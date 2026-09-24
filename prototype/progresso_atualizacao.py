# -*- coding: utf-8 -*-
"""
progresso_atualizacao.py — andamento do "Atualizar" por sessão de navegador.
=====================================================================
[2026-09-15, relato do usuário: "tentei novamente, ficou atualizando e não
foi para o dia 09/09"] Um clique em "Atualizar" hoje leva ~9 minutos (ver
`beehus_api/client.py` sobre o rate limit da API Beehus e o backoff de 429),
e durante esse tempo a tela só mostrava o botão travado em "Atualizando...",
sem nenhum sinal de vida. Não havia como distinguir "está rodando" de
"travou" — e o usuário, naturalmente, concluía que tinha travado e clicava de
novo, o que só DOBRAVA a carga em cima do mesmo rate limit.

Este módulo é o lado servidor desse sinal de vida: `build_snapshot.
montar_snapshot()` publica em que etapa está, e a tela lê pela rota
`GET /api/atualizar/progresso` (app.py) enquanto o `fetch` do `/api/atualizar`
não voltou. É só INFORMATIVO — nada aqui altera o resultado do snapshot, e
falha nenhuma daqui pode derrubar um build (por isso `status()` nunca lança).

Por que por SESSÃO e não global: desde 2026-08-06 o app atende várias pessoas
ao mesmo tempo (`app.run(threaded=True)`, token por sid — ver a docstring de
`beehus_api/client.py`). Duas pessoas atualizando juntas têm andamentos
diferentes, e cada uma tem que ver o seu. A chave é o MESMO sid opaco do
token, lido de `beehus_api.client.id_sessao_atual()` — que já é propagado
para dentro das threads dos fan-outs de `db.py`/`positions.py` (cada worker
chama `bind_session_id()` de novo), então `passo_concluido()` funciona
inclusive quando é um worker do ThreadPoolExecutor que o chama.

Sem sid amarrado (CLI `build_snapshot.py`, boot do servidor), todas as
funções viram no-op silencioso — o CLI já imprime o andamento no console.
"""
import contextlib
import statistics
import threading
import time

from beehus_api.client import id_sessao_atual

# Nº de etapas do build, igual aos rótulos "[n/6]" que montar_snapshot() já
# imprimia no console desde sempre — mantido em sincronia com elas.
TOTAL_ETAPAS = 6

# [2026-09-24, pedido do usuário: "conseguimos criar uma barra de % do
# atualizando e tempo faltante?"] Quanto cada etapa pesa no relógio — NÃO é
# 1/6 cada. Medido nos timings que o próprio build imprime (ver os blocos
# "[n/6]" no .controlecargas-server.out): a etapa 3 (buscar a esteira) leva
# de 3 a 4 minutos dos ~4 a 5 minutos totais, e as etapas 2, 5 e 6 são
# instantâneas. Sem esses pesos, uma barra por etapa ficaria parada em 33%
# durante 3 minutos e depois saltaria para 100% — pior que não ter barra.
PESO_ETAPAS = {1: 0.12, 2: 0.01, 3: 0.70, 4: 0.14, 5: 0.02, 6: 0.01}

# Quantas durações guardar por escopo (empresa escolhida × tamanho da janela)
# para estimar o tempo restante DESDE O PRIMEIRO SEGUNDO de uma execução
# repetida — enquanto nenhum passo terminou, não há o que medir. Memória do
# processo, não vai pra disco: é chute de tempo, não dado do time.
_MAX_DURACOES_POR_ESCOPO = 5

_lock = threading.Lock()
_por_sessao = {}   # sid -> {etapa, titulo, passos_feitos, passos_total, iniciado_em, escopo_*}
_duracoes_por_escopo = {}   # "companyId|nDatas" -> [segundos, ...] das últimas execuções


def _estado_da_sessao_atual():
    """Contexto:
    Estado de progresso da sessão amarrada nesta thread, ou None quando não
    há sid (CLI/boot) ou quando nenhuma execução está em curso para ela —
    usado por todas as funções de escrita deste módulo como guarda. NUNCA
    cria entrada nova: só `execucao()` cria, e só ela remove.

    Pseudocódigo:
      1. Lê o sid da contextvar do cliente HTTP; sem sid -> None.
      2. `.get()` simples no dict de sessões (nunca insere).
    """
    sid = id_sessao_atual()
    if sid is None:
        return None
    return _por_sessao.get(sid)


@contextlib.contextmanager
def execucao():
    """Contexto:
    Marca o início e o fim de uma execução de `montar_snapshot()` para a
    sessão atual — usado como `with` pelo wrapper `montar_snapshot()`
    (build_snapshot.py). Enquanto o bloco roda, `status()` devolve
    `emAndamento: True` para essa sessão; ao sair (inclusive por exceção), a
    entrada é removida e a tela volta a ver `emAndamento: False`. Sem sid
    amarrado, é um no-op. Não retorna nada de útil.

    Uma execução nova sobrescreve a anterior da MESMA sessão de propósito: a
    tela dispara /api/atualizar de vários lugares e só o pedido mais novo
    interessa (mesma regra do `sequenciaAtualizacao` em atualizar.js).

    Pseudocódigo:
      1. Sem sid -> só entrega o controle ao bloco e sai (no-op).
      2. Cria a entrada da sessão zerada, marcando o instante de início.
      3. Entrega o controle ao bloco `with`.
      4. Ao sair (sempre, mesmo com exceção): remove a entrada da sessão.
    """
    sid = id_sessao_atual()
    if sid is None:
        yield
        return
    with _lock:
        _por_sessao[sid] = {
            "etapa": 0, "titulo": "", "passos_feitos": 0, "passos_total": 0,
            "iniciado_em": time.monotonic(), "escopo_chave": None, "escopo_rotulo": "",
        }
    concluiu = False
    try:
        yield
        concluiu = True
    finally:
        with _lock:
            estado = _por_sessao.pop(sid, None)
        # [2026-09-24] Só execução que chegou ao fim vira histórico: uma que
        # morreu no meio (token expirado, 500) levou menos tempo do que o
        # build real leva, e envenenaria a estimativa das próximas.
        if concluiu and estado and estado.get("escopo_chave"):
            _registrar_duracao(estado["escopo_chave"], time.monotonic() - estado["iniciado_em"])


def iniciar_etapa(numero, titulo, passos_total=0):
    """Contexto:
    Publica que a execução da sessão atual entrou na etapa `numero` de
    `TOTAL_ETAPAS` — chamada por `_montar_snapshot()` nos mesmos 6 pontos em
    que ela já imprimia "[n/6] ..." no console. `passos_total` > 0 declara
    que esta etapa tem sub-passos contáveis (hoje só a etapa 3, a busca da
    esteira, que é a longa: 1 passo por data da janela). Zera o contador de
    passos da etapa anterior. Não retorna nada.

    Pseudocódigo:
      1. Sem execução em curso para esta sessão -> sai (no-op).
      2. Grava número, título e total de passos da etapa; zera os feitos.
    """
    with _lock:
        estado = _estado_da_sessao_atual()
        if estado is None:
            return
        estado["etapa"] = numero
        estado["titulo"] = titulo
        estado["passos_total"] = passos_total
        estado["passos_feitos"] = 0


def definir_total_passos(total):
    """Contexto:
    Declara quantos sub-passos a etapa corrente tem, para quem só descobre
    isso DEPOIS de a etapa começar — hoje só o fan-out de
    `db._buscar_datas_faltantes_via_api()`, que monta a fila de consultas
    (data × empresa × tipo) já dentro da etapa 3. Zera os passos feitos, para
    a contagem nascer coerente com o total novo. Não retorna nada.

    Pseudocódigo:
      1. Sem execução em curso para esta sessão -> sai (no-op).
      2. Grava o total e zera os passos feitos.
    """
    with _lock:
        estado = _estado_da_sessao_atual()
        if estado is None:
            return
        estado["passos_total"] = total
        estado["passos_feitos"] = 0


def passo_concluido(quantos=1):
    """Contexto:
    Incrementa o contador de sub-passos da etapa corrente — chamada de dentro
    dos workers do fan-out de `db.py` a cada data da janela que termina, pra
    tela poder mostrar "[3/6] buscando dados da esteira — 4/7 datas" durante
    os minutos em que essa etapa roda. Não retorna nada.

    Pseudocódigo:
      1. Sem execução em curso para esta sessão -> sai (no-op).
      2. Soma `quantos` aos passos feitos, sem nunca passar do total
         declarado (defensivo: um total errado não faz a tela mostrar 9/7).
    """
    with _lock:
        estado = _estado_da_sessao_atual()
        if estado is None:
            return
        feitos = estado["passos_feitos"] + quantos
        total = estado["passos_total"]
        estado["passos_feitos"] = min(feitos, total) if total else feitos


def definir_escopo(chave, rotulo=""):
    """Contexto:
    Diz QUAL trabalho esta execução está fazendo — empresa escolhida (ou
    todas) × nº de datas da janela —, para o tempo restante ser estimado
    contra execuções parecidas [2026-09-24, pedido do usuário: "Sempre com
    base da seleção da empresa ou todas empresas"]. Chamada por
    `_montar_snapshot()` assim que a janela é resolvida (etapa 2), porque só
    aí o nº de datas existe. Sem execução em curso, é no-op. Não retorna nada.

    Pseudocódigo:
      1. Sem execução em curso para esta sessão -> sai.
      2. Guarda a chave (usada no histórico) e o rótulo legível (a tela
         mostra, ex.: "Eté Gestão · 7 datas").
    """
    with _lock:
        estado = _estado_da_sessao_atual()
        if estado is None:
            return
        estado["escopo_chave"] = chave
        estado["escopo_rotulo"] = rotulo


def _registrar_duracao(chave, segundos):
    """Contexto:
    Guarda quanto tempo levou uma execução COMPLETA daquele escopo, para a
    próxima já nascer com uma estimativa [2026-09-24]. Chamada só pelo fim
    bem-sucedido de `execucao()`. Não retorna nada.

    Pseudocódigo:
      1. Acrescenta a duração à lista do escopo.
      2. Mantém só as últimas _MAX_DURACOES_POR_ESCOPO (a API muda de humor
         ao longo do dia; média de meses atrás não ajuda).
    """
    with _lock:
        historico = _duracoes_por_escopo.setdefault(chave, [])
        historico.append(segundos)
        del historico[:-_MAX_DURACOES_POR_ESCOPO]


def _duracao_tipica(chave):
    """Contexto:
    Quanto costuma levar uma execução deste escopo — mediana das últimas
    guardadas (mediana, não média: um único clique que pegou rate limit pesado
    não pode dominar a estimativa). Usada por `_segundos_restantes()`.
    Retorna float em segundos, ou None sem histórico.

    Pseudocódigo:
      1. Sem chave ou sem histórico -> None.
      2. Devolve a mediana das durações guardadas.
    """
    if not chave:
        return None
    historico = _duracoes_por_escopo.get(chave)
    if not historico:
        return None
    return statistics.median(historico)


def _fracao_concluida(estado):
    """Contexto:
    Quanto do trabalho já foi feito, de 0 a 1 — é o que vira a barra de % na
    tela [2026-09-24, pedido do usuário]. Usada por `status()`. Retorna float.

    Soma o peso das etapas JÁ terminadas (PESO_ETAPAS) e, da etapa corrente,
    a parte proporcional aos sub-passos dela quando ela declarou algum (hoje
    as etapas 3 e 4, que são as que fazem chamadas à API). Uma etapa sem
    sub-passos não avança a barra enquanto roda: ela só entra inteira quando
    a próxima começa. Por isso vale manter as etapas caras declarando passos.

    Pseudocódigo:
      1. Antes da etapa 1 -> 0.
      2. Soma o peso de todas as etapas anteriores à corrente.
      3. Acrescenta o peso da corrente × (passos feitos / passos totais).
      4. Trava entre 0 e 1 (defensivo — pesos e contadores são heurística).
    """
    etapa = estado.get("etapa") or 0
    if etapa <= 0:
        return 0.0
    fracao = sum(peso for numero, peso in PESO_ETAPAS.items() if numero < etapa)
    total = estado.get("passos_total") or 0
    if total > 0:
        dentro = min(1.0, (estado.get("passos_feitos") or 0) / total)
        fracao += PESO_ETAPAS.get(etapa, 0.0) * dentro
    return max(0.0, min(1.0, fracao))


def _segundos_restantes(estado, fracao, decorrido):
    """Contexto:
    Estimativa de quanto falta, em segundos — o "tempo faltante" pedido
    [2026-09-24]. Usada por `status()`. Retorna (segundos, base) com base em
    "medido" | "historico", ou (None, None) quando ainda não dá pra dizer
    nada honesto.

    Duas fontes, nesta ordem:
      - HISTÓRICO, enquanto a execução mal começou (menos de 5% feito): regra
        de três em cima de 2% de progresso erra por minutos, e é justamente o
        começo, quando a pessoa mais olha. Com uma execução anterior do MESMO
        escopo (mesma empresa e mesmo tamanho de janela), a estimativa já sai
        boa no primeiro segundo.
      - MEDIDO, a partir de 5%: regra de três com o ritmo desta execução.
        Absorve sozinho o que o histórico não sabe — rate limit pior hoje,
        rede mais lenta, cache quente.

    Pseudocódigo:
      1. Já terminou (fração >= 1) -> 0.
      2. Menos de 5% feito e com histórico do escopo -> tempo típico menos o
         decorrido (nunca negativo).
      3. Com fração utilizável (>= 2%) -> decorrido × (1 - f) / f.
      4. Nada disso -> (None, None), e a tela mostra "calculando...".
    """
    if fracao >= 1:
        return 0.0, "medido"
    if fracao < 0.05:
        tipica = _duracao_tipica(estado.get("escopo_chave"))
        if tipica:
            return max(0.0, tipica - decorrido), "historico"
    if fracao >= 0.02:
        return max(0.0, decorrido * (1 - fracao) / fracao), "medido"
    return None, None


def status():
    """Contexto:
    Foto do andamento da sessão atual, para a rota
    `GET /api/atualizar/progresso` (app.py) devolver ao navegador. Retorna
    sempre um dict pronto pra virar JSON — `{"emAndamento": False}` quando
    não há execução em curso (ou quando não há sid), nunca None e nunca uma
    exceção: esta rota é enfeite, não pode derrubar nada.

    Pseudocódigo:
      1. Sem execução em curso -> devolve {"emAndamento": False}.
      2. Senão, devolve etapa/total, título, passos feitos/total, há quantos
         segundos a execução começou e — [2026-09-24, pedido do usuário] — o
         percentual concluído, o tempo restante estimado (com a base usada:
         medido nesta execução ou histórico do mesmo escopo) e o rótulo do
         escopo (empresa escolhida × nº de datas).
    """
    with _lock:
        estado = _estado_da_sessao_atual()
        if estado is None:
            return {"emAndamento": False}
        decorrido = time.monotonic() - estado["iniciado_em"]
        fracao = _fracao_concluida(estado)
        restantes, base = _segundos_restantes(estado, fracao, decorrido)
        return {
            "emAndamento": True,
            "etapa": estado["etapa"],
            "etapasTotal": TOTAL_ETAPAS,
            "titulo": estado["titulo"],
            "passosFeitos": estado["passos_feitos"],
            "passosTotal": estado["passos_total"],
            "segundos": round(decorrido, 1),
            # [2026-09-24, pedido do usuário: barra de % + tempo faltante]
            "percentual": round(fracao * 100, 1),
            "segundosRestantes": None if restantes is None else round(restantes),
            "baseEstimativa": base,
            "escopo": estado.get("escopo_rotulo") or "",
        }
