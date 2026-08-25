/* ControleCargas.matrizPublicacaoHora — aba "Company", sub-visão "Por hora".
   [2026-08-24, pedido do usuário] Mostra, para cada dia da janela do grid, EM
   QUE HORA os agrupamentos foram publicados — linhas = baldes de hora (até
   Xh / hora cheia / após Yh / "sem hora"), colunas = mesmos dias da matriz
   Company (aba "Por empresa"). 100% ADITIVO: nenhuma função pré-existente é
   tocada por este arquivo (só reaproveitada) — ver comentário de topo de
   matriz.js para as 2 exceções cirúrgicas desta tarefa
   (agrupamentoCarteirasQueDevemPublicarNaData/agrupamentoEstaPublicadoNaData,
   extraídas de dentro de computeGroupingPublishStat() sem mudar seu retorno).

   Fonte da hora: "Rota A" (decisão do usuário) — hora REAL de publicação do
   agrupamento (campo `publishedAt` que a API Beehus já devolve em
   groupingsDetailed; db.py/snapshot_builder.py passaram a copiar/formatar
   esse campo nesta mesma tarefa, guardado em cada célula de agrupamento como
   `celula.horaPub`, string "HH:MM" BRT ou AUSENTE). Zero chamada de API
   nova: o boot já buscava esse payload, só não copiava o campo.

   "Deveria estar publicado" (linha META): MESMA regra de denominador que
   computeGroupingPublishStat() já usa para o card "Agrupamentos Publicados"
   (agrupamentoCarteirasQueDevemPublicarNaData) — não é uma curva de SLA por
   hora, é o mesmo número que já aparece naquele card, só que para TODOS os
   dias da janela de uma vez (não só a data em foco) e SEM aplicar o filtro
   corrente da toolbar — decisão do usuário: a matriz nova soma sempre TODAS
   as empresas, igual a matriz "Por empresa" já faz deliberadamente
   (computeCompanyPublishMatrix() também não chama applyFilters()).

   Faixa de hora configurável em data/publicacao_hora_config.json (CLAUDE.md
   §10), servida por GET /api/publicacao-hora-config (rota nova, adição pura
   em app.py) — nunca hardcoded aqui.

   Defensivo por natureza: se `publishedAt`/`horaPub` vier ausente ou em
   formato inesperado, toda carga cai no balde "sem hora" — nenhum KeyError/
   exceção é possível por causa desse campo (mesmo espírito do mecanismo
   hora_pub, hoje morto para carteira, ver snapshot_builder.py). */
Object.assign(ControleCargas, {
// ─────────────────────────────────────────────────────────────────────────
// Config (limites de hora) — data/publicacao_hora_config.json via API
// ─────────────────────────────────────────────────────────────────────────
_pubHoraConfigPadrao: { nomeVisao: 'Publicação por Hora', limiteInicioHoraCheia: 8, limiteFimHoraCheia: 20 },
_pubHoraConfigCache: null,

/* Contexto:
   Busca (1x, com cache em memória) a config de limites de hora da visão
   nova — GET /api/publicacao-hora-config (app.py), que por sua vez lê
   data/publicacao_hora_config.json com fallback embutido. Chamada por
   buildPublicacaoHoraMatrix() sempre que a sub-visão "Por hora" é aberta.
   Retorna uma Promise que resolve para {nomeVisao, limiteInicioHoraCheia,
   limiteFimHoraCheia} — NUNCA rejeita (rede indisponível/erro HTTP cai nos
   defaults embutidos, defensivo, igual ao resto da tela quando falta rede).

   Pseudocódigo:
     1. Já tem cache -> devolve direto (sem nova requisição).
     2. Busca a rota; sem sucesso (rede/HTTP/JSON), cai nos defaults.
     3. Mescla a resposta por cima dos defaults (chave ausente mantém o
        default) e guarda em cache. */
carregarConfigPublicacaoHora(){
  if(ControleCargas._pubHoraConfigCache) return Promise.resolve(ControleCargas._pubHoraConfigCache);
  return fetch('/api/publicacao-hora-config')
    .then(r=> r.ok ? r.json() : Promise.reject(new Error('http '+r.status)))
    .then(cfg=>{
      ControleCargas._pubHoraConfigCache = Object.assign({}, ControleCargas._pubHoraConfigPadrao, cfg||{});
      return ControleCargas._pubHoraConfigCache;
    })
    .catch(()=> (ControleCargas._pubHoraConfigCache = Object.assign({}, ControleCargas._pubHoraConfigPadrao)));
},

// ─────────────────────────────────────────────────────────────────────────
// Cálculo (JS puro, mesmo padrão das outras matrizes — backend só emite
// fatos, front agrega)
// ─────────────────────────────────────────────────────────────────────────
/* Contexto:
   Monta a lista ordenada de "baldes de hora" (linhas da matriz nova) a
   partir da config — até Xh, hora cheia de X+1 até Y, após Yh, e "sem hora"
   (balde de segurança, sempre por último). Chamada por
   computePublicacaoHoraMatrix(). Retorna array de
   {id, label, pertence(horaInteira)}.

   Pseudocódigo:
     1. 1º balde: horas <= limiteInicioHoraCheia (inclui null? não — null é
        tratado à parte pelo balde "sem hora").
     2. 1 balde por hora cheia, de limiteInicioHoraCheia+1 até
        limiteFimHoraCheia.
     3. Balde final: horas > limiteFimHoraCheia.
     4. Balde de segurança "sem hora": horaInteira===null (publishedAt
        ausente/formato inesperado). */
montarBaldesHoraPublicacao(config){
  const pad2 = n=> String(n).padStart(2,'0');
  const baldes = [];
  baldes.push({ id:'ate', label:`até ${pad2(config.limiteInicioHoraCheia)}h`,
    pertence: hh=> hh!==null && hh<=config.limiteInicioHoraCheia });
  for(let h=config.limiteInicioHoraCheia+1; h<=config.limiteFimHoraCheia; h++){
    baldes.push({ id:`h${h}`, label:`${pad2(h)}h`, pertence: hh=> hh===h });
  }
  baldes.push({ id:'apos', label:`após ${pad2(config.limiteFimHoraCheia)}h`,
    pertence: hh=> hh!==null && hh>config.limiteFimHoraCheia });
  baldes.push({ id:'sem', label:'sem hora', pertence: hh=> hh===null });
  return baldes;
},

/* Contexto:
   Extrai a hora inteira (0-23) de uma string "HH:MM" (formatar_horario_brt,
   snapshot_builder.py) gravada em celula.horaPub — usada por
   computePublicacaoHoraMatrix() para decidir o balde de cada publicação.
   100% defensivo (regra explícita desta tarefa: publishedAt pode não existir
   ou vir em formato inesperado — NUNCA lança exceção por causa disso).
   Retorna número (0-23) ou null ("sem hora").

   Pseudocódigo:
     1. Vazio/não-string -> null.
     2. Extrai os 2 primeiros dígitos antes do ":" e faz parseInt.
     3. Fora do intervalo 0-23 ou não numérico -> null. */
horaInteiraDeHoraPub(horaPub){
  if(!horaPub || typeof horaPub !== 'string') return null;
  const h = parseInt(horaPub.split(':')[0], 10);
  return Number.isFinite(h) && h>=0 && h<=23 ? h : null;
},

/* Contexto:
   Agrega, por dia da janela do grid e por balde de hora, quantos
   agrupamentos foram publicados naquele balde ("incremento"), além da meta
   fixa do dia (denominador — mesma regra de computeGroupingPublishStat(),
   reaproveitando os 2 helpers extraídos em matriz.js). SEMPRE todas as
   empresas (decisão do usuário — sem applyFilters(), igual à matriz "Por
   empresa"). Chamada por buildPublicacaoHoraMatrix(). Retorna
   {baldes, metaPorDia, incrementoPorBaldeEData}.

   Pseudocódigo:
     1. Monta os baldes de hora a partir da config.
     2. Para cada dia da janela, para cada agrupamento do snapshot (todos,
        sem filtro): resolve as carteiras-membro que deveriam publicar
        (agrupamentoCarteirasQueDevemPublicarNaData); sem nenhuma, o
        agrupamento não conta nesse dia.
     3. Com alguma carteira no denominador, soma 1 na meta do dia; se além
        disso o agrupamento JÁ publicou (agrupamentoEstaPublicadoNaData, o
        MESMO booleano que o card "Agrupamentos Publicados" usaria),
        descobre a hora (celula.horaPub do próprio agrupamento naquele dia)
        e soma 1 no balde correspondente.
     4. Devolve os 3 mapas prontos para o render acumular coluna a coluna. */
computePublicacaoHoraMatrix(config){
  const window_ = ControleCargas.SNAPSHOT.meta.window;
  const agrupamentos = ControleCargas.SNAPSHOT.groupings;
  const baldes = ControleCargas.montarBaldesHoraPublicacao(config);
  const metaPorDia = {};
  const incrementoPorBaldeEData = {};
  baldes.forEach(b=> incrementoPorBaldeEData[b.id] = {});

  window_.forEach(d=>{
    let metaDoDia = 0;
    agrupamentos.forEach(grouping=>{
      const carteirasQueDevemPublicar = ControleCargas.agrupamentoCarteirasQueDevemPublicarNaData(grouping, d);
      if(!carteirasQueDevemPublicar.length) return;
      metaDoDia++;
      if(!ControleCargas.agrupamentoEstaPublicadoNaData(grouping, d, carteirasQueDevemPublicar)) return;
      const celula = ControleCargas.cellByDate(grouping)[d];
      const horaInteira = ControleCargas.horaInteiraDeHoraPub(celula && celula.horaPub);
      const balde = baldes.find(b=> b.pertence(horaInteira)) || baldes[baldes.length-1];
      incrementoPorBaldeEData[balde.id][d] = (incrementoPorBaldeEData[balde.id][d] || 0) + 1;
    });
    metaPorDia[d] = metaDoDia;
  });

  return { baldes, metaPorDia, incrementoPorBaldeEData };
},

// ─────────────────────────────────────────────────────────────────────────
// Render
// ─────────────────────────────────────────────────────────────────────────
/* Contexto:
   Monta 1 célula de balde/dia da matriz nova — incremento daquele balde
   (grande) + acumulado até ali no dia/percentual sobre a meta (menor), com a
   MESMA cor das 4 classes já existentes (.company-ok/att/crit/neutral,
   zero token novo — pedido do usuário). Chamada por buildPublicacaoHoraMatrix(),
   1x por célula, acumulando coluna a coluna (o chamador mantém o acumulado
   corrente e só passa pra cá). Retorna string HTML (<td>...).

   Pseudocódigo:
     1. Meta=0 nesse dia -> célula neutra "—" (nenhum agrupamento deveria
        publicar).
     2. Meta>0 -> calcula o percentual acumulado, escolhe a cor pela mesma
        faixa 100%/≥80%/abaixo do resto da tela e monta o texto (+incremento
        grande, acumulado/percentual menor). */
celulaPublicacaoHoraHtml(incremento, acumulado, meta, data, labelBalde){
  if(!meta){
    return `<td><div class="cell pubhora-cell company-neutral" title="${ControleCargas.weekdayAbbrev(data)} ${data} · ${ControleCargas.escAttr(labelBalde)}: nenhum agrupamento deveria publicar (dia não coberto)">—</div></td>`;
  }
  const pct = acumulado/meta*100;
  const pctExibido = Math.floor(pct); // floor, mesmo critério de celulaCompanyHtml (matriz_company.js)
  const cls = pct>=100 ? 'company-ok' : pct>=80 ? 'company-att' : 'company-crit';
  const title = `${ControleCargas.weekdayAbbrev(data)} ${data} · ${ControleCargas.escAttr(labelBalde)}: +${incremento} nesta hora · acumulado ${acumulado}/${meta} (${pct.toFixed(1)}%)`;
  return `<td><div class="cell pubhora-cell ${cls}" title="${title}"><span class="pubhora-incremento">+${incremento}</span><span class="pubhora-acumulado">${acumulado} · ${pctExibido}%</span></div></td>`;
},

/* Contexto:
   (Re)desenha a sub-visão "Por hora" da aba Company (#pubhora-matrix) — 1
   linha por balde de hora (+ linha "Meta" no topo e "Fim do dia" no
   rodapé), 1 coluna por dia da janela do grid, igual orientação das outras
   matrizes (clique numa coluna de data reaproveita wireHeaderDateClicks()
   de graça — mesmo seletor global "table.matrix thead th[data-date]").
   Chamada ao clicar no botão "Por hora" do seletor novo (ver
   ligarSeletorSubVisaoCompany() logo abaixo) e sempre que a aba Company é
   reaberta com essa sub-visão ativa. Não retorna nada.

   Pseudocódigo:
     1. Sem a tabela no DOM (sub-visão nunca aberta ainda), sai.
     2. Carrega a config de limites de hora (assíncrono, com cache).
     3. Agrega os dados (computePublicacaoHoraMatrix).
     4. Monta o cabeçalho: coluna "Hora" + 1 coluna por dia (destacando
        referência/foco, igual às outras matrizes).
     5. Monta a linha "Meta" (denominador fixo do dia, constante ao longo
        das horas).
     6. Monta 1 linha por balde, acumulando o total corrente por coluna
        conforme desce pelas linhas (ordem cronológica dos baldes).
     7. Monta a linha "Fim do dia" com o total acumulado final de cada
        coluna (deve bater com o total do card "Agrupamentos Publicados"
        daquele dia, mesma regra de publicado).
     8. Atualiza a nota de rodapé e religa clique nas colunas de data. */
buildPublicacaoHoraMatrix(){
  const table = document.getElementById('pubhora-matrix');
  if(!table) return;
  ControleCargas.carregarConfigPublicacaoHora().then(config=>{
    const window_ = ControleCargas.SNAPSHOT.meta.window;
    const refDate = ControleCargas.SNAPSHOT.meta.referenceDate;
    const focusDate = ControleCargas.state.focusDate || refDate;
    const { baldes, metaPorDia, incrementoPorBaldeEData } = ControleCargas.computePublicacaoHoraMatrix(config);

    let thead = '<thead><tr><th class="hdr-companyname">Hora</th>';
    window_.forEach(d=>{
      const isRef = d===refDate;
      const isFocus = d===focusDate;
      const classe = isRef ? 'ref' : (isFocus ? 'focuscol' : '');
      thead += `<th class="${classe}" data-date="${d}" title="Clique para ver &quot;Agrupamentos Publicados&quot; nesta data">${ControleCargas.fmtDM(d)}${isRef?'<span class="refline">▾ ref</span>':`<br><span style="font-weight:400">${ControleCargas.weekdayAbbrev(d)}</span>`}${(isFocus&&!isRef)?'<span class="focusline">● foco</span>':''}</th>`;
    });
    thead += '</tr></thead>';

    let corpoMeta = '<tr class="pubhora-row-meta"><td class="col-companyname">Meta<span class="pubhora-sublabel">deveria publicar</span></td>';
    window_.forEach(d=> corpoMeta += `<td class="pubhora-meta-cell">${metaPorDia[d]}</td>`);
    corpoMeta += '</tr>';

    const acumuladoPorDia = {};
    window_.forEach(d=> acumuladoPorDia[d]=0);

    let corpoBaldes = '';
    baldes.forEach(balde=>{
      corpoBaldes += `<tr><td class="col-companyname">${ControleCargas.esc(balde.label)}</td>`;
      window_.forEach(d=>{
        const incremento = incrementoPorBaldeEData[balde.id][d] || 0;
        acumuladoPorDia[d] += incremento;
        corpoBaldes += ControleCargas.celulaPublicacaoHoraHtml(incremento, acumuladoPorDia[d], metaPorDia[d], d, balde.label);
      });
      corpoBaldes += '</tr>';
    });

    let corpoFim = '<tr class="pubhora-row-fim"><td class="col-companyname">Fim do dia</td>';
    window_.forEach(d=>{
      const meta = metaPorDia[d];
      const total = acumuladoPorDia[d];
      const pctTxt = meta ? ` <span class="pubhora-fim-pct">(${Math.floor(total/meta*100)}%)</span>` : '';
      corpoFim += `<td class="pubhora-fim-cell">${total}${pctTxt}</td>`;
    });
    corpoFim += '</tr>';

    table.innerHTML = thead + '<tbody>' + corpoMeta + corpoBaldes + corpoFim + '</tbody>';

    const nota = document.getElementById('pubhora-note');
    if(nota) nota.textContent =
      `Meta = mesma regra do card "Agrupamentos Publicados" (agrupamentos do Template com carteira-membro "Deve Publicar"=Sim ativa na data), sempre todas as empresas. Hora = publishedAt do próprio agrupamento (API Beehus), convertida para BRT; "sem hora" = agrupamento publicado sem esse campo preenchido (esperado até confirmar com um token/rede reais). Janela: ${window_[0]} .. ${window_[window_.length-1]} (${window_.length} du). Faixa configurável em data/publicacao_hora_config.json.`;

    ControleCargas.wireHeaderDateClicks();
  });
},

/* Contexto:
   Liga o seletor segmentado "Por empresa"/"Por hora" dentro da aba Company
   — troca qual sub-visão fica visível e (re)desenha a "Por hora" sob
   demanda. 100% ADITIVO: os 2 botões são elementos NOVOS do HTML, e o
   listener extra em "tab-company" só recalcula a sub-visão "Por hora" SE
   ela estiver selecionada no momento — não interfere no listener já
   registrado por wireAbas() (switchTab('company') continua intocado,
   cuidando sozinho da tabela "Por empresa"). Chamada 1x, no fim deste
   arquivo. Não retorna nada.

   Pseudocódigo:
     1. Clicar em "Por hora": marca esse botão ativo, esconde o wrapper
        "Por empresa" e mostra o wrapper "Por hora", desenhando-o
        (buildPublicacaoHoraMatrix).
     2. Clicar em "Por empresa": inverso — volta a mostrar a tabela já
        existente (não precisa reconstruí-la, buildCompanyMatrix() já a
        mantém atualizada a cada abertura da aba).
     3. Guarda a sub-visão corrente em ControleCargas._pubHoraSubViewAtiva
        (propriedade nova, não existia antes) para o listener extra do passo
        4 saber o que redesenhar.
     4. Um listener A MAIS (aditivo) no botão "tab-company" já existente:
        toda vez que a aba Company é (re)aberta e a sub-visão ativa é "Por
        hora", redesenha a matriz nova (dado pode ter mudado — ex.: usuário
        clicou "Atualizar" enquanto estava em outra aba). */
ligarSeletorSubVisaoCompany(){
  const btnEmpresa = document.getElementById('pubhora-btn-empresa');
  const btnHora = document.getElementById('pubhora-btn-hora');
  const wrapEmpresa = document.getElementById('company-matrix-wrap');
  const wrapHora = document.getElementById('pubhora-wrap');
  const notaEmpresaLegenda = document.getElementById('company-legend');
  const notaEmpresa = document.getElementById('company-note');
  const notaHora = document.getElementById('pubhora-note');
  if(!btnEmpresa || !btnHora || !wrapEmpresa || !wrapHora) return;

  ControleCargas._pubHoraSubViewAtiva = 'empresa';

  btnHora.addEventListener('click', ()=>{
    ControleCargas._pubHoraSubViewAtiva = 'hora';
    btnHora.classList.add('active'); btnEmpresa.classList.remove('active');
    wrapEmpresa.style.display = 'none'; wrapHora.style.display = '';
    if(notaEmpresaLegenda) notaEmpresaLegenda.style.display = 'none';
    if(notaEmpresa) notaEmpresa.style.display = 'none';
    if(notaHora) notaHora.style.display = '';
    ControleCargas.buildPublicacaoHoraMatrix();
  });

  btnEmpresa.addEventListener('click', ()=>{
    ControleCargas._pubHoraSubViewAtiva = 'empresa';
    btnEmpresa.classList.add('active'); btnHora.classList.remove('active');
    wrapHora.style.display = 'none'; wrapEmpresa.style.display = '';
    if(notaHora) notaHora.style.display = 'none';
    if(notaEmpresaLegenda) notaEmpresaLegenda.style.display = '';
    if(notaEmpresa) notaEmpresa.style.display = '';
  });

  const tabCompany = document.getElementById('tab-company');
  if(tabCompany){
    tabCompany.addEventListener('click', ()=>{
      if(ControleCargas._pubHoraSubViewAtiva === 'hora') ControleCargas.buildPublicacaoHoraMatrix();
    });
  }
},
});

// Liga o seletor assim que este arquivo carrega — os elementos do HTML já
// existem nesse ponto (script no fim do <body>, mesmo padrão de
// static/js/anomalias/index.js e static/js/controle_demandas/index.js).
ControleCargas.ligarSeletorSubVisaoCompany();
