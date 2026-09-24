/* CarteirasNaoCadastradas.state — estado da aba "Carteiras Não Cadastradas".
   [2026-09-24, pedido do usuário] Carteiras que existem no Beehus mas não
   estão no TemplateCarteiras.xlsx (dado vem de GET
   /api/carteiras-nao-cadastradas, pages/carteiras_nao_cadastradas.py).
   Objeto PRÓPRIO (não estende ControleCargas), padrão "sem build" do
   CLAUDE.md §4: este arquivo declara o objeto; os seguintes acrescentam
   métodos via Object.assign(CarteirasNaoCadastradas, {...}).

   COLUNAS é a fonte ÚNICA das colunas — tabela (resultados.js), filtro de
   cabeçalho (filtros.js) e Excel (exportar.js) leem daqui, então incluir ou
   renomear uma coluna é mudar 1 lugar só. `texto(c)` = valor usado no filtro
   e no Excel; `html(c)` (opcional) = célula da tela quando difere do texto. */
const CarteirasNaoCadastradas = {
  resposta: null,       // última resposta da API ({parametros, contagem, carteiras, geradoEm})
  carregando: false,
  jaConsultou: false,   // a 1ª consulta só acontece ao abrir a aba (custa chamadas à API)
  _debounceBusca: null,
  filtrosColuna: {},    // chave da coluna -> Set de textos aceitos (ausente/null = sem filtro)

  COLUNAS: [
    { chave: 'alerta', rotulo: 'Alerta',
      texto: c => (c.isNova ? 'Nova' : '—'),
      textoExcel: c => (c.isNova ? `Nova (${c.diasUteisRestantesNova} du restantes)` : ''),
      html: c => (c.isNova
        ? `<span class="cnc-badge-nova" title="Criada há ${c.diasUteisDesdeCriacao} du — perde a sinalização em ${c.diasUteisRestantesNova} du se não entrar no Template">Nova · ${c.diasUteisRestantesNova} du</span>`
        : '') },
    { chave: 'company', rotulo: 'Company', texto: c => c.company },
    { chave: 'name', rotulo: 'Carteira', texto: c => c.name, classe: 'cnc-nome' },
    { chave: 'walletId', rotulo: 'WalletID', texto: c => c.walletId, classe: 'cnc-mono' },
    { chave: 'institution', rotulo: 'Instituição', texto: c => c.institution },
    { chave: 'accountCode', rotulo: 'Conta', texto: c => c.accountCode || '—', classe: 'cnc-mono' },
    { chave: 'dataCriacao', rotulo: 'Criada em', texto: c => CarteirasNaoCadastradas.formatarData(c.dataCriacao) },
    { chave: 'startDateConsolidation', rotulo: 'Início consolidação',
      texto: c => CarteirasNaoCadastradas.formatarData(c.startDateConsolidation) },
    { chave: 'ultimaCarga', rotulo: 'Última carga', texto: c => CarteirasNaoCadastradas.formatarData(c.ultimaCarga) },
    { chave: 'carga', rotulo: 'Carga últimos 45 dias?',
      texto: c => (c.temCargaRecente ? 'Sim' : 'Não'),
      html: c => (c.temCargaRecente
        ? '<span class="cnc-pill cnc-pill-sim">Sim</span>'
        : '<span class="cnc-pill cnc-pill-nao">Não</span>') },
  ],

  /* Contexto: escapa texto pra entrar em innerHTML. Retorna string. */
  esc(texto) {
    return String(texto == null ? '' : texto)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  },

  /* Contexto: "YYYY-MM-DD" -> "DD/MM/YYYY" ("—" quando vazio). Retorna string. */
  formatarData(dataIso) {
    if (!dataIso) return '—';
    const [ano, mes, dia] = String(dataIso).slice(0, 10).split('-');
    return `${dia}/${mes}/${ano}`;
  },

  /* Contexto: coluna de COLUNAS pela chave. Retorna o objeto ou undefined. */
  colunaPorChave(chave) {
    return this.COLUNAS.find(coluna => coluna.chave === chave);
  },
};
