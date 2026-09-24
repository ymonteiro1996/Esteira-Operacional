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
   de 2 em 2 segundos enquanto o fetch do Atualizar não voltou. [REVISADO
   2026-09-24, pedido do usuário: "conseguimos criar uma barra de % do
   atualizando e tempo faltante? Sempre com base da seleção da empresa ou
   todas empresas"] O andamento saiu do texto solto na .atualizar-msg e virou
   uma BARRA (#atualizar-barra) com percentual, etapa, consultas feitas,
   tempo restante estimado e o escopo (empresa escolhida × nº de datas) — a
   .atualizar-msg ficou reservada pro resultado final e pros erros. O
   percentual e o tempo restante vêm prontos do servidor
   (progresso_atualizacao.py): é lá que estão os pesos por etapa e o
   histórico por escopo. Nenhuma decisão de
   negócio, nenhuma chamada à API Beehus, e nenhuma falha aqui pode atrapalhar
   o Atualizar em si (todo erro de rede é engolido — ver acompanharProgresso).
*/
Object.assign(ControleCargas, {

/* Contexto:
   Formata uma duração em segundos como "4min 12s" / "48s" — usada nos dois
   tempos que a barra mostra (o que falta e o que já passou). Retorna string.

   Pseudocódigo:
     1. Arredonda e separa minutos e segundos.
     2. Sem minutos, devolve só os segundos. */
formatarDuracaoCurta(segundos){
  const total = Math.max(0, Math.round(segundos || 0));
  const minutos = Math.floor(total / 60);
  return minutos ? `${minutos}min ${total % 60}s` : `${total}s`;
},

/* Contexto:
   Frase do tempo que falta — o "tempo faltante" pedido pelo usuário
   [2026-09-24]. Chamada por renderizarBarraProgresso(). Retorna string.

   Diz também DE ONDE veio o número, porque as duas fontes merecem confiança
   diferente: "estimativa" quando ainda é o histórico de execuções anteriores
   do mesmo escopo (a execução mal começou), sem ressalva quando já é o ritmo
   medido nesta execução (ver _segundos_restantes, progresso_atualizacao.py).

   Pseudocódigo:
     1. Servidor ainda sem estimativa -> "calculando o tempo restante...".
     2. Com estimativa -> "faltam ~Xmin Ys" (+ " (estimativa)" quando vem do
        histórico). */
textoTempoRestante(progresso){
  if(progresso.segundosRestantes == null) return 'calculando o tempo restante…';
  const base = progresso.baseEstimativa === 'historico' ? ' (estimativa)' : '';
  return `faltam ~${ControleCargas.formatarDuracaoCurta(progresso.segundosRestantes)}${base}`;
},

/* Contexto:
   Traduz um dict de /api/atualizar/progresso na frase que acompanha a barra.
   Chamada por renderizarBarraProgresso(). Retorna string (vazia quando não há
   execução em curso).

   [2026-09-24, pedido do usuário: "quero só status % e tempo Total Restante,
   tempo passado também"] São só esses 3 números — o % vai no começo da linha
   (renderizarBarraProgresso), aqui ficam os 2 tempos. A etapa "[n/6]", o
   título dela e a contagem de consultas SAÍRAM da tela de propósito: eram
   detalhe de implementação do build, não informação de quem espera. O
   servidor continua publicando tudo isso em /api/atualizar/progresso (e o
   console do servidor continua imprimindo), então dá pra voltar a mostrar sem
   mexer no backend.

   Pseudocódigo:
     1. Sem execução em curso -> string vazia.
     2. Junta "faltam ~X" e "decorrido Y". */
textoProgressoAtualizacao(progresso){
  if(!progresso || !progresso.emAndamento) return '';
  return `${ControleCargas.textoTempoRestante(progresso)} · decorrido ${ControleCargas.formatarDuracaoCurta(progresso.segundos)}`;
},

/* Contexto:
   Desenha a barra: largura do preenchimento = percentual do servidor, e a
   frase ao lado [2026-09-24, pedido do usuário: "barra de % do atualizando e
   tempo faltante"]. Chamada a cada resposta do polling. Não retorna nada.

   Pseudocódigo:
     1. Sem os elementos no DOM (HTML antigo em cache) -> sai sem erro.
     2. Sem execução em curso -> esconde a barra.
     3. Mostra a barra, ajusta largura/aria e escreve "NN% · <frase>". */
renderizarBarraProgresso(progresso){
  const barra = document.getElementById('atualizar-barra');
  const preenchida = document.getElementById('atualizar-barra-preenchida');
  const texto = document.getElementById('atualizar-barra-texto');
  if(!barra || !preenchida || !texto) return;

  if(!progresso || !progresso.emAndamento){
    ControleCargas.esconderBarraProgresso();
    return;
  }
  const pct = Math.max(0, Math.min(100, progresso.percentual || 0));
  barra.hidden = false;
  preenchida.style.width = `${pct}%`;
  const trilha = document.getElementById('atualizar-barra-trilha');
  if(trilha) trilha.setAttribute('aria-valuenow', Math.round(pct));
  texto.textContent = `${pct.toFixed(0)}% · ${ControleCargas.textoProgressoAtualizacao(progresso)}`;
},

/* Contexto:
   Esconde a barra e zera o preenchimento — chamada quando o Atualizar termina
   (pararAcompanhamentoProgresso) e quando o servidor diz que não há execução
   em curso. Não retorna nada.

   Pseudocódigo:
     1. Sem os elementos no DOM, sai sem erro.
     2. Esconde e zera (a próxima execução começa do zero, não da largura
        que ficou da anterior). */
esconderBarraProgresso(){
  const barra = document.getElementById('atualizar-barra');
  const preenchida = document.getElementById('atualizar-barra-preenchida');
  if(!barra || !preenchida) return;
  barra.hidden = true;
  preenchida.style.width = '0%';
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
     4. Desenha a barra com o que voltou (renderizarBarraProgresso)
        [2026-09-24 — antes o andamento ia como texto na .atualizar-msg, que
        agora fica reservada pro resultado final/erro].
     5. Qualquer erro de rede é ignorado de propósito — o progresso é
        enfeite, e a resposta do próprio /api/atualizar é quem manda. */
acompanharProgresso(estaObsoleto){
  ControleCargas.pararAcompanhamentoProgresso();

  ControleCargas.state.timerProgresso = setInterval(()=>{
    fetch('/api/atualizar/progresso')
      .then(r=> r.ok ? r.json() : null)
      .then(progresso=>{
        if(estaObsoleto && estaObsoleto()){
          ControleCargas.pararAcompanhamentoProgresso();
          return;
        }
        ControleCargas.renderizarBarraProgresso(progresso);
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
     1. Esconde a barra (o Atualizar acabou — ou outro assumiu).
     2. Sem timer guardado no state, sai.
     3. Cancela o timer e limpa a referência. */
pararAcompanhamentoProgresso(){
  ControleCargas.esconderBarraProgresso();
  if(!ControleCargas.state.timerProgresso) return;
  clearInterval(ControleCargas.state.timerProgresso);
  ControleCargas.state.timerProgresso = null;
},

});
