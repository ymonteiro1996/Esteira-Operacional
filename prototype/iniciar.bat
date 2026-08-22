@echo off
title Beehus - Controle de Cargas
cd /d "%~dp0"

echo Iniciando servidor...
powershell -ExecutionPolicy Bypass -File "%~dp0start.ps1"
