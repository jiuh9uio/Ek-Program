'use strict';
/**
 * Import eingefügter Tabellen (z. B. von Claude berechnete MIN/MAX-Werte).
 * Erkennt Markdown-Tabellen, Excel/Tab-getrennt und CSV (; oder ,).
 * Spalten werden über Synonyme erkannt; leere Zellen ändern nichts.
 * Mit dry_run wird nur eine Vorschau berechnet (Transaktion wird zurückgerollt).
 */
const { unprocessable } = require('../http/core');
const { audit, diff } = require('./audit');

const normH = (s) => String(s || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]/g, '');

const SYNONYMS = {
  article_no: ['artikelnummer', 'artnr', 'artikelnr', 'nr', 'nummer', 'sku', 'artikelno'],
  name: ['artikelname', 'artikel', 'name', 'bezeichnung', 'produkt', 'artikelbezeichnung', 'ware'],
  category: ['kategorie', 'warengruppe', 'gruppe', 'kat'],
  manufacturer: ['hersteller', 'marke'],
  supplier: ['lieferant', 'einkaufsort', 'bezugsquelle', 'haendler', 'einkaufsquelle', 'wokaufen', 'kaufenbei', 'quelle', 'markt'],
  location: ['lagerort', 'lager', 'ort', 'standort'],
  pack_size: ['gebindegroesse', 'gebinde', 'packungsgroesse', 'groesse'],
  unit: ['einheit', 'zaehleinheit', 'mengeneinheit', 'me', 'basiseinheit'],
  order_unit: ['bestelleinheit', 'kaufeinheit', 'einkaufseinheit', 've', 'verpackungseinheit'],
  units_per_order: ['inhaltjebestelleinheit', 'inhalt', 'inhaltprobestelleinheit', 'umrechnung', 'faktor', 'stueckprokarton', 'proverpackung', 'jebestelleinheit'],
  min_stock: ['min', 'minimum', 'mindestbestand', 'minbestand', 'meldebestand'],
  max_stock: ['max', 'maximum', 'maximalbestand', 'maxbestand', 'zielbestand', 'hoechstbestand'],
  price_net: ['eknetto', 'ek', 'einkaufspreis', 'preis', 'einkaufspreisnetto', 'preisnetto', 'eknettoeur'],
  min_order_qty: ['mindestbestellmenge', 'mbm', 'minbestellmenge'],
  order_step: ['gebindeschritt', 'bestellintervall', 'schritt', 'bestellschritt'],
  notes: ['bemerkung', 'bemerkungen', 'notiz', 'hinweis', 'kommentar', 'begruendung'],
  active: ['aktiv'],
  barcode: ['barcode', 'ean', 'gtin', 'ean13', 'code', 'qrcode', 'etikett', 'etikettencode', 'strichcode', 'scancode'],
};

function fieldFor(header) {
  const h = normH(header);
  if (!h) return null;
  for (const [f, syn] of Object.entries(SYNONYMS)) if (syn.includes(h)) return f;
  if (/^min/.test(h) && !h.includes('bestell')) return 'min_stock';
  if (/^max/.test(h)) return 'max_stock';
  if (h.includes('mindestbestell')) return 'min_order_qty';
  if (h.includes('bestelleinheit') && (h.includes('inhalt') || h.includes('je') || h.includes('pro'))) return 'units_per_order';
  if (h.includes('bestelleinheit')) return 'order_unit';
  if (h.includes('prokarton') || h.includes('jekarton') || h.includes('inhalt')) return 'units_per_order';
  if (h.includes('lieferant') || h.includes('einkaufsort')) return 'supplier';
  if (h.includes('artikelnummer') || h.includes('artnr')) return 'article_no';
  if (h.includes('preis') || h.startsWith('ek')) return 'price_net';
  if (h.includes('kategorie')) return 'category';
  if (h.includes('lagerort')) return 'location';
  if (h.includes('bemerk') || h.includes('begruend')) return 'notes';
  return null;
}

function splitCsv(line, sep) {
  const out = []; let cell = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === sep) { out.push(cell); cell = ''; }
    else cell += c;
  }
  out.push(cell);
  return out;
}

/** Text → { format, header: [...], rows: [{ line, cells }] } */
function parseTable(text) {
  const lines = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const clean = (c) => c.replace(/\*\*|__|`/g, '').trim();
  const mdRows = lines.map((l, i) => ({ l: l.trim(), i })).filter((x) => x.l.startsWith('|') && x.l.length > 1);
  let format; let table = [];
  if (mdRows.length >= 2) {
    format = 'markdown';
    table = mdRows.filter((x) => !/^\|?[\s:|-]+\|?$/.test(x.l)).map((x) => {
      let cells = x.l.split('|');
      if (cells[0].trim() === '') cells = cells.slice(1);
      if (cells.length && cells[cells.length - 1].trim() === '') cells = cells.slice(0, -1);
      return { line: x.i + 1, cells: cells.map(clean) };
    });
  } else {
    const nonEmpty = lines.map((l, i) => ({ l, i })).filter((x) => x.l.trim());
    if (!nonEmpty.length) throw unprocessable('Es wurde keine Tabelle eingefügt.');
    const head = nonEmpty[0].l;
    let sep;
    if (head.includes('\t')) { sep = '\t'; format = 'tabelle'; }
    else { sep = (head.match(/;/g) || []).length >= (head.match(/,/g) || []).length ? ';' : ','; format = 'csv'; }
    table = nonEmpty.map((x) => ({ line: x.i + 1, cells: (sep === '\t' ? x.l.split('\t') : splitCsv(x.l, sep)).map(clean) }));
  }
  if (table.length < 2) throw unprocessable('Die Tabelle braucht eine Kopfzeile und mindestens eine Datenzeile.');
  return { format, header: table[0].cells, rows: table.slice(1).filter((r) => r.cells.some((c) => c !== '')) };
}

/** "1.234,5" / "12,5" / "3 Kästen" / "ca. 6" → Zahl */
function looseNum(s) {
  const m = String(s).replace(/\s/g, '').match(/-?\d[\d.,]*/);
  if (!m) return NaN;
  let t = m[0];
  if (t.includes(',') && t.includes('.')) t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if (t.includes(',')) t = t.replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  return Number(t);
}

class DryRun extends Error {}

function importTable(db, user, can, text, { dryRun = true, createNew = true, department = 'service' } = {}) {
  const { articleInput, enforceFieldPerms, ALL_FIELDS } = require('../routes/articles');
  const parsed = parseTable(text);
  const map = parsed.header.map((h) => fieldFor(h));
  const used = new Set();
  const columns = parsed.header.map((h, i) => {
    let f = map[i];
    if (f && used.has(f)) f = null; // doppelte Spalte ignorieren
    if (f) used.add(f);
    map[i] = f;
    return { header: h, field: f };
  });
  if (!used.has('name') && !used.has('article_no')) throw unprocessable('Keine Spalte „Artikelname“ oder „Artikelnummer“ erkannt. Bitte Kopfzeile prüfen.');

  const names = {
    units: new Map(db.all('SELECT id, name, plural FROM units').flatMap((u) => [[normH(u.name), u.id], [normH(u.plural), u.id]])),
  };
  const lookup = (table, value, created) => {
    if (!value) return null;
    if (table === 'units') {
      const id = names.units.get(normH(value));
      if (id) return id;
      const nid = Number(db.run('INSERT INTO units(name, plural, sort_order) VALUES(?,?,999)', value, value).lastInsertRowid);
      names.units.set(normH(value), nid); created.push(`Einheit „${value}“`);
      return nid;
    }
    const depWhere = table === 'suppliers' ? '' : ' AND department = ?';
    const r = db.get(`SELECT id FROM ${table} WHERE name = ? COLLATE NOCASE${depWhere}`, ...(table === 'suppliers' ? [value] : [value, department]));
    if (r) return r.id;
    const t = new Date().toISOString();
    const id = table === 'suppliers'
      ? Number(db.run('INSERT INTO suppliers(name, created_at, updated_at) VALUES(?,?,?)', value, t, t).lastInsertRowid)
      : Number(db.run(`INSERT INTO ${table}(department, name, sort_order) VALUES(?, ?, 999)`, department, value).lastInsertRowid);
    created.push(`${({ suppliers: 'Lieferant', categories: 'Kategorie', locations: 'Lagerort' })[table]} „${value}“`);
    return id;
  };
  const all = db.all('SELECT * FROM articles WHERE department = ? AND archived = 0', department);
  const byNo = new Map(all.map((a) => [normH(a.article_no), a]));
  const byName = new Map();
  for (const a of all) { const k = normH(a.name); byName.set(k, byName.has(k) ? 'AMBIG' : a); }

  const results = [];
  const createdRefs = [];
  const idName = (table, id) => (id ? (db.get(`SELECT name FROM ${table} WHERE id = ?`, id) || {}).name : null);
  const REF = { category_id: 'categories', supplier_id: 'suppliers', location_id: 'locations', unit_id: 'units', order_unit_id: 'units' };

  const run = () => {
    for (const r of parsed.rows) {
      const raw = {};
      map.forEach((f, i) => { if (f && r.cells[i] !== undefined && r.cells[i] !== '' && r.cells[i] !== '-' && r.cells[i] !== '–') raw[f] = r.cells[i]; });
      const res = { line: r.line, name: raw.name || null, article_no: raw.article_no || null };
      try {
        db.transaction(() => {
          let before = null;
          if (raw.article_no) before = byNo.get(normH(raw.article_no)) || null;
          if (!before && raw.name) {
            const m = byName.get(normH(raw.name));
            if (m === 'AMBIG') throw unprocessable(`Name „${raw.name}“ ist mehrdeutig – bitte Artikelnummer angeben.`);
            before = m || null;
          }
          if (!before && !createNew) { res.action = 'skipped'; res.error = 'Artikel nicht gefunden (Neuanlage ausgeschaltet).'; return; }
          if (!before && !raw.name) throw unprocessable('Neuer Artikel ohne Artikelname.');
          const body = {};
          for (const f of ['name', 'manufacturer', 'pack_size', 'notes']) if (raw[f] !== undefined) body[f] = raw[f];
          if (raw.article_no !== undefined) body.article_no = raw.article_no;
          for (const f of ['min_stock', 'max_stock', 'price_net', 'min_order_qty', 'order_step', 'units_per_order']) {
            if (raw[f] === undefined) continue;
            const n = looseNum(raw[f]);
            if (!Number.isFinite(n)) throw unprocessable(`„${raw[f]}“ ist keine gültige Zahl.`);
            body[f] = n;
          }
          if (raw.barcode !== undefined) res.barcode = raw.barcode;
          if (raw.active !== undefined) body.active = !/^(nein|no|0|false|inaktiv)$/i.test(raw.active);
          if (raw.category !== undefined) body.category_id = lookup('categories', raw.category, createdRefs);
          if (raw.supplier !== undefined) body.supplier_id = lookup('suppliers', raw.supplier, createdRefs);
          if (raw.location !== undefined) body.location_id = lookup('locations', raw.location, createdRefs);
          if (raw.unit !== undefined) body.unit_id = lookup('units', raw.unit, createdRefs);
          if (raw.order_unit !== undefined) body.order_unit_id = lookup('units', raw.order_unit, createdRefs);
          if (!before && !body.article_no) {
            let no;
            do { no = `A-${String(db.nextNumber('article_auto')).padStart(4, '0')}`; } while (byNo.has(normH(no)));
            body.article_no = no;
          }
          // fehlendes MAX bei neuem MIN: nicht automatisch erfinden – Validierung meldet MAX < MIN
          const a = articleInput(db, body, before);
          enforceFieldPerms({ can }, a, before);
          const t = new Date().toISOString();
          if (before) {
            const ch = diff(before, a, ALL_FIELDS);
            if (raw.barcode !== undefined) {
              const C = require('./codes');
              const code = C.normCode(raw.barcode);
              const owner = db.get('SELECT article_id FROM article_codes WHERE code = ? COLLATE NOCASE', code);
              if (owner && owner.article_id !== before.id) throw unprocessable(`Code „${code}“ gehört bereits zu einem anderen Artikel.`);
              if (!owner) { C.addCode(db, user, before.id, { code }); ch.barcode = { von: null, nach: code }; }
            }
            if (!Object.keys(ch).length) { res.action = 'unchanged'; res.name = before.name; return; }
            db.run(`UPDATE articles SET ${ALL_FIELDS.map((f) => `${f} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...ALL_FIELDS.map((f) => a[f]), t, before.id);
            if (a.price_net !== before.price_net) db.run("UPDATE purchase_items SET unit_price_est = ? WHERE article_id = ? AND list_id IN (SELECT id FROM purchase_lists WHERE status IN ('draft','ready'))", a.price_net, before.id);
            for (const [k, tbl] of Object.entries(REF)) if (ch[k]) ch[k] = { von: idName(tbl, ch[k].von), nach: idName(tbl, ch[k].nach) };
            res.action = 'update'; res.changes = ch; res.name = a.name; res.article_no = a.article_no; res.id = before.id;
          } else {
            const id = Number(db.run(`INSERT INTO articles(department, ${ALL_FIELDS.join(',')}, created_at, updated_at) VALUES(?, ${ALL_FIELDS.map(() => '?').join(',')}, ?, ?)`, department, ...ALL_FIELDS.map((f) => a[f]), t, t).lastInsertRowid);
            const created = db.get('SELECT * FROM articles WHERE id = ?', id);
            byNo.set(normH(a.article_no), created); byName.set(normH(a.name), created);
            if (raw.barcode !== undefined) require('./codes').addCode(db, user, id, { code: raw.barcode });
            res.action = 'create'; res.name = a.name; res.article_no = a.article_no; res.id = id;
            res.changes = { min_stock: { von: null, nach: a.min_stock }, max_stock: { von: null, nach: a.max_stock } };
          }
        });
      } catch (e) {
        if (e instanceof DryRun) throw e;
        res.action = 'error'; res.error = e.message;
      }
      results.push(res);
    }
    if (dryRun) throw new DryRun();
  };

  try { db.transaction(run); } catch (e) { if (!(e instanceof DryRun)) throw e; }
  const count = (a) => results.filter((r) => r.action === a).length;
  const out = {
    format: parsed.format, columns, dry_run: dryRun, rows: results,
    created_refs: [...new Set(createdRefs)],
    counts: { create: count('create'), update: count('update'), unchanged: count('unchanged'), error: count('error'), skipped: count('skipped') },
  };
  if (!dryRun) audit(db, user, 'Tabelle importiert (MIN/MAX)', 'article', null, { format: parsed.format, ...out.counts });
  return out;
}

module.exports = { parseTable, importTable, fieldFor, looseNum };
