@echo off
REM ============================================================
REM  Start.bat — Arranca la app SIN ventana persistente.
REM  Delega en src\Start.vbs (que corre el servidor oculto) y
REM  se cierra al instante. Si quieres ver los mensajes/errores,
REM  usa "Diagnose.bat".
REM ============================================================
start "" "%~dp0src\Start.vbs"
exit
