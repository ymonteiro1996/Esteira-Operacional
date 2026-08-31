# -*- coding: utf-8 -*-
"""
app.py — Controle de Cargas, servidor Flask (Fase 1 do "app real")
==========================================================================
Este arquivo NÃO é a arquitetura completa de blueprints descrita no
PLANNING.md (pages/*.py) — aquela é a Fase 0/1 "esqueleto", ainda não
construída. [2026-08-05] O protótipo AGORA USA `beehus_api/` (cliente HTTP
copiado dos apps-irmãos `SWAT\\beehus-swat`/`SWAT\\conciliacao`) — a
decisão de independência do CLAUDE.md passou a valer só pra
`beehus_catalog.py` (helpers genéricos demais pra este protótipo; ver db.py
e o CLAUDE.md atualizado). O que ESTE arquivo faz:

  1) Serve `index.html` na raiz "/" e os estáticos versionados em
     `static/css/` e `static/js/` (Flask static handler nativo).
  2) Serve um allowlist de arquivos avulsos na raiz do protótipo (hoje só
     `snapshot.json`) — nunca um diretório inteiro, pra não expor
     `data/alert_comments.json` nem o código-fonte por acidente.
  3) `GET /api/comments` / `POST /api/comments` — comentários de alerta
     (persistidos em data/alert_comments.json, nunca no Mongo).
  3b) [2026-07-24, pedido do usuário] `GET /api/annotations` / `POST
     /api/annotations` — colunas "Responsável"/"Comentário sobre atuação" da
     grade (persistidas em data/wallet_annotations.json, nunca no Mongo),
     chaveadas por (targetType, targetId, referenceDate) — mesmo par
     targetType/targetId de /api/comments (vale pra Carteiras E
     Agrupamentos, paridade de colunas entre as duas abas), SÓ a data de
     referência do grid, não por dia da janela. Mesmo padrão de
     /api/comments (arquivo JSON local, lido a cada request), mas upsert em
     vez de lista append-only: o botão "Salvar" da tela manda um lote de
     linhas editadas de uma vez (POST com array), cada uma sobrescreve o
     registro anterior daquela chave.
  4) `GET /api/atualizar` — Tarefa 3 do refactor 2026-07-20: recalcula o
     snapshot para um intervalo de datas pedido pelo usuário (botão
     "Atualizar" da tela), reaproveitando o cache por data de db.py/cache.py
     em vez de repetir consultas à API Beehus. [2026-08-05, pedido do
     usuário: "pode travar para 5DU"] O intervalo pedido é travado em
     JANELA_MAXIMA_DIAS_UTEIS (5 du) — cada dia novo custa 1 chamada à API
     POR EMPRESA (get_processed_position/get_nav_results/
     get_preprocessing_status, ver db.py), então um intervalo customizado
     sem teto poderia disparar centenas de chamadas de uma vez.
  5) `GET /api/janela-padrao` — [2026-07-23] devolve De/Até default (D-3 do
     hoje REAL do servidor + 5du antes) sem tocar o Mongo; usada pra sugerir
     os campos de data no 1º acesso sem depender da meta.referenceDate
     congelada do snapshot.json (arquivo pré-gerado, ver build_snapshot.py).
  5b) [2026-08-06, pedido do usuário: "coloque a data inicial como fixa,
     onde ao mudar a data final ela mude também"] `GET
     /api/data-inicial-padrao` — devolve data_inicial = data_final −
     JANELA_MAXIMA_DIAS_UTEIS du; o campo "De" da tela ficou readonly e se
     recalcula sozinho a cada troca do campo "até" (atualizar.js), pra
     nunca mais deixar o usuário montar pela UI uma janela maior que o teto
     de /api/atualizar (o que antes só dava erro DEPOIS do clique em
     Atualizar).
  6) [2026-07-23, pedido do usuário] No boot (`if __name__ == "__main__"`),
     regera `snapshot.json` do zero (`atualizar_snapshot_no_boot()`) antes de
     `app.run()` — sempre lê o `TemplateCarteiras.xlsx` mais recente, em vez
     de servir um arquivo estático potencialmente desatualizado até alguém
     rodar `build_snapshot.py` à parte ou clicar "Atualizar" na tela.
  7) [2026-08-05, pedido do usuário: "consegue efetuar todas consultas por
     Endpoints" + "pode efetuar o processo de transição"] `GET/POST/DELETE
     /api/beehus-token` — gerencia o token Bearer da API Beehus (válido por
     1 dia, colado na tela pelo botão "🔑 Beehus API"; ver beehus_api/client.py
     e static/js/controle_cargas/beehus_token.js). ESTE é o requisito de
     conexão do app — sem token válido, nada carrega. [2026-08-05, pedido do
     usuário: "pode remover toda consulta do mongo"] O acesso direto ao
     Mongo (incluindo a rota /api/conexao-mongo e seu modo avançado/
     fallback) foi removido por completo — não há mais nenhum caminho
     alternativo de conexão a banco neste app.
  8) [2026-08-06, pedido do usuário: "tem que poder mais de uma pessoa abrir
     ao mesmo tempo"] SUPORTE A MÚLTIPLOS USUÁRIOS SIMULTÂNEOS. Antes disto o
     app era single-user por design: `app.run()` sem `threaded=True` atendia
     1 requisição por vez (uma pessoa travava a tela da outra em qualquer
     chamada longa, ex. boot/`/api/atualizar`), e o token da API Beehus vivia
     num único dict global do processo (a 2ª pessoa que colasse o token dela
     sobrescrevia silenciosamente a sessão da 1ª). Agora: (a) `app.run(...,
     threaded=True)` — requisições concorrentes são atendidas em paralelo;
     (b) cada navegador ganha um sid opaco (cookie de sessão assinado por
     `app.secret_key`, ver `_amarrar_sessao_beehus()` abaixo) e o token vive
     POR SID (`beehus_api.client._sessions`), nunca mais 1 global — ver
     docstring completa de `beehus_api/client.py`. `app.secret_key` é
     persistido em `~/.swat/flask_secret.key` (mesmo padrão do token) pra o
     cookie de sessão sobreviver a um restart do servidor.

Refatoração 2026-07-20 (CLAUDE.md): arquivo dividido em 3 seções numeradas
(imports/config → helpers → rotas); rotas ficam finas, só orquestram.
"""

# ─────────────────────────────────────────────────────────────────────────
# 1. IMPORTS E CONFIGURAÇÃO
# ─────────────────────────────────────────────────────────────────────────

import os
import json
import secrets
import threading
import uuid
import datetime as dt
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory, session

from beehus_api import BeehusAPIError, BeehusAuthError, bind_session_id, clear_token, set_token, token_status, verify_token
from build_snapshot import montar_snapshot, escrever_snapshot_json
from pages.controle_demandas import bp as controle_demandas_bp
from pages.anomalias import bp as anomalias_bp
from snapshot_builder import LIMIAR_DIVERGENCIA_PADRAO, LIMIAR_DIVERGENCIA_REAIS_PADRAO
from utils.datas import CalendarioDiasUteis, GRID_REFERENCE_LAG_DU, JANELA_INICIAL_DIAS_UTEIS, calcular_janela_grid
from utils.caminhos import resolver_data_dir

HERE = Path(__file__).resolve().parent
# [2026-08-25, decisão do usuário: "consumirmos de um diretório" separado do código
# rastreado pelo Git] DATA_DIR aceita override via variável de ambiente
# CONTROLECARGAS_DATA_DIR — se não configurada, cai no comportamento de sempre
# (pasta "data/" ao lado do código). Isso permite apontar pra uma pasta FORA do
# clone do Git (ex.: a mesma pasta OneDrive de antes, num caminho irmão do
# repositório), sem quebrar quem ainda não configurou nada.
# [REVISADO 2026-08-28, achado do usuário: "temos que funcionar com os caminhos
# dinâmicos para o onedrive" — sem a variável configurada manualmente em cada
# máquina, caía direto pro `data/` local vazio] Resolução movida pra
# utils.caminhos.resolver_data_dir() (mesma função usada por build_snapshot.py
# pro TemplateCarteiras.xlsx — as duas fontes de dado do app agora seguem a
# MESMA regra de pasta, eliminando a divergência que existia antes entre
# app.py e build_snapshot.py): além do override por variável de ambiente,
# tenta o caminho dinâmico do OneDrive corporativo (Path.home()) antes de
# cair no `data/` local.
DATA_DIR = Path(resolver_data_dir(HERE))
COMMENTS_PATH = DATA_DIR / "alert_comments.json"
ANNOTATIONS_PATH = DATA_DIR / "wallet_annotations.json"
CONFLITOS_DIR = DATA_DIR / "_conflitos_resolvidos"

# [2026-08-13, "diversos arquivos criados, será sincronização? corrija como
# as coisas são salvas e consumidas, mantendo os acessos do jeito que está"]
# CADA usuário continua rodando app.py na própria máquina (nada mudou no
# acesso), com data/ dentro do OneDrive corporativo sincronizado. Dois
# problemas foram endereçados na camada de persistência, SEM tocar em como o
# app é acessado:
#   1) Duas requisições no MESMO processo (2 abas do navegador, duplo-clique
#      em Salvar, threaded=True) podiam disputar o mesmo arquivo JSON — um
#      RLock por arquivo agora serializa todo o ciclo ler->modificar->salvar
#      (ver post_comments()/post_annotations()). RLock (reentrante) porque
#      as funções de mesclagem de conflito abaixo também usam o mesmo lock
#      e podem ser chamadas de dentro de quem já o segura.
#   2) O OneDrive, ao ver o MESMO arquivo editado quase ao mesmo tempo por
#      duas máquinas diferentes, cria uma cópia renomeada
#      "<nome>-<PC>[-N].json" em vez de sobrescrever (mesmo padrão já visto
#      nos logs ".controlecargas-server-<hostname>.err" deste projeto) — daí
#      os "diversos arquivos criados". Sem tratamento, o comentário/anotação
#      que ficou na cópia renomeada nunca mais aparece pra ninguém (perda
#      silenciosa). _mesclar_copias_conflito_*() (chamadas a cada leitura,
#      abaixo) acham essas cópias, incorporam o conteúdo delas no arquivo
#      canônico e arquivam a cópia em data/_conflitos_resolvidos/ (nunca
#      apagam o arquivo original do OneDrive) — o app se autocura sozinho a
#      cada carregamento de tela, sem precisar de nenhuma ação manual.
# Limite assumido: isso NÃO é um lock distribuído entre máquinas — só reduz
# o risco e recupera o que o OneDrive já separou; duas pessoas salvando no
# MESMO instante exato (antes de qualquer sincronização) ainda podem gerar
# uma cópia de conflito nova, só que agora ela é auto-mesclada no próximo
# load em vez de ficar esquecida pra sempre.
_comments_lock = threading.RLock()
_annotations_lock = threading.RLock()


def _escrever_json_atomico(caminho, payload):
    """Contexto:
    Grava `payload` em `caminho` sem deixar um JSON truncado/corrompido no
    disco se o processo for morto no meio da escrita (ex.: start.ps1 mata a
    instância anterior com Stop-Process -Force ao reiniciar o servidor).
    Chamada por _save_comments()/_save_annotations(). Não retorna nada.

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


def _achar_copias_conflito(caminho_canonico):
    """Contexto:
    Lista cópias de conflito que o OneDrive cria quando duas máquinas
    diferentes editam o mesmo arquivo quase ao mesmo tempo — o nome vira
    "<nome>-<PC>.ext" (às vezes com um contador "-2", "-3" no fim), o MESMO
    padrão já visto nos logs ".controlecargas-server-<hostname>.err" deste
    protótipo. Chamada por _load_comments()/_load_annotations() a cada
    leitura, antes de devolver o conteúdo canônico. Retorna lista de Path
    (vazia se não houver nenhuma cópia).

    Pseudocódigo:
      1. Monta o padrão "<stem>-*<sufixo>" na mesma pasta do arquivo
         canônico (ex.: "alert_comments-*.json").
      2. Devolve os arquivos que batem, ignorando temporários (".tmp").
    """
    padrao = f"{caminho_canonico.stem}-*{caminho_canonico.suffix}"
    return sorted(
        p for p in caminho_canonico.parent.glob(padrao)
        if p.is_file() and not p.name.endswith(".tmp")
    )


def _arquivar_copia_conflito(copia):
    """Contexto:
    Move uma cópia de conflito do OneDrive (já incorporada por
    _mesclar_copias_conflito_comments/_annotations) para
    data/_conflitos_resolvidos/, em vez de apagá-la — mantém o arquivo
    original disponível pra conferência manual caso a mesclagem automática
    tenha errado algo. Chamada por _mesclar_copias_conflito_*(). Não
    retorna nada.

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


def _mesclar_copias_conflito_comments(comments):
    """Contexto:
    Procura cópias de conflito do OneDrive de alert_comments.json (ver
    _achar_copias_conflito) e incorpora nelas qualquer comentário cujo "id"
    ainda não esteja em `comments` — comentário é sempre um registro novo e
    independente (nunca edita um id existente), então a mesclagem é uma
    união simples por id, sem risco de perder edição de ninguém. Chamada
    por _load_comments() a cada leitura (custo baixo: poucos arquivos na
    pasta data/). Retorna a lista final (== `comments`, sem mudança, se não
    havia nenhuma cópia pra mesclar).

    Pseudocódigo:
      1. Acha cópias de conflito; sem nenhuma, devolve `comments` como veio.
      2. Pra cada cópia: lê o JSON (ignora e avisa no console se vier
         corrompido); soma ao resultado os comentários cujo "id" ainda não
         apareceu.
      3. Arquiva a cópia processada (mesmo se ilegível) — nunca fica
         reprocessando o mesmo arquivo pra sempre.
      4. Se algo novo entrou, regrava alert_comments.json (sob
         _comments_lock, reentrante) e avisa no console.
    """
    copias = _achar_copias_conflito(COMMENTS_PATH)
    if not copias:
        return comments

    ids_conhecidos = {c.get("id") for c in comments}
    mesclados = list(comments)
    houve_novidade = False

    for copia in copias:
        try:
            with open(copia, "r", encoding="utf-8") as f:
                payload = json.load(f)
            for comentario in payload.get("comments", []):
                if comentario.get("id") not in ids_conhecidos:
                    mesclados.append(comentario)
                    ids_conhecidos.add(comentario.get("id"))
                    houve_novidade = True
        except (json.JSONDecodeError, OSError) as exc:
            print(f"AVISO: cópia de conflito ilegível ignorada em alert_comments ({copia.name}): {exc}")
        _arquivar_copia_conflito(copia)

    if houve_novidade:
        with _comments_lock:
            _save_comments(mesclados)
        print(f"[ControleCargas] {len(copias)} cópia(s) de conflito do OneDrive mesclada(s) em alert_comments.json.")

    return mesclados


def _mesclar_copias_conflito_annotations(annotations):
    """Contexto:
    Mesmo problema de _mesclar_copias_conflito_comments(), mas pra
    wallet_annotations.json: como cada chave (targetType|targetId|
    referenceDate) pode ter sido editada nas duas máquinas em conflito, a
    mesclagem usa "updatedAt" (timestamp ISO já gravado em cada registro
    por post_annotations()) pra decidir qual versão vale quando a MESMA
    chave aparece nos dois lados — fica a mais recente. Chamada por
    _load_annotations() a cada leitura. Retorna o dict final (== `annotations`,
    sem mudança, se não havia nenhuma cópia pra mesclar).

    Pseudocódigo:
      1. Acha cópias de conflito; sem nenhuma, devolve `annotations` como
         veio.
      2. Pra cada cópia: lê o JSON (ignora e avisa no console se vier
         corrompido); pra cada chave, se ainda não existir OU se o
         "updatedAt" da cópia for mais recente que o já conhecido,
         substitui.
      3. Arquiva a cópia processada (mesmo se ilegível).
      4. Se algo mudou, regrava wallet_annotations.json (sob
         _annotations_lock, reentrante) e avisa no console.
    """
    copias = _achar_copias_conflito(ANNOTATIONS_PATH)
    if not copias:
        return annotations

    mesclado = dict(annotations)
    houve_novidade = False

    for copia in copias:
        try:
            with open(copia, "r", encoding="utf-8") as f:
                payload = json.load(f)
            for chave, registro in payload.get("annotations", {}).items():
                atual = mesclado.get(chave)
                if atual is None or registro.get("updatedAt", "") > atual.get("updatedAt", ""):
                    mesclado[chave] = registro
                    houve_novidade = True
        except (json.JSONDecodeError, OSError) as exc:
            print(f"AVISO: cópia de conflito ilegível ignorada em wallet_annotations ({copia.name}): {exc}")
        _arquivar_copia_conflito(copia)

    if houve_novidade:
        with _annotations_lock:
            _save_annotations(mesclado)
        print(f"[ControleCargas] {len(copias)} cópia(s) de conflito do OneDrive mesclada(s) em wallet_annotations.json.")

    return mesclado

# arquivos que podem ser servidos por /<filename> além de "/" (index.html) e
# de /static/... (que o Flask já cobre nativamente) — allowlist explícita,
# nunca um `send_from_directory` genérico sobre HERE (vazaria build_snapshot.py,
# app.py, db.py ou data/alert_comments.json).
_ALLOWED_STATIC_FILES = {"snapshot.json"}


def _montar_snapshot_vazio():
    """Contexto:
    Placeholder de snapshot.json (MESMO schema de montar_snapshot()/
    build_snapshot.py, zero carteira/agrupamento) servido por static_files()
    quando o arquivo ainda não existe em disco — 1ª vez que alguém roda
    `python app.py` depois de um `git clone`/`git pull` novo, já que
    snapshot.json NUNCA é versionado (gerado localmente, ver .gitignore).

    [2026-08-31, achado do usuário: "aqui está rodando normal e no meu
    colega não"] Sem isso, fetch('snapshot.json') do front-end (index.js)
    recebia 404 puro e caía no `.catch()`, que só mostra um aviso e PARA —
    `ControleCargas.init()` (que liga `wire()`: filtros ▾, ordenação, busca,
    campos De/Até, botão "Salvar") nunca roda. O botão "Atualizar" continua
    funcionando (é ligado à parte, fora do init()) e redesenha a matriz com
    dado novo, mas os filtros/ordenação ficam mortos pra sempre — exatamente
    o sintoma relatado. `atualizar_snapshot_no_boot()` (abaixo) já tentava
    cobrir esse caso gerando o arquivo no boot, mas SEMPRE falha desde
    2026-08-06 (token da API Beehus é por sessão de navegador — o boot roda
    fora de qualquer requisição HTTP, então nunca tem token nenhum) e cai no
    fallback "segue com o snapshot.json existente", que numa máquina nova
    não existe. No colega o problema não aparecia só porque a máquina dele
    já tinha um snapshot.json local de um uso anterior.

    Esta função NÃO toca a API Beehus (calendário é aritmética pura — mesma
    base de /api/janela-padrao) nem grava nada em disco: o front-end recebe
    uma tela vazia mas 100% interativa (wire() roda normalmente), e o
    refresh automático já existente no fim de init()
    (preencherCamposDataAtualizar -> executarAtualizacao(), atualizar.js)
    puxa o dado real assim que a pessoa colar o token Beehus (o modal já
    abre sozinho — beehus_token.js). Retorna o dict do snapshot vazio.

    Pseudocódigo:
      1. Calendário ANBIMA + janela default (mesma fórmula do snapshot real,
         calcular_janela_grid — nenhuma chamada à API Beehus).
      2. Monta o dict com o MESMO formato de montar_snapshot(), zerando
         wallets/groupings/custodianUpload e os agregados derivados deles. """
    calendario = CalendarioDiasUteis()
    hoje = _today_str()
    data_referencia, janela = calcular_janela_grid(calendario, hoje)
    return {
        "generatedAt": dt.datetime.now().isoformat(timespec="seconds"),
        "meta": {
            "today": hoje,
            "referenceDate": data_referencia,
            "gridReferenceLagDu": GRID_REFERENCE_LAG_DU,
            "window": janela,
            "calendarSource": calendario.fonte,
            "calendarFallback": calendario.fallback,
            "companies": [],
            "institutions": [],
            "totalWallets": 0,
            "orphanWallets": 0,
            "orphanNames": [],
            "groupingBlocoCounts": {},
            "queryTimings": {},
            "cacheInfo": {"datasNovasConsultadas": 0, "datasDoCache": 0},
            "limiarDivergenciaPct": LIMIAR_DIVERGENCIA_PADRAO,
            "limiarDivergenciaReais": LIMIAR_DIVERGENCIA_REAIS_PADRAO,
        },
        "wallets": [],
        "groupings": [],
        "custodianUpload": None,
    }

VALID_SEVERITIES = ("green", "yellow", "red")
VALID_TARGET_TYPES = ("wallet", "grouping")

# static_folder="static": Flask passa a servir /static/css/... e
# /static/js/... nativamente (CLAUDE.md §4 — CSS/JS quebrados em arquivos
# próprios, não mais inline no HTML). O catch-all abaixo (seção 3) só cobre
# arquivos SOLTOS na raiz do protótipo (allowlist), nunca a pasta static/.
app = Flask(__name__, static_folder=str(HERE / "static"), static_url_path="/static")
# [2026-07-28, pedido do usuário: baixou um Excel e a tela veio sem as
# mudanças recém-feitas em exportar.js/controle_cargas.css] Sem isso, o
# Flask deixa o navegador cachear /static/... por um tempo (Cache-Control
# heurístico do Werkzeug) — toda edição em JS/CSS feita durante o
# desenvolvimento só aparecia depois de um hard-refresh manual. Com
# max-age=0, o navegador sempre revalida (If-None-Match/If-Modified-Since)
# antes de usar o cache — arquivo mudou, vem o conteúdo novo; não mudou,
# volta 304 (ainda barato). App local, sem CDN — não há ganho de
# performance em cachear aqui, só risco de servir JS/CSS velho.
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0

# [2026-08-21, porte da aba "Controle de Demandas"] Registro do blueprint
# novo (pages/controle_demandas.py) — só expõe as rotas /api/demandas*; a
# tela em si é servida como mais uma aba da mesma SPA (index.html), não uma
# rota HTML própria. Nenhuma rota/função já existente neste arquivo foi
# alterada para isso.
app.register_blueprint(controle_demandas_bp)

# [2026-08-21, board manual "Anomalias", mesmo mecanismo aditivo da aba
# "Controle de Demandas" acima] Registro do blueprint novo
# (pages/anomalias.py) — só expõe as rotas /api/anomalias*; a tela em si
# é servida como mais uma aba da mesma SPA (index.html), não uma rota
# HTML própria. Nenhuma rota/função já existente neste arquivo foi
# alterada para isso.
app.register_blueprint(anomalias_bp)


def _carregar_ou_criar_secret_key():
    """Contexto:
    Lê `app.secret_key` (usada por Flask pra assinar o cookie de sessão) de
    `~/.swat/flask_secret.key`, criando um valor novo (aleatório, 32 bytes)
    na 1ª vez — mesmo padrão de persistência já usado pro token da API
    Beehus (ver beehus_api/client.py). Sem isso, uma chave gerada só em
    memória mudaria a cada restart do servidor e invalidaria o cookie de
    sessão (e o token por sessão que depende dele) de TODO MUNDO a cada
    reinício [2026-08-06, pedido do usuário: "mais de uma pessoa ao mesmo
    tempo"]. Retorna string (a chave).

    Pseudocódigo:
      1. Se o arquivo já existe e tem conteúdo, devolve ele.
      2. Senão, gera uma chave aleatória nova, grava e devolve. """
    caminho = Path.home() / ".swat" / "flask_secret.key"
    caminho.parent.mkdir(parents=True, exist_ok=True)
    if caminho.exists():
        chave_existente = caminho.read_text(encoding="utf-8").strip()
        if chave_existente:
            return chave_existente
    chave_nova = secrets.token_hex(32)
    caminho.write_text(chave_nova, encoding="utf-8")
    return chave_nova


app.secret_key = _carregar_ou_criar_secret_key()

_COOKIE_SESSAO_BEEHUS = "cc_sid"


@app.before_request
def _amarrar_sessao_beehus():
    """Contexto:
    Garante que toda requisição tenha um sid de sessão (cookie Flask,
    assinado por app.secret_key) e amarra esse sid à contextvar do módulo
    beehus_api (bind_session_id()) ANTES de qualquer rota rodar — é o que
    faz o token da API Beehus ser POR NAVEGADOR em vez de global ao
    processo [2026-08-06, pedido do usuário: "tem que poder mais de uma
    pessoa abrir ao mesmo tempo"]. Chamada automaticamente pelo Flask antes
    de toda rota (inclusive as estáticas — custo é 1 dict lookup, irrelevante
    frente ao resto da requisição). Não retorna nada.

    Pseudocódigo:
      1. Sem sid no cookie de sessão ainda -> gera um novo (uuid4) e marca a
         sessão como permanente (sobrevive ao navegador fechar, não só à
         aba — combinado com secret_key persistido, sobrevive a um restart
         do servidor também).
      2. Amarra o sid à contextvar (bind_session_id) — client.py e os 3
         pontos de fan-out (db.py/positions.py) leem daqui pra saber de quem
         é o token. """
    sid = session.get(_COOKIE_SESSAO_BEEHUS)
    if not sid:
        sid = uuid.uuid4().hex
        session[_COOKIE_SESSAO_BEEHUS] = sid
        session.permanent = True
    bind_session_id(sid)


# ─────────────────────────────────────────────────────────────────────────
# 2. HELPERS (persistência de comentários + validação da rota /api/atualizar)
# ─────────────────────────────────────────────────────────────────────────

def _ensure_data_dir():
    """Contexto: garante que prototype/data/ existe (1ª execução do app pode
    não ter a pasta ainda; o app não deve depender de build_snapshot.py ter
    rodado antes). Chamada por _load_comments/_save_comments antes de tocar
    em alert_comments.json. Não retorna nada.

    Pseudocódigo:
      1. Cria DATA_DIR (e pais, se faltarem); não faz nada se já existir.
    """
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def _load_comments():
    """Contexto:
    Lê alert_comments.json do disco A CADA CHAMADA — nunca cacheia em
    memória entre requests (mitigação de escrita concorrente: cada GET/POST
    enxerga o estado mais recente do arquivo). Nunca lança exceção — arquivo
    ausente/corrompido devolve lista vazia em vez de derrubar o servidor.
    [2026-08-13] antes de devolver, mescla qualquer cópia de conflito do
    OneDrive já esperando na pasta (ver _mesclar_copias_conflito_comments).

    Pseudocódigo:
      1. Garante a pasta data/.
      2. Se o arquivo não existe, parte de [].
      3. Senão, lê `comments`; qualquer erro de parsing volta pra [].
      4. Mescla cópias de conflito do OneDrive (se houver) e devolve.
    """
    _ensure_data_dir()
    if not COMMENTS_PATH.exists():
        comments = []
    else:
        try:
            with open(COMMENTS_PATH, "r", encoding="utf-8") as f:
                payload = json.load(f)
            comments = payload.get("comments", [])
        except (json.JSONDecodeError, OSError):
            comments = []
    return _mesclar_copias_conflito_comments(comments)


def _save_comments(comments):
    """Contexto: persiste a lista completa de comentários em
    alert_comments.json, chamada por post_comments() depois de anexar o
    comentário novo (reescreve o arquivo inteiro). [2026-08-13] a escrita em
    si é atômica (nunca deixa o arquivo pela metade se o processo morrer no
    meio) — mas quem chama isto precisa segurar `_comments_lock` durante TODO
    o ciclo ler→modificar→salvar (ver post_comments()), senão duas
    requisições concorrentes leem a mesma lista antiga e uma sobrescreve o
    comentário da outra. Não retorna nada.

    Pseudocódigo:
      1. Garante a pasta data/.
      2. Serializa {"comments": comments} atomicamente por cima do arquivo.
    """
    _ensure_data_dir()
    _escrever_json_atomico(COMMENTS_PATH, {"comments": comments})


def _chave_anotacao(target_type, target_id, reference_date):
    """Contexto: monta a chave composta (targetType, targetId, referenceDate)
    usada para indexar data/wallet_annotations.json — MESMO par
    targetType/targetId já usado por /api/comments (VALID_TARGET_TYPES),
    pra a anotação valer tanto pra Carteiras quanto pra Agrupamentos (mesma
    paridade de colunas entre as duas abas já usada no resto da grade, ver
    matriz.js buildCabecalhoMatriz/rowHtml). Chamada por post_annotations()
    (ao gravar). Retorna string.

    Pseudocódigo:
      1. Junta targetType + targetId + referenceDate com um separador que
         não aparece em nenhum dos três. """
    return f"{target_type}|{target_id}|{reference_date}"


def _load_annotations():
    """Contexto:
    Lê wallet_annotations.json do disco A CADA CHAMADA — mesmo padrão de
    _load_comments() (nunca cacheia em memória entre requests). Nunca lança
    exceção — arquivo ausente/corrompido devolve dict vazio em vez de
    derrubar o servidor. [2026-08-13] antes de devolver, mescla qualquer
    cópia de conflito do OneDrive já esperando na pasta (ver
    _mesclar_copias_conflito_annotations). Retorna dict {chave: {...}}.

    Pseudocódigo:
      1. Garante a pasta data/.
      2. Se o arquivo não existe, parte de {}.
      3. Senão, lê `annotations`; qualquer erro de parsing volta pra {}.
      4. Mescla cópias de conflito do OneDrive (se houver) e devolve.
    """
    _ensure_data_dir()
    if not ANNOTATIONS_PATH.exists():
        annotations = {}
    else:
        try:
            with open(ANNOTATIONS_PATH, "r", encoding="utf-8") as f:
                payload = json.load(f)
            annotations = payload.get("annotations", {})
        except (json.JSONDecodeError, OSError):
            annotations = {}
    return _mesclar_copias_conflito_annotations(annotations)


def _save_annotations(annotations):
    """Contexto: persiste o dict completo de anotações em
    wallet_annotations.json, chamada por post_annotations() depois do
    upsert do lote recebido (reescreve o arquivo inteiro). [2026-08-13] mesmo
    padrão de _save_comments(): escrita atômica aqui dentro, mas quem chama
    precisa segurar `_annotations_lock` durante todo o ciclo
    ler→modificar→salvar (ver post_annotations()). Não retorna nada.

    Pseudocódigo:
      1. Garante a pasta data/.
      2. Serializa {"annotations": annotations} atomicamente por cima do
         arquivo.
    """
    _ensure_data_dir()
    _escrever_json_atomico(ANNOTATIONS_PATH, {"annotations": annotations})


def _today_str():
    """Contexto: data de hoje como string "YYYY-MM-DD", usada por
    post_comments() como default de validFrom/validTo quando o body não
    informa vigência. Retorna string.

    Pseudocódigo:
      1. Pega a data local de hoje e formata em ISO.
    """
    return dt.date.today().isoformat()


def _validar_data_iso(valor, nome_campo):
    """Contexto: valida que `valor` é uma string "YYYY-MM-DD" bem formada —
    usado pela rota /api/atualizar antes de repassar a data pra API Beehus
    (nunca confiar em input de querystring sem validar). Retorna None se
    válido, ou uma mensagem de erro (string) se inválido.

    Pseudocódigo:
      1. Falta o parâmetro -> erro.
      2. `dt.date.fromisoformat` falha -> erro (formato inválido).
      3. Tudo certo -> None.
    """
    if not valor:
        return f"parâmetro '{nome_campo}' é obrigatório (formato YYYY-MM-DD)"
    try:
        dt.date.fromisoformat(valor)
    except ValueError:
        return f"parâmetro '{nome_campo}' inválido: '{valor}' (esperado YYYY-MM-DD)"
    return None


def _validar_numero_nao_negativo(valor, nome_campo):
    """Contexto: valida os 2 campos editáveis do filtro de divergência Rent
    Contrib × Rent NAV (limiar_divergencia_pct/limiar_divergencia_reais) —
    [2026-07-31, pedido do usuário: "campos para mudar o valor"]. Ao
    contrário de `_validar_data_iso`, um campo VAZIO é válido (usa o padrão
    de sempre — ver montar_snapshot()). Retorna None se válido, ou uma
    mensagem de erro (string) se inválido.

    Pseudocódigo:
      1. Vazio -> None (sem erro; o padrão entra em montar_snapshot()).
      2. `float()` falha, ou dá negativo -> erro.
      3. Tudo certo -> None. """
    if not valor:
        return None
    try:
        numero = float(valor)
    except ValueError:
        return f"parâmetro '{nome_campo}' inválido: '{valor}' (esperado número)"
    if numero < 0:
        return f"parâmetro '{nome_campo}' não pode ser negativo: '{valor}'"
    return None


# ─────────────────────────────────────────────────────────────────────────
# 3. ROTAS — finas, só orquestram (chamam os helpers acima / os módulos)
# ─────────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    """Contexto: rota raiz da tela — servida ao abrir http://localhost:5050/.
    Retorna o HTML principal do protótipo (o snapshot em si vem à parte, via
    fetch('snapshot.json')).

    Pseudocódigo:
      1. Serve index.html da raiz do protótipo.
    """
    return send_from_directory(HERE, "index.html")


@app.route("/<path:filename>")
def static_files(filename):
    """Contexto: catch-all para arquivos soltos na raiz do protótipo pedidos
    fora de "/" e de "/static/..." (que o Flask já resolve nativamente).
    Nunca serve um diretório inteiro — só o allowlist explícito
    (_ALLOWED_STATIC_FILES), pra não vazar data/alert_comments.json nem o
    código-fonte .py. Retorna o arquivo (ou o placeholder vazio, só para
    snapshot.json — ver abaixo) ou 404 JSON.

    [2026-08-31, achado do usuário — "rodando normal aqui e no colega não"]
    `snapshot.json` nunca é versionado (gerado localmente, ver .gitignore) —
    numa máquina nova (`git clone`/`git pull` sem nunca ter rodado
    `build_snapshot.py`/tido um "Atualizar" bem-sucedido), o arquivo
    simplesmente não existe em disco. Um 404 puro aqui fazia o front-end
    (index.js) cair no `.catch()` do fetch inicial, que nunca chama
    `ControleCargas.init()`/`wire()` — filtros ▾/ordenação/campos De-Até
    ficavam mortos para sempre (ver _montar_snapshot_vazio() para o detalhe
    completo da causa raiz).

    Pseudocódigo:
      1. Se `filename` não está no allowlist, devolve 404 {"error": ...}.
      2. Caso seja snapshot.json e o arquivo AINDA não exista em disco,
         devolve um snapshot vazio (mesmo schema, zero carteira/agrupamento)
         montado na hora — 200, nunca 404. O boot inicial do app.py
         (atualizar_snapshot_no_boot) já TENTA gerar o arquivo de verdade
         antes de chegar aqui; isto é só o fallback para quando aquela
         tentativa falhar (ex.: sem token da API Beehus, o caso normal numa
         máquina que nunca abriu a tela).
      3. Caso contrário, serve o arquivo real da raiz do protótipo. """
    if filename not in _ALLOWED_STATIC_FILES:
        return jsonify({"error": "not found"}), 404
    if filename == "snapshot.json" and not (HERE / filename).exists():
        return jsonify(_montar_snapshot_vazio())
    return send_from_directory(HERE, filename)


# ── Token da API Beehus [2026-08-05, pedido do usuário: "consegue efetuar
#    todas consultas por Endpoints" + "pode efetuar o processo de
#    transição"] — requisito de conexão do app (acesso direto ao Mongo foi
#    removido por completo, ver db.py). Válido por 1 dia (JWT curto), vive só em
#    memória do processo (beehus_api/client.py) — a pessoa cola de novo
#    quando expirar. Mesmo padrão de rota do app-irmão `SWAT\beehus-swat`
#    (pages/beehus_console.py `/api/beehus/token`), só adaptado ao modal
#    desta tela em vez de uma página própria. ──────────────────────────────

@app.route("/api/beehus-token", methods=["GET"])
def beehus_token_get():
    """Contexto:
    Devolve o status do token atual (carregado? expirado? rejeitado pela
    API?) — usada no boot da página (ControleCargas.verificarTokenBeehus())
    pra decidir se abre o modal automaticamente, e pelo indicador da
    masthead. NUNCA devolve o token em si. Retorna o dict de
    beehus_api.token_status().

    Pseudocódigo:
      1. Delega direto pra beehus_api.token_status(). """
    return jsonify(token_status())


@app.route("/api/beehus-token", methods=["POST"])
def beehus_token_set():
    """Contexto:
    Cola o token do dia — chamada pelo modal "🔑 Beehus API"
    (ControleCargas.salvarTokenBeehus()). Valida contra a API IMEDIATAMENTE
    (verify_token(), 1 GET barato) em vez de deixar todo o resto da tela
    falhar silenciosamente com um token errado/incompleto. Retorna
    token_status() (200) ou {"error": ...} (400/401).

    Pseudocódigo:
      1. Lê `token` do body JSON; vazio -> 400.
      2. set_token() (guarda em memória + persiste em ~/.swat/beehus.token).
      3. verify_token() — 401/403 -> 401 com mensagem clara; qualquer outro
         erro de rede/API -> aviso "soft" (o token pode estar certo, a API
         só não respondeu agora) em vez de bloquear o salvamento.
    """
    body = request.get_json(force=True, silent=True) or {}
    try:
        set_token(body.get("token", ""))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    try:
        verify_token()
    except BeehusAuthError as exc:
        return jsonify({
            "error": "Token rejeitado pela API (401/403). Confira se copiou o token de hoje por completo.",
            "upstream_status": exc.status,
        }), 401
    except BeehusAPIError as exc:
        return jsonify({**token_status(), "warning": f"Não foi possível validar agora: {exc}"})
    return jsonify(token_status())


@app.route("/api/beehus-token", methods=["DELETE"])
def beehus_token_clear():
    """Contexto: remove o token (memória + disco) — botão "Sair"/limpar do
    modal, se a pessoa quiser trocar de conta. Retorna token_status().

    Pseudocódigo:
      1. Delega pra beehus_api.clear_token(). """
    clear_token()
    return jsonify(token_status())


@app.route("/api/comments", methods=["GET"])
def get_comments():
    """Contexto:
    Lista de comentários para a tela consumir ao carregar (ver
    ControleCargas.loadComments() no front-end). Devolve TODOS os
    comentários (vigentes + expirados) — o front-end decide o que mostrar na
    matriz (só vigentes) vs. no painel de detalhe (vigentes e expirados, em
    duas seções).

    Pseudocódigo:
      1. Lê o arquivo via _load_comments() (nunca lança exceção).
      2. Devolve {"comments": [...]} como JSON.
    """
    return jsonify({"comments": _load_comments()})


@app.route("/api/comments", methods=["POST"])
def post_comments():
    """Contexto:
    Cria 1 comentário novo de alerta (linha ou célula), chamada pelo
    formulário do painel de detalhe (ver
    static/js/controle_cargas/comentarios.js::postComment). Body JSON
    esperado: {targetType, targetId, cellDate?, severity, text, validFrom?,
    validTo?}. Retorna {"comment": {...}} (201) ou {"error": ...} (400).

    Pseudocódigo:
      1. Lê e valida os campos obrigatórios (targetType/targetId/severity/
         text); acumula todos os erros antes de responder.
      2. Preenche validFrom/validTo com hoje quando ausentes; corrige validTo
         se vier antes de validFrom.
      3. Monta o comentário (id novo, author pelo usuário do SO, timestamps).
      4. Anexa à lista existente e reescreve o arquivo inteiro.
    """
    body = request.get_json(force=True, silent=True) or {}

    target_type = body.get("targetType")
    target_id = body.get("targetId")
    severity = body.get("severity")
    text = (body.get("text") or "").strip()

    errors = []
    if target_type not in VALID_TARGET_TYPES:
        errors.append("targetType deve ser 'wallet' ou 'grouping'")
    if not target_id:
        errors.append("targetId é obrigatório")
    if severity not in VALID_SEVERITIES:
        errors.append("severity deve ser 'green', 'yellow' ou 'red'")
    if not text:
        errors.append("text é obrigatório (não pode ser vazio)")
    if errors:
        return jsonify({"error": "; ".join(errors)}), 400

    today = _today_str()
    valid_from = body.get("validFrom") or today
    valid_to = body.get("validTo") or today
    if valid_to < valid_from:
        valid_to = valid_from

    now_iso = dt.datetime.now().isoformat(timespec="seconds")
    comment = {
        "id": f"c_{uuid.uuid4().hex[:12]}",
        "targetType": target_type,
        "targetId": str(target_id),
        "cellDate": body.get("cellDate") or None,
        "severity": severity,
        "text": text,
        "validFrom": valid_from,
        "validTo": valid_to,
        "author": (os.environ.get("USERNAME") or "desconhecido").lower(),
        "createdAt": now_iso,
        "updatedAt": now_iso,
        "resolved": False,
    }

    # [2026-08-13] lock cobre ler+anexar+salvar como uma unidade só — sem
    # isso, duas pessoas comentando quase ao mesmo tempo no servidor central
    # podiam ler a mesma lista antiga e a 2ª escrita apagava o comentário da
    # 1ª (perda silenciosa, não só corrupção de arquivo).
    with _comments_lock:
        comments = _load_comments()
        comments.append(comment)
        _save_comments(comments)

    return jsonify({"comment": comment}), 201


@app.route("/api/annotations", methods=["GET"])
def get_annotations():
    """Contexto:
    Todas as anotações (Responsável/Comentário sobre atuação) para a tela
    consumir ao carregar/trocar snapshot (ver ControleCargas.anotacoes.js) —
    [2026-07-24, pedido do usuário]. Devolve o dict inteiro; o front-end
    resolve a anotação de uma linha pela chave (targetType + "|" + targetId
    + "|" + referenceDate corrente).

    Pseudocódigo:
      1. Lê o arquivo via _load_annotations() (nunca lança exceção).
      2. Devolve {"annotations": {...}} como JSON. """
    return jsonify({"annotations": _load_annotations()})


@app.route("/api/annotations", methods=["POST"])
def post_annotations():
    """Contexto:
    Salva em lote as anotações editadas na grade (botão "Salvar" —
    static/js/controle_cargas/anotacoes.js), uma por (targetType, targetId,
    referenceDate) — MESMO par targetType/targetId de /api/comments, pra
    valer tanto em Carteiras quanto em Agrupamentos (paridade de colunas
    entre as duas abas). Body JSON esperado: {"annotations": [{targetType,
    targetId, referenceDate, responsavel?, comentarioAtuacao?}, ...]}. Cada
    item SOBRESCREVE o registro anterior daquela chave (não acumula
    histórico — diferente de /api/comments). Retorna {"annotations": {...}}
    (o dict completo já atualizado, 200) ou {"error": ...} (400).

    Pseudocódigo:
      1. Lê o array `annotations` do body; vazio/ausente -> erro 400.
      2. Pra cada item, valida targetType/targetId/referenceDate
         (obrigatórios); acumula erros sem abortar no meio do lote.
      3. Sem erros, faz upsert de cada item no dict carregado (chave
         targetType|targetId|referenceDate), gravando author/updatedAt
         igual a post_comments().
      4. Persiste o dict inteiro e devolve. """
    body = request.get_json(force=True, silent=True) or {}
    itens = body.get("annotations")
    if not isinstance(itens, list) or not itens:
        return jsonify({"error": "annotations deve ser uma lista não vazia"}), 400

    errors = []
    for i, item in enumerate(itens):
        if item.get("targetType") not in VALID_TARGET_TYPES:
            errors.append(f"item {i}: targetType deve ser 'wallet' ou 'grouping'")
        if not item.get("targetId"):
            errors.append(f"item {i}: targetId é obrigatório")
        if not item.get("referenceDate"):
            errors.append(f"item {i}: referenceDate é obrigatório")
    if errors:
        return jsonify({"error": "; ".join(errors)}), 400

    now_iso = dt.datetime.now().isoformat(timespec="seconds")
    author = (os.environ.get("USERNAME") or "desconhecido").lower()
    # [2026-08-13] mesmo cuidado de post_comments(): lock cobre ler+upsert do
    # lote+salvar como uma unidade, senão duas pessoas salvando a grade quase
    # ao mesmo tempo no servidor central podiam se sobrescrever.
    with _annotations_lock:
        annotations = _load_annotations()
        for item in itens:
            chave = _chave_anotacao(item["targetType"], item["targetId"], item["referenceDate"])
            annotations[chave] = {
                "targetType": item["targetType"],
                "targetId": str(item["targetId"]),
                "referenceDate": item["referenceDate"],
                "responsavel": (item.get("responsavel") or "").strip(),
                "comentarioAtuacao": (item.get("comentarioAtuacao") or "").strip(),
                "author": author,
                "updatedAt": now_iso,
            }
        _save_annotations(annotations)

    return jsonify({"annotations": annotations})


@app.route("/api/janela-padrao", methods=["GET"])
def janela_padrao():
    """Contexto:
    Devolve a janela DEFAULT do grid (data_inicial/data_final) calculada
    contra o "hoje" REAL do relógio do servidor — sem tocar a API Beehus nem
    depender do snapshot.json em disco. Usada por
    preencherCamposDataAtualizar() (atualizar.js) pra sugerir De/Até no 1º
    acesso. Existe porque snapshot.json é um arquivo PRÉ-GERADO
    (build_snapshot.py rodado à parte, ver comentário no topo deste
    arquivo): sua meta.referenceDate fica CONGELADA em quando o arquivo foi
    gerado, então não serve pra sugerir "hoje - Ndu" de verdade — pedido do
    usuário 2026-07-23, depois de notar o campo "até" sugerindo uma data
    antiga mesmo depois de clicar Atualizar (o botão só reenvia o que já
    estava nos campos; se o campo nasceu errado, o Atualizar não corrige
    sozinho).

    Pseudocódigo:
      1. Monta o calendário ANBIMA (mesmo usado por montar_snapshot()).
      2. Calcula (data_referencia, janela) contra o hoje real via
         calcular_janela_grid() — MESMA fórmula/constantes do default do
         snapshot (utils/datas.py: D-3 de referência — GRID_REFERENCE_LAG_DU,
         [REVISADO 2026-07-24, pedido do usuário] foi D-5 por 1 dia —, 5 du
         antes),
         sem nenhuma consulta à API (só aritmética de calendário — barato,
         seguro de chamar a cada carregamento da tela).
      3. Devolve {dataInicial: janela[0], dataFinal: data_referencia}.
    """
    calendario = CalendarioDiasUteis()
    hoje = _today_str()
    data_referencia, janela = calcular_janela_grid(calendario, hoje)
    return jsonify({"dataInicial": janela[0], "dataFinal": data_referencia})


# [2026-08-24, tarefa "Publicação por Hora" (aba Company) — rota NOVA, adição
# pura: nenhuma rota/função já existente foi tocada por causa dela] Config dos
# limites de hora da visão nova, externalizada em data/publicacao_hora_config.json
# (CLAUDE.md §10 — "parâmetros configuráveis vão para data/*.json, não hardcoded"),
# consumida por static/js/controle_cargas/matriz_publicacao_hora.js.
PUBLICACAO_HORA_CONFIG_PATH = DATA_DIR / "publicacao_hora_config.json"
PUBLICACAO_HORA_CONFIG_PADRAO = {
    "nomeVisao": "Publicação por Hora",
    "limiteInicioHoraCheia": 8,
    "limiteFimHoraCheia": 20,
}


@app.route("/api/publicacao-hora-config", methods=["GET"])
def publicacao_hora_config():
    """Contexto:
    [2026-08-24, adição pura desta tarefa] Devolve os limites de hora
    (baldes "até Xh" / hora cheia / "após Yh") da visão nova "Publicação por
    Hora" (sub-visão da aba Company), configuráveis em
    data/publicacao_hora_config.json em vez de hardcoded no JS — mesmo
    padrão já usado por data/demandas_config.json/data/anomalias_config.json
    (config lida no servidor, servida como JSON). Só leitura local, sem
    Mongo/API Beehus. Retorna JSON.

    Pseudocódigo:
      1. Parte dos defaults embutidos (08h/20h) — nunca falha por arquivo
         ausente (1ª execução, ou alguém apagou o JSON sem querer).
      2. Se o arquivo existir, lê e mescla por cima dos defaults (chave
         ausente no JSON mantém o default); JSON malformado é ignorado
         (defensivo — nunca derruba a tela por causa de um config quebrado).
    """
    config = dict(PUBLICACAO_HORA_CONFIG_PADRAO)
    try:
        if PUBLICACAO_HORA_CONFIG_PATH.exists():
            with open(PUBLICACAO_HORA_CONFIG_PATH, "r", encoding="utf-8") as f:
                config.update(json.load(f) or {})
    except (OSError, ValueError):
        pass
    return jsonify(config)


def _mensagem_amigavel_erro_atualizacao(exc):
    """Contexto:
    Traduz uma exceção crua de montar_snapshot() numa mensagem que o usuário
    consegue AGIR sobre, em vez do texto de erro do Python — usada por
    atualizar_snapshot() (rota /api/atualizar) [2026-07-30, pedido do
    usuário: depois de descobrir que o Rent não atualizava porque o Excel
    estava aberto travando TemplateCarteiras.xlsx, pediu um alerta claro
    "na próxima" em vez de descobrir o motivo manualmente de novo]. Retorna
    string (a mensagem já pronta pra mostrar).

    Pseudocódigo:
      1. PermissionError num .xlsx -> quase sempre o arquivo aberto no Excel
         (ou sincronizando no OneDrive) — mensagem específica, com o nome
         do arquivo, dizendo o que fazer.
      2. [2026-08-05] BeehusAuthError (token da API ausente/expirado/
         rejeitado) -> mensagem apontando pro botão "🔑 Beehus API" desta
         tela, em vez do texto cru do cliente (que menciona uma página
         "/beehus" que não existe aqui).
      3. Qualquer outra exceção -> mensagem genérica com o texto original
         (comportamento de antes), pra nunca esconder um erro novo/diferente. """
    if isinstance(exc, PermissionError) and str(exc).strip().lower().endswith(".xlsx'"):
        nome_arquivo = str(exc).split(":")[-1].strip().strip("'")
        return (f'Não foi possível ler "{nome_arquivo}" — o arquivo provavelmente está aberto no Excel '
                f'(ou sincronizando no OneDrive). Feche-o e clique em Atualizar de novo.')
    if isinstance(exc, BeehusAuthError):
        return ("Token da API Beehus ausente, expirado ou rejeitado — cole o token de hoje "
                "no botão \"🔑 Beehus API\" (topo da página) e clique em Atualizar de novo.")
    if isinstance(exc, BeehusAPIError):
        return f"Falha ao consultar a API Beehus: {exc}"
    return f"falha ao atualizar snapshot: {exc}"


# [2026-08-05, pedido do usuário: "pode travar para 5DU"] Teto da janela
# pedida via /api/atualizar (campos De/Até da tela) — cada dia além deste
# teto custa 1 chamada extra à API POR EMPRESA (processed-position/
# nav-results/preprocessing-status, ver db.py); sem teto, um intervalo
# customizado grande (ex.: 2 meses) explodiria em centenas de chamadas de
# uma vez. MESMO valor do default da janela inicial (utils/datas.py) — não
# há razão pra o teto ser diferente do que já é considerado "normal".
JANELA_MAXIMA_DIAS_UTEIS = JANELA_INICIAL_DIAS_UTEIS


@app.route("/api/data-inicial-padrao", methods=["GET"])
def data_inicial_padrao():
    """Contexto:
    Devolve data_inicial = data_final − JANELA_MAXIMA_DIAS_UTEIS dias úteis —
    usada pelo campo "De" da tela, que ficou readonly e se recalcula sozinho
    a cada troca do campo "até" (static/js/controle_cargas/atualizar.js)
    [2026-08-06, pedido do usuário: "coloque a data inicial como fixa, onde
    ao mudar a data final ela mude também" — depois de um clique em
    Atualizar ter falhado com 400 por pedir uma janela maior que o teto,
    ver JANELA_MAXIMA_DIAS_UTEIS acima]. Não toca a API Beehus, só
    aritmética de calendário — seguro de chamar a cada troca do campo.

    Pseudocódigo:
      1. Lê `data_final` da querystring; formato inválido -> 400.
      2. Desloca JANELA_MAXIMA_DIAS_UTEIS dias úteis pra trás via
         CalendarioDiasUteis (mesmo calendário ANBIMA de /api/atualizar).
      3. Devolve {dataInicial: ...}.
    """
    data_final = request.args.get("data_final", "").strip()
    erro = _validar_data_iso(data_final, "data_final")
    if erro:
        return jsonify({"error": erro}), 400
    calendario = CalendarioDiasUteis()
    data_inicial = calendario.deslocar(data_final, -JANELA_MAXIMA_DIAS_UTEIS)
    return jsonify({"dataInicial": data_inicial})


@app.route("/api/atualizar", methods=["GET"])
def atualizar_snapshot():
    """Contexto:
    Tarefa 3 do refactor 2026-07-20 — botão "Atualizar" da tela. Recalcula o
    snapshot só para o intervalo [data_inicial, data_final] pedido (em vez
    de rodar `python build_snapshot.py` inteiro por fora).

    [REVISADO 2026-07-27, pedido do usuário — "quando eu clicar em
    atualizar, realmente atualize tudo"] SEMPRE chama `montar_snapshot(...,
    forcar_atualizacao=True)` — invalida o cache por-data ANTES de buscar,
    garantindo dado fresco da API pra TODA a janela pedida, mesmo datas já
    vistas nesta sessão do processo (cobre o caso de carga/retificação que
    chega atrasada pra uma data já cacheada). Isso é DETERMINÍSTICO (não
    depende de quanto tempo passou desde a última consulta — uma tentativa
    anterior com TTL de 120s foi revertida a pedido do usuário).

    Pseudocódigo:
      1. Lê `data_inicial`/`data_final` da querystring e valida formato.
      2. Lê `limiar_divergencia_pct`/`limiar_divergencia_reais` — os 2 campos
         editáveis do filtro de divergência Rent Contrib × Rent NAV
         [2026-07-31, pedido do usuário: "campos para mudar o valor"];
         vazios são válidos (usam o padrão — ver montar_snapshot()). O
         percentual vem da tela em PONTOS PERCENTUAIS (ex.: "0.02" = 0,02%)
         — convertido pra fração decimal (÷100) antes de repassar, que é a
         unidade que div_overlay_kind() usa internamente.
      3. [2026-08-05] Valida que o intervalo pedido não passa de
         JANELA_MAXIMA_DIAS_UTEIS (5 du) — 400 cedo, antes de qualquer
         chamada à API, se passar.
      4. Chama montar_snapshot(data_inicial, data_final,
         forcar_atualizacao=True, limiar_divergencia_pct=...,
         limiar_divergencia_reais=...) — mesma função do CLI (que nunca
         força, cache já começa vazio no boot), então qualquer melhoria ali
         beneficia os dois caminhos.
      5. Devolve o snapshot completo (mesmo formato de snapshot.json) —
         o front-end troca ControleCargas.SNAPSHOT inteiro e re-renderiza
         (mais simples de integrar do que devolver só a fatia nova, e o
         payload de uma janela de poucos dias é pequeno).
      6. Erros (parâmetro inválido, janela grande demais, token da API
         Beehus ausente/expirado) viram JSON {error:...} com status
         400/401/500 — nunca um 500 cru.
    """
    data_inicial = request.args.get("data_inicial", "").strip()
    data_final = request.args.get("data_final", "").strip()
    limiar_pct_bruto = request.args.get("limiar_divergencia_pct", "").strip()
    limiar_reais_bruto = request.args.get("limiar_divergencia_reais", "").strip()

    erro = (_validar_data_iso(data_inicial, "data_inicial")
            or _validar_data_iso(data_final, "data_final")
            or _validar_numero_nao_negativo(limiar_pct_bruto, "limiar_divergencia_pct")
            or _validar_numero_nao_negativo(limiar_reais_bruto, "limiar_divergencia_reais"))
    if erro:
        return jsonify({"error": erro}), 400
    if data_inicial > data_final:
        return jsonify({"error": "data_inicial não pode ser depois de data_final"}), 400

    dias_uteis_pedidos = CalendarioDiasUteis().sequencia_dias_uteis(data_inicial, data_final)
    if len(dias_uteis_pedidos) - 1 > JANELA_MAXIMA_DIAS_UTEIS:
        return jsonify({
            "error": f"Janela pedida tem {len(dias_uteis_pedidos) - 1} dias úteis — "
                     f"o máximo é {JANELA_MAXIMA_DIAS_UTEIS} (cada dia consulta a API Beehus "
                     f"por empresa; peça um intervalo menor ou clique Atualizar de novo depois "
                     f"pra avançar a janela em etapas)."
        }), 400

    limiar_pct = (float(limiar_pct_bruto) / 100) if limiar_pct_bruto else None
    limiar_reais = float(limiar_reais_bruto) if limiar_reais_bruto else None

    try:
        snapshot = montar_snapshot(data_inicial=data_inicial, data_final=data_final, forcar_atualizacao=True,
                                    limiar_divergencia_pct=limiar_pct, limiar_divergencia_reais=limiar_reais)
    except BeehusAuthError as exc:
        return jsonify({"error": _mensagem_amigavel_erro_atualizacao(exc)}), 401
    except Exception as exc:  # pragma: no cover - defensivo, nunca 500 cru pro front
        return jsonify({"error": _mensagem_amigavel_erro_atualizacao(exc)}), 500

    return jsonify(snapshot)


def atualizar_snapshot_no_boot():
    """Contexto:
    Regera `snapshot.json` (janela DEFAULT, mesma de sempre) toda vez que o
    servidor sobe — pedido do usuário 2026-07-23, depois de descobrir que a
    tela ficou mostrando um `snapshot.json` de 2 dias atrás (792 carteiras)
    mesmo já tendo `TemplateCarteiras.xlsx` atualizado (924): o arquivo
    estático só era refeito rodando `build_snapshot.py` à parte ou clicando
    "Atualizar" na tela (e isso só atualiza a sessão do navegador aberto,
    nunca o arquivo em disco que o PRÓXIMO carregamento da página vai buscar).
    Chamada 1x no bootstrap, antes de `app.run()`. Não retorna nada.

    Pseudocódigo:
      1. Monta o snapshot (lê TemplateCarteiras.xlsx + API Beehus na hora).
      2. Grava em snapshot.json (escrever_snapshot_json, mesma função do CLI
         build_snapshot.py).
      3. Falha (ex.: token da API Beehus ausente/expirado) -> avisa no
         console e SEGUE com o snapshot.json antigo que já estiver em disco,
         em vez de impedir o servidor de subir. """
    try:
        print("Atualizando snapshot.json (janela default) antes de subir o servidor...")
        snap = montar_snapshot()
        escrever_snapshot_json(snap)
    except Exception as exc:
        print(f"AVISO: não foi possível atualizar snapshot.json no boot ({exc}). "
              f"Servidor vai subir com o snapshot.json existente (pode estar desatualizado) — "
              f"use o botão Atualizar na tela ou rode build_snapshot.py manualmente.")


if __name__ == "__main__":
    atualizar_snapshot_no_boot()
    # port 5050, use_reloader=False — o reloader do Flask faz spawn de
    # subprocess usando o path completo do arquivo, e o path do OneDrive tem
    # espaços ("Beehus Tecnologia Ltda - Documentos"), o que quebra o reloader.
    # threaded=True [2026-08-06, pedido do usuário: "mais de uma pessoa ao
    # mesmo tempo"] — sem isso o servidor de desenvolvimento atende 1
    # requisição por vez; qualquer chamada longa (boot, /api/atualizar, que
    # podem levar 30-100+s) travava a tela de QUALQUER outra pessoa até
    # terminar, mesmo sem nenhuma disputa de dado entre elas.
    app.run(debug=True, port=5050, use_reloader=False, threaded=True)
