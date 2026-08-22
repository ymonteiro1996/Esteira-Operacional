# -*- coding: utf-8 -*-
"""
db.py — única porta de entrada para os dados do Controle de Cargas.
==============================================================================
[2026-08-05, pedido do usuário: "consegue levantar se conseguimos efetuar
todas consultas por Endpoints igual" os apps-irmãos SWAT\\beehus-swat/
SWAT\\conciliacao — e depois "pode efetuar o processo de transição"]
MIGRAÇÃO API-FIRST: este módulo passou a buscar companies/entities/wallets/
groupings/securities/posições/NAV/issues pela API Beehus (`beehus_api/`,
cópia local do cliente HTTP genérico dos apps-irmãos — ver seu __init__.py)
em vez de ler o MongoDB de produção direto. [2026-08-05, pedido do usuário:
"pode remover toda consulta do mongo"] O acesso direto ao Mongo (conexão,
cadastro de connection string por usuário, singleton de `MongoClient`) foi
**removido por completo** deste módulo — não há mais nenhum caminho, nem
avançado/fallback, que abra conexão com o banco. Se algum dia for preciso
de novo (ex.: uma ferramenta offline), reimplementar do zero seguindo o
padrão de `SWAT\\beehus-swat\\db.py`/`SWAT\\Relatorios\\pages\\setup.py`.

Autenticação da API: token Bearer colado na tela ("🔑 Beehus API" na
masthead, ver app.py `/api/beehus-token` + `beehus_api.client`), válido por
1 dia. [2026-08-06, pedido do usuário: "mais de uma pessoa ao mesmo tempo"]
Vive POR SESSÃO DE NAVEGADOR (não mais 1 único token pro processo inteiro) e
sobrevive a um restart do servidor (persistido a disco por sessão) — ver
docstring completa de beehus_api/client.py.

[2026-08-05, validado ao vivo contra a API de produção com um token real —
ver histórico do chat] `wallets.startDateConsolidation` e
`groupings.benchmarks` EXISTEM na API (a suposição inicial, baseada só nas
docstrings do cliente HTTP em beehus_api/partner.py e grouping.py — que não
são exaustivas —, estava ERRADA; confirmado com dados reais: 979/979
carteiras da Oikos têm `startDateConsolidation` preenchido, 9/179 groupings
têm `benchmarks` não-vazio). Os dois são lidos normalmente abaixo — SEM
lacuna. Mesma validação confirmou que os campos `createdAt`/`updatedAt` de
unprocessed/processed position (horários de carga/reprocessamento/publicação
no tooltip da célula) TAMBÉM existem e vêm preenchidos — sem risco de shape
como se temia inicialmente.

Lacunas CONFIRMADAS de verdade nesta migração (validadas ao vivo — precisam
de endpoint novo da equipe Beehus se algum dia quisermos de volta; ver
`docs/PLANNING.md` "Divergências vs. levantamento anterior" e o CLAUDE.md
deste protótipo):
  1. **Colunas Última Unprocessed/Processada/Publicada (Últ. Unp/Pro/Pub)**
     removidas por completo (não só o dado — a feature: colunas da matriz,
     ordenação, painéis de detalhe, export Excel) — não existe endpoint que
     devolva "última data com dado por carteira" em lote; o agregado Mongo
     equivalente já era o passo mais caro do build (24s típicos). Ver commits
     desta migração / CLAUDE.md.
  2. `get_preprocessing_status` cobre só 6 dos 8 tipos de issue do Mongo —
     `explosion_error`/`missing_fund_position_for_explosion` não existem no
     endpoint (nenhuma chave equivalente). Ver
     `_TIPO_ISSUE_PARA_CHAVE_DETAILED` abaixo.
  3. [validado ao vivo] O item `missingWalletDetailed` (tipo `missing_wallet`
     — 1 dos 2 tipos de severidade vermelha) não tem `walletId` NEM
     `affectedWallets` (só `createdAt`/`externalId`/`externalOrigin` — faz
     sentido: é uma carteira que NÃO EXISTE no Beehus, não há id pra dar).
     Na prática, esse tipo nunca se atribui a nenhuma carteira via API (some
     do badge/contagem por carteira), embora o TIPO em si apareça no endpoint
     — diferente do Mongo, que guardava um walletId mesmo nesses casos.
     Junto com o item 2, os 2 tipos de severidade vermelha (`missing_wallet`,
     `explosion_error`) ficam sem cobertura efetiva por carteira nesta
     migração.

Formato dos campos de referência (`walletId`, `entityId`, `companyId`, etc.):
a API às vezes devolve POPULADO (dict com "_id") e às vezes CRU (string) —
inconsistente até entre respostas do MESMO endpoint (confirmado ao vivo:
`get_nav_results` devolve `walletId` cru; `partner_wallets`/`list_groupings`
devolvem `entityId`/`companyId`/`wallets[].walletId` populados). `_idstr()`
(abaixo) normaliza os dois casos — SEMPRE usada ao ler um campo de
referência da API, nunca confiar que vem de um jeito só.

Regras que valiam antes e continuam valendo:
  - NUNCA escreve nada (só leitura).
  - Sempre lote (várias carteiras/datas por chamada) — nunca 1 chamada por
    carteira; a API é escopada por empresa, então o lote é "por empresa"
    (`_agrupar_por_empresa`), com companies em paralelo (mesmo padrão de
    fan-out já usado pelos apps-irmãos em beehus_catalog.py).

Tarefa 3 do refactor 2026-07-20 (preservada): as buscas da esteira continuam
"cache-aware" por data (ver cache.py) — ao pedir uma janela de datas, só as
datas AINDA não vistas nesta sessão do processo geram chamada real à API; as
demais vêm do cache em memória. [2026-08-05] A janela agora é travada em 5
dias úteis (ver app.py `/api/atualizar`) — outro ponto desta migração: cada
data nova custa 1 chamada por empresa a `get_processed_position`/
`get_nav_results`/`get_preprocessing_status`, então travar a janela evita que
um intervalo customizado grande exploda o número de chamadas.
"""

import concurrent.futures
import time

from beehus_api import (
    bind_session_id,
    get_nav_results,
    get_preprocessing_status,
    get_processed_position,
    get_security,
    get_unprocessed_security_positions,
    id_sessao_atual,
    list_companies,
    list_entities,
    list_groupings,
    list_securities,
    partner_wallets,
)
from cache import cache_esteira_por_data, cache_ttl_colecoes

# Nº de empresas buscadas em paralelo nos fan-outs "por empresa" deste módulo
# (colecoes_pequenas: até ~19 empresas visíveis ao token) — mesma ordem de
# grandeza usada pelos apps-irmãos (beehus_catalog._NAV_WARM_WORKERS).
_FAN_OUT_WORKERS = 8

# [2026-08-05, pedido do usuário: "está demorando muito a inicialização"]
# Workers do fan-out ÚNICO de processed/nav/issues em _buscar_datas_
# faltantes_via_api — combina TODAS as (data × empresa × tipo) numa fila só
# (ver docstring da função), então o nº de tarefas é bem maior (5 empresas ×
# 6 datas × 3 tipos = 90 na janela default) do que o dos outros fan-outs
# "só por empresa" deste módulo — precisa de mais workers pra não virar
# gargalo (I/O-bound — esperar rede, não CPU — então um pool maior que o nº
# de núcleos é seguro e esperado aqui).
_FAN_OUT_WORKERS_ESTEIRA = 40

# 6 dos 8 tipos de issue que este protótipo usava do Mongo (docs/PLANNING.md
# "Tipos de issue confirmados") têm equivalente nos arrays `*Detailed` do
# pre-processing (E) — confirmado contra o uso já validado em produção pelos
# apps-irmãos (beehus_catalog.issues_by_wallet_detail, comentário "Validado
# ao vivo == Mongo"). `explosion_error` e
# `missing_fund_position_for_explosion` NÃO têm campo equivalente no endpoint
# — ficam de fora da migração (mesma lacuna registrada no topo do arquivo;
# endpoint novo necessário se quisermos esses 2 de volta).
_TIPO_ISSUE_PARA_CHAVE_DETAILED = {
    "missing_wallet":                  "missingWalletDetailed",
    "missing_unprocessed_position":    "missingPositionDetailed",
    "security_unmapped":               "securityUnmappedDetailed",
    "security_missing_classification": "securityMissingClassificationDetailed",
    "security_missing_price":          "securityMissingPriceDetailed",
    "security_missing_history_price":  "securityMissingHistoryPriceDetailed",
}

ISSUE_SEVERITY = {
    "missing_wallet": "red", "explosion_error": "red",
    "missing_unprocessed_position": "yellow", "security_unmapped": "yellow",
    "missing_fund_position_for_explosion": "yellow", "security_missing_price": "yellow",
    "security_missing_history_price": "info", "security_missing_classification": "info",
}

# [2026-08-05, pedido do usuário: "só pode ter issues pendentes se tiver como
# unprocessed... mapeamento, classificação de ativos, registro de preço,
# falta de preço no dia"] Esses 4 tipos são derivados de ANALISAR as
# securities de dentro de uma posição unprocessed já enviada — só fazem
# sentido (e só devem ser contados) pra uma carteira que TEM unprocessed
# naquela data. Regra confirmada como intencional no app-irmão
# `SWAT\beehus-swat` (mesmo produto, mesma equipe) — só que lá só é aplicada
# no FRONT-END, como filtro de exibição (templates/controlpanel.html,
# comentário "Issues column only renders chips when the wallet actually has
# unprocessed (per user spec)"), nunca no backend. Aqui aplicamos na origem
# (_issues_do_status/buscar_issues_detail), o que também evita atribuir
# contagem/entrada no cache pra uma combinação (carteira, data) que nunca
# deveria ter gerado esses 4 tipos. `missing_wallet` (sem walletId, ver
# lacuna 3 no topo do arquivo) e `missing_unprocessed_position` (que é
# JUSTAMENTE sobre a AUSÊNCIA de unprocessed — filtrar por presença
# apagaria o próprio alerta) ficam de fora desta regra.
_TIPOS_ISSUE_QUE_EXIGEM_UNPROCESSED = {
    "security_unmapped", "security_missing_classification",
    "security_missing_price", "security_missing_history_price",
}


def _idstr(valor):
    """Contexto:
    Normaliza um id que pode vir CRU (string) ou POPULADO (dict com "_id")
    da API Beehus — vários endpoints populam campos de referência
    (`wallets[].entityId`, `grouping.wallets[].walletId`, possivelmente
    `walletId` dentro de `get_nav_results`) em vez de devolver só o id cru.
    Chamada por toda função deste módulo que lê um campo de referência da
    API. Retorna string ("" se `valor` for None/vazio).

    Pseudocódigo:
      1. dict -> usa "_id" (ou "" se ausente).
      2. Caso contrário, str(valor) direto ("" se vazio/None). """
    if isinstance(valor, dict):
        return str(valor.get("_id") or "")
    return str(valor) if valor else ""


def _parse_iso_dt(valor):
    """Contexto:
    Converte um timestamp ISO (ex. "2026-06-18T16:11:33.149Z") num
    `datetime` — [2026-08-05, achado testando com token real contra a API
    de produção] a API devolve datetime SEMPRE como string JSON, nunca como
    objeto datetime (o pymongo fazia essa desserialização automática antes,
    lendo BSON direto — por isso essa conversão nunca foi necessária até
    esta migração). `formatar_horario_brt()` (utils/formatacao.py) exige um
    datetime; todo `createdAt`/`updatedAt` lido da API passa por aqui antes
    de entrar num doc montado por este módulo. Retorna datetime ou None.

    Pseudocódigo:
      1. Vazio -> None. Já é datetime -> devolve direto (idempotente).
      2. Troca o "Z" final por "+00:00" (isoformat não aceita "Z") e faz
         parse; falha de formato -> None (defensivo, nunca derruba o build). """
    import datetime as _dt
    if not valor:
        return None
    if isinstance(valor, _dt.datetime):
        return valor
    try:
        return _dt.datetime.fromisoformat(str(valor).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def _fan_out_por_empresa(ids_empresas, funcao):
    """Contexto:
    Chama `funcao(company_id)` para cada empresa de `ids_empresas` EM
    PARALELO (poucas empresas — 5 hoje — então o custo real é a latência de
    rede de 1 chamada, não o número de empresas). Usada por
    carregar_colecoes_pequenas() (wallets/groupings por empresa) e pelos
    fan-outs de data (unprocessed/processed/nav/issues). Retorna
    `{company_id: retorno_da_funcao}` — entradas cuja chamada levantou
    excecão NÃO aparecem no dict e a excecão é relançada (nunca mapa parcial
    silencioso; quem chamou decide como tratar).

    Pseudocódigo:
      1. Sem ids -> {}.
      2. ThreadPoolExecutor com no máx. _FAN_OUT_WORKERS workers, 1 chamada
         por empresa; ex.map preserva a ordem e relança a 1ª excecão.
         [2026-08-06, pedido do usuário: "mais de uma pessoa ao mesmo
         tempo"; CORRIGIDO no mesmo dia — achado em produção: "cannot enter
         context: ... is already entered"] Cada worker chama
         beehus_api.bind_session_id(sid) DENTRO da própria thread, com o sid
         capturado ANTES do fan-out (id_sessao_atual()) — sem isso, o worker
         nasce com um contexto vazio e o sid da sessão (amarrado pelo
         before_request) não chegaria até ele, quebrando o token de
         QUALQUER usuário nas chamadas em fan-out. A 1ª versão tentava
         reusar um único `contextvars.Context` (copy_context().run(...))
         entre todas as chamadas concorrentes — mas um Context não pode ser
         "entrado" por 2 threads ao mesmo tempo; propagar só o VALOR do sid
         (string) e deixar cada worker setar a própria contextvar evita o
         problema por completo (cada thread nova já tem seu contexto
         isolado, sem nada compartilhado pra colidir). """
    if not ids_empresas:
        return {}
    sid = id_sessao_atual()

    def _com_sessao(company_id):
        bind_session_id(sid)
        return funcao(company_id)

    with concurrent.futures.ThreadPoolExecutor(
            max_workers=min(_FAN_OUT_WORKERS, len(ids_empresas))) as ex:
        resultados = list(ex.map(_com_sessao, ids_empresas))
    return dict(zip(ids_empresas, resultados))


# ─────────────────────────────────────────────────────────────────────────
# Coleções pequenas (companies/entities/wallets/groupings/securities) — via
# API Beehus, cache TTL 120s (PLANNING §Otimização, regra 4)
# ─────────────────────────────────────────────────────────────────────────

def _resolver_explosao(carteiras_por_id, timings=None):
    """Contexto:
    Resolve `wallets.securitiesForExplosion` (lista de securityId em string)
    nos DOIS sentidos — chamada por carregar_colecoes_pequenas(), antes de
    devolver. Não retorna nada.

    (a) pro nome de exibição de cada security (`beehusName`) — a "explosão de
    ativos" da carteira (ex.: RGM PF BTG BRL explode em Delfos FI MM,
    Esparta FIF Ações) [2026-07-31, pedido do usuário]. Escreve
    `explodedAssetNames` (lista de string, possivelmente vazia).

    (b) [NOVO 2026-08-13, pedido do usuário: "se a carteira da lista for
    comprada por alguma carteira da lista, precisa aparecer com uma
    sinalização diferenciada e trazida como prioridade... resolver primeiro
    ele para depois as carteiras que comprar ele"] pro `walletId` REAL da
    carteira correspondente a cada security (`correspondingWallet._id`) — o
    vínculo que permite, mais adiante (snapshot_builder.mapear_carteiras_
    compradas), saber que uma carteira do Template é comprada por outra do
    Template, e não só exibir o nome do ativo. Escreve `explodedWalletIds`
    (lista de walletId, ids sem `correspondingWallet` são só omitidos).

    [2026-08-05] Nomes migrados de `db.securities.find({"_id":{"$in":ids}})`
    para `beehus_api.list_securities()` — não existe endpoint de busca por
    lote de ids na API, então isto busca o catálogo INTEIRO (1 chamada só,
    cacheado junto com o resto por 120s) e filtra no cliente. `correspondingWallet`
    NÃO vem nesse catálogo em lote (confirmado pela docstring de
    beehus_api/securities.py — só o GET individual `get_security()` traz esse
    campo), por isso (b) precisa de 1 chamada extra POR security id
    referenciado (deduplicado antes) — catálogo de explosão é pequeno (caso
    raro, não 1 por carteira), então o custo extra é baixo.

    Pseudocódigo:
      1. Junta, de todas as carteiras, os ids de security referenciados em
         securitiesForExplosion — únicos.
      2. Sem nenhum id -> grava listas vazias em todo mundo e sai (0 chamadas).
      3. 1 chamada (catálogo inteiro) resolve os nomes.
      4. 1 chamada get_security() POR id referenciado resolve
         correspondingWallet._id (ids sem esse campo são ignorados).
      5. Para cada carteira, traduz os ids que ela tem pros nomes e pros
         walletIds resolvidos (ids sem match em nenhum dos dois são só
         omitidos, não aparecem como None). """
    ids_referenciados = set()
    for w in carteiras_por_id.values():
        ids_referenciados.update(w.get("securitiesForExplosion") or [])
    if not ids_referenciados:
        for w in carteiras_por_id.values():
            w["explodedAssetNames"] = []
            w["explodedWalletIds"] = []
        return

    t0 = time.monotonic()
    nome_por_id = {}
    for sec in (list_securities() or []):
        sid = _idstr(sec.get("_id"))
        if sid in ids_referenciados:
            nome_por_id[sid] = sec.get("beehusName") or sid
    if timings is not None:
        timings["securities_explosao"] = time.monotonic() - t0

    t1 = time.monotonic()
    wallet_alvo_por_security_id = {}
    for sid in ids_referenciados:
        sec = get_security(security_id=sid)
        alvo = (sec or {}).get("correspondingWallet") or {}
        alvo_id = _idstr(alvo.get("_id"))
        if alvo_id:
            wallet_alvo_por_security_id[sid] = alvo_id
    if timings is not None:
        timings["carteiras_alvo_explosao"] = time.monotonic() - t1

    for w in carteiras_por_id.values():
        ids_da_carteira = w.get("securitiesForExplosion") or []
        w["explodedAssetNames"] = [nome_por_id[i] for i in ids_da_carteira if i in nome_por_id]
        w["explodedWalletIds"] = [wallet_alvo_por_security_id[i] for i in ids_da_carteira
                                    if i in wallet_alvo_por_security_id]


def carregar_colecoes_pequenas(timings=None):
    """Contexto:
    Carrega companies/entities/wallets/groupings inteiras (não dependem da
    janela de datas, então cacheadas por TTL de 120s) — via API Beehus.
    Retorna (empresas_por_id, entidades_por_nome_ci, carteiras_por_id,
    agrupamentos_por_id), MESMO SHAPE de antes (Mongo) — snapshot_builder.py/
    registry.py/build_snapshot.py não precisaram mudar por causa disto.

    [2026-08-05] `wallets`/`groupings` da API são escopados por empresa
    (`partner_wallets(companyId)`/`list_groupings(companyId)`) — não existe
    "buscar tudo, de toda empresa" como o antigo `db.wallets.find({})`.
    Descobre as empresas visíveis ao token (`list_companies()`) e faz fan-out
    em paralelo por empresa (_fan_out_por_empresa) — 5 empresas monitoradas
    hoje, então isso é ~1 chamada de rede de latência, não 5x.

    Pseudocódigo:
      1. Cache TTL hit -> devolve direto (cobre "Atualizar" clicado
         repetidas vezes).
      2. list_companies()/list_entities() — 2 chamadas, cobrem tudo que o
         token vê.
      3. Fan-out paralelo de partner_wallets(cid)/list_groupings(cid) por
         empresa; normaliza os ids (podem vir populados) e monta
         carteiras_por_id/agrupamentos_por_id no MESMO shape do Mongo antigo.
      4. Resolve a explosão de ativos de cada carteira (_resolver_explosao) —
         nomes de exibição E o walletId real da carteira correspondente.
      5. Grava tudo no cache TTL antes de devolver.
    """
    cacheado = cache_ttl_colecoes.obter("colecoes_pequenas")
    if cacheado is not None:
        return cacheado

    t0 = time.monotonic()
    empresas_por_id = {_idstr(c.get("_id")): {"name": c.get("name")}
                        for c in (list_companies() or []) if c.get("_id")}
    entidades_por_nome_ci = {e["name"].strip().casefold(): _idstr(e.get("_id"))
                              for e in (list_entities() or []) if e.get("name") and e.get("_id")}

    ids_empresas = list(empresas_por_id.keys())
    wallets_por_empresa = _fan_out_por_empresa(ids_empresas, partner_wallets)
    groupings_por_empresa = _fan_out_por_empresa(ids_empresas, list_groupings)

    carteiras_por_id = {}
    for company_id, wallets in wallets_por_empresa.items():
        for w in (wallets or []):
            wid = _idstr(w.get("_id"))
            if not wid:
                continue
            carteiras_por_id[wid] = {
                "name": w.get("name"),
                "companyId": company_id,
                "entityId": _idstr(w.get("entityId")),
                "accountCode": w.get("accountCode"),
                "trashed": bool(w.get("trashed")),
                "securitiesForExplosion": [str(s) for s in (w.get("securitiesForExplosion") or []) if s],
                "startDateConsolidation": w.get("startDateConsolidation"),
            }

    agrupamentos_por_id = {}
    for company_id, groupings in groupings_por_empresa.items():
        for g in (groupings or []):
            gid = _idstr(g.get("_id"))
            if not gid:
                continue
            membros = []
            for m in (g.get("wallets") or []):
                if not isinstance(m, dict):
                    continue
                membros.append({
                    "walletId": _idstr(m.get("walletId")),
                    "initialDateOnGrouping": m.get("initialDateOnGrouping"),
                    "finalDateOnGrouping": m.get("finalDateOnGrouping"),
                })
            agrupamentos_por_id[gid] = {
                "name": g.get("name"),
                "companyId": company_id,
                "trashed": bool(g.get("trashed")),
                "wallets": membros,
                "benchmarks": g.get("benchmarks"),
            }
    if timings is not None:
        timings["colecoes_pequenas"] = time.monotonic() - t0

    _resolver_explosao(carteiras_por_id, timings)

    resultado = (empresas_por_id, entidades_por_nome_ci, carteiras_por_id, agrupamentos_por_id)
    cache_ttl_colecoes.guardar("colecoes_pequenas", resultado)
    return resultado


def _mapa_empresa_por_carteira():
    """Contexto:
    `{walletId: companyId}` a partir do catálogo (cache TTL 120s, mesma
    chamada de carregar_colecoes_pequenas — não gera chamada extra à API na
    prática). Usada por _agrupar_por_empresa() pra rotear cada carteira pra
    a chamada da EMPRESA certa (todo endpoint de posição/NAV/issues da API
    Beehus é escopado por `companyId`, nunca aceita carteiras de empresas
    diferentes numa chamada só). Retorna dict.
    """
    _, _, carteiras_por_id, _ = carregar_colecoes_pequenas()
    return {wid: w.get("companyId") for wid, w in carteiras_por_id.items()}


def _mapa_empresa_por_grouping():
    """Contexto: `{groupingId: companyId}` a partir do catálogo — mesmo
    propósito de _mapa_empresa_por_carteira(), pro lado dos agrupamentos
    (usada só pra descobrir QUAIS empresas têm agrupamento monitorado, já
    que `get_nav_results`/`get_preprocessing_status` devolvem todas as
    carteiras E agrupamentos da empresa numa chamada só — não há "buscar só
    estes groupingIds"). Retorna dict."""
    _, _, _, agrupamentos_por_id = carregar_colecoes_pequenas()
    return {gid: g.get("companyId") for gid, g in agrupamentos_por_id.items()}


def _agrupar_por_empresa(ids, mapa_empresa_por_id):
    """Contexto:
    Agrupa uma lista plana de ids (carteiras OU agrupamentos) por empresa —
    `{companyId: [id1, id2, ...]}` — usando o mapa já resolvido do catálogo.
    Todo fan-out de data (unprocessed/processed/nav/issues) começa por aqui,
    já que os endpoints da API são escopados por empresa. Ids sem empresa
    resolvida no catálogo são ignorados (carteira/grouping órfão — não
    deveria acontecer, mas nunca deve derrubar o build). Retorna dict.
    """
    por_empresa = {}
    for i in (ids or []):
        cid = mapa_empresa_por_id.get(i)
        if cid:
            por_empresa.setdefault(cid, []).append(i)
    return por_empresa


# ─────────────────────────────────────────────────────────────────────────
# Batch queries da esteira — cache-aware POR DATA (Tarefa 3 do refactor),
# agora via API Beehus (fan-out por empresa × data)
# ─────────────────────────────────────────────────────────────────────────

def _wallet_ids_do_item_issue(item):
    """Contexto:
    Extrai a lista de walletId de 1 item de um array `*Detailed` do
    pre-processing (E) — cada item pode trazer `affectedWallets` (várias
    carteiras, tipos de security) OU um `walletId` único (tipos de
    carteira). Chamada por _issues_do_status() e buscar_issues_detail() —
    único lugar com essa normalização (CLAUDE.md §6, evitar duplicar).
    Retorna lista de string (pode ter 1 item vazio "" — ver nota).

    [validado ao vivo] `missingWalletDetailed` (tipo `missing_wallet`) não
    tem NENHUM dos dois campos (só `createdAt`/`externalId`/`externalOrigin`
    — faz sentido: é uma carteira que não existe no Beehus, não há id pra
    dar) — `_idstr(item.get("walletId"))` some devolve "" nesse caso; quem
    chama SEMPRE precisa descartar wid vazio (ver docstring do módulo,
    lacuna 3 — `missing_wallet` nunca se atribui a uma carteira específica
    nesta migração).

    Pseudocódigo:
      1. Tem `affectedWallets` (lista não-vazia) -> 1 wid por entrada.
      2. Senão -> lista de 1 elemento com `item.get("walletId")` (pode ser
         vazio). """
    afetados = item.get("affectedWallets")
    if isinstance(afetados, list) and afetados:
        return [_idstr(w.get("id") if isinstance(w, dict) else w) for w in afetados]
    return [_idstr(item.get("walletId"))]


def _issues_do_status(status, wallet_ids_desejados=None, carteiras_com_unprocessed=None):
    """Contexto:
    Extrai `{(walletId, tipo): count}` de UM resultado já buscado de
    `get_preprocessing_status(company_id, date)`, varrendo os 6 tipos
    confirmados (_TIPO_ISSUE_PARA_CHAVE_DETAILED) e expandindo cada item
    (_wallet_ids_do_item_issue) — mesma granularidade do antigo
    `db.issues.aggregate` por walletId+type. Chamada por
    _buscar_datas_faltantes_via_api() (grid, todas as carteiras da empresa).
    Retorna dict.

    Pseudocódigo:
      1. Pra cada 1 dos 6 tipos confirmados, lê a lista `*Detailed` do status.
      2. Expande cada item em 1+ walletId (_wallet_ids_do_item_issue).
      3. Se `wallet_ids_desejados` foi passado, ignora ids fora do filtro (e
         sempre ignora id vazio).
      4. [2026-08-05, pedido do usuário] Se `carteiras_com_unprocessed` foi
         passado E o tipo é um dos 4 que exigem unprocessed
         (_TIPOS_ISSUE_QUE_EXIGEM_UNPROCESSED), ignora a entrada quando essa
         carteira NÃO tem unprocessed na mesma data (a issue não devia
         existir pra ela sem unprocessed — descartar em vez de contar).
      5. Incrementa a contagem (walletId, tipo). """
    if not isinstance(status, dict):
        return {}
    desejados = set(wallet_ids_desejados) if wallet_ids_desejados is not None else None
    contagem = {}
    for tipo, chave in _TIPO_ISSUE_PARA_CHAVE_DETAILED.items():
        exige_unprocessed = tipo in _TIPOS_ISSUE_QUE_EXIGEM_UNPROCESSED
        for item in (status.get(chave) or []):
            if not isinstance(item, dict):
                continue
            for wid in _wallet_ids_do_item_issue(item):
                if not wid or (desejados is not None and wid not in desejados):
                    continue
                if (exige_unprocessed and carteiras_com_unprocessed is not None
                        and wid not in carteiras_com_unprocessed):
                    continue
                chave_contagem = (wid, tipo)
                contagem[chave_contagem] = contagem.get(chave_contagem, 0) + 1
    return contagem


def _buscar_datas_faltantes_via_api(datas_faltantes, wallet_ids, grouping_ids, timings):
    """Contexto:
    Substitui `_buscar_datas_faltantes_no_mongo` — busca na API Beehus TODAS
    as datas que faltam no cache (unprocessed/processed/nav-carteira/issues/
    nav-grouping). Preenche `cache_esteira_por_data` com o resultado, uma
    entrada por data. Não devolve nada — quem chamou relê do cache.

    [2026-08-05, pedido do usuário: "está demorando muito a inicialização"]
    REESCRITO pra paralelizar por (data × empresa), não só por empresa
    dentro de uma data processada por vez: a versão anterior rodava as N
    datas em SÉRIE (pro de todas empresas, depois nav de todas, depois
    issues de todas — só então a data seguinte), então o tempo total era a
    SOMA de todas as rodadas. Com só 5 empresas monitoradas e um pool de
    workers bem maior que isso, não fazia sentido nenhuma dessas ~90
    chamadas (N datas × 5 empresas × 3 tipos) esperar a rodada anterior
    terminar — nenhuma depende do resultado de outra. Agora TODAS entram
    numa única fila e disputam o mesmo pool de workers; o tempo total passa
    a ser ~(nº de chamadas ÷ workers) × latência média, não mais N ×
    (pro + nav + issues) em série.

    Custo em chamadas HTTP (5 empresas monitoradas hoje, N = nº de datas
    faltantes, sempre ≤ 5-6 du por causa do teto da janela — ver
    app.py /api/atualizar) — mesmo total de antes, só que TODAS em paralelo:
      - unprocessed: 1 chamada por empresa (aceita faixa de datas) = 5.
      - processed:   1 chamada por empresa POR DATA = 5×N.
      - nav+issues:  2 chamadas por empresa POR DATA = 10×N.

    Pseudocódigo:
      1. Sem datas faltantes -> não faz nada.
      2. Agrupa wallet_ids/grouping_ids por empresa; união das 2 chaves =
         empresas relevantes.
      3. unprocessed: 1 chamada por empresa cobrindo [min..max] das datas
         faltantes (fan-out paralelo entre empresas) — feito ANTES do resto
         porque o filtro de issues (passo 5) precisa saber quem tem
         unprocessed em cada data.
      4. Monta a fila ÚNICA de tarefas (pro/nav/issues × data × empresa) e
         roda tudo num só ThreadPoolExecutor.
      5. Reagrupa os resultados por data e monta os docs no MESMO shape de
         antes (mesmas chaves que o Mongo devolvia), aplicando o filtro de
         unprocessed nas issues (_issues_do_status), e grava no cache. """
    if not datas_faltantes:
        return

    empresa_por_carteira = _mapa_empresa_por_carteira()
    empresa_por_grouping = _mapa_empresa_por_grouping()
    carteiras_por_empresa = _agrupar_por_empresa(wallet_ids, empresa_por_carteira)
    groupings_por_empresa = _agrupar_por_empresa(grouping_ids, empresa_por_grouping)
    empresas_relevantes = sorted(set(carteiras_por_empresa) | set(groupings_por_empresa))

    por_data = {d: {"unp": [], "pro": [], "nav": [], "issues": [], "nav_grouping": []}
                for d in datas_faltantes}

    # ── unprocessed: 1 chamada por empresa, faixa [min..max] das datas ──────
    # Fica ANTES do resto (não entra na fila única) porque as issues (passo
    # 5) precisam do resultado pra filtrar os 4 tipos security_* por
    # unprocessed-na-mesma-data — ver _TIPOS_ISSUE_QUE_EXIGEM_UNPROCESSED.
    t0 = time.monotonic()
    data_min, data_max = min(datas_faltantes), max(datas_faltantes)

    def _buscar_unp_empresa(company_id):
        wids = carteiras_por_empresa.get(company_id) or []
        if not wids:
            return []
        return get_unprocessed_security_positions(
            company_id=company_id, initial_date=data_min, final_date=data_max, wallet_ids=wids)

    for docs in _fan_out_por_empresa(list(carteiras_por_empresa.keys()), _buscar_unp_empresa).values():
        for doc in (docs or []):
            wid = _idstr(doc.get("walletId"))
            pd = str(doc.get("positionDate") or "")[:10]
            if not wid or pd not in por_data:
                continue
            por_data[pd]["unp"].append({
                "walletId": wid, "positionDate": pd,
                # ver nota de _parse_iso_dt() mais abaixo (mesmo motivo:
                # API devolve string ISO, não datetime).
                "createdAt": _parse_iso_dt(doc.get("createdAt")),
                "inputType": doc.get("inputType"),
            })
    if timings is not None:
        timings["unprocessedSecurityPositions"] = timings.get("unprocessedSecurityPositions", 0) + (time.monotonic() - t0)

    # ── processed / nav / issues: TODAS as (empresa × data) numa fila só ────
    tarefas = []
    for data in datas_faltantes:
        for company_id in carteiras_por_empresa:
            tarefas.append(("pro", data, company_id))
        for company_id in empresas_relevantes:
            tarefas.append(("nav", data, company_id))
            tarefas.append(("issues", data, company_id))

    def _executar_tarefa(tarefa):
        tipo, data, company_id = tarefa
        if tipo == "pro":
            wids = carteiras_por_empresa.get(company_id) or []
            resultado = get_processed_position(company_id=company_id, date=data, wallet_ids=wids) if wids else []
        elif tipo == "nav":
            resultado = get_nav_results(company_id=company_id, position_date=data)
        else:  # "issues"
            resultado = get_preprocessing_status(company_id=company_id, position_date=data)
        return tarefa, resultado

    def _executar_tarefa_com_sessao(tarefa, sid):
        bind_session_id(sid)
        return _executar_tarefa(tarefa)

    t0 = time.monotonic()
    resultados_por_tarefa = {}
    if tarefas:
        # [2026-08-06] Mesma propagação de sid por VALOR (não por Context
        # compartilhado) do fan-out acima (_fan_out_por_empresa) — ver
        # comentário lá sobre o "cannot enter context: ... is already
        # entered" da 1ª versão.
        sid = id_sessao_atual()
        with concurrent.futures.ThreadPoolExecutor(
                max_workers=min(_FAN_OUT_WORKERS_ESTEIRA, len(tarefas))) as ex:
            for tarefa, resultado in ex.map(lambda t: _executar_tarefa_com_sessao(t, sid), tarefas):
                resultados_por_tarefa[tarefa] = resultado
    t_total_esteira = time.monotonic() - t0

    for data in datas_faltantes:
        carteiras_com_unprocessed = {doc["walletId"] for doc in por_data[data]["unp"]}

        for company_id in carteiras_por_empresa:
            for env in (resultados_por_tarefa.get(("pro", data, company_id)) or []):
                pos = (env or {}).get("position") or {}
                wid = _idstr(pos.get("walletId"))
                pd = str(pos.get("positionDate") or "")[:10]
                if not wid or pd != data:
                    continue
                por_data[data]["pro"].append({
                    "walletId": wid, "positionDate": pd,
                    "published": bool(pos.get("published")),
                    # [2026-08-05, achado testando com token real] a API
                    # devolve datetime como STRING ISO ("...T14:32:40.752Z"),
                    # não como objeto datetime (o pymongo fazia essa
                    # desserialização automática antes) — formatar_horario_brt()
                    # exige datetime; _parse_iso_dt() converte (None se
                    # ausente/malformado, nunca derruba o build).
                    "createdAt": _parse_iso_dt(pos.get("createdAt")),
                    "updatedAt": _parse_iso_dt(pos.get("updatedAt")),
                })

        for company_id in empresas_relevantes:
            resultado = resultados_por_tarefa.get(("nav", data, company_id)) or {}
            for item in (resultado.get("walletsWithNavDetailed") or []):
                wid = _idstr(item.get("walletId"))
                if not wid:
                    continue
                por_data[data]["nav"].append({
                    "walletId": wid, "positionDate": data,
                    "returnContribution": item.get("returnContribution"),
                    "returnNavPerShare": item.get("returnNavPerShare"),
                    "nav": item.get("nav"), "navPerShare": item.get("navPerShare"),
                    # [2026-08-05] `get_nav_results` não devolve estes 3 campos
                    # (confirmado no schema documentado do endpoint) — sempre
                    # None. `formerNav`/`formerNavPerShare` só alimentavam o
                    # tooltip de auditoria (nunca o cálculo do badge Rent, que
                    # usa só returnContribution/returnNavPerShare/nav, todos
                    # presentes); `published`, aqui, não tem consumidor
                    # (confirmado em snapshot_builder.py — quem decide
                    # "Publicada" é sempre `processedPosition.published`).
                    "formerNav": None, "formerNavPerShare": None, "inAndOutFlows": None,
                    "published": None, "createdAt": None,
                })
            for item in (resultado.get("groupingsDetailed") or []):
                gid = _idstr(item.get("groupingId"))
                if not gid:
                    continue
                por_data[data]["nav_grouping"].append({
                    "groupingId": gid, "positionDate": data,
                    "returnContribution": item.get("returnContribution"),
                    "returnNavPerShare": item.get("returnNavPerShare"),
                    "nav": item.get("nav"), "navPerShare": item.get("navPerShare"),
                    "published": item.get("published"),
                })

            status = resultados_por_tarefa.get(("issues", data, company_id))
            for (wid, tipo), n in _issues_do_status(status, carteiras_com_unprocessed=carteiras_com_unprocessed).items():
                por_data[data]["issues"].append({"_id": {"w": wid, "d": data, "t": tipo}, "n": n})

    if timings is not None:
        # [2026-08-05] UMA métrica só (não mais 1 por tipo) — processed/nav/
        # issues agora correm TODAS juntas no mesmo pool de workers (ver
        # docstring da função), então não existe mais um "tempo individual"
        # de cada tipo pra reportar separado sem inventar um número; reportar
        # 3 chaves com o mesmo valor daria a falsa impressão de que a soma é
        # o tempo real (seria, na verdade, o TRIPLO do tempo de parede real).
        timings["processedPosition+navPackages+issues (paralelo)"] = \
            timings.get("processedPosition+navPackages+issues (paralelo)", 0) + t_total_esteira

    for data, valores in por_data.items():
        cache_esteira_por_data.guardar(data, valores["unp"], valores["pro"], valores["nav"],
                                        valores["issues"], valores["nav_grouping"])


def invalidar_cache_esteira(datas):
    """Contexto:
    Remove as datas informadas do cache por-data da esteira — chamada por
    montar_snapshot() (build_snapshot.py) quando `forcar_atualizacao=True`
    (rota /api/atualizar, botão "Atualizar" da tela), garantindo que essas
    datas sejam buscadas DE NOVO na API mesmo se já tivessem sido vistas
    antes nesta sessão do processo. Não retorna nada.

    Pseudocódigo:
      1. Delega pra cache_esteira_por_data.invalidar_datas().
    """
    cache_esteira_por_data.invalidar_datas(datas)


def buscar_dados_esteira_para_datas(wallet_ids, grouping_ids, datas_pedidas, timings=None):
    """Contexto:
    Função PRINCIPAL de otimização (Tarefa 3): dado o conjunto de datas que a
    tela precisa (a janela do grid, com ou sem o dia extra do gate de
    sequência), devolve os mesmos 5 mapas que o resto do código (
    snapshot_builder.py) já espera — (unp_map, pro_map, nav_map, issues_map,
    nav_group_map), todos keyed por (id, positionDate) — mas só busca na API
    as datas que ESTA sessão do processo ainda não viu. Usada tanto pela
    carga inicial (build_snapshot.py) quanto pelo botão "Atualizar" (app.py
    /api/atualizar) — o cache é COMPARTILHADO entre as duas.

    Pseudocódigo:
      1. Descobre quais datas pedidas faltam no cache.
      2. Busca só essas na API (_buscar_datas_faltantes_via_api) e grava no
         cache.
      3. Para TODAS as datas pedidas (cache antigo + recém-buscado), lê do
         cache e monta os mapas finais keyed por (id, data).
    """
    datas_faltantes = cache_esteira_por_data.datas_faltantes(datas_pedidas)
    _buscar_datas_faltantes_via_api(datas_faltantes, wallet_ids, grouping_ids, timings)

    unp_map, pro_map, nav_map = {}, {}, {}
    issues_map = {}
    nav_group_map = {}
    for data in datas_pedidas:
        cacheado = cache_esteira_por_data.obter(data) or {
            "unp": [], "pro": [], "nav": [], "issues": [], "nav_grouping": []}
        for doc in cacheado["unp"]:
            unp_map[(doc["walletId"], doc["positionDate"])] = doc
        for doc in cacheado["pro"]:
            pro_map[(doc["walletId"], doc["positionDate"])] = doc
        for doc in cacheado["nav"]:
            nav_map[(doc["walletId"], doc["positionDate"])] = doc
        for linha in cacheado["issues"]:
            chave = (linha["_id"]["w"], linha["_id"]["d"])
            issues_map.setdefault(chave, []).append((linha["_id"]["t"], linha["n"]))
        for doc in cacheado["nav_grouping"]:
            nav_group_map[(doc["groupingId"], doc["positionDate"])] = doc

    if timings is not None:
        timings["datas_novas_consultadas"] = len(datas_faltantes)
        timings["datas_do_cache"] = len(datas_pedidas) - len(datas_faltantes)
    return unp_map, pro_map, nav_map, issues_map, nav_group_map


def buscar_issues_detail(wallet_ids, data_inicial, data_final, timings=None):
    """Contexto:
    Issues pendentes por carteira, pro Painel de Detalhe (PLANNING §Painéis
    de Detalhe, item 5). Recebe `wallet_ids` já restrito às carteiras com
    pendência (nunca todas as ~921) para manter o payload pequeno.

    [2026-08-05] Migrado do Mongo (`db.issues.find`, com `description`
    integral) pra `get_preprocessing_status` — MESMO shape de saída de
    antes (date/type/severity/description/inputType/createdAt por carteira),
    mas `description`/`inputType` sempre vazios/None: a API não tem esses 2
    campos (confirmado — nenhum endpoint de pre-processing os expõe; ver
    docstring do módulo). `type` cobre só os 6 tipos confirmados
    (_TIPO_ISSUE_PARA_CHAVE_DETAILED) — `explosion_error`/
    `missing_fund_position_for_explosion` não aparecem mais aqui. [pedido do
    usuário] Os 4 tipos security_* (_TIPOS_ISSUE_QUE_EXIGEM_UNPROCESSED) só
    aparecem pra carteiras com unprocessed NA MESMA data — lidas do cache
    por data (cache_esteira_por_data), já preenchido por
    buscar_dados_esteira_para_datas() pra essa MESMA janela dentro da mesma
    chamada de montar_snapshot() (nunca gera chamada extra à API só pra
    isso; sem cache pra uma data, o filtro fica permissivo nela).

    Pseudocódigo:
      1. Sem carteiras com pendência, não faz chamada nenhuma.
      2. Agrupa as carteiras pedidas por empresa; pra cada (empresa, data)
         dentro de [data_inicial..data_final], 1 chamada a
         get_preprocessing_status (fan-out paralelo por empresa, sequencial
         por data — janela sempre ≤ 5-6 du, ver app.py /api/atualizar).
      3. Expande os 6 tipos confirmados (_wallet_ids_do_item_issue), filtrado
         às carteiras pedidas e, pros 4 tipos security_*, também às
         carteiras com unprocessed nessa data (cache) — monta o dict final
         por carteira. """
    from utils.formatacao import formatar_horario_brt

    resultado = {}
    if not wallet_ids:
        return resultado

    t0 = time.monotonic()
    empresa_por_carteira = _mapa_empresa_por_carteira()
    carteiras_por_empresa = _agrupar_por_empresa(wallet_ids, empresa_por_carteira)
    desejados = set(wallet_ids)

    from utils.datas import CalendarioDiasUteis
    datas = CalendarioDiasUteis().sequencia_dias_uteis(data_inicial, data_final)

    for data in datas:
        def _buscar_status_empresa(company_id, _data=data):
            return get_preprocessing_status(company_id=company_id, position_date=_data)

        cacheado = cache_esteira_por_data.obter(data)
        carteiras_com_unprocessed = ({doc["walletId"] for doc in cacheado["unp"]}
                                      if cacheado is not None else None)

        for company_id, status in _fan_out_por_empresa(list(carteiras_por_empresa.keys()), _buscar_status_empresa).items():
            if not isinstance(status, dict):
                continue
            for tipo, chave in _TIPO_ISSUE_PARA_CHAVE_DETAILED.items():
                exige_unprocessed = tipo in _TIPOS_ISSUE_QUE_EXIGEM_UNPROCESSED
                for item in (status.get(chave) or []):
                    if not isinstance(item, dict):
                        continue
                    for wid in _wallet_ids_do_item_issue(item):
                        if wid not in desejados:
                            continue
                        if (exige_unprocessed and carteiras_com_unprocessed is not None
                                and wid not in carteiras_com_unprocessed):
                            continue
                        resultado.setdefault(wid, []).append({
                            "date": data,
                            "type": tipo,
                            "severity": ISSUE_SEVERITY.get(tipo, "info"),
                            # [2026-08-05] não existem na API (ver docstring).
                            "description": "",
                            "inputType": None,
                            "createdAt": formatar_horario_brt(_parse_iso_dt(item.get("createdAt"))),
                        })
    if timings is not None:
        timings["issues_detail"] = time.monotonic() - t0
    return resultado
