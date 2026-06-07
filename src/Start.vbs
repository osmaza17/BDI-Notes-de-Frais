' ============================================================
'  Start.vbs — Arranca la app SIN ventana de terminal.
'  Vive en /src ; la raíz del proyecto es su carpeta padre.
'  El servidor corre oculto y se apaga solo al cerrar la
'  pestaña del navegador.
'  (Si algo falla, usa "Diagnose.bat" para ver los mensajes.)
' ============================================================
Option Explicit
Dim sh, fso, base
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
' raíz = carpeta padre de /src (donde están package.json, .env, node_modules)
base = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
sh.CurrentDirectory = base

' Instala las dependencias la primera vez (oculto, esperando a que termine).
If Not fso.FolderExists(base & "\node_modules") Then
  sh.Run "cmd /c npm install", 0, True
End If

' Arranca el servidor oculto (ventana 0 = invisible; no espera).
sh.Run "cmd /c node src\server.js", 0, False

' Abre el navegador en la app tras un breve margen.
WScript.Sleep 1800
sh.Run "http://localhost:4317"
