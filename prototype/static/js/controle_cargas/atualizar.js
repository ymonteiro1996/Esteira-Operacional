/* ControleCargas.atualizar — botão "Atualizar" + campos de janela (data
   inicial/final) — Tarefas 2 e 3 do refactor 2026-07-20.
   Parte do objeto único ControleCargas (ver state.js). Chama GET
   /api/atualizar?data_inicial=...&data_final=...[&company_id=...] (app.py),
   que só consulta a API Beehus para as datas AINDA não cacheadas nesta
   sessão — e, com company_id, só as carteiras dessa empresa (ver db.py/
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
        recalcula "de" sozinho (data_final − 5 du).
     5. Cada tecla no campo de busca de empresa filtra o seletor
        (filtrarEmpresasDigitadas); Enter ali é neutralizado de propósito. */
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
  // [2026-09-22, pedido do usuário: "permitir digitar a company e
  // autocompletar"] Filtra o seletor a cada tecla. Enter aqui NÃO dispara o
  // Atualizar de propósito: digitar o nome da empresa é escolher escopo, não
  // pedir uma consulta de 9 minutos.
  const campoBuscaEmpresa = document.getElementById('empresa-busca');
  if(campoBuscaEmpresa){
    campoBuscaEmpresa.addEventListener('input', ControleCargas.filtrarEmpresasDigitadas);
    campoBuscaEmpresa.addEventListener('keydown', (e)=>{ if(e.key==='Enter') e.preventDefault(); });
  }
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
        comportamento anterior a esta função existir.
     5. [2026-09-11, relato do usuário: "às vezes fica em data antiga"]
        Guarda a promessa em state.sincronizacaoDataInicial e a devolve —
        executarAtualizacao() espera por ela antes de ler os campos, pra um
        Atualizar disparado logo depois de trocar o "até" (clique rápido ou
        Enter, que chega ANTES desta resposta) não enviar o "de" velho e
        tomar 400 "janela maior que o teto". Retorna Promise. */
sincronizarDataInicial(){
  const de = document.getElementById('data-inicial');
  const ate = document.getElementById('data-final');
  if(!de || !ate || !ate.value) return Promise.resolve();

  const sincronizacao = fetch(`/api/data-inicial-padrao?data_final=${encodeURIComponent(ate.value)}`)
    .then(r=> r.json().then(data=> ({ok:r.ok, data})))
    .then(({ok,data})=>{
      if(!ok) throw new Error(data.error || 'falha ao calcular data inicial');
      de.value = data.dataInicial;
    })
    .catch(()=>{});
  ControleCargas.state.sincronizacaoDataInicial = sincronizacao;
  return sincronizacao;
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

// Empresas devolvidas por GET /api/empresas, como vieram — o <select> é
// redesenhado a partir daqui a cada tecla no campo de busca, então a lista
// completa precisa sobreviver ao filtro.
empresasDisponiveis: [],

/* Contexto:
   Normaliza um texto para comparação de busca — minúsculas e sem acento, pra
   "ete"/"Eté"/"ETÉ" acharem "Eté Gestão". Usada pelo filtro do seletor de
   empresa [2026-09-22, pedido do usuário: "permitir digitar a company e
   autocompletar"]. Retorna string. (Mora aqui, e não em static/js/utils/,
   porque hoje só esta tela usa — promover se aparecer um 2º uso, CLAUDE.md
   §5.)

   Pseudocódigo:
     1. Vazio/nulo -> string vazia.
     2. Decompõe os acentos (NFD), remove os sinais diacríticos e baixa a
        caixa. */
normalizarParaBusca(texto){
  return String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
},

/* Contexto:
   Empresas que casam com o que está digitado no campo de busca
   (#empresa-busca) — casa por NOME ou por companyId, sem acento e sem caixa.
   Chamada por desenharOpcoesEmpresas(). Retorna array (a lista inteira
   quando o campo está vazio).

   Pseudocódigo:
     1. Lê e normaliza o texto digitado; vazio -> devolve tudo.
     2. Mantém as empresas cujo nome normalizado contém o texto, ou cujo id
        começa com ele (digitar CNPJ). */
empresasQueCasamComBusca(){
  const campo = document.getElementById('empresa-busca');
  const procurado = ControleCargas.normalizarParaBusca(campo && campo.value);
  if(!procurado) return ControleCargas.empresasDisponiveis;

  return ControleCargas.empresasDisponiveis.filter(({id, name})=>
    ControleCargas.normalizarParaBusca(name).includes(procurado) || String(id || '').startsWith(procurado));
},

/* Contexto:
   Desenha as opções do seletor "Empresa" (só as que casam com o filtro
   digitado) e as sugestões do <datalist> (sempre a lista inteira — o
   autocompletar nativo tem que sugerir tudo enquanto se digita). Chamada por
   preencherSelectEmpresas() e a cada tecla no campo de busca. Não retorna
   nada.

   Pseudocódigo:
     1. Sem o seletor no DOM, sai sem erro.
     2. "Todas as empresas" (value vazio = sem filtro, o que /api/atualizar
        espera) + uma opção por empresa que casou.
     3. A empresa ESCOLHIDA entra na lista mesmo que não case com o filtro —
        senão ela sumiria do DOM, o select voltaria pra "Todas as empresas"
        sozinho e o próximo Atualizar consultaria TODAS as empresas sem
        ninguém pedir (9 minutos por engano).
     4. Repõe a escolha; se a empresa escolhida não existe mais na lista
        vinda do servidor, volta pra "Todas as empresas".
     5. Reescreve o <datalist> com todos os nomes. */
desenharOpcoesEmpresas(escolhaDesejada){
  const select = document.getElementById('empresa-atualizar');
  if(!select) return;
  const escolhida = escolhaDesejada || '';

  const casaram = ControleCargas.empresasQueCasamComBusca();
  const paraMostrar = casaram.slice();
  if(escolhida && !paraMostrar.some(e=> e.id === escolhida)){
    const fixa = ControleCargas.empresasDisponiveis.find(e=> e.id === escolhida);
    if(fixa) paraMostrar.unshift(fixa);
  }

  select.innerHTML = '';
  const todas = document.createElement('option');
  todas.value = '';
  todas.textContent = 'Todas as empresas';
  select.appendChild(todas);
  paraMostrar.forEach(({id, name})=>{
    const opcao = document.createElement('option');
    opcao.value = id;
    opcao.textContent = name || id;
    select.appendChild(opcao);
  });

  select.value = escolhida;
  if(!select.value) select.value = '';

  const sugestoes = document.getElementById('lista-empresas');
  if(sugestoes){
    sugestoes.innerHTML = '';
    ControleCargas.empresasDisponiveis.forEach(({name, id})=>{
      const sugestao = document.createElement('option');
      sugestao.value = name || id;
      sugestoes.appendChild(sugestao);
    });
  }
},

/* Contexto:
   Reage a cada tecla no campo de busca (#empresa-busca): redesenha o seletor
   só com quem casa e, quando sobra UMA empresa, já a deixa escolhida — é o
   que faz "digitar e escolher" virar um gesto só [2026-09-22, pedido do
   usuário]. Ligada por wireAtualizar(). Não retorna nada.

   Pseudocódigo:
     1. Sem o seletor no DOM, sai sem erro.
     2. Redesenha as opções mantendo a escolha atual.
     3. Sobrou exatamente 1 empresa -> escolhe ela.
     4. Campo de busca vazio -> não mexe na escolha (limpar o filtro não pode
        desfazer a empresa que a pessoa já tinha escolhido). */
filtrarEmpresasDigitadas(){
  const select = document.getElementById('empresa-atualizar');
  const campo = document.getElementById('empresa-busca');
  if(!select) return;

  ControleCargas.desenharOpcoesEmpresas(select.value);
  if(campo && campo.value.trim()){
    const casaram = ControleCargas.empresasQueCasamComBusca();
    if(casaram.length === 1) select.value = casaram[0].id;
  }
},

/* Contexto:
   Diz na PRÓPRIA caixinha por que a lista de empresas não veio — chamada por
   preencherSelectEmpresas() quando GET /api/empresas falha (401 sem token,
   rede) ou devolve lista vazia. [2026-09-22, relato do usuário: "não aparece
   mais a company para selecionar"] Antes o erro era engolido e o seletor
   ficava só com "Todas as empresas", indistinguível de "esta conta não tem
   empresa nenhuma" — a pessoa não tinha como saber que faltava colar o
   token. Não retorna nada.

   Pseudocódigo:
     1. Sem o seletor no DOM, sai sem erro.
     2. Mantém "Todas as empresas" (o Atualizar continua funcionando sem
        filtro) e acrescenta 1 opção desabilitada com o motivo.
     3. Deixa "Todas as empresas" selecionada. */
marcarSelectEmpresasIndisponivel(motivo){
  const select = document.getElementById('empresa-atualizar');
  if(!select) return;
  ControleCargas.empresasDisponiveis = [];

  select.innerHTML = '';
  const todas = document.createElement('option');
  todas.value = '';
  todas.textContent = 'Todas as empresas';
  select.appendChild(todas);

  const aviso = document.createElement('option');
  aviso.value = '';
  aviso.disabled = true;
  aviso.textContent = `— ${motivo} —`;
  select.appendChild(aviso);
  select.value = '';
},

/* Contexto:
   Preenche o seletor "Empresa" da toolbar (#empresa-atualizar) com as
   empresas visíveis ao token (GET /api/empresas) [2026-09-22, pedido do
   usuário: "permitir selecionar data e company e depois dar um atualizar
   clickando no botao"]. Chamada no bootstrap (init(), index.js), depois que
   o usuário cola o token (salvarTokenBeehus, beehus_token.js) e depois de
   cada Atualizar bem-sucedido — no 1º acesso a rota responde 401 (token
   ainda não colado), então precisa dessas outras chances. Sempre devolve uma
   Promise resolvida (o seletor é acessório; a tela continua utilizável com
   "Todas as empresas"). Não altera a escolha do usuário.

   Pseudocódigo:
     1. Sem o seletor no DOM (versão antiga do HTML em cache), sai sem erro.
     2. Guarda a escolha atual, pra restaurar depois de redesenhar.
     3. Busca GET /api/empresas.
     4. Deu certo e veio empresa -> desenha as opções.
     5. Deu certo e veio lista vazia, ou falhou -> escreve o motivo DENTRO do
        seletor (marcarSelectEmpresasIndisponivel), nunca deixa a caixinha
        vazia em silêncio. */
preencherSelectEmpresas(){
  const select = document.getElementById('empresa-atualizar');
  if(!select) return Promise.resolve();
  const escolhaAnterior = select.value;

  return fetch('/api/empresas')
    .then(r=> r.json().then(dados=> ({ok:r.ok, status:r.status, dados})))
    .then(({ok, status, dados})=>{
      if(!ok){
        throw new Error(status===401
          ? 'cole o token da API Beehus para listar as empresas'
          : (dados.error || `falha ao listar empresas (HTTP ${status})`));
      }
      const empresas = dados.empresas || [];
      if(!empresas.length){
        ControleCargas.marcarSelectEmpresasIndisponivel('nenhuma empresa visível para este token');
        return;
      }
      ControleCargas.empresasDisponiveis = empresas;
      ControleCargas.desenharOpcoesEmpresas(escolhaAnterior);
    })
    .catch(erro=>{
      ControleCargas.marcarSelectEmpresasIndisponivel(erro.message || 'não foi possível listar as empresas');
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
        usuário: "campos para mudar o valor"] — e company_id quando o
        seletor "Empresa" (#empresa-atualizar) tiver uma empresa escolhida
        [2026-09-22, pedido do usuário: "permitir selecionar data e company
        e depois dar um atualizar clickando no botao"]; "Todas as empresas"
        (valor vazio) também não entra na URL.
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
     8. Sempre reabilita o botão ao final (sucesso ou erro) — menos quando
        uma atualização MAIS NOVA já assumiu (ver sequenciaAtualizacao no
        passo 0), pra não reabilitar o botão no meio dela. */
executarAtualizacao(){
  return Promise.resolve(ControleCargas.state.sincronizacaoDataInicial)
    .then(ControleCargas.enviarAtualizacao);
},

/* Contexto:
   Corpo do "Atualizar" propriamente dito — separado de
   executarAtualizacao() [2026-09-11] só pra aquela função ter um único
   contexto (esperar o campo "de" ficar consistente) e esta outro (montar e
   enviar o pedido). Não chame direto: o ponto de entrada é sempre
   executarAtualizacao(). Não retorna nada de útil (Promise da requisição).

   Pseudocódigo: ver executarAtualizacao() — os passos 1 a 8 são todos
   daqui. */
enviarAtualizacao(){
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

  // [2026-09-11, relato do usuário: "às vezes fica em data antiga"] Numera
  // este pedido: se outro Atualizar for disparado enquanto este ainda está
  // no ar (refresh automático do init() + clique/Enter do usuário + o
  // disparo de salvarTokenBeehus), só a resposta do pedido MAIS NOVO pode
  // mexer na tela — antes disso, a resposta lenta da janela ANTIGA chegava
  // por último e sobrescrevia ControleCargas.SNAPSHOT, devolvendo a matriz
  // pra data velha.
  const sequencia = ++ControleCargas.state.sequenciaAtualizacao;
  const estaObsoleto = ()=> sequencia !== ControleCargas.state.sequenciaAtualizacao;

  // Texto fixo (e não o textContent corrente): com 2 atualizações no ar, o
  // 2º disparo capturava "Atualizando..." como "original" e o botão ficava
  // com esse rótulo pra sempre.
  btn.disabled = true;
  btn.textContent = 'Atualizando...';
  if(msgEl) msgEl.textContent = '';
  // [2026-09-15] Sinal de vida enquanto o pedido roda (~9min hoje) — ver
  // progresso.js. Só escreve em .atualizar-msg; não interfere no fetch.
  ControleCargas.acompanharProgresso(estaObsoleto);

  const campoPct = document.getElementById('limiar-divergencia-pct');
  const campoReais = document.getElementById('limiar-divergencia-reais');
  const selectEmpresa = document.getElementById('empresa-atualizar');
  let url = `/api/atualizar?data_inicial=${encodeURIComponent(dataInicial)}&data_final=${encodeURIComponent(dataFinal)}`;
  if(campoPct && campoPct.value) url += `&limiar_divergencia_pct=${encodeURIComponent(campoPct.value)}`;
  if(campoReais && campoReais.value) url += `&limiar_divergencia_reais=${encodeURIComponent(campoReais.value)}`;
  // [2026-09-22, pedido do usuário] Empresa escolhida no seletor — vazio
  // ("Todas as empresas") não entra na URL, e o backend consulta tudo, igual
  // a antes deste campo existir.
  if(selectEmpresa && selectEmpresa.value) url += `&company_id=${encodeURIComponent(selectEmpresa.value)}`;
  fetch(url)
    .then(r=> r.json().then(data=> ({ok:r.ok, data})))
    .then(({ok,data})=>{
      if(estaObsoleto()) return;   // resposta de um pedido já substituído por outro mais novo
      if(!ok) throw new Error(data.error || 'falha ao atualizar');
      ControleCargas.esconderAlertaAtualizacao();
      ControleCargas.SNAPSHOT = data;
      ControleCargas.preencherCamposLimiarDivergencia();
      // [2026-09-22, relato do usuário: "não aparece mais a company para
      // selecionar"] Um Atualizar que deu certo prova que há token válido —
      // é a hora de preencher o seletor se ele tiver nascido vazio (401 no
      // carregamento da página, antes de o token ser colado).
      ControleCargas.preencherSelectEmpresas();
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
          const empresaFiltro = data.meta && data.meta.companyFiltro;
          const semCarteira = !data.wallets || !data.wallets.length;
          // [2026-09-22, pedido do usuário] Com empresa escolhida, o snapshot
          // pode voltar legitimamente vazio (empresa sem carteira no
          // TemplateCarteiras.xlsx) — sem este aviso a grade em branco
          // pareceria falha do Atualizar.
          if(empresaFiltro && semCarteira){
            msgEl.textContent = `Nenhuma carteira do cadastro em "${empresaFiltro}" — escolha outra empresa ou "Todas as empresas".`;
          } else {
            msgEl.textContent = (cacheInfo
              ? `Atualizado — ${cacheInfo.datasNovasConsultadas} data(s) nova(s) consultada(s) na API, ${cacheInfo.datasDoCache} do cache local.`
              : 'Atualizado.') + (empresaFiltro ? ` Empresa: ${empresaFiltro}.` : '');
          }
        }
      });
    })
    .catch(err=>{
      if(estaObsoleto()) return;
      if(msgEl) msgEl.textContent = 'Erro ao atualizar: ' + err.message;
      ControleCargas.mostrarAlertaAtualizacao('Falha ao atualizar: ' + err.message);
    })
    .finally(()=>{
      if(estaObsoleto()) return;   // quem reabilita o botão é o pedido mais novo, ainda no ar
      ControleCargas.pararAcompanhamentoProgresso();
      btn.disabled = false;
      btn.textContent = '↻ Atualizar';
    });
},

});
