/* ControleCargas.exportar — o "⬇ Baixar Excel" da matriz.
   ====================================================================
   [REVISADO 2026-09-25, pedido do usuário: "o formato do excel não é XLSX,
   pode corrigir e validar?" + "quero na extensão mais nova e padrão"] Este
   arquivo montava a planilha INTEIRA aqui no navegador, em SpreadsheetML
   2003 (XML com extensão .xls) — escolha da época pra não depender de
   servidor nem de CDN. O Excel abre esse formato, mas avisa que o conteúdo
   não bate com a extensão, e quem lê xlsx de verdade (pandas, Google Sheets,
   visualizador de e-mail) recusa.

   Agora o arquivo é Open XML (.xlsx) escrito pelo servidor com `openpyxl` —
   a mesma biblioteca que o relatório do CLI já usava, então não entrou
   dependência nova (CLAUDE.md §13). A divisão ficou:
     - AQUI: o que entra na planilha — as linhas já filtradas e ordenadas
       como estão na tela, com as anotações (inclusive as ainda não salvas),
       os alertas dia a dia e o comentário vigente de cada dia. Nada disso o
       servidor sabe: os filtros e a ordem vivem só no navegador.
     - excel_matriz_xlsx.py: só a formatação (cor, contorno, congelamento).

   O que sobrou de SpreadsheetML aqui — `xmlEsc()` e `ssCell()` — continua
   servindo a aba "Carteiras Não Cadastradas", que ainda exporta no formato
   antigo (static/js/carteiras_nao_cadastradas/exportar.js).
*/
Object.assign(ControleCargas, {
/* Contexto:
   Escapa texto para uso dentro do XML SpreadsheetML (regras mínimas de XML
   — só &, < e > precisam de entidade nesse formato). Usada por ssCell() ao
   montar cada célula do XML. Retorna string.

   Pseudocódigo:
     1. Trata null/undefined como string vazia.
     2. Escapa & primeiro (senão duplicaria as entidades recém-inseridas),
        depois < e >. */
xmlEsc(s){ return (s==null?'':String(s)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); },

/* Contexto:
   Monta a marcação <Cell> do SpreadsheetML para 1 valor, com estilo e tipo
   opcionais. Usada por buildExcelXml() para cada célula da aba Matriz.
   Retorna string XML.

   Pseudocódigo:
     1. Resolve o atributo de estilo (ss:StyleID), se `opts.style` foi dado.
     2. Resolve o tipo do dado ("Number" se opts.numeric, senão "String").
     3. Monta <Cell ...><Data ...>valor escapado</Data></Cell>. */
ssCell(value, opts){
  opts = opts || {};
  const styleAttr = opts.style ? ` ss:StyleID="${opts.style}"` : '';
  const type = opts.numeric ? 'Number' : 'String';
  return `<Cell${styleAttr}><Data ss:Type="${type}">${ControleCargas.xmlEsc(value)}</Data></Cell>`;
},

/* Contexto:
   Formata a Defasagem (SLA em du) de 1 carteira no mesmo texto da coluna
   "Defasagem" do TemplateCarteiras.xlsx ("D-1", "D-3", "M") — pedido do
   usuário 2026-07-23. Usada por buildAbaMatrizExcel(). Retorna string.

   Pseudocódigo:
     1. Regime mensal (periodicity 'M') -> "M" (o SLA mensal usa outro
        cálculo, ver prazo_regime_mensal em utils/datas.py).
     2. Regime diário -> "D-{lagBizDays}" (ou "—" se, por algum motivo,
        lagBizDays não veio preenchido).
     0. [2026-09-24] Antes de tudo: carência herdada da carteira explodida
        (defasagemHerdadaDe) -> "D-{efetiva} (herdada de X)" — é ela que
        gerou os prazos/cores da Matriz. */
montarDefasagemExcel(r){
  if(r.defasagemHerdadaDe) return `D-${r.lagBizDaysEfetiva} (herdada de ${r.defasagemHerdadaDe})`;
  if(r.periodicity==='M') return 'M';
  return r.lagBizDays!=null ? `D-${r.lagBizDays}` : '—';
},

/* Contexto:
   Junta numa célula só o valor de CADA dia da janela que tiver conteúdo, no
   formato "dd/mm: valor · dd/mm: valor" — a forma de as colunas de auditoria
   deixarem de ser só da data de referência [2026-09-24, pedido do usuário:
   "quero que o Excel traga os alertas desse Range de datas e não só da data
   Referencia"]. Genérica de propósito: recebe a função que sabe ler o valor
   de um dia, então serve pras 5 colunas (Δ Rent, sequência, issues, alertas
   do grid, comentário) sem repetir o laço. Usada por montarPayloadExcel().
   Retorna string (vazia quando nenhum dia tem valor).

   Pseudocódigo:
     1. Para cada data da janela, pede o valor do dia.
     2. Descarta os dias sem valor (a célula não vira uma lista de vazios).
     3. Prefixa cada valor com o dia (dd/mm) e junta com " · ". */
montarColunaPorDiaExcel(window_, valorDoDia){
  return window_
    .map(data=>{
      const valor = valorDoDia(data);
      return valor ? `${ControleCargas.fmtDM(data)}: ${valor}` : '';
    })
    .filter(Boolean)
    .join(' · ');
},

// rótulos legíveis dos overlays da matriz (mesmo vocabulário da legenda,
// ControleCargas.buildLegend em matriz.js) — usados só na exportação Excel,
// pedido do usuário 2026-07-23 ("nossos alertas... Rent, Atras, etc").
OVERLAY_LABELS_EXCEL: {
  div: 'Rent', div_strong: 'Rent forte',
  atraso: 'Atraso', atraso_strong: 'Atraso forte', pauta: 'Pauta do dia',
  seq: 'Sequência', issue: 'Issue',
},

/* Contexto:
   Monta o texto de 1 célula com os overlays da matriz (Rent/Rent forte,
   Atraso/Atraso forte, Sequência, Issue) da carteira NA DATA pedida,
   separados por vírgula — pedido do usuário 2026-07-23 ("nossos alertas
   também... Rent, Atras, etc"). [REMOVIDO 2026-07-23, pedido do usuário] A
   coluna irmã "Alertas/Avisos" (issues do Mongo, outro vocabulário/fonte)
   saiu do relatório — não desejada no Excel. [REVISADO 2026-07-23, pedido
   do usuário: só a data de referência, não a janela inteira; REVERTIDO
   2026-09-24, pedido do usuário: "quero que o Excel traga os alertas desse
   Range de datas e não só da data Referencia" — esta função continua sendo
   POR DATA; quem varre a janela agora é montarColunaPorDiaExcel(), que a
   chama uma vez por dia]. Usada por buildAbaMatrizExcel(). Retorna string
   (vazia quando a carteira não tem overlay nessa data).

   Pseudocódigo:
     1. Acha a célula da data pedida (r.cells).
     2. Sem célula ou sem overlay -> string vazia.
     3. Junta os overlays daquele dia (rótulo via OVERLAY_LABELS_EXCEL) com
        ", ". */
montarOverlaysCsvExcel(r, data){
  const celula = (r.cells||[]).find(c=> c.d===data);
  if(!celula || !celula.ov || !celula.ov.length) return '';
  return celula.ov.map(o=> ControleCargas.OVERLAY_LABELS_EXCEL[o]||o).join(', ');
},

/* Contexto:
   Monta o texto do(s) comentário(s) que COBREM a data pedida numa carteira
   — pedido do usuário 2026-07-23 ("Comentário presente na data"). [REVISADO
   2026-07-23, pedido do usuário — mesma mudança de
   cellCommentSeverity()/comentarios.js: "os alertas devem ser mantidos... e
   não nos dias reais"] Antes usava commentsForTarget() (vigência contra o
   hoje real); agora testa vigência contra a PRÓPRIA DATA pedida
   (isVigente(c, data)), igual à matriz — assim a coluna do Excel bate
   exatamente com o que aparece pintado na célula daquele dia. Considera
   tanto o comentário de LINHA inteira (cellDate null) quanto o específico
   daquela data. Usada por buildAbaMatrizExcel(). Retorna string (vazia
   quando não há comentário cobrindo essa carteira+data).

   Pseudocódigo:
     1. Filtra COMMENTS pelo alvo, e que ou têm cellDate exatamente igual à
        data pedida, ou são de linha inteira (cellDate nulo) — nos dois
        casos, exige validFrom ≤ data ≤ validTo.
     2. Junta o texto de cada um com "; " (normalmente é só 1). */
montarComentarioNaDataExcel(r, data){
  const relevantes = ControleCargas.COMMENTS.filter(c=> c.targetType==='wallet' && c.targetId===r.walletId
                                 && (c.cellDate===data || c.cellDate===null)
                                 && ControleCargas.isVigente(c, data));
  if(!relevantes.length) return '';
  return relevantes.map(c=> c.text).join('; ');
},

/* Contexto:
   Monta o corpo do pedido de exportação: o que está NA TELA, já filtrado e
   ordenado, com cada valor pronto pro servidor só formatar. Chamada por
   exportExcel(). Retorna o objeto que vira JSON.

   Pseudocódigo:
     1. Cabeçalho: quando foi gerado, a janela e a data de referência.
     2. Por carteira (na ordem da tela): identidade + defasagem + a
        severidade do comentário vigente na data de referência (o servidor
        usa pra tingir as 4 primeiras colunas).
     3. Por dia da janela: a sigla que a célula mostra, o estado (define a
        cor) e se aquele dia é Pauta (define o contorno).
     4. As 7 colunas de auditoria: Responsável/Comentário sobre atuação (da
        data de referência) + as 5 que cobrem a janela inteira, dia a dia
        (montarColunaPorDiaExcel). */
montarPayloadExcel(){
  const meta = ControleCargas.SNAPSHOT.meta;
  const janela = meta.window;
  const refDate = meta.referenceDate;
  const rotuloJanela = `${ControleCargas.fmtDM(janela[0])}–${ControleCargas.fmtDM(janela[janela.length-1])}`;

  const linhas = ControleCargas.sortedRows(ControleCargas.SNAPSHOT.wallets, true).map(r=>{
    const cmap = ControleCargas.cellByDate(r);
    const ttDoDia = (d)=> ((cmap[d] || {}).tt) || {};
    const anotacao = ControleCargas.annotationAtual('wallet', r.walletId);
    return {
      company: r.company, carteira: r.name, walletId: r.walletId, instituicao: r.institution,
      modeloCarga: r.loadModel, periodicidade: r.monthly ? 'Mensal' : 'Diário',
      defasagem: ControleCargas.montarDefasagemExcel(r),
      severidadeComentario: ControleCargas.cellCommentSeverity('wallet', r.walletId, refDate),
      dias: janela.map(d=>{
        const c = cmap[d];
        const estado = c ? c.s : 'notcov';
        const st = ControleCargas.STATES[estado];
        return { letra: st ? st.letter : '—', estado,
                 pauta: !!(c && (c.ov||[]).includes('pauta')) };
      }),
      responsavel: anotacao.responsavel,
      comentarioAtuacao: anotacao.comentarioAtuacao,
      divergencia: ControleCargas.montarColunaPorDiaExcel(janela, d=>{
        const div = ttDoDia(d).div;
        return div ? div.bp.toFixed(1) : '';
      }),
      sequencia: ControleCargas.montarColunaPorDiaExcel(janela, d=> ttDoDia(d).seq ? 'Sim' : ''),
      issues: ControleCargas.montarColunaPorDiaExcel(janela, d=> ttDoDia(d).issues || ''),
      alertas: ControleCargas.montarColunaPorDiaExcel(janela, d=> ControleCargas.montarOverlaysCsvExcel(r, d)),
      comentarios: ControleCargas.montarColunaPorDiaExcel(janela, d=> ControleCargas.montarComentarioNaDataExcel(r, d)),
    };
  });

  return { geradoEm: ControleCargas.formatarDataHoraAgora(), janela, referenceDate: refDate,
           rotuloJanela, linhas };
},

/* Contexto:
   Baixa o relatório .xlsx — handler do botão "⬇ Baixar Excel". Manda o que
   está na tela pro servidor (POST /api/exportar-excel) e salva o arquivo que
   volta. Retorna Promise (resolvida sempre; erro vira mensagem na tela).

   O arquivo é montado NO SERVIDOR desde 2026-09-25: antes era gerado aqui em
   SpreadsheetML 2003, que não é xlsx de verdade (ver o cabeçalho deste
   arquivo).

   Pseudocódigo:
     1. Desabilita o botão e avisa que está gerando (planilha de ~1000 linhas
        leva alguns segundos entre montar o corpo, subir e voltar).
     2. POST com o payload; resposta não-ok vira erro com a mensagem do
        backend.
     3. Salva o blob recebido com o nome que o servidor mandou no
        Content-Disposition (ou um nome padrão).
     4. Reabilita o botão em qualquer caso. */
exportExcel(){
  const btn = document.getElementById('btn-export');
  const msgEl = document.getElementById('grid-note');
  const rotuloOriginal = '⬇ Baixar Excel';
  if(btn){ btn.disabled = true; btn.textContent = 'Gerando Excel...'; }

  return fetch('/api/exportar-excel', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(ControleCargas.montarPayloadExcel()),
  })
    .then(async r=>{
      if(!r.ok){
        const erro = await r.json().catch(()=>({}));
        throw new Error(erro.error || ('http '+r.status));
      }
      return { blob: await r.blob(), nome: ControleCargas.nomeArquivoDaResposta(r) };
    })
    .then(({blob, nome})=>{
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = nome;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    })
    .catch(err=>{
      if(msgEl) msgEl.textContent = 'Erro ao gerar o Excel: ' + err.message;
    })
    .finally(()=>{
      if(btn){ btn.disabled = false; btn.textContent = rotuloOriginal; }
    });
},

/* Contexto:
   Lê o nome do arquivo no cabeçalho Content-Disposition da resposta, pra o
   download sair com o nome que o SERVIDOR escolheu (inclui a data). Chamada
   por exportExcel(). Retorna string (nome padrão quando o cabeçalho não vem,
   ex.: proxy que o remove).

   Pseudocódigo:
     1. Sem cabeçalho -> nome padrão.
     2. Extrai o trecho filename="..." e devolve o que estiver entre aspas. */
nomeArquivoDaResposta(resposta){
  const cabecalho = resposta.headers.get('Content-Disposition') || '';
  const achado = /filename="?([^";]+)"?/i.exec(cabecalho);
  return achado ? achado[1] : 'ControleCargas_relatorio.xlsx';
},
});
