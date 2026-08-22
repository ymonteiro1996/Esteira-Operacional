/* utils/tema.js — alterna o app inteiro (6 abas) entre tema claro/escuro.
   ====================================================================
   [2026-08-21] Arquivo NOVO em static/js/utils/ (pasta criada nesta
   tarefa — CLAUDE.md §5, "funções genéricas e reutilizáveis" que não
   pertencem a uma tela específica). Não depende de nenhum objeto de tela
   (ControleCargas/ControleDemandas/Anomalias) nem é depend por eles —
   standalone de propósito, porque este <script> precisa carregar e rodar
   no <head>, ANTES desses outros scripts (que só existem no fim do
   <body>), pra aplicar o tema antes da 1ª pintura da página (sem flash de
   tema errado).

   Padrão: "Automático" (segue prefers-color-scheme do SO) até a pessoa
   escolher manualmente pelo botão "🌙 Escuro/☀️ Claro" da masthead — a
   escolha manual grava em localStorage (chave abaixo) e passa a valer
   sempre, nas 2 direções, até ser trocada de novo ou limpa (pressionar e
   segurar o botão ~0,7s volta a seguir o SO — atalho não obrigatório,
   mas trivial de manter).

   A pintura em si (cores por seletor) mora nos 3 CSS existentes
   (controle_cargas.css já tinha [data-theme=dark/light] prontos, mas sem
   nenhum JS escrevendo o atributo — ver static/css/tema_escuro.css pro
   resto). Este arquivo só manipula o atributo `data-theme` no <html> e o
   texto do botão — nenhuma cor aqui. */
const Tema = {
  CHAVE_LOCALSTORAGE: 'controlecargas.tema',

  /* Contexto:
     Lê a escolha manual salva (se houver) — usada tanto pra decidir o
     tema inicial quanto pra saber se a automação por SO deve ou não
     pisar em cima de uma escolha já feita. Retorna 'dark'/'light'/null.

     Pseudocódigo:
       1. Tenta ler a chave do localStorage (pode falhar em modo privado
          ou com storage bloqueado — nesse caso trata como "sem escolha").
       2. Só aceita os 2 valores válidos; qualquer outra coisa vira null. */
  obterTemaSalvo() {
    let valor = null;
    try {
      valor = localStorage.getItem(Tema.CHAVE_LOCALSTORAGE);
    } catch (erroDeAcessoAoStorage) {
      valor = null;
    }
    return (valor === 'dark' || valor === 'light') ? valor : null;
  },

  /* Contexto:
     Decide qual tema deve estar ativo AGORA, sem depender de nenhuma
     escolha manual ainda ter sido feita. Chamada no boot (antes da 1ª
     pintura) e sempre que a automação por SO precisa recalcular. Retorna
     'dark' ou 'light'.

     Pseudocódigo:
       1. Se existe escolha manual salva, ela sempre vence.
       2. Senão, segue matchMedia('prefers-color-scheme: dark') do SO. */
  resolverTemaAtivo() {
    const temaSalvo = Tema.obterTemaSalvo();
    if (temaSalvo) return temaSalvo;
    const soPrefereEscuro = window.matchMedia
      && window.matchMedia('(prefers-color-scheme: dark)').matches;
    return soPrefereEscuro ? 'dark' : 'light';
  },

  /* Contexto:
     Escreve o atributo `data-theme` no <html> — é isso que os 3 blocos de
     CSS ([data-theme=dark]/[data-theme=light] em controle_cargas.css e
     tema_escuro.css) leem para sobrepor o @media(prefers-color-scheme).
     Não retorna nada.

     Pseudocódigo:
       1. Seta document.documentElement.dataset.theme = tema. */
  aplicarTema(tema) {
    document.documentElement.setAttribute('data-theme', tema);
  },

  /* Contexto:
     Aplica o tema resolvido (manual salvo OU automático por SO) o quanto
     antes — chamada de imediato no fim deste arquivo (este <script> está
     no <head>, sem defer/async, então roda antes do <body> ser
     desenhado: sem isso haveria 1 frame de flash com o tema errado).
     Também é chamada de novo quando o SO muda de tema em tempo real
     (listener mais abaixo) e ao "limpar" uma escolha manual. Não retorna
     nada.

     Pseudocódigo:
       1. Resolve o tema ativo e aplica no <html>. */
  aplicarTemaInicial() {
    Tema.aplicarTema(Tema.resolverTemaAtivo());
  },

  /* Contexto:
     Grava uma escolha EXPLÍCITA de tema (chamada pelo clique no botão) —
     a partir daqui essa escolha vence a preferência do SO até ser trocada
     de novo ou limpa. Não retorna nada.

     Pseudocódigo:
       1. Salva a escolha no localStorage (best-effort).
       2. Aplica e sincroniza o texto do botão. */
  definirTemaManual(tema) {
    try {
      localStorage.setItem(Tema.CHAVE_LOCALSTORAGE, tema);
    } catch (erroDeAcessoAoStorage) {
      /* Storage bloqueado (ex. modo privado): a escolha só vale pra esta
         sessão de página — aceitável, não é motivo pra travar o toggle. */
    }
    Tema.aplicarTema(tema);
    Tema.atualizarBotao();
  },

  /* Contexto:
     Alterna entre claro/escuro a partir do que está aplicado NO MOMENTO
     (seja por causa do SO ou de uma escolha manual anterior) — chamada
     pelo clique curto no botão #btn-tema. Não retorna nada.

     Pseudocódigo:
       1. Lê o data-theme atual do <html> (com fallback pro cálculo
          automático, caso por algum motivo ainda não tenha sido setado).
       2. Grava o oposto como escolha manual explícita. */
  alternar() {
    const temaAtual = document.documentElement.getAttribute('data-theme')
      || Tema.resolverTemaAtivo();
    Tema.definirTemaManual(temaAtual === 'dark' ? 'light' : 'dark');
  },

  /* Contexto:
     Apaga a escolha manual salva e volta a seguir o SO — atalho discreto
     (pressionar e segurar o botão ~0,7s, ver wireBotao()), não obrigatório
     na v1 mas trivial de manter já que toda a lógica de "automático" já
     existe em resolverTemaAtivo(). Não retorna nada.

     Pseudocódigo:
       1. Remove a chave do localStorage (best-effort).
       2. Recalcula e aplica o tema automático; sincroniza o botão. */
  limparEscolhaManual() {
    try {
      localStorage.removeItem(Tema.CHAVE_LOCALSTORAGE);
    } catch (erroDeAcessoAoStorage) {
      /* nada a fazer — sem escolha salva de qualquer forma */
    }
    Tema.aplicarTemaInicial();
    Tema.atualizarBotao();
  },

  /* Contexto:
     Sincroniza o texto do botão #btn-tema com o tema aplicado agora — 2
     estados visíveis, sempre a partir do estado ATUAL (não guarda estado
     próprio). Chamada ao ligar os listeners e depois de qualquer troca.
     Não retorna nada.

     Pseudocódigo:
       1. Se não existe o botão nesta página, não faz nada.
       2. Tema atual = escuro -> mostra "☀️ Claro" (ação de trocar PRA
          claro); tema atual = claro -> mostra "🌙 Escuro". */
  atualizarBotao() {
    const botao = document.getElementById('btn-tema');
    if (!botao) return;
    const temaAtual = document.documentElement.getAttribute('data-theme')
      || Tema.resolverTemaAtivo();
    botao.textContent = (temaAtual === 'dark') ? '☀️ Claro' : '🌙 Escuro';
  },

  /* Contexto:
     Liga os listeners do botão de toggle da masthead — chamada 1x no
     DOMContentLoaded (o botão só existe depois do <body> ser desenhado,
     diferente do resto deste arquivo que roda no <head>). Não retorna
     nada.

     Pseudocódigo:
       1. Sincroniza o texto do botão com o tema já aplicado.
       2. Clique curto -> alternar().
       3. Pressionar e segurar (~700ms, mouse ou touch) -> limparEscolhaManual()
          em vez de alternar (o clique curto não dispara nesse caso). */
  wireBotao() {
    const botao = document.getElementById('btn-tema');
    if (!botao) return;
    Tema.atualizarBotao();
    botao.title = 'Clique: alternar tema · Pressione e segure: usar tema do sistema';

    const DURACAO_CLIQUE_LONGO_MS = 700;
    let temporizadorCliqueLongo = null;
    let disparouCliqueLongo = false;

    const iniciarPressionar = () => {
      disparouCliqueLongo = false;
      temporizadorCliqueLongo = setTimeout(() => {
        disparouCliqueLongo = true;
        Tema.limparEscolhaManual();
      }, DURACAO_CLIQUE_LONGO_MS);
    };
    const cancelarPressionar = () => {
      if (temporizadorCliqueLongo) clearTimeout(temporizadorCliqueLongo);
    };

    botao.addEventListener('mousedown', iniciarPressionar);
    botao.addEventListener('touchstart', iniciarPressionar, { passive: true });
    ['mouseup', 'mouseleave', 'touchend', 'touchcancel'].forEach((nomeEvento) => {
      botao.addEventListener(nomeEvento, cancelarPressionar);
    });
    botao.addEventListener('click', () => {
      if (disparouCliqueLongo) { disparouCliqueLongo = false; return; }
      Tema.alternar();
    });
  },
};

/* Aplica o tema o quanto antes: este <script> fica no <head>, sem
   defer/async, então roda de forma bloqueante antes do <body> ser
   desenhado — evita 1 frame de flash com o tema errado. */
Tema.aplicarTemaInicial();

/* Contexto:
   Mantém o tema em sincronia se a pessoa mudar o tema do Windows/SO COM a
   página já aberta — só quando não houver escolha manual salva (senão a
   automação atropelaria a escolha explícita da pessoa). Não retorna nada.

   Pseudocódigo:
     1. Se o navegador suporta matchMedia, escuta o evento 'change'.
     2. Só reaplica o tema automático se não houver tema salvo. */
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!Tema.obterTemaSalvo()) {
      Tema.aplicarTemaInicial();
      Tema.atualizarBotao();
    }
  });
}

/* O botão #btn-tema só existe depois do <body> ser desenhado — liga os
   listeners e sincroniza o texto quando o DOM estiver pronto. */
document.addEventListener('DOMContentLoaded', () => {
  Tema.wireBotao();
});
