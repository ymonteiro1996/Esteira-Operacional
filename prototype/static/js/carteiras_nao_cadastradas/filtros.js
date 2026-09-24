/* CarteirasNaoCadastradas.filtros — filtros de tela: barra de cima (busca,
   empresa, carga, só novas) + filtro ▾ por cabeçalho de coluna (estilo
   Excel, via utils/filtro_popover.js). Tudo filtra o que JÁ veio da API,
   sem nova consulta. */
Object.assign(CarteirasNaoCadastradas, {

  /* Contexto:
     Liga os campos de filtro ao re-render da tabela. Chamada 1x no boot
     (index.js). Não retorna nada.

     Pseudocódigo:
       1. Busca por texto: re-render com debounce de 200ms.
       2. Empresa / carga / "só novas": re-render imediato.
       3. Clique num ▾ do cabeçalho (delegado no <thead>, que é redesenhado):
          abre o filtro daquela coluna.
       4. "Limpar filtros": zera barra de cima e cabeçalhos. */
  ligarFiltros() {
    document.getElementById('cnc-f-busca').addEventListener('input', () => {
      clearTimeout(this._debounceBusca);
      this._debounceBusca = setTimeout(() => this.renderizarTabela(), 200);
    });
    ['cnc-f-empresa', 'cnc-f-carga', 'cnc-f-novas'].forEach(id =>
      document.getElementById(id).addEventListener('change', () => this.renderizarTabela()));
    document.getElementById('cnc-thead').addEventListener('click', e => {
      const botao = e.target.closest('.th-filter-btn');
      if (!botao) return;
      e.stopPropagation();
      this.abrirFiltroColuna(botao.dataset.cncColuna, botao);
    });
    document.getElementById('cnc-btn-limpar-filtros').addEventListener('click', () => this.limparFiltros());
  },

  /* Contexto:
     Preenche o <select> de empresas com as empresas presentes na última
     resposta, preservando a escolha atual quando ela ainda existe. Chamada
     depois de cada consulta (resultados.js). Não retorna nada. */
  montarOpcoesEmpresa(carteiras) {
    const select = document.getElementById('cnc-f-empresa');
    const escolhida = select.value;
    const empresas = [...new Set(carteiras.map(c => c.company))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    select.innerHTML = '<option value="">Todas as empresas</option>' +
      empresas.map(nome => `<option value="${this.esc(nome)}">${this.esc(nome)}</option>`).join('');
    if (empresas.includes(escolhida)) select.value = escolhida;
  },

  /* Contexto:
     Aplica TODOS os filtros sobre a lista (já ordenada pelo backend).
     `colunaIgnorada` deixa de fora o filtro de 1 coluna — usado pra montar
     as opções daquela coluna em cascata (como no Excel: a lista mostra o
     que sobra pelos OUTROS filtros). Chamada por renderizarTabela(),
     exportarExcel() e valoresDistintosColuna(). Retorna a lista filtrada.

     Pseudocódigo:
       1. Barra de cima: texto (nome/WalletID/conta, sem acento/caixa),
          empresa, carga Sim/Não, só novas.
       2. Cabeçalhos: pra cada coluna com Set ativo (exceto a ignorada), o
          texto da célula precisa estar no Set. */
  aplicarFiltros(carteiras, colunaIgnorada) {
    const normalizar = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const busca = normalizar(document.getElementById('cnc-f-busca').value.trim());
    const empresa = document.getElementById('cnc-f-empresa').value;
    const carga = document.getElementById('cnc-f-carga').value;
    const soNovas = document.getElementById('cnc-f-novas').checked;
    const filtrosAtivos = Object.entries(this.filtrosColuna)
      .filter(([chave, aceitos]) => aceitos && chave !== colunaIgnorada)
      .map(([chave, aceitos]) => [this.colunaPorChave(chave), aceitos]);
    return carteiras.filter(c =>
      (!busca || normalizar(`${c.name} ${c.walletId} ${c.accountCode || ''}`).includes(busca))
      && (!empresa || c.company === empresa)
      && (!carga || (carga === 'sim') === c.temCargaRecente)
      && (!soNovas || c.isNova)
      && filtrosAtivos.every(([coluna, aceitos]) => aceitos.has(coluna.texto(c))));
  },

  /* Contexto:
     Valores distintos de 1 coluna com a contagem, em cascata (considera
     todos os outros filtros). Datas "DD/MM/YYYY" ordenam pela data real.
     Chamada por abrirFiltroColuna(). Retorna [{valor, label, contagem}]. */
  valoresDistintosColuna(chave) {
    const coluna = this.colunaPorChave(chave);
    const contagem = new Map();
    this.aplicarFiltros(this.resposta.carteiras, chave).forEach(c => {
      const texto = coluna.texto(c);
      contagem.set(texto, (contagem.get(texto) || 0) + 1);
    });
    const chaveOrdem = t => (/^\d{2}\/\d{2}\/\d{4}$/.test(t) ? t.split('/').reverse().join('') : t);
    return [...contagem.entries()]
      .sort(([a], [b]) => chaveOrdem(a).localeCompare(chaveOrdem(b), 'pt-BR'))
      .map(([valor, total]) => ({ valor, label: valor, contagem: total }));
  },

  /* Contexto:
     Abre o popover ▾ de 1 coluna; ao aplicar, guarda o Set (ou remove o
     filtro) e redesenha cabeçalho + tabela. Não retorna nada. */
  abrirFiltroColuna(chave, botao) {
    if (!this.resposta) return;
    FiltroPopover.alternar({
      ancora: botao,
      valores: this.valoresDistintosColuna(chave),
      marcados: this.filtrosColuna[chave] || null,
      aoAplicar: selecao => {
        this.filtrosColuna[chave] = selecao;
        this.renderizarTabela();
      },
    });
  },

  /* Contexto: zera todos os filtros (barra de cima + cabeçalhos) e
     redesenha. Chamada pelo botão "Limpar filtros". Não retorna nada. */
  limparFiltros() {
    document.getElementById('cnc-f-busca').value = '';
    document.getElementById('cnc-f-empresa').value = '';
    document.getElementById('cnc-f-carga').value = '';
    document.getElementById('cnc-f-novas').checked = false;
    this.filtrosColuna = {};
    this.renderizarTabela();
  },
});
