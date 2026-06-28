# BDI · Notes de Frais

A local desktop-style web app for the **treasurer of the Bureau de l'International (BDI)** at
CentraleSupélec. It turns the tedious job of producing **expense reports** (*Notes de Frais*) into a
few clicks: you drop the proofs of an event (invoices, receipts, *attestations sur l'honneur*),
**Claude reads them and extracts the data**, and the app produces an **editable expense report that
matches the BDI's official template**. The final deliverable is a **single PDF** that bundles the
expense report together with every supporting document.

Everything runs on your own machine. By default the AI work is done by **Claude Code installed on the
computer** (your subscription — no API key needed); the Anthropic API is only an optional fallback.
Invoices, signatures, bank details and any API key never leave the folder.

> 🇫🇷 The app interface is available in **French, Spanish and English**. The generated expense report
> itself stays in French, because it is the BDI's official document.

---

## Table of contents

- [What it does](#what-it-does)
- [Requirements](#requirements)
- [Setup](#setup)
- [Running the app](#running-the-app)
- [Walkthrough](#walkthrough)
  - [1. People database](#1-people-database-rib--iban)
  - [2. Create an event](#2-create-an-event)
  - [3. Documents (automatic analysis)](#3-documents--automatic-analysis)
  - [4. Analysis (review the OCR)](#4-analysis--review-what-the-ai-read)
  - [5. Expense report & final PDF](#5-expense-report--final-pdf)
  - [6. Attach the signed report](#6-attach-the-signed-report)
- [Feature reference](#feature-reference)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Project structure](#project-structure)
- [How it works (technical)](#how-it-works-technical)
- [Data model](#data-model)
- [REST API](#rest-api)
- [Portability guarantee](#portability-guarantee)
- [Privacy & the public repo](#privacy--the-public-repo)
- [Design decisions](#design-decisions)
- [Troubleshooting](#troubleshooting)
- [Roadmap ideas](#roadmap-ideas)

---

## What it does

```
Drop documents (PDF / JPG / PNG)  ─►  automatic AI analysis (INCREMENTAL, a few in parallel)
        │
        ▼
One request per document does it all: Claude reads it directly (Claude Code Read tool, or vision
   via the API) → transcribes that piece line by line AND extracts its expense lines
        │
        ▼
Results stream in live, in the SAME ORDER the documents are listed: the first document's
   transcription + lines appear first, then the second, and so on (a few run in parallel for speed,
   but each is held back until its turn so the display stays in order)
        │
        ▼
Human review  (Analysis: fix the text · Expense report: fix the data — everything auto-saved)
        │
        ▼
Final PDF  =  the expense report  +  all the attachments, in the order you choose
```

There is **no external OCR**: Claude both transcribes each document and fills in the report. By default
this runs through **headless Claude Code** (`claude -p`) using the subscription already logged in on the
machine — **no API key required**. The Anthropic API is used only as an **optional fallback** you can
enable in *Réglages* (see [Requirements](#requirements)). The analysis is **incremental**: each document
is read, transcribed and turned into expense lines in a single request, and results appear **in the
order the documents are listed** (first document first, then the second, …). A small number of documents
are processed **in parallel** (3 by default, set `ANALISIS_CONCURRENCIA` in `.env`; use `1` for strictly
sequential) — the bottleneck is API latency, so overlapping requests cuts the total time; a reordering
buffer keeps the on-screen results in list order even though they finish out of order.

---

## Requirements

- [Node.js](https://nodejs.org/) **20 or later**.
- **Claude Code**, installed and logged in (run `claude login` once) → this is the default engine,
  used through your subscription. The app auto-detects the `claude` binary on the PATH.
- *(Optional)* An **Anthropic API key** → https://console.anthropic.com/settings/keys — only needed if
  you enable the **API fallback** in *Réglages* (for machines without Claude Code).

## Setup

1. Install Claude Code and run `claude login` once (so the subscription is available on this machine).
2. *(Optional)* Copy `.env.example` to `.env` if you want the API fallback or to pin a model. By default
   **no `.env` is required**.
3. The engine and the optional API fallback (plus model and key) are all configurable from the
   **Réglages (⚙)** panel inside the app — it shows whether Claude Code is detected.

## Running the app

- **Windows:** double-click **`Start.bat`**. It starts the server **with no terminal window** and
  opens your browser. The first run installs dependencies automatically. **If Node.js isn't installed,
  the launcher offers to install it for you** (via `winget`, built into Windows 11 — needs internet and
  the usual Windows permission prompt; re-run `Start.bat` once afterwards). If something fails and you
  want to see the logs, use **`Diagnose.bat`** (windowed version — see below).
- **Any OS / manually:**
  ```bash
  npm install
  npm start
  ```
  Then open http://localhost:4317.

> **What is `Diagnose.bat`?** The everyday launcher (`Start.bat`) runs the server **hidden**, so if
> something goes wrong you see nothing. `Diagnose.bat` does the same job but **in a visible terminal
> window**: it checks that Node.js is installed (and offers to install it via `winget` if missing),
> installs dependencies if needed, warns if `.env` is missing, then runs the server **printing all its
> logs and errors** (and opens the browser). Use it whenever the app won't start or the AI analysis
> misbehaves, to read the actual error message.

> The server **shuts down by itself when you close the browser window** (not on an inactivity timer);
> reloading the page (F5) keeps it alive. If you edit `.env`, close and reopen. After updating the app
> files, reload with **Ctrl+F5**.

---

## Walkthrough

### 1. People database (RIB / IBAN)

The people who advance the money (usually the president or the treasurer) live in a **People
database**. It is the **first tab (« Personnes »)** in the top bar, always visible next to
**« Événements »**. Each person stores the bank details found on a *RIB*: account holder, **IBAN**,
BIC/SWIFT, bank, branch.

Add a person two ways:
- From the **People** tab → **« + Add a person »**.
- From the **event creation** window → **« + Person »** (when the person isn't in the list yet).

In the person form you can either **type the fields manually** or **import a RIB** (PDF/image) and let
**the AI fill them in** automatically. Everything stays **editable** at any time. When you later pick a
person while creating an event, their **IBAN is placed automatically** in the expense report.

### 2. Create an event

Each **event = one expense report**. Click the floating **« + »** button (bottom-right of the home
page) and fill in:

| Field | Notes |
|---|---|
| **Name** | e.g. *World Week 2026* — used for the report number. |
| **Section (pôle / club)** | A grouped dropdown: the 6 BDI **pôles** (Events, RelEnt, Trez, Soirée, Comm, Cohez) **and the subsidiary associations (clubs)** — Club Espagnol, Club Tunisien, CentraleSupélec Israël, BdI Metz, CS Asie, Club Argentin, CentraleSupélec Afrique, Club Brésil, CentraleSupélec Maroc, BdI Rennes, ItaliCS, Club Allemand, Club Chilien, CèdreS, Club Chinois. Club names are translated to the UI language. |
| **Date** | Used for the report number's year. |
| **Max budget** | The maximum the BDI allocated to this event (shown on the card and as "remaining budget"). |
| **Member who paid** | A **dropdown** connected to the People database (their IBAN is attached automatically). |
| **Documents** *(optional)* | A **drag-and-drop zone** to attach the proofs right away; after the event is created they upload and **analysis starts automatically**. |

On the home page, events are **grouped by year**, each card is **colour-coded by status** and shows the
**budget**. A **search bar** and **status chips** (multi-select) help when there are many; the
**Remboursé** status is what indicates an event has been paid.

### 3. Documents (automatic analysis)

The first card on this tab is the **editable event info** (name, section/pôle, date, budget, member).
Changing any field **auto-saves** and is **reported automatically** onto the expense report (report
number, section/asso, date, member name & IBAN).

Below it, drag-and-drop your invoices, receipts and attestations **onto the cards area** (or use
**« + Add documents »**). **Analysis starts automatically** — Claude reads each document, transcribes
it and fills the report. Results appear **document by document** as each one finishes (a few run in
parallel), with a live log and a loading indicator while it works.

- Each card has a **thumbnail** (first page of PDFs, full image otherwise).
- **« View »** opens it in an in-app popup viewer; **« Open »** opens it in a new browser tab; click
  the **name** to rename it (the file is renamed on disk).
- If you upload a file that is **byte-for-byte identical** to one already there, it's ignored with a
  *duplicate* notice (hash check).
- Deleting a document **restarts** the analysis without it.

### 4. Analysis — review what the AI read

Side-by-side view: the **original document on the left** (shown in an `<iframe>` for PDFs, an `<img>`
for images), the **editable transcription on the right**. The transcription keeps the original
line structure (Claude returns it line by line). Fix anything the AI misread, then click
**« Regenerate the report »** to recompute the lines from your corrected text. Arrow keys ←/→ jump
between documents; **« Open »** opens a document in a new tab.

### 5. Expense report & final PDF

A faithful, fully-editable preview of the official BDI report. The screen is split in two columns:

- **Left column** (cards):
  - **Status & budget** — event status dropdown (**Remboursé** = paid) and **remaining budget**
    (turns red if over budget), plus an **orphan-documents** warning.
  - **AI observations** — the AI's notes as an editable numbered list (not printed on the report).
  - **Attachment order** — drag the cards to set the order the documents will follow the report in the
    final PDF.
- **Right column**: the **A4 preview** itself, with a small **aside** beside the table holding the
  **« Ajouter une ligne »** button (on top) and the **colour legend** (below), aligned to the table.

Key behaviours:
- **Everything auto-saves** (no save button). The IBAN field is filled from the chosen person but stays
  editable.
- **Amounts are always in euros**, decimal comma. **VAT is ignored on purpose**: the AI reads the
  **final amount paid (incl. tax)** straight into the **Prix HT** column, the **Taux TVA** column is a
  fixed, non-editable **0 %** placeholder, and **Total HT = Total TTC = sum of the amounts** (recomputed
  live). The treasurer never has to split VAT.
- Each line has a **coloured border** showing the AI's **confidence** (green = high, amber = medium,
  red = low) so you know what to double-check — the legend explains it.
- **One signature only — the treasurer of the parent association.** The **« Signature trésorier »**
  button drops a saved signature image into the report (if none exists yet, your OS file picker opens);
  a small **✕** lets you **remove** it again. The member's signature column stays empty: the member
  **signs the printed report by hand**, and you attach the signed version in the **Signée** tab (step 6).
- If the table grows, the preview **flows onto several A4 pages**, and the signature block is never cut.
- The red ✕ on a line removes it.
- A red warning appears below the name if the **surname isn't in UPPERCASE**.
- **The IBAN is required** before you can generate the PDF.

**« Generate PDF »** (or Ctrl+P) builds the **single final PDF** = the report (one or more A4 pages) +
every attachment in your chosen order; it opens in the viewer and is saved in the event folder
(`<report number>.pdf`). **« Excel »** exports the lines to a spreadsheet.

### 6. Attach the signed report

Once the member has physically signed the report, attach the signed version in the **« Signée »** tab
(PDF or image — drag-and-drop or **« + Joindre la NDF signée »**). It is saved **next to the blank
report** in the event folder with a **`_signee`** suffix. From there you can **download** it, **open the
folder** (Windows Explorer), **replace** or **delete** it.

---

## Feature reference

- **AI document reading & extraction** (Claude, no external OCR), with **per-line confidence**.
- **People / RIB database** (first tab) with **AI extraction from a RIB** and manual editing.
- **Hierarchical tabs**: Personnes / Événements always visible; opening an event reveals its
  Documents / Analyse / Note de Frais / Signée sub-tabs (the « Événements » tab shows a ↩ to go back).
- **Editable event-info card** on the Documents tab that auto-saves and propagates to the report.
- **Attach documents at creation** → they upload and get analysed automatically.
- **Event states** (draft → to review → validated → sent → reimbursed) shown as card colours; the
  **Remboursé** status indicates the event has been paid.
- **Per-event budget** with live "remaining budget" / "over budget".
- **Final concatenated PDF** (report + attachments), the **signed report** kept as `_signee`, and
  **Excel export**.
- **Duplicate detection** (SHA-256) and **orphan-document** warnings.
- **Treasurer signature** from a shared signatures folder, with **add / remove / delete saved** images.
- **Automatic analysis**, **autosave**, **automatic backups** of each event's JSON.
- **Multi-language UI** (FR/ES/EN), **light/dark theme**, **search & status chips**, **sticky top bar**.
- **In-app PDF viewer**, **drag-and-drop**, **keyboard shortcuts**.
- A single **« How to use »** button (top bar) with all sections in one window.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| **Ctrl/Cmd + S** | Force-save the current report |
| **Ctrl/Cmd + P** | Generate the final PDF (on the Note de Frais tab) |
| **← / →** | Move between documents on the Analysis tab |
| **Esc** | Close any open modal |

---

## Project structure

The repository root keeps only the launchers (`.bat`), the docs (`.md`), the env files and the files
git/npm require there. **Code** lives in `src/`, **runtime data** in `data/`. All filenames are in
English.

```
NotesDeFraisBDI/
├── Start.bat              ← start WITHOUT a terminal window (delegates to src/Start.vbs)
├── Diagnose.bat          ← windowed version, to see logs/errors
├── README.md · CLAUDE.md
├── .env.example          ← key template (copy to .env)
├── .gitignore            ← excludes .env, data/Cases/, data/Signatures/, data/people.json
├── package.json · package-lock.json · node_modules/   ← must stay at the root (npm)
├── src/
│   ├── server.js         ← backend (Express + pdf-lib; routes AI to Claude Code or the API)
│   ├── claudeCode.js     ← default engine: headless `claude -p` (invisible window, subscription)
│   ├── Start.vbs         ← hidden launcher (the project root is its parent folder)
│   └── web/              ← UI (vanilla JS, no framework)
│       ├── index.html · styles.css · app.js
│       ├── i18n.js       ← FR / ES / EN translations + help texts
│       └── logo-bdi.png
└── data/                 ← runtime data (contents git-ignored)
    ├── Signatures/       ← signature images (treasurer) — private
    ├── people.json       ← people + bank details (RIB/IBAN) — private
    └── Cases/            ← one folder per event
         └── <event>/
              ├── event.json    ← single file: meta + transcriptions + report data
              ├── <report>.pdf         ← the generated blank report (after « Generate PDF »)
              ├── <report>_signee.pdf  ← the signed report (after attaching it in the Signée tab)
              ├── Documents/    ← the uploaded files
              └── _backups/     ← automatic backups of event.json
```

---

## How it works (technical)

- **Backend** `src/server.js`: Node + Express, no build step. Uses `pdf-lib`, the official
  `@anthropic-ai/sdk` (API fallback only) and **`src/claudeCode.js`** (the default engine). Serves
  `src/web/` and exposes a REST API under `/api`. Paths are resolved relative to the project root
  (`__dirname/..`) and `.env` is loaded from there explicitly, so the server works from any directory.
  - **AI engine (`src/claudeCode.js`)**: by default each AI call spawns a **headless Claude Code**
    process (`claude -p --output-format json`, prompt over stdin) using your subscription. On Windows the
    console window is kept **invisible** (`windowsHide: true`). The child's `ANTHROPIC_API_KEY` /
    `ANTHROPIC_AUTH_TOKEN` are **stripped** so it uses the subscription, not the API. It runs in a throw-
    away temp folder where the document to read is copied, and Claude reads it with its **Read** tool
    (`--allowedTools Read`). `motorActivo()` picks the engine: Claude Code if the `claude` binary is on
    the PATH, otherwise the API **only if the fallback is enabled** and a key is set, otherwise a clear
    error. The CLI doesn't enforce a JSON schema, so the output is parsed leniently (`parsearJSONlax`).
  - **Final PDF**: the browser rasterises each A4 page of the report with **html2canvas** and POSTs the
    images + the chosen attachment order; the server concatenates everything with **pdf-lib** (report
    images become pages; attachment PDFs are copied page-by-page, images are embedded into A4 pages).
  - **Structured output (API fallback)**: Claude is called with `output_config.format` (JSON schema),
    `effort` omitted automatically for Haiku (which doesn't support it).
  - **Shutdown only on window close**: the browser sends `POST /api/cerrar` (a `pagehide` beacon); the
    server schedules shutdown in ~4 s, and a following `POST /api/ping` (after an F5) cancels it.
  - **Backups**: every save copies the previous `event.json` into `_backups/` (last *N* kept). Older
    events created as `evento.json` are renamed to `event.json` automatically on startup.
- **Frontend** `src/web/` (vanilla JS): `index.html`, `styles.css`, `app.js`, `i18n.js`. Local vendor
  libs (`src/web/vendor/`): `pdf.js` (thumbnails / Signée preview) and `html2canvas` (final PDF).
  Documents are shown with `<iframe>` (PDF) / `<img>` (images). The A4 paginator measures the real available height of
  the page once it's visible, so the signature block never gets cut.

## Data model

`data/Cases/<id>/event.json`:

```jsonc
{
  "id", "nom", "section", "membre", "date", "creado",
  "iban": "FR76…",          // payee IBAN (from the chosen person; required before the PDF)
  "budget": 300,            // BDI max budget (number or null)
  "estado": "brouillon",    // brouillon | a_verifier | valide | envoye | rembourse (= paid)
  "signee": "NDF_..._signee.pdf",  // signed report attached in the Signée tab (or null)
  "ocr": { "facture1.pdf": "transcribed text", ... },
  "datos": {
    "numero_ndf": "NDF_<name-with-dashes>_<year>",
    "date_emission", "nom_membre", "iban", "section", "asso", "adresse", "date_evenement",
    // VAT is ignored: prix_ht = final amount paid, taux_tva is always 0, montant_ttc = prix_ht.
    "lignes": [ { "article","date_achat","prix_ht","taux_tva","montant_ttc","fichiers_source","confiance" } ],
    "observations": [ "note 1", ... ],
    "signature": "file.png",   // treasurer of the parent association (member signs the print by hand)
    "ordre_pieces": [ "ticket.jpeg", "facture.pdf" ]
  }
}
```

People live in a separate, git-ignored `data/people.json`:
`{ id, nom, titulaire, iban, bic, banque, domiciliation, role, creado }`.

## REST API

| Method | Route | Action |
|---|---|---|
| GET/POST | `/api/eventos` | list / create event |
| GET/PUT/DELETE | `/api/eventos/:id` | detail / update meta (name, section, date, status, budget, member) / delete |
| POST/DELETE/GET | `/api/eventos/:id/archivos[/:n]` | upload (with dedup) / delete / serve a file |
| POST | `/api/eventos/:id/archivos/:n/renombrar` | rename a file |
| POST | `/api/eventos/:id/analizar` | Claude reads the documents → ocr + data |
| PUT | `/api/eventos/:id/ocr` | save transcriptions |
| POST | `/api/eventos/:id/regenerar` | re-extract from the transcriptions |
| PUT | `/api/eventos/:id/datos` | save the report (autosave) |
| POST | `/api/eventos/:id/pdf` | final PDF (report + attachments) |
| POST/GET/DELETE | `/api/eventos/:id/signee` | attach / serve / delete the signed report (`_signee`) |
| POST | `/api/eventos/:id/signee/abrir-carpeta` | reveal the signed report in Windows Explorer |
| GET/POST/PUT/DELETE | `/api/personnes[/:pid]` | people CRUD |
| POST | `/api/personnes/extraire` | extract bank details from a RIB (AI) |
| GET/POST/DELETE | `/api/firmas[/:n]` | list / upload / serve / delete signatures |
| GET/PUT | `/api/settings` | read (engine + Claude Code status + apiFallback + masked key + model) / update hot |
| POST | `/api/settings/test` | test the active engine (a minimal `claude -p`, or an API ping) without saving |
| POST | `/api/ping` · `/api/cerrar` | heartbeat / close-on-window |

## Portability guarantee

As long as the whole app lives in one folder with this structure, it works on **any computer with
Node ≥ 20**: every path is relative, there are no native binaries and no build step, and all data and
secrets live inside the folder. Just copy it and run `Start.bat` (or `npm install && npm start`).

For the AI analysis the machine needs **Claude Code installed and logged in** (`claude login`) — the
default engine, auto-detected on the PATH. If you move the folder to a computer without Claude Code,
analysis still works **only** if you enable the **API fallback** in *Réglages* and provide a key in
`.env` (never copied with the repo); otherwise the app shows a clear error. **Node.js** itself is the
only requirement the launchers can install automatically (via `winget`); Claude Code is not auto-installed.

## Privacy & the public repo

`.gitignore` excludes `.env` (your key), `data/Cases/` (real data), `data/Signatures/` (signature
images) and `data/people.json` (bank details), so this repository can be public without leaking
anything sensitive.

## Design decisions

- **Portable, no build.** Node + Express and vanilla JS; only pure-JS dependencies (`pdf-lib` to merge
  PDFs). `npm install` and go — anyone can clone and run it.
- **Local engine, not just HTML.** Credentials can't sit in the browser (public repo + CORS), so a small
  local server runs the AI (Claude Code subscription by default; API key in `.env` only as fallback).
- **Subscription first, API as fallback.** By default the AI runs through the machine's logged-in Claude
  Code (no per-token API cost, no key to share); the API is an opt-in fallback. Each headless `claude -p`
  call is invisible on Windows and forced onto the subscription (API env vars stripped).
- **One JSON per event** + files in `Documents/` + copies in `_backups/`.
- **The real deliverable** is the concatenated PDF (report + proofs), in the treasurer's chosen order.
- **Human review always.** It's money: the AI proposes, the treasurer verifies and corrects (text in
  *Analysis*, amounts in *Note de Frais*) before generating.
- **Faithful to the official model**, including A4 pagination, colours and logo.

## Troubleshooting

- **"Server stopped" banner / connection refused** → the server isn't running. Reopen `Start.bat`,
  then click *Retry* or reload.
- **AI analysis does nothing / errors** → open **Réglages (⚙)**: it shows whether **Claude Code** is
  detected. If not, run `claude login` in a terminal (and make sure `claude` is on the PATH), or enable
  the **API fallback** and set a key. If you just installed Claude Code, restart the app.
- **PDF colours/logo missing when printing the in-app preview** → in the browser print dialog enable
  *Background graphics*. (The final PDF from « Generate PDF » already includes them.)
- **Changes don't show up** → hard-reload with **Ctrl+F5**.
- **See logs** → start with `Diagnose.bat` instead of `Start.bat`.

## Roadmap ideas

Not implemented yet, but natural next steps: a consolidated yearly ledger / Excel export of all
reports, a "pending reimbursements" worklist, click-a-line-to-highlight-its-source, automatic
generation of *attestations sur l'honneur*, and an email inbox that imports clubs' documents
automatically.

---

Developed by [Óscar Martínez Zamora](https://www.linkedin.com/in/oscarmartinezzamora/) ·
[Source code](https://github.com/osmaza17/BDI-Notes-de-Frais)
