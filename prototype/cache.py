# -*- coding: utf-8 -*-
"""
cache.py — cache em memória do processo Flask, por data e por TTL.
=====================================================================
Tarefa 3 do refactor de 2026-07-20: o pedido do desenvolvedor foi reduzir ao
MÁXIMO as idas repetidas ao Mongo de produção quando o usuário aumenta a
janela do grid ou clica "Atualizar" várias vezes seguidas.

Duas estruturas de cache, cada uma para um problema diferente:

1) `CachePorData` — cacheia os documentos da esteira (unprocessed/processed/
   navPackages/issues/navPackages-grouping) POR positionDate. Isso é o que
   permite: usuário pede 5du, depois amplia para 15du -> só as 10 datas NOVAS
   são buscadas no Mongo; as 5 já vistas nesta sessão vêm do cache. Clicar
   "Atualizar" de novo sem mudar a janela -> ZERO queries novas (100% cache).

   [REVISADO 2026-07-27, pedido do usuário — "veja uma solução robusta e
   definitiva": uma carteira recebeu Unprocessed NOVO no Mongo pra uma data
   já cacheada (5 dias atrás) e a tela nunca mostrou, mesmo depois de
   "Atualizar"] Primeira tentativa foi TTL (120s) nesta classe — o usuário
   pediu pra reverter: "não quero atualização a cada 120s, desejo que quando
   eu clicar em atualizar, realmente atualize tudo". Solução final: o cache
   continua sem expiração por tempo (mesma promessa de sempre — zero queries
   repetidas dentro da mesma sessão), mas ganhou `invalidar_datas()` — a
   rota `/api/atualizar` (app.py) chama isso ANTES de buscar, forçando as
   datas pedidas a serem tratadas como "nunca vistas" e buscadas de novo no
   Mongo, garantindo que um clique no botão sempre traga o dado mais
   recente, de forma determinística (não depende de quanto tempo passou).

2) `CacheTTL` — cache simples com expiração por tempo, para dados que NÃO
   dependem da janela de datas (coleções pequenas companies/entities/wallets/
   groupings, e o agregado de "últimas datas" por carteira) — mesmo padrão
   documentado em PLANNING.md §Estratégia de Otimização de Acesso ao Banco
   ("Cache TTL... 120s").

Trade-off ASSUMIDO (documentado also no README/CLAUDE.md): o cache vive só
em memória do processo (`python app.py`) — reiniciar o servidor limpa tudo e
a próxima consulta paga o custo cheio de novo. Optou-se por isso (em vez de
um arquivo `data/.cache_snapshot.json`) porque:
  - é um app local de 1 usuário por vez (não precisa sobreviver a restart
    nem ser compartilhado entre processos/máquinas);
  - evita problemas de escrita concorrente em arquivo (o mesmo cuidado que
    o projeto já toma com data/alert_comments.json, aqui multiplicado por
    cada requisição);
  - é reiniciado raramente (o servidor fica de pé o dia inteiro).
Se um dia isso precisar sobreviver a restarts, a troca é directa: mesma
interface (`obter`/`guardar`), troca-se o dict em memória por um arquivo
JSON — mas fica FORA de escopo desta tarefa (ver CLAUDE.md §7 — mudança de
padrão de persistência exigiria confirmar antes).
"""

import time


class CachePorData:
    """Contexto:
    Guarda, por positionDate (string "YYYY-MM-DD"), os documentos já
    buscados de cada coleção da esteira. Usado por db.py para nunca repetir
    uma consulta de uma data que esta sessão já buscou antes — mesmo que a
    janela pedida mude (amplie pra trás, ou o usuário clique "Atualizar" de
    novo) — SALVO quando `invalidar_datas()` é chamada antes (ver
    /api/atualizar, app.py). Pseudocódigo do uso típico (ver db.py):
      1. app.py calcula quais datas a tela pediu.
      2. `datas_faltantes(...)` devolve só as que este cache NÃO tem.
      3. db.py busca no Mongo só essas faltantes (1 query $in por coleção).
      4. `guardar(...)` grava o resultado por data.
      5. quem pediu monta o resultado final combinando cache + recém-buscado.
    """

    def __init__(self):
        # data -> {"unp": [...docs...], "pro": [...], "nav": [...],
        #          "issues": [...linhas de aggregate...], "nav_grouping": [...]}
        self._por_data = {}

    def datas_faltantes(self, datas_pedidas):
        """Contexto: dado um iterável de datas pedidas, devolve (ordenada)
        só as que ainda não estão no cache — essas é que vão gerar query
        real no Mongo.

        Pseudocódigo:
          1. Filtra as datas que não são chave do dict interno.
          2. Ordena (mantém as queries determinísticas/legíveis no log).
        """
        return sorted(d for d in datas_pedidas if d not in self._por_data)

    def guardar(self, data, unp, pro, nav, issues, nav_grouping):
        """Contexto: grava os documentos de UMA data específica no cache,
        chamada por db.py logo depois de buscar essa data no Mongo.
        Substitui qualquer entrada anterior dessa mesma data (idempotente —
        chamar de novo com o mesmo resultado não corrompe nada). Não retorna
        nada.

        Pseudocódigo:
          1. Grava os 5 conjuntos de documentos da data num dict só, keyed
             pela própria data.
        """
        self._por_data[data] = {
            "unp": unp, "pro": pro, "nav": nav,
            "issues": issues, "nav_grouping": nav_grouping,
        }

    def obter(self, data):
        """Contexto: devolve o dict cacheado de uma data (ou None se ainda
        não foi buscada nesta sessão) — chamada por db.py ao montar os mapas
        finais para todas as datas pedidas.

        Pseudocódigo:
          1. Busca a data no dict interno; devolve None se ausente.
        """
        return self._por_data.get(data)

    def invalidar_datas(self, datas):
        """Contexto:
        Remove do cache as datas informadas — chamada pela rota
        /api/atualizar (app.py) ANTES de buscar, garantindo que um clique
        no botão "Atualizar" sempre force uma consulta nova ao Mongo pras
        datas pedidas (nunca serve dado potencialmente desatualizado do
        cache) [2026-07-27, pedido do usuário: "não quero atualização a
        cada 120s, desejo que quando eu clicar em atualizar, realmente
        atualize tudo"]. Não afeta datas fora da lista (o resto da sessão
        continua cacheado normalmente). Não retorna nada.

        Pseudocódigo:
          1. Remove cada data do dict interno, se presente (ignora as que
             nunca foram cacheadas)."""
        for d in datas:
            self._por_data.pop(d, None)

    def datas_em_cache(self):
        """Contexto: nº de datas já cacheadas nesta sessão do processo —
        usado só para reportar ao usuário quanto o cache economizou (mensagem
        no botão Atualizar, ver static/js/controle_cargas/atualizar.js).
        Retorna int.

        Pseudocódigo:
          1. Conta as chaves do dict interno.
        """
        return len(self._por_data)


class CacheTTL:
    """Contexto:
    Cache simples chave->valor com expiração por tempo (segundos) — para
    dados que não dependem da janela pedida (coleções pequenas, agregados
    globais). Mesmo padrão já documentado em PLANNING.md (TTL 120s para
    companies/entities/wallets/groupings). Usado por db.py.

    Pseudocódigo (uso típico, ver db.py):
      1. Quem precisa do dado chama `obter(chave)` primeiro.
      2. Se vier None (nunca guardado, ou TTL vencido), recalcula/rebusca e
         chama `guardar(chave, valor)`.
      3. Se vier um valor, usa direto — zero custo de recálculo.
    """

    def __init__(self, ttl_segundos=120):
        self._ttl = ttl_segundos
        self._valores = {}   # chave -> (valor, guardado_em_monotonic)

    def obter(self, chave):
        """Contexto: devolve o valor cacheado de `chave` se ainda dentro do
        TTL, chamada por db.py antes de qualquer query cacheável por TTL.
        Retorna o valor guardado ou None (ausente ou expirado).

        Pseudocódigo:
          1. Se a chave nunca foi guardada, devolve None.
          2. Se já passou do TTL desde que foi guardada, devolve None
             (expirado — força quem chamou a recalcular).
          3. Senão, devolve o valor guardado.
        """
        item = self._valores.get(chave)
        if item is None:
            return None
        valor, guardado_em = item
        if time.monotonic() - guardado_em > self._ttl:
            return None
        return valor

    def guardar(self, chave, valor):
        """Contexto: grava/substitui o valor de `chave`, reiniciando a
        contagem do TTL — chamada por db.py logo depois de recalcular um
        valor que veio None de obter(). Não retorna nada.

        Pseudocódigo:
          1. Grava (valor, agora) na chave, sobrescrevendo o que houver.
        """
        self._valores[chave] = (valor, time.monotonic())


# instâncias únicas do processo — importadas por db.py/app.py (nunca criar
# uma instância nova por request, isso zeraria o cache a cada chamada).
cache_esteira_por_data = CachePorData()
cache_ttl_colecoes = CacheTTL(ttl_segundos=120)
