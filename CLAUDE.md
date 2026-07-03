# CLAUDE.md

Guía para trabajar en este proyecto con Claude Code. Léela antes de hacer cambios.

## Qué es

App **local** para el tesorero del **Bureau de l'International (BDI)** de CentraleSupélec.
Automatiza la creación de las **Notes de Frais (NDF)**: el tesorero sube las pruebas de gasto de un
evento (facturas, tickets, attestations sur l'honneur), la IA las lee y extrae los datos, y la app
genera un formulario de NDF **editable** idéntico al modelo oficial del BDI. El entregable final es
un **único PDF** = la NDF + todas las pruebas adjuntas, listo para enviar.

Todo corre en la máquina del usuario. Las facturas, las firmas y la clave de API nunca salen de la
carpeta. El repositorio es **público**, así que nada sensible debe subirse (ver `.gitignore`).

> ⚠️ **Requisitos para que la app funcione en un ordenador** (los dos hay que instalarlos):
> 1. **Node.js 20 o superior** — sin él la app no arranca (los lanzadores de Windows ofrecen
>    instalarlo automáticamente con `winget`).
> 2. **Claude Code instalado y logueado** (`claude login`) — sin él no hay análisis de IA
>    (salvo que se active el respaldo a la API con clave en `.env`).

## Portabilidad (requisito)

La app debe seguir funcionando **copiando la carpeta a cualquier ordenador** con Node ≥ 20. Por eso:
- **Motor por defecto = Claude Code instalado en el ordenador** (no la API). El único requisito extra
  es tener **Claude Code instalado y logueado** (`claude login`); la app **autodetecta** el binario
  `claude` del PATH. Si se mueve la carpeta a un PC sin Claude Code, la app solo analiza si se activa
  el **respaldo a la API** en Réglages (`API_FALLBACK`); si no, muestra error claro.
- **Todas las rutas son relativas** (`path.join(__dirname, …)`), nunca absolutas. `src/server.js`
  calcula `RAIZ = path.join(__dirname, '..')` y carga el `.env` de la raíz con
  `dotenv.config({ path })` (independiente del cwd).
- Dependencias: solo paquetes **JS puros sin binarios** (`@anthropic-ai/sdk`, `express`, `dotenv`,
  `pdf-lib`). Se instalan con `npm install`; nada de bundlers ni pasos de build.
- Datos y secretos viven dentro de la carpeta (`data/`, `.env`).
- **No introducir rutas absolutas, binarios nativos, ni dependencias del SO.**

## Estructura de carpetas

```
raíz/
  Start.bat            ← arranca SIN terminal (delega en src/Start.vbs)
  Diagnose.bat         ← arranca CON ventana visible (para ver errores)
  README.md · CLAUDE.md · .env · .env.example
  .gitignore · package.json · package-lock.json · node_modules/   (deben quedarse en la raíz)
  src/
    server.js          ← backend (Express + pdf-lib; enruta IA a Claude Code o API)
    claudeCode.js      ← motor por DEFECTO: instancias headless `claude -p` (ventana invisible)
    Start.vbs          ← lanzador oculto (la raíz es su carpeta padre)
    web/               ← frontend (index.html, styles.css, app.js, i18n.js, logo-bdi.png)
  data/                ← datos en runtime (contenido gitignored)
    Cases/             ← un subfolder por evento (antes Dossiers/)
    Signatures/        ← firmas del tesorero
    people.json        ← base de personas con RIB (antes personnes.json)
```

> En la raíz solo viven `.bat`, `.md`, `.env`/`.env.example` y los ficheros que git/npm exigen ahí
> (`.gitignore`, `package.json`, `package-lock.json`, `node_modules/`). Todo lo demás está en `src/`
> (código) o `data/` (datos). Nombres de fichero **en inglés**.

## Pipeline

```
Subir documentos (PDF/JPG/PNG)  →  análisis AUTOMÁTICO (INCREMENTAL, paralelo acotado)
        ↓
Para CADA documento, UNA sola petición que lo hace TODO de ese documento (`analizarDocumento`):
   Claude lo lee DIRECTAMENTE (Read / visión) → transcribe esa pieza Y extrae SUS líneas de la NDF
        ↓
En cuanto un documento termina se EMITE en directo (SSE `doc`): su transcripción + sus líneas se
   añaden a la NDF al instante, sin esperar al resto (resultados aparecen documento a documento)
        ↓
Revisión humana (Analyse: corregir texto · Note de Frais: corregir datos, todo autoguardado)
        ↓
PDF FINAL = NDF (rasterizada) + adjuntos (pdf-lib), en el orden elegido por el tesorero
```

**No se usa OCR externo.** Claude lee el documento directamente.

**Motor de IA (importante):** por defecto se usa **Claude Code headless** (`claude -p`), no la API.
`motorActivo()` (en `server.js`) decide: `'claude_code'` si el binario `claude` está en el PATH
(preferente **siempre**); si no, `'api'` solo cuando `apiFallback` está activo **y** hay clave; si no,
`null` → error claro (`claude_code_falta`/`clave_falta`). El módulo **`src/claudeCode.js`** encapsula
el CLI (réplica del patrón de los proyectos `youtube-summarizer`/`linkedin-summarizer` del usuario):
- Invocación `claude -p --model <alias> --output-format json`; **prompt por stdin** (no argv).
  Alias: `claude-haiku-4-5`→`haiku`, `claude-sonnet-4-6`→`sonnet` (`aliasModelo`).
- **Ventana INVISIBLE en Windows**: `spawn(..., { windowsHide: true })` (equivale a CREATE_NO_WINDOW).
  Si el binario fuese `.cmd`/`.ps1` se envuelve en `cmd.exe /c` (también con windowsHide); un `.exe`
  se lanza directo. En este PC `claude` es `…/.local/bin/claude.exe`.
- **Fuerza la SUSCRIPCIÓN, no la API**: `entornoSinClaves()` borra `ANTHROPIC_API_KEY` y
  `ANTHROPIC_AUTH_TOKEN` del entorno del hijo (si las heredara, el CLI facturaría la API).
- **cwd = carpeta temporal vacía** (`os.tmpdir()`, se borra al acabar) → no carga el `CLAUDE.md` del
  proyecto. Los documentos a leer se **copian** dentro de ese cwd con nombre simple (`document<ext>`,
  `rib<ext>`) y la instancia los lee con su herramienta **`Read`** (soporta PDF e imágenes),
  pre-autorizada con `--allowedTools Read --max-turns 6`.
- **Salida estructurada**: el CLI **no** fuerza json_schema. Se pide el formato en el prompt
  (`FORMATO_DOC_COMPLETO`/`FORMATO_TRANSCRIPCION`/`FORMATO_LIGNES`/`FORMATO_RIB`) y se parsea con
  **`parsearJSONlax`** (quita fences ```` ```json ````, recorta al primer `{…}`/`[…]`). El modelo
  suele envolver el JSON en fences.
- **Errores**: `class ErrorClaudeCode { tipo }` con tipos estables `claude_code_falta|auth|timeout|
  salida|error`; `clasificarErrorIA` los respeta y el frontend los traduce (`aiError.claude_code_*`).
  El **límite semanal** de la suscripción llega como 429 con «weekly limit» → tipo `límite`; entonces
  el análisis NO funciona con Claude Code hasta que el límite se reinicia (o se activa el respaldo API).

Las funciones de IA (`analizarDocumento`, `transcribirDocumento`, `estructurarDesdeTextos`,
`extraerRIB`) tienen **rama CLI** (por defecto) y **rama API** (fallback) según `motorActivo()`.

**Análisis INCREMENTAL + paralelo acotado + EMISIÓN EN ORDEN (importante):** `analizarConClaude`
procesa los documentos con un **pool de `CONCURRENCIA_ANALISIS` workers** (por defecto **3**,
`ANALISIS_CONCURRENCIA` en `.env`; pon **1** para estrictamente secuencial). Para cada documento,
**UNA sola petición** (`analizarDocumento`) lo lee, lo transcribe Y extrae **sus** líneas de la NDF en
una pasada. Los workers **calculan en paralelo** (acaban en desorden), pero los resultados se **emiten
(`onDoc` → SSE `doc`) en el ORDEN de la lista** mediante un **buffer de reordenación**: el documento i
solo se muestra cuando ya se mostraron todos los anteriores (`proximo`/`listo[]`/`resultados[]`, vaciado
serializado con una cadena de promesas). Así la transcripción del 1º aparece primero, luego la del 2º,
etc., aunque uno posterior haya terminado antes (se retiene hasta que le toca). Motivo del paralelismo:
el cuello de botella es la **latencia de la API** (un `claude -p` vacío tarda ~2 s, pero leer+procesar un
documento 20-160 s), no la CPU local → varios a la vez **solapan** esas esperas y dividen el tiempo total
(medido: ~166 s / 6 docs en paralelo-3 vs ~600 s+ en secuencial). El resultado FINAL que se persiste va
también **ordenado** por documento y se reemite por SSE (`datos`) + va en la respuesta HTTP. Cada
`analizarDocumento` fuerza `fichiers_source = [nombre]` (el modelo solo ve un `document.ext`) y normaliza
IVA/importe (`normalizarLigne`: `taux_tva=0`, `montant_ttc=prix_ht`). Regla en el prompt: **un
ticket/factura = una sola línea con el total** (no itemizar artículos). `max_tokens: 16000` solo en la
rama API.

**Por qué una sola llamada por documento:** enviar TODOS los documentos en una petición hinchaba
entrada (N base64) y salida (todo el texto junto) → JSON truncado / cortes. Una llamada pequeña por
documento es fiable, y combinar transcripción+estructuración en esa misma llamada evita una segunda
petición por documento (más rápido). `estructurarDesdeTextos` (solo texto, sobre TODAS las
transcripciones) ya **no** se usa en el análisis; queda para `/regenerar` (re-extraer desde el texto
ya editado a mano). `transcribirDocumento` (solo transcripción) queda para `/reextraer` (botón
« Releer ce document »).

**Reintento por documento** (`analizarDocumentoConReintento`): si el análisis de un documento falla o
no devuelve transcripción (**0 caracteres**), se reintenta **una** segunda vez. Si el segundo intento
también falla/vacío, se lanza un error → el endpoint `/analizar` responde 500 y el frontend muestra la
**ventana flotante de error**. Cada intento se registra en el Journal d'analyse.

**Transcripción por líneas (preservar estructura):** el esquema de salida pide `transcription`
como **array de strings** (una por línea visible del documento → `ESQUEMA_TRANSCRIPCION_CAMPO`);
el server las une con `\n` (`unirTranscripcion`) antes de guardarlas en `ocr`. Así se conserva la
estructura (tabla, bloques) en el `<textarea>` de Analyse en vez de un párrafo corrido. `ev.ocr[nom]`
sigue siendo un **string** (ahora con saltos de línea); el resto del pipeline no cambia.

**Modelo:** por defecto `claude-haiku-4-5` (configurable con `ANTHROPIC_MODEL` en `.env` **o desde
el panel Réglages ⚙**, que lo cambia en caliente y lo persiste en `.env`). Vale para ambos motores
(se mapea a alias del CLI). Modelos ofrecidos en la UI: `claude-haiku-4-5` y `claude-sonnet-4-6`
(`MODELOS` en `server.js`).
**Solo rama API:** `max_tokens: 16000`/`1500` y `output_config.format` json_schema (Haiku no admite
`effort` → `outputConfig()` lo omite con `/haiku/i.test(modeloClaude)`). La rama CLI no usa estos knobs.
**Estado en caliente:** `anthropicApiKey`, `modeloClaude`, `apiFallback` y el cliente `anthropic` son
`let`; `PUT /api/settings` los actualiza, recrea el cliente y reescribe `.env` (`actualizarEnv`:
`ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL`/`API_FALLBACK`) sin reiniciar. La detección de `claude` se cachea
(`rutaClaude`/`versionClaude`): si instalas Claude Code con la app abierta, reinicia el servidor.

## Arquitectura

- **Backend** `src/server.js`: Node + Express, sin build. `pdf-lib` + `@anthropic-ai/sdk` (solo rama
  de fallback API) + **`src/claudeCode.js`** (motor por defecto, `claude -p` headless).
  - Sirve `src/web/` y expone la API REST bajo `/api`.
  - **PDF final** (`POST /eventos/:id/pdf`): el cliente manda las páginas de la NDF rasterizadas
    (PNG dataURL, vía html2canvas) + el orden de los adjuntos; el server concatena con **pdf-lib**
    (imágenes A4 de la NDF → páginas; adjuntos PDF se copian, imágenes se embeben en A4). Guarda el
    PDF en la carpeta del evento y lo devuelve.
  - **Apagado SOLO al cerrar la ventana**: el cliente manda `POST /api/cerrar` (sendBeacon en
    `pagehide`). El server programa apagado en 4 s; un `POST /api/ping` posterior (p. ej. tras un F5)
    lo **cancela**. NO hay apagado por inactividad/timeout.
  - **Backups**: en cada `guardarEvento()` se copia el `event.json` previo a `data/Cases/<id>/_backups/`
    (se conservan los últimos `MAX_BACKUPS`).
- **Arranque (Windows)**: `Start.bat` (sin terminal, delega en `src/Start.vbs`),
  `Diagnose.bat` (con ventana, para ver errores). `npm start` = `node src/server.js`.
  - **Node.js** es el requisito base. Si falta, los lanzadores ofrecen instalarlo automáticamente con
    `winget` (`OpenJS.NodeJS.LTS`; requiere internet + UAC, y relanzar una vez); si no hay winget,
    abren nodejs.org. `Start.vbs` comprueba `where node` antes de arrancar.
  - **Claude Code** es el requisito del motor de IA por defecto (instalado + `claude login`). Sin él,
    el análisis solo funciona con el respaldo a la API activado en Réglages. (Los lanzadores no lo
    instalan automáticamente; la app lo autodetecta en el PATH.)
- **Frontend** `src/web/` (vanilla JS): `index.html`, `styles.css`, `app.js`, `i18n.js`, `logo-bdi.png`.
  - Vendor local (`src/web/vendor/`): `pdf.js`/`pdf.worker` (miniaturas y preview de la pestaña
    Signée) y `html2canvas` (rasterizar la NDF para el PDF final).
  - **Visor de documentos** (`montarOriginal`): en la pestaña **Analyse** y en el modal `#modal-doc`
    los documentos se muestran con **`<iframe>`** (PDF, render inline del navegador) o **`<img>`**
    (imágenes). El server sirve los archivos con `Content-Disposition: inline` para que el PDF se
    renderice en el iframe sin forzar descarga. (`pintarVisorPDF` con pdf.js solo se usa ya en la
    preview de Signée.)
  - **i18n** (`i18n.js`): `t(clave, vars)` + `aplicarIdioma()` recorren `data-i18n` / `-ph` / `-title`.
    Idioma en `localStorage('idioma-ndf')`. **Selector de idioma** = desplegable **propio** (no
    `<select>`) **justo después del indicador de servidor** (`#lang-select` → `#lang-btn` + `#lang-menu`):
    usa **banderas SVG** (`FLAGS` en `app.js`), porque los emoji 🇫🇷🇪🇸🇬🇧 no se renderizan en Windows.
    `elegirIdioma()` guarda y re-renderiza; cierra con click fuera / Escape. La **hoja NDF se queda
    en francés** (documento oficial); solo se traduce la interfaz.
  - **Home**: eventos **agrupados por año**; **buscador** (`#buscar`) + **chips de estado**
    (`#chips-estado`, multi-selección; `estado.filtro.estados[]`, `renderChipsEstado`); tarjetas con
    nombre + pôle (subtítulo) + **color de borde según estado** + presupuesto (NO hay badge payé; el
    estado `rembourse` indica pagado). Creación en **modal** (FAB "+") con **zona drag&drop de
    documentos** (`#crear-dropzone`, `crearDocs[]`): al crear se suben y se lanza el análisis.
  - **Análisis automático**: al subir/borrar docs se llama solo a `/analizar` (`lanzarAnalisis()`,
    cancelable por `estado.analisisToken`: resultado obsoleto se descarta; borrar un doc corta y relanza).
  - **Journal d'analyse + resultados en directo (SSE)**: el mismo stream `GET /api/eventos/:id/logs`
    transporta (a) líneas de log por paso (`emitLog`, buffer por evento, reiniciado con `resetLog`) y
    (b) eventos ESTRUCTURADOS (`emitEvento`, no bufferizados salvo la última instantánea de datos):
    `datos` (esqueleto de la NDF al iniciar, o snapshot al reconectar a mitad de análisis vía
    `estructBuffer`), `doc` (un documento terminó: su transcripción **y** sus líneas) y `fin`. El
    cliente (`abrirLogStream`): `datos` → adopta `estado.activo.datos`; `doc` → `aplicarDocEnVivo`
    (pinta la transcripción en Analyse + **añade sus líneas a la NDF** y re-renderiza); `fin` →
    `finalizarAnalisisEnVivo` (recarga datos definitivos). `lanzarAnalisis` vacía las líneas locales al
    empezar para que se reconstruyan documento a documento. Los mensajes de log van en francés.
  - **Duplicados**: al subir, el server calcula sha256 y rechaza (409) si ya existe un documento idéntico.
  - **Huérfanos**: documentos subidos que no aparecen en ninguna `ligne.fichiers_source` → aviso en la NDF
    (`#aviso-orphelins`) y badge rojo en la tarjeta (`documentosHuerfanos()`).
  - **IBAN del abonado** (`datos.iban`): viene de la persona elegida; editable en la NDF; **obligatorio
    para generar el PDF** (`generarPDF()` bloquea si está vacío). Siempre en euros (no hay multidivisa).
  - **Base de personas (RIB)**: `data/people.json` (gitignored, datos bancarios; **sin firma**). Es la
    **primera pestaña** (vista Personnes); el "membre" al crear evento es un **desplegable** conectado a
    esa base (su IBAN se copia al evento). Alta de persona desde la pestaña o desde el modal de creación
    (`personneVolverACrear`); el formulario permite **importar un RIB** → `POST /api/personnes/extraire`
    (Claude extrae titulaire/iban/bic/banque).
  - **Pestañas jerárquicas**: `#tabs-home` (Personnes · Événements) **siempre visible**; al abrir un
    evento aparece la subfila `#tabs.tabs-sub` (Documents/Analyse/NDF/Signée) y la pestaña Événements
    muestra **↩** (`.ico-volver`, clase `editando`); pulsarla → `volverAEventos()`. No hay `#btn-volver`.
  - **Tarjeta de info del evento** (1ª tarjeta de Documents): `renderInfoEvento()` rellena `#info-*`
    (nom, section, date, budget, membre); `guardarInfoEvento()` (debounce) hace `PUT` de la meta y
    **propaga a `datos`** (numero_ndf, section, asso, date_evenement, nom_membre, iban) replicando
    `construirDatos`, luego `autoguardarDatos` + repagina.
  - **NDF Signée** (`datos`/meta `ev.signee`): pestaña/vista para adjuntar la NDF firmada; se guarda en
    la carpeta del evento como `<numero_ndf>_signee.<ext>` (`POST/GET/DELETE /api/eventos/:id/signee`,
    `renderSignee`). Botón «Ouvrir le dossier» → `POST …/signee/abrir-carpeta`.
  - **Paginación A4 (importante)**: `paginarHoja()` mide la altura real `clientHeight - padding` de cada
    `.ndf-page` **solo cuando es visible**. Por eso `mostrarVista('ndf')` **re-pagina** (si se pagina con
    la pestaña oculta, `clientHeight=0` y cada fila salta de página). Reserva el alto del bloque de firmas
    (`altoFirmas()`) para que nunca se corten.
  - **Layout NDF**: 2 columnas. Izquierda = cartas (estado/budget+huérfanos, observaciones, orden de
    piezas), sin scroll interno (se expanden). Derecha = hoja + **aside** (`.ndf-aside`) con el botón
    **« Ajouter une ligne »** (`#btn-add-ligne`, i18n `ndf.addLine`) arriba y la **leyenda** debajo;
    `alinearComplementos()` le da margin-top para alinearlo con el inicio de la tabla.
  - **Confianza por línea**: `ligne.confiance` → **reborde superpuesto** de la celda (`td.art/td.prix
    ::after` con box-shadow inset), no fondo. Leyenda explicativa en la columna derecha.
  - **UI**: logo BDI arriba-izq (`header .app-logo`); `#topbar` (header+pestañas) **sticky**; errores de
    validación **dentro del modal** (`.modal-error`, no toast de fondo).
  - **Autoguardado** (`autoguardarDatos` / `autoguardarOcr`, debounce); `guardarMeta()` (estado, budget)
    y `guardarInfoEvento()` (nom/section/date/budget/membre + propagación). No hay botón de guardar;
    atajo **Ctrl+S** fuerza, **Ctrl+P** genera PDF, ←/→ navegan en Analyse.
  - **NDF paginada A4**: `paginarHoja()` reparte filas en varias `.ndf-page` midiendo la altura real de
    los hijos contra un presupuesto en px (NO usar `scrollHeight`: la página tiene altura fija 297mm).
  - **Confianza por línea**: cada `ligne.confiance` ∈ haute/moyenne/basse tiñe la fila (verde/ámbar/rojo).
    Durante la exportación se añade la clase `exportando` a `#hoja-ndf` para ocultar tintes/botones/bordes.
  - **Firma**: **solo el tesorero de l'asso mère** (`datos.signature`); la celda del miembro queda
    **vacía** (firma física → se adjunta en la pestaña Signée). `elegirFirma()` (sin arg) lista solo
    `Signature_Trez_BDI_*`; cada tarjeta del modal tiene una **✕** que la borra (`DELETE /api/firmas/:n`);
    botón **✕** en la hoja → `quitarFirma()`.
  - **Orden de adjuntos**: cards reordenables (drag&drop) en `#ordre-cards` → `datos.ordre_pieces`.
  - **Ayuda única**: un solo botón `#btn-howto-global` (header) → `abrirAyudaGlobal()` concatena todas
    las secciones de `AYUDA` (incl. `signee`) en `#modal-howto` (`.modal-howto-grande`).
  - **Réglages** (`#btn-ajustes` junto a Thème → `#modal-ajustes`): muestra el **estado del motor
    Claude Code** (`#set-cc-estado`: detectado + versión / no encontrado), un **toggle de respaldo a la
    API** (`#set-api-fallback`), la **clave API** (campo password con ojo; solo se usa con el respaldo
    activo; placeholder = clave enmascarada, vacío = conservar) y el **modelo** (desplegable poblado
    desde `GET /api/settings`). **Tester la connexion** (`POST /api/settings/test`) prueba el motor
    **activo** (lanza un `claude -p` mínimo, o un ping de la API) sin guardar; **Enregistrer** hace
    `PUT /api/settings` (incluye `apiFallback`). Sin estado de evento; i18n bajo `settings.*`.
  - **Modales**: crear evento, visor doc (`#modal-doc`), firma (`#modal-firma`), ayuda (`#modal-howto`),
    réglages (`#modal-ajustes`).
- **Datos** `data/Cases/<id>/`: `event.json` (todo), `Documents/` (ficheros), `_backups/` (copias).
- **Firmas**: carpeta **`data/Signatures/`** (gitignored); solo firmas del tesorero de l'asso
  mère (`Signature_Trez_BDI_*`).

## Modelo de datos (`event.json`)

```jsonc
{
  "id", "nom", "section", "membre", "date", "creado",
  "iban": "FR76…",          // IBAN del abonado (opcional al crear; obligatorio para el PDF)
  "budget": 300,            // presupuesto máx del BDI (número o null)
  "estado": "brouillon",    // brouillon|a_verifier|valide|envoye|rembourse (= pagado)
  "signee": "..._signee.pdf",  // NDF firmada adjuntada en la pestaña Signée (o null)
  "ocr": { "facture1.pdf": "texto transcrito", ... },
  "datos": {
    "numero_ndf": "NDF_<nom-con-guiones>_<año>",
    "date_emission", "nom_membre", "section", "asso", "adresse", "date_evenement",
    "lignes": [ { "article","date_achat","prix_ht","taux_tva","montant_ttc","fichiers_source","confiance" } ],
    "observations": [ "remarque 1", ... ],   // array
    "iban": "FR76…",                         // IBAN (espejo editable del de meta)
    "signature": "fichero.png",              // firma tesorero asso mère (en data/Signatures)
    "ordre_pieces": [ "ticket.jpeg", "facture.pdf" ]  // orden en el PDF final
  }
}
```

Reglas de negocio (no romper):
- `nom_membre`, `section`, `date`, `budget` vienen **del evento**; editables en la **tarjeta de info**
  de Documents, que **propaga** los cambios a `datos` (no se editan desde los documentos).
- `section`: desplegable con 6 **pôles** (`Bureau de l'International (Pôle X)`) **+ las associations
  filles (clubs)**. Definidos en `SECCIONES` (`web/app.js`): `val` = valor canónico guardado (aparece
  en la NDF, en francés); `fr/es/en` = etiquetas visibles traducidas (los pôles NO se traducen). Los
  `<select>` (`#nuevo-section`, `#info-section`) se pueblan por JS (`poblarSelectsSeccion`) y se
  re-traducen al cambiar de idioma; `nombreSeccion(val)` traduce un valor guardado para mostrarlo.
- `numero_ndf` = `NDF_` + nombre con guiones + `_` + año (de `date`).
- Dirección por defecto: `3 rue Joliot Curie, 91190, Gif-sur-Yvette`.
- Separador decimal en UI: **coma** (`numFR`/`aNumero`).
- **IVA ignorado**: `prix_ht` = **importe final pagado (TTC)**; `taux_tva` siempre **0** (columna
  «Taux TVA» = placeholder fijo «0 %», no editable); `montant_ttc` = `prix_ht`. Claude recoge el
  total final, sin desglosar impuestos. Totales: `Total HT = Total TTC = Σ prix_ht`.
- Aviso (no bloqueante, no impreso) si `nom_membre` no tiene apellido en MAYÚSCULAS.

## API REST (resumen)

| Método | Ruta | Acción |
|---|---|---|
| GET/POST | `/api/eventos` | listar / crear (nom, section, membre, date, budget) |
| GET | `/api/eventos/:id` | detalle |
| PUT | `/api/eventos/:id` | actualizar meta (nom, section, date, estado, budget, membre, iban) |
| DELETE | `/api/eventos/:id` | borrar evento |
| POST/DELETE/GET | `/api/eventos/:id/archivos[/:n]` | subir / borrar / servir fichero |
| POST | `/api/eventos/:id/archivos/:n/renombrar` | renombrar |
| POST | `/api/eventos/:id/analizar` | Claude lee documentos → ocr + datos |
| GET | `/api/eventos/:id/logs` | **SSE**: journal d'analyse + resultados en directo (logs + eventos `datos`/`doc`/`fin`) |
| PUT | `/api/eventos/:id/ocr` | guardar transcripciones |
| POST | `/api/eventos/:id/regenerar` | re-extraer desde transcripciones |
| PUT | `/api/eventos/:id/datos` | guardar la NDF (autoguardado) |
| POST | `/api/eventos/:id/pdf` | **PDF final** (NDF rasterizada + adjuntos) |
| POST/GET/DELETE | `/api/eventos/:id/signee` | adjuntar / servir / borrar la NDF firmada (`_signee`) |
| POST | `/api/eventos/:id/signee/abrir-carpeta` | abrir la NDF firmada en el Explorador |
| GET/POST/PUT/DELETE | `/api/personnes[/:pid]` | CRUD de personas (base de RIB) |
| POST | `/api/personnes/extraire` | extraer datos bancarios de un RIB (Claude) |
| GET/POST/DELETE | `/api/firmas[/:n]` | listar / subir / servir / borrar firmas |
| GET/PUT | `/api/settings` | leer (motor + estado Claude Code + apiFallback + clave enmascarada + modelo) / cambiar en caliente |
| POST | `/api/settings/test` | probar el motor activo (Claude Code `claude -p` mínimo o ping de la API), sin persistir |
| POST | `/api/ping` · `/api/cerrar` | latido / cierre por ventana |

## La hoja NDF (réplica del modelo oficial)

`paginarHoja()` genera la hoja en `.ndf-page` (A4). Debe seguir **idéntica** al modelo (`/NDF/WW2026/`
del repo padre): barras laterales (azul `#4A7EBB`, naranja `#FB8F60`, rojo `#E12848`), logo
`web/logo-bdi.png`, etiquetas negras + valores azul `#1F497D`, tabla con cabecera/total grises.
**Dark mode**: la hoja siempre blanca con texto `#000` forzado. El **PDF final** se construye
rasterizando cada `.ndf-page` con html2canvas y concatenando con pdf-lib (no se usa `window.print()`).

## Convenciones / cuidado

- **Idioma**: interfaz traducida (FR/ES/EN); la NDF en francés; comentarios en español.
- **No** añadir dependencias con binarios ni paso de build (portabilidad).
- Reiniciar el servidor tras editar `.env` **a mano** (la clave/modelo cambiados desde Réglages se
  aplican en caliente, sin reiniciar). Tras editar `src/web/*`, recargar con Ctrl+F5.
- Verificación visual: Chrome headless + deep-link `#evento=<id>&tab=documents|analyse|ndf[&voir=<f>]`.
- `analizar`/`regenerar` gastan tokens reales; el análisis es **automático al subir documentos**.
