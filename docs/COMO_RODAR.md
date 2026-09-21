# Como rodar o ControleCargas na sua máquina

> Para quem vai **usar** a ferramenta (não só desenvolver). Passo a passo completo,
> do `git pull` até a matriz na tela.

O app roda **local, na sua própria máquina**: o servidor sobe em
`http://127.0.0.1:5050` e só o seu navegador enxerga. Não existe servidor central —
o que é compartilhado entre o time são **os dados**, que ficam numa pasta do OneDrive
corporativo, e **o código**, que vem do Git.

---

## 1. Pegue a versão atual do código

```bash
git pull origin development
```

Faça isso **sempre que for começar o dia**. Boa parte dos problemas relatados
("não atualiza", "o token não entra", "os comentários do dia não aparecem") era
gente rodando uma cópia antiga do código.

> ⚠️ **Não rode o app a partir da pasta do OneDrive.** Existe uma cópia antiga do
> `prototype/` dentro de
> `Beehus Tecnologia Ltda - Documentos\SWAT\ControleCargas\`, de agosto/2026.
> Ela **não recebe correção nenhuma** — rode sempre do seu clone do Git. Da pasta
> do OneDrive o app usa só a subpasta `data/`, e é o próprio código que a encontra
> sozinho (ver item 3).

## 2. Suba o servidor

Dê **dois cliques em `prototype\iniciar.bat`**.

Ele instala as dependências que faltarem, sobe o Flask, espera o carregamento
inicial e abre o navegador sozinho. O primeiro boot demora (lê o cadastro e
consulta a API Beehus) — pode levar de 1 a 5 minutos.

Se preferir a linha de comando:

```bash
cd prototype
python -m pip install -r requirements.txt
python app.py
```

## 3. Confira de onde vêm os dados compartilhados

A **primeira linha do log de boot** diz qual pasta o app escolheu:

```
[ControleCargas] DATA_DIR (OneDrive compartilhado do time): C:\Users\<voce>\Beehus Tecnologia Ltda\...
```

É essa pasta que guarda o `TemplateCarteiras.xlsx`, os comentários, as anotações,
as demandas e as anomalias — **tudo que o time compartilha**.

Se no lugar disso aparecer um bloco começando com `AVISO: a pasta compartilhada do
time NAO foi encontrada`, pare: o app está funcionando numa **ilha**, e você não vai
ver os comentários nem as anotações de ninguém. Resolva assim:

1. Abra o OneDrive e garanta que a biblioteca **"Beehus Tecnologia Ltda - Documentos"**
   está sincronizada, com a pasta `SWAT\ControleCargas\prototype\data` baixada
   (não pode estar como "somente na nuvem" ☁️).
2. Se a sua pasta estiver em outro caminho, aponte a variável de ambiente:
   ```powershell
   setx CONTROLECARGAS_DATA_DIR "C:\caminho\completo\ate\a\pasta\data"
   ```
   Feche e reabra o terminal depois do `setx`.

## 4. Cole o token da API Beehus

Sem token o app **não carrega nada** — por isso o modal `🔑 Beehus API` abre sozinho.

O token é o Bearer do dia (a Beehus renova a cada 24h). Cole no campo e clique em
**Validar e salvar**.

- Pode colar **com o prefixo `Bearer`**, entre aspas, ou quebrado em várias linhas —
  o app limpa antes de usar.
- O campo é mascarado. Embaixo dele aparece **quantos caracteres foram colados** e se
  o formato parece um token; use isso para confirmar que o `Ctrl+V` pegou. O botão 👁
  mostra o conteúdo.
- **"Token rejeitado pela API (401/403)"** = o token está errado, incompleto ou é de
  ontem. Copie de novo, inteiro.
- **"Token salvo, mas a API não respondeu para validar"** = o token pode estar certo,
  quem não respondeu foi a Beehus. O modal fica aberto de propósito; tente de novo ou
  feche e use o botão **Atualizar**.

O token fica guardado por navegador e sobrevive a um restart do servidor. Ele **nunca**
vai para o OneDrive nem para o Git (mora em `~/.swat/beehus.token`).

## 5. Clique em Atualizar

O `Atualizar` é o que traz dado fresco da API e recalcula a matriz. Enquanto roda, o
botão mostra o progresso (`Atualizando… [3/6] ...`).

**Por que isso importa para os comentários:** a matriz sem um `Atualizar` bem-sucedido
pinta o último `snapshot.json` que existir em disco, que pode ser de semanas atrás.
A vigência dos comentários é calculada contra o **relógio da sua máquina** (corrigido
em 21/09/2026), então comentários do dia aparecem de qualquer jeito — mas os
**estados das células** continuam sendo os do snapshot velho até você atualizar.

---

## Trabalhando em várias pessoas ao mesmo tempo

Comentário com período de vigência, Responsável, comentário de atuação, demandas e
plano de ação das anomalias ficam **todos na pasta compartilhada do OneDrive** — são
os quatro arquivos `alert_comments.json`, `wallet_annotations.json`,
`controle_demandas.json` e `anomalias.json`. Não existe cópia sua: o que você salva
vai para o arquivo do time.

**O que acontece quando o colega salva algo:**

1. O OneDrive sincroniza o arquivo (segundos a minutos).
2. A sua tela consulta o servidor **a cada 60 segundos**, e também **sempre que você
   volta para a aba**.
3. Chegando novidade, aparece a faixa azul-esverdeada `↻ N comentário(s) novo(s)...`
   e a matriz se atualiza sozinha.

Se você estiver com um modal aberto ou digitando numa célula, a tela **não** se repinta
no meio da sua ação — a faixa mostra o botão **Aplicar** e você decide a hora.

**Suas edições não salvas nunca são apagadas** por essa atualização automática: o que
está no `Salvar (N)` continua valendo por cima do que chegou.

**O único caso que ainda perde:** duas pessoas editando a **mesma linha, na mesma data
de referência**, antes de o OneDrive sincronizar. Aí vale quem salvou por último. A tela
avisa quando isso está prestes a acontecer — a faixa acrescenta *"N linha(s) que você
editou e ainda não salvou também foram alteradas por outra pessoa"*. Se aparecer, vale
combinar no chat antes de salvar.

**Cópia de conflito do OneDrive** (`wallet_annotations-SUAMAQUINA.json` e afins): o app
detecta, incorpora o conteúdo e arquiva o arquivo em `data/_conflitos_resolvidos/`
sozinho — **nunca apague essas cópias na mão**, deixe o app processar.

## Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Comentários do dia não aparecem | Código antigo (anterior a 21/09/2026), ou pasta de dados isolada | `git pull` e conferir a 1ª linha do log (item 3) |
| "Token rejeitado pela API" colando o token certo | Token de ontem, ou copiado pela metade | Copiar o token do dia inteiro |
| Colo o token e a tela não muda | A API não respondeu para validar | O modal agora mostra o aviso — tente de novo |
| "Erro ao atualizar: Read timed out" / 429 | Código antigo, sem o freio de rate limit | `git pull` |
| A janela do servidor abre e fecha na hora | Dependência faltando | `iniciar.bat` já instala; se persistir, ver `.controlecargas-server.err` |
| Duas pessoas salvando ao mesmo tempo | — | Suportado: o app usa lock e mescla cópias de conflito do OneDrive |

## Onde fica cada coisa

| O quê | Onde |
|---|---|
| Código | seu clone do Git, branch `development` |
| Dados do time (comentários, anotações, cadastro) | OneDrive → `SWAT\ControleCargas\prototype\data` |
| Token da API | `~/.swat/beehus.token` (só sua máquina, nunca sincroniza) |
| `snapshot.json` | gerado local, não versionado |
| Log do servidor | `prototype\.controlecargas-server.err` / `.out` |
