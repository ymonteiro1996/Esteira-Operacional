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
// [2026-09-24, pedido do usuário: "estude um filtro melhor, um filtro só na
// pauta que eu consiga selecionar o Status Pauta: Todos filtros que usamos
// nas datas. Ai vamos tirar essas seleções de todos com divergencia de
// rentabilidade e todos pauta"] `statusPauta` é uma coluna VIRTUAL: não há
// cabeçalho "Pauta" na grade (o dia da pauta é a Defasagem de CADA carteira,
// muda linha a linha), mas ela se comporta como as colunas de data em tudo o
// mais — mesmas tags, mesmo popover, mesma cascata. Substituiu os 3 chips de
// "filtros gerais" (divergência / pauta / divergência na pauta) que existiram
// por algumas horas no mesmo dia: eles eram 3 atalhos fixos, este é o filtro
// inteiro ("Problema Rent" marcado na coluna da Pauta = o que o chip
// "Divergência na Pauta" fazia, e ainda dá pra cruzar com Unp/Pro/Pub, Carga
// Mensal, etc.).
// [2026-09-24, pedido do usuário: "precisamos implementar seleção de célula
// na matriz"] celulaSelecionada = {view, rid, date} da ÚNICA célula marcada
// na tela (null = nenhuma). Quem lê e explica o efeito é
// static/js/controle_cargas/selecao_celula.js: a linha selecionada passa a
// editar a anotação DO DIA da célula, em vez da data de referência.
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
              filtroValoresColuna: {responsavel:null, comentarioAtuacao:null, institution:null, loadModel:null, statusRef:null, statusPauta:null},
              search:'', showBloco3:false, focusDate:null, celulaSelecionada:null,
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
     1. Para cada linha, descarta se a empresa selecionada não bate.
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

  // [2026-09-24, pedido do usuário] Filtro da PAUTA — mesmo popover das
  // colunas de data (.th-filter-btn + data-filtro-coluna, ligado por
  // wireFiltrosCabecalho), só que a célula lida é a do badge Pauta de cada
  // carteira em vez de uma data fixa. Fica na frente da faixa, num grupo
  // próprio, pra não se perder no meio de 20 chips de empresa.
  let html = '<span class="filtros-grupo"><span class="filtros-grupo-rotulo" title="Filtra pelo dia da Defasagem de cada carteira (o dia com o badge Pauta), com as mesmas opções das colunas de data">Pauta</span>'
           + ControleCargas.botaoFiltroPautaHtml()
           + '</span><span class="filtros-divisor"></span>';

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
},

/* Contexto:
   Monta o botão "Status na Pauta ▾" da faixa de filtros — o único controle
   do filtro de Pauta [2026-09-24, pedido do usuário: "um filtro só na pauta
   que eu consiga selecionar o Status Pauta: Todos filtros que usamos nas
   datas"]. Chamada por buildFilters(). Retorna string HTML.

   De propósito carrega a classe `th-filter-btn` e o `data-filtro-coluna` das
   colunas da grade: é o que faz o clique cair no handler que já existe
   (wireFiltrosCabecalho, filtro_cabecalho.js) e abrir o MESMO popover, sem
   uma segunda implementação de filtro na tela.

   Pseudocódigo:
     1. Lê o filtro atual da coluna virtual (null = sem filtro).
     2. Com filtro ativo, mostra quantos valores estão marcados no rótulo e
        liga a classe "active" (cor de selecionado).
     3. Devolve o botão com o rótulo + "▾". */
botaoFiltroPautaHtml(){
  const escolhidos = ControleCargas.state.filtroValoresColuna[ControleCargas.COLUNA_PAUTA];
  const ativo = escolhidos != null;
  const sufixo = ativo ? ` (${escolhidos.size})` : '';
  const ajuda = ativo
    ? 'Filtrando o dia da pauta de cada carteira. Clique para mudar ou limpar.'
    : 'Filtra pelo dia da Defasagem de cada carteira (o do badge Pauta): estado (Unp/Pro/Pub/∅/Agd), Problema Rent, Carga Mensal e "Sem pauta na janela" — as mesmas opções das colunas de data.';
  return `<button type="button" class="th-filter-btn chip-filtro${ativo?' active':''}" data-filtro-coluna="${ControleCargas.COLUNA_PAUTA}" title="${ControleCargas.escAttr(ajuda)}">Status na Pauta${sufixo} ▾</button>`;
},

/* Contexto:
   Sincroniza a classe visual "on" (destacado) dos chips de empresa com o
   estado corrente — chamada depois de qualquer mudança de filtro que não
   redesenha buildFilters() inteiro (evita perder o foco/handlers já
   ligados). Não retorna nada.

   Pseudocódigo:
     1. Para cada chip de empresa, liga "on" só no que corresponde ao filtro
        corrente.
     2. Mantém o aria-pressed de cada chip em dia com a classe — é o que um
        leitor de tela anuncia, e o que sobra quando a cor não basta.
        (O botão do filtro de Pauta não passa por aqui: quem o redesenha é
        buildFilters(), chamado pelo buildMatrix() de depois do OK/Limpar.) */
refreshFilterUI(){
  document.querySelectorAll('.chip[data-company]').forEach(chip=>{
    const ligado = (chip.dataset.company||null) === ControleCargas.state.company;
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
