'use strict';
/**
 * Bon-Layout (geräteunabhängig) und Ausgabe als ESC/POS-Bytes, Epson ePOS-XML oder Text.
 *
 * Dokumentmodell: Array aus Zeilen { text, align, bold, size } bzw. { feed: n } / { cut: true }.
 * size: 'normal' | 'double' (doppelte Breite+Höhe) | 'tall' (doppelte Höhe)
 */

const fmtQty = (n) => {
  const r = Math.round(Number(n) * 1000) / 1000;
  return Number.isInteger(r) ? String(r) : String(r).replace('.', ',');
};

const pad2 = (n) => String(n).padStart(2, '0');
const fmtDate = (d) => `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`;
const fmtDateTime = (d) => `${fmtDate(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

/** Ersetzt typografische Zeichen durch druckbare Entsprechungen. */
function normalizeText(s) {
  return String(s ?? '')
    .replace(/[‘’‚′´`]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―⸺⸻−]/g, '-')
    .replace(/…/g, '...')
    .replace(/ /g, ' ')
    .replace(/[\r\n\t]+/g, ' ');
}

function wrap(text, width) {
  const words = normalizeText(text).split(' ').filter(Boolean);
  const lines = [];
  let cur = '';
  for (let w of words) {
    while (w.length > width) { // überlange Wörter hart umbrechen
      if (cur) { lines.push(cur); cur = ''; }
      lines.push(w.slice(0, width)); w = w.slice(width);
    }
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= width) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur || !lines.length) lines.push(cur);
  return lines;
}

/**
 * Positionszeile: "[ ] Name ............. 8 Kästen", Name wird bei Bedarf umbrochen.
 */
function itemLines(name, qtyText, width) {
  const box = '[ ] ';
  const right = ' ' + qtyText;
  const avail = width - box.length - right.length;
  if (avail >= 8) {
    const nameLines = wrap(name, avail);
    const out = [];
    nameLines.forEach((nl, i) => {
      if (i === 0) out.push(box + nl.padEnd(avail) + right);
      else out.push('    ' + nl);
    });
    return out;
  }
  return [...wrap(box + name, width), qtyText.padStart(width)];
}

function unitLabel(qty, unit, plural) {
  if (!unit) return '';
  return Math.abs(Number(qty) - 1) < 1e-9 ? unit : (plural || unit);
}

/** Menge in Bestelleinheit, falls hinterlegt: { main: '2 Kartons', base: '12 Flaschen' | null } */
function orderQty(qty, i) {
  const base = `${fmtQty(qty)} ${unitLabel(qty, i.unit_name, i.unit_plural)}`.trim();
  const upo = Number(i.units_per_order) || 1;
  if (upo > 1 && i.order_unit_name) {
    const n = Math.round((qty / upo) * 1000) / 1000;
    return { main: `${fmtQty(n)} ${unitLabel(n, i.order_unit_name, i.order_unit_plural)}`, base: `= ${base}` };
  }
  return { main: base, base: null };
}

/**
 * Baut den Einkaufsbon für eine Liste.
 * @param list Ergebnis von loadList()
 * @param opts { width, groupBy: 'category'|'supplier'|'location', supplierId, company, userName, date, showPrices }
 */
function buildListDoc(list, opts = {}) {
  const W = opts.width || 48;
  const date = opts.date || new Date();
  let items = [...list.items];
  if (opts.supplierId !== undefined && opts.supplierId !== null) {
    items = items.filter((i) => (i.supplier_id || 0) === Number(opts.supplierId));
  }
  if (opts.onlyOpen) items = items.filter((i) => i.open_qty > 0 && !i.purchased);
  const groupBy = opts.groupBy || 'category';
  const keyOf = (i) => groupBy === 'supplier' ? (i.supplier_name || 'Ohne Lieferant')
    : groupBy === 'location' ? (i.location_name || 'Ohne Lagerort') : (i.category_name || 'Ohne Kategorie');
  const sortOf = (i) => groupBy === 'category' ? (i.category_sort ?? 9999) : groupBy === 'location' ? (i.location_sort ?? 9999) : 0;

  const groups = new Map();
  for (const i of items) {
    const k = keyOf(i);
    if (!groups.has(k)) groups.set(k, { name: k, sort: sortOf(i), items: [] });
    groups.get(k).items.push(i);
  }
  const sorted = [...groups.values()].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'de'));

  const doc = [];
  const line = (text, o = {}) => doc.push({ text: normalizeText(text), align: o.align || 'left', bold: !!o.bold, size: o.size || 'normal' });
  line('='.repeat(W));
  line(opts.title || 'SERVICE-EINKAUF', { size: 'double', bold: true, align: 'center' });
  if (opts.company) line(opts.company, { align: 'center' });
  line('');
  line(`Datum: ${fmtDateTime(date)}`);
  line(`Mitarbeiter: ${opts.userName || '-'}`);
  line(`Liste: ${list.number}${list.title ? ' – ' + list.title : ''}`);
  if (opts.supplierName) line(`Lieferant: ${opts.supplierName}`, { bold: true });
  if (list.note) wrap('Hinweis: ' + list.note, W).forEach((l) => line(l));

  let estTotal = 0;
  for (const g of sorted) {
    line('');
    wrap(g.name.toUpperCase(), W).forEach((l) => line(l, { bold: true }));
    g.items.sort((a, b) => a.article_name.localeCompare(b.article_name, 'de'));
    for (const i of g.items) {
      const qty = opts.onlyOpen ? i.open_qty : i.qty;
      const oq = orderQty(qty, i);
      itemLines(i.article_name, oq.main, W).forEach((l) => line(l));
      const extra = [];
      if (oq.base) extra.push(oq.base);
      if (i.pack_size) extra.push(i.pack_size);
      if (groupBy !== 'supplier' && !opts.supplierName && i.supplier_name) extra.push(i.supplier_name);
      if (opts.showPrices) extra.push(`ca. ${(qty * i.unit_price_est).toFixed(2).replace('.', ',')} EUR`);
      if (extra.length) wrap(extra.join(' | '), W - 4).forEach((l) => line('    ' + l));
      if (i.note) wrap('! ' + i.note, W - 4).forEach((l) => line('    ' + l));
      estTotal += qty * i.unit_price_est;
    }
  }
  line('');
  line('-'.repeat(W));
  line(`Positionen: ${items.length}`, { bold: true });
  if (opts.showPrices) line(`Geschätzt netto: ${estTotal.toFixed(2).replace('.', ',')} EUR`);
  line('='.repeat(W));
  return doc;
}

function buildTestDoc(printer, opts = {}) {
  const W = printer.chars_per_line || 48;
  const doc = [];
  const line = (text, o = {}) => doc.push({ text: normalizeText(text), align: o.align || 'left', bold: !!o.bold, size: o.size || 'normal' });
  line('='.repeat(W));
  line('TESTDRUCK', { size: 'double', bold: true, align: 'center' });
  line(opts.company || 'EK-Service', { align: 'center' });
  line('');
  line(`Drucker: ${printer.name}`);
  line(`Protokoll: ${printer.protocol}`);
  if (printer.host) line(`Adresse: ${printer.host}:${printer.port}`);
  line(`Papier: ${printer.paper_width} mm / ${W} Zeichen`);
  line(`Zeit: ${fmtDateTime(new Date())}`);
  line('');
  line('Umlaute: ÄÖÜ äöü ß €  é è à');
  line('Fett gedruckt', { bold: true });
  line('Zentriert', { align: 'center' });
  line('Rechts', { align: 'right' });
  line('0123456789'.repeat(Math.ceil(W / 10)).slice(0, W));
  line('');
  itemLines('Beispielartikel mit einem langen Namen zur Umbruchprüfung', '8 Kästen', W).forEach((l) => line(l));
  line('='.repeat(W));
  return doc;
}

// ---------------- Zeichensätze ----------------
const CP_BASE = { // gemeinsam für CP437/850/858
  'Ç': 0x80, 'ü': 0x81, 'é': 0x82, 'â': 0x83, 'ä': 0x84, 'à': 0x85, 'å': 0x86, 'ç': 0x87, 'ê': 0x88, 'ë': 0x89,
  'è': 0x8A, 'ï': 0x8B, 'î': 0x8C, 'ì': 0x8D, 'Ä': 0x8E, 'Å': 0x8F, 'É': 0x90, 'æ': 0x91, 'Æ': 0x92, 'ô': 0x93,
  'ö': 0x94, 'ò': 0x95, 'û': 0x96, 'ù': 0x97, 'ÿ': 0x98, 'Ö': 0x99, 'Ü': 0x9A, 'á': 0xA0, 'í': 0xA1, 'ó': 0xA2,
  'ú': 0xA3, 'ñ': 0xA4, 'Ñ': 0xA5, 'ª': 0xA6, 'º': 0xA7, '¿': 0xA8, '½': 0xAB, '¼': 0xAC, '¡': 0xAD, '«': 0xAE,
  '»': 0xAF, 'ß': 0xE1, 'µ': 0xE6, '±': 0xF1, '°': 0xF8, '·': 0xFA, '²': 0xFD,
};
const CODEPAGES = {
  cp858: { escT: 19, map: { ...CP_BASE, 'ø': 0x9B, '£': 0x9C, 'Ø': 0x9D, '×': 0x9E, '€': 0xD5, 'Ã': 0xC7, 'ã': 0xC6, 'Ê': 0xD2, 'Ë': 0xD3, 'È': 0xD4, 'Í': 0xD6, 'Î': 0xD7, 'Ï': 0xD8, 'Ó': 0xE0, 'Ô': 0xE2, 'Ò': 0xE3, 'õ': 0xE4, 'Õ': 0xE5, 'Ú': 0xE9, 'Û': 0xEA, 'Ù': 0xEB, 'Á': 0xB5, 'Â': 0xB6, 'À': 0xB7, '§': 0xF5 } },
  cp850: { escT: 2, map: { ...CP_BASE, 'ø': 0x9B, '£': 0x9C, 'Ø': 0x9D, '×': 0x9E, '§': 0xF5, 'Á': 0xB5, 'Â': 0xB6, 'À': 0xB7 } },
  cp437: { escT: 0, map: { ...CP_BASE, '£': 0x9C, '¥': 0x9D } },
};
const FALLBACK = { '€': 'EUR', 'Á': 'A', 'À': 'A', 'Â': 'A', 'Ã': 'A', 'ã': 'a', 'Ê': 'E', 'Ë': 'E', 'È': 'E', 'Í': 'I', 'Î': 'I', 'Ï': 'I', 'Ó': 'O', 'Ô': 'O', 'Ò': 'O', 'õ': 'o', 'Õ': 'O', 'Ú': 'U', 'Û': 'U', 'Ù': 'U', 'ø': 'o', 'Ø': 'O', '§': 'S', '×': 'x' };

function encodeText(str, codepage = 'cp858') {
  const cp = CODEPAGES[codepage] || CODEPAGES.cp858;
  const out = [];
  for (const ch of normalizeText(str)) {
    const c = ch.codePointAt(0);
    if (c >= 0x20 && c < 0x7F) out.push(c);
    else if (cp.map[ch] !== undefined) out.push(cp.map[ch]);
    else if (FALLBACK[ch]) for (const f of FALLBACK[ch]) out.push(f.charCodeAt(0));
    else {
      const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      if (base.length === 1 && base.charCodeAt(0) < 0x7F) out.push(base.charCodeAt(0)); else out.push(0x3F);
    }
  }
  return out;
}

/** Breite einer Zeile in Zeichen unter Berücksichtigung der Schriftgröße. */
function effectiveWidth(W, size) { return size === 'double' ? Math.floor(W / 2) : W; }

/** Zeilen, die für die gewählte Schriftgröße zu lang sind, umbrechen. */
function fitDoc(doc, W) {
  const out = [];
  for (const l of doc) {
    if (l.text === undefined) { out.push(l); continue; }
    const ew = effectiveWidth(W, l.size);
    if (l.text.length <= ew) out.push(l);
    else wrap(l.text, ew).forEach((t) => out.push({ ...l, text: t }));
  }
  return out;
}

/** ESC/POS-Bytefolge erzeugen. */
function toEscPos(doc, { width = 48, codepage = 'cp858', cut = true, feedLines = 4 } = {}) {
  const cp = CODEPAGES[codepage] || CODEPAGES.cp858;
  const bytes = [0x1B, 0x40, 0x1B, 0x74, cp.escT, 0x1B, 0x32]; // Init, Codepage, Standard-Zeilenabstand
  let curAlign = -1; let curBold = -1; let curSize = -1;
  const ALIGN = { left: 0, center: 1, right: 2 };
  const SIZE = { normal: 0x00, double: 0x11, tall: 0x01 };
  for (const l of fitDoc(doc, width)) {
    if (l.feed) { bytes.push(0x1B, 0x64, Math.min(255, l.feed)); continue; }
    if (l.cut) { bytes.push(0x1D, 0x56, 0x42, 0x00); continue; }
    const a = ALIGN[l.align] ?? 0; const b = l.bold ? 1 : 0; const s = SIZE[l.size] ?? 0;
    if (a !== curAlign) { bytes.push(0x1B, 0x61, a); curAlign = a; }
    if (b !== curBold) { bytes.push(0x1B, 0x45, b); curBold = b; }
    if (s !== curSize) { bytes.push(0x1D, 0x21, s); curSize = s; }
    bytes.push(...encodeText(l.text, codepage), 0x0A);
  }
  bytes.push(0x1B, 0x45, 0, 0x1D, 0x21, 0, 0x1B, 0x61, 0);
  if (cut) bytes.push(0x1D, 0x56, 0x42, Math.min(255, feedLines * 24)); // Vorschub + Teilschnitt
  else bytes.push(0x1B, 0x64, feedLines + 2);
  return Buffer.from(bytes);
}

const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Epson ePOS-Print XML (SOAP) für TM-m30II & Co. */
function toEposXml(doc, { width = 48, cut = true } = {}) {
  const parts = ['<text lang="de"/>', '<text smooth="true"/>'];
  for (const l of fitDoc(doc, width)) {
    if (l.feed) { parts.push(`<feed line="${l.feed}"/>`); continue; }
    if (l.cut) { parts.push('<cut type="feed"/>'); continue; }
    const dw = l.size === 'double'; const dh = l.size === 'double' || l.size === 'tall';
    parts.push(`<text align="${l.align}"/><text dw="${dw}" dh="${dh}" em="${!!l.bold}"/><text>${xmlEsc(l.text)}&#10;</text>`);
  }
  parts.push(cut ? '<cut type="feed"/>' : '<feed line="4"/>');
  return '<?xml version="1.0" encoding="utf-8"?>'
    + '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>'
    + `<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">${parts.join('')}</epos-print>`
    + '</s:Body></s:Envelope>';
}

/** Textvorschau (so wie der Bon aussieht). */
function toText(doc, width = 48) {
  return fitDoc(doc, width).filter((l) => l.text !== undefined).map((l) => {
    let t = l.text;
    if (l.size === 'double') t = t.split('').join(' ');
    if (l.align === 'center') t = ' '.repeat(Math.max(0, Math.floor((width - t.length) / 2))) + t;
    else if (l.align === 'right') t = t.padStart(width);
    return t;
  }).join('\n');
}

module.exports = { orderQty, buildListDoc, buildTestDoc, toEscPos, toEposXml, toText, encodeText, wrap, itemLines, fmtQty, unitLabel, normalizeText, fmtDate, fmtDateTime, CODEPAGES };
