# -*- coding: utf-8 -*-
"""
pages/anomalias.py — blueprint da aba "Anomalias"
====================================================================
[2026-08-21] Board MANUAL de anomalias/incidentes operacionais, no MESMO
mecanismo da aba "Controle de Demandas" (`pages/controle_demandas.py`):
CRUD simples sobre um JSON próprio (`data/anomalias.json`), populado à mão
pelo time — SEM NENHUMA relação com `snapshot_builder.py`/`registry.py`/
`build_snapshot.py`/`snapshot.json` ou qualquer dado de carteira/esteira.

[Correção de rumo do usuário, mesma sessão] Uma tentativa anterior desta
tarefa tentou construir "Anomalias" como análise AUTOMÁTICA computada a
partir do snapshot de carteiras (lendo `registry.py`/`snapshot_builder.py`)
— foi revertida por completo. O usuário corrigiu: "essa nova aba deve ser
similar a de demandas, sem relação com as carteiras". Este arquivo nasce
já na versão certa; nunca reintroduzir leitura de snapshot aqui sem
confirmar de novo com o usuário (CLAUDE.md §7).

Este blueprint é ADITIVO e AUTOCONTIDO, seguindo o mesmo padrão validado
por `pages/controle_demandas.py`: a persistência (escrita atômica + lock +
auto-cura de cópia de conflito do OneDrive) é uma cópia PRÓPRIA e local
deste arquivo — deliberadamente PARECIDA com a de `controle_demandas.py`/
`app.py`, mas sem importar nada de lá nem promover para um módulo
`utils/` comum (mesma decisão do usuário na tarefa de Demandas: manter o
blast radius restrito a arquivos novos).

Reaproveitamento deliberado: `CLIENTES`/`RESPONSAVEIS` vêm do MESMO
arquivo `data/demandas_config.json` que a aba de Demandas já usa (só
leitura — nunca escreve nesse arquivo daqui), para as duas telas nunca
divergirem sobre "quais clientes/responsáveis existem". `STATUS_OPTS` é
literalmente a mesma lista de `controle_demandas.py` (pedido explícito do
usuário: "mesmos valores de Demandas por consistência").

Funcionalidade nova desta tela (não existe em Demandas): cada anomalia
pode ter 0+ `demandas_vinculadas` — cada vínculo é só uma REFERÊNCIA por
id (`{"demanda_id", "horizonte", "resumo", "created_at"}`), nunca duplica
dado nenhum de Demandas. Quem cria/edita a demanda em si continua sendo
exclusivamente `pages/controle_demandas.py` (`POST`/`GET /api/demandas`) —
este arquivo só grava o vínculo do lado da Anomalia.

Decisão de design registrada aqui (sem regra explícita do usuário,
CLAUDE.md §7 — não é quebra de padrão, é só uma escolha de agrupamento):
o quadro Kanban desta aba agrupa por CRITICIDADE (Crítico/Atenção/
Observação — 3 colunas FIXAS), não por responsável como em Demandas.
Motivo: criticidade é o eixo central e exclusivo desta tela (o campo que
não existe em Demandas e que dá sentido a um board de "anomalias" — um
board de triagem de severidade, como um bug tracker), enquanto
responsável é mais sobre distribuição de carga de trabalho (o que já faz
sentido em Demandas, que é sobre tarefas atribuídas a alguém). Com só 3
valores fixos, o board também dispensa a mecânica de colunas dinâmicas
ocultáveis/persistidas em localStorage que Demandas precisa (N
responsáveis variáveis) — simplificação real, não corte de escopo.

[2026-08-22] Parte 2 (Onda 2) do plano de melhorias funcionais desta aba
— usuário liberou edição pontual e cirúrgica destes arquivos
(pages/anomalias.py, static/js/anomalias/*.js, static/css/anomalias.css)
para acrescentar campo novo ao schema (a regra "só adicionar" continua
valendo para todo o resto do app). Campos novos: `ocorrido_em` (data real
do problema, opcional — default hoje quando ausente, ver criar_anomalia)
+ `impacto` (texto curto livre) + `tags` (lista de texto livre, com
sugestões em data/anomalias_config.json) + `historico` (trilha de
auditoria, registrada aqui no servidor sempre que "criticidade"/"status"
mudam via PATCH — inclusive o PATCH de arrastar-e-soltar entre colunas,
que já muda só "criticidade"). Limiares de aging (Onda 1, badge "há Nd"
no cartão) e as tags sugeridas também viraram config ajustável em
data/anomalias_config.json (CLAUDE.md §10), devolvidos por
GET /api/anomalias/opcoes.
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

bp = Blueprint("anomalias", __name__)

HERE = Path(__file__).resolve().parent
DATA_DIR = HERE.parent / "data"
ANOMALIAS_PATH = DATA_DIR / "anomalias.json"
CONFIG_PATH = DATA_DIR / "demandas_config.json"  # reaproveitado (só leitura) da aba Demandas
ANOMALIAS_CONFIG_PATH = DATA_DIR / "anomalias_config.json"  # config PRÓPRIA desta tela (limiares de aging + tags sugeridas)
CONFLITOS_DIR = DATA_DIR / "_conflitos_resolvidos"

# Enums do domínio — ramificam lógica (ordenação/validação) neste arquivo,
# por isso continuam constantes aqui em vez de data/demandas_config.json.
CRITICIDADES = ["Crítico", "Atenção", "Observação"]
# Mesma lista de pages/controle_demandas.py::STATUS_OPTS — pedido do
# usuário: "mesmos valores de Demandas por consistência". Duplicada aqui
# (em vez de importada) para manter os dois blueprints desacoplados —
# mesma decisão de não criar um módulo `utils/` compartilhado.
STATUS_OPTS = ["Pendente", "Em Andamento", "Concluído", "Cancelado", "On Hold"]
HORIZONTES = ["curto_prazo", "longo_prazo"]
# [2026-08-22] Campos que geram entrada em `historico[]` quando mudam de
# valor via PATCH /api/anomalias/<id> (ver _registrar_mudanca_no_historico)
# — só os 2 eixos de triagem desta tela (o board é organizado por
# criticidade; status é o eixo que Demandas usa). Os demais campos editáveis
# (título/descrição/responsável/ações/tags/etc.) não geram trilha, só os
# que mudam "onde a anomalia está" no processo.
CAMPOS_COM_HISTORICO = {"criticidade", "status"}

# [2026-08-22] Padrões usados quando data/anomalias_config.json ainda não
# existe ou está corrompido (ver _carregar_config_anomalias) — nunca
# derrubam a rota de opções por falta desse arquivo de config.
_AGING_THRESHOLDS_PADRAO = {
    "Crítico": {"verde": 2, "ambar": 5},
    "Atenção": {"verde": 7, "ambar": 14},
    "Observação": {"verde": 21, "ambar": 45},
}
_TAGS_SUGERIDAS_PADRAO = [
    "preço faltando", "ativo não mapeado", "custódia atrasada",
    "explosão de fundo", "classificação", "NAV divergente", "cadastro",
]

# Mapa criticidade -> prioridade padrão de demanda, usado pelo front-end
# (static/js/anomalias/vinculos.js) só como VALOR PADRÃO editável no mini
# formulário de "criar demanda nova e já vincular" — nunca força o valor,
# quem decide a prioridade final é sempre quem preenche o formulário.
CRITICIDADE_PARA_PRIORIDADE = {"Crítico": "Alto", "Atenção": "Médio", "Observação": "Baixo"}

_CRIT_ORDER = {valor: indice for indice, valor in enumerate(CRITICIDADES)}
_STATUS_ORDER = {valor: indice for indice, valor in enumerate(STATUS_OPTS)}

# [mesmo padrão de controle_demandas.py/app.py] lock reentrante cobrindo
# todo o ciclo ler→modificar→salvar de cada rota de escrita — protege
# contra 2 requisições do MESMO processo pisando uma na outra
# (threaded=True).
_anomalias_lock = threading.RLock()


# ─────────────────────────────────────────────────────────────────────────
# 2. HELPERS / REGRAS DE NEGÓCIO (funções puras, sem Flask)
# ─────────────────────────────────────────────────────────────────────────

# As 4 funções abaixo (_escrever_json_atomico_anomalias /
# _achar_copias_conflito_anomalias / _arquivar_copia_conflito_anomalias /
# _mesclar_copias_conflito_anomalias) são uma cópia PRÓPRIA e local, só
# para anomalias.json — deliberadamente parecidas com a proteção contra
# conflito do OneDrive que `controle_demandas.py`/`app.py` já têm (mesma
# técnica: escrita atômica + achar cópias "<nome>-<PC>[-N].json" + mesclar
# por id + arquivar em _conflitos_resolvidos/), mas SEM importar nada de
# lá — mantém o blast radius desta tela restrito a arquivos novos.
# `_conflitos_resolvidos/` é a MESMA pasta física que controle_demandas.py
# usa, mas o glob abaixo é específico do stem "anomalias" — nunca cruza
# com as cópias de conflito de controle_demandas.json.

def _escrever_json_atomico_anomalias(caminho, payload):
    """Contexto:
    Grava `payload` em `caminho` sem deixar um JSON truncado/corrompido no
    disco se o processo for morto no meio da escrita. Chamada por
    _salvar_anomalias(). Não retorna nada.

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


def _achar_copias_conflito_anomalias(caminho_canonico):
    """Contexto:
    Lista cópias de conflito que o OneDrive cria quando duas máquinas
    diferentes editam anomalias.json quase ao mesmo tempo — o nome vira
    "<nome>-<PC>.json" (às vezes com um contador "-2", "-3" no fim).
    Chamada por _carregar_anomalias() a cada leitura. Retorna lista de
    Path (vazia se não houver nenhuma cópia).

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


def _arquivar_copia_conflito_anomalias(copia):
    """Contexto:
    Move uma cópia de conflito do OneDrive (já incorporada por
    _mesclar_copias_conflito_anomalias) para data/_conflitos_resolvidos/,
    em vez de apagá-la — mantém o arquivo original disponível pra
    conferência manual. Não retorna nada.

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


def _mesclar_copias_conflito_anomalias(anomalias):
    """Contexto:
    Procura cópias de conflito do OneDrive de anomalias.json (ver
    _achar_copias_conflito_anomalias) e incorpora nelas qualquer anomalia
    cujo "id" ainda não esteja em `anomalias` — cada anomalia é sempre um
    registro independente (nunca colide), então a mesclagem é uma união
    simples por id. Chamada por _carregar_anomalias() a cada leitura.
    Retorna a lista final (== `anomalias`, sem mudança, se não havia
    nenhuma cópia pra mesclar).

    Pseudocódigo:
      1. Acha cópias de conflito; sem nenhuma, devolve `anomalias` como
         veio.
      2. Pra cada cópia: lê o JSON (ignora e avisa no console se vier
         corrompido); soma ao resultado as anomalias cujo "id" ainda não
         apareceu.
      3. Arquiva a cópia processada (mesmo se ilegível) — nunca fica
         reprocessando o mesmo arquivo pra sempre.
      4. Se algo novo entrou, regrava anomalias.json (sob
         _anomalias_lock, reentrante) e avisa no console.
    """
    copias = _achar_copias_conflito_anomalias(ANOMALIAS_PATH)
    if not copias:
        return anomalias

    ids_conhecidos = {a.get("id") for a in anomalias}
    mesclados = list(anomalias)
    houve_novidade = False

    for copia in copias:
        try:
            with open(copia, "r", encoding="utf-8") as f:
                payload = json.load(f)
            for anomalia in payload:
                if anomalia.get("id") not in ids_conhecidos:
                    mesclados.append(anomalia)
                    ids_conhecidos.add(anomalia.get("id"))
                    houve_novidade = True
        except (json.JSONDecodeError, OSError) as exc:
            print(f"AVISO: cópia de conflito ilegível ignorada em anomalias ({copia.name}): {exc}")
        _arquivar_copia_conflito_anomalias(copia)

    if houve_novidade:
        with _anomalias_lock:
            _salvar_anomalias(mesclados)
        print(f"[Anomalias] {len(copias)} cópia(s) de conflito do OneDrive mesclada(s) em anomalias.json.")

    return mesclados


def _agora_iso():
    """Contexto:
    Timestamp para registros NOVOS (criação/atualização/comentário/
    vínculo) desta tela. Chamada por criar_anomalia()/atualizar_anomalia()/
    adicionar_comentario()/vincular_demanda(). Retorna string.

    Pseudocódigo:
      1. Usa a hora LOCAL do servidor (mesma convenção de
         controle_demandas.py/app.py, datetime.now().isoformat(timespec=
         "seconds")) — nunca datetime.utcnow() (bug de fuso já corrigido
         na origem, não repetir aqui).
    """
    return datetime.now().isoformat(timespec="seconds")


def _ensure_data_dir():
    """Contexto: garante que prototype/data/ existe antes de ler/gravar
    anomalias.json — mesmo cuidado de controle_demandas.py/app.py (1ª
    execução pode não ter a pasta ainda). Não retorna nada.

    Pseudocódigo:
      1. Cria DATA_DIR (e pais, se faltarem); não faz nada se já existir.
    """
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def _carregar_anomalias():
    """Contexto:
    Lê anomalias.json do disco A CADA CHAMADA — nunca cacheia em memória
    entre requests (mesmo padrão de controle_demandas.py). Nunca lança
    exceção — arquivo ausente/corrompido devolve lista vazia. Antes de
    devolver, mescla qualquer cópia de conflito do OneDrive já esperando
    na pasta (ver _mesclar_copias_conflito_anomalias). Retorna lista de
    dicts.

    Pseudocódigo:
      1. Garante a pasta data/.
      2. Arquivo ausente -> lista vazia; erro de parsing -> lista vazia.
      3. Mescla cópias de conflito por "id" (união simples, nunca colide).
      4. Devolve a lista final.
    """
    _ensure_data_dir()
    if not ANOMALIAS_PATH.exists():
        anomalias = []
    else:
        try:
            with open(ANOMALIAS_PATH, "r", encoding="utf-8") as f:
                anomalias = json.load(f)
        except (json.JSONDecodeError, OSError):
            anomalias = []
    return _mesclar_copias_conflito_anomalias(anomalias)


def _salvar_anomalias(anomalias):
    """Contexto: persiste a lista completa de anomalias em anomalias.json
    (reescreve o arquivo inteiro) — escrita atômica própria deste arquivo
    (ver _escrever_json_atomico_anomalias). Quem chama precisa segurar
    _anomalias_lock durante todo o ciclo ler→modificar→salvar. Não
    retorna nada.

    Pseudocódigo:
      1. Garante a pasta data/.
      2. Serializa a lista atomicamente por cima do arquivo (lista pura,
         sem wrapper — mesmo formato de controle_demandas.json). """
    _ensure_data_dir()
    _escrever_json_atomico_anomalias(ANOMALIAS_PATH, anomalias)


def _carregar_opcoes_config():
    """Contexto:
    Lê data/demandas_config.json (clientes/responsáveis) — MESMO arquivo
    que a aba Demandas usa, só leitura, para as duas telas nunca
    divergirem sobre "quais clientes/responsáveis existem". Relido a cada
    chamada (custo irrelevante). Usada por GET /api/anomalias/opcoes.
    Retorna dict {"clientes": [...], "responsaveis": [...]}.

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


def _carregar_config_anomalias():
    """Contexto:
    Lê data/anomalias_config.json — config AJUSTÁVEL própria desta tela
    (CLAUDE.md §10: parâmetro configurável vai para data/*.json, não
    hardcoded no meio da lógica): limiares de aging (dias) por
    criticidade, usados pelo front-end para colorir o badge "há Nd" do
    cartão (verde/âmbar/vermelho, melhoria de aging), e a lista de tags
    sugeridas para autocomplete do campo livre "tags". Relida a cada
    chamada (custo irrelevante, mesmo padrão de _carregar_opcoes_config).
    Usada por opcoes_anomalias(). Retorna dict
    {"aging_thresholds_dias": {...}, "tags_sugeridas": [...]}.

    Pseudocódigo:
      1. Arquivo ausente/corrompido -> devolve os padrões hardcoded neste
         módulo (_AGING_THRESHOLDS_PADRAO/_TAGS_SUGERIDAS_PADRAO), nunca
         derruba a rota.
      2. Caso contrário, devolve o conteúdo do arquivo (com os mesmos
         padrões como fallback campo a campo, se o JSON só tiver 1 dos
         2). """
    if not ANOMALIAS_CONFIG_PATH.exists():
        return {"aging_thresholds_dias": _AGING_THRESHOLDS_PADRAO, "tags_sugeridas": _TAGS_SUGERIDAS_PADRAO}
    try:
        with open(ANOMALIAS_CONFIG_PATH, "r", encoding="utf-8") as f:
            config = json.load(f)
    except (json.JSONDecodeError, OSError):
        return {"aging_thresholds_dias": _AGING_THRESHOLDS_PADRAO, "tags_sugeridas": _TAGS_SUGERIDAS_PADRAO}
    return {
        "aging_thresholds_dias": config.get("aging_thresholds_dias", _AGING_THRESHOLDS_PADRAO),
        "tags_sugeridas": config.get("tags_sugeridas", _TAGS_SUGERIDAS_PADRAO),
    }


def _encontrar_anomalia(anomalias, anomalia_id):
    """Contexto: acha o dict de uma anomalia pelo "id" numa lista já
    carregada — usada por todas as rotas de escrita antes de mexer no
    registro. Retorna o dict ou None se não achar.

    Pseudocódigo:
      1. Percorre a lista comparando "id"; devolve o primeiro que bater. """
    for anomalia in anomalias:
        if anomalia.get("id") == anomalia_id:
            return anomalia
    return None


def _registrar_mudanca_no_historico(anomalia, campo, valor_antigo, valor_novo, quando):
    """Contexto:
    Acrescenta 1 entrada à trilha de auditoria (`historico[]`) de uma
    anomalia — melhoria 4 (Onda 2): hoje um arrastar-e-soltar entre
    colunas muda a criticidade em meio segundo sem deixar rastro; isso
    passa a ficar registrado no servidor. Chamada só por
    atualizar_anomalia(), só para os campos em CAMPOS_COM_HISTORICO
    (criticidade/status) e só quando o valor realmente mudou. Exibida
    como timeline simples no front-end (modal de "Atualizações", ver
    static/js/anomalias/modais.js::renderizarTimeline). Não retorna nada.

    Pseudocódigo:
      1. Anexa {"quando", "campo", "de", "para"} à lista `historico`
         (cria a lista vazia se a anomalia ainda não tiver nenhuma). """
    anomalia.setdefault("historico", []).append({
        "quando": quando, "campo": campo, "de": valor_antigo, "para": valor_novo,
    })


def _filtrar_anomalias(anomalias, filtros):
    """Contexto:
    Aplica os filtros da querystring de GET /api/anomalias (cliente/
    criticidade/responsavel/status/tag/busca por texto) — mesma lógica de
    _filtrar_demandas() em controle_demandas.py. Chamada por
    listar_anomalias(). Retorna nova lista (não modifica `anomalias`).

    Pseudocódigo:
      1. Sem filtro algum -> devolve a lista como veio.
      2. Cliente/criticidade/status: igualdade exata quando informado.
      3. Responsável: substring (case-insensitive).
      4. Tag: igualdade exata contra qualquer item de `tags[]` (melhoria
         5 — filtro por tag, Onda 2).
      5. Busca: substring (case-insensitive) no título, na descrição ou
         no responsável. """
    cliente = filtros.get("cliente", "").strip()
    criticidade = filtros.get("criticidade", "").strip()
    responsavel = filtros.get("responsavel", "").strip().lower()
    status = filtros.get("status", "").strip()
    tag = filtros.get("tag", "").strip()
    busca = filtros.get("search", "").strip().lower()

    resultado = list(anomalias)
    if cliente:
        resultado = [a for a in resultado if a.get("cliente") == cliente]
    if criticidade:
        resultado = [a for a in resultado if a.get("criticidade") == criticidade]
    if responsavel:
        resultado = [a for a in resultado if responsavel in a.get("responsavel", "").lower()]
    if status:
        resultado = [a for a in resultado if a.get("status") == status]
    if tag:
        resultado = [a for a in resultado if tag in (a.get("tags") or [])]
    if busca:
        resultado = [
            a for a in resultado
            if busca in a.get("titulo", "").lower()
            or busca in a.get("descricao", "").lower()
            or busca in a.get("responsavel", "").lower()
        ]
    return resultado


def _ordenar_anomalias(anomalias):
    """Contexto: ordem de exibição padrão do quadro — criticidade (Crítico
    primeiro) > status (Pendente primeiro) > cliente alfabético. Chamada
    por listar_anomalias(). Retorna nova lista ordenada.

    Pseudocódigo:
      1. Ordena por (posição da criticidade em CRITICIDADES, posição do
         status em STATUS_OPTS, nome do cliente) — valores fora do enum
         vão para o fim (índice 9). """
    return sorted(anomalias, key=lambda a: (
        _CRIT_ORDER.get(a.get("criticidade", ""), 9),
        _STATUS_ORDER.get(a.get("status", ""), 9),
        a.get("cliente", ""),
    ))


def _validar_valor_do_enum(valor, valores_validos, nome_campo):
    """Contexto:
    Validação de domínio genérica para os campos-enum da anomalia
    (criticidade/status) — usada por POST/PATCH /api/anomalias. Retorna
    None se válido (ou campo vazio/ausente, quando o chamador não exige
    obrigatoriedade), ou uma mensagem de erro (string) se inválido.

    Pseudocódigo:
      1. Vazio/ausente -> None (quem exige valor obrigatório valida isso
         à parte).
      2. Fora da lista de valores válidos -> mensagem de erro citando as
         opções aceitas.
      3. Caso contrário -> None. """
    if not valor:
        return None
    if valor not in valores_validos:
        return f"{nome_campo} inválido: '{valor}' (esperado um de {valores_validos})"
    return None


def _validar_payload_anomalia(dados):
    """Contexto:
    Valida o corpo de POST/PATCH /api/anomalias antes de gravar — acumula
    todos os erros de domínio (criticidade/status fora do enum, tags com
    formato errado) em vez de parar no primeiro. Chamada por
    criar_anomalia()/atualizar_anomalia(). Retorna lista de strings
    (vazia se não houver erro).

    Pseudocódigo:
      1. Valida "criticidade" contra CRITICIDADES, "status" contra
         STATUS_OPTS (só se o campo veio no payload).
      2. Valida "tags" (Onda 2, melhoria 5): se veio no payload, precisa
         ser uma lista — cada item vira texto livre, sem enum.
      3. Devolve a lista de mensagens de erro acumuladas. """
    erros = []
    if "criticidade" in dados:
        erro = _validar_valor_do_enum(dados.get("criticidade"), CRITICIDADES, "criticidade")
        if erro:
            erros.append(erro)
    if "status" in dados:
        erro = _validar_valor_do_enum(dados.get("status"), STATUS_OPTS, "status")
        if erro:
            erros.append(erro)
    if "tags" in dados and not isinstance(dados.get("tags"), list):
        erros.append("tags deve ser uma lista de textos")
    return erros


# ─────────────────────────────────────────────────────────────────────────
# 3. ROTAS — finas, só orquestram (chamam os helpers acima)
# ─────────────────────────────────────────────────────────────────────────

@bp.route("/api/anomalias/opcoes", methods=["GET"])
def opcoes_anomalias():
    """Contexto:
    Devolve todo o vocabulário dinâmico do formulário/filtros do board
    (clientes/responsáveis vindos de data/demandas_config.json + os enums
    fixos deste arquivo + o mapa criticidade->prioridade sugerido para o
    mini formulário de "criar demanda e vincular" + os limiares de aging
    e as tags sugeridas de data/anomalias_config.json, Onda 2) —
    consumida 1x no boot da aba pelo front-end
    (static/js/anomalias/index.js), já que a tela é servida sem Jinja.
    Retorna JSON.

    Pseudocódigo:
      1. Lê clientes/responsáveis de demandas_config.json.
      2. Lê limiares de aging + tags sugeridas de anomalias_config.json.
      3. Junta com criticidades/status (constantes deste módulo) + o mapa
         de prioridade sugerida e devolve tudo num único payload. """
    opcoes = _carregar_opcoes_config()
    config_anomalias = _carregar_config_anomalias()
    return jsonify({
        "clientes": opcoes["clientes"],
        "responsaveis": opcoes["responsaveis"],
        "criticidades": CRITICIDADES,
        "status": STATUS_OPTS,
        "criticidade_para_prioridade": CRITICIDADE_PARA_PRIORIDADE,
        "aging_thresholds": config_anomalias["aging_thresholds_dias"],
        "tags_sugeridas": config_anomalias["tags_sugeridas"],
    })


@bp.route("/api/anomalias", methods=["GET"])
def listar_anomalias():
    """Contexto:
    Lista as anomalias do board para o front-end montar o Kanban — aplica
    os filtros da querystring (busca/cliente/criticidade/responsável/
    status) e devolve já na ordem padrão de exibição. Chamada pelo boot
    da aba e a cada mudança de filtro. Retorna JSON (lista).

    Pseudocódigo:
      1. Carrega todas as anomalias do disco.
      2. Filtra pelos parâmetros da querystring.
      3. Ordena (criticidade > status > cliente) e devolve. """
    anomalias = _carregar_anomalias()
    anomalias = _filtrar_anomalias(anomalias, request.args)
    anomalias = _ordenar_anomalias(anomalias)
    return jsonify(anomalias)


@bp.route("/api/anomalias", methods=["POST"])
def criar_anomalia():
    """Contexto:
    Cria uma anomalia nova — chamada pelo modal "Nova Anomalia" (ver
    static/js/anomalias/modais.js). Retorna {"id": "..."} (201) ou
    {"error": ...} (400) se cliente/título/criticidade faltarem ou algum
    enum vier inválido.

    Pseudocódigo:
      1. Lê o body JSON; valida "cliente"/"titulo"/"criticidade"
         obrigatórios e "status" opcional (se vier preenchido).
      2. Monta o documento (novo "id" uuid4, created_at/updated_at =
         agora, comments=[], demandas_vinculadas=[], historico=[]) +
         campos da Onda 2: "ocorrido_em" (usa o valor enviado ou, se
         vazio, a data de hoje — "data real do problema", melhoria 8),
         "impacto" (texto curto) e "tags" (lista, filtra itens vazios/
         não-string).
      3. Sob _anomalias_lock: carrega, anexa, salva.
      4. Devolve o id do registro criado. """
    dados = request.get_json(force=True, silent=True) or {}

    erros = []
    if not (dados.get("cliente") or "").strip():
        erros.append("cliente é obrigatório")
    if not (dados.get("titulo") or "").strip():
        erros.append("titulo é obrigatório")
    if not (dados.get("criticidade") or "").strip():
        erros.append("criticidade é obrigatória")
    erros.extend(_validar_payload_anomalia(dados))
    if erros:
        return jsonify({"error": "; ".join(erros)}), 400

    agora = _agora_iso()
    tags_recebidas = dados.get("tags") or []
    documento = {
        "id": str(uuid.uuid4()),
        "cliente": dados.get("cliente", ""),
        "titulo": dados.get("titulo", ""),
        "descricao": dados.get("descricao", ""),
        "criticidade": dados.get("criticidade", ""),
        "acao_curto_prazo": dados.get("acao_curto_prazo", ""),
        "acao_longo_prazo": dados.get("acao_longo_prazo", ""),
        "responsavel": dados.get("responsavel", ""),
        "status": dados.get("status") or "Pendente",
        "ocorrido_em": (dados.get("ocorrido_em") or "").strip() or datetime.now().strftime("%Y-%m-%d"),
        "impacto": dados.get("impacto", ""),
        "tags": [t.strip() for t in tags_recebidas if isinstance(t, str) and t.strip()],
        "created_at": agora,
        "updated_at": agora,
        "comments": [],
        "demandas_vinculadas": [],
        "historico": [],
    }
    with _anomalias_lock:
        anomalias = _carregar_anomalias()
        anomalias.append(documento)
        _salvar_anomalias(anomalias)
    return jsonify({"id": documento["id"]}), 201


@bp.route("/api/anomalias/<anomalia_id>", methods=["PATCH"])
def atualizar_anomalia(anomalia_id):
    """Contexto:
    Atualiza campos de uma anomalia existente — usada pela edição via
    modal e pelo arrastar-e-soltar entre colunas de criticidade (PATCH só
    de "criticidade", ver static/js/anomalias/quadro.js). Retorna
    {"ok": true} (200), {"error": ...} (400, enum inválido) ou 404 se o
    id não existir.

    Pseudocódigo:
      1. Lê o body JSON; valida os enums (só os campos presentes no
         payload).
      2. Sob _anomalias_lock: carrega, acha a anomalia pelo "id" (404 se
         não achar); para cada campo permitido presente no payload, se
         for "criticidade"/"status" (CAMPOS_COM_HISTORICO) E o valor
         realmente mudou, registra a mudança em `historico[]` (melhoria
         4, Onda 2 — cobre inclusive o PATCH de arrastar-e-soltar entre
         colunas) antes de aplicar; aplica o valor; atualiza
         "updated_at"; salva. """
    dados = request.get_json(force=True, silent=True) or {}
    erros = _validar_payload_anomalia(dados)
    if erros:
        return jsonify({"error": "; ".join(erros)}), 400

    campos_permitidos = {
        "cliente", "titulo", "descricao", "criticidade",
        "acao_curto_prazo", "acao_longo_prazo", "responsavel", "status",
        "ocorrido_em", "impacto", "tags",
    }
    with _anomalias_lock:
        anomalias = _carregar_anomalias()
        anomalia = _encontrar_anomalia(anomalias, anomalia_id)
        if anomalia is None:
            return jsonify({"error": "anomalia não encontrada"}), 404
        agora = _agora_iso()
        for campo, valor in dados.items():
            if campo not in campos_permitidos:
                continue
            if campo in CAMPOS_COM_HISTORICO and anomalia.get(campo) != valor:
                _registrar_mudanca_no_historico(anomalia, campo, anomalia.get(campo), valor, agora)
            anomalia[campo] = valor
        anomalia["updated_at"] = agora
        _salvar_anomalias(anomalias)
    return jsonify({"ok": True})


@bp.route("/api/anomalias/<anomalia_id>", methods=["DELETE"])
def remover_anomalia(anomalia_id):
    """Contexto: remove uma anomalia — modal de confirmação "Remover
    anomalia?" do front-end. Retorna {"ok": true} sempre (idempotente: id
    inexistente não é erro, só não remove nada). NÃO mexe em nenhuma
    demanda vinculada (o vínculo era só uma referência por id dentro
    desta anomalia — apagá-la não apaga a demanda).

    Pseudocódigo:
      1. Sob _anomalias_lock: carrega, filtra fora o "id" pedido, salva. """
    with _anomalias_lock:
        anomalias = _carregar_anomalias()
        anomalias = [a for a in anomalias if a.get("id") != anomalia_id]
        _salvar_anomalias(anomalias)
    return jsonify({"ok": True})


@bp.route("/api/anomalias/<anomalia_id>/comments", methods=["POST"])
def adicionar_comentario(anomalia_id):
    """Contexto: acrescenta 1 comentário/atualização a uma anomalia —
    modal "Atualizações" do front-end. Retorna {"ok": true} ou 404 se o
    id não existir.

    Pseudocódigo:
      1. Lê "text" do body (vazio é permitido — o front-end já bloqueia
         texto vazio antes de chamar).
      2. Sob _anomalias_lock: carrega, acha a anomalia (404 se não achar),
         anexa o comentário (texto + timestamp local) à lista de
         comentários, atualiza "updated_at", salva. """
    dados = request.get_json(force=True, silent=True) or {}
    comentario = {"text": dados.get("text", ""), "created_at": _agora_iso()}

    with _anomalias_lock:
        anomalias = _carregar_anomalias()
        anomalia = _encontrar_anomalia(anomalias, anomalia_id)
        if anomalia is None:
            return jsonify({"error": "anomalia não encontrada"}), 404
        anomalia.setdefault("comments", []).append(comentario)
        anomalia["updated_at"] = _agora_iso()
        _salvar_anomalias(anomalias)
    return jsonify({"ok": True})


@bp.route("/api/anomalias/<anomalia_id>/vincular-demanda", methods=["POST"])
def vincular_demanda(anomalia_id):
    """Contexto:
    Grava uma referência a uma demanda (já existente OU recém-criada por
    POST /api/demandas, ver static/js/anomalias/vinculos.js) dentro de
    `demandas_vinculadas` da anomalia — a funcionalidade nova pedida pelo
    usuário ("podendo indexar demandas como solução"). NÃO cria/edita
    nada em controle_demandas.json — isso é sempre feito antes, pelas
    rotas homologadas do blueprint de Demandas; aqui só se grava o
    "demanda_id" de referência. Retorna {"ok": true} (200), {"error":...}
    (400) ou 404 se a anomalia não existir.

    Pseudocódigo:
      1. Lê "demanda_id"/"horizonte"/"resumo" do body; valida
         "demanda_id" obrigatório e "horizonte" em HORIZONTES.
      2. Sob _anomalias_lock: carrega, acha a anomalia (404 se não
         achar), anexa o vínculo (com timestamp), atualiza "updated_at",
         salva. """
    dados = request.get_json(force=True, silent=True) or {}
    demanda_id = (dados.get("demanda_id") or "").strip()
    horizonte = (dados.get("horizonte") or "").strip()
    resumo = (dados.get("resumo") or "").strip()

    if not demanda_id:
        return jsonify({"error": "demanda_id é obrigatório"}), 400
    if horizonte not in HORIZONTES:
        return jsonify({"error": f"horizonte inválido: '{horizonte}' (esperado um de {HORIZONTES})"}), 400

    with _anomalias_lock:
        anomalias = _carregar_anomalias()
        anomalia = _encontrar_anomalia(anomalias, anomalia_id)
        if anomalia is None:
            return jsonify({"error": "anomalia não encontrada"}), 404
        anomalia.setdefault("demandas_vinculadas", []).append({
            "demanda_id": demanda_id,
            "horizonte": horizonte,
            "resumo": resumo,
            "created_at": _agora_iso(),
        })
        anomalia["updated_at"] = _agora_iso()
        _salvar_anomalias(anomalias)
    return jsonify({"ok": True})


@bp.route("/api/anomalias/<anomalia_id>/vincular-demanda/<demanda_id>", methods=["DELETE"])
def desvincular_demanda(anomalia_id, demanda_id):
    """Contexto:
    Remove um vínculo de demanda de uma anomalia (corrige vínculo errado
    feito por engano) — NÃO apaga a demanda em si, só a referência dentro
    da anomalia. Complemento natural de vincular_demanda(), não pedido
    explicitamente no requisito mas necessário para corrigir erros de
    operação sem precisar excluir a anomalia inteira. Aceita
    "?horizonte=curto_prazo|longo_prazo" opcional na querystring pra
    desambiguar caso a mesma demanda esteja vinculada nos dois horizontes
    (caso raro, mas o schema permite). Retorna {"ok": true} sempre
    (idempotente) ou 404 se a anomalia não existir.

    Pseudocódigo:
      1. Sob _anomalias_lock: carrega, acha a anomalia (404 se não
         achar), remove da lista os vínculos que batem com o
         "demanda_id" (e com o "horizonte", se informado), atualiza
         "updated_at", salva. """
    horizonte = request.args.get("horizonte", "").strip()
    with _anomalias_lock:
        anomalias = _carregar_anomalias()
        anomalia = _encontrar_anomalia(anomalias, anomalia_id)
        if anomalia is None:
            return jsonify({"error": "anomalia não encontrada"}), 404
        vinculadas = anomalia.get("demandas_vinculadas", [])
        anomalia["demandas_vinculadas"] = [
            v for v in vinculadas
            if not (v.get("demanda_id") == demanda_id and (not horizonte or v.get("horizonte") == horizonte))
        ]
        anomalia["updated_at"] = _agora_iso()
        _salvar_anomalias(anomalias)
    return jsonify({"ok": True})
