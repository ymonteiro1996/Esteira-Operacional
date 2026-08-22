/* ControleCargas.filtro_cabecalho — filtro "estilo Excel" (AutoFilter) no cabeçalho da matriz.
   Parte do objeto único ControleCargas (ver state.js). Novo arquivo
   [2026-07-29, pedido do usuário: "implementar um modelo que ao clicar nos
   itens do cabeçalho da matriz aparece filtros de seleção igual o excel...
   podemos remover o de Comentários sobre atuação e responsável, já que vai
   existir no cabeçalho"] — CLAUDE.md §4, 1 arquivo por funcionalidade (não
   inchar filtros.js/matriz.js). O modelo é genérico (FILTRO_CABECALHO_COLUNAS
   + tagsColunaParaLinha) — dá pra estender pra outras colunas sem reescrever
   nada aqui.

   [AMPLIADO 2026-07-29, mesmo dia, pedido do usuário: "preciso poder
   selecionar instituição no filtro, Modelo de Carga, o texto da Ref (aqui
   acrescentar texto + Problema Rent para filtrar os com problema)"] —
   3 colunas novas: institution/loadModel (campo simples da linha, 1 tag) e
   statusRef (a coluna do DIA DE REFERÊNCIA — 1 ou 2 tags por linha: a sigla
   do estado nessa data — "pode ser só os nomes e símbolos que usamos nas
   células", pedido do usuário no mesmo dia, ver tagsColunaParaLinha — e
   também "Problema Rent" quando há divergência Rent×NAV >2bp nesse dia).
   `statusRef` substitui os antigos controles soltos da toolbar ("Status na
   Data Ref" select + chip "Só divergência"). Por ter potencialmente 2 tags
   por linha, o modelo de "1 linha = 1 valor" virou "1 linha = array de
   tags" (tagsColunaParaLinha) em TODA coluna — as demais colunas continuam
   com array de 1 elemento, sem mudança de comportamento.
*/
Object.assign(ControleCargas, {
// coluna -> rótulo exibido no popover/título do botão ▾.
FILTRO_CABECALHO_COLUNAS: {
  responsavel: 'Responsável',
  comentarioAtuacao: 'Comentário sobre atuação',
  institution: 'Instituição',
  loadModel: 'Modelo de Carga',
  statusRef: 'Status (Data Referência)',
},

/* Contexto:
   Botão "▾" desenhado dentro do <th> de uma coluna filtrável — abre o
   popover ao clicar (wireFiltrosCabecalho). Usada por buildCabecalhoMatriz()
   (matriz.js). Retorna string HTML.

   Pseudocódigo:
     1. Marca a classe "active" quando a coluna já tem um filtro aplicado
        (state.filtroValoresColuna[coluna] não é null) — feedback visual,
        mesmo espírito do estado "on" dos chips de filtro. */
renderFiltroCabecalhoBotaoHtml(coluna){
  const ativo = ControleCargas.state.filtroValoresColuna[coluna] != null;
  return `<button type="button" class="th-filter-btn ${ativo?'active':''}" data-filtro-coluna="${coluna}" title="Filtrar ${ControleCargas.esc(ControleCargas.FILTRO_CABECALHO_COLUNAS[coluna]||'')}">▾</button>`;
},

/* Contexto:
   Resolve a(s) tag(s) de 1 linha (carteira/agrupamento) pra uma coluna
   filtrável — normalmente 1 tag (o valor do campo), mas `statusRef` pode
   devolver 2 (o estado na data de referência + "Problema Rent", se houver
   divergência). Usada por applyFilters() (filtros.js) e por
   listaValoresDistintosColuna()/abrirFiltroCabecalho() (aqui). Retorna
   array de strings (nunca vazio — sempre ao menos 1 tag, mesmo que "").

   Pseudocódigo:
     1. responsavel/comentarioAtuacao -> 1 tag, valor da anotação na data de
        referência (annotationAtual, anotacoes.js).
     2. institution/loadModel -> 1 tag, campo direto da linha (r[coluna]).
     3. statusRef -> 1 a 3 tags: a MESMA sigla mostrada na célula da grade
        (mockkeyReferencia + STATES[...].letter — [REVISADO 2026-07-29,
        pedido do usuário: "pode ser só os nomes e símbolos que usamos nas
        células + Problema Rent"; antes usava o nome longo, STATES[...].name]
        — cD e wc COMPARTILHAM a sigla "Pro" na célula, então também
        compartilham aqui de propósito, igual o usuário vê na tela), se
        divergenciaBpReferencia(r) > 2bp, também "Problema Rent", e [NOVO
        2026-08-13, pedido do usuário: "se a carteira da lista for comprada
        por alguma carteira da lista..."] se r.aguardandoExplosao (só
        carteira, nunca Agrupamento), também "Comprada". */
tagsColunaParaLinha(coluna, isWallets, r){
  if(coluna === 'responsavel' || coluna === 'comentarioAtuacao'){
    const targetType = isWallets ? 'wallet' : 'grouping';
    const rid = r.walletId || r.groupingId;
    return [ ControleCargas.annotationAtual(targetType, rid)[coluna] || '' ];
  }
  if(coluna === 'institution' || coluna === 'loadModel'){
    return [ r[coluna] || '' ];
  }
  if(coluna === 'statusRef'){
    const mk = ControleCargas.mockkeyReferencia(r);
    const st = ControleCargas.STATES[mk];
    const tags = [ st ? st.letter : '—' ];
    const bp = ControleCargas.divergenciaBpReferencia(r);
    if(bp != null && bp > 2) tags.push('Problema Rent');
    if(isWallets && r.aguardandoExplosao) tags.push('Comprada');
    return tags;
  }
  return [''];
},

/* Contexto:
   Ordem de exibição das tags de `statusRef` na lista do filtro — [REVISADO
   2026-07-29, pedido do usuário: "a ordem da seleção do filtro deve ser a
   mesma da exibição"] antes vinha em ordem alfabética (misturava "Concluída
   — Processada", "Em andamento — Unprocessed" etc. sem relação com a
   gravidade real); agora segue a MESMA ordem de PRIORITY_ORDER (state.js —
   pior→melhor, a mesma usada pra ordenar as linhas da grade e que o antigo
   select "Status na Data Ref" já usava). Como as tags agora são SIGLAS
   (STATES[...].letter, não .name — ver tagsColunaParaLinha), e cD/wc
   compartilham a sigla "Pro", o findIndex() abaixo acha o PRIMEIRO mockkey
   de PRIORITY_ORDER com aquela sigla — que é sempre "wc" antes de "cD" (wc
   vem primeiro no array, por ser o mais urgente dos dois) — então "Pro"
   fica ranqueado na posição do pior dos dois, sem esforço extra. "Problema
   Rent"/"Comprada" (não são mockkey real) entram logo depois do pior estado
   presente. Usada por listaValoresDistintosColuna(). Retorna número (menor =
   mostrado primeiro).

   Pseudocódigo:
     1. Sigla de estado real -> índice em PRIORITY_ORDER (via
        STATES[mk].letter — 1º match, ver nota acima sobre "Pro").
     2. "Problema Rent"/"Comprada" [2026-08-13] -> logo depois do último
        estado (PRIORITY_ORDER.length).
     3. Qualquer outra coisa (não deveria ocorrer) -> ainda depois disso. */
RANK_ORDEM_STATUS_REF(tag){
  const idx = ControleCargas.PRIORITY_ORDER.findIndex(mk=> ControleCargas.STATES[mk] && ControleCargas.STATES[mk].letter === tag);
  if(idx !== -1) return idx;
  if(tag === 'Problema Rent' || tag === 'Comprada') return ControleCargas.PRIORITY_ORDER.length;
  return ControleCargas.PRIORITY_ORDER.length + 1;
},

/* Contexto:
   Lista os valores/tags distintos de 1 coluna filtrável, já considerando os
   DEMAIS filtros ativos (empresa/outras colunas) — mesmo comportamento "em
   cascata" do AutoFilter do Excel (a lista de opções some valores que os
   outros filtros já excluíram). Usada por abrirFiltroCabecalho(). Retorna
   array ordenado de {valor, label, contagem}.

   Pseudocódigo:
     1. Resolve as linhas da aba corrente (Carteiras/Agrupamentos).
     2. Aplica applyFilters() com `skipColumn=coluna` (o filtro da própria
        coluna não deve restringir a lista dela mesma).
     3. Conta ocorrências de cada tag (tagsColunaParaLinha) — uma linha com
        2 tags (caso statusRef+Problema Rent) conta pras duas.
     4. Ordena: `statusRef` usa a ordem de severidade da grade
        (RANK_ORDEM_STATUS_REF, pior→melhor — pedido do usuário: "a ordem da
        seleção do filtro deve ser a mesma da exibição"); as demais colunas
        continuam alfabéticas, com "(Vazio)" sempre por último. */
listaValoresDistintosColuna(coluna, isWallets){
  const source = isWallets ? ControleCargas.SNAPSHOT.wallets : ControleCargas.SNAPSHOT.groupings;
  const linhas = ControleCargas.applyFilters(source, isWallets, coluna);
  const contagem = new Map();
  linhas.forEach(r=>{
    ControleCargas.tagsColunaParaLinha(coluna, isWallets, r).forEach(tag=>{
      contagem.set(tag, (contagem.get(tag)||0) + 1);
    });
  });
  const entradas = Array.from(contagem.entries()).map(([valor,n])=> ({
    valor, contagem:n, label: valor === '' ? '(Vazio)' : valor,
  }));
  if(coluna === 'statusRef'){
    entradas.sort((a,b)=> ControleCargas.RANK_ORDEM_STATUS_REF(a.valor) - ControleCargas.RANK_ORDEM_STATUS_REF(b.valor));
  } else {
    entradas.sort((a,b)=> (a.valor==='') - (b.valor==='') || a.label.localeCompare(b.label));
  }
  return entradas;
},

/* Contexto:
   Fecha (remove do DOM) o popover de filtro de cabeçalho aberto, se houver
   — chamada antes de abrir um novo (só 1 por vez), ao clicar fora, Esc, ou
   antes de redesenhar a matriz (o <th> que ancora o popover é destruído a
   cada buildMatrix()). Não retorna nada.

   Pseudocódigo:
     1. Sem popover no DOM, não faz nada.
     2. Remove o elemento e os listeners globais (fora-do-clique/Esc) que só
        existem enquanto ele está aberto. */
fecharFiltroCabecalho(){
  const pop = document.getElementById('th-filter-popover');
  if(pop) pop.remove();
  if(ControleCargas._fecharFiltroCabecalhoHandler){
    document.removeEventListener('mousedown', ControleCargas._fecharFiltroCabecalhoHandler, true);
    document.removeEventListener('keydown', ControleCargas._fecharFiltroCabecalhoHandler, true);
    ControleCargas._fecharFiltroCabecalhoHandler = null;
  }
  // [2026-07-29, pedido do usuário: "ajuste o filtro que está descendo
  // junto com o scroll da página"] listener de reposicionamento (ver
  // abrirFiltroCabecalho) precisa sair junto — senão acumula 1 listener de
  // scroll morto por popover aberto/fechado.
  if(ControleCargas._reposicionarFiltroCabecalhoHandler){
    window.removeEventListener('scroll', ControleCargas._reposicionarFiltroCabecalhoHandler, true);
    window.removeEventListener('resize', ControleCargas._reposicionarFiltroCabecalhoHandler, true);
    ControleCargas._reposicionarFiltroCabecalhoHandler = null;
  }
},

/* Contexto:
   Abre o popover "estilo Excel" (busca + lista de checkboxes + Selecionar
   tudo/Limpar filtro/Cancelar/OK) ancorado embaixo do botão ▾ de 1 coluna.
   Chamada por wireFiltrosCabecalho() ao clicar num .th-filter-btn. Não
   retorna nada.

   Pseudocódigo:
     1. Fecha qualquer popover já aberto (só 1 por vez).
     2. Calcula os valores distintos possíveis (em cascata, ver
        listaValoresDistintosColuna) e quais já estão marcados (filtro atual
        ou, sem filtro ativo, todos marcados).
     3. Monta o HTML (busca + checkbox "Selecionar tudo" + lista + rodapé) e
        posiciona logo abaixo do botão âncora (coordenadas de viewport,
        position:fixed). [CORRIGIDO 2026-07-29, pedido do usuário: "ajuste o
        filtro que está descendo junto com o scroll da página" — a posição
        era calculada 1x, na abertura; como o botão âncora vive DENTRO da
        área com scroll próprio da matriz (.grid-scroll, tanto vertical
        quanto horizontal — drag-to-scroll), rolar a grade OU a página
        depois de abrir deixava o popover para trás/deslocado do botão.
        Agora reposiciona() é chamada de novo a cada evento de scroll
        (capture:true, pra pegar o scroll de QUALQUER contêiner, não só da
        window) e de resize, então o popover sempre acompanha o botão.
     4. Liga: busca (filtra as linhas visíveis da lista, não a seleção),
        "Selecionar tudo" (marca/desmarca todas as linhas VISÍVEIS),
        "Limpar filtro" (remove o filtro da coluna e fecha, aplicando na
        hora), "Cancelar"/clique fora/Esc (fecha sem aplicar), "OK" (monta o
        Set escolhido — vira null se cobre 100% dos valores possíveis,
        senão o Set — desconge­la a ordem e reconstrói a matriz). */
abrirFiltroCabecalho(coluna, anchorBtn){
  ControleCargas.fecharFiltroCabecalho();
  const isWallets = ControleCargas.state.view === 'wallets';
  const valores = ControleCargas.listaValoresDistintosColuna(coluna, isWallets);
  const filtroAtual = ControleCargas.state.filtroValoresColuna[coluna];
  const marcados = new Set(filtroAtual ? Array.from(filtroAtual) : valores.map(v=>v.valor));

  const pop = document.createElement('div');
  pop.id = 'th-filter-popover';
  pop.className = 'th-filter-popover';
  pop.innerHTML = `
    <input type="text" class="th-filter-search" placeholder="Buscar...">
    <label class="th-filter-selectall"><input type="checkbox" checked> <b>Selecionar tudo</b></label>
    <div class="th-filter-list">
      ${valores.map(v=> `<label class="th-filter-item"><input type="checkbox" value="${ControleCargas.escAttr(v.valor)}" ${marcados.has(v.valor)?'checked':''}> ${ControleCargas.esc(v.label)} <span class="th-filter-count">(${v.contagem})</span></label>`).join('') || '<div class="th-filter-empty">Nenhum valor nesta coluna.</div>'}
    </div>
    <div class="th-filter-footer">
      <button type="button" class="linklike" data-fc-action="limpar" title="Remove o filtro desta coluna">Limpar</button>
      <button type="button" class="linklike" data-fc-action="cancelar">Cancelar</button>
      <button type="button" class="btn" data-fc-action="ok">OK</button>
    </div>`;
  document.body.appendChild(pop);

  const reposicionar = ()=>{
    const rect = anchorBtn.getBoundingClientRect();
    const popW = pop.offsetWidth || 220;
    pop.style.top = `${Math.round(rect.bottom + 4)}px`;
    pop.style.left = `${Math.round(Math.max(8, Math.min(rect.left, window.innerWidth - popW - 8)))}px`;
  };
  reposicionar();
  ControleCargas._reposicionarFiltroCabecalhoHandler = reposicionar;
  window.addEventListener('scroll', reposicionar, true);
  window.addEventListener('resize', reposicionar, true);

  const checkboxItens = ()=> Array.from(pop.querySelectorAll('.th-filter-item input[type=checkbox]'));
  const selectAllBox = pop.querySelector('.th-filter-selectall input');

  const sincronizarSelectAll = ()=>{
    const visiveis = checkboxItens().filter(cb=> cb.closest('.th-filter-item').style.display !== 'none');
    selectAllBox.checked = visiveis.length>0 && visiveis.every(cb=> cb.checked);
  };
  // estado inicial: o HTML acima nasce com "Selecionar tudo" marcado de
  // propósito (placeholder), mas se já havia um filtro parcial aplicado
  // antes (marcados ≠ todos os valores), precisa corrigir pro real.
  sincronizarSelectAll();

  pop.querySelector('.th-filter-search').addEventListener('input', (e)=>{
    const q = e.target.value.toLowerCase();
    pop.querySelectorAll('.th-filter-item').forEach(item=>{
      item.style.display = item.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
    sincronizarSelectAll();
  });

  selectAllBox.addEventListener('change', ()=>{
    checkboxItens().filter(cb=> cb.closest('.th-filter-item').style.display !== 'none')
      .forEach(cb=> cb.checked = selectAllBox.checked);
  });
  checkboxItens().forEach(cb=> cb.addEventListener('change', sincronizarSelectAll));

  pop.querySelector('[data-fc-action="cancelar"]').addEventListener('click', ()=> ControleCargas.fecharFiltroCabecalho());
  pop.querySelector('[data-fc-action="limpar"]').addEventListener('click', ()=>{
    ControleCargas.state.filtroValoresColuna[coluna] = null;
    ControleCargas.state.frozen = null;
    ControleCargas.fecharFiltroCabecalho();
    ControleCargas.buildMatrix();
  });
  pop.querySelector('[data-fc-action="ok"]').addEventListener('click', ()=>{
    const escolhidos = new Set(checkboxItens().filter(cb=>cb.checked).map(cb=>cb.value));
    // cobre 100% dos valores possíveis (nesta cascata) -> equivale a "sem
    // filtro" (null); menos que isso, mesmo vazio (nada marcado = mostra 0
    // linhas, igual ao Excel), guarda o Set escolhido.
    const cobreTudo = valores.length>0 && escolhidos.size === valores.length;
    ControleCargas.state.filtroValoresColuna[coluna] = cobreTudo ? null : escolhidos;
    ControleCargas.state.frozen = null;
    ControleCargas.fecharFiltroCabecalho();
    ControleCargas.buildMatrix();
  });

  // fecha ao clicar fora ou apertar Esc — capture:true pra rodar antes de
  // qualquer outro handler de clique da página (evita reabrir/duplicar).
  ControleCargas._fecharFiltroCabecalhoHandler = (e)=>{
    if(e.type==='keydown'){ if(e.key==='Escape') ControleCargas.fecharFiltroCabecalho(); return; }
    if(!pop.contains(e.target) && e.target!==anchorBtn) ControleCargas.fecharFiltroCabecalho();
  };
  document.addEventListener('mousedown', ControleCargas._fecharFiltroCabecalhoHandler, true);
  document.addEventListener('keydown', ControleCargas._fecharFiltroCabecalhoHandler, true);
},

/* Contexto:
   Liga o clique nos botões ▾ de filtro de cabeçalho — delegado no
   `document` (sobrevive a buildMatrix() recriar o <thead> do zero, mesmo
   padrão de wireFilterShortcuts()). Chamada 1x no bootstrap (index.js).
   Não retorna nada.

   Pseudocódigo:
     1. Delega o clique; se o alvo é um .th-filter-btn, abre (ou fecha, se
        já era o mesmo botão que estava aberto) o popover daquela coluna. */
wireFiltrosCabecalho(){
  document.addEventListener('click', (e)=>{
    const btn = e.target.closest('.th-filter-btn');
    if(!btn) return;
    e.stopPropagation();
    const jaAberto = document.getElementById('th-filter-popover') && ControleCargas._filtroCabecalhoAbertoEm === btn;
    ControleCargas.fecharFiltroCabecalho();
    if(jaAberto){ ControleCargas._filtroCabecalhoAbertoEm = null; return; }
    ControleCargas._filtroCabecalhoAbertoEm = btn;
    ControleCargas.abrirFiltroCabecalho(btn.dataset.filtroColuna, btn);
  });
},
});
