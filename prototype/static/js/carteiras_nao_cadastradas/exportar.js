/* CarteirasNaoCadastradas.exportar — Excel da aba (SpreadsheetML 2003,
   client-side, mesmo formato do "Exportar" da Matriz).
   [2026-09-24, pedido do usuário: "poder extrair Carteiras Não Cadastradas
   em Excel"] Exporta o que está NA TELA (todos os filtros aplicados), na
   mesma ordem e com as mesmas colunas (COLUNAS, state.js). Reusa
   ControleCargas.ssCell/xmlEsc (static/js/controle_cargas/exportar.js, já
   carregado antes) em vez de duplicar o gerador de célula. */
Object.assign(CarteirasNaoCadastradas, {

  /* Contexto:
     Monta o XML do Workbook: aba "Não Cadastradas" com cabeçalho + 1 linha
     por carteira filtrada (novas com fundo âmbar) e uma aba "Parâmetros"
     com a data da consulta e as regras usadas. Chamada por exportarExcel().
     Retorna string XML.

     Pseudocódigo:
       1. Cabeçalho = rótulos de COLUNAS (estilo hdr).
       2. Linhas = textoExcel/texto de cada coluna; linha nova usa estilo "nova".
       3. Aba Parâmetros = consulta, faixa de carga, regra de Nova, filtros.
       4. Envolve no template do Workbook (cabeçalho congelado). */
  montarXmlExcel(linhas) {
    const celula = (valor, estilo) => ControleCargas.ssCell(valor, estilo ? { style: estilo } : undefined);
    const cabecalho = `<Row>${this.COLUNAS.map(coluna => celula(coluna.rotulo, 'hdr')).join('')}</Row>`;
    const corpo = linhas.map(c => `<Row>${this.COLUNAS.map(coluna =>
      celula((coluna.textoExcel || coluna.texto)(c), c.isNova ? 'nova' : null)).join('')}</Row>`).join('');
    const { parametros, geradoEm } = this.resposta;
    const parametrosLinhas = [
      ['Consultado em', geradoEm],
      ['Carga verificada', `${this.formatarData(parametros.dataInicialCarga)} a ${this.formatarData(parametros.dataFinalCarga)} (${parametros.diasVerificacaoCarga} dias corridos)`],
      ['Nova', `criada há menos de ${parametros.diasUteisSinalizacaoNova} dias úteis`],
      ['Linhas exportadas', `${linhas.length} de ${this.resposta.carteiras.length} (filtros da tela aplicados)`],
    ].map(([rotulo, valor]) => `<Row>${celula(rotulo, 'hdr')}${celula(valor)}</Row>`).join('');
    return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles>
 <Style ss:ID="hdr"><Font ss:Bold="1"/><Interior ss:Color="#EEF0EC" ss:Pattern="Solid"/></Style>
 <Style ss:ID="nova"><Interior ss:Color="#FEF3C7" ss:Pattern="Solid"/><Font ss:Color="#92400E"/></Style>
</Styles>
<Worksheet ss:Name="Não Cadastradas">
 <Table>${cabecalho}${corpo}</Table>
 <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane></WorksheetOptions>
 <AutoFilter x:Range="R1C1:R${linhas.length + 1}C${this.COLUNAS.length}" xmlns="urn:schemas-microsoft-com:office:excel"/>
</Worksheet>
<Worksheet ss:Name="Parâmetros">
 <Table>${parametrosLinhas}</Table>
</Worksheet>
</Workbook>`;
  },

  /* Contexto:
     Handler do botão "Exportar Excel": baixa um .xls com as linhas
     filtradas da tela. Não retorna nada.

     Pseudocódigo:
       1. Sem consulta feita ainda -> não faz nada (botão fica desabilitado).
       2. Aplica os filtros atuais e gera o XML.
       3. Baixa via Blob + <a download> temporário. */
  exportarExcel() {
    if (!this.resposta) return;
    const xml = this.montarXmlExcel(this.aplicarFiltros(this.resposta.carteiras));
    const url = URL.createObjectURL(new Blob([xml], { type: 'application/vnd.ms-excel' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `CarteirasNaoCadastradas_${this.resposta.parametros.dataFinalCarga}.xls`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  },
});
