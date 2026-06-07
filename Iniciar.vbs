' ============================================================
'  Iniciar.vbs — Arranca la app SIN ventana de terminal.
'  Doble clic aquí. El servidor corre oculto y se apaga solo
'  cuando cierras la pestaña del navegador.
'  (Si algo falla, usa "Iniciar.bat" para ver los mensajes.)
' ============================================================
Option Explicit
Dim sh, fso, base
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = base

' Instala las dependencias la primera vez (oculto, esperando a que termine).
If Not fso.FolderExists(base & "\node_modules") Then
  sh.Run "cmd /c npm install", 0, True
End If

' Arranca el servidor oculto (ventana 0 = invisible; no espera).
sh.Run "cmd /c node servidor.js", 0, False

' Abre el navegador en la app tras un breve margen.
WScript.Sleep 1800
sh.Run "http://localhost:4317"
