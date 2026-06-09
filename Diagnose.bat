@echo off
REM ============================================================
REM  Diagnose.bat — Arranca la app CON ventana visible para
REM  ver mensajes y errores (Node, npm install, servidor).
REM  Para el uso normal, usa "Start.bat".
REM ============================================================
cd /d "%~dp0"
title BDI - Notes de Frais (diagnose)

where node >nul 2>nul
if not errorlevel 1 goto NODE_OK
echo.
echo  [ERROR] Node.js no esta instalado.
where winget >nul 2>nul
if errorlevel 1 goto NODE_MANUAL
echo  Se puede instalar automaticamente con winget.
set /p RESP="  Instalar Node.js ahora? (S/N): "
if /i not "%RESP%"=="S" goto NODE_MANUAL
winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
echo.
echo  Instalacion terminada. Cierra esta ventana y vuelve a ejecutar Diagnose.bat.
pause
exit /b 0
:NODE_MANUAL
echo  Instalalo desde https://nodejs.org/ ^(version 20 o superior^) y vuelve a ejecutar.
echo.
pause
exit /b 1
:NODE_OK

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
node src\server.js

pause
