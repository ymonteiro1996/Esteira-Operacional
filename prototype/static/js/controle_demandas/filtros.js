/* ControleDemandas.filtros — filtros de busca/cliente/prioridade/status/tipo do quadro.
   Object.assign(ControleDemandas, {...}) — CLAUDE.md §4. */
Object.assign(ControleDemandas, {

  /* Contexto:
     Preenche os <select> de filtro e do modal de formulário com as opções
     dinâmicas vindas de GET /api/demandas/opcoes (clientes/responsáveis
     configuráveis em data/demandas_config.json + os 3 enums fixos do
     backend). Chamada 1x no boot (index.js), depois que a fetch de opções
     resolve. Não retorna nada.

     Pseudocódigo:
       1. Monta as <option> de cada <select> de filtro (com "Todos...").
       2. Monta as <option> dos <select> do modal de formulário (sem
          "Todos...", mais um placeholder onde faz sentido escolher vazio).
       3. Monta a <datalist> de responsáveis (autocomplete do campo texto
          livre "Responsável"). */
  montarOpcoesFiltros() {
    const o = this.opcoes;
    const montarOptions = (id, valores, labelTudo) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.innerHTML = `<option value="">${labelTudo}</option>` +
        valores.map(v => `<option value="${this.esc(v)}">${this.esc(v)}</option>`).join('');
    };
    montarOptions('kd-f-cliente', o.clientes, 'Todos os clientes');
    montarOptions('kd-f-prioridade', o.prioridades, 'Todas as prioridades');
    montarOptions('kd-f-status', o.status, 'Todos os status');
    montarOptions('kd-f-tipo', o.tipos, 'Todos os tipos');

    document.getElementById('kd-form-cliente').innerHTML =
      '<option value="">Selecione…</option>' + o.clientes.map(v => `<option value="${this.esc(v)}">${this.esc(v)}</option>`).join('');
    document.getElementById('kd-form-tipo').innerHTML =
      '<option value="">—</option>' + o.tipos.map(v => `<option value="${this.esc(v)}">${this.esc(v)}</option>`).join('');
    document.getElementById('kd-form-prioridade').innerHTML =
      o.prioridades.map(v => `<option value="${this.esc(v)}">${this.esc(v)}</option>`).join('');
    document.getElementById('kd-form-status').innerHTML =
      o.status.map(v => `<option value="${this.esc(v)}">${this.esc(v)}</option>`).join('');
    document.getElementById('kd-resp-list').innerHTML =
      o.responsaveis.map(r => `<option value="${this.esc(r)}">`).join('');
  },

  /* Contexto: monta os parâmetros de querystring de GET /api/demandas a
     partir dos campos de filtro correntes da tela. Chamada por
     carregarDemandas(). Retorna URLSearchParams. */
  montarParametrosFiltro() {
    const params = new URLSearchParams();
    const busca = document.getElementById('kd-f-search').value.trim();
    const cliente = document.getElementById('kd-f-cliente').value;
    const prioridade = document.getElementById('kd-f-prioridade').value;
    const status = document.getElementById('kd-f-status').value;
    const tipo = document.getElementById('kd-f-tipo').value;
    if (busca) params.set('search', busca);
    if (cliente) params.set('cliente', cliente);
    if (prioridade) params.set('prioridade', prioridade);
    if (status) params.set('status', status);
    if (tipo) params.set('tipo', tipo);
    return params;
  },

  /* Contexto: dispara carregarDemandas() com um pequeno atraso (300ms) a
     cada tecla digitada no campo de busca, pra não bater na API a cada
     caractere — mesmo padrão (debounceLoad) da origem. Chamada pelo
     listener de input do campo de busca. Não retorna nada. */
  buscarComDebounce() {
    clearTimeout(this._debounceBusca);
    this._debounceBusca = setTimeout(() => this.carregarDemandas(), 300);
  },

  /* Contexto: reseta todos os campos de filtro e recarrega o quadro sem
     filtro nenhum — botão "Limpar filtros". Não retorna nada. */
  limparFiltros() {
    ['kd-f-search', 'kd-f-cliente', 'kd-f-prioridade', 'kd-f-status', 'kd-f-tipo'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.getElementById('kd-f-show-done').checked = false;
    this.carregarDemandas();
  },

  /* Contexto: liga todos os handlers de interação dos filtros (busca,
     4 selects, checkbox "mostrar concluídos", botão "limpar"). Chamada 1x
     no boot (index.js). Não retorna nada. */
  ligarFiltros() {
    document.getElementById('kd-f-search').addEventListener('input', () => this.buscarComDebounce());
    ['kd-f-cliente', 'kd-f-prioridade', 'kd-f-status', 'kd-f-tipo', 'kd-f-show-done'].forEach(id => {
      document.getElementById(id).addEventListener('change', () => this.carregarDemandas());
    });
    document.getElementById('kd-btn-limpar-filtros').addEventListener('click', () => this.limparFiltros());
  },
});
