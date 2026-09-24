/* ControleCargas.filtros — filtros (empresa/instituição/pendência/busca), ordenação e os atalhos de clique nos chips da matriz.
   Parte do objeto único ControleCargas (ver state.js). Gerado a partir da
   refatoração de index_template.html (CLAUDE.md §4, "Divisão clara das
   páginas" — pasta static/js/controle_cargas/, 1 arquivo por funcionalidade).
*/
Object.assign(ControleCargas, {
// focusDate: data escolhida pelo usuário clicando numa coluna do cabeçalho
// da matriz (ver ControleCargas.wireHeaderDateClicks, matriz.js) — controla
// só o painel "Carteiras Publicadas" (buildPublishStat); null = usa a data
// de referência do grid (meta.referenceDate), comportamento default.
// sortDir: 1 = direção padrão do critério corrente (a mesma de sempre, ver
// sortArrayBy), -1 = invertida — alternado ao clicar de novo no MESMO
// cabeçalho/botão de ordenação já ativo [2026-07-24, pedido do usuário:
// "permitir ordenação... clicando no cabeçalho" + seta indicando direção].
// filtroValoresColuna: filtro "estilo Excel" por coluna — [REVISADO
// 2026-07-29, pedido do usuário: "implementar um modelo que ao clicar nos
// itens do cabeçalho da matriz aparece filtros de seleção igual o excel...
// podemos remover o de Comentários sobre atuação e responsável"; ampliado
// no mesmo dia: "preciso poder selecionar instituição no filtro, Modelo de
// Carga, o texto da Ref (aqui acrescentar texto + Problema Rent para
// filtrar os com problema)"] substitui os antigos controles soltos da
// toolbar (select de Instituição, select "Status na Data Ref", chip "Só
// divergência", campos de texto Responsável/Comentário) por um dropdown no
// próprio cabeçalho de cada coluna (ver filtro_cabecalho.js): cada chave é
// null (sem filtro — mostra tudo) ou um Set com os valores/tags escolhidos
// na lista de checkboxes (mesmo comportamento do AutoFilter do Excel — sem
// filtro "contém", só seleção de valores distintos). `statusRef` é
// especial: cada linha pode contribuir com MAIS de 1 tag (o nome do estado
// na data de referência, e também "Problema Rent" quando há divergência
// >2bp nessa data) — ver tagsColunaParaLinha() em filtro_cabecalho.js.
// [2026-09-24] Além das chaves fixas abaixo, cada coluna de dia não-Ref
// ganha chave dinâmica "statusDia:YYYY-MM-DD" quando filtrada (criada no OK
// do popover) — applyFilters() já percorre todas as chaves presentes.
// [2026-09-24, pedido do usuário: "quero dois filtros Gerais, Selecionar
// Todos Com Divergencia de Rentabilidade e selecionar Todos Pauta, posso
// selecionar esses dois filtros juntos. Capturar todos no range de datas"]
// filtrosGerais é o 1º filtro que NÃO olha uma data só: os do cabeçalho
// (statusRef/statusDia:<data>) perguntam "como esta carteira está NESTE
// dia?", e estes perguntam "esta carteira teve o alerta em QUALQUER dia da
// janela?". Os dois SOMAM quando marcados juntos (união, não interseção —
// ver linhaPassaNosFiltrosGerais): marcar os dois é pedir a lista de trabalho
// do dia inteira, não o punhado que tem os dois alertas ao mesmo tempo.
// Quem quer JUSTAMENTE esse punhado tem o 3º filtro, "Divergência na Pauta",
// que é E dentro da MESMA célula [2026-09-24, pedido do usuário].
// [2026-09-11, relato do usuário: "às vezes fica em data antiga"]
// sequenciaAtualizacao / sincronizacaoDataInicial são estado de CONCORRÊNCIA do
// botão Atualizar (atualizar.js): a tela dispara /api/atualizar de 4 lugares
// (refresh automático do init(), clique no botão, Enter nos campos, e logo
// depois de colar o token Beehus) e cada chamada leva 30-100s, então 2 podem
// ficar no ar ao mesmo tempo. sequenciaAtualizacao numera cada pedido pra só a
// resposta do ÚLTIMO ser aplicada (sem isso, uma resposta lenta da janela
// ANTIGA chegava depois e sobrescrevia a matriz nova);
// sincronizacaoDataInicial guarda o fetch pendente que recalcula o campo "de"
// a cada troca do "até", pra um Atualizar disparado rápido demais não enviar a
// janela desatualizada (400 "janela maior que o teto").
// [2026-09-15] timerProgresso é o setInterval que consulta
// /api/atualizar/progresso enquanto o Atualizar está no ar (progresso.js) —
// fica no state só pra nunca existir mais de um timer de pé ao mesmo tempo.
state: { view:'wallets', sort:'priority', sortDir:1, frozen:null, company:null,
              filtroValoresColuna: {responsavel:null, comentarioAtuacao:null, institution:null, loadModel:null, statusRef:null},
              filtrosGerais: {divergencia:false, pauta:false, divergenciaNaPauta:false},
              search:'', showBloco3:false, focusDate:null,
              sequenciaAtualizacao:0, sincronizacaoDataInicial:null,
              timerProgresso:null },

// ─────────────────────────────────────────────────────────────────────────
// Filtros
// ─────────────────────────────────────────────────────────────────────────
/* Contexto:
   Aplica os filtros correntes (empresa/coluna/busca por texto) a uma lista
   de linhas (carteiras ou agrupamentos). Chamada por sortedRows() e
   getGroupingBlocks() antes de ordenar, e por filtro_cabecalho.js (com
   `skipColumn`) pra calcular a lista de valores distintos de UMA coluna sem
   que o filtro dela mesma se auto-restrinja (mesmo comportamento "em
   cascata" do AutoFilter do Excel). Retorna a lista filtrada (nova array).

   Pseudocódigo:
     1. Para cada linha, descarta se a empresa selecionada não bate, ou se
        ela não passa nos filtros gerais (linhaPassaNosFiltrosGerais).
     2. Pra cada coluna com filtro "estilo Excel" ativo
        (state.filtroValoresColuna — responsavel/comentarioAtuacao/
        institution/loadModel/statusRef), descarta a linha se NENHUMA das
        suas tags (normalmente 1, statusRef pode ter 2) está no Set
        escolhido; PULA essa checagem quando a coluna é `skipColumn`
        (cascata: calculando os valores possíveis da própria coluna que
        está sendo editada, seu filtro atual não deve se aplicar a si
        mesmo).
     3. Descarta se o texto de busca não aparece no nome da linha.
     4. Mantém a linha se passou por todos os filtros acima. */
applyFilters(rows, isWallets, skipColumn){
  return rows.filter(r=>{
    if(ControleCargas.state.company && r.company !== ControleCargas.state.company) return false;
    if(!ControleCargas.linhaPassaNosFiltrosGerais(r)) return false;
    for(const coluna of Object.keys(ControleCargas.state.filtroValoresColuna)){
      if(coluna === skipColumn) continue;
      const permitidos = ControleCargas.state.filtroValoresColuna[coluna];
      if(!permitidos) continue;
      const tags = ControleCargas.tagsColunaParaLinha(coluna, isWallets, r);
      if(!tags.some(t=> permitidos.has(t))) return false;
    }
    if(ControleCargas.state.search){
      const q = ControleCargas.state.search.toLowerCase();
      if(!r.name.toLowerCase().includes(q)) return false;
    }
    return true;
  });
},

// O que cada filtro geral exige de UMA MESMA célula — nomes iguais aos que
// snapshot_builder.py escreve em cells[].ov e que a legenda mostra:
// 'div'/'div_strong' são o badge "Rent" (respeitam os 2 campos de limiar da
// toolbar) e 'pauta' é o badge "Pauta" [2026-09-24, pedido do usuário].
//
// Formato: lista de REQUISITOS; cada requisito é uma lista de overlays
// aceitáveis. Dentro do requisito vale OU, entre requisitos vale E — e o E é
// dentro da MESMA célula, que é o que diferencia "tem divergência e tem pauta
// (em dias quaisquer)" de "tem divergência NO dia da pauta" [2026-09-24,
// pedido do usuário: "novo filtro, todos com divergencia de rentabilidade só
// na Pauta"].
REQUISITOS_FILTRO_GERAL: {
  divergencia: [['div', 'div_strong']],
  pauta: [['pauta']],
  divergenciaNaPauta: [['div', 'div_strong'], ['pauta']],
},

// Rótulo de cada filtro geral no chip da toolbar (ordem de exibição).
ROTULOS_FILTRO_GERAL: {
  divergencia: 'Todos com Divergência de Rentabilidade',
  pauta: 'Todos Pauta',
  divergenciaNaPauta: 'Todos com Divergência na Pauta',
},

// Explicação de cada chip (title), pra ninguém confundir o 3º com a soma dos
// 2 primeiros — ele é mais estreito: exige os dois alertas no MESMO dia.
AJUDA_FILTRO_GERAL: {
  divergencia: 'Linhas com o badge Rent (divergência Rent Contrib × NAV, pelos limiares da toolbar) em QUALQUER dia do range.',
  pauta: 'Linhas com o badge Pauta (dia exato da Defasagem) em QUALQUER dia do range.',
  divergenciaNaPauta: 'Mais estreito que os outros dois: exige o badge Rent e o badge Pauta na MESMA célula — divergência no próprio dia da pauta.',
},

/* Contexto:
   Diz se UMA célula atende a todos os requisitos de um filtro geral (ver
   REQUISITOS_FILTRO_GERAL: OU dentro do requisito, E entre requisitos).
   Usada por linhaTemCelulaQueAtende(). Retorna bool.

   Pseudocódigo:
     1. Lê os overlays da célula (ausentes = lista vazia).
     2. Todo requisito precisa ter pelo menos 1 overlay presente nela. */
celulaAtendeRequisitos(celula, requisitos){
  const overlays = (celula && celula.ov) || [];
  return requisitos.every(aceitos=> aceitos.some(o=> overlays.includes(o)));
},

/* Contexto:
   Diz se a linha tem ALGUMA célula da janela que atende aos requisitos — é o
   que diferencia os filtros gerais dos filtros de cabeçalho, que olham um dia
   só [2026-09-24, pedido do usuário: "Capturar todos no range de datas"].
   Usada por linhaPassaNosFiltrosGerais(). Serve igual pra carteira e pra
   agrupamento (os dois têm `cells` com `ov`). Retorna bool.

   Repare que o E é DENTRO da célula: "divergência na pauta" exige os dois
   badges no mesmo dia, não um alerta num dia e outro em outro.

   Pseudocódigo:
     1. Percorre as células da linha (a janela inteira, em ordem).
     2. Basta uma que atenda a todos os requisitos pra devolver true. */
linhaTemCelulaQueAtende(r, requisitos){
  return (r.cells || []).some(c=> ControleCargas.celulaAtendeRequisitos(c, requisitos));
},

/* Contexto:
   Aplica os filtros gerais da toolbar (state.filtrosGerais) a 1 linha —
   chamada por applyFilters() antes dos filtros de coluna. Retorna bool
   (true = a linha continua na grade).

   Os dois filtros SOMAM quando marcados juntos: a linha passa se tiver
   divergência OU pauta em qualquer dia da janela [2026-09-24, pedido do
   usuário: "posso selecionar esses dois filtros juntos"]. União, não
   interseção — marcar os dois é montar a lista de trabalho do dia (tudo que
   pede atenção), não isolar o punhado que tem os dois alertas juntos.

   Pseudocódigo:
     1. Nenhum filtro geral marcado -> passa (comportamento de sempre).
     2. Marcado(s) -> passa se casar com PELO MENOS UM deles. */
linhaPassaNosFiltrosGerais(r){
  const marcados = Object.keys(ControleCargas.state.filtrosGerais)
    .filter(chave=> ControleCargas.state.filtrosGerais[chave]);
  if(!marcados.length) return true;
  return marcados.some(chave=>
    ControleCargas.linhaTemCelulaQueAtende(r, ControleCargas.REQUISITOS_FILTRO_GERAL[chave]));
},

/* Contexto:
   Liga/desliga 1 filtro geral (clique no chip da toolbar) e redesenha a
   grade. Chamada pelos handlers ligados em buildFilters(). Não retorna nada.

   Pseudocódigo:
     1. Inverte o estado do filtro pedido.
     2. Descongela a ordem (a lista mudou de tamanho; manter a ordem
        congelada mostraria linhas que o filtro acabou de tirar).
     3. Sincroniza os chips e reconstrói a matriz da aba visível. */
alternarFiltroGeral(chave){
  ControleCargas.state.filtrosGerais[chave] = !ControleCargas.state.filtrosGerais[chave];
  ControleCargas.state.frozen = null;
  const badge = document.getElementById('freeze-badge');
  if(badge) badge.style.display = 'none';
  ControleCargas.refreshFilterUI();
  ControleCargas.buildMatrix();
},

/* Contexto:
   Divergência Rent Contrib × NAV (em bp) da linha NA DATA DE REFERÊNCIA —
   última célula da janela. Usada pelo filtro "só divergência > 0,02%"
   [2026-07-24, pedido do usuário]. Retorna número (bp) ou null se a célula
   não tem divergência calculada nesse dia.

   Pseudocódigo:
     1. Sem `cells` ou array vazio -> null.
     2. Sem `tt.div` na última célula -> null.
     3. Devolve `tt.div.bp`. */
divergenciaBpReferencia(r){
  const cells = r.cells || [];
  if(!cells.length) return null;
  const tt = cells[cells.length-1].tt || {};
  return tt.div ? tt.div.bp : null;
},

/* Contexto:
   Mockkey (estado visual) da linha NA DATA DE REFERÊNCIA — última célula da
   janela (`cells` vem sempre em ordem cronológica, tanto pra carteira quanto
   pra agrupamento). Usada pelo filtro "só com pendência" (tier foi
   aposentado, 2026-07-24 — pendência agora é decidida direto pelo mockkey).
   Retorna string (mockkey) ou null se a linha não tem células.

   Pseudocódigo:
     1. Sem `cells` ou array vazio -> null.
     2. Devolve o campo `s` da última célula. */
mockkeyReferencia(r){
  const cells = r.cells || [];
  if(!cells.length) return null;
  return cells[cells.length-1].s;
},

/* Contexto:
   Comparador puro por chave de ordenação corrente — extraído de
   sortedRows() para ser reaproveitado também na aba Agrupamentos (ordena
   DENTRO de cada bloco de prioridade, nunca entre blocos — PLANNING §Visão
   por Agrupamento). Retorna uma NOVA array ordenada (não muta `rows`).

   Pseudocódigo:
     1. Copia a array de entrada (slice).
     2. Lê state.sortDir (1 = direção padrão do critério, -1 = invertida —
        alternado ao clicar de novo no mesmo cabeçalho/botão já ativo,
        wireOrdenacao() em index.js).
     3. Conforme o modo pedido (priority/name/company/institution), aplica
        o comparador correspondente multiplicado por `dir` — priority usa a
        sortKey pré-calculada no backend (lista, comparação lexicográfica);
        os demais comparam o campo textual e desempatam por nome (o
        desempate por nome NÃO inverte com `dir` — só a ordenação primária
        é invertida). */
sortArrayBy(rows, mode){
  const arr = rows.slice();
  const dir = ControleCargas.state.sortDir || 1;
  if(mode==='priority'){
    // sortKey é [rank, -contagem, nome] — rank do mockkey na data de
    // referência (pior primeiro, mesma ordem da legenda/PRIORITY_ORDER),
    // -contagem de dias da janela com esse MESMO mockkey (desempate: mais
    // dias iguais = mais prioritário), nome fecha a chave como ordem total
    // (nunca empate residual). Calculado em compute_sort_key(),
    // snapshot_builder.py [2026-07-24, pedido do usuário].
    arr.sort((a,b)=>{
      const ka=a.sortKey, kb=b.sortKey;
      for(let i=0;i<ka.length;i++){
        if(ka[i]<kb[i]) return -dir;
        if(ka[i]>kb[i]) return dir;
      }
      return 0;
    });
  } else if(mode==='name'){
    arr.sort((a,b)=> dir*a.name.localeCompare(b.name));
  } else if(mode==='company'){
    arr.sort((a,b)=> dir*(a.company||'').localeCompare(b.company||'') || a.name.localeCompare(b.name));
  } else if(mode==='institution'){
    arr.sort((a,b)=> dir*(a.institution||'').localeCompare(b.institution||'') || a.name.localeCompare(b.name));
  }
  return arr;
},

/* Contexto:
   Linhas prontas para desenhar na matriz: aplica os filtros e, se houver
   ordem congelada (state.frozen), respeita-a; senão ordena pelo critério
   corrente. Chamada por buildMatrix() (aba Carteiras) e por buildExcelXml().
   Retorna a lista final (filtrada + ordenada).

   Pseudocódigo:
     1. Se há uma ordem congelada, só filtra em cima dela (mantém a ordem
        fixada quando o usuário clicou "congelar").
     2. Senão, filtra a lista recebida e ordena pelo critério corrente. */
sortedRows(rows, isWallets){
  if(ControleCargas.state.frozen) return ControleCargas.applyFilters(ControleCargas.state.frozen, isWallets);
  const filtered = ControleCargas.applyFilters(rows, isWallets);
  return ControleCargas.sortArrayBy(filtered, ControleCargas.state.sort);
},

/* Contexto:
   Separa uma lista de agrupamentos em 3 blocos de prioridade (PLANNING
   §Visão por Agrupamento — "Ordenação da aba — 3 blocos de prioridade").
   Chamada por getGroupingBlocks() depois de ordenar. Retorna [bloco1,
   bloco2, bloco3] (arrays).

   Pseudocódigo:
     1. Percorre as linhas em ordem, empurrando cada uma na array do seu
        campo `bloco` (1, 2 ou 3) — partição ESTÁVEL, preserva a ordem
        relativa de entrada, então sortArrayBy(...) seguido de
        partitionByBloco(...) equivale a ordenar dentro de cada bloco. */
partitionByBloco(rows){
  const b1=[], b2=[], b3=[];
  rows.forEach(r=> (r.bloco===1?b1:r.bloco===2?b2:b3).push(r));
  return [b1, b2, b3];
},

/* Contexto:
   Linhas da aba Agrupamentos já filtradas + ordenadas + segmentadas em
   blocos (bloco 1: >=1 membro rastreado COM pendência; bloco 2: >=1
   rastreado, nenhum com pendência; bloco 3: zero membros rastreados).
   Chamada por buildMatrix() ao desenhar a aba Agrupamentos. Retorna [b1, b2,
   b3] (arrays).

   Pseudocódigo:
     1. Se há ordem congelada, só filtra (mantém a ordem fixada).
     2. Senão, filtra e ordena pelo critério corrente 1x (a ordenação dentro
        de cada bloco vem de graça da partição estável).
     3. Particiona o resultado em 3 blocos. */
getGroupingBlocks(){
  const source = ControleCargas.state.frozen
    ? ControleCargas.applyFilters(ControleCargas.state.frozen, false)                                   // ordem já fixada ao congelar
    : ControleCargas.sortArrayBy(ControleCargas.applyFilters(ControleCargas.SNAPSHOT.groupings, false), ControleCargas.state.sort);   // ordena 1x, depois particiona (estável)
  return ControleCargas.partitionByBloco(source);
},

// ─────────────────────────────────────────────────────────────────────────
// Filtros (chips de Company — os demais viraram filtro de cabeçalho)
// ─────────────────────────────────────────────────────────────────────────
/* Contexto:
   Desenha os chips de empresa e liga seus handlers de clique. Chamada no
   init() e sempre que o snapshot é trocado (botão Atualizar). Não retorna
   nada.

   [REMOVIDO 2026-07-29, pedido do usuário: "preciso poder selecionar
   instituição no filtro, Modelo de Carga, o texto da Ref..."] Esta função
   tinha também o select de Instituição, o select "Status na Data Ref" e o
   chip "Só divergência >0,02%" — os 3 saíram daqui e viraram filtro
   "estilo Excel" no próprio cabeçalho da coluna correspondente (Instituição
   e a coluna do dia de referência — ver filtro_cabecalho.js), no mesmo
   espírito da remoção de Responsável/Comentário já feita mais cedo no
   mesmo dia.

   Pseudocódigo:
     1. Monta o grupo "Alertas na janela" (os 2 filtros gerais) e, depois do
        divisor, os chips de empresa (a partir de meta.companies) — os gerais
        vêm primeiro pra não se perderem quando há 20 empresas na faixa
        [2026-09-24].
     2. Snapshot ainda sem empresa nenhuma -> acrescenta uma dica explicando
        que os chips aparecem depois do 1º Atualizar [2026-09-22, relato do
        usuário: "não aparece mais a company para selecionar"]. Desde que a
        tela deixou de consultar sozinha ao carregar (mesma data), o snapshot
        nasce vazio e esta faixa ficava com um chip só, sem explicação.
     3. Injeta no container #filters.
     4. Liga o clique de cada chip: atualiza o filtro, descongela a ordem e
        reconstrói a UI + a matriz. */
buildFilters(){
  const el = document.getElementById('filters');
  const companies = ControleCargas.SNAPSHOT.meta.companies;

  // [2026-09-24, pedido do usuário] Filtros GERAIS — não são por empresa nem
  // por dia: varrem a janela inteira (ver linhaPassaNosFiltrosGerais). Vêm
  // PRIMEIRO, num grupo com moldura: com 20 empresas na faixa, eles sumiam no
  // meio da lista [REVISADO no mesmo dia: "melhore a cor de seleção e layout"].
  const janela = `${ControleCargas.SNAPSHOT.meta.window[0]} a ${ControleCargas.SNAPSHOT.meta.referenceDate}`;
  let html = '<span class="filtros-grupo"><span class="filtros-grupo-rotulo" title="Filtros que olham a janela inteira, não uma data só">Alertas na janela</span>';
  Object.keys(ControleCargas.ROTULOS_FILTRO_GERAL).forEach(chave=>{
    const ligado = ControleCargas.state.filtrosGerais[chave];
    const ajuda = `${ControleCargas.AJUDA_FILTRO_GERAL[chave]} Range em tela: ${janela}. Marcando mais de um, a grade mostra quem atende a QUALQUER um deles.`;
    html += `<span class="chip chip-geral${ligado?' on':''}" data-geral="${chave}" role="button" aria-pressed="${ligado}" tabindex="0" title="${ControleCargas.escAttr(ajuda)}">${ControleCargas.esc(ControleCargas.ROTULOS_FILTRO_GERAL[chave])}</span>`;
  });
  html += '</span><span class="filtros-divisor"></span>';

  const empresaLigada = (valor)=> ControleCargas.state.company === valor;
  html += `<span class="chip ${empresaLigada(null)?'on':''}" data-company="" role="button" aria-pressed="${empresaLigada(null)}" tabindex="0">Todas as empresas</span>`;
  companies.forEach(c=>{
    html += `<span class="chip ${empresaLigada(c)?'on':''}" data-company="${ControleCargas.escAttr(c)}" role="button" aria-pressed="${empresaLigada(c)}" tabindex="0">${ControleCargas.esc(c)}</span>`;
  });
  if(!companies.length){
    html += '<span class="chip-dica">as empresas aparecem aqui depois do primeiro ↻ Atualizar</span>';
  }

  el.innerHTML = html;

  el.querySelectorAll('.chip[data-company]').forEach(chip=>{
    chip.addEventListener('click', ()=>{
      ControleCargas.state.company = chip.dataset.company || null;
      ControleCargas.state.frozen = null;
      ControleCargas.refreshFilterUI(); ControleCargas.buildMatrix();
    });
  });
  el.querySelectorAll('.chip[data-geral]').forEach(chip=>{
    chip.addEventListener('click', ()=> ControleCargas.alternarFiltroGeral(chip.dataset.geral));
  });
},

/* Contexto:
   Sincroniza a classe visual "on" (destacado) dos chips de empresa com o
   estado corrente — chamada depois de qualquer mudança de filtro que não
   redesenha buildFilters() inteiro (evita perder o foco/handlers já
   ligados). Não retorna nada.

   Pseudocódigo:
     1. Para cada chip de empresa, liga "on" só no que corresponde ao filtro
        corrente.
     2. Para cada chip de filtro geral, liga "on" conforme state.filtrosGerais
        [2026-09-24].
     3. Mantém o aria-pressed de cada chip em dia com a classe — é o que um
        leitor de tela anuncia, e o que sobra quando a cor não basta. */
refreshFilterUI(){
  document.querySelectorAll('.chip[data-company]').forEach(chip=>{
    const ligado = (chip.dataset.company||null) === ControleCargas.state.company;
    chip.classList.toggle('on', ligado);
    chip.setAttribute('aria-pressed', ligado);
  });
  document.querySelectorAll('.chip[data-geral]').forEach(chip=>{
    const ligado = !!ControleCargas.state.filtrosGerais[chip.dataset.geral];
    chip.classList.toggle('on', ligado);
    chip.setAttribute('aria-pressed', ligado);
  });
},

/* Contexto:
   Liga atalhos de filtro que vivem DENTRO da matriz (clique no chip de
   instituição ou no link de company de uma linha aplica aquele filtro).
   Chamada 1x no bootstrap (index.js) — usa delegação de evento no
   document, então funciona mesmo depois da matriz ser redesenhada. Não
   retorna nada.

   Pseudocódigo:
     1. Delega o clique no document; se o alvo é um chip de instituição,
        aplica o filtro "estilo Excel" da coluna Instituição só com esse
        valor (Set de 1 elemento) e reconstrói a matriz [REVISADO
        2026-07-29 — antes escrevia direto em state.institution/inst-select,
        removidos].
     2. Senão, se o alvo é um link de company, atualiza o filtro de empresa,
        atualiza a UI e reconstrói a matriz. */
wireFilterShortcuts(){
  // clique nos chips de instituição/company dentro da tabela (atalho de filtro)
  document.addEventListener('click', (e)=>{
    const instEl = e.target.closest('.inst-chip');
    if(instEl){
      const valor = instEl.dataset.inst || '';
      ControleCargas.state.filtroValoresColuna.institution = new Set([valor]);
      ControleCargas.state.frozen = null;
      ControleCargas.buildMatrix();
      return;
    }
    const compEl = e.target.closest('.companylink');
    if(compEl){
      ControleCargas.state.company = compEl.dataset.company || null;
      ControleCargas.refreshFilterUI();
      ControleCargas.buildMatrix();
    }
  });
},
});
