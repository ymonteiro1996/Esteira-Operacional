/* ControleDemandas.index — bootstrap: busca as opções dinâmicas + demandas, liga toda a interação e dispara o 1º render.
   Objeto independente de ControleCargas (não usa snapshot.json/token
   Beehus — dado 100% local). Auto-inicializa assim que o script carrega:
   a aba pode estar escondida (display:none), mas o quadro já vem pronto
   quando o usuário clicar em "Controle de Demandas".

   [2026-08-21, correção do usuário: "não devemos mudar nenhuma função já
   existente no ControleCargas"] A troca de aba É FEITA AQUI, por
   listeners NOVOS e ADITIVOS anexados aos botões — nenhuma linha de
   static/js/controle_cargas/index.js (switchTab()/wireAbas()) foi
   tocada. Um elemento DOM aceita quantos addEventListener() quiserem
   sem conflito, então: (a) o botão novo "tab-demandas" ganha um listener
   que esconde os 4 painéis antigos + o toolbar3 e mostra #panel-demandas;
   (b) os 4 botões de aba ANTIGOS ganham um listener A MAIS (além do que
   controle_cargas/index.js já registra) que só esconde #panel-demandas —
   o listener antigo continua rodando exatamente como sempre, sem edição. */
Object.assign(ControleDemandas, {

  /* Contexto:
     Ponto de entrada da tela — busca as opções dinâmicas (clientes/
     responsáveis/enums) ANTES de carregar as demandas, porque o
     agrupamento em colunas depende de `opcoes.responsaveis` já
     carregado. Chamada 1x, no fim deste arquivo. Não retorna nada.

     Pseudocódigo:
       1. GET /api/demandas/opcoes.
       2. Guarda as opções, monta os <select>/<datalist> e as colunas
          iniciais (localStorage ou todos os responsáveis).
       3. Liga filtros e modais.
       4. Carrega e desenha o quadro pela 1ª vez. */
  async iniciar() {
    const resposta = await fetch('/api/demandas/opcoes');
    this.opcoes = await resposta.json();
    this.colunas = this.carregarColunasSalvas();
    this.montarOpcoesFiltros();
    this.ligarFiltros();
    this.ligarModais();
    await this.carregarDemandas();
  },

  /* Contexto:
     Liga a aba nova ao mecanismo de abas JÁ EXISTENTE (`.tabs`/
     `#panel-*` de index_template.html) SEM editar switchTab()/wireAbas()
     — ver nota de topo. Chamada 1x, no fim deste arquivo. Não retorna
     nada.

     Pseudocódigo:
       1. Clicar em "tab-demandas": esconde panel-main/panel-legend/
          panel-company/panel-custodian + toolbar3 (mesmos elementos que
          switchTab() já esconde entre si), marca só "tab-demandas" como
          ativa, mostra #panel-demandas.
       2. Clicar em qualquer uma das 4 abas antigas: só esconde
          #panel-demandas e desmarca "tab-demandas" — o listener ANTIGO
          de cada botão (registrado por wireAbas()) continua disparando
          normalmente por cima disso, cuidando do resto (mostrar o painel
          certo entre os 4 originais). */
  ligarTrocaDeAba() {
    const painelDemandas = document.getElementById('panel-demandas');
    const tabDemandas = document.getElementById('tab-demandas');
    const painensDasAbasAntigas = ['panel-main', 'panel-legend', 'panel-company', 'panel-custodian'];
    const idsDasAbasAntigas = ['tab-wallets', 'tab-groupings', 'tab-company', 'tab-custodian'];

    tabDemandas.addEventListener('click', () => {
      painensDasAbasAntigas.forEach(id => { document.getElementById(id).style.display = 'none'; });
      const toolbar3 = document.getElementById('toolbar3');
      if (toolbar3) toolbar3.style.display = 'none';
      idsDasAbasAntigas.forEach(id => document.getElementById(id).classList.remove('active'));
      tabDemandas.classList.add('active');
      painelDemandas.style.display = '';
    });

    idsDasAbasAntigas.forEach(id => {
      document.getElementById(id).addEventListener('click', () => {
        painelDemandas.style.display = 'none';
        tabDemandas.classList.remove('active');
      });
    });
  },
});

ControleDemandas.ligarTrocaDeAba();
ControleDemandas.iniciar().catch(err => {
  const board = document.getElementById('kd-board');
  if (board) board.innerHTML = `<p style="padding:16px;color:#9ca3af;font-size:12px;">Não foi possível carregar Controle de Demandas (${ControleDemandas.esc(err.message)}).</p>`;
});
