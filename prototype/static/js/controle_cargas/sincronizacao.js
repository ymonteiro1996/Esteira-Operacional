/* ControleCargas.sincronizacao — traz para a tela, sozinho, o que OUTRA
   PESSOA gravou nos arquivos compartilhados (alert_comments.json e
   wallet_annotations.json, na pasta do OneDrive do time).
   ====================================================================
   [2026-09-21, decisão do usuário: "esses dados ... precisam estar na rede,
   nós editamos isso em várias pessoas" + "vamos hospedar no one drive mesmo"]

   O que este arquivo resolve: os quatro arquivos de dado transacional moram
   numa pasta sincronizada, e cada pessoa roda o próprio Flask contra ela. O
   servidor sempre relê o arquivo do disco antes de responder, então o dado
   do colega JÁ ficava disponível assim que o OneDrive sincronizava — só que
   a tela só buscava comentários e anotações em dois momentos: no bootstrap
   (index.js) e depois de um "Atualizar" (atualizar.js). Quem deixava a aba
   aberta a manhã inteira ficava olhando um retrato do momento em que abriu,
   sem nenhum sinal de que havia coisa nova.

   O que este arquivo NÃO resolve, de propósito: duas pessoas editando a
   MESMA anotação (mesma carteira, mesma data de referência) antes de uma
   sincronização continua sendo last-writer-wins, com o desempate por
   `updatedAt` feito no servidor (ver _mesclar_copias_conflito_annotations em
   app.py). Aqui a gente só avisa quando isso está prestes a acontecer, no
   momento em que o dado do colega chega e colide com uma edição sua ainda
   não salva.

   Parte do objeto único ControleCargas (ver state.js) — pasta
   static/js/controle_cargas/, 1 arquivo por funcionalidade (CLAUDE.md §4). */
Object.assign(ControleCargas, {

// De quanto em quanto tempo consultar o servidor. 60s é folgado de
// propósito: são 2 GETs num arquivo local pequeno, e o gargalo real da
// propagação não é este intervalo — é o tempo que o OneDrive leva pra
// sincronizar a máquina de quem gravou.
INTERVALO_SINCRONIZACAO_MS: 60000,

// Novidades já baixadas mas ainda NÃO aplicadas porque não era seguro
// repintar na hora (modal aberto ou pessoa digitando). Formato:
// {comentarios:[...], anotacoes:{...}, resumo:'...'}. null = nada pendente.
novidadesPendentes: null,

_timerSincronizacao: null,

/* Contexto:
   Assinatura curta e ORDEM-INDEPENDENTE da lista de comentários — usada
   para decidir se o que voltou do servidor é diferente do que já está na
   tela, sem comparar os objetos inteiros. Retorna string.

   Ordem-independente porque a mesclagem de cópia de conflito do servidor
   pode reordenar a lista sem que nada tenha mudado de fato; comparar o JSON
   cru geraria repintura à toa. Retorna string.

   Pseudocódigo:
     1. Reduz cada comentário a id + updatedAt + resolved (é tudo que pode
        mudar num comentário — o resto é imutável depois de criado).
     2. Ordena e junta. */
assinaturaComentarios(comentarios){
  return (comentarios || [])
    .map(c=> `${c.id}|${c.updatedAt||''}|${c.resolved?1:0}`)
    .sort()
    .join('\n');
},

/* Contexto:
   Mesma ideia de assinaturaComentarios(), para o dict de anotações: chave
   composta + updatedAt, que é o campo que o servidor reescreve a cada
   POST /api/annotations. Retorna string.

   Pseudocódigo:
     1. Reduz cada par (chave, registro) a "chave|updatedAt".
     2. Ordena e junta. */
assinaturaAnotacoes(anotacoes){
  return Object.keys(anotacoes || {})
    .map(chave=> `${chave}|${(anotacoes[chave]||{}).updatedAt||''}`)
    .sort()
    .join('\n');
},

/* Contexto:
   Diz se dá pra repintar a matriz AGORA sem atrapalhar a pessoa — chamada
   por buscarNovidadesCompartilhadas() antes de aplicar o que chegou.
   Retorna bool.

   buildMatrix() reconstrói o DOM inteiro da tabela: fazer isso enquanto
   alguém digita numa célula de Responsável tira o foco do campo no meio da
   frase, e fazer com um modal aberto repinta o que está atrás dele. Nos dois
   casos a novidade fica guardada em `novidadesPendentes` e a faixa oferece
   o botão "Aplicar".

   Pseudocódigo:
     1. Modal aberto (#modal-backdrop com a classe .show) -> não.
     2. Foco num campo editável (input/textarea/contenteditable) -> não.
     3. Caso contrário -> pode. */
podeRepintarAgora(){
  const backdrop = document.getElementById('modal-backdrop');
  if(backdrop && backdrop.classList.contains('show')) return false;
  const ativo = document.activeElement;
  if(ativo && (ativo.tagName === 'INPUT' || ativo.tagName === 'TEXTAREA' || ativo.isContentEditable)) return false;
  return true;
},

/* Contexto:
   Monta a frase que a faixa mostra ("2 comentários novos e 1 anotação
   alterada por outra pessoa"). Chamada por buscarNovidadesCompartilhadas().
   Retorna string (vazia se nada mudou).

   Pseudocódigo:
     1. Conta comentários cujo id ainda não está na tela.
     2. Conta chaves de anotação novas ou com updatedAt diferente.
     3. Monta a frase só com as partes que têm contagem > 0. */
resumirNovidades(comentariosNovos, anotacoesNovas){
  const idsConhecidos = new Set((ControleCargas.COMMENTS || []).map(c=> c.id));
  const qtdComentarios = (comentariosNovos || []).filter(c=> !idsConhecidos.has(c.id)).length;

  const atuais = ControleCargas.ANNOTATIONS || {};
  const qtdAnotacoes = Object.keys(anotacoesNovas || {}).filter(chave=>{
    const nova = anotacoesNovas[chave] || {};
    const atual = atuais[chave];
    return !atual || (nova.updatedAt || '') !== (atual.updatedAt || '');
  }).length;

  const partes = [];
  if(qtdComentarios) partes.push(`${qtdComentarios} comentário(s) novo(s)`);
  if(qtdAnotacoes) partes.push(`${qtdAnotacoes} anotação(ões) alterada(s)`);
  return partes.length ? `${partes.join(' e ')} por outra pessoa.` : '';
},

/* Contexto:
   Lista as edições SUAS ainda não salvas que a novidade do colega vai
   sobrescrever quando você clicar em Salvar — chamada por
   buscarNovidadesCompartilhadas() para acrescentar o aviso à faixa. Retorna
   array de chaves (vazio no caso normal).

   Pseudocódigo:
     1. Sem edições pendentes -> array vazio.
     2. Devolve as chaves que estão ao mesmo tempo em PENDING_ANNOTATIONS e
        entre as anotações que mudaram do lado do servidor. */
colisoesComEdicaoPendente(anotacoesNovas){
  const pendentes = ControleCargas.PENDING_ANNOTATIONS || {};
  const atuais = ControleCargas.ANNOTATIONS || {};
  return Object.keys(pendentes).filter(chave=>{
    const nova = (anotacoesNovas || {})[chave];
    if(!nova) return false;
    const atual = atuais[chave];
    return !atual || (nova.updatedAt || '') !== (atual.updatedAt || '');
  });
},

/* Contexto:
   Coração do arquivo: consulta /api/comments e /api/annotations, compara com
   o que já está na tela e, havendo diferença, aplica (ou guarda para o botão
   "Aplicar", se não for seguro repintar agora). Chamada pelo timer e quando
   a aba volta a ficar visível. Retorna Promise (sempre resolvida — falha de
   rede é ignorada de propósito).

   Não mexe em PENDING_ANNOTATIONS: a edição que você ainda não salvou
   continua tendo prioridade na leitura (ver annotationAtual em anotacoes.js),
   então aplicar a novidade do colega nunca apaga o que você digitou.

   Pseudocódigo:
     1. Busca os dois arquivos em paralelo; qualquer falha encerra em
        silêncio (a próxima rodada tenta de novo).
     2. Se as duas assinaturas forem iguais às do que está na tela, não faz
        nada.
     3. Monta o resumo e o aviso de colisão com edição pendente.
     4. Dá pra repintar -> aplica na hora e mostra a faixa informativa.
        Não dá -> guarda em novidadesPendentes e mostra a faixa com o botão
        "Aplicar". */
buscarNovidadesCompartilhadas(){
  return Promise.all([
    fetch('/api/comments').then(r=> r.ok ? r.json() : Promise.reject(new Error('http '+r.status))),
    fetch('/api/annotations').then(r=> r.ok ? r.json() : Promise.reject(new Error('http '+r.status))),
  ])
    .then(([dadosComentarios, dadosAnotacoes])=>{
      const comentarios = dadosComentarios.comments || [];
      const anotacoes = dadosAnotacoes.annotations || {};

      const mudouComentarios = ControleCargas.assinaturaComentarios(comentarios)
        !== ControleCargas.assinaturaComentarios(ControleCargas.COMMENTS);
      const mudouAnotacoes = ControleCargas.assinaturaAnotacoes(anotacoes)
        !== ControleCargas.assinaturaAnotacoes(ControleCargas.ANNOTATIONS);
      if(!mudouComentarios && !mudouAnotacoes) return;

      let resumo = ControleCargas.resumirNovidades(comentarios, anotacoes);
      if(!resumo) resumo = 'Alterações de outra pessoa chegaram.';

      const colisoes = ControleCargas.colisoesComEdicaoPendente(anotacoes);
      if(colisoes.length){
        resumo += ` Atenção: ${colisoes.length} linha(s) que você editou e ainda não salvou `
          + 'também foram alteradas por outra pessoa — ao salvar, a sua versão prevalece.';
      }

      ControleCargas.novidadesPendentes = {comentarios, anotacoes};
      const repintaAgora = ControleCargas.podeRepintarAgora();
      if(repintaAgora) ControleCargas.aplicarNovidadesPendentes();
      ControleCargas.mostrarAlertaSincronizacao(resumo, !repintaAgora);
    })
    .catch(()=>{});   // sem servidor/rede -> próxima rodada tenta de novo
},

/* Contexto:
   Substitui COMMENTS/ANNOTATIONS pelo que foi baixado e repinta a matriz —
   chamada por buscarNovidadesCompartilhadas() (quando é seguro) e pelo botão
   "Aplicar" da faixa. Não retorna nada.

   Preserva a rolagem porque buildMatrix() recria a tabela inteira e, sem
   isso, a página saltaria para o topo no meio da leitura de quem estava no
   fim de uma lista de 1300 carteiras.

   Pseudocódigo:
     1. Sem novidade guardada -> não faz nada.
     2. Troca COMMENTS/ANNOTATIONS (PENDING_ANNOTATIONS fica intacto).
     3. SNAPSHOT ainda não carregado (boot lento ou falho) -> para por aqui,
        sem repintar; quem for desenhar a matriz depois já vai achar os
        dados novos no lugar.
     4. Guarda a rolagem, repinta na mesma sequência do "Atualizar"
        (atualizar.js) e devolve a rolagem.
     5. Limpa a novidade guardada. */
aplicarNovidadesPendentes(){
  const novidades = ControleCargas.novidadesPendentes;
  if(!novidades) return;

  ControleCargas.COMMENTS = novidades.comentarios;
  ControleCargas.ANNOTATIONS = novidades.anotacoes;
  ControleCargas.novidadesPendentes = null;
  if(!ControleCargas.SNAPSHOT) return;   // boot ainda não terminou — nada pra repintar

  const rolagem = window.scrollY;
  ControleCargas.buildHeader();
  ControleCargas.buildLegend();
  ControleCargas.buildFilters();
  if(ControleCargas.state.view === 'company') ControleCargas.buildCompanyMatrix();
  else ControleCargas.buildMatrix();
  window.scrollTo(0, rolagem);
},

/* Contexto:
   Mostra a faixa informativa (#alerta-sincronizacao) com o resumo do que
   chegou. `comBotaoAplicar` liga o botão que repinta na hora, usado quando
   não era seguro repintar sozinho. Não retorna nada.

   Pseudocódigo:
     1. Escreve o texto.
     2. Mostra/esconde o botão "Aplicar" conforme o caso.
     3. Exibe a faixa. */
mostrarAlertaSincronizacao(texto, comBotaoAplicar){
  const banner = document.getElementById('alerta-sincronizacao');
  const alvo = document.getElementById('alerta-sincronizacao-texto');
  const botao = document.getElementById('alerta-sincronizacao-aplicar');
  if(!banner || !alvo || !botao) return;
  alvo.textContent = texto;
  botao.style.display = comBotaoAplicar ? '' : 'none';
  banner.style.display = '';
},

/* Contexto: esconde a faixa — chamada pelo "×" e depois de aplicar as
   novidades pelo botão. Não retorna nada. */
esconderAlertaSincronizacao(){
  const banner = document.getElementById('alerta-sincronizacao');
  if(banner) banner.style.display = 'none';
},

/* Contexto:
   Liga o relógio da sincronização e os botões da faixa — chamada 1x no
   bootstrap (fim deste arquivo). Não retorna nada.

   Além do intervalo fixo, consulta também quando a aba volta a ficar
   visível: é o momento em que a pessoa mais provavelmente vai olhar o dado,
   e é de graça (quem estava com a aba escondida não gerou requisição
   nenhuma nesse tempo).

   Pseudocódigo:
     1. Liga o botão "Aplicar" e o "×" da faixa.
     2. Agenda a consulta periódica.
     3. Consulta também a cada visibilitychange que deixe a aba visível. */
ligarSincronizacaoPeriodica(){
  const botaoAplicar = document.getElementById('alerta-sincronizacao-aplicar');
  if(botaoAplicar) botaoAplicar.addEventListener('click', ()=>{
    ControleCargas.aplicarNovidadesPendentes();
    ControleCargas.esconderAlertaSincronizacao();
  });
  const botaoFechar = document.getElementById('alerta-sincronizacao-fechar');
  if(botaoFechar) botaoFechar.addEventListener('click', ControleCargas.esconderAlertaSincronizacao);

  if(ControleCargas._timerSincronizacao) clearInterval(ControleCargas._timerSincronizacao);
  ControleCargas._timerSincronizacao = setInterval(
    ControleCargas.buscarNovidadesCompartilhadas, ControleCargas.INTERVALO_SINCRONIZACAO_MS);

  document.addEventListener('visibilitychange', ()=>{
    if(!document.hidden) ControleCargas.buscarNovidadesCompartilhadas();
  });
},
});

// ─────────────────────────────────────────────────────────────────────────
// Bootstrap: liga o relógio. A 1ª consulta sai só depois do intervalo — o
// bootstrap da página (index.js) já carrega comentários e anotações frescos.
// ─────────────────────────────────────────────────────────────────────────
ControleCargas.ligarSincronizacaoPeriodica();
