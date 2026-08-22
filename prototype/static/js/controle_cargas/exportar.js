/* ControleCargas.exportar — exportação Excel client-side (SpreadsheetML 2003, sem CDN/servidor).
   Parte do objeto único ControleCargas (ver state.js). Gerado a partir da
   refatoração de index_template.html (CLAUDE.md §4, "Divisão clara das
   páginas" — pasta static/js/controle_cargas/, 1 arquivo por funcionalidade).
*/
Object.assign(ControleCargas, {
// ─────────────────────────────────────────────────────────────────────────
// Exportação Excel — client-side, SpreadsheetML 2003 (sem CDN, sem servidor)
// ─────────────────────────────────────────────────────────────────────────
// [rodada 7, 2026-07-18] fundo = só estágio (wu amarelo-pálido / wc verde-
// menta) — originalmente mesmos hex das CSS vars --state-* do modo claro.
// [REVISADO 2026-07-28, pedido do usuário: "no excel o verde de fundo da
// Pro está mais escuro que o verde da Pub" — Pub (p/cD) e Pro-aguardando-
// publicação (wc) tiveram seus tons TROCADOS entre si SÓ AQUI (mesmos 3 hex
// de sempre — Unp/Pro/Pub — só a atribuição mudou), pra Pub virar o verde
// mais escuro/saturado no Excel. IMPORTANTE: o usuário confirmou que a TELA
// já estava certa e não deveria mudar ("a tela deveria ser mantida o que já
// estava, estava certo. somente no excel estava errado") — por isso esta
// troca NÃO foi replicada em controle_cargas.css (--state-p-bg/--state-pro-
// bg continuam com os valores originais). Excel e tela agora usam esquemas
// de cor DIFERENTES de propósito para Pro/Pub — mantida em sincronia só com
// excel_report.py (_PREENCHIMENTO_XLSX), o outro gerador de Excel.]
XML_BG: {
  p:'#8AE6D2', cD:'#8AE6D2', wu:'#FDE68A', wc:'#DCFCE7',
  miss:'#FEE2E2', wait:'#F3F4F6', notcov:'#F9FAFB',
},

XML_FG: {
  p:'#134E4A', cD:'#134E4A', wu:'#78350F', wc:'#15803D',
  miss:'#B91C1C', wait:'#9CA3AF', notcov:'#D1D5DB',
},

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

// [refatoração 2026-07-20] buildExcelXml() virou uma orquestradora fina;
// estilos, aba Matriz e o template do Workbook ganharam sua própria função
// abaixo. LÓGICA/XML idênticos, só a organização mudou (CLAUDE.md §3).
// [REVISADO 2026-07-23, pedido do usuário: "quero tudo na aba matriz"] A
// antiga aba "Detalhe" foi eliminada — só existe a aba Matriz agora.

// Cores do balão de comentário (mesmo hex de .cmt-dot/.row-comment-badge,
// controle_cargas.css) — usadas pra colorir a identidade da linha no Excel
// quando há comentário vigente na data de referência [2026-07-27, pedido do
// usuário: "as carteiras com comentário na data, deve se parecer a mesma
// cor na linha no excel"]. Fundo pastel + letra escura, mesmo padrão de
// XML_BG/XML_FG (nunca a cor "sólida" do dot, ilegível como fundo de texto).
XML_BG_COMENTARIO: { red:'#FEE2E2', yellow:'#FEF3C7', green:'#DCFCE7' },
XML_FG_COMENTARIO: { red:'#B91C1C', yellow:'#92400E', green:'#15803D' },

/* Contexto:
   Monta o bloco <Styles> do XML SpreadsheetML: 1 estilo por estado da
   matriz (fundo/letra do estágio) + 1 por severidade de comentário +
   cabeçalho. [REVISADO 2026-07-23, pedido do usuário: "remover cores das
   colunas A até D" — os 4 estilos de tier (usados até então pra colorir
   Company/Carteira/WalletID/Instituição) foram removidos junto com a
   coluna Tier, que também saiu do relatório]. [REVISADO 2026-07-27, pedido
   do usuário] Essas colunas voltaram a ganhar cor, mas agora pela
   severidade do comentário vigente na data de referência (mesma cor do
   balão da tela), não mais pelo tier (aposentado). Chamada 1x por
   buildExcelXml(). Retorna string XML.

   Pseudocódigo:
     1. Estilo de cabeçalho (negrito + fundo cinza claro).
     2. 1 estilo por chave de ControleCargas.XML_BG/XML_FG (mesma
        simbologia da matriz) — usados só nas colunas de dia.
     3. 1 estilo por severidade de comentário (XML_BG_COMENTARIO/
        XML_FG_COMENTARIO) — usados só nas colunas de identidade (A-D),
        quando a linha tem comentário vigente na data de referência. */
buildEstilosExcel(){
  let styles = `<Style ss:ID="hdr"><Font ss:Bold="1"/><Interior ss:Color="#EEF0EC" ss:Pattern="Solid"/></Style>`;
  Object.keys(ControleCargas.XML_BG).forEach(k=>{
    styles += `<Style ss:ID="st_${k}"><Interior ss:Color="${ControleCargas.XML_BG[k]}" ss:Pattern="Solid"/><Font ss:Color="${ControleCargas.XML_FG[k]}" ss:Bold="1"/><Alignment ss:Horizontal="Center"/></Style>`;
  });
  Object.keys(ControleCargas.XML_BG_COMENTARIO).forEach(sev=>{
    styles += `<Style ss:ID="cmt_${sev}"><Interior ss:Color="${ControleCargas.XML_BG_COMENTARIO[sev]}" ss:Pattern="Solid"/><Font ss:Color="${ControleCargas.XML_FG_COMENTARIO[sev]}"/></Style>`;
  });
  return styles;
},

/* Contexto:
   Formata a Defasagem (SLA em du) de 1 carteira no mesmo texto da coluna
   "Defasagem" do TemplateCarteiras.xlsx ("D-1", "D-3", "M") — pedido do
   usuário 2026-07-23. Usada por buildAbaMatrizExcel(). Retorna string.

   Pseudocódigo:
     1. Regime mensal (periodicity 'M') -> "M" (o SLA mensal usa outro
        cálculo, ver prazo_regime_mensal em utils/datas.py).
     2. Regime diário -> "D-{lagBizDays}" (ou "—" se, por algum motivo,
        lagBizDays não veio preenchido). */
montarDefasagemExcel(r){
  if(r.periodicity==='M') return 'M';
  return r.lagBizDays!=null ? `D-${r.lagBizDays}` : '—';
},

/* Contexto:
   Monta as <Row> da única aba "Matriz" do relatório Excel: cabeçalho
   (identidade + janela dia-a-dia + últimas datas + auditoria da data de
   referência) e, por carteira já ordenada, 1 linha com a sigla/estilo de
   cada dia MAIS as colunas de auditoria. [REVISADO 2026-07-23, pedido do
   usuário: "criou uma aba detalhe, eu quero tudo na aba matriz" — a antiga
   aba "Detalhe" foi eliminada; tudo que ela tinha (WalletID, Modelo de
   Carga, Periodicidade, Δ Rent/Sequência/Issues/Alertas/Comentário da data
   de referência) agora vive nesta mesma aba, ao lado do grid dia-a-dia].
   [REVISADO 2026-07-23, pedido do usuário] Removidas as colunas Tier/Score
   Prioridade/Overlay Score/Alertas-Avisos (Mongo) — não desejadas no Excel
   — e as 4 colunas de identidade (A-D: Company/Carteira/WalletID/
   Instituição) pararam de vir coloridas pelo tier; acrescentada a coluna
   Defasagem (montarDefasagemExcel). Chamada 1x por buildExcelXml(). Retorna
   string XML (linhas, sem o <Table> em volta).

   Pseudocódigo:
     1. Monta a linha de cabeçalho: identidade (Company/Carteira/WalletID/
        Instituição/Modelo de Carga/Periodicidade/Defasagem) + 1 coluna por
        dia da janela + as 2 colunas de anotação (Responsável/Comentário
        sobre atuação, SÓ a data de referência — [REVISADO 2026-07-25,
        pedido do usuário: "trazer essas duas colunas para antes da Ult
        Unp"], antes vinham no fim) + últimas datas + auditoria da data de
        referência (Δ Rent, Sequência, Issues, Alertas do Grid, Comentário).
     2. Para cada carteira (já ordenada): resolve a severidade do comentário
        vigente NA DATA DE REFERÊNCIA (cellCommentSeverity) e colore as 4
        colunas de identidade (Company/Carteira/WalletID/Instituição) com
        essa cor, se houver — [REVISADO 2026-07-27, pedido do usuário: "as
        carteiras com comentário na data, deve se parecer a mesma cor na
        linha no excel"] mesma cor do balão da tela (cmt-dot). Monta a
        sigla/estilo de cada dia (mesma simbologia da matriz principal) e,
        na mesma linha, a anotação da carteira (annotationAtual,
        anotacoes.js — pendente ou já salva, o que já estiver na tela) + os
        campos de auditoria lidos só da célula da data de referência
        (montarOverlaysCsvExcel/montarComentarioNaDataExcel já filtram só
        nela). */
buildAbaMatrizExcel(window_, walletRows){
  const refDate = ControleCargas.SNAPSHOT.meta.referenceDate;

  // [2026-07-28, pedido do usuário: "sempre na criação do excel, salvar o
  // horário que foi criado"] 1ª linha da aba, antes do cabeçalho — mesmo
  // formato/helper já usado pro timestamp do botão Atualizar (DRY, CLAUDE.md
  // §6). A <Created> do DocumentProperties (buildWorkbookXml) já guardava
  // esse horário, mas só nos metadados do arquivo (invisível ao abrir); esta
  // linha deixa visível na própria planilha.
  let matrixRows = `<Row><Cell><Data ss:Type="String">Relatório gerado em: ${ControleCargas.formatarDataHoraAgora()}</Data></Cell></Row>`;
  matrixRows += `<Row>`;
  ['Company','Carteira','WalletID','Instituição','Modelo de Carga','Periodicidade','Defasagem'].forEach(h=> matrixRows += ControleCargas.ssCell(h, {style:'hdr'}));
  window_.forEach(d=> matrixRows += ControleCargas.ssCell(d, {style:'hdr'}));
  [`Responsável (${refDate})`,`Comentário sobre atuação (${refDate})`,
   `Δ Rent bp (${refDate})`,`Fora de sequência (${refDate})`,`Issues (${refDate})`,
   `Alertas do Grid — Rent/Atraso/Sequência/Issue (${refDate})`,
   `Comentário (${refDate})`].forEach(h=> matrixRows += ControleCargas.ssCell(h, {style:'hdr'}));
  matrixRows += `</Row>`;

  walletRows.forEach(r=>{
    const cmap = ControleCargas.cellByDate(r);
    const comentarioSevRef = ControleCargas.cellCommentSeverity('wallet', r.walletId, refDate);
    const estiloIdentidade = comentarioSevRef ? {style: 'cmt_'+comentarioSevRef} : undefined;
    matrixRows += `<Row>`;
    matrixRows += ControleCargas.ssCell(r.company, estiloIdentidade) + ControleCargas.ssCell(r.name, estiloIdentidade) + ControleCargas.ssCell(r.walletId, estiloIdentidade) + ControleCargas.ssCell(r.institution, estiloIdentidade);
    matrixRows += ControleCargas.ssCell(r.loadModel) + ControleCargas.ssCell(r.monthly?'Mensal':'Diário') + ControleCargas.ssCell(ControleCargas.montarDefasagemExcel(r));
    window_.forEach(d=>{
      const c = cmap[d];
      const key = c ? c.s : 'notcov';
      const letter = ControleCargas.STATES[key] ? ControleCargas.STATES[key].letter : '—';
      matrixRows += ControleCargas.ssCell(letter, {style:'st_'+key});
    });

    const celulaRef = cmap[refDate];
    const ttRef = (celulaRef && celulaRef.tt) || {};
    const divRef = ttRef.div ? ttRef.div.bp.toFixed(1) : '';
    const seqRef = !!ttRef.seq;
    const issuesTextoRef = ttRef.issues || '';
    const overlaysCsv = ControleCargas.montarOverlaysCsvExcel(r, refDate);
    const comentarioNaData = ControleCargas.montarComentarioNaDataExcel(r, refDate);
    const anotacao = ControleCargas.annotationAtual('wallet', r.walletId);

    matrixRows += ControleCargas.ssCell(anotacao.responsavel) + ControleCargas.ssCell(anotacao.comentarioAtuacao);
    matrixRows += ControleCargas.ssCell(divRef) + ControleCargas.ssCell(seqRef?'Sim':'Não') + ControleCargas.ssCell(issuesTextoRef);
    matrixRows += ControleCargas.ssCell(overlaysCsv) + ControleCargas.ssCell(comentarioNaData);
    matrixRows += `</Row>`;
  });
  return matrixRows;
},

// rótulos legíveis dos overlays da matriz (mesmo vocabulário da legenda,
// ControleCargas.buildLegend em matriz.js) — usados só na exportação Excel,
// pedido do usuário 2026-07-23 ("nossos alertas... Rent, Atras, etc").
OVERLAY_LABELS_EXCEL: {
  div: 'Rent', div_strong: 'Rent forte',
  atraso: 'Atraso', atraso_strong: 'Atraso forte',
  seq: 'Sequência', issue: 'Issue',
},

/* Contexto:
   Monta o texto de 1 célula com os overlays da matriz (Rent/Rent forte,
   Atraso/Atraso forte, Sequência, Issue) da carteira NA DATA pedida,
   separados por vírgula — pedido do usuário 2026-07-23 ("nossos alertas
   também... Rent, Atras, etc"). [REMOVIDO 2026-07-23, pedido do usuário] A
   coluna irmã "Alertas/Avisos" (issues do Mongo, outro vocabulário/fonte)
   saiu do relatório — não desejada no Excel. [REVISADO 2026-07-23, pedido
   do usuário: só a data de referência, não a janela inteira]. Usada por
   buildAbaMatrizExcel(). Retorna string (vazia quando a carteira não tem
   overlay nessa data).

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
   Envolve as linhas já montadas da aba única "Matriz" + os estilos no
   template XML completo do Workbook SpreadsheetML 2003. [REVISADO
   2026-07-23, pedido do usuário: "quero tudo na aba matriz" — a antiga aba
   "Detalhe" foi eliminada, só existe mais 1 worksheet]. Chamada 1x por
   buildExcelXml(), como último passo. Retorna a string XML pronta para
   virar um Blob .xls.

   Pseudocódigo:
     1. Cabeçalho XML + namespaces do Workbook + DocumentProperties
        (título/autor/timestamp de criação).
     2. Bloco <Styles> recebido.
     3. Worksheet "Matriz" única, com FreezePanes nas 4 primeiras colunas
        (Company/Carteira/WalletID/Instituição) + as 2 primeiras linhas
        (timestamp de geração + cabeçalho — [REVISADO 2026-07-28] antes era
        só 1 linha congelada, a do cabeçalho; a nova linha de timestamp
        entrou acima dele em buildAbaMatrizExcel() e precisou entrar no
        congelamento também), e as <Row> recebidas. */
buildWorkbookXml(styles, matrixRows){
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
<DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">
 <Title>Controle de Cargas</Title>
 <Author>Beehus SWAT</Author>
 <Created>${new Date().toISOString()}</Created>
</DocumentProperties>
<Styles>${styles}</Styles>
<Worksheet ss:Name="Matriz">
 <Table>${matrixRows}</Table>
 <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>2</SplitHorizontal><TopRowBottomPane>2</TopRowBottomPane><SplitVertical>4</SplitVertical><LeftColumnRightPane>4</LeftColumnRightPane></WorksheetOptions>
</Worksheet>
</Workbook>`;
},

/* Contexto:
   Monta o XML SpreadsheetML 2003 completo do relatório exportável (aba
   única Matriz, com o grid dia-a-dia + toda a auditoria da data de
   referência lado a lado — [REVISADO 2026-07-23, pedido do usuário]),
   client-side e sem CDN/servidor. Chamada por exportExcel() ao clicar
   "Exportar". Orquestradora fina — cada peça estrutural é montada por uma
   função própria (ver acima). Retorna a string XML pronta para virar um
   Blob .xls.

   Pseudocódigo:
     1. Ordena as carteiras 1x.
     2. Monta os estilos (buildEstilosExcel).
     3. Monta as linhas da aba Matriz (buildAbaMatrizExcel).
     4. Envolve tudo no template XML do Workbook (buildWorkbookXml) e
        retorna a string. */
buildExcelXml(){
  const m = ControleCargas.SNAPSHOT.meta;
  const window_ = m.window;
  const walletRows = ControleCargas.sortedRows(ControleCargas.SNAPSHOT.wallets, true);

  const styles = ControleCargas.buildEstilosExcel();
  const matrixRows = ControleCargas.buildAbaMatrizExcel(window_, walletRows);

  return ControleCargas.buildWorkbookXml(styles, matrixRows);
},

/* Contexto:
   Dispara o download do relatório Excel (.xls SpreadsheetML) gerado
   client-side — handler do botão "Exportar" da toolbar. Não retorna nada.

   Pseudocódigo:
     1. Gera o XML via buildExcelXml().
     2. Cria um Blob e um link <a download> temporário apontando pra ele.
     3. Simula o clique do link (dispara o download do navegador) e limpa o
        link/URL temporários em seguida. */
exportExcel(){
  const xml = ControleCargas.buildExcelXml();
  const blob = new Blob([xml], {type:'application/vnd.ms-excel'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ControleCargas_relatorio_${ControleCargas.SNAPSHOT.meta.today}.xls`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
},
});
