/* ControleCargas.diagnostico — rodapé "de onde vêm os dados compartilhados".
   ====================================================================
   [2026-09-22, relato do usuário: "um colega ainda não está aparecendo o
   responsável e comentários, mesmo que são gravados e consumidos em uma base
   na rede onedrive" — com o colega na MESMA data de referência (16/09) da
   máquina onde aparece]

   O que este arquivo resolve: quando o Responsável/Comentário não aparece pra
   uma pessoa e aparece pra outra, as causas possíveis são sempre as mesmas
   três, e NENHUMA delas dava sinal na tela — o app subia normal, a grade
   funcionava, e a coluna simplesmente vinha vazia:
     1. a máquina está lendo uma pasta `data/` LOCAL (ilha) em vez da pasta do
        time — o caminho do OneDrive muda de nome entre máquinas (idioma,
        OneDrive pessoal, pasta renomeada; ver utils/caminhos.py);
     2. o OneDrive daquela máquina ainda não baixou a versão nova do arquivo;
     3. a pessoa está rodando uma CÓPIA VELHA do código (ex.: a que mora dentro
        do próprio OneDrive), que não tem as correções mais recentes.
   O rodapé mostra os três de uma vez: pasta dos dados (e se é a compartilhada),
   quando o arquivo de anotações foi gravado pela última vez, quantas anotações
   vieram dele — inclusive quantas valem pra data de referência EM TELA, que é
   o número que explica uma coluna vazia — e a pasta de onde o código subiu.

   Parte do objeto único ControleCargas (ver state.js) — 1 arquivo por
   funcionalidade (CLAUDE.md §4). */
Object.assign(ControleCargas, {

// De quanto em quanto tempo reconsultar o servidor (mtime/contagens do disco).
// Folgado: é só pra flagrar o OneDrive tendo sincronizado no meio do dia.
INTERVALO_DIAGNOSTICO_MS: 300000,

// Redesenho só com o que já está em memória (sem rede) — segue a data de
// referência quando um "Atualizar" troca o snapshot e as anotações que o
// sincronizacao.js traz do colega, sem precisar ligar handler em nenhuma das
// duas funções.
INTERVALO_RESUMO_LOCAL_MS: 10000,

// Última resposta de /api/diagnostico-dados (null antes da 1ª). Guardada pra
// o redesenho local não depender de rede.
diagnosticoDados: null,

/* Contexto:
   Busca o diagnóstico no servidor (GET /api/diagnostico-dados) e manda
   redesenhar o rodapé. Chamada no bootstrap deste arquivo e a cada
   INTERVALO_DIAGNOSTICO_MS. Retorna Promise (sempre resolvida — o rodapé é
   informativo, nunca pode virar erro na tela).

   Pseudocódigo:
     1. fetch da rota; resposta não-ok vira erro.
     2. Guarda o payload em diagnosticoDados e redesenha.
     3. Em falha, deixa a mensagem de indisponível (sem quebrar a tela). */
carregarDiagnosticoDados(){
  return fetch('/api/diagnostico-dados')
    .then(r=>{ if(!r.ok) throw new Error('http '+r.status); return r.json(); })
    .then(dados=>{
      ControleCargas.diagnosticoDados = dados;
      ControleCargas.renderizarRodapeDiagnostico();
    })
    .catch(()=>{
      const texto = document.getElementById('diagnostico-texto');
      if(texto && !ControleCargas.diagnosticoDados){
        texto.textContent = 'Não foi possível verificar de onde vêm os dados compartilhados (servidor não respondeu).';
      }
    });
},

/* Contexto:
   Formata "2026-09-22T14:47:53" como "22/09 14:47" — usado só no rodapé, pra
   mostrar quando o arquivo compartilhado foi gravado pela última vez. Retorna
   string ('—' quando não há data).

   Pseudocódigo:
     1. Sem valor, devolve '—'.
     2. Recorta dia/mês e hora/minuto direto da string ISO (é hora local do
        servidor, que aqui é a própria máquina — não precisa de Date). */
formatarMomentoArquivo(iso){
  if(!iso) return '—';
  const [data, hora] = String(iso).split('T');
  const [ano, mes, dia] = (data || '').split('-');
  if(!dia) return iso;
  return `${dia}/${mes} ${(hora || '').slice(0,5)}`;
},

/* Contexto:
   Conta quantas anotações carregadas valem para a data de referência que está
   EM TELA — o número que explica uma coluna "Responsável" vazia sem que nada
   esteja quebrado (a anotação é gravada por data de referência: a de 16/09 não
   aparece em 17/09). Chamada por renderizarRodapeDiagnostico(). Retorna
   {referenceDate, quantidade}.

   Pseudocódigo:
     1. Lê a data de referência do snapshot em tela (vazio antes do 1º
        Atualizar).
     2. Conta as chaves de ANNOTATIONS que terminam em "|<data>" (mesmo
        formato de chaveAnotacao, anotacoes.js).
     3. Só conta as que têm responsável ou comentário preenchido — chave com
        os dois campos vazios é anotação apagada, não conta como conteúdo. */
resumirAnotacoesDaDataEmTela(){
  const meta = (ControleCargas.SNAPSHOT || {}).meta || {};
  const referenceDate = meta.referenceDate || '';
  const anotacoes = ControleCargas.ANNOTATIONS || {};
  if(!referenceDate) return { referenceDate, quantidade: 0 };

  const sufixo = `|${referenceDate}`;
  const quantidade = Object.keys(anotacoes).filter(chave=>{
    if(!chave.endsWith(sufixo)) return false;
    const registro = anotacoes[chave] || {};
    return Boolean((registro.responsavel || '').trim() || (registro.comentarioAtuacao || '').trim());
  }).length;
  return { referenceDate, quantidade };
},

/* Contexto:
   Monta a frase sobre a PASTA dos dados (a parte que muda de máquina pra
   máquina e é a causa nº 1 de "não aparece pra mim"). Chamada por
   renderizarRodapeDiagnostico(). Retorna string.

   Pseudocódigo:
     1. Pasta compartilhada encontrada -> diz isso e mostra o caminho.
     2. Pasta local (ilha) -> avisa explicitamente que o dado NÃO é o do time.
     3. Acrescenta a origem "por busca" quando o caminho desta máquina não é o
        padrão (bom sinal de que a resolução automática entrou em ação). */
descreverPastaDados(dados){
  if(!dados.compartilhada){
    return `⚠ Dados NÃO compartilhados — lendo a cópia local ${dados.caminho}. `
         + 'O que você gravar aqui não chega ao time, e o que o time gravou não aparece.';
  }
  const comoAchou = dados.origem === 'variavel' ? ' (via CONTROLECARGAS_DATA_DIR)'
                  : dados.origem === 'onedrive_variante' ? ' (encontrada por busca)'
                  : '';
  return `Dados do time${comoAchou}: ${dados.caminho}`;
},

/* Contexto:
   Redesenha o rodapé com o último diagnóstico do servidor + o que está em
   memória agora (data de referência em tela e anotações dela). Chamada depois
   de cada carregarDiagnosticoDados() e a cada INTERVALO_RESUMO_LOCAL_MS. Não
   retorna nada.

   Pseudocódigo:
     1. Sem o elemento no DOM ou sem diagnóstico ainda, não faz nada.
     2. Marca o rodapé como alerta quando a pasta não é a compartilhada.
     3. Monta as partes: pasta dos dados · gravação mais recente do arquivo de
        anotações · contagens carregadas · quantas valem na data em tela ·
        pasta do código.
     4. Escreve tudo separado por "·". */
renderizarRodapeDiagnostico(){
  const rodape = document.getElementById('diagnostico-rodape');
  const texto = document.getElementById('diagnostico-texto');
  const diagnostico = ControleCargas.diagnosticoDados;
  if(!rodape || !texto || !diagnostico) return;

  const dados = diagnostico.dados || {};
  const arquivos = diagnostico.arquivos || {};
  const contagens = diagnostico.contagens || {};
  const anotacoesArquivo = arquivos.walletAnnotations || {};
  const daData = ControleCargas.resumirAnotacoesDaDataEmTela();

  rodape.classList.toggle('alerta', dados.compartilhada === false);

  const partes = [ControleCargas.descreverPastaDados(dados)];
  partes.push(`anotações gravadas por último em ${ControleCargas.formatarMomentoArquivo(anotacoesArquivo.atualizadoEm)}`);
  partes.push(`carregados: ${contagens.comentarios || 0} comentário(s), ${contagens.anotacoes || 0} anotação(ões)`);
  partes.push(daData.referenceDate
    ? `${daData.quantidade} anotação(ões) na data de referência em tela (${daData.referenceDate})`
    : 'nenhuma data de referência em tela ainda — clique em Atualizar');
  partes.push(`código rodando de ${(diagnostico.codigo || {}).caminho || '—'}`);
  texto.textContent = partes.join(' · ');
},

/* Contexto:
   Liga o rodapé: 1 consulta ao servidor agora, uma reconsulta folgada (5 min,
   pra pegar o OneDrive sincronizando no meio do dia) e um redesenho local
   frequente (10s, sem rede) que faz o rodapé acompanhar a data de referência
   quando um "Atualizar" troca o snapshot. Chamada 1x no fim deste arquivo.
   Não retorna nada.

   Pseudocódigo:
     1. Busca o diagnóstico agora.
     2. Agenda a reconsulta (rede) e o redesenho local (sem rede). */
iniciarRodapeDiagnostico(){
  ControleCargas.carregarDiagnosticoDados();
  setInterval(ControleCargas.carregarDiagnosticoDados, ControleCargas.INTERVALO_DIAGNOSTICO_MS);
  setInterval(ControleCargas.renderizarRodapeDiagnostico, ControleCargas.INTERVALO_RESUMO_LOCAL_MS);
},

});

// ─────────────────────────────────────────────────────────────────────────
// Bootstrap: o rodapé não depende do snapshot nem do token — pode subir assim
// que o arquivo carrega (mesmo padrão das chamadas soltas no fim de
// beehus_token.js/index.js).
// ─────────────────────────────────────────────────────────────────────────
ControleCargas.iniciarRodapeDiagnostico();
