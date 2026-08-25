/* ControleCargas.matrizHoraCompany — aba "Company", sub-visão "Por empresa",
   drill-down "Processamento por Hora × Empresa". [2026-08-25, pedido do
   usuário] Clicar no botão "⏱" do cabeçalho de um dia da matriz "Por
   empresa" (matriz_company.js) abre, logo abaixo dela (painel inline,
   dentro de #panel-company — NÃO é modal), uma tabela cruzando HORA de
   PROCESSAMENTO (linhas) × COMPANY (colunas) para aquele dia específico.

   100% ADITIVO — nenhuma função pré-existente é tocada por este arquivo, só
   reaproveitada:
     - computeCompanyPublishMatrix() (matriz_company.js) — meta por
       company/dia (denominador "deveria publicar").
     - montarBaldesHoraPublicacao()/horaInteiraDeHoraPub()/
       celulaPublicacaoHoraHtml() (matriz_publicacao_hora.js) — mesmos
       baldes de hora, mesma extração de hora inteira de uma string
       "HH:MM" e mesma célula de 2 números (incremento+acumulado/%) já
       usados pela sub-visão agregada "Por hora".
     - cellByDate() (matriz.js) — acha a célula de uma carteira numa data.
     - carregarConfigPublicacaoHora()/enableDragScroll()/weekdayAbbrev()/
       esc() — helpers já existentes, só chamados.
   O botão "⏱" em si é injetado via DOM (insertAdjacentHTML/appendChild)
   DEPOIS que buildCompanyMatrix() já desenhou a tabela — não edita o
   template do <th> em matriz_company.js. Um MutationObserver dedicado
   (_observarMatrizCompanyParaBotoesHora) religa o botão sempre que a
   matriz "Por empresa" é redesenhada (troca de aba, clique de foco de
   data, "Atualizar"), de forma idempotente.

   MÉTRICA — Processamento (não Publicação, decisão do usuário): usa
   `celula.tt.c`, a hora de `processedPosition.createdAt` já formatada BRT,
   JÁ existente em toda célula de carteira do snapshot (montar_horarios_
   celula(), snapshot_builder.py) — dado real, confirmado populado, sem
   depender de publishedAt/Beehus. Quando há reprocesso (tt.reproc
   presente), o balde usa a MESMA hora `tt.c` (1ª geração/createdAt) — nunca
   a de updatedAt (tt.reproc é só a hora do reprocesso em si, ignorada aqui
   de propósito).

   Filtro de empresa da toolbar: ignorado, sempre todas as companies —
   mesmo comportamento que computeCompanyPublishMatrix()/
   computePublicacaoHoraMatrix() já têm hoje (decisão do usuário). */
Object.assign(ControleCargas, {
// ─────────────────────────────────────────────────────────────────────────
// Estado do painel (qual dia está aberto agora, se algum)
// ─────────────────────────────────────────────────────────────────────────
_diaAbertoDrillDownHoraCompany: null,

// ─────────────────────────────────────────────────────────────────────────
// Cálculo (JS puro, mesmo padrão das outras matrizes — backend só emite
// fatos, front agrega)
// ─────────────────────────────────────────────────────────────────────────
/* Contexto:
   Agrega, para 1 dia específico da janela, quantas carteiras (mustPublish)
   já foram PROCESSADAS (celula.tt.c) em cada balde de hora, cruzado por
   company — só as companies com meta > 0 nesse dia entram nas colunas
   (decisão do usuário). Chamada por abrirDrillDownHoraCompany(). Retorna
   {baldes, companies, metaPorCompany, metaTotal, incrementoPorBaldeECompany,
   incrementoPorBaldeTotal}.

   Pseudocódigo:
     1. Monta os baldes de hora a partir da config (mesma faixa configurável
        da sub-visão agregada "Por hora").
     2. Reaproveita computeCompanyPublishMatrix() só para ler a meta de cada
        company nesse dia; filtra as companies com meta > 0 (colunas da
        tabela) e soma a meta total.
     3. Para cada carteira (mustPublish) do snapshot cuja company está entre
        as colunas: se ela "deveria publicar" no dia (célula existe e não é
        'notcov') e já tem hora de processamento (tt.c — reprocesso usa a
        MESMA hora, nunca tt.reproc/updatedAt), acha o balde e soma 1 no
        incremento daquela company/balde e no total da coluna "Total".
        Carteira sem tt.c ainda (não processada) não entra em nenhum balde —
        só reduz o "Fim do dia" contra a meta, mesmo espírito de
        computePublicacaoHoraMatrix() com agrupamentos não publicados. */
computeMatrizHoraPorCompany(dia, config){
  const baldes = ControleCargas.montarBaldesHoraPublicacao(config);
  const porCompany = ControleCargas.computeCompanyPublishMatrix();

  const companies = Object.keys(porCompany)
    .filter(company => porCompany[company].porData[dia] && porCompany[company].porData[dia].total > 0)
    .sort((a,b)=> a.localeCompare(b));

  const metaPorCompany = {};
  let metaTotal = 0;
  companies.forEach(company=>{
    const meta = porCompany[company].porData[dia].total;
    metaPorCompany[company] = meta;
    metaTotal += meta;
  });

  const incrementoPorBaldeECompany = {};
  const incrementoPorBaldeTotal = {};
  baldes.forEach(b=>{ incrementoPorBaldeECompany[b.id] = {}; incrementoPorBaldeTotal[b.id] = 0; });

  ControleCargas.SNAPSHOT.wallets.forEach(carteira=>{
    if(!carteira.mustPublish) return;
    if(metaPorCompany[carteira.company] === undefined) return; // company sem meta>0 neste dia -> fora das colunas
    const celula = ControleCargas.cellByDate(carteira)[dia];
    if(!celula || celula.s === 'notcov') return;
    const horaProcessamento = celula.tt && celula.tt.c;
    if(!horaProcessamento) return; // ainda não processada nesse dia
    const horaInteira = ControleCargas.horaInteiraDeHoraPub(horaProcessamento);
    const balde = baldes.find(b=> b.pertence(horaInteira)) || baldes[baldes.length-1];
    incrementoPorBaldeECompany[balde.id][carteira.company] = (incrementoPorBaldeECompany[balde.id][carteira.company] || 0) + 1;
    incrementoPorBaldeTotal[balde.id] += 1;
  });

  return { baldes, companies, metaPorCompany, metaTotal, incrementoPorBaldeECompany, incrementoPorBaldeTotal };
},

// ─────────────────────────────────────────────────────────────────────────
// Render
// ─────────────────────────────────────────────────────────────────────────
/* Contexto:
   Monta o HTML da tabela do drill-down — linhas "Meta"/1 por balde de
   hora/"Fim do dia" (mesmo desenho da sub-visão agregada "Por hora"),
   colunas = companies com meta > 0 no dia + 1 coluna final "Total" (soma
   de todas as companies — serve de teste de sanidade contra a coluna deste
   mesmo dia na matriz agregada "Publicação por Hora"). Reaproveita
   celulaPublicacaoHoraHtml() célula a célula. Chamada por
   abrirDrillDownHoraCompany(). Retorna string HTML.

   Pseudocódigo:
     1. Sem nenhuma company com meta > 0 no dia, mostra aviso vazio.
     2. Cabeçalho: coluna "Hora" + 1 coluna por company + "Total".
     3. Linha "Meta": meta de cada company + meta total (constante nas
        linhas seguintes, igual à sub-visão agregada).
     4. 1 linha por balde, acumulando o total corrente por company E pela
        coluna "Total", célula a célula.
     5. Linha "Fim do dia": acumulado final de cada company + Total. */
renderMatrizHoraCompanyHtml(dia, dados){
  const { baldes, companies, metaPorCompany, metaTotal, incrementoPorBaldeECompany, incrementoPorBaldeTotal } = dados;
  if(!companies.length){
    return `<p class="note">Nenhuma company tem carteira que deveria publicar em ${ControleCargas.weekdayAbbrev(dia)} ${dia}.</p>`;
  }

  let thead = '<thead><tr><th class="hdr-companyname">Hora</th>';
  companies.forEach(company=> thead += `<th>${ControleCargas.esc(company)}</th>`);
  thead += '<th>Total</th></tr></thead>';

  let corpoMeta = '<tr class="pubhora-row-meta"><td class="col-companyname">Meta<span class="pubhora-sublabel">deveria publicar</span></td>';
  companies.forEach(company=> corpoMeta += `<td class="pubhora-meta-cell">${metaPorCompany[company]}</td>`);
  corpoMeta += `<td class="pubhora-meta-cell">${metaTotal}</td></tr>`;

  const acumuladoPorCompany = {};
  companies.forEach(c=> acumuladoPorCompany[c] = 0);
  let acumuladoTotal = 0;

  let corpoBaldes = '';
  baldes.forEach(balde=>{
    corpoBaldes += `<tr><td class="col-companyname">${ControleCargas.esc(balde.label)}</td>`;
    companies.forEach(company=>{
      const incremento = incrementoPorBaldeECompany[balde.id][company] || 0;
      acumuladoPorCompany[company] += incremento;
      corpoBaldes += ControleCargas.celulaPublicacaoHoraHtml(incremento, acumuladoPorCompany[company], metaPorCompany[company], dia, `${balde.label} · ${company}`);
    });
    const incrementoTotal = incrementoPorBaldeTotal[balde.id] || 0;
    acumuladoTotal += incrementoTotal;
    corpoBaldes += ControleCargas.celulaPublicacaoHoraHtml(incrementoTotal, acumuladoTotal, metaTotal, dia, `${balde.label} · Total`);
    corpoBaldes += '</tr>';
  });

  let corpoFim = '<tr class="pubhora-row-fim"><td class="col-companyname">Fim do dia</td>';
  companies.forEach(company=>{
    const meta = metaPorCompany[company];
    const total = acumuladoPorCompany[company];
    const pctTxt = meta ? ` <span class="pubhora-fim-pct">(${Math.floor(total/meta*100)}%)</span>` : '';
    corpoFim += `<td class="pubhora-fim-cell">${total}${pctTxt}</td>`;
  });
  {
    const pctTxt = metaTotal ? ` <span class="pubhora-fim-pct">(${Math.floor(acumuladoTotal/metaTotal*100)}%)</span>` : '';
    corpoFim += `<td class="pubhora-fim-cell">${acumuladoTotal}${pctTxt}</td>`;
  }
  corpoFim += '</tr>';

  return `<table class="matrix hcp-table">${thead}<tbody>${corpoMeta}${corpoBaldes}${corpoFim}</tbody></table>`;
},

// ─────────────────────────────────────────────────────────────────────────
// Painel inline (abrir/fechar) — dentro de #panel-company, logo abaixo da
// matriz "Por empresa"
// ─────────────────────────────────────────────────────────────────────────
/* Contexto:
   Cria (1x, idempotente) o container DOM do painel de drill-down —
   cabeçalho com título + botão fechar, corpo vazio (preenchido por
   abrirDrillDownHoraCompany). Injetado como irmão, logo depois de
   #company-matrix-wrap, dentro de #panel-company. Chamada por
   abrirDrillDownHoraCompany(). Retorna o elemento do painel.

   Pseudocódigo:
     1. Já existe -> devolve direto.
     2. Monta o HTML do cabeçalho+corpo, insere depois de
        #company-matrix-wrap e liga o botão fechar. */
_garantirPainelDrillDownHoraCompany(){
  let painel = document.getElementById('hcp-painel');
  if(painel) return painel;
  const ancora = document.getElementById('company-matrix-wrap');
  ancora.insertAdjacentHTML('afterend', `
    <div class="hcp-painel" id="hcp-painel" style="display:none;">
      <div class="hcp-cabecalho">
        <h3 id="hcp-titulo">Processamento por Hora × Empresa</h3>
        <button type="button" class="hcp-fechar" id="hcp-fechar" title="Fechar">×</button>
      </div>
      <div id="hcp-corpo"></div>
    </div>`);
  painel = document.getElementById('hcp-painel');
  document.getElementById('hcp-fechar').addEventListener('click', ControleCargas.fecharDrillDownHoraCompany);
  return painel;
},

/* Contexto:
   Abre (ou recarrega, se já aberto noutro dia) o painel inline
   "Processamento por Hora × Empresa" de 1 dia da janela. Chamada pelo
   clique no botão "⏱" do cabeçalho de um dia (ligarBotoesDrillDownDia()).
   Não retorna nada.

   Pseudocódigo:
     1. Garante o container do painel (cria 1x) e mostra "Carregando…".
     2. Carrega a config de baldes de hora (carregarConfigPublicacaoHora,
        cache compartilhado com a sub-visão agregada "Por hora").
     3. Se o usuário já fechou/trocou de dia enquanto a config carregava,
        descarta o resultado (evita "piscar" dado de um dia antigo).
     4. Agrega os dados do dia (computeMatrizHoraPorCompany) e desenha a
        tabela (renderMatrizHoraCompanyHtml) dentro de um .grid-scroll
        próprio (liga o drag-scroll nele, mesmo mecanismo do resto da
        tela). */
abrirDrillDownHoraCompany(dia){
  const painel = ControleCargas._garantirPainelDrillDownHoraCompany();
  painel.style.display = '';
  ControleCargas._diaAbertoDrillDownHoraCompany = dia;

  const corpo = document.getElementById('hcp-corpo');
  const titulo = document.getElementById('hcp-titulo');
  titulo.textContent = `Processamento por Hora × Empresa — ${ControleCargas.weekdayAbbrev(dia)} ${dia}`;
  corpo.innerHTML = '<p class="note">Carregando…</p>';

  ControleCargas.carregarConfigPublicacaoHora().then(config=>{
    if(ControleCargas._diaAbertoDrillDownHoraCompany !== dia) return;
    const dados = ControleCargas.computeMatrizHoraPorCompany(dia, config);
    corpo.innerHTML = `<div class="grid-scroll" id="hcp-scroll">${ControleCargas.renderMatrizHoraCompanyHtml(dia, dados)}</div>
      <p class="note">Hora = processamento (celula.tt.c, processedPosition.createdAt BRT) de cada carteira "Deve Publicar"=Sim; reprocesso usa a hora da 1ª geração, nunca a do reprocesso. Meta = mesma regra da matriz "Por empresa" acima (só companies com meta&gt;0 neste dia entram nas colunas). Coluna "Total" soma todas as companies — compare com a coluna deste mesmo dia na sub-visão agregada "Por hora" (seletor no topo do painel).</p>`;
    const scrollEl = document.getElementById('hcp-scroll');
    if(scrollEl) ControleCargas.enableDragScroll(scrollEl);
  });
},

/* Contexto:
   Fecha o painel de drill-down, se estiver aberto. Chamada pelo botão "×"
   do painel e por ligarBotoesDrillDownDia() quando o usuário clica de novo
   no botão "⏱" do mesmo dia já aberto (alterna abrir/fechar). Não retorna
   nada.

   Pseudocódigo:
     1. Sem painel no DOM ainda, não há o que fechar.
     2. Esconde o painel e limpa o dia aberto (próxima abertura sempre
        recomeça do zero). */
fecharDrillDownHoraCompany(){
  const painel = document.getElementById('hcp-painel');
  if(!painel) return;
  painel.style.display = 'none';
  ControleCargas._diaAbertoDrillDownHoraCompany = null;
},

// ─────────────────────────────────────────────────────────────────────────
// Gatilho — botão "⏱" injetado em cada <th data-date> da matriz "Por
// empresa" (via DOM, sem editar matriz_company.js)
// ─────────────────────────────────────────────────────────────────────────
/* Contexto:
   Injeta o botão "⏱" dentro de cada <th data-date> já renderizado pela
   matriz "Por empresa" (buildCompanyMatrix(), matriz_company.js) — 100%
   ADITIVO via DOM: nenhuma função existente é tocada, o botão é anexado
   DEPOIS que a tabela já foi desenhada. O clique que já existe no <th>
   inteiro (wireHeaderDateClicks(), matriz.js — foco de data) continua
   funcionando sem nenhuma alteração: o botão novo tem seu próprio listener
   com stopPropagation() para não disparar os dois efeitos juntos. Chamada
   pelo MutationObserver de _observarMatrizCompanyParaBotoesHora() sempre
   que #company-matrix é redesenhada (idempotente — nunca duplica o botão
   dentro do mesmo <th>). Não retorna nada.

   Pseudocódigo:
     1. Para cada <th data-date> da matriz "Por empresa" que ainda não tem
        o botão, cria e injeta o botão "⏱".
     2. Liga o clique: stopPropagation (não deixa vazar pro <th> pai) e
        alterna abrir/fechar o painel — se o dia clicado já é o que está
        aberto, fecha; senão abre nesse dia. */
ligarBotoesDrillDownDia(){
  document.querySelectorAll('#company-matrix thead th[data-date]').forEach(th=>{
    if(th.querySelector('.hcp-drill-btn')) return;
    const dia = th.dataset.date;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hcp-drill-btn';
    btn.title = `Processamento por Hora × Empresa — ${ControleCargas.weekdayAbbrev(dia)} ${dia}`;
    btn.textContent = '⏱';
    btn.addEventListener('click', (e)=>{
      e.stopPropagation();
      if(ControleCargas._diaAbertoDrillDownHoraCompany === dia) ControleCargas.fecharDrillDownHoraCompany();
      else ControleCargas.abrirDrillDownHoraCompany(dia);
    });
    th.appendChild(btn);
  });
},

/* Contexto:
   Liga um MutationObserver em #company-matrix que religa os botões "⏱"
   (ligarBotoesDrillDownDia) sempre que o innerHTML da tabela é substituído
   — buildCompanyMatrix() (matriz_company.js) redesenha a tabela inteira a
   cada troca de aba/foco de data/"Atualizar", apagando qualquer botão
   injetado antes. Chamada 1x, no fim deste arquivo. Não retorna nada.

   Pseudocódigo:
     1. Sem a tabela no DOM ainda, sai (script carrega antes do 1º render,
        mas o elemento <table id="company-matrix"> já existe vazio no HTML
        estático — só o conteúdo é que ainda não foi desenhado).
     2. Observa mudanças nos filhos diretos da tabela (thead/tbody sendo
        substituídos) e, a cada uma, tenta religar os botões. */
_observarMatrizCompanyParaBotoesHora(){
  const tabela = document.getElementById('company-matrix');
  if(!tabela) return;
  const observer = new MutationObserver(()=> ControleCargas.ligarBotoesDrillDownDia());
  observer.observe(tabela, { childList:true, subtree:false });
},
});

// Liga o observer assim que este arquivo carrega — os elementos do HTML já
// existem nesse ponto (script no fim do <body>, mesmo padrão de
// matriz_publicacao_hora.js/static/js/anomalias/index.js).
ControleCargas._observarMatrizCompanyParaBotoesHora();
