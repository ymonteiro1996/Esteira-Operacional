/* ControleDemandas.arrastar — drag&drop de cartões entre colunas (reatribui o responsável).
   Object.assign(ControleDemandas, {...}) — CLAUDE.md §4. */
Object.assign(ControleDemandas, {

  /* Contexto: início do arraste de um cartão — guarda o id sendo movido
     em _idArrastado e aplica o feedback visual (opacidade). Chamada pelo
     listener dragstart do cartão. Não retorna nada. */
  aoIniciarArrasto(e) {
    this._idArrastado = e.currentTarget.dataset.id;
    e.currentTarget.classList.add('kd-dragging');
    e.dataTransfer.effectAllowed = 'move';
  },

  /* Contexto: fim do arraste (solto ou cancelado) — remove o feedback
     visual. Chamada pelo listener dragend do cartão. Não retorna nada. */
  aoFinalizarArrasto(e) {
    e.currentTarget.classList.remove('kd-dragging');
  },

  /* Contexto: cartão passando por cima de uma zona de drop — permite o
     drop e destaca a coluna-alvo. Chamada pelo listener dragover da zona
     de cartões. Não retorna nada. */
  aoArrastarSobre(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    e.currentTarget.classList.add('kd-drag-over');
  },

  /* Contexto: cartão saindo de cima de uma zona de drop sem soltar —
     remove o destaque (só quando realmente sai da zona, não em cada
     sub-elemento interno). Chamada pelo listener dragleave. Não retorna
     nada. */
  aoSairDoArrasto(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove('kd-drag-over');
  },

  /* Contexto:
     Soltura do cartão numa coluna — reatribui o campo "responsavel" da
     demanda pro nome da coluna-alvo (string vazia se for a coluna "Sem
     Responsável") via PATCH, depois recarrega o quadro — tradução de
     onDrop() da origem. Chamada pelo listener drop da zona de cartões.
     Não retorna nada.

     Pseudocódigo:
       1. Sem nenhum id em arraste, sai cedo.
       2. PATCH /api/demandas/<id> {responsavel: <nome da coluna ou "">}.
       3. Recarrega o quadro inteiro (garante que a demanda reaparece na
          coluna certa, mesma lógica de agrupamento por substring de
          agruparPorColuna()). */
  async aoSoltar(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('kd-drag-over');
    if (!this._idArrastado) return;
    const pessoa = e.currentTarget.dataset.pessoa;
    const novoResponsavel = pessoa === '__sem_responsavel__' ? '' : pessoa;
    await fetch(`/api/demandas/${this._idArrastado}`, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({responsavel: novoResponsavel}),
    });
    this._idArrastado = null;
    this.carregarDemandas();
  },
});
