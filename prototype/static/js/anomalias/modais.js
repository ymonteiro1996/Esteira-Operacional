/* Anomalias.modais — modais de formulário (nova/editar, com a seção "Demandas vinculadas"), comentários e confirmação de exclusão.
   Usam overlays PRÓPRIOS (.an-modal-backdrop/.an-modal-box, ver
   anomalias.css) — não reaproveitam #modal-backdrop/.modal (grade
   principal) nem as classes "kd-modal-" da aba Demandas. Tradução do
   mesmo padrão de static/js/controle_demandas/modais.js, adaptada para
   os campos desta tela (sem progresso/tipo/deadline/prioridade, que não
   existem em Anomalias) + a seção nova de vínculos. Object.assign(
   Anomalias, {...}) — CLAUDE.md §4.

   [2026-08-22, Onda 2 do plano de melhorias] Os campos novos do schema
   (ocorrido_em/impacto/tags — melhorias 5 e 8) e a timeline de
   histórico (melhoria 4) são injetados via JS dentro dos modais já
   existentes (injetarCamposOnda2()/injetarTimeline(), chamadas 1x em
   ligarModais()) — o markup de index_template.html/index.html não é
   tocado (fora do escopo de edição liberado desta tarefa). O aviso de
   recorrência (melhoria 6) também mora aqui, reagindo a mudanças de
   cliente/tags no formulário "Nova/Editar Anomalia". */
Object.assign(Anomalias, {

  // ── Onda 2: campos novos injetados no modal de formulário ───────────────

  /* Contexto:
     Injeta os campos novos do schema (Onda 2) no modal Nova/Editar
     Anomalia — "Data do ocorrido"/"Impacto" (melhoria 8), o input de
     tags com chips removíveis (melhoria 5) e o parágrafo de aviso de
     recorrência (melhoria 6, escondido por padrão) — tudo antes da
     seção "Demandas vinculadas" (#an-vinc-secao). Chamada 1x em
     ligarModais(), idempotente (não duplica se já injetado). Não
     retorna nada. */
  injetarCamposOnda2() {
    if (document.getElementById('an-form-ocorrido-em')) return;
    document.getElementById('an-vinc-secao').insertAdjacentHTML('beforebegin', `
      <div class="an-grid2">
        <div class="an-campo">
          <label>Data do ocorrido</label>
          <input type="date" id="an-form-ocorrido-em">
        </div>
        <div class="an-campo">
          <label>Impacto</label>
          <input type="text" id="an-form-impacto" placeholder="Ex: 3 carteiras sem NAV publicado">
        </div>
      </div>
      <div class="an-campo">
        <label>Tags</label>
        <input type="text" id="an-form-tag-input" list="an-tags-datalist" placeholder="Digite e pressione Enter…">
        <datalist id="an-tags-datalist"></datalist>
        <div class="an-tag-input-chips" id="an-form-tags-chips"></div>
      </div>
      <p class="an-recorrencia-aviso" id="an-form-recorrencia-aviso" style="display:none;"></p>
    `);
    document.getElementById('an-form-tag-input').addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ',') return;
      e.preventDefault();
      this.adicionarTagAoForm(e.target.value);
      e.target.value = '';
    });
    document.getElementById('an-form-cliente').addEventListener('change', () => this.avaliarRecorrenciaForm());
  },

  /* Contexto:
     Atualiza a <datalist> de autocomplete do campo de tags com as
     sugestões de config (opcoes.tags_sugeridas) unidas às tags já usadas
     em `this.anomalias` — chamada toda vez que o modal de formulário
     abre (abrirModalNova()/abrirModalEditar()), pra refletir tags novas
     criadas na sessão. Não retorna nada. */
  atualizarDatalistTags() {
    const datalist = document.getElementById('an-tags-datalist');
    if (!datalist) return;
    const todas = new Set(this.opcoes.tags_sugeridas || []);
    this.anomalias.forEach(a => (a.tags || []).forEach(t => todas.add(t)));
    datalist.innerHTML = [...todas].sort((a, b) => a.localeCompare(b, 'pt-BR'))
      .map(t => `<option value="${this.esc(t)}">`).join('');
  },

  /* Contexto:
     Acrescenta 1 tag ao array transitório `_tagsForm` (dedupe, ignora
     texto vazio), redesenha os chips e reavalia o aviso de recorrência.
     Chamada pelo Enter/vírgula do campo de tag input. Não retorna
     nada. */
  adicionarTagAoForm(texto) {
    const tag = (texto || '').trim();
    if (!tag || this._tagsForm.includes(tag)) return;
    this._tagsForm.push(tag);
    this.renderizarTagsForm();
    this.avaliarRecorrenciaForm();
  },

  /* Contexto: desenha os chips das tags em edição (`_tagsForm`) no modal
     de formulário, cada um com um botão "×" de remoção. Não retorna
     nada. */
  renderizarTagsForm() {
    const container = document.getElementById('an-form-tags-chips');
    if (!container) return;
    container.innerHTML = this._tagsForm.map(t => `
      <span class="an-tag-input-chip">${this.esc(t)}<button type="button" data-tag="${this.esc(t)}" title="Remover tag">×</button></span>
    `).join('');
    container.querySelectorAll('button[data-tag]').forEach(botao => {
      botao.addEventListener('click', () => {
        this._tagsForm = this._tagsForm.filter(t => t !== botao.dataset.tag);
        this.renderizarTagsForm();
        this.avaliarRecorrenciaForm();
      });
    });
  },

  /* Contexto:
     Sinal de recorrência (melhoria 6) dentro do PRÓPRIO formulário —
     antes mesmo de salvar, avisa se já existem outras anomalias do
     MESMO cliente compartilhando alguma tag em comum nos últimos 30
     dias (cálculo client-side sobre `this.anomalias`, já carregada, sem
     chamada nova — fronteira ITIL clássica entre incidente isolado e
     problema recorrente). Chamada a cada mudança de cliente/tags no
     formulário. Não retorna nada.

     Pseudocódigo:
       1. Sem cliente ou sem nenhuma tag em edição, esconde o aviso (não
          dá pra avaliar recorrência sem os dois).
       2. Filtra `this.anomalias` por mesmo cliente + pelo menos 1 tag em
          comum + data (ocorrido_em||created_at) dentro dos últimos 30
          dias — exclui a própria anomalia (edição).
       3. Achou alguma -> mostra o aviso com a contagem; senão, esconde. */
  avaliarRecorrenciaForm() {
    const aviso = document.getElementById('an-form-recorrencia-aviso');
    if (!aviso) return;
    const cliente = document.getElementById('an-form-cliente').value;
    const tags = this._tagsForm || [];
    if (!cliente || !tags.length) {
      aviso.style.display = 'none';
      return;
    }
    const idAtual = document.getElementById('an-form-id').value;
    const limiteMs = Date.now() - 30 * 86400000;
    const similares = this.anomalias.filter(a => {
      if (a.id === idAtual) return false;
      if (a.cliente !== cliente) return false;
      const dataRef = new Date(a.ocorrido_em || a.created_at).getTime();
      if (isNaN(dataRef) || dataRef < limiteMs) return false;
      return (a.tags || []).some(t => tags.includes(t));
    });
    if (similares.length) {
      aviso.style.display = '';
      aviso.textContent = similares.length === 1
        ? '↻ Já existe 1 anomalia similar deste cliente (mesma tag) nos últimos 30 dias.'
        : `↻ Já existem ${similares.length} anomalias similares deste cliente (mesma tag) nos últimos 30 dias.`;
    } else {
      aviso.style.display = 'none';
    }
  },

  // ── Modal: Nova / Editar Anomalia ───────────────────────────────────────

  /* Contexto: abre o modal em modo "Nova Anomalia" — usado pelo botão do
     cabeçalho, pelo botão "+ Anomalia" de cada coluna (já vem com a
     criticidade da coluna pré-preenchida) e pelo atalho de teclado "n"
     (index.js). A seção "Demandas vinculadas" fica ESCONDIDA nesse modo
     — só é possível vincular depois que a anomalia existe (tem id).
     Também reseta os campos da Onda 2 (ocorrido_em fica em branco — o
     backend usa a data de hoje como default quando ausente — impacto e
     tags) e esconde o aviso de recorrência. Não retorna nada. */
  abrirModalNova(criticidadePreenchida) {
    document.getElementById('an-form-titulo').textContent = 'Nova Anomalia';
    document.getElementById('an-form-id').value = '';
    document.getElementById('an-form-cliente').value = '';
    document.getElementById('an-form-titulo-campo').value = '';
    document.getElementById('an-form-descricao').value = '';
    document.getElementById('an-form-criticidade').value = criticidadePreenchida || '';
    document.getElementById('an-form-status').value = 'Pendente';
    document.getElementById('an-form-responsavel').value = '';
    document.getElementById('an-form-acao-curto').value = '';
    document.getElementById('an-form-acao-longo').value = '';
    document.getElementById('an-form-ocorrido-em').value = '';
    document.getElementById('an-form-impacto').value = '';
    document.getElementById('an-form-tag-input').value = '';
    this._tagsForm = [];
    this.renderizarTagsForm();
    this.atualizarDatalistTags();
    document.getElementById('an-form-recorrencia-aviso').style.display = 'none';
    document.getElementById('an-vinc-secao').style.display = 'none';
    document.getElementById('an-modal-form-backdrop').classList.add('an-show');
  },

  /* Contexto: abre o modal em modo "Editar Anomalia", pré-preenchido com
     os dados da anomalia pedida (busca no mapa local, sem nova
     requisição) — inclui a seção "Demandas vinculadas" (só aparece em
     edição, ver abrirModalNova()) e os campos da Onda 2 (ocorrido_em/
     impacto/tags, com o aviso de recorrência já avaliado). Não retorna
     nada. */
  abrirModalEditar(id) {
    const anomalia = this.mapaPorId[id];
    if (!anomalia) return;
    document.getElementById('an-form-titulo').textContent = 'Editar Anomalia';
    document.getElementById('an-form-id').value = anomalia.id;
    document.getElementById('an-form-cliente').value = anomalia.cliente || '';
    document.getElementById('an-form-titulo-campo').value = anomalia.titulo || '';
    document.getElementById('an-form-descricao').value = anomalia.descricao || '';
    document.getElementById('an-form-criticidade').value = anomalia.criticidade || '';
    document.getElementById('an-form-status').value = anomalia.status || '';
    document.getElementById('an-form-responsavel').value = anomalia.responsavel || '';
    document.getElementById('an-form-acao-curto').value = anomalia.acao_curto_prazo || '';
    document.getElementById('an-form-acao-longo').value = anomalia.acao_longo_prazo || '';
    document.getElementById('an-form-ocorrido-em').value = anomalia.ocorrido_em || '';
    document.getElementById('an-form-impacto').value = anomalia.impacto || '';
    document.getElementById('an-form-tag-input').value = '';
    this._tagsForm = [...(anomalia.tags || [])];
    this.renderizarTagsForm();
    this.atualizarDatalistTags();
    this.avaliarRecorrenciaForm();
    document.getElementById('an-vinc-secao').style.display = '';
    this.renderizarVinculosNoModal(anomalia);
    document.getElementById('an-modal-form-backdrop').classList.add('an-show');
  },

  /* Contexto: fecha o modal de formulário sem salvar. Não retorna nada. */
  fecharModalForm() {
    document.getElementById('an-modal-form-backdrop').classList.remove('an-show');
  },

  /* Contexto:
     Envia o formulário (criação ou edição, conforme an-form-id estar
     vazio ou não) — POST /api/anomalias ou PATCH /api/anomalias/<id>.
     Inclui os campos da Onda 2 (ocorrido_em/impacto/tags — melhorias 8
     e 5); qualquer tag ainda digitada e não confirmada com Enter/vírgula
     no momento de salvar é incorporada automaticamente, pra não perder o
     que o usuário já digitou. Não retorna nada.

     Pseudocódigo:
       1. Lê os campos do formulário (inclusive tag pendente no input).
       2. Cliente/título/criticidade vazios -> alerta e sai sem enviar
          (mesma validação de front-end feita em Demandas; o backend
          também valida).
       3. Envia POST (novo) ou PATCH (edição existente).
       4. Erro do backend (ex.: enum inválido, 400) -> alerta com a
          mensagem; sucesso -> fecha o modal e recarrega o board. */
  async enviarFormulario() {
    const id = document.getElementById('an-form-id').value;
    const tagPendente = document.getElementById('an-form-tag-input').value.trim();
    if (tagPendente) this.adicionarTagAoForm(tagPendente);
    const payload = {
      cliente: document.getElementById('an-form-cliente').value,
      titulo: document.getElementById('an-form-titulo-campo').value.trim(),
      descricao: document.getElementById('an-form-descricao').value.trim(),
      criticidade: document.getElementById('an-form-criticidade').value,
      status: document.getElementById('an-form-status').value,
      responsavel: document.getElementById('an-form-responsavel').value.trim(),
      acao_curto_prazo: document.getElementById('an-form-acao-curto').value.trim(),
      acao_longo_prazo: document.getElementById('an-form-acao-longo').value.trim(),
      ocorrido_em: document.getElementById('an-form-ocorrido-em').value,
      impacto: document.getElementById('an-form-impacto').value.trim(),
      tags: this._tagsForm.slice(),
    };
    if (!payload.cliente || !payload.titulo || !payload.criticidade) {
      alert('Preencha Cliente, Título e Criticidade.');
      return;
    }
    const resposta = await fetch(id ? `/api/anomalias/${id}` : '/api/anomalias', {
      method: id ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resposta.ok) {
      const erro = await resposta.json().catch(() => ({}));
      alert(erro.error || 'Não foi possível salvar a anomalia.');
      return;
    }
    this.fecharModalForm();
    this.carregarAnomalias();
  },

  // ── Seção "Demandas vinculadas" (dentro do modal de edição) ─────────────

  /* Contexto:
     Desenha a lista de demandas vinculadas da anomalia aberta no modal
     (horizonte, texto/status resolvido via mapaDemandasPorId, botão de
     desvincular) — chamada por abrirModalEditar() e novamente depois de
     um vínculo novo (vinculos.js), pra atualizar a lista sem fechar o
     modal. Não retorna nada. */
  renderizarVinculosNoModal(anomalia) {
    const lista = document.getElementById('an-vinc-lista');
    const vinculos = anomalia.demandas_vinculadas || [];
    if (!vinculos.length) {
      lista.innerHTML = '<p class="an-vinc-vazio">Nenhuma demanda vinculada ainda.</p>';
      return;
    }
    lista.innerHTML = vinculos.map(v => {
      const demanda = this.mapaDemandasPorId[v.demanda_id];
      const texto = demanda ? demanda.demanda : '(demanda não encontrada)';
      const status = demanda ? demanda.status : '';
      return `
        <div class="an-vinc-item">
          <span class="an-vinc-horizonte">${this.esc(this.HORIZONTE_LABEL[v.horizonte] || v.horizonte)}</span>
          <span class="an-vinc-texto" title="${this.esc(texto)}">${this.esc(texto)}${status ? ` · ${this.esc(status)}` : ''}</span>
          <button class="an-vinc-remover" data-demanda-id="${this.esc(v.demanda_id)}" data-horizonte="${this.esc(v.horizonte)}" title="Desvincular">×</button>
        </div>
      `;
    }).join('');
    lista.querySelectorAll('.an-vinc-remover').forEach(botao => {
      botao.addEventListener('click', () => this.desvincularDemanda(anomalia.id, botao.dataset.demandaId, botao.dataset.horizonte));
    });
  },

  /* Contexto:
     Remove um vínculo (corrige engano) — DELETE /api/anomalias/<id>/
     vincular-demanda/<demanda_id>?horizonte=..., depois recarrega o
     board e redesenha a lista do próprio modal (sem fechar). NÃO apaga a
     demanda em si. Não retorna nada. */
  async desvincularDemanda(anomaliaId, demandaId, horizonte) {
    await fetch(`/api/anomalias/${anomaliaId}/vincular-demanda/${demandaId}?horizonte=${encodeURIComponent(horizonte)}`, { method: 'DELETE' });
    await this.carregarAnomalias();
    const anomaliaAtualizada = this.mapaPorId[anomaliaId];
    if (anomaliaAtualizada) this.renderizarVinculosNoModal(anomaliaAtualizada);
  },

  // ── Onda 2: timeline de mudança de criticidade/status (melhoria 4) ──────

  /* Contexto:
     Injeta o container da timeline (#an-timeline-lista) dentro do modal
     de "Atualizações", ACIMA da lista de comentários — a trilha de
     auditoria (historico[], registrada no servidor por
     pages/anomalias.py::atualizar_anomalia) fica visível junto de onde o
     time já lê o andamento da anomalia. Chamada 1x em ligarModais(),
     idempotente. Não retorna nada. */
  injetarTimeline() {
    if (document.getElementById('an-timeline-lista')) return;
    document.getElementById('an-comentarios-lista').insertAdjacentHTML('beforebegin', '<div class="an-timeline" id="an-timeline-lista"></div>');
  },

  /* Contexto: traduz o nome interno do campo rastreado no histórico
     ("criticidade"/"status") para o rótulo exibido na timeline. Retorna
     string. */
  rotuloCampoHistorico(campo) {
    return { criticidade: 'Criticidade', status: 'Status' }[campo] || campo;
  },

  /* Contexto:
     Desenha a timeline de mudanças de criticidade/status (mais recente
     primeiro) — cada entrada é {quando, campo, de, para}, gravada no
     servidor a cada PATCH que muda um desses 2 campos (inclusive o
     arrastar-e-soltar entre colunas do board, que já é um PATCH só de
     "criticidade"). Chamada por abrirModalComentarios(). Não retorna
     nada. */
  renderizarTimeline(historico) {
    const lista = document.getElementById('an-timeline-lista');
    if (!lista) return;
    if (!historico.length) {
      lista.innerHTML = '<p class="an-timeline-vazio">Nenhuma mudança de criticidade/status registrada ainda.</p>';
      return;
    }
    lista.innerHTML = [...historico].reverse().map(h => `
      <div class="an-timeline-item">
        <span class="an-timeline-data">${this.formatarData(h.quando)}</span>
        <span>${this.esc(this.rotuloCampoHistorico(h.campo))}: ${this.esc(h.de || '—')} → <b>${this.esc(h.para || '—')}</b></span>
      </div>
    `).join('');
  },

  // ── Modal: Comentários / Atualizações ───────────────────────────────────

  /* Contexto: abre o modal de comentários/histórico de uma anomalia,
     listando a timeline de mudanças de criticidade/status (melhoria 4,
     acima) seguida dos comentários já carregados localmente. Não
     retorna nada. */
  abrirModalComentarios(id) {
    this.idEmEdicaoComentarios = id;
    const anomalia = this.mapaPorId[id];
    document.getElementById('an-comentarios-titulo').textContent = anomalia ? anomalia.titulo : '';
    document.getElementById('an-comentario-texto').value = '';
    this.renderizarTimeline(anomalia ? (anomalia.historico || []) : []);
    this.renderizarListaComentarios(anomalia ? (anomalia.comments || []) : []);
    document.getElementById('an-modal-comments-backdrop').classList.add('an-show');
  },

  /* Contexto: desenha a lista de comentários (mais recente primeiro) no
     modal. Não retorna nada. */
  renderizarListaComentarios(comentarios) {
    const lista = document.getElementById('an-comentarios-lista');
    if (!comentarios.length) {
      lista.innerHTML = '<p class="an-comment-vazio">Nenhuma atualização ainda.</p>';
      return;
    }
    lista.innerHTML = [...comentarios].reverse().map(c => `
      <div class="an-comment-item">
        <p class="an-comment-texto">${this.esc(c.text)}</p>
        <p class="an-comment-data">${this.formatarData(c.created_at)}</p>
      </div>
    `).join('');
  },

  /* Contexto: fecha o modal de comentários. Não retorna nada. */
  fecharModalComentarios() {
    document.getElementById('an-modal-comments-backdrop').classList.remove('an-show');
    this.idEmEdicaoComentarios = null;
  },

  /* Contexto:
     Envia um novo comentário/atualização para a anomalia aberta no modal
     — POST /api/anomalias/<id>/comments, depois recarrega o board (pra
     atualizar a contagem 💬 do cartão) e redesenha a lista do próprio
     modal (sem fechar, pra permitir adicionar vários seguidos). Não
     retorna nada. */
  async enviarComentario() {
    const texto = document.getElementById('an-comentario-texto').value.trim();
    if (!texto || !this.idEmEdicaoComentarios) return;
    await fetch(`/api/anomalias/${this.idEmEdicaoComentarios}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: texto }),
    });
    document.getElementById('an-comentario-texto').value = '';
    await this.carregarAnomalias();
    const anomaliaAtualizada = this.mapaPorId[this.idEmEdicaoComentarios];
    if (anomaliaAtualizada) this.renderizarListaComentarios(anomaliaAtualizada.comments || []);
  },

  // ── Modal: Confirmar exclusão ────────────────────────────────────────────

  /* Contexto: abre o modal de confirmação de exclusão. Não retorna
     nada. */
  abrirModalExcluir(id) {
    this.idParaExcluir = id;
    document.getElementById('an-modal-delete-backdrop').classList.add('an-show');
  },

  /* Contexto: fecha o modal de confirmação sem excluir. Não retorna
     nada. */
  fecharModalExcluir() {
    this.idParaExcluir = null;
    document.getElementById('an-modal-delete-backdrop').classList.remove('an-show');
  },

  /* Contexto: confirma a exclusão — DELETE /api/anomalias/<id>, fecha o
     modal e recarrega o board. Não retorna nada. */
  async confirmarExclusao() {
    if (!this.idParaExcluir) return;
    await fetch(`/api/anomalias/${this.idParaExcluir}`, { method: 'DELETE' });
    this.fecharModalExcluir();
    this.carregarAnomalias();
  },

  // ── Wiring ────────────────────────────────────────────────────────────

  /* Contexto:
     Liga todos os handlers dos 3 modais de CRUD (abrir/fechar/enviar) +
     os 2 botões "Vincular demanda de curto/longo prazo" do modal de
     edição (que só abrem o modal de vínculo — a lógica em si mora em
     vinculos.js) + o atalho de teclado Escape + injeta os elementos
     novos da Onda 2 (campos ocorrido_em/impacto/tags + aviso de
     recorrência no modal de formulário; timeline no modal de
     Atualizações). Chamada 1x no boot (index.js). Não retorna nada. */
  ligarModais() {
    this.injetarCamposOnda2();
    this.injetarTimeline();
    document.getElementById('an-btn-nova').addEventListener('click', () => this.abrirModalNova(''));

    const backdropForm = document.getElementById('an-modal-form-backdrop');
    backdropForm.addEventListener('click', e => { if (e.target === backdropForm) this.fecharModalForm(); });
    document.getElementById('an-form-cancelar').addEventListener('click', () => this.fecharModalForm());
    document.getElementById('an-form-fechar').addEventListener('click', () => this.fecharModalForm());
    document.getElementById('an-form-salvar').addEventListener('click', () => this.enviarFormulario());

    document.getElementById('an-btn-vincular-curto').addEventListener('click', () => {
      const id = document.getElementById('an-form-id').value;
      if (id) this.abrirModalVincular(id, 'curto_prazo');
    });
    document.getElementById('an-btn-vincular-longo').addEventListener('click', () => {
      const id = document.getElementById('an-form-id').value;
      if (id) this.abrirModalVincular(id, 'longo_prazo');
    });

    const backdropComments = document.getElementById('an-modal-comments-backdrop');
    backdropComments.addEventListener('click', e => { if (e.target === backdropComments) this.fecharModalComentarios(); });
    document.getElementById('an-comentarios-fechar').addEventListener('click', () => this.fecharModalComentarios());
    document.getElementById('an-comentarios-fechar-rodape').addEventListener('click', () => this.fecharModalComentarios());
    document.getElementById('an-comentario-enviar').addEventListener('click', () => this.enviarComentario());

    const backdropDelete = document.getElementById('an-modal-delete-backdrop');
    backdropDelete.addEventListener('click', e => { if (e.target === backdropDelete) this.fecharModalExcluir(); });
    document.getElementById('an-delete-cancelar').addEventListener('click', () => this.fecharModalExcluir());
    document.getElementById('an-delete-confirmar').addEventListener('click', () => this.confirmarExclusao());

    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      this.fecharModalForm();
      this.fecharModalComentarios();
      this.fecharModalExcluir();
      this.fecharModalVincular();
    });
  },
});
