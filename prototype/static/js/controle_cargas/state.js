/* ControleCargas.state — estado global da tela (snapshot cru + vocabulário visual) + helpers genéricos.
   Parte do objeto único ControleCargas (ver state.js). Gerado a partir da
   refatoração de index_template.html (CLAUDE.md §4, "Divisão clara das
   páginas" — pasta static/js/controle_cargas/, 1 arquivo por funcionalidade).
*/
const ControleCargas = {
// ─────────────────────────────────────────────────────────────────────────
// Carrega o snapshot via fetch('snapshot.json'), servido pelo app.py (Flask,
// allowlist de estáticos). [REVISADO 2026-07-17] O JSON não é mais embutido
// inline no HTML (~6MB): o protótipo PRECISA do servidor rodando — o que já
// era o caso por causa dos comentários (/api/comments). Sem servidor, a
// página mostra a instrução abaixo em vez de quebrar silenciosamente.
// ─────────────────────────────────────────────────────────────────────────
SNAPSHOT: null,

// ─────────────────────────────────────────────────────────────────────────
// Simbologia (idêntica ao mockup aprovado — mesmas chaves/cores/siglas)
// ─────────────────────────────────────────────────────────────────────────
STATES: {
  p:   {cls:'s-p',   letter:'Pub', name:'Concluída — Publicada'},
  cD:  {cls:'s-p',   letter:'Pro', name:'Concluída — Processada (não publica)'},
  // [2026-07-18, rodada 7] FUNDO = SÓ ESTÁGIO: os 6 estados em-progresso
  // (wu/wc/au/ac/au2/ac2) colapsaram em 2 — o atraso saiu do fundo e virou o
  // badge "Atraso" (overlay atraso/atraso_strong, canto inf. esq.). O nome
  // legível não menciona prazo: quem diz o atraso é o badge + linha SLA.
  wu:  {cls:'s-unp', letter:'Unp', name:'Em andamento — Unprocessed (aguardando processamento)'},
  wc:  {cls:'s-pro', letter:'Pro', name:'Em andamento — Processada (aguardando publicação)'},
  // '∅' (U+2205, conjunto vazio) — trocou de 'N/A' na rodada 4 da simbologia
  // (PLANNING.md §Simbologia da Matriz de Status): exclusivo do estado
  // vermelho "Faltando, vencida". [CONSOLIDADO 2026-07-24, pedido do usuário:
  // miss/miss2 viraram um único mockkey visual "miss" — o badge de Atraso já
  // avisa a severidade (1-2du vs ≥3du), não precisa de 2 fundos distintos.]
  miss:  {cls:'s-r1', letter:'∅', name:'Sem Unprocessed — prazo vencido, agir'},
  wait:  {cls:'s-g1', letter:'Agd', name:'Aguardando — no prazo, normal'},
  notcov:{cls:'s-g2', letter:'—',   name:'Não cobrado neste dia'},
},

// Ordem de prioridade (pior → melhor) usada tanto pro rank de ordenação
// (compute_sort_key, snapshot_builder.py) quanto pra exibir a legenda
// nessa mesma ordem [2026-07-24, pedido do usuário].
PRIORITY_ORDER: ['miss', 'wait', 'notcov', 'wu', 'wc', 'cD', 'p'],

// atraso/atraso_strong NÃO viram classe na célula: o badge "Atraso" é um
// <span> real (ControleCargas.atrasoBadgeHtml) porque ::before/::after já estão ocupados
// (triângulo de issues / badge Rent) e os badges precisam coexistir.
OV_CLASS: {div:'ov-dot', div_strong:'ov-div_strong', seq:'ov-seq', issue:'ov-issue',
                  atraso:'', atraso_strong:''},

/* Contexto:
   Escapa texto para inserção segura em HTML (evita XSS/quebra de marcação
   ao injetar nomes/textos vindos do snapshot ou de comentários digitados
   pelo usuário). Chamada por praticamente todo builder de HTML da tela.
   Retorna string.

   Pseudocódigo:
     1. Trata null/undefined como string vazia.
     2. Troca cada caractere especial (&<>"') pela entidade HTML correspondente. */
esc(s){ return (s==null?'':String(s)).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); },

/* Contexto:
   Escapa texto para uso dentro de um atributo HTML (ex.: data-company="...").
   Hoje é idêntico a esc() (mesmas entidades cobrem os dois casos), mantido
   como função própria para deixar explícita a intenção no HTML gerado.
   Retorna string.

   Pseudocódigo:
     1. Delega para ControleCargas.esc(). */
escAttr(s){ return ControleCargas.esc(s); },

/* Contexto:
   Formata um número para exibição em pt-BR (separador de milhar/decimal
   brasileiro), usado nos valores brutos de NAV/quantidade mostrados no
   painel de detalhe. Retorna string ("—" quando o valor é null/undefined).

   Pseudocódigo:
     1. Valor ausente -> "—".
     2. Caso contrário, formata com Number.toLocaleString('pt-BR'). */
fmtNum(v){ return v==null ? '—' : Number(v).toLocaleString('pt-BR', {maximumFractionDigits:6}); },

/* Contexto:
   Monta o HTML do badge "Atraso" (rodada 7) — espelho visual do badge Rent,
   no canto inferior esquerdo da célula; amarelo = atraso leve (1-2du),
   vermelho = elevado (≥3du). Chamada por rowHtml()/miniTimelineHtml() ao
   desenhar cada célula. Retorna string HTML (vazia quando não há atraso).

   Pseudocódigo:
     1. Sem overlays -> string vazia.
     2. Overlay 'atraso_strong' -> badge vermelho.
     3. Overlay 'atraso' -> badge amarelo.
     4. Nenhum dos dois -> string vazia. */
atrasoBadgeHtml(ovs){
  if(!ovs) return '';
  if(ovs.includes('atraso_strong')) return '<span class="atraso-badge strong" aria-hidden="true">Atras</span>';
  if(ovs.includes('atraso')) return '<span class="atraso-badge" aria-hidden="true">Atras</span>';
  return '';
},
};
