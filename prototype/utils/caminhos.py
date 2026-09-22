# -*- coding: utf-8 -*-
"""
utils/caminhos.py — resolução do diretório de dados compartilhado.

[2026-08-28, achado do usuário: "temos que funcionar com os caminhos
dinâmicos para o onedrive" — sem CONTROLECARGAS_DATA_DIR configurada, o
app quebrava porque cada módulo (app.py/build_snapshot.py) tinha seu
próprio fallback pra `data/` LOCAL do clone Git, nunca pro OneDrive
compartilhado onde o time realmente mantém TemplateCarteiras.xlsx +
alert_comments.json/wallet_annotations.json/etc.] Função única,
reaproveitada por app.py, build_snapshot.py e os blueprints de pages/
(CLAUDE.md §5/6 — evita duplicar a mesma regra de resolução em 4 arquivos,
como já tinha acontecido antes desta correção).

[REVISADO 2026-09-22, relato do usuário: "um colega ainda não está
aparecendo o responsável e comentários, mesmo que são gravados e consumidos
em uma base na rede onedrive" — com o colega na MESMA data de referência
(16/09) que a máquina onde aparece] O caminho da pasta compartilhada era um
literal ÚNICO (`~/Beehus Tecnologia Ltda/Beehus Tecnologia Ltda - Documentos/
SWAT/...`). Esse literal é o nome que o OneDrive dá à biblioteca do
SharePoint NESTA máquina — em outra ele muda por motivos banais e
invisíveis pra quem usa: Windows/OneDrive em inglês sincroniza
"... - Documents" (sem o "o"), a pessoa pode ter a biblioteca no OneDrive
pessoal (`OneDrive - Beehus Tecnologia Ltda/SWAT/...`, um nível a menos) ou
ter renomeado a pasta local. Qualquer uma dessas variações fazia
`resolver_data_dir()` cair no `data/` do próprio clone — uma ILHA, com o
`wallet_annotations.json` vazio (num clone novo o .gitignore não traz esse
arquivo) — e o sintoma era exatamente "o responsável não aparece pra mim",
sem erro nenhum na tela. Agora, além do caminho canônico, há uma BUSCA por
variantes (ver `_procurar_data_dir_compartilhado`), e `descrever_data_dir()`
expõe o resultado pra tela mostrar de onde o dado está vindo (rodapé de
diagnóstico, GET /api/diagnostico-dados).
"""

import os
from pathlib import Path

# Caminho canônico desta máquina: estrutura fixa do OneDrive corporativo
# Beehus a partir da pasta do usuário logado — mesmo padrão já usado por
# custodian_upload.py::CONTROLE_UPLOAD_XLSX para o ControleUpload.xlsx.
# Continua sendo tentado PRIMEIRO (caminho feliz, sem varrer pasta nenhuma).
_CAMINHO_ONEDRIVE_DATA = (
    Path.home() / "Beehus Tecnologia Ltda"
    / "Beehus Tecnologia Ltda - Documentos"
    / "SWAT" / "ControleCargas" / "prototype" / "data"
)

# Trecho final, esse sim ESTÁVEL em qualquer máquina: o que muda de uma
# instalação do OneDrive pra outra é só a pasta-raiz da biblioteca.
_SUFIXO_BIBLIOTECA = Path("SWAT") / "ControleCargas" / "prototype" / "data"

# Como a biblioteca aparece nas máquinas do time: "Beehus..." (biblioteca do
# SharePoint sincronizada) ou "OneDrive - Beehus..." (OneDrive pessoal).
# Casado sem acento/maiúscula, cobrindo "- Documentos" e "- Documents".
_MARCA_PASTA_BIBLIOTECA = "beehus"

# Resultado memorizado: resolver_data_dir() é chamada no import de 4 módulos
# e descrever_data_dir() a cada carregamento da tela — a busca por variantes
# lista pastas em disco, não faz sentido repetir.
_CACHE_BUSCA = {}


def _bases_de_busca():
    """Contexto:
    Lista as pastas onde a biblioteca compartilhada do time pode ter sido
    sincronizada nesta máquina — insumo de _procurar_data_dir_compartilhado().
    Chamada só quando o caminho canônico não existe. Retorna lista de Path
    (sem repetição, só as que existem de verdade).

    Pseudocódigo:
      1. Começa pela pasta do usuário (onde o OneDrive cria as bibliotecas).
      2. Acrescenta as raízes apontadas por OneDrive/OneDriveCommercial e os
         PAIS delas — uma biblioteca do SharePoint fica ao LADO da pasta do
         OneDrive pessoal, não dentro dela.
      3. Descarta repetidas e as que não existem.
    """
    candidatas = [Path.home()]
    for variavel in ("OneDriveCommercial", "OneDrive"):
        valor = os.environ.get(variavel)
        if not valor:
            continue
        raiz = Path(valor)
        candidatas.extend([raiz, raiz.parent])

    bases, vistas = [], set()
    for base in candidatas:
        chave = str(base).casefold()
        if chave in vistas:
            continue
        vistas.add(chave)
        try:
            if base.is_dir():
                bases.append(base)
        except OSError:
            continue
    return bases


def _procurar_data_dir_compartilhado():
    """Contexto:
    Procura a pasta `data/` compartilhada do time quando o caminho canônico
    (_CAMINHO_ONEDRIVE_DATA) não existe nesta máquina — cobre as variações de
    nome que o OneDrive cria sozinho (idioma do Windows, biblioteca do
    SharePoint vs. OneDrive pessoal, pasta renomeada). Chamada por
    resolver_data_dir(). Retorna Path da pasta encontrada ou None.

    Varre no MÁXIMO 2 níveis abaixo de cada base, e só entra em pastas cujo
    nome tem "beehus" — é uma listagem curta de diretório, não uma varredura
    do disco (importante: pastas do OneDrive podem ser "só na nuvem", e
    percorrer tudo custaria download).

    Pseudocódigo:
      1. Para cada base (_bases_de_busca), lista as subpastas com "beehus" no
         nome.
      2. Para cada uma, testa <pasta>/SWAT/ControleCargas/prototype/data
         (caso "OneDrive - Beehus .../SWAT/...").
      3. Não achando, testa o mesmo sufixo 1 nível abaixo — caso
         "Beehus Tecnologia Ltda/Beehus ... - Documentos/SWAT/...", que é
         como a biblioteca do SharePoint aparece.
      4. Primeira que existir vence; nenhuma -> None.
    """
    for base in _bases_de_busca():
        try:
            pastas_beehus = [p for p in base.iterdir()
                             if p.is_dir() and _MARCA_PASTA_BIBLIOTECA in p.name.casefold()]
        except OSError:
            continue
        for pasta in pastas_beehus:
            direto = pasta / _SUFIXO_BIBLIOTECA
            if direto.is_dir():
                return direto
            try:
                subpastas = [p for p in pasta.iterdir() if p.is_dir()]
            except OSError:
                continue
            for subpasta in subpastas:
                aninhado = subpasta / _SUFIXO_BIBLIOTECA
                if aninhado.is_dir():
                    return aninhado
    return None


def descrever_data_dir(raiz_projeto):
    """Contexto:
    Resolve o DATA_DIR e diz DE ONDE ele veio — fonte única de verdade de
    resolver_data_dir(), diagnosticar_data_dir() e da rota
    GET /api/diagnostico-dados (rodapé de diagnóstico da tela, 2026-09-22).
    Retorna dict {caminho, origem, compartilhada, mensagem}, com `origem` em
    "variavel" | "onedrive" | "onedrive_variante" | "local" e
    `compartilhada` False só no caso "local" (a ilha).

    O resultado é memorizado por raiz_projeto: a busca por variantes lista
    pastas em disco e o valor não muda enquanto o processo vive.

    Pseudocódigo:
      1. Cache do processo -> devolve direto.
      2. CONTROLECARGAS_DATA_DIR configurada -> vence (override explícito,
         pra quem tem a pasta compartilhada em outro lugar).
      3. Caminho canônico do OneDrive corporativo existe -> vence.
      4. Busca variantes (_procurar_data_dir_compartilhado) -> vence.
      5. Nada disso -> `data/` ao lado do código, marcado como NÃO
         compartilhado e com a mensagem em formato de AVISO.
    """
    chave = str(raiz_projeto)
    if chave in _CACHE_BUSCA:
        return _CACHE_BUSCA[chave]

    override = os.environ.get("CONTROLECARGAS_DATA_DIR")
    if override:
        descricao = {
            "caminho": override, "origem": "variavel", "compartilhada": True,
            "mensagem": f"[ControleCargas] DATA_DIR (via CONTROLECARGAS_DATA_DIR): {override}",
        }
    elif _CAMINHO_ONEDRIVE_DATA.is_dir():
        caminho = str(_CAMINHO_ONEDRIVE_DATA)
        descricao = {
            "caminho": caminho, "origem": "onedrive", "compartilhada": True,
            "mensagem": f"[ControleCargas] DATA_DIR (OneDrive compartilhado do time): {caminho}",
        }
    else:
        encontrado = _procurar_data_dir_compartilhado()
        if encontrado is not None:
            caminho = str(encontrado)
            descricao = {
                "caminho": caminho, "origem": "onedrive_variante", "compartilhada": True,
                "mensagem": (f"[ControleCargas] DATA_DIR (OneDrive compartilhado do time, "
                             f"encontrado por busca — o caminho desta maquina nao e o padrao): {caminho}"),
            }
        else:
            caminho = os.path.join(raiz_projeto, "data")
            descricao = {
                "caminho": caminho, "origem": "local", "compartilhada": False,
                "mensagem": (
                    f"AVISO: a pasta compartilhada do time NAO foi encontrada "
                    f"(procurada em {_CAMINHO_ONEDRIVE_DATA} e nas variantes do OneDrive desta maquina).\n"
                    f"       Usando a copia LOCAL {caminho} — comentarios, anotacoes e o\n"
                    "       TemplateCarteiras.xlsx desta maquina ficam ISOLADOS do resto do time.\n"
                    "       Sincronize a biblioteca 'Beehus Tecnologia Ltda - Documentos' no OneDrive\n"
                    "       ou aponte a variavel de ambiente CONTROLECARGAS_DATA_DIR para a pasta certa."
                ),
            }

    _CACHE_BUSCA[chave] = descricao
    return descricao


def resolver_raiz_biblioteca(raiz_projeto):
    """Contexto:
    Devolve a pasta RAIZ da biblioteca compartilhada nesta máquina — aquela
    que contém `SWAT/` e `Cliente Beehus/` — derivada do DATA_DIR já
    resolvido. Existe pra outros arquivos que moram na MESMA biblioteca (hoje
    o `Cliente Beehus/ControleUpload.xlsx`, custodian_upload.py) não
    repetirem o literal do caminho do OneDrive, que é justamente o que quebra
    numa máquina com nome de pasta diferente [2026-09-22]. Retorna Path ou
    None (ilha local, ou CONTROLECARGAS_DATA_DIR apontando pra uma pasta fora
    dessa estrutura — nesses casos quem chama decide o próprio fallback).

    Pseudocódigo:
      1. Resolve o DATA_DIR (mesma função de sempre, memorizada).
      2. Não sendo a pasta compartilhada, devolve None.
      3. Confere que o caminho realmente termina em
         SWAT/ControleCargas/prototype/data e sobe esses 4 níveis.
    """
    descricao = descrever_data_dir(raiz_projeto)
    if not descricao["compartilhada"]:
        return None
    caminho = Path(descricao["caminho"])
    partes_sufixo = _SUFIXO_BIBLIOTECA.parts
    if [p.casefold() for p in caminho.parts[-len(partes_sufixo):]] != [p.casefold() for p in partes_sufixo]:
        return None
    return caminho.parents[len(partes_sufixo) - 1]


def resolver_data_dir(raiz_projeto):
    """Contexto:
    Decide qual pasta usar como DATA_DIR (cadastro Excel + JSONs
    transacionais/config). Chamada uma vez no import de app.py,
    build_snapshot.py e dos blueprints de pages/. Retorna string com o
    caminho absoluto. Wrapper fino de descrever_data_dir() (CLAUDE.md §3):
    a regra de resolução mora lá, aqui só sai o caminho.

    Pseudocódigo:
      1. Pede a descrição completa e devolve só o campo `caminho`.
    """
    return descrever_data_dir(raiz_projeto)["caminho"]


def diagnosticar_data_dir(raiz_projeto):
    """Contexto:
    Explica, em uma frase, DE ONDE veio o DATA_DIR — chamada no boot por
    app.py e build_snapshot.py só pra imprimir no log. Retorna
    (caminho, mensagem), com "AVISO:" na frente quando o app caiu na pasta
    local isolada.

    [2026-09-21, achado do usuário: "não está aparecendo os comentários do
    dia para um colega de time"] O fallback pra pasta local era SILENCIOSO:
    numa máquina sem o OneDrive corporativo sincronizado, o app subia normal
    e passava a ler/gravar `prototype/data/` do próprio clone, sem nenhum
    erro na tela nem no log. [REVISADO 2026-09-22] Esta mensagem continua
    indo só pro log (`.controlecargas-server.out`, janela oculta) — quem
    mostra o mesmo diagnóstico PRA PESSOA é o rodapé da tela, alimentado por
    GET /api/diagnostico-dados (app.py) a partir de descrever_data_dir().

    Pseudocódigo:
      1. Pede a descrição completa e devolve (caminho, mensagem) dela.
    """
    descricao = descrever_data_dir(raiz_projeto)
    return descricao["caminho"], descricao["mensagem"]
