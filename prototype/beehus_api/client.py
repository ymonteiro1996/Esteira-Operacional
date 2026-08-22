"""Low-level HTTP client + token storage for the Beehus API.

[2026-08-06, pedido do usuário: "tem que poder mais de uma pessoa abrir ao
mesmo tempo"] O token é armazenado POR SESSÃO DE NAVEGADOR (sid opaco, cookie
Flask assinado com app.secret_key — ver bind_session_id() e app.py
before_request), não mais num único dict global do processo. Antes, a 2ª
pessoa que colasse o token dela sobrescrevia silenciosamente a sessão da 1ª
(mesmo processo, mesmo dict `_state`) — agora cada aba/navegador tem seu
próprio token, isolado.

O sid chega até aqui via uma `contextvars.ContextVar` (não thread-local puro)
porque as threads de fan-out (`concurrent.futures.ThreadPoolExecutor` em
db.py/positions.py) NÃO herdam automaticamente o contexto da thread que
tratou a requisição Flask. [CORRIGIDO 2026-08-06, achado em produção:
"cannot enter context: ... is already entered"] A 1ª tentativa reusava um
ÚNICO `contextvars.Context` (`contextvars.copy_context().run(...)`) entre
TODAS as chamadas concorrentes do fan-out — mas um Context não pode ser
"entrado" por 2 threads ao mesmo tempo. A correção real: cada worker captura
o sid ANTES do fan-out (`id_sessao_atual()`, na thread que dispara) e chama
`bind_session_id(sid)` de novo DENTRO da própria thread (que já nasce com
contexto isolado) — só o VALOR do sid é propagado, nunca um Context
compartilhado. Os 3 pontos de fan-out do projeto (db.py ×2, positions.py ×1)
já fazem isso.

Os tokens de TODAS as sessões são **persistidos a disco**
(`~/.swat/beehus.token`, agora um dict `{sid: {token, set_at}}`) e recarregados
no import — como o cookie de sessão sobrevive a um restart (secret_key também
persistido, ver app.py), cada navegador volta autenticado sem precisar colar
de novo. Deliberadamente em `~/.swat/` (mesmo diretório local, só do usuário
atual, do token de sessão em auth.py) e NÃO na pasta `data/` sincronizada pelo
OneDrive — uma credencial bearer não pode sincronizar pra nuvem. O token ainda
pode expirar no lado do Beehus (é de curta duração); um reload obsoleto só
gera um 401 na próxima chamada e a pessoa cola de novo, exatamente como antes.
"""
import contextvars
import json
import logging
import os
import threading
import time
from pathlib import Path

import requests
from requests.adapters import HTTPAdapter

from .exceptions import BeehusAPIError, BeehusAuthError

BASE_URL = "https://controladoria.beehus.com.br"
DEFAULT_TIMEOUT = 30  # seconds

_lock = threading.Lock()
# Estado POR SESSÃO — sid -> {"token", "set_at", "rejected"}. `rejected`: set
# True sempre que o upstream responde 401/403 (token ausente/expirado/errado
# no lado do servidor Beehus), limpo no próximo 2xx e sempre que um token novo
# é colado/limpo. Deixa a tela distinguir "o servidor rejeitou este token" de
# um JWT que só PARECE válido pelo `exp` local.
_sessions: dict[str, dict] = {}

# Amarra o sid da sessão à thread atual — setada 1x por requisição pelo
# before_request (app.py) via bind_session_id(); lida por toda função deste
# módulo que precisa saber "de quem" é o token. Ver docstring do módulo sobre
# por que isso precisa ser propagado manualmente pros workers de fan-out.
_current_session_id: contextvars.ContextVar = contextvars.ContextVar(
    "beehus_session_id", default=None)


def bind_session_id(sid) -> None:
    """Contexto:
    Amarra `sid` (id opaco da sessão do navegador) à contextvar desta thread
    — chamada 1x por requisição pelo `@app.before_request` (app.py), ANTES
    de qualquer rota rodar. Todo o resto deste módulo (get_token/set_token/
    clear_token/token_status/_headers/tratamento de 401 em request()) lê o
    token daquele sid, nunca de um global único.

    [CORRIGIDO 2026-08-06, achado em produção: "cannot enter context: ...
    is already entered"] Também chamada explicitamente, com o MESMO sid da
    requisição, de DENTRO de cada worker de um ThreadPoolExecutor de fan-out
    (db.py/positions.py) — a 1ª versão tentava propagar o sid reusando um
    ÚNICO `contextvars.Context` (via `contextvars.copy_context().run(...)`)
    entre TODAS as tarefas concorrentes, mas um mesmo Context não pode ser
    "entrado" por duas threads ao mesmo tempo (nem reentrado) — quando 2+
    workers do pool caíam nele simultaneamente, o 2º explodia com esse erro.
    A correção é mais simples: cada worker chama bind_session_id(sid) DENTRO
    da própria thread (que já nasce com seu próprio Context vazio/isolado do
    ThreadPoolExecutor — nada de Context compartilhado), só propagando o
    VALOR do sid (uma string), capturado ANTES do fan-out via
    id_sessao_atual(). Não retorna nada.

    Pseudocódigo:
      1. Grava `sid` na contextvar do processo/thread atual. """
    _current_session_id.set(sid)


def id_sessao_atual():
    """Contexto:
    Valor bruto (string ou None) da contextvar de sid amarrada nesta thread
    — usada por quem PREPARA um fan-out em ThreadPoolExecutor (db.py/
    positions.py) pra capturar o sid da requisição ANTES de submeter as
    tarefas, e repassar pra cada worker chamar bind_session_id() de novo já
    dentro da própria thread (ver docstring de bind_session_id() acima sobre
    por que não dá pra só reusar um Context compartilhado). Retorna string
    ou None (sem sessão amarrada).

    Pseudocódigo:
      1. Lê e devolve o valor atual da contextvar. """
    return _current_session_id.get()


def _sessao_atual() -> dict | None:
    """Contexto:
    Estado (token/set_at/rejected) da sessão amarrada nesta thread via
    bind_session_id() — usada por get_token/token_status/clear_token/
    request()/request_multipart(). Retorna o dict já registrado em
    `_sessions`, ou None se o sid não tem estado ainda (nunca colou token) OU
    nenhum sid foi amarrado (ex.: chamada fora de uma requisição Flask, como
    o boot do servidor antes do 1º acesso). NUNCA cria entrada nova — quem
    precisa criar (só set_token(), a única escrita real) faz isso
    explicitamente. [ACHADO 2026-08-06, revisão de código: a versão anterior
    usava `setdefault`, o que criava e MANTINHA PARA SEMPRE em `_sessions`
    uma entrada vazia pra CADA visitante que só carregasse a página (todo
    GET/POST passa pelo before_request, que amarra um sid e várias rotas
    chamam get_token()/token_status() mesmo sem token nenhum colado) —
    memory leak sem teto num processo que fica de pé o dia inteiro.

    Pseudocódigo:
      1. Lê o sid da contextvar; sem sid -> None.
      2. `.get()` simples no dict de sessões (nunca insere). """
    sid = _current_session_id.get()
    if sid is None:
        return None
    return _sessions.get(sid)

_session = requests.Session()
# Connection pool sized for the per-company fan-outs (wallets/groupings index,
# nav warm) that fire up to `beehus_catalog._NAV_WARM_WORKERS` (10) parallel GETs
# to this single host — and which may now run in the BACKGROUND
# (stale-while-revalidate) while a foreground request is also in flight. The
# urllib3 default `pool_maxsize=10` discards the overflow ("Connection pool is
# full"), forcing a fresh TCP+TLS handshake each time. 20 keeps a full fan-out
# plus a concurrent foreground request pooled for keep-alive reuse.
# [2026-08-05, ControleCargas — achado medindo o boot com enable_timing()]
# Nesta cópia local, `db._buscar_datas_faltantes_via_api` roda um pool PRÓPRIO
# de até 16 workers (data×empresa×tipo) e, pra empresas grandes, `positions.py`
# `_get_positions_chunked` ainda soma até 5 sub-chamadas concorrentes por
# cima disso (chunking de walletIds) — o total de conexões simultâneas
# pedidas passa fácil de 20, e o excedente fica na fila esperando uma
# conexão do pool livre em vez de abrir uma nova, anulando parte do
# paralelismo do lado do cliente. Subido pra 40 (folga sobre o pior caso
# observado) só nesta cópia — não repassar essa mudança pros apps-irmãos
# sem medir o próprio padrão de fan-out deles primeiro.
_adapter = HTTPAdapter(pool_connections=40, pool_maxsize=40)
_session.mount("https://", _adapter)
_session.mount("http://", _adapter)

_log = logging.getLogger(__name__)

# ── Per-call timing instrumentation (diagnostics only) ───────────────────────
# Off by default (zero overhead beyond a boolean check). Turn on by setting the
# env var BEEHUS_HTTP_TIMING=1 at startup, or call `enable_timing()` at runtime.
# When on, every upstream call is logged (method, path, compact param summary,
# status, elapsed ms) and appended to `_timing_log` so a harness can tally how
# many upstream round-trips a single dashboard request actually fires.
_timing_lock = threading.Lock()
_timing_on = os.environ.get("BEEHUS_HTTP_TIMING", "").strip() in ("1", "true", "True")
_timing_log: list = []


def enable_timing(on: bool = True) -> None:
    global _timing_on
    _timing_on = bool(on)


def reset_timing() -> None:
    with _timing_lock:
        _timing_log.clear()


def get_timing() -> list:
    """Snapshot of recorded calls: list of dicts {method, path, summary, status, ms}."""
    with _timing_lock:
        return list(_timing_log)


def _param_summary(params, path):
    """Compact one-line summary of the query params that matter for cost —
    chiefly `date`/`initialDate`/`finalDate` and the SIZE of `walletIds`."""
    if not params:
        return ""
    bits = []
    for k in ("date", "initialDate", "finalDate", "positionDate"):
        if params.get(k):
            bits.append(f"{k}={params[k]}")
    wi = params.get("walletIds")
    if wi is not None:
        n = len([x for x in str(wi).split(",") if x]) if wi else 0
        bits.append(f"walletIds[{n}]")
    for k in ("securityIds", "pricingType"):
        if params.get(k):
            bits.append(k)
    return " ".join(bits)


def _record_timing(method, path, params, status, elapsed_ms):
    summary = _param_summary(params, path)
    with _timing_lock:
        _timing_log.append({
            "method": method, "path": path, "summary": summary,
            "status": status, "ms": round(elapsed_ms, 1),
        })
    _log.info("[beehus] %s %s %s -> %s in %.0fms",
              method, path, summary, status, elapsed_ms)


def _token_path() -> Path:
    d = Path.home() / ".swat"
    d.mkdir(parents=True, exist_ok=True)
    return d / "beehus.token"


# Teto de idade de uma sessão persistida — o token em si já expira em ~1 dia
# no lado do Beehus, então nenhuma sessão precisa sobreviver muito além
# disso; a folga (7 dias) é só pra tolerar fuso/relógio e gente que só usa a
# ferramenta 1x por semana sem perder a sessão à toa. [ACHADO 2026-08-06,
# revisão de código: sem isso, `_sessions` e `~/.swat/beehus.token` cresciam
# pra sempre — 1 entrada por pessoa que já colou um token, desde o 1º dia de
# uso da ferramenta, nunca removida.]
_SESSAO_MAX_IDADE_SEGUNDOS = 7 * 24 * 3600


def _sessao_expirada(estado, agora) -> bool:
    """Contexto: se `estado` (dict {token,set_at,...}) já passou do teto de
    idade pra persistência — usada por _persist_sessions()/
    _load_persisted_sessions() pra podar sessões velhas antes de gravar/
    recarregar. Retorna bool (True = sem set_at válido também conta como
    expirada, nunca persiste algo sem idade conhecida)."""
    set_at = estado.get("set_at")
    return not set_at or (agora - set_at) > _SESSAO_MAX_IDADE_SEGUNDOS


def _persist_sessions() -> None:
    """Contexto:
    Grava os tokens de TODAS as sessões AINDA DENTRO DO TETO DE IDADE em
    disco (`{sid: {token, set_at}}`), chamada depois de qualquer
    set_token()/clear_token() — best-effort, uma falha de escrita nunca
    quebra o estado em memória (persistência é conveniência, não requisito).
    Só grava sessões que TÊM token (uma sessão sem token não precisa
    sobreviver a um restart). Também PODA do `_sessions` em memória as
    sessões expiradas encontradas nessa passada — mata as 2 fontes do
    crescimento sem teto (disco E memória) no mesmo lugar, já que toda
    escrita passa por aqui. Não retorna nada."""
    try:
        agora = time.time()
        expiradas = [sid for sid, estado in _sessions.items() if _sessao_expirada(estado, agora)]
        for sid in expiradas:
            _sessions.pop(sid, None)
        payload = {
            "sessions": {
                sid: {"token": estado.get("token"), "set_at": estado.get("set_at")}
                for sid, estado in _sessions.items() if estado.get("token")
            }
        }
        _token_path().write_text(json.dumps(payload), encoding="utf-8")
    except Exception:
        pass


def _load_persisted_sessions() -> None:
    """Contexto:
    Popula `_sessions` a partir de `~/.swat/beehus.token` no import do
    módulo — cada sid recupera o próprio token (o cookie de sessão do
    navegador sobrevive a um restart porque app.secret_key também é
    persistido, ver app.py). Ignora silenciosamente o formato ANTIGO do
    arquivo (token único, pré-multi-sessão) — é um token de curta duração
    (expira em 1 dia), perder ele na migração custa só um re-paste único, não
    é uma regressão real. Também não recarrega sessões já além do teto de
    idade (_SESSAO_MAX_IDADE_SEGUNDOS) — evita reviver pra sempre uma sessão
    de alguém que não usa a ferramenta há semanas. Não retorna nada."""
    try:
        p = _token_path()
        if not p.exists():
            return
        data = json.loads(p.read_text(encoding="utf-8") or "{}")
        sessoes_salvas = data.get("sessions")
        if not isinstance(sessoes_salvas, dict):
            return
        agora = time.time()
        for sid, estado in sessoes_salvas.items():
            if not isinstance(estado, dict):
                continue
            token_salvo = (estado.get("token") or "").strip()
            if not token_salvo or _sessao_expirada(estado, agora):
                continue
            _sessions[sid] = {"token": token_salvo, "set_at": estado.get("set_at"), "rejected": False}
    except Exception:
        pass


def set_token(token: str) -> None:
    """Contexto:
    Guarda o token bearer na sessão AMARRADA NESTA THREAD (bind_session_id())
    e persiste todas as sessões a disco — chamada pela rota POST
    /api/beehus-token (app.py), 1x por dia por pessoa. Espaços em branco são
    removidos; vazio é rejeitado. Levanta RuntimeError se chamada sem sessão
    amarrada (só pode acontecer fora de uma requisição Flask — nunca deveria
    ocorrer nas rotas reais). É o ÚNICO lugar que CRIA uma entrada nova em
    `_sessions` (ver _sessao_atual() sobre por que as leituras nunca criam).
    Não retorna nada.

    Pseudocódigo:
      1. Normaliza e valida o token (não vazio).
      2. Sem sid amarrado -> erro.
      3. Cria/acha o estado da sessão atual, grava token/set_at, zera
         `rejected` (token novo, ainda não provado ruim) e persiste todas as
         sessões a disco. """
    t = (token or "").strip()
    if not t:
        raise ValueError("token is empty")
    with _lock:
        sid = _current_session_id.get()
        if sid is None:
            raise RuntimeError("set_token() chamado sem sessão amarrada (fora de uma requisição Flask)")
        estado = _sessions.setdefault(sid, {"token": None, "set_at": None, "rejected": False})
        estado["token"] = t
        estado["set_at"] = time.time()
        estado["rejected"] = False
        _persist_sessions()


def clear_token() -> None:
    """Contexto:
    Remove o token da sessão AMARRADA NESTA THREAD (memória + disco) —
    chamada pela rota DELETE /api/beehus-token (botão "Sair" do modal), afeta
    só quem clicou, nunca as outras sessões. Não retorna nada."""
    with _lock:
        sid = _current_session_id.get()
        if sid is not None:
            _sessions.pop(sid, None)
        _persist_sessions()


# Recarrega os tokens de todas as sessões salvas no boot do processo, pra um
# restart do servidor não forçar todo mundo a colar de novo (ver docstring
# do módulo).
_load_persisted_sessions()


def get_token() -> str | None:
    estado = _sessao_atual()
    return estado.get("token") if estado else None


def _decode_jwt_exp(token):
    """Best-effort read of a JWT's `exp` (epoch seconds) WITHOUT verifying the
    signature — just enough to tell the UI the in-process token has expired.
    Returns an int, or None if the token isn't a decodable JWT."""
    try:
        import base64, json as _json
        parts = token.split(".")
        if len(parts) < 2:
            return None
        payload = parts[1]
        payload += "=" * (-len(payload) % 4)  # restore base64 padding
        claims = _json.loads(base64.urlsafe_b64decode(payload.encode("ascii")))
        exp = claims.get("exp")
        return int(exp) if exp is not None else None
    except Exception:  # noqa: BLE001 — malformed token must never raise here
        return None


def token_status() -> dict:
    """Whether the token of the CURRENT session (bind_session_id()) is
    loaded, how old it is, and whether it has expired.

    `expired` decodes the session's token's `exp` claim, so a running
    instance whose token aged out is detectable — the modal uses this to
    prompt a re-paste instead of letting API-backed pages fail silently."""
    estado = _sessao_atual() or {}
    t = estado.get("token")
    set_at = estado.get("set_at")
    exp = _decode_jwt_exp(t) if t else None
    expired = bool(t) and exp is not None and exp <= time.time()
    return {
        "loaded": bool(t),
        "set_at": set_at,
        "age_seconds": (time.time() - set_at) if set_at else None,
        "exp": exp,
        "expired": expired,
        # True when the upstream last answered 401/403 for ESTA sessão —
        # catches a token the server rejects even though its local `exp`
        # still looks valid.
        "rejected": bool(estado.get("rejected")),
    }


def verify_token() -> None:
    """Probe the API with the current token via a cheap authenticated GET.

    Returns None on success; raises BeehusAuthError if the token is missing or
    rejected (401/403), or BeehusAPIError on any other upstream failure. Used by
    the token-save route to validate a pasted token immediately instead of
    letting later page reads fail silently."""
    request("GET", "/beehus/partners/companies")


def _headers(*, json_body: bool = True) -> dict:
    t = get_token()
    if not t:
        raise BeehusAuthError(
            "Bearer token not set. Open /beehus and paste today's token."
        )
    h = {"Authorization": f"Bearer {t}"}
    if json_body:
        h["Content-Type"] = "application/json"
    # For multipart uploads, let `requests` set Content-Type with the boundary.
    return h


def request(method: str, path: str, *, json=None, params=None, timeout: int | None = None):
    """Send a request to the Beehus API and return the parsed JSON body.

    Raises BeehusAuthError on 401/403, BeehusAPIError on any other non-2xx.
    """
    url = f"{BASE_URL}{path}"
    # Retry on 429 (rate limit) with backoff — the bulk warm of the navPackages
    # cache fires hundreds of calls and can trip the upstream rate limiter.
    # Honour `Retry-After` when present; otherwise exponential backoff capped.
    attempt = 0
    while True:
        attempt += 1
        _t0 = time.monotonic() if _timing_on else None
        try:
            r = _session.request(
                method,
                url,
                headers=_headers(),
                json=json,
                params=params,
                timeout=timeout or DEFAULT_TIMEOUT,
            )
        except requests.RequestException as e:
            if _timing_on:
                _record_timing(method, path, params, "ERR",
                               (time.monotonic() - _t0) * 1000.0)
            raise BeehusAPIError(f"Network error calling {method} {path}: {e}") from e
        if _timing_on:
            _record_timing(method, path, params, r.status_code,
                           (time.monotonic() - _t0) * 1000.0)
        if r.status_code == 429 and attempt <= 5:
            ra = r.headers.get("Retry-After")
            try:
                delay = float(ra) if ra else min(0.5 * (2 ** attempt), 8.0)
            except (TypeError, ValueError):
                delay = min(0.5 * (2 ** attempt), 8.0)
            time.sleep(delay)
            continue
        break

    if r.status_code in (401, 403):
        with _lock:
            estado = _sessao_atual()
            if estado is not None:
                estado["rejected"] = True
        raise BeehusAuthError(
            f"Token rejected ({r.status_code}). Re-paste today's token on /beehus.",
            status=r.status_code,
            body=r.text[:500],
        )
    if not r.ok:
        raise BeehusAPIError(
            f"{method} {path} failed: {r.status_code}",
            status=r.status_code,
            body=r.text[:1000],
        )

    with _lock:  # a 2xx clears any prior rejection (desta sessão)
        estado = _sessao_atual()
        if estado is not None:
            estado["rejected"] = False
    if not r.content:
        return None
    try:
        return r.json()
    except ValueError:
        return r.text


def request_multipart(method: str, path: str, *, files, data=None,
                      params=None, timeout: int | None = None):
    """Send a multipart/form-data request and return the parsed JSON body.

    `files` is a dict accepted by `requests` (e.g. `{"file": (name, bytes,
    mimetype)}`); `data` carries non-file form fields. We omit the JSON
    Content-Type header so `requests` can fill in the multipart boundary.
    """
    url = f"{BASE_URL}{path}"
    _t0 = time.monotonic() if _timing_on else None
    try:
        r = _session.request(
            method,
            url,
            headers=_headers(json_body=False),
            files=files,
            data=data or {},
            params=params,
            timeout=timeout or DEFAULT_TIMEOUT,
        )
    except requests.RequestException as e:
        if _timing_on:
            _record_timing(method, path, params, "ERR",
                           (time.monotonic() - _t0) * 1000.0)
        raise BeehusAPIError(f"Network error calling {method} {path}: {e}") from e
    if _timing_on:
        _record_timing(method, path, params, r.status_code,
                       (time.monotonic() - _t0) * 1000.0)

    if r.status_code in (401, 403):
        with _lock:
            estado = _sessao_atual()
            if estado is not None:
                estado["rejected"] = True
        raise BeehusAuthError(
            f"Token rejected ({r.status_code}). Re-paste today's token on /beehus.",
            status=r.status_code,
            body=r.text[:500],
        )
    if not r.ok:
        raise BeehusAPIError(
            f"{method} {path} failed: {r.status_code}",
            status=r.status_code,
            body=r.text[:1000],
        )

    with _lock:  # a 2xx clears any prior rejection (desta sessão)
        estado = _sessao_atual()
        if estado is not None:
            estado["rejected"] = False
    if not r.content:
        return None
    try:
        return r.json()
    except ValueError:
        return r.text
