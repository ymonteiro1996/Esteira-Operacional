# -*- coding: utf-8 -*-
"""
build_snapshot.py — Controle de Cargas (protótipo): orquestrador do snapshot.
================================================================================
Lê o cadastro de carteiras (TemplateCarteiras.xlsx) + consulta a API Beehus
[2026-08-05, migrado do MongoDB direto — ver db.py] e monta o snapshot da
matriz carteira x dia útil (estágio, severidade, overlays, SLA, ordenação por
prioridade) pronto para o front-end consumir via fetch('snapshot.json')
(servido pelo app.py).

Refatoração de 2026-07-20 (CLAUDE.md): este arquivo virou um ORQUESTRADOR
fino — a lógica pesada foi separada em módulos por camada:
  - db.py              → acesso à API Beehus (única porta de entrada, cache-aware;
                          [2026-08-05] acesso direto ao Mongo removido por completo)
  - registry.py        → leitura/validação do cadastro (Excel)
  - snapshot_builder.py→ regra de negócio (estágio/severidade/prioridade)
  - excel_report.py    → formatação do relatório .xlsx
  - utils/datas.py     → calendário de dias úteis / prazos
  - utils/formatacao.py→ formatação de horário BRT
  - cache.py           → cache em memória por data + TTL (Tarefa 3)

Tarefa 2 do refactor (janela inicial enxuta): a consulta inicial agora busca
só `JANELA_INICIAL_DIAS_UTEIS` (5 du, ver utils/datas.py) dias úteis para
trás da data de referência (D-3, ver `GRID_REFERENCE_LAG_DU` — foi D-5 por 1
dia, 2026-07-23 a 2026-07-24), em vez dos 14 du de antes. O usuário pode pedir
uma janela diferente pelos campos de data da tela (que chamam
`montar_snapshot(data_inicial=..., data_final=...)` via app.py /api/atualizar)
— [2026-08-05, pedido do usuário: "pode travar para 5DU"] travada no mesmo
teto de 5 du (JANELA_MAXIMA_DIAS_UTEIS, ver app.py), porque cada dia além
desse teto agora custa chamadas reais à API por empresa, não apenas mais
resultado de uma query Mongo já feita.

Nenhuma escrita — 100% leitura: lotes por empresa (a API Beehus é escopada
por companyId — ver db.py `_agrupar_por_empresa`), projeção mínima, cache
por data (mesma estratégia de antes, só a fonte trocou).
"""

import os
import json
import time
import datetime as dt
from collections import defaultdict

import db
from registry import ler_linhas_do_template, montar_registry_validado
from snapshot_builder import (
    compute_wallet_row, compute_groupings_rows, definir_limiares_divergencia,
    mapear_carteiras_compradas,
    LIMIAR_DIVERGENCIA_PADRAO, LIMIAR_DIVERGENCIA_REAIS_PADRAO,
)
from utils.datas import CalendarioDiasUteis, calcular_janela_grid, GRID_REFERENCE_LAG_DU
from excel_report import write_excel_report

# Ingestão do ControleUpload.xlsx (aba "Controle de Cargas" — custodiantes).
# Módulo separado de propósito: fonte de dado TOTALMENTE diferente do resto
# (Excel manual de OUTRA pessoa, fora do projeto, somente leitura — nunca
# escrever nele; ver docstring de custodian_upload.py).
from custodian_upload import load_controle_upload

# ─────────────────────────────────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────────────────────────────────

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(HERE, "data")

# [REVISADO 2026-07-28, pedido do usuário: "traga os arquivos externo que a
# rotina usa para esse diretório, exclui da minha máquina pessoal"] Antes
# apontava pro OneDrive PESSOAL do usuário (conta "OIkos FAMILY OFFICE",
# fora do OneDrive corporativo Beehus onde este projeto vive):
#   r"C:\Users\efigueira\OneDrive - OIkos FAMILY OFFICE\Área de Trabalho
#   \Melhorias Esteira Processamento\TemplateCarteiras.xlsx"
# Migrado para dentro do projeto (data/ — mesma pasta de
# alert_comments.json/wallet_annotations.json, já coberta pelas mesmas
# regras de "dados reais de cliente" do CLAUDE.md §9); o arquivo original
# foi apagado da conta pessoal depois da migração confirmada. A PARTIR DE
# AGORA o cadastro deve ser editado direto em data/TemplateCarteiras.xlsx
# (nunca mais no OneDrive pessoal).
XLSX_PATH = os.path.join(DATA_DIR, "TemplateCarteiras.xlsx")
SNAPSHOT_JSON_PATH = os.path.join(HERE, "snapshot.json")
HTML_TEMPLATE_PATH = os.path.join(HERE, "index_template.html")
HTML_OUTPUT_PATH = os.path.join(HERE, "index.html")


def _carregar_registry(timings):
    """Contexto:
    Passo [1/6] de montar_snapshot(): lê o Excel do cadastro + valida contra
    as coleções pequenas da API Beehus. Chamada uma vez por execução (CLI ou
    /api/atualizar). Devolve (registry, registry_por_id, wallet_ids,
    empresas_por_id, agrupamentos_por_id, orfas).

    Pseudocódigo:
      1. Lê as linhas cruas do TemplateCarteiras.xlsx.
      2. Carrega companies/entities/wallets/groupings da API Beehus (cache TTL).
      3. Valida as linhas contra essas coleções (registry.py).
      4. Deriva registry_por_id e a lista de wallet_ids a partir do registry.
    """
    linhas = ler_linhas_do_template(XLSX_PATH)
    empresas_por_id, entidades_por_nome_ci, carteiras_por_id, agrupamentos_por_id = \
        db.carregar_colecoes_pequenas(timings)
    registry, orfas = montar_registry_validado(
        linhas, carteiras_por_id, entidades_por_nome_ci, empresas_por_id, agrupamentos_por_id)
    registry_por_id = {w["walletId"]: w for w in registry}
    wallet_ids = list(registry_por_id.keys())
    return registry, registry_por_id, wallet_ids, empresas_por_id, agrupamentos_por_id, orfas


def _ler_controle_upload_custodiantes():
    """Contexto:
    Passo [5/6] de montar_snapshot(): lê o ControleUpload.xlsx (best-effort —
    Excel externo, mantido por outra pessoa, só leitura). Se falhar, devolve
    None em vez de derrubar o build inteiro (as abas Carteiras/Agrupamentos
    não podem ser reféns de um Excel externo). Retorna o bloco
    `custodianUpload` ou None.

    Pseudocódigo:
      1. Tenta ler e devolver o bloco via load_controle_upload().
      2. Em qualquer exceção, loga um aviso e devolve None.
    """
    try:
        bloco = load_controle_upload()
        print(f"      {len(bloco['rows'])} custodiantes × {len(bloco['dates'])} datas · "
              f"células: {bloco['counts']} · última data com dado: {bloco['lastDateWithData']}")
        return bloco
    except Exception as exc:
        print(f"      AVISO: falha ao ler ControleUpload.xlsx ({exc}) — snapshot sai sem a aba.")
        return None


def montar_snapshot(data_inicial=None, data_final=None, forcar_atualizacao=False,
                     limiar_divergencia_pct=None, limiar_divergencia_reais=None):
    """Contexto:
    Ponto de entrada principal — monta o snapshot completo (mesma estrutura
    de sempre: meta/wallets/groupings/custodianUpload). Se `data_inicial`/
    `data_final` não forem passados, usa a janela DEFAULT enxuta (5 dias
    úteis terminando em D-3 — Tarefa 2 do refactor; foi D-5 por 1 dia,
    2026-07-23 a 2026-07-24, pedido do usuário). Se passados (rota
    /api/atualizar), usa exatamente esse intervalo — permitindo ao usuário
    pedir uma janela maior/diferente sem precisar rodar o script inteiro de
    novo por fora.

    `forcar_atualizacao` [2026-07-27, pedido do usuário: "quando eu clicar
    em atualizar, realmente atualize tudo"] — quando True, invalida o cache
    por-data ANTES de buscar, forçando consulta nova à API Beehus pra TODAS
    as datas da janela pedida, mesmo as já vistas nesta sessão do processo.
    Usada pela rota /api/atualizar (clique no botão "Atualizar" da tela);
    NUNCA usada no boot do servidor nem no CLI (lá o cache já começa vazio,
    forçar seria uma query redundante).

    `limiar_divergencia_pct`/`limiar_divergencia_reais` [2026-07-31, pedido
    do usuário: "campos para mudar o valor" — os 2 campos de filtro da
    divergência Rent Contrib × Rent NAV (§Alerta 5) viraram editáveis pela
    tela, em vez de só constantes fixas] — None (não veio nada da tela) usa
    o padrão de sempre (LIMIAR_DIVERGENCIA_PADRAO/_REAIS_PADRAO).

    Pseudocódigo:
      1. Define os limiares de divergência ATIVOS pra esta execução
         (definir_limiares_divergencia) — precisa ser ANTES de calcular
         qualquer célula, já que div_overlay_kind() lê os globais mutáveis.
      2. Lê o cadastro (Excel) e valida contra a API Beehus.
      3. Calendário ANBIMA + janela de datas (default ou pedida pelo usuário).
      4. Se `forcar_atualizacao`, invalida o cache dessas datas (garante API
         fresca). Busca os dados da esteira SÓ para essa janela — via db.py,
         que cacheia por data (Tarefa 3: reaproveita o que a sessão já
         buscou, exceto o que acabou de ser invalidado).
      5. Cruza carteiras compradas por outras carteiras do Template
         (mapear_carteiras_compradas [2026-08-13]) e calcula células/linhas
         (snapshot_builder.py) + roll-up de agrupamentos.
      6. Lê o ControleUpload.xlsx (custodiantes, best-effort).
      7. Monta o dict final do snapshot, incluindo os limiares ATIVOS em
         meta (pra tela pré-preencher os 2 campos com o valor que realmente
         gerou este snapshot).
    """
    definir_limiares_divergencia(limiar_divergencia_pct, limiar_divergencia_reais)
    limiar_pct_ativo = limiar_divergencia_pct if limiar_divergencia_pct is not None else LIMIAR_DIVERGENCIA_PADRAO
    limiar_reais_ativo = limiar_divergencia_reais if limiar_divergencia_reais is not None else LIMIAR_DIVERGENCIA_REAIS_PADRAO

    timings = {}
    t_total0 = time.monotonic()
    hoje = dt.date.today().isoformat()

    print(f"[1/6] Lendo cadastro + coleções pequenas da API Beehus...")
    registry, registry_por_id, wallet_ids, empresas_por_id, agrupamentos_por_id, orfas = \
        _carregar_registry(timings)
    print(f"      {len(registry)} carteiras casadas com `wallets`; {len(orfas)} órfãs.")

    print("[2/6] Calendário ANBIMA + janela do grid...")
    calendario = CalendarioDiasUteis()
    print(f"      fonte do calendário: {calendario.fonte}")
    if data_inicial and data_final:
        data_referencia = data_final
        janela = calendario.sequencia_dias_uteis(data_inicial, data_final)
        print(f"      janela CUSTOMIZADA pedida pelo usuário: {data_inicial}..{data_final} ({len(janela)} du)")
    else:
        data_referencia, janela = calcular_janela_grid(calendario, hoje)
        print(f"      janela DEFAULT (5du/D-3): {janela[0]}..{janela[-1]} ({len(janela)} du)")
    data_extra_gate_sequencia = calendario.deslocar(janela[0], -1)  # 1du a mais p/ checar gate de sequência do 1º dia visível

    print("[3/6] Buscando dados da esteira (cache-aware por data)...")
    todas_datas_pedidas = [data_extra_gate_sequencia] + janela
    if forcar_atualizacao:
        db.invalidar_cache_esteira(todas_datas_pedidas)
        print(f"      forçando atualização — cache invalidado pra {len(todas_datas_pedidas)} data(s)")
    ids_agrupamentos_ativos = sorted(gid for gid, g in agrupamentos_por_id.items() if not g.get("trashed"))
    unp_map, pro_map, nav_map, issues_map, nav_group_map = db.buscar_dados_esteira_para_datas(
        wallet_ids, ids_agrupamentos_ativos, todas_datas_pedidas, timings)
    print(f"      unp={len(unp_map)} pro={len(pro_map)} nav={len(nav_map)} issues_cells={len(issues_map)} "
          f"nav_grouping={len(nav_group_map)} · datas novas consultadas={timings.get('datas_novas_consultadas', 0)} "
          f"· datas do cache={timings.get('datas_do_cache', 0)}")
    for k, v in timings.items():
        if isinstance(v, float):
            print(f"        - {k}: {v:.3f}s")

    print("[4/6] Calculando células, prioridade e agrupamentos...")
    datas_processadas_por_carteira = defaultdict(set)
    for (wallet_id, data) in pro_map.keys():
        datas_processadas_por_carteira[wallet_id].add(data)

    # [2026-08-13, pedido do usuário: "se a carteira da lista for comprada
    # por alguma carteira da lista..."] 1 cruzamento só, fora do loop —
    # repassado pra cada compute_wallet_row() abaixo (ver snapshot_builder.
    # mapear_carteiras_compradas).
    compradores_por_alvo = mapear_carteiras_compradas(registry_por_id)

    linhas_carteiras = []
    for w in registry:
        linha = compute_wallet_row(w, janela, calendario, hoje, unp_map, pro_map, nav_map,
                                    issues_map, datas_processadas_por_carteira, compradores_por_alvo)
        linhas_carteiras.append(linha)

    linhas_carteiras.sort(key=lambda r: r["sortKey"])
    linhas_carteiras_por_id = {r["walletId"]: r for r in linhas_carteiras}

    ids_com_pendencia = [r["walletId"] for r in linhas_carteiras if r["cells"][-1]["s"] not in ("p", "cD")]
    issues_detail_por_carteira = db.buscar_issues_detail(ids_com_pendencia, janela[0], janela[-1], timings)
    for r in linhas_carteiras:
        if r["cells"][-1]["s"] not in ("p", "cD"):
            r["issuesDetail"] = issues_detail_por_carteira.get(r["walletId"], [])

    linhas_agrupamentos = compute_groupings_rows(
        agrupamentos_por_id, linhas_carteiras_por_id, registry_por_id, janela, data_referencia,
        nav_group_map, empresas_por_id)

    empresas_vistas = sorted({r["company"] for r in linhas_carteiras})
    instituicoes_vistas = sorted({r["institution"] for r in linhas_carteiras if r["institution"]})

    contagem_blocos = defaultdict(int)
    for r in linhas_agrupamentos:
        contagem_blocos[r["bloco"]] += 1

    print("[5/6] Lendo ControleUpload.xlsx (aba Controle de Cargas — custodiantes)...")
    t0 = time.monotonic()
    custodian_upload = _ler_controle_upload_custodiantes()
    timings["controle_upload_xlsx"] = time.monotonic() - t0

    print("[6/6] Montando snapshot final...")
    timings["total"] = time.monotonic() - t_total0

    snapshot = {
        "generatedAt": dt.datetime.now().isoformat(timespec="seconds"),
        "meta": {
            "today": hoje,
            "referenceDate": data_referencia,
            "gridReferenceLagDu": GRID_REFERENCE_LAG_DU,
            "window": janela,
            "calendarSource": calendario.fonte,
            "calendarFallback": calendario.fallback,
            "companies": empresas_vistas,
            "institutions": instituicoes_vistas,
            "totalWallets": len(linhas_carteiras),
            "orphanWallets": len(orfas),
            "orphanNames": [o["nome"] for o in orfas][:50],
            "groupingBlocoCounts": {str(k): v for k, v in contagem_blocos.items()},
            "queryTimings": {k: round(v, 3) for k, v in timings.items() if isinstance(v, float)},
            # info de cache exibida no botão "Atualizar" (Tarefa 3 — ver
            # static/js/controle_cargas/atualizar.js)
            "cacheInfo": {
                "datasNovasConsultadas": timings.get("datas_novas_consultadas", 0),
                "datasDoCache": timings.get("datas_do_cache", 0),
            },
            # limiares de divergência Rent Contrib × Rent NAV REALMENTE
            # usados neste snapshot — [2026-07-31, pedido do usuário: "campos
            # para mudar o valor"] a tela pré-preenche os 2 campos editáveis
            # com isso (nunca com o padrão fixo), pra sempre refletir o que
            # gerou o snapshot corrente.
            "limiarDivergenciaPct": limiar_pct_ativo,
            "limiarDivergenciaReais": limiar_reais_ativo,
        },
        "wallets": linhas_carteiras,
        "groupings": linhas_agrupamentos,
        "custodianUpload": custodian_upload,
    }

    print(f"\nConcluído em {timings['total']:.2f}s. Blocos de agrupamento: {dict(contagem_blocos)}")
    return snapshot


def write_html(snapshot):
    """Contexto:
    Gera index.html a partir de index_template.html — SEM embutir o
    snapshot (o front-end carrega via fetch('snapshot.json'), servido pelo
    app.py). O parâmetro `snapshot` fica na assinatura só para validar que
    ele existe antes de publicar o HTML que depende dele.

    Pseudocódigo:
      1. Lê o template.
      2. Se o snapshot vier vazio, aborta (nunca publica um HTML órfão).
      3. Copia o template pro index.html final.
    """
    with open(HTML_TEMPLATE_PATH, "r", encoding="utf-8") as f:
        template = f.read()
    if not snapshot or not snapshot.get("wallets"):
        raise RuntimeError("snapshot vazio — abortando escrita do index.html")
    with open(HTML_OUTPUT_PATH, "w", encoding="utf-8") as f:
        f.write(template)
    print(f"index.html escrito em {HTML_OUTPUT_PATH} ({os.path.getsize(HTML_OUTPUT_PATH)/1024:.0f} KB) "
          f"— snapshot servido à parte via app.py (fetch('snapshot.json'))")


def escrever_snapshot_json(snapshot):
    """Contexto:
    Grava `snapshot` em SNAPSHOT_JSON_PATH (mesmo arquivo servido pelo
    app.py via fetch('snapshot.json')) — extraído do bloco `__main__` deste
    arquivo [2026-07-23, pedido do usuário] pra ser reaproveitado também por
    app.py no boot do servidor (garante que o cadastro/API Beehus lidos na
    inicialização fiquem refletidos no arquivo estático, sem precisar rodar
    este script à parte nem esperar um "Atualizar" manual na tela). Não
    retorna nada.

    Pseudocódigo:
      1. Serializa o snapshot inteiro (mesmo formato do resto do app).
      2. Loga o tamanho final em KB. """
    with open(SNAPSHOT_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(snapshot, f, ensure_ascii=False, separators=(",", ":"))
    tamanho_kb = os.path.getsize(SNAPSHOT_JSON_PATH) / 1024
    print(f"snapshot.json escrito em {SNAPSHOT_JSON_PATH} ({tamanho_kb:.0f} KB)")


if __name__ == "__main__":
    snap = montar_snapshot()
    escrever_snapshot_json(snap)

    write_html(snap)

    caminho_xlsx = os.path.join(HERE, f"ControleCargas_relatorio_{snap['meta']['today']}.xlsx")
    write_excel_report(snap, caminho_xlsx)
