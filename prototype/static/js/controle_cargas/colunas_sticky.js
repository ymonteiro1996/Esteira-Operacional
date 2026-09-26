/* ControleCargas.colunas_sticky — posição da coluna Carteira/Agrupamento fixa ao rolar.
   [2026-09-25, pedido do usuário: "Ajustar o campo instituição na matriz em Carteiras, no caso da
   XP, apareceu só o P na visualização" — CC-04]

   As duas primeiras colunas da matriz são sticky: Company em `left:0` e Carteira/Agrupamento num
   `left:96px` FIXO. Quando a Company fica mais estreita que 96px (só empresas de nome curto, ex.:
   Blue3 — 624 carteiras, 100% XP), a Carteira era empurrada até 96px mesmo sem rolar e cobria o
   começo da coluna Instituição: "XP" virava "P" (medido: Company 60px, Carteira terminando 23px
   depois do início do chip). Com nomes longos acontecia o inverso: rolar para o lado fazia a
   Carteira cobrir a Company. Agora o `left` da Carteira vem da largura REAL da Company, medida a
   cada redesenho da matriz (variável CSS `--sticky-left-nome`; 96px continua como fallback). */
Object.assign(ControleCargas, {

/* Contexto:
   Mede a coluna Company da tabela recém-desenhada e grava onde a coluna Carteira/Agrupamento deve
   grudar ao rolar. Chamada por atualizarDomEEstadoMatriz() (Carteiras e Agrupamentos) e, 1x, quando
   as fontes terminam de carregar (a largura do texto muda). Não retorna nada.

   Pseudocódigo:
     1. Sem tabela ou sem o cabeçalho da Company -> não faz nada.
     2. left = largura da Company + espaçamento horizontal entre células (border-spacing), para a
        Carteira ficar logo depois da Company quando as duas estiverem grudadas.
     3. Grava em --sticky-left-nome na própria tabela (td/th herdam). */
ajustarColunaStickyNome(table){
  const cabecalhoCompany = table && table.querySelector('th.hdr-company');
  if(!cabecalhoCompany) return;
  const espacamento = parseFloat(String(getComputedStyle(table).borderSpacing || '0').split(' ')[0]) || 0;
  const left = Math.ceil(cabecalhoCompany.getBoundingClientRect().width + espacamento);
  table.style.setProperty('--sticky-left-nome', left + 'px');
},
});

// Fontes carregadas depois do 1º desenho mudam a largura do texto da Company: remede uma vez.
if(document.fonts && document.fonts.ready){
  document.fonts.ready.then(()=>{
    document.querySelectorAll('table.matrix').forEach(t=> ControleCargas.ajustarColunaStickyNome(t));
  });
}
