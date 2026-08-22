/* ControleDemandas.cartoes — monta o cartão de uma demanda (badges, barra de progresso, ações) e o controle de progresso inline.
   Object.assign(ControleDemandas, {...}) — CLAUDE.md §4. */
Object.assign(ControleDemandas, {

  /* Contexto: detecta se uma demanda está atrasada — deadline no formato
     "DD/MM/AAAA" no passado E status ainda não terminal (Concluído/
     Cancelado). Deadlines em texto livre (ex.: "TBD", "Diário", "4T2026")
     nunca disparam atraso — tradução exata de isOverdue() da origem.
     Retorna boolean. */
  estaAtrasada(demanda) {
    if (['Concluído', 'Cancelado'].includes(demanda.status)) return false;
    const m = (demanda.deadline || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (!m) return false;
    const dataLimite = new Date(+m[3], +m[2] - 1, +m[1]);
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    return dataLimite < hoje;
  },

  /* Contexto:
     Monta o cartão de 1 demanda (barra de progresso com botões −/+, badge
     de cliente + sinalizador de atraso, ações de comentar/editar/excluir,
     texto da demanda, badge de status + deadline) — tradução de
     buildCard() da origem. Chamada por construirColuna() 1 vez por
     demanda visível. Retorna o HTMLDivElement pronto, já com drag&drop e
     ações ligados.

     Pseudocódigo:
       1. Resolve as classes de cor (prioridade define a borda esquerda +
          o "pontinho"; cliente/status têm badge próprio) com o MESMO
          fallback da origem (cliente/status desconhecidos caem em
          kd-cl-beehus/kd-st-pendente).
       2. Monta o HTML interno (progresso, cabeçalho com cliente+atraso+
          ações, texto da demanda, rodapé com status+deadline).
       3. Liga dragstart/dragend (arrastar.js) e delegação de clique nas
          ações ([data-action]). */
  construirCartao(demanda) {
    const classePrio = this.PRIO_CLS[demanda.prioridade] || 'kd-prio-none';
    const ehTerminal = demanda.status === 'Concluído' || demanda.status === 'Cancelado';
    const ehOnHold = demanda.status === 'On Hold';
    const classeDim = (ehTerminal || ehOnHold) ? ' kd-dim' : '';
    const classeTexto = ehTerminal ? ' kd-concluida' : ehOnHold ? ' kd-hold' : '';
    const classeCliente = this.CLIENT_CLS[demanda.cliente] || 'kd-cl-beehus';
    const classeStatus = this.STATUS_CLS[demanda.status] || 'kd-st-pendente';
    const classeDot = this.PRIO_DOT[demanda.prioridade] || 'kd-dot-none';
    const numComentarios = (demanda.comments || []).length;

    const cartao = document.createElement('div');
    cartao.className = `kd-card ${classePrio}${classeDim}`;
    cartao.draggable = true;
    cartao.dataset.id = demanda._id;
    cartao.addEventListener('dragstart', e => this.aoIniciarArrasto(e));
    cartao.addEventListener('dragend', e => this.aoFinalizarArrasto(e));

    const progresso = parseInt(demanda.progress, 10) || 0;
    const corProgresso = progresso >= 100 ? '#34d399' : progresso >= 70 ? '#60a5fa' : progresso >= 30 ? '#fbbf24' : '#f87171';
    const sinalAtraso = this.estaAtrasada(demanda) ? '<span class="kd-atraso" title="Atrasada">⚠️</span>' : '';

    cartao.innerHTML = `
      <div class="kd-prog-row">
        <button class="kd-prog-btn" data-action="prog-dec" title="−5%">−</button>
        <div class="kd-prog-track"><div class="kd-prog-fill" style="width:${progresso}%;background:${corProgresso}"></div></div>
        <span class="kd-prog-pct" style="color:${progresso > 0 ? corProgresso : '#9ca3af'}">${progresso}%</span>
        <button class="kd-prog-btn" data-action="prog-inc" title="+5%">+</button>
      </div>
      <div class="kd-card-top">
        <div class="kd-card-top-left">
          <span class="kd-dot ${classeDot}"></span>
          <span class="kd-badge ${classeCliente}">${this.esc(demanda.cliente)}</span>
          ${sinalAtraso}
        </div>
        <div class="kd-actions">
          <button class="kd-action-btn" data-action="comentar" title="Comentários">💬${numComentarios > 0 ? `<span style="color:#3b82f6">${numComentarios}</span>` : ''}</button>
          <button class="kd-action-btn" data-action="editar" title="Editar">✏️</button>
          <button class="kd-action-btn" data-action="excluir" title="Remover">🗑</button>
        </div>
      </div>
      <p class="kd-card-texto${classeTexto}" title="${this.esc(demanda.demanda)}">${this.esc(demanda.demanda)}</p>
      <div class="kd-card-bottom">
        <span class="kd-badge ${classeStatus}">${this.esc(demanda.status)}</span>
        ${demanda.deadline ? `<span class="kd-deadline">${this.esc(demanda.deadline)}</span>` : ''}
      </div>
    `;

    cartao.addEventListener('click', e => {
      const botao = e.target.closest('[data-action]');
      if (!botao) return;
      e.stopPropagation();
      const acao = botao.dataset.action;
      if (acao === 'comentar') this.abrirModalComentarios(demanda._id);
      if (acao === 'editar') this.abrirModalEditar(demanda._id);
      if (acao === 'excluir') this.abrirModalExcluir(demanda._id);
      if (acao === 'prog-dec') this.ajustarProgresso(demanda._id, -5);
      if (acao === 'prog-inc') this.ajustarProgresso(demanda._id, 5);
    });

    return cartao;
  },

  /* Contexto:
     Ajusta o progresso (0-100, passo de 5) de uma demanda pelos botões
     −/+ do cartão — atualização otimista (redesenha só o cartão na hora)
     seguida de PATCH em segundo plano, mesma técnica de adjustProgress()
     na origem. Chamada pelos botões prog-dec/prog-inc do cartão. Não
     retorna nada.

     Pseudocódigo:
       1. Acha a demanda no mapa local; sem ela, não faz nada.
       2. Calcula o novo valor (clamp 0-100); sem mudança, sai cedo.
       3. Atualiza o estado local e substitui o cartão na tela na hora
          (sem esperar a resposta da rede) + recalcula as métricas.
       4. Envia o PATCH em segundo plano (best-effort). */
  async ajustarProgresso(id, delta) {
    const demanda = this.mapaPorId[id];
    if (!demanda) return;
    const valorAtual = parseInt(demanda.progress, 10) || 0;
    const novoValor = Math.max(0, Math.min(100, valorAtual + delta));
    if (novoValor === valorAtual) return;
    demanda.progress = novoValor;

    const cartaoAntigo = document.querySelector(`.kd-card[data-id="${id}"]`);
    if (cartaoAntigo) cartaoAntigo.replaceWith(this.construirCartao(demanda));
    this.renderizarMetricas(this.demandas);

    fetch(`/api/demandas/${id}`, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({progress: novoValor}),
    });
  },
});
