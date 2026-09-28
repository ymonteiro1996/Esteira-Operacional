"""Matriz do "Controle de Cargas" — CC-03, fase 3A (somente leitura).

[2026-09-27, pedido do usuário: "Controlar as cargas por Company – Instituição – Modelo de Carga –
Mensal/Diário ... uma métrica que diga se a carga foi efetivada ... mostrar primeiro os problemas com
mais carteiras afetadas" — aba nova aprovada pelo usuário (confirmação de arquitetura 2 do
docs/ESCOPO_MUDANCAS_2026-09.md)]

Uma linha por CHAVE `companyId | Instituição | Modelo de Carga | D/M` [o SLA chegou a entrar na chave
em 28/09 e saiu no mesmo dia — pedido do usuário: "a carência não deve virar chave, reverter"; ficou
como COLUNA filtrável, com as carências das carteiras da linha]; uma célula por dia da janela do
grid com a cobertura de carga das carteiras do Template daquela chave. Tudo sai das linhas de carteira
que o snapshot JÁ calculou (build_snapshot._montar_snapshot) — nenhuma chamada nova à API Beehus.

"Tem carga" num dia = a carteira tem Unprocessed/Processed naquele dia (mockkey wu/wc/cD/p). Sem
carga, o mockkey já diz se o prazo (dia + Defasagem) venceu ("miss") ou não ("wait").

Métrica (proposta D3 do escopo, "a confirmar" com o usuário):
  1. Dias úteis ANBIMA (o prazo já vem do calendário, em compute_cell).
  2. Carteira INATIVA sai do denominador: sem carga nos N du antes do dia avaliado (a janela de
     atividade termina ANTES do dia). Quando a janela do grid não cobre esses N du, vale ter tido
     carga em qualquer dia da janela. Carteira nova (início há menos de M du) nunca é inativa.
  3. Trava contra falha prolongada: nenhuma ativa, ou mais de X% das esperadas excluídas por
     inatividade -> "falha_prolongada" (um feed inteiro parado não pode aparecer como OK por 0/0).
  4. Níveis: ok (0 faltantes), parcial (1 faltante ou cobertura >= 95%), falha (resto);
     aguardando (ninguém venceu o prazo ainda e falta carga).
  5. Mensais: avaliadas só no último dia útil do mês (e só até o D0), com prazo = fim do mês +
     du Recebimento PDF + du Upload Beehus. Nos outros dias: "nao_avaliada". A regra 2 (inativa)
     NÃO vale para elas: carteira mensal só recebe carga no fechamento, então "sem carga nos N du
     antes" é o normal dela (achado rodando sobre um snapshot real: todas as mensais viravam
     inativas e a linha caía em falha prolongada).
  6. Onboarding: carteira nova que ainda não teve a 1ª carga na janela aparece à parte, não como
     falha do feed.

Parâmetros em data/controle_cargas_config.json (CLAUDE.md §10), com padrão embutido.
"""
import json
from collections import defaultdict
from pathlib import Path

# ─────────────────────────────────────────────────────────────
# 1. CONFIGURAÇÃO
# ─────────────────────────────────────────────────────────────

NOME_ARQUIVO_CONFIG = "controle_cargas_config.json"

CONFIG_PADRAO = {
    "diasAtividadeDu": 5,            # carteira sem carga nos N du antes do dia = inativa
    "diasCarteiraNovaDu": 5,         # início há menos de N du = nova (nunca inativa)
    "limiteExcluidasPct": 50,        # > X% das esperadas excluídas por inatividade = falha prolongada
    "coberturaParcialPct": 95,       # cobertura >= X% = parcial (ainda que com mais de 1 faltante)
    "faltantesParcialMax": 1,        # até N faltantes = parcial
    # Fase 3C (disparo da carga) — [D1 e D2 respondidos pelo usuário em 2026-09-27]
    "disparo": {
        "maxDiasUteisFaixa": 10,     # D1: faixa De/Até de no máximo 10 du, uma chamada por data
        "defasagemPorInstituicao": {"XP": 3},   # D2: só a XP manda "data do problema + 3 du"
    },
}

MOCKKEYS_COM_CARGA = ("wu", "wc", "cD", "p")

NIVEL_OK = "ok"
NIVEL_PARCIAL = "parcial"
NIVEL_FALHA = "falha"
NIVEL_FALHA_PROLONGADA = "falha_prolongada"
NIVEL_AGUARDANDO = "aguardando"
NIVEL_NAO_AVALIADA = "nao_avaliada"
NIVEIS_COM_PROBLEMA = (NIVEL_PARCIAL, NIVEL_FALHA, NIVEL_FALHA_PROLONGADA)


def carregar_config_cargas(data_dir):
    """Contexto:
    Lê os parâmetros da métrica de data/controle_cargas_config.json, mesclados por cima do padrão
    embutido. Chamada 1x por montagem de snapshot. Retorna dict (nunca falha: arquivo ausente ou
    JSON quebrado caem no padrão).

    Pseudocódigo:
      1. Parte de uma cópia do padrão (inclusive o sub-dict "disparo").
      2. Se o arquivo existir e for JSON válido, sobrepõe as chaves presentes.
    """
    config = json.loads(json.dumps(CONFIG_PADRAO))
    caminho = Path(data_dir) / NOME_ARQUIVO_CONFIG
    try:
        if caminho.exists():
            with open(caminho, "r", encoding="utf-8") as arquivo:
                lido = json.load(arquivo) or {}
            disparo = lido.pop("disparo", None)
            config.update(lido)
            if isinstance(disparo, dict):
                config["disparo"].update(disparo)
    except (OSError, ValueError):
        pass
    return config


# ─────────────────────────────────────────────────────────────
# 2. REGRAS DA MÉTRICA (funções puras)
# ─────────────────────────────────────────────────────────────

def rotulo_sla(linha_carteira):
    """Contexto:
    SLA da carteira como aparece na coluna SLA [2026-09-28]: diária = a Defasagem EFETIVA (a que gera
    o prazo, inclusive a herdada da explosão), no formato do Template ("D-1", "D-3"); mensal = "M+n du"
    com n = du Recebimento PDF + du Upload Beehus (o prazo do fechamento), ou "M" sem esses campos.
    Retorna string.

    Pseudocódigo: 1. Mensal -> "M+n du"/"M". 2. Diária -> "D-<defasagem efetiva>".
    """
    if linha_carteira.get("monthly"):
        pdf, upload = linha_carteira.get("slaPdfReceiptDu"), linha_carteira.get("slaUploadDu")
        if pdf is None and upload is None:
            return "M"
        return f"M+{(pdf or 0) + (upload or 0)} du"
    defasagem = linha_carteira.get("lagBizDaysEfetiva", linha_carteira.get("lagBizDays"))
    return f"D-{defasagem or 0}"


def montar_chave_carga(linha_carteira):
    """Contexto:
    Chave da linha da matriz — também é o targetId de comentários e anotações ('carga').
    Retorna string "companyId|Instituição|Modelo|D" (ou "|M").
    [2026-09-28] O SLA entrou e saiu da chave no mesmo dia ("a carência não deve virar chave"): a
    chave voltou aos 4 campos, e as anotações/comentários gravados com ela voltam a aparecer.

    Pseudocódigo:
      1. Junta companyId, instituição, modelo de carga e D/M com "|".
    """
    periodicidade = "M" if linha_carteira.get("monthly") else "D"
    return "|".join([
        str(linha_carteira.get("companyId") or ""),
        (linha_carteira.get("institution") or "").strip() or "—",
        (linha_carteira.get("loadModel") or "").strip() or "—",
        periodicidade,
    ])


def slas_das_carteiras(carteiras):
    """Contexto:
    As carências (rotulo_sla) das carteiras de uma linha, sem repetir, em ordem (D-1 antes de D-3;
    mensais depois). É a coluna SLA e o que o filtro dela compara. Retorna [str].

    Pseudocódigo: 1. Rótulo de cada carteira. 2. Distintos, ordenados pelo número de du.
    """
    def ordem(rotulo):
        numero = "".join(ch for ch in rotulo if ch.isdigit())
        return (rotulo.startswith("M"), int(numero) if numero else 0, rotulo)
    return sorted({rotulo_sla(c) for c in carteiras}, key=ordem)


def agrupar_carteiras_por_chave(linhas_carteiras):
    """Contexto:
    Separa as linhas de carteira do snapshot pelas chaves da matriz. Retorna dict
    {chave: [linha de carteira, ...]} na ordem em que as carteiras chegaram.

    Pseudocódigo:
      1. Para cada carteira, calcula a chave e acrescenta no balde dela.
    """
    por_chave = defaultdict(list)
    for linha in linhas_carteiras:
        por_chave[montar_chave_carga(linha)].append(linha)
    return por_chave


def _data_inicio(linha_carteira):
    """Contexto: início de consolidação da carteira como "AAAA-MM-DD" (a API manda ISO com hora),
    ou None. Retorna string/None.

    Pseudocódigo: 1. Corta os 10 primeiros caracteres quando houver valor.
    """
    inicio = linha_carteira.get("startDateConsolidation")
    return str(inicio)[:10] if inicio else None


def datas_com_carga(linha_carteira):
    """Contexto: conjunto de dias da janela em que a carteira tem carga (Unp/Pro/Pub). Retorna set.

    Pseudocódigo: 1. Filtra as células cujo mockkey é de carga.
    """
    return {c["d"] for c in linha_carteira.get("cells") or [] if c.get("s") in MOCKKEYS_COM_CARGA}


def carteira_e_nova(linha_carteira, data, calendario, config):
    """Contexto: a carteira começou há menos de `diasCarteiraNovaDu` du de `data`? Retorna bool.

    Pseudocódigo:
      1. Sem data de início -> não é nova.
      2. Conta os du entre o início e `data`; menos que o limite (e não negativo) = nova.
    """
    inicio = _data_inicio(linha_carteira)
    if not inicio or inicio > data:
        return False
    return calendario.dias_uteis_entre(inicio, data) < config["diasCarteiraNovaDu"]


def carteira_ativa_na_data(dias_com_carga, data, janela, config):
    """Contexto:
    Decide se a carteira conta no denominador de `data` (regra 2 da métrica). Retorna bool.

    Pseudocódigo:
      1. Dias da janela ANTES de `data` (a janela de atividade termina antes do dia avaliado).
      2. Se há pelo menos `diasAtividadeDu` deles: ativa = teve carga em algum dos N últimos.
      3. Se a janela não cobre os N du: ativa = teve carga em qualquer dia da janela.
    """
    anteriores = [d for d in janela if d < data]
    n_dias = config["diasAtividadeDu"]
    if len(anteriores) >= n_dias:
        return any(d in dias_com_carga for d in anteriores[-n_dias:])
    return bool(dias_com_carga)


def situacao_carteira_mensal(linha_carteira, data, calendario, data_hoje):
    """Contexto:
    Situação de uma carteira MENSAL no fechamento do mês `data`: tem carga, sem carga no prazo ou
    sem carga vencida. Prazo = fim do mês + du Recebimento PDF + du Upload Beehus. Retorna
    "carga" | "aguardando" | "faltante".

    Pseudocódigo:
      1. Tem carga no dia -> "carga".
      2. Senão calcula o prazo mensal; hoje antes do prazo -> "aguardando", senão "faltante".
    """
    if data in datas_com_carga(linha_carteira):
        return "carga"
    prazo = calendario.prazo_regime_mensal(
        data, linha_carteira.get("slaPdfReceiptDu"), linha_carteira.get("slaUploadDu"))
    return "aguardando" if calendario.dias_uteis_entre(prazo, data_hoje) < 0 else "faltante"


def celula_da_carteira(linha_carteira, data):
    """Contexto: a célula (dict do snapshot) da carteira no dia, ou {}. Retorna dict."""
    return next((c for c in linha_carteira.get("cells") or [] if c.get("d") == data), {})


def situacao_carteira_diaria(linha_carteira, data):
    """Contexto: situação de uma carteira DIÁRIA no dia `data`, lida do mockkey que o snapshot já
    calculou (o prazo com Defasagem já está nele). Retorna "carga" | "aguardando" | "faltante".

    Pseudocódigo:
      1. Mockkey de carga -> "carga"; "wait" -> "aguardando"; resto -> "faltante".
    """
    mockkey = celula_da_carteira(linha_carteira, data).get("s")
    if mockkey in MOCKKEYS_COM_CARGA:
        return "carga"
    return "aguardando" if mockkey == "wait" else "faltante"


def e_fechamento_do_mes(data, calendario):
    """Contexto: `data` é o último dia útil do mês dela? Retorna bool.

    Pseudocódigo: 1. Compara com calendario.ultimo_dia_util_do_mes(ano, mes).
    """
    ano, mes = int(data[:4]), int(data[5:7])
    return calendario.ultimo_dia_util_do_mes(ano, mes) == data


def classificar_nivel(com_carga, faltantes, aguardando, ativas, excluidas, esperadas, config):
    """Contexto:
    Converte as contagens de 1 célula no nível da métrica (regras 3 e 4). Retorna (nivel, cobertura),
    com cobertura em 0..1 ou None quando ninguém venceu o prazo ainda.

    Pseudocódigo:
      1. Trava: há esperadas mas nenhuma ativa, ou excluídas acima do limite -> falha_prolongada.
      2. Cobertura = com carga / (com carga + faltantes).
      3. Ninguém faltando e alguém ainda no prazo -> aguardando (só quando não há faltante).
      4. 0 faltantes -> ok; até N faltantes ou cobertura >= X% -> parcial; senão falha.
    """
    if esperadas and (ativas == 0 or excluidas * 100 > config["limiteExcluidasPct"] * esperadas):
        return NIVEL_FALHA_PROLONGADA, None
    vencidas = com_carga + faltantes
    cobertura = (com_carga / vencidas) if vencidas else None
    if faltantes == 0:
        return (NIVEL_AGUARDANDO if aguardando else NIVEL_OK), cobertura
    if faltantes <= config["faltantesParcialMax"] or cobertura * 100 >= config["coberturaParcialPct"]:
        return NIVEL_PARCIAL, cobertura
    return NIVEL_FALHA, cobertura


def montar_celula_carga(carteiras, data, janela, calendario, data_hoje, config, mensal):
    """Contexto:
    Monta 1 célula da matriz (1 chave × 1 dia): contagens, nível e as listas de walletId que o
    clique na célula mostra. Retorna dict.

    Pseudocódigo:
      1. Mensal fora do fechamento do mês (ou depois do D0) -> "nao_avaliada".
      2. Para cada carteira: ignora as que ainda não começaram; separa inativas (regra 2, só nas
         diárias),
         onboarding (nova sem nenhuma carga até o dia) e, entre as ativas, carga/aguardando/faltante.
      3. Classifica o nível e devolve contagens + listas.
    """
    if mensal and (not e_fechamento_do_mes(data, calendario) or data > data_hoje):
        return {"d": data, "nivel": NIVEL_NAO_AVALIADA}

    listas = {"faltantes": [], "aguardando": [], "onboarding": [], "inativas": []}
    esperadas = com_carga = 0
    # [2026-09-28, pedido do usuário: "Sinalização de Pauta dia igual Carteira"] Pauta = o dia da
    # Defasagem é hoje (D0) para a carteira — o mesmo overlay 'pauta' que a aba Carteiras mostra;
    # 'seq' junto = D-1 sem processada (anel vermelho, CC-05). Conta entre as esperadas.
    em_pauta = pauta_sem_d1 = 0
    for carteira in carteiras:
        inicio = _data_inicio(carteira)
        if inicio and inicio > data:
            continue   # ainda não começou: não é esperada neste dia
        esperadas += 1
        overlays = celula_da_carteira(carteira, data).get("ov") or []
        if "pauta" in overlays:
            em_pauta += 1
            if "seq" in overlays:
                pauta_sem_d1 += 1
        dias_com_carga = datas_com_carga(carteira)
        nova = carteira_e_nova(carteira, data, calendario, config)
        if not mensal and not nova and not carteira_ativa_na_data(dias_com_carga, data, janela, config):
            listas["inativas"].append(carteira["walletId"])
            continue
        situacao = (situacao_carteira_mensal(carteira, data, calendario, data_hoje) if mensal
                    else situacao_carteira_diaria(carteira, data))
        if situacao == "carga":
            com_carga += 1
        elif nova and not any(d <= data for d in dias_com_carga):
            listas["onboarding"].append(carteira["walletId"])
        elif situacao == "aguardando":
            listas["aguardando"].append(carteira["walletId"])
        else:
            listas["faltantes"].append(carteira["walletId"])

    ativas = esperadas - len(listas["inativas"])
    nivel, cobertura = classificar_nivel(
        com_carga, len(listas["faltantes"]), len(listas["aguardando"]), ativas,
        len(listas["inativas"]), esperadas, config)
    return {
        "d": data, "nivel": nivel, "cobertura": cobertura,
        "esperadas": esperadas, "ativas": ativas, "comCarga": com_carga,
        "nFaltantes": len(listas["faltantes"]), "nAguardando": len(listas["aguardando"]),
        "nOnboarding": len(listas["onboarding"]), "nInativas": len(listas["inativas"]),
        "pauta": em_pauta > 0, "nPauta": em_pauta, "pautaSemD1": pauta_sem_d1 > 0,
        **listas,
    }


def dias_seguidos_com_problema(celulas):
    """Contexto: quantos dias seguidos, contando para trás a partir do último dia da janela (a
    referência), a linha está com problema. Critério de desempate da ordenação. Retorna int.

    Pseudocódigo:
      1. Anda de trás pra frente pulando "nao_avaliada"; para no 1º dia sem problema.
    """
    seguidos = 0
    for celula in reversed(celulas):
        if celula["nivel"] == NIVEL_NAO_AVALIADA:
            continue
        if celula["nivel"] not in NIVEIS_COM_PROBLEMA:
            break
        seguidos += 1
    return seguidos


def faltantes_para_ordenar(celula):
    """Contexto: nº de carteiras afetadas usado na ordenação; falha prolongada conta todas as
    esperadas (senão o feed inteiro parado cairia pro fim da lista). Retorna int.

    Pseudocódigo: 1. Falha prolongada -> esperadas; senão nFaltantes (0 quando não avaliada).
    """
    if celula["nivel"] == NIVEL_FALHA_PROLONGADA:
        return celula.get("esperadas", 0)
    return celula.get("nFaltantes", 0)


def celula_da_referencia(celulas):
    """Contexto: a célula mais recente que foi avaliada (a de referência; para mensais, o último
    fechamento de mês da janela). Retorna dict ou None.

    Pseudocódigo: 1. Último item que não seja "nao_avaliada".
    """
    return next((c for c in reversed(celulas) if c["nivel"] != NIVEL_NAO_AVALIADA), None)


def montar_linha_carga(chave, carteiras, janela, calendario, data_hoje, config):
    """Contexto:
    Monta 1 linha da matriz a partir das carteiras da chave. Retorna dict (metadados da chave +
    células + campos de ordenação).

    Pseudocódigo:
      1. Metadados vêm da 1ª carteira (todas compartilham a chave).
      2. Uma célula por dia da janela (montar_celula_carga).
      3. Faltantes na referência + dias seguidos com problema para a ordenação.
    """
    primeira = carteiras[0]
    mensal = bool(primeira.get("monthly"))
    celulas = [montar_celula_carga(carteiras, d, janela, calendario, data_hoje, config, mensal)
               for d in janela]
    referencia = celula_da_referencia(celulas)
    return {
        "key": chave,
        "company": primeira.get("company"),
        "companyId": primeira.get("companyId"),
        "institution": (primeira.get("institution") or "").strip() or "—",
        "loadModel": (primeira.get("loadModel") or "").strip() or "—",
        "isManualLoad": bool(primeira.get("isManualLoad")),
        "periodicity": "M" if mensal else "D",
        # [2026-09-28] carências das carteiras da linha (não é mais chave): coluna + filtro.
        "slas": slas_das_carteiras(carteiras),
        "sla": ", ".join(slas_das_carteiras(carteiras)),
        "totalWallets": len(carteiras),
        "cells": celulas,
        "faltantesRef": faltantes_para_ordenar(referencia) if referencia else 0,
        "diasSeguidosProblema": dias_seguidos_com_problema(celulas),
    }


def ordenar_linhas_carga(linhas):
    """Contexto: ordem da matriz (regra do pedido: mais carteiras afetadas primeiro). Ordena a lista
    no lugar e a devolve.

    Pseudocódigo:
      1. Faltantes na referência (decrescente), dias seguidos com problema (decrescente), depois
         Company, Instituição, Modelo e D/M em ordem alfabética.
    """
    linhas.sort(key=lambda l: (-l["faltantesRef"], -l["diasSeguidosProblema"],
                               (l["company"] or "").casefold(), l["institution"].casefold(),
                               l["loadModel"].casefold(), l["periodicity"]))
    return linhas


# ─────────────────────────────────────────────────────────────
# 3. ORQUESTRAÇÃO (chamada pelo build do snapshot)
# ─────────────────────────────────────────────────────────────

def montar_matriz_cargas(linhas_carteiras, janela, calendario, data_hoje, config):
    """Contexto:
    Monta `snapshot["cargas"]` a partir das linhas de carteira já calculadas. Chamada 1x por
    _montar_snapshot() (build_snapshot.py). Retorna dict {linhas, parametros}.

    Pseudocódigo:
      1. Agrupa as carteiras por chave.
      2. Monta e ordena as linhas.
      3. Devolve junto os parâmetros usados (a tela mostra na legenda).
    """
    por_chave = agrupar_carteiras_por_chave(linhas_carteiras)
    linhas = [montar_linha_carga(chave, carteiras, janela, calendario, data_hoje, config)
              for chave, carteiras in por_chave.items()]
    return {"linhas": ordenar_linhas_carga(linhas), "parametros": config}
