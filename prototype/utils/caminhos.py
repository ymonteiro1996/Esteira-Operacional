# -*- coding: utf-8 -*-
"""
utils/caminhos.py — resolução do diretório de dados compartilhado.

[2026-08-28, achado do usuário: "temos que funcionar com os caminhos
dinâmicos para o onedrive" — sem CONTROLECARGAS_DATA_DIR configurada, o
app quebrava porque cada módulo (app.py/build_snapshot.py) tinha seu
próprio fallback pra `data/` LOCAL do clone Git, nunca pro OneDrive
compartilhado onde o time realmente mantém TemplateCarteiras.xlsx +
alert_comments.json/wallet_annotations.json/etc.] Função única,
reaproveitada por app.py e build_snapshot.py (CLAUDE.md §5/6 — evita
duplicar a mesma regra de resolução em 2 arquivos, como já tinha
acontecido antes desta correção).
"""

import os
from pathlib import Path

# Estrutura fixa do OneDrive corporativo Beehus, a partir da pasta do
# usuário logado — mesmo padrão já usado por
# custodian_upload.py::CONTROLE_UPLOAD_XLSX para o ControleUpload.xlsx.
_CAMINHO_ONEDRIVE_DATA = (
    Path.home() / "Beehus Tecnologia Ltda"
    / "Beehus Tecnologia Ltda - Documentos"
    / "SWAT" / "ControleCargas" / "prototype" / "data"
)


def resolver_data_dir(raiz_projeto):
    """Contexto:
    Decide qual pasta usar como DATA_DIR (cadastro Excel + JSONs
    transacionais/config). Chamada uma vez no import de app.py e de
    build_snapshot.py. Retorna string com o caminho absoluto.

    Pseudocódigo:
      1. Se CONTROLECARGAS_DATA_DIR estiver configurada, usa ela (override
         explícito, pra quem tiver a pasta compartilhada em outro lugar).
      2. Senão, tenta o caminho dinâmico dentro do OneDrive corporativo
         (Path.home() + estrutura fixa de pastas) — só usa se a pasta
         realmente existir nesta máquina, pra não quebrar quem não tem
         esse OneDrive sincronizado (ex.: ambiente de teste).
      3. Se nenhum dos dois existir, cai no fallback antigo: `data/` ao
         lado do código (dentro do clone do projeto).
    """
    override = os.environ.get("CONTROLECARGAS_DATA_DIR")
    if override:
        return override
    if _CAMINHO_ONEDRIVE_DATA.is_dir():
        return str(_CAMINHO_ONEDRIVE_DATA)
    return os.path.join(raiz_projeto, "data")


def diagnosticar_data_dir(raiz_projeto):
    """Contexto:
    Explica, em uma frase, DE ONDE veio o DATA_DIR que resolver_data_dir()
    escolheu e se essa origem é a pasta COMPARTILHADA do time ou uma cópia
    local isolada. Chamada no boot por app.py e build_snapshot.py só pra
    imprimir. Retorna (caminho, mensagem) — a mensagem já vem pronta para
    print(), com "AVISO:" na frente quando o app caiu na pasta local.

    [2026-09-21, achado do usuário: "não está aparecendo os comentários do
    dia para um colega de time"] O fallback da etapa 3 de resolver_data_dir()
    era SILENCIOSO: numa máquina sem o OneDrive corporativo sincronizado (ou
    com a biblioteca do SWAT em outro caminho), o app subia normalmente e
    passava a ler/gravar `prototype/data/` do próprio clone — uma ilha, sem
    os comentários, anotações e o TemplateCarteiras.xlsx do time. Pra quem
    estava do lado de fora, o sintoma era exatamente "os comentários não
    aparecem", sem nenhum erro na tela nem no log.

    Pseudocódigo:
      1. Resolve o caminho (mesma função de sempre — nenhuma regra nova).
      2. Identifica qual das 3 origens venceu: variável de ambiente, OneDrive
         corporativo ou fallback local.
      3. Monta a frase correspondente (a do fallback vira AVISO).
    """
    caminho = resolver_data_dir(raiz_projeto)
    if os.environ.get("CONTROLECARGAS_DATA_DIR"):
        return caminho, f"[ControleCargas] DATA_DIR (via CONTROLECARGAS_DATA_DIR): {caminho}"
    if _CAMINHO_ONEDRIVE_DATA.is_dir():
        return caminho, f"[ControleCargas] DATA_DIR (OneDrive compartilhado do time): {caminho}"
    return caminho, (
        f"AVISO: a pasta compartilhada do time NAO foi encontrada em {_CAMINHO_ONEDRIVE_DATA}.\n"
        f"       Usando a copia LOCAL {caminho} — comentarios, anotacoes e o\n"
        "       TemplateCarteiras.xlsx desta maquina ficam ISOLADOS do resto do time.\n"
        "       Sincronize a biblioteca 'Beehus Tecnologia Ltda - Documentos' no OneDrive\n"
        "       ou aponte a variavel de ambiente CONTROLECARGAS_DATA_DIR para a pasta certa."
    )
