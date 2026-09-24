/* ControleCargas.selecao_celula — célula selecionada na matriz e o vínculo
   dela com as colunas Responsável / Comentário sobre atuação.
   ====================================================================
   [2026-09-24, pedido do usuário: "precisamos implementar seleção de célula
   na matriz, onde eu possa ver o comentário, criar, editar, mudar o
   responsável" + "quero que continuar o painel lateral de Responsável e
   comentários e a seleção dele seja dinâmica. Caso click uma vez, aparece o
   comentário editável nele. Caso click novamente na celula, aparece todas
   informações"]

   O que muda no gesto:
     - 1º clique numa célula: SELECIONA (contorno na célula). As 2 colunas da
       direita — Responsável e Comentário sobre atuação, o "painel lateral" —
       passam a mostrar e editar a anotação DAQUELE DIA, não mais a da data de
       referência. A célula selecionada é uma só na tela inteira.
     - 2º clique na MESMA célula: abre o painel completo (modal de 9 seções),
       que é o que o clique fazia sozinho antes.

   Por que a anotação passou a ser por dia [decisão do usuário, mesma data]:
   ela sempre foi gravada por `referenceDate` (anotacoes.js), e o backend
   nunca exigiu que essa data fosse a de referência — a chave é
   (targetType, targetId, data). Então "responsável do dia 15" cabe no mesmo
   arquivo, sem migração: muda só QUAL data a tela manda ao gravar. Quem não
   selecionou nada continua editando a data de referência, como sempre.

   Parte do objeto único ControleCargas (ver state.js) — 1 arquivo por
   funcionalidade (CLAUDE.md §4). */
Object.assign(ControleCargas, {

/* Contexto:
   Diz se (view, rid, date) é a célula selecionada agora — usada pelo clique
   (wireRowClicks, paineis.js) pra distinguir o 1º do 2º clique, e por
   rowHtml() (matriz.js) pra marcar a célula ao desenhar. Retorna bool.

   Pseudocódigo:
     1. Sem seleção -> false.
     2. Compara as 3 partes (aba, linha e dia). */
celulaEstaSelecionada(view, rid, date){
  const sel = ControleCargas.state.celulaSelecionada;
  return !!sel && sel.view === view && sel.rid === rid && sel.date === date;
},

/* Contexto:
   Data que as colunas Responsável / Comentário sobre atuação de UMA linha
   editam agora: a do dia selecionado, quando a seleção está nessa linha, ou
   a data de referência do grid (comportamento de sempre) quando não está.
   Usada por colunasAnotacaoHtml() (anotacoes.js) e por quem grava a edição.
   Retorna string "YYYY-MM-DD".

   A seleção é de UMA célula só, então no máximo 1 linha da grade fica
   apontando pra um dia diferente — as demais seguem a referência.

   Pseudocódigo:
     1. Seleção na mesma aba e na mesma linha -> a data dela.
     2. Caso contrário -> data de referência do snapshot. */
dataAnotacaoDaLinha(rid){
  const sel = ControleCargas.state.celulaSelecionada;
  if(sel && sel.view === ControleCargas.state.view && sel.rid === rid) return sel.date;
  return ControleCargas.SNAPSHOT.meta.referenceDate;
},

/* Contexto:
   Marca a célula clicada como selecionada e religa as colunas de anotação da
   linha ao dia dela. Chamada pelo 1º clique numa célula (wireRowClicks,
   paineis.js). Não retorna nada.

   De propósito NÃO chama buildMatrix(): repintar 1000 linhas a cada clique
   deixaria o gesto lento e faria a grade "piscar". Só o que muda é
   atualizado — o contorno das 2 células envolvidas e os 2 campos da linha
   (antes e depois da troca).

   Pseudocódigo:
     1. Guarda a linha que estava selecionada antes (os campos dela precisam
        voltar pra data de referência).
     2. Grava a seleção nova no estado.
     3. Repinta o contorno (pintarSelecaoCelula).
     4. Redesenha as colunas de anotação da linha antiga e da nova. */
selecionarCelula(view, rid, date){
  const anterior = ControleCargas.state.celulaSelecionada;
  ControleCargas.state.celulaSelecionada = {view, rid, date};
  ControleCargas.pintarSelecaoCelula();
  if(anterior && anterior.rid !== rid) ControleCargas.redesenharColunasAnotacao(anterior.rid);
  ControleCargas.redesenharColunasAnotacao(rid);
},

/* Contexto:
   Desfaz a seleção — as colunas de anotação da linha voltam a editar a data
   de referência. Chamada pelo "×" da tag de data na própria linha e pelo Esc
   (quando não há modal aberto, wireSelecaoCelula). Não retorna nada.

   Pseudocódigo:
     1. Sem seleção, não faz nada.
     2. Limpa o estado, repinta o contorno e redesenha a linha que perdeu a
        seleção. */
limparSelecaoCelula(){
  const anterior = ControleCargas.state.celulaSelecionada;
  if(!anterior) return;
  ControleCargas.state.celulaSelecionada = null;
  ControleCargas.pintarSelecaoCelula();
  ControleCargas.redesenharColunasAnotacao(anterior.rid);
},

/* Contexto:
   Sincroniza o contorno de "selecionada" no DOM da matriz com o estado —
   chamada por selecionarCelula()/limparSelecaoCelula(). rowHtml() já nasce
   com a classe certa depois de um buildMatrix(), então isto só cobre a
   troca sem repintura. Não retorna nada.

   Pseudocódigo:
     1. Tira a classe de quem quer que esteja marcado.
     2. Sem seleção, para por aqui.
     3. Acha a célula (rid + data) e marca. */
pintarSelecaoCelula(){
  document.querySelectorAll('.cell.celula-selecionada')
    .forEach(c=> c.classList.remove('celula-selecionada'));
  const sel = ControleCargas.state.celulaSelecionada;
  if(!sel) return;
  const alvo = document.querySelector(
    `#matrix .cell[data-rid="${CSS.escape(sel.rid)}"][data-date="${CSS.escape(sel.date)}"]`);
  if(alvo) alvo.classList.add('celula-selecionada');
},

/* Contexto:
   Troca no DOM as 2 células (Responsável / Comentário sobre atuação) de 1
   linha, pra elas passarem a mostrar/editar a data certa depois que a
   seleção mudou. Chamada por selecionarCelula()/limparSelecaoCelula().
   Não retorna nada.

   Religa os listeners SÓ dos inputs recriados (ligarInputAnotacao,
   anotacoes.js) — chamar wireColunasAnotacao() aqui duplicaria o listener
   de todas as outras linhas, que não foram tocadas.

   Pseudocódigo:
     1. Acha a <tr> da linha (data-rid) e as 2 <td> de anotação dela.
     2. Monta o HTML novo das 2 (colunasAnotacaoHtml já resolve a data certa
        via dataAnotacaoDaLinha).
     3. Substitui as 2 células e liga os inputs novos. */
redesenharColunasAnotacao(rid){
  const linha = document.querySelector(`#matrix tr[data-rid="${CSS.escape(rid)}"]`);
  if(!linha) return;
  const antigas = linha.querySelectorAll('td.col-anotacao');
  if(antigas.length !== 2) return;

  const targetType = ControleCargas.state.view === 'wallets' ? 'wallet' : 'grouping';
  const molde = document.createElement('tbody');
  molde.innerHTML = `<tr>${ControleCargas.colunasAnotacaoHtml(targetType, rid)}</tr>`;
  const novas = Array.from(molde.querySelector('tr').children);
  if(novas.length !== 2) return;

  antigas[0].replaceWith(novas[0]);
  antigas[1].replaceWith(novas[1]);
  novas.forEach(td=> td.querySelectorAll('.anot-input').forEach(ControleCargas.ligarInputAnotacao));
},

/* Contexto:
   Liga o que a seleção precisa fora da matriz: o "×" que volta pra data de
   referência (delegado, sobrevive a redesenho) e o Esc. Chamada 1x no
   bootstrap (index.js). Não retorna nada.

   Pseudocódigo:
     1. Clique delegado no "×" da tag de data -> limparSelecaoCelula(); o
        stopPropagation evita que o clique conte como clique na célula.
     2. Esc com o modal FECHADO -> limpa a seleção (com o modal aberto, Esc
        já é o "fechar modal" de sempre, wireModalGlobalHandlers). */
wireSelecaoCelula(){
  document.addEventListener('click', (e)=>{
    const limpar = e.target.closest('[data-acao="limpar-selecao-celula"]');
    if(!limpar) return;
    e.stopPropagation();
    ControleCargas.limparSelecaoCelula();
  });
  document.addEventListener('keydown', (e)=>{
    if(e.key !== 'Escape') return;
    const backdrop = document.getElementById('modal-backdrop');
    if(backdrop && backdrop.classList.contains('show')) return;
    ControleCargas.limparSelecaoCelula();
  });
},

});
