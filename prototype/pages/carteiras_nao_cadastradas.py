# -*- coding: utf-8 -*-
"""
pages/carteiras_nao_cadastradas.py — blueprint da aba "Carteiras Não Cadastradas"
==================================================================================
[2026-09-24, pedido do usuário: "Demonstrar com alertas, carteiras que estão no
sistema e não registramos no Template Carteiras. Aba separada"] Lista toda
carteira que o token enxerga na API Beehus (não excluída/trashed) cujo WalletID
NÃO está no TemplateCarteiras.xlsx.

Regras de negócio (todas aqui, nas funções puras da seção 2):
  - **Nova**: carteira criada há menos de DIAS_UTEIS_SINALIZACAO_NOVA (10) dias
    úteis -> sinalizada e exibida no topo. Passado o prazo sem entrar no
    Template, perde a sinalização mas CONTINUA na lista (pedido do usuário).
  - **Data de criação**: a API de wallets não expõe `createdAt`, mas o WalletID
    é um ObjectId do Mongo — os 8 primeiros hex são o timestamp de criação do
    documento. Id fora desse formato -> sem data (nunca sinaliza como Nova).
  - **Verificador de carga**: "Carga nos últimos N dias?" (N =
    DIAS_CORRIDOS_VERIFICACAO_CARGA, 45 dias corridos) = existe alguma
    unprocessedSecurityPositions da carteira nessa faixa
    (db.buscar_ultima_carga_por_carteira). Mostra também a data da última carga.

Somente LEITURA (CLAUDE.md §8): Excel via registry.py, API via db.py — nenhum
acesso direto a banco, nenhuma escrita.
"""

# ─────────────────────────────────────────────────────────────
# 1. IMPORTS E CONFIGURAÇÃO DO BLUEPRINT
# ─────────────────────────────────────────────────────────────

import datetime as dt

from flask import Blueprint, jsonify

import db
from beehus_api import BeehusAuthError
from build_snapshot import XLSX_PATH
from registry import ler_linhas_do_template
from utils.datas import CalendarioDiasUteis

bp = Blueprint("carteiras_nao_cadastradas", __name__)

# Parâmetros definidos pelo usuário em 2026-09-24.
DIAS_UTEIS_SINALIZACAO_NOVA = 10
DIAS_CORRIDOS_VERIFICACAO_CARGA = 45

# ObjectId guarda o timestamp em UTC; o dia de criação é contado em BRT.
_FUSO_BRT = dt.timezone(dt.timedelta(hours=-3))


# ─────────────────────────────────────────────────────────────
# 2. HELPERS / REGRAS DE NEGÓCIO (funções puras, sem Flask)
# ─────────────────────────────────────────────────────────────

def extrair_data_criacao_do_wallet_id(wallet_id):
    """Contexto:
    Data de criação (YYYY-MM-DD, BRT) de uma carteira a partir do próprio
    WalletID — ObjectId do Mongo, cujos 8 primeiros caracteres hex são o
    timestamp Unix de criação. Usada por montar_linha_carteira(). Retorna
    string ou None (id fora do formato ObjectId).

    Pseudocódigo:
      1. Id sem 24 caracteres hex -> None.
      2. Converte os 8 primeiros hex em segundos Unix.
      3. Converte pra data em BRT e devolve ISO.
    """
    texto = str(wallet_id or "")
    if len(texto) != 24:
        return None
    try:
        int(texto, 16)
        segundos = int(texto[:8], 16)
    except ValueError:
        return None
    return dt.datetime.fromtimestamp(segundos, tz=_FUSO_BRT).date().isoformat()


def filtrar_carteiras_nao_cadastradas(carteiras_por_id, ids_do_template):
    """Contexto:
    Separa, do catálogo de carteiras da API, as que não estão no Template.
    Chamada 1x pela rota. Retorna dict {walletId: doc} (mesmo shape de
    db.carregar_colecoes_pequenas()).

    Pseudocódigo:
      1. Descarta carteiras excluídas (trashed) — não são mais do sistema.
      2. Descarta as que têm WalletID no Template.
    """
    return {wid: w for wid, w in carteiras_por_id.items()
            if not w.get("trashed") and wid not in ids_do_template}


def montar_linha_carteira(wallet_id, carteira, contexto):
    """Contexto:
    Monta a linha de 1 carteira não cadastrada (formato consumido pelo
    front-end, static/js/carteiras_nao_cadastradas/). `contexto` junta o
    que é igual pra todas as linhas: empresas_por_id, nomes_entidades,
    ultima_carga, calendario, hoje. Retorna dict.

    Pseudocódigo:
      1. Data de criação pelo WalletID e dias úteis desde então.
      2. Nova = criada há menos de DIAS_UTEIS_SINALIZACAO_NOVA du; guarda
         quantos du faltam pra perder a sinalização.
      3. Última carga na faixa verificada -> "Sim"/"Não".
      4. Junta identificação (empresa, instituição, accountCode...).
    """
    data_criacao = extrair_data_criacao_do_wallet_id(wallet_id)
    dias_uteis_desde_criacao = (contexto["calendario"].dias_uteis_entre(data_criacao, contexto["hoje"])
                                if data_criacao else None)
    is_nova = dias_uteis_desde_criacao is not None and dias_uteis_desde_criacao < DIAS_UTEIS_SINALIZACAO_NOVA
    ultima_carga = contexto["ultima_carga"].get(wallet_id)
    company_id = carteira.get("companyId") or ""
    return {
        "walletId": wallet_id,
        "name": carteira.get("name") or "—",
        "companyId": company_id,
        "company": contexto["empresas_por_id"].get(company_id, {}).get("name") or company_id or "—",
        "institution": contexto["nomes_entidades"].get(carteira.get("entityId") or "") or "—",
        "accountCode": carteira.get("accountCode"),
        "startDateConsolidation": str(carteira.get("startDateConsolidation") or "")[:10] or None,
        "dataCriacao": data_criacao,
        "diasUteisDesdeCriacao": dias_uteis_desde_criacao,
        "isNova": is_nova,
        "diasUteisRestantesNova": (DIAS_UTEIS_SINALIZACAO_NOVA - dias_uteis_desde_criacao) if is_nova else None,
        "ultimaCarga": ultima_carga,
        "temCargaRecente": ultima_carga is not None,
    }


def ordenar_linhas_por_prioridade(linhas):
    """Contexto:
    Ordena a lista pra exibição: novas no topo (pedido do usuário:
    "priorizar exibição de novas carteiras"), depois as que estão recebendo
    carga (ativas, candidatas mais prováveis a entrar no Template), depois o
    resto. Retorna nova lista.

    Pseudocódigo:
      1. Nova primeiro; entre novas, a criada mais recentemente primeiro.
      2. Depois quem tem carga recente, a última carga mais recente primeiro.
      3. Desempate por empresa e nome.
    """
    def chave(linha):
        return (
            0 if linha["isNova"] else 1,
            linha["diasUteisDesdeCriacao"] if linha["isNova"] else 0,
            0 if linha["temCargaRecente"] else 1,
            _inverter_data_iso(linha["ultimaCarga"]),
            linha["company"].casefold(),
            linha["name"].casefold(),
        )
    return sorted(linhas, key=chave)


def _inverter_data_iso(data_iso):
    """Contexto: transforma "YYYY-MM-DD" num número que ordena da data mais
    recente pra mais antiga (sem data vai por último). Usada por
    ordenar_linhas_por_prioridade(). Retorna int."""
    if not data_iso:
        return 0
    return -int(data_iso.replace("-", ""))


def resumir_contagem(linhas):
    """Contexto: totais do cabeçalho da aba e do badge no botão da aba.
    Retorna dict {total, novas, comCargaRecente, semCargaRecente}."""
    com_carga = sum(1 for linha in linhas if linha["temCargaRecente"])
    return {
        "total": len(linhas),
        "novas": sum(1 for linha in linhas if linha["isNova"]),
        "comCargaRecente": com_carga,
        "semCargaRecente": len(linhas) - com_carga,
    }


def montar_resposta_carteiras_nao_cadastradas(hoje):
    """Contexto:
    Orquestra a busca e a regra da aba (buscar -> filtrar -> calcular ->
    ordenar). Chamada pela rota GET /api/carteiras-nao-cadastradas.
    Retorna o dict da resposta.

    Pseudocódigo:
      1. WalletIDs do Template (Excel) + catálogo de carteiras da API.
      2. Separa as não cadastradas.
      3. Busca nomes de instituição e a última carga na faixa de
         DIAS_CORRIDOS_VERIFICACAO_CARGA dias (só das não cadastradas).
      4. Monta, ordena e resume as linhas.
    """
    ids_do_template = {str(linha["walletId"]).strip() for linha in ler_linhas_do_template(XLSX_PATH)}
    empresas_por_id, _, carteiras_por_id, _ = db.carregar_colecoes_pequenas()
    nao_cadastradas = filtrar_carteiras_nao_cadastradas(carteiras_por_id, ids_do_template)

    data_inicial_carga = (dt.date.fromisoformat(hoje) - dt.timedelta(days=DIAS_CORRIDOS_VERIFICACAO_CARGA)).isoformat()
    contexto = {
        "empresas_por_id": empresas_por_id,
        "nomes_entidades": db.listar_nomes_entidades(),
        "ultima_carga": db.buscar_ultima_carga_por_carteira(list(nao_cadastradas), data_inicial_carga, hoje),
        "calendario": CalendarioDiasUteis(),
        "hoje": hoje,
    }
    linhas = ordenar_linhas_por_prioridade(
        [montar_linha_carteira(wid, carteira, contexto) for wid, carteira in nao_cadastradas.items()])
    return {
        "geradoEm": dt.datetime.now(_FUSO_BRT).strftime("%d/%m/%Y %H:%M"),
        "parametros": {
            "diasUteisSinalizacaoNova": DIAS_UTEIS_SINALIZACAO_NOVA,
            "diasVerificacaoCarga": DIAS_CORRIDOS_VERIFICACAO_CARGA,
            "dataInicialCarga": data_inicial_carga,
            "dataFinalCarga": hoje,
        },
        "contagem": resumir_contagem(linhas),
        "carteiras": linhas,
    }


# ─────────────────────────────────────────────────────────────
# 3. ROTAS (@bp.route) — só orquestram: chamam helpers e respondem
# ─────────────────────────────────────────────────────────────

@bp.route("/api/carteiras-nao-cadastradas", methods=["GET"])
def listar_carteiras_nao_cadastradas():
    """Contexto:
    Rota da aba "Carteiras Não Cadastradas" — chamada ao abrir a aba pela 1ª
    vez e no botão "Atualizar lista" dela. Devolve o dict de
    montar_resposta_carteiras_nao_cadastradas().

    Pseudocódigo:
      1. Monta a resposta com a data de hoje.
      2. Token ausente/expirado -> 401 com mensagem que diz o que fazer.
      3. Excel travado (aberto no Excel/OneDrive sincronizando) -> 409.
      4. Qualquer outra falha -> 500 com mensagem, nunca 500 cru.
    """
    try:
        return jsonify(montar_resposta_carteiras_nao_cadastradas(dt.date.today().isoformat()))
    except BeehusAuthError:
        return jsonify({"error": "Token da API Beehus ausente ou expirado — cole um token novo no "
                                 "botão \"🔑 Beehus API\" e clique em Atualizar lista."}), 401
    except PermissionError:
        return jsonify({"error": "Não consegui ler o TemplateCarteiras.xlsx — feche o arquivo no Excel "
                                 "(ou espere o OneDrive terminar de sincronizar) e tente de novo."}), 409
    except Exception as exc:  # pragma: no cover - defensivo, nunca 500 cru pro front
        return jsonify({"error": f"Falha ao montar a lista de carteiras não cadastradas: {exc}"}), 500
