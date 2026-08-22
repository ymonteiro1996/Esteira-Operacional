/* ControleCargas.identificadores — botões ℹ️/📋 ao lado de nome de carteira/agrupamento e walletId/groupingId, em qualquer tela.
   Parte do objeto único ControleCargas (ver state.js). Novo arquivo
   [2026-07-30, pedido do usuário: "sempre onde tiver o nome da carteira,
   nome do grupo, ou walletid ou groupingId deve ser possível copiar
   clicando"; refinado a seguir: "conseguimos colocar um simbolo de
   informação e um de copiar?" — resolve o conflito com cliques que já
   abrem painel de detalhe (matriz, linhas de drill-through) sem tirar nada
   do que já funcionava: 📋 copia, ℹ️ só aparece onde ainda não havia
   nenhuma forma de abrir o painel daquele alvo] — CLAUDE.md §4, 1 arquivo
   por funcionalidade (não inchar matriz.js/paineis.js).
*/
Object.assign(ControleCargas, {
/* Contexto:
   Copia 1 texto pra área de transferência e mostra um aviso rápido —
   chamada por todo clique num botão 📋 (delegação em
   wireAcoesIdentificador()). Não retorna nada.

   Pseudocódigo:
     1. navigator.clipboard.writeText (API só funciona em contexto seguro —
        é o caso deste protótipo, servido em localhost).
     2. Em sucesso, mostra o toast com o texto copiado; em falha (ex.:
        permissão negada pelo navegador), mostra uma mensagem de erro no
        mesmo toast — nunca lança exceção pro usuário. */
copiarTexto(texto){
  navigator.clipboard.writeText(texto)
    .then(()=> ControleCargas.mostrarToastCopiar(`Copiado: ${texto}`))
    .catch(()=> ControleCargas.mostrarToastCopiar('Não foi possível copiar (permissão do navegador)'));
},

/* Contexto:
   Mostra um aviso pequeno e efêmero no canto da tela — feedback visual do
   copiarTexto(). Cria o elemento #copy-toast 1x (se ainda não existir) e
   reaproveita nas chamadas seguintes. Não retorna nada.

   Pseudocódigo:
     1. Sem #copy-toast no DOM, cria e anexa ao body.
     2. Grava o texto, mostra (classe "show") e agenda esconder de novo
        depois de 1.6s — limpa qualquer timeout anterior, pra 2 cliques
        rápidos em sequência não fecharem 1 toast no meio do outro. */
mostrarToastCopiar(texto){
  let el = document.getElementById('copy-toast');
  if(!el){
    el = document.createElement('div');
    el.id = 'copy-toast';
    document.body.appendChild(el);
  }
  el.textContent = texto;
  el.classList.add('show');
  clearTimeout(ControleCargas._copyToastTimer);
  ControleCargas._copyToastTimer = setTimeout(()=> el.classList.remove('show'), 1600);
},

/* Contexto:
   Monta os botões ℹ️/📋 ao lado de 1 nome/identificador (carteira,
   agrupamento, walletId ou groupingId) — reaproveitada em toda tela que
   mostra esses valores (matriz, painéis de detalhe). Os cliques são
   tratados por delegação global em wireAcoesIdentificador() — não precisa
   religar a cada redesenho/reabertura de painel. Retorna string HTML.

   Pseudocódigo:
     1. Botão 📋 sempre presente, com o texto a copiar no data-copy-text.
     2. Botão ℹ️ só quando `kind`+`id` forem passados — abre o painel de
        detalhe daquele alvo; omitido nos casos em que já existe outra
        forma de abrir esse mesmo painel a partir do mesmo elemento (ex.:
        nome da linha na matriz já abre ao clicar; walletId dentro do
        próprio painel daquele walletId seria circular). */
acoesIdentificadorHtml(textoParaCopiar, kind, id){
  let html = '';
  if(kind && id){
    html += `<button type="button" class="id-action-btn id-action-info" title="Ver detalhe" data-drill-kind="${kind}" data-drill-id="${ControleCargas.escAttr(id)}">ℹ️</button>`;
  }
  html += `<button type="button" class="id-action-btn id-action-copy" title="Copiar" data-copy-text="${ControleCargas.escAttr(textoParaCopiar)}">📋</button>`;
  return html;
},

/* Contexto:
   Marca visualmente (amarelo) qual botão 📋 foi o ÚLTIMO clicado numa
   lista — pedido do usuário 2026-08-03: "até eu clicar em outro copiar,
   ele deve ficar com o simbolo de copiar amarelo". Só 1 fica marcado por
   vez em toda a tela (matriz + modal juntos). Chamada por
   wireAcoesIdentificador() a cada clique em .id-action-copy. Não retorna
   nada.

   Pseudocódigo:
     1. Tira a marca de qualquer botão que estivesse marcado antes (nunca
        mais que 1 amarelo ao mesmo tempo).
     2. Marca o botão recém-clicado.
     3. Não precisa desmarcar sozinho depois de um tempo nem sobreviver a um
        redesenho (buildMatrix()/openModal() recriam os botões do zero, o
        que já "limpa" a marca — comportamento aceitável, o pedido foi só
        "até eu clicar em outro"). */
marcarUltimoCopiado(botao){
  document.querySelectorAll('.id-action-copy.copiado').forEach(b=> b.classList.remove('copiado'));
  botao.classList.add('copiado');
},

/* Contexto:
   Marca (fundo levemente amarelo) a <tr> da ÚLTIMA cópia via 📋 — pedido do
   usuário 2026-08-07: "ao copiar o nome na matriz pelo botão de copiar, a
   linha precisa ficar mais clara para sinalizar ela inteira"; REVISADO no
   mesmo dia: "pode deixar a linha com leve sinalização ao selecionar o
   copiar até selecionar outra" — 1ª versão piscava e apagava sozinha depois
   de ~1,3s; agora PERSISTE até a próxima cópia, mesma regra de "só 1
   marcado por vez" que o próprio botão 📋 já segue (marcarUltimoCopiado).
   Chamada por wireAcoesIdentificador() a cada clique em .id-action-copy
   (matriz e tabelas do modal, onde o mesmo botão também aparece). Não
   retorna nada.

   Pseudocódigo:
     1. Sobe até a <tr> mais próxima do botão; sem <tr> (ex.: título do
        modal, que não é linha de tabela), não faz nada.
     2. Tira a marca de qualquer linha marcada antes (nunca mais que 1 ao
        mesmo tempo).
     3. Marca a linha recém-copiada. Não precisa desmarcar sozinha depois de
        um tempo nem sobreviver a um redesenho (buildMatrix()/openModal()
        recriam as linhas do zero, o que já "limpa" a marca — mesmo
        comportamento aceito para marcarUltimoCopiado). */
destacarLinhaCopiada(botao){
  const linha = botao.closest('tr');
  if(!linha) return;
  document.querySelectorAll('tr.row-copiada').forEach(tr=> tr.classList.remove('row-copiada'));
  linha.classList.add('row-copiada');
},

/* Contexto:
   Liga, por delegação no document (1x no bootstrap — wire(), index.js —
   nunca precisa religar depois de um redesenho), os cliques em qualquer
   botão ℹ️/📋 da tela, cobrindo a matriz principal e o modal de detalhe.
   Não retorna nada.

   Pseudocódigo:
     1. Botão 📋 (.id-action-copy): copia o texto do data-copy-text, marca
        ele como o último copiado (marcarUltimoCopiado), destaca a linha
        inteira (destacarLinhaCopiada) e para a propagação (evita também
        acionar o clique da linha/nome por baixo).
     2. Botão ℹ️ (.id-action-info): abre buildWalletPanel/buildGroupingPanel
        do id indicado, focado na data de referência do grid, e também para
        a propagação. */
wireAcoesIdentificador(){
  document.addEventListener('click', (e)=>{
    const btnCopiar = e.target.closest('.id-action-copy');
    if(btnCopiar){
      e.stopPropagation();
      ControleCargas.copiarTexto(btnCopiar.dataset.copyText);
      ControleCargas.marcarUltimoCopiado(btnCopiar);
      ControleCargas.destacarLinhaCopiada(btnCopiar);
      return;
    }
    const btnInfo = e.target.closest('.id-action-info');
    if(btnInfo){
      e.stopPropagation();
      const id = btnInfo.dataset.drillId;
      const refDate = ControleCargas.SNAPSHOT.meta.referenceDate;
      if(btnInfo.dataset.drillKind === 'wallet') ControleCargas.buildWalletPanel(id, refDate);
      else ControleCargas.buildGroupingPanel(id, refDate);
    }
  });
},
});
