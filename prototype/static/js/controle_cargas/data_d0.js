/* ControleCargas.data_d0 — campo "Data D0" da toolbar.
   [2026-09-25, pedido do usuário: "Criar um Campo Data D0 que começa como Default hoje, e ao ser
   mudado altera todo D0 que a Ferramenta utiliza" — CC-01]

   O "hoje" da ferramenta (atraso, Pauta, rótulos D-n, SLA, janela padrão, vigência de comentário)
   vinha do relógio. Agora vem de `ControleCargas.d0Atual()`: o campo `#data-d0`, que abre SEMPRE
   em hoje e não é salvo entre recargas (D10). O cálculo continua no SERVIDOR (calendário ANBIMA):
   a tela manda `d0` em /api/atualizar, /api/janela-padrao, /api/carteiras-nao-cadastradas e no
   POST de comentários. Trocar o D0 recalcula De/Até mas NÃO roda o Atualizar sozinho (D10).

   Limitação (avisada na faixa "D0 simulado"): a API devolve o estado ATUAL, sem histórico — um D0
   no passado reavalia o SLA com os dados de hoje (carga que chegou atrasada aparece presente). */
Object.assign(ControleCargas, {

/* Contexto: o D0 em vigor (AAAA-MM-DD). Usado por atualizar.js, comentarios.js e a aba Carteiras
   Não Cadastradas. Retorna string.
   Pseudocódigo: 1. Campo/estado preenchido -> ele. 2. Senão, hoje (relógio local). */
d0Atual(){
  return (ControleCargas.state && ControleCargas.state.d0) || UtilsDatas.hojeISO();
},

/* Contexto: mostra/esconde a faixa "D0 simulado" conforme o D0 difere de hoje. Não retorna nada.
   Pseudocódigo: 1. D0 == hoje -> esconde. 2. Senão mostra dd/mm + o aviso da limitação. */
atualizarFaixaD0(){
  const faixa = document.getElementById('d0-simulado');
  if(!faixa) return;
  const d0 = ControleCargas.d0Atual();
  const simulado = d0 !== UtilsDatas.hojeISO();
  faixa.hidden = !simulado;
  if(simulado){
    const [a, m, d] = d0.split('-');
    faixa.textContent = `D0 simulado: ${d}/${m}/${a} — a API devolve o estado ATUAL (sem histórico): `
      + 'uma carga que chegou atrasada aparece como presente. Clique em Atualizar para aplicar.';
  }
},

/* Contexto: liga o campo #data-d0 — chamada 1x no fim deste arquivo. Não retorna nada.
   Pseudocódigo:
     1. Nasce em hoje (nunca restaura valor antigo — D10).
     2. Ao mudar: guarda em state.d0 (vazio volta a hoje), atualiza a faixa e REESCREVE De/Até
        com a janela padrão do D0 (/api/janela-padrao?d0=) — sem rodar o Atualizar. Resposta de
        um D0 que já mudou de novo é ignorada (achado no teste: o preenchimento do carregamento,
        feito com o D0 de hoje, chegava depois e sobrescrevia o "até"). */
wireDataD0(){
  const campo = document.getElementById('data-d0');
  const hoje = UtilsDatas.hojeISO();
  ControleCargas.state.d0 = hoje;
  if(!campo) return;
  campo.value = hoje;
  campo.addEventListener('change', ()=>{
    if(!campo.value) campo.value = UtilsDatas.hojeISO();
    ControleCargas.state.d0 = campo.value;
    ControleCargas.atualizarFaixaD0();
    const de = document.getElementById('data-inicial'), ate = document.getElementById('data-final');
    const d0Pedido = campo.value;
    fetch(`/api/janela-padrao?d0=${encodeURIComponent(d0Pedido)}`)
      .then(r=>{ if(!r.ok) throw new Error('http '+r.status); return r.json(); })
      .then(({dataInicial, dataFinal})=>{
        if(ControleCargas.d0Atual() !== d0Pedido) return;   // o D0 mudou de novo nesse meio tempo
        if(de) de.value = dataInicial;
        if(ate) ate.value = dataFinal;
      })
      .catch(()=>{});
  });
  ControleCargas.atualizarFaixaD0();
},
});

ControleCargas.wireDataD0();
