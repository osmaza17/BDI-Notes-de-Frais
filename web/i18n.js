// ============================================================
//  i18n.js — Traducciones FR / ES / EN.
//  La hoja de la NDF se mantiene en francés (documento oficial);
//  aquí se traduce la "chrome" de la app (instrucciones, botones…).
// ============================================================

const I18N = {
  fr: {
    'header.noEvent': 'Aucun événement sélectionné',
    'server.connecting': 'Connexion…',
    'server.connected': 'Serveur connecté',
    'server.down': 'Serveur arrêté',
    'server.downTitle': '⚠ Serveur arrêté',
    'server.downBody': 'La connexion avec le serveur local a été perdue.',
    'server.downHint': 'Rouvre Iniciar.vbs puis recharge cette page.',
    'server.retry': 'Réessayer',
    'theme': '🌓 Thème',
    'credit': 'Développé par',
    'repo': 'Code source',
    'tabs.back': '← Événements',
    'tabs.documents': 'Documents',
    'tabs.analyse': 'Analyse',
    'tabs.ndf': 'Note de Frais',
    'howto.btn': '❔ How to use',
    'howto.prefix': 'Comment ça marche — ',

    'home.title': 'Événements',
    'home.newEvent': 'Nouvel événement',
    'home.newEventSub': 'Chaque événement correspond à une Note de Frais.',
    'home.empty': 'Aucun événement pour le moment. Clique sur « + » pour en créer un.',
    'home.noMatch': 'Aucun événement ne correspond à la recherche.',
    'home.docs': 'doc(s)',
    'home.search': '🔎 Rechercher (nom, pôle, membre, année)…',
    'home.allStates': 'Tous les états',

    'form.name': "Nom de l'événement",
    'form.namePh': 'ex : World Week 2026',
    'form.section': 'Section (pôle)',
    'form.choose': '— Choisir —',
    'form.date': "Date de l'événement",
    'form.member': 'Membre ayant engagé les dépenses',
    'form.memberPh': 'ex : Óscar MARTÍNEZ ZAMORA',
    'form.budget': 'Budget max alloué par le BDI (€)',
    'form.budgetPh': 'ex : 300',
    'form.create': 'Créer',
    'form.needNameSection': 'Indique le nom et la section.',
    'event.created': 'Événement créé',
    'event.deleted': 'Événement supprimé',
    'event.confirmDel': "Supprimer l'événement « {x} » et tous ses fichiers ?",

    'estado.brouillon': 'Brouillon',
    'estado.a_verifier': 'À vérifier',
    'estado.valide': 'Validé',
    'estado.envoye': 'Envoyé',
    'estado.rembourse': 'Remboursé',
    'paye.yes': '✓ Payé',
    'paye.no': 'Non payé',
    'budget.left': 'Budget restant',
    'budget.over': 'Dépassement',
    'budget.none': 'Sans budget',

    'docs.title': 'Documents',
    'docs.sub': "Glisse tes pièces : l'analyse se lance automatiquement.",
    'docs.list': 'Documents',
    'docs.add': '+ Ajouter des documents',
    'docs.none': 'Aucun document. Glisse des fichiers ici.',
    'docs.view': 'Voir',
    'docs.openTab': 'Ouvrir',
    'docs.confirmDel': 'Supprimer « {x} » ?',
    'docs.deleted': 'Document supprimé',
    'docs.added': 'Documents ajoutés — analyse…',
    'docs.uploading': 'Téléversement de {n} fichier(s)…',
    'docs.renamed': 'Document renommé ✔',
    'docs.clickRename': 'Cliquer pour renommer',
    'docs.clickAnalyse': 'Cliquer pour voir le texte extrait',

    'analysing': "Lecture des documents par l'IA… (cela peut prendre une minute)",
    'analysed': 'Analyse terminée ✔',
    'analyse.title': 'Texte extrait des documents',
    'analyse.sub': 'Corrige le texte si besoin (document à gauche, texte à droite), puis régénère la note.',
    'analyse.regen': '↻ Régénérer la note',
    'analyse.regening': '↻ Régénération…',
    'analyse.regenOk': 'Note régénérée ✔',
    'analyse.none': 'Aucun document à analyser.',
    'analyse.loadingDoc': "Lecture du document par l'IA…",
    'analyse.notYet': 'Pas encore analysé.',
    'analyse.placeholder': '(aucun texte extrait)',

    'ndf.empty': "Aucune donnée. Ajoute d'abord des documents.",
    'ndf.title': 'Vérification & édition',
    'ndf.pdf': '📄 Générer le PDF',
    'ndf.pdfGen': '📄 Génération…',
    'ndf.excel': '⬇ Excel',
    'ndf.obsTitle': "Observations de l'IA",
    'ndf.obsSub': "Remarques de l'analyse (non imprimées sur la NDF).",
    'ndf.addObs': '+ Ajouter une remarque',
    'ndf.noObs': 'Aucune observation.',
    'ndf.addLine': '+ Add new line',
    'ndf.warnName': '⚠ Le nom de famille doit être écrit en MAJUSCULES (ex : Óscar MARTÍNEZ ZAMORA).',
    'ndf.signTrez': '✎ Signature trésorier',
    'ndf.signMembre': '✎ Signature membre',
    'ndf.saving': 'Enregistrement…',
    'ndf.saved': 'Enregistré ✔',
    'ndf.ordreTitle': 'Ordre des pièces jointes',
    'ndf.ordreSub': 'Glisse les cartes pour définir leur ordre dans le PDF final (après la note).',
    'ndf.statut': 'Statut',
    'ndf.budgetMax': 'Budget max',

    'sign.titleTrez': 'Signature du trésorier',
    'sign.titleMembre': 'Signature du membre',
    'sign.sub': 'Choisis une signature enregistrée :',
    'sign.import': '+ Importer une autre image',
    'sign.none': 'Aucune signature enregistrée.',
    'sign.set': 'Signature ajoutée ✔',
  },

  es: {
    'header.noEvent': 'Ningún evento seleccionado',
    'server.connecting': 'Conectando…',
    'server.connected': 'Servidor conectado',
    'server.down': 'Servidor apagado',
    'server.downTitle': '⚠ Servidor apagado',
    'server.downBody': 'Se ha perdido la conexión con el servidor local.',
    'server.downHint': 'Vuelve a abrir Iniciar.vbs y recarga esta página.',
    'server.retry': 'Reintentar',
    'theme': '🌓 Tema',
    'credit': 'Desarrollado por',
    'repo': 'Código fuente',
    'tabs.back': '← Eventos',
    'tabs.documents': 'Documentos',
    'tabs.analyse': 'Análisis',
    'tabs.ndf': 'Nota de Gastos',
    'howto.btn': '❔ Cómo se usa',
    'howto.prefix': 'Cómo funciona — ',

    'home.title': 'Eventos',
    'home.newEvent': 'Nuevo evento',
    'home.newEventSub': 'Cada evento corresponde a una Nota de Gastos.',
    'home.empty': 'Aún no hay eventos. Pulsa « + » para crear uno.',
    'home.noMatch': 'Ningún evento coincide con la búsqueda.',
    'home.docs': 'doc(s)',
    'home.search': '🔎 Buscar (nombre, pôle, miembro, año)…',
    'home.allStates': 'Todos los estados',

    'form.name': 'Nombre del evento',
    'form.namePh': 'ej : World Week 2026',
    'form.section': 'Sección (pôle)',
    'form.choose': '— Elegir —',
    'form.date': 'Fecha del evento',
    'form.member': 'Miembro que ha incurrido en los gastos',
    'form.memberPh': 'ej : Óscar MARTÍNEZ ZAMORA',
    'form.budget': 'Presupuesto máx. asignado por el BDI (€)',
    'form.budgetPh': 'ej : 300',
    'form.create': 'Crear',
    'form.needNameSection': 'Indica el nombre y la sección.',
    'event.created': 'Evento creado',
    'event.deleted': 'Evento eliminado',
    'event.confirmDel': '¿Eliminar el evento « {x} » y todos sus archivos?',

    'estado.brouillon': 'Borrador',
    'estado.a_verifier': 'Por verificar',
    'estado.valide': 'Validado',
    'estado.envoye': 'Enviado',
    'estado.rembourse': 'Reembolsado',
    'paye.yes': '✓ Pagado',
    'paye.no': 'No pagado',
    'budget.left': 'Presupuesto restante',
    'budget.over': 'Excedido',
    'budget.none': 'Sin presupuesto',

    'docs.title': 'Documentos',
    'docs.sub': 'Arrastra tus documentos: el análisis se lanza automáticamente.',
    'docs.list': 'Documentos',
    'docs.add': '+ Añadir documentos',
    'docs.none': 'Ningún documento. Arrastra archivos aquí.',
    'docs.view': 'Ver',
    'docs.openTab': 'Abrir',
    'docs.confirmDel': '¿Eliminar « {x} »?',
    'docs.deleted': 'Documento eliminado',
    'docs.added': 'Documentos añadidos — analizando…',
    'docs.uploading': 'Subiendo {n} archivo(s)…',
    'docs.renamed': 'Documento renombrado ✔',
    'docs.clickRename': 'Clic para renombrar',
    'docs.clickAnalyse': 'Clic para ver el texto extraído',

    'analysing': 'Leyendo los documentos con la IA… (puede tardar un minuto)',
    'analysed': 'Análisis terminado ✔',
    'analyse.title': 'Texto extraído de los documentos',
    'analyse.sub': 'Corrige el texto si hace falta (documento a la izquierda, texto a la derecha) y regenera la nota.',
    'analyse.regen': '↻ Regenerar la nota',
    'analyse.regening': '↻ Regenerando…',
    'analyse.regenOk': 'Nota regenerada ✔',
    'analyse.none': 'Ningún documento que analizar.',
    'analyse.loadingDoc': 'Leyendo el documento con la IA…',
    'analyse.notYet': 'Aún no analizado.',
    'analyse.placeholder': '(sin texto extraído)',

    'ndf.empty': 'Sin datos. Añade primero documentos.',
    'ndf.title': 'Verificación y edición',
    'ndf.pdf': '📄 Generar el PDF',
    'ndf.pdfGen': '📄 Generando…',
    'ndf.excel': '⬇ Excel',
    'ndf.obsTitle': 'Observaciones de la IA',
    'ndf.obsSub': 'Observaciones del análisis (no se imprimen en la NDF).',
    'ndf.addObs': '+ Añadir una observación',
    'ndf.noObs': 'Ninguna observación.',
    'ndf.addLine': '+ Añadir línea',
    'ndf.warnName': '⚠ El apellido debe ir en MAYÚSCULAS (ej : Óscar MARTÍNEZ ZAMORA).',
    'ndf.signTrez': '✎ Firma tesorero',
    'ndf.signMembre': '✎ Firma miembro',
    'ndf.saving': 'Guardando…',
    'ndf.saved': 'Guardado ✔',
    'ndf.ordreTitle': 'Orden de los documentos adjuntos',
    'ndf.ordreSub': 'Arrastra las tarjetas para definir su orden en el PDF final (tras la nota).',
    'ndf.statut': 'Estado',
    'ndf.budgetMax': 'Presupuesto máx.',

    'sign.titleTrez': 'Firma del tesorero',
    'sign.titleMembre': 'Firma del miembro',
    'sign.sub': 'Elige una firma guardada:',
    'sign.import': '+ Importar otra imagen',
    'sign.none': 'No hay firmas guardadas.',
    'sign.set': 'Firma añadida ✔',
  },

  en: {
    'header.noEvent': 'No event selected',
    'server.connecting': 'Connecting…',
    'server.connected': 'Server connected',
    'server.down': 'Server stopped',
    'server.downTitle': '⚠ Server stopped',
    'server.downBody': 'The connection to the local server was lost.',
    'server.downHint': 'Reopen Iniciar.vbs and reload this page.',
    'server.retry': 'Retry',
    'theme': '🌓 Theme',
    'credit': 'Developed by',
    'repo': 'Source code',
    'tabs.back': '← Events',
    'tabs.documents': 'Documents',
    'tabs.analyse': 'Analysis',
    'tabs.ndf': 'Expense Report',
    'howto.btn': '❔ How to use',
    'howto.prefix': 'How it works — ',

    'home.title': 'Events',
    'home.newEvent': 'New event',
    'home.newEventSub': 'Each event corresponds to one Expense Report.',
    'home.empty': 'No events yet. Click « + » to create one.',
    'home.noMatch': 'No event matches your search.',
    'home.docs': 'doc(s)',
    'home.search': '🔎 Search (name, pôle, member, year)…',
    'home.allStates': 'All states',

    'form.name': 'Event name',
    'form.namePh': 'e.g. World Week 2026',
    'form.section': 'Section (pôle)',
    'form.choose': '— Choose —',
    'form.date': 'Event date',
    'form.member': 'Member who incurred the expenses',
    'form.memberPh': 'e.g. Óscar MARTÍNEZ ZAMORA',
    'form.budget': 'Max budget allocated by the BDI (€)',
    'form.budgetPh': 'e.g. 300',
    'form.create': 'Create',
    'form.needNameSection': 'Enter the name and section.',
    'event.created': 'Event created',
    'event.deleted': 'Event deleted',
    'event.confirmDel': 'Delete the event “{x}” and all its files?',

    'estado.brouillon': 'Draft',
    'estado.a_verifier': 'To review',
    'estado.valide': 'Validated',
    'estado.envoye': 'Sent',
    'estado.rembourse': 'Reimbursed',
    'paye.yes': '✓ Paid',
    'paye.no': 'Unpaid',
    'budget.left': 'Budget left',
    'budget.over': 'Over budget',
    'budget.none': 'No budget',

    'docs.title': 'Documents',
    'docs.sub': 'Drop your files: analysis starts automatically.',
    'docs.list': 'Documents',
    'docs.add': '+ Add documents',
    'docs.none': 'No documents. Drop files here.',
    'docs.view': 'View',
    'docs.openTab': 'Open',
    'docs.confirmDel': 'Delete “{x}”?',
    'docs.deleted': 'Document deleted',
    'docs.added': 'Documents added — analysing…',
    'docs.uploading': 'Uploading {n} file(s)…',
    'docs.renamed': 'Document renamed ✔',
    'docs.clickRename': 'Click to rename',
    'docs.clickAnalyse': 'Click to view the extracted text',

    'analysing': 'Reading the documents with AI… (this may take a minute)',
    'analysed': 'Analysis complete ✔',
    'analyse.title': 'Text extracted from the documents',
    'analyse.sub': 'Fix the text if needed (document on the left, text on the right), then regenerate the report.',
    'analyse.regen': '↻ Regenerate the report',
    'analyse.regening': '↻ Regenerating…',
    'analyse.regenOk': 'Report regenerated ✔',
    'analyse.none': 'No document to analyse.',
    'analyse.loadingDoc': 'Reading the document with AI…',
    'analyse.notYet': 'Not analysed yet.',
    'analyse.placeholder': '(no text extracted)',

    'ndf.empty': 'No data. Add documents first.',
    'ndf.title': 'Review & edit',
    'ndf.pdf': '📄 Generate PDF',
    'ndf.pdfGen': '📄 Generating…',
    'ndf.excel': '⬇ Excel',
    'ndf.obsTitle': 'AI observations',
    'ndf.obsSub': 'Notes from the analysis (not printed on the report).',
    'ndf.addObs': '+ Add a note',
    'ndf.noObs': 'No observations.',
    'ndf.addLine': '+ Add new line',
    'ndf.warnName': '⚠ The surname must be written in UPPERCASE (e.g. Óscar MARTÍNEZ ZAMORA).',
    'ndf.signTrez': '✎ Treasurer signature',
    'ndf.signMembre': '✎ Member signature',
    'ndf.saving': 'Saving…',
    'ndf.saved': 'Saved ✔',
    'ndf.ordreTitle': 'Order of the attached documents',
    'ndf.ordreSub': 'Drag the cards to set their order in the final PDF (after the report).',
    'ndf.statut': 'Status',
    'ndf.budgetMax': 'Max budget',

    'sign.titleTrez': 'Treasurer signature',
    'sign.titleMembre': 'Member signature',
    'sign.sub': 'Choose a saved signature:',
    'sign.import': '+ Import another image',
    'sign.none': 'No saved signatures.',
    'sign.set': 'Signature added ✔',
  },
};

// Contenido de "How to use" por pestaña e idioma (HTML).
const AYUDA = {
  fr: {
    eventos: { titulo: 'Événements', cuerpo: `
      <p>Page d'accueil. Chaque <b>événement</b> correspond à une <b>Note de Frais</b>.</p>
      <h4>Créer</h4>
      <p>Clique sur <b>« + »</b> (en bas à droite). Renseigne le nom, la <b>section (pôle)</b>, la date, le <b>membre</b> (nom de famille en MAJUSCULES) et le <b>budget max alloué par le BDI</b>.</p>
      <h4>Repérer</h4>
      <p>Les événements sont regroupés par année. La <b>couleur</b> de la carte indique l'état (brouillon, à vérifier, validé, envoyé, remboursé) et un badge montre s'il est <b>payé</b>. Utilise la <b>barre de recherche</b> et le filtre d'état pour t'y retrouver.</p>` },
    documents: { titulo: 'Documents', cuerpo: `
      <p>Glisse-dépose tes factures, tickets et attestations sur la zone des cartes (ou « + Ajouter des documents »).</p>
      <p><b>L'analyse est automatique</b> : Claude lit, transcrit et prépare la Note de Frais. Supprimer un document relance l'analyse sans lui.</p>
      <p>Sur chaque carte : <b>Voir</b> (fenêtre), <b>Ouvrir</b> (onglet), clic sur le nom pour renommer, clic sur la carte pour voir le texte (Analyse).</p>` },
    analyse: { titulo: 'Analyse', cuerpo: `
      <p>Vérifie ce que Claude a lu : original à gauche, transcription (éditable) à droite. Les flèches ← → naviguent entre documents.</p>
      <p>Corrige puis <b>« Régénérer la note »</b>. <b>« Ouvrir »</b> ouvre le document dans un onglet.</p>` },
    ndf: { titulo: 'Note de Frais', cuerpo: `
      <p>Aperçu fidèle, <b>tout est modifiable et enregistré automatiquement</b> (Ctrl+S force la sauvegarde).</p>
      <p><b>Add new line</b> ajoute une ligne ; la ✕ en supprime une. Le <b>fond coloré</b> d'une ligne indique la confiance de l'IA (vert/ambre/rouge). Si la table est longue, l'aperçu passe en plusieurs pages A4.</p>
      <p>Boutons <b>Signature trésorier</b> / <b>Signature membre</b> pour insérer les signatures. Choisis l'<b>ordre des pièces jointes</b> avec les cartes. <b>Générer le PDF</b> (Ctrl+P) crée un PDF unique : note + toutes les pièces. <b>Excel</b> exporte les lignes.</p>
      <p>En haut : l'<b>état</b> de l'événement, le bouton <b>payé / non payé</b> et le <b>budget restant</b>.</p>` },
  },
  es: {
    eventos: { titulo: 'Eventos', cuerpo: `
      <p>Página inicial. Cada <b>evento</b> es una <b>Nota de Gastos</b>.</p>
      <h4>Crear</h4>
      <p>Pulsa <b>« + »</b> (abajo a la derecha). Indica nombre, <b>sección (pôle)</b>, fecha, <b>miembro</b> (apellido en MAYÚSCULAS) y el <b>presupuesto máx. asignado por el BDI</b>.</p>
      <h4>Identificar</h4>
      <p>Los eventos se agrupan por año. El <b>color</b> de la tarjeta indica el estado (borrador, por verificar, validado, enviado, reembolsado) y un distintivo muestra si está <b>pagado</b>. Usa el <b>buscador</b> y el filtro de estado.</p>` },
    documents: { titulo: 'Documentos', cuerpo: `
      <p>Arrastra facturas, tickets y attestations sobre la zona de tarjetas (o « + Añadir documentos »).</p>
      <p><b>El análisis es automático</b>: Claude lee, transcribe y prepara la nota. Borrar un documento relanza el análisis sin él.</p>
      <p>En cada tarjeta: <b>Ver</b> (ventana), <b>Abrir</b> (pestaña), clic en el nombre para renombrar, clic en la tarjeta para ver el texto (Análisis).</p>` },
    analyse: { titulo: 'Análisis', cuerpo: `
      <p>Revisa lo que Claude ha leído: original a la izquierda, transcripción (editable) a la derecha. Las flechas ← → navegan entre documentos.</p>
      <p>Corrige y pulsa <b>« Regenerar la nota »</b>. <b>« Abrir »</b> abre el documento en una pestaña.</p>` },
    ndf: { titulo: 'Nota de Gastos', cuerpo: `
      <p>Previsualización fiel, <b>todo es editable y se guarda solo</b> (Ctrl+S fuerza el guardado).</p>
      <p><b>Añadir línea</b> agrega una fila; la ✕ elimina una. El <b>fondo de color</b> de una fila indica la confianza de la IA (verde/ámbar/rojo). Si la tabla es larga, pasa a varias páginas A4.</p>
      <p>Botones <b>Firma tesorero</b> / <b>Firma miembro</b> para insertar las firmas. Elige el <b>orden de los adjuntos</b> con las tarjetas. <b>Generar el PDF</b> (Ctrl+P) crea un PDF único: nota + todos los documentos. <b>Excel</b> exporta las líneas.</p>
      <p>Arriba: el <b>estado</b> del evento, el botón <b>pagado / no pagado</b> y el <b>presupuesto restante</b>.</p>` },
  },
  en: {
    eventos: { titulo: 'Events', cuerpo: `
      <p>Home page. Each <b>event</b> is one <b>Expense Report</b>.</p>
      <h4>Create</h4>
      <p>Click <b>“+”</b> (bottom right). Fill in name, <b>section (pôle)</b>, date, <b>member</b> (surname in UPPERCASE) and the <b>max budget allocated by the BDI</b>.</p>
      <h4>Spot</h4>
      <p>Events are grouped by year. The card <b>color</b> shows its status (draft, to review, validated, sent, reimbursed) and a badge shows if it's <b>paid</b>. Use the <b>search bar</b> and status filter.</p>` },
    documents: { titulo: 'Documents', cuerpo: `
      <p>Drag & drop your invoices, receipts and attestations onto the cards area (or “+ Add documents”).</p>
      <p><b>Analysis is automatic</b>: Claude reads, transcribes and prepares the report. Deleting a document restarts analysis without it.</p>
      <p>On each card: <b>View</b> (window), <b>Open</b> (tab), click the name to rename, click the card to see the text (Analysis).</p>` },
    analyse: { titulo: 'Analysis', cuerpo: `
      <p>Check what Claude read: original on the left, editable transcription on the right. Arrows ← → move between documents.</p>
      <p>Fix it then click <b>“Regenerate the report”</b>. <b>“Open”</b> opens the document in a tab.</p>` },
    ndf: { titulo: 'Expense Report', cuerpo: `
      <p>Faithful preview, <b>everything is editable and saved automatically</b> (Ctrl+S forces a save).</p>
      <p><b>Add new line</b> adds a row; the ✕ removes one. A row's <b>colored background</b> shows the AI confidence (green/amber/red). If the table is long, it spans several A4 pages.</p>
      <p><b>Treasurer signature</b> / <b>Member signature</b> buttons insert the signatures. Set the <b>attachment order</b> with the cards. <b>Generate PDF</b> (Ctrl+P) creates a single PDF: report + all documents. <b>Excel</b> exports the lines.</p>
      <p>At the top: the event <b>status</b>, the <b>paid / unpaid</b> button and the <b>remaining budget</b>.</p>` },
  },
};

let IDIOMA = localStorage.getItem('idioma-ndf') || 'fr';
function t(clave, vars) {
  let s = (I18N[IDIOMA] && I18N[IDIOMA][clave]) || I18N.fr[clave] || clave;
  if (vars) for (const k in vars) s = s.replace('{' + k + '}', vars[k]);
  return s;
}
function aplicarIdioma() {
  document.documentElement.lang = IDIOMA;
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
}
