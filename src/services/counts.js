'use strict';
/**
 * Geführte Bestandszählung (Inventurbeleg) mit automatischem Bestellvorschlag.
 *
 * Ablauf wie in Inventursystemen:
 *  1. Zählbeleg anlegen (Umfang: Lagerorte/Kategorien/Lieferanten) → zugehörige Einkaufsliste (Entwurf)
 *  2. Artikel in Laufwegreihenfolge zählen: Ist-Menge erfassen → Bestand wird gebucht,
 *     Nachkaufmenge bis MAX wird automatisch auf die Einkaufsliste gesetzt
 *  3. Nicht gezählte/übersprungene Artikel bleiben "nicht kontrolliert" (nie Bestand 0)
 *  4. Zählung abschließen → Soll/Ist-Differenzen bleiben dokumentiert
 */
const { notFound, unprocessable, conflict } = require('../http/core');
const { loadArticles } = require('./articles');
const { round3 } = require('./stock');
const L = require('./lists');
const { audit } = require('./audit');

const now = () => new Date().toISOString();
const ids = (v) => (Array.isArray(v) ? v.map(Number).filter((n) => Number.isInteger(n) && n > 0) : []);

function createCount(db, user, opts = {}) {
  const department = opts.department || 'service';
  return db.transaction(() => {
    const loc = ids(opts.location_ids); const cat = ids(opts.category_ids); const sup = ids(opts.supplier_ids);
    let arts = loadArticles(db, { department, includeInactive: false });
    if (loc.length) arts = arts.filter((a) => loc.includes(a.location_id));
    if (cat.length) arts = arts.filter((a) => cat.includes(a.category_id));
    if (sup.length) arts = arts.filter((a) => sup.includes(a.supplier_id));
    if (opts.only_minmax) arts = arts.filter((a) => a.max_stock > 0);
    if (opts.only_due) arts = arts.filter((a) => !a.stock_fresh || a.current_stock === null || ['below', 'at_min'].includes(a.status));
    if (!arts.length) throw unprocessable('Für diese Auswahl gibt es keine aktiven Artikel.');
    arts.sort((a, b) => (a.location_sort ?? 9999) - (b.location_sort ?? 9999)
      || String(a.location_name || '').localeCompare(String(b.location_name || ''), 'de')
      || a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'de'));

    const d = new Date();
    const title = opts.title || `Einkauf ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
    const listId = L.createList(db, user, { department, title, note: opts.note || null });
    const n = db.nextNumber(`count_${department}`);
    const number = `INV-${String(n).padStart(5, '0')}`;
    const t = now();
    const id = Number(db.run('INSERT INTO stock_counts(number, department, list_id, status, scope, created_by, created_at) VALUES(?,?,?,\'open\',?,?,?)',
      number, department, listId, JSON.stringify({ location_ids: loc, category_ids: cat, supplier_ids: sup, only_minmax: !!opts.only_minmax, only_due: !!opts.only_due }), user.id, t).lastInsertRowid);
    arts.forEach((a, i) => db.run('INSERT INTO stock_count_items(count_id, article_id, seq, expected_qty) VALUES(?,?,?,?)', id, a.id, i + 1, a.current_stock));
    L.logEvent(db, listId, user, 'Bestandszählung gestartet', { zaehlung: number, artikel: arts.length });
    audit(db, user, 'Bestandszählung gestartet', 'count', id, { nummer: number, artikel: arts.length });
    return id;
  });
}

function getCountRow(db, id) {
  const c = db.get('SELECT * FROM stock_counts WHERE id = ?', id);
  if (!c) throw notFound('Bestandszählung nicht gefunden.');
  return c;
}

function loadCount(db, id) {
  const c = db.get(`SELECT sc.*, u.display_name AS created_by_name, cu.display_name AS completed_by_name,
      pl.number AS list_number, pl.status AS list_status, pl.title AS list_title
    FROM stock_counts sc LEFT JOIN users u ON u.id = sc.created_by LEFT JOIN users cu ON cu.id = sc.completed_by
    LEFT JOIN purchase_lists pl ON pl.id = sc.list_id WHERE sc.id = ?`, id);
  if (!c) throw notFound('Bestandszählung nicht gefunden.');
  const rows = db.all(`SELECT ci.*, u.display_name AS counted_by_name FROM stock_count_items ci
    LEFT JOIN users u ON u.id = ci.counted_by WHERE ci.count_id = ? ORDER BY ci.seq`, id);
  const arts = new Map(loadArticles(db, { department: c.department, includeArchived: true, ids: rows.map((r) => r.article_id), excludeListId: c.list_id }).map((a) => [a.id, a]));
  const listItems = new Map(c.list_id ? db.all('SELECT article_id, id, qty, source, note FROM purchase_items WHERE list_id = ?', c.list_id).map((p) => [p.article_id, p]) : []);
  const items = rows.map((r) => {
    const a = arts.get(r.article_id) || {};
    const pi = listItems.get(r.article_id) || null;
    return {
      id: r.id, seq: r.seq, article_id: r.article_id, expected_qty: r.expected_qty, counted_qty: r.counted_qty, counted_at: r.counted_at,
      counted_by_name: r.counted_by_name, skipped: !!r.skipped,
      state: r.counted_qty !== null ? 'counted' : r.skipped ? 'skipped' : 'open',
      difference: r.counted_qty !== null && r.expected_qty !== null ? round3(r.counted_qty - r.expected_qty) : null,
      name: a.name, article_no: a.article_no, pack_size: a.pack_size, unit_name: a.unit_name, unit_plural: a.unit_plural,
      location_name: a.location_name, category_name: a.category_name, supplier_name: a.supplier_name, manufacturer: a.manufacturer,
      min_stock: a.min_stock, max_stock: a.max_stock, order_step: a.order_step, min_order_qty: a.min_order_qty, price_net: a.price_net,
      current_stock: a.current_stock, has_image: a.has_image, unavailable_since: a.unavailable_since, active: a.active,
      recommended: a.recommended, on_order: a.on_order, open_lists: a.open_lists, status: a.status,
      order: pi ? { item_id: pi.id, qty: pi.qty, source: pi.source, note: pi.note } : null,
    };
  });
  const counted = items.filter((i) => i.state === 'counted');
  return {
    ...c,
    scope: c.scope ? JSON.parse(c.scope) : null,
    items,
    summary: {
      total: items.length,
      counted: counted.length,
      skipped: items.filter((i) => i.state === 'skipped').length,
      open: items.filter((i) => i.state === 'open').length,
      on_list: items.filter((i) => i.order).length,
      order_value: round3(items.reduce((s, i) => s + (i.order ? i.order.qty * (i.price_net || 0) : 0), 0)),
      with_difference: counted.filter((i) => i.difference !== null && Math.abs(i.difference) > 1e-9).length,
    },
  };
}

/**
 * Zählergebnis erfassen und Bestellvorschlag aktualisieren.
 * body: { counted_qty } | { skip: true } | { order_qty } | { note }
 */
function recordItem(db, user, can, countId, itemId, body = {}) {
  return db.transaction(() => {
    const c = getCountRow(db, countId);
    if (c.status !== 'open') throw conflict(`Die Zählung ${c.number} ist bereits abgeschlossen.`);
    const ci = db.get('SELECT * FROM stock_count_items WHERE id = ? AND count_id = ?', itemId, countId);
    if (!ci) throw notFound('Zählposition nicht gefunden.');
    const list = c.list_id ? db.get('SELECT * FROM purchase_lists WHERE id = ?', c.list_id) : null;
    const listEditable = list && ['draft', 'ready'].includes(list.status);
    const article = db.get('SELECT * FROM articles WHERE id = ?', ci.article_id);
    const t = now();
    const pi = () => (list ? db.get('SELECT * FROM purchase_items WHERE list_id = ? AND article_id = ?', list.id, article.id) : null);

    if (body.skip) {
      db.run('UPDATE stock_count_items SET skipped = 1 WHERE id = ?', ci.id);
    }

    if (body.counted_qty !== undefined && body.counted_qty !== null && body.counted_qty !== '') {
      const q = round3(Number(String(body.counted_qty).replace(',', '.')));
      if (!Number.isFinite(q) || q < 0 || q > 1e6) throw unprocessable('Bitte eine gültige gezählte Menge (≥ 0) eingeben.');
      db.run("UPDATE articles SET current_stock = ?, stock_checked_at = ?, stock_checked_by = ?, check_result = 'counted', updated_at = ? WHERE id = ?", q, t, user.id, t, article.id);
      db.run("INSERT INTO stock_movements(article_id, at, user_id, type, qty_before, qty_after, delta, note) VALUES(?,?,?,'count',?,?,?,?)",
        article.id, t, user.id, article.current_stock, q, article.current_stock === null ? null : round3(q - article.current_stock), `Zählung ${c.number}`);
      db.run('UPDATE stock_count_items SET counted_qty = ?, counted_at = ?, counted_by = ?, skipped = 0 WHERE id = ?', q, t, user.id, ci.id);

      // Automatischer Bestellvorschlag bis MAX (bereits bestellte Mengen anderer Listen werden berücksichtigt)
      if (listEditable && can('list.create') && article.active && !article.unavailable_since) {
        const ev = loadArticles(db, { department: c.department, ids: [article.id], excludeListId: list.id })[0];
        const existing = pi();
        if (ev.recommended > 0 && (!existing || existing.source === 'count')) {
          L.upsertItem(db, user, () => true, list.id, article.id, { qty: ev.recommended, mode: 'set', source: 'count' });
        } else if (ev.recommended === 0 && existing && existing.source === 'count') {
          L.removeItem(db, user, () => true, list.id, existing.id);
        }
      }
    }

    if (body.order_qty !== undefined) {
      if (!listEditable) throw conflict('Die zugehörige Einkaufsliste ist nicht mehr bearbeitbar.');
      if (!can('list.create')) throw unprocessable('Keine Berechtigung, Bestellmengen zu ändern.');
      const q = body.order_qty === null || body.order_qty === '' ? 0 : round3(Number(String(body.order_qty).replace(',', '.')));
      if (!Number.isFinite(q) || q < 0) throw unprocessable('Ungültige Bestellmenge.');
      const existing = pi();
      if (q > 0) {
        const r = L.upsertItem(db, user, can, list.id, article.id, { qty: q, mode: 'set', source: 'manual' });
        db.run("UPDATE purchase_items SET source = 'manual' WHERE id = ?", r.item_id);
      } else if (existing) {
        L.removeItem(db, user, can, list.id, existing.id);
      }
    }

    if (body.note !== undefined) {
      const existing = pi();
      const note = body.note ? String(body.note).slice(0, 300) : null;
      if (existing && listEditable) L.updateItem(db, user, can, list.id, existing.id, { note });
      else db.run('UPDATE articles SET check_note = ?, updated_at = ? WHERE id = ?', note, t, article.id);
    }

    const after = pi();
    db.run('UPDATE stock_count_items SET order_qty = ? WHERE id = ?', after ? after.qty : null, ci.id);
    return loadCount(db, countId);
  });
}

function completeCount(db, user, countId) {
  return db.transaction(() => {
    const c = getCountRow(db, countId);
    if (c.status !== 'open') throw conflict('Die Zählung ist bereits abgeschlossen.');
    db.run("UPDATE stock_counts SET status = 'completed', completed_at = ?, completed_by = ? WHERE id = ?", now(), user.id, countId);
    const res = loadCount(db, countId);
    if (c.list_id) L.logEvent(db, c.list_id, user, 'Bestandszählung abgeschlossen', { zaehlung: c.number, gezaehlt: res.summary.counted, positionen: res.summary.on_list });
    audit(db, user, 'Bestandszählung abgeschlossen', 'count', countId, { nummer: c.number, gezaehlt: res.summary.counted, uebersprungen: res.summary.skipped, offen: res.summary.open, differenzen: res.summary.with_difference });
    return res;
  });
}

function listCounts(db, department = 'service') {
  return db.all(`SELECT sc.id, sc.number, sc.status, sc.created_at, sc.completed_at, sc.list_id, pl.number AS list_number, pl.status AS list_status,
      u.display_name AS created_by_name,
      COUNT(ci.id) AS total, SUM(CASE WHEN ci.counted_qty IS NOT NULL THEN 1 ELSE 0 END) AS counted,
      SUM(CASE WHEN ci.order_qty > 0 THEN 1 ELSE 0 END) AS on_list,
      SUM(CASE WHEN ci.counted_qty IS NOT NULL AND ci.expected_qty IS NOT NULL AND ABS(ci.counted_qty - ci.expected_qty) > 1e-9 THEN 1 ELSE 0 END) AS differences
    FROM stock_counts sc LEFT JOIN stock_count_items ci ON ci.count_id = sc.id LEFT JOIN purchase_lists pl ON pl.id = sc.list_id
    LEFT JOIN users u ON u.id = sc.created_by WHERE sc.department = ? GROUP BY sc.id ORDER BY sc.id DESC LIMIT 200`, department);
}

module.exports = { createCount, loadCount, recordItem, completeCount, listCounts };
