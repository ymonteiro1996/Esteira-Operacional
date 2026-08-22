/* Anomalias.quadro — carrega as anomalias (+ status atual das demandas vinculadas) e desenha o board inteiro.
   Object.assign(Anomalias, {...}) — CLAUDE.md §4.

   [2026-08-21, decisão de design sem regra explícita — ver cabeçalho de
   pages/anomalias.py] O board agrupa por CRITICIDADE (3 colunas FIXAS:
   Crítico/Atenção/Observação), não por responsável como em Demandas. Com
   só 3 valores fixos (ao contrário dos N responsáveis dinâmicos de
   Demandas), este arquivo já inclui a construção de coluna e o
   arrastar-e-soltar entre colunas (que em Demandas moram em colunas.js/
   arrastar.js separados) — não há colunas ocultáveis/persistidas em
   localStorage nem menu de "+ coluna" pra justificar arquivos à parte
   aqui. */
Object.assign(Anomalias, {

  /* Contexto:
     Busca as anomalias na API (já filtradas/ordenadas pelo backend, ver
     pages/anomalias.py::listar_anomalias) E, em paralelo, a lista
     COMPLETA de demandas (GET /api/demandas, sem filtro) — usada só para
     indexar o STATUS atual de cada demanda vinculada por id, numa única
     chamada geral por refresh do board (não 1 chamada por card, pedido
     explícito do requisito). Chamada no boot e a cada mudança de filtro/
     vínculo. Não retorna nada.

     Pseudocódigo:
       1. Monta a querystring com os filtros correntes de Anomalias.
       2. Dispara as 2 fetches em paralelo (Promise.all).
       3. Guarda as anomalias + o mapa por id (usado por editar/comentar/
          excluir/vincular/drag&drop) e o mapa de demandas por id (usado
          só para exibir status nos badges de vínculo).
       4. Redesenha o board (renderizarQuadro). */
  async carregarAnomalias() {
    const params = this.montarParametrosFiltro();
    const [respostaAnomalias, respostaDemandas] = await Promise.all([
      fetch('/api/anomalias?' + params.toString()),
      fetch('/api/demandas'),
    ]);
    const anomalias = await respostaAnomalias.json();
    const demandas = await respostaDemandas.json();

    this.anomalias = anomalias;
    this.mapaPorId = {};
    anomalias.forEach(a => { this.mapaPorId[a.id] = a; });

    this.mapaDemandasPorId = {};
    demandas.forEach(d => { this.mapaDemandasPorId[d._id] = d; });

    this.renderizarQuadro();
  },

  /* Contexto: separa as anomalias visíveis em baldes por criticidade —
     cada uma das 3 colunas fixas (CRITICIDADES, ver state.js/pages/
     anomalias.py) recebe exatamente as anomalias com aquele valor;
     anomalias com criticidade vazia/fora do enum (não deveria acontecer,
     o backend valida, mas por segurança) caem no balde
     "__sem_criticidade__". Retorna dict {criticidade: [anomalias]}. */
  agruparPorCriticidade(anomalias) {
    const baldes = { __sem_criticidade__: [] };
    this.opcoes.criticidades.forEach(c => { baldes[c] = []; });
    anomalias.forEach(a => {
      (baldes[a.criticidade] ? baldes[a.criticidade] : baldes.__sem_criticidade__).push(a);
    });
    return baldes;
  },

  /* Contexto:
     Recalcula e desenha a barra de métricas a partir de TODAS as
     anomalias carregadas (não só as visíveis pelo filtro "mostrar
     concluídas/canceladas" — mesma regra de Demandas). Chamada por
     renderizarQuadro(). Não retorna nada.

     Pseudocódigo:
       1. Conta total/críticas/em atenção/concluídas/sem nenhuma demanda
          vinculada (métrica nova desta tela — sinaliza risco operacional
          de anomalia sem encaminhamento).
       2. Desenha os chips. */
  renderizarMetricas(anomalias) {
    const total = anomalias.length;
    const criticas = anomalias.filter(a => a.criticidade === 'Crítico').length;
    const atencao = anomalias.filter(a => a.criticidade === 'Atenção').length;
    const concluidas = anomalias.filter(a => a.status === 'Concluído').length;
    const semVinculo = anomalias.filter(a => !(a.demandas_vinculadas || []).length).length;

    document.getElementById('an-metrics').innerHTML = `
      <span class="an-met-chip">📋 <b>${total}</b> total</span>
      ${criticas ? `<span class="an-met-chip critico">🔴 <b>${criticas}</b> críticas</span>` : ''}
      ${atencao ? `<span class="an-met-chip atencao">🟡 <b>${atencao}</b> em atenção</span>` : ''}
      <span class="an-met-chip done">✅ <b>${concluidas}</b> concluídas</span>
      ${semVinculo
        ? `<span class="an-met-chip semvinculo">🔗 <b>${semVinculo}</b> sem demanda vinculada</span>`
        : `<span class="an-met-chip ok">✓ todas com demanda vinculada</span>`}
    `;
  },

  /* Contexto:
     Reordena a lista visível conforme o <select> "an-f-ordenar"
     (melhoria 3, injetado por filtros.js::injetarControlesFiltrosNovos)
     — "criticidade" (padrão) preserva a ordem que já veio do backend
     (criticidade > status > cliente, ver pages/anomalias.py::
     _ordenar_anomalias); "antigas"/"atualizadas" reordenam por data
     dentro de cada coluna (o agrupamento por criticidade continua
     valendo, a ordenação só muda a posição RELATIVA dentro do balde).
     Chamada por renderizarQuadro(). Retorna nova lista ordenada (não
     modifica `lista`). */
  ordenarParaExibicao(lista) {
    const modo = document.getElementById('an-f-ordenar')?.value || 'criticidade';
    const copia = [...lista];
    if (modo === 'antigas') {
      copia.sort((a, b) => new Date(a.ocorrido_em || a.created_at) - new Date(b.ocorrido_em || b.created_at));
    } else if (modo === 'atualizadas') {
      copia.sort((a, b) => new Date(a.updated_at) - new Date(b.updated_at));
    }
    return copia;
  },

  /* Contexto:
     Redesenha o board inteiro (métricas + 3 colunas + cartões) a partir
     de `this.anomalias` — chamada por carregarAnomalias() e por qualquer
     ação que mude o conjunto visível (toggle "mostrar concluídas/
     canceladas", "só sem demanda vinculada" — melhoria 3 — ou o <select>
     de ordenação). Não retorna nada.

     Pseudocódigo:
       1. Recalcula as métricas sobre TODAS as anomalias carregadas.
       2. Atualiza as opções do filtro de tag (melhoria 5) com as tags
          realmente em uso.
       3. Aplica o filtro "mostrar concluídas/canceladas" (esconde
          Concluído/Cancelado por padrão) e, se marcado, "só sem demanda
          vinculada" (melhoria 3).
       4. Reordena conforme o <select> de ordenação (melhoria 3).
       5. Atualiza o rótulo de contagem (com "(N ocultas)" quando houver).
       6. Agrupa por criticidade e desenha as 3 colunas fixas, na ordem
          de CRITICIDADES (Crítico primeiro). */
  renderizarQuadro() {
    this.renderizarMetricas(this.anomalias);
    this.atualizarOpcoesFiltroTag();

    const mostrarConcluidas = document.getElementById('an-f-show-done').checked;
    const somenteSemVinculo = document.getElementById('an-f-somente-sem-vinculo')?.checked;
    const statusOcultos = new Set(['Concluído', 'Cancelado']);
    let visiveis = mostrarConcluidas ? this.anomalias : this.anomalias.filter(a => !statusOcultos.has(a.status));
    if (somenteSemVinculo) {
      visiveis = visiveis.filter(a => !(a.demandas_vinculadas || []).length);
    }
    visiveis = this.ordenarParaExibicao(visiveis);

    const ocultas = this.anomalias.length - visiveis.length;
    document.getElementById('an-count-label').textContent =
      (visiveis.length === 1 ? '1 anomalia' : `${visiveis.length} anomalias`) +
      (ocultas > 0 ? ` (${ocultas} ocultas)` : '');

    const baldes = this.agruparPorCriticidade(visiveis);
    const board = document.getElementById('an-board');
    board.innerHTML = '';
    this.opcoes.criticidades.forEach(criticidade => board.appendChild(this.construirColuna(criticidade, baldes[criticidade] || [])));
    if (baldes.__sem_criticidade__.length) {
      board.appendChild(this.construirColuna('__sem_criticidade__', baldes.__sem_criticidade__));
    }
  },

  /* Contexto:
     Monta o elemento <div> de 1 coluna do board (cabeçalho com pontinho
     colorido + nome + contagem, zona de drop, cartões, botão "+
     Anomalia") — equivalente a buildColumn()/colunas.js de Demandas,
     simplificado pra 3 colunas fixas (sem botão de ocultar/menu de
     colunas ocultas, que não fazem sentido aqui). Retorna o
     HTMLDivElement pronto pra anexar ao board. */
  construirColuna(criticidade, anomaliasDaColuna) {
    const ehSemCriticidade = criticidade === '__sem_criticidade__';
    const nomeExibicao = ehSemCriticidade ? 'Sem criticidade' : criticidade;
    const classeDot = this.CRITICIDADE_CLS[criticidade] || '';

    const coluna = document.createElement('div');
    coluna.className = 'an-col';
    coluna.dataset.criticidade = criticidade;
    coluna.innerHTML = `
      <div class="an-col-header">
        <span class="an-col-dot ${classeDot}"></span>
        <span class="an-col-nome">${this.esc(nomeExibicao)}</span>
        <span class="an-col-contagem">${anomaliasDaColuna.length}</span>
      </div>
    `;

    const zonaDrop = document.createElement('div');
    zonaDrop.className = 'an-cartoes';
    zonaDrop.dataset.criticidade = criticidade;
    zonaDrop.addEventListener('dragover', e => this.aoArrastarSobre(e));
    zonaDrop.addEventListener('dragleave', e => this.aoSairDoArrasto(e));
    zonaDrop.addEventListener('drop', e => this.aoSoltar(e));
    anomaliasDaColuna.forEach(a => zonaDrop.appendChild(this.construirCartao(a)));
    coluna.appendChild(zonaDrop);

    if (!ehSemCriticidade) {
      const botaoNova = document.createElement('button');
      botaoNova.className = 'an-add-btn';
      botaoNova.textContent = '+ Anomalia';
      botaoNova.addEventListener('click', () => this.abrirModalNova(criticidade));
      coluna.appendChild(botaoNova);
    }

    return coluna;
  },

  // ── Arrastar-e-soltar entre colunas (reatribui a criticidade) ────────────

  /* Contexto: início do arraste de um cartão — guarda o id sendo movido
     e aplica o feedback visual. Chamada pelo listener dragstart do
     cartão (ligado em cartoes.js). Não retorna nada. */
  aoIniciarArrasto(e) {
    this._idArrastado = e.currentTarget.dataset.id;
    e.currentTarget.classList.add('an-dragging');
    e.dataTransfer.effectAllowed = 'move';
  },

  /* Contexto: fim do arraste (solto ou cancelado) — remove o feedback
     visual. Não retorna nada. */
  aoFinalizarArrasto(e) {
    e.currentTarget.classList.remove('an-dragging');
  },

  /* Contexto: cartão passando por cima de uma zona de drop — permite o
     drop e destaca a coluna-alvo. Não retorna nada. */
  aoArrastarSobre(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    e.currentTarget.classList.add('an-drag-over');
  },

  /* Contexto: cartão saindo de cima de uma zona de drop sem soltar —
     remove o destaque. Não retorna nada. */
  aoSairDoArrasto(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove('an-drag-over');
  },

  /* Contexto:
     Soltura do cartão numa coluna — reatribui a "criticidade" da
     anomalia pra criticidade da coluna-alvo via PATCH, depois recarrega
     o board. Chamada pelo listener drop da zona de cartões. Não retorna
     nada.

     Pseudocódigo:
       1. Sem nenhum id em arraste, ou soltando na coluna "sem
          criticidade" (não é um valor válido pra gravar), sai cedo.
       2. PATCH /api/anomalias/<id> {criticidade: <criticidade da
          coluna>}.
       3. Recarrega o board inteiro. */
  async aoSoltar(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('an-drag-over');
    const criticidade = e.currentTarget.dataset.criticidade;
    if (!this._idArrastado || criticidade === '__sem_criticidade__') { this._idArrastado = null; return; }
    await fetch(`/api/anomalias/${this._idArrastado}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ criticidade }),
    });
    this._idArrastado = null;
    this.carregarAnomalias();
  },
});
