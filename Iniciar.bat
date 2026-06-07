@echo off
REM ============================================================
REM  Iniciar.bat — Arranca la app SIN ventana persistente.
REM  Delega en Iniciar.vbs (que corre el servidor oculto) y
REM  se cierra al instante. Si quieres ver los mensajes/errores,
REM  usa "Diagnostico.bat".
REM ============================================================
start "" "%~dp0Iniciar.vbs"
exit
