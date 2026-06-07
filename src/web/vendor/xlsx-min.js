// ============================================================
//  xlsx-min.js — Escritor mínimo de ficheros .xlsx (OOXML).
//  Sin dependencias ni build: genera un ZIP "STORE" (sin comprimir)
//  con las partes XML mínimas y cadenas en línea (inlineStr).
//  Excel/LibreOffice lo abren SIN el aviso "formato y extensión no
//  coinciden" (a diferencia del antiguo .xls que era HTML disfrazado).
//
//  Uso:  const blob = MiniXLSX.toBlob(rows, 'Note de Frais');
//        rows = [ ['A', 1, 2.5], ['B', ...] ]   (string | number por celda)
// ============================================================
(function () {
  'use strict';

  // ---- CRC-32 (requerido por el formato ZIP) ----
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  const enc = new TextEncoder();
  const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

  // Índice de columna (0,1,2…) → letra (A,B,…,Z,AA,…)
  function colLetra(i) {
    let s = '';
    i++;
    while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
    return s;
  }

  // ---- ZIP (método STORE, sin compresión) ----
  function zipStore(files) {
    const chunks = [];
    const central = [];
    let offset = 0;
    const u16 = (v) => { const b = new Uint8Array(2); b[0] = v & 0xFF; b[1] = (v >>> 8) & 0xFF; return b; };
    const u32 = (v) => { const b = new Uint8Array(4); b[0] = v & 0xFF; b[1] = (v >>> 8) & 0xFF; b[2] = (v >>> 16) & 0xFF; b[3] = (v >>> 24) & 0xFF; return b; };
    const push = (arr, b) => { arr.push(b); return b.length; };

    for (const f of files) {
      const nameB = enc.encode(f.name);
      const data = f.data;
      const crc = crc32(data);
      const local = [];
      let len = 0;
      len += push(local, u32(0x04034b50));      // firma local
      len += push(local, u16(20));               // versión
      len += push(local, u16(0));                // flags
      len += push(local, u16(0));                // compresión = store
      len += push(local, u16(0));                // hora
      len += push(local, u16(0));                // fecha
      len += push(local, u32(crc));
      len += push(local, u32(data.length));      // tamaño comprimido
      len += push(local, u32(data.length));      // tamaño sin comprimir
      len += push(local, u16(nameB.length));
      len += push(local, u16(0));                // extra
      len += push(local, nameB);
      len += push(local, data);
      for (const b of local) chunks.push(b);

      const cen = [];
      push(cen, u32(0x02014b50));                // firma central
      push(cen, u16(20)); push(cen, u16(20));    // versiones
      push(cen, u16(0)); push(cen, u16(0));      // flags, compresión
      push(cen, u16(0)); push(cen, u16(0));      // hora, fecha
      push(cen, u32(crc));
      push(cen, u32(data.length)); push(cen, u32(data.length));
      push(cen, u16(nameB.length));
      push(cen, u16(0)); push(cen, u16(0));      // extra, comentario
      push(cen, u16(0)); push(cen, u16(0));      // disco, attrs internos
      push(cen, u32(0));                         // attrs externos
      push(cen, u32(offset));                    // offset local
      push(cen, nameB);
      central.push(cen);
      offset += len;
    }

    let centralSize = 0;
    const centralStart = offset;
    for (const cen of central) for (const b of cen) { chunks.push(b); centralSize += b.length; offset += b.length; }

    const eocd = [];
    const pe = (b) => { chunks.push(b); };
    pe(u32(0x06054b50));
    pe(u16(0)); pe(u16(0));
    pe(u16(files.length)); pe(u16(files.length));
    pe(u32(centralSize));
    pe(u32(centralStart));
    pe(u16(0));

    let total = 0;
    for (const b of chunks) total += b.length;
    const out = new Uint8Array(total);
    let p = 0;
    for (const b of chunks) { out.set(b, p); p += b.length; }
    return out;
  }

  // ---- Partes XML mínimas de un libro de una sola hoja ----
  function hojaXML(rows) {
    let body = '';
    rows.forEach((row, r) => {
      const cells = row.map((val, c) => {
        const ref = colLetra(c) + (r + 1);
        if (typeof val === 'number' && isFinite(val)) return `<c r="${ref}"><v>${val}</v></c>`;
        return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(val)}</t></is></c>`;
      }).join('');
      body += `<row r="${r + 1}">${cells}</row>`;
    });
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
  }

  function toBytes(rows, nombreHoja) {
    const hoja = (nombreHoja || 'Feuille1').slice(0, 31).replace(/[\\/?*\[\]:]/g, ' ');
    const files = [
      { name: '[Content_Types].xml', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`) },
      { name: '_rels/.rels', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
      { name: 'xl/workbook.xml', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(hoja)}" sheetId="1" r:id="rId1"/></sheets></workbook>`) },
      { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`) },
      { name: 'xl/worksheets/sheet1.xml', data: enc.encode(hojaXML(rows)) },
    ];
    return zipStore(files);
  }

  window.MiniXLSX = {
    toBytes,
    toBlob(rows, nombreHoja) {
      return new Blob([toBytes(rows, nombreHoja)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    },
  };
})();
