/* ControleDemandas.quadro — carrega as demandas da API e orquestra o redesenho do Kanban inteiro.
   Object.assign(ControleDemandas, {...}) — CLAUDE.md §4. */
Object.assign(ControleDemandas, {

  /* Contexto: lê as colunas visíveis (responsáveis) do localStorage — cada
     navegador pode esconder/reordenar colunas sem afetar o dado real
     (mesmo comportamento da origem, chave "kb_columns_v2" lá, própria
     aqui). Retorna lista de nomes.

     Pseudocódigo:
       1. Tenta ler e parsear do localStorage.
       2. Formato inválido ou vazio -> parte da lista completa de
          responsáveis (opcoes.responsaveis). */
  carregarColunasSalvas() {
    try {
      const salvas = JSON.parse(localStorage.getItem(this.LS_CHAVE_COLUNAS) || 'null');
      if (Array.isArray(salvas) && salvas.length) return salvas;
    } catch (_) { /* localStorage corrompido - ignora e usa o padrão */ }
    return [...this.opcoes.responsaveis];
  },

  /* Contexto: persiste a lista corrente de colunas visíveis no
     localStorage — chamada sempre que uma coluna é ocultada/adicionada.
     Não retorna nada. */
  salvarColunas() {
    localStorage.setItem(this.LS_CHAVE_COLUNAS, JSON.stringify(this.colunas));
  },

  /* Contexto:
     Busca as demandas na API (já filtradas/ordenadas pelo backend, ver
     pages/controle_demandas.py::listar_demandas) e reconstrói o quadro
     inteiro. Chamada no boot e a cada mudança de filtro. Não retorna
     nada.

     Pseudocódigo:
       1. Monta a querystring com os filtros correntes.
       2. GET /api/demandas?... .
       3. Guarda a lista e o mapa por id (usado por editar/comentar/
          excluir/drag&drop/progresso).
       4. Redesenha o quadro (renderizarQuadro). */
  async carregarDemandas() {
    const params = this.montarParametrosFiltro();
    const resposta = await fetch('/api/demandas?' + params.toString());
    const demandas = await resposta.json();
    this.demandas = demandas;
    this.mapaPorId = {};
    demandas.forEach(d => { this.mapaPorId[d._id] = d; });
    this.renderizarQuadro();
  },

  /* Contexto: separa as demandas visíveis em baldes por coluna
     (responsável) — cada demanda vai pra PRIMEIRA coluna cujo nome
     apareça em `responsavel` (cobre responsáveis compostos tipo
     "Yuri/Hulgo": mesma regra "assignToColumns" da origem). Demandas sem
     match caem no balde "__sem_responsavel__". Retorna dict
     {coluna: [demandas]}.

     Pseudocódigo:
       1. Cria 1 balde vazio por coluna + o balde "sem responsável".
       2. Para cada demanda, acha a 1ª coluna cujo nome está contido
          (case-insensitive) no campo responsavel; sem match, cai no
          balde "sem responsável". */
  agruparPorColuna(demandas) {
    const baldes = { __sem_responsavel__: [] };
    this.colunas.forEach(pessoa => { baldes[pessoa] = []; });
    demandas.forEach(d => {
      const responsavel = (d.responsavel || '').toLowerCase();
      const coluna = this.colunas.find(p => responsavel.includes(p.toLowerCase()));
      (coluna ? baldes[coluna] : baldes.__sem_responsavel__).push(d);
    });
    return baldes;
  },

  /* Contexto:
     Redesenha o quadro inteiro (métricas + colunas + cartões) a partir de
     `this.demandas` — chamada por carregarDemandas() e por qualquer ação
     que mude o conjunto visível (toggle "mostrar concluídos", ocultar/
     adicionar coluna). Não retorna nada.

     Pseudocódigo:
       1. Recalcula as métricas sobre TODAS as demandas carregadas (não só
          as visíveis — o filtro "mostrar concluídos" só esconde cartão,
          não deve distorcer o contador "total", mesma regra da origem).
       2. Aplica o filtro "mostrar concluídos" (esconde Concluído/
          Cancelado por padrão).
       3. Atualiza o rótulo de contagem (com "(N ocultas)" quando houver).
       4. Agrupa por coluna e desenha: "Sem Responsável" primeiro, depois
          cada coluna configurada, depois o botão "+ pessoa" com o menu
          das colunas ocultas. */
  renderizarQuadro() {
    this.renderizarMetricas(this.demandas);

    const mostrarConcluidos = document.getElementById('kd-f-show-done').checked;
    const statusOcultos = new Set(['Concluído', 'Cancelado']);
    const visiveis = mostrarConcluidos ? this.demandas : this.demandas.filter(d => !statusOcultos.has(d.status));

    const ocultos = this.demandas.length - visiveis.length;
    document.getElementById('kd-count-label').textContent =
      (visiveis.length === 1 ? '1 demanda' : `${visiveis.length} demandas`) +
      (!mostrarConcluidos && ocultos > 0 ? ` (${ocultos} ocultas)` : '');

    const baldes = this.agruparPorColuna(visiveis);
    const board = document.getElementById('kd-board');
    board.innerHTML = '';
    board.appendChild(this.construirColuna('__sem_responsavel__', baldes.__sem_responsavel__, true));
    this.colunas.forEach(pessoa => board.appendChild(this.construirColuna(pessoa, baldes[pessoa] || [], false)));
    board.appendChild(this.construirBotaoAdicionarColuna());
  },
});
