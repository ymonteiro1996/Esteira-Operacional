/* utils/filtro_popover.js — popover genérico de filtro de cabeçalho "estilo Excel".
   [2026-09-24, pedido do usuário: "poder filtrar cabeçalho também" na aba
   Carteiras Não Cadastradas] Mesmo visual e comportamento do filtro ▾ da
   Matriz (static/js/controle_cargas/filtro_cabecalho.js — busca + "Selecionar
   tudo" + lista com contagem + Limpar/Cancelar/OK), reusando as MESMAS classes
   CSS `.th-filter-*` de controle_cargas.css. Aquele arquivo continua intacto:
   ele é amarrado ao estado da Matriz (state.filtroValoresColuna/buildMatrix);
   este é independente de tela — quem chama passa os valores e recebe a
   seleção. Candidato a substituir o da Matriz numa refatoração futura. */
const FiltroPopover = {
  _fecharHandler: null,
  _reposicionarHandler: null,
  _ancoraAberta: null,

  /* Contexto: escapa texto pra innerHTML/atributo. Retorna string. */
  _esc(texto) {
    return String(texto == null ? '' : texto)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  },

  /* Contexto: fecha o popover aberto (se houver) e remove os listeners
     globais dele. Não retorna nada. */
  fechar() {
    const popover = document.getElementById('th-filter-popover');
    if (popover) popover.remove();
    if (this._fecharHandler) {
      document.removeEventListener('mousedown', this._fecharHandler, true);
      document.removeEventListener('keydown', this._fecharHandler, true);
      this._fecharHandler = null;
    }
    if (this._reposicionarHandler) {
      window.removeEventListener('scroll', this._reposicionarHandler, true);
      window.removeEventListener('resize', this._reposicionarHandler, true);
      this._reposicionarHandler = null;
    }
  },

  /* Contexto:
     Abre (ou fecha, se já estava aberto na mesma âncora) o popover abaixo do
     botão ▾. `valores` = [{valor, label, contagem}]; `marcados` = Set do
     filtro atual ou null (sem filtro = tudo marcado); `aoAplicar(sel)`
     recebe null (Limpar, ou OK com tudo marcado) ou o Set escolhido.
     Não retorna nada.

     Pseudocódigo:
       1. Mesma âncora já aberta -> só fecha (toggle).
       2. Monta o HTML e posiciona embaixo da âncora (reposiciona em
          scroll/resize).
       3. Busca filtra a lista visível; "Selecionar tudo" age só nos visíveis.
       4. Limpar -> aoAplicar(null); OK -> Set (ou null se cobre tudo);
          Cancelar/Esc/clique fora -> fecha sem aplicar. */
  alternar({ ancora, valores, marcados, aoAplicar }) {
    const jaAberto = document.getElementById('th-filter-popover') && this._ancoraAberta === ancora;
    this.fechar();
    if (jaAberto) { this._ancoraAberta = null; return; }
    this._ancoraAberta = ancora;
    const selecionados = new Set(marcados ? Array.from(marcados) : valores.map(v => v.valor));
    const popover = this._montarPopover(valores, selecionados);
    this._posicionar(popover, ancora);
    this._ligarLista(popover);
    this._ligarRodape(popover, valores, aoAplicar);
    this._ligarFechamento(popover, ancora);
  },

  /* Contexto: cria o elemento do popover e anexa ao <body>. Retorna o elemento. */
  _montarPopover(valores, selecionados) {
    const popover = document.createElement('div');
    popover.id = 'th-filter-popover';
    popover.className = 'th-filter-popover';
    const itens = valores.map(v => `<label class="th-filter-item"><input type="checkbox" value="${this._esc(v.valor)}" ${selecionados.has(v.valor) ? 'checked' : ''}> ${this._esc(v.label)} <span class="th-filter-count">(${v.contagem})</span></label>`).join('');
    popover.innerHTML = `
      <input type="text" class="th-filter-search" placeholder="Buscar...">
      <label class="th-filter-selectall"><input type="checkbox" checked> <b>Selecionar tudo</b></label>
      <div class="th-filter-list">${itens || '<div class="th-filter-empty">Nenhum valor nesta coluna.</div>'}</div>
      <div class="th-filter-footer">
        <button type="button" class="linklike" data-fc-action="limpar" title="Remove o filtro desta coluna">Limpar</button>
        <button type="button" class="linklike" data-fc-action="cancelar">Cancelar</button>
        <button type="button" class="btn" data-fc-action="ok">OK</button>
      </div>`;
    document.body.appendChild(popover);
    return popover;
  },

  /* Contexto: posiciona o popover embaixo da âncora e o mantém colado nela
     em scroll/resize. Não retorna nada. */
  _posicionar(popover, ancora) {
    const reposicionar = () => {
      const rect = ancora.getBoundingClientRect();
      const largura = popover.offsetWidth || 220;
      popover.style.top = `${Math.round(rect.bottom + 4)}px`;
      popover.style.left = `${Math.round(Math.max(8, Math.min(rect.left, window.innerWidth - largura - 8)))}px`;
    };
    reposicionar();
    this._reposicionarHandler = reposicionar;
    window.addEventListener('scroll', reposicionar, true);
    window.addEventListener('resize', reposicionar, true);
  },

  /* Contexto: liga busca, "Selecionar tudo" e os checkboxes da lista.
     Não retorna nada. */
  _ligarLista(popover) {
    const caixas = () => Array.from(popover.querySelectorAll('.th-filter-item input[type=checkbox]'));
    const visiveis = () => caixas().filter(cb => cb.closest('.th-filter-item').style.display !== 'none');
    const selecionarTudo = popover.querySelector('.th-filter-selectall input');
    const sincronizar = () => {
      const lista = visiveis();
      selecionarTudo.checked = lista.length > 0 && lista.every(cb => cb.checked);
    };
    sincronizar();
    popover.querySelector('.th-filter-search').addEventListener('input', e => {
      const termo = e.target.value.toLowerCase();
      popover.querySelectorAll('.th-filter-item').forEach(item => {
        item.style.display = item.textContent.toLowerCase().includes(termo) ? '' : 'none';
      });
      sincronizar();
    });
    selecionarTudo.addEventListener('change', () => visiveis().forEach(cb => { cb.checked = selecionarTudo.checked; }));
    caixas().forEach(cb => cb.addEventListener('change', sincronizar));
  },

  /* Contexto: liga Limpar/Cancelar/OK. Não retorna nada. */
  _ligarRodape(popover, valores, aoAplicar) {
    popover.querySelector('[data-fc-action="cancelar"]').addEventListener('click', () => this.fechar());
    popover.querySelector('[data-fc-action="limpar"]').addEventListener('click', () => {
      this.fechar();
      aoAplicar(null);
    });
    popover.querySelector('[data-fc-action="ok"]').addEventListener('click', () => {
      const escolhidos = new Set(Array.from(popover.querySelectorAll('.th-filter-item input[type=checkbox]'))
        .filter(cb => cb.checked).map(cb => cb.value));
      const cobreTudo = valores.length > 0 && escolhidos.size === valores.length;
      this.fechar();
      aoAplicar(cobreTudo ? null : escolhidos);
    });
  },

  /* Contexto: fecha em Esc ou clique fora do popover/âncora. Não retorna nada. */
  _ligarFechamento(popover, ancora) {
    this._fecharHandler = e => {
      if (e.type === 'keydown') { if (e.key === 'Escape') this.fechar(); return; }
      if (!popover.contains(e.target) && !ancora.contains(e.target)) this.fechar();
    };
    document.addEventListener('mousedown', this._fecharHandler, true);
    document.addEventListener('keydown', this._fecharHandler, true);
  },
};
