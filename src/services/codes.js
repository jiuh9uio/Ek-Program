'use strict';
/**
 * Artikel-Codes (EAN/GTIN, Karton-EAN, eigene Etiketten-Codes) und Scanner-Suche.
 * Ein Code gehört eindeutig zu genau einem Artikel. Die Artikelnummer gilt zusätzlich als Code.
 */
const { notFound, unprocessable, conflict } = require('../http/core');
const { audit } = require('./audit');

const KINDS = ['ean', 'own', 'case', 'other'];

function normCode(raw) {
  // Steuerzeichen (z. B. GS-Trenner von GS1-Codes) und Leerzeichen am Rand entfernen
  const s = String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!s) throw unprocessable('Bitte einen Code eingeben oder scannen.', { field: 'code' });
  if (s.length > 120) throw unprocessable('Der Code ist zu lang (max. 120 Zeichen).', { field: 'code' });
  return s;
}

/** EAN-8/EAN-13/UPC-A: Prüfziffer kontrollieren (nur Hinweis, kein Fehler). */
function eanValid(code) {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return null;
  const digits = code.split('').map(Number);
  const check = digits.pop();
  const sum = digits.reverse().reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

function guessKind(code) {
  if (/^EK\d{6}/i.test(code)) return 'own';
  if (eanValid(code)) return 'ean';
  return 'other';
}

function codesFor(db, ids) {
  const map = new Map();
  if (!ids.length) return map;
  for (const r of db.all(`SELECT * FROM article_codes WHERE article_id IN (${ids.map(() => '?').join(',')}) ORDER BY CASE kind WHEN 'own' THEN 0 WHEN 'ean' THEN 1 WHEN 'case' THEN 2 ELSE 3 END, id`, ...ids)) {
    if (!map.has(r.article_id)) map.set(r.article_id, []);
    map.get(r.article_id).push(r);
  }
  return map;
}

function lookup(db, raw, department = 'service') {
  const code = normCode(raw);
  let row = db.get(`SELECT ac.code, ac.kind, a.id, a.name, a.article_no, a.archived, a.active FROM article_codes ac JOIN articles a ON a.id = ac.article_id
    WHERE ac.code = ? COLLATE NOCASE AND a.department = ?`, code, department);
  let via = row ? row.kind : null;
  if (!row) {
    row = db.get('SELECT id, name, article_no, archived, active FROM articles WHERE article_no = ? COLLATE NOCASE AND department = ?', code, department);
    via = row ? 'article_no' : null;
  }
  if (!row) throw notFound(`Unbekannter Code „${code}“ – keinem Artikel zugeordnet.`);
  return { code, via, article: { id: row.id, name: row.name, article_no: row.article_no, archived: !!row.archived, active: !!row.active } };
}

function addCode(db, user, articleId, { code, kind, note } = {}) {
  const a = db.get('SELECT id, name FROM articles WHERE id = ?', articleId);
  if (!a) throw notFound('Artikel nicht gefunden.');
  const c = normCode(code);
  const k = kind && KINDS.includes(kind) ? kind : guessKind(c);
  const used = db.get('SELECT ac.article_id, a.name FROM article_codes ac JOIN articles a ON a.id = ac.article_id WHERE ac.code = ? COLLATE NOCASE', c);
  if (used) {
    if (used.article_id === a.id) throw conflict(`Der Code „${c}“ ist diesem Artikel bereits zugeordnet.`);
    throw conflict(`Der Code „${c}“ gehört bereits zu „${used.name}“.`);
  }
  const clash = db.get('SELECT name FROM articles WHERE article_no = ? COLLATE NOCASE AND id <> ?', c, a.id);
  if (clash) throw conflict(`„${c}“ ist die Artikelnummer von „${clash.name}“.`);
  const id = Number(db.run('INSERT INTO article_codes(article_id, code, kind, note, created_at) VALUES(?,?,?,?,?)',
    a.id, c, k, note ? String(note).slice(0, 200) : null, new Date().toISOString()).lastInsertRowid);
  audit(db, user, 'Code zugeordnet', 'article', a.id, { artikel: a.name, code: c, art: k });
  return { id, code: c, kind: k, ean_valid: eanValid(c) };
}

function removeCode(db, user, articleId, codeId) {
  const r = db.get('SELECT ac.*, a.name FROM article_codes ac JOIN articles a ON a.id = ac.article_id WHERE ac.id = ? AND ac.article_id = ?', codeId, articleId);
  if (!r) throw notFound('Code nicht gefunden.');
  db.run('DELETE FROM article_codes WHERE id = ?', r.id);
  audit(db, user, 'Code entfernt', 'article', articleId, { artikel: r.name, code: r.code });
  return { ok: true };
}

/** Eigener, stabiler Etiketten-Code: EK + Artikel-ID (6-stellig). */
function generateOwn(db, user, articleId) {
  const a = db.get('SELECT id FROM articles WHERE id = ?', articleId);
  if (!a) throw notFound('Artikel nicht gefunden.');
  const existing = db.get("SELECT * FROM article_codes WHERE article_id = ? AND kind = 'own' ORDER BY id LIMIT 1", a.id);
  if (existing) return { id: existing.id, code: existing.code, kind: 'own', existing: true };
  let code = `EK${String(a.id).padStart(6, '0')}`;
  for (let i = 2; db.get('SELECT id FROM article_codes WHERE code = ? COLLATE NOCASE', code); i++) code = `EK${String(a.id).padStart(6, '0')}-${i}`;
  return addCode(db, user, a.id, { code, kind: 'own' });
}

/** Etikettendaten; fehlende Codes werden auf Wunsch erzeugt. */
function labelData(db, user, ids, { generate = true } = {}) {
  const list = ids.map(Number).filter(Number.isInteger);
  if (!list.length) throw unprocessable('Keine Artikel ausgewählt.');
  if (list.length > 500) throw unprocessable('Höchstens 500 Etiketten auf einmal.');
  return db.transaction(() => {
    const rows = db.all(`SELECT a.id, a.name, a.article_no, a.pack_size, a.min_stock, a.max_stock, l.name AS location_name, s.name AS supplier_name, u.plural AS unit_plural
      FROM articles a LEFT JOIN locations l ON l.id = a.location_id LEFT JOIN suppliers s ON s.id = a.supplier_id LEFT JOIN units u ON u.id = a.unit_id
      WHERE a.id IN (${list.map(() => '?').join(',')})`, ...list);
    const byId = new Map(rows.map((r) => [r.id, r]));
    let codes = codesFor(db, list);
    if (generate) {
      for (const id of list) if (byId.has(id) && !codes.get(id)) generateOwn(db, user, id);
      codes = codesFor(db, list);
    }
    return list.filter((id) => byId.has(id)).map((id) => {
      const c = codes.get(id) || [];
      return { ...byId.get(id), code: c.length ? c[0].code : byId.get(id).article_no, codes: c.map((x) => x.code) };
    });
  });
}

/** Bon-Etiketten (ESC/POS/ePOS): je Artikel Name, Lagerort, Barcode, Schnitt. */
function labelDoc(labels, width = 48) {
  const doc = [];
  labels.forEach((l, i) => {
    doc.push({ text: l.name, align: 'center', bold: true, size: 'double' });
    const sub = [l.pack_size, l.location_name].filter(Boolean).join(' · ');
    if (sub) doc.push({ text: sub, align: 'center', bold: false, size: 'normal' });
    doc.push({ barcode: l.code });
    if (l.max_stock > 0) doc.push({ text: `MIN ${String(l.min_stock).replace('.', ',')} / MAX ${String(l.max_stock).replace('.', ',')} ${l.unit_plural || ''}`.trim(), align: 'center', bold: false, size: 'normal' });
    if (i < labels.length - 1) { doc.push({ feed: 3 }); doc.push({ cut: true }); }
  });
  return doc;
}

module.exports = { normCode, eanValid, guessKind, lookup, addCode, removeCode, generateOwn, codesFor, labelData, labelDoc, KINDS };
