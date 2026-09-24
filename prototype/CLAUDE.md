# Instruções de Desenvolvimento — Beehus SWAT

> Este projeto é desenvolvido **sempre com o auxílio do Claude**, por um time que nem
> sempre tem base em programação. Por isso estas instruções são **obrigatórias** e têm
> prioridade sobre qualquer padrão default. O objetivo é manter o código **saudável,
> legível e fácil de manter em equipe**, evitando os problemas atuais: arquivos gigantes,
> funcionalidades empilhadas na mesma página e conflitos de merge constantes.
>
> **Regra número 1 (leia antes de tudo):** se um requisito futuro exigir quebrar qualquer
> padrão de arquitetura descrito aqui, **NÃO implemente direto. Pare e confirme com o
> desenvolvedor primeiro**, explicando o que seria quebrado e por quê. Ver seção
> [Quebra de arquitetura](#7-quebra-de-arquitetura-confirmar-sempre-antes).
>
> **⛔ Regra número 2 (CRÍTICA — dados): o Claude NÃO está autorizado a alterar nada no
> MongoDB por acesso direto.** O acesso direto ao Mongo é permitido **apenas para LEITURA,
> e somente como fallback**. **Qualquer alteração de dados (criar, editar ou remover) deve
> ser feita exclusivamente pelas rotas homologadas da API Beehus.** Nunca escreva direto
> no banco. Ver seção [Acesso a dados](#8-acesso-a-dados--api-first-mongo-é-somente-leitura).

---

## 1. Nomenclatura de variáveis e funções

- **Sempre `snake_case`** para variáveis, funções e nomes de arquivos Python.
  (`total_liquido`, `calcular_nav`, `carteira_selecionada` — nunca `totalLiquido`,
  `calcNav`, `x`, `tmp`, `aux`, `data2`.)
- **Nomes representativos e por extenso.** O nome deve dizer o que a coisa é ou faz,
  sem precisar de comentário para explicar. Prefira clareza a brevidade.
- Evite abreviações obscuras. `qtd`, `pu`, `nav` são aceitáveis por serem termos de
  domínio já consolidados no projeto; `q`, `p`, `n` não são.
- Constantes em `MAIÚSCULO_COM_UNDERSCORE` (`DATA_BASE_PADRAO`, `LIMITE_LINHAS`).
- Booleanos com prefixo que revele intenção: `is_`, `has_`, `deve_`, `tem_`
  (`is_carteira_valida`, `tem_provisao`, `deve_recalcular`).

```python
# RUIM
def calc(d, w):
    r = []
    for x in d:
        if x['w'] == w: r.append(x)
    return r

# BOM
def filtrar_posicoes_por_carteira(posicoes, carteira_id):
    posicoes_da_carteira = []
    for posicao in posicoes:
        if posicao["carteira_id"] == carteira_id:
            posicoes_da_carteira.append(posicao)
    return posicoes_da_carteira
```

> Em JavaScript dentro dos templates, siga a convenção nativa da linguagem
> (`camelCase` para variáveis/funções), mas mantenha o mesmo rigor: nomes
> representativos e por extenso.

---

## 2. Comentário obrigatório acima de TODA função

Toda função — Python ou JavaScript — deve ter, imediatamente acima dela, um comentário
no formato **"contexto + pseudocódigo claro"**:

1. **Contexto:** 1–2 frases dizendo *para que serve* a função, *quando* é chamada e
   *o que ela retorna*. (O "porquê", não o "como".)
2. **Pseudocódigo claro:** os passos principais da função em linguagem simples,
   numerados, para que qualquer pessoa entenda a lógica sem ler a implementação.

Em Python, use **docstring** (padrão do projeto). Em JavaScript, use bloco `/* */`.

```python
def calcular_nav_projetado(posicoes, transacoes, data_alvo):
    """Contexto:
    Calcula o NAV simulado de uma carteira projetada até `data_alvo`. Usado na tela
    de Conciliação (Movimentação) quando o usuário clica em "Movimentar".
    Retorna um dict {nav, nav_por_cota, gap}.

    Pseudocódigo:
      1. Parte das posições de origem agregadas por ativo.
      2. Aplica as transações da janela (origem, alvo] ajustando quantidade e caixa.
      3. Busca o PU oficial de cada ativo na data-alvo (com fallbacks).
      4. Soma provisões de liquidação e de dividendos/JCP.
      5. Calcula nav, nav_por_cota e gap e retorna.
    """
    ...
```

```javascript
/* Contexto:
   Monta a linha da tabela de conciliação a partir de um registro de posição.
   Chamada ao renderizar a grade principal. Retorna um elemento <tr>.

   Pseudocódigo:
     1. Cria o <tr> e aplica a classe de destaque se houver divergência.
     2. Para cada coluna configurada, cria a célula formatada.
     3. Anexa o handler de clique para abrir o drill-down.
     4. Retorna a linha pronta. */
function montarLinhaConciliacao(posicao) {
  ...
}
```

- O comentário descreve a **intenção e a lógica**, nunca repete o código linha a linha.
- Ao **alterar** uma função, **atualize o comentário** junto. Comentário desatualizado
  é pior que ausência de comentário.

---

## 3. Funções pequenas, com um único contexto

- Cada função faz **uma coisa só** e tem um nome que descreve exatamente essa coisa.
- Se você precisar de "e"/"também" para descrever a função, ela provavelmente deve
  virar duas.
- **Prefira várias funções pequenas e reaproveitáveis a uma função grande.** Se um
  trecho de lógica pode fazer sentido isolado (um cálculo, uma formatação, uma
  validação, uma consulta), **extraia numa função própria** com nome claro.
- Sinais de que uma função está grande demais e precisa ser dividida:
  - passa de ~40–50 linhas;
  - tem mais de um nível profundo de `if`/`for` aninhado;
  - mistura buscar dados + calcular + formatar + responder na mesma função.
- Separe as **camadas**: buscar dados, aplicar regra de negócio e formatar a resposta
  devem ficar em funções distintas sempre que possível.

---

## 4. Divisão clara das páginas (evitar os monólitos atuais)

Este é o ponto mais importante para acabar com os conflitos de merge. Hoje várias
telas têm todo o código empilhado num único arquivo/bloco gigante. **Não repita esse
padrão em nada novo.**

### Backend (blueprints em `pages/`)

- Cada tela é um **blueprint** com **responsabilidade única**.
- Dentro do arquivo, mantenha uma **ordem e divisão explícitas**, marcadas com
  cabeçalhos de comentário, na seguinte sequência:

```python
# ─────────────────────────────────────────────────────────────
# 1. IMPORTS E CONFIGURAÇÃO DO BLUEPRINT
# ─────────────────────────────────────────────────────────────

# ─────────────────────────────────────────────────────────────
# 2. HELPERS / REGRAS DE NEGÓCIO (funções puras, sem Flask)
# ─────────────────────────────────────────────────────────────

# ─────────────────────────────────────────────────────────────
# 3. ROTAS (@bp.route) — só orquestram: chamam helpers e respondem
# ─────────────────────────────────────────────────────────────
```

- **Rotas devem ser finas:** validam entrada, chamam funções de negócio e devolvem a
  resposta. A lógica pesada mora nos helpers (seção 2), não dentro da rota.
- Se um arquivo de página passar de **~800 linhas** ou acumular responsabilidades
  distintas, **pare e proponha dividi-lo** (ex.: mover as regras de negócio para um
  módulo próprio) — confirmando com o desenvolvedor antes (ver seção 7).

### Frontend (templates HTML)

- **Não** crie novos HTMLs com milhares de linhas de JS/CSS embutidos num único
  `<script>`/`<style>`. Foi isso que gerou os conflitos atuais.
- Separe por tipo de conteúdo:
  - **CSS** → `static/css/<tela>.css`.
  - **JavaScript** → `static/js/…` (ver a regra de pastas abaixo).
  - **HTML/estrutura** → o template da tela, o mais enxuto possível (só marcação +
    `<link>`/`<script src>`).

#### Quebra obrigatória em pasta por tela (vale também nas REFATORAÇÕES)

- **Nunca deixe um único `.js` gigante por tela.** Toda tela com JS não-trivial tem a
  sua **própria pasta** `static/js/<tela>/`, com **um arquivo por funcionalidade/contexto**.
  Isso vale tanto para código novo quanto para **toda refatoração**: ao refatorar uma
  tela, **sempre** quebre o script dela nessa estrutura de pasta — não pare em "tirei o
  JS de dentro do HTML".
- Estrutura típica de `static/js/<tela>/` (adapte os nomes ao domínio da tela):
  - `state.js`   — declara o objeto único da tela (estado + helpers finos).
  - `filtros.js` — filtros / seleção / montagem de payload.
  - `resultados.js` — busca e renderização dos resultados.
  - `edicao.js`  — modo de edição (quando houver).
  - `modais.js`  — modais / fluxos de confirmação e envio.
  - `index.js`   — bootstrap (`init` + `DOMContentLoaded`).
- **Padrão sem build (mantém um objeto só):** `state.js` declara `const Tela = { … }`
  (global, para os `onclick` inline do template); cada arquivo seguinte **acrescenta**
  seus métodos com `Object.assign(Tela, { … })`. Assim `this` e os handlers continuam
  funcionando e cada funcionalidade fica isolada num arquivo.
- **Carregue na ordem** no template: utils compartilhados → `state.js` → demais pedaços
  → `index.js` por último. Ex.:
  ```html
  <script src="/static/js/utils/format.js"></script>
  <script src="/static/js/carteira/state.js"></script>
  <script src="/static/js/carteira/filtros.js"></script>
  <script src="/static/js/carteira/resultados.js"></script>
  <script src="/static/js/carteira/edicao.js"></script>
  <script src="/static/js/carteira/modais.js"></script>
  <script src="/static/js/carteira/index.js"></script>
  ```
- **Objetivo:** dois desenvolvedores mexendo em funcionalidades diferentes da mesma tela
  editam **arquivos diferentes** — sem conflito de merge. Se um pedaço crescer demais,
  quebre-o de novo (ex.: `modais.js` → `modais_busca.js` + `modais_envio.js`).
- A tela **`carteira`** é a referência viva desse padrão — use-a como modelo.

---

## 5. Pasta `utils/` — funções de uso comum

Para simplificar o reaproveitamento e evitar código duplicado:

- Crie e use uma pasta **`utils/`** na raiz do projeto para **funções genéricas e
  reutilizáveis** — aquelas que servem a mais de uma tela ou não pertencem à regra de
  negócio de nenhuma página específica.
- Exemplos do que vai em `utils/`: formatação de datas/moeda/número, parsing,
  validações genéricas, helpers de resposta HTTP, conversões, cálculos utilitários.
- Organize por tema, um arquivo por assunto:
  `utils/datas.py`, `utils/formatacao.py`, `utils/validacao.py`, etc.
- Para JavaScript reutilizável, use `static/js/utils/` da mesma forma.
- **Antes de escrever um helper novo, verifique se ele já existe em `utils/`.**
  Se algo parecido existir, reutilize ou generalize o existente em vez de duplicar.
- Quando notar a **mesma lógica repetida em duas ou mais páginas**, extraia para
  `utils/` e faça as páginas passarem a importar de lá.

```python
# utils/formatacao.py

def formatar_moeda_brl(valor):
    """Contexto:
    Formata um número como moeda brasileira (R$ 1.234,56). Usado em qualquer tela
    que exiba valores financeiros. Retorna string.

    Pseudocódigo:
      1. Arredonda para 2 casas.
      2. Aplica separador de milhar "." e decimal ",".
      3. Prefixa "R$ " e retorna.
    """
    ...
```

---

## 6. Reaproveitamento antes de escrever código novo

- Antes de implementar, **procure se já existe** função/helper que resolva o problema
  (em `utils/`, no blueprint da tela, ou em módulos como `beehus_api/`, `db.py`,
  `beehus_catalog.py`).
- Prefira **reutilizar e generalizar** a **copiar e colar**. Código duplicado é uma das
  principais fontes de bug e de divergência entre telas.
- Se for reutilizar algo que está "preso" dentro de uma página, **promova para `utils/`**
  em vez de duplicar — confirmando antes se a mudança afeta outras telas.

---

## 7. Quebra de arquitetura: confirmar SEMPRE antes

Se, para atender um requisito, a solução mais direta exigir **quebrar qualquer padrão
deste documento** — por exemplo: colocar muita lógica dentro de uma rota, inflar um
template já grande, duplicar código em vez de extrair para `utils/`, misturar
responsabilidades num único arquivo, ou criar um novo monólito —, então:

1. **NÃO implemente a versão que quebra o padrão.**
2. **Explique ao desenvolvedor**, em português claro:
   - qual padrão seria quebrado;
   - por que o requisito parece empurrar para essa quebra;
   - qual seria a alternativa saudável (mesmo que dê mais trabalho);
   - o trade-off entre as opções.
3. **Aguarde a decisão do desenvolvedor** antes de escrever o código.

O objetivo é que nenhuma decisão de arquitetura seja tomada silenciosamente no meio de
uma implementação. Padrão saudável primeiro; exceções só com aval explícito.

---

## 8. Acesso a dados — API-first, Mongo é SOMENTE LEITURA

O projeto tem uma camada de dados bem definida: **API-first, com o Mongo apenas como
fallback de leitura**. Todo acesso a dados passa por [beehus_api/](beehus_api/),
[db.py](db.py) e [beehus_catalog.py](beehus_catalog.py).

- **Nenhuma tela nova acessa o banco direto nem faz HTTP cru.** Sempre use as camadas
  acima. Isso evita que cada página reinvente o acesso a dados (fonte clássica de bug e
  de divergência entre telas).

### ⛔ Proibição de escrita direta no MongoDB (regra crítica)

**O Claude NÃO está autorizado a executar nenhuma operação de escrita/alteração direta no
MongoDB.** Isso é inegociável e vale para qualquer requisito.

- **PROIBIDO** (acesso direto ao banco): `insert_one`/`insert_many`, `update_one`/
  `update_many`, `replace_one`, `delete_one`/`delete_many`, `drop`, `bulk_write`,
  `find_one_and_*`, criação/remoção de índices, ou qualquer comando que **modifique**
  dados ou estrutura no Mongo.
- **PERMITIDO** apenas: **leitura** (`find`, `aggregate`) e **somente como fallback**,
  quando a API Beehus não cobre aquele dado.
- **Toda alteração de dados** (criar, editar ou remover) **deve passar exclusivamente
  pelas rotas homologadas da API Beehus**, através dos módulos de [beehus_api/](beehus_api/)
  (ex.: `securities`, `transactions`, `positions`, `provisions`).
- Se a operação de escrita necessária **não existir** na API homologada: **PARE e
  confirme com o desenvolvedor**. **Nunca** improvise gravando direto no banco, nem crie
  conexões de escrita, credenciais elevadas ou scripts que gravem no Mongo.

> Resumindo: **Mongo = leitura de emergência. Escrita = só via API homologada.**

---

## 9. Segredos e dados de cliente (segurança)

- **Segredos só via variável de ambiente** (`SWAT_MONGO_URI`, `.env`, etc.).
  **Nunca** deixe credenciais, tokens, URIs ou senhas hardcoded no código, e **nunca**
  as comite (o `.env` e `user_connections.json` já estão no `.gitignore`).
- **Nunca logue nem exponha credenciais** em mensagens de erro ou telas. O projeto já
  faz isso (ver `_scrub` em [app.py](app.py), que remove usuário/senha de URIs do Mongo
  antes de qualquer log ou resposta) — mantenha esse cuidado em código novo.
- A pasta [data/](data/) contém **dados reais de cliente**. Vários desses arquivos estão
  no `.gitignore` justamente por isso — **nunca comite dados de cliente** e confira o
  `.gitignore` antes de adicionar arquivos novos em `data/`.

---

## 10. Configuração em `data/*.json`, não no código

- O projeto externaliza regras e parâmetros em JSON (`transaction_type_rules.json`,
  `precificacao_config.json`, `conciliacao_config.json`, etc.). **Parâmetros
  configuráveis vão para `data/*.json`**, não hardcoded no meio da lógica.
- Atenção a quais arquivos são versionados e quais são locais/sensíveis: o `.gitignore`
  faz essa distinção (ex.: `data/config.json`, caches e pastas de dados são ignorados).

---

## 11. Manter a documentação (`docs/`) atualizada

- O projeto tem documentação por tela/fluxo em [docs/](docs/) (ex.: `CONCILIACAO_MOV.md`,
  `PRECIFICACAO.md`, `CONTROLPANEL.md`).
- **Ao criar ou alterar uma funcionalidade, atualize o doc correspondente** em `docs/`
  na mesma tarefa. Documentação desatualizada engana quem for manter depois.

---

## 12. Higiene de Git (para reduzir conflitos de merge)

Complementa a divisão de código da seção 4 — juntas atacam a causa dos conflitos atuais:

- **Uma branch por funcionalidade.** Faça `git pull` da `main` **antes de começar**.
- **Commits pequenos e focados**, com mensagem clara do que mudou e por quê.
- **Uma funcionalidade = um arquivo/partial próprio** sempre que possível, para que dois
  desenvolvedores mexendo em coisas diferentes **não editem o mesmo trecho**.
- Não misture, no mesmo commit, mudanças de funcionalidades diferentes.

---

## 13. Dependências novas só com confirmação

- O [requirements.txt](requirements.txt) é enxuto e com versões fixadas. **Não adicione
  biblioteca nova** (Python ou JS) **sem confirmar com o desenvolvedor** — isso conta
  como quebra de padrão (seção 7). Prefira resolver com o que já existe no projeto.

---

## 14. Python, encoding e ambiente (Windows / OneDrive)

- Ao rodar dashboards Python (Dash/Flask), sempre use `use_reloader=False` em
  desenvolvimento e evite caminhos com espaços. Se o projeto estiver no OneDrive ou em um
  caminho com espaços, avise proativamente e configure de acordo.
- O ambiente é **Windows** e o conteúdo tem **acentos em português**. **Salve os arquivos
  em UTF-8** e tome cuidado com acentuação no terminal (houve correção recente salvando
  `start.ps1` como UTF-8 com BOM justamente por causa disso).

---

## Notas específicas deste protótipo (ControleCargas) — [ADICIONADO 2026-07-20]

- **[2026-08-05, pedido do usuário: "consegue efetuar todas consultas por Endpoints" →
  "pode efetuar o processo de transição" → "pode remover toda consulta do mongo"]
  MIGRAÇÃO API-FIRST COMPLETA — este protótipo NÃO tem mais NENHUM acesso a MongoDB,
  nem ao vivo nem avançado/fallback.** Todo `import pymongo`/`certifi`, o singleton de
  `MongoClient`, o cadastro de connection string por usuário
  (`data/user_connections.json`) e as rotas `/api/conexao-mongo*` foram REMOVIDOS por
  completo de `db.py`/`app.py` — não existe mais um caminho alternativo de conexão a
  banco neste app. Ele busca companies/entities/wallets/groupings/securities/posições/
  NAV/issues pela **API Beehus** (`beehus_api/` — cópia local, mesmo cliente HTTP dos
  apps-irmãos `SWAT\beehus-swat`/`SWAT\conciliacao`, com os módulos de escrita
  removidos: este protótipo continua 100% leitura). O `beehus_catalog.py` genérico dos
  apps-irmãos **não** foi copiado — os helpers de catálogo/esteira ficam direto em
  `db.py`, mais magros e específicos a este protótipo. Ver docstring completa de
  `db.py` (topo do arquivo) para o detalhe de cada função. Se algum dia for preciso de
  Mongo de novo (ex.: ferramenta offline), reimplementar do zero seguindo o padrão de
  `SWAT\beehus-swat\db.py`/`SWAT\Relatorios\pages\setup.py` — não há nada a "reativar".
  - **Autenticação**: token Bearer da API, válido por 1 dia, colado no botão "🔑 Beehus
    API" da masthead (`GET/POST/DELETE /api/beehus-token`, app.py + `beehus_api/client.py`,
    modal em `static/js/controle_cargas/beehus_token.js`). Sem token válido, nada
    carrega — é o ÚNICO requisito de conexão do app; o modal abre automaticamente
    quando ausente/expirado. `start.ps1` não checa mais nenhuma variável de ambiente
    de Mongo antes de subir o servidor (checagem removida — era um gate morto agora).
  - **Janela travada em 6 dias úteis (7 datas)** [pedido do usuário: "pode travar para 5DU";
    ampliado para 6 du em 2026-09-24: "aparecendo sempre 7 dias"]: o
    campo De/Até do botão "Atualizar" (`/api/atualizar`) rejeita intervalos maiores —
    cada dia da janela custa chamadas reais à API por empresa (`get_processed_position`/
    `get_nav_results`/`get_preprocessing_status`), então um intervalo customizado grande
    sem teto explodiria em centenas de chamadas de um clique só.
  - **Boot mais lento que antes** [pedido do usuário: "está demorando muito a
    inicialização"] — o healthcheck de `start.ps1` subiu de 90s pra 240s; o boot agora
    faz chamadas HTTP por empresa/data em vez de 1 query Mongo batch. Otimizado 2x:
    (1) `_buscar_datas_faltantes_via_api` rodava as N datas em SÉRIE (pro de todas
    empresas, depois nav, depois issues, só então a próxima data) — reescrito pra
    jogar TODAS as tarefas (data×empresa×tipo) numa fila só, 1 ThreadPoolExecutor
    (`_FAN_OUT_WORKERS_ESTEIRA=40`); (2) o pool de conexões HTTP (`beehus_api/
    client.py`, só nesta cópia local) subiu de 20 pra 40 — com o chunking interno de
    `positions.py` (até 5 sub-chamadas por empresa grande) por cima do pool externo, o
    limite de 20 conexões estava enfileirando requisições. Resultado medido: janela
    default (7 du) caiu de ~96s pra ~80s. O restante é latência real do servidor
    Beehus por chamada (medida até 16.7s numa chamada individual de
    `processed-position`) — não dá pra cortar mais só do lado do cliente.
  - **Lacunas reais confirmadas** (endpoint novo da equipe Beehus necessário se quisermos
    de volta): (1) as 3 colunas "Última Unp/Pro/Pub" + ordenação + export Excel foram
    **removidas por completo** — não existe endpoint de "última data com dado por
    carteira, em lote" (o agregado Mongo equivalente já era o passo mais caro do build
    antigo, ~24s); (2) `get_preprocessing_status` cobre só 6 dos 8 tipos de issue que
    existiam no Mongo — `explosion_error`/`missing_fund_position_for_explosion` não
    existem no endpoint; (3) o tipo `missing_wallet` (1 dos 2 tipos de severidade
    vermelha) aparece no endpoint mas sem NENHUM campo de walletId — não se atribui a
    carteira nenhuma via API. Ver `db.py` (topo do arquivo) para os detalhes.
  - **Otimização por regra de negócio** [pedido do usuário: "só pode ter issues
    pendentes se tiver como unprocessed"]: os 4 tipos de issue derivados de analisar
    securities (`security_unmapped`/`security_missing_classification`/
    `security_missing_price`/`security_missing_history_price`) só contam pra uma
    carteira se ela tiver unprocessed NA MESMA data (`db._TIPOS_ISSUE_QUE_EXIGEM_
    UNPROCESSED`) — regra já documentada (só como filtro de front-end) no app-irmão
    `SWAT\beehus-swat` (`templates/controlpanel.html`), aplicada aqui na origem.
  - **Suposições iniciais CORRIGIDAS depois de testar com um token real**: `wallets.
    startDateConsolidation` e `groupings.benchmarks` **existem** na API (a suspeita
    inicial de que seriam lacunas veio só da docstring — não exaustiva — do cliente
    HTTP; dados reais confirmaram 100%/~5-70% de preenchimento, variando por empresa).
    Também confirmado ao vivo: os campos `createdAt`/`updatedAt` de unprocessed/
    processed position existem — MAS vêm como **string ISO, não `datetime`** (o pymongo
    fazia essa conversão automática antes; agora passa por `db._parse_iso_dt()`).
    **Lição**: sempre que possível, valide suposições sobre o shape de um endpoint com
    um token/dado real antes de escrever a lógica de consumo — docstrings de cliente
    HTTP escritas para OUTRO app não são garantia de shape completo.
- **[2026-08-21, ATUALIZADO — antes dizia "ainda não há blueprints, é uma
  tela única"] Agora há 2 telas.** A grade original (Carteiras/
  Agrupamentos/Company/Controle de Cargas) continua com as rotas direto em
  `app.py` (não migrada pra blueprint nesta rodada — só a divisão por
  camada `db.py`/`registry.py`/`snapshot_builder.py`/`excel_report.py`/
  `utils/` já aplicava a separação de responsabilidades da seção 3/4). A
  aba nova **"Controle de Demandas"** (porte de `beehus-rotinas`, Kanban de
  demandas operacionais) é o 1º blueprint do protótipo (`pages/
  controle_demandas.py`, `pages/` criada só para ela), registrado em
  `app.py` com só 2 linhas novas (`import` + `register_blueprint`) — nenhuma
  rota/função pré-existente do grid foi tocada. A tela nova entra como mais
  uma aba da MESMA SPA (`#tab-demandas`/`#panel-demandas` em
  `index_template.html`/`index.html`), não uma página própria — a troca de
  aba usa listeners ADITIVOS em `static/js/controle_demandas/index.js`
  (anexados por cima dos botões de aba já existentes), sem editar
  `switchTab()`/`wireAbas()` de `static/js/controle_cargas/index.js`. Dado
  100% local (`data/controle_demandas.json`/`data/demandas_config.json`,
  sem Mongo/API Beehus), com persistência atômica+lock+anti-conflito de
  OneDrive PRÓPRIA e autocontida dentro do blueprint (deliberadamente
  parecida com a de `app.py`, mas não promovida a um módulo `utils/`
  compartilhado — decisão do usuário de manter o blast radius restrito a
  arquivos novos). CSS autocontido (`static/css/controle_demandas.css`,
  visual fiel à origem — não reaproveita os tokens de
  `controle_cargas.css`) e overlays de modal próprios (`.kd-modal-*`, não
  o `#modal-backdrop` da grade principal). Ver `docs/PLANNING.md` §"Aba
  Controle de Demandas" para o detalhe completo.
- **[2026-08-21] Aba nova "Anomalias" (2º blueprint do protótipo,
  `pages/anomalias.py`) — board MANUAL de anomalias/incidentes
  operacionais, MESMO mecanismo da aba "Controle de Demandas" acima (CRUD
  simples sobre `data/anomalias.json`, sem seed inicial) — SEM NENHUMA
  relação com snapshot/carteiras/esteira (não lê `snapshot_builder.py`/
  `registry.py`/`build_snapshot.py`).** Uma 1ª tentativa desta tarefa
  tinha construído a aba como análise AUTOMÁTICA a partir do snapshot —
  o usuário corrigiu ("essa nova aba deve ser similar a de demandas, sem
  relação com as carteiras") e a tentativa foi revertida por completo
  antes de reconstruir do zero como board manual. Registrado em
  `app.py` com só 2 linhas novas (`import` + `register_blueprint`);
  nenhuma rota/função pré-existente foi tocada, inclusive as de
  `pages/controle_demandas.py` (só LIDAS, nunca alteradas — `Anomalias`
  reaproveita `GET/POST /api/demandas` e `data/demandas_config.json` só
  como leitura, para a funcionalidade nova de **vincular demandas como
  solução da anomalia** — campo `demandas_vinculadas[]`, referência por
  id, nunca duplica dado). Schema: `criticidade` (Crítico/Atenção/
  Observação, enum novo desta tela) + `acao_curto_prazo`/
  `acao_longo_prazo` (contenção vs. estrutural) + os campos já
  conhecidos de Demandas (cliente/responsável/status/comments).
  CSS/JS autocontidos (`static/css/anomalias.css` — mesma família visual
  de `controle_demandas.css`, classes `an-` próprias; `static/js/
  anomalias/`), troca de aba por listeners ADITIVOS (mesma técnica de
  Demandas). Decisão de design registrada em `pages/anomalias.py` e
  `docs/PLANNING.md`: o board agrupa por CRITICIDADE (3 colunas fixas),
  não por responsável como em Demandas — criticidade é o eixo central e
  exclusivo desta tela (board de triagem de severidade), responsável é
  sobre distribuição de carga de trabalho (papel que já cabe a
  Demandas). Testado via Playwright (criar/editar/comentar/excluir
  anomalia; vincular demanda existente via busca; criar demanda nova e
  já vincular, com prioridade default do mapa criticidade→prioridade;
  nova demanda aparece em `GET /api/demandas` e no board de Demandas;
  clique no badge de vínculo troca de aba e filtra a demanda certa; as 5
  abas antigas sem regressão). Ver `docs/PLANNING.md` §"Aba Anomalias"
  para o detalhe completo, inclusive 2 bugs achados e corrigidos durante
  o próprio teste (comentário JS/CSS com `*/` literal fechando o bloco
  de comentário cedo demais; guard `window.ControleDemandas` que nunca
  é verdadeiro porque `const` de topo de arquivo não vira propriedade de
  `window`).
- **[2026-08-13, "diversos arquivos criados, será sincronização? corrija como as coisas
  são salvas e consumidas, mantendo os acessos do jeito que está"] PERSISTÊNCIA MAIS
  ROBUSTA CONTRA CONFLITO DO ONEDRIVE — acesso continua exatamente como sempre foi
  (cada pessoa roda `app.py`/`iniciar.bat` na própria máquina; NENHUMA mudança de
  arquitetura de acesso/hospedagem).** Foi encontrada evidência (logs
  `.controlecargas-server-<hostname>[-N].err/.out` com sufixos de pelo menos 4 máquinas
  diferentes) de que o OneDrive corporativo, ao ver o MESMO arquivo escrito quase ao
  mesmo tempo por processos `app.py` de máquinas diferentes (código E `data/` moram
  dentro da pasta sincronizada), cria uma cópia renomeada `<nome>-<PC>[-N].<ext>` em vez
  de sobrescrever — daí os "diversos arquivos criados". O risco real não são os logs (só
  sujeira), e sim `data/alert_comments.json`/`data/wallet_annotations.json`: sem
  tratamento, o comentário/anotação que ficasse numa cópia renomeada suportada pelo
  OneDrive nunca mais apareceria pra ninguém (perda silenciosa de dado de usuário). A
  camada de persistência (`app.py`) ganhou 3 mudanças, TODAS dentro do próprio arquivo,
  sem exigir nenhuma mudança de processo/infra:
  1. **Escrita atômica** (`_escrever_json_atomico`): grava num `.tmp` na mesma pasta e
     troca com `os.replace` — nunca deixa um JSON pela metade no disco se o processo for
     morto no meio (ex.: `Stop-Process -Force` do `start.ps1` ao reiniciar).
  2. **Lock reentrante por arquivo dentro do processo** (`_comments_lock`/
     `_annotations_lock`, `threading.RLock`): cobre todo o ciclo ler→modificar→salvar de
     `/api/comments` e `/api/annotations` (antes só a escrita final não tinha proteção
     nenhuma) — protege contra 2 requisições do MESMO processo (2 abas do navegador,
     duplo-clique em Salvar) se pisando, já que `threaded=True` (2026-08-06) atende
     ambas em paralelo.
  3. **Auto-cura de cópias de conflito do OneDrive** (`_achar_copias_conflito` +
     `_mesclar_copias_conflito_comments`/`_annotations`, chamadas a cada leitura, dentro
     de `_load_comments()`/`_load_annotations()`): acham qualquer `<nome>-<PC>[-N].json`
     na pasta `data/`, incorporam o conteúdo no arquivo canônico (comentários: união por
     `id`, nunca colidem porque cada comentário é um registro novo; anotações: por chave
     `targetType|targetId|referenceDate`, desempate por `updatedAt` mais recente) e
     arquivam a cópia processada em `data/_conflitos_resolvidos/` — NUNCA apagam o
     arquivo original do OneDrive, só tiram do caminho pra não ficar reprocessando pra
     sempre (cópia ilegível/corrompida também é arquivada, não trava a leitura). O app se
     autocura sozinho a cada carregamento de tela, sem ação manual de ninguém.
  - **Limite assumido, documentado propositalmente**: isso NÃO é um lock distribuído
    entre máquinas (não existe forma de fazer isso só com arquivos sincronizados pelo
    OneDrive, sem um servidor central) — só reduz a janela de risco e recupera
    automaticamente o que o OneDrive já separou em vez de deixar perdido pra sempre. Se
    duas pessoas salvarem no MESMO instante exato, antes de qualquer sincronização, o
    OneDrive ainda pode gerar uma cópia de conflito nova — só que agora ela é
    auto-mesclada no próximo load em vez de ficar esquecida. Se essa janela residual
    virar problema de verdade no futuro, a solução definitiva seria centralizar num
    único processo/servidor — mudança de arquitetura que exigiria confirmação
    específica (ver seção 7), fora do escopo desta correção.
  - **O que NÃO mudou**: `data/TemplateCarteiras.xlsx` continua dentro do OneDrive,
    editado manualmente por quem cuida do cadastro — fluxo humano de baixa frequência,
    diferente das escritas do próprio Flask a cada request; mexer nisso quebraria a
    migração já feita em 2026-07-28 (ver `build_snapshot.py`). Nenhuma variável de
    ambiente nova, nenhuma mudança em `start.ps1`/`iniciar.bat`, nenhuma dependência
    nova.
- **[2026-08-13, pedido do usuário: "se a carteira da lista for comprada por alguma
  carteira da lista, precisa aparecer com uma sinalização diferenciada e trazida como
  prioridade... porque precisamos resolver primeiro ele para depois as carteiras que
  comprar ele"] PRIORIDADE POR DEPENDÊNCIA DE EXPLOSÃO.** Reaproveita o mecanismo de
  "explosão de ativos" que o app já tinha PARCIALMENTE (`wallets.securitiesForExplosion`,
  2026-07-31) — antes só resolvia o NOME do ativo de exibição (`explodedAssetNames`),
  sem nenhum vínculo de `walletId` nem efeito em prioridade/ordenação. Confirmado com o
  usuário (3 decisões de negócio, via pergunta antes de implementar — CLAUDE.md §7):
  1. **Detecção**: `db.py::_resolver_explosao` (renomeada de `_resolver_nomes_explosao`)
     agora TAMBÉM resolve `correspondingWallet._id` de cada security referenciada em
     `securitiesForExplosion` (1 chamada `get_security()` por id ÚNICO referenciado — não
     vem no catálogo em lote `list_securities()`, confirmado pela docstring de
     `beehus_api/securities.py`) e escreve `explodedWalletIds` (paralelo a
     `explodedAssetNames`, mas com o walletId real). `registry.py` propaga pro registry;
     `snapshot_builder.mapear_carteiras_compradas(registry_por_id)` cruza TODAS as
     carteiras entre si e devolve `{walletId comprado: [nomes dos compradores]}` — SÓ
     conta quando o comprador E o comprado estão os dois no Template (registry_por_id);
     não é "qualquer wallet do Beehus".
  2. **Prioridade**: `compute_sort_key()` (snapshot_builder.py) ganhou um 1º critério, na
     frente de tudo (`fura_fila`) — MAS só liga (`aguardando_explosao=True`, calculado em
     `compute_wallet_row()`) quando a carteira comprada AINDA tem pendência na data de
     referência (`celulas[-1]["s"] not in ("p","cD")`) — carteira comprada já Publicada
     não fura a fila de ninguém (regra confirmada: só reordena entre quem já tem algum
     problema pendente). Groupings continuam com o default `aguardando_explosao=False`
     (conceito só existe por walletId) — comportamento de ordenação deles inalterado
     (confirmado: o novo elemento na chave é constante entre eles, não afeta ordem
     relativa).
  3. **Sinalização visual**: os 4 cantos + borda da CÉLULA já estavam 100% ocupados
     (Atraso/Rent/Issue/Comentário/Seq — ver legenda), então a marcação é a nível de
     LINHA, não de célula: classe `linha-comprada-pendente` na `<tr>` inteira (anel
     violeta via `box-shadow` — canal deliberadamente diferente de `background-color`,
     usado por `tr.row-copiada`, pra as duas marcações conviverem sem se apagar) +
     pílula "Comprada" ao lado do nome (`matriz.js` `rowHtml()`) com tooltip listando
     quem compra + tag nova "Comprada" no filtro de cabeçalho `statusRef`
     (`filtro_cabecalho.js`, mesmo padrão de "Problema Rent") + linha "Comprada por" no
     painel de detalhe (`paineis.js`, ao lado de "Explode em", que já existia). Cor
     violeta NOVA no design system (`--overlay-comprada`/-ink/-wash, controle_cargas.css)
     — canal ORTOGONAL às cores de gravidade (âmbar/vermelho), não passou pelo
     `validate_palette.py` da skill dataviz (diferente dos outros pares já validados);
     revisitar se o time achar baixo contraste.
  - **O que NÃO mudou**: `data/TemplateCarteiras.xlsx`/`excel_report.py` não ganharam
    coluna nova (o campo irmão `explodedAssets` já não tinha coluna no Excel, então
    `compradaPorNomes` seguiu o mesmo escopo, sem inflar o relatório sem pedido
    explícito).

- **[2026-08-21, pedido do usuário: "mude o layout de cores para escuro"] MODO ESCURO
  NO APP INTEIRO (6 abas), com toggle claro/escuro/automático.** 100% aditivo — nenhum
  dos 3 CSS existentes (`controle_cargas.css`/`controle_demandas.css`/`anomalias.css`)
  nem nenhum JS existente foi editado.
  - **`static/css/tema_escuro.css`** (novo, carregado por ÚLTIMO no `<head>`, depois
    dos outros 3 CSS): `controle_cargas.css` já tinha a paleta escura completa (3
    blocos `@media(prefers-color-scheme)`/`[data-theme=dark]`/`[data-theme=light]`,
    validados com a skill dataviz) — só faltava alguém escrever o atributo
    `data-theme`; esse arquivo só tapa 3 lacunas de cor fixa que sobravam no grid
    (tooltip, sombra de popover, tons de anotação). Para Demandas/Anomalias (~46 hex
    hardcoded, zero variável CSS, paleta própria e deliberadamente separada do grid),
    o arquivo declara custom properties locais (`--sb-*`) nos mesmos 3 seletores e
    escreve as regras de pintura de `#panel-demandas`/`#panel-anomalias` UMA vez,
    referenciando só `var(--sb-...)` — como carrega por último e a especificidade é
    igual à das regras originais, a cascata garante que essas regras novas vençam sem
    precisar de `!important` nem editar os CSS de origem.
  - **`static/js/utils/tema.js`** (novo — primeiro arquivo em `static/js/utils/`,
    pasta criada nesta tarefa, CLAUDE.md §5): aplica o tema o mais cedo possível
    (`<script>` bloqueante no `<head>`, sem defer/async, pra não ter flash de tema
    errado) lendo `localStorage['controlecargas.tema']` com fallback pra
    `matchMedia('prefers-color-scheme: dark')` quando não há escolha manual salva —
    ou seja, padrão **"Automático"** [decisão do usuário]. Botão novo `#btn-tema` na
    masthead (clique curto alterna; pressionar e segurar ~0,7s limpa a escolha manual
    e volta a seguir o SO — bônus trivial, não pedido explicitamente).
  - **Botões primários no escuro invertidos** [decisão do usuário: "claro sobre fundo
    escuro", não o verde `--accent` do grid, pra não misturar os dois sistemas de cor
    que já são propositalmente separados].
  - **Corrigida de quebra a divergência pré-existente `index.html` × `index_template.html`**
    (achado à parte, sem relação com o tema): `build_snapshot.py::write_html()`
    sobrescrevia `index.html` com uma cópia desatualizada de `index_template.html`,
    apagando o botão "🔑 Beehus API"/script/campo de data — os dois arquivos foram
    reconciliados (ficam idênticos agora) e toda mudança de HTML desta tarefa entrou
    nos dois. Rodar `build_snapshot.py` deixou de ser destrutivo.
  - Limitação conhecida, aceita: o `corDot` do badge de vínculo em
    `anomalias/cartoes.js` é `style=` inline (JS já existente) e fica com contraste
    baixo no escuro — não corrigido nesta rodada por ser código já existente; será
    revisitado junto das melhorias funcionais da aba Anomalias.

- **[2026-08-22, Parte 2 do plano de tema/melhorias — 8 melhorias funcionais na aba
  Anomalias] EDIÇÃO PONTUAL E CIRÚRGICA LIBERADA pelo usuário, só para esta tarefa e só
  em `pages/anomalias.py`/`static/js/anomalias/*.js`/`static/css/anomalias.css`** (a
  regra "só adicionar" continuou valendo para todo o resto do app, inclusive
  `index_template.html`/`index.html`/`static/css/tema_escuro.css` — nenhuma linha
  tocada, confirmado por diff completo contra backup). Motivo da liberação: 4 das 8
  melhorias (Onda 2) exigiam campo novo no schema de anomalia (`ocorrido_em`, `impacto`,
  `tags[]`, `historico[]`) e trilha de auditoria no SERVIDOR — sem a liberação, isso
  ficaria dependente de gambiarra client-side ao invés de garantido.
  - **Onda 1** (zero campo novo, `state.js`/`filtros.js`/`quadro.js`/`index.js`):
    (1) aging — badge "há Nd"/"há Nsem" por criticidade, limiares em
    `data/anomalias_config.json` (arquivo novo); (2) cartão "órfão" — anel tracejado +
    pílula "⚠ sem ação vinculada" em Crítico/Atenção sem `demandas_vinculadas`; (3)
    `<select>` de ordenação + checkbox "só sem vínculo"; (7) atalhos de teclado
    (`n`/`/`/`1`-`3`/`0`), com guarda de foco (nunca intercepta digitação em
    input/textarea/select) e guarda de aba visível.
  - **Onda 2** (schema novo, `pages/anomalias.py`/`modais.js`/`cartoes.js`):
    (8) `ocorrido_em` (default = hoje quando ausente) + `impacto` (texto curto);
    (5) `tags[]` + chips no cartão + filtro por tag (servidor: novo parâmetro `tag` em
    `_filtrar_anomalias`); (4) `historico[]` — `{quando, campo, de, para}`, gravado em
    `atualizar_anomalia()` sempre que `criticidade`/`status` mudam via PATCH (inclusive
    o drag&drop entre colunas), exibido como timeline no modal de "Atualizações"; (6)
    recorrência — pílula "↻ Nª vez" no cartão + aviso no modal Nova/Editar quando há
    tag em comum com outra anomalia do mesmo cliente nos últimos 30 dias (cálculo 100%
    client-side, sem chamada nova).
  - **Nenhum token `--sb-*` novo em `tema_escuro.css`**: todo elemento visual novo
    reaproveita tokens já existentes (`--sb-chip-critico-*`/`-atencao-*`/`-done-*`/
    `-active-*`/`--sb-vinc-*`/`--sb-text-*`/`--sb-border`) via `var(--sb-x, <fallback
    claro>)` direto em `anomalias.css` — funciona nos 2 temas mesmo carregando ANTES de
    `tema_escuro.css` (custom property resolve pelo valor vigente em `:root` na hora da
    pintura, não pela ordem de `<link>`).
  - **Nenhum `<script>`/elemento HTML novo em `index_template.html`/`index.html`**
    (fora do escopo liberado): todo controle novo (selects, checkbox, campos de
    formulário, aviso, timeline) é injetado via JS (`insertAdjacentHTML`, idempotente)
    dentro dos containers que já existiam.
  - Ver `docs/PLANNING.md` §"Aba Anomalias" → "Melhorias [2026-08-22]" para o detalhe
    completo, inclusive as decisões sem regra explícita registradas por transparência
    (timeline no modal de Atualizações, não no de edição; recorrência só conta com tag
    em comum) e o resultado do teste Playwright (8 melhorias, 2 temas, zero regressão
    nas outras 5 abas, dados de teste apagados de `data/anomalias.json` ao final).

- **[2026-08-24, pedido do usuário] Sub-visão nova "Publicação por Hora" na aba
  Company** — materialização PARCIAL do "Alerta 7 — Horários Execução" que já estava
  planejado em `docs/PLANNING.md` desde o desenho original e nunca tinha sido
  implementado (ver lá o detalhe completo, seção atualizada nesta mesma tarefa).
  Seletor "Por empresa"/"Por hora" dentro do painel `#panel-company` já existente:
  linhas = baldes de hora (até 08h / hora cheia 09h..20h / após 20h / "sem hora",
  limites configuráveis), colunas = mesmos dias da janela do grid; célula = quantos
  AGRUPAMENTOS foram publicados naquele balde (incremento) + acumulado/% sobre a meta
  fixa do dia (mesmo denominador do card "Agrupamentos Publicados").
  - **Decisões do usuário, já confirmadas antes de codar** (via plano prévio,
    `PLANO_PUBLICACAO_POR_HORA.md`): (1) fonte da hora = "Rota A", o `publishedAt`
    real que a API Beehus já devolve em `groupingsDetailed` (MESMA chamada que o boot
    já fazia — zero chamada de API nova; nem Rota A nem Rota B usam Mongo, o app é
    100% API desde 2026-08-05); (2) "deveria publicar" = meta FIXA por dia, mesma
    regra de denominador de `computeGroupingPublishStat()` (não é uma curva de SLA por
    hora); (3) sempre todas as empresas, ignorando o filtro corrente (igual a matriz
    "Por empresa" já faz); (4) 2 helpers extraídos de dentro de
    `computeGroupingPublishStat()` (matriz.js) —
    `agrupamentoCarteirasQueDevemPublicarNaData()`/`agrupamentoEstaPublicadoNaData()` —
    comportamento IDÊNTICO, comprovado por teste automatizado (ver abaixo); (5) faixa
    até 08h/09h..20h/após 20h/"sem hora", limites em `data/publicacao_hora_config.json`
    (novo, CLAUDE.md §10); (6) só os dias já carregados na janela atual (zero API
    nova); (7) nome da visão "Publicação por Hora".
  - **3 exceções cirúrgicas liberadas** (documentadas com comentário
    `[2026-08-24, decisão do usuário]` em cada arquivo, tudo o mais é adição pura):
    `db.py` (~L711-719, copia `publishedAt` de `groupingsDetailed` via `_parse_iso_dt`,
    antes descartado), `snapshot_builder.py::montar_celula_grouping_dia()` (~L994-1002,
    grava `entrada["horaPub"]` formatado via `formatar_horario_brt()`, guardado —
    só grava a chave quando há hora), `matriz.js::computeGroupingPublishStat()`
    (extração dos 2 helpers acima, retorno idêntico).
  - **1 desvio do plano original, decidido nesta implementação e reportado ao
    usuário**: o plano previa `data/publicacao_hora_config.json` sendo lido
    diretamente pelo JS — impossível sem uma rota nova (`data/` não é servido pelo
    Flask; a allowlist `_ALLOWED_STATIC_FILES` de `app.py` só cobre `snapshot.json`, e
    editar essa allowlist ou criar acesso cru a `data/*.json` não estava entre as 3
    exceções liberadas). Em vez disso, `app.py` ganhou 1 rota NOVA (não uma
    modificação de rota existente) `GET /api/publicacao-hora-config`, no MESMO padrão
    já usado por `data/demandas_config.json`/`data/anomalias_config.json` (config lida
    no servidor, servida como JSON) — decisão registrada aqui por transparência, já
    que o plano listava só 3 arquivos a tocar e este é um 4º (adição pura, nenhuma
    rota/função pré-existente foi alterada).
  - **Arquivos novos**: `static/js/controle_cargas/matriz_publicacao_hora.js` (compute
    + render + o seletor "Por empresa"/"Por hora", tudo num arquivo só — decisão
    tomada por simplicidade, o plano permitia essa opção), `static/css/
    matriz_publicacao_hora.css` (só layout — cor 100% via `var()` dos tokens
    `.company-ok/att/crit/neutral` já existentes, zero token novo),
    `data/publicacao_hora_config.json`.
  - **Testado via Playwright**: as 6 abas sem regressão; comparação numérica
    automatizada (dentro da própria página, via `page.evaluate`) da fórmula ORIGINAL
    inline de `computeGroupingPublishStat()` contra a versão pós-extração, para os 6
    dias da janela — bateram 100% (mesmos `total`/`publicados` em todos os dias);
    seletor "Por hora" renderiza sem erro (todas as células caem em "sem hora" —
    esperado, ver limitação abaixo); 2 temas (claro/escuro, `page.emulate_media`);
    zero erro de console novo além do 401 já esperado no sandbox.
  - **Limitação explícita, não validável neste ambiente**: o sandbox usado para
    implementar e testar esta tarefa não tem acesso real à API Beehus (`/api/
    atualizar` sempre 401 aqui). Não foi possível confirmar, com um token/rede reais,
    que `publishedAt` de fato vem preenchido no payload de `groupingsDetailed` — só a
    docstring do cliente HTTP (`beehus_api/consolidation.py`) documenta esse campo. O
    código é 100% defensivo quanto a isso (`.get()` com fallback `None` em toda a
    cadeia, nunca acesso direto por chave — mesmo espírito do mecanismo `hora_pub`,
    hoje morto para carteira): se o campo vier ausente, a linha "sem hora" absorve a
    publicação (como aconteceu em todo o teste desta tarefa) em vez de quebrar. **Só o
    usuário, rodando a aplicação na própria máquina com token/rede reais, pode
    confirmar se a hora real aparece preenchida.**

- **[2026-08-25, pedido do usuário] Drill-down "Processamento por Hora ×
  Empresa" na aba Company** — 2ª materialização parcial do "Alerta 7 —
  Horários Execução" (ver `docs/PLANNING.md`, mesma seção da rodada
  anterior), desta vez pela granularidade CARTEIRA (não agrupamento) e pela
  etapa **Processamento** (não Publicação) — decisão explícita do usuário,
  porque `celula.tt.c` (hora de `processedPosition.createdAt`, já formatada
  BRT) é dado REAL confirmado populado no snapshot (1825 de 6192 células),
  ao contrário de `publishedAt` de agrupamento (sub-visão agregada "Por
  hora" já existente, ainda sem confirmação ao vivo).
  - **Gatilho**: botão novo "⏱" no cabeçalho de cada dia da matriz "Por
    empresa" (`static/js/controle_cargas/matriz_company.js`). **100%
    aditivo por DOM, zero edição em `matriz_company.js`**: o botão é
    injetado (`insertAdjacentHTML`/`appendChild`) DEPOIS que
    `buildCompanyMatrix()` já desenhou a tabela — não o template do `<th>`
    dentro daquela função. Um `MutationObserver` dedicado
    (`_observarMatrizCompanyParaBotoesHora()`, novo arquivo) religa o botão
    a cada redesenho de `#company-matrix` (troca de aba, clique de foco de
    data, "Atualizar"), de forma idempotente. O clique que já existia no
    `<th data-date>` inteiro (`wireHeaderDateClicks()`, matriz.js — foco de
    data) continua funcionando SEM NENHUMA alteração: o botão novo tem seu
    próprio listener com `stopPropagation()`.
  - **Renderização**: painel inline (`#hcp-painel`, criado 1x via JS),
    injetado como irmão logo depois de `#company-matrix-wrap` dentro de
    `#panel-company` — NÃO é modal (sem backdrop). Fecha pelo botão "×" do
    painel ou clicando de novo no mesmo botão "⏱" (alterna abrir/fechar).
  - **Cálculo**: linhas = mesmos baldes de hora da sub-visão agregada
    (`montarBaldesHoraPublicacao()`, reaproveitado); colunas = companies com
    meta > 0 NESSE dia específico (meta vem de
    `computeCompanyPublishMatrix()[company].porData[dia].total`, também
    reaproveitado, sem duplicar a regra de "deveria publicar") + coluna
    final "Total" (soma de todas as companies). Reprocesso usa a MESMA hora
    `tt.c` (1ª geração/`createdAt`), nunca `tt.reproc`/`updatedAt` — decisão
    explícita do usuário. Rodapé "Fim do dia" com número absoluto e
    percentual acumulado, mesmo padrão da sub-visão agregada.
  - **Filtro de empresa da toolbar**: ignorado, sempre todas as companies
    (mesmo comportamento de `computeCompanyPublishMatrix()`/
    `computePublicacaoHoraMatrix()`, decisão explícita do usuário).
  - **Arquivos novos**: `static/js/controle_cargas/matriz_hora_company.js`
    (compute + render + abrir/fechar + o `MutationObserver` do botão "⏱",
    tudo num arquivo só, mesma decisão de simplicidade da sub-visão
    agregada) e `static/css/matriz_hora_company.css` (só o "chrome" do
    painel/botão — cor 100% via `var()` dos tokens `.company-ok/att/crit/
    neutral` já existentes, reaproveitados por `celulaPublicacaoHoraHtml()`;
    zero token novo). `index_template.html`/`index.html` ganharam 1
    `<link>` + 1 `<script>` cada (confirmado idênticos entre si via `diff`
    ao final).
  - **Nenhuma mudança de backend/Python** — confirmado por `diff` contra o
    backup pré-tarefa: `db.py`/`snapshot_builder.py`/`beehus_api/`/`app.py`
    não foram tocados (o `diff` completo do backup mostrou `app.py`/
    `pages/anomalias.py`/`pages/controle_demandas.py` divergentes, mas por
    uma mudança PRÉ-EXISTENTE e não relacionada — `CONTROLECARGAS_DATA_DIR`,
    já datada 2026-08-25 mas de uma tarefa anterior a esta, confirmada por
    inspeção do diff antes de reportar).
  - **Achado de teste, desvio reportado ao usuário**: o pedido esperava que
    a coluna "Total" do drill-down batesse com a coluna do mesmo dia na
    sub-visão agregada "Publicação por Hora", como teste de sanidade.
    Testado ao vivo com Playwright (dia 2026-07-27, snapshot local): o
    drill-down deu 251/1029 carteiras processadas (24%) contra a agregada
    30/1093 agrupamentos publicados (2%) — **os números NÃO batem**, porque
    Processamento×Carteira e Publicação×Agrupamento são entidades e etapas
    diferentes por desenho (não um bug desta implementação); as metas (1029
    carteiras mustPublish vs. 1093 agrupamentos mustPublish naquele dia)
    ficam próximas mas também não são idênticas pelo mesmo motivo.
  - **Testado via Playwright**: matriz "Por empresa" sem regressão (5
    companies, 6 dias, botão "⏱" 1x por dia); abrir/fechar o painel (botão
    "⏱" de novo no mesmo dia, e botão "×"); clique normal no `<th>` (fora do
    botão) continua focando a data como sempre (`ControleCargas.state.
    focusDate` mudou corretamente); botão nunca duplica após redesenho
    (`MutationObserver` idempotente, confirmado clicando no `<th>` — que
    dispara `buildCompanyMatrix()` — e recontando os botões no mesmo `<th>`);
    2 temas (claro/escuro, via `localStorage['controlecargas.tema']` +
    reload, cores do painel/células corretas nos dois); zero erro de
    console novo além do 401 esperado (`/api/atualizar`, sem rede real
    neste sandbox).

- **[2026-08-25, colega de time relatou "não consegui visualizar o comentário e
  responsável que salvei"] AVISO DE EDIÇÃO NÃO SALVA (Responsável/Comentário sobre
  atuação).** Investigação (sem reprodução direta do relato, causa mais provável
  identificada por leitura de código): os campos são "estilo Excel" desde
  2026-07-24 — digitar só grava em memória (`PENDING_ANNOTATIONS`), nada vai pro
  servidor até o clique em "💾 Salvar"; fechar a aba, recarregar ou navegar pra
  outra URL antes disso descartava a edição **sem nenhum aviso** (o único sinal era
  o contador no próprio botão, `💾 Salvar (N)`, fácil de não notar). Confirmado
  também que `/api/comments`/`/api/annotations` (GET lê exatamente o que POST
  grava, mesma chave) e o snapshot (`build_snapshot.py` não embute anotações) não
  têm bug — a hipótese de perda de dado por rota/cache foi descartada.
  - **Fix 100% aditivo em `static/js/controle_cargas/anotacoes.js`**: 1 listener
    novo de `window.addEventListener('beforeunload', ...)`, em module scope (mesmo
    padrão das chamadas soltas no fim de `index.js`) — se há alguma chave pendente
    em `PENDING_ANNOTATIONS` no momento de sair da página, o navegador mostra o
    diálogo nativo de confirmação. Nenhuma função existente foi tocada (nem
    `wire()`/`index.js`, nem `salvarAnotacoes()`/`executarAtualizacao()`).
  - **Verificado**: contador do botão incrementa corretamente ao digitar
    (`💾 Salvar (1)`), confirmando que o rastreio de pendência já funcionava. O
    diálogo nativo de `beforeunload` em si não é confiável de simular via
    automação headless (Chromium/CDP costuma pular esse diálogo em navegação
    programática, limitação conhecida da ferramenta de teste, não do código) — a
    verificação final desse ponto específico foi manual.
  - **Limitação aceita, não corrigida nesta rodada**: a anotação é salva por
    `referenceDate` (nunca por outro dia da janela); se a data de referência mudar
    (ex.: virada de dia, ou "Atualizar" com data nova) ENQUANTO há uma edição
    pendente da data anterior, o campo na tela passa a mostrar vazio (a pendência
    antiga fica "invisível", embora ainda exista em memória e ainda seja enviada se
    o usuário clicar Salvar). Não gera perda de dado por si só, mas é confuso —
    revisitar se o time achar que ainda causa confusão depois deste fix.

- **[2026-08-31, achado do usuário: "aqui está rodando normal e no meu colega
  não"] TELA MORTA (filtros ▾/ordenação/campos De-Até sem efeito) NA 1ª VEZ QUE
  ALGUÉM RODA O APP APÓS `git clone`/`git pull`.** Causa raiz, confirmada por
  leitura de código (não por reprodução — o sandbox não roda o servidor): (1)
  `prototype/snapshot.json` nunca é versionado (.gitignore — é gerado
  localmente, ~4MB); (2) `atualizar_snapshot_no_boot()` (app.py) tenta gerá-lo
  no boot, mas SEMPRE falha numa máquina nova, silenciosamente — desde
  2026-08-06 o token da API Beehus vive POR SESSÃO DE NAVEGADOR
  (`beehus_api/client.py::_current_session_id`, uma contextvar amarrada só
  dentro de uma requisição HTTP via `before_request`); o boot roda ANTES de
  qualquer requisição existir, então `get_token()` sempre devolve `None` ali,
  `montar_snapshot()` sempre lança `BeehusAuthError`, e o `except` do boot cai
  no fallback "segue com o snapshot.json existente" — que numa máquina nova
  não existe; (3) sem o arquivo em disco, `GET /snapshot.json` devolvia 404
  puro, e `fetch('snapshot.json').catch(...)` (index.js) só mostra 1 aviso e
  PARA — `ControleCargas.init()` (que chama `wire()`: liga filtros ▾,
  ordenação, busca, campos De/Até, botão "Salvar" de Responsável/Comentário)
  nunca roda. O botão "Atualizar" continua funcionando (ligado à parte, fora
  do `init()`, por `wireAtualizar()`) e redesenha a matriz com dado novo via
  `/api/atualizar` — mas como `wire()` nunca rodou, os filtros/ordenação
  ficam mortos para sempre, exatamente o sintoma relatado. No colega o
  problema não aparecia só porque a máquina dele já tinha um `snapshot.json`
  local de um uso anterior (o `fetch` inicial já achava sucesso de cara).
  - **Fix, só em `app.py`** (`static_files()` + `_montar_snapshot_vazio()`
    novo, perto de `_ALLOWED_STATIC_FILES`): quando `GET /snapshot.json` é
    pedido e o arquivo AINDA não existe em disco, o servidor devolve 200 com
    um snapshot **vazio mas com o schema idêntico** ao de `montar_snapshot()`
    (mesmas chaves de `meta`, `wallets: []`, `groupings: []`,
    `custodianUpload: null`) em vez de 404 — montado só com aritmética de
    calendário (`calcular_janela_grid`, mesma base de `/api/janela-padrao`),
    **sem nenhuma chamada à API Beehus**, então funciona mesmo sem token
    nenhum. Isso faz o `fetch('snapshot.json')` do front-end SEMPRE ter
    sucesso na 1ª carga — `startWithSnapshot()` → `init()` → `wire()` rodam
    normalmente (zero mudança em JS: o front-end já sabia lidar com esse
    caminho, só nunca tinha chance de entrar nele). O resto já existia e
    passou a ser aproveitado de graça: o modal "🔑 Beehus API" já abre
    sozinho quando falta token (`beehus_token.js::verificarTokenBeehus()`), e
    o refresh automático já embutido no fim de `init()`
    (`preencherCamposDataAtualizar().then(()=> executarAtualizacao())`) puxa
    o dado real via `/api/atualizar` assim que a pessoa colar o token —
    tela nasce vazia por 1 instante, mas 100% interativa, e se autopreenche
    sozinha.
  - **Verificado** (sem servidor rodando — via `app.test_client()` do Flask,
    renomeando `snapshot.json` temporariamente e restaurando em seguida):
    `GET /snapshot.json` sem o arquivo em disco → 200 com o snapshot vazio
    (schema conferido campo a campo); com o arquivo presente → continua
    servindo o arquivo real, byte a byte, sem alteração de comportamento;
    filename fora do allowlist → continua 404, como sempre.
  - **O que NÃO foi tocado**: `atualizar_snapshot_no_boot()` continua
    tentando gerar o snapshot real no boot (best-effort, como já era) —
    ela vai continuar falhando silenciosamente numa máquina sem sessão de
    navegador ainda aberta (comportamento inerente ao token por sessão,
    2026-08-06), mas isso deixou de importar: o fallback novo cobre o
    intervalo até o 1º token ser colado. Nenhuma mudança de front-end, de
    schema de dado real, nem de `build_snapshot.py`/CLI.
  - **Feito na branch `development`** (pedido explícito do usuário: também
    precisa ir para `main`) — commitar aqui e trazer/aplicar o mesmo diff em
    `main` (merge, cherry-pick, ou PR de `development` — a critério do time).

- **[2026-09-03, pedido do usuário: "tratar data inicial para não aparecer
  vazio, deixar a matriz em branco (sem nada) e na cor verde se a carteira
  não iniciou ou se já encerrou"] REINTRODUZ (de forma mais estreita) o gate
  de onboarding que tinha saído de compute_cell() em 2026-07-25.** Daquela
  vez a decisão foi confiar 100% no processo operacional ("só cadastraremos
  no Template quando realmente iniciar"), mas na prática isso nem sempre se
  confirmou — carteiras aparecendo com mockkey vermelho/âmbar (miss/wait) em
  dias fora do seu período real de atividade.
  - **Sem campo de encerramento na carteira**: investigado ao vivo o payload
    real de `GET /partner/wallets` (997 carteiras de uma empresa) — não
    existe NENHUM campo de data de encerramento no cadastro da carteira
    (só `startDateConsolidation`/`startDateReturn`, sem par de "fim";
    `trashed`/`trashedData` existem mas nenhuma das 997 veio `trashed:true`,
    e não dá pra confiar num booleano sem data mesmo se viesse). O usuário
    então localizou o campo certo, mas em outro lugar: `initialDateOnGrouping`/
    `finalDateOnGrouping`, que existem por MEMBRO de agrupamento (endpoint de
    groupings, `wallets[].{walletId, initialDateOnGrouping,
    finalDateOnGrouping}`) — dado que este app JÁ buscava e já usava pro
    roll-up de Agrupamentos (`_membro_ativo_em()`/`_membro_intersecta_janela()`,
    tarefa "Publicação por Hora" 2026-08-24), só nunca tinha sido aplicado à
    própria linha da CARTEIRA.
  - **Decisão do usuário sobre a fonte, 2 casos**: (1) carteira com
    "Agrupamentos Indexados" preenchido no Template -> usa o par
    (initialDateOnGrouping..finalDateOnGrouping) do PRIMEIRO agrupamento da
    lista (`registry.py::_membro_no_1o_agrupamento()`) como fonte ÚNICA de
    início E fim, substituindo `startDateConsolidation` pra ela; (2) carteira
    sem nenhum agrupamento vinculado -> só `startDateConsolidation` continua
    valendo (não iniciou), sem noção de "encerrou" (não existe fonte de dado
    pra isso nesse caso).
  - **Limitação aceita, reportada ao usuário**: `initialDateOnGrouping` é a
    data de ENTRADA naquele agrupamento específico, não necessariamente a
    mesma data em que a carteira começou a ser consolidada de fato — podem
    divergir se ela só foi agrupada bem depois de já estar sendo consolidada
    (nesse caso, dias reais de atividade anteriores à entrada no agrupamento
    ficariam incorretamente em branco). Aceito pelo usuário como parte da
    escolha desta fonte de dado.
  - **Mockkey novo `"fp"` (fora do período)** — célula SEM LETRA (`letter:
    ''`, "sem nada" mesmo, diferente de `notcov` que mostra "—") e cor VERDE
    PRÓPRIA (`--state-fp-bg`/`--state-fp-fg`, tokens novos nos 4 blocos de
    tema de `controle_cargas.css` — canal deliberadamente distinto de
    `--state-p-bg`/`--state-pro-bg`, que sinalizam progresso real, e de
    `--state-g1`/`g2`, cinza/"não cobrado"). Reaproveita o "estado-base"
    `not_due` de `notcov` (mesmo lugar no ranking de severidade do roll-up de
    Agrupamento — `RANKING_SEVERIDADE["not_due"]=0`, já existia) mas com
    mockkey/cor/prioridade PRÓPRIOS: `notcov` continua exclusivo de
    Agrupamento sem membro ativo (comportamento intocado); `"fp"` é o único
    mockkey que uma linha de CARTEIRA pode ter fora do estágio normal.
    `MOCKKEY_PRIORITY_RANK["fp"]=7` (depois de "p" — menos urgente que tudo).
  - **`wallet_fora_do_periodo(wallet, data)`** (snapshot_builder.py, novo) —
    chamada célula a célula em `compute_wallet_row()`, ANTES de
    `compute_cell()`: quando True, a célula vira `{"s":"fp","d":data}` direto
    (sem chamar compute_cell/compute_overlays/montar_horarios_celula/
    montar_tooltip — literalmente nenhum cálculo a mais rodou pra esse dia).
  - **Todo check de "tem pendência" do app ganhou `"fp"` junto de `"p"`/`"cD"`**
    (carteira fora do próprio período não é uma pendência): `ainda_nao_
    publicada` (fura-fila de "Comprada"), classificação de bloco de
    Agrupamento (`classificar_grouping_em_bloco`), lista de "não processadas"
    do tooltip de Agrupamento (`montar_tooltip_celula_grouping`),
    `ids_com_pendencia`/fetch de issuesDetail (`build_snapshot.py` — bônus:
    menos chamada à API pra carteira fora do período), e o front-end
    (`paineis.js::semPendencia`, drill-down de Agrupamento).
  - **Arquivos tocados**: `registry.py` (novo campo + helper
    `_membro_no_1o_agrupamento`), `snapshot_builder.py` (mockkey + gate +
    checks de pendência), `build_snapshot.py` (2 checks de pendência),
    `excel_report.py` (`_PREENCHIMENTO_XLSX["fp"]`), `static/css/
    controle_cargas.css` (tokens `--state-fp-*` + `.s-fp`), `static/js/
    controle_cargas/state.js` (`STATES.fp` + `PRIORITY_ORDER`), `static/js/
    controle_cargas/matriz.js` (linha nova na legenda `colorRows`),
    `static/js/controle_cargas/paineis.js` (`semPendencia`), `static/js/
    controle_cargas/exportar.js` (`XML_BG`/`XML_FG`). Filtro "Status (Data
    Referência)"/legenda/chip de prioridade não precisaram de código novo —
    são 100% data-driven a partir de `STATES`/`PRIORITY_ORDER`.

- **[2026-09-11, relato do usuário: "estou com problemas ao selecionar data e
  atualizar, às vezes fica em data antiga ou no dia 03/08"] MATRIZ PRESA NUMA
  DATA ANTIGA — 3 causas independentes, todas corrigidas.**
  1. **Host da API Beehus desatualizado** (causa do print enviado: "Erro ao
     atualizar: ... Read timed out (read timeout=30)"). Medido nesta máquina:
     `controladoria.beehus.com.br` (host antigo) dá timeout de leitura em
     TODA chamada, mesmo sem token; `api.controladoria.beehus.com.br`
     responde 401 em 0,1s no MESMO path. Com toda chamada estourando 30s,
     `/api/atualizar` sempre falhava e a tela continuava com o snapshot
     estático. Fix: `BASE_URL` de `beehus_api/client.py`. **Os apps-irmãos
     (`beehus-swat`, `conciliacao`, `beehus-rotinas`) têm cada um a SUA cópia
     do client, todas ainda no host antigo — precisam do mesmo ajuste.**
  2. **`snapshot.json` congelado servido como se fosse atual** (a origem
     do "dia 03/08"): o arquivo desta máquina estava em
     `meta.referenceDate = 2026-08-03` porque `atualizar_snapshot_no_boot()`
     SEMPRE falha desde 2026-08-06 (token é por sessão de navegador, o boot
     roda fora de requisição HTTP — ver nota de 2026-08-31) e `/api/atualizar`
     devolve o snapshot pro navegador sem nunca reescrever o arquivo. Todo
     carregamento de página pintava a matriz inteira em 03/08, e ela só saía
     de lá se o refresh automático do `init()` desse certo. Fix em `app.py`:
     `_snapshot_json_esta_desatualizado()` (novo) + `static_files()` — um
     arquivo com referenceDate anterior à referência de hoje passa a cair no
     MESMO caminho do arquivo ausente (`_montar_snapshot_vazio()`, que já
     existia desde 2026-08-31). A tela nasce vazia com as datas CERTAS e o
     refresh a preenche, em vez de exibir dado de semanas atrás como se fosse
     de hoje.
  3. **Corrida entre atualizações simultâneas** (o "às vezes"): a tela dispara
     `/api/atualizar` de 4 lugares (refresh automático do `init()`, clique,
     Enter nos campos, e logo após colar o token) e cada chamada leva 30-100s
     — a resposta que chegasse POR ÚLTIMO sobrescrevia `SNAPSHOT`, mesmo sendo
     de uma janela mais antiga. Fix em `static/js/controle_cargas/atualizar.js`
     + `filtros.js`: `state.sequenciaAtualizacao` numera cada pedido e só a
     resposta do mais novo mexe na tela; `state.sincronizacaoDataInicial`
     guarda o recálculo pendente do campo "de" e `executarAtualizacao()`
     espera por ele antes de montar a URL (evita mandar a janela velha e tomar
     400 ao clicar Atualizar logo depois de trocar o "até"); o rótulo do botão
     voltou a ser texto fixo (com 2 pedidos no ar, o 2º capturava
     "Atualizando..." como "original" e o botão ficava assim pra sempre).
     `executarAtualizacao()` virou uma função fina (espera a sincronização) +
     `enviarAtualizacao()` (monta e envia o pedido), CLAUDE.md §3.
  4. Campos De/Até ganharam `autocomplete="off"` (`index.html` +
     `index_template.html`, mantidos idênticos): o navegador restaurava o
     valor digitado numa sessão anterior no F5, e
     `preencherCamposDataAtualizar()` não sobrescreve campo já preenchido —
     a data velha sobrevivia e o Atualizar só reenviava ela.
  - **Verificado**: `GET /snapshot.json` via `app.test_client()` com o arquivo
    velho em disco → devolve a janela de hoje (2026-08-31..2026-09-08) com
    `wallets: []` em vez do grid de 03/08; allowlist de estáticos intacta
    (`/db.py` continua 404). O caminho com API real depende de token/rede e
    só pode ser confirmado pelo usuário na própria máquina.

- **[2026-09-15, relato do usuário: "estou mudando a data, dando um atualizar
  e não está mudando" / "ficou atualizando e não foi para o dia 09/09"]
  ATUALIZAR DEMORANDO ~9 MINUTOS E ÀS VEZES FALHANDO COM 500 — não era a data.**
  Diagnosticado pelo log do servidor: a data pedida SEMPRE chegou certa
  (`/api/atualizar?...data_final=2026-09-09`); o que acontecia era o pedido
  demorar 542s ou morrer em 500, e `atualizar.js` mantém o SNAPSHOT antigo na
  tela quando falha (comportamento deliberado desde 2026-07-30 — nunca deixar
  a matriz em branco), então a coluna REF continuava no dia anterior e parecia
  que o clique não tinha feito nada. Medido com `beehus_api.client.
  enable_timing()` num clique real: **683 chamadas à API Beehus, 126 delas 429
  (18%)**. Três correções independentes:
  1. **Cache de coleções expirando no meio da própria execução**
     (`cache.py::CacheTTL.congelado()`, novo + `build_snapshot.montar_snapshot()`).
     O TTL de 120s pressupunha que quem usa o cache termina em bem menos que
     isso — deixou de ser verdade quando a API passou a aplicar rate limit
     (commit de 2026-09-11) e o build foi de ~90s para ~9min. O cache vencia
     ANTES do fim da execução que o tinha populado, e o registry inteiro era
     buscado de novo: no log de instrumentação, TODA chamada
     `/beehus/securities/<id>` (1 por ativo de explosão, `db.py::_resolver_
     explosao`) aparecia exatamente **2x** num único clique. `congelado()` é
     um context manager reentrante e thread-safe que suspende a expiração — de
     propósito, SÓ para o que foi guardado DEPOIS do congelamento começar: a
     1ª leitura de cada execução continua buscando dado fresco (não serve um
     valor de horas atrás só porque alguém congelou agora) e a partir daí ela
     reaproveita o que ela mesma buscou.
  2. **Backoff de 429 privado de cada thread e sem jitter**
     (`beehus_api/client.py::_esperar_pausa_global()`/
     `_pausa_global_por_rate_limit()`, novos). O commit de 2026-09-11 já tinha
     baixado o fan-out (40→6) e ampliado o retry (5→8 tentativas), mas cada
     thread continuava fazendo backoff sozinha: as 6 tomavam 429 quase juntas,
     dormiam o MESMO tempo e voltavam a disparar juntas — efeito manada, que
     rende outra rodada de 429 em vez de uma fila que escoa. Agora o freio é
     ÚNICO do processo: quem toma 429 publica até quando ninguém deve tentar
     (`_rate_limit_pausa_ate`) e TODA chamada respeita essa pausa antes de
     sair, inclusive as threads que ainda nem tinham tomado 429; a espera de
     cada thread sai com jitter de ±50% pra elas não voltarem a bater no
     servidor no mesmo milissegundo. A pausa usa `max()`, então 6 threads na
     mesma rodada convergem para uma pausa só, não seis. `Retry-After`
     continua com prioridade quando vier (hoje o 429 vem como página HTML, sem
     `Retry-After` nem `X-RateLimit-*` — **vale insistir com o time do backend
     por esses headers**, é o que permitiria o cliente se auto-regular de
     verdade em vez de adivinhar).
  3. **Nenhum sinal de vida durante 9 minutos** (`progresso_atualizacao.py` e
     `static/js/controle_cargas/progresso.js`, novos + rota
     `GET /api/atualizar/progresso`). O botão ficava o tempo todo em
     "Atualizando..." sem nada mudar na tela, indistinguível de travado — e o
     efeito colateral era o pior: quem achava que travou clicava de novo, e o
     2º pedido DOBRAVA a carga em cima do mesmo rate limit que causava a
     lentidão. Agora `montar_snapshot()` publica a etapa corrente (os mesmos
     6 rótulos "[n/6]" que ela já imprimia no console) e o fan-out de `db.py`
     publica quantas das N consultas já terminaram; a tela lê de 2 em 2s e
     mostra `Atualizando… [3/6] buscando dados da esteira — 37/90 consultas ·
     há 4min 12s`. O progresso é por SESSÃO (mesmo sid opaco do token, que já
     é propagado pros workers do fan-out via `bind_session_id()`), porque duas
     pessoas atualizando ao mesmo tempo têm andamentos diferentes. É 100%
     enfeite: sem sid (CLI/boot) vira no-op, e nenhum erro daqui pode derrubar
     um build.
  - **`montar_snapshot()` virou wrapper fino** (CLAUDE.md §3) que só abre os 2
    contextos da execução inteira (cache congelado + progresso) e delega pra
    `_montar_snapshot()`, que é o corpo de sempre, inalterado — mesmo padrão
    do split `executarAtualizacao()`/`enviarAtualizacao()` de 11/09.
  - **Achado colateral, NÃO corrigido aqui** (fora do escopo desta tarefa,
    precisa de decisão do time): esta máquina roda 3 apps ao mesmo tempo
    (5050 ControleCargas, 5001 Conciliação, 5000 beehus-swat) e os 3
    compartilham o MESMO `~/.swat/beehus.token` e a MESMA cota de rate limit
    da API. O arquivo de token estava inclusive no formato ANTIGO (`{token,
    set_at}` na raiz, pré-multi-sessão) — um app-irmão sobrescreveu o formato
    multi-sessão que este app grava. Além disso os apps-irmãos ainda não têm
    o freio compartilhado de 429 nem o `BASE_URL` novo (ver nota de
    2026-09-11), então continuam gastando a cota sem se auto-regular.
  - **Verificado**: `cache.CacheTTL.congelado()` (valor guardado antes do
    congelamento continua expirando pelo TTL; guardado dentro não expira;
    reentrante; exceção no meio não deixa congelado pra sempre);
    `progresso_atualizacao` (no-op sem sid e fora de execução, contador nunca
    passa do total, entrada limpa ao sair inclusive por exceção); freio de 429
    (6 threads convergem numa pausa só em vez de somar 6, jitter de ±50%,
    `Retry-After` válido tem prioridade e inválido não explode,
    `_esperar_pausa_global()` custa zero sem pausa e segura de verdade com
    pausa); `GET /api/atualizar/progresso` via `app.test_client()` (200 com
    `{"emAndamento": false}`, rotas vizinhas e allowlist de estáticos
    intactas); e um build COMPLETO contra a API real (janela 01/09..09/09) —
    ver a mensagem do commit para os números medidos.

- **[2026-09-22, pedido do usuário: "não atualizar ao executar a primeira vez,
  permitir selecionar data e company e depois dar um atualizar clickando no
  botão"] A TELA NÃO CONSULTA MAIS NADA SOZINHA + SELETOR DE EMPRESA QUE ESCOPA
  O "ATUALIZAR".** Com o clique custando ~9 minutos (nota de 15/09), os dois
  disparos automáticos que existiam viraram estorvo: `init()` (`index.js`)
  disparava um `executarAtualizacao()` assim que a página carregava, e
  `salvarTokenBeehus()` (`beehus_token.js`) disparava outro assim que o token
  era colado — os dois sempre na janela default e em TODAS as empresas. Quem
  queria outra data ou outro escopo esperava essa consulta terminar (ou
  disputava com ela, cenário que já tinha motivado o `sequenciaAtualizacao` de
  11/09).
  - **Fim do automático**: `init()` agora só deixa a tela PRONTA — preenche
    De/Até (`preencherCamposDataAtualizar`), preenche o seletor de empresas
    (`preencherSelectEmpresas`, nova) e escreve o convite na `.atualizar-msg`
    (`convidarParaAtualizar`, nova em `index.js`, que nunca sobrescreve uma
    mensagem já existente de resultado/erro). `salvarTokenBeehus()` faz o mesmo
    par depois de o token ser aceito (o seletor precisa dessa 2ª chance: no
    boot `/api/empresas` responde 401, ainda não há token). Nenhuma outra
    função foi tocada — `wireAtualizar()`, `executarAtualizacao()` e
    `enviarAtualizacao()` são as mesmas.
  - **Seletor "Empresa"** (`#empresa-atualizar`, `index_template.html` +
    `index.html`, ao lado dos campos de data; CSS novo `.datefield select`): vai
    como `company_id` em `GET /api/atualizar`. É escopo de CONSULTA, não filtro
    de tela — `_montar_snapshot()` aplica `_filtrar_cadastro_por_empresa()`
    (nova, `build_snapshot.py`) logo depois do passo `[1/6]`, **antes** do
    fan-out da esteira, então o clique custa uma fração das chamadas de "Todas
    as empresas" (a fila de `db.py` é data × empresa × tipo). O snapshot carrega
    o filtro aplicado em `meta.companyIdFiltro`/`meta.companyFiltro`, que a tela
    usa pra dizer "Empresa: X" no fim da mensagem de sucesso e pra avisar
    "Nenhuma carteira do cadastro em X" quando a empresa não tem carteira no
    `TemplateCarteiras.xlsx` (senão a grade vazia pareceria falha do Atualizar).
  - **`GET /api/empresas`** (rota nova, fina) → `db.listar_empresas()` (nova) =
    1 chamada a `list_companies()`. De propósito **não** reaproveita
    `carregar_colecoes_pequenas()`: aquela também busca wallets/groupings/
    explosão de TODAS as empresas (2-37s no timing `colecoes_pequenas` + os de
    explosão) — caro demais pra preencher um `<select>` no carregamento da tela.
    O preço dessa escolha é o seletor listar as ~19 empresas que o TOKEN vê, não
    só as ~5 com carteira no cadastro.
  - **[mesmo dia, 2 relatos seguidos do usuário]** (a) "não aparece mais a
    company para selecionar": `preencherSelectEmpresas()` roda no
    carregamento, quando ainda não há token colado (e o token se perde a cada
    restart do servidor) — o 401 era engolido pelo `.catch()` e a caixinha
    ficava só com "Todas as empresas", indistinguível de "esta conta não tem
    empresa". Agora o motivo vai DENTRO do seletor como opção desabilitada
    ("— cole o token da API Beehus para listar as empresas —", a mensagem do
    backend, ou "nenhuma empresa visível para este token"), e há 1 chance a
    mais de preencher: depois de um Atualizar bem-sucedido (prova de que há
    token). No mesmo lote, os chips de Company da grade ganharam a dica "as
    empresas aparecem aqui depois do primeiro ↻ Atualizar" quando
    `meta.companies` está vazio — efeito colateral de a tela não consultar
    mais sozinha, e a outra leitura possível do mesmo relato. (b) "pode
    manter do jeito que está, mas também permitir digitar a company e
    autocompletar": campo `#empresa-busca` AO LADO do `<select>` (que continua
    sendo a fonte do `company_id`) — filtra por nome sem acento/caixa ou por
    CNPJ, com `<datalist>` pro autocompletar nativo; sobrando 1 empresa, ela
    já fica escolhida. A empresa ESCOLHIDA nunca é removida das opções pelo
    filtro: se sumisse do DOM, o select voltaria pra "Todas as empresas"
    sozinho e o próximo clique consultaria todas as empresas (9 min) sem
    ninguém pedir. Enter no campo de busca é neutralizado de propósito.
  - **Limite aceito**: com filtro ativo, `mapear_carteiras_compradas()` enxerga
    só as carteiras daquela empresa — o cruzamento "comprada por carteira de
    OUTRA empresa" (13/08) não é marcado enquanto o filtro estiver ligado; some
    ao voltar pra "Todas as empresas". Documentado na docstring da função nova.
  - **Verificado** (sem derrubar o servidor de 5050, via `app.test_client()`):
    `/api/empresas` e `/api/atualizar?...&company_id=...` respondem o 401
    amigável de token ausente (rota registrada e erro tratado, nunca 500 cru);
    `/api/janela-padrao` intacto; `/` serve o `<select>` novo e os `.js` servem
    as funções novas; `_filtrar_cadastro_por_empresa()` testada com cadastro
    sintético (empresa com carteira → só ela e o agrupamento dela; empresa
    inexistente → tudo vazio, que é o caminho da mensagem "Nenhuma carteira do
    cadastro"). **Não testado contra a API real** — o token do dia é do
    navegador do usuário; o teste ponta a ponta (escolher empresa, clicar,
    comparar o tempo com o de "Todas as empresas") ficou para ele.

- **[2026-09-22, relato do usuário: "um colega ainda não está aparecendo o
  responsável e comentários, mesmo que são gravados e consumidos em uma base na
  rede onedrive" + "sendo direto, não está aparecendo os responsáveis em 16/09
  para o colega"] CAMINHO DA PASTA COMPARTILHADA AGORA SE ACHA SOZINHO EM
  QUALQUER MÁQUINA + RODAPÉ DE DIAGNÓSTICO SEMPRE VISÍVEL.** Com o colega na
  MESMA data de referência (16/09) que a máquina onde aparece, a diferença de
  data ficou descartada e sobrou a origem do dado. Levantado com os dados reais
  do arquivo compartilhado: 686 anotações, 35 delas em 16/09, gravadas às
  14:47 de 22/09 — ou seja, o dado existe e está lá.
  - **Causa nº 1 (corrigida), `utils/caminhos.py`**: a pasta compartilhada era
    procurada num literal ÚNICO (`~/Beehus Tecnologia Ltda/Beehus Tecnologia
    Ltda - Documentos/SWAT/...`). Esse nome é o que o OneDrive dá à biblioteca
    NESTA máquina; em outra ele muda por motivos banais e invisíveis — Windows/
    OneDrive em inglês sincroniza "... - Documents" (sem o "o"), a pessoa pode
    ter a biblioteca no OneDrive pessoal (`OneDrive - Beehus Tecnologia Ltda/
    SWAT/...`, um nível a menos) ou ter renomeado a pasta. Qualquer variação
    caía no `data/` do próprio clone — uma ILHA que, num clone novo, não tem
    `wallet_annotations.json` nenhum (.gitignore), dando exatamente "o
    responsável não aparece pra mim", sem erro na tela. Agora, além do caminho
    canônico (tentado primeiro, sem varrer nada), há `_procurar_data_dir_
    compartilhado()`: lista as pastas com "beehus" no nome dentro de
    `Path.home()` e das raízes de `OneDrive`/`OneDriveCommercial` (e dos pais
    delas — biblioteca do SharePoint fica AO LADO do OneDrive pessoal, não
    dentro), testando o sufixo estável `SWAT/ControleCargas/prototype/data` até
    2 níveis. Medido: 0,03s, e só roda quando o caminho canônico falha. O
    resultado é memorizado por processo.
  - **`descrever_data_dir()` (nova) virou a fonte única**: devolve
    `{caminho, origem, compartilhada, mensagem}`; `resolver_data_dir()` e
    `diagnosticar_data_dir()` viraram wrappers finos dela (CLAUDE.md §3), então
    os 4 módulos que já as chamavam (app.py, build_snapshot.py, pages/
    anomalias.py, pages/controle_demandas.py) não mudaram nada.
  - **`custodian_upload.py` seguia o mesmo literal** [lembrete do usuário: "o
    caminho no onedrive deve seguir o usuário dele"]: `Path.home()` resolvia o
    USUÁRIO, mas "Beehus Tecnologia Ltda/... - Documentos" continuava fixo.
    Passou a montar o caminho do `Cliente Beehus/ControleUpload.xlsx` a partir
    de `resolver_raiz_biblioteca()` (nova em utils/caminhos.py, derivada do
    DATA_DIR já resolvido) — as duas fontes externas do app seguem agora a
    mesma máquina/usuário. Override `CONTROLECARGAS_UPLOAD_XLSX` intacto.
  - **Causa nº 2 (agora visível): o diagnóstico existia, mas ninguém via.** A
    mensagem de AVISO da ilha (2026-09-21) só era impressa na 1ª linha do log
    de boot — e `start.ps1` sobe o Python com `-WindowStyle Hidden` redirecionando
    stdout pra `.controlecargas-server.out`. Agora `GET /api/diagnostico-dados`
    (rota nova, fina) devolve pasta dos dados + se é a compartilhada + contagem
    REAL de comentários/anotações lidos do disco (mesmas `_load_comments()`/
    `_load_annotations()` das rotas de verdade) + mtime/tamanho de
    `alert_comments.json`/`wallet_annotations.json`/`TemplateCarteiras.xlsx` +
    **a pasta de onde o CÓDIGO subiu**. `static/js/controle_cargas/
    diagnostico.js` (arquivo novo) pinta isso num rodapé SEMPRE visível
    (decisão do usuário), em faixa vermelha quando a pasta não é a do time.
  - **O rodapé também mata a dúvida da data**, sem mudar a semântica da
    anotação (decisão do usuário: "precisa funcionar do mesmo jeito que
    funciona na minha máquina, ao selecionar a data e dar atualizar"): ele conta
    quantas anotações existem PARA A DATA DE REFERÊNCIA EM TELA
    (`resumirAnotacoesDaDataEmTela()`, lê `ControleCargas.ANNOTATIONS` já
    carregado). "0 anotações na data de referência em tela" com o arquivo
    recente = a pessoa está olhando outra data; nada quebrado.
  - **Redesenho sem acoplar em ninguém**: o rodapé reconsulta o servidor a cada
    5 min (mtime/contagens) e se redesenha localmente a cada 10s a partir do que
    já está em memória — assim acompanha a troca de data de um "Atualizar" e as
    anotações que `sincronizacao.js` traz do colega, sem precisar de handler
    dentro de `enviarAtualizacao()`/`loadAnnotations()` (zero edição nessas).
  - **Verificado** (sem derrubar o servidor de 5050, via `app.test_client()` e
    chamadas diretas): resolução nos 3 caminhos — canônico quebrado achando a
    variante em 0,03s, ilha (nenhuma biblioteca) devolvendo `compartilhada:
    False` com a mensagem de AVISO, e override `CONTROLECARGAS_DATA_DIR`
    vencendo os dois; `resolver_raiz_biblioteca()` devolvendo a raiz certa e
    `None` na ilha; `custodian_upload.CONTROLE_UPLOAD_XLSX` apontando pro
    arquivo real (confirmado `os.path.isfile`); `GET /api/diagnostico-dados`
    200 com pasta/contagens/mtimes corretos (89 comentários, 686 anotações,
    anotações gravadas 22/09 14:47); `/` servindo o rodapé e o `<script>`;
    `diagnostico.js` e o CSS servidos. **O que só o usuário pode confirmar**: o
    rodapé na máquina DO COLEGA — é lá que ele diz qual das três causas é
    (pasta local, arquivo desatualizado pelo OneDrive, ou código velho).
  - **O que este commit NÃO resolve, e precisa de decisão**: quem sobe o app da
    cópia obsoleta dentro do OneDrive (`SWAT/ControleCargas/prototype`, código
    de 21/08 — log `.controlecargas-server-Adzo-7.err` mostra a máquina "Adzo"
    rodando ela em 16/09) não recebe NADA disto, nem as correções de 31/08,
    11/09 e 21/09 (entre elas a vigência do comentário pelo relógio local e o
    `sincronizacao.js`). Nenhuma mudança no código novo alcança quem roda o
    código velho — a única saída é neutralizar/remover aquela cópia, pendente
    de confirmação do usuário desde 21/09.

- **[2026-09-24, pedido do usuário: "Carteiras que compram carteiras que explodem,
  seguir a maior carência entre a cadastrada no Template Carteiras e a da Carteira
  explodida"] DEFASAGEM HERDADA DA EXPLOSÃO.** Se A tem B (também do Template) em
  `explodedWalletIds`, o prazo de A usa `max(Defasagem de A, Defasagem efetiva de B)`.
  - `snapshot_builder.aplicar_defasagem_herdada_da_explosao(registry_por_id)` roda 1x
    em `_montar_snapshot()` logo depois de `mapear_carteiras_compradas()` e grava em
    cada carteira `lagBizDaysEfetiva` + `defasagemHerdadaDe` (nome da explodida que
    impôs a carência). `lagBizDays` (o cadastrado) NÃO muda. `compute_cell()` usa
    `defasagem_efetiva_du(wallet)` — logo estágio, Atraso/Pauta, SLA do tooltip e
    ordenação já saem com a carência herdada.
  - **Transitivo** (A→B→C: A herda a de C se for a maior da cadeia), com defesa contra
    ciclo (A↔B não trava). "M"/vazio conta como 0 (mesma regra do prazo). Empate não
    herda (a cadastrada vale).
  - Exibição: painel de detalhe mostra "D-n (herdada de X; cadastro D-m)" em violeta
    (`montarTextoDefasagemPainel`, paineis.js); coluna Defasagem do Excel exportado
    vira "D-n (herdada de X)" (`montarDefasagemExcel`, exportar.js).
  - **Limite**: com filtro de empresa ativo, só enxerga explodidas da MESMA empresa (mesmo
    limite de `mapear_carteiras_compradas`).

- **[2026-09-24, pedido do usuário] ABA "CARTEIRAS NÃO CADASTRADAS".** Carteiras que o
  token vê no Beehus (não trashed) e cujo WalletID não está no TemplateCarteiras.xlsx.
  - Backend: `pages/carteiras_nao_cadastradas.py` (blueprint, `GET
    /api/carteiras-nao-cadastradas`) + 2 leituras novas em `db.py`
    (`listar_nomes_entidades`, `buscar_ultima_carga_por_carteira`). Frontend:
    `static/js/carteiras_nao_cadastradas/` (state/filtros/resultados/index) +
    `static/css/carteiras_nao_cadastradas.css`; troca de aba aditiva (mesma técnica de
    Demandas/Anomalias — nenhum listener existente alterado).
  - **Nova** = criada há < `DIAS_UTEIS_SINALIZACAO_NOVA` (10) du → badge "Nova · N du"
    (du restantes), linha no topo e contador no botão da aba. Depois disso perde o
    badge e continua na lista. **Data de criação** sai do próprio WalletID (ObjectId:
    8 primeiros hex = timestamp) — a API de wallets não expõe `createdAt`.
  - **Verificador de carga** = "Carga últimos 45 dias?" (`DIAS_CORRIDOS_VERIFICACAO_CARGA`,
    dias corridos): existe unprocessedSecurityPositions na faixa (1 chamada por empresa,
    endpoint aceita faixa de datas) + coluna "Última carga".
  - Ordem: novas (mais recente primeiro) → com carga recente → resto. Consulta só no 1º
    clique na aba e no "↻ Atualizar lista" (custa chamadas à API; a 1ª a frio inclui o
    catálogo de wallets + explosão, que o Atualizar principal já deixa em cache por 120s).
  - **Colunas** definidas 1x em `COLUNAS` (state.js) — tabela, filtro de cabeçalho e Excel
    leem de lá. **Filtro ▾ por cabeçalho** (pedido do usuário: "poder filtrar cabeçalho
    também") em toda coluna, estilo Excel e em cascata, via `static/js/utils/
    filtro_popover.js` — genérico, mesmas classes `.th-filter-*` da Matriz. O
    `filtro_cabecalho.js` da Matriz NÃO foi tocado (é amarrado a `state.filtroValoresColuna`/
    `buildMatrix`); o util novo é candidato a substituí-lo numa refatoração futura.
  - **Exportar Excel** (`exportar.js` da aba): .xls SpreadsheetML com o que está NA TELA
    (filtros aplicados), mesma ordem/colunas, novas em âmbar, autofiltro + cabeçalho
    congelado, e aba "Parâmetros" (consulta, faixa de carga, regra de Nova). Reusa
    `ControleCargas.ssCell` em vez de duplicar o gerador de célula.
  - **Não testado contra a API real** (sem token na máquina de desenvolvimento) — testado
    com `app.test_client()` + dados sintéticos (401 amigável sem token; excluídas e já
    cadastradas ficam de fora; nova no topo; última carga por carteira); JS em Edge
    headless (21 checagens: troca de aba, badge, filtro de cabeçalho/cascata, Limpar, só
    novas, escape de HTML, XML bem-formado); .xls aberto no Excel via COM (2 abas,
    acentos corretos, autofiltro e congelamento ativos).

- **[2026-09-24, pedido do usuário: "quero dois filtros Gerais, Selecionar
  Todos Com Divergencia de Rentabilidade e selecionar Todos Pauta, posso
  selecionar esses dois filtros juntos. Capturar todos no range de datas.
  Também quero que o Excel traga os alertas desse Range de datas e não só da
  data Referencia. Celulas Pauta da matriz do Excel devem ter um contorno
  diferente"] FILTROS QUE OLHAM A JANELA INTEIRA (tela e Excel).** Até aqui
  TODO filtro de alerta era por UMA data: os do cabeçalho perguntam "como esta
  carteira está NESTE dia?" (`statusRef` / `statusDia:<data>`, 29/07 e 24/09) e
  as colunas de auditoria do Excel só liam a data de referência (decisão de
  23/07, agora revertida). Quem queria "tudo que teve divergência na semana"
  tinha que abrir o ▾ de cada dia, um por um.
  - **2 chips novos na faixa de filtros** (`#filters`, ao lado dos chips de
    empresa, sob o rótulo "GERAIS:"): "Todos com Divergência de Rentabilidade"
    (overlays `div`/`div_strong` — o badge "Rent", que respeita os 2 campos de
    limiar da toolbar) e "Todos Pauta" (overlay `pauta`, badge fúcsia do dia
    exato da Defasagem). `linhaTemOverlayNaJanela()` varre `cells[].ov` da
    linha inteira, então basta o alerta existir em QUALQUER dia do range.
    Servem igual pra Carteiras e Agrupamentos (os dois têm `cells` com `ov`).
  - **Os dois juntos SOMAM (união, não interseção)** — decisão registrada em
    `linhaPassaNosFiltrosGerais()`: marcar os dois é montar a lista de trabalho
    do dia (tudo que pede atenção), não isolar o punhado que tem os dois
    alertas ao mesmo tempo. Se o time preferir interseção, é trocar o `.some(`
    por `.every(` nessa função — 1 linha.
  - **Convivem com os filtros que já existiam**: `applyFilters()` aplica os
    gerais ANTES dos de coluna, então empresa + ▾ de cabeçalho + busca +
    gerais se acumulam (E entre os grupos, OU dentro de cada um). Canal visual
    próprio (contorno/fundo fúcsia, `.chip-geral`) pra não se confundir com os
    chips de empresa, que usam o verde `--accent` na mesma faixa.
  - **Excel — colunas de alerta agora cobrem a janela**: `Δ Rent bp`,
    `Fora de sequência`, `Issues`, `Alertas do Grid` e `Comentário` passaram de
    "(data de referência)" para "(dd/mm–dd/mm)", com o conteúdo dia a dia
    dentro da própria célula (`10/09: Rent forte · 15/09: Pauta do dia`), via
    `montarColunaPorDiaExcel()` — 1 função genérica que recebe "como ler o
    valor de um dia", em vez de 5 laços iguais. `montarOverlaysCsvExcel()` e
    `montarComentarioNaDataExcel()` continuam sendo POR DATA (quem varre é a
    função nova). **Responsável/Comentário sobre atuação continuam por data de
    referência**: a anotação é gravada por `referenceDate` (anotacoes.js), não
    existe "a anotação do dia 15" pra listar.
  - **Células Pauta no Excel ganharam contorno**: cada estilo `st_<estado>`
    ganhou o gêmeo `st_<estado>_pauta`, com a MESMA pintura de estágio mais um
    contorno fúcsia grosso (`#C026D3`, o mesmo `--overlay-pauta` da tela;
    `ss:Weight="3"`). Mantém a separação de canais que a tela já usa — fundo
    diz o estágio, o contorno/badge diz o alerta. A 1ª linha da planilha
    (a do "Relatório gerado em") passou a explicar o contorno e o range.
  - **O Excel já sai filtrado**: `buildExcelXml()` usa `sortedRows()`, que
    passa por `applyFilters()` — ligar os chips e baixar a planilha entrega só
    as linhas filtradas, sem nenhum código novo.
  - **Verificado** (Playwright na tela real, 5050, com snapshot SINTÉTICO
    injetado por JS — dado real não garante alerta no dia que interessa
    testar; 21 verificações): chips aparecem/acendem; "divergência" pega a
    carteira cujo único alerta está no 1º dia da janela (o caso que o filtro
    por coluna da Ref não pegava); "pauta" idem no meio da janela; os dois
    juntos devolvem a UNIÃO (3 de 4 carteiras); empresa + gerais continuam se
    acumulando; no XML do Excel, cabeçalho com `10/09–16/09`, alertas dia a
    dia (`10/09: Rent forte · 15/09: Pauta do dia`), Δ Rent listando o dia do
    alerta antigo, estilo `st_wu_pauta` declarado com `ss:Weight="3"` e
    `#C026D3` e usado exatamente nas 2 células de pauta; zero erro de JS.
    Conferido à parte, no `snapshot.json` real (1032 carteiras), que o shape
    que as colunas novas leem é o esperado (`tt.div.bp` numérico, `tt.seq`
    bool, `tt.issues` string) e que `div`/`div_strong` aparecem de verdade
    (40 carteiras na janela daquele arquivo).
  - **Efeito colateral conhecido, aceito**: com janela de 6 du e carteiras que
    ficam em atraso a semana toda, a coluna "Alertas do Grid" vira uma lista de
    até 6 itens por carteira — é o que "trazer os alertas do range" significa.
    Se ficar verboso na prática, o passo seguinte seria agrupar por tipo
    ("Atraso forte: 27/07, 28/07, …") em vez de listar por dia.
  - **[REVISADO no mesmo dia, relato do usuário: "não achei que as seleções do
    filtro ficaram boas, não consigo identificar quando estão selecionados,
    melhore a cor de seleção e layout"]** A 1ª versão errou em duas coisas.
    (a) **Estado só por cor**: ligado era "fundo fúcsia", desligado era "letra
    e contorno fúcsia" — a diferença some num relance e some de vez pra quem
    não distingue bem as cores. Agora o estado é redundante em 3 canais:
    caixinha **☐/☑** (`::before`, então `refreshFilterUI()` só troca a classe),
    **peso da fonte** (750) e **anel** em volta (`box-shadow` com os tokens
    novos `--overlay-pauta-wash`/`--accent-wash`, definidos nos 4 blocos de
    tema); o DESLIGADO virou neutro como qualquer chip, pra o ligado ser o
    único colorido. Os chips de empresa ganharam o mesmo tratamento, com **✓**
    no selecionado. Todos os chips ganharam `role="button"` + `aria-pressed` +
    `tabindex` (o estado também passou a existir pra leitor de tela) e
    `:focus-visible`. (b) **Layout**: os 2 gerais ficavam DEPOIS de até 20
    chips de empresa, quebrando pra 2ª linha e sumindo. Agora abrem a faixa,
    num grupo com moldura e rótulo "ALERTAS NA JANELA", separado das empresas
    por uma barra fina (`.filtros-grupo`/`.filtros-divisor`).
    **Verificado** (Playwright, 10 verificações, tema claro E escuro): grupo é
    o 1º filho de `#filters`; divisor presente; `::before` "☐ " no desligado e
    "☑ " no ligado; `aria-pressed` acompanhando; ligado com anel e
    `font-weight:750`; chip de empresa com "✓ "; no escuro o ligado continua
    preenchido e com anel; zero erro de JS.
  - **[AMPLIADO 2026-09-24, pedido do usuário: "novo filtro, todos com
    divergencia de rentabilidade só na Pauta. Mude essa cor rosa"]** 3º filtro
    geral, **"Todos com Divergência na Pauta"** — e ele NÃO é a soma dos dois
    primeiros: é mais estreito, exige os dois badges na **MESMA célula**
    (divergência no próprio dia da pauta). Os dois alertas são overlays
    independentes da mesma célula (`compute_overlays`, snapshot_builder.py),
    então isso é checável sem dado novo.
    - O modelo de filtro virou `REQUISITOS_FILTRO_GERAL`: lista de requisitos,
      cada um com os overlays aceitáveis — **OU dentro do requisito, E entre
      requisitos, e o E é dentro da mesma célula**
      (`celulaAtendeRequisitos()` + `linhaTemCelulaQueAtende()`, que
      substituíram `linhaTemOverlayNaJanela()`). Os 2 filtros antigos viraram
      um requisito só cada um — comportamento idêntico ao de antes. Entre
      chips marcados continua valendo a UNIÃO.
    - Cada chip ganhou `AJUDA_FILTRO_GERAL` no `title`, porque a diferença
      entre "tem os dois (em dias quaisquer)" e "tem os dois no mesmo dia" não
      se lê no rótulo.
    - **Cor do selecionado deixou de ser o fúcsia** (`--overlay-pauta`), que é
      o do badge Pauta: virou token próprio `--filtro-sel` (azul #1d4ed8
      claro / #60a5fa escuro, nos 4 blocos de tema). Separa os assuntos — o
      fúcsia continua significando "pauta" na matriz e no contorno do Excel, o
      azul significa "este filtro está ligado" — e fica fora da escala de
      gravidade (verde/âmbar/vermelho) e do violeta de "Comprada".
    - **Verificado** (Playwright, 11 verificações, 2 temas): 3 chips na faixa;
      o novo pega SÓ a carteira com os dois badges no mesmo dia e ignora a que
      tem um em cada dia; os 2 filtros antigos devolvem exatamente o que
      devolviam; união preservada ao marcar mais de um; chip ligado em
      `rgb(29,78,216)` no claro e `rgb(96,165,250)` no escuro, com o anel na
      cor nova; `--overlay-pauta` intacto em `#c026d3`; zero erro de JS.

---

## Checklist rápido (antes de considerar uma tarefa pronta)

- [ ] Variáveis e funções em `snake_case` (Python) e com nomes representativos.
- [ ] Toda função tem comentário acima no formato **contexto + pseudocódigo**.
- [ ] Funções pequenas, cada uma com um único contexto.
- [ ] Nada de lógica pesada dentro de rotas; nada de novo monólito de HTML/JS.
- [ ] Página dividida em seções claras (imports → helpers → rotas; CSS/JS separados).
- [ ] JS da tela quebrado em `static/js/<tela>/` (um arquivo por funcionalidade) —
      inclusive ao refatorar; nada de `.js` único gigante por tela.
- [ ] Funções genéricas foram para `utils/` e o que já existia foi reaproveitado.
- [ ] Acesso a dados só via `beehus_api/` / `db.py` / `beehus_catalog.py`.
- [ ] **Nenhuma escrita direta no Mongo** — alterações só por rotas homologadas da API.
- [ ] Nenhum segredo hardcoded ou dado de cliente comitado.
- [ ] Doc em `docs/` atualizada; nenhuma dependência nova adicionada sem confirmar.
- [ ] Nenhum padrão de arquitetura foi quebrado sem confirmação do desenvolvedor.
