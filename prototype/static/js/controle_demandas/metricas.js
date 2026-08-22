/* ControleDemandas.metricas — barra de métricas do quadro (total/concluídas/andamento/pendentes/on-hold/atrasadas/progresso médio).
   Object.assign(ControleDemandas, {...}) — CLAUDE.md §4. */
Object.assign(ControleDemandas, {

  /* Contexto:
     Recalcula e desenha a barra de métricas a partir de TODAS as demandas
     carregadas (não só as visíveis pelo filtro "mostrar concluídos" —
     senão o total oscilaria só por causa desse toggle, mesma regra de
     renderMetrics() na origem). Chamada por renderizarQuadro() e por
     ajustarProgresso() (atualização otimista). Não retorna nada.

     Pseudocódigo:
       1. Conta total/concluídas/em-andamento/pendentes/on-hold/atrasadas.
       2. Calcula o progresso médio (0 se não houver nenhuma demanda).
       3. Desenha os chips (mesmos rótulos/emojis da origem). */
  renderizarMetricas(demandas) {
    const total = demandas.length;
    const concluidas = demandas.filter(d => d.status === 'Concluído').length;
    const emAndamento = demandas.filter(d => d.status === 'Em Andamento').length;
    const pendentes = demandas.filter(d => d.status === 'Pendente').length;
    const onHold = demandas.filter(d => d.status === 'On Hold').length;
    const atrasadas = demandas.filter(d => this.estaAtrasada(d)).length;
    const progressoMedio = total
      ? Math.round(demandas.reduce((soma, d) => soma + (parseInt(d.progress, 10) || 0), 0) / total)
      : 0;

    document.getElementById('kd-metrics').innerHTML = `
      <span class="kd-met-chip">📋 <b>${total}</b> total</span>
      <span class="kd-met-chip done">✅ <b>${concluidas}</b> concluídas</span>
      <span class="kd-met-chip active">▶ <b>${emAndamento}</b> em andamento</span>
      <span class="kd-met-chip pend">⏳ <b>${pendentes}</b> pendentes</span>
      ${onHold ? `<span class="kd-met-chip hold">⏸ <b>${onHold}</b> on hold</span>` : ''}
      ${atrasadas
        ? `<span class="kd-met-chip late">⚠️ <b>${atrasadas}</b> atrasadas</span>`
        : `<span class="kd-met-chip ok">✓ sem atrasos</span>`}
      <span class="kd-met-chip progresso">📈 progresso médio <b>${progressoMedio}%</b></span>
    `;
  },
});
