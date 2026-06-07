@echo off
REM ============================================================
REM  Diagnostico.bat — Arranca la app CON ventana visible para
REM  ver mensajes y errores (Node, npm install, servidor).
REM  Para el uso normal, usa "Iniciar.bat" o "Iniciar.vbs".
REM ============================================================
cd /d "%~dp0"
title BDI - Notes de Frais (diagnostico)

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [ERROR] Node.js no esta instalado.
  echo  Instalalo desde https://nodejs.org/ y vuelve a ejecutar este archivo.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo.
  echo  Instalando dependencias por primera vez ^(puede tardar un minuto^)...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo  [ERROR] Fallo la instalacion de dependencias.
    pause
    exit /b 1
  )
)

if not exist ".env" (
  echo.
  echo  [AVISO] No existe el archivo .env con tu clave de API.
  echo  Copia ".env.example" como ".env" y rellena ANTHROPIC_API_KEY.
  echo.
)

start "" /b cmd /c "timeout /t 2 >nul & start http://localhost:4317"
node servidor.js

pause
