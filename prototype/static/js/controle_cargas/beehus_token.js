/* ControleCargas.beehus_token — modal "🔑 Beehus API": cola o token Bearer
   (válido por 1 dia) que autentica TODAS as consultas deste app
   [2026-08-05, pedido do usuário: "consegue efetuar todas consultas por
   Endpoints" + "pode efetuar o processo de transição" + "pode remover toda
   consulta do mongo" — o acesso direto ao Mongo foi removido por completo,
   ver db.py; este token é o ÚNICO requisito de conexão do app agora]. Sem
   token válido, nada carrega (catálogo de carteiras incluso) — por isso
   este modal ABRE AUTOMATICAMENTE sempre que o token está ausente/expirado/
   rejeitado. Parte do objeto único ControleCargas (ver state.js) — pasta
   static/js/controle_cargas/, 1 arquivo por funcionalidade (CLAUDE.md §4).
*/
Object.assign(ControleCargas, {
/* Contexto:
   Pergunta ao backend (GET /api/beehus-token) o status do token atual —
   chamada 1x no bootstrap (fim deste arquivo) e depois de salvar um token
   novo. Não retorna nada.

   Pseudocódigo:
     1. Busca o status; falha de rede -> não faz nada (o botão fica no texto
        default do HTML, sem travar o carregamento da tela).
     2. "Precisa colar" = sem token carregado, OU expirado (exp local), OU
        rejeitado pela API (última chamada real bateu 401/403) — guarda em
        `state.tokenBeehusOk` e atualiza o botão.
     3. Precisa colar -> abre o modal automaticamente (único requisito de
        conexão do app — sem token, nada carrega). */
verificarTokenBeehus(){
  fetch('/api/beehus-token').then(r=>r.json()).then(status=>{
    const precisaColar = !status.loaded || status.expired || status.rejected;
    ControleCargas.state.tokenBeehusOk = !precisaColar;
    ControleCargas.atualizarBotaoTokenBeehus();
    if(precisaColar) ControleCargas.abrirModalTokenBeehus();
  }).catch(()=>{});
},

/* Contexto:
   Sincroniza o texto/cor do botão "🔑 Beehus API" da masthead com
   `state.tokenBeehusOk` — chamada por verificarTokenBeehus() e depois de
   salvar um token com sucesso. Não retorna nada.

   Pseudocódigo:
     1. OK -> texto neutro "Beehus API OK", sem destaque.
     2. Precisa colar -> texto de alerta + classe conexao-pendente (mesmas
        cores do estado vermelho da matriz). */
atualizarBotaoTokenBeehus(){
  const btn = document.getElementById('btn-beehus-token');
  if(!btn) return;
  const ok = ControleCargas.state.tokenBeehusOk;
  btn.textContent = ok ? '🔑 Beehus API OK' : '🔑 Colar token Beehus API';
  btn.classList.toggle('conexao-pendente', !ok);
},

/* Contexto:
   Monta e abre (via ControleCargas.openModal, paineis.js) o modal onde a
   pessoa cola o token do dia. Chamada automaticamente por
   verificarTokenBeehus() (token ausente/expirado/rejeitado) e pelo clique
   no botão "🔑 Beehus API" (wireTokenBeehus). Não retorna nada.

   Pseudocódigo:
     1. Monta o HTML (explicação + campo + mensagem de status + botão).
     2. Abre o modal genérico.
     3. Liga o clique do botão "Validar e salvar" e o Enter no campo. */
abrirModalTokenBeehus(){
  const html = `
    <h2>Token da API Beehus</h2>
    <p>Cole o token de hoje (válido por 1 dia — a Beehus renova todo dia). Ele fica
    só na memória deste servidor (nunca sincroniza no OneDrive) e é perdido a cada
    restart — é preciso colar de novo quando isso acontecer ou quando expirar.</p>
    <input type="password" id="input-beehus-token" style="width:100%;box-sizing:border-box;padding:8px;font-family:monospace;font-size:12.5px;"
      placeholder="eyJ...">
    <p class="modal-status-msg" id="beehus-token-msg"></p>
    <div style="margin-top:8px;">
      <button class="btn" id="btn-salvar-beehus-token">Validar e salvar</button>
    </div>`;
  ControleCargas.openModal(html);
  document.getElementById('btn-salvar-beehus-token').addEventListener('click', ControleCargas.salvarTokenBeehus);
  document.getElementById('input-beehus-token').addEventListener('keydown', (e)=>{
    if(e.key==='Enter') ControleCargas.salvarTokenBeehus();
  });
},

/* Contexto:
   Lê o campo do modal, valida e persiste o token (POST /api/beehus-token) —
   chamada pelo botão "Validar e salvar" e pelo Enter no campo
   (abrirModalTokenBeehus). Backend valida contra a API (1 GET barato) antes
   de confirmar; nunca fecha o modal em caso de erro, pra pessoa poder
   corrigir e tentar de novo. Não retorna nada.

   Pseudocódigo:
     1. Campo vazio -> mensagem de erro, sem chamar o backend.
     2. Chama POST /api/beehus-token; {error:...} (401/400) -> mostra a
        mensagem em vermelho; {warning:...} (token salvo mas não validado
        agora, ex. API fora do ar) -> mensagem neutra, ainda fecha o modal.
     3. Sucesso -> mensagem verde, atualiza o botão da masthead, fecha o
        modal e dispara executarAtualizacao() (atualizar.js) pra já carregar
        dado fresco com o token recém-colado. */
salvarTokenBeehus(){
  const input = document.getElementById('input-beehus-token');
  const msg = document.getElementById('beehus-token-msg');
  const token = (input.value || '').trim();
  msg.className = 'modal-status-msg';
  if(!token){ msg.textContent = 'Cole o token antes de salvar.'; msg.classList.add('err'); return; }

  msg.textContent = 'Validando token...';
  fetch('/api/beehus-token', {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({token}),
  })
    .then(r=>r.json().then(data=>({ok:r.ok, data})))
    .then(({ok, data})=>{
      if(!ok){ msg.textContent = data.error || 'Falha ao validar o token.'; msg.classList.add('err'); return; }
      ControleCargas.state.tokenBeehusOk = true;
      ControleCargas.atualizarBotaoTokenBeehus();
      msg.textContent = data.warning ? `Token salvo (${data.warning})` : 'Token válido — salvo com sucesso.';
      msg.classList.add(data.warning ? '' : 'ok');
      ControleCargas.closeModal();
      ControleCargas.executarAtualizacao();
    })
    .catch(()=>{ msg.textContent = 'Falha de rede ao salvar o token.'; msg.classList.add('err'); });
},

/* Contexto: liga o clique do botão "🔑 Beehus API" da masthead ao modal —
   chamada 1x no bootstrap (fim deste arquivo). Não retorna nada.

   Pseudocódigo:
     1. Clique no botão -> abrirModalTokenBeehus(). */
wireTokenBeehus(){
  document.getElementById('btn-beehus-token').addEventListener('click', ControleCargas.abrirModalTokenBeehus);
},
});

// ─────────────────────────────────────────────────────────────────────────
// Bootstrap: liga o botão da masthead e verifica se este processo já tem um
// token válido (abre o modal automaticamente se não tiver — obrigatório).
// ─────────────────────────────────────────────────────────────────────────
ControleCargas.wireTokenBeehus();
ControleCargas.verificarTokenBeehus();
