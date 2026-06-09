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

' Comprueba que Node.js esté instalado (único requisito externo). Si falta,
' intenta instalarlo automáticamente con winget; si no se puede, abre la
' página de descarga. Así no falla en silencio en un ordenador nuevo.
If sh.Run("cmd /c where node", 0, True) <> 0 Then
  ' ¿Está winget disponible? (viene de serie en Windows 11)
  If sh.Run("cmd /c where winget", 0, True) = 0 Then
    If MsgBox("Node.js no está instalado (es necesario para la app)." & vbCrLf & vbCrLf & _
              "¿Instalarlo automáticamente ahora?" & vbCrLf & _
              "(Requiere internet y aceptar el aviso de permisos de Windows.)", _
              vbYesNo + vbQuestion, "BDI · Notes de Frais") = vbYes Then
      ' Ventana visible para ver el progreso; espera a que termine.
      sh.Run "cmd /c winget install --id OpenJS.NodeJS.LTS -e " & _
             "--accept-source-agreements --accept-package-agreements & pause", 1, True
      MsgBox "Instalación terminada." & vbCrLf & vbCrLf & _
             "Vuelve a ejecutar Start.bat para abrir la app.", _
             vbInformation, "BDI · Notes de Frais"
      WScript.Quit
    End If
  End If
  ' Sin winget, o el usuario prefiere hacerlo a mano:
  MsgBox "Instala Node.js (versión 20 o superior) desde https://nodejs.org/" & vbCrLf & _
         "y vuelve a ejecutar Start.bat." & vbCrLf & vbCrLf & _
         "Se abrirá la página de descarga.", vbExclamation, "BDI · Notes de Frais"
  sh.Run "https://nodejs.org/"
  WScript.Quit
End If

' Instala las dependencias la primera vez (oculto, esperando a que termine).
If Not fso.FolderExists(base & "\node_modules") Then
  sh.Run "cmd /c npm install", 0, True
End If

' Arranca el servidor oculto (ventana 0 = invisible; no espera).
sh.Run "cmd /c node src\server.js", 0, False

' Abre el navegador en la app tras un breve margen.
WScript.Sleep 1800
sh.Run "http://localhost:4317"
