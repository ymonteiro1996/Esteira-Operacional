/* ControleDemandas.modais — modais de formulário (nova/editar), comentários e confirmação de exclusão.
   Usam overlays PRÓPRIOS (.kd-modal-backdrop/.kd-modal-box, ver
   controle_demandas.css) — não reaproveitam #modal-backdrop/.modal do
   restante do app (aquele é usado pelo drill-down da grade principal,
   ver static/js/controle_cargas/paineis.js; misturar os dois criaria
   acoplamento entre telas sem necessidade).
   Object.assign(ControleDemandas, {...}) — CLAUDE.md §4. */
Object.assign(ControleDemandas, {

  // ── Modal: Nova / Editar Demanda ────────────────────────────────────────

  /* Contexto: abre o modal em modo "Nova Demanda" — usado pelo botão do
     cabeçalho e pelo botão "+ Demanda" de cada coluna (já vem com o
     responsável pré-preenchido quando a coluna não é "Sem Responsável").
     Tradução de openNew() da origem. Não retorna nada. */
  abrirModalNova(responsavelPreenchido) {
    document.getElementById('kd-form-titulo').textContent = 'Nova Demanda';
    document.getElementById('kd-form-id').value = '';
    document.getElementById('kd-form-cliente').value = '';
    document.getElementById('kd-form-demanda').value = '';
    document.getElementById('kd-form-tipo').value = '';
    document.getElementById('kd-form-prioridade').value = 'Médio';
    document.getElementById('kd-form-status').value = 'Pendente';
    document.getElementById('kd-form-responsavel').value = responsavelPreenchido || '';
    document.getElementById('kd-form-deadline').value = '';
    document.getElementById('kd-modal-form-backdrop').classList.add('kd-show');
  },

  /* Contexto: abre o modal em modo "Editar Demanda", pré-preenchido com
     os dados da demanda pedida (busca no mapa local, sem nova
     requisição) — tradução de openEdit() da origem. Não retorna nada. */
  abrirModalEditar(id) {
    const demanda = this.mapaPorId[id];
    if (!demanda) return;
    document.getElementById('kd-form-titulo').textContent = 'Editar Demanda';
    document.getElementById('kd-form-id').value = demanda._id;
    document.getElementById('kd-form-cliente').value = demanda.cliente || '';
    document.getElementById('kd-form-demanda').value = demanda.demanda || '';
    document.getElementById('kd-form-tipo').value = demanda.tipo || '';
    document.getElementById('kd-form-prioridade').value = demanda.prioridade || '';
    document.getElementById('kd-form-status').value = demanda.status || '';
    document.getElementById('kd-form-responsavel').value = demanda.responsavel || '';
    document.getElementById('kd-form-deadline').value = demanda.deadline || '';
    document.getElementById('kd-modal-form-backdrop').classList.add('kd-show');
  },

  /* Contexto: fecha o modal de formulário sem salvar. Não retorna nada. */
  fecharModalForm() {
    document.getElementById('kd-modal-form-backdrop').classList.remove('kd-show');
  },

  /* Contexto:
     Envia o formulário (criação ou edição, conforme kd-form-id estar
     vazio ou não) — POST /api/demandas ou PATCH /api/demandas/<id>,
     tradução de submitForm() da origem. Não retorna nada.

     Pseudocódigo:
       1. Lê os campos do formulário.
       2. Cliente/demanda vazios -> alerta e sai sem enviar (mesma
          validação de front-end da origem; o backend também valida).
       3. Envia POST (novo) ou PATCH (edição existente).
       4. Erro do backend (ex.: enum inválido, 400) -> alerta com a
          mensagem; sucesso -> fecha o modal e recarrega o quadro. */
  async enviarFormulario() {
    const id = document.getElementById('kd-form-id').value;
    const payload = {
      cliente: document.getElementById('kd-form-cliente').value,
      demanda: document.getElementById('kd-form-demanda').value.trim(),
      tipo: document.getElementById('kd-form-tipo').value,
      prioridade: document.getElementById('kd-form-prioridade').value,
      status: document.getElementById('kd-form-status').value,
      responsavel: document.getElementById('kd-form-responsavel').value.trim(),
      deadline: document.getElementById('kd-form-deadline').value.trim(),
    };
    if (!payload.cliente || !payload.demanda) {
      alert('Preencha Cliente e Demanda.');
      return;
    }
    const resposta = await fetch(id ? `/api/demandas/${id}` : '/api/demandas', {
      method: id ? 'PATCH' : 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload),
    });
    if (!resposta.ok) {
      const erro = await resposta.json().catch(() => ({}));
      alert(erro.error || 'Não foi possível salvar a demanda.');
      return;
    }
    this.fecharModalForm();
    this.carregarDemandas();
  },

  // ── Modal: Comentários / Atualizações ───────────────────────────────────

  /* Contexto: abre o modal de comentários de uma demanda, listando o
     histórico já carregado localmente — tradução de openComments() da
     origem. Não retorna nada. */
  abrirModalComentarios(id) {
    this.idEmEdicaoComentarios = id;
    const demanda = this.mapaPorId[id];
    document.getElementById('kd-comentarios-titulo').textContent = demanda ? demanda.demanda : '';
    document.getElementById('kd-comentario-texto').value = '';
    this.renderizarListaComentarios(demanda ? (demanda.comments || []) : []);
    document.getElementById('kd-modal-comments-backdrop').classList.add('kd-show');
  },

  /* Contexto: desenha a lista de comentários (mais recente primeiro) no
     modal — tradução de renderCommentsList() da origem. Não retorna
     nada. */
  renderizarListaComentarios(comentarios) {
    const lista = document.getElementById('kd-comentarios-lista');
    if (!comentarios.length) {
      lista.innerHTML = '<p class="kd-comment-vazio">Nenhuma atualização ainda.</p>';
      return;
    }
    lista.innerHTML = [...comentarios].reverse().map(c => `
      <div class="kd-comment-item">
        <p class="kd-comment-texto">${this.esc(c.text)}</p>
        <p class="kd-comment-data">${this.formatarData(c.created_at)}</p>
      </div>
    `).join('');
  },

  /* Contexto: fecha o modal de comentários. Não retorna nada. */
  fecharModalComentarios() {
    document.getElementById('kd-modal-comments-backdrop').classList.remove('kd-show');
    this.idEmEdicaoComentarios = null;
  },

  /* Contexto:
     Envia um novo comentário/atualização para a demanda aberta no modal —
     POST /api/demandas/<id>/comments, depois recarrega o quadro (pra
     atualizar a contagem 💬 do cartão) e redesenha a lista do próprio
     modal (sem fechar, pra permitir adicionar vários seguidos) —
     tradução de submitComment() da origem. Não retorna nada. */
  async enviarComentario() {
    const texto = document.getElementById('kd-comentario-texto').value.trim();
    if (!texto || !this.idEmEdicaoComentarios) return;
    await fetch(`/api/demandas/${this.idEmEdicaoComentarios}/comments`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({text: texto}),
    });
    document.getElementById('kd-comentario-texto').value = '';
    await this.carregarDemandas();
    const demandaAtualizada = this.mapaPorId[this.idEmEdicaoComentarios];
    if (demandaAtualizada) this.renderizarListaComentarios(demandaAtualizada.comments || []);
  },

  // ── Modal: Confirmar exclusão ────────────────────────────────────────────

  /* Contexto: abre o modal de confirmação de exclusão. Não retorna
     nada. */
  abrirModalExcluir(id) {
    this.idParaExcluir = id;
    document.getElementById('kd-modal-delete-backdrop').classList.add('kd-show');
  },

  /* Contexto: fecha o modal de confirmação sem excluir. Não retorna
     nada. */
  fecharModalExcluir() {
    this.idParaExcluir = null;
    document.getElementById('kd-modal-delete-backdrop').classList.remove('kd-show');
  },

  /* Contexto: confirma a exclusão — DELETE /api/demandas/<id>, fecha o
     modal e recarrega o quadro. Não retorna nada. */
  async confirmarExclusao() {
    if (!this.idParaExcluir) return;
    await fetch(`/api/demandas/${this.idParaExcluir}`, {method: 'DELETE'});
    this.fecharModalExcluir();
    this.carregarDemandas();
  },

  // ── Wiring ────────────────────────────────────────────────────────────

  /* Contexto:
     Liga todos os handlers dos 3 modais (abrir/fechar/enviar) e o atalho
     de teclado Escape (fecha qualquer modal aberto) — tradução dos
     listeners do fim do <script> da origem. Chamada 1x no boot
     (index.js). Não retorna nada.

     Pseudocódigo:
       1. Botão "Nova Demanda" do cabeçalho.
       2. Fechar/cancelar/salvar do modal de formulário (+ clique fora
          fecha).
       3. Fechar/adicionar do modal de comentários (+ clique fora fecha).
       4. Cancelar/confirmar do modal de exclusão (+ clique fora fecha).
       5. Escape fecha os 3; Ctrl/Cmd+Enter envia o formulário ou o
          comentário do modal que estiver aberto (mesmo atalho da
          origem). */
  ligarModais() {
    document.getElementById('kd-btn-nova').addEventListener('click', () => this.abrirModalNova(''));

    const backdropForm = document.getElementById('kd-modal-form-backdrop');
    backdropForm.addEventListener('click', e => { if (e.target === backdropForm) this.fecharModalForm(); });
    document.getElementById('kd-form-cancelar').addEventListener('click', () => this.fecharModalForm());
    document.getElementById('kd-form-fechar').addEventListener('click', () => this.fecharModalForm());
    document.getElementById('kd-form-salvar').addEventListener('click', () => this.enviarFormulario());

    const backdropComments = document.getElementById('kd-modal-comments-backdrop');
    backdropComments.addEventListener('click', e => { if (e.target === backdropComments) this.fecharModalComentarios(); });
    document.getElementById('kd-comentarios-fechar').addEventListener('click', () => this.fecharModalComentarios());
    document.getElementById('kd-comentarios-fechar-rodape').addEventListener('click', () => this.fecharModalComentarios());
    document.getElementById('kd-comentario-enviar').addEventListener('click', () => this.enviarComentario());

    const backdropDelete = document.getElementById('kd-modal-delete-backdrop');
    backdropDelete.addEventListener('click', e => { if (e.target === backdropDelete) this.fecharModalExcluir(); });
    document.getElementById('kd-delete-cancelar').addEventListener('click', () => this.fecharModalExcluir());
    document.getElementById('kd-delete-confirmar').addEventListener('click', () => this.confirmarExclusao());

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        this.fecharModalForm();
        this.fecharModalComentarios();
        this.fecharModalExcluir();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        if (backdropForm.classList.contains('kd-show')) this.enviarFormulario();
        else if (backdropComments.classList.contains('kd-show')) this.enviarComentario();
      }
    });
  },
});
