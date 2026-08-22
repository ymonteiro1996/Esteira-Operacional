/* Anomalias.filtros — filtros de busca/cliente/criticidade/status do board.
   Object.assign(Anomalias, {...}) — CLAUDE.md §4. Tradução do mesmo
   padrão de static/js/controle_demandas/filtros.js, adaptado para os
   campos desta tela (sem "prioridade"/"tipo", que não existem em
   Anomalias; com "criticidade" no lugar).

   [2026-08-22] Melhoria 3 (ordenar/filtrar por tempo em aberto + "só sem
   vínculo") e o filtro por tag (melhoria 5) injetam os controles novos
   via JS dentro de `.an-filtros` (injetarControlesFiltrosNovos(),
   chamada 1x no boot) — o markup de index_template.html/index.html não
   é tocado (fora do escopo de edição liberado desta tarefa; ver
   pages/anomalias.py, cabeçalho). */
Object.assign(Anomalias, {

  /* Contexto:
     Acrescenta 3 controles novos à barra de filtros, sem editar o HTML
     do template (fora do escopo liberado desta tarefa): o <select> de
     ordenação (melhoria 3), o checkbox "só sem demanda vinculada"
     (melhoria 3) e o <select> de filtro por tag (melhoria 5) — os 3
     entram logo antes do botão "Limpar filtros". Chamada 1x no boot
     (ligarFiltros()), idempotente (não duplica se já injetado). Não
     retorna nada. */
  injetarControlesFiltrosNovos() {
    if (document.getElementById('an-f-ordenar')) return;
    const botaoLimpar = document.getElementById('an-btn-limpar-filtros');
    botaoLimpar.insertAdjacentHTML('beforebegin', `
      <select class="an-select" id="an-f-tag" title="Filtrar por tag"></select>
      <select class="an-select" id="an-f-ordenar" title="Ordenação">
        <option value="criticidade">Ordenar: Criticidade</option>
        <option value="antigas">Mais antigas primeiro</option>
        <option value="atualizadas">Atualizadas há mais tempo</option>
      </select>
      <label class="an-checkbox"><input type="checkbox" id="an-f-somente-sem-vinculo"> Só sem demanda vinculada</label>
    `);
    document.getElementById('an-f-tag').addEventListener('change', () => this.carregarAnomalias());
    document.getElementById('an-f-ordenar').addEventListener('change', () => this.renderizarQuadro());
    document.getElementById('an-f-somente-sem-vinculo').addEventListener('change', () => this.renderizarQuadro());
  },

  /* Contexto:
     Recalcula as <option> do filtro de tag a partir das tags realmente
     em uso (`this.anomalias`) unidas com as sugestões de config
     (opcoes.tags_sugeridas) — mantém o filtro útil mesmo com poucas
     anomalias cadastradas. Preserva a seleção atual quando ela continua
     válida. Chamada por renderizarQuadro() (quadro.js) a cada refresh do
     board. Não retorna nada. */
  atualizarOpcoesFiltroTag() {
    const select = document.getElementById('an-f-tag');
    if (!select) return;
    const emUso = new Set();
    this.anomalias.forEach(a => (a.tags || []).forEach(t => emUso.add(t)));
    (this.opcoes.tags_sugeridas || []).forEach(t => emUso.add(t));
    const valorAtual = select.value;
    const tags = [...emUso].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    select.innerHTML = '<option value="">Todas as tags</option>' +
      tags.map(t => `<option value="${this.esc(t)}">${this.esc(t)}</option>`).join('');
    if (tags.includes(valorAtual)) select.value = valorAtual;
  },

  /* Contexto:
     Preenche os <select> de filtro e do modal de formulário com as
     opções dinâmicas vindas de GET /api/anomalias/opcoes (clientes/
     responsáveis configuráveis em data/demandas_config.json + os enums
     fixos do backend). Chamada 1x no boot (index.js), depois que a fetch
     de opções resolve. Não retorna nada.

     Pseudocódigo:
       1. Monta as <option> de cada <select> de filtro (com "Todas...").
       2. Monta as <option> dos <select> do modal de formulário (sem
          "Todas...").
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
    montarOptions('an-f-cliente', o.clientes, 'Todos os clientes');
    montarOptions('an-f-criticidade', o.criticidades, 'Todas as criticidades');
    montarOptions('an-f-status', o.status, 'Todos os status');

    document.getElementById('an-form-cliente').innerHTML =
      '<option value="">Selecione…</option>' + o.clientes.map(v => `<option value="${this.esc(v)}">${this.esc(v)}</option>`).join('');
    document.getElementById('an-form-criticidade').innerHTML =
      '<option value="">Selecione…</option>' + o.criticidades.map(v => `<option value="${this.esc(v)}">${this.esc(v)}</option>`).join('');
    document.getElementById('an-form-status').innerHTML =
      o.status.map(v => `<option value="${this.esc(v)}">${this.esc(v)}</option>`).join('');
    document.getElementById('an-resp-list').innerHTML =
      o.responsaveis.map(r => `<option value="${this.esc(r)}">`).join('');
  },

  /* Contexto: monta os parâmetros de querystring de GET /api/anomalias a
     partir dos campos de filtro correntes da tela (inclui "tag",
     melhoria 5, quando o controle já foi injetado). Chamada por
     carregarAnomalias(). Retorna URLSearchParams. */
  montarParametrosFiltro() {
    const params = new URLSearchParams();
    const busca = document.getElementById('an-f-search').value.trim();
    const cliente = document.getElementById('an-f-cliente').value;
    const criticidade = document.getElementById('an-f-criticidade').value;
    const status = document.getElementById('an-f-status').value;
    const tag = document.getElementById('an-f-tag')?.value || '';
    if (busca) params.set('search', busca);
    if (cliente) params.set('cliente', cliente);
    if (criticidade) params.set('criticidade', criticidade);
    if (status) params.set('status', status);
    if (tag) params.set('tag', tag);
    return params;
  },

  /* Contexto: dispara carregarAnomalias() com um pequeno atraso (300ms) a
     cada tecla digitada no campo de busca, pra não bater na API a cada
     caractere. Chamada pelo listener de input do campo de busca. Não
     retorna nada. */
  buscarComDebounce() {
    clearTimeout(this._debounceBusca);
    this._debounceBusca = setTimeout(() => this.carregarAnomalias(), 300);
  },

  /* Contexto: reseta todos os campos de filtro (inclusive os injetados
     pela melhoria 3/5: ordenação, "só sem vínculo", tag) e recarrega o
     board sem filtro nenhum — botão "Limpar filtros" e atalho de teclado
     "0" (ligarAtalhosTeclado(), index.js). Não retorna nada. */
  limparFiltros() {
    ['an-f-search', 'an-f-cliente', 'an-f-criticidade', 'an-f-status', 'an-f-tag'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    document.getElementById('an-f-show-done').checked = false;
    const ordenar = document.getElementById('an-f-ordenar');
    if (ordenar) ordenar.value = 'criticidade';
    const somenteSemVinculo = document.getElementById('an-f-somente-sem-vinculo');
    if (somenteSemVinculo) somenteSemVinculo.checked = false;
    this.carregarAnomalias();
  },

  /* Contexto: liga todos os handlers de interação dos filtros (busca, 3
     selects originais, checkbox "mostrar concluídas/canceladas", botão
     "limpar") e injeta + liga os controles novos da melhoria 3/5
     (ordenação, "só sem vínculo", tag). Chamada 1x no boot (index.js).
     Não retorna nada. */
  ligarFiltros() {
    document.getElementById('an-f-search').addEventListener('input', () => this.buscarComDebounce());
    ['an-f-cliente', 'an-f-criticidade', 'an-f-status', 'an-f-show-done'].forEach(id => {
      document.getElementById(id).addEventListener('change', () => this.carregarAnomalias());
    });
    document.getElementById('an-btn-limpar-filtros').addEventListener('click', () => this.limparFiltros());
    this.injetarControlesFiltrosNovos();
  },
});
