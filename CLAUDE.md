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
- **Todas las rutas son relativas** a la carpeta del proyecto (`path.join(__dirname, …)`), nunca absolutas.
- Dependencias: solo paquetes **JS puros sin binarios** (`@anthropic-ai/sdk`, `express`, `dotenv`,
  `pdf-lib`). Se instalan con `npm install`; nada de bundlers ni pasos de build.
- Datos y secretos viven dentro de la carpeta (`Dossiers/`, `Signatures/`, `.env`).
- **No introducir rutas absolutas, binarios nativos, ni dependencias del SO.**

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

- **Backend** `servidor.js`: Node + Express, sin build. `@anthropic-ai/sdk` + `pdf-lib`.
  - Sirve `web/` y expone la API REST bajo `/api`.
  - **PDF final** (`POST /eventos/:id/pdf`): el cliente manda las páginas de la NDF rasterizadas
    (PNG dataURL, vía html2canvas) + el orden de los adjuntos; el server concatena con **pdf-lib**
    (imágenes A4 de la NDF → páginas; adjuntos PDF se copian, imágenes se embeben en A4). Guarda el
    PDF en la carpeta del evento y lo devuelve.
  - **Apagado SOLO al cerrar la ventana**: el cliente manda `POST /api/cerrar` (sendBeacon en
    `pagehide`). El server programa apagado en 4 s; un `POST /api/ping` posterior (p. ej. tras un F5)
    lo **cancela**. NO hay apagado por inactividad/timeout.
  - **Backups**: en cada `guardarEvento()` se copia el `evento.json` previo a `Dossiers/<id>/_backups/`
    (se conservan los últimos `MAX_BACKUPS`).
- **Arranque (Windows)**: `Iniciar.vbs` (sin terminal), `Iniciar.bat` (delega en el .vbs),
  `Diagnostico.bat` (con ventana, para ver errores).
- **Frontend** `web/` (vanilla JS): `index.html`, `estilos.css`, `app.js`, `i18n.js`, `logo-bdi.png`.
  - CDNs: `pdf.js` (miniaturas) y `html2canvas` (rasterizar la NDF para el PDF final).
  - **i18n** (`i18n.js`): `t(clave, vars)` + `aplicarIdioma()` recorren `data-i18n` / `-ph` / `-title`.
    Idioma en `localStorage('idioma-ndf')`, selector FR/ES/EN junto a Thème. La **hoja NDF se queda
    en francés** (documento oficial); solo se traduce la interfaz.
  - **Home**: eventos **agrupados por año**; **buscador** (`#buscar`) + **filtro de estado**; tarjetas
    con nombre + pôle (subtítulo) + **color de borde según estado** + presupuesto + badge payé.
    Creación en **modal** abierto por el **FAB "+"**. (NO hay emoji — eliminado.)
  - **Análisis automático**: al subir/borrar docs se llama solo a `/analizar` (`lanzarAnalisis()`,
    cancelable por `estado.analisisToken`: resultado obsoleto se descarta; borrar un doc corta y relanza).
  - **Duplicados**: al subir, el server calcula sha256 y rechaza (409) si ya existe un documento idéntico.
  - **Huérfanos**: documentos subidos que no aparecen en ninguna `ligne.fichier_source` → aviso en la NDF
    (`#aviso-orphelins`) y badge rojo en la tarjeta (`documentosHuerfanos()`).
  - **IBAN del abonado** (`datos.iban`): viene de la persona elegida; editable en la NDF; **obligatorio
    para generar el PDF** (`generarPDF()` bloquea si está vacío). Siempre en euros (no hay multidivisa).
  - **Base de personas (RIB)**: `personnes.json` (gitignored, datos bancarios). Pestaña/vista Personnes;
    el "membre" al crear evento es un **desplegable** conectado a esa base (su IBAN se copia al evento).
    Alta de persona desde la pestaña o desde el modal de creación (`personneVolverACrear`); el formulario
    permite **importar un RIB** → `POST /api/personnes/extraire` (Claude extrae titulaire/iban/bic/banque).
  - **Paginación A4 (importante)**: `paginarHoja()` mide la altura real `clientHeight - padding` de cada
    `.ndf-page` **solo cuando es visible**. Por eso `mostrarVista('ndf')` **re-pagina** (si se pagina con
    la pestaña oculta, `clientHeight=0` y cada fila salta de página). Reserva el alto del bloque de firmas
    (`altoFirmas()`) para que nunca se corten.
  - **Layout NDF**: 2 columnas. Izquierda = cartas (estado/budget+huérfanos, observaciones, orden de
    piezas), sin scroll interno (se expanden). Derecha = leyenda de colores + hoja. Botón "Add new line"
    arriba-derecha (`.ndf-toolbar`).
  - **Confianza por línea**: `ligne.confiance` → **reborde superpuesto** de la celda (`td.art/td.prix
    ::after` con box-shadow inset), no fondo. Leyenda explicativa en la columna derecha.
  - **UI**: logo BDI arriba-izq (`header .app-logo`); `#topbar` (header+pestañas) **sticky**; errores de
    validación **dentro del modal** (`.modal-error`, no toast de fondo).
  - **Autoguardado** (`autoguardarDatos` / `autoguardarOcr`, debounce) y `guardarMeta()` (estado, payé,
    budget). No hay botón de guardar; atajo **Ctrl+S** fuerza, **Ctrl+P** genera PDF, ←/→ navegan en Analyse.
  - **NDF paginada A4**: `paginarHoja()` reparte filas en varias `.ndf-page` midiendo la altura real de
    los hijos contra un presupuesto en px (NO usar `scrollHeight`: la página tiene altura fija 297mm).
  - **Confianza por línea**: cada `ligne.confiance` ∈ haute/moyenne/basse tiñe la fila (verde/ámbar/rojo).
    Durante la exportación se añade la clase `exportando` a `#hoja-ndf` para ocultar tintes/botones/bordes.
  - **Firmas**: botones flotantes en las celdas (tesorero y miembro), `elegirFirma('tesorero'|'membre')`.
  - **Orden de adjuntos**: cards reordenables (drag&drop) en `#ordre-cards` → `datos.ordre_pieces`.
  - **Modales**: crear evento, visor doc (`#modal-doc`), firma (`#modal-firma`), ayuda (`#modal-howto`).
- **Datos** `Dossiers/<id>/`: `evento.json` (todo), `Documents/` (ficheros), `_backups/` (copias).
- **Firmas**: carpeta **`Signatures/`** a nivel de app (gitignored), compartida por tesorero y miembro.

## Modelo de datos (`evento.json`)

```jsonc
{
  "id", "nom", "section", "membre", "date", "creado",
  "iban": "FR76…",          // IBAN del abonado (opcional al crear; obligatorio para el PDF)
  "budget": 300,            // presupuesto máx del BDI (número o null)
  "estado": "brouillon",    // brouillon|a_verifier|valide|envoye|rembourse
  "paye": false,            // pagado o no
  "ocr": { "facture1.pdf": "texto transcrito", ... },
  "datos": {
    "numero_ndf": "NDF_<nom-con-guiones>_<año>",
    "date_emission", "nom_membre", "section", "asso", "adresse", "date_evenement",
    "lignes": [ { "article","date_achat","prix_ht","taux_tva","montant_ttc","fichier_source","confiance" } ],
    "observations": [ "remarque 1", ... ],   // array
    "iban": "FR76…",                         // IBAN (espejo editable del de meta)
    "signature": "fichero.png",              // firma tesorero (en /Signatures)
    "signature_membre": "fichero.png",       // firma miembro
    "ordre_pieces": [ "ticket.jpeg", "facture.pdf" ]  // orden en el PDF final
  }
}
```

Reglas de negocio (no romper):
- `nom_membre`, `section`, `date`, `budget` vienen **del evento** (creación), NO de los documentos.
- `section` ∈ 6 pôles: **Events, RelEnt, Trez, Soirée, Comm, Cohez** (`Bureau de l'International (Pôle X)`).
- `numero_ndf` = `NDF_` + nombre con guiones + `_` + año (de `date`).
- Dirección por defecto: `3 rue Joliot Curie, 91190, Gif-sur-Yvette`.
- Separador decimal en UI: **coma** (`numFR`/`aNumero`).
- Totales: `Total HT = Σ prix_ht`; `Total TTC = Σ prix_ht·(1+taux_tva)`.
- Aviso (no bloqueante, no impreso) si `nom_membre` no tiene apellido en MAYÚSCULAS.

## API REST (resumen)

| Método | Ruta | Acción |
|---|---|---|
| GET/POST | `/api/eventos` | listar / crear (nom, section, membre, date, budget) |
| GET | `/api/eventos/:id` | detalle |
| PUT | `/api/eventos/:id` | actualizar meta (estado, paye, budget, membre) |
| DELETE | `/api/eventos/:id` | borrar evento |
| POST/DELETE/GET | `/api/eventos/:id/archivos[/:n]` | subir / borrar / servir fichero |
| POST | `/api/eventos/:id/archivos/:n/renombrar` | renombrar |
| POST | `/api/eventos/:id/analizar` | Claude lee documentos → ocr + datos |
| PUT | `/api/eventos/:id/ocr` | guardar transcripciones |
| POST | `/api/eventos/:id/regenerar` | re-extraer desde transcripciones |
| PUT | `/api/eventos/:id/datos` | guardar la NDF (autoguardado) |
| POST | `/api/eventos/:id/pdf` | **PDF final** (NDF rasterizada + adjuntos) |
| GET/POST/PUT/DELETE | `/api/personnes[/:pid]` | CRUD de personas (base de RIB) |
| POST | `/api/personnes/extraire` | extraer datos bancarios de un RIB (Claude) |
| GET/POST | `/api/firmas` · GET `/api/firmas/:n` | listar / subir / servir firmas |
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
- Reiniciar el servidor tras editar `.env`. Tras editar `web/*`, recargar con Ctrl+F5.
- Verificación visual: Chrome headless + deep-link `#evento=<id>&tab=documents|analyse|ndf[&voir=<f>]`.
- `analizar`/`regenerar` gastan tokens reales; el análisis es **automático al subir documentos**.
