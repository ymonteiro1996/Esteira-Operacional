/* ControleCargas.painel_carga — painel do 2º clique numa célula da aba "Controle de Cargas".
   [2026-09-28, pedido do usuário: "Ao clicar duas vezes na matriz, na parte que mostra as carteiras
   faltantes, mostrar matriz de processamento dessas carteiras e permitir extração de excel dessas
   carteiras, incluindo Wallet ID, Company e entidade."]

   Saiu de matriz_cargas.js (1 arquivo por funcionalidade, CLAUDE.md §4). Cada grupo do dia
   (faltantes, aguardando, onboarding, inativas) vira uma MATRIZ DE PROCESSAMENTO: carteira × dia da
   janela, com a mesma simbologia da aba Carteiras (Unp/Pro/Pub/∅/Agd, badges de Atraso/Pauta), e um
   botão "⬇ Excel" que baixa ESSAS carteiras pelo mesmo exportador .xlsx da aba Carteiras
   (POST /api/exportar-excel — já traz WalletID, Company, Instituição e a matriz colorida).

   Parte do objeto único ControleCargas (ver state.js). */
Object.assign(ControleCargas, {

/* Contexto: linhas de carteira do snapshot para uma lista de walletIds, na mesma ordem (as que não
   existirem no snapshot são puladas). Retorna array.

   [CORRIGIDO 2026-09-28] pegava window._WALLETS_BY_ID direto, com fallback "||".
   Como esta aba não passa por buildMatrix(), o índice era o do snapshot anterior
   — e vazio no 1º load. Objeto vazio é truthy, então o fallback não salvava: todo
   id virava undefined, .filter(Boolean) zerava a lista e o painel dizia "Faltantes
   (0) — Nenhuma." embaixo de uma célula marcando 80%. carteirasPorId() reindexa
   sozinho quando o SNAPSHOT troca.

   Pseudocódigo: 1. Índice por walletId do snapshot corrente. 2. Mapeia e filtra. */
carteirasDoGrupoCarga(ids){
  const porId = ControleCargas.carteirasPorId();
  return (ids || []).map(id=> porId[id]).filter(Boolean);
},

/* Contexto: matriz de processamento de um grupo de carteiras — 1 linha por carteira (nome, WalletID,
   Company, Instituição) e 1 célula por dia da janela com o estado da aba Carteiras. O nome abre o
   painel da carteira (data-drill-wallet, wireDrillThroughPainel). Retorna string HTML.

   Pseudocódigo:
     1. Sem carteiras -> "Nenhuma.".
     2. Cabeçalho com D-n + data (o dia focado marcado).
     3. Por carteira: identificação + células (classe do estado, overlays, badge de atraso/pauta). */
matrizProcessamentoCarteirasHtml(carteiras, dataFocada){
  if(!carteiras.length) return '<p class="empty-note">Nenhuma.</p>';
  const janela = ControleCargas.SNAPSHOT.meta.window;
  const esc = ControleCargas.esc;
  let html = '<div class="cg-proc-wrap"><table class="cg-proc"><thead><tr><th>Carteira</th><th>WalletID</th><th>Company</th><th>Instituição</th>';
  janela.forEach(d=>{
    html += `<th class="${d === dataFocada ? 'cg-proc-foco' : ''}">${ControleCargas.rotuloDistanciaHojeHtml(d)}${ControleCargas.fmtDM(d)}</th>`;
  });
  html += '</tr></thead><tbody>';
  carteiras.forEach(w=>{
    const cmap = ControleCargas.cellByDate(w);
    html += `<tr><td><span class="cg-proc-nome" data-drill-wallet="${ControleCargas.escAttr(w.walletId)}" title="Abrir o painel da carteira">${esc(w.name)}</span></td>`
      + `<td><code style="user-select:all">${esc(w.walletId)}</code>${ControleCargas.acoesIdentificadorHtml(w.walletId)}</td>`
      + `<td>${esc(w.company)}</td><td>${esc(w.institution || '—')}</td>`;
    janela.forEach(d=>{
      const c = cmap[d];
      const st = c ? ControleCargas.STATES[c.s] : ControleCargas.STATES.notcov;
      const ov = c && c.ov ? ControleCargas.ovClass(c.ov) : '';
      const letra = c && c.s === 'miss' ? `<span class="emptyset">${st.letter}</span>` : (c ? st.letter : '—');
      html += `<td><div class="cell ${st.cls} ${ov}${d === dataFocada ? ' focused' : ''}" title="${ControleCargas.escAttr(d + ' — ' + st.name)}">`
        + `${letra}${ControleCargas.atrasoBadgeHtml(c && c.ov)}</div></td>`;
    });
    html += '</tr>';
  });
  return html + '</tbody></table></div>';
},

/* Contexto: bloco de 1 grupo do painel (título + botão Excel + matriz). Retorna string HTML.

   Pseudocódigo: 1. Resolve as carteiras; 2. botão só quando há carteira; 3. aberto/recolhido. */
grupoCarteirasCargaHtml(chaveGrupo, titulo, ids, dataFocada, aberto){
  const carteiras = ControleCargas.carteirasDoGrupoCarga(ids);
  const botao = carteiras.length
    ? ` <button type="button" class="btn secondary cg-btn-excel" data-acao="excel-carteiras-carga" data-grupo="${chaveGrupo}"`
      + ` title="Baixa estas ${carteiras.length} carteira(s) em .xlsx: WalletID, Company, Instituição e a matriz de processamento">⬇ Excel (${carteiras.length})</button>`
    : '';
  return `<details class="cg-grupo"${aberto ? ' open' : ''}><summary>${titulo} (${carteiras.length})${botao}</summary>`
    + ControleCargas.matrizProcessamentoCarteirasHtml(carteiras, dataFocada) + '</details>';
},

/* Contexto: cabeçalho do painel da carga (chave, dia, nível, SLA, Pauta e, na carga manual, quem
   aciona). Retorna string HTML.

   Pseudocódigo: 1. Título com Instituição · Modelo; 2. chips; 3. resumo da anotação do dia. */
secaoCabecalhoCarga(linha, c){
  const nivel = ControleCargas.NIVEIS_CARGA[c.nivel] || {nome:c.nivel, cls:''};
  const html = `<h3>${ControleCargas.esc(linha.institution)} · ${ControleCargas.esc(linha.loadModel)}</h3>`
    + `<div class="modal-sub">Carga ${linha.periodicity === 'M' ? 'mensal' : 'diária'} · SLA ${ControleCargas.esc(linha.sla || '—')} · ${ControleCargas.esc(linha.company)} · ${ControleCargas.weekdayAbbrev(c.d)} ${c.d}</div>`
    + `<div class="chiprow"><span class="pchip ${nivel.cls}">${ControleCargas.esc(nivel.nome)}</span>`
    + (c.pauta ? `<span class="pchip cg-chip-pauta">Pauta: ${c.nPauta} carteira(s) no dia da Defasagem${c.pautaSemD1 ? ' · D-1 sem processada' : ''}</span>` : '')
    + `<span class="pchip">${linha.totalWallets} carteira${linha.totalWallets === 1 ? '' : 's'} no Template</span>`
    + (linha.isManualLoad ? `<span class="pchip">Carga manual — acionar: ${ControleCargas.esc(linha.loadModel)}</span>` : '')
    + '</div>';
  return html + ControleCargas.resumoAtuacaoHtml('carga', linha.key, c.d);
},

/* Contexto: mini-linha do tempo da chave no painel — clicar num dia refoca o painel nele
   (data-panel-date, ligado por wireFocoDataPainel). Retorna string HTML.

   Pseudocódigo: 1. Uma mini-célula por dia, com a cor do nível, o anel de Pauta e o dia focado. */
secaoJanelaCarga(linha, dataFocada){
  let html = `<div class="psec"><h4>Janela (${linha.cells.length} du)</h4><div class="mini-row">`;
  linha.cells.forEach(c=>{
    const nivel = ControleCargas.NIVEIS_CARGA[c.nivel] || ControleCargas.NIVEIS_CARGA.nao_avaliada;
    html += `<div class="cell ${nivel.cls} ${ControleCargas.classesPautaCarga(c)}${c.d === dataFocada ? ' focused' : ''}" data-panel-date="${c.d}"`
      + ` title="${ControleCargas.escAttr(c.d + ' — ' + nivel.nome)}">${ControleCargas.conteudoCelulaCarga(c)}</div>`;
  });
  return html + '</div></div>';
},

/* Contexto: os 4 grupos do dia como matrizes de processamento (faltantes aberta; aguardando,
   onboarding e inativas recolhidas — inativas aberta na falha prolongada). Retorna string HTML.

   Pseudocódigo: 1. Dia não avaliado -> nota. 2. Um grupoCarteirasCargaHtml por grupo. */
secaoCarteirasCarga(c){
  if(c.nivel === 'nao_avaliada'){
    return '<div class="psec"><h4>Carteiras</h4><p class="empty-note">Carga mensal: só o último dia útil do mês é avaliado.</p></div>';
  }
  return `<div class="psec"><h4>Carteiras do dia — matriz de processamento</h4>`
    + ControleCargas.grupoCarteirasCargaHtml('faltantes', 'Faltantes', c.faltantes, c.d, true)
    + ControleCargas.grupoCarteirasCargaHtml('aguardando', 'Aguardando (no prazo)', c.aguardando, c.d, false)
    + ControleCargas.grupoCarteirasCargaHtml('onboarding', 'Onboarding (nova, sem a 1ª carga)', c.onboarding, c.d, false)
    + ControleCargas.grupoCarteirasCargaHtml('inativas', 'Inativas (sem carga há dias — fora do cálculo)', c.inativas, c.d, c.nivel === 'falha_prolongada')
    + '</div>';
},

/* Contexto: liga os botões "⬇ Excel" do painel recém-aberto. Não retorna nada.

   Pseudocódigo:
     1. Clique (sem abrir/fechar o <details>): resolve as carteiras do grupo.
     2. Baixa pelo exportador da aba Carteiras, com o nome do arquivo dizendo a carga, o dia e o grupo. */
wireExcelPainelCarga(linha, c){
  document.querySelectorAll('#modal-body [data-acao="excel-carteiras-carga"]').forEach(botao=>{
    botao.addEventListener('click', (ev)=>{
      ev.preventDefault(); ev.stopPropagation();
      const grupo = botao.dataset.grupo;
      const carteiras = ControleCargas.carteirasDoGrupoCarga(c[grupo]);
      const nome = `ControleCargas_${linha.institution}_${linha.loadModel}_${c.d}_${grupo}.xlsx`.replace(/[\\/:*?"<>|\s]+/g, '_');
      ControleCargas.baixarXlsxMatriz(ControleCargas.montarPayloadExcel(carteiras), botao, nome);
    });
  });
},

/* Contexto: abre o painel da carga focado num dia. Chamada pelo 2º clique na célula e ao refocar
   pela mini-linha do tempo ou depois de salvar comentário (reabrirPainel, paineis.js). Não retorna
   nada.

   Pseudocódigo:
     1. Acha a linha e a célula do dia (sem elas, não abre).
     2. Cabeçalho + janela + matrizes das carteiras + comentários ('carga').
     3. openModal + wirePanelInteractions (foco, drill-through para a carteira, comentários) + Excel. */
buildCargaPanel(chave, data){
  const linha = (ControleCargas.linhasCargas() || []).find(l=> l.key === chave);
  if(!linha) return;
  const c = linha.cells.find(x=> x.d === data) || linha.cells[linha.cells.length - 1];
  const html = ControleCargas.secaoCabecalhoCarga(linha, c)
    + ControleCargas.secaoJanelaCarga(linha, c.d)
    + ControleCargas.secaoCarteirasCarga(c)
    + ControleCargas.commentsSectionHtml('carga', linha.key, c.d);
  ControleCargas.openModal(html);
  ControleCargas.wirePanelInteractions('carga', linha.key, c.d);
  ControleCargas.wireExcelPainelCarga(linha, c);
},
});
