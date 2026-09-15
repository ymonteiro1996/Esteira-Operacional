/* ControleCargas.progresso — sinal de vida do botão "Atualizar".
   Parte do objeto único ControleCargas (ver state.js).

   [2026-09-15, relato do usuário: "tentei novamente, ficou atualizando e não
   foi para o dia 09/09"] Um Atualizar leva ~9 minutos hoje (rate limit da API
   Beehus, ver beehus_api/client.py), e nesse tempo todo o botão ficava só em
   "Atualizando...", sem nada mudando na tela — indistinguível de travado. O
   efeito colateral era o pior: quem achava que travou clicava de novo, e o 2º
   pedido DOBRAVA a carga em cima do mesmo rate limit que já estava causando a
   lentidão.

   Este arquivo só LÊ e MOSTRA: consulta GET /api/atualizar/progresso (app.py)
   de 2 em 2 segundos enquanto o fetch do Atualizar não voltou, e escreve o
   andamento no mesmo .atualizar-msg que já existia. Nenhuma decisão de
   negócio, nenhuma chamada à API Beehus, e nenhuma falha aqui pode atrapalhar
   o Atualizar em si (todo erro de rede é engolido — ver acompanharProgresso).
*/
Object.assign(ControleCargas, {

/* Contexto:
   Traduz um dict de /api/atualizar/progresso na frase curta que aparece ao
   lado do botão. Chamada a cada resposta do polling. Retorna string (vazia
   quando não há execução em curso, pra não escrever nada por cima da
   mensagem final de sucesso/erro).

   Pseudocódigo:
     1. Sem execução em curso -> string vazia.
     2. Monta o prefixo "Atualizando… [etapa/total] título".
     3. Quando a etapa declarou sub-passos, acrescenta "— feitos/total
        consultas" (hoje só a etapa 3, a longa).
     4. Acrescenta há quanto tempo a execução começou, em minutos e segundos. */
textoProgressoAtualizacao(progresso){
  if(!progresso || !progresso.emAndamento) return '';
  let texto = `Atualizando… [${progresso.etapa}/${progresso.etapasTotal}] ${progresso.titulo}`;
  if(progresso.passosTotal > 0){
    texto += ` — ${progresso.passosFeitos}/${progresso.passosTotal} consultas`;
  }
  const segundos = Math.max(0, Math.round(progresso.segundos || 0));
  const minutos = Math.floor(segundos / 60);
  texto += ` · há ${minutos ? minutos + 'min ' : ''}${segundos % 60}s`;
  return texto;
},

/* Contexto:
   Liga o polling do progresso — chamado por enviarAtualizacao() (atualizar.js)
   logo depois de desabilitar o botão, e desligado por
   pararAcompanhamentoProgresso() no .finally() do mesmo fetch. `estaObsoleto`
   é a mesma função de sequência do pedido usada lá: se um Atualizar mais novo
   assumir, este polling para sozinho sem escrever na tela. Não retorna nada.

   Pseudocódigo:
     1. Para qualquer acompanhamento anterior que ainda esteja de pé.
     2. A cada 2s, busca GET /api/atualizar/progresso.
     3. Se este pedido já ficou obsoleto, para o polling e não escreve nada.
     4. Com texto a mostrar, escreve em .atualizar-msg.
     5. Qualquer erro de rede é ignorado de propósito — o progresso é
        enfeite, e a resposta do próprio /api/atualizar é quem manda. */
acompanharProgresso(estaObsoleto){
  ControleCargas.pararAcompanhamentoProgresso();
  const msgEl = document.getElementById('atualizar-msg');
  if(!msgEl) return;

  ControleCargas.state.timerProgresso = setInterval(()=>{
    fetch('/api/atualizar/progresso')
      .then(r=> r.ok ? r.json() : null)
      .then(progresso=>{
        if(estaObsoleto && estaObsoleto()){
          ControleCargas.pararAcompanhamentoProgresso();
          return;
        }
        const texto = ControleCargas.textoProgressoAtualizacao(progresso);
        if(texto) msgEl.textContent = texto;
      })
      .catch(()=>{});
  }, 2000);
},

/* Contexto:
   Desliga o polling do progresso — chamado no .finally() do fetch do
   Atualizar (sucesso ou erro) e no início de um acompanhamento novo, pra
   nunca ficar mais de um timer de pé. Idempotente: chamar sem nada rodando
   não faz nada. Não retorna nada.

   Pseudocódigo:
     1. Sem timer guardado no state, sai.
     2. Cancela o timer e limpa a referência. */
pararAcompanhamentoProgresso(){
  if(!ControleCargas.state.timerProgresso) return;
  clearInterval(ControleCargas.state.timerProgresso);
  ControleCargas.state.timerProgresso = null;
},

});
