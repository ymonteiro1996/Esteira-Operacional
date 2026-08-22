/* Anomalias.cartoes — monta o cartão de 1 anomalia (badges, vínculos de demanda, ações).
   Object.assign(Anomalias, {...}) — CLAUDE.md §4.

   [2026-08-22] Onda 1/2 do plano de melhorias: aging (badge "há Nd",
   melhoria 1), cartão órfão (anel tracejado + pílula, melhoria 2), tags
   (chips, melhoria 5), impacto (linha curta, melhoria 8) e recorrência
   (pílula "Nª vez", melhoria 6) — cores reaproveitam os tokens --sb-*
   já existentes em static/css/tema_escuro.css (com fallback hex pro
   valor claro original), então nenhum token novo foi necessário lá. */
Object.assign(Anomalias, {

  /* Contexto:
     Resolve a cor/label de status de UMA demanda vinculada, a partir do
     mapa carregado em bloco por carregarAnomalias() (GET /api/demandas
     geral, 1x por refresh do board — nunca 1 fetch por card, ver
     quadro.js). Usada por construirCartao() e por
     renderizarVinculosNoModal() (modais.js). Retorna
     {texto, classeStatus} — classeStatus vazia se a demanda não for mais
     encontrada (pode ter sido removida do lado de Demandas). */
  resolverStatusDemandaVinculada(demandaId) {
    const demanda = this.mapaDemandasPorId[demandaId];
    if (!demanda) return { texto: 'demanda não encontrada', classeStatus: '' };
    return { texto: demanda.status || '', classeStatus: this.STATUS_CLS[demanda.status] || 'an-st-pendente' };
  },

  /* Contexto:
     Monta o badge pequeno e clicável de 1 vínculo de demanda dentro do
     cartão (horizonte + status atual da demanda, cor conforme o status)
     — clicar nele leva à aba Controle de Demandas (ver
     abrirDemandaVinculada() abaixo). Retorna string HTML. */
  construirBadgeVinculoMini(vinculo) {
    const { texto, classeStatus } = this.resolverStatusDemandaVinculada(vinculo.demanda_id);
    const label = this.HORIZONTE_LABEL[vinculo.horizonte] || vinculo.horizonte;
    const corDot = { 'an-st-pendente': '#9ca3af', 'an-st-em-andamento': '#1d4ed8', 'an-st-concluido': '#15803d', 'an-st-cancelado': '#9ca3af', 'an-st-on-hold': '#b45309' }[classeStatus] || '#9ca3af';
    return `<span class="an-vinc-badge-mini" data-demanda-id="${this.esc(vinculo.demanda_id)}" title="${this.esc(texto)}"><span class="an-vinc-dot" style="background:${corDot}"></span>${this.esc(label)}</span>`;
  },

  /* Contexto:
     Calcula a posição ordinal (Nª vez) desta anomalia dentro do grupo de
     anomalias do MESMO cliente que compartilham ao menos 1 tag,
     ocorridas nos últimos 30 dias contados a partir da data desta
     anomalia (ocorrido_em || created_at) — sinal de recorrência
     (melhoria 6, Onda 2), cálculo 100% client-side sobre `this.
     anomalias` (já carregada, sem chamada nova) — fronteira clássica
     ITIL entre incidente isolado e problema recorrente. Sem tags, nunca
     há recorrência (não daria pra saber que são "o mesmo tipo" de
     anomalia). Chamada por construirCartao(). Retorna inteiro >=1 (1 =
     ocorrência isolada, sem pílula no cartão). */
  calcularRecorrencia(anomalia) {
    const tags = anomalia.tags || [];
    if (!tags.length) return 1;
    const dataRef = new Date(anomalia.ocorrido_em || anomalia.created_at).getTime();
    if (isNaN(dataRef)) return 1;
    const grupo = this.anomalias.filter(outra => {
      if (outra.cliente !== anomalia.cliente) return false;
      const outrasTags = outra.tags || [];
      if (!outrasTags.some(t => tags.includes(t))) return false;
      const dataOutra = new Date(outra.ocorrido_em || outra.created_at).getTime();
      if (isNaN(dataOutra)) return false;
      const diffDias = (dataRef - dataOutra) / 86400000;
      return diffDias >= 0 && diffDias <= 30;
    });
    grupo.sort((a, b) => new Date(a.ocorrido_em || a.created_at) - new Date(b.ocorrido_em || b.created_at));
    const posicao = grupo.findIndex(a => a.id === anomalia.id);
    return posicao === -1 ? grupo.length : posicao + 1;
  },

  /* Contexto:
     Monta o cartão de 1 anomalia (badge de cliente + status + aging,
     título, descrição truncada, tags, responsável, badges de demandas
     vinculadas, ações de comentar/editar/excluir) — tradução do padrão
     de ControleDemandas.construirCartao(), sem barra de progresso (campo
     que não existe no schema de Anomalias). Chamada por construirColuna()
     1 vez por anomalia visível (quadro.js). Retorna o HTMLDivElement
     pronto, já com drag&drop e ações ligados.

     Pseudocódigo:
       1. Resolve as classes de cor (criticidade define a borda esquerda;
          cliente/status têm badge próprio) com fallback pra valores
          desconhecidos.
       2. Resolve aging (melhoria 1), condição de órfã (melhoria 2) e
          recorrência (melhoria 6).
       3. Monta o HTML interno.
       4. Liga dragstart/dragend (quadro.js) e delegação de clique nas
          ações ([data-action]) + nos badges de vínculo. */
  construirCartao(anomalia) {
    const classeCrit = this.CRITICIDADE_CLS[anomalia.criticidade] || '';
    const ehTerminal = anomalia.status === 'Concluído' || anomalia.status === 'Cancelado';
    const classeDim = ehTerminal ? ' an-dim' : '';
    const classeTitulo = ehTerminal ? ' an-concluida' : '';
    const classeCliente = this.CLIENT_CLS[anomalia.cliente] || 'an-cl-beehus';
    const classeStatus = this.STATUS_CLS[anomalia.status] || 'an-st-pendente';
    const numComentarios = (anomalia.comments || []).length;
    const vinculos = anomalia.demandas_vinculadas || [];
    const tags = anomalia.tags || [];
    const aging = this.resolverFaixaAging(anomalia);
    const orfa = this.ehAnomaliaOrfa(anomalia);
    const recorrencia = this.calcularRecorrencia(anomalia);

    const cartao = document.createElement('div');
    cartao.className = `an-card ${classeCrit}${classeDim}${orfa ? ' an-orfa' : ''}`;
    cartao.draggable = true;
    cartao.dataset.id = anomalia.id;
    cartao.addEventListener('dragstart', e => this.aoIniciarArrasto(e));
    cartao.addEventListener('dragend', e => this.aoFinalizarArrasto(e));

    cartao.innerHTML = `
      <div class="an-card-top">
        <div class="an-card-top-left">
          <span class="an-badge ${classeCliente}">${this.esc(anomalia.cliente)}</span>
          <span class="an-badge ${classeStatus}">${this.esc(anomalia.status)}</span>
          <span class="an-aging ${aging.classe}" title="${this.esc(anomalia.ocorrido_em ? 'ocorrido em ' + anomalia.ocorrido_em : 'criada em ' + anomalia.created_at)}">${aging.texto}</span>
        </div>
        <div class="an-actions">
          <button class="an-action-btn" data-action="comentar" title="Comentários/histórico">💬${numComentarios > 0 ? `<span style="color:#3b82f6">${numComentarios}</span>` : ''}</button>
          <button class="an-action-btn" data-action="editar" title="Editar">✏️</button>
          <button class="an-action-btn" data-action="excluir" title="Remover">🗑</button>
        </div>
      </div>
      ${orfa ? `<span class="an-orfa-pilula">⚠ sem ação vinculada</span>` : ''}
      ${recorrencia >= 2 ? `<span class="an-recorrencia-pilula" title="Anomalias do mesmo cliente com tag em comum nos últimos 30 dias">↻ ${recorrencia}ª vez</span>` : ''}
      <p class="an-card-titulo${classeTitulo}" title="${this.esc(anomalia.titulo)}">${this.esc(anomalia.titulo)}</p>
      ${anomalia.impacto ? `<p class="an-card-impacto" title="${this.esc(anomalia.impacto)}">💥 ${this.esc(anomalia.impacto)}</p>` : ''}
      ${anomalia.descricao ? `<p class="an-card-descricao" title="${this.esc(anomalia.descricao)}">${this.esc(anomalia.descricao)}</p>` : ''}
      ${tags.length ? `<div class="an-card-tags">${tags.map(t => `<span class="an-tag-chip">${this.esc(t)}</span>`).join('')}</div>` : ''}
      <div class="an-card-bottom">
        ${anomalia.responsavel ? `<span class="an-resp">👤 ${this.esc(anomalia.responsavel)}</span>` : ''}
      </div>
      ${vinculos.length ? `<div class="an-card-vinculos">${vinculos.map(v => this.construirBadgeVinculoMini(v)).join('')}</div>` : ''}
    `;

    cartao.addEventListener('click', e => {
      const badgeVinculo = e.target.closest('[data-demanda-id]');
      if (badgeVinculo) {
        e.stopPropagation();
        this.abrirDemandaVinculada(badgeVinculo.dataset.demandaId);
        return;
      }
      const botao = e.target.closest('[data-action]');
      if (!botao) return;
      e.stopPropagation();
      const acao = botao.dataset.action;
      if (acao === 'comentar') this.abrirModalComentarios(anomalia.id);
      if (acao === 'editar') this.abrirModalEditar(anomalia.id);
      if (acao === 'excluir') this.abrirModalExcluir(anomalia.id);
    });

    return cartao;
  },

  /* Contexto:
     Leva o usuário até a demanda vinculada — troca pra aba "Controle de
     Demandas" (reaproveita o próprio botão de aba, que já tem TODOS os
     listeners de troca de aba anexados, inclusive o desta tela ocultando
     #panel-anomalias) e pré-preenche a busca do Kanban de Demandas com um
     trecho do texto da demanda, pra ela aparecer filtrada na tela —
     "scroll/link para a aba Controle de Demandas" pedido no requisito.
     Chamada ao clicar num badge de vínculo do cartão ou da lista do modal
     de edição. Não retorna nada. */
  abrirDemandaVinculada(demandaId) {
    const demanda = this.mapaDemandasPorId[demandaId];
    const botaoAbaDemandas = document.getElementById('tab-demandas');
    if (!botaoAbaDemandas) return;
    botaoAbaDemandas.click();
    // [nota] ControleDemandas é um `const` de topo de arquivo — não vira
    // propriedade de `window` (diferença de `var`/function declarations).
    // Checar `window.ControleDemandas` aqui daria sempre falso; o guard
    // correto é `typeof ControleDemandas !== 'undefined'`.
    if (demanda && typeof ControleDemandas !== 'undefined') {
      const campoBusca = document.getElementById('kd-f-search');
      if (campoBusca) {
        campoBusca.value = this.truncar(demanda.demanda || '', 40);
        ControleDemandas.carregarDemandas();
      }
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },
});
