'use strict';
const { notFound, conflict, unprocessable, forbidden, RawResponse } = require('../http/core');
const v = require('../http/validate');
const { audit, diff } = require('../services/audit');
const { loadArticles, loadArticle } = require('../services/articles');
const { round3 } = require('../services/stock');

const BASE_FIELDS = ['article_no', 'name', 'category_id', 'manufacturer', 'supplier_id', 'location_id', 'pack_size', 'unit_id', 'min_order_qty', 'order_step', 'notes', 'active', 'sort_order'];
const MINMAX_FIELDS = ['min_stock', 'max_stock'];
const PRICE_FIELDS = ['price_net'];
const ALL_FIELDS = [...BASE_FIELDS, ...MINMAX_FIELDS, ...PRICE_FIELDS];

function refCheck(db, table, id, label) {
  if (id && !db.get(`SELECT id FROM ${table} WHERE id = ?`, id)) throw unprocessable(`${label}: Auswahl existiert nicht.`);
  return id;
}

function articleInput(db, body, before) {
  const src = { ...(before || {}), ...body };
  const a = {
    article_no: v.str(src.article_no, 'article_no', { required: true, max: 40, label: 'Artikelnummer' }),
    name: v.str(src.name, 'name', { required: true, max: 120, label: 'Artikelname' }),
    category_id: refCheck(db, 'categories', v.id(src.category_id, 'category_id', { label: 'Kategorie' }), 'Kategorie'),
    manufacturer: v.optStr(src.manufacturer, 'manufacturer', { max: 120, label: 'Hersteller' }),
    supplier_id: refCheck(db, 'suppliers', v.id(src.supplier_id, 'supplier_id', { label: 'Lieferant' }), 'Lieferant'),
    location_id: refCheck(db, 'locations', v.id(src.location_id, 'location_id', { label: 'Lagerort' }), 'Lagerort'),
    pack_size: v.optStr(src.pack_size, 'pack_size', { max: 60, label: 'Gebindegröße' }),
    unit_id: refCheck(db, 'units', v.id(src.unit_id, 'unit_id', { label: 'Mengeneinheit' }), 'Mengeneinheit'),
    price_net: v.num(src.price_net, 'price_net', { min: 0, max: 1e6, label: 'Einkaufspreis netto' }),
    min_stock: v.num(src.min_stock, 'min_stock', { min: 0, max: 1e6, label: 'Mindestbestand' }),
    max_stock: v.num(src.max_stock, 'max_stock', { min: 0, max: 1e6, label: 'Maximalbestand' }),
    min_order_qty: v.num(src.min_order_qty, 'min_order_qty', { min: 0, max: 1e6, label: 'Mindestbestellmenge' }),
    order_step: v.num(src.order_step === undefined || src.order_step === '' ? 1 : src.order_step, 'order_step', { min: 0.001, max: 1e6, label: 'Gebindeschritt' }),
    notes: v.optStr(src.notes, 'notes', { max: 2000, label: 'Bemerkungen' }),
    active: v.bool(src.active === undefined ? 1 : src.active) ? 1 : 0,
    sort_order: v.num(src.sort_order, 'sort_order', { integer: true, min: 0, max: 1e7, label: 'Sortierung' }),
  };
  if (a.max_stock > 0 && a.max_stock < a.min_stock) throw unprocessable('Der Maximalbestand muss größer oder gleich dem Mindestbestand sein.', { field: 'max_stock' });
  return a;
}

/** Entfernt Felder, für die der Benutzer keine Rechte hat (oder wirft Fehler bei Änderung). */
function enforceFieldPerms(ctx, input, before) {
  const can = ctx.can;
  const check = (fields, perm, what) => {
    if (can(perm)) return;
    for (const f of fields) {
      const old = before ? before[f] : (f === 'order_step' ? 1 : f === 'active' ? 1 : f.endsWith('_id') || ['manufacturer', 'pack_size', 'notes'].includes(f) ? null : 0);
      if (String(input[f] ?? '') !== String(old ?? '')) throw forbidden(`Keine Berechtigung, ${what} zu ändern.`);
    }
  };
  check(MINMAX_FIELDS, 'minmax.manage', 'MIN/MAX-Bestände');
  check(PRICE_FIELDS, 'prices.manage', 'Einkaufspreise');
  check(BASE_FIELDS.filter((f) => f !== 'sort_order'), 'articles.manage', 'Artikelstammdaten');
}

// ---------- CSV ----------
const CSV_COLS = [
  ['article_no', 'Artikelnummer'], ['name', 'Artikelname'], ['category', 'Kategorie'], ['manufacturer', 'Hersteller'],
  ['supplier', 'Lieferant'], ['location', 'Lagerort'], ['pack_size', 'Gebindegröße'], ['unit', 'Mengeneinheit'],
  ['price_net', 'EK netto'], ['min_stock', 'MIN'], ['max_stock', 'MAX'], ['current_stock', 'Ist-Bestand'],
  ['min_order_qty', 'Mindestbestellmenge'], ['order_step', 'Gebindeschritt'], ['notes', 'Bemerkungen'], ['active', 'Aktiv'],
];
const csvCell = (x) => {
  if (x === null || x === undefined) return '';
  let s = typeof x === 'number' ? String(x).replace('.', ',') : String(x);
  if (/^[=+\-@]/.test(s) && typeof x !== 'number') s = "'" + s; // Formel-Injektion in Excel verhindern
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const sep = (text.split('\n')[0].match(/;/g) || []).length >= (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

module.exports = function register(router) {
  router.get('/api/articles', {}, ({ db, query }) => loadArticles(db, {
    department: query.department || 'service',
    includeArchived: query.archived === '1' || query.archived === 'all',
  }).filter((a) => query.archived === '1' ? a.archived : query.archived === 'all' ? true : !a.archived));

  router.get('/api/articles/export.csv', { perm: 'articles.manage' }, ({ db }) => {
    const rows = loadArticles(db, { includeArchived: false });
    const lines = [CSV_COLS.map((c) => c[1]).join(';')];
    for (const a of rows) {
      const m = { ...a, category: a.category_name, supplier: a.supplier_name, location: a.location_name, unit: a.unit_name, active: a.active ? 'ja' : 'nein' };
      lines.push(CSV_COLS.map(([k]) => csvCell(m[k])).join(';'));
    }
    return new RawResponse('﻿' + lines.join('\r\n'), 'text/csv; charset=utf-8', `artikel_${new Date().toISOString().slice(0, 10)}.csv`);
  });

  router.post('/api/articles/import', { perm: ['articles.manage'] }, ({ db, user, body, can }) => {
    if (typeof body.csv !== 'string' || !body.csv.trim()) throw unprocessable('Keine CSV-Daten.');
    const rows = parseCsv(body.csv);
    if (rows.length < 2) throw unprocessable('Die CSV-Datei enthält keine Datenzeilen.');
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const idx = {};
    for (const [k, label] of CSV_COLS) {
      const i = header.findIndex((h) => h === label.toLowerCase() || h === k);
      if (i >= 0) idx[k] = i;
    }
    if (idx.article_no === undefined || idx.name === undefined) throw unprocessable('Spalten "Artikelnummer" und "Artikelname" sind erforderlich.');
    const lookup = (table, name, extra = '') => {
      if (!name) return null;
      const r = db.get(`SELECT id FROM ${table} WHERE name = ? COLLATE NOCASE ${extra}`, name);
      if (r) return r.id;
      if (table === 'units') return Number(db.run('INSERT INTO units(name, plural, sort_order) VALUES(?,?,999)', name, name).lastInsertRowid);
      if (table === 'suppliers') { const t = new Date().toISOString(); return Number(db.run('INSERT INTO suppliers(name, created_at, updated_at) VALUES(?,?,?)', name, t, t).lastInsertRowid); }
      return Number(db.run(`INSERT INTO ${table}(department, name, sort_order) VALUES('service', ?, 999)`, name).lastInsertRowid);
    };
    const errors = []; let created = 0; let updated = 0;
    db.transaction(() => {
      rows.slice(1).forEach((r, n) => {
        const get = (k) => (idx[k] === undefined ? undefined : (r[idx[k]] ?? '').trim());
        try {
          db.transaction(() => {
            const no = get('article_no');
            const before = db.get("SELECT * FROM articles WHERE department = 'service' AND article_no = ?", no);
            const body2 = {};
            for (const k of ['article_no', 'name', 'manufacturer', 'pack_size', 'price_net', 'min_stock', 'max_stock', 'min_order_qty', 'order_step', 'notes']) {
              const val = get(k); if (val !== undefined) body2[k] = val.replace(/^'/, '');
            }
            if (get('active') !== undefined) body2.active = !/^(nein|no|0|false|inaktiv)$/i.test(get('active'));
            if (get('category') !== undefined) body2.category_id = lookup('categories', get('category'), "AND department = 'service'");
            if (get('supplier') !== undefined) body2.supplier_id = lookup('suppliers', get('supplier'));
            if (get('location') !== undefined) body2.location_id = lookup('locations', get('location'), "AND department = 'service'");
            if (get('unit') !== undefined) body2.unit_id = lookup('units', get('unit'));
            const a = articleInput(db, body2, before);
            enforceFieldPerms({ can }, a, before);
            const t = new Date().toISOString();
            if (before) {
              db.run(`UPDATE articles SET ${ALL_FIELDS.map((f) => `${f} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...ALL_FIELDS.map((f) => a[f]), t, before.id);
              updated++;
            } else {
              db.run(`INSERT INTO articles(department, ${ALL_FIELDS.join(',')}, created_at, updated_at) VALUES('service', ${ALL_FIELDS.map(() => '?').join(',')}, ?, ?)`, ...ALL_FIELDS.map((f) => a[f]), t, t);
              created++;
            }
          });
        } catch (e) { errors.push(`Zeile ${n + 2}: ${e.message}`); }
      });
    });
    audit(db, user, 'Artikel importiert (CSV)', 'article', null, { neu: created, aktualisiert: updated, fehler: errors.length });
    return { created, updated, errors };
  });

  router.get('/api/articles/:id', {}, ({ db, params }) => {
    const a = loadArticle(db, Number(params.id));
    if (!a) throw notFound('Artikel nicht gefunden.');
    a.movements = db.all(`SELECT m.*, u.display_name AS user_name, pl.number AS list_number FROM stock_movements m
      LEFT JOIN users u ON u.id = m.user_id LEFT JOIN purchase_lists pl ON pl.id = m.list_id
      WHERE m.article_id = ? ORDER BY m.id DESC LIMIT 50`, a.id);
    return a;
  });

  router.get('/api/articles/:id/image', {}, ({ db, params }) => {
    const r = db.get('SELECT image FROM articles WHERE id = ?', params.id);
    if (!r || !r.image) throw notFound('Kein Bild.');
    const m = /^data:([^;]+);base64,(.*)$/.exec(r.image);
    return new RawResponse(Buffer.from(m[2], 'base64'), m[1]);
  });

  router.post('/api/articles', { perm: 'articles.manage' }, (ctx) => {
    const { db, user, body } = ctx;
    const a = articleInput(db, body, null);
    enforceFieldPerms(ctx, a, null);
    const image = v.image(body.image, 'image');
    const t = new Date().toISOString();
    const id = Number(db.run(`INSERT INTO articles(department, ${ALL_FIELDS.join(',')}, image, created_at, updated_at) VALUES(?, ${ALL_FIELDS.map(() => '?').join(',')}, ?, ?, ?)`,
      body.department || 'service', ...ALL_FIELDS.map((f) => a[f]), image ?? null, t, t).lastInsertRowid);
    // optional: Anfangsbestand
    if (body.current_stock !== undefined && body.current_stock !== null && body.current_stock !== '') {
      const s = v.num(body.current_stock, 'current_stock', { min: 0, max: 1e6, label: 'Ist-Bestand' });
      db.run("UPDATE articles SET current_stock = ?, stock_checked_at = ?, stock_checked_by = ?, check_result = 'counted' WHERE id = ?", s, t, user.id, id);
      db.run("INSERT INTO stock_movements(article_id, at, user_id, type, qty_before, qty_after, delta, note) VALUES(?,?,?,'count',NULL,?,NULL,'Anfangsbestand')", id, t, user.id, s);
    }
    audit(db, user, 'Artikel angelegt', 'article', id, { nummer: a.article_no, name: a.name });
    return loadArticle(db, id);
  });

  router.put('/api/articles/:id', { perm: ['articles.manage', 'minmax.manage', 'prices.manage'] }, (ctx) => {
    const { db, user, body, params } = ctx;
    const before = db.get('SELECT * FROM articles WHERE id = ?', params.id);
    if (!before) throw notFound('Artikel nicht gefunden.');
    const a = articleInput(db, body, before);
    enforceFieldPerms(ctx, a, before);
    const image = v.image(body.image, 'image');
    if (image !== undefined && !ctx.can('articles.manage')) throw forbidden();
    const t = new Date().toISOString();
    db.transaction(() => {
      db.run(`UPDATE articles SET ${ALL_FIELDS.map((f) => `${f} = ?`).join(', ')}${image !== undefined ? ', image = ?' : ''}, updated_at = ? WHERE id = ?`,
        ...ALL_FIELDS.map((f) => a[f]), ...(image !== undefined ? [image] : []), t, before.id);
      // Preisänderung in offene Entwurfslisten übernehmen
      if (a.price_net !== before.price_net) {
        db.run(`UPDATE purchase_items SET unit_price_est = ? WHERE article_id = ? AND list_id IN (SELECT id FROM purchase_lists WHERE status IN ('draft','ready'))`, a.price_net, before.id);
      }
      const changes = diff(before, a, ALL_FIELDS);
      if (image !== undefined && image !== before.image) changes.bild = image ? 'geändert' : 'entfernt';
      if (Object.keys(changes).length) audit(db, user, 'Artikel geändert', 'article', before.id, { name: a.name, ...changes });
    });
    return loadArticle(db, before.id);
  });

  router.post('/api/articles/:id/duplicate', { perm: 'articles.manage' }, ({ db, user, params }) => {
    const src = db.get('SELECT * FROM articles WHERE id = ?', params.id);
    if (!src) throw notFound('Artikel nicht gefunden.');
    let no = `${src.article_no}-K`;
    for (let i = 2; db.get('SELECT id FROM articles WHERE department = ? AND article_no = ?', src.department, no); i++) no = `${src.article_no}-K${i}`;
    const t = new Date().toISOString();
    const id = Number(db.run(`INSERT INTO articles(department, ${ALL_FIELDS.join(',')}, image, created_at, updated_at) VALUES(?, ${ALL_FIELDS.map(() => '?').join(',')}, ?, ?, ?)`,
      src.department, ...ALL_FIELDS.map((f) => (f === 'article_no' ? no : f === 'name' ? `${src.name} (Kopie)` : src[f])), src.image, t, t).lastInsertRowid);
    audit(db, user, 'Artikel dupliziert', 'article', id, { quelle: src.article_no, neu: no });
    return loadArticle(db, id);
  });

  router.post('/api/articles/:id/archive', { perm: 'articles.manage' }, ({ db, user, params, body }) => {
    const a = db.get('SELECT * FROM articles WHERE id = ?', params.id);
    if (!a) throw notFound('Artikel nicht gefunden.');
    const archived = body.archived === false ? 0 : 1;
    if (archived) {
      const open = db.get(`SELECT COUNT(*) AS n FROM purchase_items pi JOIN purchase_lists pl ON pl.id = pi.list_id
        WHERE pi.article_id = ? AND pl.status IN ('draft','ready','ordered','partial')`, a.id).n;
      if (open) throw conflict(`"${a.name}" ist noch auf ${open} offenen Einkaufsliste(n). Bitte zuerst dort entfernen oder die Listen abschließen.`);
    }
    db.run('UPDATE articles SET archived = ?, updated_at = ? WHERE id = ?', archived, new Date().toISOString(), a.id);
    audit(db, user, archived ? 'Artikel archiviert' : 'Artikel wiederhergestellt', 'article', a.id, { name: a.name });
    return { ok: true };
  });

  router.post('/api/articles/reorder', { perm: 'articles.manage' }, ({ db, user, body }) => {
    if (!Array.isArray(body.ids)) throw unprocessable('ids fehlt.');
    db.transaction(() => body.ids.forEach((id, i) => db.run('UPDATE articles SET sort_order = ? WHERE id = ?', (i + 1) * 10, Number(id))));
    audit(db, user, 'Artikelreihenfolge geändert', 'article', null, { anzahl: body.ids.length });
    return { ok: true };
  });

  router.delete('/api/articles/:id', { perm: 'articles.manage' }, ({ db, user, params }) => {
    const a = db.get('SELECT * FROM articles WHERE id = ?', params.id);
    if (!a) throw notFound('Artikel nicht gefunden.');
    const used = db.get('SELECT (SELECT COUNT(*) FROM purchase_items WHERE article_id = ?) + (SELECT COUNT(*) FROM stock_movements WHERE article_id = ?) AS n', a.id, a.id).n;
    if (used) throw conflict('Der Artikel hat eine Einkaufs- bzw. Bestandshistorie und kann nur archiviert werden.');
    db.run('DELETE FROM articles WHERE id = ?', a.id);
    audit(db, user, 'Artikel gelöscht', 'article', a.id, { nummer: a.article_no, name: a.name });
    return { ok: true };
  });

  // Manuelle Bestandskorrektur (z. B. Bruch, Inventur) durch Administratoren
  router.post('/api/articles/:id/correct-stock', { perm: 'articles.manage' }, ({ db, user, params, body }) => {
    const a = db.get('SELECT * FROM articles WHERE id = ?', params.id);
    if (!a) throw notFound('Artikel nicht gefunden.');
    const stock = v.num(body.stock, 'stock', { nullable: true, min: 0, max: 1e6, label: 'Bestand' });
    const note = v.str(body.note, 'note', { required: true, max: 300, label: 'Grund' });
    const t = new Date().toISOString();
    db.run("UPDATE articles SET current_stock = ?, stock_checked_at = CASE WHEN ? IS NULL THEN NULL ELSE ? END, stock_checked_by = ?, check_result = CASE WHEN ? IS NULL THEN NULL ELSE 'counted' END, updated_at = ? WHERE id = ?",
      stock, stock, t, user.id, stock, t, a.id);
    db.run("INSERT INTO stock_movements(article_id, at, user_id, type, qty_before, qty_after, delta, note) VALUES(?,?,?,'correction',?,?,?,?)",
      a.id, t, user.id, a.current_stock, stock, stock === null || a.current_stock === null ? null : round3(stock - a.current_stock), note);
    audit(db, user, 'Bestand korrigiert', 'article', a.id, { name: a.name, von: a.current_stock, nach: stock, grund: note });
    return loadArticle(db, a.id);
  });
};
