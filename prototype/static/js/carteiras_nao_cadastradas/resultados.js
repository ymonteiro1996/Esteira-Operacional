/* CarteirasNaoCadastradas.resultados — consulta a API do app e desenha
   resumo, cabeçalho (com ▾ de filtro), tabela e o badge de alerta no botão
   da aba. */
Object.assign(CarteirasNaoCadastradas, {

  /* Contexto:
     Consulta GET /api/carteiras-nao-cadastradas e re-renderiza a aba.
     Chamada ao abrir a aba pela 1ª vez e pelo botão "Atualizar lista".
     Não retorna nada (erros viram mensagem na própria aba).

     Pseudocódigo:
       1. Ignora clique repetido enquanto uma consulta está em curso.
       2. Mostra "consultando…" e desabilita os botões.
       3. Resposta ok -> guarda, monta opções de empresa, resumo, tabela e badge.
       4. Erro -> mostra a mensagem do backend (401 token, 409 Excel aberto...). */
  async carregar() {
    if (this.carregando) return;
    this.carregando = true;
    this.jaConsultou = true;
    const botoes = ['cnc-btn-atualizar', 'cnc-btn-exportar'].map(id => document.getElementById(id));
    botoes.forEach(botao => { botao.disabled = true; });
    document.getElementById('cnc-subtitulo').textContent = 'Consultando a API Beehus (carteiras + cargas)…';
    try {
      const resposta = await fetch('/api/carteiras-nao-cadastradas');
      const corpo = await resposta.json();
      if (!resposta.ok) throw new Error(corpo.error || `HTTP ${resposta.status}`);
      this.resposta = corpo;
      this.montarOpcoesEmpresa(corpo.carteiras);
      this.atualizarRotulosCarga(corpo.parametros);
      this.renderizarResumo();
      this.renderizarTabela();
      this.atualizarBadgeAba();
    } catch (erro) {
      document.getElementById('cnc-subtitulo').textContent = `Não foi possível consultar: ${erro.message}`;
    } finally {
      this.carregando = false;
      botoes[0].disabled = false;
      botoes[1].disabled = !this.resposta;
    }
  },

  /* Contexto: troca o rótulo da coluna de carga e das opções do filtro pelo
     nº de dias que o backend realmente usou. Não retorna nada. */
  atualizarRotulosCarga(parametros) {
    const dias = parametros.diasVerificacaoCarga;
    this.colunaPorChave('carga').rotulo = `Carga últimos ${dias} dias?`;
    document.querySelector('#cnc-f-carga option[value="sim"]').textContent = `Com carga nos últimos ${dias} dias`;
    document.querySelector('#cnc-f-carga option[value="nao"]').textContent = `Sem carga nos últimos ${dias} dias`;
  },

  /* Contexto:
     Subtítulo + chips de contagem (total, novas, com/sem carga). Chamada
     depois de cada consulta. Não retorna nada. */
  renderizarResumo() {
    const { contagem, parametros, geradoEm } = this.resposta;
    document.getElementById('cnc-subtitulo').textContent =
      `${contagem.total} carteira(s) no Beehus fora do TemplateCarteiras · consultado em ${geradoEm} · ` +
      `carga verificada de ${this.formatarData(parametros.dataInicialCarga)} a ${this.formatarData(parametros.dataFinalCarga)}`;
    document.getElementById('cnc-metricas').innerHTML = `
      <span class="cnc-chip">Total <b>${contagem.total}</b></span>
      <span class="cnc-chip cnc-chip-nova">Novas (&lt; ${parametros.diasUteisSinalizacaoNova} du) <b>${contagem.novas}</b></span>
      <span class="cnc-chip cnc-chip-sim">Com carga <b>${contagem.comCargaRecente}</b></span>
      <span class="cnc-chip">Sem carga <b>${contagem.semCargaRecente}</b></span>
      <span class="cnc-chip cnc-chip-exibindo" id="cnc-exibindo"></span>`;
  },

  /* Contexto:
     Desenha o <thead> a partir de COLUNAS, cada coluna com o botão ▾ (aceso
     quando a coluna tem filtro). Chamada por renderizarTabela(). Não
     retorna nada. */
  renderizarCabecalho() {
    const celulas = this.COLUNAS.map(coluna => {
      const ativo = this.filtrosColuna[coluna.chave] ? 'active' : '';
      return `<th>${this.esc(coluna.rotulo)} <button type="button" class="th-filter-btn ${ativo}" data-cnc-coluna="${coluna.chave}" title="Filtrar ${this.esc(coluna.rotulo)}">▾</button></th>`;
    }).join('');
    document.getElementById('cnc-thead').innerHTML = `<tr>${celulas}</tr>`;
  },

  /* Contexto:
     Desenha cabeçalho + tabela (já filtrada) — novas no topo com badge
     "Nova", na ordem que o backend devolveu — e o chip "Exibindo X de Y".
     Chamada após consulta e a cada filtro. Não retorna nada. */
  renderizarTabela() {
    if (!this.resposta) return;
    this.renderizarCabecalho();
    const tbody = document.getElementById('cnc-tbody');
    const linhas = this.aplicarFiltros(this.resposta.carteiras);
    const exibindo = document.getElementById('cnc-exibindo');
    if (exibindo) exibindo.innerHTML = `Exibindo <b>${linhas.length}</b> de ${this.resposta.carteiras.length}`;
    if (!linhas.length) {
      const mensagem = this.resposta.carteiras.length
        ? 'Nenhuma carteira com esses filtros.'
        : 'Todas as carteiras do Beehus estão no TemplateCarteiras.';
      tbody.innerHTML = `<tr><td colspan="${this.COLUNAS.length}" class="cnc-vazio">${mensagem}</td></tr>`;
      return;
    }
    tbody.innerHTML = linhas.map(c => this.montarLinhaTabela(c)).join('');
  },

  /* Contexto:
     HTML de 1 <tr>, coluna a coluna de COLUNAS (usa `html` quando a coluna
     tem, senão o `texto` escapado). Nova -> classe de destaque. Retorna string. */
  montarLinhaTabela(c) {
    const celulas = this.COLUNAS.map(coluna => {
      const conteudo = coluna.html ? coluna.html(c) : this.esc(coluna.texto(c));
      return `<td${coluna.classe ? ` class="${coluna.classe}"` : ''}>${conteudo}</td>`;
    }).join('');
    return `<tr class="${c.isNova ? 'cnc-linha-nova' : ''}">${celulas}</tr>`;
  },

  /* Contexto:
     Alerta no botão da aba: nº de carteiras novas (some quando zero).
     Chamada depois de cada consulta. Não retorna nada. */
  atualizarBadgeAba() {
    const badge = document.getElementById('cnc-tab-badge');
    const novas = this.resposta ? this.resposta.contagem.novas : 0;
    badge.textContent = novas ? `${novas} nova${novas > 1 ? 's' : ''}` : '';
    badge.style.display = novas ? '' : 'none';
  },
});
