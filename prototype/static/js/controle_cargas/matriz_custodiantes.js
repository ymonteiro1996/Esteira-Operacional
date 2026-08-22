/* ControleCargas.matriz_custodiantes — aba "Controle de Cargas" (custodiantes) — ControleUpload.xlsx, janela deslizante.
   Parte do objeto único ControleCargas (ver state.js). Gerado a partir da
   refatoração de index_template.html (CLAUDE.md §4, "Divisão clara das
   páginas" — pasta static/js/controle_cargas/, 1 arquivo por funcionalidade).
*/
Object.assign(ControleCargas, {
// ─────────────────────────────────────────────────────────────────────────
// Aba "Controle de Cargas" (custodiantes) — ControleUpload.xlsx
// Fonte: ControleCargas.SNAPSHOT.custodianUpload (gerado por custodian_upload.py, chamado
// pelo build_snapshot.py — Excel manual da operação, SOMENTE LEITURA).
// Grid simples: linhas = custodiantes, colunas = datas (janela deslizante de
// 25), célula = só cor (verde OK / amarelo alerta / cinza neutro); o texto
// bruto original aparece no tooltip (ex.: "P (Conferir T)" é verde mas o
// hover mostra que há algo a conferir).
// ─────────────────────────────────────────────────────────────────────────
CU_WINDOW: 25,   // nº de colunas de data visíveis por página

cuState: { end: null },   // índice (em cu.dates) da ÚLTIMA coluna visível; null = default

// nome legível da classificação (tooltip) — espelho de classify_status()
// do custodian_upload.py: manter os DOIS em sincronia se a regra mudar.
CU_CLASS_NAMES: {
  ok:      'OK — posição carregada (começa com "P")',
  alert:   'Alerta — status precisa de atenção',
  neutral: 'Neutro — sem cobrança (vazio ou feriado)',
},

/* Contexto:
   Calcula o índice default da última coluna visível: a última data COM
   DADO preenchido (não a última coluna da planilha — o cabeçalho vai até
   dez/2026, meses no futuro sem nada digitado ainda). Chamada por
   buildCustodianMatrix() quando cuState.end ainda não foi definido. Retorna
   o índice (int) em cu.dates.

   Pseudocódigo:
     1. Usa lastDateWithData do bloco (ou hoje, como fallback) como âncora.
     2. Percorre as datas de trás para frente até achar a primeira <= âncora
        — esse é o índice default. */
cuDefaultEnd(cu){
  const anchor = cu.lastDateWithData || ControleCargas.SNAPSHOT.meta.today;
  let end = cu.dates.length - 1;
  for(let i = cu.dates.length - 1; i >= 0; i--){
    if(cu.dates[i] <= anchor){ end = i; break; }
  }
  return end;
},

/* Contexto:
   (Re)desenha a aba "Controle de Cargas" (custodiantes) — grid de janela
   deslizante de CU_WINDOW colunas de data. Chamada ao trocar para essa aba
   e pelos botões ◀/▶/"mais recente". Não retorna nada.

   Pseudocódigo:
     1. Sem bloco custodianUpload no snapshot (Excel não pôde ser lido),
        limpa a tabela e mostra a nota de aviso.
     2. Resolve a janela [start, end] de colunas visíveis (calcula o
        default na 1ª vez; sempre clampa o índice guardado).
     3. Monta o cabeçalho (DD/MM + dia da semana, com marcador de Day Off).
     4. Monta o corpo: 1 linha por custodiante, célula = só cor (o texto
        bruto fica no tooltip).
     5. Atualiza os textos de range/contagem/nota de rodapé e religa o
        tooltip das células. */
buildCustodianMatrix(){
  const table = document.getElementById('cu-matrix');
  const cu = ControleCargas.SNAPSHOT.custodianUpload;
  if(!cu){
    // build_snapshot.py não conseguiu ler o ControleUpload.xlsx (best-effort)
    table.innerHTML = '';
    document.getElementById('cu-range').textContent = '';
    document.getElementById('cu-count').textContent = '';
    document.getElementById('cu-note').textContent =
      'ControleUpload.xlsx não pôde ser lido na geração deste snapshot — regere com build_snapshot.py (o arquivo pode estar aberto/bloqueado ou ter sido movido).';
    return;
  }
  const dates = cu.dates;
  if(ControleCargas.cuState.end===null) ControleCargas.cuState.end = ControleCargas.cuDefaultEnd(cu);
  ControleCargas.cuState.end = Math.max(0, Math.min(ControleCargas.cuState.end, dates.length - 1));   // clamp defensivo
  const end = ControleCargas.cuState.end;
  const start = Math.max(0, end - ControleCargas.CU_WINDOW + 1);

  // cabeçalho: DD/MM + dia da semana; datas com nota "Day Off" ganham o
  // marcador ● (a nota completa vai no title e no tooltip das células).
  let thead = '<thead><tr><th class="hdr-cust">Gestor + Custodia</th>';
  for(let i=start; i<=end; i++){
    const d = dates[i];
    const dayoff = cu.dayOffNotes ? cu.dayOffNotes[d] : null;
    thead += `<th title="${ControleCargas.escAttr(d)}${dayoff?(' — '+ControleCargas.escAttr(dayoff)):''}">${ControleCargas.fmtDM(d)}${dayoff?'<span class="dayoff-mark"> ●</span>':''}<br><span style="font-weight:400">${ControleCargas.weekdayAbbrev(d)}</span></th>`;
  }
  thead += '</tr></thead>';

  // corpo: 1 linha por custodiante (nº de linhas vem do snapshot — a
  // planilha cresce e o grid acompanha sem mexer em nada aqui).
  let body = '';
  cu.rows.forEach((r, ri)=>{
    body += `<tr><td class="col-cust">${ControleCargas.esc(r.label)}</td>`;
    for(let i=start; i<=end; i++){
      const cell = r.cells[i];                 // null = vazio (neutro)
      const cls = cell ? cell.c : 'neutral';
      body += `<td><div class="cell cu-${cls}" tabindex="0" data-cu-row="${ri}" data-cu-idx="${i}"></div></td>`;
    }
    body += '</tr>';
  });
  table.innerHTML = thead + '<tbody>' + body + '</tbody>';

  document.getElementById('cu-range').textContent =
    `${dates[start]} .. ${dates[end]} (${end-start+1} de ${dates.length} datas)`;
  document.getElementById('cu-count').textContent =
    `${cu.rows.length} custodiantes · última data com dado: ${cu.lastDateWithData||'—'}`;
  document.getElementById('cu-note').textContent =
    `Fonte: ${cu.sourceFile} (aba ${cu.sheet}, mantida manualmente pela operação — nosso app é SOMENTE LEITURA: linhas/datas novas são absorvidas automaticamente a cada geração do snapshot). Lida em ${cu.readAt.replace('T',' ')}. Passe o mouse na célula para ver o texto original.`;

  ControleCargas.initCustodianTooltip();
},

/* Contexto:
   Liga o hover/foco de tooltip em toda célula da matriz de custodiantes —
   reaproveita o mesmo #tt do grid principal (posicionamento idêntico ao
   initTooltip()). Chamada no fim de buildCustodianMatrix() (precisa
   religar a cada redesenho). Não retorna nada.

   Pseudocódigo:
     1. Para cada célula, liga um handler "show" que resolve custodiante+
        data+texto bruto+classificação (+ nota Day Off, se houver) e
        posiciona o balão perto da célula.
     2. Liga o "hide" para esconder o balão.
     3. Associa os dois handlers a mouseenter/mouseleave e focus/blur. */
initCustodianTooltip(){
  const tt = document.getElementById('tt');
  document.querySelectorAll('#cu-matrix .cell').forEach(cell=>{
    const show = ()=>{
      const cu = ControleCargas.SNAPSHOT.custodianUpload;
      const r = cu.rows[+cell.dataset.cuRow];
      const i = +cell.dataset.cuIdx;
      if(!r || !cu.dates[i]) return;
      const d = cu.dates[i];
      const c = r.cells[i];
      const cls = c ? c.c : 'neutral';
      const dayoff = cu.dayOffNotes ? cu.dayOffNotes[d] : null;
      tt.innerHTML = `<div class="tt-h">${ControleCargas.esc(r.label)}</div>
        <div class="tt-sub">${ControleCargas.weekdayAbbrev(d)} ${d}</div>
        <div class="tt-row"><span class="tt-label">Texto original</span><span class="tt-val">${ControleCargas.esc(c ? c.t : '(vazio)')}</span></div>
        <div class="tt-row"><span class="tt-label">Classificação</span><span class="tt-val${cls==='alert'?' tt-warn':''}">${ControleCargas.CU_CLASS_NAMES[cls]}</span></div>
        ${dayoff?`<div class="tt-rule"></div><div class="tt-row"><span class="tt-label">Nota do dia</span><span class="tt-val">${ControleCargas.esc(dayoff)}</span></div>`:''}`;
      const rect = cell.getBoundingClientRect();
      const ttW = 320;
      let left = rect.left + rect.width/2 - ttW/2;
      left = Math.max(8, Math.min(left, window.innerWidth - ttW - 8));
      tt.style.left = left+'px';
      let top = rect.bottom + 8;
      if(top + 160 > window.innerHeight) top = rect.top - 160;
      tt.style.top = top+'px';
      tt.classList.add('show');
    };
    const hide = ()=> tt.classList.remove('show');
    cell.addEventListener('mouseenter', show);
    cell.addEventListener('mouseleave', hide);
    cell.addEventListener('focus', show);
    cell.addEventListener('blur', hide);
  });
},
});
