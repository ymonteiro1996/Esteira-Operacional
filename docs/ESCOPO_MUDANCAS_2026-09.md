# Escopo de mudanças: ControleCargas (set/2026)

Este arquivo é parte do escopo conjunto **conciliacao · ControleCargas · beehus-swat**, levantado em **25/09/2026** a partir da leitura do código. Ele traz:
- a visão geral dos três projetos;
- as decisões;
- os itens **deste repo**;
- os itens transversais.

Os itens dos outros repos estão no mesmo caminho (`docs/ESCOPO_MUDANCAS_2026-09.md`) dentro de cada um deles.

---

## 0. Roteiro para a sessão que vai implementar

1. Ler este arquivo inteiro e o `CLAUDE.md` do repo. As convenções de cada projeto estão no bloco PREP.
2. Fazer o **PREP** do repo: branch, pendências no git, como subir o servidor.
3. Seguir as **ondas** da tabela da seção 2. Para cada item:
   - implementar;
   - rodar o **teste manual** e conferir o **critério de aceite**;
   - atualizar o `docs/` do projeto;
   - fazer um commit pequeno;
   - marcar o Status na tabela.
   
   **Não dar push sem confirmar.**
4. **Parar e perguntar** ao usuário:
   - nas decisões marcadas com 🔴;
   - nas "confirmações de arquitetura" da seção 3.2;
   - se o código divergir do que está descrito aqui.
5. Ao terminar cada item, informar ao usuário:
   - o que mudou;
   - os arquivos alterados;
   - como testar.
6. Nada de gravar dado real no Beehus durante os testes. Usar carteira ou empresa de teste, ou uma data que possa ser revertida.

---

## 1. Como usar este documento

- Cada pedido tem um **ID** (`CONC-xx`, `CC-xx`, `SWAT-xx`). Itens que se repetem nos três projetos viraram itens **transversais** (`TRV-xx`), com um desenho único.
- As referências `arquivo:linha` foram levantadas em **25/09/2026**. Confira antes de editar, porque as linhas mudam.
- A sessão que for implementar deve atualizar a coluna **Status** da tabela abaixo no arquivo do repo onde o item foi feito. Status: `pendente` · `em andamento` · `em teste` · `feito` · `bloqueado`.
- Nenhum dos três projetos tem teste automatizado. Cada item traz um **teste manual** e um **critério de aceite**. Um item só vira `feito` depois do teste manual.

## 2. Visão geral e ordem de execução

A ordem prioriza o que pode gerar **dado errado no Beehus**. Depois vêm o token (que atrapalha tudo), os ajustes rápidos e, por último, os itens grandes.

| Onda | ID | Projeto | Item | Esforço | Depende de | Status |
|---|---|---|---|---|---|---|
| 0 | PREP | todos | Preparação: branch, commit do que está pendente, conferir host da API | P | — | feito (CC: branch `onda-1/escopo-2026-09`; só CRLF pendente) |
| 1 | SWAT-05 | swat | Publicação publica acima da divergência: checar por data e por carteira no servidor | M | — | pendente |
| 1 | CONC-01 | conciliacao | Colar valor na transação perde o decimal (manda valor errado ao Beehus) | M | — | pendente |
| 1 | TRV-02 | todos | Modal fecha ao arrastar a seleção de texto (transação, token e outros) | P | — | feito no CC (guarda nos 2 HTMLs idênticos; Playwright em servidor isolado, com e sem a guarda). D12 do token fica p/ o TRV-01 (modal próprio) |
| 1 | CC-04 | ControleCargas | Instituição "XP" aparece como "P" na matriz | P | — | feito — causa confirmada no DOM (Company 60px < 96px fixo); `left` da Carteira agora medido. Playwright: só Blue3 mostra "XP"; todas as empresas rolando, nada se cobre; Agrupamentos idem |
| 1 | SWAT-04 | swat | Groupings não aparecem | P–M | reprodução do usuário | pendente |
| 2 | TRV-01 | todos | Token expirado abre o pop-up de colar token na hora | M | PREP | feito no CC (= CC-06; branch `onda-2/escopo-2026-09`; modal próprio do token + D12; só as 3 rotas do Beehus marcam; 15 checks Playwright) |
| 2 | TRV-03 | swat, conciliacao | Campo token começa vazio | P | TRV-02 | pendente |
| 3 | SWAT-07 | swat | Lote do Identificar Transações: 500 → 250 | P | — | pendente |
| 3 | SWAT-08 | swat | Faixa de datas vem preenchida (D-7 a D-1) nos 5 executores | P | — | pendente |
| 3 | SWAT-09 | swat | Transações: um scroll só | P | — | pendente |
| 3 | CONC-03 | conciliacao | Botão de copiar o valor do GAP | P–M | CONC-01 | pendente |
| 3 | CC-02 | ControleCargas | Renomear a aba atual para "Checklist Manual Cargas" | P | — | feito (branch `onda-3/escopo-2026-09`; rótulo + comentários/docstrings/log; ids, <title>, <h1> e nome do app intocados; Playwright: aba, painel e ◀/▶) |
| 3 | CC-05 | ControleCargas | Pauta com contorno azul; vermelho se o D-1 não foi processado | P | — | feito (anel azul sky-600/sky-400 — D9; vermelho na Pauta com D-1 sem processada; Excel azul/vermelho; testado no backend e na tela, 2 temas) |
| 4 | SWAT-01 | swat | Log temporário na tela e limpeza ao trocar de Company | M | SWAT-08 | pendente |
| 4 | SWAT-06 | swat | Várias empresas ou "Todas" nos 5 executores | M (Transações: G) | SWAT-05, SWAT-01 | pendente |
| 4 | CC-01 | ControleCargas | Campo "Data D0" que muda todo o D0 da ferramenta | M | — | feito (branch `onda-4/escopo-2026-09`; `data_hoje` no snapshot + `d0` nas 4 rotas; D10: abre em hoje, faixa "D0 simulado", não roda Atualizar sozinho; 8 checks servidor + 9 tela) |
| 5 | CC-03 | ControleCargas | Novo "Controle de Cargas" (3A leitura · 3B API de jobs · 3C disparo) | G | CC-02, CC-01 | 3A feita (branch `onda-5/escopo-2026-09`, só local; métrica D3 confirmada em 27/09; 22 checks de regra + 32 na tela); 3B aguarda a captura do `jobs/logger` pelo usuário; 3C bloqueada pela 3B |

Aliases (o mesmo trabalho aparece em mais de um lugar do pedido original):
- `CONC-02` (transação fecha ao selecionar) = **TRV-02**
- `CONC-04`, `CC-06` e `SWAT-03` (token estourou → pop-up) = **TRV-01**
- `SWAT-02` (campo token preenchido e fechando ao arrastar) = **TRV-03** + **TRV-02**

A descoberta da API de jobs (`CC-03`, fase 3B) depende de uma captura feita pelo usuário no navegador. Ela pode começar em paralelo, já na onda 1.

---

## 3. Decisões

### 3.1 Já respondidas pelo usuário (25/09/2026)

| Tema | Decisão |
|---|---|
| SWAT-07, "250 transações" | É o tamanho do lote do **Identificar Transações** (hoje 500). Não é um teto global no servidor. |
| SWAT-05, Δ nulo | Carteira ou agrupamento **sem Δ calculado** na data **não publica** e aparece no log como "sem Δ calculado". |
| SWAT-05, como checar | A checagem é **por data e pela diferença em cada data**, carteira a carteira, e não só pela data inicial da faixa. |
| CC-05, anel vermelho | Numa célula de Pauta, o vermelho aparece **quando o dia útil anterior (D-1) não tem posição processada**, mesmo que o dia da Pauta ainda não esteja processado. Isso **muda a regra atual** para células de Pauta. |
| CC-03, "rodar carga" | **Entender via API.** O usuário indicou que o Beehus web chama `GET https://api.controladoria.beehus.com.br/beehus/jobs/logger?date=AAAA-MM-DD` (200 OK), e que esse módulo de jobs deve ajudar no disparo. Nenhum dos três projetos usa esse módulo hoje. Ver a fase 3B do CC-03. |

### 3.2 Pendentes

A sessão pode seguir com o **padrão proposto** e marcar o item como "a confirmar". Os itens marcados com 🔴 bloqueiam a implementação.

| # | Tema | Padrão proposto |
|---|---|---|
| D1 🔴 | **CC-03**: a frase "podendo inserir um range de datas com intervalo de …" ficou cortada. Intervalo de quê? Tamanho máximo da faixa, passo entre execuções ou espera entre disparos? | Faixa De/Até de no máximo **10 dias úteis**, uma chamada por data, em sequência. **Respondido 27/09: é isso** (`disparo.maxDiasUteisFaixa` = 10). |
| D2 🔴 | **CC-03**: a regra "D+3" vale **só para XP**, ou para todo mundo via coluna **Defasagem** do Template? No Template, D-3 também aparece em Goldman Sachs (21), BTG Pactual US (19), JP Morgan NY (17), Avenue (11) etc.; D-2 em Morgan Stanley NY (130); D-1 em BTG, Itaú etc. | Usar a Defasagem do Template (XP = D-3 → D+3). Se for só XP, deixar a lista de instituições em `data/controle_cargas_config.json`. **Respondido 27/09: só XP** (`disparo.defasagemPorInstituicao` = `{"XP": 3}`). |
| D3 | **CC-03**: a métrica de "carga efetivada" | Ver a proposta refinada no CC-03 (três níveis, dias úteis, trava contra falha prolongada). **Confirmado 27/09 como proposto** (95%, 1 faltante, inativa após 5 du, trava em 50%) — gravado em `data/controle_cargas_config.json`. |
| D4 | **SWAT-08**: D-7 e D-1 em **dias úteis ANBIMA** ou dias corridos? | Dias úteis ANBIMA (o projeto já tem `bizdays` e `wallet_scope.deslocar_du`). |
| D5 | **SWAT-01**: ao trocar de Company, as datas ficam **em branco** ou **voltam ao padrão** D-7/D-1? O log é por ferramenta ou um só para o painel? | Voltar ao padrão D-7/D-1 e limpar o log. Um log por ferramenta, logo abaixo do botão Executar. |
| D6 | **SWAT-05**: manter um jeito de **forçar** a publicação (hoje existe Ctrl-clique no seletor)? | Não. O servidor sempre bloqueia. Se precisar, criar um "Forçar" explícito com confirmação e registro no log. |
| D7 🔴 | **SWAT-04**: em qual painel e depois de quais passos os Groupings somem? | Seguir a hipótese A (company desatualizada no iframe da ferramenta) e confirmar com o teste descrito no item. |
| D8 | **SWAT-07**: o modal "Processar Transações" do painel também tem um limite de 500 linhas (`_PTX_MAX_ROWS`, `controlpanel.html:2063`). Muda para 250? | Não mexer. Só o lote do Identificar. |
| D9 | **CC-05**: qual tom de azul? O badge fúcsia de Pauta continua? | Um azul diferente do azul de seleção (`#1d4ed8`), por exemplo sky-600. O badge continua. |
| D10 | **CC-01**: o D0 fica salvo entre recargas da página? | Não. Sempre abre em hoje, e aparece uma faixa "D0 simulado" quando ele for diferente de hoje. Trocar o D0 não roda o Atualizar sozinho. |
| D11 | **TRV-01**: depois de colar um token novo, a ação que falhou é repetida sozinha? | Não. Só aparece a mensagem "Token salvo, repita a ação". Repetir um POST automaticamente pode duplicar escrita. |
| D12 | **TRV-02**: os modais de criar/editar (transação, token) devem fechar com clique no fundo? | Token e transação fecham só pelos botões ou Esc. Os outros modais mantêm o clique no fundo, com a proteção contra arrasto. |

**Confirmações de arquitetura** (os CLAUDE.md do conciliacao e do ControleCargas, §7, exigem aval antes):
1. TRV-01 intercepta o `fetch` globalmente nos três projetos.
2. CC-03 cria uma aba nova, um blueprint novo e uma chamada nova à API de jobs. **Aprovado 27/09.** Na 3A não precisou de blueprint nem de chamada nova: a matriz sai do snapshot (`matriz_cargas.py`).
3. CC-03, fase 3C: o ControleCargas passaria a fazer chamadas de **escrita** (disparo de job), contrariando a regra atual de "app somente leitura" (§8). **Aprovado 27/09, com confirmação** (modal + registro no log, só pela rota que sair da 3B).

---

## 4. Itens deste repo (ControleCargas)

### PREP (ControleCargas)

- **Pasta e branch.** O app fica em `...\Projeto - Servidor\ControleCargas\prototype` e a branch é `development`. No `git status` aparecem 10 arquivos modificados, mas é só CRLF: não há mudança real pendente. Criar branch por item ou por onda.
- **Como rodar.**
  - `prototype\iniciar.bat` chama o `start.ps1`, que usa a porta fixa **5050**, encerra o processo antigo, instala as dependências e abre o navegador.
  - Manualmente: `python -m pip install -r requirements.txt` e depois `python app.py`.
  - Cole o token do dia no botão 🔑 e clique em **Atualizar**. O Atualizar nunca roda sozinho.
- **Testes.** Não há suíte. O CLAUDE.md registra testes pontuais com Playwright usando um snapshot sintético injetado via JS.
- **Convenções do `prototype/CLAUDE.md`.**
  - Quebra de arquitetura exige aval (§7).
  - O app é **somente leitura** na API; escrita só por rota homologada (§8).
  - Comentário "Contexto" + "Pseudocódigo" acima de toda função; nomes em português; `snake_case` no Python (§2, §3).
  - JS em `static/js/<tela>/`, um arquivo por funcionalidade, somado ao objeto `ControleCargas` via `Object.assign`. Não inflar o `matriz.js`, que já tem ~1080 linhas (§4).
  - Backend novo vai como blueprint em `pages/`, registrado de forma aditiva no `app.py`.
  - Parâmetros ficam em `data/*.json` (§10).
  - **`index.html` e `index_template.html` precisam ficar idênticos.**
  - Datas no formato `AAAA-MM-DD`. Dias úteis via `CalendarioDiasUteis` (ANBIMA). O D-n é calculado no servidor.
  - Dados compartilhados em JSON no OneDrive, com lock e gravação atômica. Reaproveitar `/api/annotations` em vez de criar arquivo novo.
  - Marcar as mudanças com `[AAAA-MM-DD, pedido do usuário: …]` e atualizar `docs/` na mesma tarefa (§11).
- **Mapa rápido.**
  - Abas (`index_template.html:86-104`): Carteiras, Agrupamentos, Company, "Controle de Cargas" (`tab-custodian`), Controle de Demandas, Anomalias e Carteiras Não Cadastradas.
  - Matriz: as linhas são as carteiras do `TemplateCarteiras.xlsx` validadas na API (`registry.py`). As colunas são 7 dias úteis até a data "Até". Cada célula é calculada em `snapshot_builder.compute_cell` (l. 383).

### CC-01: campo "Data D0" (padrão hoje)

**Pedido:** "Criar um Campo Data D0 que começa como Default hoje, e ao ser mudado altera todo D0 que a Ferramenta utiliza."

**Como está hoje:** o D0 não existe como conceito. O "hoje" vem do relógio do servidor (`build_snapshot.py:252`, `hoje = date.today()`).

**Onde o "hoje" é usado e se deve seguir o D0**

| Camada | Local | Segue o D0? |
|---|---|---|
| Snapshot | `build_snapshot.py:252`, que alimenta a janela padrão (:276), o atraso, o estado e a Pauta (`compute_wallet_row` :327 → `compute_cell` :437-438), o texto de SLA (:616-622), o badge dos agrupamentos (:1018-1045), `meta.today` (:364) e os rótulos D-n (:369) | **Sim** |
| Servidor | `app.py:687-695`, `_today_str()`, usado em `janela_padrao` (:1122), no padrão de vigência de `post_comments` (:920) e no snapshot vazio (:399) | Sim |
| Servidor | Nome do arquivo Excel (`app.py:1330`) e checagem de snapshot velho (`app.py:464`) | Não |
| Outras abas | `pages/carteiras_nao_cadastradas.py:231` | Sim |
| Carimbos de registro | `app.py:402,926,1012,1071`, `custodian_upload.py:268`, anomalias, demandas, expiração do token | Não |
| Tela | `static/js/utils/datas.js:37-41`, `hojeISO()`, usado em `comentarios.js:50` (comentários vigentes) e `:306` | **Sim** |
| Tela | `atualizar.js:156-175` (De/Até via `/api/janela-padrao`), `matriz.js:348,745`, `matriz_custodiantes.js:40` | Sim |
| Chave por data | As anotações usam `meta.referenceDate` (o "Até"), em `anotacoes.js:50,90,183` | Continuam no "Até" |

**O que fazer (tem que ser no servidor**, porque atraso, Pauta e D-n são calculados lá com o calendário ANBIMA)
- **Campo na tela.** Criar `<input type="date" id="data-d0">` no `#toolbar3`, nos **dois** HTML. Guardar em `ControleCargas.state.d0`, com padrão `hojeISO()`. Não persistir entre recargas (D10).
- **Aviso.** Mostrar a faixa "D0 simulado: dd/mm" quando o D0 for diferente de hoje.
- **Parâmetro `d0`.** Passar em `/api/atualizar`, `/api/janela-padrao`, `/api/carteiras-nao-cadastradas` e no POST de comentários.
- **Snapshot.** `montar_snapshot(data_hoje=…)` substitui a l. 252. O `calcular_janela_grid` já recebe a data como parâmetro.
- **Trocar o D0** recalcula De/Até, mas **não** roda o Atualizar sozinho.
- **Validação.** Bloquear ou avisar quando "Até" for maior que D0.

**Limitação (avisar o usuário):** a API devolve o estado **atual**, sem histórico. Um D0 no passado reavalia o SLA com os dados de hoje, então uma carga que chegou atrasada aparece como presente.

**Aceite:**
- Com D0 numa sexta passada e Atualizar, o cabeçalho mostra D0 e D-n relativos àquela data.
- As Pautas mudam de acordo.
- Aparecem os comentários vigentes naquela data.
- Recarregar a página volta para hoje.

**Esforço:** M.

### CC-02: renomear para "Checklist Manual Cargas"

**Pedido:** "Nomear o Controle de Cargas atual como Checklist Manual Cargas."

A aba atual mostra a planilha `ControleUpload.xlsx`, mantida à mão (`custodian_upload.py`). Ou seja, ela já é um checklist manual.

**O que mudar**
- Rótulo da aba em `index_template.html:90` e `index.html:90`.
- Comentários e docstrings: `index_template.html:115,200`, `index.js:28-49,93,108`, `matriz_custodiantes.js:1,8,49`, `controle_cargas.css:692`, `custodian_upload.py:2,8`, `build_snapshot.py:57,352` (mensagem de log) e a seção em `docs/PLANNING.md:1646`.

**O que não mudar**
- `<title>`, `<h1>`, `iniciar.bat` e a docstring do `app.py`: "Controle de Cargas" é o nome do app inteiro.
- Os ids internos (`tab-custodian`, view `'custodian'`).

**Aceite:** a aba mostra o nome novo, e a navegação ◀/▶ e o tooltip continuam funcionando.

**Esforço:** P.

### CC-03: novo "Controle de Cargas"

**Pedido (resumo):**
- Controlar as cargas por **Company – Instituição – Modelo de Carga – Mensal/Diário**, com filtro Mensal/Diário e as mensais com contorno diferente.
- Uma métrica que diga se a carga foi **efetivada**.
- Mostrar primeiro os problemas com **mais carteiras afetadas**.
- Comentários temporários e diários, com responsável, no mesmo layout de "Carteiras".
- Vincular a carga à API e à data da Matriz: **XP em D+3** da data com problema; algumas cargas são manuais.
- Clicar na data e no problema para **rodar a carga**, com uma faixa de datas.

**O que já existe**
- **Dados.** O Template tem tudo o que a chave precisa:
  - C Instituição;
  - H Periodicidade (D 1124 / M 287);
  - I Defasagem (D-1, D-2, D-3, D-4 ou M);
  - K Modelo de Carga (API 495, AWS 327, Scrapping 291, Operacional Oikos 236, Yuri 34, E-mail PDF 17, XML 9…).
  
  O `registry.py:139-160` já gera `loadModel`, `isManualLoad` (sistêmicos = API, AWS, Scrapping Site, XML, l. 18), `periodicity` e `lagBizDays`, e tudo isso já está nas linhas do snapshot (`snapshot_builder.py:714-745`). A Company vem da API (`companyId`). São ~64 combinações de Instituição + Modelo + Periodicidade, sem nenhuma chamada nova à API.
- **Início e última carga.** `startDateConsolidation` vem da API e está preenchido em 100% das carteiras (`registry.py:170`). Para olhar além da janela de 7 dias, `db.buscar_ultima_carga_por_carteira` (`db.py:942`) e a busca de Unprocessed (`db.py:614-640`) usam **1 chamada por empresa, com qualquer intervalo**. Os documentos trazem `inputType`, que distingue carga por API de upload manual.
- **Componentes para reaproveitar:**
  - `matriz_company.js`: agregação grupo × dia com faixas ok/atenção/crítico; é o molde mais próximo;
  - `rowHtml`, `STATES` e o CSS de célula;
  - `anotacoes.js` + `selecao_celula.js` + `/api/annotations`, para responsável e comentário do dia: acrescentar `'carga'` em `VALID_TARGET_TYPES` (`app.py:469`, validado em :909 e :1062), com `targetId = companyId|instituição|modelo|D/M`;
  - `comentarios.js`, para comentários temporários com vigência De/Até;
  - `utils/filtro_popover.js`, para os filtros.
- **Disparo:** o `beehus_api` do CC é 100% leitura (`beehus_api/__init__.py:1-12`). O swat também não tem rota de disparo de carga. A única ação próxima é o **reprocessar** Unp → Pro (`positions.py:176`, POST `.../processed-position/process`), que não busca carga nova. O usuário indicou o módulo **`/beehus/jobs/*`** (fase 3B).

#### Fase 3A: tela somente leitura (G)

- **Aba e arquivos.** Aba nova "Controle de Cargas", com arquivos próprios: `static/js/controle_cargas/matriz_cargas.js`, CSS próprio e blueprint `pages/controle_cargas_novo.py`, se precisar de rota.
- **Linhas e células.** Linha = chave `Company | Instituição | Modelo | D/M`. Célula por dia = **% de carteiras com carga** e **quantas faltam**. O clique abre a lista das carteiras faltantes.
- **Ordem.** Por **número de carteiras faltantes** na data de referência (decrescente) e, em seguida, pelos dias seguidos com problema.
- **Filtro.** Chip Mensal/Diário. As linhas mensais ganham **contorno tracejado**.
- **Comentários.** Responsável e comentário do dia, e comentário temporário, **no mesmo layout de Carteiras**.
- **Configuração.** Parâmetros da métrica em `data/controle_cargas_config.json`.

**Proposta de métrica** (resposta ao "veja se são boas métricas"; confirmar em D3)

A ideia do usuário é boa: cobertura das carteiras do Template, sem contar as inativas e contando as novas. Ela precisa de 6 ajustes para não enganar:
1. **Contar em dias úteis ANBIMA**, não em dias corridos.
2. **Trava contra falha prolongada.** Pela regra original, se o feed inteiro cair por 5 dias, **todas** as carteiras viram "sem carga nos últimos 5 dias", saem do denominador, e a carga aparece como OK (0/0). Por isso:
   - a janela de atividade termina **antes** da data avaliada;
   - se o denominador for 0, ou se mais de 50% das carteiras forem excluídas, a linha mostra **🔴 Falha prolongada**.
3. **Três níveis em vez de "> 95%":**
   - ✅ **Efetivada:** 0 faltantes.
   - 🟡 **Parcial:** 1 faltante, ou cobertura ≥ 95%. Mostrar "efetivada com X faltantes".
   - 🔴 **Não efetivada:** o resto.
   
   Motivo: muitos grupos têm de 1 a 10 carteiras. Com 10 carteiras, uma falha dá 90% e reprovaria. Já a XP API tem ~329 carteiras, e 95% esconderia 16 faltantes.
4. **Antes do prazo** (data + Defasagem ainda não chegou), a célula mostra **⏳ Aguardando**, e não falha.
5. **Mensais:** avaliar só na data de referência do mês (último dia útil), com prazo = fim do mês + `du Recebimento PDF` + `du Upload Beehus`. Cobertura diária não faz sentido para elas. Limitar ao D0, porque a Repetição Diária gera documentos com data futura.
6. **Carteiras novas** (início há menos de 5 du) entram no denominador, como o usuário pediu. As que **ainda não tiveram a primeira carga** aparecem marcadas como "onboarding", para não parecerem falha do feed.

O `docs/PLANNING.md:942-948` já especificava um alerta parecido ("Carga Instituição", faltantes/total ≥ 0,8 com total ≥ 3) que nunca foi implementado. Alinhar as duas regras.

#### Fase 3B: descoberta da API de jobs (P, depende do usuário)

**Ponto de partida:** o Beehus web chama `GET https://api.controladoria.beehus.com.br/beehus/jobs/logger?date=AAAA-MM-DD` e recebe 200.

1. **Pedir ao usuário** que, com o DevTools aberto no Beehus web:
   - salve um exemplo da **resposta** do `jobs/logger` (JSON, sem o token);
   - se o Beehus web tiver um botão de rodar ou reprocessar consumo, dispare-o **uma vez numa carteira ou data de teste** e copie o request (método, URL e payload) com **"Copy as cURL"**, **apagando o header Authorization**.
2. **Documentar em `docs/API_JOBS.md`:**
   - campos do logger (job, custodiante/instituição, modelo, data, status, início e fim, erro);
   - como casar um job com a chave `Instituição | Modelo`;
   - rota, método e payload do disparo;
   - se o disparo aceita data ou faixa.
3. **Uso de leitura:** acrescentar `get_jobs_logger(date)` no `beehus_api` do CC. É uma chamada GET e respeita o "somente leitura". Mostrar o status do job ao lado da cobertura, para separar "o job não rodou" de "o job rodou, mas faltaram carteiras".

#### Fase 3C: botão "Rodar carga" (M, bloqueado por 3B, D1, D2 e aval de arquitetura)

- **Seleção.** Clicar na célula (data + problema) e escolher a faixa De/Até (D1).
- **Data enviada.** Data do problema + Defasagem (XP D-3 → D+3). Ver D2: só XP ou todas.
- **Execução.** Uma chamada por data, em sequência, com progresso e resultado no log da tela.
- **Modelos manuais** (Operacional Oikos, Yuri, E-mail PDF…): no lugar do botão, mostrar **"Acionar responsável"**. O próprio campo Modelo já traz o nome da pessoa.
- **Reprocessar** (`/process`, Unp → Pro): só como ação separada e com aval.

**Aceite da 3A:**
- Cada chave aparece com o nível certo para um conjunto conhecido de carteiras.
- A ordenação segue o número de faltantes.
- O filtro Mensal/Diário funciona e as mensais têm o contorno diferente.
- O comentário do dia é salvo e reaparece depois de recarregar.

### CC-04: Instituição "XP" aparece como "P"

**Pedido:** "Ajustar o campo instituição na matriz em Carteiras, no caso da XP, apareceu só o P na visualização."

**Onde:** `static/js/controle_cargas/matriz.js:124` desenha `r.institution` inteiro, sem cortar nada:

```js
<td class="col-summary"><span class="inst-chip" ...>${esc(r.institution||'—')}</span></td>
```

**Causa provável: coluna sticky com posição fixa** (`static/css/controle_cargas.css:331-338`).

```css
td.col-company, th.hdr-company{ position:sticky; left:0; ... }  /* largura automática */
td.col-name,  th.hdr-name{ position:sticky; left:96px; ... }     /* fixo em 96px */
```

- Quando a coluna Company fica com **menos de 96px**, a coluna Carteira (fundo opaco, z-index 2) é empurrada para 96px mesmo sem rolar a tela. Ela passa a cobrir o começo da Instituição, e o "X" some.
- Acontece quando só aparecem empresas de nome curto. Exemplo: Blue3 tem 624 carteiras, 100% XP.
- O inverso também acontece: com nomes longos, rolar para o lado faz a Carteira cobrir a Company.

**Antes de corrigir, confirmar no DevTools:** comparar a largura de `td.col-company` com o `left` de `td.col-name`.

**O que fazer:** depois de desenhar a tabela (`atualizarDomEEstadoMatriz`, `matriz.js:340`), medir `th.hdr-company` e gravar numa variável CSS: `left: var(--sticky-left-nome, 96px)`. A alternativa é fixar a Company em 96px, com reticências e `title`. O mesmo CSS vale para a aba Agrupamentos.

**Aceite:**
- Atualizar com a empresa Blue3 mostra "XP".
- Com todas as empresas, rolar para o lado não cobre nenhuma coluna.

**Esforço:** P.

### CC-05: Pauta com contorno azul, vermelho se D-1 não foi processado

**Pedido:** células de Pauta com contorno azul. Se não houver posição processada no dia anterior, manter o anel vermelho. A decisão do usuário foi que o vermelho vale **sempre que o D-1 não tem processada** (ver 3.1).

**Como está hoje**
- O overlay `'seq'` só é aplicado quando o dia **tem** processada e o dia útil anterior não tem (`snapshot_builder.py:548-574`, anexado em :534-535). O `'pauta'` entra quando `atraso_du == 0` (:489-490).
- `OV_CLASS` (`state.js:46-47`): `seq → 'ov-seq'`, `pauta → ''`. A Pauta não gera classe na célula, só o badge fúcsia (`css:489`).
- `.ov-seq` (`css:461`) é um `box-shadow` interno de 3px vermelho.
- O azul `#1d4ed8` já é usado na **célula selecionada** (`css:815-817`).

**O que fazer**
1. **Backend** (`snapshot_builder.py`). Para células de Pauta, calcular `d1_sem_processada` (o dia útil anterior não tem Processed) e anexar um overlay `'pauta_seq'`, ou reutilizar `'seq'` só nesse caso. A regra `'seq'` das células que não são Pauta **não muda**.
2. **Front** (`state.js`). `pauta → 'ov-pauta'`, com `.ov-pauta{box-shadow: inset 0 0 0 3px var(--overlay-pauta-ring)}` declarado **antes** de `.ov-seq`: na mesma especificidade, o vermelho vence pela ordem no arquivo. Usar um azul diferente do da seleção (D9), com variante no tema escuro (`tema_escuro.css`).
3. **Legenda e Excel.**
   - Legenda em `matriz.js:689,692`.
   - Excel em `excel_matriz_xlsx.py:38-72,148-149` (hoje a borda é fúcsia): passar a azul, e vermelha quando houver o problema de D-1.
   - `exportar.js:190` passa a enviar essa marca também.
   - O painel de detalhe (`paineis.js:91`) e a aba Agrupamentos herdam a mudança sozinhos.

**Aceite:**
- Célula de Pauta com D-1 processado: anel azul.
- Célula de Pauta com D-1 sem processada: anel vermelho.
- Célula comum processada sem D-1: vermelho, como hoje.
- A célula selecionada continua distinguível.
- Tudo certo nos dois temas e no Excel.

**Esforço:** P.

### CC-06: token estourou → pop-up

Ver **TRV-01**. No CC são 4 rotas de 401 e o front fica em `beehus_token.js`. Criar um modal de token próprio, sem usar o genérico. O texto atual do modal diz que o token é "perdido a cada restart", mas ele é salvo em disco: corrigir.

---

## 5. Itens transversais (valem para os três projetos)

### TRV-01: token estourou → pop-up de colar token na hora

**Pedido:** "Quando tentar algo e estourar o token, já mostrar na tela o pop up de colar o token" (conciliacao, ControleCargas e swat).

**Como está hoje**

- **Detecção no cliente.** O status 401 **ou 403** do Beehus liga a flag `rejected` e lança `BeehusAuthError`. Quando não há token, `_headers()` lança o mesmo erro sem ligar a flag.
  - conciliacao e swat: `beehus_api/client.py:279-285` e `:331-337` (os dois arquivos são idênticos, exceto a linha 28).
  - CC: `prototype/beehus_api/client.py:585-593`.
  - `exceptions.py` é igual nos três.
- **Como o erro chega na tela.**
  - conciliacao: `utils/respostas.py:27-48` devolve 401 `{error, upstream_status, upstream_body}`, sem código próprio.
  - swat: dois helpers devolvem 401 (`pages/beehus_console.py:106-112`, `pages/conciliacao.py:734-739`). Porém ~39 blocos `except BeehusAPIError` e várias rotas em lote devolvem 502, ou 200 com o erro dentro do corpo (ex.: `pages/excecoes.py:1902-1905`).
  - CC: 4 rotas devolvem 401 com uma mensagem amigável (`app.py:847`, `:1355`, `:1439`, `pages/carteiras_nao_cadastradas.py:232`).
- **Erro engolido.** O `beehus_catalog.py` captura `BeehusAuthError` junto com `Exception` (21 lugares no conciliacao, 30 no swat). Exemplo: no conciliacao, `/api/conciliacao-mov/rows` devolve **200 `{"rows":[]}`** com o token vencido (`pages/conciliacao_mov.py:118-142`). Olhar só o status HTTP não resolve.
- **Conflito com o login local.** No conciliacao e no swat, o `auth.py:98` já devolve `("unauthorized", 401)` em texto quando falta o cookie de sessão. Por isso o front **não pode** tratar todo 401 como token vencido.
- **Tela.**
  - conciliacao e swat: um banner consulta `/api/beehus/token` a cada 60 s e mostra o link "Colar token →" (`templates/partials/_token_banner.html:18,30-57`). Nada reage na hora em que a ação falha.
  - swat: há ~12 `alert` espalhados para `status===401`.
  - CC: o modal abre sozinho só quando a página carrega (`static/js/controle_cargas/beehus_token.js:26-33`).

**O que fazer (mesmo desenho nos três)**

*Backend*
1. **Hook `after_request`.** Para toda resposta `/api/*` que não seja a própria rota de token: se `token_status()` indicar `rejected` ou nenhum token carregado, adicionar o header **`X-Beehus-Token: expired`**.
   - Isso cobre erro engolido, erro dentro de lote e erro em thread de fundo, porque a flag é "grudenta".
   - No CC funciona por sessão, porque o `before_request` já amarra o `sid`.
2. **Código de erro.** Acrescentar `error_code: "BEEHUS_TOKEN_EXPIRED"` nos helpers de 401 que já existem e registrar `@app.errorhandler(BeehusAuthError)` como rede de segurança. O status continua 401.
3. **Antes de mexer no 403:** descobrir o que a API devolve para token vencido.
   - Se for só 401, parar de tratar 403 como token rejeitado. Senão, um 403 de permissão abriria o pop-up.
   - Se a API usa 403 para token vencido, manter como está.

*Frontend: `static/js/utils/beehus_token_guard.js`, o mesmo arquivo copiado nos três*
1. **Envolver `window.fetch`.** Se a resposta vier com `X-Beehus-Token: expired` e a URL não for a rota de token:
   - dentro de iframe: `parent.postMessage({type:'beehus-token-expired'}, location.origin)`;
   - fora de iframe: abrir o modal local.
   A resposta segue sem alteração para quem chamou.
2. **No shell**, tratar a mensagem `beehus-token-expired`, conferindo `event.origin`. Abrir o modal com o campo **vazio** e o texto "Seu token expirou, cole um novo".
3. **Evitar reabrir em loop.** Não reabrir se o modal já estiver aberto, e esperar ~20 s depois de o usuário fechar. Sem isso, o polling do banner (60 s) e os pollings de 2,5 s do swat ficariam reabrindo o modal.
4. **Depois de salvar:** avisar os iframes e mostrar "Token salvo. Repita a ação." (ver D11). **Não** repetir POSTs automaticamente.
5. **Remover os ~12 `alert` de 401 no swat**, para não aparecerem o alert e o modal ao mesmo tempo.

*Onde encaixar em cada projeto*
- **swat:** dentro do wrapper de `fetch` que já existe em `templates/base.html:15-75` (hoje ele injeta os headers `X-Swat-Scope`). Precisa reestruturar para rodar sempre, e não só quando há escopo. Todas as 14 páginas estendem `base.html`.
- **conciliacao:** no `<head>` do `base.html` da página, mais o tratamento da mensagem no `templates/shell.html`. O `Token.open()` fica em `shell.html:31` e o modal em `:55-71`.
- **CC:** dentro do `beehus_token.js` (não precisa de tag nova). Se for criar uma tag nova, `index.html` e `index_template.html` precisam ficar **idênticos**.
  - Hoje o token usa o modal genérico (`paineis.js:22-33`), então abrir o token **substituiria** um painel aberto. Criar um elemento de modal próprio para o token.

**Critérios de aceite**
- Com o token apagado ou inválido, qualquer ação que chama a API abre o pop-up na hora, com o campo vazio.
- Isso vale também para ações cujo erro hoje é engolido, por exemplo carregar as linhas da conciliação.
- Um 401 do login local (sem cookie) **não** abre o pop-up.
- O pop-up não reabre em loop enquanto estiver aberto, nem logo depois de ser fechado.
- Depois de colar um token válido, repetir a ação funciona.

**Teste manual**
1. Apagar o token com o `DELETE /api/beehus/token` (conciliacao e swat) ou pela rota equivalente do CC, e disparar uma ação.
2. Colar um token propositalmente inválido (último caractere trocado) e disparar uma ação.
3. Deixar a tela parada por 3 minutos com o token vencido e confirmar que o pop-up não pisca.

**Esforço:** conciliacao P–M · swat M · CC P.

**Atenção:** o conciliacao tem uma alteração **não commitada** justamente em `utils/respostas.py`. Ver PREP.

---

### TRV-02: modal fecha ao arrastar a seleção de texto

**Pedido:**
- conciliacao: "Ao selecionar o range de um valor para editar, ele fecha a janela da transação".
- swat: "[campo Token não deve] fechar quando arrasta o range de seleção com o mouse".

**Causa (a mesma em todos os projetos, e reproduzida com Playwright)**

Os fundos dos modais fecham no `click` com `if(event.target===this) fechar()`. Quando o mouse desce dentro do input e sobe em cima do fundo, o navegador entrega o `click` ao ancestral comum, que é o próprio fundo, e o modal fecha. O `onclick="event.stopPropagation()"` no painel interno não ajuda.

**Onde o padrão aparece**
- **conciliacao** (10 lugares):
  - `static/js/conciliacao_mov/edicao.js:83` (transação), `:267` (provisão) e `:351` (preço de execução);
  - `templates/conciliacao_mov.html:274, 291, 312, 334, 435`;
  - `templates/shell.html:55-56` (token) e `:80-81` (cache).
- **swat** (~45 lugares):
  - `beehus_console.html` (24), `conciliacao_mov.html` (10), `controlpanel.html` (8, mais `:5932-5938`);
  - modais de token em `shell.html:208`, `beehus_console.html:2664/2677`, `controlpanel.html:1327/1339` e `correcoes.html:306/319`.
  - O swat já tem o padrão certo em um lugar: `_guardedClose` em `templates/precificacao.html:1514-1528`.
- **CC:** o fundo do modal genérico, em `static/js/controle_cargas/paineis.js:824` (`e.target.id==='modal-backdrop'`).

**O que fazer**
1. **Guarda global em fase de captura** (`static/js/utils/guarda_arrasto.js`, um por projeto):
   - no `mousedown`, guardar o alvo;
   - no `click`, cancelar (`stopImmediatePropagation` + `preventDefault`) **somente se** as três condições valerem:
     - o `mousedown` começou em `input`, `textarea`, `select`, `[contenteditable]` ou em texto que ficou selecionado;
     - o alvo do `click` é diferente do alvo do `mousedown`;
     - o alvo do `click` **contém** o alvo do `mousedown`.
   - Não cancelar qualquer clique em ancestral, porque isso quebraria cliques normais em botões que têm um `<span>` dentro.
2. **Tirar o fechamento por clique no fundo** dos modais de **token** e de **criar/editar transação/provisão/preço**, deixando só os botões Fechar e Esc (ver D12). O Esc já fecha no conciliacao (`detalhe_blocos.js:1030`).
3. **`shell.html` é outro documento** (as páginas rodam dentro de iframe). Precisa carregar a guarda também.

**Critérios de aceite**
- Arrastar para selecionar texto num campo e soltar em cima do fundo **não** fecha nenhum modal.
- Clique simples no fundo continua fechando os modais que devem fechar.
- Botões com ícone ou `<span>` interno continuam respondendo ao clique.

**Teste manual:** em cada modal listado, arrastar do meio do campo até o fundo escuro. Depois clicar no fundo. Depois apertar Esc.

**Esforço:** P por projeto.

---

### TRV-03: campo token começa vazio

**Pedido (swat):** "Campo Token não deve começar preenchido".

**Causa:** o código nunca preenche o campo. O que acontece é o seguinte:
- `Token.close()` só esconde o modal. O input é limpo **apenas depois de salvar com sucesso** (swat `shell.html:447-466`; conciliacao `shell.html:296`). Uma colagem que falhou e foi fechada volta a aparecer na próxima abertura.
- O input é `type="password"` sem `autocomplete` (swat `shell.html:216`), então o gerenciador de senhas do navegador pode preenchê-lo.

**O que fazer**
- Limpar o input no `open()` e no `close()`.
- Acrescentar `autocomplete="new-password" data-lpignore="true" data-1p-ignore spellcheck="false"`.
- Aplicar o mesmo nos modais de token avulsos do swat (`beehus_console.html`, `controlpanel.html:6515-6572`, `correcoes.html`) e no `shell.html` do conciliacao, que é idêntico.
- O CC já recria o modal a cada abertura e não precisa mudar.

**Aceite:** abrir o modal sempre mostra o campo vazio, inclusive depois de uma colagem que falhou e depois de salvar.

**Esforço:** P.

---

## 6. Achados fora do pedido (não fazer sem aval do usuário)

| # | Projeto | Achado | Sugestão |
|---|---|---|---|
| A1 | conciliacao | `beehus_api/client.py:28` ainda usa o host antigo `controladoria.beehus.com.br`. O swat e o CC usam `api.controladoria.beehus.com.br`. | Confirmar se há timeouts. Se houver, alinhar o host (P). |
| A2 | CC × conciliacao/swat | Os três gravam o **mesmo** `~/.swat/beehus.token`, mas em formatos incompatíveis: o CC grava `{"sessions":{…}}` e os outros gravam `{"token","set_at"}`. Depois de um restart, um app descarta o token do outro. Isso também atrapalha o teste do TRV-01. | Separar os arquivos (ex.: `~/.swat/beehus_cc.token`) ou fazer o CC ler o formato antigo (P). **Feito 27/09 no CC (branch `onda-6/achados-2026-09`, só local):** o CC grava só em `~/.swat/beehus_cc.token`; o `beehus.token` fica para swat e conciliacao (mesmo formato entre eles, não mudaram). Migração: sem o arquivo próprio, o CC lê 1 vez as sessões do arquivo antigo quando ele está no formato do CC — nunca grava nele. 9 checagens com HOME isolado (os 3 apps reiniciando e cada um recuperando o seu token). |
| A3 | todos | O cliente trata **403** como token rejeitado. | Ver o passo 3 do backend no TRV-01. |
| A4 | swat | O `iniciar.bat` faz `git pull` a cada início. | Avisar quem trabalha em branch de feature, ou tirar o pull do .bat. **Feito 27/09 no swat (branch `onda-6/achados-2026-09`, só local):** o pull continua (é a atualização automática de quem roda da branch do time), mas só em `development`/`main`, com a árvore sem mudanças rastreadas e `--ff-only` (nunca cria merge nem conflito); em branch de feature, com mudança local ou branch divergente, avisa e sobe o servidor sem puxar. 6 checagens rodando o `.bat` com `cmd` em repositórios git temporários. |
| A5 | swat | `filter_grouping_return_deltas` diz usar a "pior carteira", mas usa o documento do agrupamento. | Está incluído no SWAT-05. |
| A7 | todos | (27/09) Sem token ou com token **inválido/vencido**, o host novo responde **429** `{"userType":"default","maxRequests":20,"windowSizeMinutes":1,"retryAfterSeconds":60}` quando esse balde anônimo (20/min, compartilhado) esgota — em vez de 401. O `retryAfterSeconds` vem no CORPO, sem header `Retry-After`. Efeitos: (1) o TRV-01 detecta token vencido por 401, então um token vencido que tome 429 não abre o pop-up; (2) o retry de 429 do cliente faz a validação de um token inválido levar ~60 s em "Validando token..." (visto no teste do TRV-01 no CC). O host antigo devolve 401 na hora. | Decidir: tratar 429 com `userType: "default"` como token ausente/rejeitado (sem retry) nos 3 clientes, e/ou ler `retryAfterSeconds` do corpo; pedir ao time Beehus 401 antes do rate limit (P–M). **Feito 27/09 (decisão do usuário: "trate o 429 limite excedido como token rejeitado"; branch `onda-6/achados-2026-09`, só local):** nos 3 clientes (`beehus_api/client.py`), `_e_limite_anonimo()` reconhece o 429 com `userType: "default"` e o trata como token rejeitado (marca `rejected`, `BeehusAuthError`, sem retry) em `request()` e `request_multipart()`. **Só esse 429**: o 429 de token válido (rate limit real, comum no Atualizar do CC) segue com o retry de sempre — tratar todo 429 como token vencido abriria o pop-up no meio de um Atualizar. Suposição não medida (medir exigiria esgotar a cota do token de verdade): o 429 de token válido não vem com `userType: "default"`. Verificado: 15 checagens contra um servidor falso (anônimo = rejeitado em < 1 s e 1 chamada só; válido e HTML = retry; 401 igual) e o teste do TRV-01 no CC contra a API real — validação do token inválido caiu de ~60 s para 0,1 s. |
