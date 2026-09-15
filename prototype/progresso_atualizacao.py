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
import threading
import time

from beehus_api.client import id_sessao_atual

# Nº de etapas do build, igual aos rótulos "[n/6]" que montar_snapshot() já
# imprimia no console desde sempre — mantido em sincronia com elas.
TOTAL_ETAPAS = 6

_lock = threading.Lock()
_por_sessao = {}   # sid -> {etapa, titulo, passos_feitos, passos_total, iniciado_em}


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
            "iniciado_em": time.monotonic(),
        }
    try:
        yield
    finally:
        with _lock:
            _por_sessao.pop(sid, None)


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


def status():
    """Contexto:
    Foto do andamento da sessão atual, para a rota
    `GET /api/atualizar/progresso` (app.py) devolver ao navegador. Retorna
    sempre um dict pronto pra virar JSON — `{"emAndamento": False}` quando
    não há execução em curso (ou quando não há sid), nunca None e nunca uma
    exceção: esta rota é enfeite, não pode derrubar nada.

    Pseudocódigo:
      1. Sem execução em curso -> devolve {"emAndamento": False}.
      2. Senão, devolve etapa/total, título, passos feitos/total e há quantos
         segundos a execução começou.
    """
    with _lock:
        estado = _estado_da_sessao_atual()
        if estado is None:
            return {"emAndamento": False}
        return {
            "emAndamento": True,
            "etapa": estado["etapa"],
            "etapasTotal": TOTAL_ETAPAS,
            "titulo": estado["titulo"],
            "passosFeitos": estado["passos_feitos"],
            "passosTotal": estado["passos_total"],
            "segundos": round(time.monotonic() - estado["iniciado_em"], 1),
        }
