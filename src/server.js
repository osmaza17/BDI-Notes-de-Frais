// ============================================================
//  server.js — Motor local de la app de Notes de Frais del BDI.
//
//  Pipeline: el usuario sube facturas/tickets/attestations →
//  Claude los lee, transcribe cada documento y extrae las líneas
//  de la NDF. Motor por DEFECTO: instancias HEADLESS de Claude Code
//  (`claude -p`, suscripción local, sin clave). La API de Anthropic
//  es solo FALLBACK opcional (toggle en Réglages, `API_FALLBACK`).
//
//  Almacenamiento por evento (carpeta en /data/Cases/<id>/):
//   - event.json    → ÚNICO fichero con TODA la info del evento.
//   - Documents/    → subcarpeta con los ficheros aportados.
//   - _backups/     → copias de seguridad de event.json.
//
//  Portabilidad: todo es relativo a la carpeta del proyecto, sin
//  rutas absolutas; basta copiar la carpeta a otro PC con Node.
//
//  Clave y modelo en .env (ANTHROPIC_API_KEY / ANTHROPIC_MODEL);
//  editables en caliente desde el panel Réglages (/api/settings).
// ============================================================

import dotenv from 'dotenv';
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { PDFDocument } from 'pdf-lib';
import {
  claudeDisponible, versionClaude, ejecutarClaude, parsearJSONlax, ErrorClaudeCode,
} from './claudeCode.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Estructura de carpetas (relativa, portable):
//   <raíz>/src/server.js  ← este archivo (__dirname = <raíz>/src)
//   <raíz>/src/web/       ← frontend servido como estático
//   <raíz>/data/          ← datos en runtime (Cases/, Signatures/, people.json)
//   <raíz>/.env           ← clave de API (se carga aquí, sin depender del cwd)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(__dirname, '..');
const DIR_DATOS = path.join(RAIZ, 'data');
const RUTA_ENV = path.join(RAIZ, '.env');
dotenv.config({ path: RUTA_ENV });

const DIR_DOSSIERS = path.join(DIR_DATOS, 'Cases');
const DIR_WEB = path.join(__dirname, 'web');
const DIR_FIRMAS = path.join(DIR_DATOS, 'Signatures');
const RUTA_PERSONAS = path.join(DIR_DATOS, 'people.json');

const PORT = process.env.PORT || 4317;

// Modelos que puede elegir el usuario desde el panel de Réglages.
// `id` = identificador de la API de Anthropic; `label` = etiqueta visible.
const MODELOS = [
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
];
const MODELO_POR_DEFECTO = 'claude-haiku-4-5';

// Nº de documentos que se analizan EN PARALELO. El cuello de botella es la LATENCIA de la API de
// Claude (no la CPU local: un `claude -p` vacío tarda ~2 s, pero leer+procesar un documento 20-160 s),
// así que lanzar varios a la vez SOLAPA esas esperas y divide el tiempo total. Cada documento sigue
// mostrando sus resultados en cuanto termina (análisis incremental). Configurable con
// ANALISIS_CONCURRENCIA en .env; por defecto 3. Pon 1 para análisis estrictamente secuencial.
const CONCURRENCIA_ANALISIS = Math.max(1, Number(process.env.ANALISIS_CONCURRENCIA) || 3);

// Configuración EN CALIENTE: la clave y el modelo pueden cambiar en runtime
// desde /api/settings (se persisten en .env y se recrea el cliente, sin reiniciar).
let anthropicApiKey = process.env.ANTHROPIC_API_KEY || '';
let modeloClaude = process.env.ANTHROPIC_MODEL || MODELO_POR_DEFECTO;
let anthropic = new Anthropic({ apiKey: anthropicApiKey });

// Motor de IA. Por DEFECTO se usa Claude Code headless (suscripción local).
// La API de Anthropic solo se usa como FALLBACK si `apiFallback` está activado
// en Réglages (persistido en .env como API_FALLBACK) Y hay clave configurada.
let apiFallback = /^(1|true|on)$/i.test(process.env.API_FALLBACK || '');

// Decide qué motor usar AHORA:
//   'claude_code' → el CLI `claude` está disponible (preferente siempre)
//   'api'         → no hay CLI, pero el fallback está activo y hay clave
//   null          → no hay forma de analizar (→ error claro para el usuario)
function motorActivo() {
  if (claudeDisponible()) return 'claude_code';
  if (apiFallback && anthropicApiKey) return 'api';
  return null;
}

// Haiku no admite `effort`; se calcula según el modelo activo en cada llamada.
function outputConfig(schema) {
  const oc = { format: { type: 'json_schema', schema } };
  if (!/haiku/i.test(modeloClaude)) oc.effort = 'medium';
  return oc;
}

// Clasifica un error de la API de Anthropic en un `tipo` estable que el frontend
// traduce a un mensaje claro + cómo resolverlo (ver `mostrarErrorIA` en app.js).
// Códigos del SDK: 401 auth · 403 permiso · 429 límite · 500 servidor · 529 sobrecarga.
// El saldo insuficiente llega como 400 invalid_request_error con «credit balance» en el mensaje.
function clasificarErrorIA(e) {
  // Errores del motor Claude Code ya traen su propio `tipo` estable.
  if (e instanceof ErrorClaudeCode || e?.name === 'ErrorClaudeCode') return e.tipo || 'claude_code_error';
  const status = e?.status;
  const tipoApi = e?.type || e?.error?.type || e?.error?.error?.type || '';
  const msg = (e?.message || '').toLowerCase();
  const red = `${e?.code || ''} ${e?.cause?.code || ''} ${msg}`;
  if (!anthropicApiKey) return 'clave_falta';
  if (/credit balance|insufficient|billing|purchase credits|plans? ?(&|and) ?billing/.test(msg) || tipoApi === 'billing_error')
    return 'sin_creditos';
  if (status === 401 || tipoApi === 'authentication_error' || /invalid x-api-key|invalid api key|authentication_error/.test(msg))
    return 'clave_invalida';
  if (status === 403 || tipoApi === 'permission_error') return 'sin_permiso';
  if (status === 429 || tipoApi === 'rate_limit_error') return 'limite';
  if (status === 529 || tipoApi === 'overloaded_error') return 'sobrecarga';
  if ((status >= 500 && status < 600) || tipoApi === 'api_error') return 'servidor';
  if (/enotfound|econnrefused|etimedout|eai_again|econnreset|fetch failed|getaddrinfo|network|socket hang up/i.test(red))
    return 'red';
  return 'desconocido';
}

// Actualiza claves en el .env conservando el resto de líneas (las añade si faltan).
async function actualizarEnv(cambios) {
  let lineas = [];
  try { lineas = (await fs.readFile(RUTA_ENV, 'utf8')).split(/\r?\n/); } catch { /* no existe aún */ }
  const claves = Object.keys(cambios);
  const vistas = new Set();
  lineas = lineas.map((ln) => {
    const m = /^\s*([A-Za-z0-9_]+)\s*=/.exec(ln);
    if (m && claves.includes(m[1])) { vistas.add(m[1]); return `${m[1]}=${cambios[m[1]]}`; }
    return ln;
  });
  for (const k of claves) if (!vistas.has(k)) lineas.push(`${k}=${cambios[k]}`);
  await fs.writeFile(RUTA_ENV, lineas.join('\n'), 'utf8');
}

// Enmascara la clave para mostrarla sin revelarla entera.
function maskKey(k) {
  if (!k) return '';
  return k.length <= 12 ? '••••' : `${k.slice(0, 7)}…${k.slice(-4)}`;
}

const ADRESSE_BDI = '3 rue Joliot Curie, 91190, Gif-sur-Yvette';
const MAX_BACKUPS = 15;

const EXT_IMAGEN = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);
const esImagenNombre = (n) => EXT_IMAGEN.has(path.extname(n).toLowerCase());

await fs.mkdir(DIR_DOSSIERS, { recursive: true });
await fs.mkdir(DIR_FIRMAS, { recursive: true });

// ---------- Utilidades de ficheros ----------
function slug(texto) {
  return (texto || 'evento')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'evento';
}
async function leerJSON(ruta, pd = null) {
  try { return JSON.parse(await fs.readFile(ruta, 'utf8')); } catch { return pd; }
}
async function escribirJSON(ruta, obj) {
  await fs.writeFile(ruta, JSON.stringify(obj, null, 2), 'utf8');
}

const rutaEvento = (id) => path.join(DIR_DOSSIERS, id);
const rutaDocs = (id) => path.join(rutaEvento(id), 'Documents');
const rutaJSON = (id) => path.join(rutaEvento(id), 'event.json');
const rutaJSONlegacy = (id) => path.join(rutaEvento(id), 'evento.json');
const rutaBackups = (id) => path.join(rutaEvento(id), '_backups');

function idValido(id) { return typeof id === 'string' && /^[a-zA-Z0-9_]+$/.test(id); }

// Lee event.json; si no existe, cae al antiguo evento.json (compat.).
async function leerEvento(id) {
  const ev = await leerJSON(rutaJSON(id));
  if (ev) return ev;
  return leerJSON(rutaJSONlegacy(id));
}

// Migración: renombra cualquier evento.json antiguo a event.json al arrancar.
async function migrarNombresJSON() {
  const ids = await fs.readdir(DIR_DOSSIERS).catch(() => []);
  for (const id of ids) {
    if (!idValido(id)) continue;
    const viejo = rutaJSONlegacy(id), nuevo = rutaJSON(id);
    const hayViejo = await fs.access(viejo).then(() => true, () => false);
    const hayNuevo = await fs.access(nuevo).then(() => true, () => false);
    if (hayViejo && !hayNuevo) await fs.rename(viejo, nuevo).catch(() => {});
  }
}
await migrarNombresJSON();

// Guarda el evento y deja una copia de seguridad con marca de tiempo.
async function guardarEvento(id, ev) {
  // Backup de la versión anterior (si existe) antes de sobrescribir.
  try {
    const previo = await fs.readFile(rutaJSON(id), 'utf8');
    await fs.mkdir(rutaBackups(id), { recursive: true });
    const sello = new Date().toISOString().replace(/[:.]/g, '-');
    await fs.writeFile(path.join(rutaBackups(id), `event_${sello}.json`), previo, 'utf8');
    // Conserva solo los últimos MAX_BACKUPS.
    const copias = (await fs.readdir(rutaBackups(id))).filter((n) => n.endsWith('.json')).sort();
    for (const vieja of copias.slice(0, Math.max(0, copias.length - MAX_BACKUPS))) {
      await fs.rm(path.join(rutaBackups(id), vieja), { force: true });
    }
  } catch { /* primera escritura: no hay previo */ }
  await escribirJSON(rutaJSON(id), ev);
}

async function listarArchivos(id) {
  const entradas = await fs.readdir(rutaDocs(id)).catch(() => []);
  return entradas.filter((n) => !n.startsWith('.'));
}

// ---------- Extracción con Claude ----------
const MIME_POR_EXT = {
  '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
};

const ESQUEMA_LIGNE = {
  type: 'object',
  additionalProperties: false,
  required: ['article', 'date_achat', 'prix_ht', 'taux_tva', 'montant_ttc', 'fichiers_source', 'confiance'],
  properties: {
    article: { type: 'string', description: "Désignation courte de l'achat en français." },
    date_achat: { type: 'string', description: "Date de l'achat au format JJ/MM/AAAA. Vide si inconnue." },
    prix_ht: { type: 'number', description: "Montant TOTAL payé en euros, toutes taxes comprises (TTC) — le montant final qui figure sur le ticket ou la facture. On ne décompose JAMAIS la TVA." },
    taux_tva: { type: 'number', description: 'Toujours 0. La TVA est ignorée : on ne saisit que le montant final.' },
    montant_ttc: { type: 'number', description: 'Égal à prix_ht (le montant final payé).' },
    fichiers_source: { type: 'array', items: { type: 'string' }, description: "Noms exacts de TOUS les fichiers dont provient cette ligne (la facture ET son attestation sur l'honneur de soutien le cas échéant)." },
    confiance: { type: 'string', enum: ['haute', 'moyenne', 'basse'], description: "Ton niveau de confiance dans l'exactitude des montants/données de cette ligne." },
  },
};
const ESQUEMA_OBS = {
  type: 'array', items: { type: 'string' },
  description: "Liste de remarques courtes et AUTONOMES pour le trésorier (une remarque = un élément). Tableau vide si rien à signaler.",
};
// Transcripción POR LÍNEAS: una cadena por línea visible del documento. El servidor las une
// con '\n', así se preserva la estructura (tabla, bloques) en lugar de un párrafo corrido.
const ESQUEMA_TRANSCRIPCION_CAMPO = {
  type: 'array',
  items: { type: 'string' },
  description: "Texte du document transcrit LIGNE PAR LIGNE : une chaîne par ligne visible, dans l'ordre de lecture (préserve la mise en page : chaque ligne du tableau, chaque bloc = une entrée). Ne fusionne PAS tout sur une seule entrée.",
};
const ESQUEMA_SOLO = {
  type: 'object', additionalProperties: false, required: ['lignes', 'observations'],
  properties: { lignes: { type: 'array', items: ESQUEMA_LIGNE }, observations: ESQUEMA_OBS },
};

const ESQUEMA_TRANSCRIPCION = {
  type: 'object', additionalProperties: false, required: ['transcription'],
  properties: { transcription: ESQUEMA_TRANSCRIPCION_CAMPO },
};
// Esquema COMBINADO de un solo documento: transcripción + líneas de la NDF + observaciones en
// una única respuesta. Lo usa la rama API del análisis por-documento (una llamada por fichero).
const ESQUEMA_DOC_COMPLETO = {
  type: 'object', additionalProperties: false, required: ['transcription', 'lignes', 'observations'],
  properties: {
    transcription: ESQUEMA_TRANSCRIPCION_CAMPO,
    lignes: { type: 'array', items: ESQUEMA_LIGNE },
    observations: ESQUEMA_OBS,
  },
};

// Datos bancarios extraídos de un RIB.
const ESQUEMA_RIB = {
  type: 'object', additionalProperties: false,
  required: ['titulaire', 'iban', 'bic', 'banque', 'domiciliation'],
  properties: {
    titulaire: { type: 'string', description: 'Nom complet du titulaire du compte.' },
    iban: { type: 'string', description: "IBAN (avec espaces tels qu'imprimés ou regroupés)." },
    bic: { type: 'string', description: 'Code BIC / SWIFT. Vide si absent.' },
    banque: { type: 'string', description: "Nom de la banque. Vide si absent." },
    domiciliation: { type: 'string', description: "Agence / domiciliation. Vide si absent." },
  },
};

// El CLI de Claude Code NO fuerza json_schema (a diferencia de la API): se pide
// el formato exacto en el prompt y se parsea de forma tolerante (parsearJSONlax).
const FORMATO_TRANSCRIPCION = `Réponds UNIQUEMENT avec un objet JSON valide, sans aucun texte ni balise autour, de la forme :
{"transcription": ["ligne 1", "ligne 2", "..."]}
Une chaîne par ligne visible du document, dans l'ordre de lecture (préserve la mise en page ; ne fusionne pas tout sur une seule entrée).`;

const FORMATO_LIGNES = `Réponds UNIQUEMENT avec un objet JSON valide, sans aucun texte ni balise autour, de la forme :
{
  "lignes": [
    {
      "article": "désignation courte de l'achat, en français",
      "date_achat": "JJ/MM/AAAA (chaîne vide si inconnue)",
      "prix_ht": 0,
      "taux_tva": 0,
      "montant_ttc": 0,
      "fichiers_source": ["nom EXACT du/des fichier(s) d'origine"],
      "confiance": "haute"
    }
  ],
  "observations": ["remarque courte et autonome pour le trésorier"]
}
Rappels : prix_ht = montant FINAL payé (TTC), taux_tva TOUJOURS 0, montant_ttc = prix_ht. "confiance" ∈ {"haute","moyenne","basse"}. "observations" = [] s'il n'y a rien à signaler. Recopie les noms de fichiers exactement comme indiqués après "### Fichier :".`;

const FORMATO_RIB = `Réponds UNIQUEMENT avec un objet JSON valide, sans aucun texte ni balise autour, de la forme :
{"titulaire": "", "iban": "", "bic": "", "banque": "", "domiciliation": ""}
Laisse la chaîne vide ("") pour tout champ absent du document.`;

// Formato COMBINADO (rama CLI): transcripción + líneas de la NDF de UN documento en una sola
// respuesta JSON. "fichiers_source" lo rellena el servidor (el modelo solo ve "document.ext"),
// por eso se le indica que deje el placeholder.
const FORMATO_DOC_COMPLETO = `Réponds UNIQUEMENT avec un objet JSON valide, sans aucun texte ni balise autour, de la forme :
{
  "transcription": ["ligne 1", "ligne 2", "..."],
  "lignes": [
    {
      "article": "désignation courte de l'achat, en français",
      "date_achat": "JJ/MM/AAAA (chaîne vide si inconnue)",
      "prix_ht": 0,
      "taux_tva": 0,
      "montant_ttc": 0,
      "fichiers_source": ["document"],
      "confiance": "haute"
    }
  ],
  "observations": ["remarque courte et autonome pour le trésorier"]
}
"transcription" : une chaîne par ligne visible du document, dans l'ordre de lecture (préserve la mise en page ; ne fusionne pas tout sur une seule entrée).
"lignes" : les dépenses de CE document. RÈGLE IMPORTANTE — un ticket de caisse ou une facture = UNE SEULE ligne, avec le MONTANT TOTAL payé (le total tout en bas du ticket). N'itemise JAMAIS les articles d'un même ticket : on ne veut pas une ligne par produit. Ne crée plusieurs lignes que si le document regroupe des achats réellement distincts qui doivent être séparés (cas rare). En cas de doute : UNE ligne avec le total.
Rappels : prix_ht = montant FINAL payé (TTC), taux_tva TOUJOURS 0, montant_ttc = prix_ht. "confiance" ∈ {"haute","moyenne","basse"}.
"observations" = [] s'il n'y a rien à signaler. Laisse "fichiers_source" à ["document"] (le serveur mettra le vrai nom).`;

const SYSTEM_PROMPT = `Tu es l'assistant comptable du Bureau de l'International (BDI) de CentraleSupélec.
On te fournit les pièces justificatives (factures, tickets de caisse, attestations sur l'honneur) d'une section pour un événement. Tu prépares les lignes d'une "Note de Frais" (NDF) qui servira au remboursement de la section par le BDI.

Règles :
- Lis attentivement chaque document fourni (image ou PDF) et transcris fidèlement son texte. Transcris LIGNE PAR LIGNE en conservant la structure d'origine : chaque ligne visible, chaque ligne de tableau et chaque bloc = une entrée distincte du tableau "transcription". Ne fusionne JAMAIS tout le document sur une seule ligne.
- Une ligne par achat. Un ticket de caisse accompagné de son attestation sur l'honneur = une seule ligne (utilise le ticket pour les montants, l'attestation pour l'objet) ; renseigne alors les DEUX fichiers dans "fichiers_source".
- Les attestations sur l'honneur seules (sans montant) ne génèrent PAS de ligne propre : sers-t'en pour préciser l'objet des autres lignes, et cite-les dans "fichiers_source" de la ligne qu'elles appuient.
- "fichiers_source" doit lister TOUS les fichiers d'où sort la ligne, pour qu'aucune pièce réellement utilisée ne soit signalée comme « non utilisée ».
- TRÈS IMPORTANT — dans les champs "fichier" et "fichiers_source", recopie EXACTEMENT le nom du fichier tel qu'il apparaît après "### Fichier :" (même orthographe, mêmes accents, même langue, même extension). Ne traduis JAMAIS et ne corrige JAMAIS le nom du fichier, même si son contenu est dans une autre langue.
- IMPORTANT — LA TVA EST TOTALEMENT IGNORÉE. On NE décompose JAMAIS la TVA et on ne fait JAMAIS de lignes séparées par taux. Pour chaque ligne : prix_ht = le MONTANT FINAL PAYÉ (toutes taxes comprises, le total qui figure sur le ticket/facture), taux_tva = 0, montant_ttc = ce même montant final. Ne calcule rien, recopie simplement le montant total payé.
- Rédige les libellés (article) en français, de façon concise.
- Pour chaque ligne, indique ta "confiance" (haute/moyenne/basse) selon la lisibilité du document et ta certitude sur les montants.
- Pour chaque document qui est une "attestation sur l'honneur" : vérifie si elle est SIGNÉE et entièrement REMPLIE (montant, date, nom du signataire). Si la signature manque ou si un champ est vide/incomplet, ajoute une remarque explicite dans "observations" (ex : « L'attestation "X" n'est pas signée » ou « L'attestation "X" est incomplète : il manque la date »).
- N'invente jamais un montant : en cas de doute, mets ta meilleure estimation, confiance 'basse', et signale-le dans "observations".
- Le trésorier vérifiera et corrigera tout avant génération : privilégie la fidélité aux documents.`;

const ctx = (ev) =>
  `Événement : ${ev.nom}\nSection (pôle) : ${ev.section || ''}\nDate de l'événement : ${ev.date || '(non précisée)'}`;
const textoRespuesta = (resp) => resp.content.find((b) => b.type === 'text')?.text || '{}';

async function bloquesDeArchivos(id, archivos, onLog) {
  const bloques = [];
  for (const nombre of archivos) {
    const ext = path.extname(nombre).toLowerCase();
    const mime = MIME_POR_EXT[ext] || 'application/pdf';
    const raw = await fs.readFile(path.join(rutaDocs(id), nombre));
    onLog?.(`📄 Lecture · ${nombre} · ${Math.max(1, Math.round(raw.length / 1024))} Ko · ${mime}`);
    const data = raw.toString('base64');
    bloques.push({ type: 'text', text: `### Fichier : ${nombre}` });
    if (mime.startsWith('image/')) bloques.push({ type: 'image', source: { type: 'base64', media_type: mime, data } });
    else bloques.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } });
  }
  return bloques;
}

// Claude devuelve la transcripción como array de líneas (ver ESQUEMA_TRANSCRIPCION_CAMPO);
// las unimos con '\n' para conservar la estructura. Compatible con respuestas antiguas (string).
const unirTranscripcion = (t) => Array.isArray(t) ? t.join('\n') : (t || '');

// Normaliza un nombre para comparar sin acentos, mayúsculas ni signos.
const normNombre = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '');

// Devuelve el nombre REAL correspondiente a uno citado por Claude en fichiers_source.
function resolverFuente(nombre, archivos, mapa) {
  if (mapa && mapa.has(nombre)) return mapa.get(nombre);
  if (archivos.includes(nombre)) return nombre;
  return archivos.find((r) => normNombre(r) === normNombre(nombre)) || nombre;
}
function remapearFuentes(lignes, archivos, mapa) {
  return (lignes || []).map((l) => Array.isArray(l.fichiers_source)
    ? { ...l, fichiers_source: l.fichiers_source.map((f) => resolverFuente(f, archivos, mapa)) }
    : l);
}

// Regla de negocio: la IVA se ignora → taux_tva=0 y montant_ttc=prix_ht (importe final pagado).
function normalizarLigne(l) {
  return { ...l, taux_tva: 0, montant_ttc: Number(l.prix_ht) || 0 };
}

// Analiza UN documento en UNA sola petición `claude -p` (o una llamada a la API en el fallback):
// la misma instancia LEE el fichero, lo transcribe LÍNEA A LÍNEA y extrae las líneas de la NDF que
// de él se derivan. Una sola llamada por documento (en vez de transcripción + estructuración por
// separado) → la mitad de procesos → más rápido, y cada documento produce sus resultados completos
// de golpe. Devuelve { transcription (string), lignes, observations }.
async function analizarDocumento(ev, id, nombre, onLog) {
  let r;
  if (motorActivo() === 'claude_code') {
    const ext = path.extname(nombre).toLowerCase() || '.pdf';
    const safe = `document${ext}`;   // nombre simple en el cwd temporal (evita problemas de quoting)
    onLog?.(`📄 Lecture + extraction · ${nombre}`);
    const prompt = [
      SYSTEM_PROMPT, '', ctx(ev), '',
      `Lis le fichier « ${safe} » présent dans le dossier courant (avec ton outil Read).`,
      '1) Transcris fidèlement TOUT son texte, LIGNE PAR LIGNE.',
      '2) À partir de CE document, construis les lignes de la Note de Frais qui en découlent.',
      '', FORMATO_DOC_COMPLETO,
    ].join('\n');
    r = parsearJSONlax(await ejecutarClaude({
      prompt, modelo: modeloClaude,
      ficheros: [{ nombre: safe, ruta: path.join(rutaDocs(id), nombre) }],
      permitirRead: true, onLog,
    }));
  } else {
    // --- Fallback API : document en base64 + sortie structurée combinée (json_schema) ---
    const content = [
      { type: 'text', text: `${ctx(ev)}\n\nLis le document ci-dessous : transcris fidèlement son texte intégral ET construis les lignes de la Note de Frais qui en découlent.` },
      ...(await bloquesDeArchivos(id, [nombre], onLog)),
    ];
    onLog?.(`⏳ Envoi à Claude (${modeloClaude})…`);
    const resp = await anthropic.messages.create({
      model: modeloClaude, max_tokens: 16000, system: SYSTEM_PROMPT,
      output_config: outputConfig(ESQUEMA_DOC_COMPLETO), messages: [{ role: 'user', content }],
    });
    r = JSON.parse(textoRespuesta(resp));
  }
  // Esta pasada concierne a UN solo fichero → se fuerza fichiers_source al nombre real (el modelo
  // solo ve un "document.ext") y se normaliza IVA/importe.
  const lignes = (r.lignes || []).map((l) => normalizarLigne({ ...l, fichiers_source: [nombre] }));
  const observations = Array.isArray(r.observations) ? r.observations : (r.observations ? [r.observations] : []);
  return { transcription: unirTranscripcion(r.transcription), lignes, observations };
}

// Analiza un documento con UN reintento automático: si la lectura falla o no devuelve texto, se
// reintenta una segunda vez. Si el segundo intento también falla/vacío → error (ventana flotante).
async function analizarDocumentoConReintento(ev, id, nombre, onLog) {
  let ultimoError = null;
  for (let intento = 1; intento <= 2; intento++) {
    try {
      const res = await analizarDocumento(ev, id, nombre, onLog);
      if ((res.transcription || '').trim()) return res;   // lectura correcta
      ultimoError = new Error(`Le document « ${nombre} » a été lu mais aucun texte n'a été extrait (0 caractère).`);
      onLog?.(`⚠ ${nombre} · 0 caractère${intento < 2 ? ' · nouvelle tentative…' : ''}`);
    } catch (e) {
      ultimoError = e;
      onLog?.(`⚠ ${nombre} · échec${intento < 2 ? ' · nouvelle tentative…' : ''} : ${e.message}`);
    }
  }
  throw new Error(`Le document « ${nombre} » n'a pas pu être analysé après 2 tentatives. ${ultimoError?.message || ''}`.trim());
}

// Análisis INCREMENTAL con PARALELISMO acotado (pool de CONCURRENCIA_ANALISIS workers). Para cada
// documento, una sola instancia `claude -p` lo lee, lo transcribe Y extrae sus líneas de la NDF; el
// resultado (transcripción + líneas) se empuja en directo (`onDoc`) EN CUANTO ese documento termina,
// sin esperar al resto → el tesorero ve aparecer los resultados documento a documento. Varios a la
// vez solapan la latencia de la API y dividen el tiempo total. El RESULTADO FINAL que se devuelve va
// REORDENADO según el orden original de los documentos (los workers terminan en desorden).
async function analizarConClaude(ev, id, archivos, onLog, onDoc) {
  const concur = Math.min(CONCURRENCIA_ANALISIS, archivos.length);
  onLog?.(`🔎 Analyse de ${archivos.length} document(s)${concur > 1 ? ` · ${concur} en parallèle` : ''}…`);
  const porDoc = new Map();   // nombre -> { transcription, lignes, observations }
  const cola = [...archivos];
  let hechos = 0;
  async function worker() {
    for (;;) {
      const nombre = cola.shift();
      if (nombre === undefined) return;
      // El documento pudo borrarse a mitad del análisis (el usuario lo quitó): se ignora.
      const existe = await fs.access(path.join(rutaDocs(id), nombre)).then(() => true, () => false);
      if (!existe) { onLog?.(`⏭ ${nombre} · supprimé en cours d'analyse, ignoré`); continue; }
      onLog?.(`📝 Analyse · ${nombre}`);
      const res = await analizarDocumentoConReintento(ev, id, nombre, onLog);
      porDoc.set(nombre, res);
      onLog?.(`✓ ${nombre} · ${res.transcription.length} car. · ${res.lignes.length} ligne(s) (${++hechos}/${archivos.length})`);
      await onDoc?.(nombre, res.transcription, res.lignes, res.observations);   // en directo, sin esperar al resto
    }
  }
  await Promise.all(Array.from({ length: concur }, worker));
  // Resultado final ORDENADO por el orden original de los documentos.
  const ocr = {}, lignes = [], observations = [];
  for (const nombre of archivos) {
    const res = porDoc.get(nombre);
    if (!res) continue;
    ocr[nombre] = res.transcription;
    lignes.push(...res.lignes);
    observations.push(...res.observations);
  }
  onLog?.(`📥 ${lignes.length} ligne(s) · ${observations.length} remarque(s) au total`);
  return { ocr, lignes, observations };
}

// Transcribe UN seul document. Es la unidad del análisis secuencial y también el botón
// « Releer ce document » de la pestaña Analyse.
async function transcribirDocumento(ev, id, nombre, onLog) {
  // --- Motor por defecto: Claude Code headless lit le fichier avec son outil Read ---
  if (motorActivo() === 'claude_code') {
    const ext = path.extname(nombre).toLowerCase() || '.pdf';
    const safe = `document${ext}`;   // nom simple dans le cwd temporaire (évite tout souci de quoting)
    onLog?.(`📄 Lecture via Read · ${nombre}`);
    const prompt = [
      SYSTEM_PROMPT, '', ctx(ev), '',
      `Lis le fichier « ${safe} » présent dans le dossier courant (avec ton outil Read) et transcris fidèlement TOUT son texte, LIGNE PAR LIGNE.`,
      '', FORMATO_TRANSCRIPCION,
    ].join('\n');
    const result = await ejecutarClaude({
      prompt, modelo: modeloClaude,
      ficheros: [{ nombre: safe, ruta: path.join(rutaDocs(id), nombre) }],
      permitirRead: true, onLog,
    });
    const r = parsearJSONlax(result);
    return unirTranscripcion(r.transcription);
  }
  // --- Fallback API : document en base64 + sortie structurée (json_schema) ---
  const content = [
    { type: 'text', text: `${ctx(ev)}\n\nLis le document ci-dessous et transcris fidèlement son texte intégral.` },
    ...(await bloquesDeArchivos(id, [nombre], onLog)),
  ];
  onLog?.(`⏳ Envoi à Claude (${modeloClaude})…`);
  const resp = await anthropic.messages.create({
    model: modeloClaude, max_tokens: 16000, system: SYSTEM_PROMPT,
    output_config: outputConfig(ESQUEMA_TRANSCRIPCION), messages: [{ role: 'user', content }],
  });
  const r = JSON.parse(textoRespuesta(resp));
  return unirTranscripcion(r.transcription);
}

async function estructurarDesdeTextos(ev, ocr) {
  const bloques = Object.entries(ocr).map(([nom, txt]) => `### Fichier : ${nom}\n${txt || '(vide)'}`).join('\n\n---\n\n');
  let r;
  if (motorActivo() === 'claude_code') {
    // Solo texto : pas de fichier, pas d'outil Read.
    const prompt = [
      SYSTEM_PROMPT, '', ctx(ev), '',
      'Voici les transcriptions des pièces :', '', bloques, '',
      'À partir de ces transcriptions, construis les lignes de la Note de Frais.',
      '', FORMATO_LIGNES,
    ].join('\n');
    const result = await ejecutarClaude({ prompt, modelo: modeloClaude, permitirRead: false });
    r = parsearJSONlax(result);
  } else {
    const resp = await anthropic.messages.create({
      model: modeloClaude, max_tokens: 16000, system: SYSTEM_PROMPT,
      output_config: outputConfig(ESQUEMA_SOLO),
      messages: [{ role: 'user', content: `${ctx(ev)}\n\nVoici les transcriptions des pièces :\n\n${bloques}` }],
    });
    r = JSON.parse(textoRespuesta(resp));
  }
  // Mismo riesgo de nombres "corregidos" por Claude: se remapean a las claves reales del OCR.
  const lignes = remapearFuentes(r.lignes || [], Object.keys(ocr), new Map());
  return { lignes, observations: r.observations || [] };
}

// Extrae los datos bancarios de un RIB (PDF o imagen, base64).
async function extraerRIB(nombre, contenidoBase64) {
  const ext = path.extname(nombre).toLowerCase() || '.pdf';
  const SYS_RIB = "Tu lis un RIB (relevé d'identité bancaire) et tu en extrais les informations. Sois fidèle ; laisse vide ce qui est absent.";
  if (motorActivo() === 'claude_code') {
    const safe = `rib${ext}`;
    const prompt = [
      SYS_RIB, '',
      `Lis le fichier « ${safe} » présent dans le dossier courant (avec ton outil Read) et extrais ses informations bancaires.`,
      '', FORMATO_RIB,
    ].join('\n');
    const result = await ejecutarClaude({
      prompt, modelo: modeloClaude,
      ficheros: [{ nombre: safe, base64: contenidoBase64 }],
      permitirRead: true, timeout: 120000,
    });
    return parsearJSONlax(result);
  }
  // --- Fallback API ---
  const mime = MIME_POR_EXT[ext] || 'application/pdf';
  const bloque = mime.startsWith('image/')
    ? { type: 'image', source: { type: 'base64', media_type: mime, data: contenidoBase64 } }
    : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: contenidoBase64 } };
  const resp = await anthropic.messages.create({
    model: modeloClaude, max_tokens: 1500,
    system: SYS_RIB,
    output_config: outputConfig(ESQUEMA_RIB),
    messages: [{ role: 'user', content: [{ type: 'text', text: "Extrais les informations bancaires de ce RIB." }, bloque] }],
  });
  return JSON.parse(textoRespuesta(resp));
}

function construirDatos(ev, extraido) {
  const seccion = ev.section || '';
  const annee = (ev.date && ev.date.slice(0, 4)) || String(new Date().getFullYear());
  const nomGuiones = (ev.nom || '').trim().replace(/\s+/g, '-');
  const obs = extraido.observations;
  return {
    numero_ndf: `NDF_${nomGuiones}_${annee}`,
    date_emission: new Date().toLocaleDateString('fr-FR'),
    nom_membre: ev.membre || '',
    iban: ev.iban || '',
    section: seccion,
    asso: `Bureau de l'International (${seccion})`,
    adresse: ADRESSE_BDI,
    date_evenement: ev.date || '',
    // La TVA est ignorée : on force taux_tva=0 et montant_ttc=prix_ht (montant final payé).
    lignes: (extraido.lignes || []).map(normalizarLigne),
    observations: Array.isArray(obs) ? obs : obs ? [obs] : [],
    signature: '',          // firma del tesorero (fichero en /Signatures)
    signature_membre: '',   // firma del miembro
    ordre_pieces: [],       // orden de los adjuntos en el PDF final
    analizado: Date.now(),
  };
}

// ---------- Servidor web ----------
const app = express();
app.use(express.json({ limit: '120mb' }));
app.use(express.static(DIR_WEB));

app.use('/api', (req, res, next) => {
  if (req.path.includes('analizar') || req.path.includes('regenerar') || req.path.includes('extraire')) {
    if (!motorActivo()) {
      // Sin Claude Code disponible y sin fallback de API utilizable → error claro.
      const tipo = (apiFallback && !anthropicApiKey) ? 'clave_falta' : 'claude_code_falta';
      const error = tipo === 'clave_falta'
        ? 'Le repli vers l’API est activé mais aucune clé API n’est renseignée. Renseigne-la dans Réglages (⚙).'
        : 'Claude Code introuvable. Installe et connecte Claude Code (claude login), ou active le repli vers l’API dans Réglages (⚙).';
      return res.status(500).json({ error, tipo });
    }
  }
  next();
});

// ---------- Journal d'analyse : logs en direct (SSE) ----------
// Cada evento tiene un buffer de logs y suscriptores SSE. emitLog escribe a la
// consola del servidor Y los envía al cliente, para que se vean en la pestaña Analyse.
const logBuffer = new Map();   // id -> [{ t, msg }]
const logSubs = new Map();     // id -> Set<res>
// Instantánea de `ev.datos` mientras el análisis está en curso (esqueleto + líneas ya extraídas).
// Permite que una vista reabierta o recargada a mitad del análisis recupere el estado actual de la
// NDF al conectarse al SSE, sin esperar al final. Se borra al iniciar/terminar el análisis.
const estructBuffer = new Map();   // id -> datos
// Eventos cuyo análisis está EN CURSO en el servidor. Sirve para que, si el usuario
// sale del evento y vuelve (o recarga), la app sepa que sigue analizándose y reenganche
// el stream en directo en lugar de perder el progreso. El análisis NO se corta al salir:
// la petición /analizar sigue corriendo en el servidor hasta terminar y guardar.
const analisisEnCurso = new Set();   // id en análisis
function resetLog(id) { logBuffer.set(id, []); estructBuffer.delete(id); }
function emitLog(id, msg) {
  const linea = { t: Date.now(), msg };
  console.log(`[${id}] ${msg}`);
  const buf = logBuffer.get(id) || [];
  buf.push(linea);
  while (buf.length > 200) buf.shift();
  logBuffer.set(id, buf);
  const subs = logSubs.get(id);
  if (subs) for (const r of subs) { try { r.write(`data: ${JSON.stringify(linea)}\n\n`); } catch { /* cliente cerrado */ } }
}
// Envía un evento ESTRUCTURADO por SSE a los suscriptores en directo (no se guarda en el
// buffer de logs). Lo usa el análisis para empujar cada transcripción en cuanto termina
// (`tipo:'ocr'`) y avisar del final (`tipo:'fin'`), sin esperar al resto de documentos.
function emitEvento(id, obj) {
  const linea = { t: Date.now(), ...obj };
  const subs = logSubs.get(id);
  if (subs) for (const r of subs) { try { r.write(`data: ${JSON.stringify(linea)}\n\n`); } catch { /* cliente cerrado */ } }
}

// ---------- Apagado SOLO al cerrar la ventana del navegador ----------
// El cliente manda un "beacon" al cerrar la pestaña. Damos una pequeña
// gracia para sobrevivir a un F5 (recarga): si vuelve un ping, se cancela.
let apagadoPendiente = null;
app.post('/api/ping', (req, res) => {
  if (apagadoPendiente) { clearTimeout(apagadoPendiente); apagadoPendiente = null; }
  res.json({ ok: true });
});
app.post('/api/cerrar', (req, res) => {
  res.json({ ok: true });
  if (apagadoPendiente) clearTimeout(apagadoPendiente);
  apagadoPendiente = setTimeout(() => {
    console.log('\n  Ventana cerrada — apagando el servidor. ¡Hasta luego!\n');
    process.exit(0);
  }, 4000); // si es un F5, el nuevo ping cancela esto
});

// ---------- Réglages (moteur · clé API · modèle) ----------
// La clave nunca se devuelve entera: solo si está puesta y una versión enmascarada.
function vistaSettings() {
  return {
    motor: motorActivo(),                                  // 'claude_code' | 'api' | null
    claudeCode: { disponible: claudeDisponible(), version: versionClaude() },
    apiFallback,
    apiKeySet: !!anthropicApiKey, apiKeyMask: maskKey(anthropicApiKey),
    model: modeloClaude, models: MODELOS,
  };
}
app.get('/api/settings', (req, res) => res.json(vistaSettings()));
// App local: el botón «ojo» pide la clave entera para mostrarla al propio usuario en su máquina.
app.get('/api/settings/revelar', (req, res) => res.json({ apiKey: anthropicApiKey || '' }));

app.put('/api/settings', async (req, res) => {
  const b = req.body || {};
  const cambios = {};
  if (typeof b.apiKey === 'string' && b.apiKey.trim()) {
    anthropicApiKey = b.apiKey.trim();
    anthropic = new Anthropic({ apiKey: anthropicApiKey }); // recrea el cliente en caliente
    cambios.ANTHROPIC_API_KEY = anthropicApiKey;
  }
  if (typeof b.model === 'string' && MODELOS.some((m) => m.id === b.model)) {
    modeloClaude = b.model;
    cambios.ANTHROPIC_MODEL = modeloClaude;
  }
  if (typeof b.apiFallback === 'boolean') {
    apiFallback = b.apiFallback;
    cambios.API_FALLBACK = apiFallback ? '1' : '0';
  }
  try {
    if (Object.keys(cambios).length) await actualizarEnv(cambios);
  } catch (e) { return res.status(500).json({ error: 'No se pudo guardar en .env : ' + e.message }); }
  res.json(vistaSettings());
});

// Prueba el motor SIN persistir. Por defecto prueba el motor ACTIVO :
//   • claude_code → lance un `claude -p` minimal (vérifie installation + login).
//   • api         → ping minimal de l'API avec la clé/modèle (du corps ou actifs).
// Le corps peut forcer `motor` ('claude_code'|'api') pour tester l'un ou l'autre.
app.post('/api/settings/test', async (req, res) => {
  const b = req.body || {};
  const model = (typeof b.model === 'string' && MODELOS.some((m) => m.id === b.model)) ? b.model : modeloClaude;
  const motor = (b.motor === 'claude_code' || b.motor === 'api') ? b.motor : (claudeDisponible() ? 'claude_code' : 'api');
  if (motor === 'claude_code') {
    try {
      const r = await ejecutarClaude({ prompt: 'Réponds exactement : OK', modelo: model, permitirRead: false, timeout: 45000 });
      return res.json({ ok: true, motor, model, result: r.slice(0, 80) });
    } catch (e) { return res.status(400).json({ ok: false, motor, error: e.message, tipo: clasificarErrorIA(e) }); }
  }
  const key = (typeof b.apiKey === 'string' && b.apiKey.trim()) ? b.apiKey.trim() : anthropicApiKey;
  if (!key) return res.status(400).json({ ok: false, motor, error: 'Falta la clé API.', tipo: 'clave_falta' });
  try {
    const cli = new Anthropic({ apiKey: key });
    await cli.messages.create({ model, max_tokens: 8, messages: [{ role: 'user', content: 'ping' }] });
    res.json({ ok: true, motor, model });
  } catch (e) { res.status(400).json({ ok: false, motor, error: e.message, tipo: clasificarErrorIA(e) }); }
});

// Vista pública del evento.
function vista(ev, archivos) {
  return {
    id: ev.id, nom: ev.nom, section: ev.section, membre: ev.membre, date: ev.date,
    iban: ev.iban || '',
    budget: ev.budget ?? null, estado: ev.estado || 'brouillon', paye: !!ev.paye,
    creado: ev.creado, archivos, datos: ev.datos || null, ocr: ev.ocr || {},
    signee: ev.signee || null,
    analizando: analisisEnCurso.has(ev.id),   // análisis en curso en el servidor (para reenganchar al volver)
  };
}

app.get('/api/eventos', async (req, res) => {
  const ids = await fs.readdir(DIR_DOSSIERS).catch(() => []);
  const eventos = [];
  for (const id of ids) {
    if (!idValido(id)) continue;
    const ev = await leerEvento(id);
    if (ev) eventos.push({
      id: ev.id, nom: ev.nom, section: ev.section, membre: ev.membre, date: ev.date,
      budget: ev.budget ?? null, estado: ev.estado || 'brouillon', paye: !!ev.paye,
      creado: ev.creado, nArchivos: (await listarArchivos(id)).length,
    });
  }
  eventos.sort((a, b) => (b.creado || 0) - (a.creado || 0));
  res.json(eventos);
});

app.post('/api/eventos', async (req, res) => {
  const { nom, section, membre, date, budget, iban } = req.body || {};
  if (!nom || !section) return res.status(400).json({ error: "Faltan el nombre del evento o la section (pôle)." });
  const base = slug(`${section}_${nom}`);
  let id = base, n = 1;
  while (await fs.access(rutaEvento(id)).then(() => true, () => false)) id = `${base}_${++n}`;
  await fs.mkdir(rutaDocs(id), { recursive: true });
  const ev = {
    id, nom: nom.trim(), section: section.trim(), membre: (membre || '').trim(),
    date: (date || '').trim(), iban: (iban || '').trim(),
    budget: (budget === '' || budget == null) ? null : Number(budget),
    estado: 'brouillon', paye: false,
    creado: Date.now(), ocr: {}, datos: null,
  };
  await guardarEvento(id, ev);
  res.json(vista(ev, []));
});

app.get('/api/eventos/:id', async (req, res) => {
  const { id } = req.params;
  if (!idValido(id)) return res.status(400).json({ error: 'ID no válido.' });
  const ev = await leerEvento(id);
  if (!ev) return res.status(404).json({ error: 'Evento no encontrado.' });
  res.json(vista(ev, await listarArchivos(id)));
});

// Actualizar metadatos del evento (budget, estado, paye, etc.).
app.put('/api/eventos/:id', async (req, res) => {
  const { id } = req.params;
  if (!idValido(id)) return res.status(400).json({ error: 'ID no válido.' });
  const ev = await leerEvento(id);
  if (!ev) return res.status(404).json({ error: 'Evento no encontrado.' });
  const b = req.body || {};
  if ('estado' in b) ev.estado = b.estado;
  if ('paye' in b) ev.paye = !!b.paye;
  if ('budget' in b) ev.budget = (b.budget === '' || b.budget == null) ? null : Number(b.budget);
  if ('membre' in b) ev.membre = b.membre;
  if ('iban' in b) ev.iban = (b.iban || '').trim();
  // Editables desde la tarjeta de info del evento (el id/carpeta NO cambia).
  if ('nom' in b) ev.nom = (b.nom || '').trim();
  if ('section' in b) ev.section = (b.section || '').trim();
  if ('date' in b) ev.date = (b.date || '').trim();
  await guardarEvento(id, ev);
  res.json(vista(ev, await listarArchivos(id)));
});

app.delete('/api/eventos/:id', async (req, res) => {
  const { id } = req.params;
  if (!idValido(id)) return res.status(400).json({ error: 'ID no válido.' });
  await fs.rm(rutaEvento(id), { recursive: true, force: true });
  res.json({ ok: true });
});

app.post('/api/eventos/:id/archivos', async (req, res) => {
  const { id } = req.params;
  if (!idValido(id)) return res.status(400).json({ error: 'ID no válido.' });
  const { nombre, contenidoBase64 } = req.body || {};
  if (!nombre || !contenidoBase64) return res.status(400).json({ error: 'Falta nombre o contenido.' });
  await fs.mkdir(rutaDocs(id), { recursive: true });
  const buf = Buffer.from(contenidoBase64, 'base64');

  // Detección de duplicados por hash: si ya existe un documento idéntico, se rechaza.
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  for (const existente of await listarArchivos(id)) {
    const otro = await fs.readFile(path.join(rutaDocs(id), existente)).catch(() => null);
    if (otro && crypto.createHash('sha256').update(otro).digest('hex') === hash) {
      return res.status(409).json({ error: 'duplicado', duplicado: existente });
    }
  }

  const seguro = path.basename(nombre);
  await fs.writeFile(path.join(rutaDocs(id), seguro), buf);
  res.json({ ok: true, nombre: seguro });
});

app.delete('/api/eventos/:id/archivos/:nombre', async (req, res) => {
  const { id, nombre } = req.params;
  if (!idValido(id)) return res.status(400).json({ error: 'ID no válido.' });
  await fs.rm(path.join(rutaDocs(id), path.basename(nombre)), { force: true });
  res.json({ ok: true });
});

app.get('/api/eventos/:id/archivos/:nombre', async (req, res) => {
  const { id } = req.params;
  if (!idValido(id)) return res.status(400).end();
  // inline → el navegador renderiza el PDF dentro del <iframe> en vez de forzar la descarga.
  res.setHeader('Content-Disposition', 'inline');
  res.sendFile(path.join(rutaDocs(id), path.basename(req.params.nombre)));
});

// ---------- NDF firmada (_signee) : se guarda en la carpeta del evento ----------
// Misma carpeta que la NDF vierge (<numero_ndf>.pdf), con el sufijo _signee.
const EXT_SIGNEE = new Set(['.pdf', '.jpg', '.jpeg', '.png']);
app.post('/api/eventos/:id/signee', async (req, res) => {
  const { id } = req.params;
  if (!idValido(id)) return res.status(400).json({ error: 'ID no válido.' });
  const ev = await leerEvento(id);
  if (!ev) return res.status(404).json({ error: 'Evento no encontrado.' });
  const { nombre, contenidoBase64 } = req.body || {};
  if (!nombre || !contenidoBase64) return res.status(400).json({ error: 'Falta nombre o contenido.' });
  const ext = path.extname(nombre).toLowerCase();
  if (!EXT_SIGNEE.has(ext)) return res.status(400).json({ error: 'Solo se admiten PDF o imágenes (jpg/png).' });
  // Borra la versión firmada anterior si existe.
  if (ev.signee) await fs.rm(path.join(rutaEvento(id), path.basename(ev.signee)), { force: true });
  const base = (ev.datos && ev.datos.numero_ndf) || 'Note_de_Frais';
  const destino = path.basename(`${base}_signee${ext}`);
  await fs.writeFile(path.join(rutaEvento(id), destino), Buffer.from(contenidoBase64, 'base64'));
  ev.signee = destino;
  await guardarEvento(id, ev);
  res.json({ ok: true, signee: destino });
});
app.get('/api/eventos/:id/signee', async (req, res) => {
  const { id } = req.params;
  if (!idValido(id)) return res.status(400).end();
  const ev = await leerEvento(id);
  if (!ev || !ev.signee) return res.status(404).end();
  res.sendFile(path.join(rutaEvento(id), path.basename(ev.signee)));
});
app.delete('/api/eventos/:id/signee', async (req, res) => {
  const { id } = req.params;
  if (!idValido(id)) return res.status(400).json({ error: 'ID no válido.' });
  const ev = await leerEvento(id);
  if (!ev) return res.status(404).json({ error: 'Evento no encontrado.' });
  if (ev.signee) { await fs.rm(path.join(rutaEvento(id), path.basename(ev.signee)), { force: true }); ev.signee = null; await guardarEvento(id, ev); }
  res.json({ ok: true });
});
// Abre el Explorador de Windows seleccionando la NDF signée (en la carpeta del evento).
app.post('/api/eventos/:id/signee/abrir-carpeta', async (req, res) => {
  const { id } = req.params;
  if (!idValido(id)) return res.status(400).json({ error: 'ID no válido.' });
  if (process.platform !== 'win32') return res.status(501).json({ error: 'Solo disponible en Windows.' });
  const ev = await leerEvento(id);
  if (!ev || !ev.signee) return res.status(404).json({ error: 'NDF signée no encontrada.' });
  const ruta = path.join(rutaEvento(id), path.basename(ev.signee));
  if (!await fs.access(ruta).then(() => true, () => false)) return res.status(404).json({ error: 'Archivo no encontrado.' });
  execFile('explorer.exe', ['/select,', ruta], () => res.json({ ok: true }));
});

// Abre el Explorador de Windows con el documento seleccionado (solo Windows).
app.post('/api/eventos/:id/archivos/:nombre/abrir-carpeta', async (req, res) => {
  const { id } = req.params;
  if (!idValido(id)) return res.status(400).json({ error: 'ID no válido.' });
  if (process.platform !== 'win32') return res.status(501).json({ error: 'Solo disponible en Windows.' });
  const ruta = path.join(rutaDocs(id), path.basename(req.params.nombre));
  if (!await fs.access(ruta).then(() => true, () => false)) return res.status(404).json({ error: 'Archivo no encontrado.' });
  execFile('explorer.exe', ['/select,', ruta], () => res.json({ ok: true }));
});

app.post('/api/eventos/:id/archivos/:nombre/renombrar', async (req, res) => {
  const { id, nombre } = req.params;
  if (!idValido(id)) return res.status(400).json({ error: 'ID no válido.' });
  const ev = await leerEvento(id);
  if (!ev) return res.status(404).json({ error: 'Evento no encontrado.' });
  const viejo = path.basename(nombre);
  let nuevo = path.basename((req.body && req.body.nuevoNombre) || '').trim().replace(/[\\/]/g, '_');
  if (!nuevo) return res.status(400).json({ error: 'Nombre vacío.' });
  if (!path.extname(nuevo)) nuevo += path.extname(viejo);
  if (nuevo === viejo) return res.json({ ok: true, nombre: viejo });
  const dir = rutaDocs(id);
  if (await fs.access(path.join(dir, nuevo)).then(() => true, () => false))
    return res.status(409).json({ error: 'Ya existe un documento con ese nombre.' });
  try {
    await fs.rename(path.join(dir, viejo), path.join(dir, nuevo));
    if (ev.ocr && Object.prototype.hasOwnProperty.call(ev.ocr, viejo)) { ev.ocr[nuevo] = ev.ocr[viejo]; delete ev.ocr[viejo]; }
    if (ev.datos) {
      for (const l of ev.datos.lignes || []) {
        if (l.fichier_source === viejo) l.fichier_source = nuevo;
        if (Array.isArray(l.fichiers_source)) l.fichiers_source = l.fichiers_source.map((x) => x === viejo ? nuevo : x);
      }
      if (Array.isArray(ev.datos.ordre_pieces)) ev.datos.ordre_pieces = ev.datos.ordre_pieces.map((x) => x === viejo ? nuevo : x);
    }
    await guardarEvento(id, ev);
    res.json({ ok: true, nombre: nuevo });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/eventos/:id/archivos/:nombre/reextraer', async (req, res) => {
  const { id, nombre } = req.params;
  if (!idValido(id)) return res.status(400).json({ error: 'ID no válido.' });
  const ev = await leerEvento(id);
  if (!ev) return res.status(404).json({ error: 'Evento no encontrado.' });
  const nom = path.basename(nombre);
  if (!await fs.access(path.join(rutaDocs(id), nom)).then(() => true, () => false))
    return res.status(404).json({ error: 'Archivo no encontrado.' });
  try {
    resetLog(id);
    emitLog(id, `🔁 Relecture · ${nom} · modèle ${modeloClaude}`);
    const transcription = await transcribirDocumento(ev, id, nom, (m) => emitLog(id, m));
    ev.ocr = ev.ocr || {};
    ev.ocr[nom] = transcription;
    await guardarEvento(id, ev);
    emitLog(id, `✅ ${nom} · transcription ${transcription.length} caractères`);
    res.json({ ok: true, transcription });
  } catch (e) { emitLog(id, `❌ Erreur · ${e.message}`); console.error('Error al re-extraer:', e); res.status(500).json({ error: e.message, tipo: clasificarErrorIA(e) }); }
});

// Stream SSE del journal d'analyse de un evento (logs en direct para la pestaña Analyse).
app.get('/api/eventos/:id/logs', (req, res) => {
  const { id } = req.params;
  if (!idValido(id)) return res.status(400).end();
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  res.write(': ok\n\n'); // abre el stream
  for (const linea of logBuffer.get(id) || []) res.write(`data: ${JSON.stringify(linea)}\n\n`);
  // Si hay un análisis en curso, manda el estado actual de la NDF (esqueleto + líneas ya hechas)
  // para que una vista reabierta/recargada lo adopte y siga recibiendo los documentos restantes.
  const snap = estructBuffer.get(id);
  if (snap) res.write(`data: ${JSON.stringify({ tipo: 'datos', datos: snap })}\n\n`);
  let set = logSubs.get(id);
  if (!set) { set = new Set(); logSubs.set(id, set); }
  set.add(res);
  req.on('close', () => { set.delete(res); });
});

app.post('/api/eventos/:id/analizar', async (req, res) => {
  const { id } = req.params;
  if (!idValido(id)) return res.status(400).json({ error: 'ID no válido.' });
  const ev = await leerEvento(id);
  if (!ev) return res.status(404).json({ error: 'Evento no encontrado.' });
  // Un único análisis por evento a la vez: si ya hay uno corriendo, no se lanza otro
  // (evita que dos análisis escriban el mismo event.json). El cliente se reengancha al stream.
  if (analisisEnCurso.has(id)) return res.status(409).json({ error: 'Analyse déjà en cours.', tipo: 'analyse_en_cours' });
  try {
    const archivos = await listarArchivos(id);
    if (archivos.length === 0) return res.status(400).json({ error: 'No hay documentos que analizar.' });
    resetLog(id);
    analisisEnCurso.add(id);
    emitLog(id, `🚀 Analyse de ${archivos.length} document(s) · modèle ${modeloClaude}`);
    // Parte de cero: así, al volver al evento a medio análisis, solo se ven los ya hechos.
    // Se construye YA el esqueleto de la NDF (sin líneas), conservando los ajustes manuales que
    // no dependen del análisis; las líneas se irán AÑADIENDO documento a documento (incremental).
    ev.ocr = {};
    const previo = ev.datos || {};
    ev.datos = construirDatos(ev, { lignes: [], observations: [] });
    ev.datos.signature = previo.signature || '';
    ev.datos.signature_membre = previo.signature_membre || '';
    ev.datos.iban = previo.iban || ev.iban || '';
    ev.datos.ordre_pieces = archivos.slice(); // orden por defecto = orden actual
    await escribirJSON(rutaJSON(id), ev);
    estructBuffer.set(id, ev.datos);
    emitEvento(id, { tipo: 'datos', datos: ev.datos });   // el cliente adopta el esqueleto vacío
    // onDoc: en cuanto un documento termina, se añaden SUS líneas a la NDF y se empuja en directo
    // (transcripción + líneas) ANTES de pasar al siguiente; se persiste tras cada documento.
    let cadenaGuardado = Promise.resolve();
    const extraido = await analizarConClaude(ev, id, archivos, (m) => emitLog(id, m), (nombre, texto, lignes, observations) => {
      // En vivo (orden de finalización): se añaden las líneas de ESTE documento y se empujan al cliente.
      ev.ocr[nombre] = texto;
      ev.datos.lignes.push(...lignes);
      if (observations.length) ev.datos.observations.push(...observations);
      estructBuffer.set(id, ev.datos);
      emitEvento(id, { tipo: 'doc', nombre, texto, lignes, observations });
      cadenaGuardado = cadenaGuardado.then(() => escribirJSON(rutaJSON(id), ev)).catch(() => {});
      return cadenaGuardado;
    });
    await cadenaGuardado;   // espera a que termine la última escritura incremental
    // Resultado final REORDENADO por orden de documento (los pushes en vivo iban en orden de fin).
    ev.ocr = extraido.ocr;
    ev.datos.lignes = extraido.lignes;
    ev.datos.observations = extraido.observations;
    ev.datos.analizado = Date.now();
    await guardarEvento(id, ev);
    estructBuffer.set(id, ev.datos);
    emitEvento(id, { tipo: 'datos', datos: ev.datos });   // empuja el orden final al cliente
    emitLog(id, '✅ Analyse terminée');
    emitEvento(id, { tipo: 'fin' });   // avisa a una vista reabierta para que recargue datos/NDF
    res.json({ datos: ev.datos, ocr: ev.ocr });
  } catch (e) { emitLog(id, `❌ Erreur · ${e.message}`); emitEvento(id, { tipo: 'fin' }); console.error('Error al analizar:', e); res.status(500).json({ error: e.message, tipo: clasificarErrorIA(e) }); }
  finally { analisisEnCurso.delete(id); }
});

app.put('/api/eventos/:id/ocr', async (req, res) => {
  const { id } = req.params;
  if (!idValido(id)) return res.status(400).json({ error: 'ID no válido.' });
  const ev = await leerEvento(id);
  if (!ev) return res.status(404).json({ error: 'Evento no encontrado.' });
  ev.ocr = req.body || {};
  await guardarEvento(id, ev);
  res.json({ ok: true });
});

app.post('/api/eventos/:id/regenerar', async (req, res) => {
  const { id } = req.params;
  if (!idValido(id)) return res.status(400).json({ error: 'ID no válido.' });
  const ev = await leerEvento(id);
  if (!ev) return res.status(404).json({ error: 'Evento no encontrado.' });
  try {
    if (!ev.ocr || Object.keys(ev.ocr).length === 0) return res.status(400).json({ error: 'No hay transcripciones que analizar.' });
    const extraido = await estructurarDesdeTextos(ev, ev.ocr);
    const previo = ev.datos || {};
    ev.datos = construirDatos(ev, extraido);
    ev.datos.signature = previo.signature || '';
    ev.datos.signature_membre = previo.signature_membre || '';
    ev.datos.iban = previo.iban || ev.iban || '';
    ev.datos.ordre_pieces = (previo.ordre_pieces && previo.ordre_pieces.length) ? previo.ordre_pieces : (await listarArchivos(id));
    await guardarEvento(id, ev);
    res.json({ datos: ev.datos, ocr: ev.ocr });
  } catch (e) { console.error('Error al regenerar:', e); res.status(500).json({ error: e.message, tipo: clasificarErrorIA(e) }); }
});

app.put('/api/eventos/:id/datos', async (req, res) => {
  const { id } = req.params;
  if (!idValido(id)) return res.status(400).json({ error: 'ID no válido.' });
  const ev = await leerEvento(id);
  if (!ev) return res.status(404).json({ error: 'Evento no encontrado.' });
  ev.datos = req.body || {};
  await guardarEvento(id, ev);
  res.json({ ok: true });
});

// ---------- Personas (base de datos de RIB en data/people.json) ----------
async function leerPersonas() { return (await leerJSON(RUTA_PERSONAS, [])) || []; }
async function guardarPersonas(lista) { await escribirJSON(RUTA_PERSONAS, lista); }
const pid = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

app.get('/api/personnes', async (req, res) => res.json(await leerPersonas()));

app.post('/api/personnes', async (req, res) => {
  const b = req.body || {};
  const nom = (b.nom || b.titulaire || '').trim();
  if (!nom) return res.status(400).json({ error: 'Falta el nombre.' });
  const lista = await leerPersonas();
  const p = {
    id: pid(), nom,
    titulaire: (b.titulaire || nom).trim(),
    iban: (b.iban || '').trim(), bic: (b.bic || '').trim(),
    banque: (b.banque || '').trim(), domiciliation: (b.domiciliation || '').trim(),
    role: (b.role || 'membre').trim(),
    creado: Date.now(),
  };
  lista.push(p);
  await guardarPersonas(lista);
  res.json(p);
});

app.put('/api/personnes/:pid', async (req, res) => {
  const lista = await leerPersonas();
  const p = lista.find((x) => x.id === req.params.pid);
  if (!p) return res.status(404).json({ error: 'Persona no encontrada.' });
  const b = req.body || {};
  for (const k of ['nom', 'titulaire', 'iban', 'bic', 'banque', 'domiciliation', 'role']) if (k in b) p[k] = (b[k] || '').trim();
  if (!p.nom) p.nom = p.titulaire || p.nom;
  await guardarPersonas(lista);
  res.json(p);
});

app.delete('/api/personnes/:pid', async (req, res) => {
  let lista = await leerPersonas();
  lista = lista.filter((x) => x.id !== req.params.pid);
  await guardarPersonas(lista);
  res.json({ ok: true });
});

// Extrae datos bancarios de un RIB (no guarda; el cliente revisa y confirma).
app.post('/api/personnes/extraire', async (req, res) => {
  const { nombre, contenidoBase64 } = req.body || {};
  if (!nombre || !contenidoBase64) return res.status(400).json({ error: 'Falta el archivo del RIB.' });
  try { res.json(await extraerRIB(nombre, contenidoBase64)); }
  catch (e) { console.error('Error RIB:', e); res.status(500).json({ error: e.message, tipo: clasificarErrorIA(e) }); }
});

// ---------- Firmas (carpeta /Signatures, compartida) ----------
app.get('/api/firmas', async (req, res) => {
  const e = await fs.readdir(DIR_FIRMAS).catch(() => []);
  res.json(e.filter((n) => !n.startsWith('.') && esImagenNombre(n)));
});
app.post('/api/firmas', async (req, res) => {
  const { nombre, contenidoBase64, nombreDestino } = req.body || {};
  if (!nombre || !contenidoBase64) return res.status(400).json({ error: 'Falta nombre o contenido.' });
  if (!esImagenNombre(nombre)) return res.status(400).json({ error: 'Solo se admiten imágenes.' });
  // Si se indica un nombre de destino (ej. Signature_<persona>_<rol>), se respeta
  // su base y se conserva la extensión real de la imagen subida.
  const ext = path.extname(nombre).toLowerCase();
  const seguro = nombreDestino
    ? path.basename(nombreDestino).replace(/\.[^.]*$/, '') + ext
    : path.basename(nombre);
  await fs.mkdir(DIR_FIRMAS, { recursive: true });
  await fs.writeFile(path.join(DIR_FIRMAS, seguro), Buffer.from(contenidoBase64, 'base64'));
  res.json({ ok: true, nombre: seguro });
});
app.get('/api/firmas/:nombre', async (req, res) => {
  res.sendFile(path.join(DIR_FIRMAS, path.basename(req.params.nombre)));
});
app.delete('/api/firmas/:nombre', async (req, res) => {
  const nombre = path.basename(req.params.nombre);
  if (!esImagenNombre(nombre)) return res.status(400).json({ error: 'Nombre no válido.' });
  await fs.rm(path.join(DIR_FIRMAS, nombre), { force: true });
  res.json({ ok: true });
});

// ---------- PDF final: NDF (imágenes de página) + adjuntos ----------
// El cliente envía las páginas de la NDF rasterizadas (PNG dataURL) y el
// orden de los adjuntos. Aquí concatenamos todo en un único PDF con pdf-lib.
app.post('/api/eventos/:id/pdf', async (req, res) => {
  const { id } = req.params;
  if (!idValido(id)) return res.status(400).json({ error: 'ID no válido.' });
  const ev = await leerEvento(id);
  if (!ev) return res.status(404).json({ error: 'Evento no encontrado.' });
  try {
    const { paginas = [], orden = [] } = req.body || {};
    const A4 = [595.28, 841.89]; // puntos (210×297mm)
    const out = await PDFDocument.create();

    // 1) Páginas de la Note de Frais (imágenes PNG a tamaño A4).
    for (const dataUrl of paginas) {
      const b64 = String(dataUrl).split(',')[1];
      const png = await out.embedPng(Buffer.from(b64, 'base64'));
      const page = out.addPage(A4);
      page.drawImage(png, { x: 0, y: 0, width: A4[0], height: A4[1] });
    }

    // 2) Adjuntos en el orden indicado.
    const archivos = await listarArchivos(id);
    const lista = (orden.length ? orden : archivos).filter((n) => archivos.includes(n));
    for (const n of archivos) if (!lista.includes(n)) lista.push(n); // por si falta alguno
    for (const nombre of lista) {
      const ext = path.extname(nombre).toLowerCase();
      const bytes = await fs.readFile(path.join(rutaDocs(id), nombre));
      if (ext === '.pdf') {
        const src = await PDFDocument.load(bytes, { ignoreEncryption: true }).catch(() => null);
        if (!src) continue;
        const pgs = await out.copyPages(src, src.getPageIndices());
        pgs.forEach((p) => out.addPage(p));
      } else if (ext === '.jpg' || ext === '.jpeg' || ext === '.png') {
        const img = ext === '.png' ? await out.embedPng(bytes) : await out.embedJpg(bytes);
        const page = out.addPage(A4);
        // Encaja la imagen dentro del A4 conservando proporción, con margen.
        const m = 28;
        const maxW = A4[0] - m * 2, maxH = A4[1] - m * 2;
        const s = Math.min(maxW / img.width, maxH / img.height);
        const w = img.width * s, h = img.height * s;
        page.drawImage(img, { x: (A4[0] - w) / 2, y: (A4[1] - h) / 2, width: w, height: h });
      }
      // otros formatos (webp/gif): se omiten en el PDF (no soportados por pdf-lib).
    }

    const pdfBytes = await out.save();
    const nombrePdf = `${(ev.datos && ev.datos.numero_ndf) || 'Note_de_Frais'}.pdf`;
    await fs.writeFile(path.join(rutaEvento(id), nombrePdf), pdfBytes);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(nombrePdf)}"`);
    res.send(Buffer.from(pdfBytes));
  } catch (e) { console.error('Error al generar PDF:', e); res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => {
  console.log('\n  BDI · Notes de Frais');
  console.log(`  Abre tu navegador en:  http://localhost:${PORT}\n`);
  if (!anthropicApiKey) {
    console.log('  ⚠  Falta ANTHROPIC_API_KEY — configúrala en Réglages (⚙) o en .env.\n');
  }
});
