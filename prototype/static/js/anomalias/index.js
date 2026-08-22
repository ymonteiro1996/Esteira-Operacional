/* Anomalias.index — bootstrap: busca as opções dinâmicas + anomalias, liga toda a interação e dispara o 1º render.
   Objeto independente de ControleCargas/ControleDemandas (não usa
   snapshot.json/token Beehus — dado 100% local). Auto-inicializa assim
   que o script carrega: a aba pode estar escondida (display:none), mas o
   board já vem pronto quando o usuário clicar em "Anomalias".

   [2026-08-21, mesma técnica ADITIVA de static/js/controle_demandas/
   index.js — "não devemos mudar nenhuma função já existente"] A troca de
   aba é feita por listeners NOVOS anexados aos botões já existentes:
   (a) o botão novo "tab-anomalias" ganha um listener que esconde os 4
   painéis antigos + toolbar3 + #panel-demandas e mostra #panel-anomalias;
   (b) os 5 botões de aba JÁ EXISTENTES (as 4 abas originais + a aba
   "Controle de Demandas") ganham um listener A MAIS (além dos que já
   tinham) que só esconde #panel-anomalias — nenhuma linha de
   static/js/controle_cargas/index.js OU static/js/controle_demandas/
   index.js foi tocada para isso.

   [2026-08-22] Melhoria 7 (atalhos de teclado) mora neste arquivo —
   ver ligarAtalhosTeclado() abaixo, chamada 1x em iniciar(). */
Object.assign(Anomalias, {

  /* Contexto:
     Ponto de entrada da tela — busca as opções desta tela E as opções de
     Demandas (necessárias pro mini formulário "criar demanda nova e já
     vincular" ter as mesmas listas de prioridade/tipo, ver vinculos.js)
     ANTES de carregar as anomalias. Chamada 1x, no fim deste arquivo.
     Não retorna nada.

     Pseudocódigo:
       1. GET /api/anomalias/opcoes + GET /api/demandas/opcoes (em
          paralelo — a 2ª é só leitura da rota já homologada de
          Demandas, nunca escreve nada lá).
       2. Guarda as opções e monta os <select>/<datalist>.
       3. Liga filtros, modais e o modal de vínculo.
       4. Carrega e desenha o board pela 1ª vez. */
  async iniciar() {
    const [respostaOpcoes, respostaOpcoesDemandas] = await Promise.all([
      fetch('/api/anomalias/opcoes'),
      fetch('/api/demandas/opcoes'),
    ]);
    this.opcoes = await respostaOpcoes.json();
    this.opcoesDemandas = await respostaOpcoesDemandas.json();
    this.montarOpcoesFiltros();
    this.ligarFiltros();
    this.ligarModais();
    this.ligarVinculos();
    this.ligarAtalhosTeclado();
    await this.carregarAnomalias();
  },

  /* Contexto:
     Atalhos de teclado da aba Anomalias (melhoria 7), inspirados no
     design "keyboard-first" do Linear — "n" abre Nova Anomalia, "/" foca
     a busca, "1"/"2"/"3" filtram por Crítico/Atenção/Observação, "0"
     limpa todos os filtros (Escape fechar modal já existia, ver
     modais.js::ligarModais). 2 guardas obrigatórias, sempre checadas
     ANTES de agir: (a) só reage com a aba Anomalias visível
     (#panel-anomalias não pode estar com display:none — outra aba pode
     estar ativa); (b) nunca intercepta digitação normal em
     input/textarea/select (ex.: usuário digitando "1" dentro da
     descrição da anomalia). Chamada 1x no boot (iniciar()). Não retorna
     nada. */
  ligarAtalhosTeclado() {
    document.addEventListener('keydown', e => {
      const painel = document.getElementById('panel-anomalias');
      if (!painel || painel.style.display === 'none') return;
      const tagFoco = (e.target.tagName || '').toLowerCase();
      if (tagFoco === 'input' || tagFoco === 'textarea' || tagFoco === 'select') return;

      if (e.key === 'n') {
        e.preventDefault();
        this.abrirModalNova('');
      } else if (e.key === '/') {
        e.preventDefault();
        document.getElementById('an-f-search').focus();
      } else if (e.key === '1' || e.key === '2' || e.key === '3') {
        const indice = Number(e.key) - 1;
        document.getElementById('an-f-criticidade').value = this.opcoes.criticidades[indice] || '';
        this.carregarAnomalias();
      } else if (e.key === '0') {
        this.limparFiltros();
      }
    });
  },

  /* Contexto:
     Liga a aba nova ao mecanismo de abas JÁ EXISTENTE (`.tabs`/
     `#panel-*` de index_template.html) SEM editar switchTab()/wireAbas()
     nem os listeners aditivos que a aba "Controle de Demandas" já
     registrou — ver nota de topo. Chamada 1x, no fim deste arquivo. Não
     retorna nada.

     Pseudocódigo:
       1. Clicar em "tab-anomalias": esconde os 4 painéis originais +
          toolbar3 + #panel-demandas, marca só "tab-anomalias" como
          ativa, mostra #panel-anomalias.
       2. Clicar em qualquer uma das OUTRAS 5 abas (4 originais + a de
          Demandas): só esconde #panel-anomalias e desmarca
          "tab-anomalias" — os listeners JÁ EXISTENTES de cada botão
          continuam disparando normalmente por cima disso. */
  ligarTrocaDeAba() {
    const painelAnomalias = document.getElementById('panel-anomalias');
    const tabAnomalias = document.getElementById('tab-anomalias');
    const painensOutrasAbas = ['panel-main', 'panel-legend', 'panel-company', 'panel-custodian'];
    const idsOutrasAbas = ['tab-wallets', 'tab-groupings', 'tab-company', 'tab-custodian', 'tab-demandas'];

    tabAnomalias.addEventListener('click', () => {
      painensOutrasAbas.forEach(id => { document.getElementById(id).style.display = 'none'; });
      const toolbar3 = document.getElementById('toolbar3');
      if (toolbar3) toolbar3.style.display = 'none';
      const painelDemandas = document.getElementById('panel-demandas');
      if (painelDemandas) painelDemandas.style.display = 'none';
      idsOutrasAbas.forEach(id => document.getElementById(id).classList.remove('active'));
      tabAnomalias.classList.add('active');
      painelAnomalias.style.display = '';
    });

    idsOutrasAbas.forEach(id => {
      document.getElementById(id).addEventListener('click', () => {
        painelAnomalias.style.display = 'none';
        tabAnomalias.classList.remove('active');
      });
    });
  },
});

Anomalias.ligarTrocaDeAba();
Anomalias.iniciar().catch(err => {
  const board = document.getElementById('an-board');
  if (board) board.innerHTML = `<p style="padding:16px;color:#9ca3af;font-size:12px;">Não foi possível carregar Anomalias (${Anomalias.esc(err.message)}).</p>`;
});
