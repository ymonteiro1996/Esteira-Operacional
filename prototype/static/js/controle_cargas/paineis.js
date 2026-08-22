/* ControleCargas.paineis — painéis de detalhe (drill-down) de Carteira e Agrupamento + modal genérico.
   Parte do objeto único ControleCargas (ver state.js). Gerado a partir da
   refatoração de index_template.html (CLAUDE.md §4, "Divisão clara das
   páginas" — pasta static/js/controle_cargas/, 1 arquivo por funcionalidade).
*/
Object.assign(ControleCargas, {
// ─────────────────────────────────────────────────────────────────────────
// Drill-down: modal genérico + Painéis de Detalhe completos (PLANNING.md
// §Painéis de Detalhe — Carteira: 9 seções / Agrupamento: 6 seções, sempre
// nesta ordem). Clique numa célula OU no nome da linha abre o painel; toda
// célula é clicável, não só as com pendência (seções de problema aparecem
// com "nada aberto" quando a carteira/agrupamento está saudável).
// ─────────────────────────────────────────────────────────────────────────
/* Contexto:
   Abre o modal genérico de drill-down com o HTML pronto (já montado por
   buildWalletPanel()/buildGroupingPanel()). Chamada por essas duas funções.
   Não retorna nada.

   Pseudocódigo:
     1. Injeta o HTML recebido + o rodapé com o botão "Fechar".
     2. Mostra o backdrop do modal. */
openModal(html){
  document.getElementById('modal-body').innerHTML = html + '<div class="modal-close"><button class="btn secondary" onclick="ControleCargas.closeModal()">Fechar</button></div>';
  document.getElementById('modal-backdrop').classList.add('show');
},

/* Contexto: fecha o modal de drill-down — chamada pelo botão "Fechar", pelo
   clique no backdrop e pela tecla Esc (wireModalGlobalHandlers()). Não
   retorna nada.

   Pseudocódigo:
     1. Esconde o backdrop do modal. */
closeModal(){ document.getElementById('modal-backdrop').classList.remove('show'); },

/* Contexto: monta o chip visual do STATUS (mockkey na data focada) — usado
   no cabeçalho dos dois painéis de detalhe. Substitui o antigo chip de tier
   (Crítica/Atenção/Observação/OK, aposentado 2026-07-24) — usa a MESMA
   simbologia/cor da legenda (ControleCargas.STATES), não uma escala própria.
   Retorna string HTML.

   Pseudocódigo:
     1. Sem mockkey reconhecido -> chip neutro "Status —".
     2. Monta um <span> colorido com o bg/fg do estado (mesmas CSS vars
        --state-*-bg/-fg da célula na matriz) e o nome legível
        correspondente (STATES[mockkey].name). */
statusChipHtml(mockkey){
  const st = ControleCargas.STATES[mockkey];
  if(!st) return '<span class="pchip">Status —</span>';
  const varBase = 'state-' + st.cls.replace('s-', '');
  return `<span class="pchip" style="background:var(--${varBase}-bg);color:var(--${varBase}-fg)">${ControleCargas.esc(st.name)}</span>`;
},

/* Contexto: monta o chip de prioridade de exibição — substitui o antigo
   score numérico 0–100 (aposentado 2026-07-24, junto com o tier). Mostra o
   nome do estado na data de referência + quantos dias da janela pesquisada
   tiveram esse MESMO estado (mesma dupla usada por compute_sort_key,
   snapshot_builder.py — "sem posição em todos os dias do range" = mais
   prioritário). Usado no cabeçalho dos dois painéis de detalhe. Retorna
   string HTML.

   Pseudocódigo:
     1. Resolve o mockkey da linha na data de referência.
     2. Lê a contagem (dias com esse mesmo mockkey) direto do 2º elemento do
        sortKey (guardado como -contagem).
     3. Monta o chip com "nome do estado · contagem/tamanho da janela dias". */
priorityChipHtml(r, windowLength){
  const mockkeyRef = ControleCargas.mockkeyReferencia(r);
  const st = ControleCargas.STATES[mockkeyRef];
  const contagem = (r.sortKey && r.sortKey.length > 1) ? -r.sortKey[1] : null;
  return `<span class="pchip" title="Prioridade de exibição — rank do estado na data de referência + nº de dias da janela com esse mesmo estado (compute_sort_key, snapshot_builder.py)">Prioridade: ${ControleCargas.esc(st ? st.name : '—')}${contagem != null ? (' · ' + contagem + '/' + windowLength + ' dias') : ''}</span>`;
},

/* Contexto:
   Monta a mini-timeline/mini-matriz: 1 linha de células reaproveitando a
   MESMA simbologia do grid principal (PLANNING: "mesma simbologia +
   overlays"). Usada nos dois painéis de detalhe (carteira e, por membro,
   agrupamento). Retorna string HTML.

   Pseudocódigo:
     1. Para cada dia da janela, resolve a célula (ou "não coberto") e
        desenha com a mesma cor/sigla/overlay/badge de atraso do grid
        principal, marcando como "focused" o dia igual a `focusDate`.
     2. Cada célula carrega `data-panel-date` — clique nela re-abre o
        painel focado naquele dia (ligado por wirePanelInteractions()). */
miniTimelineHtml(r, window_, focusDate){
  let html = '<div class="mini-row">';
  const cmap = ControleCargas.cellByDate(r);
  window_.forEach(d=>{
    const entry = cmap[d];
    const st = entry ? ControleCargas.STATES[entry.s] : ControleCargas.STATES.notcov;
    const ovs = entry && entry.ov ? ControleCargas.ovClass(entry.ov) : '';
    const focusedCls = d===focusDate ? 'focused' : '';
    const letter = entry && entry.s==='miss' ? `<span class="emptyset">${st.letter}</span>` : (entry?st.letter:'—');
    html += `<div class="cell ${st.cls} ${ovs} ${focusedCls}" data-panel-date="${d}" title="${d}">${letter}${ControleCargas.atrasoBadgeHtml(entry&&entry.ov)}</div>`;
  });
  html += '</div>';
  return html;
},

/* Contexto:
   Resolve os objetos de agrupamento (linhas do snapshot) associados a uma
   carteira, a partir de r.groupingIds. Usada pela seção 8 do painel de
   carteira ("Agrupamentos da carteira"). Retorna array de linhas de
   agrupamento (sem os IDs que não foram encontrados).

   Pseudocódigo:
     1. Para cada groupingId da carteira, busca a linha correspondente em
        SNAPSHOT.groupings.
     2. Descarta os que não foram encontrados (Boolean filter). */
findGroupingsForWallet(r){
  return (r.groupingIds||[]).map(gid=> ControleCargas.SNAPSHOT.groupings.find(g=>g.groupingId===gid)).filter(Boolean);
},

/* Contexto:
   Monta a lista de carteiras-membro "ofensoras" (mockkey na data de
   referência ∉ {p, cD} — tier foi aposentado, 2026-07-24) de um
   agrupamento, no MESMO formato usado pelo Painel de Agrupamento seção 2
   (PLANNING: "sempre primeiro"). Retorna string HTML.

   Pseudocódigo:
     1. Sem membros ofensores, mostra uma nota vazia.
     2. Para cada membro, resolve a célula na data de referência (cor/sigla
        do estado, ícones dos overlays ativos) e monta 1 linha clicável
        (drill-through pra o painel da carteira) com Nome da Carteira E
        WalletID visíveis [2026-07-24, pedido do usuário: "ao clicar também
        deve mostrar com Nome da Carteira e WalletID"]. */
offenderListHtml(members){
  if(!members.length) return '<p class="empty-note">Nenhuma carteira-membro rastreada com pendência.</p>';
  const refDate = ControleCargas.SNAPSHOT.meta.referenceDate;
  let html = '';
  members.forEach(w=>{
    const cmap = ControleCargas.cellByDate(w);
    const entry = cmap[refDate];
    const st = entry ? ControleCargas.STATES[entry.s] : null;
    const letter = entry && entry.s==='miss' ? '∅' : (entry?st.letter:'—');
    const ovIcons = (entry&&entry.ov||[]).map(o=>({div:'Rent',div_strong:'Rent',seq:'◇',issue:'◤',atraso:'Atras',atraso_strong:'Atras'}[o]||'')).join(' ');
    html += `<div class="offender" data-drill-wallet="${w.walletId}">
      <div class="cell ${st?st.cls:'s-g2'}" style="min-width:34px;height:22px;font-size:10px;">${letter}</div>
      <div class="oname">${ControleCargas.esc(w.name)}${ControleCargas.acoesIdentificadorHtml(w.name)} <code style="font-size:10px;color:var(--ink-faint);user-select:all;">${ControleCargas.esc(w.walletId)}</code>${ControleCargas.acoesIdentificadorHtml(w.walletId)}</div>
      <div class="ometa">${st?ControleCargas.esc(st.name):'—'}${entry&&entry.tt&&entry.tt.sla?(' · '+ControleCargas.esc(entry.tt.sla)):''} ${ovIcons}</div>
    </div>`;
  });
  return html;
},

/* [refatoração 2026-07-20] wirePanelInteractions() virou uma orquestradora
   fina — religar foco de data, religar drill-through e a lógica de negócio
   de submissão de comentário viraram 3 funções próprias abaixo. LÓGICA
   idêntica, só a organização mudou (CLAUDE.md §3). */

/* Contexto:
   Religa o clique em cada célula da mini-timeline (data-panel-date) do
   painel recém-renderizado: reabre o MESMO painel focado no dia clicado.
   Chamada por wirePanelInteractions() logo depois de openModal(). Não
   retorna nada.

   Pseudocódigo:
     1. Para cada elemento com data-panel-date dentro do corpo do modal,
        liga um clique que reabre o painel (carteira ou agrupamento,
        conforme targetType) focado naquele dia. */
wireFocoDataPainel(body, targetType, targetId){
  body.querySelectorAll('[data-panel-date]').forEach(el=>{
    el.addEventListener('click', ()=>{
      const d = el.dataset.panelDate;
      if(targetType==='wallet') ControleCargas.buildWalletPanel(targetId, d); else ControleCargas.buildGroupingPanel(targetId, d);
    });
  });
},

/* Contexto:
   Religa o drill-through carteira<->agrupamento do painel recém-
   renderizado (ex.: clicar numa carteira ofensora dentro do painel de
   agrupamento, ou num agrupamento dentro do painel de carteira). Chamada
   por wirePanelInteractions() logo depois de openModal(). Não retorna nada.

   Pseudocódigo:
     1. Elementos com data-drill-wallet abrem o painel de carteira do id
        indicado, preservando a data focada corrente.
     2. Elementos com data-drill-grouping abrem o painel de agrupamento do
        id indicado, preservando a data focada corrente. */
wireDrillThroughPainel(body, focusDate){
  body.querySelectorAll('[data-drill-wallet]').forEach(el=>{
    el.addEventListener('click', ()=> ControleCargas.buildWalletPanel(el.dataset.drillWallet, focusDate));
  });
  body.querySelectorAll('[data-drill-grouping]').forEach(el=>{
    el.addEventListener('click', ()=> ControleCargas.buildGroupingPanel(el.dataset.drillGrouping, focusDate));
  });
},

/* Contexto:
   Liga a lógica de negócio do formulário de comentário do painel (seção 9
   de Carteira / 6 de Agrupamento, quando presente): seleção de severidade e
   submissão via POST /api/comments. Chamada por wirePanelInteractions()
   logo depois de openModal(). Não retorna nada.

   Pseudocódigo:
     1. Sem formulário de comentário no painel corrente, não há o que ligar
        — sai.
     2. Liga a seleção de severidade (botões verde/amarelo/vermelho,
        classe .on exclusiva).
     3. Liga o clique de "Adicionar comentário": valida severidade+texto,
        deriva o escopo comparando as datas De/Até (iguais = pontual, vira
        `cellDate`; diferentes = recorrente, `cellDate` nulo — [REMOVIDO
        2026-07-28, pedido do usuário: existia um rádio "Pontual"/
        "Recorrente" separado das datas; ele pediu pra eliminar o controle
        extra e deixar a MESMA data De/Até decidir o escopo sozinha]), faz
        o POST via postComment(), recarrega os comentários e re-renderiza
        o painel + a matriz (pro balão aparecer); erro de rede mostra
        mensagem amigável no formulário. */
wireFormularioComentarioPainel(body, targetType, targetId, focusDate){
  const form = body.querySelector('.comment-form');
  if(!form) return;
  let selectedSev = null;
  form.querySelectorAll('.sevbtn').forEach(b=> b.addEventListener('click', ()=>{
    selectedSev = b.dataset.sev;
    form.querySelectorAll('.sevbtn').forEach(x=>x.classList.remove('on'));
    b.classList.add('on');
  }));
  form.querySelector('[data-action="submit-comment"]').addEventListener('click', ()=>{
    const msgEl = form.querySelector('.formmsg');
    msgEl.className = 'formmsg'; msgEl.textContent = '';
    const text = form.querySelector('textarea').value.trim();
    const validFrom = form.querySelector('.cf-from').value;
    const validTo = form.querySelector('.cf-to').value;
    const cellDate = (validFrom && validTo && validFrom===validTo) ? validFrom : null;
    if(!selectedSev){ msgEl.classList.add('err'); msgEl.textContent = 'Selecione a severidade (verde/amarelo/vermelho).'; return; }
    if(!text){ msgEl.classList.add('err'); msgEl.textContent = 'Escreva um comentário.'; return; }
    ControleCargas.postComment({
      targetType: form.dataset.targetType, targetId: form.dataset.targetId,
      cellDate, severity: selectedSev, text, validFrom, validTo,
    }).then(()=> ControleCargas.loadComments()).then(()=>{
      msgEl.classList.add('ok'); msgEl.textContent = 'Comentário salvo.';
      // re-renderiza o painel (mostra o comentário novo) + a matriz (balão)
      if(targetType==='wallet') ControleCargas.buildWalletPanel(targetId, focusDate); else ControleCargas.buildGroupingPanel(targetId, focusDate);
      ControleCargas.buildMatrix();
    }).catch(err=>{
      msgEl.classList.add('err');
      msgEl.textContent = 'Erro ao salvar: ' + err.message + ' (servidor Flask/app.py rodando?)';
    });
  });
},

/* Contexto:
   Liga os elementos interativos DENTRO do painel de detalhe recém-
   renderizado: re-foco de data na mini-timeline, drill-through
   carteira<->agrupamento, e submissão do formulário de comentário (POST
   /api/comments). Chamada logo depois de openModal() por
   buildWalletPanel()/buildGroupingPanel(). Orquestradora fina — cada
   responsabilidade é uma função própria (ver acima). Não retorna nada.

   Pseudocódigo:
     1. Religa foco de data (wireFocoDataPainel).
     2. Religa drill-through (wireDrillThroughPainel).
     3. Liga a lógica do formulário de comentário (wireFormularioComentarioPainel). */
wirePanelInteractions(targetType, targetId, focusDate){
  const body = document.getElementById('modal-body');
  ControleCargas.wireFocoDataPainel(body, targetType, targetId);
  ControleCargas.wireDrillThroughPainel(body, focusDate);
  ControleCargas.wireFormularioComentarioPainel(body, targetType, targetId, focusDate);
},

// ═══ Painel de Detalhe — CARTEIRA (9 seções, PLANNING §Painéis de Detalhe) ═══
// [refatoração 2026-07-20] buildWalletPanel() virou uma orquestradora fina;
// cada uma das 9 seções ganhou sua própria função buildSecaoXyz(...), que só
// monta e devolve o HTML daquela seção. LÓGICA/HTML idênticos, só a
// organização mudou (CLAUDE.md §3).

/* Contexto: monta a seção 1 (cabeçalho + chips de cadastro) do painel de
   carteira — nome, walletId, dia focado, company/instituição/modelo de
   carga, chip de status e de prioridade. Chamada por buildWalletPanel().
   Retorna string HTML.

   Pseudocódigo:
     1. Monta o <h3> + subtítulo (walletId + dia focado).
     2. Monta a fileira de chips, omitindo os que não se aplicam
        (instituição/modelo de carga vazios). */
buildSecaoCabecalhoCarteira(r, focusDate){
  // sem ℹ️ nos dois (nome e walletId): já estamos dentro do painel deste
  // mesmo alvo — só o 📋 faz sentido aqui (identificadores.js) [2026-07-30].
  let html = `<h3>${ControleCargas.esc(r.name)}${ControleCargas.acoesIdentificadorHtml(r.name)}</h3><div class="modal-sub">Carteira · walletId <code style="user-select:all">${ControleCargas.esc(r.walletId)}</code>${ControleCargas.acoesIdentificadorHtml(r.walletId)} · ${ControleCargas.weekdayAbbrev(focusDate)} ${focusDate}</div>`;
  html += `<div class="chiprow">
    <span class="pchip">${ControleCargas.esc(r.company)}</span>
    ${r.institution?`<span class="pchip">${ControleCargas.esc(r.institution)}</span>`:''}
    ${r.loadModel?`<span class="pchip">${ControleCargas.esc(r.loadModel)}${r.isManualLoad?' (manual)':''}</span>`:''}
    ${ControleCargas.statusChipHtml(ControleCargas.mockkeyReferencia(r))}
    ${ControleCargas.priorityChipHtml(r, ControleCargas.SNAPSHOT.meta.window.length)}
  </div>`;
  // Responsável/Comentário sobre atuação (anotacoes.js) — pedido do usuário
  // 2026-07-30: o clique na célula (que abre este painel) também precisa
  // mostrar o comentário, não só o hover (tooltip, escondido pelo modal).
  html += ControleCargas.resumoAtuacaoHtml('wallet', r.walletId);
  return html;
},

/* Contexto: monta a seção 2 (mini-timeline da janela) do painel de
   carteira. Chamada por buildWalletPanel(). Retorna string HTML.

   [REMOVIDO 2026-08-05, pedido do usuário — migração API Beehus] A tabela
   de últimas datas Unprocessed/Processada/Publicada que ficava abaixo da
   mini-timeline saiu por completo — sem endpoint equivalente na API (ver
   db.py).

   Pseudocódigo:
     1. Título com o tamanho da janela em du.
     2. Mini-timeline reaproveitando a simbologia do grid principal. */
buildSecaoJanelaCarteira(r, window_, focusDate){
  let html = `<div class="psec"><h4>Janela (${window_.length} du)</h4>`;
  html += ControleCargas.miniTimelineHtml(r, window_, focusDate);
  html += `</div>`;
  return html;
},

/* Contexto: monta a seção 3 (situação detalhada do dia focado — horários
   por estágio + SLA) do painel de carteira. Chamada por buildWalletPanel().
   Retorna string HTML.

   Pseudocódigo:
     1. Sem célula pra esse dia -> nota vazia explicando o motivo
        [2026-07-25, pedido do usuário: aposentado o gate de pré-onboarding
        em compute_cell() — carteira nunca mais produz mockkey "notcov"; a
        checagem de "notcov" aqui só sobra como defesa contra dado ausente].
     2. Senão, tabela com Unprocessed/Processada/Publicada (✓ horário BRT ou
        ✗ ausente) + linha de SLA quando aplicável. */
buildSecaoSituacaoDiaCarteira(entry, focusDate){
  let html = `<div class="psec"><h4>Situação — ${ControleCargas.weekdayAbbrev(focusDate)} ${focusDate}</h4>`;
  if(!entry || entry.s==='notcov'){
    html += `<p class="empty-note">Sem dado para este dia.</p>`;
  } else {
    const tt = entry.tt || {};
    html += `<table class="ptable">
      <tr><th>Etapa</th><th>Status</th></tr>
      <tr><td>Unprocessed</td><td>${tt.u?`✓ ${ControleCargas.esc(tt.u)} BRT`:'✗ ausente'}</td></tr>
      <tr><td>Processada</td><td>${tt.c?`✓ ${ControleCargas.esc(tt.c)} BRT${tt.reproc?` (reproc. ${ControleCargas.esc(tt.reproc)})`:''}`:'✗ ausente'}</td></tr>
      <tr><td>Publicada</td><td>${tt.p?`✓ ${ControleCargas.esc(tt.p)} BRT`:(entry.s==='cD'?'— não publica (Deve Publicar = Não)':'✗ ausente')}</td></tr>
      ${tt.sla?`<tr><td>SLA</td><td${tt.slaWarn?' style="color:var(--state-r1-fg);font-weight:700"':''}>${ControleCargas.esc(tt.sla)}</td></tr>`:''}
    </table>`;
  }
  html += `</div>`;
  return html;
},

/* Contexto: monta a seção 4 (cadastro & SLA completos) do painel de
   carteira. Chamada por buildWalletPanel(). Retorna string HTML.

   Pseudocódigo:
     1. Tabela com instituição, company, modelo de carga, periodicidade,
        defasagem/SLA, deve publicar, repetição diária, exceção, explosão
        (nota manual do Excel) + explode em (lista real do Mongo,
        wallets.securitiesForExplosion — [NOVO 2026-07-31, pedido do
        usuário]) + comprada por [NOVO 2026-08-13, pedido do usuário: "se a
        carteira da lista for comprada por alguma carteira da lista..."] —
        inverso de "Explode em" (mapear_carteiras_compradas,
        snapshot_builder.py) —, início de consolidação e accountCode. */
buildSecaoCadastroSlaCarteira(r){
  return `<div class="psec"><h4>Cadastro &amp; SLA</h4><table class="ptable">
    <tr><td>Instituição</td><td>${ControleCargas.esc(r.institution||'—')}</td></tr>
    <tr><td>Company</td><td>${ControleCargas.esc(r.company||'—')}</td></tr>
    <tr><td>Modelo de Carga</td><td>${ControleCargas.esc(r.loadModel||'—')}${r.isManualLoad?' (manual)':''}</td></tr>
    <tr><td>Periodicidade</td><td>${r.periodicity==='M'?'Mensal':'Diário'}</td></tr>
    <tr><td>Defasagem / SLA</td><td>${r.periodicity==='M' ? 'fechamento do mês + 15du (10 recebimento + 5 upload)' : ('D-'+(r.lagBizDays||0))}</td></tr>
    <tr><td>Deve Publicar</td><td>${r.mustPublish?'Sim':'Não'}</td></tr>
    <tr><td>Repetição Diária</td><td>${r.dailyRepetition?'Sim':'Não'}</td></tr>
    <tr><td>Exceção</td><td>${ControleCargas.esc(r.exception||'—')}</td></tr>
    <tr><td>Explosão</td><td>${ControleCargas.esc(r.explosion||'—')}</td></tr>
    <tr><td>Explode em</td><td>${(r.explodedAssets||[]).length ? r.explodedAssets.map(ControleCargas.esc).join(', ') : '—'}</td></tr>
    <tr><td>Comprada por</td><td${r.aguardandoExplosao?' style="color:var(--overlay-comprada);font-weight:700"':''}>${(r.compradaPorNomes||[]).length ? r.compradaPorNomes.map(ControleCargas.esc).join(', ') : '—'}</td></tr>
    <tr><td>Início consolidação</td><td>${ControleCargas.esc(r.startDateConsolidation||'—')}</td></tr>
    <tr><td>accountCode</td><td>${ControleCargas.esc(r.accountCode||'—')}</td></tr>
  </table></div>`;
},

/* Contexto: monta a seção 5 (issues abertas na janela) do painel de
   carteira — description INTEGRAL (embutida pelo build_snapshot.py só para
   carteiras com pendência, ver PLANNING §Painéis de Detalhe "Regra de
   dados"). Chamada por buildWalletPanel(). Retorna string HTML.

   Pseudocódigo:
     1. Sem issues -> nota vazia.
     2. Com issues, tabela ordenada da mais recente pra mais antiga, com
        cor por severidade. */
buildSecaoIssuesCarteira(r){
  const issuesDetail = r.issuesDetail || [];
  let html = `<div class="psec"><h4>Issues abertas na janela (${issuesDetail.length})</h4>`;
  if(!issuesDetail.length){
    html += `<p class="empty-note">Nenhuma issue pendente na janela.</p>`;
  } else {
    html += `<table class="ptable"><tr><th>Data</th><th>Tipo</th><th>Descrição</th><th>Origem</th></tr>`;
    issuesDetail.slice().sort((a,b)=> (b.date||'').localeCompare(a.date||'')).forEach(is=>{
      const sevColor = is.severity==='red' ? 'var(--state-r1-fg)' : (is.severity==='yellow' ? 'var(--tier-att-fg)' : 'var(--ink-muted)');
      html += `<tr><td>${ControleCargas.esc(is.date)}</td><td style="color:${sevColor};font-weight:700">${ControleCargas.esc(is.type)}</td><td>${ControleCargas.esc(is.description||'—')}</td><td>${ControleCargas.esc(is.inputType||'—')}${is.createdAt?(' · '+ControleCargas.esc(is.createdAt)+' BRT'):''}</td></tr>`;
    });
    html += `</table>`;
  }
  html += `</div>`;
  return html;
},

/* Contexto: monta a seção 6 (divergência Rent Contrib × NAV, valores
   brutos) do painel de carteira. Chamada por buildWalletPanel(). Retorna
   string HTML.

   Pseudocódigo:
     1. Filtra os dias da janela com divergência registrada no tooltip.
     2. Sem dias -> nota vazia. Com dias, tabela com os valores brutos do
        navPackage + nota sobre o método de auditoria por contribuição
        (não implementado neste protótipo). */
buildSecaoDivergenciaCarteira(cmap, window_){
  const divDays = window_.map(d=> ({d, tt:(cmap[d]||{}).tt||{}})).filter(x=> x.tt.div);
  let html = `<div class="psec"><h4>Divergência Rent Contrib × NAV</h4>`;
  if(!divDays.length){
    html += `<p class="empty-note">Nenhuma divergência (&gt;2bp/0,02% e impacto ≥ R$800) na janela.</p>`;
  } else {
    html += `<table class="ptable"><tr><th>Data</th><th>Rent Contrib</th><th>Rent NAV</th><th>Δ (bp)</th><th>NAV / NAV p/ cota</th><th>Entradas/Saídas</th></tr>`;
    divDays.forEach(({d,tt})=>{
      const dv = tt.div;
      html += `<tr><td>${d}</td><td>${(dv.rc*100).toFixed(4)}%</td><td>${(dv.rn*100).toFixed(4)}%</td>
        <td style="font-weight:700;color:var(--overlay-div)">${dv.bp.toFixed(1)}</td>
        <td>${ControleCargas.fmtNum(dv.nav)} / ${ControleCargas.fmtNum(dv.navPerShare)}</td>
        <td>${ControleCargas.fmtNum(dv.inAndOutFlows)}</td></tr>`;
    });
    html += `</table><p class="psub">Valores brutos do navPackage do dia. "Auditar por contribuição" (recomputar de processedPosition.securities[].dailyContribution) é um método de auditoria on-demand — não implementado neste protótipo estático (ver PLANNING §Painéis de Detalhe, item 6).</p>`;
  }
  html += `</div>`;
  return html;
},

/* Contexto: monta a seção 7 (sequência cronológica, gate D-1) do painel de
   carteira. Chamada por buildWalletPanel(). Retorna string HTML.

   Pseudocódigo:
     1. Filtra os dias da janela com o flag de sequência quebrada no
        tooltip.
     2. Sem dias -> nota vazia. Com dias, lista cada buraco de sequência. */
buildSecaoSequenciaCarteira(cmap, window_){
  const seqDays = window_.filter(d=> cmap[d] && cmap[d].tt && cmap[d].tt.seq);
  let html = `<div class="psec"><h4>Sequência cronológica (gate D-1)</h4>`;
  if(!seqDays.length){
    html += `<p class="empty-note">Nenhum buraco de sequência na janela.</p>`;
  } else {
    html += '<ul style="margin:0;padding-left:18px;font-size:12.5px;">';
    seqDays.forEach(d=> html += `<li>processada em <b>${d}</b> sem processada no dia útil anterior — contribuições/rentabilidade suspeitas</li>`);
    html += '</ul>';
  }
  html += `</div>`;
  return html;
},

/* Contexto: monta a seção 8 (agrupamentos da carteira) do painel de
   carteira, com drill-through pro painel de cada agrupamento. Chamada por
   buildWalletPanel(). Retorna string HTML.

   Pseudocódigo:
     1. Resolve os agrupamentos da carteira (findGroupingsForWallet).
     2. Sem agrupamentos -> nota vazia. Com agrupamentos, 1 linha clicável
        por agrupamento (cor/sigla do dia focado + GroupingID visível +
        flag de divergência) [2026-07-24, pedido do usuário: "ao clicar na
        carteira, deve se mostrar os agrupamentos que ela participa, com
        GroupingID e Nome do Agrupamento"]. */
buildSecaoGroupingsCarteira(r, focusDate){
  const groupings = ControleCargas.findGroupingsForWallet(r);
  let html = `<div class="psec"><h4>Agrupamentos da carteira (${groupings.length})</h4>`;
  if(!groupings.length){
    html += `<p class="empty-note">Nenhum agrupamento indexado cadastrado (coluna "Agrupamentos Indexados" vazia/"Não").</p>`;
  } else {
    groupings.forEach(g=>{
      const gentry = ControleCargas.cellByDate(g)[focusDate];
      const gst = gentry ? ControleCargas.STATES[gentry.s] : null;
      const divFlag = gentry && gentry.ov && (gentry.ov.includes('div')||gentry.ov.includes('div_strong'));
      html += `<div class="offender" data-drill-grouping="${g.groupingId}">
        <div class="cell ${gst?gst.cls:'s-g2'}" style="min-width:34px;height:22px;font-size:10px;">${gst?gst.letter:'—'}</div>
        <div class="oname drillthrough">${ControleCargas.esc(g.name)}${ControleCargas.acoesIdentificadorHtml(g.name)} <code style="font-size:10px;color:var(--ink-faint);user-select:all;">${ControleCargas.esc(g.groupingId)}</code>${ControleCargas.acoesIdentificadorHtml(g.groupingId)}</div>
        <div class="ometa">${divFlag?'Δ divergente':''}</div>
      </div>`;
    });
  }
  html += `</div>`;
  return html;
},

/* Contexto:
   Monta e abre o painel de drill-down completo de 1 carteira (9 seções
   fixas, PLANNING §Painéis de Detalhe). Chamada ao clicar numa célula ou no
   nome da linha (aba Carteiras), ou por drill-through a partir do painel de
   Agrupamento. Orquestradora fina — cada seção é montada por uma
   buildSecaoXyz(...) própria (ver acima). Não retorna nada (abre o modal já
   wireado).

   Pseudocódigo:
     1. Resolve a linha da carteira e a célula do dia focado (default: data
        de referência do grid).
     2. Concatena, em ordem fixa, as 8 seções de conteúdo (cabeçalho, janela,
        situação do dia, cadastro & SLA, issues, divergência, sequência,
        agrupamentos) + a seção de comentários (commentsSectionHtml).
     3. Abre o modal com o HTML montado e liga as interações do painel. */
buildWalletPanel(walletId, focusDate){
  const r = ControleCargas.SNAPSHOT.wallets.find(w=>w.walletId===walletId);
  if(!r) return;
  const window_ = ControleCargas.SNAPSHOT.meta.window;
  focusDate = focusDate || ControleCargas.SNAPSHOT.meta.referenceDate;
  const cmap = ControleCargas.cellByDate(r);
  const entry = cmap[focusDate];

  let html = ControleCargas.buildSecaoCabecalhoCarteira(r, focusDate);
  html += ControleCargas.buildSecaoJanelaCarteira(r, window_, focusDate);
  html += ControleCargas.buildSecaoSituacaoDiaCarteira(entry, focusDate);
  html += ControleCargas.buildSecaoCadastroSlaCarteira(r);
  html += ControleCargas.buildSecaoIssuesCarteira(r);
  html += ControleCargas.buildSecaoDivergenciaCarteira(cmap, window_);
  html += ControleCargas.buildSecaoSequenciaCarteira(cmap, window_);
  html += ControleCargas.buildSecaoGroupingsCarteira(r, focusDate);
  html += ControleCargas.commentsSectionHtml('wallet', r.walletId, focusDate);

  ControleCargas.openModal(html);
  ControleCargas.wirePanelInteractions('wallet', r.walletId, focusDate);
},

// ═══ Painel de Detalhe — AGRUPAMENTO (6 seções, PLANNING §Painéis de Detalhe) ═══
// Destaque do usuário: "Carteiras ofensoras" é a PRIMEIRA seção de conteúdo,
// antes de qualquer outra informação.
// [refatoração 2026-07-20] buildGroupingPanel() virou uma orquestradora
// fina; as seções 1/2/3/4/5 ganharam sua própria função buildSecaoXyz(...)
// (a 6ª já era a função reaproveitada commentsSectionHtml). LÓGICA/HTML
// idênticos, só a organização mudou (CLAUDE.md §3).

/* Contexto: monta a seção 1 (cabeçalho + chips) do painel de agrupamento —
   nome, groupingId, dia focado, company/instituição/nº de membros ativos,
   chip de status e de prioridade. Chamada por buildGroupingPanel(). Retorna
   string HTML.

   Pseudocódigo:
     1. Monta o <h3> + subtítulo (groupingId + dia focado).
     2. Monta a fileira de chips (company, instituição, nº de membros
        ativos, status, prioridade). */
buildSecaoCabecalhoGrouping(g, focusDate){
  // sem ℹ️ nos dois (nome e groupingId): já estamos dentro do painel deste
  // mesmo alvo — só o 📋 faz sentido aqui (identificadores.js) [2026-07-30].
  let html = `<h3>${ControleCargas.esc(g.name)}${ControleCargas.acoesIdentificadorHtml(g.name)}</h3><div class="modal-sub">Agrupamento · groupingId <code style="user-select:all">${ControleCargas.esc(g.groupingId)}</code>${ControleCargas.acoesIdentificadorHtml(g.groupingId)} · ${ControleCargas.weekdayAbbrev(focusDate)} ${focusDate}</div>`;
  html += `<div class="chiprow">
    <span class="pchip">${ControleCargas.esc(g.company)}</span>
    <span class="pchip">${ControleCargas.esc(g.institution||'—')}</span>
    <span class="pchip">${g.nMembers} membro${g.nMembers===1?'':'s'} ativo${g.nMembers===1?'':'s'}</span>
    ${ControleCargas.statusChipHtml(ControleCargas.mockkeyReferencia(g))}
    ${ControleCargas.priorityChipHtml(g, ControleCargas.SNAPSHOT.meta.window.length)}
  </div>`;
  // Responsável/Comentário sobre atuação (anotacoes.js) — pedido do usuário
  // 2026-07-30: o clique na célula (que abre este painel) também precisa
  // mostrar o comentário, não só o hover (tooltip, escondido pelo modal).
  html += ControleCargas.resumoAtuacaoHtml('grouping', g.groupingId);
  return html;
},

/* Contexto: monta a seção 2 (carteiras não processadas — SEMPRE a 1ª seção
   de conteúdo, destaque pedido pelo usuário) do painel de agrupamento.
   [RENOMEADA 2026-07-24, pedido do usuário: "carteiras ofensoras" (nome
   ligado ao tier aposentado) virou "carteiras não processadas", mesmo termo
   usado no hover da célula.] Chamada por buildGroupingPanel(), já com a
   lista de não processadas calculada. Retorna string HTML.

   Pseudocódigo:
     1. Lista as carteiras não processadas (offenderListHtml).
     2. Se há membros brutos fora do Template (nUntrackedRaw > 0), anexa a
        nota explicando que eles não são monitorados. */
buildSecaoOfensorasGrouping(offenders, nUntracked){
  let html = `<div class="psec"><h4>Carteiras não processadas (${offenders.length})</h4>`;
  html += ControleCargas.offenderListHtml(offenders);
  // nUntrackedRaw (do snapshot) = membros que nem estão no Template (registry);
  // diferente de "tracked" (Template + ativo na janela) — PLANNING: "membro
  // fora do cadastro não bloqueia o estágio do agrupamento, mas o tooltip acusa".
  if(nUntracked>0) html += `<p class="psub">+${nUntracked} membro${nUntracked===1?'':'s'} fora do Template — não monitorado${nUntracked===1?'':'s'}.</p>`;
  html += `</div>`;
  return html;
},

/* Contexto: monta a seção 3 (mini-matriz dos membros: roll-up do
   agrupamento no topo + 1 mini-timeline por membro, ofensores primeiro) do
   painel de agrupamento. Chamada por buildGroupingPanel(). Retorna string
   HTML.

   Pseudocódigo:
     1. Mini-timeline do roll-up do agrupamento.
     2. Para cada membro (ofensores primeiro, depois saudáveis), o nome +
        sua própria mini-timeline. */
buildSecaoMiniMatrizGrouping(g, window_, focusDate, offenders, healthyMembers){
  let html = `<div class="psec"><h4>Mini-matriz dos membros</h4>`;
  html += `<div style="font-size:11px;color:var(--ink-muted);margin:2px 0 2px;font-weight:600;">Roll-up do agrupamento</div>`;
  html += ControleCargas.miniTimelineHtml(g, window_, focusDate);
  offenders.concat(healthyMembers).forEach(w=>{
    // nomes aqui NÃO são clicáveis pra abrir o painel da carteira (só a
    // mini-timeline é) — ℹ️ é a única forma de chegar no painel dela a
    // partir desta lista, então entra aqui (identificadores.js) [2026-07-30].
    html += `<div style="font-size:11px;color:var(--ink-muted);margin:8px 0 2px;">${ControleCargas.esc(w.name)}${ControleCargas.acoesIdentificadorHtml(w.name, 'wallet', w.walletId)}</div>`;
    html += ControleCargas.miniTimelineHtml(w, window_, focusDate);
  });
  html += `</div>`;
  return html;
},

/* Contexto: monta a seção 4 (metadados do agrupamento + tabela completa de
   membros, incl. encerrados) do painel de agrupamento. Chamada por
   buildGroupingPanel(). Retorna string HTML.

   Pseudocódigo:
     1. Tabela com groupingId, company, composição por instituição e
        benchmarks. [REMOVIDO 2026-08-05, pedido do usuário — migração API
        Beehus] A linha de últimas datas Unp/Pro/Pub consolidadas saiu —
        sem endpoint equivalente na API (ver db.py).
     2. <details> colapsável com a tabela completa de TODOS os membros
        (inclusive os não rastreados/encerrados), com o flag "Rastreado". */
buildSecaoMetadadosGrouping(g){
  const compositionStr = Object.entries(g.institutionDetail||{}).map(([k,v])=>`${k} ${v}`).join(' · ') || '—';
  let html = `<div class="psec"><h4>Metadados do agrupamento</h4><table class="ptable">
    <tr><td>groupingId</td><td style="user-select:all">${ControleCargas.esc(g.groupingId)}${ControleCargas.acoesIdentificadorHtml(g.groupingId)}</td></tr>
    <tr><td>Company</td><td>${ControleCargas.esc(g.company)}</td></tr>
    <tr><td>Composição por instituição</td><td>${ControleCargas.esc(compositionStr)}</td></tr>
    <tr><td>Benchmarks</td><td>${g.benchmarks ? ControleCargas.esc(JSON.stringify(g.benchmarks)) : '—'}</td></tr>
  </table>
  <details style="margin-top:8px;"><summary style="cursor:pointer;font-size:12px;color:var(--ink-muted);">Membros (${(g.members||[]).length}, incl. encerrados)</summary>
  <table class="ptable"><tr><th>Carteira</th><th>Início</th><th>Fim</th><th>Rastreado</th></tr>`;
  (g.members||[]).forEach(m=>{
    const w = ControleCargas.SNAPSHOT.wallets.find(x=>x.walletId===m.walletId);
    // ℹ️ só quando a carteira existe no Template (senão não há painel pra
    // abrir) — 📋 sempre, mesmo pra quem não está no Template (só o id
    // bruto) (identificadores.js) [2026-07-30].
    const nomeComAcoes = w
      ? `${ControleCargas.esc(w.name)}${ControleCargas.acoesIdentificadorHtml(w.name, 'wallet', w.walletId)}`
      : `${ControleCargas.esc(m.walletId)}${ControleCargas.acoesIdentificadorHtml(m.walletId)}`;
    html += `<tr><td>${nomeComAcoes}</td><td>${ControleCargas.esc(m.initialDateOnGrouping||'—')}</td><td>${ControleCargas.esc(m.finalDateOnGrouping||'em aberto')}</td><td>${m.tracked?'Sim':'Não'}</td></tr>`;
  });
  html += `</table></details></div>`;
  return html;
},

/* Contexto: monta a seção 5 (divergência do agrupamento — navPackage nível
   grouping + individuais dos membros) do painel de agrupamento. Chamada por
   buildGroupingPanel(). Retorna string HTML.

   Pseudocódigo:
     1. Dias com divergência no navPackage do PRÓPRIO grouping.
     2. Para cada membro (ofensores + saudáveis), suas divergências
        individuais — aponta quem contamina o consolidado. */
buildSecaoDivergenciaGrouping(gcmap, window_, offenders, healthyMembers){
  let html = `<div class="psec"><h4>Divergência do agrupamento</h4>`;
  const gDivDays = window_.filter(d=> gcmap[d] && gcmap[d].ov && (gcmap[d].ov.includes('div')||gcmap[d].ov.includes('div_strong')));
  if(!gDivDays.length){
    html += `<p class="empty-note">Nenhuma divergência do navPackage do agrupamento na janela.</p>`;
  } else {
    html += `<p class="psub">Dias com divergência no navPackage do agrupamento: ${gDivDays.join(', ')}.</p>`;
  }
  const memberDivLines = offenders.concat(healthyMembers).map(w=>{
    const wcmap = ControleCargas.cellByDate(w);
    const wdiv = window_.map(d=>({d,tt:(wcmap[d]||{}).tt||{}})).filter(x=>x.tt.div);
    return wdiv.length ? `<p class="psub"><b>${ControleCargas.esc(w.name)}</b>: ${wdiv.map(x=>`${x.d} → ${x.tt.div.bp.toFixed(1)}bp`).join(', ')}</p>` : '';
  }).join('');
  if(memberDivLines) html += `<div style="margin-top:6px;"><div style="font-size:11px;color:var(--ink-muted);font-weight:600;">Divergências individuais dos membros (aponta quem contamina o consolidado):</div>${memberDivLines}</div>`;
  html += `</div>`;
  return html;
},

/* Contexto:
   Monta e abre o painel de drill-down completo de 1 agrupamento (6 seções
   fixas, PLANNING §Painéis de Detalhe). Chamada ao clicar numa célula ou no
   nome da linha (aba Agrupamentos), ou por drill-through a partir do painel
   de Carteira. Orquestradora fina — cada seção é montada por uma
   buildSecaoXyz(...) própria (ver acima). Não retorna nada (abre o modal já
   wireado).

   Pseudocódigo:
     1. Resolve o agrupamento, a janela e os membros rastreados (registry ∩
        janela); separa ofensores (mockkey na data de referência ∉ {p, cD} —
        tier foi aposentado, 2026-07-24) dos saudáveis.
     2. Concatena, em ordem fixa (destaque do usuário: ofensoras é SEMPRE a
        1ª seção de conteúdo): cabeçalho, ofensoras, mini-matriz, metadados,
        divergência + a seção de comentários (commentsSectionHtml).
     3. Abre o modal com o HTML montado e liga as interações do painel. */
buildGroupingPanel(groupingId, focusDate){
  const g = ControleCargas.SNAPSHOT.groupings.find(x=>x.groupingId===groupingId);
  if(!g) return;
  const window_ = ControleCargas.SNAPSHOT.meta.window;
  focusDate = focusDate || ControleCargas.SNAPSHOT.meta.referenceDate;
  const gcmap = ControleCargas.cellByDate(g);

  // membros rastreados (registry ∩ janela) — base para ofensoras/mini-matriz
  const trackedIds = (g.members||[]).filter(m=>m.tracked).map(m=>m.walletId);
  const memberRows = trackedIds.map(wid=> ControleCargas.SNAPSHOT.wallets.find(w=>w.walletId===wid)).filter(Boolean);
  const semPendencia = w=> ['p','cD'].includes(ControleCargas.mockkeyReferencia(w));
  const offenders = memberRows.filter(w=> !semPendencia(w))
    .sort((a,b)=>{ const ka=a.sortKey, kb=b.sortKey; for(let i=0;i<ka.length;i++){ if(ka[i]<kb[i]) return -1; if(ka[i]>kb[i]) return 1; } return 0; });
  const healthyMembers = memberRows.filter(semPendencia);

  let html = ControleCargas.buildSecaoCabecalhoGrouping(g, focusDate);
  html += ControleCargas.buildSecaoOfensorasGrouping(offenders, g.nUntrackedRaw || 0);
  html += ControleCargas.buildSecaoMiniMatrizGrouping(g, window_, focusDate, offenders, healthyMembers);
  html += ControleCargas.buildSecaoMetadadosGrouping(g);
  html += ControleCargas.buildSecaoDivergenciaGrouping(gcmap, window_, offenders, healthyMembers);
  html += ControleCargas.commentsSectionHtml('grouping', g.groupingId, focusDate);

  ControleCargas.openModal(html);
  ControleCargas.wirePanelInteractions('grouping', g.groupingId, focusDate);
},

/* Contexto:
   Liga o clique de abrir o painel de detalhe nas células da matriz e nos
   nomes das linhas. Chamada no fim de buildMatrix() (precisa religar a
   cada redesenho do DOM). Não retorna nada.

   Pseudocódigo:
     1. Para cada célula, liga clique que abre o painel de carteira ou de
        agrupamento (conforme data-view) focado no dia clicado.
     2. Para cada nome de linha (.wname), liga clique que abre o painel
        correspondente focado na data de referência do grid. */
wireRowClicks(){
  document.querySelectorAll('.cell').forEach(cell=>{
    cell.addEventListener('click', ()=>{
      const rid = cell.dataset.rid, date = cell.dataset.date;
      if(cell.dataset.view==='wallets') ControleCargas.buildWalletPanel(rid, date); else ControleCargas.buildGroupingPanel(rid, date);
    });
  });
  document.querySelectorAll('.wname').forEach(el=>{
    el.addEventListener('click', ()=>{
      const rid = el.dataset.id, kind = el.dataset.kind;
      if(kind==='wallet') ControleCargas.buildWalletPanel(rid, ControleCargas.SNAPSHOT.meta.referenceDate);
      else ControleCargas.buildGroupingPanel(rid, ControleCargas.SNAPSHOT.meta.referenceDate);
    });
  });
},

/* Contexto:
   Liga o fechamento do modal clicando fora dele (no backdrop) ou apertando
   Esc — wiring global, feito 1x no bootstrap (não depende do snapshot já
   ter carregado). Não retorna nada.

   Pseudocódigo:
     1. Liga clique no backdrop: fecha só se o clique foi no backdrop em si
        (não em conteúdo do modal por cima dele).
     2. Liga keydown no document: fecha ao apertar Esc. */
wireModalGlobalHandlers(){
  // fecha o modal clicando fora (no backdrop) ou apertando Esc — wiring
  // global, feito 1x (não depende do snapshot já ter carregado).
  document.getElementById('modal-backdrop').addEventListener('click', (e)=>{ if(e.target.id==='modal-backdrop') ControleCargas.closeModal(); });
  document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') ControleCargas.closeModal(); });
},
});
