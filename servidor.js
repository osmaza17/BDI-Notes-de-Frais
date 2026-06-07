// ============================================================
//  servidor.js — Motor local de la app de Notes de Frais del BDI.
//
//  Pipeline: el usuario sube facturas/tickets/attestations →
//  se envían DIRECTAMENTE a la API de Anthropic (Claude), que
//  transcribe cada documento y extrae las líneas de la NDF.
//
//  Almacenamiento por evento (carpeta en /Dossiers/<id>/):
//   - evento.json   → ÚNICO fichero con TODA la info del evento.
//   - Documents/    → subcarpeta con los ficheros aportados.
//   - _backups/     → copias de seguridad de evento.json.
//
//  Portabilidad: todo es relativo a la carpeta del proyecto, sin
//  rutas absolutas; basta copiar la carpeta a otro PC con Node.
//
//  Claves en .env (solo ANTHROPIC_API_KEY).
// ============================================================

import 'dotenv/config';
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { PDFDocument } from 'pdf-lib';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR_DOSSIERS = path.join(__dirname, 'Dossiers');
const DIR_WEB = path.join(__dirname, 'web');
const DIR_FIRMAS = path.join(__dirname, 'Signatures');

const PORT = process.env.PORT || 4317;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODELO_CLAUDE = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';
const SOPORTA_EFFORT = !/haiku/i.test(MODELO_CLAUDE);
function outputConfig(schema) {
  const oc = { format: { type: 'json_schema', schema } };
  if (SOPORTA_EFFORT) oc.effort = 'medium';
  return oc;
}

const ADRESSE_BDI = '3 rue Joliot Curie, 91190, Gif-sur-Yvette';
const MAX_BACKUPS = 15;

const EXT_IMAGEN = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);
const esImagenNombre = (n) => EXT_IMAGEN.has(path.extname(n).toLowerCase());

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

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
const rutaJSON = (id) => path.join(rutaEvento(id), 'evento.json');
const rutaBackups = (id) => path.join(rutaEvento(id), '_backups');

function idValido(id) { return typeof id === 'string' && /^[a-zA-Z0-9_]+$/.test(id); }

async function leerEvento(id) { return leerJSON(rutaJSON(id)); }

// Guarda el evento y deja una copia de seguridad con marca de tiempo.
async function guardarEvento(id, ev) {
  // Backup de la versión anterior (si existe) antes de sobrescribir.
  try {
    const previo = await fs.readFile(rutaJSON(id), 'utf8');
    await fs.mkdir(rutaBackups(id), { recursive: true });
    const sello = new Date().toISOString().replace(/[:.]/g, '-');
    await fs.writeFile(path.join(rutaBackups(id), `evento_${sello}.json`), previo, 'utf8');
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
  required: ['article', 'date_achat', 'prix_ht', 'taux_tva', 'montant_ttc', 'fichier_source', 'confiance'],
  properties: {
    article: { type: 'string', description: "Désignation courte de l'achat en français." },
    date_achat: { type: 'string', description: "Date de l'achat au format JJ/MM/AAAA. Vide si inconnue." },
    prix_ht: { type: 'number', description: "Prix hors taxes en euros. Si la TVA n'est pas détaillée, = montant TTC." },
    taux_tva: { type: 'string', description: "Taux de TVA (ex: '20%', '5,5%', '0%'). '0%' si non détaillé." },
    montant_ttc: { type: 'number', description: 'Montant total TTC payé, en euros.' },
    fichier_source: { type: 'string', description: 'Nom exact du fichier dont provient cette ligne.' },
    confiance: { type: 'string', enum: ['haute', 'moyenne', 'basse'], description: "Ton niveau de confiance dans l'exactitude des montants/données de cette ligne." },
  },
};
const ESQUEMA_OBS = {
  type: 'array', items: { type: 'string' },
  description: "Liste de remarques courtes et AUTONOMES pour le trésorier (une remarque = un élément). Tableau vide si rien à signaler.",
};
const ESQUEMA_CON_DOCS = {
  type: 'object', additionalProperties: false,
  required: ['documents', 'lignes', 'observations'],
  properties: {
    documents: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['fichier', 'transcription'],
        properties: {
          fichier: { type: 'string' },
          transcription: { type: 'string', description: 'Texte intégral lisible sur le document.' },
        },
      },
    },
    lignes: { type: 'array', items: ESQUEMA_LIGNE },
    observations: ESQUEMA_OBS,
  },
};
const ESQUEMA_SOLO = {
  type: 'object', additionalProperties: false, required: ['lignes', 'observations'],
  properties: { lignes: { type: 'array', items: ESQUEMA_LIGNE }, observations: ESQUEMA_OBS },
};

const SYSTEM_PROMPT = `Tu es l'assistant comptable du Bureau de l'International (BDI) de CentraleSupélec.
On te fournit les pièces justificatives (factures, tickets de caisse, attestations sur l'honneur) d'une section pour un événement. Tu prépares les lignes d'une "Note de Frais" (NDF) qui servira au remboursement de la section par le BDI.

Règles :
- Lis attentivement chaque document fourni (image ou PDF) et transcris fidèlement son texte.
- Une ligne par achat. Un ticket de caisse accompagné de son attestation sur l'honneur = une seule ligne (utilise le ticket pour les montants, l'attestation pour l'objet).
- Les attestations sur l'honneur seules (sans montant) ne génèrent PAS de ligne : sers-t'en pour préciser l'objet des autres lignes.
- Montants en euros. Si la TVA n'est pas détaillée, mets taux_tva='0%' et prix_ht = montant_ttc.
- Rédige les libellés (article) en français, de façon concise.
- Pour chaque ligne, indique ta "confiance" (haute/moyenne/basse) selon la lisibilité du document et ta certitude sur les montants.
- N'invente jamais un montant : en cas de doute, mets ta meilleure estimation, confiance 'basse', et signale-le dans "observations".
- Le trésorier vérifiera et corrigera tout avant génération : privilégie la fidélité aux documents.`;

const ctx = (ev) =>
  `Événement : ${ev.nom}\nSection (pôle) : ${ev.section || ''}\nDate de l'événement : ${ev.date || '(non précisée)'}`;
const textoRespuesta = (resp) => resp.content.find((b) => b.type === 'text')?.text || '{}';

async function bloquesDeArchivos(id, archivos) {
  const bloques = [];
  for (const nombre of archivos) {
    const ext = path.extname(nombre).toLowerCase();
    const mime = MIME_POR_EXT[ext] || 'application/pdf';
    const data = (await fs.readFile(path.join(rutaDocs(id), nombre))).toString('base64');
    bloques.push({ type: 'text', text: `### Fichier : ${nombre}` });
    if (mime.startsWith('image/')) bloques.push({ type: 'image', source: { type: 'base64', media_type: mime, data } });
    else bloques.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } });
  }
  return bloques;
}

async function analizarConClaude(ev, id, archivos) {
  const content = [
    { type: 'text', text: `${ctx(ev)}\n\nLis chaque document ci-dessous, transcris son texte intégral, puis prépare les lignes de la Note de Frais.` },
    ...(await bloquesDeArchivos(id, archivos)),
  ];
  const resp = await anthropic.messages.create({
    model: MODELO_CLAUDE, max_tokens: 8000, system: SYSTEM_PROMPT,
    output_config: outputConfig(ESQUEMA_CON_DOCS), messages: [{ role: 'user', content }],
  });
  const r = JSON.parse(textoRespuesta(resp));
  const ocr = {};
  for (const d of r.documents || []) ocr[d.fichier] = d.transcription || '';
  for (const nombre of archivos) if (!(nombre in ocr)) ocr[nombre] = '';
  return { ocr, lignes: r.lignes || [], observations: r.observations || [] };
}

async function estructurarDesdeTextos(ev, ocr) {
  const bloques = Object.entries(ocr).map(([nom, txt]) => `### Fichier : ${nom}\n${txt || '(vide)'}`).join('\n\n---\n\n');
  const resp = await anthropic.messages.create({
    model: MODELO_CLAUDE, max_tokens: 8000, system: SYSTEM_PROMPT,
    output_config: outputConfig(ESQUEMA_SOLO),
    messages: [{ role: 'user', content: `${ctx(ev)}\n\nVoici les transcriptions des pièces :\n\n${bloques}` }],
  });
  const r = JSON.parse(textoRespuesta(resp));
  return { lignes: r.lignes || [], observations: r.observations || [] };
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
    section: seccion,
    asso: `Bureau de l'International (${seccion})`,
    adresse: ADRESSE_BDI,
    date_evenement: ev.date || '',
    lignes: extraido.lignes || [],
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
  if (req.path.includes('analizar') || req.path.includes('regenerar')) {
    if (!ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'Falta ANTHROPIC_API_KEY. Copia .env.example como .env y rellénala.' });
    }
  }
  next();
});

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

// Vista pública del evento.
function vista(ev, archivos) {
  return {
    id: ev.id, nom: ev.nom, section: ev.section, membre: ev.membre, date: ev.date,
    budget: ev.budget ?? null, estado: ev.estado || 'brouillon', paye: !!ev.paye,
    creado: ev.creado, archivos, datos: ev.datos || null, ocr: ev.ocr || {},
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
  const { nom, section, membre, date, budget } = req.body || {};
  if (!nom || !section) return res.status(400).json({ error: "Faltan el nombre del evento o la section (pôle)." });
  const base = slug(`${section}_${nom}`);
  let id = base, n = 1;
  while (await fs.access(rutaEvento(id)).then(() => true, () => false)) id = `${base}_${++n}`;
  await fs.mkdir(rutaDocs(id), { recursive: true });
  const ev = {
    id, nom: nom.trim(), section: section.trim(), membre: (membre || '').trim(),
    date: (date || '').trim(),
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
  const seguro = path.basename(nombre);
  await fs.writeFile(path.join(rutaDocs(id), seguro), Buffer.from(contenidoBase64, 'base64'));
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
  res.sendFile(path.join(rutaDocs(id), path.basename(req.params.nombre)));
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
      for (const l of ev.datos.lignes || []) if (l.fichier_source === viejo) l.fichier_source = nuevo;
      if (Array.isArray(ev.datos.ordre_pieces)) ev.datos.ordre_pieces = ev.datos.ordre_pieces.map((x) => x === viejo ? nuevo : x);
    }
    await guardarEvento(id, ev);
    res.json({ ok: true, nombre: nuevo });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/eventos/:id/analizar', async (req, res) => {
  const { id } = req.params;
  if (!idValido(id)) return res.status(400).json({ error: 'ID no válido.' });
  const ev = await leerEvento(id);
  if (!ev) return res.status(404).json({ error: 'Evento no encontrado.' });
  try {
    const archivos = await listarArchivos(id);
    if (archivos.length === 0) return res.status(400).json({ error: 'No hay documentos que analizar.' });
    const extraido = await analizarConClaude(ev, id, archivos);
    ev.ocr = extraido.ocr;
    const previo = ev.datos || {};
    ev.datos = construirDatos(ev, extraido);
    // Conserva ajustes manuales que no dependen del análisis.
    ev.datos.signature = previo.signature || '';
    ev.datos.signature_membre = previo.signature_membre || '';
    ev.datos.ordre_pieces = archivos.slice(); // orden por defecto = orden actual
    await guardarEvento(id, ev);
    res.json({ datos: ev.datos, ocr: ev.ocr });
  } catch (e) { console.error('Error al analizar:', e); res.status(500).json({ error: e.message }); }
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
    ev.datos.ordre_pieces = (previo.ordre_pieces && previo.ordre_pieces.length) ? previo.ordre_pieces : (await listarArchivos(id));
    await guardarEvento(id, ev);
    res.json({ datos: ev.datos, ocr: ev.ocr });
  } catch (e) { console.error('Error al regenerar:', e); res.status(500).json({ error: e.message }); }
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

// ---------- Firmas (carpeta /Signatures, compartida) ----------
app.get('/api/firmas', async (req, res) => {
  const e = await fs.readdir(DIR_FIRMAS).catch(() => []);
  res.json(e.filter((n) => !n.startsWith('.') && esImagenNombre(n)));
});
app.post('/api/firmas', async (req, res) => {
  const { nombre, contenidoBase64 } = req.body || {};
  if (!nombre || !contenidoBase64) return res.status(400).json({ error: 'Falta nombre o contenido.' });
  if (!esImagenNombre(nombre)) return res.status(400).json({ error: 'Solo se admiten imágenes.' });
  const seguro = path.basename(nombre);
  await fs.mkdir(DIR_FIRMAS, { recursive: true });
  await fs.writeFile(path.join(DIR_FIRMAS, seguro), Buffer.from(contenidoBase64, 'base64'));
  res.json({ ok: true, nombre: seguro });
});
app.get('/api/firmas/:nombre', async (req, res) => {
  res.sendFile(path.join(DIR_FIRMAS, path.basename(req.params.nombre)));
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
  if (!ANTHROPIC_API_KEY) {
    console.log('  ⚠  Falta ANTHROPIC_API_KEY en .env — el análisis con IA no funcionará.\n');
  }
});
