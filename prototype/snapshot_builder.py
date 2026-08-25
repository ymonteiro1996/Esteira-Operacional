# -*- coding: utf-8 -*-
"""
snapshot_builder.py — regra de negócio: docs do Mongo -> células/linhas do grid.
====================================================================================
Camada de "calcular" (entre "buscar dado" em db.py e "formatar pro front"
em build_snapshot.py/excel_report.py) — CLAUDE.md §3, "separe as camadas:
buscar dados, aplicar regra de negócio e formatar a resposta". Extraído de
build_snapshot.py na refatoração de 2026-07-20; a LÓGICA não mudou (mesma
simbologia/thresholds/fórmula de prioridade do PLANNING.md aprovado), só a
organização em módulo próprio.

[REVISADO 2026-07-24, pedido do usuário — nova fórmula de prioridade,
substitui INTEIRAMENTE a fórmula de score 0-100 (que valeu de 2026-07-20 a
2026-07-24)] priorityScore/tier saíram do modelo. A ordenação agora usa só
`compute_sort_key()`: rank do mockkey da carteira/agrupamento NA DATA DE
REFERÊNCIA (pior primeiro, mesma ordem pedida pro usuário pra legenda) +
desempate pela contagem de dias da janela pesquisada com esse MESMO mockkey.
O conceito de "tier" (Crítica/Atenção/Observação/OK) foi removido do modelo —
onde antes se checava tier (bloco de agrupamento, filtro "só com pendência",
quais carteiras buscar issuesDetail) agora se checa diretamente o mockkey da
data de referência (∉ {"p","cD"} = "tem pendência"). Ver
MOCKKEY_PRIORITY_RANK, compute_sort_key() abaixo.

[REVISADO 2026-07-25, pedido do usuário] O gate de "pré-onboarding"
(`startDateConsolidation`) saiu de `compute_cell()` — toda carteira do
Template é "esperada" em todo dia, nos dois regimes; o mockkey `notcov`
("Não cobrado") nunca mais é produzido pra carteira (o processo operacional
garante que uma carteira só entra no Template quando realmente começa a
ser consolidada). `notcov` continua existindo só pros 2 casos de Agrupamento
sem carteira-membro pra herdar estado (bloco 3 / dia sem membro ativo).

[REVISADO 2026-07-27, pedido do usuário — achado no caso real "JKZ OTHERS
BRL" (Mensal + Repetição Diária = Sim, processada quase todo dia útil, mas
aparecendo "miss" porque o código só julgava o fechamento do mês)] O regime
mensal (`fechamento_vigente_no_dia`, criado em 2026-07-25) saiu por
completo — TODA carteira, Mensal ou Diária, julga o doc e o prazo do
PRÓPRIO dia da célula (`prazo_regime_diario` + Defasagem). Periodicidade
virou só metadado de exibição (`monthly`, badge, coluna Defasagem do
Excel); confirmado com o usuário que vale até pra Mensal sem Repetição
Diária ("mesma regra por dia, sem exceção") — a intenção é que "Mensal" só
influencie, no futuro, o alerta Rent (`div_overlay_kind` já não distingue
regime, então nenhuma mudança foi necessária ali hoje). Ver compute_cell().

Contrato geral: todas as datas são strings "YYYY-MM-DD"; nada aqui toca o
Mongo diretamente (recebe os mapas já buscados por db.py).
"""

import datetime as dt
from collections import defaultdict

from utils.formatacao import formatar_horario_brt

# Mapa único de estados (mesmas chaves do STATES do front-end, ver
# static/js/controle_cargas/state.js). O fundo da célula codifica SÓ o
# estágio (rodada 7 da simbologia, PLANNING §Simbologia da Matriz de
# Status): os estados em-progresso colapsam em 2 mockkeys ("wu"=Unprocessed,
# "wc"=Processada); o atraso vira o badge "Atraso" (ver compute_overlays).
# [REVISADO 2026-07-24, pedido do usuário — "só um tipo de Sem Unprocessed,
# as sinalizações de atraso já avisam se está atrasado"] miss_late e
# miss_very_late colapsam num mockkey único "miss" (antes eram "miss"/
# "miss2" separados) — a distinção de severidade (1-2du vs ≥3du) continua
# existindo só pra decidir o badge de Atraso (atraso_overlay_kind) e o
# desempate de prioridade (ver state_from_cell(), mais abaixo).
# [REVISADO 2026-07-25, pedido do usuário — onboarding de carteira virou
# processo operacional (só entra no Template quando realmente inicia), não
# mais lógica de célula] "not_due" nunca mais é produzido por compute_cell()
# — removido daqui. O mockkey "notcov" continua existindo (ver
# MOCKKEY_TO_STATE/MOCKKEY_LETTER/MOCKKEY_PRIORITY_RANK abaixo) só para os 2
# casos de Agrupamento sem carteira-membro pra herdar estado
# (montar_linha_grouping_bloco3()/montar_celula_grouping_dia()), que nunca
# passam por este mapa.
STATE_TO_MOCKKEY = {
    ("done", "Pub"): "p", ("done", "Pro"): "cD",
    ("wip_ok", "Unp"): "wu", ("wip_ok", "Pro"): "wc",
    ("wip_late", "Unp"): "wu", ("wip_late", "Pro"): "wc",
    ("wip_very_late", "Unp"): "wu", ("wip_very_late", "Pro"): "wc",
    ("miss_late", None): "miss", ("miss_very_late", None): "miss",
    ("pending", None): "wait",
}

REDAMBER_STATES = {"miss_late", "miss_very_late", "wip_late", "wip_very_late"}

# Thresholds de divergência Rent Contribuição × Rent NAV (PLANNING §Alertas 5/6)
# [REVISADO 2026-07-31, pedido do usuário: "0,02% de diferença da
# rentabilidade é nosso novo parâmetro, também incluir para não exibir
# diferenças... menores que 800 reais" — 2 campos novos de filtro, os DOIS
# precisam passar pra a divergência aparecer (ver div_overlay_kind()).
# LIMIAR_DIVERGENCIA_FORTE (5bp, tier vermelho) não foi mencionado, mantido
# fixo — só os 2 campos abaixo viraram editáveis pela tela.
#
# [REVISADO 2026-07-31, mesmo dia, pedido do usuário: "campos para mudar o
# valor" — os 2 campos deixaram de ser só constantes fixas e passaram a ser
# MUTÁVEIS em runtime: LIMIAR_DIVERGENCIA/LIMIAR_DIVERGENCIA_REAIS guardam o
# valor ATIVO agora (o que div_overlay_kind() de fato usa); os `_PADRAO`
# guardam o valor original, pra resetar quando o usuário limpa o campo na
# tela. Ajustados só por definir_limiares_divergencia() (chamada por
# montar_snapshot(), build_snapshot.py, com o que veio de /api/atualizar) —
# nunca direto. Seguro pra este protótipo (1 usuário, 1 processo síncrono
# por vez, documentado em CLAUDE.md — "Notas específicas deste protótipo");
# um app multi-usuário concorrente precisaria de outra solução (parâmetro
# explícito threading por toda a cadeia de chamadas, em vez de global).
LIMIAR_DIVERGENCIA_PADRAO = 2e-4          # 2 bp = 0,02%
LIMIAR_DIVERGENCIA_REAIS_PADRAO = 800     # R$
LIMIAR_DIVERGENCIA_FORTE = 5e-4           # 5 bp — inalterado, não é campo editável
LIMIAR_DIVERGENCIA = LIMIAR_DIVERGENCIA_PADRAO            # valor ATIVO (mutável)
LIMIAR_DIVERGENCIA_REAIS = LIMIAR_DIVERGENCIA_REAIS_PADRAO  # valor ATIVO (mutável)


def definir_limiares_divergencia(limiar_pct=None, limiar_reais=None):
    """Contexto:
    Ajusta os 2 thresholds ATIVOS de divergência Rent Contrib × Rent NAV —
    chamada por montar_snapshot() (build_snapshot.py) no início de cada
    execução (CLI, boot ou /api/atualizar), antes de calcular qualquer
    célula, com o que veio dos 2 campos editáveis da tela (ou None, se o
    usuário deixou em branco). [2026-07-31, pedido do usuário: "campos para
    mudar o valor"]. Não retorna nada.

    Pseudocódigo:
      1. `limiar_pct`/`limiar_reais` vierem None -> volta pro padrão
         (LIMIAR_DIVERGENCIA_PADRAO/_REAIS_PADRAO) — cobre tanto "nunca foi
         informado" quanto "o usuário limpou o campo".
      2. Vierem um valor -> grava como o novo ATIVO. """
    global LIMIAR_DIVERGENCIA, LIMIAR_DIVERGENCIA_REAIS
    LIMIAR_DIVERGENCIA = limiar_pct if limiar_pct is not None else LIMIAR_DIVERGENCIA_PADRAO
    LIMIAR_DIVERGENCIA_REAIS = limiar_reais if limiar_reais is not None else LIMIAR_DIVERGENCIA_REAIS_PADRAO

# ranking de severidade p/ roll-up de agrupamento (pior caso) — usado só por
# achar_pior_celula_ativa() pra decidir a cor/sigla que o AGRUPAMENTO herda
# do pior membro ativo no dia; nada a ver com a ordenação de prioridade das
# linhas (ver MOCKKEY_PRIORITY_RANK/compute_sort_key(), mais abaixo).
RANKING_SEVERIDADE = {
    "not_due": 0, "done": 1, "wip_ok": 2, "pending": 3,
    "wip_late": 4, "wip_very_late": 5, "miss_late": 6, "miss_very_late": 7,
}
# "∅" (U+2205) — sigla do estado "Faltando, vencida" (miss).
ORDEM_ESTAGIO = {"Agd": 0, "—": 0, "∅": 0, "Unp": 1, "Pro": 2, "Pub": 3}

MOCKKEY_TO_STATE = {
    "p": "done", "cD": "done", "wu": "wip_ok", "wc": "wip_ok",
    "miss": "miss_late",  # refinado por state_from_cell() quando precisa da severidade real (miss_late vs miss_very_late)
    "wait": "pending", "notcov": "not_due",
}
MOCKKEY_LETTER = {"p": "Pub", "cD": "Pro", "wu": "Unp", "wc": "Pro",
                  "miss": "∅", "wait": "Agd", "notcov": "—"}


def state_from_cell(cell):
    """Contexto:
    Reconstrói o estado de severidade completo de uma célula já montada —
    necessário pro roll-up de agrupamento (RANKING_SEVERIDADE), já que o
    mockkey sozinho não distingue severidade dentro de wu/wc (rodada 7) nem,
    desde a fusão miss/miss2 (2026-07-24), dentro de "miss". A severidade vem
    do campo "adu" (atraso em du), gravado em toda célula problemática
    (REDAMBER_STATES).

    [REVISADO 2026-07-24, pedido do usuário — novo racional de atraso: já
    conta atrasado a partir do PRÓPRIO dia da defasagem] Checa a PRESENÇA da
    chave "adu" pra wu/wc, não só o valor: uma célula wip_late agora pode ter
    adu==0 (atrasada desde hoje), que ficaria indistinguível de "sem adu"
    (wip_ok, nunca atrasada) se só olhasse o valor default. "miss" sempre tem
    "adu" gravado (nunca existe miss "no prazo"), então não precisa desse
    cuidado.

    Pseudocódigo:
      1. wu/wc: sem a chave "adu" -> wip_ok (nunca esteve atrasada); com
         "adu" -> wip_very_late (≥3du) ou wip_late (senão).
      2. miss: sempre refina em miss_very_late (≥3du) ou miss_late (senão).
      3. Outros mockkeys -> estado-base direto (MOCKKEY_TO_STATE).
    """
    if cell["s"] in ("wu", "wc"):
        if "adu" not in cell:
            return MOCKKEY_TO_STATE[cell["s"]]
        return "wip_very_late" if cell["adu"] >= 3 else "wip_late"
    if cell["s"] == "miss":
        return "miss_very_late" if cell.get("adu", 0) >= 3 else "miss_late"
    return MOCKKEY_TO_STATE[cell["s"]]


# ─────────────────────────────────────────────────────────────────────────
# Prioridade de exibição (PLANNING §Ordenação das linhas) — [REVISADO
# 2026-07-24, pedido do usuário] substitui INTEIRAMENTE o score 0-100 de
# 2026-07-20 (que olhava a janela inteira com pesos de severidade/atraso/
# extensão/overlay + bônus de comentário). A nova regra olha só a data de
# REFERÊNCIA: rank do mockkey daquele dia (pior primeiro — mesma ordem que o
# usuário pediu pra legenda) + desempate pela CONTAGEM de dias da janela
# pesquisada com esse MESMO mockkey (mais dias iguais = mais prioritário;
# ex.: "sem posição em todos os dias do range pesquisado" é o caso mais
# prioritário possível).
#
# [AMPLIADO 2026-08-13, pedido do usuário: "se a carteira da lista for
# comprada por alguma carteira da lista, precisa aparecer com uma
# sinalização diferenciada e trazida como prioridade... porque precisamos
# resolver primeiro ele para depois as carteiras que comprar ele"] Ganhou um
# 1º critério, na frente de tudo: carteiras "compradas" (ver
# mapear_carteiras_compradas) que AINDA têm pendência na data de referência
# furam a fila de TODAS as outras (mesmo as com mockkey pior) — confirmado
# com o usuário: só fura a fila entre quem já tem algum problema pendente,
# nunca na frente de quem já está Publicado (senão destacaria uma carteira
# que na prática já está resolvida). Ver compute_wallet_row() (calcula
# `aguardando_explosao` antes de chamar compute_sort_key).
# ─────────────────────────────────────────────────────────────────────────
MOCKKEY_PRIORITY_RANK = {
    "miss": 0, "wait": 1, "notcov": 2, "wu": 3, "wc": 4, "cD": 5, "p": 6,
}


def mapear_carteiras_compradas(registry_por_id):
    """Contexto:
    [2026-08-13, pedido do usuário] Cruza `explodedWalletIds` (ver
    registry.py/db.py::_resolver_explosao) de TODAS as carteiras do Template
    entre si: se a carteira A tem a carteira B (também do Template) em
    `explodedWalletIds`, B é "comprada" por A — a explosão de A depende do
    dado de B estar pronto, então B precisa ser resolvida ANTES. Chamada 1x
    por montar_snapshot() (build_snapshot.py), antes do loop de
    compute_wallet_row — o resultado é repassado pra cada carteira. Retorna
    dict {walletId de B: [nome de A, ...]} (só entradas com ≥1 comprador).

    Pseudocódigo:
      1. Pra cada carteira A do registry, pra cada walletId em
         A.explodedWalletIds:
      2. Só conta se esse walletId TAMBÉM está no registry (é carteira
         rastreada aqui, "da lista" — não qualquer wallet do Beehus) e não é
         a própria A (defensivo; não deveria ocorrer na prática) -> anota o
         nome de A na lista de compradores desse walletId.
      3. Carteiras nunca compradas por ninguém simplesmente não aparecem no
         dict — quem chama trata ausência como lista vazia. """
    compradores_por_alvo = defaultdict(list)
    for holder in registry_por_id.values():
        for alvo_id in holder.get("explodedWalletIds") or []:
            if alvo_id in registry_por_id and alvo_id != holder["walletId"]:
                compradores_por_alvo[alvo_id].append(holder["name"])
    return dict(compradores_por_alvo)


def compute_sort_key(celulas, nome, aguardando_explosao=False):
    """Contexto:
    Monta a chave de ordenação por prioridade de 1 linha (carteira ou
    agrupamento) — [REVISADO 2026-07-24, pedido do usuário]. Chamada 1x por
    linha, no fim de compute_wallet_row()/compute_groupings_rows(), depois de
    montar todas as células da janela. Retorna lista (menor = mais
    prioritário/pior), no formato [furaFila, rank, -contagem, nome_casefold].

    `aguardando_explosao` [NOVO 2026-08-13, pedido do usuário] — só
    compute_wallet_row() passa True (linha de Agrupamento nunca tem esse
    conceito, fica no default False, comportamento idêntico a antes).

    Pseudocódigo:
      1. furaFila = 0 se `aguardando_explosao` (fura a fila de TUDO que não
         fura fila) senão 1 — critério NOVO, na frente de todo o resto.
      2. mockkey da data de referência = mockkey da ÚLTIMA célula da janela
         (a janela sempre termina na data de referência — responsabilidade
         de quem monta `celulas`).
      3. rank = MOCKKEY_PRIORITY_RANK desse mockkey (pior primeiro; mockkey
         desconhecido nunca deveria ocorrer, mas cai no fim da lista — 99).
      4. contagem = quantos dias da janela pesquisada têm esse MESMO mockkey
         (desempate: mais dias iguais ao da referência = mais prioritário).
      5. nome (casefold) fecha a chave como ordem total.
    """
    fura_fila = 0 if aguardando_explosao else 1
    mockkey_ref = celulas[-1]["s"]
    rank = MOCKKEY_PRIORITY_RANK.get(mockkey_ref, 99)
    contagem = sum(1 for c in celulas if c["s"] == mockkey_ref)
    return [fura_fila, rank, -contagem, (nome or "").casefold()]


def div_overlay_kind(retorno_contribuicao, retorno_nav_por_cota, nav=None):
    """Contexto: classifica a divergência entre Rent Contribuição e Rent NAV
    de 1 navPackage — único lugar com os thresholds de divergência (PLANNING
    §Alerta 5). Chamada por compute_overlays() e pelo roll-up de
    agrupamentos. Retorna None | 'div' | 'div_strong'.

    [REVISADO 2026-07-31, pedido do usuário: "0,02%... é nosso novo
    parâmetro, também incluir para não exibir diferenças... menores que 800
    reais"] Ganhou o parâmetro `nav` e um 2º gate, em R$ — os DOIS precisam
    passar (percentual E monetário) pra a divergência aparecer; sem `nav`
    (roll-up sem o dado, defensivo), o gate em R$ é pulado — só o percentual
    decide, nunca escondendo uma divergência real por falta desse dado.

    Pseudocódigo:
      1. Se qualquer um dos dois retornos vier None, não há o que comparar
         -> None.
      2. Diferença absoluta < LIMIAR_DIVERGENCIA (2bp/0,02%) -> None (dentro
         da tolerância percentual, nem chega a calcular o gate em R$).
      3. Com `nav` disponível, calcula o impacto em R$ (nav × diferença); se
         vier abaixo de LIMIAR_DIVERGENCIA_REAIS (R$800) -> None (percentual
         passou, mas o impacto financeiro é irrelevante).
      4. Diferença > 5bp -> 'div_strong'; senão -> 'div'.
    """
    if retorno_contribuicao is None or retorno_nav_por_cota is None:
        return None
    diferenca = abs(retorno_contribuicao - retorno_nav_por_cota)
    if diferenca < LIMIAR_DIVERGENCIA:
        return None
    if nav is not None and (nav * diferenca) < LIMIAR_DIVERGENCIA_REAIS:
        return None
    if diferenca > LIMIAR_DIVERGENCIA_FORTE:
        return "div_strong"
    return "div"


# ─────────────────────────────────────────────────────────────────────────
# Estágio + severidade da célula (carteira, dia) — coração do semáforo
# ─────────────────────────────────────────────────────────────────────────

def compute_cell(wallet, data, doc_unprocessed, doc_processed, doc_nav, calendario, data_hoje):
    """Contexto:
    Calcula (estado, sigla, atraso_du, prazo) para 1 célula. `data` nunca é
    > referência do grid (isso é responsabilidade de quem chama, que já capa
    a janela em D-3).

    [REVISADO 2026-07-24, pedido do usuário — "novo racional para atrasado,
    podemos apontar já na data de defasagem"] O corte de "ainda no prazo"
    mudou de `atraso_du <= 0` para `atraso_du < 0`: antes, no PRÓPRIO dia do
    vencimento (atraso_du == 0, `prazo == hoje`) a carteira ainda contava como
    "no prazo" (wip_ok/pending) e só virava atrasada no dia seguinte; agora
    ela já entra no balde "atrasado" (1-2du, wip_late/miss_late) no dia exato
    do vencimento. O corte de "atraso GRAVE" (≥3du, wip_very_late/
    miss_very_late) não mudou.

    [REVISADO 2026-07-25, pedido do usuário — "removemos esse status? se
    sim, precisamos remover de tudo" / "pode remover, manteremos um processo
    que só incluiremos no TemplateCarteira quando realmente iniciar"] O gate
    de onboarding (`startDateConsolidation`) saiu desta função — toda
    carteira do Template é considerada "esperada" em todo dia.

    [REVISADO 2026-07-27, pedido do usuário — achado no caso real "JKZ OTHERS
    BRL": Periodicidade Mensal + Repetição Diária = Sim, com doc processado
    quase todo dia útil, mas aparecendo como "miss" porque o código só
    julgava o fechamento do MÊS (achando que não havia repetição). Pedido do
    usuário: "as sinalizações de sem carga, unp, pro, pub sigam o sinal da
    data independente da condição Mensal ou afim; essa condição Mensal deve
    somente influenciar o alerta Rent" — confirmado que vale até pra
    carteiras Mensais SEM Repetição Diária ("mesma regra por dia, sem
    exceção")] O regime mensal (`fechamento_vigente_no_dia`/
    `prazo_regime_mensal`, que julgava um dia diferente de `data` quando
    `data` não era o fechamento do mês) SAIU inteiramente do cálculo de
    estágio/atraso — toda carteira, Mensal ou Diária, julga o prazo e o doc
    do PRÓPRIO dia `data` (`prazo_regime_diario` + Defasagem, `lagBizDays`
    ou 0 quando a coluna Defasagem é "M"/vazia — regime mensal sem Defasagem
    configurada vira prazo D+0, sem folga). Periodicidade continua existindo
    só como metadado de exibição (`monthly`, badge "carga mensal", coluna
    Defasagem do Excel) — não influencia mais estágio/atraso/prazo. O alerta
    Rent (`div_overlay_kind`) já era idêntico pros dois regimes (não lê
    `periodicity`), então nenhuma mudança foi necessária ali.

    Pseudocódigo:
      1. Prazo = data da coluna + Defasagem (dias úteis) — mesma fórmula
         pra Mensal e Diário.
      2. Estágio alcançado + severidade (done/wip_*/miss_*/pending) —
         atraso_du < 0 = ainda no prazo; 0 ≤ atraso_du < 3 = atrasado leve;
         atraso_du ≥ 3 = atrasado grave.
    """
    publicada = bool(doc_processed and doc_processed.get("published"))
    processada = doc_processed is not None
    unprocessed = doc_unprocessed is not None

    prazo = calendario.prazo_regime_diario(data, wallet["lagBizDays"] or 0)
    atraso_du = calendario.dias_uteis_entre(prazo, data_hoje)

    if publicada or (processada and not wallet["mustPublish"]):
        estado = "done"
        sigla = "Pub" if publicada else "Pro"
    elif processada or unprocessed:
        sigla = "Pro" if processada else "Unp"
        if atraso_du < 0:
            estado = "wip_ok"
        elif atraso_du < 3:
            estado = "wip_late"
        else:
            estado = "wip_very_late"
    else:
        if atraso_du < 0:
            estado = "pending"
        elif atraso_du < 3:
            estado = "miss_late"
        else:
            estado = "miss_very_late"
        sigla = {"pending": "Agd", "miss_late": "∅", "miss_very_late": "∅"}[estado]

    return estado, sigla, atraso_du, prazo


def atraso_overlay_kind(estado):
    """Contexto: classifica o badge "Atraso" a partir do estado de
    severidade de uma célula — chamada por compute_overlays() e pelo roll-up
    de agrupamentos. [REVISADO 2026-07-22, pedido do usuário — quebra a regra
    antiga documentada no PLANNING.md ("vazio nunca leva o badge, o fundo já
    comunica"), confirmado com o desenvolvedor] O badge agora existe em
    QUALQUER estágio diferente de Publicado com prazo vencido — Unp/Pro em
    andamento (wip_*) OU vazio (miss_*, ∅); em Agd/— (dentro do prazo/não
    esperado) e em Pub não há o que atrasar. Retorna None | 'atraso' |
    'atraso_strong'.

    Pseudocódigo:
      1. Estado com 1-2 du de atraso (wip_late ou miss_late) -> 'atraso'.
      2. Estado com ≥3 du de atraso (wip_very_late ou miss_very_late) ->
         'atraso_strong'.
      3. Qualquer outro estado -> None (sem badge).
    """
    if estado in ("wip_late", "miss_late"):
        return "atraso"
    if estado in ("wip_very_late", "miss_very_late"):
        return "atraso_strong"
    return None


def compute_overlays(nav_doc, tipos_de_issue, sequencia_quebrada, estado):
    """Contexto:
    Monta os overlays de 1 célula (marcadores independentes da cor de fundo:
    divergência = badge Rent, issues = triângulo, sequência = anel, atraso =
    badge derivado do estado). Chamada 1x por dia da janela por
    compute_wallet_row(). Retorna (lista_overlays, info_divergencia,
    texto_issues) — os 2 últimos só preenchidos quando aplicável.

    Pseudocódigo:
      1. Badge de atraso, a partir do estado (atraso_overlay_kind).
      2. Se há navPackage do dia, calcula divergência (div_overlay_kind) e
         monta o detalhe numérico pro tooltip/painel.
      3. Se há issues pendentes no dia, monta o texto resumido (top 4 tipos).
      4. Se a sequência está quebrada, adiciona o overlay 'seq'.
    """
    overlays = []
    tipo_atraso = atraso_overlay_kind(estado)
    if tipo_atraso:
        overlays.append(tipo_atraso)
    info_divergencia = None
    if nav_doc:
        rc, rn = nav_doc.get("returnContribution"), nav_doc.get("returnNavPerShare")
        tipo_div = div_overlay_kind(rc, rn, nav_doc.get("nav"))
        if tipo_div:
            overlays.append(tipo_div)
            info_divergencia = {
                "rc": rc, "rn": rn, "bp": abs(rc - rn) * 10000,
                "nav": nav_doc.get("nav"), "navPerShare": nav_doc.get("navPerShare"),
                "formerNav": nav_doc.get("formerNav"), "formerNavPerShare": nav_doc.get("formerNavPerShare"),
                "inAndOutFlows": nav_doc.get("inAndOutFlows"),
            }
    texto_issues = None
    if tipos_de_issue:
        overlays.append("issue")
        total = sum(n for _, n in tipos_de_issue)
        partes = " · ".join(f"{n}× {t}" for t, n in sorted(tipos_de_issue, key=lambda x: -x[1])[:4])
        texto_issues = f"{total} pendente{'s' if total != 1 else ''}: {partes}"
    if sequencia_quebrada:
        overlays.append("seq")
    return overlays, info_divergencia, texto_issues


# ─────────────────────────────────────────────────────────────────────────
# Montagem da linha (carteira) — células + tooltip + prioridade
# ─────────────────────────────────────────────────────────────────────────
# [refatoração 2026-07-20] compute_wallet_row() virou uma orquestradora fina;
# cada responsabilidade que antes vivia dentro dela (gate de sequência,
# horários BRT, texto de SLA, montagem de tooltip, montagem de célula,
# montagem do dict final) ganhou sua própria função abaixo. LÓGICA idêntica,
# só a organização mudou (CLAUDE.md §3).

def wallet_sequencia_quebrada(wallet, data, doc_pro, calendario, datas_processadas):
    """Contexto:
    Checa o gate de sequência (alerta 8) de 1 dia da carteira: foi
    processada em `data` sem ter sido processada no dia útil anterior
    (dentro do período onboarded). Chamada 1x por dia da janela por
    compute_wallet_row(). Retorna bool.

    [2026-08-05, migração API Beehus] `wallet["startDateConsolidation"]`
    continua vindo preenchido normalmente — validado ao vivo contra a API de
    produção (979/979 carteiras de uma empresa testada tinham o campo). A
    suposição inicial desta migração (de que a API não teria esse campo,
    baseada só na docstring do cliente HTTP — não exaustiva) estava errada;
    corrigida depois de testar com um token real. Nenhuma mudança de
    comportamento aqui.

    Pseudocódigo:
      1. Sem doc_pro no dia, não há o que checar -> False.
      2. Acha o dia útil anterior.
      3. Se esse dia anterior já estava onboarded (ou a carteira não tem
         data de onboarding) e ele NÃO está no conjunto de datas
         processadas da carteira, a sequência está quebrada.
    """
    if doc_pro is None:
        return False
    data_anterior = calendario.deslocar(data, -1)
    onboarded_anterior = (not wallet["startDateConsolidation"]) or \
        (data_anterior >= wallet["startDateConsolidation"])
    return onboarded_anterior and data_anterior not in datas_processadas


def montar_horarios_celula(doc_unp, doc_pro, doc_nav):
    """Contexto:
    Formata os horários BRT (Unprocessed/Processada/reprocesso/Publicada) de
    1 célula a partir dos docs brutos do Mongo já buscados por
    compute_wallet_row(). Chamada 1x por dia da janela. Retorna a tupla
    (hora_unp, hora_pro, hora_reprocesso, hora_pub) — cada campo None quando
    não se aplica.

    Pseudocódigo:
      1. Unprocessed: horário de createdAt, se o doc existir.
      2. Processada: horário de createdAt, se o doc existir.
      3. Reprocesso: só se updatedAt e createdAt existirem e a diferença for
         maior que 5 minutos (reprocessamento real, não o clock skew normal
         da 1ª gravação).
      4. Publicada: horário do navPackage, só quando a carteira publicou de
         fato (doc_pro.published truthy).
    """
    hora_unp = formatar_horario_brt(doc_unp["createdAt"]) if doc_unp else None
    hora_pro = formatar_horario_brt(doc_pro["createdAt"]) if doc_pro else None
    hora_reprocesso = None
    if doc_pro and doc_pro.get("updatedAt") and doc_pro.get("createdAt"):
        if (doc_pro["updatedAt"] - doc_pro["createdAt"]) > dt.timedelta(minutes=5):
            hora_reprocesso = formatar_horario_brt(doc_pro["updatedAt"])
    hora_pub = formatar_horario_brt(doc_nav["createdAt"]) if (doc_nav and doc_pro and doc_pro.get("published")) else None
    return hora_unp, hora_pro, hora_reprocesso, hora_pub


def montar_texto_sla_celula(wallet, estado, atraso_du, prazo):
    """Contexto:
    Monta o texto de SLA (e se ele é alerta/vermelho) de 1 célula — usado no
    tooltip da célula da carteira. Chamada 1x por dia da janela por
    compute_wallet_row(). [REVISADO 2026-07-27, pedido do usuário — regime
    mensal deixou de ter prazo próprio (ver compute_cell()); mesmo texto pra
    Mensal e Diário agora] Retorna a tupla (texto_sla, sla_alerta); texto_sla
    é None quando não há o que mostrar.

    Pseudocódigo:
      1. Se o estado é vermelho/âmbar, mostra "atrasada +Ndu".
      2. Se está em progresso/aguardando dentro do prazo, mostra "no prazo".
    """
    texto_sla, sla_alerta = None, False
    if estado in ("wip_late", "wip_very_late", "miss_late", "miss_very_late"):
        texto_sla = f"atrasada +{max(atraso_du, 0)}du (limite era {prazo})"
        sla_alerta = True
    elif estado in ("wip_ok", "pending") and prazo:
        texto_sla = f"no prazo (limite {prazo})"
    return texto_sla, sla_alerta


def montar_tooltip_celula_carteira(hora_unp, hora_pro, hora_reprocesso, hora_pub,
                                    texto_sla, sla_alerta, info_divergencia,
                                    texto_issues, sequencia_quebrada):
    """Contexto:
    Monta o dict de tooltip (payload enxuto) de 1 célula da carteira,
    incluindo só os campos que se aplicam naquele dia. Chamada 1x por dia da
    janela por compute_wallet_row(), depois de calcular horários/SLA/
    overlays. Retorna dict (pode ser {} quando nada se aplica).

    Pseudocódigo:
      1. Inclui cada horário (u/c/reproc/p) só se existir.
      2. Inclui o texto de SLA e o flag de alerta, se aplicável.
      3. Inclui o detalhe de divergência e o texto de issues, se aplicável.
      4. Inclui o flag de sequência quebrada, se aplicável.
    """
    tooltip = {}
    if hora_unp: tooltip["u"] = hora_unp
    if hora_pro: tooltip["c"] = hora_pro
    if hora_reprocesso: tooltip["reproc"] = hora_reprocesso
    if hora_pub: tooltip["p"] = hora_pub
    if texto_sla: tooltip["sla"] = texto_sla
    if sla_alerta: tooltip["slaWarn"] = True
    if info_divergencia: tooltip["div"] = info_divergencia
    if texto_issues: tooltip["issues"] = texto_issues
    if sequencia_quebrada: tooltip["seq"] = True
    return tooltip


def montar_celula_carteira(mockkey, data, estado, atraso_du, overlays, tooltip):
    """Contexto:
    Monta o dict final de 1 célula da linha de carteira (payload enxuto
    consumido pelo front-end e pelo excel_report.py) — junta mockkey, data,
    overlays, atraso (só em estado vermelho/âmbar) e tooltip. Chamada 1x por
    dia da janela por compute_wallet_row(). Retorna dict.

    Pseudocódigo:
      1. Base: mockkey ("s") + data ("d").
      2. Se há overlays, anexa ("ov").
      3. Se o estado é vermelho/âmbar, anexa o atraso em du ("adu").
      4. Se o tooltip tem algum campo, anexa ("tt").
    """
    celula = {"s": mockkey, "d": data}
    if overlays:
        celula["ov"] = overlays
    if estado in REDAMBER_STATES:
        celula["adu"] = max(atraso_du, 0)
    if tooltip:
        celula["tt"] = tooltip
    return celula


def montar_dict_linha_carteira(wallet, celulas, chave_ordenacao, comprada_por_nomes=None,
                                aguardando_explosao=False):
    """Contexto:
    Monta o dict final da linha de carteira, juntando as células já
    calculadas com o sortKey e os metadados de cadastro repassados de
    `wallet` (vindos do registry). Chamada 1x no fim de compute_wallet_row().
    Retorna dict (mesmo formato consumido pelo front-end e pelo
    excel_report.py).

    [REVISADO 2026-07-24, pedido do usuário] Os campos "tier"/"priorityScore"/
    "redAmber"/"overlayScore" saíram — o modelo de prioridade agora é só o
    "sortKey" (ver compute_sort_key()); "tem pendência" em qualquer lugar do
    app (filtro, blocos de agrupamento, quais carteiras buscam issuesDetail)
    passa a ser checado direto pelo mockkey da data de referência
    (`celulas[-1]["s"] not in ("p", "cD")`), sem precisar de um campo à parte.

    `comprada_por_nomes`/`aguardando_explosao` [NOVO 2026-08-13, pedido do
    usuário] — ver mapear_carteiras_compradas()/compute_wallet_row().
    `compradaPorNomes` é informativo (aparece sempre que houver comprador,
    mesmo se a carteira já estiver publicada); `aguardandoExplosao` já vem
    com o gate de pendência aplicado (usado pelo front-end pra decidir a
    sinalização visual/tag do filtro de cabeçalho).

    Pseudocódigo:
      1. Junta identificação (walletId/name/company/institution/...).
      2. Junta as células e o sortKey.
      3. Junta os demais metadados de cadastro/SLA da carteira.
      4. Junta compradaPorNomes/aguardandoExplosao.
    """
    wallet_id = wallet["walletId"]
    return {
        "walletId": wallet_id,
        "name": wallet["name"],
        "company": wallet["company"],
        "companyId": wallet["companyId"],
        "institution": wallet["institution"],
        "loadModel": wallet["loadModel"],
        "isManualLoad": wallet["isManualLoad"],
        "monthly": wallet["periodicity"] == "M",
        "mustPublish": wallet["mustPublish"],
        "exception": wallet["exception"],
        "explosion": wallet["explosion"],
        # lista de nomes (ex.: ["Delfos FI MM", "Esparta FIF Ações"]) — NADA
        # a ver com "explosion" acima (ver nota em registry.py) [2026-07-31].
        "explodedAssets": wallet.get("explodedAssets") or [],
        # nomes das carteiras DO TEMPLATE que compram (explodem) esta
        # carteira — inverso de explodedAssets (ver mapear_carteiras_
        # compradas()) [2026-08-13].
        "compradaPorNomes": comprada_por_nomes or [],
        "aguardandoExplosao": aguardando_explosao,
        "cells": celulas,
        "sortKey": chave_ordenacao,
        "walletIdFull": wallet_id,
        "groupingIds": wallet["groupingIds"],
        "periodicity": wallet["periodicity"],
        "lagBizDays": wallet["lagBizDays"],
        "slaPdfReceiptDu": wallet["slaPdfReceiptDu"],
        "slaUploadDu": wallet["slaUploadDu"],
        "dailyRepetition": wallet["dailyRepetition"],
        "startDateConsolidation": wallet["startDateConsolidation"],
        "accountCode": wallet.get("accountCode"),
    }


def compute_wallet_row(wallet, janela, calendario, data_hoje, unp_map, pro_map, nav_map,
                        issues_map, datas_processadas_por_carteira, compradores_por_alvo=None):
    """Contexto:
    Monta a linha completa de 1 carteira para o snapshot: uma célula por dia
    da janela (com tooltip embutido) + sortKey de prioridade + metadados de
    cadastro. Chamada 1x por carteira do registry, dentro do loop principal
    de montar_snapshot(). Orquestradora fina — cada passo abaixo é uma
    função própria (ver seção acima). Retorna o dict da linha (mesmo formato
    consumido pelo front-end e pelo excel_report.py).

    [REVISADO 2026-07-27, pedido do usuário — "as sinalizações... sigam o
    sinal da data independente da condição Mensal"] Voltou a resolver o doc
    do PRÓPRIO dia `data` pra TODAS as carteiras, Mensal ou Diária — sem
    "fechamento vigente" de mês diferente (ver compute_cell()).

    `compradores_por_alvo` [NOVO 2026-08-13, pedido do usuário] — dict
    {walletId: [nomes]} de mapear_carteiras_compradas(), calculado 1x fora do
    loop (build_snapshot.py) e repassado pra cada carteira. None/ausente
    equivale a "ninguém compra ninguém" (compatível com quem não passar o
    parâmetro).

    Pseudocódigo:
      1. Para cada dia da janela: resolve o doc do PRÓPRIO dia e calcula o
         estado da célula (compute_cell).
      2. Checa o gate de sequência (wallet_sequencia_quebrada).
      3. Monta os overlays (compute_overlays), horários BRT
         (montar_horarios_celula), texto de SLA (montar_texto_sla_celula), o
         tooltip (montar_tooltip_celula_carteira) e a célula final
         (montar_celula_carteira).
      4. Descobre se ESTA carteira é comprada por alguma outra do Template
         (compradores_por_alvo) e se AINDA NÃO FOI PUBLICADA na data de
         referência (`!= "p"` — "cD"/Processada ainda conta como pendência
         AQUI, mesmo contando como "resolvido" pras demais checagens de
         pendência do app) — só as DUAS juntas ligam `aguardando_explosao`.
      5. Fecha a chave de ordenação por prioridade (compute_sort_key, baseada
         só na data de referência — ver Fase 1 do plano 2026-07-24 — mais o
         critério de furar fila do item 4).
      6. Monta o dict final da linha (montar_dict_linha_carteira).
    """
    wallet_id = wallet["walletId"]
    datas_processadas = datas_processadas_por_carteira.get(wallet_id, set())
    celulas = []

    for data in janela:
        doc_unp = unp_map.get((wallet_id, data))
        doc_pro = pro_map.get((wallet_id, data))
        doc_nav = nav_map.get((wallet_id, data))

        estado, sigla, atraso_du, prazo = compute_cell(
            wallet, data, doc_unp, doc_pro, doc_nav, calendario, data_hoje)

        sequencia_quebrada = wallet_sequencia_quebrada(wallet, data, doc_pro, calendario, datas_processadas)

        tipos_de_issue = issues_map.get((wallet_id, data))
        overlays, info_divergencia, texto_issues = compute_overlays(
            doc_nav, tipos_de_issue, sequencia_quebrada, estado)

        mockkey = STATE_TO_MOCKKEY.get((estado, sigla)) or STATE_TO_MOCKKEY.get((estado, None))

        hora_unp, hora_pro, hora_reprocesso, hora_pub = montar_horarios_celula(doc_unp, doc_pro, doc_nav)
        texto_sla, sla_alerta = montar_texto_sla_celula(wallet, estado, atraso_du, prazo)
        tooltip = montar_tooltip_celula_carteira(hora_unp, hora_pro, hora_reprocesso, hora_pub,
                                                  texto_sla, sla_alerta, info_divergencia,
                                                  texto_issues, sequencia_quebrada)
        celulas.append(montar_celula_carteira(mockkey, data, estado, atraso_du, overlays, tooltip))

    comprada_por_nomes = (compradores_por_alvo or {}).get(wallet_id) or []
    # [CORRIGIDO 2026-08-13, achado testando com dado real: DELFOS FIM BTG
    # BRL tem 7 compradores reais mas não sinalizava porque estava "cD"
    # (Processada, aguardando publicar) — o gate usava a convenção genérica
    # de "tem pendência" do resto do app (`not in ("p","cD")`), mas o
    # combinado com o usuário foi mais estrito: "não fura na frente de quem
    # JÁ ESTÁ PUBLICADO" (só "p" exime) — Processada-mas-não-publicada ainda
    # é trabalho em aberto NESTA carteira, então continua contando como
    # pendência pra este alerta específico, mesmo não contando pras outras
    # checagens de pendência do app (issuesDetail, filtro "só pendência" etc,
    # que continuam usando not in ("p","cD") sem mudança).
    ainda_nao_publicada = celulas[-1]["s"] != "p"
    aguardando_explosao = bool(comprada_por_nomes) and ainda_nao_publicada

    chave_ordenacao = compute_sort_key(celulas, wallet["name"], aguardando_explosao)

    return montar_dict_linha_carteira(wallet, celulas, chave_ordenacao, comprada_por_nomes, aguardando_explosao)


# ─────────────────────────────────────────────────────────────────────────
# Roll-up de Agrupamentos (mesma simbologia, pior caso)
# ─────────────────────────────────────────────────────────────────────────

def _membro_intersecta_janela(membro, inicio_janela, fim_janela):
    """Contexto: decide se o intervalo de atividade de um membro no grouping
    (initialDateOnGrouping..finalDateOnGrouping) intersecta a janela do grid
    — usada por compute_groupings_rows() para separar "membros rastreados"
    (contam pro roll-up) dos que nunca estiveram ativos na janela exibida.
    Retorna bool.

    Pseudocódigo:
      1. Se o membro só começou depois do fim da janela, não intersecta.
      2. Se o membro já tinha terminado antes do início da janela, não
         intersecta.
      3. Caso contrário, intersecta.
    """
    inicial = membro.get("initialDateOnGrouping")
    final = membro.get("finalDateOnGrouping")
    if inicial and inicial > fim_janela:
        return False
    if final and final < inicio_janela:
        return False
    return True


def _membro_ativo_em(membro, data):
    """Contexto: decide se o membro está ativo no grouping exatamente no dia
    `data` — usada por compute_groupings_rows() célula a célula, pra saber
    quais carteiras entram no roll-up daquele dia específico. Retorna bool.

    Pseudocódigo:
      1. Se `data` é anterior ao início de atividade do membro, não está
         ativo.
      2. Se `data` é posterior ao fim de atividade do membro, não está
         ativo.
      3. Caso contrário, está ativo.
    """
    inicial = membro.get("initialDateOnGrouping")
    final = membro.get("finalDateOnGrouping")
    if inicial and inicial > data:
        return False
    if final and final < data:
        return False
    return True


# [refatoração 2026-07-20] compute_groupings_rows() virou uma orquestradora
# fina; classificação em bloco, roll-up célula-a-célula, metadados de
# instituição/últimas datas e montagem do dict final ganharam funções
# próprias abaixo. LÓGICA idêntica, só a organização mudou (CLAUDE.md §3).

def classificar_grouping_em_bloco(g, registry_por_id, linhas_carteiras_por_id, inicio_janela, fim_janela):
    """Contexto:
    Classifica 1 grouping num dos 3 blocos de prioridade (PLANNING §Visão
    por Agrupamento) a partir dos seus membros: separa quem está no
    Template (registry) de quem não está, e entre esses quem intersecta a
    janela exibida ("rastreados"). Chamada 1x por grouping, no início do
    loop de compute_groupings_rows(). Retorna a tupla (todos_membros,
    membros_no_registry, membros_rastreados, n_nao_rastreados_bruto, bloco).

    Pseudocódigo:
      1. Filtra os membros que estão no registry (Template).
      2. Dentre esses, filtra os que intersectam a janela (rastreados).
      3. Conta quantos membros brutos ficaram de fora do registry.
      4. Sem membro rastreado -> bloco 3. Com rastreado e alguma carteira
         com mockkey ∉ {"p","cD"} na data de referência (= "tem pendência",
         [REVISADO 2026-07-24, pedido do usuário] antes era "tier ≤ 2") ->
         bloco 1. Senão -> bloco 2.
    """
    todos_membros = g.get("wallets") or []
    membros_no_registry = [m for m in todos_membros if m.get("walletId") in registry_por_id]
    membros_rastreados = [m for m in membros_no_registry
                           if _membro_intersecta_janela(m, inicio_janela, fim_janela)]
    n_nao_rastreados_bruto = len(todos_membros) - len(membros_no_registry)

    if not membros_rastreados:
        bloco = 3
    else:
        tem_pendencia = any(linhas_carteiras_por_id[m["walletId"]]["cells"][-1]["s"] not in ("p", "cD")
                             for m in membros_rastreados)
        bloco = 1 if tem_pendencia else 2
    return todos_membros, membros_no_registry, membros_rastreados, n_nao_rastreados_bruto, bloco


def montar_linha_grouping_bloco3(grouping_id, g, nome_grupo, nome_empresa, n_nao_rastreados_bruto,
                                  janela, nav_group_map):
    """Contexto:
    Monta a linha completa de 1 grouping do bloco 3 (nenhum membro
    rastreado) — só há o navPackage do próprio grouping pra calcular
    divergência, não existe carteira-membro de quem herdar estado. Chamada
    1x por grouping classificado em bloco 3, dentro de
    compute_groupings_rows(). Retorna dict (mesmo formato das demais linhas
    de agrupamento).

    [REVISADO 2026-07-24, pedido do usuário] Sem tier/priorityScore — o
    sortKey vem de compute_sort_key() como qualquer outra linha; como toda
    célula do bloco 3 é sempre "notcov" (nenhum membro rastreado pra
    herdar estado), o mockkey da data de referência é sempre "notcov" (rank
    2) e a contagem de desempate é sempre o tamanho da janela — todo o bloco
    3 acaba empatado nesse critério e cai pro desempate por nome, o que é
    esperado (bloco 3 já é a categoria de menor prioridade de exibição, sem
    dado suficiente pra diferenciar internamente).

    Pseudocódigo:
      1. Para cada dia da janela, monta uma célula "não coberto" e, se há
         divergência no navPackage do grouping, anexa o overlay (só pra
         exibição — não alimenta mais nenhum score).
      2. Monta o dict final com os campos zerados/None que não se aplicam a
         este bloco (sem membros).
    """
    celulas = []
    for data in janela:
        navg = nav_group_map.get((grouping_id, data)) or {}
        entrada = {"s": "notcov", "d": data}
        tipo = div_overlay_kind(navg.get("returnContribution"), navg.get("returnNavPerShare"), navg.get("nav"))
        if tipo:
            entrada["ov"] = [tipo]
        celulas.append(entrada)
    return {
        "groupingId": grouping_id, "name": nome_grupo, "company": nome_empresa,
        "institution": "—", "institutionDetail": {},
        "nMembers": 0, "nUntrackedRaw": n_nao_rastreados_bruto,
        "cells": celulas, "bloco": 3,
        "sortKey": compute_sort_key(celulas, nome_grupo),
        "members": [], "benchmarks": g.get("benchmarks"),
    }


def achar_pior_celula_ativa(ativos, data, lookup_celulas):
    """Contexto:
    Acha, entre as carteiras-membro ativas de 1 grouping num dia, a célula
    da PIOR (ranking de severidade + desempate por estágio) — é dela que a
    célula do grouping herda cor/sigla/overlays. Chamada 1x por dia da
    janela por montar_celula_grouping_dia(), quando há ao menos 1 membro
    ativo. Retorna a tupla (celula_pior, estado_pior); (None, None) se
    nenhum membro ativo tinha célula calculada nesse dia.

    Pseudocódigo:
      1. Para cada carteira ativa, busca sua célula do dia (algumas podem
         não ter, se faltar dado).
      2. Compara pelo ranking de severidade (RANKING_SEVERIDADE); em
         empate, desempata pelo estágio mais avançado (ORDEM_ESTAGIO).
      3. Devolve a pior célula encontrada e seu estado completo.
    """
    pior, pior_rank = None, -1
    for wallet_id in ativos:
        c = lookup_celulas.get(wallet_id, {}).get(data)
        if not c:
            continue
        mockkey = c["s"]
        estado = state_from_cell(c)
        rank = RANKING_SEVERIDADE[estado]
        if rank > pior_rank:
            pior_rank, pior = rank, c
        elif rank == pior_rank and pior is not None:
            if ORDEM_ESTAGIO.get(MOCKKEY_LETTER.get(mockkey, "—"), 0) < \
                    ORDEM_ESTAGIO.get(MOCKKEY_LETTER.get(pior["s"], "—"), 0):
                pior = c
    if pior is None:
        return None, None
    return pior, state_from_cell(pior)


def montar_overlays_celula_grouping(ativos, data, lookup_celulas, estado, grouping_id, nav_group_map):
    """Contexto:
    Monta a lista de overlays da célula do grouping num dia: união dos
    overlays dos membros ativos (exceto os de atraso individual, que são
    recalculados no nível do grouping), + o badge de atraso do estado
    herdado, + a divergência do navPackage do próprio grouping. Chamada 1x
    por dia da janela por montar_celula_grouping_dia(), quando há uma pior
    célula encontrada. Retorna lista de overlays (sem duplicatas).

    Pseudocódigo:
      1. Junta os overlays de todos os membros ativos no dia, removendo
         "atraso"/"atraso_strong" individuais e duplicatas.
      2. Recalcula o badge de atraso a partir do estado JÁ herdado (o do
         grouping, não o de cada membro) e anexa.
      3. Se há divergência no navPackage do PRÓPRIO grouping e nenhum
         membro já trouxe overlay de divergência, anexa também.
    """
    overlays = list(dict.fromkeys(
        o for o in sum((lookup_celulas.get(wid, {}).get(data, {}).get("ov", []) for wid in ativos), [])
        if o not in ("atraso", "atraso_strong")))
    tipo_atraso = atraso_overlay_kind(estado)
    if tipo_atraso:
        overlays.append(tipo_atraso)
    navg = nav_group_map.get((grouping_id, data)) or {}
    tipo_g = div_overlay_kind(navg.get("returnContribution"), navg.get("returnNavPerShare"), navg.get("nav"))
    if tipo_g and "div" not in overlays and "div_strong" not in overlays:
        overlays.append(tipo_g)
    return overlays


def montar_tooltip_celula_grouping(ativos, data, lookup_celulas):
    """Contexto:
    Monta o tooltip da célula do grouping: total de membros ativos no dia +
    contagem de quantos estão em cada mockkey (usado pelo tooltip/painel pra
    mostrar "3/5 publicadas" etc.) + a lista de walletIds "não processadas"
    nesse dia (mockkey ∉ {"p","cD"}) — [2026-07-24, pedido do usuário: "ao
    passar o mouse deve se mostrar as carteiras não processadas desse
    agrupamento"]. Chamada 1x por dia da janela por
    montar_celula_grouping_dia(), quando há uma pior célula encontrada.
    Retorna dict {"n": total, "counts": {mockkey: quantidade},
    "unprocessedIds": [walletId, ...]}.

    Pseudocódigo:
      1. Para cada carteira ativa, busca sua célula do dia; sem dado, pula
         (mesma regra que já valia pra "counts").
      2. Conta 1 no mockkey da célula; se o mockkey não é "p"/"cD", também
         acumula o walletId na lista de não processadas.
      3. Devolve o total de ativos + as contagens por mockkey + a lista de
         walletIds não processados.
    """
    contagens = defaultdict(int)
    nao_processadas = []
    for wallet_id in ativos:
        c2 = lookup_celulas.get(wallet_id, {}).get(data)
        if not c2:
            continue
        contagens[c2["s"]] += 1
        if c2["s"] not in ("p", "cD"):
            nao_processadas.append(wallet_id)
    return {"n": len(ativos), "counts": dict(contagens), "unprocessedIds": nao_processadas}


def montar_celula_grouping_dia(grouping_id, data, ativos, lookup_celulas, nav_group_map):
    """Contexto:
    Monta a célula do grouping (blocos 1/2) para 1 dia da janela — junta
    achar a pior carteira-membro ativa, montar overlays/tooltip e aplicar o
    gate REDAMBER ("adu"). Chamada 1x por dia da janela por
    compute_groupings_rows(). Retorna dict da célula (mesmo formato das
    células de carteira).

    [REVISADO 2026-07-24, pedido do usuário] Não registra mais nada num
    acumulador de score — o sortKey da linha é fechado depois, direto em
    cima das células já montadas (compute_sort_key).

    Pseudocódigo:
      1. Sem carteira ativa no dia -> célula "não coberto".
      2. Acha a pior célula ativa (achar_pior_celula_ativa); se nenhuma
         tinha dado calculado -> célula "não coberto".
      3. Monta os overlays.
      4. Monta a célula (mockkey herdado + atraso se vermelho/âmbar +
         overlays) e anexa o tooltip de contagens por estágio.
    """
    if not ativos:
        return {"s": "notcov", "d": data}
    pior, estado = achar_pior_celula_ativa(ativos, data, lookup_celulas)
    if pior is None:
        return {"s": "notcov", "d": data}

    overlays = montar_overlays_celula_grouping(ativos, data, lookup_celulas, estado, grouping_id, nav_group_map)

    entrada = {"s": pior["s"], "d": data}
    if estado in REDAMBER_STATES:
        entrada["adu"] = pior.get("adu", 0)
    if overlays:
        entrada["ov"] = overlays
    entrada["tt"] = montar_tooltip_celula_grouping(ativos, data, lookup_celulas)
    # [2026-08-24, decisão do usuário — Rota A da visão "Publicação por Hora" (aba
    # Company)] grava a hora BRT de publicação do PRÓPRIO agrupamento (não herdada de
    # membro), lida do publishedAt que db.py agora copia de groupingsDetailed;
    # reaproveita formatar_horario_brt(), mesmo formatador já usado para hora_pub de
    # carteira (ver montar_horarios_celula acima). Guarda: só grava a chave quando há
    # hora (None -> "sem hora" na matriz nova, nunca quebra por campo ausente).
    hora_pub_grouping = formatar_horario_brt((nav_group_map.get((grouping_id, data)) or {}).get("publishedAt"))
    if hora_pub_grouping:
        entrada["horaPub"] = hora_pub_grouping
    return entrada


def metadados_instituicao_grouping(ativos_na_referencia, linhas_carteiras_por_id):
    """Contexto:
    Resolve o chip de instituição exibido na linha do grouping (nome único,
    "Mista (N)" ou "—") a partir das carteiras-membro ativas na data de
    referência. Chamada 1x por grouping dos blocos 1/2, dentro de
    compute_groupings_rows(). Retorna a tupla (chip_instituicao,
    contagem_instituicoes).

    Pseudocódigo:
      1. Conta quantos membros ativos há de cada instituição.
      2. Sem membro ativo -> "—". 1 instituição só -> o nome dela. Mais de
         1 -> "Mista (N)".
    """
    contagem_instituicoes = defaultdict(int)
    for m in ativos_na_referencia:
        instituicao = linhas_carteiras_por_id[m["walletId"]].get("institution")
        if instituicao:
            contagem_instituicoes[instituicao] += 1
    if not ativos_na_referencia:
        chip_instituicao = "—"
    elif len(contagem_instituicoes) == 1:
        chip_instituicao = next(iter(contagem_instituicoes))
    else:
        chip_instituicao = f"Mista ({len(contagem_instituicoes)})"
    return chip_instituicao, contagem_instituicoes


def montar_dict_linha_grouping(grouping_id, nome_grupo, nome_empresa, chip_instituicao,
                                contagem_instituicoes, max_ativos_no_dia, n_nao_rastreados_bruto,
                                celulas, bloco, todos_membros, membros_rastreados, g):
    """Contexto:
    Monta o dict final da linha de grouping dos blocos 1/2, juntando
    metadados de instituição com as células já calculadas e a tabela
    completa de membros (inclusive os encerrados/não rastreados). Chamada 1x
    no fim do loop por grouping de compute_groupings_rows(). Retorna dict
    (mesmo formato consumido pelo front-end).

    [REVISADO 2026-07-24, pedido do usuário] Sem tier/priorityScore — o
    sortKey vem de compute_sort_key() (rank do mockkey da data de referência
    + desempate pela contagem na janela), igual à linha de carteira; "bloco"
    continua existindo à parte (segmentação em 3 blocos da aba Agrupamentos,
    independente da ordenação por prioridade dentro de cada bloco).

    [REMOVIDO 2026-08-05, pedido do usuário — migração API Beehus] Colunas
    "Última Unp/Pro/Pub" (lastUnprocessed/lastProcessed/lastPublished +
    *Holder) tiradas por completo: não existe endpoint que devolva "última
    data com dado por carteira" em lote (o agregado Mongo equivalente já era
    o passo mais caro do build, ~24s típicos, mesmo cacheado). Precisa de
    endpoint novo da API Beehus se quisermos essa informação de volta —
    ver db.py e CLAUDE.md.

    Pseudocódigo:
      1. Junta identificação (groupingId/name/company) + chip de instituição.
      2. Junta as células, bloco, sortKey.
      3. Junta a lista completa de membros com o flag "tracked" (rastreado).
    """
    return {
        "groupingId": grouping_id,
        "name": nome_grupo,
        "company": nome_empresa,
        "institution": chip_instituicao,
        "institutionDetail": dict(contagem_instituicoes),
        "nMembers": max_ativos_no_dia,
        "nUntrackedRaw": n_nao_rastreados_bruto,
        "cells": celulas,
        "bloco": bloco,
        "sortKey": compute_sort_key(celulas, nome_grupo),
        "members": [{"walletId": m["walletId"],
                     "initialDateOnGrouping": m.get("initialDateOnGrouping"),
                     "finalDateOnGrouping": m.get("finalDateOnGrouping"),
                     "tracked": m in membros_rastreados} for m in todos_membros],
        "benchmarks": g.get("benchmarks"),
    }


def compute_groupings_rows(agrupamentos_por_id, linhas_carteiras_por_id, registry_por_id,
                            janela, data_referencia, nav_group_map, empresas_por_id):
    """Contexto:
    Roll-up de TODOS os groupings não-trashed, segmentados em 3 blocos de
    prioridade (PLANNING §Visão por Agrupamento). Itera por TODA a coleção
    `groupings` (já cacheada) e descobre membros do Template via
    `groupings.wallets[]`. Chamada 1x por montar_snapshot(), depois de todas
    as linhas de carteira já calculadas. Orquestradora fina — cada passo
    abaixo é uma função própria (ver seção acima). Retorna a lista de linhas
    de agrupamento (mesmo formato consumido pelo front-end).

    [REVISADO 2026-07-24, pedido do usuário] Sem mais AcumuladorJanela/tier/
    score — o sortKey de cada linha vem de compute_sort_key(), aplicada em
    cima das células já montadas (mesma regra da linha de carteira: rank do
    mockkey da data de referência + desempate pela contagem na janela).

    Pseudocódigo:
      1. Para cada grouping não-trashed, classifica em bloco 1/2/3
         (classificar_grouping_em_bloco).
      2. Bloco 3: monta a linha só com divergência do navPackage do próprio
         grouping (montar_linha_grouping_bloco3) e segue pro próximo.
      3. Blocos 1/2: para cada dia da janela, monta a célula herdada da pior
         carteira-membro ativa (montar_celula_grouping_dia).
      4. Calcula o metadado de exibição (chip de instituição) a partir dos
         membros ativos na referência.
      5. Monta o dict final da linha (montar_dict_linha_grouping) e adiciona
         à saída.
      6. Ordena a saída por sortKey.
    """
    lookup_celulas = {wid: {c["d"]: c for c in linha["cells"]}
                      for wid, linha in linhas_carteiras_por_id.items()}
    inicio_janela, fim_janela = janela[0], janela[-1]
    linhas_saida = []

    for grouping_id, g in agrupamentos_por_id.items():
        if g.get("trashed"):
            continue
        nome_empresa = empresas_por_id.get(str(g.get("companyId") or ""), {}).get(
            "name", g.get("companyId") or "—")
        nome_grupo = g.get("name") or grouping_id

        todos_membros, membros_no_registry, membros_rastreados, n_nao_rastreados_bruto, bloco = \
            classificar_grouping_em_bloco(g, registry_por_id, linhas_carteiras_por_id, inicio_janela, fim_janela)

        if bloco == 3:
            linhas_saida.append(montar_linha_grouping_bloco3(
                grouping_id, g, nome_grupo, nome_empresa, n_nao_rastreados_bruto,
                janela, nav_group_map))
            continue

        celulas = []
        max_ativos_no_dia = 0

        for data in janela:
            ativos = [m["walletId"] for m in membros_no_registry if _membro_ativo_em(m, data)]
            max_ativos_no_dia = max(max_ativos_no_dia, len(ativos))
            celulas.append(montar_celula_grouping_dia(grouping_id, data, ativos, lookup_celulas, nav_group_map))

        ativos_na_referencia = [m for m in membros_rastreados if _membro_ativo_em(m, data_referencia)]
        chip_instituicao, contagem_instituicoes = metadados_instituicao_grouping(
            ativos_na_referencia, linhas_carteiras_por_id)

        linhas_saida.append(montar_dict_linha_grouping(
            grouping_id, nome_grupo, nome_empresa, chip_instituicao, contagem_instituicoes,
            max_ativos_no_dia, n_nao_rastreados_bruto, celulas, bloco,
            todos_membros, membros_rastreados, g))

    linhas_saida.sort(key=lambda r: r["sortKey"])
    return linhas_saida
