@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 20 or newer, then open this file again.
  pause
  exit /b 1
)
echo Tam - RalphLAB LINE demo. Paste each value into its hidden prompt and press Enter.
powershell.exe -NoProfile -Command "$ErrorActionPreference='Stop'; function ReadPrivate($label) { $s = Read-Host $label -AsSecureString; return ([System.Net.NetworkCredential]::new('', $s)).Password }; $env:LINE_CHANNEL_SECRET = ReadPrivate 'New channel secret'; $env:LINE_CHANNEL_ACCESS_TOKEN = ReadPrivate 'Channel access token'; $env:PORT='8787'; node ./server.mjs; exit $LASTEXITCODE"
if errorlevel 1 pause
