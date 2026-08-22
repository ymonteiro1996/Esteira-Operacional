/* ControleDemandas.colunas — monta cada coluna do quadro (header + drop zone) e o menu de colunas ocultas.
   Object.assign(ControleDemandas, {...}) — CLAUDE.md §4. */
Object.assign(ControleDemandas, {

  /* Contexto:
     Monta o elemento <div> de 1 coluna do Kanban (cabeçalho com avatar +
     nome + contagem + botão de ocultar, zona de drop, cartões, botão "+
     Demanda") — tradução de buildColumn() da origem. Chamada por
     renderizarQuadro() 1x por coluna visível. Retorna o HTMLDivElement
     pronto pra anexar ao quadro.

     Pseudocódigo:
       1. Header: avatar colorido (hash do nome, ou "?" cinza se for
          "Sem Responsável") + nome + contagem de cartões + botão "×" para
          ocultar (exceto na coluna "Sem Responsável", que é fixa).
       2. Zona de drop (kd-cartoes): liga os 3 eventos de drag&drop
          (dragover/dragleave/drop, ver arrastar.js) e anexa 1 cartão por
          demanda do balde.
       3. Botão "+ Demanda" no rodapé, já com o responsável pré-preenchido
          (exceto na coluna "Sem Responsável"). */
  construirColuna(pessoa, demandasDaColuna, ehSemResponsavel) {
    const nomeExibicao = ehSemResponsavel ? 'Sem Responsável' : pessoa;
    const corFundo = ehSemResponsavel ? '#9ca3af' : this.corAvatar(pessoa);

    const coluna = document.createElement('div');
    coluna.className = 'kd-col';
    coluna.dataset.pessoa = pessoa;
    coluna.innerHTML = `
      <div class="kd-col-header">
        <div class="kd-avatar" style="background:${corFundo}">${ehSemResponsavel ? '?' : this.iniciais(pessoa)}</div>
        <span class="kd-col-nome" title="${this.esc(nomeExibicao)}">${this.esc(nomeExibicao)}</span>
        <span class="kd-col-contagem">${demandasDaColuna.length}</span>
        ${!ehSemResponsavel ? `<button class="kd-col-ocultar" title="Ocultar coluna" data-pessoa="${this.esc(pessoa)}">×</button>` : ''}
      </div>
    `;

    const zonaDrop = document.createElement('div');
    zonaDrop.className = 'kd-cartoes';
    zonaDrop.dataset.pessoa = pessoa;
    zonaDrop.addEventListener('dragover', e => this.aoArrastarSobre(e));
    zonaDrop.addEventListener('dragleave', e => this.aoSairDoArrasto(e));
    zonaDrop.addEventListener('drop', e => this.aoSoltar(e));
    demandasDaColuna.forEach(d => zonaDrop.appendChild(this.construirCartao(d)));
    coluna.appendChild(zonaDrop);

    const botaoNova = document.createElement('button');
    botaoNova.className = 'kd-add-btn';
    botaoNova.textContent = '+ Demanda';
    botaoNova.addEventListener('click', () => this.abrirModalNova(ehSemResponsavel ? '' : pessoa));
    coluna.appendChild(botaoNova);

    const botaoOcultar = coluna.querySelector('.kd-col-ocultar');
    if (botaoOcultar) botaoOcultar.addEventListener('click', () => this.ocultarColuna(pessoa));

    return coluna;
  },

  /* Contexto: monta o botão circular "+" ao final do quadro, que abre um
     menu com as colunas (responsáveis) atualmente ocultas — clicar num
     item reexibe aquela coluna (tradução de buildAddColBtn() da origem).
     Chamada por renderizarQuadro(). Retorna o elemento pronto (botão
     desabilitado se não houver nenhuma coluna oculta).

     Pseudocódigo:
       1. Calcula quais responsáveis de opcoes.responsaveis NÃO estão em
          `this.colunas` (ocultos).
       2. Sem nenhum oculto -> botão "+" desabilitado, sem menu.
       3. Com ocultos -> menu flutuante, 1 item por responsável oculto;
          clicar chama adicionarColuna() e fecha o menu. */
  construirBotaoAdicionarColuna() {
    const ocultos = this.opcoes.responsaveis.filter(p => !this.colunas.includes(p));
    const wrap = document.createElement('div');
    wrap.className = 'kd-add-col';

    const botao = document.createElement('button');
    botao.className = 'kd-add-col-btn';
    botao.title = 'Adicionar pessoa';
    botao.innerHTML = '+';
    wrap.appendChild(botao);

    if (!ocultos.length) {
      botao.disabled = true;
      return wrap;
    }

    const menu = document.createElement('div');
    menu.className = 'kd-hidden-cols-menu';
    menu.style.display = 'none';
    ocultos.forEach(pessoa => {
      const item = document.createElement('button');
      const cor = this.corAvatar(pessoa);
      item.innerHTML = `<span class="kd-avatar kd-avatar-mini" style="background:${cor}">${this.iniciais(pessoa)}</span>${this.esc(pessoa)}`;
      item.addEventListener('click', () => { this.adicionarColuna(pessoa); menu.style.display = 'none'; });
      menu.appendChild(item);
    });
    wrap.appendChild(menu);

    botao.addEventListener('click', e => {
      e.stopPropagation();
      menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    });
    document.addEventListener('click', () => { menu.style.display = 'none'; });

    return wrap;
  },

  /* Contexto: remove uma coluna da visão do quadro (não apaga nenhuma
     demanda — só deixa de agrupar por aquele responsável até a coluna ser
     reexibida, mesma UX da origem). Persiste em localStorage. Não retorna
     nada. */
  ocultarColuna(pessoa) {
    this.colunas = this.colunas.filter(p => p !== pessoa);
    this.salvarColunas();
    this.renderizarQuadro();
  },

  /* Contexto: reexibe uma coluna oculta (menu do botão "+"). Persiste em
     localStorage. Não retorna nada. */
  adicionarColuna(pessoa) {
    if (!this.colunas.includes(pessoa)) {
      this.colunas.push(pessoa);
      this.salvarColunas();
    }
    this.renderizarQuadro();
  },
});
