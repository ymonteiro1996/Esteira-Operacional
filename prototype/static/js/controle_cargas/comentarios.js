/* ControleCargas.comentarios — sistema de comentários em alertas (GET/POST /api/comments) — vigência e severidade.
   Parte do objeto único ControleCargas (ver state.js). Gerado a partir da
   refatoração de index_template.html (CLAUDE.md §4, "Divisão clara das
   páginas" — pasta static/js/controle_cargas/, 1 arquivo por funcionalidade).
*/
Object.assign(ControleCargas, {
SEVERITY_RANK: {red:3, yellow:2, green:1},   // p/ achar o comentário vigente mais grave

// ─────────────────────────────────────────────────────────────────────────
// Comentários (PLANNING §Sistema de Comentários em Alertas) — carregados de
// /api/comments (servidor Flask, app.py) na inicialização. Quando o HTML é
// aberto sem servidor (duplo-clique, file://) o fetch falha silenciosamente
// e a matriz simplesmente não mostra balões — nenhum comentário é perdido,
// eles continuam gravados em data/alert_comments.json no servidor.
// ─────────────────────────────────────────────────────────────────────────
COMMENTS: [],   // lista crua, como devolvida por GET /api/comments

/* Contexto:
   Decide se um comentário está vigente na data `todayStr` — usada por
   praticamente toda função deste arquivo antes de considerar um comentário
   para exibição. Retorna bool.

   Pseudocódigo:
     1. Não vigente se já foi marcado como resolvido.
     2. Não vigente se `todayStr` está fora do intervalo [validFrom, validTo].
     3. Caso contrário, vigente. */
isVigente(c, todayStr){
  return !c.resolved && c.validFrom <= todayStr && todayStr <= c.validTo;
},

/* Contexto:
   Separa os comentários de 1 alvo (targetType+targetId) em vigentes e
   expirados, ordenados do mais recente para o mais antigo — usada pelo
   painel de detalhe (seção Comentários) para montar as duas listas.
   Retorna {vigentes:[...], expirados:[...]}.

   Pseudocódigo:
     1. Filtra COMMENTS pelo alvo pedido.
     2. Separa em vigentes/expirados via isVigente() e ordena cada lista por
        createdAt decrescente. */
commentsForTarget(targetType, targetId){
  const todayStr = ControleCargas.SNAPSHOT.meta.today;
  const all = ControleCargas.COMMENTS.filter(c=> c.targetType===targetType && c.targetId===targetId);
  const vigentes = all.filter(c=> ControleCargas.isVigente(c, todayStr)).sort((a,b)=> b.createdAt.localeCompare(a.createdAt));
  const expirados = all.filter(c=> !ControleCargas.isVigente(c, todayStr)).sort((a,b)=> b.createdAt.localeCompare(a.createdAt));
  return {vigentes, expirados};
},

/* Contexto:
   Acha os comentários que COBREM a data `cellDate` de 1 alvo — extraído de
   cellCommentSeverity() [2026-07-23, pedido do usuário: "ao passar o mouse
   no balão e na célula precisa aparecer o comentário"] pra ser reaproveitado
   tanto por quem só precisa da severidade (cellCommentSeverity, pra colorir)
   quanto por quem precisa do TEXTO (cellCommentTexts/rowCommentTexts, pro
   hover mostrar o comentário de verdade em vez de um rótulo genérico).
   Cobre 2 tipos de comentário: o de CÉLULA específica (cellDate exatamente
   igual à data pedida) e o de LINHA inteira com intervalo de vigência
   (cellDate nulo, validFrom..validTo) — vigência testada contra a PRÓPRIA
   DATA DA CÉLULA, não o hoje real (mesma regra de 2026-07-23). Retorna
   array de comentários (vazio quando nenhum cobre essa data).

   Pseudocódigo:
     1. Filtra COMMENTS pelo alvo, e que ou (a) têm cellDate exatamente
        igual à data pedida, ou (b) são de linha inteira (cellDate nulo) —
        nos dois casos, exige validFrom ≤ cellDate ≤ validTo (isVigente
        reaproveitada com a data da CÉLULA no lugar do "hoje"). */
commentsForCellDate(targetType, targetId, cellDate){
  return ControleCargas.COMMENTS.filter(c=> c.targetType===targetType && c.targetId===targetId
                                 && (c.cellDate===cellDate || c.cellDate===null)
                                 && ControleCargas.isVigente(c, cellDate));
},

/* Contexto:
   Severidade mais grave entre os comentários que cobrem `cellDate` de 1
   alvo (red > yellow > green) — usada por rowHtml()/miniTimelineHtml() para
   colorir o balão da célula. Retorna 'red'/'yellow'/'green' ou null (nenhum
   comentário cobre essa data).

   Pseudocódigo:
     1. Busca os comentários que cobrem a data (commentsForCellDate).
     2. Sem nenhum -> null.
     3. Com algum -> reduz para o de maior rank de severidade. */
cellCommentSeverity(targetType, targetId, cellDate){
  const hits = ControleCargas.commentsForCellDate(targetType, targetId, cellDate);
  if(!hits.length) return null;
  return hits.reduce((worst,c)=> (ControleCargas.SEVERITY_RANK[c.severity]>ControleCargas.SEVERITY_RANK[worst]) ? c.severity : worst, 'green');
},

/* Contexto:
   Texto do(s) comentário(s) que cobrem `cellDate` de 1 alvo, já pronto pra
   exibir num tooltip/title — pedido do usuário 2026-07-23 ("ao passar o
   mouse... precisa aparecer o comentário"). Usada pelo tooltip customizado
   da célula (walletTooltip()/groupingTooltip(), matriz.js). Retorna string
   (vazia quando não há comentário cobrindo essa data).

   Pseudocódigo:
     1. Busca os comentários que cobrem a data (commentsForCellDate).
     2. Junta o texto de cada um com "; " (normalmente é só 1). */
cellCommentTexts(targetType, targetId, cellDate){
  return ControleCargas.commentsForCellDate(targetType, targetId, cellDate).map(c=> c.text).join('; ');
},

/* Contexto:
   Severidade do(s) comentário(s) que cobrem QUALQUER dia da janela
   ATUALMENTE EXIBIDA no grid, pra 1 alvo — usada por rowHtml() pro balão ao
   lado do nome (resumo "esta linha tem alerta visível na janela"). Retorna
   'red'/'yellow'/'green' ou null.

   Pseudocódigo:
     1. Para cada dia da janela do grid, calcula a severidade da célula
        (cellCommentSeverity).
     2. Sem nenhum dia coberto -> null.
     3. Com algum -> devolve o de maior rank de severidade entre os dias. */
rowCommentSeverity(targetType, targetId){
  const window_ = ControleCargas.SNAPSHOT.meta.window;
  let pior = null;
  window_.forEach(d=>{
    const sev = ControleCargas.cellCommentSeverity(targetType, targetId, d);
    if(sev && (!pior || ControleCargas.SEVERITY_RANK[sev] > ControleCargas.SEVERITY_RANK[pior])) pior = sev;
  });
  return pior;
},

/* Contexto:
   Texto(s) distinto(s) de comentário que cobrem ALGUM dia da janela
   ATUALMENTE EXIBIDA no grid, pra 1 alvo — usada por rowHtml() pro title do
   balão ao lado do nome (pedido do usuário 2026-07-23: "ao passar o mouse
   no balão... precisa aparecer o comentário", em vez do rótulo genérico
   fixo que tinha antes). Retorna string (vazia quando nenhum dia da janela
   está coberto).

   Pseudocódigo:
     1. Para cada dia da janela, busca os comentários que cobrem aquele dia
        e acumula os textos num Set (evita repetir o mesmo texto quando um
        comentário de linha cobre vários dias da janela).
     2. Junta os textos distintos com " | ". */
rowCommentTexts(targetType, targetId){
  const window_ = ControleCargas.SNAPSHOT.meta.window;
  const textos = new Set();
  window_.forEach(d=>{
    ControleCargas.commentsForCellDate(targetType, targetId, d).forEach(c=> textos.add(c.text));
  });
  return Array.from(textos).join(' | ');
},

/* Contexto:
   Carrega a lista de comentários do servidor (GET /api/comments) para
   dentro de ControleCargas.COMMENTS. Chamada 1x no bootstrap (antes do
   init()) e de novo depois de salvar um comentário novo. Retorna a Promise
   do fetch (resolvida sempre, nunca rejeitada).

   Pseudocódigo:
     1. fetch('/api/comments'); resposta não-ok vira erro.
     2. Em sucesso, grava data.comments em ControleCargas.COMMENTS.
     3. Em qualquer falha (ex.: página aberta via file://, sem servidor),
        grava lista vazia — nunca quebra a página por falta de comentários. */
loadComments(){
  return fetch('/api/comments').then(r=>{ if(!r.ok) throw new Error('http '+r.status); return r.json(); })
    .then(data=>{ ControleCargas.COMMENTS = data.comments || []; })
    .catch(()=>{ ControleCargas.COMMENTS = []; });   // sem servidor (file://) -> sem comentários, sem quebrar a página
},

/* Contexto:
   Envia 1 comentário novo ao servidor (POST /api/comments). Chamada pelo
   handler de submit do formulário de comentário (ver
   wirePanelInteractions() em paineis.js). Retorna Promise do comentário
   criado (rejeita com Error em caso de falha, mensagem já legível).

   Pseudocódigo:
     1. POST do payload como JSON.
     2. Lê o corpo da resposta (mesmo em erro, pra pegar a mensagem).
     3. Resposta não-ok -> rejeita com o erro do servidor (ou status HTTP).
     4. Resposta ok -> resolve com o comentário criado. */
postComment(payload){
  return fetch('/api/comments', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)})
    .then(async r=>{
      const data = await r.json().catch(()=>({}));
      if(!r.ok) throw new Error(data.error || ('http '+r.status));
      return data.comment;
    });
},

/* Contexto:
   Monta o HTML da seção final "Comentários" do painel de detalhe — idêntica
   nos 2 painéis (PLANNING: painel de Agrupamento "mesmo formulário do item
   4"). Mostra vigentes → expirados → formulário de novo comentário
   (severidade / texto / período de datas). Chamada por
   buildWalletPanel()/buildGroupingPanel(). Retorna string HTML.

   Pseudocódigo:
     1. Busca os comentários do alvo e filtra pelos relevantes ao `cellDate`
        focado (o da célula específica + os de linha inteira).
     2. Renderiza a lista de vigentes e, se houver, a de expirados (com
        rótulo "expirado em ...").
     3. Monta o formulário de novo comentário (botões de severidade,
        textarea, período de datas De/Até) — [CORRIGIDO 2026-07-27, pedido
        do usuário: os campos "Válido de"/"Válido até" vinham sempre com
        "hoje", mesmo quando o comentário focava num dia passado (comum: a
        Data Referência é D-3, sempre atrás de "hoje") — o comentário nascia
        com vigência que NUNCA cobre o próprio dia ao qual está preso,
        ficando sempre "não vigente" sem o usuário entender por quê. Agora
        os campos nascem com `cellDate` (quando existe) em vez de "hoje".
        [REMOVIDO 2026-07-28, pedido do usuário: existia um 2º controle
        aqui — rádio "Pontual"/"Recorrente" — pra escolher se o comentário
        vale só pra 1 dia ou pra vários; o usuário achou os dois controles
        (rádio + datas) confusos/redundantes e pediu pra deixar a lógica
        SÓ nas datas: "se a data for de e até ao mesmo dia, já será
        pontual" — então o rádio saiu, e `wireFormularioComentarioPainel()`
        (paineis.js) agora deriva o escopo comparando os campos De/Até no
        momento do envio, sem precisar de um controle visual a mais.] */
commentsSectionHtml(targetType, targetId, cellDate){
  const {vigentes, expirados} = ControleCargas.commentsForTarget(targetType, targetId);
  // "este dia" = cellDate do dia focado; "linha toda" = cellDate null.
  const relevantVig = vigentes.filter(c=> c.cellDate===cellDate || c.cellDate===null);
  const relevantExp = expirados.filter(c=> c.cellDate===cellDate || c.cellDate===null);

  const renderList = (list, expired)=> list.map(c=>{
    const scopeLabel = c.cellDate ? `dia ${c.cellDate}` : (targetType==='wallet'?'carteira toda':'agrupamento todo');
    return `<div class="comment-item"><div class="chead">
      <span class="comment-dot ${c.severity}"></span>
      <span class="cauthor">${ControleCargas.esc(c.author)}</span>
      <span class="cvalid">${scopeLabel} · vigência ${c.validFrom} → ${c.validTo}</span>
      ${expired?`<span class="cexpired-tag">expirado em ${ControleCargas.esc(c.validTo)}</span>`:''}
    </div><div class="ctext">${ControleCargas.esc(c.text)}</div></div>`;
  }).join('');

  let html = `<div class="psec"><h4>Comentários</h4>`;
  if(!relevantVig.length && !relevantExp.length){
    html += `<p class="empty-note">Nenhum comentário registrado para este alvo.</p>`;
  } else {
    if(relevantVig.length) html += renderList(relevantVig, false);
    if(relevantExp.length) html += `<div style="margin-top:10px;font-size:10.5px;color:var(--ink-faint);font-weight:700;text-transform:uppercase;letter-spacing:.05em;">Expirados</div>` + renderList(relevantExp, true);
  }

  // vigência default: a data da CÉLULA clicada (De=Até=cellDate, já nasce
  // "pontual" nesse dia) — não "hoje" — ver correção 2026-07-27 na
  // docstring acima.
  const dataVigenciaDefault = cellDate || ControleCargas.SNAPSHOT.meta.today;
  html += `<div class="comment-form" data-target-type="${targetType}" data-target-id="${ControleCargas.escAttr(targetId)}">
    <div class="sevbtns">
      <button type="button" class="sevbtn" data-sev="green">Verde</button>
      <button type="button" class="sevbtn" data-sev="yellow">Amarelo</button>
      <button type="button" class="sevbtn" data-sev="red">Vermelho</button>
    </div>
    <textarea placeholder="Descreva a situação (ex.: 'fornecedor avisou do atraso, sem risco')..."></textarea>
    <div class="fieldlabel">Período de datas (vigência do comentário)</div>
    <div class="datesrow">
      <label>De <input type="date" class="cf-from" value="${dataVigenciaDefault}"></label>
      <label>Até <input type="date" class="cf-to" value="${dataVigenciaDefault}"></label>
    </div>
    <p class="psub">De = Até (mesmo dia) → comentário aparece só nesse dia. Datas diferentes → aparece em todos os dias do período.</p>
    <button class="btn" type="button" data-action="submit-comment">Adicionar comentário</button>
    <div class="formmsg"></div>
  </div></div>`;
  return html;
},
});
