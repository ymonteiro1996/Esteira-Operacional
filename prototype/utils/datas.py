# -*- coding: utf-8 -*-
"""
utils/datas.py — calendário de dias úteis (ANBIMA) e cálculo de prazos/SLA.
============================================================================
Funções genéricas de data/dias-úteis, usadas por várias camadas do projeto
(snapshot_builder.py, db.py, app.py). Extraído de build_snapshot.py na
refatoração de 2026-07-20 (CLAUDE.md §5 — pasta utils/ para helpers
reutilizáveis; nada aqui é específico de uma tela).

Todas as datas são strings "YYYY-MM-DD" (comparação lexicográfica funciona
em range queries do Mongo — ver PLANNING.md §MongoDB Collections Reference).
"""

import datetime as dt

# janela inicial exibida quando a tela abre (Tarefa 2 do refactor 2026-07-20:
# era N_WINDOW_DAYS=14, o desenvolvedor pediu bem mais enxuto — só 5 dias
# úteis pra trás da data de referência D-3). Configurável aqui, não hardcoded
# no meio da lógica de nenhuma rota/função.
# [REVISADO 2026-07-22, pedido do usuário] Antes, este número era a
# CONTAGEM TOTAL de dias úteis da janela (ex.: 5 = referência + 4 anteriores).
# Agora é o DESLOCAMENTO em du entre data_inicial e data_final: data_inicial =
# data_final − JANELA_INICIAL_DIAS_UTEIS du (ver calcular_janela_grid()) — a
# janela default passou a ter 6 dias úteis (data_final e os 5 du anteriores).
JANELA_INICIAL_DIAS_UTEIS = 5

# [REVISADO 2026-07-24, pedido do usuário] Era D-3; passou pra D-5 em
# 2026-07-23; voltou pra D-3 em 2026-07-24 ("ajustar o até do Range inicial
# para D-3") — só afeta QUAL dia é tratado como "referência" (coluna ▾ ref,
# janela default, data em foco default dos painéis "Publicadas") e o rótulo
# exibido; SLA/atraso continuam calculados contra o hoje REAL
# (dt.date.today()), nunca contra esta referência — ver compute_cell() em
# snapshot_builder.py.
GRID_REFERENCE_LAG_DU = 3  # "hoje" do grid = hoje real - 3 dias úteis (PLANNING §Grid)


class CalendarioDiasUteis:
    """Contexto:
    Wrapper fino sobre `bizdays.Calendar("ANBIMA")` (feriados B3/ANBIMA
    embutidos), com fallback documentado para segunda-sexta sem feriados
    quando o pacote `bizdays` não está instalável. Todos os métodos recebem/
    devolvem strings "YYYY-MM-DD". Usado por snapshot_builder.py (SLA/
    expectativa de cada célula) e por db.py (montar a janela do grid).

    Pseudocódigo (construtor):
      1. Tenta carregar `bizdays.Calendar("ANBIMA")`.
      2. Se falhar (pacote ausente/erro de carga), cai para um cálculo
         manual seg-sex (sem feriados) e marca `self.fallback = True` —
         avisar isso claramente no relatório final (ver PLANNING.md
         §Calendário de Dias Úteis, "Fallback/manutenção").
    """

    def __init__(self):
        try:
            from bizdays import Calendar
            self.calendario = Calendar.load("ANBIMA")
            self.fonte = "bizdays ANBIMA (feriados B3/ANBIMA embutidos)"
            self.fallback = False
        except Exception as exc:
            self.calendario = None
            self.fonte = f"FALLBACK seg-sex sem feriados (bizdays indisponível: {exc})"
            self.fallback = True

    def dias_uteis_entre(self, data_inicial, data_final):
        """Contexto: nº de dias úteis entre duas datas (positivo se
        data_inicial < data_final, negativo se invertido). Usado para medir
        atraso (data-limite vs. hoje).

        Pseudocódigo:
          1. Se o calendário ANBIMA carregou, delega pra ele.
          2. Senão (fallback), conta dias corridos ignorando sáb/dom.
        """
        if not self.fallback:
            return self.calendario.bizdays(data_inicial, data_final)
        a = dt.date.fromisoformat(data_inicial)
        b = dt.date.fromisoformat(data_final)
        sinal = 1
        if a > b:
            a, b, sinal = b, a, -1
        n = 0
        cur = a
        while cur < b:
            cur += dt.timedelta(days=1)
            if cur.weekday() < 5:
                n += 1
        return n * sinal

    def deslocar(self, data, n_dias_uteis):
        """Contexto: desloca `data` em `n_dias_uteis` (pode ser negativo).
        Usado para calcular prazos (deadline = data + Defasagem du) e a
        janela do grid (ref = hoje - lag du).

        Pseudocódigo:
          1. bizdays.Calendar.offset devolve datetime.date, não string —
             conversão explícita obrigatória (senão o pymongo falha ao
             serializar a query, já que BSON não aceita datetime.date cru).
          2. Fallback: anda dia a dia pulando fins de semana.
        """
        if not self.fallback:
            resultado = self.calendario.offset(data, n_dias_uteis)
            return resultado.isoformat() if hasattr(resultado, "isoformat") else str(resultado)
        cur = dt.date.fromisoformat(data)
        passo = 1 if n_dias_uteis > 0 else -1
        restante = abs(n_dias_uteis)
        while restante > 0:
            cur += dt.timedelta(days=passo)
            if cur.weekday() < 5:
                restante -= 1
        return cur.isoformat()

    def ultimo_dia_util_do_mes(self, ano, mes):
        """Contexto: último dia útil de um mês/ano — usado no regime mensal
        (SLA = fechamento do mês + du somados, ver PLANNING §Fontes de
        Cadastro "regime mensal").

        Pseudocódigo:
          1. Calendário ANBIMA: `getdate("last bizday", ano, mes)`.
          2. Fallback: primeiro dia do mês seguinte - 1, recuando enquanto
             cair em fim de semana.
        """
        if not self.fallback:
            data = self.calendario.getdate("last bizday", ano, mes)
            return data.isoformat() if hasattr(data, "isoformat") else str(data)
        if mes == 12:
            proximo = dt.date(ano + 1, 1, 1)
        else:
            proximo = dt.date(ano, mes + 1, 1)
        cur = proximo - dt.timedelta(days=1)
        while cur.weekday() >= 5:
            cur -= dt.timedelta(days=1)
        return cur.isoformat()

    def sequencia_dias_uteis(self, data_inicial, data_final):
        """Contexto: lista de dias úteis (strings), inclusive, entre as duas
        datas — usado para montar a janela de colunas do grid.

        Pseudocódigo:
          1. Delega ao calendário ANBIMA quando disponível.
          2. Fallback: percorre dia a dia, filtrando fins de semana.
        """
        if not self.fallback:
            return [x.isoformat() if hasattr(x, "isoformat") else str(x)
                    for x in self.calendario.seq(data_inicial, data_final)]
        a = dt.date.fromisoformat(data_inicial)
        b = dt.date.fromisoformat(data_final)
        out = []
        cur = a
        while cur <= b:
            if cur.weekday() < 5:
                out.append(cur.isoformat())
            cur += dt.timedelta(days=1)
        return out

    def data_referencia(self, data_hoje, lag_dias_uteis):
        """Contexto: "hoje" do grid = hoje real − lag dias úteis (PLANNING
        "Data de referência do grid: travada em D-3"). Retorna string.

        Pseudocódigo:
          1. Apenas delega para deslocar() com n negativo.
        """
        return self.deslocar(data_hoje, -lag_dias_uteis)

    def prazo_regime_diario(self, data, defasagem_dias_uteis):
        """Contexto: prazo (deadline) do regime diário = data da coluna +
        Defasagem dias úteis (coluna I do cadastro). Retorna string.

        Pseudocódigo:
          1. Delega para deslocar().
        """
        return self.deslocar(data, defasagem_dias_uteis)

    def prazo_regime_mensal(self, fim_do_mes, sla_recebimento_pdf_du, sla_upload_beehus_du):
        """Contexto: prazo do regime mensal = último dia útil do mês +
        (recebimento + upload) dias úteis SOMADOS (PLANNING §Fontes de
        Cadastro "regime mensal"). Retorna string.

        Pseudocódigo:
          1. Soma os dois SLAs (tratando None como 0).
          2. Desloca o fim do mês por essa soma.
        """
        total_du = (sla_recebimento_pdf_du or 0) + (sla_upload_beehus_du or 0)
        return self.deslocar(fim_do_mes, total_du)


def calcular_janela_grid(calendario, data_hoje, lag_dias_uteis=GRID_REFERENCE_LAG_DU,
                          deslocamento_dias_uteis=JANELA_INICIAL_DIAS_UTEIS):
    """Contexto:
    Calcula (data_referencia, janela_de_datas) — data_final = data_referencia
    (hoje − lag_dias_uteis, D-3 [REVISADO 2026-07-24, pedido do usuário — foi
    D-5 por 1 dia, voltou pra D-3]) e data_inicial = data_final −
    deslocamento_dias_uteis (5 du da final, [REVISADO 2026-07-22, pedido do
    usuário]). Usada tanto na 1ª carga da tela (janela default) quanto para
    validar/complementar uma janela customizada pedida pelo usuário via campos
    de data (ver app.py /api/atualizar).

    Pseudocódigo:
      1. Calcula a data de referência/final (hoje − lag_dias_uteis).
      2. Desloca `deslocamento_dias_uteis` du pra trás a partir dela -> data
         inicial.
      3. Gera a sequência de dias úteis (inclusive) entre inicial e final —
         essa é a janela default.
      4. Retorna (data_referencia, janela).
    """
    data_referencia = calendario.data_referencia(data_hoje, lag_dias_uteis)
    data_inicial = calendario.deslocar(data_referencia, -deslocamento_dias_uteis)
    janela = calendario.sequencia_dias_uteis(data_inicial, data_referencia)
    return data_referencia, janela
