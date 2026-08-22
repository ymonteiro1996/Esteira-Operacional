/* ControleCargas.matriz_company — aba "Company": % de Carteiras Publicadas de cada empresa, dia a dia.
   Parte do objeto único ControleCargas (ver state.js). Pedido do usuário
   2026-07-23: 1 linha por company, 1 coluna por dia da janela do grid, célula
   = % de carteiras (mustPublish) publicadas sobre as que deveriam publicar
   naquele dia — MESMO estilo visual (célula .cell, cabeçalho sticky, coluna
   de referência destacada) das outras matrizes desta tela.
*/
Object.assign(ControleCargas, {
// ─────────────────────────────────────────────────────────────────────────
// Aba "Company"
// ─────────────────────────────────────────────────────────────────────────
/* Contexto:
   Agrega, por company e por dia da janela, quantas carteiras (mustPublish)
   deveriam publicar e quantas já publicaram — mesma regra célula a célula
   do painel "Carteiras Publicadas" (ControleCargas.computePublishStat), só
   que aqui SEM filtro de empresa (o objetivo da aba é comparar TODAS as
   companies lado a lado) e para TODOS os dias da janela de uma vez, não só
   a data em foco. Chamada por buildCompanyMatrix(). Retorna um objeto
   {nomeDaCompany: {porData: {data: {total, publicadas}}, totalCarteiras}}.

   Pseudocódigo:
     1. Para cada carteira do snapshot que precisa publicar (mustPublish),
        garante o balde da sua company e soma 1 no totalCarteiras dela.
     2. Para cada dia da janela, pula os dias "não cobertos" (notcov) dessa
        carteira; nos demais, soma 1 no total do dia e, se publicada, 1 nas
        publicadas. */
computeCompanyPublishMatrix(){
  const window_ = ControleCargas.SNAPSHOT.meta.window;
  const porCompany = {};
  ControleCargas.SNAPSHOT.wallets.forEach(carteira=>{
    if(!carteira.mustPublish) return;
    if(!porCompany[carteira.company]) porCompany[carteira.company] = { porData:{}, totalCarteiras:0 };
    const balde = porCompany[carteira.company];
    balde.totalCarteiras++;

    const cmap = ControleCargas.cellByDate(carteira);
    window_.forEach(d=>{
      const celula = cmap[d];
      if(!celula || celula.s === 'notcov') return;
      if(!balde.porData[d]) balde.porData[d] = { total:0, publicadas:0 };
      balde.porData[d].total++;
      if(celula.s === 'p') balde.porData[d].publicadas++;
    });
  });
  return porCompany;
},

/* Contexto:
   Monta 1 célula da matriz de Company — % publicadas coloridas nas mesmas 3
   faixas de status do painel "Carteiras Publicadas" (100% ok / ≥80% atenção
   / abaixo crítico), ou célula neutra quando nenhuma carteira da company
   deveria publicar naquele dia (total=0, ex.: company só com carteiras
   mensais fora do fechamento). Chamada por buildCompanyMatrix(), 1x por
   célula. Retorna string HTML (<td>...).

   Pseudocódigo:
     1. Sem dado no dia (total=0) -> célula neutra "—".
     2. Com dado, calcula o percentual, escolhe a classe de cor pela mesma
        faixa do painel de KPI e monta o texto (% arredondado) + title com
        o detalhamento (X/Y e company/data). */
celulaCompanyHtml(company, data, info){
  if(!info || info.total===0){
    return `<td><div class="cell company-neutral" title="${ControleCargas.escAttr(company)} · ${data}: nenhuma carteira deveria publicar (dia não coberto para todas)">—</div></td>`;
  }
  const pct = info.publicadas/info.total*100;
  // floor (não round) — evita mostrar "100%" arredondado quando falta 1
  // carteira publicar (ex.: 99,6% viraria "100%" com round, mas a cor já
  // seria 'att'; floor mantém texto e cor sempre coerentes).
  const pctExibido = Math.floor(pct);
  const cls = pct>=100 ? 'company-ok' : pct>=80 ? 'company-att' : 'company-crit';
  const title = `${ControleCargas.escAttr(company)} · ${ControleCargas.weekdayAbbrev(data)} ${data}: ${info.publicadas}/${info.total} publicadas (${pct.toFixed(1)}%)`;
  return `<td><div class="cell ${cls}" title="${title}">${pctExibido}%</div></td>`;
},

/* Contexto:
   (Re)desenha a aba "Company" — 1 linha por empresa, ordenada por nome,
   1 coluna por dia da janela do grid + 1 coluna-resumo com o total de
   carteiras (mustPublish) da company. Chamada ao trocar para essa aba e
   pelo clique numa coluna de data do cabeçalho (wireHeaderDateClicks, que
   também funciona aqui — mesmo seletor "table.matrix thead th[data-date]").
   Não retorna nada.

   Pseudocódigo:
     1. Agrega os dados (computeCompanyPublishMatrix).
     2. Monta o cabeçalho: Company + 1 coluna por dia (destacando a coluna de
        referência e a coluna em foco, igual à matriz principal) + coluna
        "Carteiras".
     3. Monta o corpo: 1 linha por company, célula colorida por dia
        (celulaCompanyHtml) + total de carteiras da company.
     4. Atualiza contagem/nota de rodapé, reindexa window._WALLETS_BY_ID
        (usado por computeGroupingPublishStat — evita índice parado se o
        usuário clicar "Atualizar" ficando nesta aba, ver atualizar.js) e
        religa clique nas colunas de data. */
buildCompanyMatrix(){
  const table = document.getElementById('company-matrix');
  const window_ = ControleCargas.SNAPSHOT.meta.window;
  const refDate = ControleCargas.SNAPSHOT.meta.referenceDate;
  const focusDate = ControleCargas.state.focusDate || refDate;
  const porCompany = ControleCargas.computeCompanyPublishMatrix();
  const companies = Object.keys(porCompany).sort((a,b)=> a.localeCompare(b));

  // mesmo índice global usado por buildMatrix() — ver comentário lá (CLAUDE.md
  // §6, reaproveita em vez de duplicar a lógica de indexação).
  window._WALLETS_BY_ID = Object.fromEntries(ControleCargas.SNAPSHOT.wallets.map(w=>[w.walletId,w]));

  let thead = '<thead><tr><th class="hdr-companyname">Company</th>';
  window_.forEach(d=>{
    const isRef = d===refDate;
    const isFocus = d===focusDate;
    const classe = isRef ? 'ref' : (isFocus ? 'focuscol' : '');
    thead += `<th class="${classe}" data-date="${d}" title="Clique para ver &quot;Publicadas&quot; nesta data">${ControleCargas.fmtDM(d)}${isRef?'<span class="refline">▾ ref</span>':`<br><span style="font-weight:400">${ControleCargas.weekdayAbbrev(d)}</span>`}${(isFocus&&!isRef)?'<span class="focusline">● foco</span>':''}</th>`;
  });
  thead += '<th class="hdr-summary">Carteiras</th></tr></thead>';

  let body = '';
  companies.forEach(company=>{
    const balde = porCompany[company];
    body += `<tr><td class="col-companyname">${ControleCargas.esc(company)}</td>`;
    window_.forEach(d=> body += ControleCargas.celulaCompanyHtml(company, d, balde.porData[d]));
    body += `<td class="col-summary">${balde.totalCarteiras}</td></tr>`;
  });

  table.innerHTML = thead + '<tbody>' + body + '</tbody>';

  document.getElementById('company-count').textContent = `${companies.length} companies`;
  document.getElementById('company-note').textContent =
    `% de carteiras com "Deve Publicar" = Sim já publicadas sobre as que deveriam publicar naquele dia. Janela: ${window_[0]} .. ${window_[window_.length-1]} (${window_.length} du), referência D-${ControleCargas.SNAPSHOT.meta.gridReferenceLagDu} = ${refDate}. Clique numa coluna de data pra focar os painéis "Publicadas" nela.`;

  ControleCargas.wireHeaderDateClicks();
  ControleCargas.buildPublishStat();
  ControleCargas.buildGroupingPublishStat();
},
});
