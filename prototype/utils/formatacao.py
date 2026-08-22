# -*- coding: utf-8 -*-
"""
utils/formatacao.py — formatação de datas/horários para exibição.
====================================================================
Extraído de build_snapshot.py na refatoração de 2026-07-20 (CLAUDE.md §5).
A formatação de moeda/percentual/número da MATRIZ fica no front-end
(static/js/controle_cargas/state.js::fmtNum e exportar.js — dados já vêm
crus do Mongo e são formatados só na hora de desenhar a célula/tooltip);
aqui ficam os formatadores do lado Python, hoje só o de horário BRT.
"""

import datetime as dt

FUSO_BRT = dt.timezone(dt.timedelta(hours=-3))  # America/Sao_Paulo sem horário de verão


def formatar_horario_brt(timestamp_utc):
    """Contexto:
    Formata um datetime (UTC, como vem do Mongo/Mongoose `createdAt`/
    `updatedAt`) como "HH:MM" no fuso de Brasília — usado no tooltip da
    célula e no painel de detalhe (horário de carga/processamento/
    publicação). Retorna None se `timestamp_utc` for None (contrato:
    nunca lança exceção por causa de um campo ausente).

    Pseudocódigo:
      1. Se vier sem timezone (naive), assume UTC (padrão Mongoose).
      2. Converte para o fuso BRT e formata "HH:MM".
    """
    if timestamp_utc is None:
        return None
    if timestamp_utc.tzinfo is None:
        timestamp_utc = timestamp_utc.replace(tzinfo=dt.timezone.utc)
    return timestamp_utc.astimezone(FUSO_BRT).strftime("%H:%M")
