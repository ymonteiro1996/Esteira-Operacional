/* ControleCargas.index — bootstrap: carrega snapshot.json + comentários, liga a tela e dispara o 1º render.
   Parte do objeto único ControleCargas (ver state.js). Gerado a partir da
   refatoração de index_template.html (CLAUDE.md §4, "Divisão clara das
   páginas" — pasta static/js/controle_cargas/, 1 arquivo por funcionalidade).
*/
Object.assign(ControleCargas, {
/* Contexto:
   Ponto de entrada chamado assim que snapshot.json termina de carregar
   (ver o fetch no fim deste arquivo). Guarda o snapshot no estado global e
   dispara o carregamento dos comentários E anotações antes do 1º render
   [2026-07-24, pedido do usuário: colunas Responsável/Comentário sobre
   atuação]. Não retorna nada.

   Pseudocódigo:
     1. Grava `data` em ControleCargas.SNAPSHOT.
     2. Carrega comentários e anotações em paralelo (best-effort — ver
        loadComments()/loadAnnotations()) e só então chama init() — pra a
        matriz já nascer com os balões/valores corretos. */
startWithSnapshot(data){
  ControleCargas.SNAPSHOT = data;
  Promise.all([ControleCargas.loadComments(), ControleCargas.loadAnnotations()]).then(ControleCargas.init);
},

// ─────────────────────────────────────────────────────────────────────────
// Ordenação / abas / busca
// ─────────────────────────────────────────────────────────────────────────
/* Contexto:
   Troca de aba (Carteiras / Agrupamentos / Company / Controle de Cargas) —
   mesmo padrão de sempre (classe .active no botão). As abas "Company" e
   "Controle de Cargas" têm painel PRÓPRIO (#panel-company/#panel-custodian):
   fonte/formato de dado diferentes da grade principal, então o painel
   principal + a legenda das outras abas somem e o painel da aba assume — e
   vice-versa ao voltar. Chamada pelos handlers de clique nas abas (wire())
   e pelo bootstrap. Não retorna nada.

   Pseudocódigo:
     1. Grava a view corrente no estado e resolve se é aba de painel próprio
        (Company / Controle de Cargas).
     2. Liga/desliga a classe "active" das 4 abas e alterna a visibilidade
        dos painéis (principal+legenda vs. Company vs. custodiante).
     3. Alterna a visibilidade do #toolbar3 (campos De/Até + Atualizar) —
        pedido do usuário 2026-07-23: Carteiras/Agrupamentos/Company
        compartilham o MESMO SNAPSHOT.meta.window, então compartilham os
        mesmos campos; só Controle de Cargas (fonte de dado à parte, com
        navegação própria) esconde.
     4. Recalcula a visibilidade dos painéis "Carteiras Publicadas" (só
        aparece na aba Carteiras) e "Agrupamentos Publicados" (só aparece na
        aba Agrupamentos) — feito aqui, incondicional, pra cobrir também as
        abas de painel próprio (Company/Controle de Cargas), que retornam
        cedo e nunca chegam ao buildMatrix() que normalmente recalcula os
        dois.
     5. Aba Company: só (re)desenha essa matriz e sai (ela já recalcula os
        dois painéis de novo sozinha, mas não custa nada). Aba Controle de
        Cargas: idem, sem recálculo extra (nenhum dos dois aparece lá).
        Nenhuma das duas usa ordenação/congelamento da grade principal.
     6. Carteiras/Agrupamentos: descongela a ordem, ajusta a visibilidade do
        botão de ordenar-por-instituição (só faz sentido em Carteiras) e
        reconstrói a matriz principal (que já recalcula os painéis de
        publicação). */
switchTab(view){
  ControleCargas.state.view = view;
  const isCust = view==='custodian';
  const isCompany = view==='company';
  document.getElementById('tab-wallets').classList.toggle('active', view==='wallets');
  document.getElementById('tab-groupings').classList.toggle('active', view==='groupings');
  document.getElementById('tab-company').classList.toggle('active', isCompany);
  document.getElementById('tab-custodian').classList.toggle('active', isCust);
  document.getElementById('panel-main').style.display = (isCust || isCompany) ? 'none' : '';
  document.getElementById('panel-legend').style.display = (isCust || isCompany) ? 'none' : '';
  document.getElementById('panel-company').style.display = isCompany ? '' : 'none';
  document.getElementById('panel-custodian').style.display = isCust ? '' : 'none';
  document.getElementById('toolbar3').style.display = isCust ? 'none' : '';
  ControleCargas.buildPublishStat();
  ControleCargas.buildGroupingPublishStat();
  if(isCompany){ ControleCargas.buildCompanyMatrix(); return; }
  if(isCust){ ControleCargas.buildCustodianMatrix(); return; }
  ControleCargas.state.frozen = null;
  if(view==='wallets'){
    ControleCargas.state.filtroValoresColuna.institution = null;
    document.getElementById('sort-inst-btn').style.display='';
  } else {
    document.getElementById('sort-inst-btn').style.display='none';
  }
  ControleCargas.buildMatrix();
},

// [refatoração 2026-07-20] wire() virou uma orquestradora fina; cada grupo
// de handlers (abas, navegação de custodiantes, ordenação, busca, ajuda+
// exportar) ganhou sua própria função wireXyz() abaixo. LÓGICA idêntica, só
// a organização mudou (CLAUDE.md §3).

/* Contexto: liga o clique das 4 abas (Carteiras/Agrupamentos/Company/
   Controle de Cargas) — cada uma dispara switchTab(). Chamada por wire().
   Não retorna nada.

   Pseudocódigo:
     1. tab-wallets -> switchTab('wallets').
     2. tab-groupings -> switchTab('groupings').
     3. tab-company -> switchTab('company').
     4. tab-custodian -> switchTab('custodian'). */
wireAbas(){
  document.getElementById('tab-wallets').addEventListener('click', ()=> ControleCargas.switchTab('wallets'));
  document.getElementById('tab-groupings').addEventListener('click', ()=> ControleCargas.switchTab('groupings'));
  document.getElementById('tab-company').addEventListener('click', ()=> ControleCargas.switchTab('company'));
  document.getElementById('tab-custodian').addEventListener('click', ()=> ControleCargas.switchTab('custodian'));
},

/* Contexto: liga a navegação da janela deslizante da aba Controle de Cargas
   (25 colunas) — ◀/▶ pulam uma janela inteira; "mais recente" volta à âncora
   default (última data com dado). Chamada por wire(). Não retorna nada.

   Pseudocódigo:
     1. ◀ (cu-prev): recua 1 janela inteira, sem passar do início.
     2. ▶ (cu-next): avança 1 janela inteira, sem passar do fim.
     3. "mais recente" (cu-latest): limpa a âncora (null = recalcular
        default no próximo build). Índices sempre re-clampados em
        buildCustodianMatrix(). */
wireNavegacaoCustodiante(){
  document.getElementById('cu-prev').addEventListener('click', ()=>{
    if(ControleCargas.cuState.end===null) return;
    ControleCargas.cuState.end = Math.max(0, ControleCargas.cuState.end - ControleCargas.CU_WINDOW);
    ControleCargas.buildCustodianMatrix();
  });
  document.getElementById('cu-next').addEventListener('click', ()=>{
    const cu = ControleCargas.SNAPSHOT.custodianUpload;
    if(ControleCargas.cuState.end===null || !cu) return;
    ControleCargas.cuState.end = Math.min(cu.dates.length - 1, ControleCargas.cuState.end + ControleCargas.CU_WINDOW);
    ControleCargas.buildCustodianMatrix();
  });
  document.getElementById('cu-latest').addEventListener('click', ()=>{
    ControleCargas.cuState.end = null;   // null = recalcular âncora default no próximo build
    ControleCargas.buildCustodianMatrix();
  });
},

/* Contexto:
   Aplica um critério de ordenação clicado (sortbtn OU <th data-sort> — MESMO
   efeito nos dois, PLANNING/plano 2026-07-24): clicar de novo no critério JÁ
   ativo inverte a direção (state.sortDir), clicar num critério diferente
   troca de critério e volta pra direção padrão. Chamada por wireOrdenacao().
   Não retorna nada.

   Pseudocódigo:
     1. Já era esse o critério ativo -> inverte sortDir; senão troca de
        critério e reseta sortDir pra 1 (padrão).
     2. Limpa o congelamento (mudou o critério/direção, não faz sentido
        manter a ordem congelada antiga).
     3. Sincroniza a classe "on" dos sortbtn's e reconstrói a matriz (que
        redesenha o cabeçalho com a seta ↑/↓ no critério ativo). */
aplicarCriterioOrdenacao(criterio){
  if(ControleCargas.state.sort===criterio) ControleCargas.state.sortDir = -(ControleCargas.state.sortDir||1);
  else { ControleCargas.state.sort = criterio; ControleCargas.state.sortDir = 1; }
  ControleCargas.state.frozen = null;
  document.querySelectorAll('.sortbtn[data-sort]').forEach(b=>b.classList.toggle('on', b.dataset.sort===criterio));
  ControleCargas.atualizarSetasSortbar();
  document.getElementById('freeze-badge').style.display='none';
  ControleCargas.buildMatrix();
},

/* Contexto:
   Sincroniza a seta ▲/▼ de direção nos botões da sortbar (a mesma seta que
   buildCabecalhoMatriz desenha nos <th data-sort>, mas os sortbtn's são
   estáticos — não são recriados a cada buildMatrix(), então a seta precisa
   ser religada aqui em vez de embutida no HTML). Chamada por
   aplicarCriterioOrdenacao() e 1x por wireOrdenacao() (estado inicial). Não
   retorna nada.

   Pseudocódigo:
     1. Para o sortbtn do critério ATIVO, garante 1 <span class="sortarrow">
        com a seta certa (▲ padrão, ▼ invertido).
     2. Para os demais, remove a seta se houver. */
atualizarSetasSortbar(){
  document.querySelectorAll('.sortbtn[data-sort]').forEach(b=>{
    let arrow = b.querySelector('.sortarrow');
    if(b.dataset.sort===ControleCargas.state.sort){
      if(!arrow){ arrow = document.createElement('span'); arrow.className = 'sortarrow'; b.appendChild(arrow); }
      arrow.textContent = ControleCargas.state.sortDir===-1 ? ' ▼' : ' ▲';
    } else if(arrow){
      arrow.remove();
    }
  });
},

/* Contexto: liga toda a ordenação da matriz principal — botões de
   ordenação (sortbtn), congelar ordem, e clique no cabeçalho da coluna
   (mesmo efeito de ordenação, com seta ▲/▼ de direção — 2026-07-24, pedido
   do usuário). Chamada por wire(). Não retorna nada.

   Pseudocódigo:
     1. Cada sortbtn aplica seu critério (aplicarCriterioOrdenacao).
     2. "Congelar" tira um snapshot da ordem corrente (sortedRows) e mostra
        o badge com o horário.
     3. Clique no <th data-sort> do cabeçalho da matriz tem o mesmo efeito
        de clicar no sortbtn correspondente — exceto quando o clique é no
        botão "▾" de filtro estilo Excel (Instituição também tem os dois no
        mesmo <th> desde 2026-07-29; quem trata esse clique é
        wireFiltrosCabecalho(), não a ordenação).
     4. Sincroniza a seta da sortbar com o estado inicial. */
wireOrdenacao(){
  document.querySelectorAll('.sortbtn[data-sort]').forEach(btn=>{
    btn.addEventListener('click', ()=> ControleCargas.aplicarCriterioOrdenacao(btn.dataset.sort));
  });
  document.getElementById('sort-freeze').addEventListener('click', ()=>{
    const data = ControleCargas.state.view==='wallets' ? ControleCargas.SNAPSHOT.wallets : ControleCargas.SNAPSHOT.groupings;
    ControleCargas.state.frozen = ControleCargas.sortedRows(data, ControleCargas.state.view==='wallets').slice();
    const badge = document.getElementById('freeze-badge');
    const now = new Date();
    badge.textContent = '🔒 ordem congelada às ' + now.toTimeString().slice(0,5);
    badge.style.display = 'inline';
  });
  // clique no header da coluna também ordena (Nome/Company/Instituição/Prioridade/Última Publicada)
  document.getElementById('matrix').addEventListener('click', (e)=>{
    if(e.target.closest('.th-filter-btn')) return;
    const th = e.target.closest('th[data-sort]');
    if(!th) return;
    ControleCargas.aplicarCriterioOrdenacao(th.dataset.sort);
  });
  ControleCargas.atualizarSetasSortbar();
},

/* Contexto: liga o campo de busca da toolbar — cada tecla filtra a matriz
   pelo texto digitado. Chamada por wire(). Não retorna nada.

   Pseudocódigo:
     1. No input do campo de busca, grava o texto (trim) no estado e
        reconstrói a matriz. */
wireBusca(){
  document.getElementById('search').addEventListener('input', (e)=>{
    ControleCargas.state.search = e.target.value.trim();
    ControleCargas.buildMatrix();
  });
},

/* Contexto: liga o toggle de ajuda estendida e o botão de exportar Excel —
   2 handlers sem relação entre si além de serem os últimos itens da
   toolbar. Chamada por wire(). Não retorna nada.

   Pseudocódigo:
     1. help-toggle alterna a visibilidade do texto de ajuda estendida.
     2. btn-export dispara exportExcel(). */
wireAjudaEExportar(){
  document.getElementById('help-toggle').addEventListener('click', ()=>{
    const ext = document.getElementById('help-ext');
    ext.style.display = ext.style.display==='none' ? 'inline' : 'none';
  });
  document.getElementById('btn-export').addEventListener('click', ControleCargas.exportExcel);
},

/* Contexto:
   Liga TODOS os handlers globais de interação da tela que não dependem de
   um render específico (abas, navegação da janela de custodiantes, botões
   de ordenação, busca, clique no cabeçalho da matriz, toggle de ajuda,
   botão de exportar, botão de salvar anotações). Chamada 1x no init().
   Orquestradora fina — cada grupo de handlers é ligado por uma wireXyz()
   própria (ver acima e anotacoes.js). Não retorna nada.

   Pseudocódigo:
     1. Liga as abas (wireAbas).
     2. Liga a navegação de custodiantes (wireNavegacaoCustodiante).
     3. Liga a ordenação (wireOrdenacao).
     4. Liga a busca (wireBusca).
     5. Liga ajuda + exportar (wireAjudaEExportar).
     6. Liga o botão "Salvar" das anotações (wireSalvarAnotacoes, anotacoes.js).
     7. Liga os botões "▾" de filtro de cabeçalho estilo Excel
        (wireFiltrosCabecalho, filtro_cabecalho.js) [2026-07-29].
     8. Liga os botões ℹ️/📋 de nome/walletId/groupingId, por delegação
        global — cobre matriz E modal, nunca precisa religar depois de um
        redesenho (wireAcoesIdentificador, identificadores.js) [2026-07-30]. */
wire(){
  ControleCargas.wireAbas();
  ControleCargas.wireNavegacaoCustodiante();
  ControleCargas.wireOrdenacao();
  ControleCargas.wireBusca();
  ControleCargas.wireAjudaEExportar();
  ControleCargas.wireSalvarAnotacoes();
  ControleCargas.wireFiltrosCabecalho();
  ControleCargas.wireAcoesIdentificador();
},

/* Contexto:
   Bootstrap da tela depois que snapshot + comentários já chegaram — 1º
   render completo. Chamada por startWithSnapshot(). Não retorna nada.

   [REVISADO 2026-07-27, pedido do usuário — "veja uma solução robusta e
   definitiva": uma carteira tinha Unprocessed novo no Mongo que não
   aparecia na tela] `snapshot.json` é um arquivo ESTÁTICO, escrito só no
   boot do servidor (atualizar_snapshot_no_boot(), app.py) — se o servidor
   fica de pé o dia todo, qualquer carga nova no Mongo depois do boot fica
   invisível até alguém clicar "Atualizar" manualmente ou reiniciar o
   servidor. Agora o próprio carregamento da página já dispara um
   "Atualizar" automático (mesma rota /api/atualizar, cache-aware — só
   consulta o Mongo pelas datas que ainda não viu nesta sessão do
   processo): o usuário vê a matriz renderizada com o snapshot estático
   imediatamente (sem tela em branco) e, assim que a janela padrão é
   resolvida, a tela se atualiza sozinha com o dado mais fresco possível.

   Pseudocódigo:
     1. Constrói cabeçalho, legenda e filtros com o snapshot estático (1º
        paint imediato, sem esperar rede).
     2. Liga todos os handlers de interação (wire()).
     3. Constrói a matriz principal com esse snapshot estático.
     4. Liga o drag-scroll horizontal em cada container de grid.
     5. Preenche os 2 campos do filtro de divergência Rent Contrib × Rent
        NAV com o que gerou o snapshot ESTÁTICO (preencherCamposLimiar
        Divergencia — [2026-07-31, pedido do usuário: "campos para mudar o
        valor"]; SNAPSHOT já está carregado neste ponto, não precisa de
        fetch à parte, ao contrário das datas no passo 6).
     6. Preenche os campos de data (janela padrão) e, assim que prontos,
        dispara executarAtualizacao() automaticamente — refresh silencioso
        com dado fresco, sem exigir clique do usuário (que também
        resincroniza os 2 campos do passo 5 com o snapshot fresco). */
init(){
  ControleCargas.buildHeader();
  ControleCargas.buildLegend();
  ControleCargas.buildFilters();
  ControleCargas.wire();
  ControleCargas.buildMatrix();
  document.querySelectorAll('.grid-scroll').forEach(ControleCargas.enableDragScroll);
  ControleCargas.preencherCamposLimiarDivergencia();
  ControleCargas.preencherCamposDataAtualizar().then(()=> ControleCargas.executarAtualizacao());
},
});

// ─────────────────────────────────────────────────────────────────────────
// Bootstrap: carrega snapshot.json (allowlist de estáticos do app.py) e, em
// paralelo, liga os handlers globais que não dependem do snapshot.
// ─────────────────────────────────────────────────────────────────────────
fetch('snapshot.json').then(r=>{ if(!r.ok) throw new Error('http '+r.status); return r.json(); })
  .then(ControleCargas.startWithSnapshot)
  .catch(err=>{
    document.getElementById('subhead-meta').innerHTML =
      '<b>Não foi possível carregar snapshot.json</b> ('+ControleCargas.esc(err.message)+'). ' +
      'Suba o servidor do protótipo — <code>python app.py</code> na pasta prototype — ' +
      'e abra <code>http://localhost:5050</code> (abrir o arquivo direto via file:// não é mais suportado).';
  });

ControleCargas.wireModalGlobalHandlers();
ControleCargas.wireFilterShortcuts();
ControleCargas.wireAtualizar();
