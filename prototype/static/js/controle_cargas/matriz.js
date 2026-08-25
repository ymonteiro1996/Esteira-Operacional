/* ControleCargas.matriz — grade Carteiras/Agrupamentos (célula, tooltip, legenda, cabeçalho/stats, drag-scroll).
   Parte do objeto único ControleCargas (ver state.js). Gerado a partir da
   refatoração de index_template.html (CLAUDE.md §4, "Divisão clara das
   páginas" — pasta static/js/controle_cargas/, 1 arquivo por funcionalidade).
*/
Object.assign(ControleCargas, {
/* Contexto:
   Converte a lista de overlays de uma célula (['div','seq',...]) na string
   de classes CSS correspondente. Usada por rowHtml() ao montar a célula.
   Retorna string (classes separadas por espaço, pode ser vazia).

   Pseudocódigo:
     1. Sem overlays -> string vazia.
     2. Mapeia cada overlay para sua classe CSS (OV_CLASS) e junta com espaço. */
ovClass(list){
  if(!list) return '';
  return list.map(o=>ControleCargas.OV_CLASS[o]||'').join(' ');
},

// ─────────────────────────────────────────────────────────────────────────
// Render da matriz
// ─────────────────────────────────────────────────────────────────────────
/* Contexto:
   Abreviação em português do dia da semana de uma data ISO — usada no
   cabeçalho da matriz (sob o dia/mês) e no tooltip. Retorna string de 3
   letras.

   Pseudocódigo:
     1. Monta um Date ao meio-dia (evita problema de fuso na borda do dia).
     2. Indexa a tabela de abreviações pelo dia da semana (0=domingo). */
weekdayAbbrev(dateStr){
  const days=['dom','seg','ter','qua','qui','sex','sáb'];
  const d = new Date(dateStr+'T12:00:00');
  return days[d.getDay()];
},

/* Contexto:
   Formata uma data ISO "YYYY-MM-DD" como "DD/MM" para exibição compacta no
   cabeçalho da matriz. Retorna string.

   Pseudocódigo:
     1. Separa a data em ano/mês/dia pelo hífen.
     2. Remonta como "dia/mês". */
fmtDM(dateStr){
  const [y,m,d]=dateStr.split('-');
  return `${d}/${m}`;
},

/* Contexto:
   Indexa as células de uma linha (carteira ou agrupamento) por data, para
   acesso O(1) ao desenhar a matriz/tooltip/painel. Usada por rowHtml(),
   miniTimelineHtml() e os painéis de detalhe. Retorna um objeto {data:
   célula}.

   Pseudocódigo:
     1. Percorre r.cells e grava cada uma na chave da sua data. */
cellByDate(r){
  const m = {};
  r.cells.forEach(c=> m[c.d]=c);
  return m;
},

/* Contexto:
   Monta o HTML de 1 linha (<tr>) da matriz — reaproveitado pelas duas abas
   Carteiras/Agrupamentos (paridade de colunas, PLANNING §Visão por
   Agrupamento "Paridade de informação"). Chamada 1x por linha, dentro de
   buildMatrix(). Retorna string HTML.

   Pseudocódigo:
     1. Monta as colunas fixas (company, nome, badges de contexto — carga
        mensal para carteiras, contagem de membros para agrupamentos — e o
        balão de comentário da linha, com o TEXTO do comentário no title,
        pra aparecer ao passar o mouse — pedido do usuário 2026-07-23) + as
        colunas Instituição e Modelo de Carga [REVISADO 2026-07-29, pedido
        do usuário: "remova o campo prioridade, traga instituição para esse
        campo... quero também o campo Modelo de carga ao lado" — a coluna
        Prioridade saiu (o critério continua disponível na sortbar, só não é
        mais coluna do grid); Instituição deixou de ser um chip dentro da
        coluna Carteira/Agrupamento e virou coluna própria (mesmo chip
        .inst-chip, mesmo atalho de clique-pra-filtrar, só que agora no seu
        próprio <td>); Modelo de Carga é novo, só texto (não existe pra
        Agrupamento — mostra "—").
     2. Para cada dia da janela, desenha a célula (sigla, cor, overlays,
        badge de atraso, balão de comentário da célula — o texto desse
        aparece no tooltip customizado da célula, ver walletTooltip()/
        groupingTooltip()).
     3. Anexa as 2 colunas editáveis Responsável/Comentário sobre atuação
        [REPOSICIONADAS 2026-07-25, pedido do usuário — mesma ordem do
        Excel].

   [NOVO 2026-08-13, pedido do usuário: "se a carteira da lista for comprada
   por alguma carteira da lista... sinalização diferenciada... um contorno
   nele e na matriz"] Carteira (nunca Agrupamento — o conceito só existe por
   walletId) com `aguardandoExplosao` (snapshot_builder.py, já vem com o
   gate de pendência aplicado) ganha a classe `linha-comprada-pendente` na
   `<tr>` inteira (anel violeta em toda a linha, ver CSS) + uma pílula
   "Comprada" ao lado do nome, com o(s) nome(s) do(s) comprador(es) no
   title. */
rowHtml(r, isWallets, window_){
  const rid = r.walletId || r.groupingId;
  const targetType = isWallets ? 'wallet' : 'grouping';
  const cmap = ControleCargas.cellByDate(r);
  const rowSev = ControleCargas.rowCommentSeverity(targetType, rid);
  const compradaPendente = isWallets && !!r.aguardandoExplosao;

  let html = `<tr${compradaPendente ? ' class="linha-comprada-pendente"' : ''}><td class="col-company"><span class="companylink" data-company="${ControleCargas.escAttr(r.company)}">${ControleCargas.esc(r.company)}</span></td><td class="col-name">`;
  // nome já abre o painel de detalhe ao clicar (wireRowClicks) — só o botão
  // 📋 é novo aqui; ℹ️ seria redundante (identificadores.js) [2026-07-30].
  html += `<span class="wname" data-id="${rid}" data-kind="${targetType}">${ControleCargas.esc(r.name)}</span>${ControleCargas.acoesIdentificadorHtml(r.name)}`;
  if(compradaPendente){
    const nomes = (r.compradaPorNomes||[]).join(', ');
    html += `<span class="comprada-badge" title="${ControleCargas.escAttr('Comprada por: ' + nomes + ' — resolver esta carteira primeiro.')}">Comprada</span>`;
  }
  if(isWallets){
    if(r.monthly) html += `<span class="went">carga mensal</span>`;
  } else {
    html += `<span class="went">${r.nMembers} carteira${r.nMembers===1?'':'s'} ativa${r.nMembers===1?'':'s'}</span>`;
  }
  if(rowSev) html += `<span class="row-comment-badge ${rowSev}" title="${ControleCargas.escAttr(ControleCargas.rowCommentTexts(targetType, rid))}"></span>`;
  html += '</td>';
  html += `<td class="col-summary"><span class="inst-chip" data-inst="${ControleCargas.escAttr(r.institution)}">${ControleCargas.esc(r.institution||'—')}</span></td>`;
  html += `<td class="col-summary">${ControleCargas.esc(r.loadModel||'—')}</td>`;

  window_.forEach(d=>{
    const entry = cmap[d];
    if(!entry){ html += `<td><div class="cell s-g2">—</div></td>`; return; }
    const st = ControleCargas.STATES[entry.s];
    const ovs = entry.ov||[];
    const commentSev = ControleCargas.cellCommentSeverity(targetType, rid, d);
    // Responsável / Comentário sobre atuação (anotacoes.js) — só existe na
    // data de referência do grid, nunca noutro dia da janela. [2026-07-30,
    // pedido do usuário; REVISADO no mesmo dia após feedback visual: "ta
    // invertido, quero o azul sempre como menor, dentro do
    // verde/amarelo/vermelho" — a 1ª tentativa desenhava um ANEL azul
    // ENVOLVENDO o balão de severidade (ficava maior que ele, "invertido");
    // agora é um marcador .atuacao-dot PRÓPRIO, irmão do .cmt-dot (nunca
    // filho/modificador dele), sempre pequeno e por CIMA (z-index) do balão
    // de severidade — convivem no mesmo canto sem precisar de um 6º (ver
    // buildLegend()). [REVISADO 2026-08-06, pedido do usuário: "pode deixar
    // a inclusão desse ícone para quando só houver responsável também" —
    // antes só considerava o Comentário; agora conta Responsável OU
    // Comentário (anotacaoExisteNaData), então preencher só o Responsável
    // já é suficiente pro ponto aparecer.
    const temAnotacao = ControleCargas.anotacaoExisteNaData(targetType, rid, d);
    const letterHtml = entry.s==='miss' ? `<span class="emptyset">${st.letter}</span>` : st.letter;
    const commentDot = (commentSev ? `<span class="cmt-dot ${commentSev}"></span>` : '')
      + (temAnotacao ? `<span class="atuacao-dot"></span>` : '');
    html += `<td><div class="cell ${st.cls} ${ControleCargas.ovClass(ovs)}" tabindex="0"
                data-view="${ControleCargas.state.view}" data-rid="${rid}" data-date="${d}">${letterHtml}${ControleCargas.atrasoBadgeHtml(ovs)}${commentDot}</div></td>`;
  });

  html += ControleCargas.colunasAnotacaoHtml(targetType, rid);
  html += '</tr>';
  return html;
},

// [refatoração 2026-07-20] buildMatrix() virou uma orquestradora fina;
// cabeçalho, os 2 ramos de corpo (Carteiras/Agrupamentos) e a atualização
// de DOM/estado ganharam sua própria função abaixo. LÓGICA/HTML idênticos,
// só a organização mudou (CLAUDE.md §3).

/* Contexto:
   Monta a seta ▲/▼ de um <th data-sort> clicável, só quando ele é o critério
   de ordenação ATIVO (state.sort) — mesma direção usada por sortArrayBy()
   (state.sortDir: 1 = padrão, -1 = invertida). Chamada por
   buildCabecalhoMatriz() [2026-07-24, pedido do usuário: "permitir
   ordenação... clicando no cabeçalho" + seta indicando direção/coluna
   ativa]. Retorna string HTML (vazia quando a coluna não é a ativa).

   Pseudocódigo:
     1. Coluna ≠ critério ativo -> string vazia.
     2. Coluna == critério ativo -> ▲ (direção padrão) ou ▼ (invertida). */
setaOrdenacaoHtml(criterio){
  if(ControleCargas.state.sort !== criterio) return '';
  return `<span class="sortarrow"> ${ControleCargas.state.sortDir===-1?'▼':'▲'}</span>`;
},

/* Contexto:
   Monta o <thead> da matriz principal — MESMAS colunas nas duas abas
   (paridade Agrupamentos x Carteiras, PLANNING §Visão por Agrupamento
   "Paridade de informação"): Company, nome, Instituição, Modelo de Carga,
   janela de dias, Responsável/Comentário sobre atuação. Chamada 1x por
   buildMatrix(). Retorna string HTML do <thead>.

   Pseudocódigo:
     1. Colunas fixas: Company + nome (rótulo "Carteira"/"Agrupamento"
        conforme a aba) + Instituição + Modelo de Carga [REVISADO
        2026-07-29, pedido do usuário: "remova o campo prioridade, traga
        instituição para esse campo... quero também o campo Modelo de carga
        ao lado" — Prioridade saiu da matriz (continua disponível como
        critério de ordenação na sortbar, ver wireOrdenacao()/index.js);
        Instituição ganhou coluna própria clicável (mesmo critério de
        ordenação `institution` que já existia); Modelo de Carga é só
        informativo, sem ordenação] — as colunas clicáveis ganham a seta de
        direção (setaOrdenacaoHtml).
     2. 1 coluna por dia da janela, destacando a coluna de referência (▾
        ref), mostrando o dia da semana nas demais e marcando (foco) a coluna
        escolhida pelo usuário pra alimentar o painel "Carteiras Publicadas"
        (data-date + classe "focuscol" quando ≠ ref — clique religado em
        wireHeaderDateClicks()).
     3. As 2 colunas editáveis Responsável/Comentário sobre atuação
        [2026-07-24, pedido do usuário; REPOSICIONADAS 2026-07-25 pra logo
        após os dias da janela — mesma ordem do Excel] — não clicáveis pra
        ORDENAR (texto livre, não faz sentido ordenar por comentário), mas
        ganharam o botão "▾" de filtro estilo Excel [2026-07-29, pedido do
        usuário — ver filtro_cabecalho.js]. São as últimas colunas da matriz
        [REMOVIDO 2026-08-05, pedido do usuário — migração API Beehus: as 3
        colunas-resumo Últ. Unp/Pro/Pub que vinham depois saíram por
        completo, sem endpoint equivalente na API; ver db.py]. */
buildCabecalhoMatriz(window_, refDate, isWallets){
  const focusDate = ControleCargas.state.focusDate || refDate;
  let thead = `<thead><tr>`;
  thead += `<th class="hdr-company" data-sort="company">Company${ControleCargas.setaOrdenacaoHtml('company')}</th>`;
  thead += `<th class="hdr-name" data-sort="name">${isWallets?'Carteira':'Agrupamento'}${ControleCargas.setaOrdenacaoHtml('name')}</th>`;
  thead += `<th class="hdr-summary" data-sort="institution">Instituição${ControleCargas.setaOrdenacaoHtml('institution')}${ControleCargas.renderFiltroCabecalhoBotaoHtml('institution')}</th>`;
  thead += `<th class="hdr-summary">Modelo de Carga${ControleCargas.renderFiltroCabecalhoBotaoHtml('loadModel')}</th>`;
  window_.forEach(d=>{
    const isRef = d===refDate;
    const isFocus = d===focusDate;
    const classe = isRef ? 'ref' : (isFocus ? 'focuscol' : '');
    // [REVISADO 2026-07-29, pedido do usuário: "...o texto da Ref (aqui
    // acrescentar texto + Problema Rent para filtrar os com problema)"] só
    // a coluna de referência ganha o botão de filtro "estilo Excel"
    // (statusRef) — substitui o antigo select "Status na Data Ref" + chip
    // "Só divergência" da toolbar (ver filtros.js). [CORRIGIDO 2026-07-29,
    // mesmo dia, pedido do usuário — o botão nascia FORA do <span
    // class="refline"> (display:block), então quebrava linha e ficava
    // espremido entre o cabeçalho e a 1ª linha de dados, quase invisível;
    // agora entra DENTRO do span, na mesma linha do texto "▾ ref".]
    thead += `<th class="${classe}" data-date="${d}" title="Clique para ver &quot;Carteiras Publicadas&quot; nesta data">${ControleCargas.fmtDM(d)}${isRef?`<span class="refline">▾ ref ${ControleCargas.renderFiltroCabecalhoBotaoHtml('statusRef')}</span>`:`<br><span style="font-weight:400">${ControleCargas.weekdayAbbrev(d)}</span>`}${(isFocus&&!isRef)?'<span class="focusline">● foco</span>':''}</th>`;
  });
  thead += `<th class="hdr-summary" title="Só na data de referência (${refDate}) — editável">Responsável${ControleCargas.renderFiltroCabecalhoBotaoHtml('responsavel')}</th>`;
  thead += `<th class="hdr-summary" title="Só na data de referência (${refDate}) — editável">Comentário sobre atuação${ControleCargas.renderFiltroCabecalhoBotaoHtml('comentarioAtuacao')}</th>`;
  thead += '</tr></thead>';
  return thead;
},

/* Contexto:
   Monta o corpo (<tr>...) da aba Carteiras — lista plana, ordenada pelo
   critério corrente. Chamada 1x por buildMatrix() quando a view é
   'wallets'. Retorna {body, shownCount}.

   Pseudocódigo:
     1. Ordena as carteiras (sortedRows).
     2. Monta 1 <tr> por carteira (rowHtml) e conta quantas foram
        mostradas (aqui, sempre = total, não há colapso nesta aba). */
buildCorpoMatrizCarteiras(data, window_){
  const rows = ControleCargas.sortedRows(data, true);
  let body = '';
  rows.forEach(r=> body += ControleCargas.rowHtml(r, true, window_));
  return { body, shownCount: rows.length };
},

/* Contexto:
   Monta o corpo (<tr>...) da aba Agrupamentos — SEMPRE segmentado nos 3
   blocos de prioridade, independente do critério de ordenação escolhido (o
   controle de ordenação só reordena DENTRO de cada bloco; decisão de design
   deste protótipo para manter a hierarquia de prioridade sempre visível —
   PLANNING §Visão por Agrupamento). Chamada 1x por buildMatrix() quando a
   view é 'groupings'. Retorna {body, shownCount}.

   Pseudocódigo:
     1. Pega os 3 blocos já classificados (getGroupingBlocks).
     2. Para cada bloco não-vazio, monta a linha de cabeçalho do bloco + 1
        <tr> por agrupamento (rowHtml).
     3. Bloco 3 é colapsável: se state.showBloco3, mostra as linhas + botão
        "ocultar"; senão, só o botão "mostrar +N". */
buildCorpoMatrizAgrupamentos(window_){
  const colspan = 3 + window_.length + 3 + 2; // Company+Nome+Prioridade, dias, 3 colunas-resumo, Responsável+Comentário
  let body = '';
  const [b1, b2, b3] = ControleCargas.getGroupingBlocks();
  const shownCount = b1.length + b2.length + b3.length;

  if(b1.length){
    body += `<tr class="bloco-head"><td colspan="${colspan}">Bloco 1 — ${b1.length} agrupamento${b1.length===1?'':'s'} com pendência de carteiras do Template</td></tr>`;
    b1.forEach(r=> body += ControleCargas.rowHtml(r, false, window_));
  }
  if(b2.length){
    body += `<tr class="bloco-head"><td colspan="${colspan}">Bloco 2 — ${b2.length} agrupamento${b2.length===1?'':'s'} sem pendência (carteiras do Template em dia)</td></tr>`;
    b2.forEach(r=> body += ControleCargas.rowHtml(r, false, window_));
  }
  if(b3.length){
    body += `<tr class="bloco-head"><td colspan="${colspan}">Bloco 3 — ${b3.length} agrupamento${b3.length===1?'':'s'} não rastreados (zero carteiras do Template ativas na janela)</td></tr>`;
    if(ControleCargas.state.showBloco3){
      b3.forEach(r=> body += ControleCargas.rowHtml(r, false, window_));
      body += `<tr class="bloco3-row"><td colspan="${colspan}"><button class="bloco3-toggle" id="bloco3-toggle">▴ ocultar bloco 3</button></td></tr>`;
    } else {
      body += `<tr class="bloco3-row"><td colspan="${colspan}"><button class="bloco3-toggle" id="bloco3-toggle">+${b3.length} agrupamentos não rastreados — mostrar</button></td></tr>`;
    }
  }
  return { body, shownCount };
},

/* Contexto:
   Injeta o HTML já montado (cabeçalho+corpo) na tabela e atualiza tudo que
   depende desse redesenho: contador "Mostrando X de Y", nota explicativa do
   grid, reindexação de window._ROWS_BY_ID e religamento de tooltip/cliques
   de linha/toggle do bloco 3. Chamada 1x por buildMatrix(), como último
   passo. Não retorna nada.

   Pseudocódigo:
     1. Fecha qualquer popover de filtro de cabeçalho aberto — o <th> que o
        ancora está prestes a ser destruído [2026-07-29].
     2. Substitui o innerHTML da tabela por thead+tbody.
     3. Atualiza o contador "Mostrando X de Y" e a nota do grid (texto
        diferente por aba).
     4. Reindexa window._ROWS_BY_ID (usado pelo tooltip/painel) com TODAS as
        linhas da view corrente, mesmo as escondidas no bloco 3 colapsado.
     5. Liga o toggle do bloco 3 (se presente) e religa tooltip + cliques de
        linha (precisam ser religados a cada redesenho do DOM). */
atualizarDomEEstadoMatriz(table, thead, body, data, isWallets, shownCount, window_, refDate){
  ControleCargas.fecharFiltroCabecalho();
  table.innerHTML = thead + '<tbody>' + body + '</tbody>';

  document.getElementById('resultcount').textContent =
    `Mostrando ${shownCount} de ${data.length} ${isWallets?'carteiras':'agrupamentos'}`;

  document.getElementById('grid-note').textContent = isWallets
    ? `Lista plana, ordenada por prioridade (rank do estado na data de referência + nº de dias da janela com esse mesmo estado, pior primeiro — ver painel de detalhe). Janela: ${window_[0]} .. ${window_[window_.length-1]} (${window_.length} du), referência D-${ControleCargas.SNAPSHOT.meta.gridReferenceLagDu} = ${refDate}. Prazos de SLA sempre calculados contra o hoje real (${ControleCargas.SNAPSHOT.meta.today}).`
    : 'Cada linha é um agrupamento — a célula herda cor/sigla da pior carteira-membro ativa na data. Publicada só quando 100% das carteiras-membro publicaram. Blocos 1→2→3 = prioridade (pendência no Template → sem pendência → não rastreados); dentro de cada bloco, mesma ordenação por prioridade das Carteiras.';

  // storage para tooltip/painel — inclui TODAS as linhas da view corrente
  // (mesmo as escondidas no Bloco 3 colapsado, pra abrir o painel funcionar
  // mesmo antes de expandir)
  window._ROWS_BY_ID = {};
  data.forEach(r=> window._ROWS_BY_ID[r.walletId||r.groupingId]=r);

  const b3toggle = document.getElementById('bloco3-toggle');
  if(b3toggle) b3toggle.addEventListener('click', ()=>{ ControleCargas.state.showBloco3 = !ControleCargas.state.showBloco3; ControleCargas.buildMatrix(); });

  ControleCargas.initTooltip();
  ControleCargas.wireRowClicks();
  ControleCargas.wireHeaderDateClicks();
  ControleCargas.wireColunasAnotacao();
},

/* Contexto:
   Liga o clique em cada coluna de data do cabeçalho de QUALQUER tabela
   ".matrix" (grid principal Carteiras/Agrupamentos E a matriz da aba
   Company — mesmo seletor, mesmo atributo data-date nas duas) — pedido do
   usuário 2026-07-23: escolher, pelo cabeçalho, a data que os painéis
   "Carteiras/Agrupamentos Publicados" (buildPublishStat/
   buildGroupingPublishStat) devem mostrar, em vez de sempre a data de
   referência do grid. Chamada no fim de atualizarDomEEstadoMatriz() e de
   buildCompanyMatrix() (precisa religar a cada redesenho do DOM). Não
   retorna nada.

   Pseudocódigo:
     1. Resolve a data em foco corrente (state.focusDate ou, na ausência, a
        data de referência) — só pra decidir o efeito do clique.
     2. Para cada <th data-date>, liga um clique: se o alvo é o botão "▾" de
        filtro estilo Excel (só a coluna de referência tem, ver
        buildCabecalhoMatriz/filtro_cabecalho.js), IGNORA — quem trata esse
        clique é wireFiltrosCabecalho(), não o foco de data [2026-07-29,
        senão os dois cliques disparariam juntos]. Senão, se a coluna
        clicada já é a que está em foco, volta ao default (null = data de
        referência); senão, foca nela.
     3. Qualquer mudança reconstrói a view visível corrente — a matriz
        principal (aba Carteiras/Agrupamentos) ou a matriz de Company —, que
        por sua vez recalcula os painéis de publicação. */
wireHeaderDateClicks(){
  const refDate = ControleCargas.SNAPSHOT.meta.referenceDate;
  const focusDateAtual = ControleCargas.state.focusDate || refDate;
  document.querySelectorAll('table.matrix thead th[data-date]').forEach(th=>{
    th.addEventListener('click', (e)=>{
      if(e.target.closest('.th-filter-btn')) return;
      const d = th.dataset.date;
      ControleCargas.state.focusDate = (d===focusDateAtual) ? null : d;
      if(ControleCargas.state.view==='company') ControleCargas.buildCompanyMatrix();
      else ControleCargas.buildMatrix();
    });
  });
},

/* Contexto:
   Reconstrói a matriz principal (aba Carteiras ou Agrupamentos, conforme
   state.view) do zero — cabeçalho + corpo + estatísticas de rodapé.
   Chamada sempre que um filtro/ordenação/aba muda e depois de qualquer
   atualização de snapshot. Orquestradora fina — cada peça é montada por uma
   função própria (ver acima). Não retorna nada (substitui o innerHTML da
   tabela).

   Pseudocódigo:
     1. Resolve a lista de dados da aba corrente e a janela de datas.
     2. Monta o cabeçalho (buildCabecalhoMatriz).
     3. Monta o corpo: buildCorpoMatrizCarteiras (aba Carteiras) ou
        buildCorpoMatrizAgrupamentos (aba Agrupamentos).
     4. Injeta tudo no DOM e atualiza o estado dependente
        (atualizarDomEEstadoMatriz).
     5. Recalcula os painéis "Carteiras Publicadas" e "Agrupamentos
        Publicados" (buildPublishStat/buildGroupingPublishStat) — ficam aqui
        (e não em buildHeader) porque precisam reagir a toda mudança de
        filtro/data em foco, não só ao 1º render/atualização de snapshot. */
buildMatrix(){
  const table = document.getElementById('matrix');
  const isWallets = ControleCargas.state.view==='wallets';
  const data = isWallets ? ControleCargas.SNAPSHOT.wallets : ControleCargas.SNAPSHOT.groupings;
  const window_ = ControleCargas.SNAPSHOT.meta.window;
  const refDate = ControleCargas.SNAPSHOT.meta.referenceDate;

  // índice global de carteiras por id — usado por computeGroupingPublishStat()
  // (resolve mustPublish/cells da carteira a partir do walletId do membro),
  // mesmo quando a tabela corrente é a de Agrupamentos. [CORRIGIDO 2026-07-23] antes ficava em
  // cache com "||" e nunca era refeito depois de um /api/atualizar (o
  // SNAPSHOT troca de objeto, mas o índice antigo continuava valendo) —
  // sempre recalcula, é barato (~800 carteiras) e evita dado parado.
  window._WALLETS_BY_ID = Object.fromEntries(ControleCargas.SNAPSHOT.wallets.map(w=>[w.walletId,w]));

  const thead = ControleCargas.buildCabecalhoMatriz(window_, refDate, isWallets);
  const { body, shownCount } = isWallets
    ? ControleCargas.buildCorpoMatrizCarteiras(data, window_)
    : ControleCargas.buildCorpoMatrizAgrupamentos(window_);

  ControleCargas.atualizarDomEEstadoMatriz(table, thead, body, data, isWallets, shownCount, window_, refDate);
  ControleCargas.buildHeader();
  ControleCargas.buildPublishStat();
  ControleCargas.buildGroupingPublishStat();
},

// ─────────────────────────────────────────────────────────────────────────
// Tooltip (dados reais embutidos em cada célula pelo build_snapshot.py)
// ─────────────────────────────────────────────────────────────────────────
/* Contexto:
   Acha a célula de uma linha (carteira/agrupamento) numa data específica,
   usada pelo tooltip para reidratar os dados completos a partir de
   rid+date guardados no dataset da célula do DOM. Retorna a célula ou null.

   Pseudocódigo:
     1. Resolve a linha pelo índice global window._ROWS_BY_ID.
     2. Sem linha -> null.
     3. Com linha, busca a célula cujo campo "d" bate com `date`. */
findCell(rid, date){
  const r = window._ROWS_BY_ID[rid];
  if(!r) return null;
  return r.cells.find(c=>c.d===date);
},

/* Contexto:
   Monta o HTML do tooltip de uma célula de CARTEIRA (hover/foco). Chamada
   por initTooltip(). Retorna string HTML.

   Pseudocódigo:
     1. Monta a linha "Status" com o nome legível do estado (hover enxuto —
        os horários por estágio ficam só no clique/drill-down).
     2. Se há SLA, divergência de rentabilidade, issues ou sequência
        quebrada, monta as linhas extras correspondentes.
     3. Monta o cabeçalho (nome + data + instituição/modelo de carga) e
        junta tudo com uma régua separadora antes das linhas extras. */
walletTooltip(r, entry){
  const st = ControleCargas.STATES[entry.s];
  const tt = entry.tt || {};
  const line = (label,val,warn)=> `<div class="tt-row"><span class="tt-label${warn?' tt-warn':''}">${label}</span><span class="tt-val${warn?' tt-warn':''}">${val}</span></div>`;
  // [2026-07-18] Hover enxuto (pedido do usuário): a checklist de horários
  // por estágio (Unprocessed/Processada/Publicada ✓ HH:MM) SAIU do hover —
  // esses horários vivem só no clique (painel de drill-down, seção
  // "Situação do dia selecionado"). No lugar entra a linha "Status" com o
  // nome legível do estado (ControleCargas.STATES[s].name): a confirmação célula-a-célula
  // que a legenda genérica não dá. Ficam no hover só o essencial de triagem:
  // Status + SLA + divergência + issues + sequência.
  const stageBlock = line('Status', st.name);
  let slaLine = tt.sla ? line('SLA', tt.sla, !!tt.slaWarn) : '';
  let extra = '';
  if(tt.div) extra += line('Δ Rent', `Contrib ${(tt.div.rc*100).toFixed(4)}% × NAV ${(tt.div.rn*100).toFixed(4)}% → ${tt.div.bp.toFixed(1)} bp`);
  if(tt.issues) extra += line('Issues', tt.issues);
  if(tt.seq) extra += `<div class="tt-row"><span class="tt-label tt-warn">⚠ Sequência</span><span class="tt-val tt-warn">processada sem D-1</span></div>`;
  // comentário do analista vigente nessa célula — pedido do usuário
  // 2026-07-23 ("ao passar o mouse... precisa aparecer o comentário").
  const comentarioCelula = ControleCargas.cellCommentTexts('wallet', r.walletId, entry.d);
  if(comentarioCelula) extra += line('Comentário', ControleCargas.esc(comentarioCelula), ControleCargas.cellCommentSeverity('wallet', r.walletId, entry.d)==='red');
  // Responsável + Comentário sobre atuação (anotacoes.js) — só existem na
  // data de referência; mesmo balão da célula que o comentário de alerta
  // acima, ver rowHtml() [2026-07-30, pedido do usuário; REVISADO no mesmo
  // dia: "na atuação pode aparecer Responsável & Comentário sobre atuação"
  // — faltava o Responsável, só o texto do comentário aparecia].
  const responsavelCelula = ControleCargas.atuacaoResponsavelNaData('wallet', r.walletId, entry.d);
  if(responsavelCelula) extra += line('Responsável', ControleCargas.esc(responsavelCelula));
  const atuacaoCelula = ControleCargas.atuacaoTextoNaData('wallet', r.walletId, entry.d);
  if(atuacaoCelula) extra += line('Atuação', ControleCargas.esc(atuacaoCelula));
  // Explosão de ativos (wallets.securitiesForExplosion, Mongo) — metadado
  // ESTÁTICO da carteira (não varia por dia da janela, ao contrário das
  // linhas acima), por isso aparece em QUALQUER célula, não só na
  // referência [2026-07-31, pedido do usuário: "precisamos coletar a
  // explosão de Ativos de cada carteira... que essa informação apareça ao
  // passar o mouse na célula da matriz"].
  if((r.explodedAssets||[]).length) extra += line('Explode em', r.explodedAssets.map(ControleCargas.esc).join(', '));

  // régua só quando há algo abaixo dela; rodapé lembra onde os horários
  // foram parar (drill-down) — descobribilidade da informação movida.
  const below = slaLine + extra;
  return `<div class="tt-h">${ControleCargas.esc(r.name)}</div>
    <div class="tt-sub">${ControleCargas.weekdayAbbrev(entry.d)} ${entry.d}${r.institution?(' · '+ControleCargas.esc(r.institution)):''}${r.loadModel?(' · '+ControleCargas.esc(r.loadModel)):''}${r.monthly?' · carga mensal':''}</div>
    ${stageBlock}${below?('<div class="tt-rule"></div>'+below):''}
    <div class="tt-sub" style="margin-top:4px">clique — horários por estágio + detalhes</div>`;
},

/* Contexto:
   Monta o HTML do tooltip de uma célula de AGRUPAMENTO (hover/foco).
   Chamada por initTooltip(). Retorna string HTML.

   Pseudocódigo:
     1. Monta a linha "Status" com o nome legível do estado do roll-up.
     2. Monta as contagens por estágio (publicadas/processadas/unprocessed/
        aguardando/faltando) sobre o total de membros ativos no dia.
     3. Lista os NOMES das carteiras-membro não processadas na data desta
        célula [2026-07-24, pedido do usuário: "ao passar o mouse deve se
        mostrar as carteiras não processadas desse agrupamento"] — resolve
        cada walletId de tt.unprocessedIds via window._WALLETS_BY_ID.
     4. Se há overlay de issue ou sequência, monta as linhas extras.
     5. Monta o cabeçalho (nome + nº de membros ativos + data). */
groupingTooltip(r, entry){
  const tt = entry.tt || {};
  const counts = tt.counts || {};
  const line = (label,val,warn)=> `<div class="tt-row"><span class="tt-label${warn?' tt-warn':''}">${label}</span><span class="tt-val${warn?' tt-warn':''}">${val}</span></div>`;
  const n = tt.n || 0;
  // [2026-07-18] Mesmo princípio do ControleCargas.walletTooltip: linha "Status" com o nome
  // legível do estado do roll-up abre o tooltip. As contagens por estágio
  // FICAM — são triagem (quantas carteiras seguram o agrupamento), não
  // horário granular; horários individuais só no drill-down das carteiras.
  let body = line('Status', ControleCargas.STATES[entry.s] ? ControleCargas.STATES[entry.s].name : '—');
  // [rodada 7] wc/wu já agregam TODAS as severidades do estágio (o fundo não
  // se divide mais por atraso) — os mockkeys au/ac/au2/ac2 deixaram de existir.
  const pub = (counts.p||0)+(counts.cD||0);
  const pro = counts.wc||0;
  const unp = counts.wu||0;
  const miss = counts.miss||0;
  const wait = counts.wait||0;
  body += line('Publicadas', `${pub}/${n}`);
  if(pro) body += line('Processadas', `${pro}/${n}`);
  if(unp) body += line('Unprocessed', `${unp}/${n}`);
  if(wait) body += line('Aguardando', `${wait}/${n}`);
  if(miss) body += line('Faltando', `${miss}/${n}`, true);
  let extra = '';
  const unprocessedIds = tt.unprocessedIds || [];
  if(unprocessedIds.length){
    const nomes = unprocessedIds.map(wid=> (window._WALLETS_BY_ID && window._WALLETS_BY_ID[wid]) ? window._WALLETS_BY_ID[wid].name : wid);
    extra += `<div class="tt-row"><span class="tt-label tt-warn">Não processadas (${nomes.length})</span></div>
      <div class="tt-sub" style="margin:2px 0 0;line-height:1.5;">${nomes.map(nm=>ControleCargas.esc(nm)).join('<br>')}</div>`;
  }
  if((entry.ov||[]).includes('issue')) extra += line('Issues','há issues pendentes entre os membros');
  if((entry.ov||[]).includes('seq')) extra += `<div class="tt-row"><span class="tt-label tt-warn">⚠ Sequência</span><span class="tt-val tt-warn">≥1 carteira fora de sequência</span></div>`;
  // comentário do analista vigente nessa célula — pedido do usuário
  // 2026-07-23 ("ao passar o mouse... precisa aparecer o comentário").
  const comentarioCelula = ControleCargas.cellCommentTexts('grouping', r.groupingId, entry.d);
  if(comentarioCelula) extra += line('Comentário', ControleCargas.esc(comentarioCelula), ControleCargas.cellCommentSeverity('grouping', r.groupingId, entry.d)==='red');
  // Responsável + Comentário sobre atuação (anotacoes.js) — só existem na
  // data de referência; mesmo balão da célula que o comentário de alerta
  // acima, ver rowHtml() [2026-07-30, pedido do usuário; REVISADO no mesmo
  // dia: "na atuação pode aparecer Responsável & Comentário sobre atuação"
  // — faltava o Responsável, só o texto do comentário aparecia].
  const responsavelCelula = ControleCargas.atuacaoResponsavelNaData('grouping', r.groupingId, entry.d);
  if(responsavelCelula) extra += line('Responsável', ControleCargas.esc(responsavelCelula));
  const atuacaoCelula = ControleCargas.atuacaoTextoNaData('grouping', r.groupingId, entry.d);
  if(atuacaoCelula) extra += line('Atuação', ControleCargas.esc(atuacaoCelula));
  return `<div class="tt-h">${ControleCargas.esc(r.name)}</div>
    <div class="tt-sub">Agrupamento · ${n} carteiras ativas na data — ${ControleCargas.weekdayAbbrev(entry.d)} ${entry.d}</div>
    ${body}${extra?('<div class="tt-rule"></div>'+extra):''}`;
},

/* Contexto:
   Liga o hover/foco de tooltip em toda célula da matriz principal. Chamada
   no fim de buildMatrix() (precisa religar a cada redesenho, já que o DOM
   das células é recriado). Não retorna nada.

   Pseudocódigo:
     1. Para cada .cell, liga um handler "show" que resolve a linha+célula,
        escolhe o tooltip certo (carteira ou agrupamento) e posiciona o
        balão perto da célula (com clamp pra não sair da tela).
     2. Liga o "hide" para esconder o balão.
     3. Associa os dois handlers a mouseenter/mouseleave e focus/blur
        (acessibilidade via teclado). */
initTooltip(){
  const tt = document.getElementById('tt');
  document.querySelectorAll('.cell').forEach(cell=>{
    const show = ()=>{
      const rid = cell.dataset.rid, date = cell.dataset.date;
      const r = window._ROWS_BY_ID[rid];
      const entry = ControleCargas.findCell(rid, date);
      if(!r || !entry) return;
      tt.innerHTML = cell.dataset.view==='wallets' ? ControleCargas.walletTooltip(r, entry) : ControleCargas.groupingTooltip(r, entry);
      const rect = cell.getBoundingClientRect();
      const ttW = 320;
      let left = rect.left + rect.width/2 - ttW/2;
      left = Math.max(8, Math.min(left, window.innerWidth - ttW - 8));
      tt.style.left = left+'px';
      let top = rect.bottom + 8;
      if(top + 220 > window.innerHeight) top = rect.top - 220;
      tt.style.top = top+'px';
      tt.classList.add('show');
    };
    const hide = ()=> tt.classList.remove('show');
    cell.addEventListener('mouseenter', show);
    cell.addEventListener('mouseleave', hide);
    cell.addEventListener('focus', show);
    cell.addEventListener('blur', hide);
  });
},

// ─────────────────────────────────────────────────────────────────────────
// Legenda
// ─────────────────────────────────────────────────────────────────────────
/* Contexto:
   Desenha a legenda completa da matriz — TUDO que pode aparecer na matriz
   está aqui (regra: nada entra na matriz sem entrar na legenda). Chamada no
   init() e sempre que o snapshot é trocado. Não retorna nada.

   Pseudocódigo:
     1. Monta o grupo de cores de fundo (8 estados de estágio — [REVISADO
        2026-07-18, rodada 7]: verde tem 2 siglas Pub/Pro, 2 vermelhos de
        faltando, 2 cinzas de "nada esperado ainda").
     2. Monta o grupo dos 5 marcadores sobrepostos (badge Rent, badge
        Atraso, anel de sequência, triângulo de issues, balão de
        comentário).
     3. Monta a nota explicativa da aba Agrupamentos (blocos de prioridade +
        roll-up pior caso).
     4. Injeta os 3 grupos no container #legend. */
buildLegend(){
  // [REVISADO 2026-07-18, rodada 7] Legenda completa: TUDO que pode aparecer
  // na matriz está aqui — 8 fundos (3 de estágio, sendo que o verde tem 2
  // siglas: Pub, ou Pro quando Deve Publicar = Não; 2 vermelhos de faltando;
  // 2 cinzas de "nada esperado ainda"), os 5 marcadores sobrepostos (badge
  // Rent, badge Atraso NOVO, anel de sequência, triângulo de issues, balão
  // de comentário) e a nota da aba Agrupamentos. Regra: nada entra na matriz
  // sem entrar aqui.
  const el = document.getElementById('legend');

  // Fundos (PLANNING §Simbologia — tabela "Estados de fundo"). [REVISADO
  // 2026-07-24, pedido do usuário] A ordem de PRIORIDADE de exibição real
  // (usada pra ordenar as linhas e pro painel de KPI) continua pior→melhor
  // (ControleCargas.PRIORITY_ORDER/compute_sort_key em snapshot_builder.py)
  // — [INVERTIDO 2026-07-25, pedido do usuário: "na legenda, somente na
  // legenda, pode inverter a ordem de exibição dos alertas"] só a LISTA da
  // legenda em si foi invertida (melhor→pior); miss/miss2 viraram um único
  // item "miss" — o badge de Atraso já distingue 1-2du de ≥3du, não precisa
  // de 2 fundos.
  const colorRows = [
    ['p',      'Publicada (concluída)'],
    ['cD',     'Processada e não publica (Deve Publicar = Não) — concluída'],
    ['wc',     'Processada — aguardando publicação (esteja no prazo ou não; atraso = badge)'],
    ['wu',     'Unprocessed carregada — falta processar (esteja no prazo ou não; atraso = badge)'],
    ['notcov', 'Não coberto — só em Agrupamentos (sem carteira-membro rastreada/ativa nesta data); [REVISADO 2026-07-25] carteiras nunca mais mostram este estado'],
    ['wait',   'Aguardando — no prazo, situação normal'],
    ['miss',   'Sem Unprocessed — prazo VENCIDO, agir (atraso = badge)'],
  ];
  let colorGroup = '<div class="legend-group"><span class="lg-title">Cor de fundo = estágio da esteira · ordem = melhor → pior (só nesta legenda)</span>';
  colorRows.forEach(([k,label])=>{
    const st = ControleCargas.STATES[k];
    const letter = k==='miss' ? `<span class="emptyset">${st.letter}</span>` : st.letter;
    colorGroup += `<div class="legend-item"><span class="legend-swatch ${st.cls}">${letter}</span><span>${label}</span></div>`;
  });
  colorGroup += '</div>';

  // 5 marcadores — arranjo fixo dos 4 cantos + 1 borda (rodada 7):
  // Rent = sup. dir. · Issues = sup. esq. · Atraso = inf. esq. ·
  // Comentário = inf. dir. · Sequência = anel na borda inteira.
  let overlayGroup = '<div class="legend-group"><span class="lg-title">Marcadores sobrepostos (4 cantos + borda)</span>';
  overlayGroup += `<div class="legend-item"><span class="legend-swatch s-g1" style="position:relative;"><span class="atraso-badge">Atras</span></span><span>Badge <b>Atraso</b> amarelo (inf. esq.) — qualquer estágio ≠ Publicado (Unp/Pro em andamento ou vazio ∅) com prazo vencido há 1–2 du</span></div>`;
  overlayGroup += `<div class="legend-item"><span class="legend-swatch s-g1" style="position:relative;"><span class="atraso-badge strong">Atras</span></span><span>Badge <b>Atraso</b> vermelho — idem, prazo vencido há ≥3 du</span></div>`;
  overlayGroup += `<div class="legend-item"><span class="legend-swatch s-g1 ov-dot" style="color:transparent">•</span><span>Badge <b>Rent</b> amarelo (sup. dir.) — divergência Rent Contribuição × Rent NAV leve, &gt;2bp (0,02%) <b>e</b> impacto ≥ R$800</span></div>`;
  overlayGroup += `<div class="legend-item"><span class="legend-swatch s-g1 ov-div_strong" style="color:transparent">•</span><span>Badge <b>Rent</b> vermelho — divergência elevada, &gt;5bp (idem, impacto ≥ R$800)</span></div>`;
  overlayGroup += `<div class="legend-item"><span class="legend-swatch s-g1 ov-seq" style="color:transparent">•</span><span>Anel vermelho (borda) — fora de sequência: processada sem D-1 processada</span></div>`;
  overlayGroup += `<div class="legend-item"><span class="legend-swatch s-g1 ov-issue" style="color:transparent">•</span><span>Triângulo (sup. esq.) — issues pendentes na carteira-dia</span></div>`;
  // balão — comentário humano vigente; NUNCA substitui a cor calculada
  // (PLANNING §Sistema de Comentários — "Aparência na célula").
  overlayGroup += `<div class="legend-item"><span class="legend-swatch s-g1" style="position:relative;"><span class="cmt-dot yellow"></span></span><span>Balão (inf. dir.) — comentário do analista vigente (verde/amarelo/vermelho = severidade humana; some ao expirar; na linha = balão ao lado do nome)</span></div>`;
  // Responsável / Comentário sobre atuação — [2026-07-30, revisado no
  // mesmo dia após feedback visual do usuário] compartilha o MESMO canto do
  // balão acima (não há canto livre) mas é um marcador PRÓPRIO
  // (.atuacao-dot), sempre pequeno e por cima — nunca um anel
  // envolvendo/aumentando o balão de severidade (1ª tentativa, revertida
  // por ficar "invertida"). [REVISADO 2026-08-06, pedido do usuário: "pode
  // deixar a inclusão desse ícone para quando só houver responsável
  // também" — passou a contar Responsável OU Comentário, não só o
  // Comentário; legenda atualizada pra não confundir quem só preencheu
  // Responsável.]
  overlayGroup += `<div class="legend-item"><span class="legend-swatch s-g1" style="position:relative;"><span class="atuacao-dot"></span></span><span>Ponto azul pequeno (mesmo canto, inf. dir.) — Responsável e/ou Comentário sobre atuação preenchidos na data de referência (só existe nesse dia)</span></div>`;
  overlayGroup += `<div class="legend-item"><span class="legend-swatch s-g1" style="position:relative;"><span class="cmt-dot yellow"></span><span class="atuacao-dot"></span></span><span>O mesmo ponto azul, por cima do balão — comentário do analista <b>e</b> Responsável/Comentário sobre atuação juntos na mesma célula</span></div>`;
  // [NOVO 2026-08-13] "Comprada" — carteira que é o ativo de explosão de
  // outra carteira do Template, ainda com pendência (mapear_carteiras_
  // compradas, snapshot_builder.py). Só carteiras (nunca Agrupamento).
  overlayGroup += `<div class="legend-item"><span class="comprada-badge">Comprada</span><span>Carteira comprada (explodida) por outra carteira do Template, ainda com pendência — anel violeta na linha inteira + prioridade na ordenação (resolver esta carteira primeiro; passa à frente de quem a compra)</span></div>`;
  overlayGroup += '</div>';

  // Nota da aba Agrupamentos — blocos de prioridade + roll-up pior caso.
  let groupNote = '<div class="legend-group"><span class="lg-title">Aba Agrupamentos</span>';
  groupNote += `<div class="legend-item"><span>Mesma simbologia; a célula herda cor+sigla da <b>pior</b> carteira-membro ativa no dia (Publicada só com 100% publicadas). Linhas segmentadas em <b>3 blocos de prioridade</b>: 1 — com pendência no Template · 2 — sem pendência · 3 — não rastreados (sem carteiras do Template; colapsado, só divergência é calculável). Dentro de cada bloco, ordenação pelo mesmo score de prioridade (0–100, pior primeiro) das Carteiras.</span></div>`;
  groupNote += '</div>';

  el.innerHTML = colorGroup + overlayGroup + groupNote;
},

// ─────────────────────────────────────────────────────────────────────────
// Cabeçalho / stats
// ─────────────────────────────────────────────────────────────────────────
/* Contexto:
   Desenha o subcabeçalho (hoje/referência/total de carteiras/timestamp de
   geração), a nota do calendário de dias úteis e a fileira de estatísticas
   por ESTADO (mockkey na data de referência) — [REVISADO 2026-07-24, pedido
   do usuário: substitui o painel Crítica/Atenção/Observação/OK, aposentado
   junto com o "tier", por cards com a MESMA simbologia da legenda]. Chamada
   no init() e a cada atualização de snapshot/filtro. Não retorna nada.

   Pseudocódigo:
     1. Escreve o texto do subcabeçalho e da nota de calendário (com aviso
        se o calendário caiu no fallback sem feriados).
     2. Aplica os filtros correntes (mesma applyFilters da grade) sobre as
        carteiras e conta quantas têm cada mockkey na data de referência.
     3. Monta 1 card por mockkey, na ordem de prioridade (pior → melhor,
        PRIORITY_ORDER), com o swatch colorido da legenda + contagem, e
        injeta no container #stat-row. */
buildHeader(){
  const m = ControleCargas.SNAPSHOT.meta;
  document.getElementById('subhead-meta').innerHTML =
    `Hoje: <b>${m.today}</b> · Referência do grid (D-${m.gridReferenceLagDu}): <b>${m.referenceDate}</b> · ` +
    `<b>${m.totalWallets}</b> carteiras cadastradas (Template) · gerado em ${ControleCargas.SNAPSHOT.generatedAt.replace('T',' ')}.`;
  document.getElementById('calendar-note').textContent =
    `Calendário de dias úteis: ${m.calendarSource}${m.calendarFallback?' — ATENÇÃO: fallback sem feriados em uso.':''}`;

  const carteirasFiltradas = ControleCargas.applyFilters(ControleCargas.SNAPSHOT.wallets, true);
  const contagemPorMockkey = {};
  carteirasFiltradas.forEach(w=>{
    const mk = ControleCargas.mockkeyReferencia(w) || 'notcov';
    contagemPorMockkey[mk] = (contagemPorMockkey[mk]||0) + 1;
  });
  let html = '';
  ControleCargas.PRIORITY_ORDER.forEach(mk=>{
    const st = ControleCargas.STATES[mk];
    const letter = mk==='miss' ? `<span class="emptyset">${st.letter}</span>` : st.letter;
    html += `<div class="stat">
      <div style="display:flex;align-items:center;gap:8px;">
        <span class="legend-swatch ${st.cls}">${letter}</span>
        <div class="n">${contagemPorMockkey[mk]||0}</div>
      </div>
      <div class="lbl">${ControleCargas.esc(st.name)}</div>
    </div>`;
  });
  document.getElementById('stat-row').innerHTML = html;
},

/* Contexto:
   Calcula o KPI "Carteiras Publicadas" — dentre as carteiras que PRECISAM
   publicar E têm a data em foco como esperada (mustPublish e não "notcov":
   exclui dia intermediário de carteira mensal e pré-onboarding), quantas já
   estão no estado Publicada ("p"). Respeita os filtros correntes da tela
   (empresa/instituição/busca/só-pendência) e a data escolhida pelo usuário
   no cabeçalho da matriz (state.focusDate — pedido do usuário 2026-07-23:
   "deve se referir somente à data selecionada"; sem seleção, cai na data de
   referência do grid). Chamada por buildPublishStat(). Retorna {publicadas,
   total, percentual, focusDate} (percentual null quando não há nenhuma
   carteira no denominador).

   Pseudocódigo:
     1. Resolve a data em foco (state.focusDate ou, na ausência, a data de
        referência do grid).
     2. Aplica os filtros correntes (ControleCargas.applyFilters, mesma
        função usada pela grade da aba Carteiras) sobre TODAS as carteiras.
     3. Para cada uma, descarta as que não precisam publicar (mustPublish
        falso) e as que não têm a data em foco como esperada (célula ausente
        ou estado "notcov").
     4. Conta o total restante (deveriam publicar na data em foco) e quantas
        estão publicadas ("p").
     5. Calcula o percentual (null se total=0, pra não dividir por zero). */
computePublishStat(){
  const focusDate = ControleCargas.state.focusDate || ControleCargas.SNAPSHOT.meta.referenceDate;
  const carteirasFiltradas = ControleCargas.applyFilters(ControleCargas.SNAPSHOT.wallets, true);
  let total = 0, publicadas = 0;
  carteirasFiltradas.forEach(carteira=>{
    if(!carteira.mustPublish) return;
    const celulaNaData = ControleCargas.cellByDate(carteira)[focusDate];
    if(!celulaNaData || celulaNaData.s === 'notcov') return;
    total++;
    if(celulaNaData.s === 'p') publicadas++;
  });
  const percentual = total ? (publicadas/total*100) : null;
  return { publicadas, total, percentual, focusDate };
},

/* Contexto:
   Desenha o painel "Carteiras Publicadas" (#publish-card) — KPI principal
   pedido pelo usuário 2026-07-23, antes até dos cartões de tier: quantas
   carteiras que deveriam publicar na data em foco já publicaram, com
   percentual e barra de progresso. A data em foco é escolhida clicando numa
   coluna do cabeçalho da matriz (wireHeaderDateClicks); por default é a data
   de referência do grid. [REVISADO 2026-07-23, pedido do usuário] Só aparece
   na aba Carteiras — Agrupamentos tem o seu próprio par ("Agrupamentos
   Publicados", buildGroupingPublishStat) e Company/Controle de Cargas não
   fazem sentido com este card (já mostram sua própria granularidade: %
   por company / dados do custodiante). Chamada no fim de buildMatrix() e de
   buildCompanyMatrix() (assim recalcula a cada mudança de filtro/aba/data em
   foco, não só no 1º render). Não retorna nada.

   Pseudocódigo:
     1. Fora da aba Carteiras, esconde o card e sai (nada a desenhar).
     2. Calcula o KPI (computePublishStat), já com a data em foco resolvida.
     3. Escolhe a cor de status (ok/att/crit) pelo percentual — mesmas
        faixas de leitura do semáforo da matriz (100% = ok, ≥80% = atenção,
        abaixo = crítico); sem carteiras no denominador, neutro.
     4. Monta o rótulo da data em foco (dia da semana + data), sinalizando
        quando é a data de referência default (nenhuma escolhida manualmente).
     5. Monta o texto de escopo (empresa filtrada ou "todas as empresas").
     6. Injeta número, percentual, barra de progresso e dica de uso no
        container. */
buildPublishStat(){
  const container = document.getElementById('publish-card');
  if(!container) return;
  if(ControleCargas.state.view !== 'wallets'){ container.style.display = 'none'; return; }
  container.style.display = '';

  const { publicadas, total, percentual, focusDate } = ControleCargas.computePublishStat();
  const corStatus = percentual===null ? 'att' : (percentual>=100 ? 'ok' : percentual>=80 ? 'att' : 'crit');
  const percentualLbl = percentual===null ? '—' : `${percentual.toFixed(1)}%`;
  const larguraBarra = percentual===null ? 0 : Math.max(0, Math.min(100, percentual));
  const escopo = ControleCargas.state.company ? ControleCargas.esc(ControleCargas.state.company) : 'todas as empresas';
  const ehDataReferencia = !ControleCargas.state.focusDate;
  const dataLbl = `${ControleCargas.weekdayAbbrev(focusDate)} ${focusDate}${ehDataReferencia?' (referência)':''}`;

  container.innerHTML = `
    <div class="publish-card-top">
      <span class="lbl">Carteiras Publicadas — ${dataLbl}</span>
      <span class="publish-pct ${corStatus}">${percentualLbl}</span>
    </div>
    <div class="publish-nums">${publicadas}<span class="of"> / ${total}</span><span class="publish-caption">deveriam publicar</span></div>
    <div class="publish-meter"><div class="publish-meter-fill ${corStatus}" style="width:${larguraBarra}%"></div></div>
    <div class="publish-scope">${escopo} · clique numa data no cabeçalho da grade pra trocar</div>
  `;
},

/* Contexto:
   Decide se 1 membro de agrupamento (registro vindo de g.members — ver
   montar_dict_linha_grouping() no backend) está ativo no grouping EXATAMENTE
   na data pedida — espelho em JS de _membro_ativo_em() (snapshot_builder.py),
   mesma regra (initialDateOnGrouping..finalDateOnGrouping). Usada por
   computeGroupingPublishStat() pra saber quais carteiras-membro contam pro
   roll-up do dia em foco. Retorna bool.

   Pseudocódigo:
     1. Sem data inicial registrada ou data em foco >= início -> não descarta
        por início.
     2. Sem data final registrada ou data em foco <= fim -> não descarta por
        fim.
     3. Passou nos dois -> membro ativo naquela data. */
membroAtivoNaData(membro, data){
  const inicial = membro.initialDateOnGrouping;
  const final = membro.finalDateOnGrouping;
  if(inicial && inicial > data) return false;
  if(final && final < data) return false;
  return true;
},

/* Contexto:
   Resolve as carteiras-membro que DEVERIAM publicar 1 agrupamento numa data
   específica — extraído de dentro de computeGroupingPublishStat() [2026-08-24,
   decisão do usuário: liberar a extração de 2 helpers puros, comportamento
   IDÊNTICO ao que já vivia inline, só reorganizado em função própria] para
   ser reaproveitado também pela matriz nova "Publicação por Hora"
   (matriz_publicacao_hora.js), sem duplicar a regra. Cruza as carteiras-
   membro rastreadas (tracked=true) ativas na data (membroAtivoNaData) com o
   índice global window._WALLETS_BY_ID, mantendo só as que têm
   mustPublish=true. Retorna array de carteiras (objetos de SNAPSHOT.wallets;
   vazio quando nenhuma deveria publicar nesse dia).

   Pseudocódigo:
     1. Filtra os membros do agrupamento: rastreados e ativos na data.
     2. Resolve a carteira de cada membro via o índice global.
     3. Mantém só as carteiras existentes com mustPublish=true. */
agrupamentoCarteirasQueDevemPublicarNaData(grouping, data){
  return (grouping.members||[])
    .filter(m=> m.tracked && ControleCargas.membroAtivoNaData(m, data))
    .map(m=> window._WALLETS_BY_ID[m.walletId])
    .filter(carteira=> carteira && carteira.mustPublish);
},

/* Contexto:
   Decide se um agrupamento está com TODAS as carteiras-membro que deveriam
   publicar (já resolvidas por agrupamentoCarteirasQueDevemPublicarNaData) de
   fato publicadas numa data — extraído de dentro de
   computeGroupingPublishStat() [2026-08-24, decisão do usuário, mesmo motivo
   do helper acima: comportamento IDÊNTICO, só reorganizado], reaproveitado
   também pela matriz "Publicação por Hora". Retorna bool.

   Pseudocódigo:
     1. Sem nenhuma carteira no denominador -> não conta como publicado
        (o chamador normalmente já filtra esse caso antes de chegar aqui;
        devolve false por segurança, nunca lança exceção).
     2. Publicado quando TODA carteira do array tem célula com s==='p'
        nessa data. */
agrupamentoEstaPublicadoNaData(grouping, data, carteirasQueDevemPublicar){
  if(!carteirasQueDevemPublicar || !carteirasQueDevemPublicar.length) return false;
  return carteirasQueDevemPublicar.every(carteira=>{
    const celula = ControleCargas.cellByDate(carteira)[data];
    return celula && celula.s === 'p';
  });
},

/* Contexto:
   Calcula o KPI "Agrupamentos Publicados" — pedido do usuário 2026-07-23,
   "seguindo igual o das Carteiras": cruza as carteiras do nosso Template
   (SNAPSHOT.wallets — só existem ali as que estão no registry), a data
   inicial/final delas DENTRO de cada agrupamento (BD, campo
   initialDateOnGrouping/finalDateOnGrouping em g.members) e os agrupamentos
   de que participam (BD, groupings.wallets[]), pra decidir — por
   agrupamento, na data em foco — se TODAS as carteiras-membro que devem
   publicar (mustPublish) já publicaram. Diferente de simplesmente ler
   cells[d].s==='p' do roll-up (que mistura no "pior caso" também membros com
   mustPublish=falso — ver montar_celula_grouping_dia() do backend): aqui o
   cálculo é refeito membro a membro só com quem precisa publicar, pra não
   penalizar um agrupamento por causa de um membro que nunca precisou
   publicar. Respeita os filtros correntes da tela e a mesma data em foco do
   painel de Carteiras (state.focusDate). Chamada por
   buildGroupingPublishStat(). Retorna {publicados, total, percentual,
   focusDate}.

   [REVISADO 2026-08-24, decisão do usuário] A regra de "deveria publicar"/
   "está publicado" foi extraída para agrupamentoCarteirasQueDevemPublicarNaData()/
   agrupamentoEstaPublicadoNaData() logo acima — esta função só orquestra,
   comportamento e retorno IDÊNTICOS a antes da extração.

   Pseudocódigo:
     1. Resolve a data em foco (state.focusDate ou a data de referência).
     2. Aplica os filtros correntes sobre os agrupamentos (mesma função da
        aba Agrupamentos).
     3. Para cada agrupamento, resolve as carteiras-membro que deveriam
        publicar na data em foco (agrupamentoCarteirasQueDevemPublicarNaData).
     4. Sem nenhuma carteira nessa condição, o agrupamento não entra no
        denominador (nada esperado dele na data em foco).
     5. Conta o total (agrupamentos com ao menos 1 carteira que devia
        publicar) e quantos têm TODAS essas carteiras publicadas
        (agrupamentoEstaPublicadoNaData).
     6. Calcula o percentual (null se total=0). */
computeGroupingPublishStat(){
  const focusDate = ControleCargas.state.focusDate || ControleCargas.SNAPSHOT.meta.referenceDate;
  const agrupamentosFiltrados = ControleCargas.applyFilters(ControleCargas.SNAPSHOT.groupings, false);
  let total = 0, publicados = 0;
  agrupamentosFiltrados.forEach(grouping=>{
    const carteirasQueDevemPublicar = ControleCargas.agrupamentoCarteirasQueDevemPublicarNaData(grouping, focusDate);
    if(!carteirasQueDevemPublicar.length) return;
    total++;
    if(ControleCargas.agrupamentoEstaPublicadoNaData(grouping, focusDate, carteirasQueDevemPublicar)) publicados++;
  });
  const percentual = total ? (publicados/total*100) : null;
  return { publicados, total, percentual, focusDate };
},

/* Contexto:
   Desenha o painel "Agrupamentos Publicados" (#grouping-publish-card) — par
   do "Carteiras Publicadas", só visível na aba Agrupamentos (pedido do
   usuário 2026-07-23). Chamada no fim de buildMatrix() e buildCompanyMatrix()
   (precisa reagir a toda mudança de filtro/data em foco/aba). Não retorna
   nada.

   Pseudocódigo:
     1. Fora da aba Agrupamentos, esconde o card e sai (nada a desenhar).
     2. Calcula o KPI (computeGroupingPublishStat).
     3. Mesma lógica de cor/rótulo/barra do painel de Carteiras. */
buildGroupingPublishStat(){
  const container = document.getElementById('grouping-publish-card');
  if(!container) return;
  if(ControleCargas.state.view !== 'groupings'){ container.style.display = 'none'; return; }
  container.style.display = '';

  const { publicados, total, percentual, focusDate } = ControleCargas.computeGroupingPublishStat();
  const corStatus = percentual===null ? 'att' : (percentual>=100 ? 'ok' : percentual>=80 ? 'att' : 'crit');
  const percentualLbl = percentual===null ? '—' : `${percentual.toFixed(1)}%`;
  const larguraBarra = percentual===null ? 0 : Math.max(0, Math.min(100, percentual));
  const escopo = ControleCargas.state.company ? ControleCargas.esc(ControleCargas.state.company) : 'todas as empresas';
  const ehDataReferencia = !ControleCargas.state.focusDate;
  const dataLbl = `${ControleCargas.weekdayAbbrev(focusDate)} ${focusDate}${ehDataReferencia?' (referência)':''}`;

  container.innerHTML = `
    <div class="publish-card-top">
      <span class="lbl">Agrupamentos Publicados — ${dataLbl}</span>
      <span class="publish-pct ${corStatus}">${percentualLbl}</span>
    </div>
    <div class="publish-nums">${publicados}<span class="of"> / ${total}</span><span class="publish-caption">deveriam publicar</span></div>
    <div class="publish-meter"><div class="publish-meter-fill ${corStatus}" style="width:${larguraBarra}%"></div></div>
    <div class="publish-scope">${escopo} · clique numa data no cabeçalho da grade pra trocar</div>
  `;
},

// ─────────────────────────────────────────────────────────────────────────
// Arrastar para ver datas anteriores/posteriores — pedido do usuário: a janela
// da matriz mostra só um recorte de dias úteis, e clicar-e-arrastar (como um
// mapa) é mais rápido que os botões ◀/▶ para navegar bastante para trás.
// Isso é puro comportamento de scroll horizontal nativo do navegador
// (scrollLeft) — não mexe nos dados nem na janela calculada no snapshot, só
// na forma de rolar o container que já tinha overflow-x:auto.
/* Contexto:
   Liga o comportamento de "arrastar para rolar" (como um mapa) num
   container de grid com overflow-x:auto — pedido do usuário para navegar
   mais rápido do que os botões ◀/▶. Chamada 1x por container
   (.grid-scroll), no init(). Não retorna nada.

   Pseudocódigo:
     1. No mousedown (botão esquerdo), inicia o arrasto e guarda a posição
        inicial do mouse e do scroll.
     2. No mousemove, se está arrastando, atualiza o scrollLeft pela
        diferença de posição do mouse (marca `moved` se passou de um
        limiar pequeno).
     3. No mouseup, encerra o arrasto; se houve movimento real, marca a
        flag de "suprimir o próximo clique" (evita abrir o painel de
        detalhe sem querer ao soltar o mouse em cima de uma célula).
     4. No click do container, se a flag estiver marcada, cancela a
        propagação do evento e limpa a flag.

   [REVISADO 2026-08-07, pedido do usuário: "ao clickar na célula da
   matriz, qualquer coisa que eu faça, arrasta o mouse fecha a janela"] o
   limiar que decide se houve "arrasto" subiu de 3px pra
   LIMIAR_ARRASTO_PX (8px) — 3px era sensível demais: o tremor natural da
   mão durante um clique comum (mouse ou trackpad) já bastava pra marcar
   moved=true, o que suprime o click no passo 4 e por tabela impede o
   click de abrir o painel de detalhe (wireRowClicks, paineis.js) — a
   célula parecia "não responder"/"fechar a janela" sem nunca ter aberto.
   8px ainda é bem menor que um arrasto horizontal intencional (que
   percorre dezenas/centenas de px), então continua distinguindo bem os
   dois gestos. */
enableDragScroll(container){
  const LIMIAR_ARRASTO_PX = 8;
  let dragging = false, startX = 0, startScroll = 0, moved = false;
  container.addEventListener('mousedown', (e)=>{
    // botão esquerdo só, e não iniciar arrasto a partir de uma célula focável
    // via teclado (mantém clique normal em célula funcionando), nem a partir
    // do nome da carteira/agrupamento (.wname) — pedido do usuário: permite
    // arrastar o mouse sobre o nome pra SELECIONAR/copiar o texto em vez de
    // rolar a tabela (ver user-select:text em .wname, controle_cargas.css).
    if(e.button !== 0 || e.target.closest('.wname')) return;
    dragging = true; moved = false;
    startX = e.clientX; startScroll = container.scrollLeft;
    container.classList.add('dragging');
  });
  window.addEventListener('mousemove', (e)=>{
    if(!dragging) return;
    const dx = e.clientX - startX;
    if(Math.abs(dx) > LIMIAR_ARRASTO_PX) moved = true;   // só conta como "arrasto" além do limiar
    container.scrollLeft = startScroll - dx;
  });
  window.addEventListener('mouseup', ()=>{
    if(!dragging) return;
    dragging = false;
    container.classList.remove('dragging');
    // se realmente arrastou, suprime o click da célula que soltaria o mouse
    // em cima dela (evita abrir o painel de detalhe sem querer ao arrastar)
    if(moved) container.dataset.suppressClick = '1';
  });
  container.addEventListener('click', (e)=>{
    if(container.dataset.suppressClick === '1'){
      e.stopPropagation();
      delete container.dataset.suppressClick;
    }
  }, true);
},
});
