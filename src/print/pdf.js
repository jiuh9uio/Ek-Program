'use strict';
/**
 * Schlanker PDF-Generator (PDF 1.4, Standardschriften Helvetica, WinAnsi-Kodierung).
 * Keine externen Abhängigkeiten – wichtig für die Einzeldatei-EXE.
 */

// Zeichenbreiten Helvetica (1/1000 em) für ASCII 32..126
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const EXTRA_W = { 'Ä': 667, 'Ö': 778, 'Ü': 722, 'ä': 556, 'ö': 556, 'ü': 556, 'ß': 611, '€': 556, 'é': 556, 'è': 556, 'à': 556 };

const WIN_ANSI = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '™': 0x99 };

function charWidth(ch, bold) {
  const c = ch.charCodeAt(0);
  let w = c >= 32 && c <= 126 ? HELV[c - 32] : (EXTRA_W[ch] || 556);
  if (bold) w *= 1.06;
  return w;
}

function textWidth(str, size, bold = false) {
  let w = 0;
  for (const ch of String(str)) w += charWidth(ch, bold);
  return (w * size) / 1000;
}

function encode(str) {
  let out = '';
  for (const ch of String(str ?? '')) {
    const c = ch.codePointAt(0);
    let b;
    if (WIN_ANSI[ch] !== undefined) b = WIN_ANSI[ch];
    else if (c < 256) b = c;
    else if (/[‐-―⸺⸻]/.test(ch)) b = 0x2D;
    else b = 0x3F;
    if (b === 0x28 || b === 0x29 || b === 0x5C) out += '\\' + String.fromCharCode(b);
    else if (b < 32) out += ' ';
    else out += String.fromCharCode(b);
  }
  return out;
}

function truncate(str, maxWidth, size, bold) {
  str = String(str ?? '');
  if (textWidth(str, size, bold) <= maxWidth) return str;
  let s = str;
  while (s.length && textWidth(s + '…', size, bold) > maxWidth) s = s.slice(0, -1);
  return s + '…';
}

function wrapText(str, maxWidth, size, bold) {
  const words = String(str ?? '').split(/\s+/).filter(Boolean);
  const lines = []; let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (textWidth(t, size, bold) <= maxWidth) cur = t;
    else { if (cur) lines.push(cur); cur = truncate(w, maxWidth, size, bold); }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

class PdfDoc {
  constructor({ width = 842, height = 595 } = {}) {
    this.W = width; this.H = height; this.pages = []; this.newPage();
  }
  newPage() { this.cur = []; this.pages.push(this.cur); return this; }
  color(r, g, b) { this.cur.push(`${r} ${g} ${b} rg ${r} ${g} ${b} RG`); }
  text(x, y, str, { size = 10, bold = false, color = [0, 0, 0], align = 'left', maxWidth } = {}) {
    let s = String(str ?? '');
    if (maxWidth) s = truncate(s, maxWidth, size, bold);
    let tx = x;
    if (align === 'right') tx = x - textWidth(s, size, bold);
    else if (align === 'center') tx = x - textWidth(s, size, bold) / 2;
    this.cur.push(`BT ${color.join(' ')} rg /${bold ? 'F2' : 'F1'} ${size} Tf ${tx.toFixed(2)} ${(this.H - y).toFixed(2)} Td (${encode(s)}) Tj ET`);
  }
  line(x1, y1, x2, y2, { width = 0.5, color = [0.75, 0.75, 0.75] } = {}) {
    this.cur.push(`${color.join(' ')} RG ${width} w ${x1.toFixed(2)} ${(this.H - y1).toFixed(2)} m ${x2.toFixed(2)} ${(this.H - y2).toFixed(2)} l S`);
  }
  rect(x, y, w, h, { fill = null, stroke = [0, 0, 0], width = 0.8 } = {}) {
    const op = fill && stroke ? 'B' : fill ? 'f' : 'S';
    const cmds = [];
    if (fill) cmds.push(`${fill.join(' ')} rg`);
    if (stroke) cmds.push(`${stroke.join(' ')} RG ${width} w`);
    cmds.push(`${x.toFixed(2)} ${(this.H - y - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re ${op}`);
    this.cur.push(cmds.join(' '));
  }
  toBuffer({ title = 'Dokument' } = {}) {
    const objs = [];
    const add = (s) => { objs.push(s); return objs.length; };
    const catalogId = add(null); const pagesId = add(null);
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const pageIds = [];
    for (const ops of this.pages) {
      const stream = Buffer.from(ops.join('\n'), 'latin1');
      const contentId = add({ stream, dict: `<< /Length ${stream.length} >>` });
      pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${this.W} ${this.H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${contentId} 0 R >>`));
    }
    objs[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objs[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
    const infoId = add(`<< /Title (${encode(title)}) /Producer (EK-Service) /CreationDate (D:${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}) >>`);

    const chunks = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
    let offset = chunks[0].length;
    const offsets = [];
    objs.forEach((o, i) => {
      offsets.push(offset);
      let buf;
      if (o && o.stream) buf = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n${o.dict}\nstream\n`, 'latin1'), o.stream, Buffer.from('\nendstream\nendobj\n', 'latin1')]);
      else buf = Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, 'latin1');
      chunks.push(buf); offset += buf.length;
    });
    const xref = [`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
    chunks.push(Buffer.from(`${xref}trailer\n<< /Size ${objs.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${offset}\n%%EOF\n`, 'latin1'));
    return Buffer.concat(chunks);
  }
}

const eur = (n) => (n === null || n === undefined ? '' : Number(n).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €');
const qtyFmt = (n) => Number(n).toLocaleString('de-DE', { maximumFractionDigits: 3 });
const pad2 = (n) => String(n).padStart(2, '0');
const dt = (iso) => { if (!iso) return ''; const d = new Date(iso); return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

/** Einkaufsliste als PDF (A4 quer) mit Abhak-Kästchen. */
function listPdf(list, { company = '', groupBy = 'supplier', userName = '', showPrices = true } = {}) {
  const pdf = new PdfDoc({ width: 842, height: 595 });
  const M = 36;
  const cols = [
    { key: 'check', label: '', w: 22 },
    { key: 'name', label: 'Artikel', w: 210 },
    { key: 'qty', label: 'Menge', w: 50, align: 'right' },
    { key: 'unit', label: 'Einheit', w: 62 },
    { key: 'pack', label: 'Gebinde', w: 70 },
    { key: 'supplier', label: 'Lieferant', w: 100 },
    { key: 'location', label: 'Lagerort', w: 80 },
    { key: 'price', label: 'EK netto', w: 56, align: 'right' },
    { key: 'total', label: 'Summe', w: 60, align: 'right' },
    { key: 'note', label: 'Bemerkung', w: 60 },
  ];
  if (!showPrices) { cols.find((c) => c.key === 'name').w += 116; cols.splice(cols.findIndex((c) => c.key === 'price'), 2); }
  let y = M;

  const header = () => {
    pdf.rect(M, y, 842 - 2 * M, 44, { fill: [0.13, 0.22, 0.33], stroke: null });
    pdf.text(M + 12, y + 19, 'SERVICE-EINKAUF', { size: 16, bold: true, color: [1, 1, 1] });
    pdf.text(M + 12, y + 35, company, { size: 9, color: [0.85, 0.9, 0.95] });
    pdf.text(842 - M - 12, y + 19, list.number, { size: 16, bold: true, color: [1, 1, 1], align: 'right' });
    pdf.text(842 - M - 12, y + 35, `Status: ${list.status_label}`, { size: 9, color: [0.85, 0.9, 0.95], align: 'right' });
    y += 58;
  };
  const tableHead = () => {
    let x = M;
    pdf.rect(M, y - 11, 842 - 2 * M, 16, { fill: [0.92, 0.94, 0.96], stroke: null });
    for (const c of cols) {
      pdf.text(c.align === 'right' ? x + c.w - 4 : x + 4, y, c.label, { size: 8, bold: true, color: [0.25, 0.3, 0.38], align: c.align === 'right' ? 'right' : 'left' });
      x += c.w;
    }
    y += 14;
  };
  const ensure = (h) => { if (y + h > 595 - M - 20) { pdf.newPage(); y = M; header(); tableHead(); } };

  header();
  pdf.text(M, y, `Erstellt: ${dt(list.created_at)} von ${list.created_by_name || '-'}`, { size: 9 });
  pdf.text(M + 260, y, `Gedruckt: ${dt(new Date().toISOString())}${userName ? ' von ' + userName : ''}`, { size: 9 });
  pdf.text(M + 520, y, `Positionen: ${list.items.length}`, { size: 9, bold: true });
  y += 13;
  if (list.title) { pdf.text(M, y, `Bezeichnung: ${list.title}`, { size: 9 }); y += 13; }
  if (list.note) { for (const l of wrapText(`Hinweis: ${list.note}`, 842 - 2 * M, 9)) { pdf.text(M, y, l, { size: 9 }); y += 12; } }
  y += 10;
  tableHead();

  const keyOf = (i) => groupBy === 'supplier' ? (i.supplier_name || 'Ohne Lieferant') : groupBy === 'location' ? (i.location_name || 'Ohne Lagerort') : (i.category_name || 'Ohne Kategorie');
  const groups = new Map();
  for (const i of list.items) { const k = keyOf(i); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); }
  const sortedKeys = [...groups.keys()].sort((a, b) => a.localeCompare(b, 'de'));

  for (const k of sortedKeys) {
    const items = groups.get(k);
    ensure(40);
    pdf.text(M + 2, y + 4, k.toUpperCase(), { size: 9.5, bold: true, color: [0.13, 0.22, 0.33] });
    y += 10;
    pdf.line(M, y, 842 - M, y, { width: 0.8, color: [0.13, 0.22, 0.33] });
    y += 12;
    let sub = 0;
    for (const i of items) {
      const noteLines = i.note ? wrapText(i.note, cols.find((c) => c.key === 'note') ? 56 : 200, 7.5) : [];
      const h = Math.max(18, 12 + noteLines.length * 9);
      ensure(h);
      let x = M;
      const unit = Math.abs(i.qty - 1) < 1e-9 ? i.unit_name : (i.unit_plural || i.unit_name);
      const vals = {
        name: i.article_name, qty: qtyFmt(i.qty), unit: unit || '', pack: i.pack_size || '', supplier: i.supplier_name || '',
        location: i.location_name || '', price: eur(i.unit_price_est), total: eur(i.est_total), note: '',
      };
      for (const c of cols) {
        if (c.key === 'check') pdf.rect(x + 5, y - 8, 10, 10, { stroke: [0.2, 0.2, 0.2], width: 0.9, fill: i.purchased ? [0.8, 0.9, 0.8] : null });
        else if (c.key === 'note') noteLines.forEach((l, n) => pdf.text(x + 4, y + n * 9, l, { size: 7.5, color: [0.35, 0.35, 0.35] }));
        else pdf.text(c.align === 'right' ? x + c.w - 4 : x + 4, y, vals[c.key], { size: 9, bold: c.key === 'qty' || c.key === 'name', align: c.align === 'right' ? 'right' : 'left', maxWidth: c.w - 8 });
        x += c.w;
      }
      if (i.article_no) pdf.text(M + cols[0].w + 4, y + 9, i.article_no, { size: 6.5, color: [0.5, 0.5, 0.5] });
      y += h - 6;
      pdf.line(M, y, 842 - M, y, { width: 0.3 });
      y += 12;
      sub += i.est_total;
    }
    if (showPrices) {
      ensure(16);
      pdf.text(842 - M - 4 - (cols.find((c) => c.key === 'note') ? 60 : 0), y - 2, `Zwischensumme ${k}: ${eur(sub)}`, { size: 8.5, bold: true, align: 'right' });
      const g = groupBy === 'supplier' ? list.supplier_groups.find((s) => (s.supplier_name || 'Ohne Lieferant') === k) : null;
      if (g && g.below_min_order) {
        pdf.text(M + 4, y - 2, `! Mindestbestellwert ${eur(g.min_order_value)} nicht erreicht (es fehlen ${eur(g.missing_to_min)})`, { size: 8.5, bold: true, color: [0.75, 0.1, 0.1] });
      }
      y += 14;
    }
  }

  if (showPrices) {
    ensure(50);
    y += 6;
    pdf.line(842 - M - 260, y, 842 - M, y, { width: 1, color: [0.13, 0.22, 0.33] });
    y += 14;
    pdf.text(842 - M - 260, y, 'Warenwert netto (geschätzt)', { size: 9.5 });
    pdf.text(842 - M - 4, y, eur(list.totals.est_goods), { size: 9.5, align: 'right' }); y += 13;
    pdf.text(842 - M - 260, y, 'Versandkosten', { size: 9.5 });
    pdf.text(842 - M - 4, y, eur(list.totals.shipping), { size: 9.5, align: 'right' }); y += 13;
    pdf.text(842 - M - 260, y, 'Gesamt netto (geschätzt)', { size: 10.5, bold: true });
    pdf.text(842 - M - 4, y, eur(list.totals.est_total), { size: 10.5, bold: true, align: 'right' });
    if (list.totals.actual_goods !== null || list.actual_cost !== null) {
      y += 13;
      pdf.text(842 - M - 260, y, 'Tatsächliche Kosten', { size: 9.5 });
      pdf.text(842 - M - 4, y, eur(list.actual_cost ?? list.totals.actual_goods), { size: 9.5, align: 'right' });
    }
  }

  // Fußzeile mit Seitenzahlen
  const total = pdf.pages.length;
  pdf.pages.forEach((ops, idx) => {
    pdf.cur = ops;
    pdf.text(M, 595 - 20, `EK-Service · ${list.number}`, { size: 7.5, color: [0.5, 0.5, 0.5] });
    pdf.text(842 - M, 595 - 20, `Seite ${idx + 1} von ${total}`, { size: 7.5, color: [0.5, 0.5, 0.5], align: 'right' });
  });
  return pdf.toBuffer({ title: `Einkaufsliste ${list.number}` });
}

module.exports = { PdfDoc, listPdf, textWidth, encode };
