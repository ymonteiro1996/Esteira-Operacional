# ControleCargas launcher: sobe o Flask (app.py), espera o snapshot inicial
# terminar de carregar (boot consulta a API Beehus antes do servidor aceitar
# conexões, ver atualizar_snapshot_no_boot() em app.py) e abre o navegador.
# [2026-08-05, pedido do usuário: "pode remover toda consulta do mongo"] O
# acesso direto ao Mongo (e a checagem de SWAT_CONTROLE_CARGAS_MONGO_URI que
# existia aqui) foi removido — a conexão agora é o token da API Beehus,
# colado direto na tela (botão "🔑 Beehus API"), nunca via variável de
# ambiente/setx.
# [2026-07-25, pedido do usuário: "conseguimos deixar a inicialização igual
# esse modelo? Via botão mesmo rodando no local?"] Mesmo padrão do
# start.ps1 do standalone Conciliação (Projeto - Servidor\conciliacao).
# Rode isto (ou dê 2 cliques em iniciar.bat) em vez de `python app.py` direto.
#
# Porta fixa em 5050 [2026-07-25, pedido do usuário: "não precisa criar
# várias portas, pode manter a 5050 só para Controle de Cargas"] — outros
# projetos SWAT (ex.: Conciliação, porta 5001) já coexistem sem conflito por
# usarem portas fixas diferentes; não há necessidade de parametrizar a porta
# aqui.

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $scriptDir

$port = 5050

# Encerra qualquer app.py preso na $port — sem isso, um processo anterior
# (zombie) segue respondendo com código/dado antigo e o novo falha
# silenciosamente ao dar bind, dando a falsa impressão de que reiniciou
# (mesmo problema já visto manualmente várias vezes nesta sessão de
# desenvolvimento: processos zombies segurando lock do TemplateCarteiras.xlsx).
$existing = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($existing) {
    Write-Host "[ControleCargas] Encerrando instância anterior (PID $($existing.OwningProcess))..."
    Stop-Process -Id $existing.OwningProcess -Force -ErrorAction SilentlyContinue
    for ($i = 0; $i -lt 20; $i++) {
        if (-not (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) { break }
        Start-Sleep -Milliseconds 250
    }
}

# stdout/stderr capturados em arquivo — um crash em tempo de import (ex.:
# dependência faltando) fica visível em vez de a janela oculta sumir sem
# pista nenhuma.
$outLog = Join-Path $scriptDir ".controlecargas-server.out"
$errLog = Join-Path $scriptDir ".controlecargas-server.err"
Remove-Item -Path $outLog, $errLog -ErrorAction SilentlyContinue

Write-Host "[ControleCargas] Iniciando servidor em http://127.0.0.1:$port ..."
Write-Host "[ControleCargas] Boot lê o TemplateCarteiras.xlsx + consulta a API Beehus antes de responder — pode levar ~30-90s (sem token válido colado ainda, o boot segue com o snapshot.json existente e o modal de token abre na tela)."
$proc = Start-Process -FilePath "python" -ArgumentList "app.py" -PassThru `
    -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog

try {
    # Espera até 240s pelo healthcheck (/api/janela-padrao — não toca a API,
    # só confirma que o Flask já está de pé; o boot pesado roda ANTES do
    # app.run(), então a 1ª resposta só chega depois do snapshot inicial
    # pronto) — desiste cedo se o Python já encerrou (crash de import etc.).
    # [2026-08-05, migração API Beehus] Teto SUBIU de 90s pra 240s — o boot
    # agora faz chamadas HTTP reais por empresa/data em vez de 1 query Mongo
    # batch; medido ~90s pra janela default (6 du) num teste a frio.
    $ready = $false
    for ($i = 0; $i -lt 480; $i++) {
        Start-Sleep -Milliseconds 500
        if ($proc.HasExited) { break }
        try {
            $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/janela-padrao" -UseBasicParsing -TimeoutSec 2
            if ($r.StatusCode -eq 200) { $ready = $true; break }
        } catch {}
    }
    if (-not $ready) {
        if ($proc.HasExited) {
            Write-Host "[ControleCargas] Python encerrou (exit $($proc.ExitCode)) durante o boot." -ForegroundColor Red
        } else {
            Write-Host "[ControleCargas] Servidor não respondeu em 240s." -ForegroundColor Red
        }
        if (Test-Path $errLog) {
            $errTail = Get-Content -Path $errLog -Tail 40 -ErrorAction SilentlyContinue
            if ($errTail) {
                Write-Host "--- últimas linhas de $errLog ---" -ForegroundColor Yellow
                $errTail | ForEach-Object { Write-Host $_ }
            }
        }
        Read-Host "Pressione Enter para fechar"
        exit 1
    }

    Write-Host "[ControleCargas] Abrindo navegador..."
    Start-Process "http://127.0.0.1:$port/"

    Write-Host "[ControleCargas] Servidor rodando. Feche esta janela para encerrar."
    Wait-Process -Id $proc.Id
} finally {
    if ($proc -and -not $proc.HasExited) {
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    }
}
