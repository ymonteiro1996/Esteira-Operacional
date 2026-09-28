/* ControleCargas.matriz_cargas — aba "Controle de Cargas" (CC-03, fase 3A, somente leitura).
   [2026-09-27, pedido do usuário: "Controlar as cargas por Company – Instituição – Modelo de Carga –
   Mensal/Diário ... mostrar primeiro os problemas com mais carteiras afetadas ... comentários
   temporários e diários, com responsável, no mesmo layout de Carteiras" — aba nova aprovada pelo
   usuário (confirmação de arquitetura 2 do docs/ESCOPO_MUDANCAS_2026-09.md)]

   Os números vêm prontos do servidor em SNAPSHOT.cargas (matriz_cargas.py — a métrica precisa do
   calendário ANBIMA). Aqui só se desenha:
     - linha = Company | Instituição | Modelo | D/M; célula = cobertura do dia + quantas faltam;
     - mensais com contorno tracejado; chips Todas / Diárias / Mensais;
     - clique em 2 tempos, igual à aba Carteiras: o 1º seleciona a célula (Responsável/Comentário
       sobre atuação da linha passam a editar aquele dia — selecao_celula.js), o 2º abre o painel
       com as carteiras faltantes e os comentários temporários (targetType 'carga').

   Parte do objeto único ControleCargas (ver state.js) — 1 arquivo por funcionalidade (CLAUDE.md §4). */
Object.assign(ControleCargas, {

// Texto, classe de cor e descrição de cada nível (a legenda da aba lê daqui).
NIVEIS_CARGA: {
  ok:               {cls:'company-ok',      nome:'Efetivada — todas as carteiras ativas com carga'},
  parcial:          {cls:'company-att',     nome:'Parcial — 1 faltante, ou cobertura ≥ 95%'},
  falha:            {cls:'company-crit',    nome:'Não efetivada — faltantes acima do parcial'},
  falha_prolongada: {cls:'company-crit cg-prolongada', nome:'Falha prolongada — nenhuma ativa, ou mais da metade das esperadas sem carga há dias'},
  aguardando:       {cls:'s-g1',            nome:'Aguardando — sem faltante vencido, ainda há carteira no prazo'},
  nao_avaliada:     {cls:'company-neutral', nome:'Não avaliada — mensal fora do fechamento do mês'},
},

/* Contexto: linhas do Controle de Cargas no snapshot em tela, ou null quando o snapshot é de antes
   desta aba (arquivo antigo em disco). Retorna array/null.

   Pseudocódigo: 1. SNAPSHOT.cargas.linhas quando existir. */
linhasCargas(){
  const cargas = ControleCargas.SNAPSHOT && ControleCargas.SNAPSHOT.cargas;
  return cargas && Array.isArray(cargas.linhas) ? cargas.linhas : null;
},

/* Contexto: aplica o chip Todas / Diárias / Mensais. Retorna array (nova, na mesma ordem).

   Pseudocódigo: 1. 'todas' devolve tudo; 'D'/'M' filtram pela periodicidade da chave. */
filtrarLinhasCargas(linhas){
  const filtro = ControleCargas.state.filtroPeriodicidadeCargas || 'todas';
  return filtro === 'todas' ? linhas.slice() : linhas.filter(l=> l.periodicity === filtro);
},

/* Contexto: texto curto dentro da célula. Retorna string HTML.

   Pseudocódigo:
     1. ok -> ✓; aguardando -> ⏳; não avaliada -> —; falha prolongada -> "parado".
     2. parcial/falha -> "NN%" (floor, para 99,6% não virar 100%) e, embaixo, "−N". */
conteudoCelulaCarga(c){
  if(c.nivel === 'ok') return '✓';
  if(c.nivel === 'aguardando') return '⏳';
  if(c.nivel === 'nao_avaliada') return '—';
  if(c.nivel === 'falha_prolongada') return '<span class="cg-num">parado</span>';
  const pct = c.cobertura == null ? '—' : `${Math.floor(c.cobertura * 100)}%`;
  return `<span class="cg-num">${pct}</span><span class="cg-falta">−${c.nFaltantes}</span>`;
},

/* Contexto: classes do anel de Pauta de 1 célula de carga — as mesmas da aba Carteiras: azul
   (.ov-pauta) quando alguma carteira da linha está no dia da Defasagem, vermelho (.ov-seq por cima)
   quando alguma delas está com o D-1 sem processada (CC-05) [2026-09-28]. Retorna string. */
classesPautaCarga(c){
  if(!c.pauta) return '';
  return 'ov-pauta' + (c.pautaSemD1 ? ' ov-seq' : '');
},

/* Contexto: title (hover) de 1 célula, com as contagens que a métrica usou. Retorna string.

   Pseudocódigo: 1. Nome do nível + dia; 2. contagens (com carga, faltantes, aguardando,
   onboarding, inativas) quando o dia foi avaliado. */
tituloCelulaCarga(linha, c){
  const nivel = ControleCargas.NIVEIS_CARGA[c.nivel] || {nome:c.nivel};
  let texto = `${linha.institution} · ${linha.loadModel} · ${ControleCargas.weekdayAbbrev(c.d)} ${c.d}\n${nivel.nome}`;
  if(c.nivel !== 'nao_avaliada'){
    texto += `\nCom carga: ${c.comCarga} · Faltantes: ${c.nFaltantes} · Aguardando: ${c.nAguardando}`
      + ` · Onboarding: ${c.nOnboarding} · Inativas (fora do cálculo): ${c.nInativas}`;
  }
  if(c.pauta) texto += `\nPauta: ${c.nPauta} carteira(s) no dia da Defasagem${c.pautaSemD1 ? ' — alguma com o D-1 sem processada' : ''}`;
  return texto + '\n1º clique seleciona o dia · 2º clique abre as carteiras';
},

/* Contexto: <td> de 1 célula da matriz de cargas, com os marcadores de comentário e de anotação
   (os mesmos de Carteiras). Retorna string HTML.

   Pseudocódigo:
     1. Classe de cor do nível + anel de Pauta + seleção.
     2. Badge "Pauta" (igual à aba Carteiras), balão do comentário vigente no dia (cmt-dot) e ponto
        azul de anotação (atuacao-dot).
     3. data-view="cargas" + data-rid/data-date: é por eles que a seleção acha a célula. */
celulaCargaHtml(linha, c){
  const nivel = ControleCargas.NIVEIS_CARGA[c.nivel] || ControleCargas.NIVEIS_CARGA.nao_avaliada;
  const sev = ControleCargas.cellCommentSeverity('carga', linha.key, c.d);
  const marcadores = (sev ? `<span class="cmt-dot ${sev}"></span>` : '')
    + (ControleCargas.anotacaoExisteNaData('carga', linha.key, c.d) ? '<span class="atuacao-dot"></span>' : '');
  const selecionada = ControleCargas.celulaEstaSelecionada('cargas', linha.key, c.d) ? ' celula-selecionada' : '';
  const badgePauta = c.pauta ? ControleCargas.atrasoBadgeHtml(['pauta']) : '';
  return `<td><div class="cell cg-cell ${nivel.cls} ${ControleCargas.classesPautaCarga(c)}${selecionada}" tabindex="0" data-view="cargas"`
    + ` data-rid="${ControleCargas.escAttr(linha.key)}" data-date="${c.d}"`
    + ` title="${ControleCargas.escAttr(ControleCargas.tituloCelulaCarga(linha, c))}">`
    + `${ControleCargas.conteudoCelulaCarga(c)}${badgePauta}${marcadores}</div></td>`;
},

/* Contexto: <tr> de 1 chave. Retorna string HTML.

   Pseudocódigo:
     1. Colunas fixas: Company, Instituição, Modelo (com "manual" quando é o caso), D/M, SLA,
        Carteiras.
     2. Uma célula por dia; 3. Responsável / Comentário sobre atuação (anotacoes.js, 'carga'). */
linhaCargaHtml(linha, window_){
  const porData = Object.fromEntries(linha.cells.map(c=> [c.d, c]));
  const sevLinha = ControleCargas.rowCommentSeverity('carga', linha.key);
  const classe = linha.periodicity === 'M' ? ' class="cg-mensal"' : '';
  let html = `<tr data-rid="${ControleCargas.escAttr(linha.key)}"${classe}>`
    + `<td class="col-company">${ControleCargas.esc(linha.company)}</td>`
    + `<td class="col-name"><span class="cg-inst">${ControleCargas.esc(linha.institution)}</span>`
    + (sevLinha ? `<span class="row-comment-badge ${sevLinha}" title="${ControleCargas.escAttr(ControleCargas.rowCommentTexts('carga', linha.key))}"></span>` : '')
    + `</td><td class="col-summary">${ControleCargas.esc(linha.loadModel)}${linha.isManualLoad ? ' <span class="went">manual</span>' : ''}</td>`
    + `<td class="col-summary" title="${linha.periodicity === 'M' ? 'Mensal' : 'Diária'}">${linha.periodicity}</td>`
    + `<td class="col-summary cg-sla">${ControleCargas.esc(linha.sla || '—')}</td>`
    + `<td class="col-summary">${linha.totalWallets}</td>`;
  window_.forEach(d=>{
    const c = porData[d];
    html += c ? ControleCargas.celulaCargaHtml(linha, c) : '<td><div class="cell company-neutral">—</div></td>';
  });
  return html + ControleCargas.colunasAnotacaoHtml('carga', linha.key) + '</tr>';
},

/* Contexto: <thead> da matriz de cargas (mesmo destaque de referência das outras matrizes). Retorna
   string HTML.
   [2026-09-28, pedido do usuário: "replicar a lógica de D-1, D-2 da Carteiras"] Cada data ganha o
   mesmo rótulo "D-n" da aba Carteiras — reaproveita rotuloDistanciaHojeHtml (matriz.js), que lê
   meta.diasUteisAteHoje (calendário ANBIMA, relativo ao Data D0) — em vez de recalcular aqui.

   [2026-09-28, pedido do usuário: "Cabeçalhos filtráveis" + coluna SLA] Todo cabeçalho ganha o ▾
   (filtros_cargas.js); a coluna SLA entra depois de D/M.

   Pseudocódigo: 1. 6 colunas fixas com ▾; 2. um <th> por dia (rótulo D-n + data; ref marcada) com ▾;
   3. as 2 de anotação com ▾. */
cabecalhoCargasHtml(window_, refDate){
  const f = (chave, rotulo)=> ControleCargas.botaoFiltroCargasHtml(chave, rotulo);
  let html = `<thead><tr><th class="hdr-companyname">Company ${f('company', 'Company')}</th>`
    + `<th>Instituição ${f('institution', 'Instituição')}</th><th>Modelo ${f('loadModel', 'Modelo')}</th>`
    + `<th title="D = diária · M = mensal">D/M ${f('periodicity', 'D/M')}</th>`
    + `<th title="Diária: Defasagem efetiva do Template (D-n). Mensal: fim do mês + du Recebimento PDF + du Upload.">SLA ${f('sla', 'SLA')}</th>`
    + `<th class="hdr-summary">Carteiras ${f('totalWallets', 'Carteiras')}</th>`;
  window_.forEach(d=>{
    const isRef = d === refDate;
    const botao = f(ControleCargas.PREFIXO_FILTRO_DIA_CARGA + d, ControleCargas.fmtDM(d));
    html += `<th class="${isRef ? 'ref' : ''}">${ControleCargas.rotuloDistanciaHojeHtml(d)}${ControleCargas.fmtDM(d)}`
      + (isRef ? `<span class="refline">▾ ref ${botao}</span>` : `<br><span style="font-weight:400">${ControleCargas.weekdayAbbrev(d)}</span>${botao}`)
      + '</th>';
  });
  return html + `<th class="col-anotacao">Responsável ${f('responsavel', 'Responsável')}</th>`
    + `<th class="col-anotacao">Comentário sobre atuação ${f('comentarioAtuacao', 'Comentário sobre atuação')}</th></tr></thead>`;
},

/* Contexto: (re)desenha a aba. Chamada por switchTab('cargas'), pelo Atualizar e pelo salvar de
   comentário/anotação (redesenharVisaoAtual, index.js). Não retorna nada.

   Pseudocódigo:
     1. Snapshot sem SNAPSHOT.cargas (arquivo antigo) -> convite para clicar em Atualizar.
     2. Aplica o chip D/M e os filtros de coluna / Status na Pauta (filtros_cargas.js), monta
        cabeçalho + corpo.
     3. Contagem, chips, religa cliques e inputs de anotação. */
buildCargasMatrix(){
  const tabela = document.getElementById('cargas-matrix');
  if(!tabela || !ControleCargas.SNAPSHOT) return;
  const linhas = ControleCargas.linhasCargas();
  const meta = ControleCargas.SNAPSHOT.meta;
  ControleCargas.atualizarChipsPeriodicidadeCargas();
  if(!linhas){
    tabela.innerHTML = '';
    document.getElementById('cargas-count').textContent = '';
    document.getElementById('cargas-note').textContent = 'Este snapshot é de antes do Controle de Cargas — clique em ↻ Atualizar para montar a matriz.';
    return;
  }
  ControleCargas.podarFiltrosDiaCargas(meta.window);
  ControleCargas.atualizarBotaoPautaCargas();
  const visiveis = ControleCargas.aplicarFiltrosColunaCargas(ControleCargas.filtrarLinhasCargas(linhas));
  tabela.innerHTML = ControleCargas.cabecalhoCargasHtml(meta.window, meta.referenceDate)
    + '<tbody>' + visiveis.map(l=> ControleCargas.linhaCargaHtml(l, meta.window)).join('') + '</tbody>';

  const comProblema = visiveis.filter(l=> l.faltantesRef > 0).length;
  const filtrando = visiveis.length !== linhas.length;
  document.getElementById('cargas-count').textContent =
    `${visiveis.length}${filtrando ? ' de ' + linhas.length : ''} carga${visiveis.length === 1 ? '' : 's'} · ${comProblema} com carteira faltando na referência`;
  const p = (ControleCargas.SNAPSHOT.cargas.parametros) || {};
  document.getElementById('cargas-note').textContent =
    `Cobertura = carteiras com carga ÷ (com carga + faltantes vencidas). Inativa (fora do cálculo) = sem carga nos ${p.diasAtividadeDu} du antes do dia; `
    + `nova (< ${p.diasCarteiraNovaDu} du) conta sempre e aparece como onboarding até a 1ª carga. Mensais só no último dia útil do mês. `
    + 'Ordem: mais carteiras faltando na referência primeiro. Limite: a API devolve o estado ATUAL — uma carga que chegou atrasada conta como presente.';
  ControleCargas.wireCliquesCargas();
  tabela.querySelectorAll('.anot-input').forEach(ControleCargas.ligarInputAnotacao);
},

/* Contexto: liga o clique em 2 tempos das células da aba (mesmo gesto da aba Carteiras). Não
   retorna nada.

   Pseudocódigo: 1. Célula não selecionada -> seleciona; já selecionada -> abre o painel. */
wireCliquesCargas(){
  document.querySelectorAll('#cargas-matrix .cg-cell').forEach(cell=>{
    cell.addEventListener('click', ()=>{
      const rid = cell.dataset.rid, data = cell.dataset.date;
      if(!ControleCargas.celulaEstaSelecionada('cargas', rid, data)){
        ControleCargas.selecionarCelula('cargas', rid, data);
        return;
      }
      ControleCargas.buildCargaPanel(rid, data);
    });
  });
},

/* Contexto: marca o chip D/M ativo (aria-pressed também). Não retorna nada.

   Pseudocódigo: 1. Cada botão [data-periodicidade] fica ativo se for o filtro corrente. */
atualizarChipsPeriodicidadeCargas(){
  const filtro = ControleCargas.state.filtroPeriodicidadeCargas || 'todas';
  document.querySelectorAll('#cargas-periodicidade [data-periodicidade]').forEach(b=>{
    const ativo = b.dataset.periodicidade === filtro;
    b.classList.toggle('active', ativo);
    b.setAttribute('aria-pressed', ativo ? 'true' : 'false');
  });
},

/* Contexto: liga os chips Todas / Diárias / Mensais — 1x no fim deste arquivo. Não retorna nada.

   Pseudocódigo: 1. Clique grava o filtro e redesenha. */
wireFiltroPeriodicidadeCargas(){
  document.querySelectorAll('#cargas-periodicidade [data-periodicidade]').forEach(b=>{
    b.addEventListener('click', ()=>{
      ControleCargas.state.filtroPeriodicidadeCargas = b.dataset.periodicidade;
      ControleCargas.buildCargasMatrix();
    });
  });
},

// Painel da carga (2º clique na célula): static/js/controle_cargas/painel_carga.js [2026-09-28].

// ═══ Troca de aba ═══

/* Contexto: liga a aba "Controle de Cargas" ao switchTab() e às 3 abas de painel próprio (Demandas,
   Anomalias, Carteiras Não Cadastradas), que trocam de aba por listeners aditivos e não conhecem
   esta — em vez de editar os 3 arquivos, a aba nova registra aqui os listeners que faltam. Chamada
   1x no fim deste arquivo. Não retorna nada.

   Pseudocódigo:
     1. Clique em tab-cargas: esconde os painéis das 3 abas aditivas, desmarca os botões delas e
        chama switchTab('cargas') (que cuida dos painéis da grade e do #toolbar3).
     2. Clique numa das 3 abas aditivas: esconde #panel-cargas e desmarca tab-cargas (elas já
        escondem os painéis da grade, mas não sabem deste). */
wireAbaCargas(){
  const tab = document.getElementById('tab-cargas');
  const painel = document.getElementById('panel-cargas');
  if(!tab || !painel) return;
  const abasAditivas = [['tab-demandas', 'panel-demandas'], ['tab-anomalias', 'panel-anomalias'],
    ['tab-nao-cadastradas', 'panel-nao-cadastradas']];
  tab.addEventListener('click', ()=>{
    if(!ControleCargas.SNAPSHOT) return;   // snapshot ainda carregando: as outras abas também esperam
    abasAditivas.forEach(([idTab, idPainel])=>{
      const botao = document.getElementById(idTab), outro = document.getElementById(idPainel);
      if(botao) botao.classList.remove('active');
      if(outro) outro.style.display = 'none';
    });
    ControleCargas.switchTab('cargas');
  });
  abasAditivas.forEach(([idTab])=>{
    const botao = document.getElementById(idTab);
    if(!botao) return;
    botao.addEventListener('click', ()=>{
      painel.style.display = 'none';
      tab.classList.remove('active');
    });
  });
},
});

ControleCargas.wireAbaCargas();
ControleCargas.wireFiltroPeriodicidadeCargas();
// Salvar das anotações desta aba: mesmo lote (PENDING_ANNOTATIONS) do botão da grade principal.
(()=>{
  const btn = document.getElementById('btn-salvar-anotacoes-cargas');
  if(btn) btn.addEventListener('click', ()=> ControleCargas.salvarAnotacoes());
})();
