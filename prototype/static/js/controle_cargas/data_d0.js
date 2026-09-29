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

/* Contexto: linha de aviso + campo D0 pintado quando a data olhada não é o D0 de hoje. Chamada ao
   mudar o campo e sempre que chega um snapshot (index.js / atualizar.js). Não retorna nada.
   [2026-09-29, pedido do usuário: "deixar um alerta, uma linha de aviso que a data olhada não é D0
   quando mudarmos a data D0, e pintar o campo da data D0 que mudamos também"] A faixa discreta
   "D0 simulado" virou aviso amarelo com ⚠, diz também se a TELA já está calculada com esse D0 (o
   snapshot guarda o D0 em meta.today) e traz o botão "Voltar para hoje".

   Pseudocódigo:
     1. alterado = D0 do campo != hoje -> pinta o campo (classe d0-alterado).
     2. tela = meta.today do snapshot; atrasada = snapshot com D0 diferente do campo.
     3. Nem alterado nem atrasada -> esconde a faixa.
     4. Senão monta: "D0 alterado: dd/mm (hoje é dd/mm)" e/ou "a tela mostra o D0 dd/mm — clique em
        Atualizar"; com D0 no passado, a limitação da API. */
atualizarFaixaD0(){
  const faixa = document.getElementById('d0-simulado');
  const campo = document.getElementById('data-d0');
  const d0 = ControleCargas.d0Atual();
  const hoje = UtilsDatas.hojeISO();
  const alterado = d0 !== hoje;
  if(campo){
    campo.classList.toggle('d0-alterado', alterado);
    const rotulo = campo.closest('label');
    if(rotulo) rotulo.classList.toggle('d0-alterado-rotulo', alterado);
  }
  if(!faixa) return;
  const meta = ControleCargas.SNAPSHOT && ControleCargas.SNAPSHOT.meta;
  const tela = meta && meta.today;
  const atrasada = !!tela && tela !== d0;
  faixa.hidden = !alterado && !atrasada;
  if(faixa.hidden) return;
  const br = (iso)=>{ const [a, m, d] = iso.split('-'); return `${d}/${m}/${a}`; };
  const partes = [];
  if(alterado) partes.push(`<b>D0 alterado: ${br(d0)}</b> (hoje é ${br(hoje)}) — a data olhada não é o D0 de hoje.`);
  if(atrasada) partes.push(`A tela ainda mostra o D0 ${br(tela)}: clique em <b>Atualizar</b> para aplicar${alterado ? '' : ' o D0 de hoje'}.`);
  else if(alterado) partes.push('A tela já está calculada com esse D0.');
  if(alterado && d0 < hoje) partes.push('A API devolve o estado ATUAL (sem histórico): uma carga que chegou atrasada aparece como presente.');
  faixa.innerHTML = `<span class="d0-simulado-icone" aria-hidden="true">⚠</span> <span>${partes.join(' ')}</span>`
    + (alterado ? ' <button type="button" class="d0-voltar-hoje" id="d0-voltar-hoje">Voltar para hoje</button>' : '');
  const voltar = document.getElementById('d0-voltar-hoje');
  if(voltar && campo) voltar.addEventListener('click', ()=>{
    campo.value = UtilsDatas.hojeISO();
    campo.dispatchEvent(new Event('change'));
  });
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
