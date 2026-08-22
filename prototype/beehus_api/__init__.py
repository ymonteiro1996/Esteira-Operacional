"""Beehus API client package — cliente HTTP reusável para
https://controladoria.beehus.com.br.

[2026-08-05, pedido do usuário: "consegue levantar se conseguimos efetuar
todas consultas por Endpoints igual" os apps-irmãos] Copiado (módulos
`client.py`/`exceptions.py`/`partner.py`/`positions.py`/`consolidation.py`/
`grouping.py`/`securities.py`) de `SWAT\\beehus-swat\\beehus_api` — mesmo
cliente, idêntico ao usado por `SWAT\\conciliacao`. A lista de exports abaixo
foi reduzida ao que este protótipo efetivamente usa (ver db.py); os módulos
`transactions.py`/`provisions.py`/`execution_prices.py`/`security_mappings.py`
do original não foram copiados — ControleCargas é 100% leitura, nunca
escreve em nada (CLAUDE.md §8).

Uso:
    from beehus_api import set_token, list_companies
    set_token("eyJ...")  # 1x por dia, colado na tela (ver app.py /api/beehus-token)
    empresas = list_companies()

[2026-08-06, pedido do usuário: "tem que poder mais de uma pessoa abrir ao
mesmo tempo"] O token vive POR SESSÃO DE NAVEGADOR (não mais 1 único token
pro processo inteiro) — ver client.py para o detalhe completo. `bind_session_id`
precisa ser chamada 1x por requisição (app.py before_request) e também por
quem dispara um fan-out em ThreadPoolExecutor (db.py/positions.py), pra o
worker herdar o sid certo. Persistido a disco por sessão; sobrevive a um
restart do servidor enquanto o cookie de sessão do navegador também
sobreviver (app.secret_key também persistido).
"""
from .client import set_token, get_token, clear_token, token_status, verify_token, bind_session_id, id_sessao_atual
from .exceptions import BeehusAPIError, BeehusAuthError
from .partner import list_companies, list_entities, partner_wallets
from .positions import get_processed_position, get_unprocessed_security_positions, get_preprocessing_status
from .consolidation import get_nav_results
from .grouping import list_groupings
from .securities import list_securities, get_security

__all__ = [
    "set_token",
    "get_token",
    "clear_token",
    "token_status",
    "verify_token",
    "bind_session_id",
    "id_sessao_atual",
    "BeehusAPIError",
    "BeehusAuthError",
    "list_companies",
    "list_entities",
    "partner_wallets",
    "get_processed_position",
    "get_unprocessed_security_positions",
    "get_preprocessing_status",
    "get_nav_results",
    "list_groupings",
    "list_securities",
    "get_security",
]
