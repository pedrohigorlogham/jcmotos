@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Preparando o site pela primeira vez...
  call npm install
  if errorlevel 1 (
    echo Nao foi possivel preparar o site. Verifique se o Node.js LTS esta instalado.
    pause
    exit /b 1
  )
)
start "" /b node server.js
timeout /t 2 /nobreak >nul
start "" http://localhost:3000
