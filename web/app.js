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
  personas: [],
  activo: null,
  analizando: false,
  analisisToken: 0,
  filtro: { texto: '', estados: [] },
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

function rolLabel(role) { return t('role.' + (role || 'membre')) || (role || ''); }
function slugNombre(n) {
  return String(n || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'Personne';
}

// Enlace al repo + idioma
$('#link-repo').href = REPO_URL;
$('#sel-idioma').value = IDIOMA;
$('#sel-idioma').addEventListener('change', (e) => {
  IDIOMA = e.target.value; localStorage.setItem('idioma-ndf', IDIOMA);
  aplicarIdioma(); reRenderTodo();
});
function reRenderTodo() {
  pintarEstado($('#estado-servidor').classList.contains('conectado'));
  renderChipsEstado();
  if (!estado.activo) { renderEventos(); renderPersonnes(); }
  else { renderInfoEvento(); renderDocumentos(); renderAnalyse(); renderNDF(); renderSignee(); }
}

// ---------- Navegación ----------
$$('#tabs button[data-vista]').forEach((b) => b.addEventListener('click', () => mostrarVista(b.dataset.vista)));
// Pestañas de inicio (siempre visibles): Personnes · Événements.
$$('#tabs-home button[data-home]').forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.home === 'personnes') mostrarPersonnes();
  else volverAEventos();
}));
function marcarHome(cual) {
  $$('#tabs-home button[data-home]').forEach((b) => b.classList.toggle('activa', b.dataset.home === cual));
}
function mostrarVista(nombre) {
  $$('#tabs button[data-vista]').forEach((b) => b.classList.toggle('activa', b.dataset.vista === nombre));
  $$('.vista').forEach((v) => v.classList.remove('activa'));
  $('#vista-' + nombre).classList.add('activa');
  // La paginación A4 necesita que la hoja sea visible para medir alturas;
  // se repagina al mostrar la pestaña Note de Frais.
  if (nombre === 'ndf' && datos()) paginarHoja(datos());
  if (nombre === 'signee') renderSignee();
}
function volverAEventos() {
  estado.activo = null;
  $('#tabs').style.display = 'none';
  marcarHome('eventos');
  $('#tabs-home button[data-home="eventos"]').classList.remove('editando');
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

// Chips de estado (multi-selección): ninguno seleccionado = todos.
function renderChipsEstado() {
  const cont = $('#chips-estado'); if (!cont) return;
  cont.innerHTML = '';
  for (const est of ESTADOS) {
    const chip = document.createElement('button');
    chip.className = `chip est-${est}` + (estado.filtro.estados.includes(est) ? ' activo' : '');
    chip.textContent = t('estado.' + est);
    chip.addEventListener('click', () => {
      const i = estado.filtro.estados.indexOf(est);
      if (i >= 0) estado.filtro.estados.splice(i, 1); else estado.filtro.estados.push(est);
      renderChipsEstado(); renderEventos();
    });
    cont.appendChild(chip);
  }
}

function coincide(ev) {
  const { texto, estados } = estado.filtro;
  if (estados.length && !estados.includes(ev.estado || 'brouillon')) return false;
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
let crearDocs = [];   // ficheros adjuntados en el modal (se suben tras crear el evento)
function abrirCrear() {
  $('#crear-error').textContent = '';
  crearDocs = []; renderCrearDocs();
  llenarSelectorPersonas();
  $('#modal-crear').classList.add('show');
  $('#nuevo-nom').focus();
}
function cerrarCrear() { $('#modal-crear').classList.remove('show'); }
$('#fab-crear').addEventListener('click', abrirCrear);
$('#crear-cerrar').addEventListener('click', cerrarCrear);
$('#modal-crear').addEventListener('click', (e) => { if (e.target.id === 'modal-crear') cerrarCrear(); });

// Documentos adjuntados en el modal (staged): chips con borrar.
function renderCrearDocs() {
  const cont = $('#crear-docs-lista'); if (!cont) return;
  cont.innerHTML = '';
  crearDocs.forEach((f, i) => {
    const chip = document.createElement('span');
    chip.className = 'doc-chip';
    chip.innerHTML = `<span class="doc-chip-nom">${escapar(f.name)}</span><button class="doc-chip-del" title="✕" type="button">✕</button>`;
    chip.querySelector('.doc-chip-del').addEventListener('click', () => { crearDocs.splice(i, 1); renderCrearDocs(); });
    cont.appendChild(chip);
  });
}
function anadirCrearDocs(files) {
  for (const f of files) crearDocs.push(f);
  renderCrearDocs();
}
$('#crear-add-docs').addEventListener('click', () => $('#crear-file-input').click());
$('#crear-file-input').addEventListener('change', () => { anadirCrearDocs($('#crear-file-input').files); $('#crear-file-input').value = ''; });
{
  const z = $('#crear-dropzone');
  z.addEventListener('dragover', (e) => { e.preventDefault(); z.classList.add('dragover'); });
  z.addEventListener('dragleave', (e) => { if (!z.contains(e.relatedTarget)) z.classList.remove('dragover'); });
  z.addEventListener('drop', (e) => { e.preventDefault(); z.classList.remove('dragover'); anadirCrearDocs(e.dataTransfer.files); });
}

// Rellena el desplegable de personas en el modal de creación.
function llenarSelectorPersonas(seleccionar) {
  const sel = $('#nuevo-membre-sel');
  const actual = seleccionar || sel.value;
  sel.innerHTML = `<option value="">${t('form.choosePerson')}</option>` +
    estado.personas.map((p) => `<option value="${p.id}">${escapar(p.nom)}</option>`).join('');
  if (actual) sel.value = actual;
  mostrarIbanPersona();
}
function mostrarIbanPersona() {
  const p = estado.personas.find((x) => x.id === $('#nuevo-membre-sel').value);
  $('#membre-iban-preview').textContent = p && p.iban ? `IBAN : ${p.iban}` : '';
}
$('#nuevo-membre-sel').addEventListener('change', mostrarIbanPersona);

$('#btn-crear').addEventListener('click', async () => {
  const nom = $('#nuevo-nom').value.trim();
  const section = $('#nuevo-section').value;
  const date = $('#nuevo-date').value;
  const budget = $('#nuevo-budget').value;
  const persona = estado.personas.find((x) => x.id === $('#nuevo-membre-sel').value);
  const err = $('#crear-error');
  if (!nom || !section) { err.textContent = t('form.needNameSection'); return; }
  if (!persona) { err.textContent = t('form.needPerson'); return; }
  err.textContent = '';
  const ev = await api('/eventos', { method: 'POST', body: JSON.stringify({
    nom, section, date, budget, membre: persona.nom, iban: persona.iban || '',
  }) });
  $('#nuevo-nom').value = $('#nuevo-date').value = $('#nuevo-budget').value = '';
  $('#nuevo-section').selectedIndex = 0; $('#nuevo-membre-sel').value = ''; mostrarIbanPersona();
  const docs = crearDocs; crearDocs = [];
  cerrarCrear(); toast(t('event.created'));
  await cargarEventos(); await abrirEvento(ev.id);
  // Sube los documentos adjuntados en el modal; subirArchivos lanza el análisis al terminar.
  if (docs.length) await subirArchivos(docs);
});

// ============================================================
//  PERSONNES (base de datos de RIB)
// ============================================================
async function cargarPersonas() { estado.personas = await api('/personnes').catch(() => []); }

async function mostrarPersonnes() {
  estado.activo = null;
  $('#tabs').style.display = 'none';
  marcarHome('personnes');
  $('#tabs-home button[data-home="eventos"]').classList.remove('editando');
  $('#fab-crear').style.display = 'none';
  $('#evento-activo').textContent = t('header.noEvent');
  $$('.vista').forEach((v) => v.classList.remove('activa'));
  $('#vista-personnes').classList.add('activa');
  await cargarPersonas();
  renderPersonnes();
}

function renderPersonnes() {
  const cont = $('#personnes-lista');
  if (!estado.personas.length) { cont.innerHTML = `<p class="vacio">${escapar(t('personnes.empty'))}</p>`; return; }
  cont.innerHTML = '';
  for (const p of estado.personas) {
    const row = document.createElement('div');
    row.className = 'personne-row clicable';
    row.title = t('person.edit');
    row.innerHTML = `
      <div class="personne-info">
        <div class="personne-nom">${escapar(p.nom)}</div>
        <div class="personne-role muted">${escapar(rolLabel(p.role))}</div>
        <div class="personne-iban">${escapar(p.iban || '—')}</div>
        <div class="personne-extra muted">${[p.bic, p.banque].filter(Boolean).map(escapar).join(' · ')}</div>
      </div>
      <div class="barra-acciones">
        <button class="peligro peque btn-del">${t('person.del')}</button>
      </div>`;
    row.addEventListener('click', (e) => { if (e.target.closest('button')) return; abrirPersonne(p); });
    row.querySelector('.btn-del').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(t('personnes.confirmDel', { x: p.nom }))) return;
      await api('/personnes/' + p.id, { method: 'DELETE' });
      await cargarPersonas(); renderPersonnes(); toast(t('personnes.deleted'));
    });
    cont.appendChild(row);
  }
}

// Modal añadir/editar persona. `volver` indica a dónde regresar tras crear (para el flujo de evento).
let personneEditId = null;
let personneVolverACrear = false;
function abrirPersonne(p, desdeCrear) {
  personneEditId = p && p.id ? p.id : null;
  personneVolverACrear = !!desdeCrear;
  $('#personne-titulo').textContent = personneEditId ? t('person.editTitle') : t('person.addTitle');
  $('#p-titulaire').value = p?.titulaire || p?.nom || '';
  $('#p-role').value = p?.role || 'membre';
  $('#p-iban').value = p?.iban || '';
  $('#p-bic').value = p?.bic || '';
  $('#p-banque').value = p?.banque || '';
  $('#p-domiciliation').value = p?.domiciliation || '';
  $('#personne-error').textContent = '';
  $('#personne-rib-estado').textContent = '';
  $('#modal-personne').classList.add('show');
}
function cerrarPersonne() { $('#modal-personne').classList.remove('show'); }
$('#personne-cerrar').addEventListener('click', cerrarPersonne);
$('#modal-personne').addEventListener('click', (e) => { if (e.target.id === 'modal-personne') cerrarPersonne(); });
$('#btn-add-personne').addEventListener('click', () => abrirPersonne(null, false));
$('#btn-add-personne-modal').addEventListener('click', () => abrirPersonne(null, true));

// Importar RIB → IA rellena los campos.
$('#personne-importar').addEventListener('click', () => $('#personne-rib').click());
$('#personne-rib').addEventListener('change', async () => {
  const file = $('#personne-rib').files[0]; if (!file) return;
  const est = $('#personne-rib-estado');
  est.innerHTML = '<span class="spinner"></span> ' + t('person.extracting');
  try {
    const contenidoBase64 = await leerArchivoBase64(file);
    const r = await api('/personnes/extraire', { method: 'POST', body: JSON.stringify({ nombre: file.name, contenidoBase64 }) });
    $('#p-titulaire').value = r.titulaire || $('#p-titulaire').value;
    $('#p-iban').value = r.iban || '';
    $('#p-bic').value = r.bic || '';
    $('#p-banque').value = r.banque || '';
    $('#p-domiciliation').value = r.domiciliation || '';
    est.textContent = t('person.extractOk');
  } catch (e) { est.textContent = 'Erreur : ' + e.message; }
  $('#personne-rib').value = '';
});

$('#btn-save-personne').addEventListener('click', async () => {
  const titulaire = $('#p-titulaire').value.trim();
  const err = $('#personne-error');
  if (!titulaire) { err.textContent = t('person.needName'); return; }
  err.textContent = '';
  const role = $('#p-role').value || 'membre';
  const cuerpo = {
    nom: titulaire, titulaire, role,
    iban: $('#p-iban').value.trim(), bic: $('#p-bic').value.trim(),
    banque: $('#p-banque').value.trim(), domiciliation: $('#p-domiciliation').value.trim(),
  };
  let saved;
  if (personneEditId) saved = await api('/personnes/' + personneEditId, { method: 'PUT', body: JSON.stringify(cuerpo) });
  else saved = await api('/personnes', { method: 'POST', body: JSON.stringify(cuerpo) });
  await cargarPersonas();
  cerrarPersonne(); toast(t('personnes.saved'));
  if (personneVolverACrear) llenarSelectorPersonas(saved.id);   // vuelve al modal de evento con la persona elegida
  else renderPersonnes();
});

// ---------- Abrir evento ----------
async function abrirEvento(id) {
  estado.activo = await api('/eventos/' + id);
  estado.activo.ocr = estado.activo.ocr || {};
  estado.analizando = false; estado.analisisToken++;
  $('#evento-activo').textContent = `${seccionDe(estado.activo)} — ${estado.activo.nom}`;
  // Pestañas jerárquicas: la fila Personnes/Événements sigue visible; aparece la subfila.
  marcarHome('eventos');
  $('#tabs-home button[data-home="eventos"]').classList.add('editando');
  $('#tabs').style.display = '';
  $('#fab-crear').style.display = 'none';
  renderInfoEvento(); renderDocumentos(); renderAnalyse(); renderNDF(); renderSignee();
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
// ---- Tarjeta de info del evento (editable, autoguardado, propaga a la NDF) ----
function renderInfoEvento() {
  const a = estado.activo; if (!a) return;
  $('#info-nom').value = a.nom || '';
  $('#info-section').value = a.section || '';
  $('#info-date').value = a.date || '';
  $('#info-budget').value = a.budget != null ? a.budget : '';
  // Selector de personas (valor = id); se preselecciona por nombre del membre actual.
  const sel = $('#info-membre-sel');
  sel.innerHTML = `<option value="">${t('form.choosePerson')}</option>` +
    estado.personas.map((p) => `<option value="${p.id}">${escapar(p.nom)}</option>`).join('');
  const actual = estado.personas.find((p) => (p.nom || '') === (a.membre || ''));
  sel.value = actual ? actual.id : '';
  mostrarIbanInfo();
}
function mostrarIbanInfo() {
  const p = estado.personas.find((x) => x.id === $('#info-membre-sel').value);
  $('#info-iban-preview').textContent = p && p.iban ? `IBAN : ${p.iban}` : '';
}
let tInfo;
function guardarInfoEvento() {
  const a = estado.activo; if (!a) return;
  $('#info-autosave').textContent = t('ndf.saving');
  a.nom = $('#info-nom').value.trim();
  a.section = $('#info-section').value;
  a.date = $('#info-date').value;
  const bRaw = $('#info-budget').value;
  a.budget = (bRaw === '' || bRaw == null) ? null : Number(bRaw);
  const persona = estado.personas.find((x) => x.id === $('#info-membre-sel').value);
  if (persona) { a.membre = persona.nom; a.iban = persona.iban || ''; }
  mostrarIbanInfo();
  // Refleja en cabecera y en la lista de inicio.
  $('#evento-activo').textContent = `${seccionDe(a)} — ${a.nom}`;
  const it = estado.eventos.find((e) => e.id === a.id);
  if (it) { it.nom = a.nom; it.section = a.section; it.date = a.date; it.budget = a.budget; it.membre = a.membre; }
  // Propaga a la hoja NDF (derivación idéntica a construirDatos del servidor).
  const d = a.datos;
  if (d) {
    const annee = (a.date && a.date.slice(0, 4)) || String(new Date().getFullYear());
    d.numero_ndf = `NDF_${(a.nom || '').trim().replace(/\s+/g, '-')}_${annee}`;
    d.section = a.section || '';
    d.asso = `Bureau de l'International (${a.section || ''})`;
    d.date_evenement = a.date || '';
    if (persona) { d.nom_membre = persona.nom; d.iban = persona.iban || ''; }
    autoguardarDatos();
    if ($('#vista-ndf').classList.contains('activa')) paginarHoja(d); else renderNDF();
    pintarBudget();
  }
  // Guardado de meta (debounced).
  clearTimeout(tInfo);
  tInfo = setTimeout(async () => {
    try {
      await api(`/eventos/${a.id}`, { method: 'PUT', body: JSON.stringify({
        nom: a.nom, section: a.section, date: a.date, budget: a.budget, membre: a.membre, iban: a.iban,
      }) });
      $('#info-autosave').textContent = t('ndf.saved');
    } catch { $('#info-autosave').textContent = '⚠'; }
  }, 500);
}
['#info-nom', '#info-budget'].forEach((s) => $(s).addEventListener('input', guardarInfoEvento));
['#info-section', '#info-date', '#info-membre-sel'].forEach((s) => $(s).addEventListener('change', guardarInfoEvento));

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
        <button class="sec peque btn-carpeta">${t('docs.openFolder')}</button>
        <button class="peligro peque btn-del">✕</button>
      </div>` : ''}
    </div>`;
  if (conAcciones) {
    card.addEventListener('click', (e) => { if (e.target.closest('button, a, .nombre')) return; irAnalyse(nom); });
    card.querySelector('.btn-voir').addEventListener('click', (e) => { e.stopPropagation(); abrirVisor(nom); });
    card.querySelector('.btn-carpeta').addEventListener('click', (e) => { e.stopPropagation(); abrirCarpeta(nom); });
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
async function reextraerDocumento(nom, btn) {
  if (!estado.activo) return;
  const original = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> ${t('analyse.retrying')}`;
  try {
    const r = await api(`/eventos/${estado.activo.id}/archivos/${encodeURIComponent(nom)}/reextraer`, { method: 'POST' });
    estado.activo.ocr = estado.activo.ocr || {};
    estado.activo.ocr[nom] = r.transcription;
    renderAnalyse();
    toast(t('analyse.retried'));
  } catch (e) {
    toast(e.message, true);
    btn.disabled = false; btn.innerHTML = original;
  }
}
async function abrirCarpeta(nom) {
  try {
    await api(`/eventos/${estado.activo.id}/archivos/${encodeURIComponent(nom)}/abrir-carpeta`, { method: 'POST' });
  } catch (e) { toast(e.message, true); }
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
['dragover', 'drop'].forEach((ev) => window.addEventListener(ev, (e) => { if (!e.target.closest('.dropzone-cards, .dropzone-signee, .dropzone-crear')) e.preventDefault(); }));
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
        <button class="sec peque btn-carpeta">${t('docs.openFolder')}</button>
        <button class="sec peque btn-reextraer">${t('analyse.retry')}</button>
      </div>
      <div class="analyse-split">
        <div class="orig">${orig}</div>
        <div class="txt">${panel}</div>
      </div>`;
    const ta = item.querySelector('textarea');
    if (ta) ta.addEventListener('input', (e) => { a.ocr[nom] = e.target.value; autoguardarOcr(); });
    item.querySelector('.btn-carpeta').addEventListener('click', () => abrirCarpeta(nom));
    item.querySelector('.btn-reextraer').addEventListener('click', (e) => reextraerDocumento(nom, e.currentTarget));
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
    estado.activo.estado = r.estado; estado.activo.budget = r.budget;
    // Mantén sincronizada la lista de la home (color del borde y badge "payé"=remboursé al volver).
    const it = estado.eventos.find((e) => e.id === estado.activo.id);
    if (it) { it.estado = r.estado; it.budget = r.budget; }
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

  // Control: estado, presupuesto (el estado "remboursé" indica que está pagado)
  $('#sel-estado').value = estado.activo.estado || 'brouillon';
  pintarBudget();

  renderObservations(d);
  renderOrdre(d);
  renderHuerfanos(d);
  paginarHoja(d);
}

// Documentos subidos que no aparecen en ninguna línea (fichiers_source / fichier_source).
function documentosHuerfanos(d) {
  if (!d || !Array.isArray(d.lignes)) return [];
  const norm = (s) => String(s || '').trim().toLowerCase();
  const usados = new Set();
  for (const l of d.lignes || []) {
    if (Array.isArray(l.fichiers_source)) for (const f of l.fichiers_source) if (f) usados.add(norm(f));
    if (l.fichier_source) usados.add(norm(l.fichier_source));   // compat. con datos antiguos
  }
  return (estado.activo?.archivos || []).filter((n) => !usados.has(norm(n)));
}
function renderHuerfanos(d) {
  const box = $('#aviso-orphelins'); if (!box) return;
  const orf = documentosHuerfanos(d);
  if (!orf.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
  box.style.display = '';
  box.innerHTML = `<b>${escapar(t('docs.orphanTitle'))}</b><ul>${orf.map((n) => `<li>${escapar(n)}</li>`).join('')}</ul>`;
}

function pintarBudget() {
  const el = $('#budget-info'); const bud = estado.activo.budget;
  if (bud == null) { el.textContent = t('budget.none'); el.className = 'budget-info none'; return; }
  const gastado = totalTTC(datos());
  el.textContent = `${t('budget.spent')} : ${eur(gastado)} / ${numFR(bud)} €`;
  el.className = 'budget-info ' + (gastado > bud ? 'over' : 'ok');
}
$('#sel-estado').addEventListener('change', (e) => guardarMeta({ estado: e.target.value }));

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

// Botón "Ajouter une ligne" (aside, junto a la tabla). Cableado una sola vez.
$('#btn-add-ligne').addEventListener('click', () => {
  const d = datos(); if (!d) return;
  (d.lignes ||= []).push({ article: '', date_achat: '', prix_ht: 0, taux_tva: 0, montant_ttc: 0, fichiers_source: [], confiance: 'haute' });
  paginarHoja(d); autoguardarDatos();
});

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
      <td><input data-l="date_achat" inputmode="numeric" value="${escapar(l.date_achat || '')}" /></td>
      <td class="prix"><span class="ed num" data-l="prix_ht" contenteditable="true">${l.prix_ht === '' || l.prix_ht == null ? '' : numFR(l.prix_ht)}</span> €</td>
      <td class="taux"><span class="ed num" data-l="taux_tva" contenteditable="true">${tvaStr(l.taux_tva)}</span> %</td>
    </tr>`;
}
// TVA: el dato es numérico (porcentaje). Mostrar sin decimales superfluos.
function tvaNum(v) { const n = parseFloat(String(v ?? '').replace(',', '.').replace('%', '')); return isNaN(n) ? 0 : n; }
function tvaStr(v) { const n = tvaNum(v); return Number.isInteger(n) ? String(n) : String(n).replace('.', ','); }
// Restringe la entrada de un campo (input o contenteditable) a los caracteres permitidos.
function soloPermitidos(el, re) {
  el.addEventListener('beforeinput', (e) => {
    if (e.inputType === 'insertText' && e.data && [...e.data].some((c) => !re.test(c))) e.preventDefault();
    if (e.inputType === 'insertFromPaste') {
      const txt = (e.dataTransfer || window.clipboardData)?.getData?.('text') || '';
      if (txt && [...txt].some((c) => !re.test(c))) e.preventDefault();
    }
  });
}
function htmlTotales(d) {
  let ht = 0, ttc = 0;
  for (const l of d.lignes || []) { const h = Number(l.prix_ht) || 0; ht += h; ttc += h * (1 + tasaTVA(l.taux_tva)); }
  return `<tr class="total"><td></td><td></td><td><b>Total HT :</b> ${eur(ht)}</td><td><b>Total TTC :</b> ${eur(ttc)}</td></tr>`;
}
function htmlSign(d) {
  const fT = d.signature ? `<img class="firma-img" src="/api/firmas/${encodeURIComponent(d.signature)}" alt="signature" />` : '';
  // Si hay firma puesta, se ofrece un botón para retirarla (p. ej. para firmar de otra forma).
  const quitarT = d.signature ? `<button class="btn-firma-quitar no-print" title="${t('ndf.removeSign')}">✕</button>` : '';
  return `<table class="ndf-sign"><colgroup><col /><col /></colgroup><tbody>
      <tr class="cab"><th>Signature du trésorier de la section/de l'asso mère</th><th>Signature du membre ayant engagé les dépenses</th></tr>
      <tr class="firma">
        <td class="cell-firma">${fT}${quitarT}<button class="btn-firma no-print" data-firma="tesorero">${t('ndf.signTrez')}</button></td>
        <td class="cell-firma"></td>
      </tr>
      <tr class="pj"><td colspan="2">Les factures au nom de l'asso/de la section en pièces-jointes</td></tr>
    </tbody></table>`;
}

function paginarHoja(d) {
  const hoja = $('#hoja-ndf'); hoja.innerHTML = '';

  let pagina, tabla, tbody, avail = 0, primeraTabla = null;
  function calcAvail() {
    const cs = getComputedStyle(pagina);
    // Altura útil real de la página A4 (independiente del cálculo en mm).
    avail = pagina.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  }
  function nuevaPagina(conCab) {
    pagina = document.createElement('div'); pagina.className = 'ndf-page'; pagina.innerHTML = htmlBarras(); hoja.appendChild(pagina);
    calcAvail();
    if (conCab) { const h = document.createElement('div'); h.innerHTML = htmlHeader() + htmlMeta(d); pagina.appendChild(h); }
  }
  function nuevaTabla(primera) { tabla = document.createElement('table'); tabla.className = 'ndf-tabla'; tabla.innerHTML = htmlColgroup() + htmlThead(primera) + '<tbody></tbody>'; pagina.appendChild(tabla); tbody = tabla.querySelector('tbody'); if (primera) primeraTabla = tabla; }
  function usado() { let h = 0; for (const c of pagina.children) if (!c.classList.contains('ndf-bar')) h += c.offsetHeight; return h; }
  // Margen de seguridad: nada debe quedar pegado al borde inferior.
  const cabe = (reserva = 0) => usado() + reserva <= avail - 18;

  // Mide la altura real del bloque de firmas para reservarla. IMPORTANTE: el temp
  // se inserta DENTRO de #hoja-ndf con la clase .ndf-page para que apliquen las reglas
  // `#hoja-ndf .ndf-sign…` (alto fijo 28mm de la fila de firma, bordes, fuente). Si se
  // mide fuera de #hoja-ndf, esas reglas no aplican y la reserva queda infraestimada.
  function altoFirmas() {
    const tmp = document.createElement('div');
    tmp.className = 'ndf-page';
    tmp.style.cssText = 'position:absolute; left:-9999px; top:0; visibility:hidden; height:auto; box-shadow:none; border:0;';
    tmp.innerHTML = htmlSign(d);
    hoja.appendChild(tmp);
    const el = tmp.querySelector('.ndf-sign');
    const h = (el ? el.offsetHeight : 0) + 12;
    tmp.remove();
    return h;
  }

  nuevaPagina(true);
  // Si la hoja está oculta (clientHeight≈0), `avail` sale ≤0 y `cabe()` sería siempre
  // falso → se generarían páginas basura (una fila por página). No paginamos hasta que
  // sea visible: mostrarVista('ndf') vuelve a paginar al mostrar la pestaña.
  if (avail <= 0) { hoja.innerHTML = ''; return; }
  nuevaTabla(true);
  const reservaFirmas = altoFirmas();

  const lignes = d.lignes || [];
  lignes.forEach((l, i) => {
    tbody.insertAdjacentHTML('beforeend', filaLigne(l, i));
    if (!cabe()) { tbody.lastElementChild.remove(); nuevaPagina(false); nuevaTabla(false); tbody.insertAdjacentHTML('beforeend', filaLigne(l, i)); }
  });
  // La fila de totales debe caber junto con las firmas; si no, salta de página.
  tbody.insertAdjacentHTML('beforeend', htmlTotales(d));
  if (!cabe(reservaFirmas)) { tbody.lastElementChild.remove(); nuevaPagina(false); nuevaTabla(false); tbody.insertAdjacentHTML('beforeend', htmlTotales(d)); }
  // Firmas en la misma página si caben; si no, página nueva.
  pagina.insertAdjacentHTML('beforeend', htmlSign(d));
  if (!cabe()) { pagina.lastElementChild.remove(); nuevaPagina(false); pagina.insertAdjacentHTML('beforeend', htmlSign(d)); }

  conectarHoja(d);
  alinearComplementos(primeraTabla);
}

// Alinea el aside (botón "Ajouter une ligne" + leyenda) con el borde superior de la
// tabla de conceptos, para que quede justo al lado de la tabla y no arriba del todo.
function alinearComplementos(tabla) {
  const aside = $('.ndf-aside'); const wrap = $('.ndf-hoja-wrap');
  if (!aside || !wrap) return;
  if (!tabla) { aside.style.marginTop = '0px'; return; }
  const off = tabla.getBoundingClientRect().top - wrap.getBoundingClientRect().top;
  aside.style.marginTop = Math.max(0, off) + 'px';
}

function conectarHoja(d) {
  $$('#hoja-ndf input[data-campo]').forEach((inp) => {
    if (inp.dataset.campo === 'date_emission') soloPermitidos(inp, /[0-9/]/);
    inp.addEventListener('input', () => {
      d[inp.dataset.campo] = inp.value;
      if (inp.dataset.campo === 'nom_membre') comprobarNom(inp.value);
      if (inp.dataset.campo === 'iban') { const av = $('#aviso-iban'); if (av && inp.value.trim()) { av.textContent = ''; av.style.display = 'none'; } }
      autoguardarDatos();
    });
  });
  $$('#hoja-ndf .btn-firma').forEach((b) => b.addEventListener('click', () => elegirFirma()));
  $$('#hoja-ndf .btn-firma-quitar').forEach((b) => b.addEventListener('click', () => quitarFirma()));
  conectarLignes(d);
  comprobarNom(d.nom_membre || '');
}
function conectarLignes(d) {
  $$('#hoja-ndf .ndf-tabla tbody tr[data-i]').forEach((tr) => {
    const i = Number(tr.dataset.i); if (Number.isNaN(i)) return;
    tr.querySelectorAll('[data-l]').forEach((el) => {
      const campo = el.dataset.l;
      if (campo === 'prix_ht' || campo === 'taux_tva') soloPermitidos(el, /[0-9.,]/);
      if (campo === 'date_achat') soloPermitidos(el, /[0-9/]/);
      el.addEventListener('input', () => {
        const val = el.isContentEditable ? el.textContent : el.value;
        d.lignes[i][campo] = (campo === 'prix_ht' || campo === 'taux_tva') ? aNumero(val) : val;
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
//  NDF SIGNÉE (adjuntar la nota firmada → _signee en la carpeta)
// ============================================================
function renderSignee() {
  const cont = $('#signee-cont'); if (!cont) return;
  const a = estado.activo;
  if (!a) { cont.innerHTML = ''; return; }
  const f = a.signee;
  if (!f) {
    cont.innerHTML = `<p class="vacio">${escapar(t('signee.none'))}</p>`;
    return;
  }
  const url = `/api/eventos/${a.id}/signee?t=${Date.now()}`;
  const preview = esImagen(f) ? `<img src="${url}" alt="${escapar(f)}" />` : `<iframe src="${url}" title="${escapar(f)}"></iframe>`;
  cont.innerHTML = `
    <div class="signee-actual">
      <div class="signee-head">
        <span class="signee-nom">${escapar(f)}</span>
        <div class="barra-acciones">
          <a class="sec peque" href="${url}" download="${escapar(f)}">${t('signee.download')}</a>
          <button class="sec peque" id="btn-carpeta-signee">${t('docs.openFolder')}</button>
          <button class="sec peque" id="btn-replace-signee">${t('signee.replace')}</button>
          <button class="peligro peque" id="btn-del-signee">${t('signee.delete')}</button>
        </div>
      </div>
      <div class="signee-preview">${preview}</div>
    </div>`;
  cont.querySelector('#btn-carpeta-signee').addEventListener('click', async () => {
    try { await api(`/eventos/${a.id}/signee/abrir-carpeta`, { method: 'POST' }); }
    catch (e) { toast(e.message, true); }
  });
  cont.querySelector('#btn-replace-signee').addEventListener('click', () => $('#signee-input').click());
  cont.querySelector('#btn-del-signee').addEventListener('click', async () => {
    if (!confirm(t('signee.confirmDel'))) return;
    await api(`/eventos/${a.id}/signee`, { method: 'DELETE' });
    await recargarActivo(); renderSignee(); toast(t('signee.deleted'));
  });
}
async function subirSignee(file) {
  if (!estado.activo || !file) return;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!['pdf', 'jpg', 'jpeg', 'png'].includes(ext)) { toast(t('signee.badType'), true); return; }
  try {
    const contenidoBase64 = await leerArchivoBase64(file);
    await api(`/eventos/${estado.activo.id}/signee`, { method: 'POST', body: JSON.stringify({ nombre: file.name, contenidoBase64 }) });
    await recargarActivo(); renderSignee(); toast(t('signee.saved'));
  } catch (e) { toast('Erreur : ' + e.message, true); }
  $('#signee-input').value = '';
}
$('#btn-add-signee').addEventListener('click', () => $('#signee-input').click());
$('#signee-input').addEventListener('change', () => subirSignee($('#signee-input').files[0]));
{
  const z = $('#signee-cont');
  z.addEventListener('dragover', (e) => { e.preventDefault(); z.classList.add('dragover'); });
  z.addEventListener('dragleave', (e) => { if (!z.contains(e.relatedTarget)) z.classList.remove('dragover'); });
  z.addEventListener('drop', (e) => { e.preventDefault(); z.classList.remove('dragover'); subirSignee(e.dataTransfer.files[0]); });
}

// ============================================================
//  FIRMAS (tesorero / asso mère)
// ============================================================
const firmaFile = $('#firma-file');
const esFirmaTrez = (n) => /^Signature_Trez_BDI_/i.test(n);
async function elegirFirma(reload) {
  $('#firma-titulo').textContent = t('sign.titleTrez');
  let firmas = [];
  try { firmas = await api('/firmas'); } catch {}
  // Solo firmas del tesorero de l'asso mère (Signature_Trez_BDI_*).
  firmas = firmas.filter((n) => esFirmaTrez(n));
  // Sin firmas: al abrir, ir directo a importar; al recargar (tras borrar), dejar el modal vacío.
  if (!firmas.length && !reload) { firmaFile.click(); return; }
  const cont = $('#firma-cards'); cont.innerHTML = '';
  if (!firmas.length) { cont.innerHTML = `<p class="vacio">${escapar(t('sign.none'))}</p>`; }
  for (const nom of firmas) {
    const card = document.createElement('div');
    card.className = 'doc-card firma-card';
    card.innerHTML = `<button class="btn-firma-del peligro peque no-print" title="${t('sign.del')}">✕</button>
      <div class="thumb"><img src="/api/firmas/${encodeURIComponent(nom)}" alt="${escapar(nom)}" /></div>
      <div class="pie"><div class="nombre">${escapar(nom)}</div></div>`;
    card.addEventListener('click', (e) => { if (e.target.closest('.btn-firma-del')) return; aplicarFirma(nom); });
    card.querySelector('.btn-firma-del').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(t('sign.confirmDel', { x: nom }))) return;
      try {
        await api('/firmas/' + encodeURIComponent(nom), { method: 'DELETE' });
        const d = datos();
        if (d && d.signature === nom) { d.signature = ''; paginarHoja(d); autoguardarDatos(); }
        toast(t('sign.deleted'));
        elegirFirma(true);   // recarga la lista del modal (sin abrir importador si queda vacía)
      } catch (err) { toast('Erreur : ' + err.message, true); }
    });
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
  try {
    const contenidoBase64 = await leerArchivoBase64(file);
    const cuerpo = { nombre: file.name, contenidoBase64 };
    // Firma del tesorero de l'asso mère: se guarda como Signature_Trez_BDI_<nombre>.
    const nom = prompt(t('sign.askTrezName'));
    if (!nom || !nom.trim()) { firmaFile.value = ''; return; }
    cuerpo.nombreDestino = `Signature_Trez_BDI_${slugNombre(nom)}`;
    const r = await api('/firmas', { method: 'POST', body: JSON.stringify(cuerpo) });
    aplicarFirma(r.nombre);
  } catch (e) { toast('Erreur : ' + e.message, true); }
  firmaFile.value = '';
});
function aplicarFirma(nom) {
  const d = datos(); if (!d) return;
  d.signature = nom;
  cerrarFirma(); paginarHoja(d); autoguardarDatos(); toast(t('sign.set'));
}
function quitarFirma() {
  const d = datos(); if (!d) return;
  d.signature = '';
  paginarHoja(d); autoguardarDatos(); toast(t('sign.removed'));
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
    // La hoja debe estar visible y paginada para que html2canvas mida bien.
    if (!$('#vista-ndf').classList.contains('activa')) mostrarVista('ndf');
    paginarHoja(d);
    await document.fonts.ready;
    // Espera a que las imágenes de la hoja (logo, firmas) estén decodificadas.
    await Promise.all($$('#hoja-ndf img').map((img) => img.complete ? Promise.resolve() : (img.decode ? img.decode().catch(() => {}) : Promise.resolve())));
    hoja.classList.add('exportando'); // oculta ayudas visuales en el PDF
    const pages = $$('#hoja-ndf .ndf-page');
    if (!pages.length) throw new Error(t('ndf.pdfNoPages'));
    const imgs = [];
    for (const p of pages) {
      const canvas = await html2canvas(p, {
        scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false,
        width: p.offsetWidth, height: p.offsetHeight,
        windowWidth: document.documentElement.scrollWidth,
        windowHeight: document.documentElement.scrollHeight,
        scrollX: 0, scrollY: 0,
      });
      if (canvas.width < 50 || canvas.height < 50) throw new Error(t('ndf.pdfBlank'));
      imgs.push(canvas.toDataURL('image/png'));
    }
    hoja.classList.remove('exportando');
    if (!imgs.length) throw new Error(t('ndf.pdfNoPages'));
    const resp = await fetch(`/api/eventos/${estado.activo.id}/pdf`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paginas: imgs, orden: d.ordre_pieces || [] }),
    });
    if (!resp.ok) throw new Error('PDF ' + resp.status);
    // Descarga directa (sin previsualización).
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = (d.numero_ndf || 'Note_de_Frais') + '.pdf';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast(t('ndf.pdfOk'));
  } catch (e) { toast('Erreur : ' + e.message, true); }
  finally { hoja.classList.remove('exportando'); btn.disabled = false; btn.textContent = t('ndf.pdf'); }
}

$('#btn-excel').addEventListener('click', exportarExcel);
function exportarExcel() {
  const d = datos(); if (!d) return;
  let ht = 0, ttc = 0;
  // Hoja como matriz de filas (string | number por celda).
  const rows = [
    ['NDF', d.numero_ndf || ''],
    ['Membre', d.nom_membre || ''],
    ['Section', d.section || ''],
    ['Date', d.date_emission || ''],
    [],
    ['Article', 'Date', 'Prix HT (€)', 'Taux TVA (%)', 'Montant TTC (€)'],
  ];
  for (const l of d.lignes || []) {
    const h = Number(l.prix_ht) || 0;
    const m = h * (1 + tasaTVA(l.taux_tva));
    ht += h; ttc += m;
    rows.push([l.article || '', l.date_achat || '', round2(h), tvaNum(l.taux_tva), round2(m)]);
  }
  rows.push([]);
  rows.push(['Total HT (€)', round2(ht), '', 'Total TTC (€)', round2(ttc)]);
  const blob = MiniXLSX.toBlob(rows, 'Note de Frais');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${d.numero_ndf || 'NoteDeFrais'}.xlsx`;
  a.click();
  URL.revokeObjectURL(a.href);
}
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

// ============================================================
//  "How to use"
// ============================================================
// Un único modal con TODAS las secciones (orden lógico de uso).
const HOWTO_ORDEN = ['eventos', 'personnes', 'documents', 'analyse', 'ndf', 'signee'];
function abrirAyudaGlobal() {
  const tabla = AYUDA[IDIOMA] || AYUDA.fr;
  $('#howto-titulo').textContent = t('howto.allTitle');
  $('#howto-cuerpo').innerHTML = HOWTO_ORDEN
    .map((k) => tabla[k] || AYUDA.fr[k])
    .filter(Boolean)
    .map((a) => `<section class="howto-sec"><h3>${escapar(a.titulo)}</h3>${a.cuerpo}</section>`)
    .join('');
  $('#modal-howto').classList.add('show');
}
function cerrarAyuda() { $('#modal-howto').classList.remove('show'); }
$('#btn-howto-global').addEventListener('click', abrirAyudaGlobal);
$('#howto-cerrar').addEventListener('click', cerrarAyuda);
$('#modal-howto').addEventListener('click', (e) => { if (e.target.id === 'modal-howto') cerrarAyuda(); });

// ============================================================
//  Atajos de teclado
// ============================================================
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { cerrarAyuda(); cerrarVisor(); cerrarFirma(); cerrarCrear(); cerrarPersonne(); return; }
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
renderChipsEstado();
cargarPersonas().finally(() => {
  cargarEventos().then(aplicarHash).catch((e) => toast('Erreur : ' + e.message, true));
});
