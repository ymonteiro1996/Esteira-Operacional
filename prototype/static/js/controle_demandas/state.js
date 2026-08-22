/* ControleDemandas.state — estado global da aba Kanban (Controle de Demandas) + vocabulário visual.
   Objeto PRÓPRIO (não estende ControleCargas, não importa nada de
   static/js/controle_cargas/): esta tela não depende de snapshot.json/
   token Beehus — dado 100% local (data/controle_demandas.json, servido por
   pages/controle_demandas.py). Padrão "sem build" do CLAUDE.md §4:
   state.js declara o objeto único; os arquivos seguintes acrescentam
   métodos via Object.assign(ControleDemandas, {...}).

   [2026-08-21, porte de beehus-rotinas/templates/controle_demandas.html]
   O vocabulário de cor abaixo (CLIENT_CLS/STATUS_CLS/TIPO_CLS/PRIO_CLS/
   AVATAR_COLORS) é uma tradução DIRETA do <script> da origem — inclusive
   as mesmas 9 chaves de cliente (sem "Eté", que não existia na origem) e
   o mesmo fallback pra "cl-beehus" quando o nome não bate (isso é
   propositalmente idêntico ao comportamento antigo: no dado real "Eté" e
   "SMig" caem no fallback ambar porque a origem também não tinha essas
   chaves exatas — preservado por fidelidade ao invés de "corrigido"
   silenciosamente, já que o pedido foi portar "do jeito que está"). */
const ControleDemandas = {
  // ── Estado ────────────────────────────────────────────────────────────
  demandas: [],           // última lista carregada da API
  mapaPorId: {},           // _id -> demanda (lookup rápido pra editar/comentar/excluir/arrastar)
  opcoes: { clientes: [], responsaveis: [], status: [], prioridades: [], tipos: [] },
  colunas: [],             // responsáveis visíveis como coluna (persistido em localStorage)
  idEmEdicaoComentarios: null,
  idParaExcluir: null,
  _debounceBusca: null,
  _idArrastado: null,

  LS_CHAVE_COLUNAS: 'controle_demandas_colunas_v1',

  // ── Vocabulário visual — tradução 1:1 do <script> da origem ─────────────
  CLIENT_CLS: {
    'Mira':'kd-cl-mira', 'SMIG':'kd-cl-smig', 'Fincere':'kd-cl-fincere',
    'Blue3':'kd-cl-blue3', 'Blue3 Wealth':'kd-cl-blue3wealth', 'Oikos':'kd-cl-oikos',
    'Next Wealth':'kd-cl-nextwealth', 'RTS':'kd-cl-rts', 'Beehus':'kd-cl-beehus',
  },
  STATUS_CLS: {
    'Pendente':'kd-st-pendente', 'Em Andamento':'kd-st-em-andamento',
    'Concluído':'kd-st-concluido', 'Cancelado':'kd-st-cancelado', 'On Hold':'kd-st-on-hold',
  },
  TIPO_CLS: {
    'Operacional':'kd-tp-operacional', 'Sistema':'kd-tp-sistema',
    'Sistema Operacional':'kd-tp-sistemaoperacional',
  },
  PRIO_CLS: { 'Alto':'kd-prio-alto', 'Médio':'kd-prio-medio', 'Baixo':'kd-prio-baixo' },
  PRIO_DOT: { 'Alto':'kd-dot-alto', 'Médio':'kd-dot-medio', 'Baixo':'kd-dot-baixo' },

  AVATAR_COLORS: [
    '#1d4ed8','#7c3aed','#db2777','#059669','#d97706',
    '#0891b2','#4338ca','#dc2626','#15803d','#b45309',
  ],

  /* Contexto:
     Escolhe uma cor de avatar determinística pra um responsável — mesmo
     nome sempre cai na mesma cor (hash puro, sem estado, sem depender de
     data/demandas_config.json ter uma cor cadastrada). Chamada pelo
     cabeçalho de coluna e pelo menu de colunas ocultas. Retorna string
     hex.

     Pseudocódigo:
       1. Soma os charCodes do nome num hash simples.
       2. Usa o resto da divisão por AVATAR_COLORS.length como índice. */
  corAvatar(nome) {
    let hash = 0;
    for (let i = 0; i < nome.length; i++) hash = nome.charCodeAt(i) + ((hash << 5) - hash);
    return this.AVATAR_COLORS[Math.abs(hash) % this.AVATAR_COLORS.length];
  },

  /* Contexto:
     Extrai as iniciais (até 2 letras) de um responsável para o avatar da
     coluna — separa por espaço ou "/", pra responsáveis compostos tipo
     "Yuri/Hulgo" virarem "YH" (mesmo critério da origem). Retorna string
     maiúscula. */
  iniciais(nome) {
    return (nome || '?').split(/[\s/]/).filter(Boolean).map(p => p[0]).slice(0, 2).join('').toUpperCase();
  },

  /* Contexto:
     Escapa texto para inserção segura em HTML — mesmo princípio de
     esc()/escHtml() usado em toda a origem. Chamada por praticamente todo
     builder de HTML deste módulo. Retorna string.

     Pseudocódigo:
       1. Trata null/undefined como string vazia.
       2. Troca cada caractere especial (&<>"') pela entidade HTML. */
  esc(s) {
    return (s == null ? '' : String(s)).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  },

  /* Contexto:
     Formata um timestamp ISO ("YYYY-MM-DDTHH:MM:SS") para exibição em
     pt-BR — usado nos comentários. Os registros migrados da origem (80
     demandas) estão em UTC sem timezone (bug antigo, documentado em
     pages/controle_demandas.py, não corrigido retroativamente); os novos
     usam hora local do servidor. Retorna string. */
  formatarData(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('pt-BR', {day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'});
  },
};
