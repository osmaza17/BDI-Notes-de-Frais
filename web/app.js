// ============================================================
//  app.js — Lógica de la interfaz (sin frameworks).
//  Home (eventos por año, búsqueda, estados) → pestañas
//  Documents · Analyse · Note de Frais.
//  Análisis automático · autoguardado · i18n · PDF final · Excel.
// ============================================================

// URL del repositorio (se rellena tras publicar en GitHub).
const REPO_URL = 'https://github.com/osmaza17/BDI-Notes-de-Frais';

const estado = {
  eventos: [],
  activo: null,
  analizando: false,
  analisisToken: 0,
  filtro: { texto: '', estado: '' },
};

const ESTADOS = ['brouillon', 'a_verifier', 'valide', 'envoye', 'rembourse'];

if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// ---------- Utilidades ----------
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

function toast(msg, esError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'show' + (esError ? ' error' : '');
  setTimeout(() => (el.className = ''), 3200);
}
async function api(ruta, opciones = {}) {
  const resp = await fetch('/api' + ruta, { headers: { 'Content-Type': 'application/json' }, ...opciones });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json.error || `Erreur ${resp.status}`);
  return json;
}
function leerArchivoBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = reject; r.readAsDataURL(file);
  });
}
function aNumero(v) { return parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')) || 0; }
function tasaTVA(taux) { const n = parseFloat(String(taux ?? '').replace(',', '.').replace('%', '')); return isNaN(n) ? 0 : n / 100; }
function numFR(n) { const x = Number(n); return isFinite(x) ? x.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''; }
function eur(n) { return numFR(n) + ' €'; }
function escapar(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function fmtFecha(iso) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso || ''); }
function anioDe(ev) { return (ev.date && /^\d{4}/.test(ev.date)) ? ev.date.slice(0, 4) : new Date(ev.creado || Date.now()).getFullYear().toString(); }
function seccionDe(ev) { return ev.section || ev.club || ''; }
const esImagen = (n) => /\.(jpe?g|png|webp|gif|bmp)$/i.test(n);
const urlArchivo = (id, n) => `/api/eventos/${id}/archivos/${encodeURIComponent(n)}`;
function totalTTC(d) { let t = 0; for (const l of (d?.lignes || [])) t += (Number(l.prix_ht) || 0) * (1 + tasaTVA(l.taux_tva)); return t; }

// Enlace al repo + idioma
$('#link-repo').href = REPO_URL;
$('#sel-idioma').value = IDIOMA;
$('#sel-idioma').addEventListener('change', (e) => {
  IDIOMA = e.target.value; localStorage.setItem('idioma-ndf', IDIOMA);
  aplicarIdioma(); reRenderTodo();
});
function reRenderTodo() {
  pintarEstado($('#estado-servidor').classList.contains('conectado'));
  if (!estado.activo) renderEventos();
  else { renderDocumentos(); renderAnalyse(); renderNDF(); }
}

// ---------- Navegación ----------
$$('#tabs button[data-vista]').forEach((b) => b.addEventListener('click', () => mostrarVista(b.dataset.vista)));
$('#btn-volver').addEventListener('click', volverAEventos);
function mostrarVista(nombre) {
  $$('#tabs button[data-vista]').forEach((b) => b.classList.toggle('activa', b.dataset.vista === nombre));
  $$('.vista').forEach((v) => v.classList.remove('activa'));
  $('#vista-' + nombre).classList.add('activa');
}
function volverAEventos() {
  estado.activo = null;
  $('#tabs').style.display = 'none';
  $('#evento-activo').textContent = t('header.noEvent');
  $('#fab-crear').style.display = '';
  $$('.vista').forEach((v) => v.classList.remove('activa'));
  $('#vista-eventos').classList.add('activa');
  renderEventos();
}

// ---------- Tema ----------
document.documentElement.dataset.theme = localStorage.getItem('tema-ndf') || 'claro';
$('#btn-tema').addEventListener('click', () => {
  const nuevo = document.documentElement.dataset.theme === 'claro' ? 'oscuro' : 'claro';
  document.documentElement.dataset.theme = nuevo;
  localStorage.setItem('tema-ndf', nuevo);
});

// ============================================================
//  EVENTOS (home)
// ============================================================
async function cargarEventos() { estado.eventos = await api('/eventos'); renderEventos(); }

$('#buscar').addEventListener('input', (e) => { estado.filtro.texto = e.target.value.toLowerCase(); renderEventos(); });
$('#filtro-estado').addEventListener('change', (e) => { estado.filtro.estado = e.target.value; renderEventos(); });

function coincide(ev) {
  const { texto, estado: est } = estado.filtro;
  if (est && (ev.estado || 'brouillon') !== est) return false;
  if (!texto) return true;
  return [ev.nom, seccionDe(ev), ev.membre, anioDe(ev)].join(' ').toLowerCase().includes(texto);
}

function renderEventos() {
  const cont = $('#grid-eventos');
  const lista = estado.eventos.filter(coincide);
  if (estado.eventos.length === 0) { cont.innerHTML = `<p class="vacio">${escapar(t('home.empty'))}</p>`; return; }
  if (lista.length === 0) { cont.innerHTML = `<p class="vacio">${escapar(t('home.noMatch'))}</p>`; return; }
  const porAnio = {};
  for (const ev of lista) (porAnio[anioDe(ev)] ||= []).push(ev);
  const anios = Object.keys(porAnio).sort((a, b) => b - a);
  cont.innerHTML = '';
  for (const anio of anios) {
    const grupo = document.createElement('div');
    grupo.className = 'anio-grupo';
    grupo.innerHTML = `<h3 class="anio-titulo">${anio}</h3>`;
    const grid = document.createElement('div');
    grid.className = 'grid-eventos';
    for (const ev of porAnio[anio]) grid.appendChild(tarjetaEvento(ev));
    grupo.appendChild(grid);
    cont.appendChild(grupo);
  }
}

function tarjetaEvento(ev) {
  const est = ev.estado || 'brouillon';
  const div = document.createElement('div');
  div.className = `tarjeta est-${est}`;
  div.innerHTML = `
    <div class="tarjeta-top">
      <span class="ev-estado est-${est}">${t('estado.' + est)}</span>
      <button class="icono btn-borrar-ev" title="Supprimer">🗑</button>
    </div>
    <div class="ev-nom">${escapar(ev.nom)}</div>
    <div class="ev-section">${escapar(seccionDe(ev))}</div>
    <div class="ev-meta">
      ${ev.date ? `<span>📅 ${escapar(fmtFecha(ev.date))}</span>` : '<span></span>'}
      <span>${ev.nArchivos} ${t('home.docs')}</span>
    </div>
    <div class="ev-meta2">
      ${ev.budget != null ? `<span class="ev-budget">${numFR(ev.budget)} €</span>` : '<span></span>'}
      <span class="badge-paye ${ev.paye ? 'si' : 'no'}">${ev.paye ? t('paye.yes') : t('paye.no')}</span>
    </div>`;
  div.addEventListener('click', (e) => { if (e.target.closest('.btn-borrar-ev')) return; abrirEvento(ev.id); });
  div.querySelector('.btn-borrar-ev').addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm(t('event.confirmDel', { x: ev.nom }))) return;
    await api('/eventos/' + ev.id, { method: 'DELETE' });
    toast(t('event.deleted')); await cargarEventos();
  });
  return div;
}

// ---- Modal de creación (FAB "+") ----
function abrirCrear() { $('#modal-crear').classList.add('show'); $('#nuevo-nom').focus(); }
function cerrarCrear() { $('#modal-crear').classList.remove('show'); }
$('#fab-crear').addEventListener('click', abrirCrear);
$('#crear-cerrar').addEventListener('click', cerrarCrear);
$('#modal-crear').addEventListener('click', (e) => { if (e.target.id === 'modal-crear') cerrarCrear(); });

$('#btn-crear').addEventListener('click', async () => {
  const nom = $('#nuevo-nom').value.trim();
  const section = $('#nuevo-section').value;
  const membre = $('#nuevo-membre').value.trim();
  const date = $('#nuevo-date').value;
  const budget = $('#nuevo-budget').value;
  const iban = $('#nuevo-iban').value.trim();
  if (!nom || !section) return toast(t('form.needNameSection'), true);
  const ev = await api('/eventos', { method: 'POST', body: JSON.stringify({ nom, section, membre, date, budget, iban }) });
  $('#nuevo-nom').value = $('#nuevo-membre').value = $('#nuevo-date').value = $('#nuevo-budget').value = $('#nuevo-iban').value = '';
  $('#nuevo-section').selectedIndex = 0;
  cerrarCrear(); toast(t('event.created'));
  await cargarEventos(); await abrirEvento(ev.id);
});

// ---------- Abrir evento ----------
async function abrirEvento(id) {
  estado.activo = await api('/eventos/' + id);
  estado.activo.ocr = estado.activo.ocr || {};
  estado.analizando = false; estado.analisisToken++;
  $('#evento-activo').textContent = `${seccionDe(estado.activo)} — ${estado.activo.nom}`;
  $('#tabs').style.display = '';
  $('#fab-crear').style.display = 'none';
  renderDocumentos(); renderAnalyse(); renderNDF();
  mostrarVista('documents');
}
async function recargarActivo() {
  if (!estado.activo) return;
  const nuevo = await api('/eventos/' + estado.activo.id);
  nuevo.ocr = nuevo.ocr || {};
  estado.activo = nuevo;
}

// ============================================================
//  DOCUMENTS
// ============================================================
function renderDocumentos() {
  const cont = $('#doc-cards');
  $('#n-docs').textContent = estado.activo.archivos.length;
  cont.innerHTML = '';
  if (estado.activo.archivos.length === 0) { cont.innerHTML = `<p class="vacio">${escapar(t('docs.none'))}</p>`; return; }
  for (const nom of estado.activo.archivos) cont.appendChild(tarjetaDoc(nom, true));
}

function tarjetaDoc(nom, conAcciones) {
  const tipo = /attest/i.test(nom) ? 'attestation' : /fact/i.test(nom) ? 'facture' : '';
  const huerfano = documentosHuerfanos(datos()).includes(nom);
  const card = document.createElement('div');
  card.className = 'doc-card' + (huerfano ? ' huerfano' : '');
  card.title = t('docs.clickAnalyse');
  card.innerHTML = `
    <div class="thumb"></div>
    <div class="pie">
      ${huerfano ? `<span class="badge huerfano">${t('docs.orphanBadge')}</span>` : (tipo ? `<span class="badge ${tipo}">${tipo}</span>` : '')}
      <div class="nombre" ${conAcciones ? 'contenteditable="true"' : ''} spellcheck="false" title="${t('docs.clickRename')}">${escapar(nom)}</div>
      ${conAcciones ? `<div class="acciones">
        <button class="sec peque btn-voir">${t('docs.view')}</button>
        <button class="sec peque btn-open">${t('docs.openTab')}</button>
        <button class="peligro peque btn-del">✕</button>
      </div>` : ''}
    </div>`;
  if (conAcciones) {
    card.addEventListener('click', (e) => { if (e.target.closest('button, a, .nombre')) return; irAnalyse(nom); });
    card.querySelector('.btn-voir').addEventListener('click', (e) => { e.stopPropagation(); abrirVisor(nom); });
    card.querySelector('.btn-open').addEventListener('click', (e) => { e.stopPropagation(); window.open(urlArchivo(estado.activo.id, nom), '_blank'); });
    conectarNombreEditable(card.querySelector('.nombre'), nom);
    card.querySelector('.btn-del').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(t('docs.confirmDel', { x: nom }))) return;
      await api(`/eventos/${estado.activo.id}/archivos/${encodeURIComponent(nom)}`, { method: 'DELETE' });
      await recargarActivo();
      renderDocumentos(); renderAnalyse(); renderNDF();
      toast(t('docs.deleted'));
      estado.analisisToken++; estado.analizando = false;
      if (estado.activo.archivos.length) lanzarAnalisis();
    });
  }
  pintarMiniatura(card.querySelector('.thumb'), estado.activo.id, nom);
  return card;
}

function abrirVisor(nom) {
  const url = urlArchivo(estado.activo.id, nom);
  $('#doc-titulo').textContent = nom;
  $('#doc-visor').innerHTML = esImagen(nom) ? `<img src="${url}" alt="${escapar(nom)}" />` : `<iframe src="${url}" title="${escapar(nom)}"></iframe>`;
  $('#modal-doc').classList.add('show');
}
function cerrarVisor() { $('#modal-doc').classList.remove('show'); $('#doc-visor').innerHTML = ''; }
$('#doc-cerrar').addEventListener('click', cerrarVisor);
$('#modal-doc').addEventListener('click', (e) => { if (e.target.id === 'modal-doc') cerrarVisor(); });

function irAnalyse(nom) {
  mostrarVista('analyse');
  setTimeout(() => { const it = document.querySelector(`.analyse-item[data-nom="${CSS.escape(nom)}"]`); if (it) it.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60);
}
function conectarNombreEditable(el, nombreActual) {
  el.addEventListener('click', (e) => e.stopPropagation());
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } });
  el.addEventListener('blur', () => renombrarArchivo(nombreActual, el.textContent.trim()));
}
async function renombrarArchivo(viejo, nuevo) {
  nuevo = (nuevo || '').trim();
  if (!nuevo || nuevo === viejo) { renderDocumentos(); renderAnalyse(); return; }
  try {
    await api(`/eventos/${estado.activo.id}/archivos/${encodeURIComponent(viejo)}/renombrar`, { method: 'POST', body: JSON.stringify({ nuevoNombre: nuevo }) });
    await recargarActivo();
    renderDocumentos(); renderAnalyse(); renderNDF();
    toast(t('docs.renamed'));
  } catch (e) { toast('Erreur : ' + e.message, true); renderDocumentos(); renderAnalyse(); }
}
async function pintarMiniatura(cont, id, nom) {
  const url = urlArchivo(id, nom);
  if (esImagen(nom)) { const img = new Image(); img.src = url; cont.appendChild(img); return; }
  if (/\.pdf$/i.test(nom) && window.pdfjsLib) {
    try {
      const pdf = await pdfjsLib.getDocument(url).promise;
      const page = await pdf.getPage(1);
      const v0 = page.getViewport({ scale: 1 });
      const scale = Math.min(500 / v0.width, 360 / v0.height);
      const vp = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = vp.width; canvas.height = vp.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      cont.appendChild(canvas); return;
    } catch { /* icono */ }
  }
  cont.innerHTML = '<span class="icono-doc">📄</span>';
}

// Drag & drop sobre la zona de tarjetas + botón añadir
['dragover', 'drop'].forEach((ev) => window.addEventListener(ev, (e) => { if (!e.target.closest('.dropzone-cards')) e.preventDefault(); }));
const zonaCards = $('#doc-cards');
const fileInput = $('#file-input');
zonaCards.addEventListener('dragover', (e) => { e.preventDefault(); zonaCards.classList.add('dragover'); });
zonaCards.addEventListener('dragleave', (e) => { if (!zonaCards.contains(e.relatedTarget)) zonaCards.classList.remove('dragover'); });
zonaCards.addEventListener('drop', (e) => { e.preventDefault(); zonaCards.classList.remove('dragover'); subirArchivos(e.dataTransfer.files); });
$('#btn-add-docs').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => subirArchivos(fileInput.files));

async function subirArchivos(files) {
  if (!estado.activo || !files.length) return;
  toast(t('docs.uploading', { n: files.length }));
  for (const file of files) {
    try {
      const contenidoBase64 = await leerArchivoBase64(file);
      const resp = await fetch(`/api/eventos/${estado.activo.id}/archivos`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre: file.name, contenidoBase64 }),
      });
      if (resp.status === 409) { const j = await resp.json().catch(() => ({})); toast(t('docs.duplicate', { x: j.duplicado || '?' }), true); continue; }
      if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || resp.status);
    } catch (e) { toast(`Erreur ${file.name}: ${e.message}`, true); }
  }
  fileInput.value = '';
  await recargarActivo();
  renderDocumentos();
  toast(t('docs.added'));
  lanzarAnalisis();
}

// ---- Análisis automático (cancelable) ----
async function lanzarAnalisis() {
  if (!estado.activo || !estado.activo.archivos.length) return;
  const token = ++estado.analisisToken;
  estado.analizando = true;
  const est = $('#estado-analisis');
  if (est) est.textContent = t('analysing');
  renderAnalyse();
  try {
    const r = await api(`/eventos/${estado.activo.id}/analizar`, { method: 'POST' });
    if (token !== estado.analisisToken) return;
    estado.activo.datos = r.datos; estado.activo.ocr = r.ocr || {};
    if (est) est.textContent = t('analysed'); toast(t('analysed'));
  } catch (e) {
    if (token !== estado.analisisToken) return;
    if (est) est.textContent = 'Erreur : ' + e.message; toast('Erreur : ' + e.message, true);
  } finally {
    if (token === estado.analisisToken) { estado.analizando = false; renderAnalyse(); renderNDF(); }
  }
}

// ============================================================
//  ANALYSE
// ============================================================
function renderAnalyse() {
  const cont = $('#analyse-lista');
  const a = estado.activo;
  if (!a || a.archivos.length === 0) { cont.innerHTML = `<p class="vacio">${escapar(t('analyse.none'))}</p>`; return; }
  cont.innerHTML = '';
  for (const nom of a.archivos) {
    const item = document.createElement('div');
    item.className = 'analyse-item';
    item.dataset.nom = nom;
    const orig = esImagen(nom) ? `<img src="${urlArchivo(a.id, nom)}" alt="${escapar(nom)}" />` : `<iframe src="${urlArchivo(a.id, nom)}" title="${escapar(nom)}"></iframe>`;
    const tiene = a.ocr && typeof a.ocr[nom] === 'string';
    let panel;
    if (estado.analizando && !tiene) panel = `<div class="cargando"><div class="loader"></div><div class="txt-cargando">${escapar(t('analyse.loadingDoc'))}</div></div>`;
    else if (tiene || estado.analizando) panel = `<textarea placeholder="${t('analyse.placeholder')}">${escapar((a.ocr && a.ocr[nom]) || '')}</textarea>`;
    else panel = `<div class="cargando"><div class="txt-cargando">${escapar(t('analyse.notYet'))}</div></div>`;
    item.innerHTML = `
      <div class="analyse-head">
        <h4 class="nombre-doc" contenteditable="true" spellcheck="false" title="${t('docs.clickRename')}">${escapar(nom)}</h4>
        <button class="sec peque btn-open">${t('docs.openTab')}</button>
      </div>
      <div class="analyse-split">
        <div class="orig">${orig}</div>
        <div class="txt">${panel}</div>
      </div>`;
    const ta = item.querySelector('textarea');
    if (ta) ta.addEventListener('input', (e) => { a.ocr[nom] = e.target.value; autoguardarOcr(); });
    item.querySelector('.btn-open').addEventListener('click', () => window.open(urlArchivo(a.id, nom), '_blank'));
    conectarNombreEditable(item.querySelector('.nombre-doc'), nom);
    cont.appendChild(item);
  }
}

$('#btn-regenerar').addEventListener('click', async () => {
  if (!estado.activo) return;
  const btn = $('#btn-regenerar'); const est = $('#estado-regen');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> ' + t('analyse.regening');
  try {
    await api(`/eventos/${estado.activo.id}/ocr`, { method: 'PUT', body: JSON.stringify(estado.activo.ocr || {}) });
    const r = await api(`/eventos/${estado.activo.id}/regenerar`, { method: 'POST' });
    estado.activo.datos = r.datos;
    est.textContent = t('analyse.regenOk'); toast(t('analyse.regenOk'));
    renderNDF(); mostrarVista('ndf');
  } catch (e) { toast('Erreur : ' + e.message, true); est.textContent = 'Erreur : ' + e.message; }
  finally { btn.disabled = false; btn.textContent = t('analyse.regen'); }
});

// ============================================================
//  AUTOGUARDADO
// ============================================================
let tDatos, tOcr;
function indicar(txt) { const el = $('#autosave-ind'); if (el) el.textContent = txt; }
function autoguardarDatos() {
  if (!estado.activo) return;
  indicar(t('ndf.saving'));
  clearTimeout(tDatos);
  tDatos = setTimeout(async () => {
    try { await api(`/eventos/${estado.activo.id}/datos`, { method: 'PUT', body: JSON.stringify(estado.activo.datos) }); indicar(t('ndf.saved')); }
    catch { indicar('⚠'); }
  }, 500);
}
function autoguardarOcr() {
  if (!estado.activo) return;
  clearTimeout(tOcr);
  tOcr = setTimeout(() => { api(`/eventos/${estado.activo.id}/ocr`, { method: 'PUT', body: JSON.stringify(estado.activo.ocr || {}) }).catch(() => {}); }, 700);
}
async function guardarMeta(campos) {
  if (!estado.activo) return;
  try {
    const r = await api(`/eventos/${estado.activo.id}`, { method: 'PUT', body: JSON.stringify(campos) });
    estado.activo.estado = r.estado; estado.activo.paye = r.paye; estado.activo.budget = r.budget;
    indicar(t('ndf.saved'));
  } catch { indicar('⚠'); }
}

// ============================================================
//  NOTE DE FRAIS
// ============================================================
function datos() { return estado.activo?.datos; }

function renderNDF() {
  const sin = $('#ndf-sin-datos'); const cont = $('#ndf-contenido'); const d = datos();
  if (!estado.activo || !d) { sin.style.display = ''; cont.style.display = 'none'; return; }
  sin.style.display = 'none'; cont.style.display = '';

  if (!Array.isArray(d.observations)) d.observations = d.observations ? [d.observations] : [];
  if (!Array.isArray(d.ordre_pieces) || !d.ordre_pieces.length) d.ordre_pieces = estado.activo.archivos.slice();

  // Control: estado, pagado, presupuesto
  $('#sel-estado').value = estado.activo.estado || 'brouillon';
  pintarPaye();
  pintarBudget();

  renderObservations(d);
  renderOrdre(d);
  renderHuerfanos(d);
  paginarHoja(d);
}

// Documentos subidos que no aparecen en ninguna línea (fichier_source).
function documentosHuerfanos(d) {
  if (!d || !Array.isArray(d.lignes)) return [];
  const usados = new Set((d.lignes || []).map((l) => l.fichier_source).filter(Boolean));
  return (estado.activo?.archivos || []).filter((n) => !usados.has(n));
}
function renderHuerfanos(d) {
  const box = $('#aviso-orphelins'); if (!box) return;
  const orf = documentosHuerfanos(d);
  if (!orf.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
  box.style.display = '';
  box.innerHTML = `<b>${escapar(t('docs.orphanTitle'))}</b><ul>${orf.map((n) => `<li>${escapar(n)}</li>`).join('')}</ul>`;
}

function pintarPaye() {
  const b = $('#btn-paye');
  b.textContent = estado.activo.paye ? t('paye.yes') : t('paye.no');
  b.classList.toggle('si', estado.activo.paye);
}
function pintarBudget() {
  const el = $('#budget-info'); const bud = estado.activo.budget;
  if (bud == null) { el.textContent = t('budget.none'); el.className = 'budget-info none'; return; }
  const rest = bud - totalTTC(datos());
  if (rest >= 0) { el.textContent = `${t('budget.left')} : ${eur(rest)} / ${numFR(bud)} €`; el.className = 'budget-info ok'; }
  else { el.textContent = `${t('budget.over')} : ${eur(-rest)} (max ${numFR(bud)} €)`; el.className = 'budget-info over'; }
}
$('#sel-estado').addEventListener('change', (e) => guardarMeta({ estado: e.target.value }).then(() => { /* refresca color en home al volver */ }));
$('#btn-paye').addEventListener('click', () => { estado.activo.paye = !estado.activo.paye; pintarPaye(); guardarMeta({ paye: estado.activo.paye }); });

function renderObservations(d) {
  const cont = $('#obs-lista'); if (!cont) return;
  cont.innerHTML = '';
  if (!d.observations.length) { cont.innerHTML = `<p class="muted">${escapar(t('ndf.noObs'))}</p>`; return; }
  d.observations.forEach((txt, i) => {
    const item = document.createElement('div');
    item.className = 'obs-item';
    item.innerHTML = `<span class="obs-num">${i + 1}</span><div class="obs-txt" contenteditable="true"></div><button class="obs-del" title="✕">✕</button>`;
    const ed = item.querySelector('.obs-txt'); ed.textContent = txt;
    ed.addEventListener('input', () => { d.observations[i] = ed.textContent; autoguardarDatos(); });
    item.querySelector('.obs-del').addEventListener('click', () => { d.observations.splice(i, 1); renderObservations(d); autoguardarDatos(); });
    cont.appendChild(item);
  });
}
$('#btn-add-obs').addEventListener('click', () => { const d = datos(); if (!d) return; (d.observations ||= []).push(''); renderObservations(d); autoguardarDatos(); });

// ---- Orden de las piezas adjuntas (cards reordenables) ----
function renderOrdre(d) {
  const cont = $('#ordre-cards'); if (!cont) return;
  // Sincroniza con los archivos reales.
  const archivos = estado.activo.archivos;
  d.ordre_pieces = d.ordre_pieces.filter((n) => archivos.includes(n));
  for (const n of archivos) if (!d.ordre_pieces.includes(n)) d.ordre_pieces.push(n);
  cont.innerHTML = '';
  d.ordre_pieces.forEach((nom, idx) => {
    const card = document.createElement('div');
    card.className = 'ordre-card'; card.draggable = true; card.dataset.nom = nom;
    card.innerHTML = `<span class="ordre-num">${idx + 1}</span><span class="ordre-thumb"></span><span class="ordre-nom">${escapar(nom)}</span><span class="ordre-grip">⠿</span>`;
    pintarMiniatura(card.querySelector('.ordre-thumb'), estado.activo.id, nom);
    card.addEventListener('dragstart', () => card.classList.add('arrastrando'));
    card.addEventListener('dragend', () => { card.classList.remove('arrastrando'); guardarOrden(); });
    cont.appendChild(card);
  });
  cont.ondragover = (e) => {
    e.preventDefault();
    const arr = cont.querySelector('.arrastrando');
    const after = trasElemento(cont, e.clientY);
    if (!arr) return;
    if (after == null) cont.appendChild(arr); else cont.insertBefore(arr, after);
  };
}
function trasElemento(cont, y) {
  const els = [...cont.querySelectorAll('.ordre-card:not(.arrastrando)')];
  return els.reduce((cerca, el) => {
    const box = el.getBoundingClientRect();
    const off = y - box.top - box.height / 2;
    return (off < 0 && off > cerca.offset) ? { offset: off, element: el } : cerca;
  }, { offset: -Infinity }).element;
}
function guardarOrden() {
  const d = datos(); if (!d) return;
  d.ordre_pieces = [...$('#ordre-cards').querySelectorAll('.ordre-card')].map((c) => c.dataset.nom);
  renderOrdre(d); // renumera
  autoguardarDatos();
}

// ---- Construcción de la hoja ----
function htmlBarras() { return `<div class="ndf-bar b1"></div><div class="ndf-bar b2"></div><div class="ndf-bar b3"></div>`; }
function htmlHeader() { return `<div class="ndf-head"><div class="ndf-title">Note de Frais</div><img class="ndf-logo" src="logo-bdi.png" alt="Bureau de l'International" /></div>`; }
function htmlMeta(d) {
  return `<div class="ndf-meta">
      <div class="r"><span class="lbl">Date d'émission de la NDF : </span><input class="val" data-campo="date_emission" value="${escapar(d.date_emission || '')}" style="width:40mm" /></div>
      <div class="r"><span class="lbl">Numéro de NDF :</span></div>
      <div class="r"><input class="val" data-campo="numero_ndf" value="${escapar(d.numero_ndf || '')}" style="width:90mm" /></div>
    </div>
    <div class="ndf-twocol">
      <div>
        <span class="lbl">Nom du membre ayant engagé les dépenses :</span>
        <input class="val" data-campo="nom_membre" value="${escapar(d.nom_membre || '')}" />
        <div class="aviso-nom no-print" id="aviso-nom"></div>
        <span class="lbl" style="display:block;margin-top:2mm">IBAN abonné :</span>
        <input class="val" data-campo="iban" value="${escapar(d.iban || '')}" style="width:100%" />
        <div class="aviso-nom no-print" id="aviso-iban"></div>
      </div>
      <div>
        <span class="lbl">Nom de l'asso mère (+ section) et adresse du siège social</span>
        <input class="val" data-campo="asso" value="${escapar(d.asso || '')}" />
        <input class="adr" data-campo="adresse" value="${escapar(d.adresse || '')}" />
      </div>
    </div>`;
}
function htmlColgroup() { return `<colgroup><col class="c1" /><col class="c2" /><col class="c3" /><col class="c4" /></colgroup>`; }
function htmlThead(primera) {
  const vacia = primera ? `<tr class="vacia"><td colspan="4"></td></tr>` : '';
  return `<thead>${vacia}<tr class="cab"><th>Article</th><th>Date de l'achat</th><th>Prix HT</th><th>Taux TVA</th></tr></thead>`;
}
function filaLigne(l, i) {
  const conf = ['haute', 'moyenne', 'basse'].includes(l.confiance) ? l.confiance : '';
  return `<tr data-i="${i}" class="${conf ? 'conf-' + conf : ''}">
      <td class="art"><button class="btn-quitar no-print" title="✕">✕</button><div class="ed" data-l="article" contenteditable="true">${escapar(l.article || '')}</div></td>
      <td><input data-l="date_achat" value="${escapar(l.date_achat || '')}" /></td>
      <td class="prix"><span class="ed num" data-l="prix_ht" contenteditable="true">${l.prix_ht === '' || l.prix_ht == null ? '' : numFR(l.prix_ht)}</span> €</td>
      <td><input data-l="taux_tva" value="${escapar(l.taux_tva || '0%')}" /></td>
    </tr>`;
}
function htmlTotales(d) {
  let ht = 0, ttc = 0;
  for (const l of d.lignes || []) { const h = Number(l.prix_ht) || 0; ht += h; ttc += h * (1 + tasaTVA(l.taux_tva)); }
  return `<tr class="total"><td></td><td></td><td><b>Total HT :</b> ${eur(ht)}</td><td><b>Total TTC :</b> ${eur(ttc)}</td></tr>`;
}
function htmlSign(d) {
  const fT = d.signature ? `<img class="firma-img" src="/api/firmas/${encodeURIComponent(d.signature)}" alt="signature" />` : '';
  const fM = d.signature_membre ? `<img class="firma-img" src="/api/firmas/${encodeURIComponent(d.signature_membre)}" alt="signature" />` : '';
  return `<table class="ndf-sign"><colgroup><col /><col /></colgroup><tbody>
      <tr class="cab"><th>Signature du trésorier de la section/de l'asso mère</th><th>Signature du membre ayant engagé les dépenses</th></tr>
      <tr class="firma">
        <td class="cell-firma">${fT}<button class="btn-firma no-print" data-firma="tesorero">${t('ndf.signTrez')}</button></td>
        <td class="cell-firma">${fM}<button class="btn-firma no-print" data-firma="membre">${t('ndf.signMembre')}</button></td>
      </tr>
      <tr class="pj"><td colspan="2">Les factures au nom de l'asso/de la section en pièces-jointes</td></tr>
    </tbody></table>`;
}

function paginarHoja(d) {
  const hoja = $('#hoja-ndf'); hoja.innerHTML = '';
  const barra = document.createElement('div');
  barra.className = 'ndf-toolbar no-print';
  barra.innerHTML = `<button class="btn-add-ligne" id="btn-add-ligne">${t('ndf.addLine')}</button>`;
  hoja.appendChild(barra);

  const PX = 96 / 25.4;
  const BUDGET = 297 * PX - (16 + 16) * PX - 26;
  let pagina, tabla, tbody;
  function nuevaPagina(conCab) {
    pagina = document.createElement('div'); pagina.className = 'ndf-page'; pagina.innerHTML = htmlBarras(); hoja.appendChild(pagina);
    if (conCab) { const h = document.createElement('div'); h.innerHTML = htmlHeader() + htmlMeta(d); pagina.appendChild(h); }
  }
  function nuevaTabla(primera) { tabla = document.createElement('table'); tabla.className = 'ndf-tabla'; tabla.innerHTML = htmlColgroup() + htmlThead(primera) + '<tbody></tbody>'; pagina.appendChild(tabla); tbody = tabla.querySelector('tbody'); }
  function usado() { let h = 0; for (const c of pagina.children) if (!c.classList.contains('ndf-bar')) h += c.offsetHeight; return h; }
  const cabe = () => usado() <= BUDGET;

  nuevaPagina(true); nuevaTabla(true);
  (d.lignes || []).forEach((l, i) => {
    tbody.insertAdjacentHTML('beforeend', filaLigne(l, i));
    if (!cabe()) { tbody.lastElementChild.remove(); nuevaPagina(false); nuevaTabla(false); tbody.insertAdjacentHTML('beforeend', filaLigne(l, i)); }
  });
  tbody.insertAdjacentHTML('beforeend', htmlTotales(d));
  if (!cabe()) { tbody.lastElementChild.remove(); nuevaPagina(false); nuevaTabla(false); tbody.insertAdjacentHTML('beforeend', htmlTotales(d)); }
  pagina.insertAdjacentHTML('beforeend', htmlSign(d));
  if (!cabe()) { pagina.lastElementChild.remove(); nuevaPagina(false); pagina.insertAdjacentHTML('beforeend', htmlSign(d)); }

  conectarHoja(d);
}

function conectarHoja(d) {
  $$('#hoja-ndf input[data-campo]').forEach((inp) => {
    inp.addEventListener('input', () => {
      d[inp.dataset.campo] = inp.value;
      if (inp.dataset.campo === 'nom_membre') comprobarNom(inp.value);
      if (inp.dataset.campo === 'iban') { const av = $('#aviso-iban'); if (av && inp.value.trim()) { av.textContent = ''; av.style.display = 'none'; } }
      autoguardarDatos();
    });
  });
  const btnAdd = $('#btn-add-ligne');
  if (btnAdd) btnAdd.addEventListener('click', () => { (d.lignes ||= []).push({ article: '', date_achat: '', prix_ht: 0, taux_tva: '0%', montant_ttc: 0, fichier_source: '', confiance: 'haute' }); paginarHoja(d); autoguardarDatos(); });
  $$('#hoja-ndf .btn-firma').forEach((b) => b.addEventListener('click', () => elegirFirma(b.dataset.firma)));
  conectarLignes(d);
  comprobarNom(d.nom_membre || '');
}
function conectarLignes(d) {
  $$('#hoja-ndf .ndf-tabla tbody tr[data-i]').forEach((tr) => {
    const i = Number(tr.dataset.i); if (Number.isNaN(i)) return;
    tr.querySelectorAll('[data-l]').forEach((el) => {
      el.addEventListener('input', () => {
        const campo = el.dataset.l; const val = el.isContentEditable ? el.textContent : el.value;
        d.lignes[i][campo] = campo === 'prix_ht' ? aNumero(val) : val;
        if (campo === 'prix_ht' || campo === 'taux_tva') { actualizarTotales(d); pintarBudget(); }
        autoguardarDatos();
      });
    });
    const q = tr.querySelector('.btn-quitar');
    if (q) q.addEventListener('click', () => { d.lignes.splice(i, 1); paginarHoja(d); pintarBudget(); autoguardarDatos(); });
  });
}
function actualizarTotales(d) {
  let ht = 0, ttc = 0;
  for (const l of d.lignes || []) { const h = Number(l.prix_ht) || 0; ht += h; ttc += h * (1 + tasaTVA(l.taux_tva)); }
  const fila = $('#hoja-ndf .ndf-tabla tr.total');
  if (fila) { const td = fila.querySelectorAll('td'); td[2].innerHTML = `<b>Total HT :</b> ${eur(ht)}`; td[3].innerHTML = `<b>Total TTC :</b> ${eur(ttc)}`; }
}
function tieneApellido(nombre) {
  return String(nombre || '').split(/\s+/).some((tok) => { const l = tok.replace(/[^\p{L}]/gu, ''); return l.length >= 2 && l === l.toUpperCase() && l !== l.toLowerCase(); });
}
function comprobarNom(valor) {
  const av = $('#aviso-nom'); if (!av) return;
  if (tieneApellido(valor)) { av.textContent = ''; av.style.display = 'none'; }
  else { av.textContent = t('ndf.warnName'); av.style.display = 'block'; }
}

// ============================================================
//  FIRMAS (tesorero / miembro)
// ============================================================
let firmaDestino = 'tesorero';
const firmaFile = $('#firma-file');
async function elegirFirma(destino) {
  firmaDestino = destino;
  $('#firma-titulo').textContent = destino === 'membre' ? t('sign.titleMembre') : t('sign.titleTrez');
  let firmas = [];
  try { firmas = await api('/firmas'); } catch {}
  if (!firmas.length) { firmaFile.click(); return; }
  const cont = $('#firma-cards'); cont.innerHTML = '';
  for (const nom of firmas) {
    const card = document.createElement('div');
    card.className = 'doc-card firma-card';
    card.innerHTML = `<div class="thumb"><img src="/api/firmas/${encodeURIComponent(nom)}" alt="${escapar(nom)}" /></div><div class="pie"><div class="nombre">${escapar(nom)}</div></div>`;
    card.addEventListener('click', () => aplicarFirma(nom));
    cont.appendChild(card);
  }
  $('#modal-firma').classList.add('show');
}
function cerrarFirma() { $('#modal-firma').classList.remove('show'); }
$('#firma-cerrar').addEventListener('click', cerrarFirma);
$('#modal-firma').addEventListener('click', (e) => { if (e.target.id === 'modal-firma') cerrarFirma(); });
$('#firma-importar').addEventListener('click', () => firmaFile.click());
firmaFile.addEventListener('change', async () => {
  const file = firmaFile.files[0]; if (!file) return;
  try { const contenidoBase64 = await leerArchivoBase64(file); const r = await api('/firmas', { method: 'POST', body: JSON.stringify({ nombre: file.name, contenidoBase64 }) }); aplicarFirma(r.nombre); }
  catch (e) { toast('Erreur : ' + e.message, true); }
  firmaFile.value = '';
});
function aplicarFirma(nom) {
  const d = datos(); if (!d) return;
  if (firmaDestino === 'membre') d.signature_membre = nom; else d.signature = nom;
  cerrarFirma(); paginarHoja(d); autoguardarDatos(); toast(t('sign.set'));
}

// ============================================================
//  PDF FINAL (NDF rasterizada + adjuntos) y EXCEL
// ============================================================
$('#btn-pdf').addEventListener('click', generarPDF);
async function generarPDF() {
  const d = datos(); if (!d) return;
  // IBAN obligatorio antes de generar el PDF.
  if (!(d.iban || '').trim()) {
    const av = $('#aviso-iban');
    if (av) { av.textContent = t('ndf.ibanMissing'); av.style.display = 'block'; }
    const inp = $('#hoja-ndf input[data-campo="iban"]');
    if (inp) { inp.focus(); inp.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    toast(t('ndf.ibanMissing'), true);
    return;
  }
  const btn = $('#btn-pdf'); btn.disabled = true; btn.textContent = t('ndf.pdfGen');
  const hoja = $('#hoja-ndf');
  try {
    hoja.classList.add('exportando'); // oculta ayudas visuales en el PDF
    const pages = $$('#hoja-ndf .ndf-page');
    const imgs = [];
    for (const p of pages) {
      const canvas = await html2canvas(p, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
      imgs.push(canvas.toDataURL('image/png'));
    }
    hoja.classList.remove('exportando');
    const resp = await fetch(`/api/eventos/${estado.activo.id}/pdf`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paginas: imgs, orden: d.ordre_pieces || [] }),
    });
    if (!resp.ok) throw new Error('PDF ' + resp.status);
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    $('#doc-titulo').textContent = (d.numero_ndf || 'Note de Frais') + '.pdf';
    $('#doc-visor').innerHTML = `<iframe src="${url}"></iframe>`;
    $('#modal-doc').classList.add('show');
  } catch (e) { toast('Erreur : ' + e.message, true); }
  finally { hoja.classList.remove('exportando'); btn.disabled = false; btn.textContent = t('ndf.pdf'); }
}

$('#btn-excel').addEventListener('click', exportarExcel);
function exportarExcel() {
  const d = datos(); if (!d) return;
  const filas = (d.lignes || []).map((l) =>
    `<tr><td>${escapar(l.article)}</td><td>${escapar(l.date_achat)}</td><td>${numFR(l.prix_ht)}</td><td>${escapar(l.taux_tva)}</td><td>${numFR((Number(l.prix_ht) || 0) * (1 + tasaTVA(l.taux_tva)))}</td></tr>`
  ).join('');
  let ht = 0, ttc = 0;
  for (const l of d.lignes || []) { const h = Number(l.prix_ht) || 0; ht += h; ttc += h * (1 + tasaTVA(l.taux_tva)); }
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8"></head><body>
    <table border="1">
      <tr><th>NDF</th><td>${escapar(d.numero_ndf)}</td></tr>
      <tr><th>Membre</th><td>${escapar(d.nom_membre)}</td></tr>
      <tr><th>Section</th><td>${escapar(d.section)}</td></tr>
      <tr><th>Date</th><td>${escapar(d.date_emission)}</td></tr>
    </table><br/>
    <table border="1">
      <tr><th>Article</th><th>Date</th><th>Prix HT</th><th>Taux TVA</th><th>Montant TTC</th></tr>
      ${filas}
      <tr><th colspan="2">Total HT</th><td>${numFR(ht)}</td><th>Total TTC</th><td>${numFR(ttc)}</td></tr>
    </table></body></html>`;
  const blob = new Blob(['﻿', html], { type: 'application/vnd.ms-excel' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${d.numero_ndf || 'NoteDeFrais'}.xls`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ============================================================
//  "How to use"
// ============================================================
function abrirAyuda(clave) {
  const a = (AYUDA[IDIOMA] && AYUDA[IDIOMA][clave]) || AYUDA.fr[clave]; if (!a) return;
  $('#howto-titulo').textContent = t('howto.prefix') + a.titulo;
  $('#howto-cuerpo').innerHTML = a.cuerpo;
  $('#modal-howto').classList.add('show');
}
function cerrarAyuda() { $('#modal-howto').classList.remove('show'); }
$$('.btn-howto').forEach((b) => b.addEventListener('click', () => abrirAyuda(b.dataset.howto)));
$('#howto-cerrar').addEventListener('click', cerrarAyuda);
$('#modal-howto').addEventListener('click', (e) => { if (e.target.id === 'modal-howto') cerrarAyuda(); });

// ============================================================
//  Atajos de teclado
// ============================================================
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { cerrarAyuda(); cerrarVisor(); cerrarFirma(); cerrarCrear(); return; }
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); if (estado.activo?.datos) { clearTimeout(tDatos); api(`/eventos/${estado.activo.id}/datos`, { method: 'PUT', body: JSON.stringify(estado.activo.datos) }).then(() => indicar(t('ndf.saved'))).catch(() => {}); } return; }
  if (ctrl && e.key.toLowerCase() === 'p') { if (estado.activo?.datos && $('#vista-ndf').classList.contains('activa')) { e.preventDefault(); generarPDF(); } return; }
  // Flechas: navegar entre documentos en Analyse
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && $('#vista-analyse').classList.contains('activa') && document.activeElement.tagName !== 'TEXTAREA') {
    const items = $$('.analyse-item'); if (!items.length) return;
    const y = window.scrollY; let idx = 0;
    items.forEach((it, k) => { if (it.offsetTop <= y + 120) idx = k; });
    const next = e.key === 'ArrowRight' ? Math.min(items.length - 1, idx + 1) : Math.max(0, idx - 1);
    items[next].scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});

// ============================================================
//  Servidor: estado + apagado al cerrar la ventana
// ============================================================
function pintarEstado(conectado) {
  const ind = $('#estado-servidor');
  ind.classList.toggle('conectado', conectado);
  ind.classList.toggle('desconectado', !conectado);
  ind.querySelector('.txt').textContent = conectado ? t('server.connected') : t('server.down');
  $('#aviso-servidor').classList.toggle('show', !conectado);
}
async function latir() { try { const r = await fetch('/api/ping', { method: 'POST', keepalive: true }); pintarEstado(r.ok); } catch { pintarEstado(false); } }
latir(); setInterval(latir, 4000);
$('#btn-reintentar').addEventListener('click', () => location.reload());
// Al cerrar la pestaña/ventana: avisar al servidor (un F5 lo cancela con el siguiente ping).
window.addEventListener('pagehide', () => { try { navigator.sendBeacon('/api/cerrar', new Blob([], { type: 'application/json' })); } catch {} });

// ---------- Deep-link ----------
async function aplicarHash() {
  const m = /^#evento=([^&]+)(?:&tab=(\w+))?(?:&voir=([^&]+))?/.exec(location.hash);
  if (!m) return;
  const id = decodeURIComponent(m[1]);
  if (!estado.activo || estado.activo.id !== id) { try { await abrirEvento(id); } catch { return; } }
  if (m[2]) mostrarVista(m[2]);
  if (m[3]) abrirVisor(decodeURIComponent(m[3]));
}

// ---------- Arranque ----------
aplicarIdioma();
cargarEventos().then(aplicarHash).catch((e) => toast('Erreur : ' + e.message, true));
