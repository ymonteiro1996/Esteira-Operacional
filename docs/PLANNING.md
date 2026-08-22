# SWAT – Controle de Cargas (novo): Planning & Functional Spec

> Dashboard interno de monitoramento da esteira diária de posições (Instituição → Unprocessed → Processada → Publicada), por carteira e por dia, com alertas de SLA, divergência de rentabilidade e sequência cronológica.
>
> **Status:** documento de planejamento — nenhum código foi escrito. Todos os schemas, contagens e hipóteses abaixo foram **validados contra o banco de produção `Beehus` e as planilhas de cadastro em 2026-07-17**.
>
> **⚠️ [ATUALIZAÇÃO 2026-08-05] Migração API-first parcialmente supersede este documento.**
> O protótipo (`prototype/`) passou a buscar dados pela API Beehus (`beehus_api/`) — o
> acesso direto ao MongoDB foi **removido por completo** do código (nem fallback/modo
> avançado restou). A seção [MongoDB Collections Reference](#mongodb-collections-reference-validada)
> abaixo permanece válida como referência do **schema real** (útil pra entender os dados),
> mas a **origem** desses dados no código mudou. Ver a docstring de `prototype/db.py` e a
> seção "Notas específicas deste protótipo" do `CLAUDE.md` (raiz de `prototype/`) para a
> arquitetura atual, o que migrou 1:1, o que ficou mais caro (chamadas por empresa/data em
> vez de 1 query batch) e as 3 lacunas reais confirmadas (sem endpoint equivalente hoje):
> colunas "Última Unp/Pro/Pub" (removidas), issues `explosion_error`/
> `missing_fund_position_for_explosion`, e atribuição por carteira de `missing_wallet`.

---

## Table of Contents

1. [Visão Geral e Objetivo](#visão-geral-e-objetivo)
2. [Escopo e Não-Escopo](#escopo-e-não-escopo)
3. [Tech Stack](#tech-stack)
4. [Estrutura de Arquivos Proposta](#estrutura-de-arquivos-proposta)
5. [Arquitetura](#arquitetura)
6. [Fontes de Cadastro (planilhas)](#fontes-de-cadastro-planilhas)
7. [MongoDB Collections Reference (validada)](#mongodb-collections-reference-validada)
8. [Grid de Status Diário](#grid-de-status-diário)
9. [Especificação dos Alertas](#especificação-dos-alertas)
10. [Calendário de Dias Úteis](#calendário-de-dias-úteis)
11. [Estratégia de Otimização de Acesso ao Banco](#estratégia-de-otimização-de-acesso-ao-banco)
12. [Convenção de Comentários no Código](#convenção-de-comentários-no-código)
13. [Plano de Fases de Implementação](#plano-de-fases-de-implementação)
14. [Lacunas de Dados e Decisões em Aberto](#lacunas-de-dados-e-decisões-em-aberto)
15. [Simbologia da Matriz de Status](#simbologia-da-matriz-de-status)
16. [Visão por Agrupamento](#visão-por-agrupamento)
17. [Sistema de Comentários em Alertas](#sistema-de-comentários-em-alertas)
18. [Painéis de Detalhe (Drill-down)](#painéis-de-detalhe-drill-down)
19. [Aba Controle de Cargas (Custodiantes)](#aba-controle-de-cargas-custodiantes)
20. [Aba Controle de Demandas](#aba-controle-de-demandas-2026-08-21)
21. [Referências de Design](#referências-de-design)

---

## Visão Geral e Objetivo

A Beehus processa diariamente ~792 carteiras cadastradas (de 2.341 existentes no banco), vindas de ~20 instituições custodiantes, em 4 estágios:

```
Instituição (API/AWS/scraping/XML/PDF/e-mail)
   └─► unprocessedSecurityPositions      "Unprocessed"
         └─► processedPosition           "Processada"
               └─► publishedPositionSecurities + navPackages   "Publicada"
```

O dashboard responde três perguntas para o gestor de operações:

1. **Onde cada carteira está na esteira hoje?** — grid de calendário (carteira × dia útil) com semáforo por estágio.
2. **O que está atrasado ou quebrado?** — feed de alertas (8 tipos, ver [Especificação dos Alertas](#especificação-dos-alertas)) com SLA por carteira vindo da planilha de cadastro.
3. **A que horas cada etapa rodou?** — timestamps `createdAt`/`updatedAt` (confirmados existentes em todas as coleções da esteira) vs. janela operacional (09:00–17:00, aba `Horários` da Esteira Diária).

É uma ferramenta **nova e independente**. O app maduro em `SWAT\Controle de cargas` (com espaço) continua intocado; dele aproveitamos apenas o padrão visual e o modelo de setup/conexão — nunca a lógica de conciliação/correções. A arquitetura de referência é `SWAT\Relatorios`.

---

## Escopo e Não-Escopo

| Em escopo | Fora de escopo |
|---|---|
| Leitura (read-only) do Mongo de produção | Qualquer escrita nas coleções da esteira/backend |
| Escrita isolada em arquivo local `data/alert_comments.json` (comentários de analistas — ver [Sistema de Comentários](#sistema-de-comentários-em-alertas)) — **[REVISADO 2026-07-17] decisão do usuário: sem escrita no Mongo nesta fase, nem mesmo em collection própria** | — |
| Grid de status por carteira/dia útil | Reprocessamento/republicação a partir do dashboard |
| 8 alertas da tabela do usuário + gate cronológico | Conciliação de NAV, correções, exceções (já existem no app irmão) |
| Import do cadastro da planilha → JSON local | Edição do cadastro dentro do Excel |
| Thresholds configuráveis em JSON | Banco SQL/ORM, filas, workers |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3 + Flask (`use_reloader=False` — pasta OneDrive com espaços) |
| Database | MongoDB Atlas (PyMongo + `certifi.where()`), banco `Beehus`, **read-only** |
| Frontend | Jinja2 + Tailwind CSS via CDN (sem build step) |
| JS | Vanilla JS + `fetch()` (sem framework) |
| Cadastro | openpyxl (import da planilha) → JSON em `data/` |
| Config persistence | JSON files em `data/` (sem SQL, sem ORM) |

Idêntico ao Relatorios. Versões já instaladas no ambiente: pandas 2.3.0, openpyxl 3.0.10, pymongo 4.16.0.

---

## Estrutura de Arquivos Proposta

```
ControleCargas/
├── app.py                    # Flask app factory — registra blueprints, before_request → /setup
├── db.py                     # _DbProxy singleton + ensure_indexes() + helpers de datas úteis
├── cache.py                  # cache TTL em memória (120s) p/ scans de nomes e cadastro
├── registry.py               # loader do cadastro de carteiras (Excel → data/wallet_registry.json)
│
├── pages/                    # um blueprint por página
│   ├── __init__.py
│   ├── setup.py              # registro da connection string por usuário Windows (cópia do Relatorios)
│   ├── dashboard.py          # grid principal carteira × dia + aba Agrupamentos (mesma matriz, roll-up)
│   ├── alertas.py            # feed consolidado dos 8 alertas + drill-down
│   ├── horarios.py           # visão "Horários Execução" (timeline por etapa)
│   ├── config.py             # thresholds, import/reimport da planilha, filtros de empresa
│   ├── comments.py           # API de comentários (GET/POST/PUT) — persiste em data/alert_comments.json (nunca no Mongo)
│   └── stubs.py              # placeholders "em construção"
│
├── templates/
│   ├── base.html             # sidebar + content block (mesmo layout do Relatorios)
│   ├── setup.html
│   ├── dashboard.html
│   ├── alertas.html
│   ├── horarios.html
│   ├── config.html
│   └── stub.html
│
├── static/
│   └── logo.png
│
├── data/                     # nunca commitar user_connections.json
│   ├── user_connections.json     # { "usuário_windows": "mongodb+srv://..." }
│   ├── wallet_registry.json      # snapshot importado do EsbocoCadastro (fonte de SLA)
│   ├── alert_thresholds.json     # thresholds de divergência, % de carga por instituição etc.
│   ├── horarios_cargas.json      # horário limite por instituição (seed: aba "Lista Cargas")
│   ├── holidays.json             # feriados BR (ver Lacunas — dias úteis reais)
│   ├── settings.json             # flags de UI, company_filter
│   └── alert_comments.json       # comentários humanos em alertas/células — [REVISADO 2026-07-17]
│                                  # único arquivo que o app grava (Mongo permanece 100% read-only);
│                                  # ver Sistema de Comentários em Alertas §Persistência
│
├── docs/
│   └── PLANNING.md           # este documento
├── requirements.txt
└── iniciar.bat               # launcher (path com espaços → sempre entre aspas)
```

> **[REVISADO 2026-07-20 — estrutura REAL do protótipo após o refactor estrutural]**
> A árvore acima é a visão de longo prazo do "app real" (Fase 0, pages/ em
> blueprints, `/setup` por usuário) — **ainda não construída**. O que existe
> hoje em `prototype/` (Fase 4b, reorganizado seguindo o `CLAUDE.md` copiado
> pra raiz do projeto) é:
> ```
> prototype/
> ├── app.py                    # Flask: seções 1 imports/config · 2 helpers · 3 rotas (finas)
> ├── db.py                     # ÚNICA porta de entrada ao Mongo (singleton, só leitura,
> │                              #   cache-aware por data — ver "Otimização" abaixo)
> ├── cache.py                  # CachePorData (esteira, por positionDate) + CacheTTL (120s,
> │                              #   coleções pequenas + últimas datas)
> ├── registry.py               # leitura/validação do cadastro (Excel → registry em memória)
> ├── snapshot_builder.py       # regra de negócio: célula/linha/prioridade/roll-up de agrupamento
> ├── excel_report.py           # formata o snapshot já calculado como .xlsx
> ├── build_snapshot.py         # orquestrador fino: chama os módulos acima, monta o snapshot,
> │                              #   escreve snapshot.json/index.html/relatório .xlsx (CLI)
> ├── custodian_upload.py       # ingestão do ControleUpload.xlsx (inalterado)
> ├── utils/
> │   ├── datas.py               # CalendarioDiasUteis (ANBIMA) + cálculo de prazos/janela
> │   └── formatacao.py          # formatação de horário BRT
> ├── static/
> │   ├── css/controle_cargas.css
> │   └── js/controle_cargas/    # state · filtros · matriz · matriz_custodiantes · paineis ·
> │                               # comentarios · exportar · atualizar · index (bootstrap)
> ├── index_template.html       # só marcação + <link>/<script src> (enxuto)
> ├── data/                     # alert_comments.json (único arquivo que o app grava)
> ├── .env.example               # documenta o NOME da env var do Mongo (sem valor real)
> └── snapshot.json / index.html / ControleCargas_relatorio_*.xlsx  # gerados, não versionados
> ```
> Não há `pages/*.py` nem `/setup`: é uma tela única (o grid), então blueprints
> por página não se aplicam ainda — mantido como está até o app crescer pra
> mais telas. `beehus_api/`/`beehus_catalog.py` do app-irmão **não são usados**
> aqui (decisão do usuário, ver topo deste documento) — a regra "isolar acesso
> a dados numa camada própria" é satisfeita pelo `db.py` local acima.

---

## Arquitetura

### Request lifecycle

```
Browser request
  └─► app.py before_request()
        ├─ db não pronto? → redirect /setup
        └─ db pronto? → route handler em pages/*.py
              └─ render_template(...) ou jsonify(...)
```

### DB Proxy pattern (replicar de `Relatorios/db.py`)

`db.py` expõe um singleton `_DbProxy` chamado `db`. O app sobe **sem** conexão; ao registrar a URI em `/setup` o proxy é inicializado in-place e todos os `from db import db` passam a enxergar o banco vivo, sem restart. A URI é salva em `data/user_connections.json` chaveada por `os.environ["USERNAME"]` (lowercase). Teste de conexão com `serverSelectionTimeoutMS=5000` + `tlsCAFile=certifi.where()` antes de salvar (ver `Relatorios/pages/setup.py`).

> **Segurança:** `user_connections.json` contém credenciais em texto plano — `.gitignore` obrigatório, nunca compartilhar. A URI de produção não aparece em nenhum template, log ou documento.

> **[REVISADO 2026-07-20]** O `/setup` por usuário (tela + `user_connections.json`) acima é a visão de longo prazo, **ainda não construída**. O `db.py` REAL do protótipo hoje é mais simples: lê a connection string 1x da variável de ambiente `SWAT_CONTROLE_CARGAS_MONGO_URI` (nunca hardcoded — antes vivia direto no código-fonte de `build_snapshot.py`, migrado nesta refatoração) e levanta um erro claro se ela não estiver definida, explicando como configurá-la (ver `.env.example` na raiz de `prototype/`). Continua sendo a ÚNICA porta de entrada ao Mongo do projeto (nenhum outro módulo instancia `pymongo.MongoClient`), só leitura, singleton por processo — satisfaz o espírito da regra do CLAUDE.md sem depender de uma tela `/setup` que está fora do escopo desta rodada.

### Cache TTL (replicar de `Relatorios/cache.py`)

Cache puro-Python com `time.monotonic()` e TTL de 120s para dicionários `{id: nome}` de `companies`, `entities`, `wallets`, `groupings` e para o snapshot do grid (TTL menor, 60s — ver [Otimização](#estratégia-de-otimização-de-acesso-ao-banco)).

### ensure_indexes() (idempotente, best-effort)

Rodar no import de `db.py`, dentro de `try/except` com `logging.warning` (o usuário pode não ter permissão de `createIndex` no cluster de produção — nesse caso apenas logar e seguir; as queries funcionam do mesmo jeito, só mais lentas):

```python
db.unprocessedSecurityPositions.create_index([("walletId", 1), ("positionDate", 1)])
db.unprocessedSecurityPositions.create_index([("positionDate", 1)])
db.processedPosition.create_index([("walletId", 1), ("positionDate", 1)])
db.processedPosition.create_index([("positionDate", 1), ("published", 1)])
db.navPackages.create_index([("walletId", 1), ("positionDate", 1), ("trashed", 1)])
db.navPackages.create_index([("groupingId", 1), ("positionDate", 1), ("trashed", 1)])
db.navPackages.create_index([("positionDate", 1)])
db.issues.create_index([("status", 1), ("date", 1)])
db.issues.create_index([("walletId", 1), ("date", 1), ("type", 1), ("status", 1)])
# [REVISADO 2026-07-17] Comentários NÃO usam collection Mongo nesta fase — decisão do
# usuário foi persistir em data/alert_comments.json (ver Sistema de Comentários em
# Alertas). O Mongo de produção permanece 100% read-only; não há índices a criar aqui
# para comentários. Se um dia a persistência migrar para Mongo, os índices originalmente
# cogitados seriam (targetType, targetId, cellDate) e (validTo).
```

### Semáforo (evoluído — ver seção [Simbologia da Matriz de Status](#simbologia-da-matriz-de-status))

**[REVISADO 2026-07-18, rodada 7 — separação definitiva dos canais]** A convenção herdada do Relatorios (verde=completo, amarelo=parcial, vermelho=faltando, cinza=não esperado) evoluiu em duas etapas: primeiro a cor de fundo passou a codificar severidade (rodadas 1–6); depois o usuário identificou que fundo carregando **estágio E atraso ao mesmo tempo** era a causa-raiz de `Unp`/`Pro` "parecerem iguais" em qualquer ajuste de tom — e decidiu **separar os dois canais**: a **cor de fundo codifica SÓ o estágio** (`Unp` amarelo-pálido → `Pro` verde-claro → `Pub` verde) e o **atraso vira um badge dedicado "Atraso"** (amarelo 1–2du / vermelho ≥3du, espelho do badge "Rent"). A sigla dentro da célula continua grafando o estágio (`Unp`/`Pro`/`Pub`). Resumo (spec completa, com hex e overlays, na seção de Simbologia):

| Situação | Tailwind classes / visual |
|---|---|
| Concluída (Publicada; ou Processada com Deve Publicar = Não) | `bg-green-100 text-green-700` |
| Unprocessed carregada, falta processar (**no prazo ou atrasada**) | amarelo-pálido `#fde68a` (amber-200) texto `#78350f` |
| Processada, aguardando publicação (**no prazo ou atrasada**) | verde-menta claro `#8ae6d2` texto `#134e4a` |
| Nada carregado, **SLA vencido** (Faltando) | `bg-red-100 text-red-700` (≥3du: `bg-red-200 text-red-900`) |
| Nada carregado, **dentro do prazo** (aguardando defasagem) | `bg-gray-100 text-gray-400` |
| Não cobrado (dia intermediário mensal, pré-onboarding) | `bg-gray-50 text-gray-300` |
| **Atraso em célula Unp/Pro** (SLA vencido) | badge **"Atraso"** no canto inferior esquerdo — amarelo (1–2du) ou vermelho (≥3du) **[NOVO rodada 7]** |
| Fora de sequência (gate D-1 violado) | borda vermelha `ring-2 ring-inset` (`#991b1b`) com offset de 1px de superfície, sobre a cor base **[REVISADO 2026-07-18 — era `ring-purple-400`; ver §Simbologia/Overlays]** |
| Divergência Rent Contrib × Rent NAV | badge oval **"Rent"** amarelo (leve, >2bp/0,02%) ou vermelho (elevado, >5bp) no canto superior direito, **e** impacto ≥ R$800 nos 2 casos **[REVISADO 2026-07-18 — era violeta claro/escuro; REVISADO 2026-07-31 — thresholds e gate em R$; ver §Simbologia/Overlays]** |
| Issues pendentes na carteira-dia | triângulo `slate-600` no canto **superior** esquerdo **[rodada 7 — cedeu o inferior esquerdo ao badge Atraso]** |

---

## Fontes de Cadastro (planilhas)

### Achado: os dois arquivos são idênticos

`TemplateCarteiras.xlsx` (aba `Sheet1`) e `Esteira Diaria.xlsx` (aba `EsbocoCadastro`) têm **exatamente as mesmas 17 colunas e as mesmas 792 linhas de dados, 100% idênticas célula a célula** (verificado em 2026-07-17). O Template é um export/snapshot da aba. **Decisão proposta:** usar `Esteira Diaria.xlsx > EsbocoCadastro` como fonte canônica (vive junto das demais abas operacionais) e tratar o Template como cópia descartável. O dashboard importa a planilha para `data/wallet_registry.json` via botão "Reimportar cadastro" na página Config — nunca lê o Excel em request time.

### Colunas confirmadas (A–Q) e preenchimento real

| Col | Nome | Preenchidas | Valores observados (792 linhas) | Uso no dashboard |
|---|---|---|---|---|
| A | Nome Carteira | 792 | únicos | label da linha do grid |
| B | WalletID | 792 | **792/792 existem em `wallets`** (ObjectId válido) | chave de tudo |
| C | Instituição | 792 | 20 distintos (XP 639, BTG 36, Mira Capital 28, JP Morgan NY 23, MS NY 16, Itaú 13…) — **todos batem exatamente com `entities.name`** | agrupamento do alerta "Carga Instituição" |
| D | Exceção | 23 | texto livre ("dividir quant por 2", "conta checking"…) | tooltip informativo, sem lógica |
| E | Deve Publicar | 792 | Sim 790 / Não 2 | Não → estágio Publicada vira cinza |
| F | Carga Retroativa | 0 | vazia | reservada (ignorar por ora) |
| G | Agrupamentos Indexados | 791 | ids separados por `;` (673 multi); "Não" 16; **1.016 ids distintos, 1.016/1.016 existem em `groupings`** | escopo do alerta de divergência de Agrupamento |
| H | Periodicidade | 792 | D 737 / M 55 | regime de SLA |
| I | Defasagem | 792 | D-3 642, D-1 82, D-2 10, D-4 3, M 55 | **SLA em du das carteiras diárias** |
| J | Repetição Diária | 83 | Sim 55 (todas as M) / Não 28 | M+Sim → posição repetida diariamente (gera docs futuros, ver Lacunas) |
| K | Modelo de Carga | 792 | API 348, AWS 327, Scrapping Site 56, **Yuri 34, E-mail PDF 17, Theo 5, Adeppar - Hulgo 1, E-mail Imagem 1**, XML 3 | valor = nome de pessoa/e-mail ⇒ carga manual |
| L | Precificação MtM ou Curva | 0 | vazia | reservada |
| M | C3 Todos Ativos | 0 | vazia | reservada |
| N | Captura | 792 | Sim 792 | filtro (se um dia houver "Não") |
| O | du Recebimento PDF | 55 | sempre `10` | SLA em du — **só nas 55 carteiras M** |
| P | du Upload Beehus | 55 | sempre `5` | SLA em du — **só nas 55 carteiras M** |
| Q | Explosão | 3 | Esparta, Delfos e Esparta, BlueBird | tooltip; relaciona-se a issues `*_explosion` |

### Hipótese de SLA — CONFIRMADA (com refinamento)

A hipótese "Defasagem/du Recebimento/du Upload são o Input dos alertas de atraso" **se confirma**, com uma divisão limpa em dois regimes:

- **Regime diário (H=D, 737 carteiras):** o SLA é a coluna **Defasagem** (D-1…D-4 em dias úteis). `du Recebimento PDF`/`du Upload Beehus` estão vazios nessas linhas. As 7 cargas manuais diárias (Yuri 6, Adeppar 1) também usam Defasagem (D-1/D-2).
- **Regime mensal (H=M, 55 carteiras):** Defasagem = "M" (não numérica). **[CORRIGIDO pelo usuário 2026-07-17]** A posição mensal é recebida referente ao **último dia útil do mês** e replicada para o mês inteiro (Repetição Diária = Sim). Os dois prazos **não são marcos separados: são SOMADOS** — `du Recebimento PDF (10) + du Upload Beehus (5) = 15du` — e contados **a partir do último dia útil do mês de referência**:

  ```
  data_limite_unprocessed = ultimo_dia_util(mes_referencia) + (du_Recebimento_PDF + du_Upload_Beehus) dias úteis
                          = ultimo_dia_util(mes_referencia) + 15du
  ```

  Se hoje ≥ `data_limite_unprocessed` e ainda não existe `unprocessedSecurityPositions` para a carteira com `positionDate = ultimo_dia_util(mes_referencia)` ⇒ dispara o alerta **"Carga posição não realizada (Unprocessed)"** (exemplo do usuário: "ontem 15du do mês passado devemos ter a carga dessas carteiras"). Não há mais alerta intermediário aos 10du. Todas as 55 têm os dois campos preenchidos; Modelo de Carga é sempre pessoa/e-mail/scraping (Yuri 28, E-mail PDF 17, Theo 5, Scrapping 4, E-mail Imagem 1).

### Outras abas úteis da Esteira Diária

- **`EsbocoControleRotinas`** — rascunho do usuário que originou a tabela de alertas deste documento (colunas Posições/Issues/NAV/NAV Grouping/Publicação + lista "Alertas Necessários"). Já refletido integralmente na seção de alertas.
- **`Lista Cargas`** — roteiro operacional por instituição com `Horário Inicial`/`Horário Limite` (quase todos vazios hoje) e passo-a-passo de captura manual. Seed para `data/horarios_cargas.json` do alerta de Horários.
- **`Horários`** — rotina do dia: 09:00 Revisão, 10:00 Validação Cargas (D-1), 10:30 Issues, 14:00 Informar Cargas Faltantes, 15:00 Publicar, 15:15 Conciliação, 15:40 Validação Rentabilidade, 17:00 Status por cliente. Usada como marcos default do alerta de Horários.

### Schema proposto de `data/wallet_registry.json`

```json
{
  "imported_at": "2026-07-17T15:00:00",
  "source_file": "Esteira Diaria.xlsx",
  "wallets": [
    {
      "walletId": "680a9ce33b2296d86127115f",
      "name": "JKZ PF BTG BRL",
      "institution": "BTG",
      "entityId": "…resolvido por nome em entities na importação…",
      "mustPublish": true,
      "groupingIds": ["689b43eb93b6f17232687fd5"],
      "periodicity": "D",
      "lagBizDays": 1,
      "dailyRepetition": null,
      "loadModel": "API",
      "isManualLoad": false,
      "sla_pdf_receipt_du": null,
      "sla_upload_du": null,
      "exception": null,
      "explosion": null
    }
  ]
}
```

> Na importação: (1) validar cada WalletID contra `wallets` (`$in` único); (2) resolver `Instituição → entityId` por nome exato em `entities` (bate 100% hoje, mas salvar o id congela o vínculo); (3) `Defasagem "D-3" → lagBizDays 3`, `"M" → null` + `periodicity "M"`; (4) `loadModel` fora de {API, AWS, Scrapping Site, XML} ⇒ `isManualLoad: true`.

---

## MongoDB Collections Reference (validada)

Validado contra produção em 2026-07-17. IDs de referência (`walletId`, `companyId`, `entityId`, `securityId`, `groupingId`) são **strings**; `_id` é ObjectId; `companyId` é string estilo CNPJ. `positionDate` é **string `"YYYY-MM-DD"`** em todas as coleções (comparação lexicográfica funciona em range queries).

> **Achado central:** todas as coleções da esteira têm **`createdAt` e `updatedAt`** (datetimes UTC, padrão Mongoose). A lacuna de timestamps prevista **não existe** — `ObjectId.generation_time` fica só como fallback teórico.

| Collection | ~Docs | Campos relevantes p/ o dashboard (validados) |
|---|---|---|
| `companies` | 19 | `_id` (string CNPJ), `name` |
| `entities` | 114 | `_id`, `name` (bate 100% com coluna Instituição) |
| `wallets` | 2.341 | `_id`, `name`, `companyId`, `entityId`, `accountCode`, `hasDailyPosition`, `consumptionIdentifiers`, `trashed` (hoje todos `False`), `startDateConsolidation`, `startDateReturn`, `createdAt/updatedAt` |
| `groupings` | 1.447 | `_id`, `name`, `companyId`, `trashed`, `benchmarks`, `wallets[]` → `{walletId, initialDateOnGrouping, finalDateOnGrouping}` (**confirmado em produção**; `finalDateOnGrouping: null` = carteira ainda ativa no grouping) |
| `unprocessedSecurityPositions` | 165.979 | `walletId`, `companyId`, `entityId`, `positionDate`, `inputType`, `lastInputDate`, `trashed`, `fileData`, `createdAt/updatedAt`, `securities[]` → **`{unprocessedId, quantity, pu, balance, preProcessingData}`** |
| `processedPosition` | 70.787 | `walletId`, `companyId`, `entityId`, `positionDate`, **`published` (bool)**, `inputType`, `lastInputDate`, `trashed`, `totalContribution`, `totalContributionInBrl`, `createdAt/updatedAt`, `securities[]` → `{securityId, beehusName, quantity, pu, amount, pricingType, executionPrice, dailyContribution, intradayContribution, eventContribution, totalContribution, formerPu, formerQuantity, proportion, hierarchicalVariable.*}` |
| `publishedPositionSecurities` | 1.151.744 | 1 doc **por security** por wallet-date: `walletId`, `positionDate`, `securityId`, `quantity`, `pu`, `amount`... + `walletNav`, `groupingId`, `groupingNav`, `createdAt/updatedAt`. **Não usar para o grid** (granularidade cara) |
| `navPackages` | 97.647 | `positionDate`, `trashed`, `published`, `nav`, `navPerShare`, `formerNav*`, **`returnNavPerShare`, `returnContribution`**, `inAndOutFlows`, `createdAt/updatedAt` — e **dois níveis no mesmo collection**: 64.284 docs com `walletId` (carteira) e 33.363 com `groupingId` (agrupamento) |
| `transactions` | 379.256 | `operationDate`, `liquidationDate`, `walletId`, `beehusTransactionType`, `trashed`, … (secundária p/ este dashboard) |
| `issues` | 750.755 | `type`, `companyId`, `entityId`, `walletId`, `date`, `status` (`pending`/`solved`), `description`, `securityId`, `unprocessedSecurityId`, `solvedBy`, `inputType`, `createdAt/updatedAt` |
| `provisions`, `cashAccounts` | 14k / 2k | fora do escopo direto |

### Divergências vs. levantamento anterior (correções)

1. **`unprocessedSecurityPositions.securities[]` NÃO tem `securityId` nem `amount`** — os campos reais são `unprocessedId`, `quantity`, `pu`, **`balance`**, `preProcessingData`. O mapeamento p/ security acontece depois (via `securityMappings`). Irrelevante para o grid (só contamos existência do doc), mas importante para não projetar campos fantasmas.
2. **`processedPosition.published`** existe e é o marcador barato de "Publicada" (1 doc por wallet-date). Validado: wallet-date com `published: True` tem docs em `publishedPositionSecurities`; com `False`, zero docs.
3. **`navPackages.returnContribution` já vem calculado** ao lado de `returnNavPerShare`, tanto no nível carteira quanto no nível agrupamento — os dois alertas de divergência viram comparação de dois campos do **mesmo documento** (refuta a necessidade de derivar de `processedPosition.securities[].dailyContribution` e de fazer soma ponderada por grouping — isso fica só como método de auditoria/drill-down).
4. `trashed` existe também em `unprocessedSecurityPositions` e `processedPosition` (hoje só `False`) — usar `{"trashed": {"$ne": True}}` defensivamente em todas as queries da esteira, não só em `navPackages`.
5. **Tipos de issue confirmados (8):** `explosion_error`, `missing_fund_position_for_explosion`, `missing_unprocessed_position`, `missing_wallet`, `security_missing_classification`, `security_missing_history_price`, `security_missing_price`, `security_unmapped`. Status: `pending`/`solved`. **Hoje há 410.831 pending** (318k `missing_unprocessed_position`, 82k `missing_wallet`) — o alerta de Issues **precisa** de recorte por data e carteira, nunca contagem global.
6. **Unicidade validada:** 1 doc por `(walletId, positionDate)` em `unprocessedSecurityPositions`, `processedPosition` e `navPackages` (amostra 2026-07-15, zero duplicatas).
7. **Docs com data futura existem:** 1.685 unprocessed e 19 processed com `positionDate > hoje` (`inputType: "sheets"` — efeito da Repetição Diária/forward-fill das carteiras mensais). O grid **capa em hoje** e "última data" deve ser reportada como `min(max(positionDate), hoje)` com badge "(futura)" quando aplicável.
8. `inputType` (10 valores: `api-btg`, `api-btg-mfo`, `api-xp`, `avenue-api`, `beehus`, `itau-api`, `itau-bba-scraping`, `pluggy-api`, `sheets`, `xml`) é a versão "sistema" do Modelo de Carga — útil no drill-down para confirmar por onde a carga entrou.

---

## Grid de Status Diário

### Layout

Linhas = carteiras do `wallet_registry.json` (não todas as 2.341 do banco — só as 792 cadastradas), em **lista única e plana — sem agrupamento visual por Instituição/Company** [decisão do usuário 2026-07-17], ordenada por prioridade de atenção (carteiras com problema no topo, saudáveis no final — algoritmo na subseção [Ordenação das linhas](#ordenação-das-linhas--lista-plana-priorizada-por-problema) abaixo). Instituição e Company viram **tag/coluna ao lado do nome da carteira** e filtros (padrão `CompanySelector` dos apps irmãos), nunca cabeçalho de grupo. Colunas = janela de dias úteis, mais 3 colunas-resumo à direita: **Última Unprocessed**, **Última Processada**, **Última Publicada** (a data em si, com `biz_days_elapsed` no tooltip).

> **[REVISADO 2026-07-20 — janela inicial enxuta + campos de data, Tarefa 2 do refactor estrutural]** O default deixou de ser 10-14du. O seletor 5/10/15/21 cogitado acima **não foi implementado nesta rodada**; em vez disso a tela ganhou dois campos de data ("de"/"até", `#data-inicial`/`#data-final`) que, junto do botão **Atualizar** (ver próxima seção), deixam o usuário pedir explicitamente uma janela maior/diferente — cobre o mesmo caso de uso (auditoria retroativa) com menos UI nova. Se o seletor de presets 5/10/15/21 fizer falta na prática, é aditivo (não quebra nada implementado agora).
>
> **[REVISADO 2026-07-22, pedido do usuário]** `data_final` da janela default é sempre **D-N du de hoje** (data de referência do grid — ver valor vigente na seção abaixo) e `data_inicial` é sempre **D-5 du de `data_final`** — `utils/datas.py::JANELA_INICIAL_DIAS_UTEIS = 5`, `calcular_janela_grid()`. Isso deu à janela default **6 dias úteis** (data_final e os 5 du anteriores), um a mais que antes (quando `JANELA_INICIAL_DIAS_UTEIS=5` era a contagem TOTAL de dias da janela, não o deslocamento entre as pontas).
>
> **[REVISADO 2026-07-24, pedido do usuário]** O lag da data de referência foi D-5 por 1 dia (2026-07-23 a 2026-07-24) e voltou pra **D-3** (`utils/datas.py::GRID_REFERENCE_LAG_DU = 3`) — mesma regra/motivo da seção abaixo, só o número mudou.

### Data de referência do grid: travada em D-3 (decisão do usuário)

A "data de referência" do grid (o "hoje" para efeitos de janela e expectativa) **não é D0: é `hoje − 3 dias úteis`**. A janela de N dias úteis **termina na data de referência** (ex.: últimos 10du terminando em D-3). Motivo: a Repetição Diária das carteiras mensais gera documentos com `positionDate` no futuro (1.685 unprocessed medidos — ver Collections §7); ancorar o grid em D0 faria posições replicadas antecipadamente e lacunas ainda-normais dos últimos dias poluírem a leitura como se fossem buracos reais.

- Implementado como constante Python (`utils/datas.py::GRID_REFERENCE_LAG_DU`), **nunca hardcoded** no meio da lógica das páginas; mudar o lag no futuro é editar um número.
- O date picker de âncora continua existindo para auditoria retroativa; D-3 é só o default do "hoje".
- Os cálculos de **SLA/alertas continuam usando o hoje real** (um atraso é atraso em relação a hoje, não a D-3); o lag de referência afeta apenas a janela exibida e a regra de expectativa das células.

### Estado da célula (carteira `w`, dia útil `d`)

```
publicada   := existe processedPosition(w, d, published=True, trashed≠True)
processada  := existe processedPosition(w, d, trashed≠True)
unprocessed := existe unprocessedSecurityPositions(w, d, trashed≠True)
esperado    := regra de expectativa abaixo
```

A célula separa **estágio** (cor de fundo + sigla `Unp`/`Pro`/`Pub`) de **atraso vs. SLA** (badge "Atraso") — **[rodada 7]** spec visual completa na seção [Simbologia da Matriz de Status](#simbologia-da-matriz-de-status):

| Condição | Cor de fundo | Sigla | Badge Atraso |
|---|---|---|---|
| `publicada` (ou `processada` e Deve Publicar = Não) | verde | Pub (ou Pro) | nunca |
| `unprocessed` sem `processada` (no prazo OU atrasada) | amarelo-pálido | Unp | se SLA vencido (amarelo 1–2du / vermelho ≥3du) |
| `processada` sem publicação (no prazo OU atrasada) | verde-menta claro | Pro | se SLA vencido (idem) |
| nada, `esperado` e SLA vencido | vermelho | ∅ | se SLA vencido (amarelo 1–2du / vermelho ≥3du) — **[REVISADO 2026-07-22, pedido do usuário]** antes era "nunca, o fundo já comunica"; agora o badge aparece em QUALQUER estágio ≠ Publicado com prazo vencido, vazio incluso |
| nada, dentro do prazo | cinza-médio | Agd | nunca |

> **[SUPERSEDIDO 2026-07-25, pedido do usuário]** A linha "nada e não
> `esperado` (mensal intermediário / pré-onboarding)" que existia aqui foi
> removida por completo — ver
> [Correção 2026-07-25 — regime mensal julga o fechamento vigente todo dia](#correção-2026-07-25--regime-mensal-julga-o-fechamento-vigente-todo-dia)
> e, logo abaixo dela,
> [Remoção 2026-07-25 — aposentado o gate de pré-onboarding em carteiras](#remoção-2026-07-25--aposentado-o-gate-de-pré-onboarding-em-carteiras).
> O mockkey `notcov`/"Não cobrado" (cinza-claro, sigla —) continua existindo
> só para 2 casos de **Agrupamento** (nunca mais de Carteira): bloco 3 sem
> nenhuma carteira-membro rastreada, e dia sem nenhum membro ativo — ver
> `montar_linha_grouping_bloco3()`/`montar_celula_grouping_dia()`.

**Regra de expectativa** (o coração do semáforo — evita falso vermelho); `ref = hoje − GRID_REFERENCE_LAG_DU` (D-3):

- **[SUPERSEDIDO 2026-07-27 — ver seção "Correção 2026-07-27" abaixo]** Periodicidade deixou de influenciar esta regra por completo. Prazo = `data` da coluna + Defasagem (dias úteis), **igual para toda carteira, D ou M**. As duas linhas abaixo descrevem o comportamento intermediário (2026-07-25), hoje removido — mantidas só como histórico:
- ~~Periodicidade **D**: prazo = data da coluna + Defasagem (dias úteis). **[REVISADO 2026-07-25 — ver seção "Remoção" abaixo]** Toda carteira do Template é considerada esperada em todo dia; não há mais gate de `startDateConsolidation` aqui.~~
- ~~Periodicidade **M** — **[REVISADO 2026-07-25, ver seção "Correção" abaixo]**: TODO dia `d` julga o **fechamento vigente** (o último dia útil de mês ≤ `d`, calculado por `fechamento_vigente_no_dia()`) — não só o dia exato do fechamento. O prazo é o **SLA mensal somado**: `data_limite = fechamento_vigente + 15du`. A célula fica vermelha (`∅`, mesma regra de atraso do regime diário) se `hoje ≥ data_limite` e não há Unprocessed pra esse fechamento; antes disso, cinza-médio "Aguardando".~~
- Dias `d > ref` nunca aparecem no grid (cap na data de referência D-3), mesmo havendo docs futuros no banco.

### Correção 2026-07-25 — regime mensal julga o fechamento vigente todo dia

**Problema reportado pelo usuário:** "mesmo sendo mensal, deveria ter um
alerta já que estamos após o 15º DU do mês" — ao investigar, confirmado que
era um gap real, não impressão: antes desta correção, `compute_cell()`
tratava **só o dia exato do último dia útil do mês** como "esperado" pra
carteiras mensais; **todo o resto do mês** caía incondicionalmente em
`not_due` (cinza "Não cobrado"), mesmo que a carteira estivesse gravemente
atrasada num fechamento anterior. Como a janela padrão do grid é curta (6du,
D-3), bastava o dia do fechamento "sair" da janela visível pra a carteira
ficar cinza em TODOS os dias mostrados — nenhum alerta aparecia, mesmo com o
SLA (fechamento + 15du) já estourado há semanas. Efeito colateral silencioso:
o mockkey `notcov` (rank 2) rankeava essa carteira como *menos* urgente que
uma `wu` (Unprocessed em andamento, rank 3 — não, **mais** urgente que `wu`
mas *menos* que `miss`/`wait`), distorcendo a prioridade de exibição
(Fase 1 do refactor 2026-07-24).

**Pedido do usuário:** remover o estado "Não cobrado (mensal intermediário)"
e deixar só "Aguardando" nesses dias — se estiver atrasado (SLA vencido),
seguir a regra normal de atraso da simbologia (∅/badge).

**Implementação** (`snapshot_builder.py`):

- Nova função `fechamento_vigente_no_dia(calendario, data, cache_fim_de_mes)`:
  resolve qual fechamento mensal está "em vigor" em `data` — o último dia
  útil do PRÓPRIO mês de `data`, se `data` for exatamente esse dia; senão, o
  fechamento do MÊS ANTERIOR (a obrigação que ainda vale até o mês corrente
  fechar).
- `compute_cell()`: o branch do regime mensal parou de distinguir
  "dia do fechamento" vs. "dia intermediário" — TODO dia calcula
  `esperado`/`prazo`/`atraso_du` contra o `fechamento_vigente_no_dia()`,
  exatamente como o regime diário calcula contra o próprio dia. `not_due`
  (cinza "Não cobrado") só sobra pro caso em que o fechamento vigente é
  anterior ao `startDateConsolidation` da carteira (pré-onboarding).
- `compute_wallet_row()`: os documentos do Mongo (`doc_unp`/`doc_pro`/
  `doc_nav`) alimentados em `compute_cell()`/`compute_overlays()`/
  `montar_horarios_celula()` passam a ser resolvidos pelo `data_obrigacao`
  (= `fechamento_vigente_no_dia()` pra regime mensal, = o próprio `data` pra
  diário) — sem isso, o novo `compute_cell()` teria `esperado=True` mas
  nenhum doc pra julgar (o doc real só existe na `positionDate` do
  fechamento, nunca nos dias intermediários). **Exceção deliberada:** o gate
  de sequência (`wallet_sequencia_quebrada()`) continua recebendo o doc do
  **PRÓPRIO dia** (não o resolvido) — é um alerta de regime diário
  ("processada hoje sem processar ontem"); se recebesse o doc do fechamento
  vigente, disparado todo dia em que há um fechamento pendente, geraria
  falso-positivo de "sequência quebrada" em toda carteira mensal processada.
- Efeito esperado: uma carteira mensal com o fechamento anterior ainda em
  aberto agora mostra `Agd` (dentro do prazo) ou `∅`/atraso (SLA vencido) em
  **todo** dia visível até publicar — nunca mais "sumida" atrás de um cinza
  sem alerta. Isso também corrige, de graça, a prioridade de exibição
  (Fase 1) e o bloco de Agrupamento (`classificar_grouping_em_bloco()`), que
  já liam o mockkey da data de referência — e o roll-up de % "Carteiras
  Publicadas"/aba Company, que já excluíam `notcov` do denominador (agora
  carteiras mensais entram no cálculo todo dia, não só no fechamento).
- Textos de UI ajustados nessa rodada: legenda (`matriz.js`), painel de
  detalhe (`paineis.js`) e nota da aba Company (`matriz_company.js`) — "não
  cobrado" descrito só como pré-onboarding, sem mais "mensal intermediário".
  **[SUPERSEDIDO no mesmo dia — ver seção abaixo]** o pré-onboarding também
  saiu, então esses textos foram reajustados de novo.

### Remoção 2026-07-25 — aposentado o gate de pré-onboarding em carteiras

**Pedido do usuário**, em sequência à correção acima: "removemos esse
status? Se sim, precisamos remover de tudo — 'Não cobrado neste dia
(pré-onboarding)'". Esclarecido que o mockkey `notcov` também é usado em 2
lugares de **Agrupamento** sem relação nenhuma com onboarding de carteira
(bloco 3 sem carteira-membro rastreada; dia sem membro ativo) — perguntado
ao usuário o que fazer com esses 2 casos, que confirmou: **manter para
Agrupamentos, remover só de Carteiras** (recomendado, evita ter que inventar
outro estado pros 2 casos de Agrupamento). Contexto do porquê remover:
**o usuário vai manter um processo operacional que só inclui uma carteira em
`TemplateCarteiras.xlsx` quando ela realmente inicia** — ou seja, o cenário
"carteira cadastrada antes de existir" deixa de poder acontecer na prática,
tornando o gate de código redundante.

**Implementação** (`snapshot_builder.py`):

- `compute_cell()`: removido o gate de `startDateConsolidation` por completo,
  nos dois regimes — toda carteira do Template é "esperada" em todo dia.
  Simplificado junto: a variável `esperado` (sempre `True` agora) saiu da
  função e do seu retorno (`compute_cell()` passou a devolver `(estado,
  sigla, atraso_du, prazo)`, 4 valores em vez de 5); o branch `else: estado =
  "not_due"` (nunca mais alcançável) foi removido.
- `STATE_TO_MOCKKEY`: removida a entrada `("not_due", None): "notcov"` —
  como `compute_cell()` nunca mais produz o estado `"not_due"`, essa entrada
  ficaria morta. `MOCKKEY_TO_STATE`/`MOCKKEY_LETTER`/`MOCKKEY_PRIORITY_RANK`/
  `RANKING_SEVERIDADE`/`ORDEM_ESTAGIO` **mantiveram** a entrada `notcov` —
  são consumidas por `montar_linha_grouping_bloco3()`/
  `montar_celula_grouping_dia()`, que montam a célula `{"s": "notcov", ...}`
  diretamente (nunca passam por `STATE_TO_MOCKKEY`), então continuam
  precisando do mockkey definido nesses outros mapas.
- `wallet_sequencia_quebrada()` **não foi tocada** — continua usando
  `startDateConsolidation` pra decidir se o dia útil anterior já estava
  onboarded, um uso independente do estado da célula (gate de sequência,
  regime diário). O campo `startDateConsolidation` também continua exposto
  no dict da carteira (painel "Cadastro & SLA", Excel) — só o GATE de
  produção do mockkey `notcov` saiu, não o campo em si.
- Textos de UI corrigidos de novo (agora removendo "pré-onboarding" por
  completo, não só o "mensal intermediário"): legenda (`matriz.js` —
  descrição do `notcov` reescrita pra deixar claro que é exclusivo de
  Agrupamentos), painel de detalhe (`paineis.js` — "Sem dado para este dia"
  em vez de citar onboarding) e nota da aba Company (`matriz_company.js` —
  removida a menção a "dias não cobertos").
- Efeito esperado: nenhuma carteira do Template mostra mais `notcov` em
  nenhum dia, nunca — o card "Não cobrado" do painel de KPI (Fase 2 do
  refactor 2026-07-24) fica sempre em 0 pra Carteiras (não é erro, só reflete
  que o estado não se aplica mais a elas); Agrupamentos continuam usando
  `notcov` normalmente pros seus 2 casos legítimos.

### Correção 2026-07-27 — regime mensal aposentado por completo do estágio/atraso (caso JKZ OTHERS BRL)

**Problema reportado pelo usuário:** "a rotina está apontando a seguinte
carteira como sem posição, porém tem posição e está processada, tanto para o
dia 22/07/2026 e dias anteriores: JKZ OTHERS BRL / `69864838b2900dbc63901fb4`".
Investigando, a carteira tem `Periodicidade: M` **e** `Repetição Diária: Sim`
no `TemplateCarteiras.xlsx` — mas a correção de 2026-07-25 acima
(`fechamento_vigente_no_dia()`) só julgava o fechamento do MÊS anterior/vigente,
nunca olhando os documentos que essa carteira de fato gera quase todo dia
(por causa da `Repetição Diária`). Resultado: a carteira aparecia como "sem
posição" mesmo tendo Unprocessed/Processed processados normalmente no dia.

**Pedido definitivo do usuário**, após esclarecimentos (perguntado via
AskUserQuestion sobre como tratar `Repetição Diária` ausente/presente):
"desejo que as sinalizações de sem carga, unp, pro, pub sigam o sinal da data
independente da condição Mensal ou afim, essa condição Mensal deve somente
influenciar o alerta Rent" — e, confirmando a opção mais radical (aplicar a
mesma regra a TODA carteira mensal, com ou sem `Repetição Diária`): **"Mesma
regra por dia, sem exceção (conforme pedido)"**.

**Implementação** (`snapshot_builder.py` / `build_snapshot.py`):

- Removida por completo a distinção de regime em `compute_cell()` — a função
  do fechamento vigente (`fechamento_vigente_no_dia()`/
  `_fim_do_mes_cacheado()`, criadas em 2026-07-25) foi **excluída**. Todo
  estágio (`done`/`wip_*`/`pending`/`miss_*`) e todo cálculo de atraso
  (`atraso_du`) passam a usar **sempre** `calendario.prazo_regime_diario(data,
  lagBizDays)` — o mesmíssimo cálculo já usado pro regime diário — para
  **qualquer** carteira, `Periodicidade` D ou M, com ou sem `Repetição
  Diária`.
- `compute_wallet_row()` voltou a resolver `doc_unp`/`doc_pro`/`doc_nav` pelo
  **próprio dia da coluna** (`unp_map.get((wallet_id, data))` etc.) pra
  TODAS as carteiras — removida a resolução via `data_obrigacao` (fechamento
  vigente) que só fazia sentido enquanto o regime mensal existia.
- `montar_texto_sla_celula()` deixou de ter um branch por periodicidade —
  o texto do SLA (`"atrasada +Ndu (limite era X)"` / `"no prazo (limite X)"`)
  é montado do mesmo jeito pra D e M.
- `Periodicidade`/`Repetição Diária`/`Defasagem` (colunas do
  `TemplateCarteiras.xlsx`) **passam a ser puramente metadado de exibição**
  (campo `monthly` no snapshot, colunas "Periodicidade"/"Defasagem" no Excel)
  — não influenciam mais em nada o cálculo de estágio/atraso/prioridade.
  Conforme o pedido do usuário, a condição Mensal continua reservada para
  influenciar **só o alerta de Rentabilidade** (cálculo de
  `returnNavPerShare`/WDA, ver [[feedback_wda_sign_convention]] — fora do
  escopo desta correção, que tratou apenas estágio/atraso de carga).
- `wallet_sequencia_quebrada()` **não foi tocada** — continua um gate
  independente baseado em `startDateConsolidation`/regime diário, sem
  relação com a correção acima.
- Efeito esperado: nenhuma carteira do Template pode mais aparecer "sem
  posição"/atrasada por causa de uma janela de fechamento mensal mal
  resolvida — o sinal de carga (`p`/`cD`/`wc`/`wu`/`miss`) reflete
  exclusivamente o que existe (ou não) no Mongo pra aquele dia exato, para
  qualquer carteira. Validado contra JKZ OTHERS BRL: passou a mostrar `cD`
  (Processada) em 22/07/2026 e dias anteriores, como esperado.

### Queries (3 batch queries por render — nunca N+1)

```python
# ids = todas as walletIds do registry visíveis no filtro atual (≤792 strings)
# d0, d1 = primeira/última data útil do range (strings YYYY-MM-DD)
# d1 = data de referência do grid (hoje − GRID_REFERENCE_LAG_DU, default D-3)

unp = db.unprocessedSecurityPositions.find(
    {"walletId": {"$in": ids}, "positionDate": {"$gte": d0, "$lte": d1},
     "trashed": {"$ne": True}},
    {"walletId": 1, "positionDate": 1, "createdAt": 1, "inputType": 1})

pro = db.processedPosition.find(
    {"walletId": {"$in": ids}, "positionDate": {"$gte": d0, "$lte": d1},
     "trashed": {"$ne": True}},
    {"walletId": 1, "positionDate": 1, "published": 1, "createdAt": 1, "updatedAt": 1})

nav = db.navPackages.find(
    {"walletId": {"$in": ids}, "positionDate": {"$gte": d0, "$lte": d1},
     "trashed": {"$ne": True}},
    {"walletId": 1, "positionDate": 1, "returnContribution": 1,
     "returnNavPerShare": 1, "published": 1, "createdAt": 1})
```

Volumetria medida (2026-07-15): ~427 unprocessed/dia, ~202 processed/dia, ~74 navPackages/dia ⇒ range de 10du ≈ 7k documentos magros por render. Com projeção sem `securities[]`, é barato.

As colunas-resumo "última data" usam uma agregação separada (1 por coleção, cacheada 60s):

```python
db.processedPosition.aggregate([
    {"$match": {"walletId": {"$in": ids}, "trashed": {"$ne": True},
                "positionDate": {"$lte": today_str}}},   # cap: ignora datas futuras
    {"$group": {"_id": "$walletId", "last": {"$max": "$positionDate"}}}
])
```

### Ordenação das linhas — lista plana priorizada por problema

> **[SUPERSEDIDO 2026-07-24, pedido do usuário]** Todo o conceito de **tier**
> (Crítica/Atenção/Observação/OK) e de **`priorityScore`** (score 0–100)
> descritos daqui até o fim desta seção foi **aposentado** — retirado do
> backend (`snapshot_builder.py`/`build_snapshot.py`) e do frontend
> (`state.js`/`filtros.js`/`paineis.js`/`matriz.js`). Mantido abaixo só como
> **registro histórico** (explica por que a fórmula antiga tinha os pesos que
> tinha). O modelo ATUAL de prioridade/ordenação está descrito em
> [Refactor 2026-07-24 — prioridade, tier e anotações](#refactor-2026-07-24--prioridade-tier-e-anotações),
> logo depois desta seção histórica.

**[decisão do usuário 2026-07-17]** "Não agrupe por instituição (…) manter lista por carteira, priorizando exibição prioritária das com problema e deixar as bem por final." A ordenação é **determinística** (chave de ordenação total — dado o mesmo snapshot do banco, a ordem é sempre a mesma) e calculada em memória sobre as células já montadas do grid — zero queries extras.

**Passo 1 — tier de severidade da carteira** = pior estado entre as células visíveis da janela:

| Tier | Nome | Condição (estados da seção Simbologia) |
|---|---|---|
| 0 | **Crítica** | ≥1 célula vermelha (`miss_late`/`miss_very_late`) |
| 1 | **Atenção** | sem vermelho, ≥1 célula em progresso atrasada (`wip_late`/`wip_very_late` — [rodada 7] fundo de estágio + badge Atraso) |
| 2 | **Observação** | sem vermelho/atraso, mas ≥1 overlay de alerta na janela (divergência ●/○, fora de sequência, issue pendente — o badge Atraso NÃO conta aqui, ele é reflexo dos estados do tier 1) |
| 3 | **OK** | só concluídas / em progresso no prazo / cinzas, sem overlays |

> O tier 2 existe porque uma carteira toda verde com divergência de rentabilidade é problema real (qualidade de dado) mesmo com a esteira em dia — não pode afundar no meio das saudáveis.

**Passo 2 — chave de ordenação (pseudocódigo):** **[SUPERSEDIDO 2026-07-17 pela Pontuação de prioridade abaixo — mantido como registro histórico; o tier continua existindo para exibição/filtros]**

```python
def sort_key(w):
    """Menor = mais prioritário. Insumos: células + overlays já em memória (batch queries do grid)."""
    # 1) tier: pior estado da janela (0=crítica … 3=ok)
    # 2) atraso_du da célula problemática MAIS RECENTE (o que exige ação hoje pesa mais
    #    que um buraco antigo no início da janela); 0 se tier ≥ 2
    # 3) extensão do problema: nº de células vermelhas + âmbar na janela
    # 4) agravante de overlays: soma na janela (divergência red=3, divergência=2,
    #    fora de sequência=2, célula-dia com issues pendentes=1)
    # 5) nome completo da carteira (casefold) — desempate final; fecha a chave como
    #    ordem TOTAL: nunca há empate residual, logo nunca há ordem instável
    return (w.tier,
            -w.atraso_du_da_celula_problematica_mais_recente,
            -w.n_celulas_vermelhas_ou_ambar,
            -w.overlay_score,
            w.nome.casefold())

rows.sort(key=sort_key)
```

### Pontuação de prioridade — score único 0–100 **[REVISADO 2026-07-17 — substitui a tupla `sort_key`]**

A tupla de desempate acima foi substituída por um **score numérico único** (`priorityScore`, 0 a 100, **100 = pior possível**), calculado no `build_snapshot.py` e exposto no dado de cada linha (carteira E agrupamento) — comparável entre linhas, exibível no painel de detalhe ("Prioridade 87/100") e exportável no Excel.

**Fórmula:**

```
score = 100 × (0.45·S + 0.25·A + 0.15·E + 0.15·O) − 5·G,   clamp em [0, 100]
```

| Fator | Definição | Normalização | Peso |
|---|---|---|---|
| **S** — severidade | pior célula da janela: `miss_very_late` 1.0 · `miss_late` 0.9 · `wip_very_late` 0.35 · `wip_late` 0.15 · demais 0 — **[REVISADO 2026-07-22, pedido do usuário "pontuação carga vazia maior quantidade de pontos"]** gap ampliado entre vazio (`miss_*`, nada carregado) e andamento (`wip_*`, algo carregado); valores antigos: `miss_late` 0.8 · `wip_very_late` 0.55 · `wip_late` 0.35 | já em [0,1] | **0.45** (dominante) |
| **A** — atraso | `atraso_du` da célula problemática **mais recente** (a que exige ação hoje) | `min(atraso, 10)/10` (satura em 10du) | 0.25 |
| **E** — extensão | nº de células vermelhas+atrasadas (`miss_*`/`wip_late`/`wip_very_late`) na janela | `/ N dias da janela` | 0.15 |
| **O** — overlays | soma na janela: divergência forte 3 · divergência 2 · fora de sequência 2 · dia com issues 1 | `min(overlay_score, 12)/12` | 0.15 |
| **G** — comentário verde | 1 se há comentário **verde** vigente de **linha** (analista sinalizou "sob controle"); se o alvo também tem amarelo/vermelho vigente, o mais grave vence e não há desconto | desconto fixo de **5 pontos** | −5 |

Decisões de desenho:

- **Ordenação**: carteiras por `(-score, nome.casefold())`; agrupamentos por `(bloco, -score, nome.casefold())` — o **bloco continua como prefixo** (o score ordena *dentro* de cada bloco, nunca entre blocos), e o nome permanece como desempate final de estabilidade (ordem total, nunca instável). O campo `sortKey` do snapshot passa a ser exatamente essas listas.
- **Cruzamento de tiers é intencional**: com um score aditivo, uma carteira âmbar *crônica* (atraso ≥10du, janela toda problemática, overlays: ~0.55·45+25+15+15 ≈ 80) pode superar um vermelho *pontual* de 1 dia (~0.8·45+2.5 ≈ 39) — é o comportamento desejado de um score real de urgência agregada, diferente da tupla antiga em que o tier era um teto intransponível. O tier continua calculado e exibido (badge, stats, filtro "só com pendência"), só não comanda mais a ordenação.
- **Saturações** (atraso 10du, overlays 12 pts) evitam que um único eixo "barulhento" domine o ranking.
- O antigo componente `%pendentes` do `sort_key_grouping` foi absorvido pelo fator **E** (extensão): um agrupamento com muitos membros travados fica com mais dias de janela em vermelho/âmbar. O roll-up de agrupamento herda o **atraso real** da pior carteira-membro (campo `adu` da célula), não mais a aproximação de 1du.
- **Desconto G reavaliado só a cada rebuild do snapshot** (o build lê `data/alert_comments.json` na hora de gerar) — caveat aceito no protótipo estático; no app real o score seria recalculado no snapshot TTL 60s.

Exemplo com dois extremos reais: carteira com `miss_very_late` na janela, atraso recente 8du, 9 de 14 dias problemáticos e overlay_score 3 → `100·(0.45·1.0 + 0.25·0.8 + 0.15·0.643 + 0.15·0.25) ≈ 78.4`; carteira saudável (só concluídas/em progresso no prazo, sem overlays) → `0.0`.

**Recalcular a cada carga de página?** Sim — é o comportamento desejado de uma *worklist* ("o topo é o que eu ataco agora"); a ordem só muda quando os dados mudam. O snapshot do grid é cacheado 60s, então F5 dentro do TTL nem reordena. Para o caso "quero ter certeza de onde a carteira está", dois fallbacks:

- **Ordenação manual por coluna** (clique no header): Nome / Instituição / Company / Última Publicada, asc/desc — escolha persistida em `data/settings.json` (`"grid_sort": "priority" | "name" | "institution" | "company" | "last_published"`). `"priority"` é o default.
- **Botão "Congelar ordem"**: pina a ordem corrente na sessão do browser (sessionStorage) — as células continuam atualizando, só as linhas param de trocar de lugar; badge "ordem congelada às HH:MM" + botão para soltar. É preferência de leitura, não estado do sistema — nada server-side.
- Complemento: campo de busca por nome filtra a lista na hora (a forma mais rápida de achar uma carteira específica, independente da ordem).

**Instituição/Company como colunas fixas (não mais cabeçalho de grupo):**

- Revisão (17/07): a Company ganhou **coluna própria, fixa, a primeira da tabela** (à esquerda de "Carteira") — não é mais um chip condicional. Ordem final das colunas fixas (sticky, `left` empilhado): **Company → Carteira → Instituição** → depois as colunas de data.
- **Company**: texto simples (nome curto, ex. `Oikos WM`, `Blue3`), `text-[12px] text-gray-600 font-medium`, sticky à esquerda de tudo. Sempre visível — mesmo com `CompanySelector` filtrado numa única company (nesse caso a coluna existe mas fica visualmente "achatada": todas as linhas com o mesmo valor, o que é aceitável e evita reflow ao trocar o filtro).
- **Carteira**: nome completo (regra da casa: `"007CVG - 005285190"`).
- **Instituição**: chip pequeno à direita do nome da carteira: `text-[10px] px-1.5 py-px rounded bg-gray-100 text-gray-500` (ex.: `XP`, `BTG`). Cinza neutro de propósito — **cor é reservada para status**; o chip é metadado, não semáforo.
- Tanto o texto de Company quanto o chip de Instituição são clicáveis como atalho de filtro ("mostrar só XP" / "mostrar só Oikos WM"), espelhando o `CompanySelector`.
- Na aba **Agrupamentos**, vale a **paridade de informação** com a aba Carteiras **[REVISADO pelo usuário 2026-07-17 — supersede a decisão anterior de omitir a Instituição]**: a coluna Company se mantém e a coluna Instituição também existe, com regra própria de preenchimento (um grouping pode misturar instituições) — regra exata na subseção "Paridade de informação" da seção [Visão por Agrupamento](#visão-por-agrupamento).

### Revisão da Pontuação de Prioridade — 2026-07-20

**[ANÁLISE — nenhum código foi alterado; proposta para o desenvolvedor decidir antes de implementar]** Motivada pela redução da janela padrão do grid de ~14-25du para 5du ([Grid de Status Diário](#grid-de-status-diário)) e pela separação estágio/atraso na simbologia ([Simbologia](#simbologia-da-matriz-de-status), rodada 7). Metodologia: leitura de `snapshot_builder.py` (implementação atual de `compute_priority_score`/`AcumuladorJanela`) e reconstrução, em script de investigação à parte (não versionado, não altera o protótipo), do score de todas as 792 carteiras do `snapshot.json` gerado hoje (2026-07-20, janela `2026-07-09..2026-07-15`, `referenceDate=2026-07-15`), para comparar a fórmula vigente com alternativas célula a célula.

#### 1. Janela encolhida (25→5du) infla o fator E? — **problema real, mas não do jeito hipotetizado**

Distribuição real de `redAmber` (nº de dias vermelho/âmbar dentro da janela de 5) nas 792 carteiras: `{0: 102, 1: 9, 3: 7, 4: 638, 5: 36}`. Ou seja, **674 carteiras (85%) têm 4 ou 5 dos 5 dias da janela problemáticos**, e só **9 carteiras (1,1%) têm exatamente 1 dia isolado**. Cruzando com `lastPublished`: as 674 carteiras do bloco "4-5" majoritariamente têm `lastPublished` travado há semanas (339 carteiras em `2026-06-01`, 57 em `2026-05-29`, 54 em `2026-06-05`, etc. — quase metade das 792 carteiras não publica desde o início/fim de junho) enquanto as 9 carteiras "1 dia isolado" têm `lastPublished` recente (ex. `JKZ PF BTG BRL`, `MML PF BTG BRL`, `RGM PF BTG BRL`: `lastPublished=2026-07-14`, 1 dia útil antes do fim da janela).

Isso muda a leitura do problema: **o cenário "1 dia ruim isolado inflando o score por causa da janela pequena" é raro na base atual e, quando ocorre, o impacto no score é pequeno** (ver exemplo `JKZ PF BTG BRL` abaixo, Δ≈1,9 pontos) — porque o fator E pesa só 0,15 do total. **O problema real é outro: com janela de 5 dias, `E = n_dias_problema / n_dias_janela` satura em 1,0 assim que uma carteira acumula ≥5 dias úteis de atraso — e isso acontece para QUALQUER atraso ≥5du, seja ele de 5du ou de 40du.** O fator perde toda capacidade de diferenciar carteiras "só um pouco crônicas" de carteiras "há semanas paradas" — as 674 carteiras do bloco 4-5 ficam com E≈0,8-1,0 independente da gravidade real, comprimindo o score de toda a massa crítica numa faixa estreita (confirmado abaixo: 325 das 792 carteiras hoje pontuam ≥60, uma faixa de 17 pontos de largura pra 41% da base). Na janela antiga de 14-25du, esse teto de saturação demorava muito mais a ser atingido, preservando gradação entre "5 dias ruins" e "20 dias ruins".

**Conclusão: problema real — não pela inflação de casos isolados, mas pela perda de resolução/diferenciação da fórmula dentro do grupo já problemático.** Proposta de correção na seção "Proposta" abaixo.

#### 2. S (severidade) ainda faz sentido após o badge "Atraso" virar elemento próprio? — **não é um problema**

Rastreado no código: `PESO_SEVERIDADE` (fator S) e `atraso_overlay_kind` (o que decide o badge "Atraso" amarelo/vermelho) **leem o mesmo campo `estado`** produzido por `compute_cell()` (`wip_late`/`wip_very_late`/`miss_late`/`miss_very_late`) — a separação visual estágio/atraso (rodada 7) foi só uma mudança de *apresentação* (fundo vs. badge), a *lógica* de severidade por trás de ambos nunca foi desacoplada; é a mesma fonte única de verdade. Não há drift possível por construção. **Nenhuma mudança necessária em S ou A.**

#### 3. Os 3 blocos de Agrupamentos precisam de pesos diferentes dentro de cada bloco? — **não precisa mudar**

O bloco (1 = com pendência no Template / 2 = sem pendência / 3 = não rastreados) já é o mecanismo de segmentação por *qualidade* da situação — o `sortKey` usa `(bloco, -score, nome)`, ou seja, o bloco nunca é ultrapassado pelo score (é sempre o prefixo). Usar a **mesma fórmula de score dentro de cada bloco** é o comportamento correto: dentro do bloco 1 (que já sabemos ter pendência), o score deveria mesmo continuar respondendo "qual dessas está pior", com a mesma semântica usada na aba Carteiras — inventar pesos diferentes por bloco criaria duas escalas de urgência incomparáveis sem ganho real (o bloco já resolve o particionamento; o score resolve o ranking dentro dele). **Nenhuma mudança recomendada.**

#### 4. Comentário vermelho vigente deveria aumentar o score (hoje só o verde desconta)? — **vale adicionar**

Hoje `load_green_comment_targets()` só devolve alvos cujo comentário de linha mais grave vigente é verde; um comentário vermelho vigente ("cliente reclamou", "risco de compliance", "escalar mesmo que o sistema não veja") **não tem nenhum efeito no score nem no tier** — só aparece como balão na célula. Isso é uma assimetria real: o sistema já reconhece que um humano pode saber mais que os dados (por isso o desconto verde existe), mas só deixa isso *reduzir* urgência, nunca *aumentar*. O caso mais importante é justamente o pior: uma carteira **tier OK/Observação** (score baixo, fora do radar) com um comentário vermelho de escalonamento manual — hoje ela continua invisível nos filtros de "só com pendência", que é exatamente o cenário em que o comentário deveria ter mais efeito. **Conclusão: vale adicionar**, com dois componentes (ver proposta): (a) nudge simétrico no score, (b) piso de tier — sem isso, um "+5" sozinho não tira a carteira do fundo da lista.

#### 5. Distribuição real (Crítica 328 / Atenção 362 / Observação 17 / OK 85, de 792) — calibração ou situação real?

Cruzando `redAmber` com `lastPublished` (ponto 1 acima): a concentração em Crítica/Atenção (690/792 = 87%) **reflete majoritariamente atraso genuíno**, não artefato de janela — centenas de carteiras têm `lastPublished` parado há 3-7 semanas (não 1-2 dias). O *tier* (que decide Crítica vs. Atenção vs. resto) é definido pelo pior estado da janela (`S`/`TIER_BY_STATE`), não pelo score, e **não muda com a proposta abaixo** — a proporção 87% Crítica/Atenção continua a mesma depois da correção de E, porque essa correção só redistribui o *score* (ordenação fina) dentro de cada tier, não decide o tier. **Conclusão: a proporção alta em si não é um problema de fórmula** — é um dado operacional (quase metade da base sem publicar desde início/meados de junho) que provavelmente merece uma conversa à parte, fora do escopo desta revisão de pontuação.

#### Proposta de fórmula revisada

```
score = 100 × (0.45·S + 0.25·A + 0.15·E' + 0.15·O) + 5·R − 5·G,   clamp em [0, 100]

E' = min(n_dias_problema, 14) / 14        # ANTES: n_dias_problema / n_dias_janela
R  = 1 se há comentário VERMELHO vigente de linha (nova regra, simétrica ao G)
```

- **Única mudança de peso/normalização: o fator E.** Passa de "proporção da janela exibida" para "contagem absoluta de dias problemáticos, com teto fixo de 14du" (a opção sugerida na tarefa) — o mesmo valor do antigo `N_WINDOW_DAYS=14` que era o default antes da Tarefa 2 do refactor, escolhido por continuidade de calibração (não é um número nova a justificar do zero) e por ficar na mesma ordem de grandeza da saturação de A (10du). Efeito: E deixa de depender do tamanho da janela que o usuário escolher (5 default, ou 10/15/21 se pedir mais no seletor de datas) — uma carteira com 3 dias ruins pontua o mesmo em E hoje, com janela de 5, e amanhã, se o usuário abrir uma janela de 21 dias — o que é o comportamento correto para um fator que representa "quantos dias de problema já se acumularam", não "que fração da tela está colorida".
- **Fator novo: R (comentário vermelho vigente de linha), +5 pontos** — simétrico ao desconto G (−5), mesma vigência/regra de "mais grave vence" já usada em `load_green_comment_targets` (só que capturando o extremo oposto: se o pior comentário vigente é vermelho, R=1; se é verde, G=1; nunca os dois ao mesmo tempo, pois é sempre o "pior" entre os comentários do alvo). **Acompanhado de um piso de tier:** se R=1, o tier exibido/filtrável nunca deve ficar acima de 1 (Atenção), mesmo que o cálculo automático tenha dado 2 (Observação) ou 3 (OK) — sem isso, o "+5" sozinho não tira uma carteira tier-OK (score típico 0-15) do fundo da lista nem a faz aparecer no filtro "Só com pendência", esvaziando o propósito do alerta manual.
- **Pesos S/A/O inalterados** (0.45/0.25/0.15) — o ponto 2 confirmou que continuam alinhados com a simbologia atual; não há motivo para mexer neles.
- **`n_dias_janela` deixa de ser parâmetro do fator E** em `compute_priority_score`/`AcumuladorJanela.score()` (era usado só para essa divisão); pode ser removido da assinatura ou mantido sem uso caso outra chamada dependa dele.

#### Exemplo numérico — fórmula antiga × proposta, 4 carteiras reais do snapshot de hoje (2026-07-20)

| Carteira | Cenário | `redAmber` | `lastPublished` | Score **antigo** | Score **proposto** | Δ |
|---|---|---|---|---|---|---|
| `JKZ PF BTG BRL` | 1 dia ruim isolado (janela de 5) | 1 | 2026-07-14 (recente) | 25,0 (tier Atenção) | 23,1 | **−1,9** |
| `ALMP PF ITAU BRL` | genuinamente atrasada há semanas | 5 | 2026-06-30 (~3 semanas) | 77,5 (tier Crítica) | 67,9 | **−9,6** |
| `ALMP PJ ITAU BRL` | idem, mesma família | 5 | 2026-06-30 (~3 semanas) | 71,2 (tier Crítica) | 61,6 | **−9,6** |
| `ALMP PF ITAU BRL` **+ comentário verde vigente** (ilustrativo — hoje `alert_comments.json` está vazio, nenhuma carteira tem comentário ainda) | analista sinalizou "sob controle" | 5 | 2026-06-30 | 77,5 | 62,9 (67,9 − 5 de G) | **−14,6** |

Note o padrão: a correção **quase não muda** o caso de 1 dia isolado (E já pesava pouco ali — a preocupação original da tarefa existe, mas seu efeito prático é pequeno) e **muda bastante** os casos genuinamente crônicos (E estava saturado em 1,0 por já terem ≥5 dias ruins na janela de 5, mesmo sendo, na prática, 3+ semanas de atraso — não 5 dias). Efeito agregado nas 792 carteiras: média do score cai de 44,2 para 37,5, mediana de 40,5 para 32,8, e principalmente **o número de carteiras pontuando ≥60 cai de 325 para 5** — a fórmula antiga empurrava quase 41% da base para uma faixa de score quase indistinguível (60-77); a proposta redistribui essa massa entre 20-59, restaurando a capacidade de dizer "esta está pior que aquela" dentro do grupo que já sabemos ser crítico. **Os tiers (Crítica/Atenção/Observação/OK) não mudam** — a proposta ajusta só a ordenação fina dentro de cada tier, não a classificação em si (ver ponto 5).

Exemplo de R (comentário vermelho, hipotético — nenhum existe hoje): `LOTUS PIC JPM USD` (tier OK, score 0,0 hoje) com um comentário vermelho manual ("cliente reclamou, escalar") passaria a score 5,0 **e** teria o tier-piso elevado para Atenção (1) — sem o piso de tier, ficaria em 5,0 no meio de centenas de outras carteiras na casa dos 20-40 e nunca apareceria no filtro "Só com pendência".

#### Status: **Implementado 2026-07-20**

Aprovado pelo desenvolvedor e implementado no mesmo dia da análise acima, direto em `snapshot_builder.py` (sem mudança de arquitetura — só a fórmula/fatores):

- `compute_priority_score()`: assinatura perdeu `n_dias_janela` (fator E não depende mais do tamanho da janela); ganhou `comentario_vermelho_ativo` (fator R, +5). `E' = min(n_dias_problema, 14) / 14` — nova constante `SCORE_EXTENSAO_TETO_DIAS_PROBLEMA = 14`; nova constante `SCORE_BONUS_COMENTARIO_VERMELHO = 5.0`.
- `AcumuladorJanela.tier(comentario_vermelho_ativo=False)`: novo parâmetro — aplica o **piso de tier**: `min(tier_calculado, 1)` quando há comentário vermelho vigente (nunca deixa a linha acima de Atenção).
- `AcumuladorJanela.score(comentario_verde_ativo, comentario_vermelho_ativo=False)`: repassa o novo fator pra `compute_priority_score`.
- **Leitura de comentários refatorada** para evitar duplicar a leitura do arquivo: `_pior_severidade_comentario_por_alvo()` (privada, nova) lê `data/alert_comments.json` uma única vez e devolve a pior severidade vigente por alvo; `load_green_comment_targets()` e a nova `load_red_comment_targets()` só filtram esse dicionário.
- `compute_wallet_row()` e `compute_groupings_rows()` (inclusive `montar_linha_grouping_bloco3()`, bloco 3) passaram a receber `alvos_comentario_vermelho` e aplicar R/piso de tier — **confirmado que o roll-up de Agrupamentos usa a MESMA `AcumuladorJanela`/`compute_priority_score` da aba Carteiras**, então a correção vale para os dois lugares sem lógica duplicada.
- `build_snapshot.py`: chama `load_red_comment_targets(DATA_DIR, hoje)` ao lado do `load_green_comment_targets` já existente e repassa para as duas chamadas de montagem de linha.

**Validação com dados reais (rebuild de `build_snapshot.py`, janela `2026-07-09..2026-07-15`, mesmo dia da proposta):**

| Carteira | Score **proposto** | Score **real pós-implementação** |
|---|---|---|
| `ALMP PF ITAU BRL` | 67,9 | **67,9** (exato) |
| `ALMP PJ ITAU BRL` | 61,6 | **61,6** (exato) |
| Carteiras com score ≥60 (de 792) | 5 | **5** (exato) |
| Mediana do score | 32,8 | **32,8** (exato) |
| Média do score | 37,5 | 37,36 (dado do dia mudou levemente) |

`JKZ PF BTG BRL` (o caso "1 dia isolado" da análise) hoje aparece **saudável** (score 1,2, tier Observação, `redAmber=0`) em vez do 23,1 projetado — não é discrepância de fórmula: o dia isolado ruim (2026-07-14) saiu da janela exibida entre a análise e o rebuild (dados mudam dia a dia, como o próprio plano de teste já previa). Os tiers não mudaram de mecanismo (Crítica 328/Atenção 357/Observação 20/OK 85→87 hoje vs. 328/362/17/85 na análise — variação normal de um dia de dado, não da fórmula, confirmando o ponto 5 da análise).

**Fator R e piso de tier** (nenhum comentário vermelho existe hoje em produção — `alert_comments.json` vazio): validados em teste isolado com um comentário vermelho fake num diretório de dados temporário (nunca tocando o arquivo real). Resultado: linha 100% saudável (tier automático 3, score automático 0,0) virou **tier 1 (Atenção), score 5,0** com o comentário vermelho vigente — exatamente o comportamento do exemplo `LOTUS PIC JPM USD` acima.

---

## Refactor 2026-07-24 — prioridade, tier e anotações

Leva grande de ajustes pedida pelo usuário, organizada em 4 fases sequenciais
(plano escrito e aprovado antes de implementar, a pedido explícito do
usuário: "são muitas modificações, se organize bem antes"). Substitui o
modelo de tier/`priorityScore` descrito acima.

### Fase 1 — fundamentos de backend

- **Janela default volta a D-3** (`GRID_REFERENCE_LAG_DU=3`, `utils/datas.py`)
  — tinha sido mudada pra D-5 por 1 dia (2026-07-23→2026-07-24), a pedido do
  próprio usuário revertida no dia seguinte.
- **Novo racional de atraso**: em `compute_cell()`, o corte de "atrasado"
  passou de `atraso_efetivo <= 0` (só a partir do dia seguinte ao prazo) para
  `< 0` — o **próprio dia do vencimento** já conta como atrasado (1-2du),
  não mais só a partir do dia seguinte.
- **`miss`/`miss2` consolidados num único mockkey `miss`**: a distinção de
  severidade (1-2du vs ≥3du) continua existindo internamente (`state_from_cell()`,
  campo `adu`) só pra decidir o badge de Atraso e o desempate de prioridade —
  o *fundo/estado visual* virou um só ("as sinalizações de atraso já avisam
  se está atrasado", pedido do usuário).
- **Tier (Crítica/Atenção/Observação/OK) e `priorityScore` (0–100)
  aposentados por completo** — nenhuma das duas seções acima
  (`STATE_TO_MOCKKEY`/`AcumuladorJanela`/`compute_priority_score`/`TIER_BY_STATE`/
  `OVERLAY_WEIGHTS`) sobrevive no código; `montar_snapshot()` não expõe mais
  `tier`, `priorityScore`, `redAmber`, `overlayScore` nem `tierCounts` em
  nenhuma linha/meta do snapshot.
- **Nova fórmula de prioridade** (`compute_sort_key()`, `snapshot_builder.py`)
  — pedida explicitamente pelo usuário: rank do mockkey **na data de
  referência** (pior→melhor, mesma ordem usada na legenda — ver
  `MOCKKEY_PRIORITY_RANK`: `miss` 0 · `wait` 1 · `notcov` 2 · `wu` 3 · `wc` 4
  · `cD` 5 · `p` 6), com desempate pela **contagem de dias da janela
  pesquisada com esse MESMO mockkey** (mais dias iguais = mais prioritário —
  exemplo do usuário: "sem posição em todos os dias do range = prioridade
  máxima"). `sortKey = [rank, -contagem, nome.casefold()]`, tanto para
  carteiras quanto para agrupamentos (`compute_sort_key()` reaproveitada nos
  dois lugares, incluindo bloco 3 dos agrupamentos).
- **Filtro "Só com pendência"** (`state.onlyPending`) passou a esconder
  linhas cujo mockkey na data de referência é `p` ou `cD`, em vez de "tier ≤
  2". Mesmo critério usado para separar bloco 1 (com pendência) de bloco 2
  (sem pendência) na aba Agrupamentos (`classificar_grouping_em_bloco()`).
  **[REMOVIDO 2026-07-25, pedido do usuário]** O filtro/chip em si saiu da
  tela (`filtros.js`) — a classificação em blocos 1/2 dos Agrupamentos
  continua usando o mesmo critério de mockkey internamente, só não há mais
  um chip equivalente do lado do usuário na aba Carteiras.

### Fase 2 — painel de KPI + timestamp do Atualizar

- O antigo painel de 4 cards (Crítica/Atenção/Observação/OK) foi substituído
  por cards com a **mesma simbologia da legenda** — 1 card por mockkey, com
  o swatch colorido + sigla da legenda, contando quantas carteiras têm
  aquele mockkey na data de referência, **respeitando os filtros ativos**
  (company/instituição/busca — mesmo espírito do painel "Carteiras
  Publicadas" já existente). `buildHeader()`, `matriz.js`; recalculado a
  cada `buildMatrix()` (filtro-aware).
- Novo rótulo fixo no `#toolbar3` (`#atualizar-timestamp`) mostrando
  "dd/mm/aaaa HH:MM:SS" do último clique no botão "Atualizar" — gravado no
  momento do clique (não só em caso de sucesso), fica visível até o próximo
  clique. `executarAtualizacao()`, `atualizar.js`.

### Fase 3 — hover/clique em Agrupamentos e Carteiras

- **Hover na célula de Agrupamento** (`groupingTooltip()`, `matriz.js`) passa
  a listar os NOMES das carteiras-membro **não processadas naquele dia
  específico** (mockkey ∉ {`wc`,`cD`,`p`}) — dado calculado no backend
  (`montar_tooltip_celula_grouping()` grava `tt.unprocessedIds` — lista de
  walletIds — em toda célula de agrupamento, `snapshot_builder.py`) e
  resolvido pra nome no front via `window._WALLETS_BY_ID`.
- **Clique em Agrupamento** — seção antes chamada "Carteiras ofensoras"
  (por tier ≤ 2) renomeada para **"Carteiras não processadas"** (mesmo
  critério "não processada" da data de referência) e agora exibe **Nome da
  Carteira + WalletID** (antes só o nome). `buildSecaoOfensorasGrouping()`/
  `offenderListHtml()`, `paineis.js`.
- **Clique em Carteira** — seção "Agrupamentos da carteira" passou a exibir
  o **GroupingID** ao lado do nome de cada agrupamento (mesmo padrão do
  `walletId` já exibido no cabeçalho do painel). `buildSecaoGroupingsCarteira()`,
  `paineis.js`.

### Fase 4 — grade "estilo Excel"

- **Ordenação por cabeçalho com seta de direção**: clicar num `<th
  data-sort>` (ou no botão correspondente da sortbar) aplica aquele
  critério; clicar de novo no MESMO critério já ativo **inverte a direção**
  (seta ▲ padrão / ▼ invertida — `state.sortDir`, `aplicarCriterioOrdenacao()`
  em `index.js`, aplicado em `sortArrayBy()`, `filtros.js`). **Prioridade**
  virou também uma coluna própria da grade (`col-summary`, swatch + "estado
  · contagem/tamanho da janela"), clicável como as demais — antes só existia
  como botão da sortbar.
- **Filtro "Só divergência > 0,02%"** (`state.onlyDivergent`, `filtros.js`)
  — mostra só linhas cujo `tt.div.bp` na data de referência é > 2 (0,02% =
  2bp).
- **3 filtros adicionais** [2026-07-25, pedido do usuário]: **Status na Data
  Ref** (`state.statusRef`, select) — filtra pelo mockkey PURO da linha na
  data de referência, ignorando overlays/alertas (Rent/Atraso/Sequência não
  entram); **Responsável contém** e **Comentário contém**
  (`state.buscaResponsavel`/`state.buscaComentario`, campos de texto livre)
  — busca "contém" (case-insensitive) contra a anotação da linha na data de
  referência (`annotationAtual()`, `anotacoes.js`). Mesmo padrão dos demais
  filtros: aplicados em `applyFilters()`, sem mudança de backend (os dados
  já estão todos no cliente).
- **Anotações por linha** — 2 colunas editáveis novas, **Responsável** e
  **Comentário sobre atuação**, ligadas SÓ à data de referência (nunca por
  dia da janela). Persistência própria: `data/wallet_annotations.json` +
  `GET`/`POST /api/annotations` (`app.py`), mesmo padrão de
  `alert_comments.json`/`/api/comments` mas com **upsert** (não
  append-only) — chave composta `(targetType, targetId, referenceDate)`,
  MESMO par `targetType`/`targetId` já usado pelos comentários (vale tanto
  pra Carteiras quanto Agrupamentos, mesma paridade de colunas do resto da
  grade). Edição fica em buffer local (`PENDING_ANNOTATIONS`,
  `static/js/controle_cargas/anotacoes.js` — arquivo novo, 1 por
  funcionalidade) até o clique em **"💾 Salvar"** (toolbar2, ao lado de
  "Baixar Excel"), que manda o lote inteiro num único POST. As mesmas 2
  colunas entram no Excel exportável (`exportar.js`, aba Matriz), lidas da
  data de referência.
- **Ações ℹ️/📋 de nome/id** **[NOVO 2026-07-30, pedido do usuário: "sempre
  onde tiver o nome da carteira, nome do grupo, ou walletid ou groupingId
  deve ser possível copiar clicando" + "conseguimos colocar um simbolo de
  informação e um de copiar?"]** — arquivo novo
  `static/js/controle_cargas/identificadores.js` (CLAUDE.md §4, 1 por
  funcionalidade): botão **📋** copia o texto pra área de transferência (com
  aviso `#copy-toast`, canto inferior direito) em TODO lugar que mostra nome
  de carteira/agrupamento ou walletId/groupingId; botão **ℹ️** abre o painel
  de detalhe daquele alvo, mas só aparece onde **ainda não existia** outra
  forma de chegar lá a partir do mesmo elemento (evita redundância: nome da
  linha na matriz e linhas de drill-through já abrem ao clicar — só ganham
  📋; mini-matriz de membros e a tabela completa de membros do agrupamento,
  que eram texto puro, ganham os dois). Cliques tratados por **delegação
  global** (`wireAcoesIdentificador()`, ligada 1x em `wire()`) — cobre
  matriz e modal sem precisar religar a cada redesenho.

---

## Especificação dos Alertas

Todos os alertas produzem objetos `{severity, type, walletId|entityName|groupingId, date, message, evidence}` renderizados (a) como badge na célula/linha do grid e (b) num feed ordenado por severidade na página Alertas. Severidades: `red` (ação imediata), `yellow` (atenção), `info`. Thresholds em `data/alert_thresholds.json`.

### 1. Carga Instituição não realizada

- **Input (resolvido):** `Defasagem` do cadastro + agregação por `Instituição` (coluna C ≡ `entities.name` ≡ `wallets.entityId`).
- **Regra:** para a data-alvo `d = hoje_util − lag` de cada regime de defasagem, agrupar as carteiras diárias por instituição e calcular `faltantes/total` (faltante = sem doc em `unprocessedSecurityPositions` para `d`). Se `faltantes/total ≥ inst_failure_ratio` (default **0.8**) e `total ≥ 3` ⇒ **um único alerta agregado** "Carga BTG (API) não realizada para 2026-07-16 — 34/36 carteiras sem Unprocessed" em vez de 34 alertas individuais.
- **Fonte:** mesma query batch do grid (nenhuma query extra).
- **Severidade:** `red` se `hoje > d + lag` (estourou um dia útil inteiro além da defasagem); `yellow` no dia do vencimento antes das 14:00 BRT (marco "Informar Cargas Faltantes" da aba Horários), `red` depois.
- **Distinção conceitual vs. alerta 3:** este é o **feed inteiro** que não rodou (falha sistêmica: API fora, scraping quebrado) — sinalizado no nível instituição×modelo. O alerta 3 é a **carteira individual** que ficou para trás numa carga que rodou para as demais.

### 2. Atraso receb./process. PDF, e-mail etc. (regime mensal/manual)

- **Input (resolvido):** `du Recebimento PDF` (10) e `du Upload Beehus` (5) — preenchidos exatamente nas 55 carteiras `Periodicidade=M`; `Modelo de Carga` identifica o responsável (Yuri, Theo, E-mail PDF…).
- **Regra [CORRIGIDA pelo usuário 2026-07-17 — prazos somados, não marcos separados]:** a posição mensal é recebida referente ao **último dia útil do mês de referência** (`fim_mes`) e replicada para o mês inteiro. O prazo é único:

  ```
  data_limite_unprocessed = ultimo_dia_util(mes_referencia) + (du_Recebimento_PDF + du_Upload_Beehus) du
                          = fim_mes + 15du
  ```

  - Se `hoje ≥ data_limite_unprocessed` **e** não existe `unprocessedSecurityPositions` com `positionDate = fim_mes` ⇒ alerta **"Carga posição não realizada (Unprocessed)"** para a carteira mensal (`yellow` no dia do vencimento, `red` a partir de +1du).
  - Não há mais checagem intermediária aos 10du: os 10du de recebimento são etapa interna do responsável, invisível ao banco — o dashboard só enxerga o resultado (Unprocessed presente ou não) no marco somado de 15du.
  - Estágios seguintes usam o **mesmo marco**: `hoje ≥ data_limite` sem `processedPosition`/publicação para `fim_mes` ⇒ mesma família de alerta com o estágio faltante indicado ("Unprocessed ok, não processada", "processada, não publicada").
  - `mes_referencia` corrente = mês mais recente cujo `data_limite` já venceu ou vence na janela (avaliar os 2 últimos fechamentos para não perder atraso antigo).
- Para as 7 cargas manuais **diárias** (Yuri/Adeppar com H=D): aplicar a regra do alerta 3 normalmente (Defasagem), mas etiquetar o alerta com o nome do responsável para triagem.
- **Fonte:** query pontual mensal — `find({"walletId": {"$in": ids_mensais}, "positionDate": fim_mes}, proj)` nas duas coleções (≤55 ids).

### 3. Carga posição não realizada (Unprocessed, por carteira)

- **Regra (diárias):** para cada carteira diária e cada `d` esperado no range (regra de expectativa do grid), célula vermelha na camada Unprocessed ⇒ alerta por carteira, **exceto** quando a instituição inteira já disparou o alerta 1 para o mesmo `d` (suprimir duplicidade — o alerta agregado engloba).
- **Regra (mensais):** para carteiras `Periodicidade=M`, este mesmo alerta dispara pela regra do SLA somado do alerta 2: `hoje ≥ ultimo_dia_util(mes_ref) + 15du` sem Unprocessed de `fim_mes` (é o mesmo evento — o alerta 2 detalha responsável/estágio; não duplicar no feed: um único item etiquetado com o regime).
- **Corroboração:** cruzar com `issues` tipo `missing_unprocessed_position` da mesma carteira/data (mostrar como evidência no drill-down, não como fonte primária — a fonte primária é a ausência do doc).
- **Severidade:** `yellow` no 1º du de atraso além da defasagem, `red` a partir do 2º.

### 4. Issues

- **Regra:** contagem de `issues` com `status: "pending"` por carteira, restrita a `date` dentro do range do grid (nunca global — há 410k pending históricos). Badge numérico na linha da carteira + tabela drill-down (tipo, data, descrição, `solvedBy` vazio).
- **Query exata:**

```python
db.issues.aggregate([
    {"$match": {"status": "pending", "walletId": {"$in": ids},
                "date": {"$gte": d0, "$lte": d1}}},
    {"$group": {"_id": {"w": "$walletId", "t": "$type"}, "n": {"$sum": 1}}}
])
```

- **Severidade por tipo (proposta):** `red`: `missing_wallet`, `explosion_error`; `yellow`: `missing_unprocessed_position`, `security_unmapped`, `missing_fund_position_for_explosion`, `security_missing_price`; `info`: `security_missing_history_price`, `security_missing_classification`. Mapa editável em `alert_thresholds.json`.

### 5. Divergência Rent Contribuição × Rent NAV — Carteira

- **Fonte (validada e simplificada):** `navPackages` nível carteira já traz os dois retornos no mesmo doc. Em produção os campos coincidem até e-13 quando saudáveis e divergem de fato quando há problema (ex. real: `returnContribution=0` vs `returnNavPerShare=8.7e-07`).
- **Fórmula:** `diff = |returnContribution − returnNavPerShare|` por (carteira, data).
- **Threshold (configurável):** `yellow` se `diff > 2e-4` (2 bp/0,02% — **[REVISADO 2026-07-31]** era 1e-4/1bp), `red` se `diff > 5e-4` (5 bp) — **E, nos 2 casos, [NOVO 2026-07-31]** `nav × diff ≥ R$800` (senão nenhum badge, mesmo com `diff` acima do threshold percentual — carteiras de NAV pequeno geram % alto sem relevância financeira). Ignorar docs com qualquer um dos campos `None`.
- **Query:** já coberta pela batch query `nav` do grid — o alerta é calculado em memória, custo zero adicional.
- **Drill-down (auditoria):** recomputar contribuição a partir de `processedPosition.securities[].dailyContribution / nav` apenas quando o usuário abre a carteira-dia divergente (1 `find_one` com projeção de `securities`).

### 6. Divergência Rent Contribuição × Rent NAV — Agrupamento

- **Fonte (validada — hipótese de soma ponderada refutada como necessidade):** `navPackages` **nível grouping** (33.363 docs, `groupingId` preenchido) já traz `returnContribution` e `returnNavPerShare` agregados pelo backend.
- **Regra:** idêntica ao alerta 5, sobre os groupings referenciados em `Agrupamentos Indexados` do cadastro (1.016 ids validados) que estejam `trashed ≠ True`.
- **Query:**

```python
db.navPackages.find(
    {"groupingId": {"$in": grouping_ids}, "positionDate": {"$gte": d0, "$lte": d1},
     "trashed": {"$ne": True}},
    {"groupingId": 1, "positionDate": 1, "returnContribution": 1,
     "returnNavPerShare": 1, "published": 1})
```

- **Drill-down:** listar as carteiras do grouping ativas na data (`wallets[]` com `initialDateOnGrouping ≤ d` e `finalDateOnGrouping` nulo ou `≥ d`) com as divergências individuais do alerta 5 — aponta qual carteira contamina o consolidado.

### 7. Horários Execução

- **Input (resolvido — lacuna prevista não se materializou):** `createdAt`/`updatedAt` existem em todas as coleções da esteira. Horários reais observados em `processedPosition` de 2026-07-15 (UTC): pico 13h (=10:00 BRT, marco "Validação Cargas"), 19–20h e 22h (=19:00 BRT).
- **Exibição:** página Horários com timeline por carteira-dia: hora do Unprocessed (`createdAt`), da Processada (`createdAt`; mostrar `updatedAt` como "último reprocesso" quando `updatedAt − createdAt > 5min`), da Publicada (`navPackages.createdAt`). Converter UTC → `America/Sao_Paulo` sempre na camada de apresentação.
- **Alerta:** se a etapa X do dia corrente ainda não ocorreu até o `Horário Limite` da instituição (`data/horarios_cargas.json`, seed da aba Lista Cargas; fallback: marcos da aba Horários — Unprocessed até 10:00, Publicada até 15:00 BRT) ⇒ `yellow`; 1h além ⇒ `red`.
- **Caveat documentado:** `updatedAt` é sobrescrito a cada reprocesso — o banco **não guarda histórico de execuções** (ver Lacunas §3).

### 8. Revisão Última Posição Processada (gate cronológico D-1)

- **Regra:** para cada carteira diária, com o set `P = {positionDate processadas no range}` (já em memória pela batch query do grid, cap em hoje): para cada `d ∈ P`, se o dia útil anterior `d⁻¹ ∉ P` **e** `d⁻¹ ≥ startDateConsolidation` ⇒ **buraco na sequência** — a posição de `d` foi processada sem a base de `d⁻¹`. Marcar a célula `d` com anel vermelho (rodada 6; era roxo) e emitir alerta `red` ("processada fora de sequência — D-1 ausente"), pois contribuições/rentabilidades de `d` ficam suspeitas.
- Adicionalmente, como **gate preventivo** exibido na coluna-resumo: se `última processada < hoje_util − lag − 1`, a carteira ganha badge "não processar D0 — revisar D-1 primeiro".
- **Custo:** zero queries extras — puro pós-processamento do grid. Para ranges longos (auditoria), endpoint dedicado com a mesma agregação `$group {last: $max, dates: $push}` limitada a 60du.

---

## Calendário de Dias Úteis

Todo cálculo de du deste documento (Defasagem D-1…D-4, SLA mensal 15du, janela D-3, `biz_days_elapsed`) usa o **calendário real de feriados B3/ANBIMA**, não só seg–sex. Um feriado nacional com Defasagem D-3 dominante (642 carteiras) geraria falso-vermelho em massa — por isso esta decisão é pré-requisito da Fase 1, não da Fase 4.

### Decisão: biblioteca `bizdays` + snapshot local `data/holidays.json`

**Approach escolhido:** `pip install bizdays` (wilsonfreitas) como fonte primária do calendário, com export anual para `data/holidays.json` como artefato versionado e fallback offline.

```python
from bizdays import Calendar
cal = Calendar.load("ANBIMA")           # calendário ANBIMA embutido no pacote (2000–2078)
cal.bizdays("2026-06-30", "2026-07-17") # du entre datas
cal.offset("2026-06-30", 15)            # fim_mes + 15du  → data_limite do SLA mensal
cal.getdate("last bizday", 2026, 6)     # último dia útil do mês
```

**Por quê (comparativo pesquisado em 2026-07-17):**

| Opção | Calendário ANBIMA/B3 | Manutenção | Peso |
|---|---|---|---|
| **`bizdays` (escolhida)** | **embutido** (948 feriados ANBIMA, 2000–2078; aliases "ANBIMA"/"B3") | v1.0.19 em jan/2026 — ativa | **zero dependências**, puro Python; API é exatamente aritmética de du (`bizdays`, `offset`, `following`, `seq`, `getdate`) — padrão de facto do mercado de renda fixa BR |
| `holidays` (vacanza) | `financial_holidays("BVMF")` desde v0.61 (nov/2024), doc diz "same as ANBIMA" | excelente (release mensal) | leve, mas só responde "é feriado?" — a aritmética de du ficaria por nossa conta (`numpy.busday_*`) |
| `workalendar` (`BrazilBankCalendar`) | por regras COMPE (coincide com ANBIMA na prática) | **estagnada** — última release jan/2023 | média |
| `pandas_market_calendars` | calendário `BMF` herdado do Quantopian, um dos menos cuidados do pacote | pacote ativo, calendário não | pesado (exchange_calendars), orientado a horário de pregão, não a du bancário |
| Arquivo oficial ANBIMA | `https://www.anbima.com.br/feriados/arqs/feriados_nacionais.xls` — lista oficial de feriados bancários **válida até 2099** | publicação anual da ANBIMA | vira o fallback abaixo |

**Fallback/manutenção (rotina anual):**

1. Script utilitário `scripts/update_holidays.py` (rodar 1×/ano, ex.: em dezembro): gera `data/holidays.json` a partir de `Calendar.load("ANBIMA")` (ou, se um dia a lib parar de ser mantida, direto do XLS oficial da ANBIMA acima) — lista simples `["2026-01-01", "2026-02-16", ...]` restrita a ±2 anos da data corrente.
2. `db.py` carrega o calendário assim: **se `bizdays` importável → `Calendar.load("ANBIMA")`; senão → `Calendar(holidays_do_json, weekdays=("Saturday","Sunday"))`** (a própria classe aceita lista) — o app nunca depende de rede em runtime e roda mesmo sem o pacote instalado.
3. A página Config mostra a telemetria do calendário (fonte ativa, último feriado conhecido, data do snapshot) e acusa se o horizonte do JSON estiver a menos de 6 meses de expirar.

Helpers a expor em `db.py` (assinaturas; datas sempre strings `YYYY-MM-DD`): `is_bizday(d)`, `last_bizday_of_month(y, m)`, `add_bizdays(d, n)`, `bizdays_between(d0, d1)`, `bizdate_range(d0, d1)`, `today_ref()` (= hoje − `grid_reference_lag_du` du).

---

## Estratégia de Otimização de Acesso ao Banco

Banco de produção compartilhado — regras não-negociáveis:

1. **Uma única conexão** — sempre `from db import db`; nunca instanciar `MongoClient` fora de `db.py`/`setup.py`.
2. **Nunca N+1 por carteira.** Todo dado do grid vem de **3 batch queries** com `walletId: {"$in": [...792 ids]}` + range de `positionDate`. Alertas 1, 3, 5 e 8 são derivados em memória dessas mesmas queries; só os alertas 2 (55 ids), 4 (1 aggregate) e 6 (1 find) têm queries próprias.
3. **Projeção mínima obrigatória** — jamais retornar `securities[]` (arrays de centenas de itens) em queries de listagem; `publishedPositionSecurities` (1,15M docs, 1 por security) não participa do grid — o marcador de publicação é `processedPosition.published`/`navPackages`.
4. **Cache TTL** (padrão `Relatorios/cache.py`): nomes de `companies`/`entities`/`wallets`/`groupings` com TTL 120s; snapshot montado do grid + alertas com TTL 60s (o refresh do browser não repete as queries); `wallet_registry.json` lido do disco com cache por mtime.
5. **Índices** — `ensure_indexes()` best-effort da seção Arquitetura. Os índices `(walletId, positionDate)` cobrem as batch queries; `(positionDate, published)` cobre visões "o dia inteiro"; `(status, date)` + `(walletId, date, type, status)` cobrem issues.
6. **Cap de range** — UI limita o range a 21du; endpoints de auditoria a 60du. Sem full scans: toda query da esteira tem `positionDate` no filtro (string range é indexável).
7. **`count_documents` com filtro sempre; `estimated_document_count` só para telemetria de página de config.**

> **[REVISADO 2026-07-20 — botão "Atualizar" + cache por data, Tarefa 3 do refactor estrutural]**
> Implementado em `cache.py` + `db.py` do protótipo (ver árvore de arquivos revisada no início deste documento):
> - **`CachePorData`** (`cache.py`): cache em memória do PROCESSO Flask, chaveado por `positionDate` — guarda os docs de `unprocessedSecurityPositions`/`processedPosition`/`navPackages`(carteira e grouping)/`issues` já buscados para cada data. `db.py::buscar_dados_esteira_para_datas()` calcula quais datas de uma janela pedida AINDA faltam no cache, faz **1 query `$in` por coleção só para as datas faltantes** (nunca 1 query por data), e monta o resultado final combinando cache + recém-buscado. Usado tanto pela carga inicial (`build_snapshot.py`) quanto pelo botão "Atualizar" (`GET /api/atualizar`) — o MESMO cache é compartilhado pelos dois caminhos dentro do processo do servidor.
> - **`CacheTTL`** (`cache.py`, 120s): para dados que não dependem da janela — coleções pequenas (`companies`/`entities`/`wallets`/`groupings`) e o agregado de "últimas datas" por carteira (`db.py::buscar_ultimas_datas`, que por si só é a query mais cara do build — ~11s medidos em produção — e antes rodava em TODA geração de snapshot; agora só 1x a cada 120s).
> - **Trade-off assumido**: cache só em memória (não em `data/.cache_snapshot.json`) — reinicia zerado a cada restart do `python app.py`. Aceito porque é um app local de 1 usuário por vez, evita problemas de escrita concorrente em arquivo, e o servidor fica de pé o dia inteiro (restart é raro). Documentado também em `cache.py`.
> - **Medido em produção (2026-07-20)**: pedir uma janela de 3du (+1 dia extra do gate de sequência = 4 datas) custou ~10s na 1ª chamada; a MESMA janela pedida de novo (equivalente a clicar "Atualizar" repetidamente sem mudar nada) caiu para ~1.5s — **zero queries novas na esteira**, só overhead de reconstruir o registry e o cálculo em memória. Ampliar a janela pra trás (mesma data final, início mais antigo) consultou só as datas NOVAS — as já vistas vieram do cache.
> - **Rota nova**: `GET /api/atualizar?data_inicial=YYYY-MM-DD&data_final=YYYY-MM-DD` (`app.py`) chama `build_snapshot.montar_snapshot(data_inicial, data_final)` — a MESMA função usada pelo CLI, só que com o intervalo explícito em vez da janela default de 5du — e devolve o snapshot COMPLETO recalculado (decisão: mais simples de integrar no front do que devolver só a fatia nova; o payload de poucos dias é pequeno, ver volumetria acima). O front-end (`static/js/controle_cargas/atualizar.js`) troca `ControleCargas.SNAPSHOT` inteiro e re-renderiza sem recarregar a página.

> **[REVISADO 2026-07-27, pedido do usuário — "veja uma solução robusta e definitiva"]** `CachePorData` nunca expirava — uma vez que uma data era buscada no Mongo, ficava cacheada pro resto da vida do processo, mesmo que chegasse carga NOVA/retificada pra essa data depois (achado real: uma carteira recebeu Unprocessed às 20:54 pra uma data já vista pela sessão às 19:45, e a tela nunca mostrou, nem clicando "Atualizar"). Primeira tentativa de correção foi um TTL de 120s (mesmo padrão da `CacheTTL`) — **revertida a pedido do usuário**: "não quero atualização a cada 120s, desejo que quando eu clicar em atualizar, realmente atualize tudo". Solução final, determinística (não depende de tempo):
> - `CachePorData.invalidar_datas(datas)` (`cache.py`) — remove as datas informadas do cache, forçando-as a virar "faltantes" na próxima consulta.
> - `db.invalidar_cache_esteira(datas)` — wrapper fino sobre o método acima.
> - `montar_snapshot(..., forcar_atualizacao=False)` (`build_snapshot.py`) — quando `True`, invalida o cache de TODA a janela pedida ANTES de buscar, garantindo Mongo fresco.
> - `GET /api/atualizar` (`app.py`) — **sempre** chama `montar_snapshot(..., forcar_atualizacao=True)`. O boot do servidor e o CLI (`build_snapshot.py` standalone) continuam com `forcar_atualizacao=False` (cache já começa vazio, forçar seria redundante).
> - Também corrigido, no mesmo lote: `index.js::init()` agora dispara um "Atualizar" automático assim que a página carrega (mesma rota, mesma garantia de frescor) — o usuário não depende mais só do `snapshot.json` estático (congelado no boot) nem precisa lembrar de clicar "Atualizar" manualmente ao abrir a tela.
> - **Validado em produção**: 2 chamadas consecutivas a `/api/atualizar` para a MESMA janela, sem qualquer espera entre elas, mostraram `datasNovasConsultadas` = tamanho completo da janela (nunca reduzido pelo cache) nas duas vezes — confirma que cada clique força 100% de consulta fresca.

---

## Convenção de Comentários no Código

Regra do projeto (a aplicar em todo código futuro): **funções centrais explicam o "porquê" passo a passo** — não o "o quê" (o código já diz). Padrão:

- Docstring de 1–3 linhas: contrato (entradas, saída, invariantes — ex.: "datas são strings YYYY-MM-DD; nunca retorna datas > hoje").
- Blocos numerados `# 1) ... # 2) ...` dentro da função, um por decisão de negócio, citando a origem da regra (coluna da planilha, campo do Mongo, seção deste PLANNING.md).
- Todo workaround referencia o achado que o motivou (ex.: `# cap em hoje: repetição diária gera positionDate futura — ver PLANNING.md §Lacunas`).

Exemplo ilustrativo do estilo (não é código do produto):

```python
def expected(wallet, d, today):
    """True se a carteira deveria ter posição em d. Datas YYYY-MM-DD."""
    # 1) Carteira mensal: só cobramos o fechamento do mês (alerta 2 cuida do SLA);
    #    dias intermediários nunca viram "vermelho" — ver PLANNING.md, Grid.
    # 2) Defasagem (coluna I do cadastro) desloca a cobrança em dias úteis:
    #    D-3 significa que a posição de d só é exigível 3 du depois.
    # 3) Não cobrar antes do onboarding (wallets.startDateConsolidation).
```

---

## Plano de Fases de Implementação

| Fase | Entrega | Conteúdo | Dependências |
|---|---|---|---|
| **0. Esqueleto** | app navegável | `app.py`, `db.py` (proxy + ensure_indexes), `cache.py`, `/setup`, `base.html` com sidebar, `stubs.py` — cópia adaptada do Relatorios | — |
| **1. Cadastro + Grid read-only** | valor imediato | `registry.py` (import Excel→JSON com validação `$in` de WalletIDs e resolução Instituição→entityId), página Config com "Reimportar", grid carteira×dia com semáforo e colunas de última data | Fase 0 |
| **2. Alertas de presença** | alertas 1, 3, 8 + 4 | derivação em memória sobre o grid (instituição agregada, carteira individual, gate D-1) + aggregate de issues; feed em `/alertas` com filtros | Fase 1 |
| **3. Divergências** | alertas 5, 6 | comparação `returnContribution` × `returnNavPerShare` (carteira e grouping), thresholds em `alert_thresholds.json` editáveis na Config, drill-down por `processedPosition.securities` | Fase 1 |
| **4. SLA mensal + Horários** | alertas 2, 7 | regime mensal com prazo somado (`fim_mes + 15du`), página Horários com timeline `createdAt` e limites de `horarios_cargas.json` — o calendário de du (`bizdays` + `holidays.json`) já entra na **Fase 1** (a Defasagem diária depende dele) | Fases 1–2 |
| **4b. Painéis de detalhe + Comentários** | drill-down e anotação humana | painéis de Carteira e Agrupamento (seção [Painéis de Detalhe](#painéis-de-detalhe-drill-down)), API de comentários lendo/escrevendo `data/alert_comments.json` (sem Mongo), overlay de balão na matriz, 3 blocos da aba Agrupamentos | Fases 1–3 |
| **5. Polimento** | operação diária | export Excel do feed, notificação por e-mail (padrão smtplib do Relatorios) nos marcos 10:00/14:00, filtros salvos, contagem de reprocessos (`updatedAt≠createdAt`) | Fases 2–4 |

Critério de pronto de cada fase: página funcional com dados de produção, sem query fora dos padrões da seção de Otimização.

---

## Lacunas de Dados e Decisões em Aberto

1. **Dias úteis reais (feriados BR) — RESOLVIDO (2026-07-17).** Decisão tomada: biblioteca `bizdays` (calendário ANBIMA embutido) + snapshot anual `data/holidays.json` como fallback offline — ver seção [Calendário de Dias Úteis](#calendário-de-dias-úteis).
2. **Sem histórico de execuções.** `createdAt` = primeira carga, `updatedAt` = último reprocesso — não há log de cada rodada nem de falhas de pipeline (só o resultado final). O alerta de Horários mede o estado atual, não a linha do tempo completa. Aceitar como limitação ou pedir ao time de engenharia um collection de runs (fora do nosso controle).
3. **Semântica de `lastInputDate`** (presente em unprocessed/processed): aparenta ser a data-base do último input da fonte, mas não foi confirmada com engenharia — não usar em regra de alerta até confirmar.
4. **Posições com data futura — RESOLVIDO (2026-07-17).** (1.685 unprocessed, 19 processed; `inputType: "sheets"`, repetição diária mensal): decisão do usuário — a janela do grid termina na **data de referência D-3** (`GRID_REFERENCE_LAG_DU = 3` em `utils/datas.py`, foi D-5 por 1 dia, 2026-07-23 a 2026-07-24), o que elimina a poluição das replicações antecipadas. Pendente apenas: se a página de auditoria exibe datas > ref (proposta: sim, com badge "projetada").
5. **`Horário Limite` da aba Lista Cargas está quase todo vazio** — o alerta 7 nasce com os marcos genéricos da aba Horários (10:00/15:00 BRT) até o usuário preencher `horarios_cargas.json` por instituição.
6. **Issues pendentes históricas (410k).** Alertamos só dentro do range do grid; falta política de higiene para o passivo antigo (fora do escopo deste dashboard, mas o número deve aparecer na Config como telemetria).
7. **Colunas reservadas do cadastro** (`Carga Retroativa`, `Precificação MtM ou Curva`, `C3 Todos Ativos`) estão 100% vazias — importadas mas sem lógica; revisar quando o time começar a preenchê-las.
8. **Vínculo Instituição→entity por nome** bate 100% hoje (20/20), mas é frágil a renomeações — por isso o import congela o `entityId` no registry e a Config acusa divergência em reimportações.
9. **Duas carteiras com `Deve Publicar = Não`** e 16 com `Agrupamentos Indexados = "Não"` — tratadas como cinza no estágio correspondente; confirmar com o usuário se devem sequer aparecer no grid.

---

## Simbologia da Matriz de Status

> Estudo feito em 2026-07-17 seguindo a metodologia da skill `dataviz` (paleta de status reservada + regra "cor nunca sozinha") e inspecionando os grids maduros já existentes (`Relatorios/db.py::cell_cls` e `Controle de cargas/pages/controlpanel.py::_cell_cls/_extra_cell` + tooltip flutuante `#reg-tooltip` do `controlpanel.html`). Nada de lógica foi copiado — só as convenções visuais que a equipe já lê sem treinamento (pastel-100 de fundo + texto -700, badges de contagem, tooltip escuro flutuante).

### Princípio central: fundo = estágio, badges = alertas **[REVISADO na rodada 7, 2026-07-18]**

Uma célula (carteira × dia útil) precisa comunicar **estágio da esteira** e **situação vs. SLA** ao mesmo tempo. As rodadas 1–6 tentaram carregar os dois no fundo (matiz = severidade, tom = estágio) — e o usuário rejeitou duas rodadas de cor seguidas porque `Unp` e `Pro` "sempre pareciam parecidos demais, não importa o ajuste de tom". Diagnóstico da rodada 7: o problema não era o tom, era o fundo tentando carregar **duas variáveis ao mesmo tempo**. A solução definitiva, confirmada explicitamente pelo usuário, **separa os canais**:

- **Cor de fundo = SÓ estágio** (onde a carteira está?) — amarelo-pálido = `Unp` (tem Unprocessed, falta processar), verde-menta claro = `Pro` (tem Processada, falta publicar), verde = `Pub` (concluída). O fundo **nunca mais muda por atraso**: uma célula `Unp` é amarela esteja no prazo ou atrasada.
- **Badge "Atraso" = SÓ atraso** (novo overlay, espelho do badge "Rent" no canto inferior esquerdo) — amarelo = 1–2du de atraso, vermelho = ≥3du. Só existe em células `Unp`/`Pro`; nos estados `∅`/`Agd`/`—` e `Pub` seria redundante.
- **Sigla central = estágio** (reforço textual) — `Unp` / `Pro` / `Pub` / `∅` / `Agd` / `—`.
- **Overlays independentes** (não competem com a cor de fundo): badge "Atraso" (novo), badge "Rent" amarelo/vermelho por gravidade (divergência), anel vermelho com offset (fora de sequência), triângulo cinza (issues), balão de comentário. **[Rodada 6: overlays saíram da família violeta; rodada 7: badge Atraso entra e o triângulo de issues migra para o canto superior esquerdo.]**

Organização visual da família amarelo/vermelho (agora usada por fundo `Unp`, badge Atraso E badge Rent, possivelmente na mesma célula): a separação é por **saturação e área**, não só por matiz — o fundo `Unp` é um amarelo BEM mais pálido/dessaturado (amber-200 `#fde68a`, área grande e calma) e os badges são vivos/saturados (yellow-500/red-600, formas pequenas com aro de superfície nos cantos). O olho separa "fundo = estágio" de "badge no canto = alerta" pela diferença de saturação e tamanho, validado por ΔE (ver tabela abaixo).

A sigla é a **codificação secundária obrigatória** (metodologia dataviz: status nunca é cor sozinha) — a matriz continua legível para daltônicos e em impressão P&B, porque verde-`Pub`, vermelho-`∅` e cinza-`Agd` diferem também pelo texto/símbolo. Isso é crítico sobretudo nos dois cinzas (estados 5 e 6, `#f3f4f6` vs `#f9fafb`, quase indistinguíveis a olho nu): a distinção vem inteiramente do texto.

### Siglas de estágio — Unp → Pro → Pub **[2ª CORREÇÃO de vocabulário pelo usuário 2026-07-17 — supersede a rodada anterior]**

Histórico das rodadas:

1. **Rodada 1** (mockup): `B` = Publicada / `P` = Processada — rejeitado ("veja letras mais condizentes com nosso vocabulário").
2. **Rodada 2**: 1 letra por estágio (`U`/`C`/`P`) + glifos `✕`/`–`/`·`; nessa rodada os **bigramas** `Un`/`Pr`/`Pu` foram avaliados e rejeitados (Pr vs Pu diferiam só no 2º caractere).
3. **Rodada 3 (VIGENTE para os trigramas)**: o usuário pediu explicitamente **mais informação na célula** e definiu os trigramas dos estágios alcançados — isto **supersede a rejeição anterior de bigramas**: o problema do bigrama (Pr/Pu ambíguos) não existe no trigrama (`Pro` vs `Pub` diferem em 2 dos 3 caracteres e têm silhuetas distintas). Junto, abandonam-se os glifos crípticos `✕`/`–`/`·` por texto legível (pedido literal: *"N/A - Sem Unprocessed (Pode ver umas letras melhores e uma legenda melhor para esse caso)"*).
4. **Rodada 4 (VIGENTE para o caso "Faltando, vencida", 2026-07-17)**: o usuário pediu para trocar `N/A` pelo **"símbolo universal do vazio"** — adotado **`∅` (U+2205, conjunto vazio)**. Os trigramas `Unp`/`Pro`/`Pub` e as siglas `Agd`/`—` da rodada 3 permanecem intocados; muda apenas a sigla do estado vermelho. Avaliação e alternativas rejeitadas na subseção abaixo.

Convenção final — trigramas definidos pelo usuário para os estágios alcançados:

| Sigla | Estágio | Justificativa |
|---|---|---|
| **Unp** | Unprocessed | prefixo de **Unp**rocessed — termo que o time já usa em inglês (nome da collection) |
| **Pro** | Processada | prefixo de **Pro**cessada — sem colisão: difere de `Pub` no 2º e 3º caracteres |
| **Pub** | Publicada | prefixo de **Pub**licada — o estágio final, o que o gestor pergunta ("já publicou?") |

E para os 3 casos de "nada carregado ainda" (decisão de design desta rodada — o usuário deixou em aberto, propondo `N/A` como ponto de partida):

| Sigla | Caso | Por quê |
|---|---|---|
| **∅** (U+2205) | Faltando, vencida (vermelho) | **[Rodada 4 — supersede o `N/A` desta linha]** símbolo universal do conjunto vazio: lê-se "não veio NADA" — a falta real, urgente. Reservado EXCLUSIVAMENTE para este caso. Avaliação completa abaixo. |
| **Agd** | Aguardando, no prazo (cinza) | **Agd** = **Ag**uar**d**ando, palavra do vocabulário de operações; textualmente nada parecida com o símbolo do estado vermelho (`∅`, ex-`N/A`), então a diferença sobrevive a P&B/daltonismo mesmo com os fundos cinzas quase iguais. Comunica "situação normal, ainda dentro do prazo" — o oposto acionável do `∅`. |
| **—** (em-dash) | Não cobrado (cinza-claro) | convenção universal de tabela financeira para "célula não se aplica" — não é glifo críptico como o `·` antigo, é o traço que qualquer analista lê como "ignore". É de propósito o mais silencioso dos três: este dia nunca será carregado, não há o que ler. |

**Avaliação do `∅` (rodada 4) — por que é de fato a melhor escolha, e o que foi rejeitado:**

- **`∅` U+2205 (ADOTADO)** — 1 caractere (~9px a 11px semibold, vs ~22px do `N/A`): muito mais folga na célula de 44px e leitura instantânea; reconhecido internacionalmente como "conjunto vazio / nada"; e é **texto de verdade**, então sobrevive intacto a TODOS os canais onde a sigla circula — tooltip, legenda, export Excel (SpreadsheetML client-side e openpyxl), clipboard, impressão P&B — continuando a cumprir a regra "cor nunca sozinha". Renderiza nativamente no Segoe UI (Windows, fonte default do app) e **não tem variante emoji** (nunca vira desenho colorido fora do nosso controle). Por ser 1 glifo, pode subir para `font-size: 13px` (vs 11px dos trigramas) sem alargar a célula — ganha presença visual sem custo de layout.
- **Ícone desenhado em CSS (rejeitado)** — um círculo cortado em CSS seria visualmente equivalente ao `∅`, mas deixaria a célula **sem conteúdo textual**: o export Excel, o clipboard e qualquer render fora do browser perderiam a informação e exigiriam um texto substituto — dois artefatos para manter em sincronia. Complexidade sem nenhum ganho sobre o caractere.
- **`Ø` U+00D8 e `⌀` U+2300 (rejeitados)** — `Ø` é letra do alfabeto norueguês/dinamarquês (semântica errada, maior risco de leitura como "O cortado"); `⌀` é o símbolo de diâmetro (engenharia mecânica — semântica errada) e tem cobertura de fonte pior que U+2205.
- **Célula vazia (rejeitada)** — violaria frontalmente a regra "status nunca é cor sozinha" (P&B/daltonismo) e colidiria com a semântica do `—`.
- **Risco residual assumido**: quem nunca viu `∅` pode ler "zero cortado" — mitigado por (a) fundo vermelho exclusivo deste estado, (b) legenda sempre visível ("∅ = Sem Unprocessed — prazo VENCIDO, agir"), (c) nenhum outro estado usa glifo circular.

**Por que NÃO usar o mesmo símbolo nos 3 casos de "nada ainda"** (argumento das rodadas anteriores — continua valendo com `∅` no lugar de `N/A`): os dois cinzas diferem só 2% em luminância — se o símbolo também fosse igual, "vencida-urgente" e "aguardando-normal" ficariam distinguíveis apenas por vermelho vs cinza (quebra da regra "cor nunca sozinha") e os casos 5 e 6 ficariam literalmente idênticos entre si. Além disso `∅` (aja agora) e `Agd` (não faça nada) são **ações opostas** — mesmo símbolo para ambos seria uma armadilha de leitura. `∅`, `Agd` e `—` não compartilham nenhum caractere.

A sigla nunca aparece sozinha: legenda e tooltip sempre grafam o nome completo do estado ao lado (ex.: legenda `[Pro verde-menta] Processada — aguardando publicação`).

### Estados de fundo (paleta final — Tailwind + hex)

`atraso_du` = dias úteis desde o vencimento do prazo da célula (diárias: `d + lagBizDays` vs. hoje; mensais: `data_limite = fim_mes + 15du` vs. hoje). Prazos sempre contra o **hoje real**, nunca contra a referência D-3 do grid. **[Rodada 7]** O `atraso_du` continua calculado e gravado célula a célula (campo `adu` do snapshot) — ele alimenta o badge "Atraso", o tooltip/SLA, o Excel (aba Detalhe) e o `priorityScore`; só deixou de pintar o fundo.

**[Rodada 7, 2026-07-18 — fundo = SÓ estágio; supersede a rodada 5]** O usuário rejeitou duas rodadas de ajuste de tom porque `Unp` e `Pro` continuavam "parecidos demais": a causa-raiz era o fundo carregando estágio E severidade de atraso ao mesmo tempo. Decisão final: **eliminar a distinção de fundo entre "no prazo" e "atrasado" nos estados em progresso** — os 6 estados em-progresso (2/2b/3/3b/3c/3d da tabela antiga) colapsam em 2 (um por estágio), e o atraso migra para o badge "Atraso" (tabela de Overlays). SEMPRE que existir Unprocessed sem Processada, a célula é amarela; SEMPRE que existir Processada sem Publicada, a célula é verde-menta clara — no prazo ou atrasada. Paleta validada com `scripts/validate_palette.py` da skill dataviz (detalhe nas notas abaixo).

| # | Estado | Regra exata | Fundo | Texto | Sigla |
|---|---|---|---|---|---|
| 1 | **Concluída** | `publicada` (ou `processada` com Deve Publicar = Não) | `bg-green-100` `#dcfce7` | `text-green-700` `#15803d` | **Pub** (ou **Pro** se não publica) |
| 2 | **Em andamento — Unprocessed** | tem só Unprocessed (qualquer atraso) | amarelo-pálido `#fde68a` (amber-200) | `#78350f` (amber-900) | **Unp** |
| 3 | **Em andamento — Processada** | tem Processada sem publicação (qualquer atraso) | verde-menta claro `#8ae6d2` (custom, entre teal-100 e teal-200) | `#134e4a` (teal-900) | **Pro** |
| 4 | **Faltando, vencida** | nada carregado, esperado, `atraso_du ≥ 1` | `bg-red-100` `#fee2e2` | `text-red-700` `#b91c1c` | **∅** |
| 4b | idem, ≥ 3du de atraso | mesmo, `atraso_du ≥ 3` | `bg-red-200` `#fecaca` | `text-red-900` `#7f1d1d` | **∅** |
| 5 | **Aguardando, no prazo** | nada carregado, esperado, `atraso_du ≤ 0` (defasagem/SLA ainda não venceu) | `bg-gray-100` `#f3f4f6` | `text-gray-400` `#9ca3af` | **Agd** |
| 6 | **Não cobrado** | dia intermediário de carteira mensal sem replicação; pré-onboarding; Deve Publicar=Não no estágio publicação | `bg-gray-50` `#f9fafb` | `text-gray-300` `#d1d5db` | **—** |

Dark mode (mesma semântica, tons re-derivados e validados contra a superfície `#14171b`): Unp `#6b4f0d`/`#fbd77e` (5.5:1), Pro `#175045`/`#99f6e4` (7.3:1), Pub `#0f2e1c`/`#5fd894` (8.2:1); estados 4–6 inalterados.

Notas de desenho:

- Verde/vermelho/amarelo são a família de status já usada nos apps irmãos (pastel + texto escuro) — reconhecimento imediato pela equipe. A progressão de estágio lê naturalmente: **amarelo ("em preparação") → verde-menta pálido ("quase lá") → verde ("concluído")** — o Pro é deliberadamente um verde-água mais claro/deslocado de matiz que o verde do Pub, para "quase lá" nunca se confundir com "concluído". O sky (azul) da rodada 5 saiu da paleta: não há mais estado "no prazo" separado.
- **O amarelo do fundo `Unp` vs o amarelo dos badges (Atraso leve / Rent leve)**: separados por saturação e área, não por matiz — fundo amber-200 pálido em área grande; badges yellow-500 `#eab308` vivos, pequenos, com aro de 1px de superfície. ΔE fundo Unp × badge amarelo = 13.4 (CVD) / 13.9 (normal). Caveat conhecido: o contraste WCAG de *borda* entre o badge amarelo e o fundo Unp é baixo (1.5:1) — quem garante a leitura do badge nesse pior caso são o aro de superfície e o texto interno escuro ("Atraso"/"Rent", 7.8:1 dentro do badge).
- **Validação (skill dataviz, `validate_palette.py`, rodada 7)**: o trio de estágio é forte nos 2 temas — light: Unp×Pro ΔE 10.5 (CVD) / 15.2 (normal), Pro×Pub 8.1/11.5, Unp×Pub 10.5/10.8; dark: Unp×Pro 8.0/12.2, Pro×Pub 11.9, Unp×Pub 15.5. Pares fracos remanescentes, todos mitigados pela sigla (relief obrigatório da metodologia, ≥ 4.5:1 em todos os fundos nos 2 temas): Pro×∅ sob protan (~3 — verde×vermelho pastel, limite físico do par pastel; siglas `Pro` vs `∅` totalmente distintas), os dois cinzas entre si (por desenho, desde sempre), e o "light-end vs surface" (1.0:1) inerente ao pastel-fill herdado dos apps irmãos.
- O valor exato do atraso vai no tooltip (linha SLA) e no painel de detalhe; o badge "Atraso" dá a banda (1–2du / ≥3du).
- Estados 5 e 6 são ambos cinza mas com siglas totalmente distintas (`Agd` vs `—`): 5 significa "vai ser cobrado, aguarde", 6 significa "nunca será cobrado neste dia". Como os dois fundos são quase indistinguíveis, o texto é quem carrega a distinção — por isso as duas siglas não compartilham nenhum caractere.
- `∅` é EXCLUSIVO do estado 4/4b (vermelho): na legenda e no treinamento, `∅` = "sem Unprocessed com prazo vencido — agir agora". Nunca reutilizar `∅` para os estados 5/6. Renderizar o `∅` a `font-size: 13px` (1 glifo permite subir 2px sem alterar os 26px de altura da célula). O vermelho 4/4b mantém as 2 bandas de intensidade (100→200 em ≥3du): são estados de "nada carregado", fora do escopo da separação estágio/atraso da rodada 7.
- Célula com doc carregado **antes** do vencimento (carga antecipada) usa as mesmas regras: Unp/Pro antecipado = mesmos fundos de estágio (sem badge Atraso), Pub antecipado = verde.

### Geometria da célula **[atualizada na rodada 3 — trigramas exigem célula mais larga]**

- Dimensões: `min-w-[44px] h-[26px]`, `rounded` (4px), conteúdo centralizado, `text-[11px] font-semibold`, `tracking-[0.02em]` (letter-spacing ~0.12px — abre levemente os trigramas sem esticá-los), `whitespace-nowrap`.
- Racional da largura: 3 caracteres a 11px semibold ≈ 20–23px de texto (os trigramas `Unp`/`Pub` são os mais largos; o `∅` da rodada 4 é 1 glifo ~9px — folga extra justamente no estado vermelho); 44px dá ~10px de respiro de cada lado sem cortar nem apertar. Com gap de 2px, cada coluna ocupa 46px ⇒ **15 colunas = 690px** de células + ~220px da coluna de nomes ≈ 910px — cabe sem scroll horizontal em qualquer tela de operador ≥ 1280px (em 1920px sobram >900px). Não reduzir a fonte para 10px: 11px é o mínimo confortável para varredura de centenas de células.
- Altura mantida em 26px: os trigramas continuam em 1 linha; crescer verticalmente custaria linhas visíveis de carteiras, que é o recurso escasso.
- **Gap de 2px entre células** (`border-spacing: 2px` ou grid `gap-0.5`) — as cores nunca se encostam (regra de spacer da metodologia dataviz); o fundo da página é o separador, sem bordas desenhadas.
- Hover/focus: a célula "levanta" com `outline: 2px solid #6b7280` (gray-500) + tooltip; células são focáveis por teclado (`tabindex`), mesmo tooltip no focus, clique abre o drill-down.
- Cabeçalho de coluna: `dd/mm` + inicial do dia da semana (`15/07 q`); a coluna da **data de referência (D-3)** ganha marcador `▾ ref` e fundo `bg-gray-100` no header.

### Overlays (5 marcadores — 4 cantos + 1 borda, nunca no centro)

**[Rodada 7 — arranjo final dos cantos]** Com o badge "Atraso" a célula passou a ter 4 marcadores de canto + 1 de borda. Distribuição definitiva, sem sobreposição: **Rent = superior direito · Issues (triângulo) = superior esquerdo · Atraso = inferior esquerdo · Comentário (balão) = inferior direito · Sequência = anel na borda inteira**. O triângulo de issues migrou do inferior esquerdo para o superior esquerdo para ceder o canto ao badge Atraso (a pílula de ~26px não coexistiria com o triângulo no mesmo canto); os dois badges de texto ficam em cantos diagonalmente opostos, então nunca disputam a mesma metade da célula (Atraso ~26px + balão 8px = 34px < 44px de largura; Rent ~19px + triângulo 7px = 26px < 44px).

| Marcador | O quê | Visual exato | Posição |
|---|---|---|---|
| **Atraso** (SLA vencido em célula em progresso) **[NOVO rodada 7]** | célula `Unp`/`Pro` com `atraso_du ≥ 1` — NUNCA em `Pub` (nada a atrasar) nem em `∅`/`Agd`/`—` (o fundo/estado já comunica a situação) | espelho exato do badge "Rent": pílula 9px × ~26px com o texto **"Atraso"** (texto real — sobrevive a export/impressão/P&B), fonte 6.5px bold, `border-radius 5px` + aro de 1px de superfície. Leve (1–2du): fundo **amarelo `#eab308`**, texto `#451a03` (7.8:1); elevado (≥3du): fundo **vermelho `#dc2626`**, texto branco (4.8:1) — mesmos valores já validados do badge Rent (mesma semântica leve/elevado). Dark: `#facc15`/`#451a03` e `#f87171`/`#450a0a`. Implementado como `<span>` real (não pseudo-elemento: `::before`/`::after` já estão ocupados por issues/Rent e os badges precisam coexistir) | canto **inferior esquerdo** (`bottom-[1px] left-[1px]`) |
| **Divergência da carteira** (alerta 5) | `\|returnContribution − returnNavPerShare\| > 2e-4` (2bp/0,02% — **[REVISADO 2026-07-31, pedido do usuário: "0,02%... é nosso novo parâmetro"]** era 1e-4/1bp) **E** `nav × diferença ≥ R$800` (**[NOVO 2026-07-31, pedido do usuário: "não exibir diferenças... menores que 800 reais"]** os 2 gates têm que passar — ver `LIMIAR_DIVERGENCIA`/`LIMIAR_DIVERGENCIA_REAIS`, `div_overlay_kind()`, snapshot_builder.py — único lugar com esses thresholds) no navPackage da carteira-dia | **[REVISADO 2026-07-18, rodada 6 — cor por gravidade; era violeta `#7c3aed`/`#4c1d95`]** badge oval com o texto **"Rent"** (auto-explicativo sem tooltip): 9px de altura × ~19px, fonte 6.5px bold, `border-radius 5px` + aro de 1px de superfície. Leve (>2bp e ≥R$800): fundo **amarelo `#eab308`** (yellow-500), texto `#451a03` (7.8:1); elevado (>5e-4, nível red, e ≥R$800): fundo **vermelho `#dc2626`** (red-600), texto branco (4.8:1). Dark mode: `#facc15`/`#451a03` e `#f87171`/`#450a0a`. Par leve×elevado validado (validate_palette.py): CVD ΔE 21.7 deutan / 29.0 normal (dark: 17.8/24.5). Reaproveita a família amarelo/vermelho sem confusão: o badge é pílula discreta com aro + texto, e nenhum fundo de célula usa os tons exatos ([rodada 7] fundo Unp amber-200 × badge amarelo: ΔE 13.4 CVD). Cabe no canto sem deslocar os demais overlays; pode sobrepor ~2px do topo do trigrama central — aceitável, o badge tem fundo sólido | canto **superior direito** (`top-[1px] right-[1px]`) |
| **Divergência via agrupamento** (alerta 6) | a carteira está ativa num grouping divergente naquela data | **anel vazado** 7px, `border: 1.5px solid #b45309` (amber-700 — tom de contorno da família do badge leve; amarelo puro não segura como traço fino sobre fundo claro), centro transparente; se a carteira também diverge sozinha, o badge sólido vence (tooltip lista os dois) **[REVISADO 2026-07-18 — era `#7c3aed`]** | canto superior direito |
| **Fora de sequência** (alerta 8) | processada sem D-1 processada | **[REVISADO 2026-07-18, rodada 6 — era `ring-purple-400` `#c084fc`]** anel vermelho `ring-2 ring-inset` **`#991b1b`** (red-800; dark mode `#f87171`) com **offset de 1px de superfície** entre o preenchimento da célula e o anel (2 camadas de `box-shadow inset`) — o offset garante que o contorno não "suma" no pior caso, célula já vermelha por severidade (∅): `#991b1b` sobre `#fecaca` = 5.7:1 + gap branco 8.3:1 (dark: `#f87171` sobre `#4a1818` = 5.3:1 + gap 6:1) | borda da célula |
| **Issues pendentes** (alerta 4) | ≥1 issue `pending` da carteira naquela data | triângulo de canto 7×7px `#475569` (slate-600), estilo "comentário do Excel" (CSS: `border-left: 7px solid #475569; border-bottom: 7px solid transparent`) | canto **superior esquerdo** **[rodada 7 — era inferior esquerdo]** |
| **Comentário sobre atuação** (anotacoes.js) **[NOVO 2026-07-30, pedido do usuário; REVISADO no mesmo dia após feedback visual — 1ª versão desenhava um anel azul ENVOLVENDO o balão de severidade, ficando maior que ele, "invertido"]** | há texto no campo "Comentário sobre atuação" **na data de referência do grid** (a anotação nunca vale para outro dia da janela — §Anotações por linha) | Marcador **próprio** (`.atuacao-dot`), irmão do `.cmt-dot` — não é modificador/anel dele. **Compartilha o MESMO canto do Comentário de alerta** em vez de abrir um 6º (os 4 cantos + a borda já estavam todos ocupados), mas sempre no mesmo tamanho pequeno (6px, dentro de um balão de 11px) e na mesma posição — sozinho (ponto azul `#2563eb` isolado) ou por cima do balão de severidade (`z-index` maior), nunca inflando/envolvendo o balão verde/amarelo/vermelho. Hover mostra o texto na linha "Atuação" do tooltip (mesmo tooltip do Comentário de alerta); clique abre o painel de detalhe, que também mostra Responsável/Comentário sobre atuação (só leitura) no cabeçalho — a edição continua exclusivamente pelo input da matriz | canto **inferior direito** (mesmo canto do balão de Comentário, por cima dele) |

**[Rodada 6, 2026-07-18]** A família violeta ("números suspeitos") foi aposentada nos overlays de divergência e sequência — o usuário pediu as cores de alarme universais: **amarelo = leve, vermelho = grave**. O risco de competir com o fundo (mesma família) é neutralizado pela **forma e saturação**: badge = pílula pequena, viva e saturada com aro de 1px de superfície + texto; anel = contorno com offset de 1px de superfície (nunca encosta no preenchimento); fundo = área grande e pálida. Ambos seguem legíveis mesmo sobre célula vermelha/amarela — validado com `validate_palette.py` da skill dataviz e contraste WCAG por par (valores na tabela acima). O triângulo cinza não usa cor de severidade para não competir com o fundo; a gravidade das issues vai no tooltip e no badge da linha.

**[Rodada 7 — badge Atraso × priorityScore]** O overlay `atraso`/`atraso_strong` pesa **zero** no fator O do `priorityScore` (OVERLAY_WEIGHTS): o atraso já entra no score pelos fatores S (severidade `wip_late`/`wip_very_late`) e A (`atraso_du`) — pesá-lo de novo contaria a mesma informação duas vezes. O badge é pura exibição; ordenação, tier e score não mudaram com a rodada 7.

**Badge de linha** (fora da célula, ao lado do nome da carteira, como no app irmão): e o badge "não processar D0 — revisar D-1" do gate preventivo (alerta 8) em `bg-purple-100 text-purple-700`. **[REMOVIDO 2026-07-22, pedido do usuário]** o pill `bg-red-100 text-red-700` que contava `redAmber` (nº de dias vermelho/âmbar na janela, ex. `3`) ao lado do nome foi tirado da matriz (`.issue-badge` em `matriz.js`/`controle_cargas.css`) — o dado `redAmber` continua no snapshot (usado por tier/score), só deixou de aparecer como número na linha.

### Tooltip (hover/focus) — campo a campo

**[REVISADO 2026-07-18 — hover enxuto, pedido literal do usuário: "não interessa aquelas informações de horário de quando rodou ao passar o mouse (...) deixar só o Status atual, deixar essas informações de horário quando clicar" e "quando passar o mouse, pode aparecer também o Status, mesmo tendo legenda".]** A checklist de 3 linhas com horário por estágio (`Unprocessed ✓ 09:42` / `Processada ✓ 10:15` / `Publicada ✓ 15:03`) **saiu do hover** — esses horários agora aparecem **só no clique**, no Painel de Detalhe da carteira, seção "Situação do dia selecionado" (§Painéis de Detalhe, item 3), que já os exibe estágio a estágio com hora BRT e reprocessamento. No lugar, o hover ganha uma linha **Status** com o nome legível do estado atual (o `name` do dict `STATES`, ex.: "Em andamento — Processada, no prazo") — confirmação célula-a-célula que a legenda genérica não dá. Fica no hover só o essencial de triagem: Status, SLA, divergência, issues, sequência.

Um único div flutuante compartilhado (padrão `#reg-tooltip` do app irmão): `position: fixed; z-50`, `bg-gray-900` `#111827`, `text-white text-[11px]`, `rounded-lg shadow-lg px-3 py-2`, `max-w-[320px]`, `pointer-events-none`, posicionado acima da célula (flip para baixo perto do topo). Valores em destaque (branco, `font-semibold`, `tabular-nums`), rótulos em `text-gray-400` `#9ca3af`. Linhas condicionais só aparecem quando aplicáveis:

```
007CVG - 005285190             qua 15/07/2026        ← nome COMPLETO da carteira + data/dia da semana
XP · API                                             ← Instituição · Modelo de Carga ("· Yuri (manual)" se manual)
Status        Em andamento — Processada, no prazo    ← STATES[s].name — sempre presente
──────────────────────────────
SLA           atrasada +2du (limite era 13/07)       ← ou "no prazo (limite 20/07)"; mensal: "fim jun + 15du → 21/07"
Δ Rent        Contrib 0,0412% × NAV 0,0357% → 5,5 bp ← só se divergente; grouping: + linha 'Agrup. "Nome": Δ 7,1 bp'
Issues        3 pendentes: 2× security_unmapped · 1× security_missing_price
⚠ Sequência   processada sem D-1 (14/07 ausente)     ← só se gate violado
clique — horários por estágio + detalhes             ← rodapé fixo: aponta para onde os horários foram
```

O tooltip de **Agrupamento** segue o mesmo princípio: ganha a linha `Status` com o nome do estado do roll-up; as **contagens por estágio** (`Publicadas 4/7` etc.) permanecem — são triagem (quantas carteiras seguram o agrupamento), não horário granular.

Regras: nomes de carteira/instituição/issue entram no DOM via `textContent` (nunca `innerHTML` — são dados). O tooltip **complementa, nunca é a única via**: clique na célula abre o drill-down modal com os mesmos dados em tabela (acessível sem hover) — e é lá, e só lá, que vivem os horários por estágio (sempre em BRT, `America/Sao_Paulo`).

### Legenda

Faixa única entre os filtros e o grid (`text-xs text-gray-600`), com **amostras reais de célula** (mesmas classes CSS, geradas do mesmo dict `STATE_STYLES` do backend — legenda e grid nunca divergem):

```
Fundo (= estágio):  [Pub verde] Publicada   [Unp amarelo-pálido] Unprocessed — falta processar
                    [Pro verde-menta] Processada — aguardando publicação
                    [∅ vermelho] Sem Unprocessed — prazo VENCIDO, agir   [Agd cinza] Aguardando — no prazo, normal
                    [— cinza-claro] Não cobrado neste dia
Marcadores (cantos): [Atraso] SLA vencido em célula Unp/Pro (badge amarelo = 1-2du; vermelho = ≥3du) — inf. esq.
                     [Rent] Divergência Rent Contrib×NAV (badge amarelo = leve >2bp/0,02%; vermelho = elevada >5bp; e impacto ≥ R$800 nos 2 casos) — sup. dir.   [○] Divergência via agrupamento
                     [borda vermelha] Fora de sequência (D-1 ausente)   [◤] Issues pendentes — sup. esq.   [balão] Comentário do analista vigente — inf. dir.
                     [ponto azul pequeno, mesmo canto, por cima] Comentário sobre atuação na data de referência — mesmo tamanho sozinho ou junto com o Comentário do analista
```

- Cada chip é `célula-amostra + rótulo`; a faixa é `sticky` junto com o cabeçalho de datas ao rolar.
- **Os rótulos de `∅` e `Agd` carregam a ação, não só o nome**: "prazo VENCIDO, agir" vs "no prazo, normal". São situações opostas em urgência apesar de ambas significarem "nada carregado" — a legenda precisa deixar isso cristalino, senão o analista trata `Agd` como pendência (falso alarme) ou, pior, `∅` como espera normal.
- Um link "?" ao final abre modal com a explicação estendida (regras de SLA, escala 100→200 de atraso ≥3du, semântica de cada sigla) — a faixa mostra só o essencial.

### Mapa de implementação (único source of truth)

```python
# db.py (ou grid helpers) — dict único consumido pelo grid, pela legenda e pelos testes.
# [rodada 7] FUNDO = SÓ ESTÁGIO: a chave dos estados "em andamento" volta a ser
# só o estágio — wip_ok/wip_late/wip_very_late dividem o MESMO fundo por estágio
# (o atraso vira o overlay "atraso"/"atraso_strong", badge no canto inf. esq.).
# Os 3 estados internos de severidade continuam existindo para tier/priorityScore.
STATE_STYLES = {
  "done":            {"bg": "bg-green-100", "tx": "text-green-700"},   # Pub (ou Pro se não publica)
  ("wip_*", "Unp"):  {"bg": "#fde68a",      "tx": "#78350f"},          # amber-200/900 — qualquer atraso
  ("wip_*", "Pro"):  {"bg": "#8ae6d2",      "tx": "#134e4a"},          # verde-menta claro/teal-900 — qualquer atraso
  "miss_late":       {"bg": "bg-red-100",   "tx": "text-red-700"},     # ∅
  "miss_very_late":  {"bg": "bg-red-200",   "tx": "text-red-900"},     # ∅ (≥3du)
  "pending":         {"bg": "bg-gray-100",  "tx": "text-gray-400"},    # Agd
  "not_due":         {"bg": "bg-gray-50",   "tx": "text-gray-300"},    # — (em-dash)
}
# Overlays de atraso (novo canal do SLA vencido — só em células Unp/Pro):
#   atraso        (1-2du): badge "Atraso" amarelo  #eab308 / texto #451a03
#   atraso_strong (≥3du) : badge "Atraso" vermelho #dc2626 / texto branco
```

---

## Visão por Agrupamento

**[decisão do usuário 2026-07-17]** "também ter uma aba com o mesmo controle por agrupamento dessas carteiras." Segunda aba do dashboard (tabs `Carteiras | Agrupamentos` no topo da página, rota `/dashboard/agrupamentos` no mesmo blueprint `pages/dashboard.py`): é **a MESMA matriz e a MESMA simbologia** — cores/estados do `STATE_STYLES`, siglas `Unp`/`Pro`/`Pub`/`∅`/`Agd`/`—`, overlays, tooltip escuro, legenda, janela D-3 —, mudando apenas a **unidade da linha** (um `grouping` em vez de uma carteira) e a forma de calcular a célula (roll-up abaixo). Nenhum estado nem cor nova entra na paleta.

### Escopo das linhas

- **[REVISADO 2026-07-17 — 3 blocos, ver "Ordenação da aba"]** A aba lista **todos** os groupings com `trashed ≠ True` (1.447 no banco), segmentados em 3 blocos de prioridade. O roll-up de células só é calculável para groupings com ≥1 **membro rastreado** (blocos 1–2 — na prática cobre os 1.016 ids referenciados na coluna `Agrupamentos Indexados` mais qualquer outro grouping que contenha carteiras do Template via `groupings.wallets[]`); o bloco 3 (zero membros rastreados) entra sem células (tudo `—`), colapsado por padrão.
- **Membros ativos de `g` na data `d`**: entradas de `groupings.wallets[]` com `initialDateOnGrouping ≤ d` e (`finalDateOnGrouping` null ou `≥ d`) — a carteira só conta para o agrupamento nas datas em que estava de fato ativa nele.
- **Interseção com o registry**: só membros presentes em `wallet_registry.json` entram no roll-up (são os únicos com célula calculada). Membros fora do cadastro **não bloqueiam** o estágio do agrupamento, mas o tooltip acusa (`+2 carteiras fora do cadastro — não monitoradas`) — sem essa regra, um membro não monitorado deixaria o agrupamento eternamente "incompleto".
- Grouping sem nenhum membro ativo cadastrado em `d` ⇒ célula `—` (não cobrado).

### Roll-up da célula: regra do pior caso

Mesma filosofia "pior caso" dos alertas existentes. A **célula do agrupamento herda integralmente (cor + sigla) o estado da carteira-membro em pior situação** naquela data:

```
sev_rank: not_due=0 < done=1 < wip_ok=2 < pending=3 < wip_late=4
          < wip_very_late=5 < miss_late=6 < miss_very_late=7

celula(g, d):
    membros = carteiras ativas em g na data d ∩ wallet_registry
    if membros vazio: return not_due (—)
    pior = max(membros, key=sev_rank do estado da célula da carteira)
    # empate de sev_rank → vence o estágio MENOS avançado (Agd < Unp < Pro < Pub)
    return estado_completo(pior)      # mesma cor E mesma sigla da célula da carteira "pior"
```

- Consequência: o agrupamento só fica **verde Pub** quando **todas** as carteiras-membro ativas estão Publicadas (ou Processadas com Deve Publicar = Não) — exatamente a regra "Publicado somente se TODAS publicadas; senão reflete o pior estágio".
- `pending (Agd)` ranqueia acima de `wip_ok (Unp/Pro)` de propósito: um membro sem nada carregado (ainda no prazo) está menos avançado que um em andamento — o agrupamento mostra `Agd` cinza, leitura honesta de "ainda aguardando pelo menos 1 carteira".
- **"Quase lá" (9/10 publicadas) NÃO ganha estado/cor intermediária** — decisão: vira linha de contagem no tooltip (`Publicadas 9/10`). Um estado "parcial" a mais explodiria a paleta (8 estados × parcial) e quebraria a promessa de "mesma simbologia"; a fração exata está a um hover de distância.

### Overlays no nível do agrupamento

| Marcador | Regra no agrupamento |
|---|---|
| **Badge "Rent" amarelo/vermelho (divergência)** **[REVISADO 2026-07-18 — cores por gravidade, rodada 6; mesmo badge da aba Carteiras]** | direto do **navPackage nível grouping** (alerta 6): `\|returnContribution − returnNavPerShare\| > 1e-4` no doc com `groupingId` — o Mongo já guarda o retorno agregado do agrupamento; **nunca recalcular por soma ponderada dos membros** (isso fica só como auditoria no drill-down, como já especificado no alerta 6). Mesmos thresholds/visual do alerta 5. |
| **Anel vazado (divergência via agrupamento)** | **não se aplica nesta aba** — ele existe na aba Carteiras para apontar "esta carteira pertence a um grouping divergente"; aqui a linha É o grouping, o ponto sólido basta. |
| **Anel vermelho (fora de sequência)** **[REVISADO 2026-07-18 — era roxo]** | se ≥1 membro ativo violou o gate D-1 naquela data; tooltip lista quais. |
| **Triângulo (issues)** | se ≥1 issue `pending` entre os membros na data; contagem consolidada no tooltip e no badge da linha. |
| **Badge "Atraso"** **[NOVO rodada 7]** | derivado do estado da **célula herdada** (a pior carteira-membro do roll-up), NUNCA da união dos membros — senão um membro atrasado faria o badge aparecer sobre uma célula `∅`/`Pub` herdada de outro membro, violando a regra "badge só em células `Unp`/`Pro`". Banda (amarelo/vermelho) pelo `adu` herdado da pior carteira. |

### Tooltip do agrupamento (formato próprio — contagens por estágio)

Não replica o formato de carteira individual: a seção central vira **contagem de membros por estágio**. Buckets com ≤3 carteiras listam os nomes completos (regra da casa); acima disso, só a contagem (o clique abre o drill-down). Exemplo:

```
Consolidado Família Silva            qua 15/07/2026   ← nome do grouping + data
Agrupamento · 10 carteiras ativas na data (+1 fora do cadastro)
──────────────────────────────
Publicadas    8/10
Processadas   1/10  (007CVG - 005285190)
Unprocessed   0/10
Faltando      1/10  (015CAA - 004512331 · +2du)
──────────────────────────────
SLA           pior atraso +2du (015CAA - 004512331)
Δ Rent Agrup  Contrib 0,0412% × NAV 0,0483% → 0,7 bp   ← navPackage do grouping (alerta 6)
Issues        4 pendentes em 2 carteiras
⚠ Sequência   1 carteira fora de sequência (003PCF - …)
```

Clique na célula/linha → **Painel de Detalhe do Agrupamento** (spec completa na seção [Painéis de Detalhe](#painéis-de-detalhe-drill-down)) — começa pelas carteiras-membro **ofensoras**, depois mini-matriz dos membros, metadados, divergência e comentários.

### Paridade de informação com a aba Carteiras **[decisão do usuário 2026-07-17 — supersede "coluna Instituição omitida"]**

O usuário esclareceu: agrupamentos "possuem groupingID e mesmas informações das carteiras" — a aba Agrupamentos tem **as mesmas colunas** da aba Carteiras, com o `groupingId` no papel do `walletId`. Mapeamento coluna a coluna:

| Coluna da aba Carteiras | Equivalente na aba Agrupamentos |
|---|---|
| Company (fixa, 1ª coluna) | igual — `groupings.companyId` resolvido em `companies.name` |
| Carteira (nome; `walletId` no painel/tooltip) | Nome do grouping; `groupingId` com o mesmo tratamento (copiável no painel/tooltip, nunca truncado) |
| Chip de Instituição | **regra própria abaixo** — um grouping não tem UMA instituição |
| Células da janela | roll-up pior caso (inalterado) |
| Últ. Unp / Últ. Pro / Últ. Pub | **mínimo entre os membros rastreados ativos** (a mais antiga entre as "últimas datas" — é quando o agrupamento fecha por inteiro); tooltip aponta o membro que segura (ex.: `segurada por 015CAA - 004512331`). Bloco 3: `—` |
| Badge de issues / badges de linha | consolidados dos membros (inalterado) |

**Regra do chip de Instituição no grouping:**

1. Se **100%** das carteiras-membro rastreadas ativas (na data de referência do grid) são da **mesma instituição** ⇒ chip normal com o nome (ex.: `XP`) — caso comum nos "auto-agrupamentos" de 1 carteira.
2. Se há **2+ instituições** ⇒ chip **`Mista (N)`** (N = nº de instituições distintas), mesmo visual cinza neutro; o tooltip do chip mostra a composição exata (`XP 4 · BTG 2 · Itaú 1`); a lista completa vive no painel de detalhe (seção Metadados).
3. Se **zero** membros rastreados (bloco 3) ⇒ chip `—`.

O filtro de Instituição na aba Agrupamentos usa semântica **"contém"**: seleciona os groupings com ≥1 membro rastreado ativo daquela instituição (inclui os `Mista (N)` que a contenham) — coerente com a pergunta operacional "quais agrupamentos a queda da XP afeta?".

### Ordenação da aba — 3 blocos de prioridade **[REVISADO pelo usuário 2026-07-17 — segmentação ANTES do algoritmo de prioridade]**

A lista deixa de ser um ranking único: há uma **segmentação em 3 blocos**, e o algoritmo de prioridade ordena **dentro de cada bloco**.

**Definições precisas (tudo computável em memória, zero queries extras):**

- **Membro rastreado de `g`**: entrada de `groupings.wallets[]` cujo `walletId` está no `wallet_registry.json` (Template, 792 carteiras) **e** que está **ativa em ≥1 dia útil da janela do grid**: `initialDateOnGrouping ≤ ref` (último dia da janela) **e** (`finalDateOnGrouping` null **ou** `finalDateOnGrouping ≥ window[0]`) — ou seja, o intervalo de atividade no grouping intersecta a janela. É a mesma regra dia-a-dia do roll-up, agregada à janela; uma carteira que saiu do grouping antes da janela não o "puxa" para os blocos 1–2.
- **Membro rastreado com pendência**: a linha da carteira tem **tier ≤ 2** (Crítica / Atenção / Observação — i.e., ≥1 célula vermelha ou em progresso atrasada na janela, OU ≥1 overlay de divergência/sequência/issue). Mesma definição do filtro "Só com pendência" da aba Carteiras.

| Bloco | Regra | Ordenação interna |
|---|---|---|
| **1. Com pendência no Template** | ≥1 membro rastreado **com pendência** | `sort_key_grouping` (pior primeiro) |
| **2. Sem pendência no Template** | ≥1 membro rastreado, **nenhum** com pendência | `sort_key_grouping` |
| **3. Não rastreados** | **zero** membros rastreados (nenhuma carteira do Template ativa na janela) — fração relevante: 1.447 groupings no banco vs 792 carteiras no Template | nome (`casefold`) — não há células nem severidade calculável |

```python
# [SUPERSEDIDO 2026-07-17 pela Pontuação de prioridade — ver §Ordenação das
# linhas: hoje sort_key_grouping = (bloco, -priorityScore, nome.casefold());
# o %pendentes foi absorvido pelo fator E (extensão) do score. Registro:]
def sort_key_grouping(g):
    return (g.bloco,                                  # 1) segmentação em 3 blocos [decisão do usuário 2026-07-17]
            g.tier,                                   # 2) pior estado da janela
            -g.atraso_du_da_celula_problematica_mais_recente,
            -g.pct_membros_nao_concluidos_na_coluna_mais_recente,  # 2/10 pendentes < 8/10 pendentes
            -g.overlay_score,                         # divergência/sequência/issues
            g.nome.casefold())                        # ordem total estável
```

**Bloco 3 colapsado por padrão** (decisão de design): sem membro rastreado não há célula calculável — seriam centenas de linhas 100% cinza (`—`) empurrando o scroll sem valor operacional. A UI mostra uma linha-sumário ao final da lista: **"+X agrupamentos não rastreados — mostrar"** (contador exato; expandir/colapsar é client-side, os dados já estão no snapshot). Expandido, cada linha do bloco 3 mostra Company, nome, `groupingId` e — única informação calculável sem membros no Template — o badge "Rent" (amarelo/vermelho por gravidade, rodada 6) quando existir `navPackage` nível grouping divergente na janela. Cada bloco tem um header-faixa discreto com contador (ex.: `Bloco 1 — 12 agrupamentos com pendência de carteiras do Template`); isso não conflita com a decisão "lista plana": dentro de cada bloco a lista segue plana — os blocos são camada de priorização pedida explicitamente pelo usuário, não agrupamento por metadado.

Chip de Company ao lado do nome do grouping (mesmo visual da aba Carteiras); filtro pelo `CompanySelector` (aplica-se aos 3 blocos, inclusive ao contador do bloco 3).

### Custo (zero queries novas)

- As células dos membros vêm das **mesmas 3 batch queries** do grid de carteiras (mesmo snapshot cacheado 60s) — o roll-up é pós-processamento em memória.
- Mapa de membership de `groupings` (projeção `{name, companyId, trashed, wallets}`) no cache TTL 120s, junto dos dicionários de nomes.
- Divergência do agrupamento reaproveita a query já especificada do alerta 6 (`find` por `groupingId $in` + range).
- Os 3 blocos e o chip de Instituição são pós-processamento de dados já carregados (a collection `groupings` inteira já está no cache TTL 120s; classificar por bloco = 1 passada em memória). O bloco 3 não adiciona query pesada: para cobrir a divergência de TODOS os groupings basta ampliar o `$in` da query do alerta 6 para todos os ids não-trashed — com range de 14du o retorno continua pequeno (~74 navPackages/dia no nível carteira; nível grouping é menor ainda).

---

## Sistema de Comentários em Alertas

**[pedido do usuário 2026-07-17]** Qualquer alerta/célula da matriz (carteira-dia, agrupamento-dia, ou a linha inteira) pode receber um **comentário humano** com três componentes: (a) **severidade manual** — verde / amarelo / vermelho, classificação do analista **independente** da cor calculada pelo sistema (ex.: célula vermelha automática + comentário amarelo "sabemos do atraso, fornecedor já avisou, não é crítico"); (b) **texto livre**; (c) **vigência** — data inicial e data final, **ambas pré-preenchidas com hoje**, editáveis para estender a validade.

### Persistência — decisão REVISADA (2026-07-17): `data/alert_comments.json`, não Mongo

**[decisão do usuário — supersede a análise original abaixo]** O planejamento original desta seção recomendava uma collection Mongo dedicada (`cargasComments`) com base na tabela de critérios adiante. O usuário decidiu, por ora, **manter a persistência 100% local em arquivo JSON** (`ControleCargas/prototype/data/alert_comments.json`), no mesmo padrão dos demais arquivos de `data/` já usados pelos apps irmãos — **sem nenhuma escrita no MongoDB de produção nesta fase**. Isso simplifica o app (zero exceção ao read-only, zero índice novo, zero migração de schema) e adia a decisão de infraestrutura para quando/se o volume de uso justificar.

Análise original (mantida como registro do trade-off, para retomar se a decisão for revisitada):

| Critério | `data/alert_comments.json` (ESCOLHIDA nesta fase) | Collection Mongo dedicada (alternativa não adotada agora) |
|---|---|---|
| Escrita concorrente (2+ analistas) | **risco real**: OneDrive sincroniza o arquivo inteiro; duas escritas próximas podem gerar "cópia em conflito" silenciosa ou last-writer-wins — comentário perdido sem aviso. **Risco aceito conscientemente pelo usuário nesta fase, não é bloqueador** (ver mitigação abaixo) | insert/update de documento individual — atômico no servidor; sem conflito |
| Latência de propagação entre analistas | segundos a minutos (sync OneDrive máquina a máquina) | imediata (todos leem o mesmo banco) |
| Precedente na casa | os irmãos usam JSON para **config de baixa frequência, poucos editores** (thresholds, conexões, cadastro) — comentário de alerta é mais frequente que isso, mas o usuário prefere aceitar o risco a abrir uma exceção de escrita no Mongo agora | o irmão `Controle de cargas` tem `diagnosticFeedback`, precedente de feedback humano em collection |
| Escopo read-only do Mongo | **mantém 100% read-only** — nenhuma exceção necessária | exigiria 1 exceção isolada e explícita |
| Complexidade de implementação | 1 arquivo JSON + `json.load`/`json.dump`, sem índice, sem schema de collection | exige `ensure_indexes()`, driver de escrita, tratamento de erro de rede na escrita |

**Mitigação do risco de escrita concorrente (aceito, não bloqueador):** o arquivo é pequeno (comentários, não milhares de linhas), a leitura sempre recarrega do disco antes de escrever (last-write-wins simples, sem merge), e o app roda hoje para poucos analistas simultâneos. Se o time crescer ou a colisão virar problema real observado em produção, a mesma trilha de decisão desta seção (tabela acima) já está pronta para justificar a migração para uma collection Mongo — é uma troca de `comments.py` internamente, sem mudar o contrato da API (`GET`/`POST /api/comments`) nem o schema dos campos.

### Schema

```js
// data/alert_comments.json — lista de objetos, um por comentário; ESTE é o único
// arquivo em que o app escreve (o Mongo de produção permanece 100% read-only)
{
  "id": "c_1737..."  ,                     // string gerada localmente (uuid4 ou timestamp+contador) — substitui o ObjectId
  "targetType": "wallet" | "grouping",
  "targetId": "<walletId | groupingId>",   // string, mesmo formato dos ids da esteira
  "cellDate": "YYYY-MM-DD" | null,         // null ⇒ comentário da LINHA inteira (carteira/agrupamento)
  "severity": "green" | "yellow" | "red",  // classificação HUMANA — nunca sobrescreve a calculada
  "text": "…",                             // texto livre (obrigatório, ≥1 caractere)
  "validFrom": "YYYY-MM-DD",               // default: hoje
  "validTo":   "YYYY-MM-DD",               // default: hoje (mesma data); editável p/ estender; sempre ≥ validFrom
  "author": "efigueira",                   // os.environ["USERNAME"].lower() — mesmo padrão do /setup
  "createdAt": "2026-07-17T15:00:00",  "updatedAt": "2026-07-17T15:00:00",
  "resolved": false                        // encerramento manual antes do validTo (opcional)
}
```

- **Arquivo**: `ControleCargas/prototype/data/alert_comments.json`, JSON com `{"comments": [...]}` na raiz (facilita adicionar metadados no topo do arquivo no futuro, ex. versão de schema).
- **Vigente** ⇔ `validFrom ≤ hoje ≤ validTo` e `resolved ≠ true` — contra o **hoje real**, nunca a referência D-3.
- **API** (`GET /api/comments`, `POST /api/comments` em `prototype/app.py`, ver Arquitetura/Plano de Fases): `GET` retorna o arquivo inteiro (lista completa, pequena — o filtro de "vigente vs. expirado" acontece no cliente, já que o painel de detalhe precisa dos dois grupos); `POST` recebe um comentário novo, valida campos obrigatórios (`targetType`, `targetId`, `severity`, `text`), preenche `validFrom`/`validTo` = hoje se ausentes, gera `id`/`createdAt`/`updatedAt`, e reescreve o arquivo inteiro (lê → agrega → grava, sem lock — ver risco aceito acima).
- **Sem delete pela UI**: comentário expirado é registro permanente (auditoria de "quem sabia o quê, quando"). Edição futura (fora do escopo desta fase) seria um novo `POST` de update filtrando por `id`.

### Aparência na célula — overlay adicional, NUNCA substitui a cor calculada

Decisão: o comentário entra como **4º overlay** (balão de conversa), ao lado de divergência/sequência/issues — a cor de fundo calculada **permanece intacta** durante toda a vigência.

- **Racional**: o caso de uso é "isso já está sob controle" **sem perder o dado bruto**. Se o comentário pintasse a célula, a matriz mentiria sobre o estado do sistema: um vermelho "amarelado" pelo analista sumiria da varredura visual de vermelhos, e a auditoria posterior não saberia o que o sistema dizia na época. Camada humana e camada calculada ficam visualmente separadas, como já são conceitualmente.
- **Visual**: balão no canto **inferior direito** — o único canto livre (sup. dir. = divergência, inf. esq. = issues, borda = sequência): quadrado 8×8px com `border-radius: 50% 50% 50% 0` (silhueta de balão de fala), preenchido com a cor manual — verde `#16a34a`, amarelo `#d97706`, vermelho `#dc2626` — e `ring-1` branco (mesma técnica dos pontos de divergência). Comentário de linha (`cellDate: null`): o mesmo balão ao lado do nome da carteira/grouping, junto dos badges existentes.
- **Tooltip** ganha bloco condicional: `💬 Comentário (amarelo, até 22/07 — efigueira): "fornecedor avisou do atraso…"`. Vários comentários vigentes no mesmo alvo: o balão usa a severidade **mais grave** (red > yellow > green); o tooltip lista todos.
- **Sem efeito em ordenação/tier nesta fase**: o dado bruto continua mandando na priorização (o topo da worklist é o que o sistema vê). Evolução futura possível, não decidida: filtro "ocultar comentados vigentes".

### Expiração (`hoje > validTo`)

O balão **some da matriz** — a célula volta ao estado puro. Um marcador vencido que continuasse visível viraria ruído permanente e mataria a confiança no símbolo ("isso ainda vale?"). O comentário **não é apagado**: permanece na collection e aparece no painel de detalhe, seção Comentários, sob "Expirados", com tag cinza `expirado em DD/MM` (mais recente primeiro). Reativar = editar `validTo` para uma data futura (update do mesmo doc; `updatedAt` registra a extensão).

---

## Painéis de Detalhe (Drill-down)

**[pedido do usuário 2026-07-17]** Clique numa célula OU numa linha abre um painel modal largo (`max-width: 760px`, `max-height: 85vh` com scroll interno — substitui o modal de 420px do protótipo). O conteúdo vai muito além do tooltip (que é 1 célula/1 dia): reúne a janela inteira, cadastro, issues completas, divergência com valores brutos, sequência e comentários. Toda célula é clicável (não só as com pendência) — o painel é o mesmo; numa célula saudável as seções de problema aparecem colapsadas com "nada aberto".

**Regra de dados**: tudo que já está no snapshot (células, tooltips, cadastro, roll-ups) renderiza na hora, zero query; a abertura do painel dispara no máximo 3 buscas on-demand, pontuais e projetadas: (a) issues com `description` (1 find por walletId+range), (b) navPackage completo do dia (1 `find_one`), (c) comentários do alvo (1 find). No protótipo estático (sem servidor), (a)/(b) podem ser pré-embutidos no snapshot limitados às carteiras com pendência.

### Painel de Carteira — seções, nesta ordem

| # | Seção | Conteúdo | Fonte |
|---|---|---|---|
| 1 | **Cabeçalho** | nome completo da carteira (regra da casa: `007CVG - 005285190`), chips Company / Instituição / Modelo de Carga (+ "manual" se for), badge do tier (Crítica/Atenção/Observação/OK), `walletId` copiável, data selecionada | snapshot/registry |
| 2 | **Mini-timeline da janela** | a linha inteira da matriz (~14 células, mesma simbologia + overlays; clique numa célula re-foca o painel naquele dia) + Últ. Unprocessed / Últ. Processada / Últ. Publicada com `biz_days_elapsed`; badge "(futura)" quando existir doc com `positionDate > hoje` | snapshot (`row.cells`) |
| 3 | **Situação do dia selecionado** | tabela estágio a estágio: Unprocessed (✓/✗, hora BRT, `inputType`), Processada (✓/✗, hora, "reproc. HH:MM" se `updatedAt>createdAt+5min`, flag `published`), Publicada (hora do navPackage, `nav`, `navPerShare`); linha de SLA: regime (D/M), deadline exato, `atraso_du` | snapshot (tt) + `find_one` navPackages |
| 4 | **Cadastro & SLA** | Instituição, Company, Modelo de Carga, Periodicidade, Defasagem/`lagBizDays` (ou "fechamento + 15du (10+5)" no regime M), Deve Publicar, Repetição Diária, Captura, Exceção, Explosão, `startDateConsolidation`, `accountCode` | `wallet_registry.json` + `wallets` |
| 5 | **Issues abertas (janela)** | tabela completa, agrupada por dia: data, tipo (com severidade do mapa do alerta 4), **`description` integral**, `inputType`, `createdAt`; contagem no título da seção; vazia ⇒ "nenhuma issue pendente na janela" | on-demand: `issues.find({walletId, status:"pending", date:{$gte:d0,$lte:d1}})` |
| 6 | **Divergência Rent Contrib × NAV** | por dia divergente na janela: `returnContribution` e `returnNavPerShare` **brutos** (decimal e %), Δ em bp, `nav`, `navPerShare`, `formerNav*`, `inAndOutFlows`; botão "Auditar por contribuição" recomputa de `processedPosition.securities[].dailyContribution` (find_one on-demand — método de auditoria do alerta 5) | snapshot (tt.div) + `find_one` navPackages/processedPosition |
| 7 | **Sequência cronológica** | resultado do gate D-1 na janela: lista de buracos ("processada 15/07 sem 14/07 processada"), badge preventivo "não processar D0 — revisar D-1" quando aplicável | snapshot (pós-processamento do alerta 8) |
| 8 | **Agrupamentos da carteira** | os groupings de `Agrupamentos Indexados`: nome, estado do roll-up na data de referência, Δ do grouping se divergente; clique abre o Painel de Agrupamento (drill-through) | snapshot.groupings |
| 9 | **Comentários** | vigentes primeiro (balão colorido + texto + autor + vigência), depois expirados (tag `expirado em DD/MM`); ao final o **formulário**: 3 botões de severidade (verde/amarelo/vermelho), texto livre, `validFrom`/`validTo` (ambos pré-preenchidos com hoje), escopo "este dia (DD/MM)" ou "carteira toda" | `data/alert_comments.json` |

### Painel de Agrupamento — seções, nesta ordem

**[destaque do usuário: as carteiras ofensoras vêm ANTES de tudo]**

| # | Seção | Conteúdo | Fonte |
|---|---|---|---|
| 1 | **Cabeçalho** | nome do grouping, chip Company, chip Instituição (regra da paridade: nome único ou `Mista (N)`), `groupingId` copiável, nº de membros ativos, badge do tier, data selecionada | snapshot |
| 2 | **Carteiras ofensoras** | **primeira seção de conteúdo, sempre** — as carteiras-membro rastreadas **com pendência** que impedem o agrupamento de fechar (não processadas/não publicadas/atrasadas), **ordenadas pelo mesmo `sort_key` da lista principal** (pior primeiro); cada item: nome completo, mini-célula do dia selecionado (cor + sigla), estágio atual, atraso em du, ícones dos overlays; clique abre o Painel de Carteira. Rodapé: "+N membros fora do Template — não monitorados" quando houver | snapshot (roll-up já em memória) |
| 3 | **Mini-matriz dos membros** | todos os membros rastreados ativos × janela (mesma simbologia), com a linha do roll-up do agrupamento no topo; ofensoras primeiro, saudáveis depois | snapshot |
| 4 | **Metadados do agrupamento** | `groupingId`, Company, composição por instituição (`XP 4 · BTG 2 · Itaú 1`), `benchmarks`, tabela colapsável de membros com `initialDateOnGrouping`/`finalDateOnGrouping` (inclui encerrados), Últ. Unp/Pro/Pub consolidadas (mínimo dos membros + quem segura) | `groupings` + snapshot |
| 5 | **Divergência do agrupamento** | navPackage nível grouping do dia: retornos brutos (decimal e %), Δ bp, `nav`; abaixo, as divergências individuais dos membros na mesma data (aponta qual carteira contamina o consolidado — drill-down do alerta 6); botão de auditoria por soma ponderada (on-demand, opcional) | `nav_group_map` + snapshot |
| 6 | **Comentários** | idêntico ao painel de carteira, com `targetType: "grouping"` e escopo "este dia" ou "agrupamento todo" | `data/alert_comments.json` |

Acessibilidade e consistência: painel fechável por Esc / clique fora (padrão do modal atual); todo dado dinâmico entra no DOM via `textContent` (nunca `innerHTML`) — mesma regra do tooltip; células da mini-timeline/mini-matriz são focáveis por teclado como no grid principal.

---

## Aba Controle de Cargas (Custodiantes)

**[NOVO 2026-07-18]** Terceira aba do protótipo, ao lado de Carteiras e Agrupamentos — mesma barra de tabs, mas com **fonte de dado totalmente diferente**: não vem do Mongo, vem de um **Excel mantido manualmente por uma pessoa da operação**.

### Fonte de dado (externa, somente leitura)

`Cliente Beehus\ControleUpload.xlsx` — arquivo **de outra pessoa, fora do projeto**. Decisão fundacional: **nosso app NUNCA escreve nele** (nem célula, nem aba, nem save acidental — `custodian_upload.py` abre com `read_only=True` + `data_only=True` e não possui chamada de `.save()`). O app só **absorve** o que a pessoa mantém: linhas de custodiante e datas novas entram automaticamente a cada geração do snapshot, sem nenhuma intervenção nossa.

Estrutura da aba `Planilha1` (validada em 2026-07-18 — 14 linhas × 352 datas na época; **os dois números crescem**):

- **Linha 1** — rótulos esparsos de "Day Off" de quem mantém a planilha (ex.: "Day Off Evair" em 30/12/2025). Não entram na classificação; viram **nota informativa** (marcador ● no cabeçalho da data + linha extra no tooltip).
- **Linha 2** — cabeçalho: col A = "Gestor + Custodia"; col B em diante = **uma data por coluna** (dias úteis, jun/2025..dez/2026). **Armadilha real de formato**: as datas até fev/2026 são `datetime` do Excel, as de mar/2026 em diante são **string "DD/MM/YYYY"** — `parse_header_date()` trata os dois e normaliza tudo para `YYYY-MM-DD`.
- **Linhas 3+** — col A = rótulo do custodiante ("Mira - BTG Onshore", "Smig - Itaú - Miami"...); demais colunas = status em texto livre. **Leitura dinâmica obrigatória**: varre da linha 3 até `max_row` incluindo toda linha com rótulo preenchido (nunca hardcodar contagem — a pessoa adiciona custodiantes de tempos em tempos; entre o levantamento inicial e a implementação a planilha já tinha ido de 13 para 14 linhas).

### Regra de classificação (confirmada com o usuário)

Implementada em `custodian_upload.classify_status()` — se mudar, mudar lá e no espelho `CU_CLASS_NAMES` do `index_template.html`:

| Célula (após `strip()`, case-insensitive) | Classificação | Cor |
|---|---|---|
| começa com `"P"` — cobre `P`, `P T`, `PT`, `P (Sem T)`, `P (Conferir T)`, `P (R)`, `P (Repl) T`, `P T 7/7`, sufixos `"(2/7 faltando desde ...)"` etc. | **OK** | verde |
| vazia OU exatamente `"Feriado"` (os 2 únicos casos neutros) | **neutro** | cinza |
| qualquer outro texto (`Sem posição`, `Repetido`, `Coletado` sozinho, `T`, `R`, `-`...) | **alerta** | amarelo |

Caso especial documentado: **`"Coletado P T"`** foi listado pelo usuário como verde apesar de não começar com "P" — regra estendida: `Coletado` seguido de resto que começa com "P" ⇒ verde (`Coletado` sozinho e `Coletado(validar...)` continuam amarelos).

O **texto bruto original é sempre preservado** no snapshot e mostrado no tooltip (célula verde `P (Conferir T)` continua avisando no hover que há algo a conferir).

### Pipeline e UI

- **`prototype/custodian_upload.py`** — módulo isolado de ingestão (`load_controle_upload()`): parse de datas dos 2 formatos, varredura dinâmica de linhas, classificação célula a célula, notas Day Off. Best-effort no `build_snapshot.py`: se o Excel estiver bloqueado/movido, o snapshot sai com `custodianUpload: null` e a aba mostra o aviso — Carteiras/Agrupamentos nunca são reféns do arquivo externo.
- **`snapshot.json`** — bloco `custodianUpload`: `dates` (ISO, ordem cronológica), `rows[{label, cells[]}]` (célula = `{c: ok|alert|neutral, t: texto bruto}`, `null` = vazia), `dayOffNotes`, `lastDateWithData`, `counts`.
- **Aba no front-end** — painel próprio (os filtros/ordenação/export das outras abas não se aplicam): grid linhas=custodiantes × colunas=datas, célula só com cor (sem sigla/badges — deliberadamente mais simples), tooltip = custodiante + data + texto original + classificação (+ Day Off). **Janela deslizante de 25 colunas** ancorada na **última data com dado** (não na última coluna da planilha, que vai meses no futuro), com navegação ◀/▶ por página e "mais recente".
- **Export Excel** (`write_excel_report`) — aba `ControleUpload` espelhando a janela de 25 datas com o texto bruto colorido pela classificação.

### Planilha2 — avaliada e descartada

A aba `Planilha2` contém **uma única coluna com 67 datas** (dias úteis, 25/11/2025 → 27/02/2026), sem nenhum status/rótulo associado. Avaliação: é rascunho/apoio de quem mantém a planilha (provável lista auxiliar usada para gerar as datas do cabeçalho da Planilha1 — coincide com o trecho em que o cabeçalho ainda era `datetime`). **Decisão: não é usada pela aba nova**; se um dia ganhar significado operacional, a ingestão é o único ponto a tocar (`custodian_upload.py`).

---

## Aba Controle de Demandas [2026-08-21]

**Quinta aba do protótipo** — porte do Kanban de demandas operacionais que já existia em `beehus-rotinas/pages/controle_demandas.py`/`templates/controle_demandas.html`, unificado aqui como mais uma tela do "Controle de Cargas" (decisão do usuário: uma ferramenta só, não dois apps separados no dia a dia). **A tela em `beehus-rotinas` continua ativa** — as duas fontes de dado (`beehus-rotinas/data/controle_demandas.json` e `prototype/data/controle_demandas.json`) foram deliberadamente deixadas independentes, sem sincronização entre si; risco aceito conscientemente de divergirem com o tempo, até uma decisão futura de desligar uma das duas.

### Correção de rumo durante a implementação (registrada por transparência)

A 1ª tentativa de porte tentou "modernizar" a tela contra os padrões deste protótipo — promoveu a persistência atômica/lock/anti-conflito de `app.py` para um módulo `utils/` compartilhado, e reescreveu o CSS contra os tokens de `controle_cargas.css`. O usuário corrigiu ambas as decisões: **nenhuma função já existente em `app.py` deveria ser tocada** (a persistência da tela nova ficou como código PRÓPRIO e autocontido dentro de `pages/controle_demandas.py`, deliberadamente parecido com o padrão de `app.py` mas sem importar nada de lá) e **o visual deveria ser preservado fiel à origem** (Tailwind + CSS custom do Kanban), não reskinado para o design system das outras abas. O resultado final descrito abaixo já reflete essa correção.

### Arquitetura

- **Backend**: `pages/controle_demandas.py` — 1º blueprint deste protótipo (`pages/` não existia antes; criada só para esta tela). Registrado em `app.py` com **apenas 2 linhas novas** (`import` + `app.register_blueprint(...)`) — nenhuma rota/função pré-existente foi alterada. Rotas: `GET/POST /api/demandas`, `PATCH`/`DELETE /api/demandas/<id>`, `POST /api/demandas/<id>/comments`, `GET /api/demandas/opcoes` (endpoint novo — devolve clientes/responsáveis/status/prioridades/tipos pro front-end montar `<select>`/`<datalist>`, já que o projeto não usa Jinja).
- **Persistência**: escrita atômica (`.tmp` + `os.replace`) + lock reentrante por processo + auto-cura de cópia de conflito do OneDrive (`<nome>-<PC>[-N].json`) — MESMA técnica já usada em `app.py` para `alert_comments.json`/`wallet_annotations.json`, mas como **cópia local própria** dentro de `pages/controle_demandas.py` (funções `_escrever_json_atomico_demandas`/`_achar_copias_conflito_demandas`/`_arquivar_copia_conflito_demandas`/`_mesclar_copias_conflito_demandas`), não um módulo `utils/` compartilhado — decisão do usuário de manter o blast radius desta tarefa restrito a arquivos novos.
- **Dado**: `data/controle_demandas.json` — as 80 demandas reais migradas 1x de `beehus-rotinas/data/controle_demandas.json` (schema mantido como está: `_id` uuid4, chaves em `snake_case`, sem normalizar para as convenções de outros arquivos do destino). `data/demandas_config.json` — clientes (9 reais do dado + "RTS") e responsáveis (11 nomes originais + "Backend"/"Vitinho", que apareciam no dado real mas faltavam na lista); `STATUS_OPTS`/`PRIORIDADES`/`TIPOS` continuam como constantes em `pages/controle_demandas.py` (enums que o código ramifica, não config solta).
- **`SEED_DEMANDAS`** (44 linhas hardcoded e desatualizadas da origem) **não foi portado** — sem o arquivo de dado, a tela nasce com lista vazia.
- **Validação de domínio nova**: `POST`/`PATCH /api/demandas` rejeitam `status`/`prioridade`/`tipo` fora dos valores válidos com HTTP 400 (a origem aceitava qualquer string).
- **Bug de fuso corrigido só em registros novos**: a origem gravava `datetime.utcnow().isoformat()` sem timezone (front-end exibia como se já fosse hora local — comentários apareciam ~3h adiantados). Registros novos usam `datetime.now().isoformat(timespec="seconds")` (mesma convenção de `app.py`); os timestamps das 80 demandas migradas não foram corrigidos retroativamente.

### Frontend — visual preservado fiel à origem

- **Não é uma página própria**: entra como mais uma **aba** da SPA (`#tab-demandas` + `#panel-demandas` em `index_template.html`/`index.html`, replicado nos dois arquivos). A troca de aba é feita por **listeners aditivos** em `static/js/controle_demandas/index.js` — anexados aos mesmos 4 botões de aba antigos e ao botão novo, **sem editar `switchTab()`/`wireAbas()`** de `static/js/controle_cargas/index.js` (um elemento DOM aceita múltiplos `addEventListener` no mesmo evento sem conflito).
- **CSS autocontido** (`static/css/controle_demandas.css`) — cores/espaçamentos hardcoded batendo com a origem (Tailwind + `<style>` custom do Kanban), **não** reaproveita os tokens (`--surface`/`--ink`/`--accent`/...) de `controle_cargas.css`. Tudo sob seletores `#panel-demandas .kd-*` ou classes `.kd-modal-*` inéditas (os 3 modais usam overlays próprios, não o `#modal-backdrop` compartilhado da grade principal) — nenhuma colisão de nome com o CSS existente. Sem dark mode (a origem tinha via toggle manual; o destino não tem esse controle nesta aba).
- **JS quebrado por funcionalidade** (CLAUDE.md §4), objeto próprio `ControleDemandas` (não estende `ControleCargas`): `state.js` (vocabulário de cor idêntico ao `<script>` da origem, inclusive o fallback pré-existente pra `cl-beehus`/amarelo quando cliente não bate com nenhuma chave conhecida — preservado por fidelidade), `filtros.js`, `quadro.js`, `colunas.js`, `cartoes.js`, `arrastar.js`, `metricas.js`, `modais.js`, `index.js` (bootstrap + wiring da troca de aba).
- Kanban com colunas por responsável (persistidas em `localStorage`, ocultar/reexibir coluna), cards arrastáveis (drag&drop reatribui responsável via `PATCH`), barra de progresso inline (±5%), filtros (busca + 4 selects + "mostrar concluídos"), métricas (total/concluídas/andamento/pendentes/on-hold/atrasadas/progresso médio), 3 modais (formulário nova/editar, comentários/atualizações, confirmar exclusão).

### Testado (Playwright, 2026-08-21)

Boot do servidor (`python app.py`, porta 5050) sem token Beehus configurado — sobe normalmente usando o `snapshot.json` em disco (o boot já tratava token ausente como aviso não-bloqueante, comportamento preexistente). Token colado via `POST /api/beehus-token` em runtime (nunca escrito em arquivo versionado). Confirmado: as 80 demandas carregam (27 concluídas/18 em andamento/33 pendentes/1 on hold/19 atrasadas na métrica); criar/editar (PATCH)/comentar/excluir via UI e via API; validação de domínio rejeita status inválido com 400; `GET /api/demandas/opcoes` devolve o vocabulário correto; as 4 abas antigas (Carteiras/Agrupamentos/Company/Controle de Cargas) continuam funcionando sem regressão (grade com 1032 carteiras, filtros, ordenação); zero erros de console no navegador.

---

## Aba Anomalias [2026-08-21]

**Sexta aba do protótipo** — board MANUAL de anomalias/incidentes operacionais, no MESMO mecanismo da aba "Controle de Demandas" acima (CRUD simples sobre JSON próprio, `data/anomalias.json`, populado à mão pelo time) — **SEM NENHUMA relação com carteiras/esteira** (não lê `snapshot_builder.py`/`registry.py`/`build_snapshot.py`/`snapshot.json`).

### Correção de rumo durante a implementação (registrada por transparência)

A 1ª tentativa desta tarefa construiu "Anomalias" como uma análise AUTOMÁTICA computada a partir do snapshot de carteiras (leitura de `registry.py`/`snapshot_builder.py`, cruzamento com `build_snapshot.py`). O usuário corrigiu: **"essa nova aba deve ser similar a de demandas, sem relação com as carteiras"** — a tentativa foi revertida por completo (ver backup `_backups/prototype_pos_demandas_pre_anomalias_20260821_204144/`) e a tela reconstruída do zero como board manual, seguindo à risca o padrão já validado por Demandas.

### O que é uma Anomalia (schema)

Registro criado manualmente pelo time: `id` (uuid4), `cliente`/`responsavel` (reaproveitados de `data/demandas_config.json`, mesma lista de Demandas), `titulo`/`descricao`, `criticidade` (`Crítico`/`Atenção`/`Observação` — enum novo desta tela, nomenclatura definida com o usuário), `acao_curto_prazo`/`acao_longo_prazo` (texto livre — contenção vs. estrutural), `status` (mesmos 5 valores de Demandas, por consistência), `created_at`/`updated_at`, `comments[]` (mesmo padrão de Demandas) e **`demandas_vinculadas[]`** — lista de `{"demanda_id", "horizonte": "curto_prazo"|"longo_prazo", "resumo", "created_at"}`, a funcionalidade nova pedida pelo usuário ("podendo indexar demandas como solução"): cada vínculo é só uma REFERÊNCIA por id à demanda (não duplica nenhum dado de Demandas).

### Arquitetura

- **Backend**: `pages/anomalias.py` — 2º blueprint do protótipo, mesmo padrão de `pages/controle_demandas.py` (persistência atômica + lock + auto-cura de conflito do OneDrive, cópia local própria, sem promover para `utils/`). Registrado em `app.py` com apenas 2 linhas novas. Rotas: `GET/POST /api/anomalias`, `PATCH`/`DELETE /api/anomalias/<id>`, `POST /api/anomalias/<id>/comments`, `GET /api/anomalias/opcoes` (criticidades/status + clientes/responsáveis reaproveitados de `demandas_config.json` + mapa `criticidade_para_prioridade` sugerido), `POST /api/anomalias/<id>/vincular-demanda` e `DELETE /api/anomalias/<id>/vincular-demanda/<demanda_id>` (complemento não pedido explicitamente, mas necessário para corrigir um vínculo errado sem excluir a anomalia inteira).
- **Vínculo com Demandas**: reaproveita as rotas JÁ HOMOLOGADAS do blueprint de Demandas (`GET /api/demandas?search=...` para buscar uma demanda existente, `POST /api/demandas` para criar uma nova e já vincular) — `pages/anomalias.py` nunca escreve em `controle_demandas.json`, só grava a referência (`demanda_id`) do lado da anomalia. Mini formulário de "criar nova demanda e vincular" pré-preenche cliente (igual ao da anomalia), texto (`[Anomalia · Contenção]`/`[Anomalia · Estrutural]` + título), prioridade (mapa criticidade→prioridade: Crítico→Alto, Atenção→Médio, Observação→Baixo) e tipo (Operacional para curto prazo, Sistema para longo prazo) — tudo editável antes de confirmar.
- **Dado**: `data/anomalias.json` (lista vazia inicial — nasce sem seed, populado só pelo time).

### Frontend — mesma família visual de Demandas, board por CRITICIDADE

- Entra como mais uma aba da SPA (`#tab-anomalias`/`#panel-anomalias`), com a MESMA técnica de listeners aditivos (cada uma das 5 outras abas ganha mais um listener escondendo `#panel-anomalias`; `tab-anomalias` esconde as outras 5) — nenhuma linha de `switchTab()`/`wireAbas()`/`controle_demandas/index.js` foi tocada.
- **CSS autocontido** (`static/css/anomalias.css`) — mesma linguagem visual de `controle_demandas.css` (cores, cards, badges, modais), classes `an-` próprias (nunca colidem com `kd-`), escopado sob `#panel-anomalias`/`.an-modal-*`.
- **JS quebrado por funcionalidade**, objeto próprio `Anomalias`: `state.js`, `filtros.js`, `quadro.js` (carrega anomalias + 1 fetch geral de `/api/demandas` por refresh do board, indexado por id, para mostrar o status das demandas vinculadas sem 1 chamada por card; também concentra construção de coluna e drag&drop — só 3 colunas fixas, sem a mecânica de colunas dinâmicas ocultáveis de Demandas), `cartoes.js`, `vinculos.js` (os 2 botões de vincular + busca + criar-e-vincular), `modais.js`, `index.js`.
- **Decisão de design sem regra explícita do usuário** (registrada em `pages/anomalias.py` também): o board agrupa por **CRITICIDADE** (Crítico/Atenção/Observação — 3 colunas fixas), não por responsável como em Demandas. Motivo: criticidade é o eixo central e exclusivo desta tela (board de triagem de severidade, como um bug tracker), enquanto responsável é sobre distribuição de carga de trabalho (o que já faz sentido em Demandas). Cartões arrastáveis entre as 3 colunas (PATCH reatribui `criticidade`).
- Cartão mostra badges de cliente/status/vínculos (cor conforme status atual da demanda vinculada); clicar num badge de vínculo troca para a aba Demandas e pré-filtra a busca pelo texto da demanda ("link/scroll" pedido no requisito).

### Testado (Playwright, 2026-08-21)

Boot do servidor sem internet outbound (sandbox) — `/api/atualizar` (Controle de Cargas) falha com 401 por não conseguir validar o token contra a API Beehus real, comportamento esperado e não relacionado a Anomalias (aba 100% local). Confirmado: as 6 abas presentes sem regressão nas 5 antigas; criar anomalia (aparece na coluna Crítico); editar; vincular demanda EXISTENTE via busca (`GET /api/demandas?search=`); criar demanda NOVA e já vincular (`POST /api/demandas` + `POST /api/anomalias/<id>/vincular-demanda`), com prioridade default confirmada (Crítico→Alto); nova demanda aparece em `GET /api/demandas` e no board de Demandas; clique no badge de vínculo troca de aba e filtra a demanda certa; comentário; exclusão; zero erros de console (exceto o 401 de `/api/atualizar` já explicado). Dois bugs achados e corrigidos durante o próprio teste: (1) um comentário JS/CSS continha a sequência literal `*/` no meio do texto (`.kd-modal-*/#kd-modal-*`), fechando o comentário `/* */` prematuramente e quebrando o parse de `modais.js`/`anomalias.css` — corrigido reformulando o texto; (2) `abrirDemandaVinculada()` checava `window.ControleDemandas`, que é sempre `undefined` porque `const` de topo de arquivo não vira propriedade de `window` — corrigido para `typeof ControleDemandas !== 'undefined'`.

### Melhorias [2026-08-22] — Parte 2 do plano (Onda 1 + Onda 2)

8 melhorias funcionais aprovadas pelo usuário, implementadas em 2 ondas — a Onda 1 (itens 1/2/3/7) sem nenhum campo novo no schema; a Onda 2 (itens 8/5/4/6) com campos novos, liberados por uma decisão explícita do usuário: **edição pontual e cirúrgica autorizada SÓ em `pages/anomalias.py`/`static/js/anomalias/*.js`/`static/css/anomalias.css`** (a regra "só adicionar" continuou valendo para todo o resto do app — `app.py`, `db.py`, `snapshot_builder.py`, `registry.py`, `build_snapshot.py`, `pages/controle_demandas.py`, tudo de `controle_cargas`/`controle_demandas` e, na prática, também `index_template.html`/`index.html`/`static/css/tema_escuro.css`, que nenhuma destas mudanças tocou — ver "Decisões sem regra explícita" abaixo).

**Onda 1 (zero campo novo):**
1. **Aging** — badge "há Nd"/"há Nsem" no cartão (`Anomalias.resolverFaixaAging`, `state.js`), cor por faixa (verde/âmbar/vermelho) conforme limiares configuráveis por criticidade em `data/anomalias_config.json` (`aging_thresholds_dias`, novo arquivo) — usa `ocorrido_em` quando presente (Onda 2), cai para `created_at` quando ausente.
2. **Cartão "órfão"** — anel tracejado (`outline`) + pílula "⚠ sem ação vinculada" em qualquer anomalia Crítica/Atenção com `demandas_vinculadas` vazio (`Anomalias.ehAnomaliaOrfa`).
3. `<select>` de ordenação ("Criticidade"/"Mais antigas primeiro"/"Atualizadas há mais tempo") + checkbox "Só sem demanda vinculada" — injetados via JS na barra de filtros (`filtros.js::injetarControlesFiltrosNovos`), aplicados client-side em `quadro.js::ordenarParaExibicao`/`renderizarQuadro`.
7. **Atalhos de teclado** (`index.js::ligarAtalhosTeclado`): `n` nova anomalia, `/` foca busca, `1`/`2`/`3` filtram por Crítico/Atenção/Observação, `0` limpa filtros (`Esc` fechando modal já existia). 2 guardas sempre checadas antes de agir: aba Anomalias precisa estar visível (`#panel-anomalias` sem `display:none`) e o foco não pode estar em `input`/`textarea`/`select`.

**Onda 2 (schema novo):**
8. Campo `ocorrido_em` (data, opcional — servidor usa a data de hoje como default quando ausente, `criar_anomalia()`) + `impacto` (texto curto livre) — exibido como linha itálica no cartão.
5. Campo `tags: []` (texto livre) + chips no cartão + `<select>` de filtro por tag (`an-f-tag`, injetado e populado com as tags realmente em uso + as sugestões de `data/anomalias_config.json::tags_sugeridas`). Filtro suportado no servidor (`_filtrar_anomalias`, novo parâmetro `tag`).
4. **Histórico/timeline** — array `historico: []` em cada anomalia, `{quando, campo, de, para}`, registrado no SERVIDOR (`atualizar_anomalia()`, comparando valor antes/depois de aplicar) sempre que `criticidade`/`status` mudam via PATCH — inclusive o PATCH de arrastar-e-soltar entre colunas do board, que já muda só `criticidade`. Exibido como timeline simples dentro do modal de "Atualizações" (`an-modal-comments-backdrop`), acima da lista de comentários.
6. **Recorrência** — no modal "Nova/Editar Anomalia", aviso discreto (`avaliarRecorrenciaForm()`) se já existem outras anomalias do mesmo `cliente` com alguma tag em comum nos últimos 30 dias (cálculo 100% client-side sobre a lista já carregada, sem chamada nova). No cartão, pílula "↻ Nª vez" (`calcularRecorrencia()`) quando a anomalia é a 2ª ou posterior ocorrência do grupo.

**Config nova**: `data/anomalias_config.json` (arquivo novo, versionável) — `aging_thresholds_dias` (limiares por criticidade, aceitos como propostos: Crítico 2d/5d, Atenção 7d/14d, Observação 21d/45d) e `tags_sugeridas` (7 sementes, autocomplete via `<datalist>` — campo aceita qualquer texto livre).

**Decisões sem regra explícita, registradas por transparência:**
- **Nenhum token `--sb-*` novo em `tema_escuro.css`** apesar de o plano ter previsto essa possibilidade: todos os elementos visuais novos (badge de aging, anel/pílula de órfã, chips de tag, pílula de recorrência, timeline) reaproveitam tokens `--sb-*` já existentes (`--sb-chip-critico-*`/`--sb-chip-atencao-*`/`--sb-chip-done-*`/`--sb-chip-active-*`/`--sb-vinc-*`/`--sb-text-*`/`--sb-border`), referenciados via `var(--sb-x, <fallback claro>)` diretamente em `anomalias.css` — funciona nos 2 temas mesmo com `anomalias.css` carregando ANTES de `tema_escuro.css` (custom property não depende de ordem de `<link>`, só do valor vigente em `:root` no momento da pintura). Mantém o blast radius restrito aos 4 arquivos liberados.
- **Nenhum novo `<script src>`/elemento HTML em `index_template.html`/`index.html`**: como esses 2 arquivos NÃO estavam na lista de edição liberada (só `pages/anomalias.py`/`static/js/anomalias/*.js`/`static/css/anomalias.css`/`data/anomalias_config.json` novo), todo controle novo de UI (selects de ordenação/tag, checkbox "só sem vínculo", campos de ocorrido_em/impacto/tags, aviso de recorrência, container de timeline) foi injetado via JS (`insertAdjacentHTML`) nos containers já existentes, dentro dos próprios arquivos de `static/js/anomalias/`, de forma idempotente (checa se o elemento já existe antes de injetar).
- **Timeline dentro do modal de "Atualizações"** (`an-modal-comments-backdrop`), não dentro do modal "Nova/Editar Anomalia": o plano dizia "acima dos comentários", e é o modal de Atualizações que tem a lista de comentários — o modal de edição não tem essa seção.
- **Recorrência conta só quando há tag em comum**: sem nenhuma tag preenchida, não há como o sistema saber que 2 anomalias são "do mesmo tipo" — a pílula/aviso simplesmente não aparece nesse caso (não é 0 por padrão, é ausência de sinal).

**Testado (Playwright, 2026-08-22)**: as 8 melhorias validadas uma a uma com 4 anomalias de teste (criticidades/tags/vínculos variados) — cartão órfão (3 pílulas confirmadas em Crítico/Atenção sem vínculo), recorrência (pílula "2ª vez" após 2 anomalias Mira com tag em comum), aging (badge "há 0d" verde nas 4), filtro por tag (2 de 4 cartões com "preço faltando"), impacto exibido no cartão, ordenação + "só sem vínculo" (4 de 4 sem vínculo), aviso de recorrência no modal Nova Anomalia, timeline populada após PATCH de criticidade via drag&drop simulado (`Crítico → Atenção` registrado e exibido), e os 4 atalhos de teclado (`n`/`Esc`/`/`/`1`/`0`) inclusive a guarda de foco (digitar "1" dentro do campo de busca não filtra). Nos 2 temas (`page.emulate_media`) — screenshots confirmando contraste OK em ambos. Zero erros de console (exceto o 401 de `/api/atualizar`, mesmo comportamento esperado de sandbox já documentado acima). Diff completo do repositório contra o backup pré-tarefa confirmou ZERO alteração fora dos 4 arquivos listados acima (`app.py`, `tema_escuro.css`, `index.html`/`index_template.html` inclusive, byte-idênticos). Dados de teste apagados de `data/anomalias.json` ao final (arquivo devolvido ao estado `[]` anterior à tarefa).

---

## Modo Escuro (app inteiro, 6 abas) [2026-08-21]

**Parte 1 de um plano de 2 partes** (Parte 2 = melhorias funcionais em Anomalias — aging, cartão órfão, tags, timeline etc. — ainda não implementada; ver plano completo entregue ao usuário fora do repo). Esta parte cobre só o tema claro/escuro.

### Achado de partida

`controle_cargas.css` já tinha a paleta escura COMPLETA nos 4 tabs do grid (Carteiras/Agrupamentos/Company/Controle de Cargas) — 3 blocos `@media (prefers-color-scheme: dark)` / `:root[data-theme="dark"]` / `:root[data-theme="light"]`, morta no código porque nenhum JS jamais escrevia `data-theme` no `<html>`. "Controle de Demandas" e "Anomalias" são um sistema de cor 100% separado (~46 valores hex hardcoded, zero `var()`, por decisão de projeto documentada nos cabeçalhos de `controle_demandas.css`/`anomalias.css`) e não tinham NENHUM tratamento de tema escuro.

### Decisões do usuário (confirmadas antes de implementar)

1. **Padrão inicial = "Automático"** (segue `prefers-color-scheme` do SO), não claro fixo — por isso o Sistema B também precisa da paleta escura espelhada em `@media` (não só em `[data-theme="dark"]`, que só cobre quem já escolheu manualmente).
2. **Botões primários do Sistema B invertidos no escuro** (claro sobre fundo escuro: bg `#e9ecf0`/texto `#14171b`, hover `#ffffff`) — de propósito NÃO usa o verde `--accent` do grid (os dois sistemas de cor continuam separados).
3. **Divergência `index.html` × `index_template.html` reconciliada** (achado do plano): `index.html` tinha 4 coisas que `index_template.html` não tinha (botão `#btn-beehus-token`, `<script src=".../beehus_token.js">`, `readonly` no campo de data, remoção do sortbtn "Última Publicada" — mais o texto do `<span class="tag">`, achado no diff) — `build_snapshot.py::write_html()` sobrescreve `index.html` com uma cópia de `index_template.html`, ou seja, rodar o build apagava essas 4 coisas. Os 2 arquivos agora são IDÊNTICOS; toda mudança de HTML de agora em diante entra nos dois igualmente.

### Arquivos novos (nenhum dos 3 CSS existentes nem nenhum JS existente foi editado)

- **`static/css/tema_escuro.css`** — carregado por ÚLTIMO no `<head>` (depois de `controle_cargas.css`/`controle_demandas.css`/`anomalias.css`). 3 seções:
  1. Layout (`.masthead .tag{margin-right:auto;}`, não é cor — só o espaçamento do botão novo).
  2. **Grid ControleCargas** — só 3 lacunas reais de cor FIXA (não `var()`) que ficavam sem definição visual em fundo escuro: tooltip `#tt` (quase do mesmo tom do `--surface` escuro, sem borda — ganhou `border` + sombra mais forte), sombra de popover/modal (preta a baixa opacidade, invisível sobre fundo já escuro — opacidade aumentada), e os 3 tons de anotação `td.col-anotacao.sev-*` (tintas a 14% que quase desapareciam sobre `--surface-raised` escuro — opacidade subiu para 30%). Cada lacuna ganhou os 3 blocos de sempre (`@media` / `[data-theme=dark]` / `[data-theme=light]`, este último restaurando o valor claro original — sem ele o `@media` vazaria pro tema claro escolhido manualmente com o SO em modo escuro).
  3. **Sistema B (Demandas + Anomalias)** — implementado via ~90 custom properties locais (`--sb-*`, "Sistema B": neutros, 5 badges de status, 10 badges de cliente — 9 de Demandas + "Eté" só em Anomalias —, 3 badges de tipo, chips de métrica, botão primário invertido) declaradas em 4 blocos (`:root` default claro, `@media dark`, `[data-theme=dark]`, `[data-theme=light]` restaurando o claro) + um conjunto ÚNICO de ~90 regras (`#panel-demandas`/`#panel-anomalias .kd-*`/`.an-*`) que só referenciam `var(--sb-...)` — o valor muda com o tema, a regra não se repete. Cores de acento já vívidas (dots/barras de prioridade e criticidade, botão de perigo) foram mantidas sem alteração — contraste já alto o bastante contra fundo escuro.
- **`static/js/utils/tema.js`** — pasta `static/js/utils/` criada nesta tarefa (CLAUDE.md §5). Objeto `Tema`: lê `localStorage` (chave `controlecargas.tema`) com fallback pra `matchMedia('(prefers-color-scheme: dark)')`, aplica `data-theme` no `<html>` o quanto antes (script bloqueante no `<head>`, sem `defer`/`async` — evita flash de tema errado), sincroniza texto do botão (`🌙 Escuro`/`☀️ Claro`) a partir do que está aplicado no momento, e grava escolha explícita ao clicar. Bônus não obrigatório incluído por ser trivial: pressionar e segurar o botão (~700ms, mouse ou touch) limpa a escolha manual e volta a seguir o SO.

### Único ajuste em markup pré-existente (fora do "só adição")

`index.html`/`index_template.html` tinham 2 cores hardcoded em `style=` inline no cabeçalho do painel de Demandas (`<h2 style="...color:#111827">`/`<p ... style="...color:#9ca3af">`) — resíduo de antes da extração das classes `.kd-titulo`/`.kd-subtitulo` (o `an-titulo`/`an-subtitulo` equivalente em Anomalias já usava classe, não inline). Como não usam classe, a paleta do Sistema B não alcançava esses 2 elementos — texto quase preto sobre fundo escuro, ilegível. Corrigido trocando o hex fixo por `var(--sb-text-strong,#111827)`/`var(--sb-text-faint,#9ca3af)` (fallback preserva o valor original se `tema_escuro.css` não carregar por algum motivo) — 2 linhas, nenhuma função/lógica tocada.

### Bug encontrado e corrigido durante o próprio teste

Um comentário em `tema_escuro.css` continha a sequência literal `*/` no meio do texto (`.kd-modal-*/.an-modal-*`), fechando o comentário `/* */` prematuramente — MESMO padrão de bug já documentado na tarefa de Anomalias (`modais.js`/`anomalias.css`, 2026-08-21). O parser CSS descartava a regra seguinte inteira (`.kd-modal-box, .an-modal-box{background:...}`), deixando os modais de Demandas/Anomalias com fundo branco fixo no tema escuro. Corrigido reformulando o texto do comentário para não conter `*/` literal.

### Testado (Playwright, 2026-08-21)

`page.emulate_media(color_scheme=...)` nos 2 valores (sem precisar clicar no botão) nas 6 abas + toggle manual clicado (persiste em `localStorage`, confirmado após `page.reload()`) + `Tema.limparEscolhaManual()` (volta ao automático). Screenshots confirmando legibilidade: grid (Carteiras/Agrupamentos/Company/Controle de Cargas) escuro e claro, tooltip `#tt` e popover de filtro de coluna escuros (bordas visíveis contra o fundo), Controle de Demandas (board + modal "Nova Demanda") escuro e claro, Anomalias (board + modal "Editar Anomalia" + modal "Vincular demanda") escuro e claro. Diff contra backup confirmou zero alteração em `app.py`, `static/css/controle_cargas.css`, `static/css/controle_demandas.css`, `static/css/anomalias.css` e toda `static/js/` pré-existente.

---

## Referências de Design

Inspiração de layout/padrões (nada a copiar literalmente):

- **Apache Airflow — Grid & Calendar View**: grid de células coloridas run×tempo (verde/amarelo/vermelho) e visão calendário de longo prazo — é exatamente o padrão do nosso grid carteira×dia. [Airflow UI Overview](https://airflow.apache.org/docs/apache-airflow/stable/ui.html), [Astronomer — Airflow UI](https://www.astronomer.io/docs/learn/airflow-ui) e [monitorando SLAs de DAGs](https://www.astronomer.io/blog/expert-tips-for-monitoring-the-health-and-slas-of-your-apache-airflow-dags/).
- **Data freshness / SLA boards**: padrão "timestamp do dado mais recente vs. expectativa por tabela" com alerta ao estourar — espelha nossos alertas 1–3. [Conduktor — Data Freshness & SLA](https://www.conduktor.io/glossary/data-freshness-monitoring-sla-management), [DataKitchen Data Observability](https://github.com/DataKitchen/data-observability-installer).
- **Alert feed com severidade e supressão de duplicados** (um alerta agregado por causa-raiz, não um por recurso): [OpenObserve](https://github.com/openobserve/openobserve) e o desenho de alerting do [Grafana](https://www.techinterview.org/post/3233474398/system-design-design-grafana-monitoring-dashboard-time-series-visualization-alerting-data-sources-panel-plugins/).

Documentos internos: `Relatorios/docs/DEVELOPER_GUIDE.md` (padrões de blueprint, cores, rotas), `Relatorios/db.py` (proxy, `cell_cls`, `build_wallet_map`), `Relatorios/cache.py` (TTL), `Relatorios/pages/setup.py` (registro de conexão).

---

## KPI — Processadas sem Divergência de Rentabilidade [RASCUNHO 2026-08-10 — NÃO IMPLEMENTADO]

> **Status: rascunho para avaliação futura.** Pedido do usuário: "vamos
> pensando em KPI, considerando o processo final como processado sem
> divergência de rentabilidade". Ainda não há decisão de implementar — esta
> seção só registra a proposta e as perguntas abertas, pra não perder o
> raciocínio até decidirmos avançar.

### Motivação

O KPI que já existe ("Carteiras/Agrupamentos Publicados",
`computePublishStat()`/`computeGroupingPublishStat()`, `matriz.js`) só conta
como concluído o estágio `p` (Publicada). Mas Publicação pode atrasar por
motivo operacional/burocrático sem relação com a QUALIDADE do
processamento — uma carteira já `wc`/`cD` (Processada) e sem nenhuma
divergência de rentabilidade pendente já está, na prática, "pronta"; só
falta o passo formal de publicar. Um segundo KPI mediria esse sinal mais
adiantado, sem mexer no significado do card que já existe.

### Decisões de escopo já tomadas (usuário, 2026-08-10)

- **KPI novo, lado a lado** com "Carteiras/Agrupamentos Publicados" — NÃO
  substitui o critério de sucesso do card existente (Publicada continua
  sendo Publicada, sem ambiguidade).
- **Carteiras E Agrupamentos juntos** — os dois pares de KPI ganhariam a
  lógica nova ao mesmo tempo, mantendo a mesma paridade que já existe entre
  `computePublishStat`/`computeGroupingPublishStat`.

### Definição proposta de "processada sem divergência"

Duas condições, avaliadas na MESMA data em foco do KPI (`state.focusDate`
ou data de referência — mesmo padrão de `computePublishStat()`):

1. **Estágio ≥ Processada**: célula em `wc` (Processada, aguardando
   publicação), `cD` (Processada, não publica) ou `p` (Publicada). Não
   conta `wu`/`wait`/`miss`/`notcov`.
2. **Sem divergência ativa**: overlay da célula não inclui `div` nem
   `div_strong` (`OV_CLASS`, `state.js`; thresholds em bp + impacto em R$ —
   ver `LIMIAR_DIVERGENCIA_REAIS`, `snapshot_builder.py`, §Especificação dos
   Alertas #5/#6).

```python
# Espelha computePublishStat() — mesmo denominador (mustPublish, célula não
# "notcov" na data em foco) já usado pelo KPI de Publicadas.
def processada_sem_divergencia(celula):
    if celula.s not in ('wc', 'cD', 'p'):
        return False
    overlays = celula.ov or []
    return 'div' not in overlays and 'div_strong' not in overlays
```

Para Agrupamentos, mesma regra de "pior caso" que já rege o resto do
roll-up (`computeGroupingPublishStat()`): agrupamento só conta como OK se
TODAS as carteiras-membro tracked+ativas+mustPublish na data em foco
passarem em `processada_sem_divergencia`.

### UI proposta

2 cards novos, reaproveitando o mesmo componente visual de
`buildPublishStat()`/`buildGroupingPublishStat()` (número/total, %, barra de
progresso, escopo, texto da data em foco) — mesmas 3 faixas de cor
(100% ok / ≥80% atenção / abaixo crítico).

### Perguntas abertas (resolver antes de implementar)

1. Nome definitivo do card/KPI (ex.: "Processadas sem Divergência" vs
   "Prontas para Publicar" vs outro rótulo mais próximo do vocabulário
   operacional do time).
2. A divergência deve valer só a do OVERLAY DO DIA em foco (proposta
   acima), ou também uma divergência aberta em dia anterior e ainda sem
   comentário/resolução? O overlay hoje é calculado por dia — a proposta
   atual não olha histórico.
3. `cD` (Processada, nunca vai publicar) conta como "pronta" do mesmo jeito
   que `wc` (Processada, só falta publicar)? São sucessos de natureza
   diferente (um nunca evolui mais; o outro é "quase lá").
4. Onde posicionar os cards novos na hierarquia visual, sem disputar
   atenção com o card "Publicadas" (que continua sendo o KPI principal).
