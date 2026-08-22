/* Anomalias.vinculos — os 2 botões "Vincular demanda de curto/longo prazo": busca por demanda existente OU cria uma nova e já vincula.
   Reaproveita as rotas HOMOLOGADAS do blueprint de Demandas
   (GET/POST /api/demandas, já existentes em pages/controle_demandas.py)
   pra buscar/criar a demanda em si — este arquivo só grava a REFERÊNCIA
   do vínculo do lado da Anomalia, via POST /api/anomalias/<id>/
   vincular-demanda (pages/anomalias.py). Object.assign(Anomalias, {...})
   — CLAUDE.md §4. */
Object.assign(Anomalias, {

  /* Contexto:
     Abre o modal de vínculo para a anomalia/horizonte pedidos — chamado
     pelos botões "🔗 Vincular demanda de curto/longo prazo" do modal de
     edição (modais.js). Sempre abre no modo "buscar existente" (o modo
     mais comum) e pré-carrega a lista de demandas do próprio cliente da
     anomalia (busca vazia = todas, mas o campo já sugere digitar).
     Não retorna nada. */
  abrirModalVincular(anomaliaId, horizonte) {
    this.idEmVinculacao = anomaliaId;
    this.horizonteEmVinculacao = horizonte;
    const anomalia = this.mapaPorId[anomaliaId];
    const label = this.HORIZONTE_LABEL[horizonte] || horizonte;
    document.getElementById('an-vincular-titulo').textContent = `Vincular demanda — ${label}`;

    document.getElementById('an-vinc-busca').value = '';
    this.trocarAbaVinculo('buscar');
    this.renderizarResultadosBusca([]);
    if (anomalia) this.prepararFormularioCriarDemanda(anomalia, horizonte);

    document.getElementById('an-modal-vincular-backdrop').classList.add('an-show');
    document.getElementById('an-vinc-busca').focus();
  },

  /* Contexto: fecha o modal de vínculo sem concluir nada. Não retorna
     nada. */
  fecharModalVincular() {
    document.getElementById('an-modal-vincular-backdrop').classList.remove('an-show');
    this.idEmVinculacao = null;
    this.horizonteEmVinculacao = null;
  },

  /* Contexto: alterna entre os 2 modos do modal ("buscar existente" /
     "criar nova"), trocando a aba ativa e mostrando/escondendo o painel
     correspondente. Chamada pelos 2 botões de aba do modal. Não retorna
     nada. */
  trocarAbaVinculo(modo) {
    const ehBuscar = modo === 'buscar';
    document.getElementById('an-vinc-tab-buscar').classList.toggle('an-vinc-tab-ativa', ehBuscar);
    document.getElementById('an-vinc-tab-criar').classList.toggle('an-vinc-tab-ativa', !ehBuscar);
    document.getElementById('an-vinc-painel-buscar').style.display = ehBuscar ? '' : 'none';
    document.getElementById('an-vinc-painel-criar').style.display = ehBuscar ? 'none' : '';
  },

  /* Contexto: dispara buscarDemandasParaVincular() com um pequeno atraso
     (250ms) a cada tecla digitada — mesmo padrão de debounce dos filtros
     principais. Chamada pelo listener de input do campo de busca do
     modal. Não retorna nada. */
  buscarVinculoComDebounce() {
    clearTimeout(this._debounceBuscaVinculo);
    this._debounceBuscaVinculo = setTimeout(() => this.buscarDemandasParaVincular(), 250);
  },

  /* Contexto:
     Busca demandas já existentes via a rota homologada de Demandas
     (GET /api/demandas?search=...) pra listar candidatas a vínculo —
     NUNCA cria/edita nada em controle_demandas.json, só lê. Chamada pelo
     input de busca do modal. Não retorna nada.

     Pseudocódigo:
       1. Lê o texto de busca; vazio -> lista as mais recentes (sem
          filtro) pra não deixar o painel vazio de cara.
       2. GET /api/demandas?search=<texto>.
       3. Desenha os resultados. */
  async buscarDemandasParaVincular() {
    const texto = document.getElementById('an-vinc-busca').value.trim();
    const params = new URLSearchParams();
    if (texto) params.set('search', texto);
    const resposta = await fetch('/api/demandas?' + params.toString());
    const demandas = await resposta.json();
    this.renderizarResultadosBusca(demandas.slice(0, 25));
  },

  /* Contexto: desenha a lista de resultados de busca do modal de
     vínculo, 1 botão "Vincular" por demanda encontrada. Não retorna
     nada. */
  renderizarResultadosBusca(demandas) {
    const container = document.getElementById('an-vinc-resultados');
    if (!demandas.length) {
      container.innerHTML = '<p class="an-vinc-resultado-vazio">Digite para buscar uma demanda já cadastrada…</p>';
      return;
    }
    container.innerHTML = demandas.map(d => `
      <div class="an-vinc-resultado-item">
        <div class="an-vinc-resultado-texto">
          <span class="an-vinc-resultado-cliente">${this.esc(d.cliente)} · ${this.esc(d.status)}</span>
          ${this.esc(this.truncar(d.demanda || '', 90))}
        </div>
        <button class="an-btn-secundario" style="flex:none;padding:6px 10px;" data-demanda-id="${this.esc(d._id)}">Vincular</button>
      </div>
    `).join('');
    container.querySelectorAll('[data-demanda-id]').forEach(botao => {
      botao.addEventListener('click', () => this.vincularDemandaExistente(botao.dataset.demandaId));
    });
  },

  /* Contexto:
     Conclui o vínculo com uma demanda JÁ EXISTENTE — POST
     /api/anomalias/<id>/vincular-demanda com o id escolhido nos
     resultados de busca. Chamada pelo botão "Vincular" de cada resultado.
     Não retorna nada. */
  async vincularDemandaExistente(demandaId) {
    if (!this.idEmVinculacao) return;
    await fetch(`/api/anomalias/${this.idEmVinculacao}/vincular-demanda`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ demanda_id: demandaId, horizonte: this.horizonteEmVinculacao, resumo: '' }),
    });
    this.fecharModalVincular();
    await this.carregarAnomalias();
    const anomaliaAtualizada = this.mapaPorId[this.idEmVinculacao || document.getElementById('an-form-id').value];
    if (anomaliaAtualizada) this.renderizarVinculosNoModal(anomaliaAtualizada);
  },

  /* Contexto:
     Pré-preenche o mini formulário de "criar nova demanda e já vincular"
     com valores derivados da anomalia — cliente igual ao da anomalia,
     texto prefixado conforme o horizonte, prioridade sugerida pelo mapa
     criticidade->prioridade (CRITICIDADE_PARA_PRIORIDADE, vindo de
     GET /api/anomalias/opcoes), tipo padrão Operacional (curto prazo) ou
     Sistema (longo prazo) — TUDO editável antes de confirmar, conforme o
     requisito. Chamada por abrirModalVincular(). Não retorna nada. */
  prepararFormularioCriarDemanda(anomalia, horizonte) {
    const prefixo = horizonte === 'curto_prazo' ? '[Anomalia · Contenção] ' : '[Anomalia · Estrutural] ';
    const tipoPadrao = horizonte === 'curto_prazo' ? 'Operacional' : 'Sistema';
    const prioridadePadrao = this.opcoes.criticidade_para_prioridade[anomalia.criticidade] || 'Médio';

    document.getElementById('an-vinc-form-cliente').innerHTML =
      this.opcoesDemandas.clientes.map(v => `<option value="${this.esc(v)}" ${v === anomalia.cliente ? 'selected' : ''}>${this.esc(v)}</option>`).join('');
    document.getElementById('an-vinc-form-demanda').value = prefixo + (anomalia.titulo || '');
    document.getElementById('an-vinc-form-prioridade').innerHTML =
      this.opcoesDemandas.prioridades.map(v => `<option value="${this.esc(v)}" ${v === prioridadePadrao ? 'selected' : ''}>${this.esc(v)}</option>`).join('');
    document.getElementById('an-vinc-form-tipo').innerHTML =
      this.opcoesDemandas.tipos.map(v => `<option value="${this.esc(v)}" ${v === tipoPadrao ? 'selected' : ''}>${this.esc(v)}</option>`).join('');
    document.getElementById('an-vinc-form-responsavel').value = anomalia.responsavel || '';
    document.getElementById('an-vinc-form-deadline').value = '';
    document.getElementById('an-vinc-form-resumo').value = '';
  },

  /* Contexto:
     Cria a demanda nova (POST /api/demandas, rota homologada e já
     existente do blueprint de Demandas) e, com o id devolvido, grava o
     vínculo do lado da anomalia (POST /api/anomalias/<id>/
     vincular-demanda) — "criar demanda nova e já vincular" do requisito.
     Chamada pelo botão "Criar e vincular". Não retorna nada.

     Pseudocódigo:
       1. Lê os campos do mini formulário; cliente/demanda vazios ->
          alerta e sai sem enviar.
       2. POST /api/demandas com os campos do mini formulário.
       3. Erro do backend (ex.: enum inválido) -> alerta com a mensagem;
          sucesso -> usa o id devolvido pra POST /api/anomalias/<id>/
          vincular-demanda.
       4. Fecha o modal e recarrega o board (+ a lista de vínculos do
          modal de edição, se ainda estiver aberto). */
  async criarDemandaEVincular() {
    if (!this.idEmVinculacao) return;
    const payload = {
      cliente: document.getElementById('an-vinc-form-cliente').value,
      demanda: document.getElementById('an-vinc-form-demanda').value.trim(),
      prioridade: document.getElementById('an-vinc-form-prioridade').value,
      tipo: document.getElementById('an-vinc-form-tipo').value,
      responsavel: document.getElementById('an-vinc-form-responsavel').value.trim(),
      deadline: document.getElementById('an-vinc-form-deadline').value.trim(),
    };
    if (!payload.cliente || !payload.demanda) {
      alert('Preencha Cliente e Demanda.');
      return;
    }
    const respostaCriacao = await fetch('/api/demandas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!respostaCriacao.ok) {
      const erro = await respostaCriacao.json().catch(() => ({}));
      alert(erro.error || 'Não foi possível criar a demanda.');
      return;
    }
    const { id: demandaId } = await respostaCriacao.json();
    const resumo = document.getElementById('an-vinc-form-resumo').value.trim();

    await fetch(`/api/anomalias/${this.idEmVinculacao}/vincular-demanda`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ demanda_id: demandaId, horizonte: this.horizonteEmVinculacao, resumo }),
    });

    const idAnomaliaEditada = this.idEmVinculacao;
    this.fecharModalVincular();
    await this.carregarAnomalias();
    const anomaliaAtualizada = this.mapaPorId[idAnomaliaEditada];
    if (anomaliaAtualizada) this.renderizarVinculosNoModal(anomaliaAtualizada);
  },

  /* Contexto:
     Liga todos os handlers do modal de vínculo (abas buscar/criar, busca
     com debounce, cancelar/criar-e-vincular, fechar, clique fora fecha).
     Chamada 1x no boot (index.js). Não retorna nada. */
  ligarVinculos() {
    document.getElementById('an-vinc-tab-buscar').addEventListener('click', () => this.trocarAbaVinculo('buscar'));
    document.getElementById('an-vinc-tab-criar').addEventListener('click', () => this.trocarAbaVinculo('criar'));
    document.getElementById('an-vinc-busca').addEventListener('input', () => this.buscarVinculoComDebounce());

    const backdrop = document.getElementById('an-modal-vincular-backdrop');
    backdrop.addEventListener('click', e => { if (e.target === backdrop) this.fecharModalVincular(); });
    document.getElementById('an-vincular-fechar').addEventListener('click', () => this.fecharModalVincular());
    document.getElementById('an-vinc-cancelar-criar').addEventListener('click', () => this.fecharModalVincular());
    document.getElementById('an-vinc-criar-e-vincular').addEventListener('click', () => this.criarDemandaEVincular());
  },
});
