# BDI · Notes de Frais

Aplicación local para el **tesorero del Bureau de l'International (BDI)** de CentraleSupélec.
Automatiza la creación de las **Notes de Frais**: subes las pruebas de gasto de un evento
(facturas, tickets, *attestations sur l'honneur*), **Claude** las lee y extrae los datos, y la app
genera una Note de Frais **editable e idéntica al modelo oficial del BDI**. El entregable final es un
**único PDF** que une la Note de Frais con todas las pruebas adjuntas, listo para enviar.

Todo corre en tu ordenador. Las facturas, las firmas y tu clave de API nunca salen de esta carpeta.

---

## Requisitos

- [Node.js](https://nodejs.org/) 20 o superior.
- Una clave de API de **Anthropic** → https://console.anthropic.com/settings/keys

## Instalación (una sola vez)

1. Copia `.env.example` y renómbralo a `.env`.
2. Pega tu clave: `ANTHROPIC_API_KEY=...tu_clave...`
3. Guarda.

## Uso

- **Windows:** doble clic en **`Iniciar.vbs`** (o `Iniciar.bat`). Arranca el servidor **sin ventana de
  terminal** y abre el navegador; la primera vez instala las dependencias solo. Si algo falla y quieres
  ver los mensajes, usa **`Diagnostico.bat`**.
- **Manual / otros sistemas:** `npm install` y `npm start`, luego abre http://localhost:4317.

> El servidor **se apaga solo al cerrar la ventana** del navegador (no por inactividad). Un F5 no lo apaga.
> Si editas el `.env`, cierra y reabre. Tras actualizar la app, recarga con **Ctrl+F5**.

---

## Cómo funciona

El **idioma** (FR/ES/EN) se elige con el desplegable junto a « Thème ». La interfaz se traduce; la
Note de Frais permanece en francés (documento oficial). Cada pestaña tiene un botón **« How to use »**.

1. **Événements** (inicio) — los eventos aparecen **agrupados por año**; el **color** de la tarjeta
   indica su estado y un distintivo si está **pagado**. Hay **buscador** y **filtro por estado**. Pulsa
   el botón **« + »** (abajo a la derecha) para crear uno: nombre, **section (pôle)**, fecha, **miembro**
   (apellido en MAYÚSCULAS), **presupuesto máximo asignado por el BDI** e **IBAN del abonado** (opcional).
2. **Documents** — arrastra las facturas/tickets/attestations **sobre la zona de tarjetas** (o con
   « + Ajouter des documents »). El **análisis se lanza automáticamente**: Claude lee, transcribe y
   rellena la nota. Cada tarjeta: **Voir** (ventana), **Ouvrir** (pestaña), nombre editable. Si subes
   un documento **idéntico** a otro ya presente, se ignora (aviso de duplicado).
3. **Analyse** — revisa lo que Claude ha leído: documento original a un lado, **texto transcrito
   (editable)** al otro. Corrige y pulsa **« Régénérer la note »**. Las flechas ←/→ navegan entre documentos.
4. **Note de Frais** — formulario editable (**autoguardado**, totales automáticos, importes siempre en
   **euros**, coma decimal). El **fondo de color** de cada línea indica la confianza de la IA. Si la
   tabla crece, pasa a **varias páginas A4**. Incluye el **IBAN del abonado** (obligatorio antes de
   generar el PDF). Botones **firma del tesorero** y **firma del miembro**. Define el **orden de los
   adjuntos** arrastrando las tarjetas. Si algún documento **no se usa** en ninguna línea, aparece un
   aviso. Arriba: **estado** del evento, botón **pagado/no pagado** y **presupuesto restante**. Exporta
   a **Excel** o genera el **PDF final**.

### El PDF final

**« Générer le PDF »** (o Ctrl+P) crea un **único PDF** = la Note de Frais + todos los documentos
adjuntos en el orden elegido. Se abre en una ventana y se guarda en la carpeta del evento.

---

## Pipeline técnico

```
Documentos (PDF/JPG/PNG) ─► Claude (Anthropic), lectura directa
        ├─ transcripción (editable)  → Analyse
        └─ líneas + confianza (JSON) → Note de Frais
   ─► PDF final = NDF rasterizada (html2canvas) + adjuntos (pdf-lib)
```

Una sola API (Claude). El documento se envía directamente al modelo (visión / *document input*),
sin OCR externo. **Modelo por defecto:** `claude-haiku-4-5` (cambiable en `.env`).

---

## Estructura del proyecto

```
NotesDeFraisBDI/
├── Iniciar.vbs            ← arranca SIN ventana de terminal
├── Iniciar.bat            ← igual (delega en el .vbs)
├── Diagnostico.bat        ← versión con ventana para ver errores
├── servidor.js            ← backend (Express + SDK Anthropic + pdf-lib)
├── package.json
├── .env.example           ← plantilla de la clave (copiar a .env)
├── .gitignore             ← excluye .env, Dossiers/ y Signatures/
├── CLAUDE.md · README.md
├── web/                   ← interfaz (vanilla JS, sin frameworks)
│   ├── index.html · estilos.css · app.js
│   ├── i18n.js            ← traducciones FR / ES / EN
│   └── logo-bdi.png
├── Signatures/            ← firmas (tesorero y miembros) — privado
└── Dossiers/              ← un subdirectorio por evento
     └── <evento>/
          ├── evento.json   ← ÚNICO fichero: meta + transcripciones + datos NDF
          ├── Documents/    ← ficheros aportados
          └── _backups/     ← copias de seguridad automáticas de evento.json
```

> **Portabilidad garantizada:** mientras la app esté en una carpeta con esta estructura, funciona en
> cualquier ordenador con Node ≥ 20: todas las rutas son relativas, no hay binarios nativos ni paso de
> build, y datos/secretos viven dentro de la carpeta. Basta copiarla y ejecutar `Iniciar.vbs`
> (o `npm install && npm start`).

---

## Decisiones de diseño

- **Portable y sin build.** Node + Express y JS vanilla; solo dependencias JS puras (`pdf-lib` para
  unir PDFs). `npm install` y a funcionar.
- **Motor local.** Las claves de API no pueden ir en el navegador (repo público + CORS); un servidor
  local las guarda en `.env`.
- **Un solo proveedor (Claude).** El documento va directo al modelo: menos piezas, una sola clave.
- **Un único JSON por evento** + ficheros en `Documents/` + copias en `_backups/` (seguridad).
- **PDF final concatenado.** El entregable real del tesorero: NDF + pruebas en un PDF, en su orden.
- **Análisis automático** al añadir/quitar documentos; **autoguardado** de todo; **confianza** por línea.
- **Estados y presupuesto.** Cada evento tiene estado (color en la tarjeta), marca de pagado y
  presupuesto; la NDF muestra el presupuesto restante.
- **Multi-idioma** (FR/ES/EN); la NDF se mantiene en francés.
- **Arranque sin terminal** + apagado al cerrar la ventana → se siente como un programa de escritorio.
- **PDF idéntico al modelo oficial** del BDI (barras, logo, colores, A4).

## Privacidad / repositorio público

`.gitignore` excluye `.env` (tu clave), `Dossiers/` (datos reales) y `Signatures/` (firmas), de modo
que puedes subir este repositorio a un sitio público sin filtrar nada sensible.

---

Développé par [Óscar Martínez Zamora](https://www.linkedin.com/in/oscarmartinezzamora/).
