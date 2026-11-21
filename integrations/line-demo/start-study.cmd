@rem Tam - RalphLAB timed study LINE demo
@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22 or newer, then open this file again.
  pause
  exit /b 1
)
echo Tam - RalphLAB timed study. Stop the old start.cmd server and keep the tunnel open.
set "PORT=8787"
set "LOCAL_STUDY_PAIRING=1"
set "LINE_USER_ID="
set "HOST=127.0.0.1"
set "RALPHLAB_SITE_URL=https://ralphlab-workbench.surawit2003it.chatgpt.site"
powershell.exe -NoProfile -Command "$ErrorActionPreference='Stop'; function ReadPrivate($label) { $s=Read-Host $label -AsSecureString; return ([System.Net.NetworkCredential]::new('', $s)).Password }; $env:RALPHLAB_STUDY_URL=(Read-Host 'Paste the open timed study URL including ?id=').Trim(); $env:RALPHLAB_STUDY_KEY=ReadPrivate 'Study pairing key'; $env:RALPHLAB_SITES_TOKEN=ReadPrivate 'Site service token (press Enter for a public Site)'; $env:LINE_CHANNEL_SECRET=ReadPrivate 'LINE channel secret'; $env:LINE_CHANNEL_ACCESS_TOKEN=ReadPrivate 'LINE channel access token'; node ../timed-studies/integrations/timed-line.mjs; exit $LASTEXITCODE"
if errorlevel 1 pause
