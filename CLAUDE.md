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

## Portabilidad (requisito)

La app debe seguir funcionando **copiando la carpeta a cualquier ordenador** con Node ≥ 20. Por eso:
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
    server.js          ← backend (Express + Anthropic SDK + pdf-lib)
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
Subir documentos (PDF/JPG/PNG)  →  análisis AUTOMÁTICO
        ↓
Claude (Anthropic) lee cada documento DIRECTAMENTE (visión / document input)
   → transcribe cada pieza  + extrae las líneas de la NDF (con nivel de confianza)
        ↓
Revisión humana (Analyse: corregir texto · Note de Frais: corregir datos, todo autoguardado)
        ↓
PDF FINAL = NDF (rasterizada) + adjuntos (pdf-lib), en el orden elegido por el tesorero
```

**No se usa OCR externo.** El documento se envía directamente a Claude (un paso, una clave).

**Modelo:** por defecto `claude-haiku-4-5` (configurable con `ANTHROPIC_MODEL` en `.env`).
**Haiku no admite `effort`** → `outputConfig()` lo omite si el modelo es Haiku (`SOPORTA_EFFORT`).
La salida estructurada (`output_config.format` json_schema) sí funciona en Haiku 4.5.

## Arquitectura

- **Backend** `src/server.js`: Node + Express, sin build. `@anthropic-ai/sdk` + `pdf-lib`.
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
  - **Node.js es el único requisito externo.** Si falta, los lanzadores ofrecen instalarlo
    automáticamente con `winget` (`OpenJS.NodeJS.LTS`; requiere internet + UAC, y relanzar una vez);
    si no hay winget, abren nodejs.org. `Start.vbs` comprueba `where node` antes de arrancar.
- **Frontend** `src/web/` (vanilla JS): `index.html`, `styles.css`, `app.js`, `i18n.js`, `logo-bdi.png`.
  - CDNs: `pdf.js` (miniaturas) y `html2canvas` (rasterizar la NDF para el PDF final).
  - **i18n** (`i18n.js`): `t(clave, vars)` + `aplicarIdioma()` recorren `data-i18n` / `-ph` / `-title`.
    Idioma en `localStorage('idioma-ndf')`, selector FR/ES/EN junto a Thème. La **hoja NDF se queda
    en francés** (documento oficial); solo se traduce la interfaz.
  - **Home**: eventos **agrupados por año**; **buscador** (`#buscar`) + **chips de estado**
    (`#chips-estado`, multi-selección; `estado.filtro.estados[]`, `renderChipsEstado`); tarjetas con
    nombre + pôle (subtítulo) + **color de borde según estado** + presupuesto (NO hay badge payé; el
    estado `rembourse` indica pagado). Creación en **modal** (FAB "+") con **zona drag&drop de
    documentos** (`#crear-dropzone`, `crearDocs[]`): al crear se suben y se lanza el análisis.
  - **Análisis automático**: al subir/borrar docs se llama solo a `/analizar` (`lanzarAnalisis()`,
    cancelable por `estado.analisisToken`: resultado obsoleto se descarta; borrar un doc corta y relanza).
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
  - **Modales**: crear evento, visor doc (`#modal-doc`), firma (`#modal-firma`), ayuda (`#modal-howto`).
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
| PUT | `/api/eventos/:id/ocr` | guardar transcripciones |
| POST | `/api/eventos/:id/regenerar` | re-extraer desde transcripciones |
| PUT | `/api/eventos/:id/datos` | guardar la NDF (autoguardado) |
| POST | `/api/eventos/:id/pdf` | **PDF final** (NDF rasterizada + adjuntos) |
| POST/GET/DELETE | `/api/eventos/:id/signee` | adjuntar / servir / borrar la NDF firmada (`_signee`) |
| POST | `/api/eventos/:id/signee/abrir-carpeta` | abrir la NDF firmada en el Explorador |
| GET/POST/PUT/DELETE | `/api/personnes[/:pid]` | CRUD de personas (base de RIB) |
| POST | `/api/personnes/extraire` | extraer datos bancarios de un RIB (Claude) |
| GET/POST/DELETE | `/api/firmas[/:n]` | listar / subir / servir / borrar firmas |
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
- Reiniciar el servidor tras editar `.env`. Tras editar `src/web/*`, recargar con Ctrl+F5.
- Verificación visual: Chrome headless + deep-link `#evento=<id>&tab=documents|analyse|ndf[&voir=<f>]`.
- `analizar`/`regenerar` gastan tokens reales; el análisis es **automático al subir documentos**.
