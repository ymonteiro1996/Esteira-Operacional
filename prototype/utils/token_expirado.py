"""Aviso de token Beehus vencido para a tela (TRV-01 / CC-06).

[2026-09-25, pedido do usuário: "Quando tentar algo e estourar o token, já mostrar na tela o pop
up de colar o token"] Antes o modal de token só abria sozinho no carregamento da página
(`beehus_token.js::verificarTokenBeehus`); um token que vencia no meio do uso virava erro de
"Atualizar" sem convite para colar outro.

As respostas das rotas que CONSULTAM A API BEEHUS saem com `X-Beehus-Token: expired` enquanto o
token DESTA SESSÃO (o `before_request` já amarra o sid) estiver ausente, vencido (`exp`) ou
rejeitado no último 401. O front (`static/js/utils/beehus_token_guard.js`, o mesmo arquivo do
conciliacao e do beehus-swat) lê o cabeçalho em qualquer fetch e abre o modal de token.

Diferença deliberada para os apps-irmãos: aqui só as rotas da lista abaixo são marcadas. As abas
Controle de Demandas e Anomalias, comentários, anotações, progresso e configurações são 100%
locais — marcar TODO /api/* abriria o pop-up a cada ação de quem só usa o Kanban sem token.
**Rota nova que chama a API Beehus deve entrar em ROTAS_QUE_USAM_BEEHUS.**
"""
import logging

from flask import jsonify, request

from beehus_api import BeehusAuthError, token_status

_log = logging.getLogger(__name__)

CABECALHO = "X-Beehus-Token"
VALOR_VENCIDO = "expired"
CODIGO_ERRO = "BEEHUS_TOKEN_EXPIRED"
# Caminhos EXATOS (sem prefixo): /api/atualizar/progresso é local e não entra.
ROTAS_QUE_USAM_BEEHUS = frozenset({"/api/atualizar", "/api/carteiras-nao-cadastradas", "/api/empresas"})


def token_indisponivel():
    """Contexto:
    Diz se o token da sessão desta requisição está inutilizável. Usado pelo hook e pelo
    errorhandler. Retorna boolean.

    Pseudocódigo:
      1. Lê token_status() (por sessão — sid já amarrado no before_request; não chama a API).
      2. Sem token, vencido pelo `exp` ou rejeitado no último 401 -> True.
    """
    estado = token_status() or {}
    return (not estado.get("loaded")) or bool(estado.get("expired")) or bool(estado.get("rejected"))


def marcar_resposta(resposta):
    """Contexto:
    Hook `after_request`: acrescenta `X-Beehus-Token: expired` às respostas das rotas que usam a
    API Beehus quando o token da sessão não está utilizável. Retorna a própria resposta.

    Pseudocódigo:
      1. Rota fora de ROTAS_QUE_USAM_BEEHUS -> não marca.
      2. Token indisponível -> marca o cabeçalho.
    """
    if request.path in ROTAS_QUE_USAM_BEEHUS and token_indisponivel():
        resposta.headers[CABECALHO] = VALOR_VENCIDO
    return resposta


def resposta_token_vencido(erro):
    """Contexto:
    Rede de segurança (`errorhandler(BeehusAuthError)`): erro de token que escapou de uma rota
    vira 401 JSON com `error_code`, em vez de 500. Retorna (payload, 401).

    Pseudocódigo:
      1. Loga e monta {error, error_code}.
    """
    _log.warning("[beehus] token rejeitado/ausente (errorhandler): %s", erro)
    return jsonify({"error": str(erro), "error_code": CODIGO_ERRO}), 401


def instalar(app):
    """Contexto:
    Liga o aviso de token vencido no app. Chamado 1x no app.py, depois do before_request que
    amarra a sessão. Não retorna nada.

    Pseudocódigo:
      1. Registra o after_request e o errorhandler.
    """
    app.after_request(marcar_resposta)
    app.register_error_handler(BeehusAuthError, resposta_token_vencido)
