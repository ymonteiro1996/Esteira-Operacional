/* ControleCargas.filtros_cargas — filtros da aba "Controle de Cargas".
   [2026-09-28, pedido do usuário: "Cabeçalhos filtráveis" + "Sinalização de Pauta dia igual Carteira,
   com filtro de Pauta também" + "uma coluna filtrável por SLA"]

   - ▾ em TODO cabeçalho (Company, Instituição, Modelo, D/M, SLA, Carteiras, cada dia, Responsável e
     Comentário sobre atuação), estilo Excel e em cascata: a lista de cada coluna mostra o que sobra
     pelos OUTROS filtros. Usa o popover genérico utils/filtro_popover.js (o mesmo da aba Carteiras Não
     Cadastradas) — o filtro_cabecalho.js da Matriz é amarrado às linhas de carteira.
   - "Status na Pauta ▾" (toolbar da aba): coluna VIRTUAL, como a da aba Carteiras — o nível da célula
     que está em Pauta, ou "Sem pauta na janela".
   Entre colunas vale E; dentro de uma coluna, OU. O chip Todas/Diárias/Mensais continua somando.

   Parte do objeto único ControleCargas (ver state.js). */
Object.assign(ControleCargas, {

// Rótulo curto de cada nível (valores do filtro das colunas de dia e do Status na Pauta).
ROTULO_NIVEL_CARGA: {
  ok: 'Efetivada', parcial: 'Parcial', falha: 'Não efetivada', falha_prolongada: 'Falha prolongada',
  aguardando: 'Aguardando', nao_avaliada: 'Não avaliada',
},
PREFIXO_FILTRO_DIA_CARGA: 'dia:',
COLUNA_PAUTA_CARGA: 'statusPauta',
SEM_PAUTA_CARGA: 'Sem pauta na janela',
VAZIO_FILTRO_CARGA: '(vazio)',

/* Contexto: texto de 1 linha numa coluna filtrável — é o que o filtro compara e o que a lista do
   popover mostra. Retorna string.

   Pseudocódigo:
     1. Colunas de dia (dia:<data>): rótulo do nível naquele dia (+ " · Pauta" quando em pauta).
     2. Status na Pauta: rótulo do nível da célula em pauta, ou "Sem pauta na janela".
     3. Responsável / Comentário: a anotação da data de referência (vazio = "(vazio)").
     4. Demais: o campo da linha. */
textoColunaCarga(linha, chave){
  const nivelDe = (c)=> ControleCargas.ROTULO_NIVEL_CARGA[c.nivel] || c.nivel;
  if(chave.startsWith(ControleCargas.PREFIXO_FILTRO_DIA_CARGA)){
    const c = linha.cells.find(x=> x.d === chave.slice(ControleCargas.PREFIXO_FILTRO_DIA_CARGA.length));
    return c ? nivelDe(c) + (c.pauta ? ' · Pauta' : '') : '—';
  }
  if(chave === ControleCargas.COLUNA_PAUTA_CARGA){
    const c = [...linha.cells].reverse().find(x=> x.pauta);
    return c ? nivelDe(c) : ControleCargas.SEM_PAUTA_CARGA;
  }
  if(chave === 'responsavel' || chave === 'comentarioAtuacao'){
    const a = ControleCargas.annotationAtual('carga', linha.key, ControleCargas.SNAPSHOT.meta.referenceDate);
    return a[chave] || ControleCargas.VAZIO_FILTRO_CARGA;
  }
  if(chave === 'periodicity') return linha.periodicity === 'M' ? 'Mensal' : 'Diária';
  if(chave === 'loadModel') return linha.loadModel + (linha.isManualLoad ? ' (manual)' : '');
  return String(linha[chave] == null ? '—' : linha[chave]);
},

/* Contexto: aplica os filtros de coluna (e o Status na Pauta, que mora no mesmo dicionário).
   `colunaIgnorada` monta a cascata do popover daquela coluna. Retorna array.

   Pseudocódigo: 1. Para cada coluna com Set ativo (exceto a ignorada), o texto precisa estar nele. */
aplicarFiltrosColunaCargas(linhas, colunaIgnorada){
  const ativos = Object.entries(ControleCargas.state.filtrosColunaCargas || {})
    .filter(([chave, aceitos])=> aceitos && chave !== colunaIgnorada);
  if(!ativos.length) return linhas;
  return linhas.filter(l=> ativos.every(([chave, aceitos])=> aceitos.has(ControleCargas.textoColunaCarga(l, chave))));
},

/* Contexto: valores distintos de 1 coluna com a contagem, em cascata (chip D/M + os outros filtros).
   Níveis saem na ordem de gravidade; números em ordem numérica; o resto alfabético. Retorna
   [{valor, label, contagem}].

   Pseudocódigo: 1. Conta os textos das linhas que passam nos outros filtros. 2. Ordena. */
valoresFiltroCargas(chave){
  const base = ControleCargas.aplicarFiltrosColunaCargas(
    ControleCargas.filtrarLinhasCargas(ControleCargas.linhasCargas() || []), chave);
  const contagem = new Map();
  base.forEach(l=>{ const t = ControleCargas.textoColunaCarga(l, chave); contagem.set(t, (contagem.get(t) || 0) + 1); });
  const ordemNivel = ['Falha prolongada', 'Não efetivada', 'Parcial', 'Aguardando', 'Efetivada', 'Não avaliada', ControleCargas.SEM_PAUTA_CARGA];
  const peso = (t)=>{ const i = ordemNivel.indexOf(t.replace(' · Pauta', '')); return i < 0 ? 99 : i * 2 + (t.endsWith(' · Pauta') ? 0 : 1); };
  return [...contagem.entries()]
    .sort(([a], [b])=> (peso(a) - peso(b)) || ((Number(a) - Number(b)) || a.localeCompare(b, 'pt-BR')))
    .map(([valor, total])=> ({valor, label: valor, contagem: total}));
},

/* Contexto: botão ▾ de 1 coluna (ativo quando filtrado). Retorna string HTML. */
botaoFiltroCargasHtml(chave, rotulo){
  const ativo = (ControleCargas.state.filtrosColunaCargas || {})[chave] ? ' active' : '';
  return `<button type="button" class="th-filter-btn${ativo}" data-cg-coluna="${ControleCargas.escAttr(chave)}" title="Filtrar ${ControleCargas.escAttr(rotulo)}">▾</button>`;
},

/* Contexto: abre o popover de 1 coluna; ao aplicar guarda o Set (ou limpa) e redesenha. Não retorna
   nada. */
abrirFiltroColunaCargas(chave, botao){
  if(!ControleCargas.linhasCargas()) return;
  const filtros = ControleCargas.state.filtrosColunaCargas = ControleCargas.state.filtrosColunaCargas || {};
  FiltroPopover.alternar({
    ancora: botao,
    valores: ControleCargas.valoresFiltroCargas(chave),
    marcados: filtros[chave] || null,
    aoAplicar: (selecao)=>{
      if(selecao) filtros[chave] = selecao; else delete filtros[chave];
      ControleCargas.buildCargasMatrix();
    },
  });
},

/* Contexto: rótulo do botão "Status na Pauta" (conta os valores marcados) + estado ativo. Não
   retorna nada. */
atualizarBotaoPautaCargas(){
  const botao = document.getElementById('cargas-filtro-pauta');
  if(!botao) return;
  const sel = (ControleCargas.state.filtrosColunaCargas || {})[ControleCargas.COLUNA_PAUTA_CARGA];
  botao.classList.toggle('active', !!sel);
  botao.setAttribute('aria-pressed', sel ? 'true' : 'false');
  botao.textContent = sel ? `Status na Pauta (${sel.size}) ▾` : 'Status na Pauta ▾';
},

/* Contexto: tira filtros de dias que saíram da janela (depois de um Atualizar com outra faixa).
   Não retorna nada. */
podarFiltrosDiaCargas(janela){
  const filtros = ControleCargas.state.filtrosColunaCargas || {};
  Object.keys(filtros).forEach(chave=>{
    if(chave.startsWith(ControleCargas.PREFIXO_FILTRO_DIA_CARGA)
       && !janela.includes(chave.slice(ControleCargas.PREFIXO_FILTRO_DIA_CARGA.length))) delete filtros[chave];
  });
},

/* Contexto: liga os ▾ (delegado no painel — o cabeçalho é redesenhado) e o "Limpar filtros". Chamada
   1x no fim deste arquivo. Não retorna nada.

   Pseudocódigo: 1. Clique num [data-cg-coluna] abre o popover dela. 2. Limpar zera tudo. */
wireFiltrosCargas(){
  const painel = document.getElementById('panel-cargas');
  if(!painel) return;
  painel.addEventListener('click', (ev)=>{
    const botao = ev.target.closest('[data-cg-coluna]');
    if(!botao) return;
    ev.stopPropagation();
    ControleCargas.abrirFiltroColunaCargas(botao.dataset.cgColuna, botao);
  });
  const limpar = document.getElementById('cargas-limpar-filtros');
  if(limpar) limpar.addEventListener('click', ()=>{
    ControleCargas.state.filtrosColunaCargas = {};
    ControleCargas.state.filtroPeriodicidadeCargas = 'todas';
    FiltroPopover.fechar();
    ControleCargas.buildCargasMatrix();
  });
},
});

ControleCargas.wireFiltrosCargas();
