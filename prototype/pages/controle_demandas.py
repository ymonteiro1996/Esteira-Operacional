# -*- coding: utf-8 -*-
"""
pages/controle_demandas.py — blueprint da aba "Controle de Demandas"
====================================================================
[2026-08-21] Porte do Kanban de demandas operacionais de
`beehus-rotinas/pages/controle_demandas.py` para este protótipo, como
UNIFICAÇÃO de ferramentas dentro do "Controle de Cargas" — decisão do
usuário: a tela entra como mais uma ABA da SPA já existente
(`index.html`/`index_template.html`, `#tab-demandas`/`#panel-demandas`,
`static/js/controle_demandas/`), NÃO como página própria com rota HTML
(por isso este arquivo não tem nenhuma rota `GET /controle-demandas` nem
`render_template` — o projeto inteiro não usa Jinja, ver `app.py`).

[2026-08-21, correção do usuário logo após a 1ª implementação] Este blueprint
é ADITIVO e AUTOCONTIDO: nenhuma função/rota já existente em `app.py` foi
tocada para portar esta tela — a persistência (escrita atômica + lock +
auto-cura de cópia de conflito do OneDrive) é uma cópia PRÓPRIA e local
deste arquivo, deliberadamente PARECIDA com a de `app.py` (mesma técnica já
validada ali para `alert_comments.json`/`wallet_annotations.json`), mas sem
importar nem promover nada de `app.py` para um módulo `utils/` comum — a
ideia inicial de extrair isso para `utils/persistencia_json.py` foi
descartada pelo usuário para manter o blast radius desta tarefa restrito a
arquivos novos.

Diferenças deliberadas frente à origem (decididas com o usuário antes de
implementar, CLAUDE.md §7):
  - Dado local (`data/controle_demandas.json`, migrado 1x das 80 demandas
    reais de produção) com proteção própria contra conflito do OneDrive
    (ver seção 2 abaixo), em vez de reintroduzir a leitura/escrita "crua"
    (sem lock/atomicidade) da origem.
  - `CLIENTES`/`RESPONSAVEIS` saíram de `data/demandas_config.json`
    (CLAUDE.md §10 — configuração não hardcoded), expostos ao front-end por
    `GET /api/demandas/opcoes`; `STATUS_OPTS`/`PRIORIDADES`/`TIPOS`
    continuam constantes aqui (são enums que o código ramifica — ordenação,
    validação —, não parâmetro de negócio solto).
  - `SEED_DEMANDAS` (44 linhas hardcoded e desatualizadas da origem) NÃO
    foi portado — sem o arquivo de dado, a tela nasce com lista vazia.
  - Validação de domínio nova em `POST`/`PATCH`: `status`/`prioridade`/
    `tipo` fora dos valores válidos agora rejeitam com 400 (a origem
    aceitava qualquer string).
  - Timestamps de registros NOVOS usam `datetime.now().isoformat(timespec=
    "seconds")` (mesma convenção de `app.py`), não mais
    `datetime.utcnow().isoformat()` da origem — aquele bug fazia comentários
    aparecerem ~3h adiantados no front-end (que exibe o timestamp cru como
    se already fosse hora local). As 80 demandas migradas mantêm os
    timestamps antigos como estão (não foram corrigidos retroativamente).

A tela em beehus-rotinas continua ativa (o usuário decidiu manter as duas
fontes por enquanto, aceitando que podem divergir com o tempo).
"""

# ─────────────────────────────────────────────────────────────────────────
# 1. IMPORTS E CONFIGURAÇÃO DO BLUEPRINT
# ─────────────────────────────────────────────────────────────────────────

import json
import os
import threading
import uuid
from datetime import datetime
from pathlib import Path

from flask import Blueprint, jsonify, request

bp = Blueprint("controle_demandas", __name__)

HERE = Path(__file__).resolve().parent
DATA_DIR = HERE.parent / "data"
DEMANDAS_PATH = DATA_DIR / "controle_demandas.json"
CONFIG_PATH = DATA_DIR / "demandas_config.json"
CONFLITOS_DIR = DATA_DIR / "_conflitos_resolvidos"

# Enums do domínio — ramificam lógica (ordenação/validação) neste arquivo,
# por isso continuam constantes aqui em vez de data/demandas_config.json
# (que guarda só listas de negócio soltas: clientes/responsáveis).
PRIORIDADES = ["Alto", "Médio", "Baixo"]
STATUS_OPTS = ["Pendente", "Em Andamento", "Concluído", "Cancelado", "On Hold"]
TIPOS = ["Operacional", "Sistema", "Sistema Operacional"]

_PRIO_ORDER = {valor: indice for indice, valor in enumerate(PRIORIDADES)}
_STATUS_ORDER = {valor: indice for indice, valor in enumerate(STATUS_OPTS)}

# [2026-08-13, mesmo padrão de app.py] lock reentrante cobrindo todo o ciclo
# ler→modificar→salvar de cada rota de escrita — protege contra 2
# requisições do MESMO processo pisando uma na outra (threaded=True).
_demandas_lock = threading.RLock()


# ─────────────────────────────────────────────────────────────────────────
# 2. HELPERS / REGRAS DE NEGÓCIO (funções puras, sem Flask)
# ─────────────────────────────────────────────────────────────────────────

# [2026-08-21] As 4 funções abaixo (_escrever_json_atomico_demandas /
# _achar_copias_conflito_demandas / _arquivar_copia_conflito_demandas /
# _mesclar_copias_conflito_demandas) são uma cópia PRÓPRIA e local, só para
# controle_demandas.json — deliberadamente parecidas com a proteção contra
# conflito do OneDrive que `app.py` já tem para `alert_comments.json`/
# `wallet_annotations.json` (mesma técnica: escrita atômica + achar cópias
# "<nome>-<PC>[-N].json" + mesclar por id + arquivar em
# _conflitos_resolvidos/), mas SEM importar nem alterar nada de `app.py` —
# o usuário pediu para não promover essa lógica para um módulo `utils/`
# compartilhado nesta rodada, pra manter o blast radius restrito a arquivos
# novos.

def _escrever_json_atomico_demandas(caminho, payload):
    """Contexto:
    Grava `payload` em `caminho` sem deixar um JSON truncado/corrompido no
    disco se o processo for morto no meio da escrita. Chamada por
    _salvar_demandas(). Não retorna nada.

    Pseudocódigo:
      1. Escreve o conteúdo inteiro num arquivo temporário na MESMA pasta.
      2. Troca o arquivo temporário pelo definitivo com uma renomeação
         atômica (os.replace) — o arquivo final nunca fica parcialmente
         escrito.
    """
    tmp_path = caminho.with_suffix(caminho.suffix + ".tmp")
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, caminho)


def _achar_copias_conflito_demandas(caminho_canonico):
    """Contexto:
    Lista cópias de conflito que o OneDrive cria quando duas máquinas
    diferentes editam controle_demandas.json quase ao mesmo tempo — o nome
    vira "<nome>-<PC>.json" (às vezes com um contador "-2", "-3" no fim).
    Chamada por _carregar_demandas() a cada leitura. Retorna lista de Path
    (vazia se não houver nenhuma cópia).

    Pseudocódigo:
      1. Monta o padrão "<stem>-*<sufixo>" na mesma pasta do arquivo
         canônico.
      2. Devolve os arquivos que batem, ignorando temporários (".tmp").
    """
    padrao = f"{caminho_canonico.stem}-*{caminho_canonico.suffix}"
    return sorted(
        p for p in caminho_canonico.parent.glob(padrao)
        if p.is_file() and not p.name.endswith(".tmp")
    )


def _arquivar_copia_conflito_demandas(copia):
    """Contexto:
    Move uma cópia de conflito do OneDrive (já incorporada por
    _mesclar_copias_conflito_demandas) para data/_conflitos_resolvidos/, em
    vez de apagá-la — mantém o arquivo original disponível pra conferência
    manual. Não retorna nada.

    Pseudocódigo:
      1. Garante que _conflitos_resolvidos/ existe.
      2. Move o arquivo pra lá; se já existir um com esse nome (raro),
         acrescenta um contador no nome pra nunca sobrescrever nada.
    """
    CONFLITOS_DIR.mkdir(parents=True, exist_ok=True)
    destino = CONFLITOS_DIR / copia.name
    contador = 2
    while destino.exists():
        destino = CONFLITOS_DIR / f"{copia.stem}_{contador}{copia.suffix}"
        contador += 1
    copia.replace(destino)


def _mesclar_copias_conflito_demandas(demandas):
    """Contexto:
    Procura cópias de conflito do OneDrive de controle_demandas.json (ver
    _achar_copias_conflito_demandas) e incorpora nelas qualquer demanda
    cujo "_id" ainda não esteja em `demandas` — cada demanda é sempre um
    registro independente (nunca colide), então a mesclagem é uma união
    simples por id. Chamada por _carregar_demandas() a cada leitura.
    Retorna a lista final (== `demandas`, sem mudança, se não havia nenhuma
    cópia pra mesclar).

    Pseudocódigo:
      1. Acha cópias de conflito; sem nenhuma, devolve `demandas` como veio.
      2. Pra cada cópia: lê o JSON (ignora e avisa no console se vier
         corrompido); soma ao resultado as demandas cujo "_id" ainda não
         apareceu.
      3. Arquiva a cópia processada (mesmo se ilegível) — nunca fica
         reprocessando o mesmo arquivo pra sempre.
      4. Se algo novo entrou, regrava controle_demandas.json (sob
         _demandas_lock, reentrante) e avisa no console.
    """
    copias = _achar_copias_conflito_demandas(DEMANDAS_PATH)
    if not copias:
        return demandas

    ids_conhecidos = {d.get("_id") for d in demandas}
    mesclados = list(demandas)
    houve_novidade = False

    for copia in copias:
        try:
            with open(copia, "r", encoding="utf-8") as f:
                payload = json.load(f)
            for demanda in payload:
                if demanda.get("_id") not in ids_conhecidos:
                    mesclados.append(demanda)
                    ids_conhecidos.add(demanda.get("_id"))
                    houve_novidade = True
        except (json.JSONDecodeError, OSError) as exc:
            print(f"AVISO: cópia de conflito ilegível ignorada em controle_demandas ({copia.name}): {exc}")
        _arquivar_copia_conflito_demandas(copia)

    if houve_novidade:
        with _demandas_lock:
            _salvar_demandas(mesclados)
        print(f"[ControleDemandas] {len(copias)} cópia(s) de conflito do OneDrive mesclada(s) em controle_demandas.json.")

    return mesclados


def _agora_iso():
    """Contexto:
    Timestamp para registros NOVOS (criação/atualização/comentário) desta
    tela. Chamada por criar_demanda()/atualizar_demanda()/adicionar_
    comentario(). Retorna string.

    Pseudocódigo:
      1. Usa a hora LOCAL do servidor (mesma convenção de app.py,
         datetime.now().isoformat(timespec="seconds")) — a origem
         (beehus-rotinas) usava datetime.utcnow().isoformat() sem timezone,
         o que o front-end exibia como se já fosse hora local (bug de
         comentários aparecendo ~3h adiantados); corrigido só daqui pra
         frente, sem tocar nos timestamps das 80 demandas já migradas.
    """
    return datetime.now().isoformat(timespec="seconds")


def _ensure_data_dir():
    """Contexto: garante que prototype/data/ existe antes de ler/gravar
    controle_demandas.json — mesmo cuidado de app.py (1ª execução pode não
    ter a pasta ainda). Não retorna nada.

    Pseudocódigo:
      1. Cria DATA_DIR (e pais, se faltarem); não faz nada se já existir.
    """
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def _carregar_demandas():
    """Contexto:
    Lê controle_demandas.json do disco A CADA CHAMADA — nunca cacheia em
    memória entre requests (mesmo padrão de _load_comments() em app.py).
    Nunca lança exceção — arquivo ausente/corrompido devolve lista vazia
    (CLAUDE.md/decisão do usuário: sem SEED_DEMANDAS, a tela nasce vazia se
    o arquivo não existir). Antes de devolver, mescla qualquer cópia de
    conflito do OneDrive já esperando na pasta (ver
    _mesclar_copias_conflito_demandas, cópia local própria deste arquivo).
    Retorna lista de dicts.

    Pseudocódigo:
      1. Garante a pasta data/.
      2. Arquivo ausente -> lista vazia; erro de parsing -> lista vazia.
      3. Mescla cópias de conflito por "_id" (união simples, nunca colide).
      4. Devolve a lista final.
    """
    _ensure_data_dir()
    if not DEMANDAS_PATH.exists():
        demandas = []
    else:
        try:
            with open(DEMANDAS_PATH, "r", encoding="utf-8") as f:
                demandas = json.load(f)
        except (json.JSONDecodeError, OSError):
            demandas = []
    return _mesclar_copias_conflito_demandas(demandas)


def _salvar_demandas(demandas):
    """Contexto: persiste a lista completa de demandas em
    controle_demandas.json (reescreve o arquivo inteiro) — escrita atômica
    própria deste arquivo (ver _escrever_json_atomico_demandas). Quem
    chama precisa segurar _demandas_lock durante todo o ciclo
    ler→modificar→salvar. Não retorna nada.

    Pseudocódigo:
      1. Garante a pasta data/.
      2. Serializa a lista atomicamente por cima do arquivo (sem wrapper —
         mesmo formato "lista pura" da origem, decisão do usuário de manter
         o schema como está nesta rodada).
    """
    _ensure_data_dir()
    _escrever_json_atomico_demandas(DEMANDAS_PATH, demandas)


def _carregar_opcoes_config():
    """Contexto:
    Lê data/demandas_config.json (clientes/responsáveis) — arquivo pequeno,
    relido a cada chamada (custo irrelevante) para refletir edições manuais
    sem precisar reiniciar o servidor. Usada por GET /api/demandas/opcoes
    e por openNew()/formulário no front-end (via essa mesma rota). Retorna
    dict {"clientes": [...], "responsaveis": [...]}.

    Pseudocódigo:
      1. Arquivo ausente/corrompido -> listas vazias (nunca derruba a
         rota).
      2. Caso contrário, devolve "clientes"/"responsaveis" do JSON. """
    if not CONFIG_PATH.exists():
        return {"clientes": [], "responsaveis": []}
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            config = json.load(f)
    except (json.JSONDecodeError, OSError):
        return {"clientes": [], "responsaveis": []}
    return {
        "clientes": config.get("clientes", []),
        "responsaveis": config.get("responsaveis", []),
    }


def _encontrar_demanda(demandas, demand_id):
    """Contexto: acha o dict de uma demanda pelo "_id" numa lista já
    carregada — usada por atualizar_demanda()/adicionar_comentario() antes
    de mexer no registro. Retorna o dict ou None se não achar.

    Pseudocódigo:
      1. Percorre a lista comparando "_id"; devolve o primeiro que bater. """
    for demanda in demandas:
        if demanda.get("_id") == demand_id:
            return demanda
    return None


def _filtrar_demandas(demandas, filtros):
    """Contexto:
    Aplica os filtros da querystring de GET /api/demandas (cliente/
    prioridade/responsavel/status/tipo/busca por texto) — mesma lógica da
    origem. Chamada por listar_demandas(). Retorna nova lista (não
    modifica `demandas`).

    Pseudocódigo:
      1. Sem filtro algum -> devolve a lista como veio.
      2. Cliente/prioridade/status/tipo: igualdade exata quando informado.
      3. Responsável: substring (case-insensitive) — cobre responsáveis
         compostos tipo "Yuri/Hulgo".
      4. Busca: substring (case-insensitive) no texto da demanda OU do
         responsável. """
    cliente = filtros.get("cliente", "").strip()
    prioridade = filtros.get("prioridade", "").strip()
    responsavel = filtros.get("responsavel", "").strip().lower()
    status = filtros.get("status", "").strip()
    tipo = filtros.get("tipo", "").strip()
    busca = filtros.get("search", "").strip().lower()

    resultado = list(demandas)
    if cliente:
        resultado = [d for d in resultado if d.get("cliente") == cliente]
    if prioridade:
        resultado = [d for d in resultado if d.get("prioridade") == prioridade]
    if responsavel:
        resultado = [d for d in resultado if responsavel in d.get("responsavel", "").lower()]
    if status:
        resultado = [d for d in resultado if d.get("status") == status]
    if tipo:
        resultado = [d for d in resultado if d.get("tipo") == tipo]
    if busca:
        resultado = [
            d for d in resultado
            if busca in d.get("demanda", "").lower() or busca in d.get("responsavel", "").lower()
        ]
    return resultado


def _ordenar_demandas(demandas):
    """Contexto: ordem de exibição padrão do quadro — status (Pendente
    primeiro) > prioridade (Alto primeiro) > cliente alfabético. Chamada
    por listar_demandas(). Retorna nova lista ordenada.

    Pseudocódigo:
      1. Ordena por (posição do status em STATUS_OPTS, posição da
         prioridade em PRIORIDADES, nome do cliente) — valores fora do
         enum vão para o fim (índice 9). """
    return sorted(demandas, key=lambda d: (
        _STATUS_ORDER.get(d.get("status", ""), 9),
        _PRIO_ORDER.get(d.get("prioridade", ""), 9),
        d.get("cliente", ""),
    ))


def _validar_valor_do_enum(valor, valores_validos, nome_campo):
    """Contexto:
    Validação de domínio genérica para os 3 campos-enum da demanda
    (status/prioridade/tipo) — usada por POST/PATCH /api/demandas. A
    origem (beehus-rotinas) aceitava qualquer string nesses campos; esta é
    a validação nova pedida pelo usuário ao portar a tela. Retorna None se
    válido (ou campo vazio/ausente — "tipo" pode ficar em branco), ou uma
    mensagem de erro (string) se inválido.

    Pseudocódigo:
      1. Vazio/ausente -> None (campo opcional; quem exige valor
         obrigatório valida isso à parte).
      2. Fora da lista de valores válidos -> mensagem de erro citando as
         opções aceitas.
      3. Caso contrário -> None. """
    if not valor:
        return None
    if valor not in valores_validos:
        return f"{nome_campo} inválido: '{valor}' (esperado um de {valores_validos})"
    return None


def _validar_payload_demanda(dados):
    """Contexto:
    Valida o corpo de POST/PATCH /api/demandas antes de gravar — acumula
    todos os erros de domínio (status/prioridade/tipo fora do enum) em vez
    de parar no primeiro. Chamada por criar_demanda()/atualizar_demanda().
    Retorna lista de strings (vazia se não houver erro).

    Pseudocódigo:
      1. Valida "status" contra STATUS_OPTS, "prioridade" contra
         PRIORIDADES, "tipo" contra TIPOS (só se o campo veio no payload).
      2. Devolve a lista de mensagens de erro acumuladas. """
    erros = []
    if "status" in dados:
        erro = _validar_valor_do_enum(dados.get("status"), STATUS_OPTS, "status")
        if erro:
            erros.append(erro)
    if "prioridade" in dados:
        erro = _validar_valor_do_enum(dados.get("prioridade"), PRIORIDADES, "prioridade")
        if erro:
            erros.append(erro)
    if "tipo" in dados:
        erro = _validar_valor_do_enum(dados.get("tipo"), TIPOS, "tipo")
        if erro:
            erros.append(erro)
    return erros


# ─────────────────────────────────────────────────────────────────────────
# 3. ROTAS — finas, só orquestram (chamam os helpers acima)
# ─────────────────────────────────────────────────────────────────────────

@bp.route("/api/demandas/opcoes", methods=["GET"])
def opcoes_demandas():
    """Contexto:
    Devolve todo o vocabulário dinâmico do formulário/filtros do Kanban
    (clientes/responsáveis vindos de data/demandas_config.json + os 3
    enums fixos deste arquivo) — consumida 1x no boot da aba pelo
    front-end (static/js/controle_demandas/index.js), já que a tela é
    servida sem Jinja (não dá pra injetar `<option>` no HTML no server).
    Retorna JSON.

    Pseudocódigo:
      1. Lê clientes/responsáveis de demandas_config.json.
      2. Junta com status/prioridades/tipos (constantes deste módulo) e
         devolve tudo num único payload. """
    opcoes = _carregar_opcoes_config()
    return jsonify({
        "clientes": opcoes["clientes"],
        "responsaveis": opcoes["responsaveis"],
        "status": STATUS_OPTS,
        "prioridades": PRIORIDADES,
        "tipos": TIPOS,
    })


@bp.route("/api/demandas", methods=["GET"])
def listar_demandas():
    """Contexto:
    Lista as demandas do quadro para o front-end montar o Kanban — aplica
    os filtros da querystring (busca/cliente/prioridade/responsável/
    status/tipo) e devolve já na ordem padrão de exibição. Chamada pelo
    boot da aba e a cada mudança de filtro (ver static/js/
    controle_demandas/filtros.js). Retorna JSON (lista).

    Pseudocódigo:
      1. Carrega todas as demandas do disco.
      2. Filtra pelos parâmetros da querystring.
      3. Ordena (status > prioridade > cliente) e devolve. """
    demandas = _carregar_demandas()
    demandas = _filtrar_demandas(demandas, request.args)
    demandas = _ordenar_demandas(demandas)
    return jsonify(demandas)


@bp.route("/api/demandas", methods=["POST"])
def criar_demanda():
    """Contexto:
    Cria uma demanda nova — chamada pelo modal "Nova Demanda" (submitForm()
    em static/js/controle_demandas/modais.js). Retorna {"id": "..."} (201)
    ou {"error": ...} (400) se cliente/demanda faltarem ou algum enum vier
    inválido.

    Pseudocódigo:
      1. Lê o body JSON; valida "cliente"/"demanda" obrigatórios e os 3
         enums opcionais (status/prioridade/tipo, se vierem preenchidos).
      2. Monta o documento (novo "_id" uuid4, created_at/updated_at =
         agora, comments=[]).
      3. Sob _demandas_lock: carrega, anexa, salva.
      4. Devolve o id do registro criado. """
    dados = request.get_json(force=True, silent=True) or {}

    erros = []
    if not (dados.get("cliente") or "").strip():
        erros.append("cliente é obrigatório")
    if not (dados.get("demanda") or "").strip():
        erros.append("demanda é obrigatória")
    erros.extend(_validar_payload_demanda(dados))
    if erros:
        return jsonify({"error": "; ".join(erros)}), 400

    agora = _agora_iso()
    documento = {
        "_id": str(uuid.uuid4()),
        "cliente": dados.get("cliente", ""),
        "demanda": dados.get("demanda", ""),
        "prioridade": dados.get("prioridade") or "Médio",
        "tipo": dados.get("tipo", ""),
        "responsavel": dados.get("responsavel", ""),
        "deadline": dados.get("deadline", ""),
        "status": dados.get("status") or "Pendente",
        "created_at": agora,
        "updated_at": agora,
        "comments": [],
    }
    with _demandas_lock:
        demandas = _carregar_demandas()
        demandas.append(documento)
        _salvar_demandas(demandas)
    return jsonify({"id": documento["_id"]}), 201


@bp.route("/api/demandas/<demand_id>", methods=["PATCH"])
def atualizar_demanda(demand_id):
    """Contexto:
    Atualiza campos de uma demanda existente — usada tanto pela edição via
    modal (form completo) quanto por ações rápidas do quadro (arrastar um
    card entre colunas = PATCH só de "responsavel"; +/- de progresso =
    PATCH só de "progress"). Retorna {"ok": true} (200), {"error": ...}
    (400, enum inválido) ou 404 se o id não existir.

    Pseudocódigo:
      1. Lê o body JSON; valida os 3 enums (só os campos presentes no
         payload).
      2. Sob _demandas_lock: carrega, acha a demanda pelo "_id" (404 se não
         achar), aplica só os campos permitidos presentes no payload,
         atualiza "updated_at", salva. """
    dados = request.get_json(force=True, silent=True) or {}
    erros = _validar_payload_demanda(dados)
    if erros:
        return jsonify({"error": "; ".join(erros)}), 400

    campos_permitidos = {"cliente", "demanda", "prioridade", "tipo", "responsavel", "deadline", "status", "progress"}
    with _demandas_lock:
        demandas = _carregar_demandas()
        demanda = _encontrar_demanda(demandas, demand_id)
        if demanda is None:
            return jsonify({"error": "demanda não encontrada"}), 404
        for campo, valor in dados.items():
            if campo in campos_permitidos:
                demanda[campo] = valor
        demanda["updated_at"] = _agora_iso()
        _salvar_demandas(demandas)
    return jsonify({"ok": True})


@bp.route("/api/demandas/<demand_id>", methods=["DELETE"])
def remover_demanda(demand_id):
    """Contexto: remove uma demanda — modal de confirmação "Remover
    demanda?" do front-end. Retorna {"ok": true} sempre (idempotente: id
    inexistente não é erro, só não remove nada).

    Pseudocódigo:
      1. Sob _demandas_lock: carrega, filtra fora o "_id" pedido, salva. """
    with _demandas_lock:
        demandas = _carregar_demandas()
        demandas = [d for d in demandas if d.get("_id") != demand_id]
        _salvar_demandas(demandas)
    return jsonify({"ok": True})


@bp.route("/api/demandas/<demand_id>/comments", methods=["POST"])
def adicionar_comentario(demand_id):
    """Contexto: acrescenta 1 comentário/atualização a uma demanda — modal
    "Atualizações" do front-end. Retorna {"ok": true} ou 404 se o id não
    existir.

    Pseudocódigo:
      1. Lê "text" do body (vazio é permitido — mesma tolerância da
         origem; o front-end já bloqueia texto vazio antes de chamar).
      2. Sob _demandas_lock: carrega, acha a demanda (404 se não achar),
         anexa o comentário (texto + timestamp local) à lista de
         comentários, atualiza "updated_at", salva. """
    dados = request.get_json(force=True, silent=True) or {}
    comentario = {"text": dados.get("text", ""), "created_at": _agora_iso()}

    with _demandas_lock:
        demandas = _carregar_demandas()
        demanda = _encontrar_demanda(demandas, demand_id)
        if demanda is None:
            return jsonify({"error": "demanda não encontrada"}), 404
        demanda.setdefault("comments", []).append(comentario)
        demanda["updated_at"] = _agora_iso()
        _salvar_demandas(demandas)
    return jsonify({"ok": True})
