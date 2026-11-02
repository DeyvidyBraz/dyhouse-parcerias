@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Instale o Node.js 20 ou mais recente e tente novamente.
  echo https://nodejs.org/
  pause
  exit /b 1
)
node server.mjs
pause
