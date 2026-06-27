// Arnés de prueba: sube facturas REALES a un evento, mide tiempos por documento y verifica que las
// LÍNEAS de la NDF llegan documento a documento (SSE 'doc'), no todas al final, y vuelca el resultado.
// Uso: node prueba-facturas.mjs "<carpeta>" [nombreEvento]
import { promises as fs } from 'node:fs';
import path from 'node:path';

const BASE = 'http://localhost:4317/api';
const carpeta = process.argv[2];
const nombreEv = process.argv[3] || 'ZZ Prueba ' + path.basename(carpeta);
const EXT = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.gif']);

const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return { _raw: t }; } };
const ms = () => Date.now();
const seg = (a, b) => ((b - a) / 1000).toFixed(1) + 's';

const ficheros = (await fs.readdir(carpeta)).filter((f) => EXT.has(path.extname(f).toLowerCase()));
console.log(`Carpeta: ${carpeta}\nDocumentos (${ficheros.length}): ${ficheros.join(', ')}\n`);

// 1) crear evento
const ev = await j(await fetch(`${BASE}/eventos`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ nom: nombreEv, section: 'Bureau de l\'International (Pôle Trésorerie)', date: '2026-04-28', budget: 1000 }) }));
const id = ev.id;
console.log('Evento:', id);

// 2) subir documentos
for (const f of ficheros) {
  const b64 = (await fs.readFile(path.join(carpeta, f))).toString('base64');
  const r = await j(await fetch(`${BASE}/eventos/${id}/archivos`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: f, contenidoBase64: b64 }) }));
  if (!r.ok) console.log('  ⚠ subida', f, JSON.stringify(r));
}
console.log('Subidos.\n');

// 3) abrir SSE y medir (eventos estructurados: 'datos' esqueleto, 'doc' por documento, 'fin')
const orden = [];          // [{nombre, t, lignes, totalAcum}]
let totalAcum = 0, tFin = 0, finResolve;
const t0 = ms();
const finCtl = new AbortController();
const finProm = new Promise((res) => { finResolve = res; });
fetch(`${BASE}/eventos/${id}/logs`, { signal: finCtl.signal }).then(async (resp) => {
  const reader = resp.body.getReader(); const dec = new TextDecoder(); let buf = '';
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl; while ((nl = buf.indexOf('\n')) >= 0) {
      const linea = buf.slice(0, nl); buf = buf.slice(nl + 1);
      if (!linea.startsWith('data:')) continue;
      let d; try { d = JSON.parse(linea.slice(5).trim()); } catch { continue; }
      if (d.tipo === 'datos') console.log(`  [${seg(t0, ms())}] esqueleto NDF reçu (lignes: ${(d.datos.lignes || []).length})`);
      else if (d.tipo === 'doc') {
        const n = (d.lignes || []).length; totalAcum += n;
        orden.push({ nombre: d.nombre, t: ms(), lignes: n, totalAcum });
        console.log(`  [${seg(t0, ms())}] DOC ${d.nombre.padEnd(42)} -> +${n} ligne(s) | NDF cumul: ${totalAcum} | ${d.texto.length} car.`);
      } else if (d.tipo === 'fin') { tFin = ms(); finResolve(); return; }
      else if (d.msg) console.log(`  [${seg(t0, ms())}] . ${d.msg}`);
    }
  }
}).catch(() => {});

await new Promise((r) => setTimeout(r, 400));
// 4) lanzar análisis (NO se espera la respuesta del POST: en secuencial/paralelo llega al final)
const tAnal = ms();
fetch(`${BASE}/eventos/${id}/analizar`, { method: 'POST', headers: { 'Content-Type': 'application/json' } }).catch(() => {});
await Promise.race([finProm, new Promise((r) => setTimeout(r, 590000))]);
finCtl.abort();

// 5) leer el resultado final del evento
const fin = await j(await fetch(`${BASE}/eventos/${id}`));

console.log('\n===== TIEMPOS POR DOCUMENTO (depuis le début de l\'analyse) =====');
let prev = tAnal;
for (const o of orden) {
  console.log(`  ${o.nombre.padEnd(44)} -> ${seg(tAnal, o.t).padStart(7)} (Δ ${seg(prev, o.t)}) | NDF cumul: ${o.totalAcum}`);
  prev = o.t;
}
if (tFin) console.log(`  TOTAL: ${seg(tAnal, tFin)} pour ${ficheros.length} doc(s) | moy ${seg(0, (tFin - tAnal) / ficheros.length)}/doc`);
else console.log('  (pas de \'fin\' reçu — timeout du harnais ou erreur ; voir le journal ci-dessus)');

console.log('\n===== INCRÉMENTAL ? =====');
console.log(`  Documents émis séparément: ${orden.length}/${ficheros.length}`);

console.log('\n===== LIGNES FINALES (event.json) =====');
for (const l of (fin.datos?.lignes || [])) {
  console.log(`  - ${l.article} | ${l.date_achat} | ${l.prix_ht}€ | tva:${l.taux_tva} ttc:${l.montant_ttc} | conf:${l.confiance} | src:${(l.fichiers_source || []).join(',')}`);
}
console.log('  observations:', JSON.stringify(fin.datos?.observations || []));

console.log('\n===== TRANSCRIPTION (8 premières lignes par doc) =====');
for (const f of ficheros) {
  const txt = fin.ocr?.[f]; if (!txt) continue;
  console.log(`\n--- ${f} ---`);
  console.log(txt.split('\n').slice(0, 8).map((l) => '   ' + l).join('\n'));
}

// 6) limpiar
await fetch(`${BASE}/eventos/${id}`, { method: 'DELETE' });
console.log('\nEvento borrado. FIN.');
