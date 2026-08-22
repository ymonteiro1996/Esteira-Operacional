/* ControleCargas.atualizar — botão "Atualizar" + campos de janela (data
   inicial/final) — Tarefas 2 e 3 do refactor 2026-07-20.
   Parte do objeto único ControleCargas (ver state.js). Chama GET
   /api/atualizar?data_inicial=...&data_final=... (app.py), que só consulta
   a API Beehus para as datas AINDA não cacheadas nesta sessão (ver db.py/
   cache no backend — "Otimização de Acesso ao Banco" do PLANNING.md) e devolve um
   snapshot completo recalculado para a janela pedida. O front-end troca
   ControleCargas.SNAPSHOT inteiro e reaproveita os mesmos builders do
   1º render (buildHeader/buildLegend/buildFilters/buildMatrix).
*/
Object.assign(ControleCargas, {

/* Contexto:
   Liga o botão "Atualizar" e os campos de data "de"/"até" da toolbar.
   Chamada 1x no bootstrap (index.js), não depende do snapshot já ter
   chegado (os campos só ficam com valor default depois de
   preencherCamposDataAtualizar, chamado no init()).

   Pseudocódigo:
     1. Acha o botão; se a tela ainda não tem a marcação (versão antiga do
        HTML em cache do navegador), sai sem erro.
     2. No clique, dispara executarAtualizacao().
     3. Enter no campo "até" ou nos campos de limiar também dispara
        ("de" não recebe mais Enter — ficou readonly, ver
        sincronizarDataInicial()).
     4. Troca do campo "até" dispara sincronizarDataInicial(), que
        recalcula "de" sozinho (data_final − 5 du). */
wireAtualizar(){
  const btn = document.getElementById('btn-atualizar');
  if(!btn) return;
  btn.addEventListener('click', ()=> ControleCargas.executarAtualizacao());
  ['data-final','limiar-divergencia-pct','limiar-divergencia-reais'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.addEventListener('keydown', (e)=>{ if(e.key==='Enter') ControleCargas.executarAtualizacao(); });
  });
  const campoAte = document.getElementById('data-final');
  if(campoAte) campoAte.addEventListener('change', ()=> ControleCargas.sincronizarDataInicial());
  const fecharBtn = document.getElementById('alerta-atualizacao-fechar');
  if(fecharBtn) fecharBtn.addEventListener('click', ControleCargas.esconderAlertaAtualizacao);
},

/* Contexto:
   Recalcula o campo "de" (data-inicial) a partir do campo "até"
   (data-final), mantendo a janela pedida sempre dentro do teto de
   /api/atualizar (JANELA_MAXIMA_DIAS_UTEIS, hoje 5 du) [2026-08-06, pedido
   do usuário: "coloque a data inicial como fixa, onde ao mudar a data
   final ela mude também" — depois de um clique em Atualizar falhar com 400
   por passar do teto]. O campo "de" ficou readonly no HTML (index.html);
   este é o ÚNICO jeito dele mudar de valor agora. Chamada no evento
   'change' de "até" (wireAtualizar) — o preenchimento inicial dos dois
   campos (preencherCamposDataAtualizar, via /api/janela-padrao) já nasce
   consistente com essa mesma regra (mesma constante 5 du em
   utils/datas.py), então não precisa chamar esta função de novo no boot.
   Não retorna nada.

   Pseudocódigo:
     1. Sem os dois campos no DOM, ou "até" ainda vazio, sai sem erro.
     2. Busca GET /api/data-inicial-padrao?data_final=... (só aritmética de
        calendário no backend, não toca a API Beehus).
     3. Em sucesso, grava o valor devolvido em "de".
     4. Em falha de rede, não altera "de" — o pior caso é o usuário ver o
        400 de /api/atualizar de novo ao clicar Atualizar, igual ao
        comportamento anterior a esta função existir. */
sincronizarDataInicial(){
  const de = document.getElementById('data-inicial');
  const ate = document.getElementById('data-final');
  if(!de || !ate || !ate.value) return;

  fetch(`/api/data-inicial-padrao?data_final=${encodeURIComponent(ate.value)}`)
    .then(r=> r.json().then(data=> ({ok:r.ok, data})))
    .then(({ok,data})=>{
      if(!ok) throw new Error(data.error || 'falha ao calcular data inicial');
      de.value = data.dataInicial;
    })
    .catch(()=>{});
},

/* Contexto:
   Mostra a faixa vermelha de alerta (#alerta-atualizacao) com 1 mensagem —
   chamada quando executarAtualizacao() falha, seja pelo clique manual, seja
   pelo refresh automático do carregamento da página (init(), index.js).
   [2026-07-30, pedido do usuário: "pode gerar um alerta na próxima?" — o
   único aviso de erro antes era o texto pequeno cinza .atualizar-msg,
   fácil de não notar, principalmente numa falha do refresh AUTOMÁTICO, sem
   ninguém olhando a tela nesse momento]. Não retorna nada.

   Pseudocódigo:
     1. Sem o elemento no DOM (versão antiga do HTML em cache), sai sem erro.
     2. Grava a mensagem e mostra a faixa — fica visível até o usuário
        fechar ou até esconderAlertaAtualizacao() ser chamada de novo (não
        some sozinha por tempo). */
mostrarAlertaAtualizacao(mensagem){
  const banner = document.getElementById('alerta-atualizacao');
  const texto = document.getElementById('alerta-atualizacao-texto');
  if(!banner || !texto) return;
  texto.textContent = mensagem;
  banner.style.display = '';
},

/* Contexto:
   Esconde a faixa de alerta — chamada pelo botão "×" e sempre que
   executarAtualizacao() tem SUCESSO (a falha anterior deixou de valer,
   não faz sentido o alerta continuar na tela). Não retorna nada. */
esconderAlertaAtualizacao(){
  const banner = document.getElementById('alerta-atualizacao');
  if(banner) banner.style.display = 'none';
},

/* Contexto:
   Preenche os campos "de"/"até" no 1º acesso — só quando o usuário ainda não
   digitou nada, pra não sobrescrever uma escolha em andamento. Chamada pelo
   init(). [CORRIGIDO 2026-07-23, pedido do usuário: depois de um "Atualizar"
   o campo "até" aparecia com uma data antiga (16/07)] Antes lia a janela do
   SNAPSHOT já carregado — mas snapshot.json é um arquivo PRÉ-GERADO (rodado à
   parte, ver build_snapshot.py), então sua meta.referenceDate fica CONGELADA
   em quando foi gerado, não em "hoje" de verdade; o botão Atualizar só
   reenvia o que já está nos campos, então um default nascido errado nunca se
   autocorrige. Agora busca a janela fresca em GET /api/janela-padrao (D-3 do
   hoje REAL do servidor + 5du antes, sem tocar o Mongo).

   Pseudocódigo:
     1. Sem os dois campos no DOM, ou já preenchidos (usuário mexeu antes),
        não faz nada.
     2. Busca GET /api/janela-padrao; em sucesso, preenche De/Até com o que
        veio (checando de novo se cada campo continua vazio, caso a resposta
        demore e o usuário já tenha digitado algo).
     3. Em falha de rede, cai pro fallback antigo — usa a janela do SNAPSHOT
        já carregado (pode estar desatualizada, mas é melhor que deixar os
        campos vazios). [REVISADO 2026-07-27, pedido do usuário: "veja uma
        solução robusta e definitiva" pro snapshot.json estático (congelado
        no último boot do servidor) esconder dado novo chegando na API
        durante o dia] Agora SEMPRE devolve uma Promise (mesmo quando os
        campos já estavam preenchidos) — permite ao chamador (init(),
        index.js) encadear um refresh automático assim que os campos
        estiverem prontos, sem precisar o usuário clicar "Atualizar". */
preencherCamposDataAtualizar(){
  const de = document.getElementById('data-inicial');
  const ate = document.getElementById('data-final');
  if(!de || !ate) return Promise.resolve();
  if(de.value && ate.value) return Promise.resolve();

  return fetch('/api/janela-padrao')
    .then(r=>{ if(!r.ok) throw new Error('http '+r.status); return r.json(); })
    .then(({dataInicial, dataFinal})=>{
      if(!de.value) de.value = dataInicial;
      if(!ate.value) ate.value = dataFinal;
    })
    .catch(()=>{
      const janela = ControleCargas.SNAPSHOT.meta.window;
      if(!de.value) de.value = janela[0];
      if(!ate.value) ate.value = ControleCargas.SNAPSHOT.meta.referenceDate;
    });
},

/* Contexto:
   Preenche os 2 campos editáveis do filtro de divergência Rent Contrib ×
   Rent NAV (limiar-divergencia-pct/-reais, badge "Rent" da matriz) com o
   valor que REALMENTE gerou o SNAPSHOT atual (SNAPSHOT.meta.
   limiarDivergenciaPct/Reais — nunca um padrão fixo no front-end, pra nunca
   divergir do que build_snapshot.py/snapshot_builder.py usam de verdade)
   [2026-07-31, pedido do usuário: "campos para mudar o valor"]. Chamada 1x
   no bootstrap (init(), index.js, já com SNAPSHOT carregado) e de novo
   depois de cada executarAtualizacao() com sucesso — assim os campos
   sempre refletem o snapshot em tela, mesmo se o usuário tiver deixado em
   branco (o backend aplicou o padrão, e os campos mostram esse padrão).
   Não retorna nada.

   Pseudocódigo:
     1. Sem os campos no DOM (versão antiga do HTML em cache), sai sem erro.
     2. Converte a fração decimal do meta (ex.: 0.0002) pra pontos
        percentuais (ex.: "0.02") — unidade que o campo mostra.
     3. SEMPRE sobrescreve (ao contrário de preencherCamposDataAtualizar) —
        aqui o valor precisa continuar em sincronia com o snapshot corrente,
        não é uma escolha do usuário que deva persistir entre atualizações. */
preencherCamposLimiarDivergencia(){
  const campoPct = document.getElementById('limiar-divergencia-pct');
  const campoReais = document.getElementById('limiar-divergencia-reais');
  if(!campoPct || !campoReais) return;
  const meta = ControleCargas.SNAPSHOT && ControleCargas.SNAPSHOT.meta;
  if(!meta) return;
  if(typeof meta.limiarDivergenciaPct === 'number') campoPct.value = (meta.limiarDivergenciaPct * 100).toFixed(2);
  if(typeof meta.limiarDivergenciaReais === 'number') campoReais.value = meta.limiarDivergenciaReais;
},

/* Contexto:
   Formata a data/hora ATUAL (do navegador do usuário) como "dd/mm/aaaa
   HH:MM:SS" — usada só para exibir quando o botão "Atualizar" foi clicado
   pela última vez (pedido do usuário 2026-07-24: "mostrar a data e hora que
   clicamos em atualizar"). Retorna string.

   Pseudocódigo:
     1. Lê os componentes de data/hora locais de um `new Date()`.
     2. Preenche cada componente com zero à esquerda e monta a string no
        formato brasileiro. */
formatarDataHoraAgora(){
  const agora = new Date();
  const pad = (n)=> String(n).padStart(2, '0');
  return `${pad(agora.getDate())}/${pad(agora.getMonth()+1)}/${agora.getFullYear()} ${pad(agora.getHours())}:${pad(agora.getMinutes())}:${pad(agora.getSeconds())}`;
},

/* Contexto:
   Lê os dois campos de data, chama GET /api/atualizar no backend (única
   rota que pode alargar a janela sem re-rodar o build_snapshot.py inteiro) e
   substitui ControleCargas.SNAPSHOT pelo snapshot devolvido, sem recarregar
   a página. Mostra estado de carregando no botão e mensagens de erro no
   lugar do texto de status.

   Pseudocódigo:
     1. Valida que "de" <= "até" (senão avisa e não chama o servidor).
     2. Desabilita o botão + troca o texto por "Atualizando..." (indicador).
     3. Grava a data/hora ATUAL do clique no rótulo fixo #atualizar-timestamp
        [2026-07-24, pedido do usuário: "mostrar a data e hora que clicamos
        em atualizar"] — grava no momento do clique, não só em caso de
        sucesso, e fica visível até o próximo clique.
     4. fetch('/api/atualizar?data_inicial=...&data_final=...'), incluindo
        limiar_divergencia_pct/limiar_divergencia_reais quando os campos
        (limiar-divergencia-pct/-reais) tiverem valor — vazios não entram na
        URL, o backend aplica o padrão de sempre [2026-07-31, pedido do
        usuário: "campos para mudar o valor"].
     5. Em sucesso: troca SNAPSHOT inteiro, resincroniza os 2 campos de
        limiar com o que o backend REALMENTE usou
        (preencherCamposLimiarDivergencia), limpa a ordem congelada (senão
        sortedRows()/getGroupingBlocks() continuariam usando o array antigo
        congelado em vez do SNAPSHOT novo — carteira removida do Template
        continuaria aparecendo) e limpa os filtros de cabeçalho amarrados à
        data de referência (statusRef/responsavel/comentarioAtuacao —
        tagsColunaParaLinha/annotationAtual, filtro_cabecalho.js e
        anotacoes.js, recalculam essas tags EM CIMA de meta.referenceDate,
        que muda pra o novo "até") [CORRIGIDO 2026-08-07, pedido do usuário:
        "mudei a data do até... porem não atualizou na matriz ao clickar em
        atualizar" — o Set de valores escolhidos no filtro ficava preso aos
        rótulos da data de referência ANTIGA; ao trocar "até", linhas que
        mudaram de estado na nova data de referência deixavam de bater com o
        Set antigo e SUMIAM da grade, dando a impressão de que o clique não
        tinha feito nada]. institution/loadModel ficam de fora — são campos
        estáticos da linha, não dependem da data de referência.
     6. [2026-08-06, pedido do usuário: "dei um atualizar... não apareceu o
        balão vermelho" — loadComments()/loadAnnotations() só eram chamadas
        1x no bootstrap (index.js), então um comentário/anotação criado
        depois (por outra aba, ou direto em data/alert_comments.json) nunca
        aparecia mesmo clicando Atualizar, só com F5] Recarrega
        COMMENTS/ANNOTATIONS (GET /api/comments + /api/annotations, em
        paralelo) ANTES de re-renderizar, pra os balões refletirem o estado
        atual do servidor a cada clique — mesma falha de sincronia que
        motivou 6b abaixo pro snapshot.json estático.
     6b. Com COMMENTS/ANNOTATIONS já frescos, re-renderiza header/legend/
        filtros (mesmos builders do 1º load) + a view VISÍVEL corrente —
        buildCompanyMatrix() na aba Company, buildMatrix() nas demais
        (Carteiras/Agrupamentos; #toolbar3 fica escondido na aba Controle de
        Cargas, então essa nunca chega aqui) — sem F5. [REVISADO 2026-07-23,
        pedido do usuário: #toolbar3 passou a ser compartilhado também pela
        aba Company.]
     7. Em erro: mostra a mensagem no texto pequeno (.atualizar-msg) E na
        faixa vermelha #alerta-atualizacao (mostrarAlertaAtualizacao)
        [2026-07-30, pedido do usuário — a falha do refresh AUTOMÁTICO do
        carregamento da página passava batido, o texto pequeno é fácil de
        não notar; a faixa fica na tela até o usuário fechar ou até um
        próximo Atualizar dar certo] — mantém o snapshot antigo na tela
        (nunca deixa a matriz em branco por causa de uma falha aqui).
     8. Sempre reabilita o botão ao final (sucesso ou erro). */
executarAtualizacao(){
  const btn = document.getElementById('btn-atualizar');
  const de = document.getElementById('data-inicial');
  const ate = document.getElementById('data-final');
  const msgEl = document.getElementById('atualizar-msg');
  if(!btn || !de || !ate) return;

  const dataInicial = de.value;
  const dataFinal = ate.value;
  if(!dataInicial || !dataFinal){
    if(msgEl) msgEl.textContent = 'Preencha as duas datas (de / até).';
    return;
  }
  if(dataInicial > dataFinal){
    if(msgEl) msgEl.textContent = '"De" não pode ser depois de "até".';
    return;
  }

  const tsEl = document.getElementById('atualizar-timestamp');
  if(tsEl) tsEl.textContent = 'Último clique em Atualizar: ' + ControleCargas.formatarDataHoraAgora();

  const textoOriginal = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Atualizando...';
  if(msgEl) msgEl.textContent = '';

  const campoPct = document.getElementById('limiar-divergencia-pct');
  const campoReais = document.getElementById('limiar-divergencia-reais');
  let url = `/api/atualizar?data_inicial=${encodeURIComponent(dataInicial)}&data_final=${encodeURIComponent(dataFinal)}`;
  if(campoPct && campoPct.value) url += `&limiar_divergencia_pct=${encodeURIComponent(campoPct.value)}`;
  if(campoReais && campoReais.value) url += `&limiar_divergencia_reais=${encodeURIComponent(campoReais.value)}`;
  fetch(url)
    .then(r=> r.json().then(data=> ({ok:r.ok, data})))
    .then(({ok,data})=>{
      if(!ok) throw new Error(data.error || 'falha ao atualizar');
      ControleCargas.esconderAlertaAtualizacao();
      ControleCargas.SNAPSHOT = data;
      ControleCargas.preencherCamposLimiarDivergencia();
      ControleCargas.state.frozen = null;
      ControleCargas.state.filtroValoresColuna.statusRef = null;
      ControleCargas.state.filtroValoresColuna.responsavel = null;
      ControleCargas.state.filtroValoresColuna.comentarioAtuacao = null;
      const freezeBadge = document.getElementById('freeze-badge');
      if(freezeBadge) freezeBadge.style.display = 'none';
      return Promise.all([ControleCargas.loadComments(), ControleCargas.loadAnnotations()]).then(()=>{
        ControleCargas.buildHeader();
        ControleCargas.buildLegend();
        ControleCargas.buildFilters();
        if(ControleCargas.state.view==='company') ControleCargas.buildCompanyMatrix();
        else ControleCargas.buildMatrix();
        if(msgEl){
          const cacheInfo = data.meta && data.meta.cacheInfo;
          msgEl.textContent = cacheInfo
            ? `Atualizado — ${cacheInfo.datasNovasConsultadas} data(s) nova(s) consultada(s) na API, ${cacheInfo.datasDoCache} do cache local.`
            : 'Atualizado.';
        }
      });
    })
    .catch(err=>{
      if(msgEl) msgEl.textContent = 'Erro ao atualizar: ' + err.message;
      ControleCargas.mostrarAlertaAtualizacao('Falha ao atualizar: ' + err.message);
    })
    .finally(()=>{
      btn.disabled = false;
      btn.textContent = textoOriginal;
    });
},

});
