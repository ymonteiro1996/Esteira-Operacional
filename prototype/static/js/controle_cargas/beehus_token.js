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
     3. Liga o clique do botão "Validar e salvar", o Enter no campo e o
        botão "mostrar/ocultar".

   [2026-09-21, relato do usuário: "não está conseguindo colar o token"] O
   campo continua `type="password"` por ser uma credencial, mas ganhou (a) o
   botão 👁 pra conferir o que foi colado e (b) o contador de caracteres, que
   é o sinal mais direto de que o Ctrl+V pegou — antes, num campo mascarado
   e sem retorno nenhum, não dava pra distinguir "não colou" de "colou
   errado". O aviso sobre `Bearer `/aspas é o par visível da limpeza que o
   backend faz (beehus_api/client.py::normalizar_token_colado). */
abrirModalTokenBeehus(){
  const html = `
    <h2>Token da API Beehus</h2>
    <p>Cole o token de hoje (válido por 1 dia — a Beehus renova todo dia). Ele fica
    só na memória deste servidor (nunca sincroniza no OneDrive) e é perdido a cada
    restart — é preciso colar de novo quando isso acontecer ou quando expirar.</p>
    <div style="display:flex;gap:6px;align-items:stretch;">
      <input type="password" id="input-beehus-token" style="flex:1;min-width:0;box-sizing:border-box;padding:8px;font-family:monospace;font-size:12.5px;"
        placeholder="eyJ...">
      <button class="btn" type="button" id="btn-ver-beehus-token" title="Mostrar/ocultar o token digitado">👁</button>
    </div>
    <p class="psub" id="beehus-token-contagem">Nada colado ainda.</p>
    <p class="psub">Pode colar com o prefixo <code>Bearer</code> ou entre aspas, e mesmo
    quebrado em várias linhas — o app limpa antes de usar.</p>
    <p class="modal-status-msg" id="beehus-token-msg"></p>
    <div style="margin-top:8px;">
      <button class="btn" id="btn-salvar-beehus-token">Validar e salvar</button>
    </div>`;
  ControleCargas.openModal(html);
  const input = document.getElementById('input-beehus-token');
  document.getElementById('btn-salvar-beehus-token').addEventListener('click', ControleCargas.salvarTokenBeehus);
  document.getElementById('btn-ver-beehus-token').addEventListener('click', ()=>{
    input.type = (input.type === 'password') ? 'text' : 'password';
    input.focus();
  });
  input.addEventListener('input', ControleCargas.atualizarContagemTokenBeehus);
  input.addEventListener('keydown', (e)=>{
    if(e.key==='Enter') ControleCargas.salvarTokenBeehus();
  });
  input.focus();
},

/* Contexto:
   Escreve embaixo do campo quantos caracteres já foram colados — ligada ao
   evento `input` do campo em abrirModalTokenBeehus(). É o retorno visual que
   faltava pra pessoa saber que o Ctrl+V funcionou num campo mascarado
   [2026-09-21, relato do usuário: "não está conseguindo colar o token"].
   Não retorna nada.

   Pseudocódigo:
     1. Campo vazio -> frase neutra "Nada colado ainda.".
     2. Senão, mostra a contagem de caracteres e um alerta quando o valor
        não parece um JWT (um JWT tem 3 partes separadas por ponto). */
atualizarContagemTokenBeehus(){
  const campoContagem = document.getElementById('beehus-token-contagem');
  const input = document.getElementById('input-beehus-token');
  if(!campoContagem || !input) return;   // modal já fechado — nada a escrever
  const valor = (input.value || '').trim();
  if(!valor){ campoContagem.textContent = 'Nada colado ainda.'; return; }
  const pareceJwt = valor.replace(/^["']|["']$/g, '').replace(/^\s*bearer\s+/i, '').split('.').length === 3;
  campoContagem.textContent = `${valor.length} caracteres colados`
    + (pareceJwt ? ' — formato de token OK.' : ' — não parece um token (esperado: 3 partes separadas por ponto).');
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
        agora, ex. API fora do ar) -> mensagem neutra e o modal FICA ABERTO.
     3. Sucesso -> mensagem verde, atualiza o botão da masthead, fecha o
        modal e dispara executarAtualizacao() (atualizar.js) pra já carregar
        dado fresco com o token recém-colado.

   [2026-09-21, relato do usuário: "não está conseguindo colar o token"] O
   caso `warning` ANTES também fechava o modal, logo depois de escrever a
   mensagem — ou seja, a pessoa colava, a janela sumia, nada carregava e não
   restava nenhum aviso na tela de que a API não tinha respondido. Agora o
   modal só fecha quando a API confirmou o token de verdade; o aviso fica
   visível, com o botão disponível pra tentar de novo. */
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
      if(data.warning){
        msg.textContent = `Token salvo, mas a API não respondeu para validar (${data.warning}). `
          + 'Clique em "Validar e salvar" de novo para tentar outra vez, ou feche e use o botão Atualizar.';
        return;   // modal fica aberto de propósito — ver docstring acima
      }
      msg.textContent = 'Token válido — salvo com sucesso.';
      msg.classList.add('ok');
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
