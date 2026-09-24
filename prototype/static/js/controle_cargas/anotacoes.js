/* ControleCargas.anotacoes — colunas editáveis "Responsável"/"Comentário sobre atuação" (GET/POST /api/annotations).
   Parte do objeto único ControleCargas (ver state.js). Novo arquivo
   [2026-07-24, pedido do usuário: "criar coluna que podemos descrever um
   Comentário Sobre atuação... e também uma coluna de responsável... deixar
   no estilo o mais excel possível e um botão de salvar"] — CLAUDE.md §4, 1
   arquivo por funcionalidade (não inchar matriz.js/paineis.js).
*/
Object.assign(ControleCargas, {
// ─────────────────────────────────────────────────────────────────────────
// Anotações por linha (Responsável / Comentário sobre atuação), SÓ na data
// de referência do grid (nunca por dia da janela) — carregadas de
// /api/annotations (servidor Flask, app.py) na inicialização. Editadas
// inline, acumuladas em memória (PENDING_ANNOTATIONS) até o usuário clicar
// em "Salvar" (POST em lote) — mesmo espírito do congelamento de ordem já
// existente: nada é perdido por falta de servidor, só não persiste.
// ─────────────────────────────────────────────────────────────────────────
ANNOTATIONS: {},           // dict cru {chave: {...}}, como devolvido por GET /api/annotations
PENDING_ANNOTATIONS: {},   // edições ainda não salvas, mesma chave — sobrepõe ANNOTATIONS na leitura

/* Contexto:
   Monta a chave composta (targetType, targetId, referenceDate) usada para
   indexar ANNOTATIONS/PENDING_ANNOTATIONS — MESMO formato usado pelo
   backend (_chave_anotacao, app.py). Usada por praticamente toda função
   deste arquivo. Retorna string.

   Pseudocódigo:
     1. Junta targetType + targetId + referenceDate com "|" (mesmo separador
        do backend). */
chaveAnotacao(targetType, targetId, referenceDate){
  return `${targetType}|${targetId}|${referenceDate}`;
},

/* Contexto:
   Resolve o valor CORRENTE (pendente > salvo > vazio) de uma anotação, pra
   desenhar os campos editáveis com o conteúdo certo. Usada por
   colunasAnotacaoHtml(). Retorna {responsavel, comentarioAtuacao} (strings,
   nunca undefined).

   Pseudocódigo:
     1. Monta a chave pra (targetType, targetId, `data`) — [2026-09-24,
        pedido do usuário: seleção de célula] o 3º argumento é opcional e
        quase sempre vem vazio; sem ele vale a data de referência, como
        sempre. Com uma célula selecionada, a linha dela manda o dia da
        célula (ver dataAnotacaoDaLinha, selecao_celula.js).
     2. Edição pendente ainda não salva tem prioridade (é o que o usuário
        está vendo/editando agora).
     3. Sem pendência, usa o valor já salvo (ANNOTATIONS).
     4. Sem nenhum dos dois, strings vazias. */
annotationAtual(targetType, targetId, data){
  const refDate = data || ControleCargas.SNAPSHOT.meta.referenceDate;
  const chave = ControleCargas.chaveAnotacao(targetType, targetId, refDate);
  const pendente = ControleCargas.PENDING_ANNOTATIONS[chave];
  const salva = ControleCargas.ANNOTATIONS[chave];
  const fonte = pendente || salva || {};
  return { responsavel: fonte.responsavel || '', comentarioAtuacao: fonte.comentarioAtuacao || '' };
},

/* Contexto:
   Carrega as anotações do servidor (GET /api/annotations) para dentro de
   ControleCargas.ANNOTATIONS. Chamada 1x no bootstrap (antes do init(), lado
   a lado com loadComments()) e de novo depois de salvar um lote. Retorna a
   Promise do fetch (resolvida sempre, nunca rejeitada).

   Pseudocódigo:
     1. fetch('/api/annotations'); resposta não-ok vira erro.
     2. Em sucesso, grava data.annotations em ControleCargas.ANNOTATIONS.
     3. Em qualquer falha (ex.: sem servidor), grava dict vazio — nunca
        quebra a página por falta de anotações. */
loadAnnotations(){
  return fetch('/api/annotations').then(r=>{ if(!r.ok) throw new Error('http '+r.status); return r.json(); })
    .then(data=>{ ControleCargas.ANNOTATIONS = data.annotations || {}; })
    .catch(()=>{ ControleCargas.ANNOTATIONS = {}; });
},

/* Contexto:
   Grava 1 edição de campo (responsavel/comentarioAtuacao) no buffer de
   pendências — chamada pelo handler de input/change dos campos editáveis
   (wireColunasAnotacao()). NÃO chama o servidor (só o botão "Salvar" faz
   isso) — permite editar várias linhas antes de persistir, "estilo Excel".
   Não retorna nada.

   Pseudocódigo:
     1. Monta a chave (targetType, targetId, `data` — a do dia selecionado
        quando a linha está com uma célula marcada; senão a de referência,
        comportamento de sempre [2026-09-24]).
     2. Parte do valor pendente já acumulado (ou do valor salvo, se essa
        linha ainda não tem pendência) e sobrescreve só o campo editado.
     3. Atualiza o indicador visual do botão "Salvar" (tem pendência?). */
registrarEdicaoAnotacao(targetType, targetId, campo, valor, data){
  const refDate = data || ControleCargas.SNAPSHOT.meta.referenceDate;
  const chave = ControleCargas.chaveAnotacao(targetType, targetId, refDate);
  const base = ControleCargas.PENDING_ANNOTATIONS[chave] || ControleCargas.ANNOTATIONS[chave] || {};
  ControleCargas.PENDING_ANNOTATIONS[chave] = {
    targetType, targetId, referenceDate: refDate,
    responsavel: base.responsavel || '', comentarioAtuacao: base.comentarioAtuacao || '',
    [campo]: valor,
  };
  ControleCargas.atualizarBotaoSalvarAnotacoes();
},

/* Contexto:
   Mostra/esconde e habilita/desabilita o botão "Salvar" conforme há ou não
   edições pendentes — feedback visual de que existe algo pra persistir
   ("estilo Excel": editar não salva sozinho). Chamada por
   registrarEdicaoAnotacao() e depois de salvarAnotacoes()/loadAnnotations().
   Não retorna nada.

   Pseudocódigo:
     1. Sem o botão no DOM (HTML antigo em cache), sai sem erro.
     2. Conta quantas chaves há em PENDING_ANNOTATIONS.
     3. Sem pendência -> botão desabilitado, texto padrão.
     4. Com pendência -> botão habilitado, texto com a contagem. */
atualizarBotaoSalvarAnotacoes(){
  const btn = document.getElementById('btn-salvar-anotacoes');
  if(!btn) return;
  const n = Object.keys(ControleCargas.PENDING_ANNOTATIONS).length;
  btn.disabled = n===0;
  btn.textContent = n>0 ? `💾 Salvar (${n})` : '💾 Salvar';
},

/* Contexto:
   Envia o lote de edições pendentes ao servidor (POST /api/annotations).
   Chamada pelo clique no botão "Salvar" (wireSalvarAnotacoes()). Retorna
   Promise (resolvida sempre — erro já vira mensagem no "grid-note", mesmo
   padrão de executarAtualizacao()/atualizar.js).

   Pseudocódigo:
     1. Sem pendência, não faz nada (botão já vem desabilitado, mas defende
        contra clique via teclado/DevTools).
     2. POST do array de valores de PENDING_ANNOTATIONS.
     3. Em sucesso: substitui ANNOTATIONS pelo dict devolvido (já com os
        author/updatedAt do servidor), limpa PENDING_ANNOTATIONS e
        reconstrói a matriz (os campos voltam a mostrar o valor salvo).
     4. Em erro: mantém as pendências intactas (nada se perde) e mostra a
        mensagem no "grid-note". */
salvarAnotacoes(){
  const itens = Object.values(ControleCargas.PENDING_ANNOTATIONS);
  const msgEl = document.getElementById('grid-note');
  if(!itens.length) return Promise.resolve();

  const btn = document.getElementById('btn-salvar-anotacoes');
  if(btn) btn.disabled = true;

  return fetch('/api/annotations', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({annotations: itens})})
    .then(async r=>{
      const data = await r.json().catch(()=>({}));
      if(!r.ok) throw new Error(data.error || ('http '+r.status));
      ControleCargas.ANNOTATIONS = data.annotations || ControleCargas.ANNOTATIONS;
      ControleCargas.PENDING_ANNOTATIONS = {};
      ControleCargas.atualizarBotaoSalvarAnotacoes();
      ControleCargas.buildMatrix();
    })
    .catch(err=>{
      if(msgEl) msgEl.textContent = 'Erro ao salvar anotações: ' + err.message;
      ControleCargas.atualizarBotaoSalvarAnotacoes();
    });
},

/* Contexto:
   Monta as 2 colunas editáveis (Responsável / Comentário sobre atuação) de
   1 linha da matriz — reaproveitada pelas duas abas (Carteiras/Agrupamentos,
   mesma paridade de colunas do resto da grade). Usada por rowHtml()
   (matriz.js). Retorna string HTML (2 <td>).

   Pseudocódigo:
     1. Resolve o valor corrente (pendente > salvo > vazio).
     2. Resolve a severidade do comentário vigente NA DATA EDITADA
        (cellCommentSeverity) — [2026-08-07, pedido do usuário: "o
        comentário vigente verde/amarelo/vermelho aparecer como sinalização
        nas células Responsável e Comentário, para avaliar antes de lançar
        responsável"; escolhida a opção "fundo tingido" dentre 3 mockups]
        e aplica como classe extra em cada <td> (.sev-green/-yellow/-red,
        ver controle_cargas.css) — sem severidade nenhuma, nenhuma classe
        extra (fundo normal).
     3. Monta 1 <input> (Responsável, texto curto) + 1 <input> (Comentário,
        texto livre) com data-attributes de identificação (targetType/
        targetId) pra o handler de input achar a linha certa. */
colunasAnotacaoHtml(targetType, targetId){
  // [2026-09-24, pedido do usuário: "a seleção dele seja dinâmica"] A data
  // editada aqui é a do dia SELECIONADO nesta linha (selecao_celula.js) —
  // sem seleção, segue sendo a de referência, como sempre.
  const data = ControleCargas.dataAnotacaoDaLinha(targetId);
  const refDate = ControleCargas.SNAPSHOT.meta.referenceDate;
  const {responsavel, comentarioAtuacao} = ControleCargas.annotationAtual(targetType, targetId, data);
  const sev = ControleCargas.cellCommentSeverity(targetType, targetId, data);
  const classeSev = sev ? ` sev-${sev}` : '';
  // Tag sempre que a linha tem célula selecionada — inclusive quando o dia
  // selecionado É a data de referência [REVISADO 2026-09-24, pedido do
  // usuário: "aparecer a data no campo responsável mesmo que seja selecionada
  // célula na D-1"]: a 1ª versão só mostrava a tag quando o dia era diferente
  // da referência, então clicar na coluna de referência (hoje D-1) não
  // mostrava data nenhuma — justo a coluna mais usada. Sem seleção, nenhuma
  // tag: seriam 1000 tags repetindo a mesma data.
  const selecionada = ControleCargas.linhaTemCelulaSelecionada(targetId);
  const ajudaTag = data === refDate
    ? `Editando a anotação de ${data} (célula selecionada) — que é a data de referência do grid`
    : `Editando a anotação do dia ${data} (célula selecionada), não a da data de referência ${refDate}`;
  const tagData = !selecionada ? '' :
    `<span class="anot-data-tag${data === refDate ? ' na-referencia' : ''}" title="${ControleCargas.escAttr(ajudaTag)}">${ControleCargas.esc(ControleCargas.fmtDM(data))}`
    + `<button type="button" class="anot-data-x" data-acao="limpar-selecao-celula" title="Tirar a seleção (as duas colunas voltam a editar a data de referência)">×</button></span>`;
  const atributos = `data-target-type="${targetType}" data-target-id="${ControleCargas.escAttr(targetId)}" data-data="${ControleCargas.escAttr(data)}"`;
  return `<td class="col-anotacao${classeSev}">${tagData}<input type="text" class="anot-input anot-responsavel" ${atributos} value="${ControleCargas.escAttr(responsavel)}" placeholder="—"></td>` +
         `<td class="col-anotacao col-anotacao-comentario${classeSev}"><input type="text" class="anot-input anot-comentario" ${atributos} value="${ControleCargas.escAttr(comentarioAtuacao)}" placeholder="Comentário sobre atuação..."></td>`;
},

/* Contexto:
   Liga o clique do botão "Salvar" da toolbar2. Chamada 1x no bootstrap
   (index.js). Não retorna nada.

   Pseudocódigo:
     1. Sem o botão no DOM (HTML antigo em cache), sai sem erro.
     2. No clique, chama salvarAnotacoes() e sincroniza o estado inicial do
        botão (sem pendência ao carregar a página). */
wireSalvarAnotacoes(){
  const btn = document.getElementById('btn-salvar-anotacoes');
  if(!btn) return;
  btn.addEventListener('click', ()=> ControleCargas.salvarAnotacoes());
  ControleCargas.atualizarBotaoSalvarAnotacoes();
},

/* Contexto:
   Liga os campos editáveis (Responsável/Comentário) recém-desenhados pela
   matriz — precisa religar a cada buildMatrix() (o DOM das linhas é
   recriado do zero). Chamada no fim de buildMatrix() (matriz.js), mesmo
   padrão de initTooltip()/wireRowClicks(). Não retorna nada.

   Pseudocódigo:
     1. Para cada .anot-input, liga o evento "input" (a cada tecla, não só
        no blur — "estilo Excel", edição imediata) que grava no buffer de
        pendências (registrarEdicaoAnotacao). */
wireColunasAnotacao(){
  document.querySelectorAll('.anot-input').forEach(ControleCargas.ligarInputAnotacao);
},

/* Contexto:
   Liga 1 campo editável de anotação ao buffer de pendências. Extraída de
   wireColunasAnotacao() [2026-09-24] pra o redesenho de UMA linha
   (redesenharColunasAnotacao, selecao_celula.js) poder religar só os campos
   que ele recriou — chamar wireColunasAnotacao() de novo duplicaria o
   listener de todas as outras linhas. Não retorna nada.

   Pseudocódigo:
     1. A cada tecla ("estilo Excel", não espera o blur), descobre qual dos 2
        campos é e grava no buffer, com a DATA que a célula está editando
        (data-data — a do dia selecionado ou a de referência). */
ligarInputAnotacao(inp){
  inp.addEventListener('input', ()=>{
    const campo = inp.classList.contains('anot-responsavel') ? 'responsavel' : 'comentarioAtuacao';
    ControleCargas.registrarEdicaoAnotacao(inp.dataset.targetType, inp.dataset.targetId, campo, inp.value, inp.dataset.data);
  });
},

/* Contexto:
   Texto do Comentário sobre atuação de 1 alvo, só quando `date` É a data de
   referência do grid (a anotação NUNCA vale para outro dia da janela — ver
   ANNOTATIONS acima) — usada por rowHtml() (matriz.js) pra decidir se
   desenha o marcador dentro do balão da célula [2026-07-30, pedido do
   usuário: "criar um simbolo na matriz... quando passar o mouse deve
   aparecer esse comentário e também ao clickar" — decisão, após indas e
   vindas com o usuário: o marcador entra DENTRO do balão de Comentário de
   alerta que já existe (canto inferior direito), não num canto novo (os 4
   cantos + a borda já estão todos ocupados pelos outros marcadores) — ver
   nota em rowHtml()]. Retorna string (vazia quando não se aplica).

   Pseudocódigo:
     1. Devolve o texto gravado para (alvo, `date`) — vazio quando não há.
        [REVISADO 2026-09-24, pedido do usuário: agora a anotação pode ser de
        qualquer dia da janela (seleção de célula), então o dia deixou de ser
        filtrado aqui: quem responde é o próprio dicionário de anotações.] */
atuacaoTextoNaData(targetType, targetId, date){
  return ControleCargas.annotationAtual(targetType, targetId, date).comentarioAtuacao;
},

/* Contexto:
   Responsável de 1 alvo, só quando `date` é a data de referência do grid —
   mesmo espelho de atuacaoTextoNaData() só que pro campo Responsável.
   Usada por walletTooltip()/groupingTooltip() (matriz.js) [2026-07-30,
   pedido do usuário: "na atuação pode aparecer Responsável & Comentário
   sobre atuação" — o hover mostrava só o comentário, faltava dizer QUEM é
   o responsável]. Retorna string (vazia quando não se aplica).

   Pseudocódigo:
     1. Devolve o responsável gravado para (alvo, `date`) — vazio quando não
        há. [REVISADO 2026-09-24: vale pra qualquer dia, ver
        atuacaoTextoNaData.] */
atuacaoResponsavelNaData(targetType, targetId, date){
  return ControleCargas.annotationAtual(targetType, targetId, date).responsavel;
},

/* Contexto:
   Se existe ALGUMA anotação (Responsável OU Comentário sobre atuação, os
   dois campos contam) pra 1 alvo em `date` — usada por rowHtml() (matriz.js)
   pra decidir se desenha o `.atuacao-dot` (ponto azul) na célula
   [2026-08-06, pedido do usuário: "pode deixar a inclusão desse ícone para
   quando só houver responsável também" — antes o ponto só aparecia com
   Comentário sobre atuação preenchido; quem preenchia só o Responsável
   (comum — nem toda linha tem comentário, mas quase toda tem responsável)
   não tinha NENHUM indicador visual na matriz de que a anotação existia].
   Retorna bool.

   Pseudocódigo:
     1. True se responsável OU comentário tiver algum texto naquele dia (não
        os dois vazios). [REVISADO 2026-09-24, pedido do usuário: com a
        seleção de célula a anotação pode ser de qualquer dia, e é este ponto
        azul que faz ela aparecer na grade no dia certo — sem isso, uma
        anotação gravada no dia 15 ficaria invisível.] */
anotacaoExisteNaData(targetType, targetId, date){
  const {responsavel, comentarioAtuacao} = ControleCargas.annotationAtual(targetType, targetId, date);
  return Boolean(responsavel || comentarioAtuacao);
},

/* Contexto:
   Monta o resumo "Responsável / Comentário sobre atuação" pro cabeçalho dos
   painéis de detalhe (buildSecaoCabecalhoCarteira/Grouping, paineis.js) —
   pedido do usuário 2026-07-30: o balão da célula já mostra o comentário no
   HOVER (tooltip), mas o CLIQUE abre o modal por cima (z-index maior),
   escondendo o tooltip; este resumo garante que o clique também mostra a
   informação, só que dentro do modal. Somente leitura (a edição continua só
   pelo input da matriz, wireColunasAnotacao) — some por completo quando os
   2 campos estão vazios. Retorna string HTML (vazia quando não há nada a
   mostrar).

   Pseudocódigo:
     1. Resolve o valor corrente (annotationAtual).
     2. Sem responsável e sem comentário -> string vazia.
     3. Com algum dos dois, monta 1 linha com os campos presentes, rotulada
        com o dia a que a anotação pertence — o dia FOCADO no painel
        [REVISADO 2026-09-24: com a seleção de célula a anotação pode ser de
        qualquer dia da janela, então o painel mostra a do dia que ele está
        focando, não sempre a da referência]. */
resumoAtuacaoHtml(targetType, targetId, data){
  const dia = data || ControleCargas.SNAPSHOT.meta.referenceDate;
  const {responsavel, comentarioAtuacao} = ControleCargas.annotationAtual(targetType, targetId, dia);
  if(!responsavel && !comentarioAtuacao) return '';
  const partes = [];
  if(responsavel) partes.push(`<b>Responsável:</b> ${ControleCargas.esc(responsavel)}`);
  if(comentarioAtuacao) partes.push(`<b>Comentário sobre atuação:</b> ${ControleCargas.esc(comentarioAtuacao)}`);
  return `<p class="psub" style="margin-top:8px;">${partes.join(' · ')} <span style="color:var(--ink-faint)">(${ControleCargas.esc(dia)} — editável na matriz)</span></p>`;
},
});

/* Contexto:
   Avisa o usuário se ele tentar fechar a aba/janela ou recarregar a página
   com edições de Responsável/Comentário sobre atuação ainda não salvas —
   [2026-08-25, colega de time relatou "não consegui visualizar o
   comentário e responsável que salvei": digitar nos campos só guarda a
   edição em memória (PENDING_ANNOTATIONS, "estilo Excel"), nada é enviado
   ao servidor até o clique em "💾 Salvar"; fechar/recarregar a aba antes
   disso descartava a edição sem nenhum aviso]. Ligado 1x, em module scope,
   junto com o resto do bootstrap sem-tela do arquivo (mesmo padrão do fim
   de index.js: wireModalGlobalHandlers()/wireFilterShortcuts()/
   wireAtualizar() chamadas soltas, fora de wire()) — não precisa mexer em
   nenhuma função já existente.

   Pseudocódigo:
     1. No evento beforeunload, se houver alguma chave pendente em
        PENDING_ANNOTATIONS, cancela o evento e seta e.returnValue — é só
        essa combinação que faz o navegador mostrar o diálogo nativo de
        confirmação (o texto customizado não é mais suportado pelos
        browsers modernos, só a presença do diálogo em si). */
window.addEventListener('beforeunload', (e)=>{
  if(Object.keys(ControleCargas.PENDING_ANNOTATIONS).length > 0){
    e.preventDefault();
    e.returnValue = '';
  }
});
