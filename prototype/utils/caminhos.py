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
