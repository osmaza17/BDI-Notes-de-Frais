# BDI · Notes de Frais

A local desktop-style web app for the **treasurer of the Bureau de l'International (BDI)** at
CentraleSupélec. It turns the tedious job of producing **expense reports** (*Notes de Frais*) into a
few clicks: you drop the proofs of an event (invoices, receipts, *attestations sur l'honneur*),
**Claude reads them and extracts the data**, and the app produces an **editable expense report that
matches the BDI's official template**. The final deliverable is a **single PDF** that bundles the
expense report together with every supporting document.

Everything runs on your own machine. Invoices, signatures, bank details and your API key never leave
the folder.

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
Drop documents (PDF / JPG / PNG)  ─►  automatic AI analysis
        │
        ▼
Claude reads each document directly (vision / document input)
   → transcribes every piece  +  extracts the expense lines (with a confidence level)
        │
        ▼
Human review  (Analysis: fix the text · Expense report: fix the data — everything auto-saved)
        │
        ▼
Final PDF  =  the expense report  +  all the attachments, in the order you choose
```

There is **no external OCR**: each document is sent straight to Claude, which both transcribes it and
fills in the report. One API, one key.

---

## Requirements

- [Node.js](https://nodejs.org/) **20 or later**.
- An **Anthropic API key** → https://console.anthropic.com/settings/keys

## Setup

1. Copy `.env.example` to `.env`.
2. Paste your key: `ANTHROPIC_API_KEY=...your_key...`
3. Save. (Optional: change `ANTHROPIC_MODEL`, default `claude-haiku-4-5`.)

## Running the app

- **Windows:** double-click **`Iniciar.vbs`** (or `Iniciar.bat`). It starts the server **with no
  terminal window** and opens your browser. The first run installs dependencies automatically. If
  something fails and you want to see the logs, use **`Diagnostico.bat`** (windowed version).
- **Any OS / manually:**
  ```bash
  npm install
  npm start
  ```
  Then open http://localhost:4317.

> The server **shuts down by itself when you close the browser window** (not on an inactivity timer);
> reloading the page (F5) keeps it alive. If you edit `.env`, close and reopen. After updating the app
> files, reload with **Ctrl+F5**.

---

## Walkthrough

### 1. People database (RIB / IBAN)

The people who advance the money (usually the president or the treasurer) live in a **People
database**. Open it from the **« Personnes »** button in the top bar. Each person stores the bank
details found on a *RIB*: account holder, **IBAN**, BIC/SWIFT, bank, branch.

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
| **Section (pôle)** | One of: Events, RelEnt, Trez, Soirée, Comm, Cohez. |
| **Date** | Used for the report number's year. |
| **Max budget** | The maximum the BDI allocated to this event (shown on the card and as "remaining budget"). |
| **Member who paid** | A **dropdown** connected to the People database (their IBAN is attached automatically). |

On the home page, events are **grouped by year**, each card is **colour-coded by status**, shows the
**budget** and a **paid / unpaid** badge. A **search bar** and **status filter** help when there are
many.

### 3. Documents (automatic analysis)

Drag-and-drop your invoices, receipts and attestations **onto the cards area** (or use
**« + Add documents »**). **Analysis starts automatically** — Claude reads each document, transcribes
it and fills the report. While it works you see a loading indicator.

- Each card has a **thumbnail** (first page of PDFs, full image otherwise).
- **« View »** opens it in an in-app popup viewer; **« Open »** opens it in a new browser tab; click
  the **name** to rename it (the file is renamed on disk).
- If you upload a file that is **byte-for-byte identical** to one already there, it's ignored with a
  *duplicate* notice (hash check).
- Deleting a document **restarts** the analysis without it.

### 4. Analysis — review what the AI read

Side-by-side view: the **original document on the left**, the **editable transcription on the right**.
Fix anything the AI misread, then click **« Regenerate the report »** to recompute the lines from your
corrected text. Arrow keys ←/→ jump between documents; **« Open »** opens a document in a new tab.

### 5. Expense report & final PDF

A faithful, fully-editable preview of the official BDI report. The screen is split in two columns:

- **Left column** (cards):
  - **Status & budget** — event status dropdown, **paid / unpaid** toggle, **remaining budget**
    (turns red if over budget), and an **orphan-documents** warning.
  - **AI observations** — the AI's notes as an editable numbered list (not printed on the report).
  - **Attachment order** — drag the cards to set the order the documents will follow the report in the
    final PDF.
- **Right column**: a small **colour legend** and the **A4 preview** itself.

Key behaviours:
- **Everything auto-saves** (no save button). The IBAN field is filled from the chosen person but stays
  editable.
- **Amounts are always in euros**, decimal comma; totals (HT / TTC) recompute live.
- Each line has a **coloured border** showing the AI's **confidence** (green = high, amber = medium,
  red = low) so you know what to double-check — the legend explains it.
- **Treasurer signature** and **Member signature** buttons drop a saved signature image into the
  report; if none exists yet, your OS file picker opens.
- If the table grows, the preview **flows onto several A4 pages**, and the signature block is never cut.
- **« Add new line »** sits at the top-right of the table; the red ✕ removes a line.
- A red warning appears below the name if the **surname isn't in UPPERCASE**.
- **The IBAN is required** before you can generate the PDF.

**« Generate PDF »** (or Ctrl+P) builds the **single final PDF** = the report (one or more A4 pages) +
every attachment in your chosen order; it opens in the viewer and is saved in the event folder.
**« Excel »** exports the lines to a spreadsheet.

---

## Feature reference

- **AI document reading & extraction** (Claude, no external OCR), with **per-line confidence**.
- **People / RIB database** with **AI extraction from a RIB** and manual editing.
- **Event states** (draft → to review → validated → sent → reimbursed) shown as card colours + a
  **paid / unpaid** toggle.
- **Per-event budget** with live "remaining budget" / "over budget".
- **Final concatenated PDF** (report + attachments) and **Excel export**.
- **Duplicate detection** (SHA-256) and **orphan-document** warnings.
- **Two signatures** (treasurer & member) from a shared signatures folder.
- **Automatic analysis**, **autosave**, **automatic backups** of each event's JSON.
- **Multi-language UI** (FR/ES/EN), **light/dark theme**, **search & filter**, **sticky top bar**.
- **In-app PDF viewer**, **drag-and-drop**, **keyboard shortcuts**.
- Per-tab **« How to use »** help.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| **Ctrl/Cmd + S** | Force-save the current report |
| **Ctrl/Cmd + P** | Generate the final PDF (on the Note de Frais tab) |
| **← / →** | Move between documents on the Analysis tab |
| **Esc** | Close any open modal |

---

## Project structure

```
NotesDeFraisBDI/
├── Iniciar.vbs            ← start WITHOUT a terminal window
├── Iniciar.bat            ← same (delegates to the .vbs)
├── Diagnostico.bat        ← windowed version, to see errors
├── servidor.js            ← backend (Express + Anthropic SDK + pdf-lib)
├── package.json
├── .env.example           ← key template (copy to .env)
├── .gitignore             ← excludes .env, Dossiers/, Signatures/, personnes.json
├── CLAUDE.md · README.md
├── web/                   ← UI (vanilla JS, no framework)
│   ├── index.html · estilos.css · app.js
│   ├── i18n.js            ← FR / ES / EN translations + per-tab help
│   └── logo-bdi.png
├── Signatures/            ← signature images (treasurer & members) — private
├── personnes.json         ← people + bank details (RIB/IBAN) — private, git-ignored
└── Dossiers/              ← one folder per event
     └── <event>/
          ├── evento.json   ← single file: meta + transcriptions + report data
          ├── Documents/    ← the uploaded files
          └── _backups/     ← automatic backups of evento.json
```

---

## How it works (technical)

- **Backend** `servidor.js`: Node + Express, no build step. Uses the official `@anthropic-ai/sdk` and
  `pdf-lib`. Serves `web/` and exposes a REST API under `/api`.
  - **Final PDF**: the browser rasterises each A4 page of the report with **html2canvas** and POSTs the
    images + the chosen attachment order; the server concatenates everything with **pdf-lib** (report
    images become pages; attachment PDFs are copied page-by-page, images are embedded into A4 pages).
  - **Structured output**: Claude is called with `output_config.format` (JSON schema). The `effort`
    parameter is omitted automatically when the model is Haiku (which doesn't support it).
  - **Shutdown only on window close**: the browser sends `POST /api/cerrar` (a `pagehide` beacon); the
    server schedules shutdown in ~4 s, and a following `POST /api/ping` (after an F5) cancels it.
  - **Backups**: every save copies the previous `evento.json` into `_backups/` (last *N* kept).
- **Frontend** `web/` (vanilla JS): `index.html`, `estilos.css`, `app.js`, `i18n.js`. CDNs: `pdf.js`
  (thumbnails) and `html2canvas` (final PDF). The A4 paginator measures the real available height of
  the page once it's visible, so the signature block never gets cut.

## Data model

`Dossiers/<id>/evento.json`:

```jsonc
{
  "id", "nom", "section", "membre", "date", "creado",
  "iban": "FR76…",          // payee IBAN (from the chosen person; required before the PDF)
  "budget": 300,            // BDI max budget (number or null)
  "estado": "brouillon",    // brouillon | a_verifier | valide | envoye | rembourse
  "paye": false,
  "ocr": { "facture1.pdf": "transcribed text", ... },
  "datos": {
    "numero_ndf": "NDF_<name-with-dashes>_<year>",
    "date_emission", "nom_membre", "iban", "section", "asso", "adresse", "date_evenement",
    "lignes": [ { "article","date_achat","prix_ht","taux_tva","montant_ttc","fichier_source","confiance" } ],
    "observations": [ "note 1", ... ],
    "signature": "file.png", "signature_membre": "file.png",
    "ordre_pieces": [ "ticket.jpeg", "facture.pdf" ]
  }
}
```

People live in a separate, git-ignored `personnes.json`:
`{ id, nom, titulaire, iban, bic, banque, domiciliation, creado }`.

## REST API

| Method | Route | Action |
|---|---|---|
| GET/POST | `/api/eventos` | list / create event |
| GET/PUT/DELETE | `/api/eventos/:id` | detail / update meta (status, paid, budget) / delete |
| POST/DELETE/GET | `/api/eventos/:id/archivos[/:n]` | upload (with dedup) / delete / serve a file |
| POST | `/api/eventos/:id/archivos/:n/renombrar` | rename a file |
| POST | `/api/eventos/:id/analizar` | Claude reads the documents → ocr + data |
| PUT | `/api/eventos/:id/ocr` | save transcriptions |
| POST | `/api/eventos/:id/regenerar` | re-extract from the transcriptions |
| PUT | `/api/eventos/:id/datos` | save the report (autosave) |
| POST | `/api/eventos/:id/pdf` | final PDF (report + attachments) |
| GET/POST/PUT/DELETE | `/api/personnes[/:pid]` | people CRUD |
| POST | `/api/personnes/extraire` | extract bank details from a RIB (AI) |
| GET/POST | `/api/firmas` · GET `/api/firmas/:n` | list / upload / serve signatures |
| POST | `/api/ping` · `/api/cerrar` | heartbeat / close-on-window |

## Portability guarantee

As long as the whole app lives in one folder with this structure, it works on **any computer with
Node ≥ 20**: every path is relative, there are no native binaries and no build step, and all data and
secrets live inside the folder. Just copy it and run `Iniciar.vbs` (or `npm install && npm start`). On
a new machine you only need to recreate `.env` with your key (it is never copied with the repo).

## Privacy & the public repo

`.gitignore` excludes `.env` (your key), `Dossiers/` (real data), `Signatures/` (signature images) and
`personnes.json` (bank details), so this repository can be public without leaking anything sensitive.

## Design decisions

- **Portable, no build.** Node + Express and vanilla JS; only pure-JS dependencies (`pdf-lib` to merge
  PDFs). `npm install` and go — anyone can clone and run it.
- **Local engine, not just HTML.** API keys can't sit in the browser (public repo + CORS), so a small
  local server keeps them in `.env`.
- **One provider (Claude).** The document goes straight to the model: fewer moving parts, one key.
- **One JSON per event** + files in `Documents/` + copies in `_backups/`.
- **The real deliverable** is the concatenated PDF (report + proofs), in the treasurer's chosen order.
- **Human review always.** It's money: the AI proposes, the treasurer verifies and corrects (text in
  *Analysis*, amounts in *Note de Frais*) before generating.
- **Faithful to the official model**, including A4 pagination, colours and logo.

## Troubleshooting

- **"Server stopped" banner / connection refused** → the server isn't running. Reopen `Iniciar.vbs`,
  then click *Retry* or reload.
- **AI analysis does nothing / errors** → check `ANTHROPIC_API_KEY` in `.env`, then restart.
- **PDF colours/logo missing when printing the in-app preview** → in the browser print dialog enable
  *Background graphics*. (The final PDF from « Generate PDF » already includes them.)
- **Changes don't show up** → hard-reload with **Ctrl+F5**.
- **See logs** → start with `Diagnostico.bat` instead of `Iniciar.vbs`.

## Roadmap ideas

Not implemented yet, but natural next steps: a consolidated yearly ledger / Excel export of all
reports, a "pending reimbursements" worklist, click-a-line-to-highlight-its-source, automatic
generation of *attestations sur l'honneur*, and an email inbox that imports clubs' documents
automatically.

---

Developed by [Óscar Martínez Zamora](https://www.linkedin.com/in/oscarmartinezzamora/) ·
[Source code](https://github.com/osmaza17/BDI-Notes-de-Frais)
