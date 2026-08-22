/* Anomalias.state — estado global da aba "Anomalias" + vocabulário visual.
   Objeto PRÓPRIO (não estende ControleCargas/ControleDemandas, não
   importa nada de static/js/controle_cargas/ nem static/js/
   controle_demandas/): esta tela não depende de snapshot.json/token
   Beehus — dado 100% local (data/anomalias.json, servido por
   pages/anomalias.py). Padrão "sem build" do CLAUDE.md §4: state.js
   declara o objeto único; os arquivos seguintes acrescentam métodos via
   Object.assign(Anomalias, {...}).

   [2026-08-21] Vocabulário de cor de status/cliente é uma tradução DIRETA
   da mesma paleta de static/js/controle_demandas/state.js (mesma família
   visual, pedido do usuário) — só que com prefixo "an-" (nunca colide com
   "kd-") e com "Eté"/"SMig" corrigidos (chaves exatas de
   data/demandas_config.json; a aba Demandas preserva por fidelidade um
   fallback antigo pra esses 2 clientes, mas esta tela é código novo, sem
   motivo pra repetir aquele detalhe). Criticidade (Crítico/Atenção/
   Observação) é o vocabulário NOVO desta tela — não existe em Demandas.

   [2026-08-22, Onda 2 do plano de melhorias] `opcoes.aging_thresholds`/
   `opcoes.tags_sugeridas` vêm de data/anomalias_config.json (via GET
   /api/anomalias/opcoes, pages/anomalias.py::_carregar_config_anomalias)
   — config ajustável, não hardcoded aqui. `_tagsForm` é o estado
   transitório das tags sendo editadas no modal Nova/Editar Anomalia
   (array simples, sincronizado com os chips visuais antes de ir pro
   payload de enviarFormulario(), ver modais.js). */
const Anomalias = {
  // ── Estado ────────────────────────────────────────────────────────────
  anomalias: [],          // última lista carregada da API
  mapaPorId: {},           // id -> anomalia (lookup rápido pra editar/comentar/excluir/arrastar)
  mapaDemandasPorId: {},   // _id de demanda -> demanda (status atual, pra badges de vínculo) — 1 fetch geral, não por card
  opcoes: {
    clientes: [], responsaveis: [], criticidades: [], status: [], criticidade_para_prioridade: {},
    aging_thresholds: {}, tags_sugeridas: [],
  },
  opcoesDemandas: { clientes: [], responsaveis: [], status: [], prioridades: [], tipos: [] },
  idEmEdicaoComentarios: null,
  idParaExcluir: null,
  idEmVinculacao: null,      // anomalia sendo editada quando o modal de vincular é aberto
  horizonteEmVinculacao: null, // 'curto_prazo' | 'longo_prazo'
  _debounceBusca: null,
  _debounceBuscaVinculo: null,
  _idArrastado: null,
  _tagsForm: [],             // tags sendo editadas no modal Nova/Editar Anomalia (Onda 2)

  // ── Vocabulário visual ───────────────────────────────────────────────────
  CRITICIDADE_CLS: { 'Crítico': 'an-crit-critico', 'Atenção': 'an-crit-atencao', 'Observação': 'an-crit-observacao' },
  STATUS_CLS: {
    'Pendente': 'an-st-pendente', 'Em Andamento': 'an-st-em-andamento',
    'Concluído': 'an-st-concluido', 'Cancelado': 'an-st-cancelado', 'On Hold': 'an-st-on-hold',
  },
  CLIENT_CLS: {
    'Mira': 'an-cl-mira', 'SMig': 'an-cl-smig', 'Fincere': 'an-cl-fincere',
    'Blue3': 'an-cl-blue3', 'Blue3 Wealth': 'an-cl-blue3wealth', 'Eté': 'an-cl-ete',
    'Oikos': 'an-cl-oikos', 'Next Wealth': 'an-cl-nextwealth', 'RTS': 'an-cl-rts', 'Beehus': 'an-cl-beehus',
  },
  HORIZONTE_LABEL: { 'curto_prazo': 'Curto prazo', 'longo_prazo': 'Longo prazo' },

  AVATAR_COLORS: [
    '#1d4ed8', '#7c3aed', '#db2777', '#059669', '#d97706',
    '#0891b2', '#4338ca', '#dc2626', '#15803d', '#b45309',
  ],

  /* Contexto:
     Escolhe uma cor de avatar determinística pra um responsável — mesmo
     nome sempre cai na mesma cor (hash puro, sem estado). Tradução de
     ControleDemandas.corAvatar(). Retorna string hex. */
  corAvatar(nome) {
    let hash = 0;
    for (let i = 0; i < nome.length; i++) hash = nome.charCodeAt(i) + ((hash << 5) - hash);
    return this.AVATAR_COLORS[Math.abs(hash) % this.AVATAR_COLORS.length];
  },

  /* Contexto:
     Extrai as iniciais (até 2 letras) de um responsável — separa por
     espaço ou "/", pra responsáveis compostos tipo "Yuri/Hulgo" virarem
     "YH". Tradução de ControleDemandas.iniciais(). Retorna string
     maiúscula. */
  iniciais(nome) {
    return (nome || '?').split(/[\s/]/).filter(Boolean).map(p => p[0]).slice(0, 2).join('').toUpperCase();
  },

  /* Contexto:
     Escapa texto para inserção segura em HTML — usada por praticamente
     todo builder de HTML deste módulo. Retorna string. */
  esc(s) {
    return (s == null ? '' : String(s)).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  /* Contexto:
     Formata um timestamp ISO ("YYYY-MM-DDTHH:MM:SS") para exibição em
     pt-BR — usado nos comentários e nas datas de vínculo. Retorna
     string. */
  formatarData(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  },

  /* Contexto:
     Trunca um texto para exibição compacta (badges/listas de resultado de
     busca) — evita cartão/linha crescendo demais com descrições longas.
     Retorna string (com "…" se cortou). */
  truncar(texto, tamanho) {
    const t = texto || '';
    return t.length > tamanho ? t.slice(0, tamanho).trimEnd() + '…' : t;
  },

  // ── Aging / cartão órfão (melhorias 1 e 2, Onda 1) ──────────────────────

  /* Contexto:
     Calcula há quantos dias a anomalia está aberta — usa "ocorrido_em"
     (data real do problema, Onda 2) quando presente, caindo para
     "created_at" quando ausente (anomalias criadas antes da Onda 2, ou
     enquanto só a Onda 1 estava implementada). Chamada por
     resolverFaixaAging()/calcularRecorrencia(). Retorna número inteiro
     (dias completos, nunca negativo). */
  calcularIdadeEmDias(anomalia) {
    const dataBase = anomalia.ocorrido_em || anomalia.created_at;
    if (!dataBase) return 0;
    const diffMs = Date.now() - new Date(dataBase).getTime();
    return Math.max(0, Math.floor(diffMs / 86400000));
  },

  /* Contexto:
     Formata a idade em dias para o badge do cartão — dias corridos até
     13 ("há Nd"), semanas cheias a partir de 14 ("há Nsem"). Chamada por
     resolverFaixaAging(). Retorna string. */
  formatarIdade(dias) {
    if (dias < 14) return `há ${dias}d`;
    return `há ${Math.floor(dias / 7)}sem`;
  },

  /* Contexto:
     Resolve a faixa de aging (verde/âmbar/vermelho) de 1 anomalia,
     conforme os limiares configuráveis por criticidade
     (opcoes.aging_thresholds, data/anomalias_config.json) — melhoria 1.
     Criticidade fora do enum (não deveria acontecer) cai nos limiares de
     "Observação" (os mais folgados), por segurança. Chamada por
     construirCartao() (cartoes.js). Retorna {classe, texto, dias}. */
  resolverFaixaAging(anomalia) {
    const dias = this.calcularIdadeEmDias(anomalia);
    const limiares = this.opcoes.aging_thresholds[anomalia.criticidade]
      || this.opcoes.aging_thresholds['Observação']
      || { verde: 21, ambar: 45 };
    let classe = 'an-aging-vermelho';
    if (dias <= limiares.verde) classe = 'an-aging-verde';
    else if (dias <= limiares.ambar) classe = 'an-aging-ambar';
    return { classe, texto: this.formatarIdade(dias), dias };
  },

  /* Contexto:
     Uma anomalia é "órfã" quando é Crítico/Atenção e ainda não tem
     NENHUMA demanda vinculada — sinal de risco operacional (melhoria 2,
     regra clássica de postmortem: "sem item de ação = postmortem
     inútil"). "Observação" nunca é órfã (criticidade baixa não exige
     encaminhamento formal). Chamada por construirCartao(). Retorna
     boolean. */
  ehAnomaliaOrfa(anomalia) {
    const ehCriticaOuAtencao = anomalia.criticidade === 'Crítico' || anomalia.criticidade === 'Atenção';
    return ehCriticaOuAtencao && !(anomalia.demandas_vinculadas || []).length;
  },
};
