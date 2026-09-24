/* CarteirasNaoCadastradas.index — bootstrap + troca de aba.
   [2026-09-24] Mesma técnica ADITIVA das abas Demandas/Anomalias: nenhum
   listener existente é alterado — (a) o botão "tab-nao-cadastradas"
   esconde os demais painéis e mostra #panel-nao-cadastradas; (b) cada um
   dos outros botões de aba ganha um listener A MAIS que só esconde este
   painel. A 1ª consulta à API só acontece no 1º clique na aba. */
Object.assign(CarteirasNaoCadastradas, {

  /* Contexto:
     Liga a aba ao mecanismo de abas existente sem tocar switchTab() nem os
     listeners de controle_demandas/anomalias. Chamada 1x no fim deste
     arquivo. Não retorna nada.

     Pseudocódigo:
       1. Clique na aba: esconde painéis das outras abas + toolbar3, marca
          só esta aba como ativa, mostra o painel; 1ª vez -> consulta.
       2. Clique em qualquer outra aba: esconde este painel e desmarca a aba. */
  ligarTrocaDeAba() {
    const painel = document.getElementById('panel-nao-cadastradas');
    const tab = document.getElementById('tab-nao-cadastradas');
    const paineisOutrasAbas = ['panel-main', 'panel-legend', 'panel-company', 'panel-custodian',
      'panel-demandas', 'panel-anomalias', 'toolbar3'];
    const idsOutrasAbas = ['tab-wallets', 'tab-groupings', 'tab-company', 'tab-custodian',
      'tab-demandas', 'tab-anomalias'];

    tab.addEventListener('click', () => {
      paineisOutrasAbas.forEach(id => {
        const elemento = document.getElementById(id);
        if (elemento) elemento.style.display = 'none';
      });
      idsOutrasAbas.forEach(id => {
        const botao = document.getElementById(id);
        if (botao) botao.classList.remove('active');
      });
      tab.classList.add('active');
      painel.style.display = '';
      if (!this.jaConsultou) this.carregar();
    });

    idsOutrasAbas.forEach(id => {
      const botao = document.getElementById(id);
      if (!botao) return;
      botao.addEventListener('click', () => {
        painel.style.display = 'none';
        tab.classList.remove('active');
      });
    });
  },

  /* Contexto: liga filtros e os botões "Atualizar lista"/"Exportar Excel".
     Chamada 1x no fim deste arquivo. Não retorna nada. */
  iniciar() {
    this.ligarFiltros();
    document.getElementById('cnc-btn-atualizar').addEventListener('click', () => this.carregar());
    document.getElementById('cnc-btn-exportar').addEventListener('click', () => this.exportarExcel());
  },
});

CarteirasNaoCadastradas.ligarTrocaDeAba();
CarteirasNaoCadastradas.iniciar();
