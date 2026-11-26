'use strict';
/**
 * Einkaufslisten / Bestellungen: Positionen, Status-Workflow, Wareneingang.
 * Alle Mengenänderungen laufen in Transaktionen; doppelte Artikel pro Liste
 * sind per UNIQUE-Constraint ausgeschlossen und werden zusammengeführt.
 */
const { HttpError, notFound, unprocessable, conflict, forbidden } = require('../http/core');
const { evaluate, openQuantities, allowedMaxQty, round3, OPEN_LIST_STATUSES } = require('./stock');
const { audit } = require('./audit');

const STATUS_LABELS = {
  draft: 'Entwurf', ready: 'Einkaufsbereit', ordered: 'Bestellt', partial: 'Teilweise geliefert',
  delivered: 'Vollständig geliefert', closed: 'Abgeschlossen', cancelled: 'Storniert',
};
const EDITABLE = ['draft', 'ready'];
const now = () => new Date().toISOString();

function logEvent(db, listId, user, action, details) {
  db.run('INSERT INTO list_events(list_id, at, user_id, user_name, action, details) VALUES(?,?,?,?,?,?)',
    listId, now(), user ? user.id : null, user ? user.display_name : 'System', action, details ? JSON.stringify(details) : null);
}

function touch(db, listId) {
  db.run('UPDATE purchase_lists SET updated_at = ?, version = version + 1 WHERE id = ?', now(), listId);
}

function getListRow(db, id) {
  const l = db.get('SELECT * FROM purchase_lists WHERE id = ?', id);
  if (!l) throw notFound('Einkaufsliste nicht gefunden.');
  return l;
}

function createList(db, user, { title = null, note = null, department = 'service' } = {}) {
  return db.transaction(() => {
    const n = db.nextNumber(`list_${department}`);
    const prefix = department === 'service' ? 'EK' : department.toUpperCase().slice(0, 2);
    const number = `${prefix}-${String(n).padStart(5, '0')}`;
    const t = now();
    const id = Number(db.run(`INSERT INTO purchase_lists(number, department, title, status, note, created_by, created_at, updated_at)
      VALUES(?,?,?,'draft',?,?,?,?)`, number, department, title, note, user.id, t, t).lastInsertRowid);
    logEvent(db, id, user, 'Erstellt', { number });
    audit(db, user, 'Einkaufsliste erstellt', 'list', id, { number });
    return id;
  });
}

/** Aktuelle gemeinsame Entwurfsliste des Bereichs (für den Einkaufsmodus). */
function activeDraft(db, department = 'service') {
  return db.get("SELECT * FROM purchase_lists WHERE department = ? AND status = 'draft' ORDER BY updated_at DESC, id DESC LIMIT 1", department) || null;
}

function ensureActiveDraft(db, user, department = 'service') {
  const d = activeDraft(db, department);
  if (d) return d.id;
  return createList(db, user, { department, title: 'Service-Einkauf' });
}

function assertEditable(list, ctxCan) {
  if (EDITABLE.includes(list.status)) return;
  if (['ordered', 'partial'].includes(list.status) && ctxCan('orders.approve')) return;
  throw conflict(`Die Liste ${list.number} ist im Status "${STATUS_LABELS[list.status]}" und kann nicht mehr bearbeitet werden.`);
}

function checkQtyAllowed(db, list, article, qty, can) {
  if (can('list.exceed_max')) return;
  const onOrder = openQuantities(db, { department: list.department, excludeListId: list.id, articleId: article.id }).get(article.id);
  const allowed = allowedMaxQty(article, onOrder ? onOrder.qty : 0);
  if (qty > allowed + 1e-9) {
    throw unprocessable(
      `Die Menge ${fmt(qty)} überschreitet den Maximalbestand von "${article.name}". Erlaubt sind höchstens ${fmt(allowed)}. Für größere Mengen ist ein Administrator erforderlich.`,
      { allowed, code: 'EXCEEDS_MAX' });
  }
}

const fmt = (n) => String(round3(n)).replace('.', ',');

/**
 * Artikel zur Liste hinzufügen oder Menge setzen.
 * mode 'set' = Menge ersetzen (Einkaufsmodus), 'add' = addieren (Zusammenführen).
 */
function upsertItem(db, user, can, listId, articleId, { qty, mode = 'set', note, source = 'manual', supplier_id } = {}) {
  return db.transaction(() => {
    const list = getListRow(db, listId);
    assertEditable(list, can);
    const article = db.get('SELECT * FROM articles WHERE id = ? AND department = ?', articleId, list.department);
    if (!article) throw notFound('Artikel nicht gefunden.');
    if (article.archived || !article.active) throw unprocessable(`"${article.name}" ist inaktiv oder archiviert und kann nicht bestellt werden.`);
    if (!(qty > 0)) throw unprocessable('Die Bestellmenge muss größer als 0 sein.');

    const existing = db.get('SELECT * FROM purchase_items WHERE list_id = ? AND article_id = ?', listId, articleId);
    const newQty = round3(mode === 'add' && existing ? existing.qty + qty : qty);
    checkQtyAllowed(db, list, article, newQty, can);
    const t = now();
    let itemId;
    if (existing) {
      db.run(`UPDATE purchase_items SET qty = ?, note = COALESCE(?, note), supplier_id = COALESCE(?, supplier_id), updated_at = ? WHERE id = ?`,
        newQty, note === undefined ? null : note, supplier_id || null, t, existing.id);
      itemId = existing.id;
      if (existing.qty !== newQty) logEvent(db, listId, user, mode === 'add' ? 'Position zusammengeführt' : 'Menge geändert', { artikel: article.name, von: existing.qty, nach: newQty });
    } else {
      itemId = Number(db.run(`INSERT INTO purchase_items(list_id, article_id, qty, unit_price_est, supplier_id, note, source, added_by, created_at, updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)`, listId, articleId, newQty, article.price_net, supplier_id || article.supplier_id, note || null, source, user.id, t, t).lastInsertRowid);
      logEvent(db, listId, user, 'Position hinzugefügt', { artikel: article.name, menge: newQty });
    }
    touch(db, listId);
    // Warnung: Artikel steht bereits auf einer anderen offenen Liste
    const others = openQuantities(db, { department: list.department, excludeListId: listId, articleId }).get(articleId);
    return { item_id: itemId, qty: newQty, merged: !!existing && mode === 'add', other_open: others ? others.lists : [] };
  });
}

function updateItem(db, user, can, listId, itemId, body) {
  return db.transaction(() => {
    const list = getListRow(db, listId);
    const item = db.get('SELECT pi.*, a.name AS article_name FROM purchase_items pi JOIN articles a ON a.id = pi.article_id WHERE pi.id = ? AND pi.list_id = ?', itemId, listId);
    if (!item) throw notFound('Position nicht gefunden.');
    const changes = {};
    // "Eingekauft"-Haken und Bemerkung dürfen auch in bestellten Listen gesetzt werden
    const lightOnly = Object.keys(body).every((k) => ['purchased', 'note'].includes(k));
    if (!lightOnly) assertEditable(list, can);
    else if (['closed', 'cancelled'].includes(list.status)) throw conflict('Die Liste ist abgeschlossen bzw. storniert.');

    if (body.qty !== undefined) {
      const qty = round3(Number(body.qty));
      if (!(qty > 0)) throw unprocessable('Die Bestellmenge muss größer als 0 sein.');
      const article = db.get('SELECT * FROM articles WHERE id = ?', item.article_id);
      checkQtyAllowed(db, list, article, qty, can);
      if (qty !== item.qty) { changes.qty = { von: item.qty, nach: qty }; db.run('UPDATE purchase_items SET qty = ? WHERE id = ?', qty, itemId); }
    }
    if (body.note !== undefined) {
      const note = body.note ? String(body.note).slice(0, 500) : null;
      if ((note || null) !== (item.note || null)) { changes.bemerkung = { von: item.note, nach: note }; db.run('UPDATE purchase_items SET note = ? WHERE id = ?', note, itemId); }
    }
    if (body.purchased !== undefined) {
      const p = body.purchased ? 1 : 0;
      if (p !== item.purchased) { changes.eingekauft = p ? 'ja' : 'nein'; db.run('UPDATE purchase_items SET purchased = ? WHERE id = ?', p, itemId); }
    }
    if (body.supplier_id !== undefined) {
      const sid = body.supplier_id ? Number(body.supplier_id) : null;
      if (sid && !db.get('SELECT id FROM suppliers WHERE id = ?', sid)) throw unprocessable('Lieferant nicht gefunden.');
      if (sid !== item.supplier_id) { changes.lieferant = { von: item.supplier_id, nach: sid }; db.run('UPDATE purchase_items SET supplier_id = ? WHERE id = ?', sid, itemId); }
    }
    if (body.unit_price_est !== undefined) {
      if (!can('prices.manage')) throw forbidden('Nur berechtigte Benutzer dürfen Einkaufspreise ändern.');
      const p = Number(body.unit_price_est);
      if (!(p >= 0)) throw unprocessable('Ungültiger Preis.');
      if (p !== item.unit_price_est) { changes.preis = { von: item.unit_price_est, nach: p }; db.run('UPDATE purchase_items SET unit_price_est = ? WHERE id = ?', round3(p), itemId); }
    }
    if (Object.keys(changes).length) {
      db.run('UPDATE purchase_items SET updated_at = ? WHERE id = ?', now(), itemId);
      logEvent(db, listId, user, 'Position geändert', { artikel: item.article_name, ...changes });
      touch(db, listId);
    }
    return { ok: true };
  });
}

function removeItem(db, user, can, listId, itemId) {
  return db.transaction(() => {
    const list = getListRow(db, listId);
    assertEditable(list, can);
    const item = db.get('SELECT pi.*, a.name AS article_name FROM purchase_items pi JOIN articles a ON a.id = pi.article_id WHERE pi.id = ? AND pi.list_id = ?', itemId, listId);
    if (!item) throw notFound('Position nicht gefunden.');
    if (item.qty_received > 0) throw conflict('Für diese Position wurde bereits Ware gebucht – Entfernen nicht möglich.');
    db.run('DELETE FROM purchase_items WHERE id = ?', itemId);
    logEvent(db, listId, user, 'Position entfernt', { artikel: item.article_name, menge: item.qty });
    touch(db, listId);
    return { ok: true };
  });
}

/** Liste inkl. Positionen, Summen und Lieferantengruppen. */
function loadList(db, id) {
  const list = db.get(`SELECT pl.*, u.display_name AS created_by_name, ap.display_name AS approved_by_name, cb.display_name AS closed_by_name
    FROM purchase_lists pl LEFT JOIN users u ON u.id = pl.created_by LEFT JOIN users ap ON ap.id = pl.approved_by
    LEFT JOIN users cb ON cb.id = pl.closed_by WHERE pl.id = ?`, id);
  if (!list) throw notFound('Einkaufsliste nicht gefunden.');
  const items = db.all(`
    SELECT pi.*, a.name AS article_name, a.article_no, a.pack_size, a.current_stock, a.min_stock, a.max_stock,
           a.order_step, a.min_order_qty, a.stock_checked_at, a.check_result, a.price_net, a.active AS article_active,
           u.name AS unit_name, u.plural AS unit_plural, a.units_per_order, ou.name AS order_unit_name, ou.plural AS order_unit_plural, c.name AS category_name, c.sort_order AS category_sort,
           l.name AS location_name, l.sort_order AS location_sort, s.name AS supplier_name,
           s.min_order_value, s.shipping_cost, ab.display_name AS added_by_name
    FROM purchase_items pi
    JOIN articles a ON a.id = pi.article_id
    LEFT JOIN units u ON u.id = a.unit_id
    LEFT JOIN units ou ON ou.id = a.order_unit_id
    LEFT JOIN categories c ON c.id = a.category_id
    LEFT JOIN locations l ON l.id = a.location_id
    LEFT JOIN suppliers s ON s.id = pi.supplier_id
    LEFT JOIN users ab ON ab.id = pi.added_by
    WHERE pi.list_id = ?
    ORDER BY COALESCE(c.sort_order, 9999), a.name COLLATE NOCASE`, id);

  const groups = new Map();
  let estTotal = 0;
  let actualTotal = 0;
  let hasActual = false;
  for (const it of items) {
    it.est_total = round3(it.qty * it.unit_price_est);
    it.open_qty = round3(Math.max(0, it.qty - it.qty_received));
    if (it.qty_received > 0) { hasActual = true; actualTotal += it.qty_received * (it.unit_price_actual ?? it.unit_price_est); }
    estTotal += it.est_total;
    const key = it.supplier_id || 0;
    if (!groups.has(key)) groups.set(key, { supplier_id: it.supplier_id, supplier_name: it.supplier_name || 'Ohne Lieferant', min_order_value: it.min_order_value || 0, shipping_cost: it.shipping_cost || 0, items: 0, est_total: 0 });
    const g = groups.get(key);
    g.items++; g.est_total = round3(g.est_total + it.est_total);
  }
  const supplierGroups = [...groups.values()].map((g) => ({
    ...g,
    below_min_order: g.supplier_id && g.min_order_value > 0 && g.est_total < g.min_order_value,
    missing_to_min: g.min_order_value > 0 ? round3(Math.max(0, g.min_order_value - g.est_total)) : 0,
  })).sort((a, b) => a.supplier_name.localeCompare(b.supplier_name, 'de'));
  const shipping = supplierGroups.reduce((s, g) => s + (g.supplier_id ? g.shipping_cost : 0), 0);

  const events = db.all('SELECT * FROM list_events WHERE list_id = ? ORDER BY id DESC', id)
    .map((e) => ({ ...e, details: e.details ? JSON.parse(e.details) : null }));
  const prints = db.all('SELECT id, printer_id, printer_name, kind, title, status, error, user_name, at FROM print_jobs WHERE list_id = ? ORDER BY id DESC', id);

  return {
    ...list,
    status_label: STATUS_LABELS[list.status],
    items,
    supplier_groups: supplierGroups,
    totals: {
      positions: items.length,
      est_goods: round3(estTotal),
      shipping: round3(shipping),
      est_total: round3(estTotal + shipping),
      actual_goods: hasActual ? round3(actualTotal) : null,
      actual_cost: list.actual_cost,
      purchased: items.filter((i) => i.purchased).length,
    },
    events,
    prints,
    count: db.get('SELECT id, number, status FROM stock_counts WHERE list_id = ? ORDER BY id DESC LIMIT 1', id) || null,
  };
}

function receiptStatus(db, listId) {
  const r = db.get('SELECT COUNT(*) AS n, SUM(CASE WHEN qty_received >= qty - 1e-9 THEN 1 ELSE 0 END) AS full, SUM(CASE WHEN qty_received > 0 THEN 1 ELSE 0 END) AS any FROM purchase_items WHERE list_id = ?', listId);
  if (!r.n) return null;
  if (r.full === r.n) return 'delivered';
  if (r.any > 0) return 'partial';
  return null;
}

/** Status-Workflow mit Rechteprüfung. */
function changeStatus(db, user, can, listId, target, { note, actual_cost } = {}) {
  return db.transaction(() => {
    const list = getListRow(db, listId);
    const from = list.status;
    const count = db.get('SELECT COUNT(*) AS n FROM purchase_items WHERE list_id = ?', listId).n;
    const t = now();
    const warnings = [];
    const need = (perm) => { if (!can(perm)) throw forbidden(); };
    const bad = () => { throw conflict(`Statuswechsel von "${STATUS_LABELS[from]}" nach "${STATUS_LABELS[target] || target}" ist nicht möglich.`); };

    switch (target) {
      case 'ready':
        if (from !== 'draft') bad();
        need('list.create');
        if (!count) throw unprocessable('Die Liste enthält keine Positionen.');
        db.run('UPDATE purchase_lists SET status = ?, ready_at = ? WHERE id = ?', 'ready', t, listId);
        break;
      case 'draft':
        if (from === 'ready') need('list.create');
        else if (from === 'cancelled') need('orders.approve');
        else bad();
        db.run("UPDATE purchase_lists SET status = 'draft', cancelled_at = NULL WHERE id = ?", listId);
        break;
      case 'ordered':
        if (!['draft', 'ready'].includes(from)) bad();
        need('orders.approve');
        if (!count) throw unprocessable('Die Liste enthält keine Positionen.');
        db.run('UPDATE purchase_lists SET status = ?, ordered_at = ?, approved_by = ?, ready_at = COALESCE(ready_at, ?) WHERE id = ?', 'ordered', t, user.id, t, listId);
        for (const g of loadList(db, listId).supplier_groups) {
          if (g.below_min_order) warnings.push(`Mindestbestellwert bei ${g.supplier_name} nicht erreicht (${g.est_total.toFixed(2)} € von ${g.min_order_value.toFixed(2)} €).`);
        }
        break;
      case 'closed': {
        if (!['ordered', 'partial', 'delivered', 'ready'].includes(from)) bad();
        need('orders.approve');
        const open = db.get('SELECT COUNT(*) AS n FROM purchase_items WHERE list_id = ? AND qty_received < qty - 1e-9', listId).n;
        if (open) warnings.push(`${open} Position(en) wurden nicht vollständig geliefert und gelten nicht mehr als offen.`);
        let ac = null;
        if (actual_cost !== undefined && actual_cost !== null && actual_cost !== '') {
          ac = Number(String(actual_cost).replace(',', '.'));
          if (!(ac >= 0)) throw unprocessable('Ungültige tatsächliche Kosten.');
        }
        db.run('UPDATE purchase_lists SET status = ?, closed_at = ?, closed_by = ?, actual_cost = COALESCE(?, actual_cost) WHERE id = ?', 'closed', t, user.id, ac, listId);
        break;
      }
      case 'reopen': {
        if (from !== 'closed') bad();
        need('orders.approve');
        const rs = receiptStatus(db, listId);
        const back = rs || (list.ordered_at ? 'ordered' : 'ready');
        db.run('UPDATE purchase_lists SET status = ?, closed_at = NULL, closed_by = NULL WHERE id = ?', back, listId);
        target = back;
        break;
      }
      case 'cancelled': {
        if (['closed', 'cancelled', 'delivered'].includes(from)) bad();
        if (['ordered', 'partial'].includes(from)) need('orders.approve'); else need('list.create');
        const rec = db.get('SELECT COUNT(*) AS n FROM purchase_items WHERE list_id = ? AND qty_received > 0', listId).n;
        if (rec) throw conflict('Es wurde bereits Ware gebucht. Die Liste kann nur noch abgeschlossen werden.');
        db.run('UPDATE purchase_lists SET status = ?, cancelled_at = ? WHERE id = ?', 'cancelled', t, listId);
        break;
      }
      default:
        throw unprocessable('Unbekannter Status.');
    }
    logEvent(db, listId, user, `Status: ${STATUS_LABELS[from]} → ${STATUS_LABELS[target]}`, note ? { bemerkung: note } : null);
    audit(db, user, 'Status Einkaufsliste geändert', 'list', listId, { nummer: list.number, von: from, nach: target });
    touch(db, listId);
    return { status: target, warnings };
  });
}

/**
 * Wareneingang: gelieferte Mengen erfassen und dem Bestand zubuchen.
 * entries: [{ item_id, qty (zusätzlich gelieferte Menge, darf zur Korrektur negativ sein), unit_price_actual, update_price }]
 */
function receive(db, user, can, listId, entries, { note } = {}) {
  return db.transaction(() => {
    const list = getListRow(db, listId);
    if (!['ready', 'ordered', 'partial', 'delivered'].includes(list.status)) {
      throw conflict(`Wareneingang ist im Status "${STATUS_LABELS[list.status]}" nicht möglich.`);
    }
    if (!Array.isArray(entries) || !entries.length) throw unprocessable('Keine Mengen angegeben.');
    const t = now();
    const booked = [];
    for (const e of entries) {
      const item = db.get('SELECT * FROM purchase_items WHERE id = ? AND list_id = ?', Number(e.item_id), listId);
      if (!item) throw notFound('Position nicht gefunden.');
      const delta = round3(Number(String(e.qty ?? 0).replace(',', '.')));
      if (!Number.isFinite(delta)) throw unprocessable('Ungültige Liefermenge.');
      let price = e.unit_price_actual;
      if (price !== undefined && price !== null && price !== '') {
        price = Number(String(price).replace(',', '.'));
        if (!(price >= 0)) throw unprocessable('Ungültiger Einkaufspreis.');
        price = round3(price);
      } else price = null;
      if (delta === 0 && price === null) continue;
      const newReceived = round3(item.qty_received + delta);
      if (newReceived < 0) throw unprocessable('Die gelieferte Menge kann nicht negativ werden.');
      const article = db.get('SELECT * FROM articles WHERE id = ?', item.article_id);

      db.run('UPDATE purchase_items SET qty_received = ?, unit_price_actual = COALESCE(?, unit_price_actual), purchased = CASE WHEN ? > 0 THEN 1 ELSE purchased END, updated_at = ? WHERE id = ?',
        newReceived, price, newReceived, t, item.id);

      if (delta !== 0) {
        // Unbekannter Bestand bleibt unbekannt (keine Annahme "0"), Bewegung wird trotzdem protokolliert.
        const before = article.current_stock;
        const after = before === null ? null : round3(Math.max(0, before + delta));
        db.run('UPDATE articles SET current_stock = ?, updated_at = ? WHERE id = ?', after, t, article.id);
        db.run(`INSERT INTO stock_movements(article_id, at, user_id, type, qty_before, qty_after, delta, unit_price, supplier_id, list_id, note)
          VALUES(?,?,?,?,?,?,?,?,?,?,?)`, article.id, t, user.id, 'receipt', before, after, delta,
        price ?? item.unit_price_actual ?? item.unit_price_est, item.supplier_id, listId, note || null);
      }
      if (price !== null && e.update_price && can('prices.manage') && price !== article.price_net) {
        db.run('UPDATE articles SET price_net = ?, updated_at = ? WHERE id = ?', price, t, article.id);
        audit(db, user, 'Einkaufspreis aus Wareneingang übernommen', 'article', article.id, { von: article.price_net, nach: price });
      }
      booked.push({ artikel: article.name, menge: delta, preis: price });
    }
    if (!booked.length) throw unprocessable('Keine Änderungen zum Buchen.');
    const rs = receiptStatus(db, listId);
    let status = list.status;
    if (rs === 'delivered') status = 'delivered';
    else if (rs === 'partial') status = 'partial';
    else status = list.ordered_at ? 'ordered' : list.status;
    db.run('UPDATE purchase_lists SET status = ?, ordered_at = COALESCE(ordered_at, ?), delivered_at = CASE WHEN ? = \'delivered\' THEN ? ELSE delivered_at END WHERE id = ?',
      status, t, status, t, listId);
    logEvent(db, listId, user, 'Wareneingang gebucht', { positionen: booked, bemerkung: note || undefined });
    audit(db, user, 'Wareneingang gebucht', 'list', listId, { nummer: list.number, positionen: booked.length });
    touch(db, listId);
    return { status, booked: booked.length };
  });
}

/** Führt eine andere offene Liste in diese Liste zusammen (Mengen werden addiert). */
function mergeLists(db, user, can, targetId, sourceId) {
  return db.transaction(() => {
    if (Number(targetId) === Number(sourceId)) throw unprocessable('Eine Liste kann nicht mit sich selbst zusammengeführt werden.');
    const target = getListRow(db, targetId);
    const source = getListRow(db, sourceId);
    assertEditable(target, can);
    if (!EDITABLE.includes(source.status)) throw conflict(`Liste ${source.number} ist nicht mehr offen.`);
    if (target.department !== source.department) throw unprocessable('Listen verschiedener Bereiche können nicht zusammengeführt werden.');
    const items = db.all('SELECT * FROM purchase_items WHERE list_id = ?', sourceId);
    const t = now();
    for (const it of items) {
      const ex = db.get('SELECT * FROM purchase_items WHERE list_id = ? AND article_id = ?', targetId, it.article_id);
      if (ex) {
        const notes = [ex.note, it.note].filter(Boolean).join(' / ') || null;
        db.run('UPDATE purchase_items SET qty = ?, note = ?, updated_at = ? WHERE id = ?', round3(ex.qty + it.qty), notes, t, ex.id);
        db.run('DELETE FROM purchase_items WHERE id = ?', it.id);
      } else {
        db.run('UPDATE purchase_items SET list_id = ?, updated_at = ? WHERE id = ?', targetId, t, it.id);
      }
    }
    db.run("UPDATE purchase_lists SET status = 'cancelled', cancelled_at = ?, note = TRIM(COALESCE(note, '') || ' [zusammengeführt in ' || ? || ']') WHERE id = ?", t, target.number, sourceId);
    logEvent(db, targetId, user, 'Liste zusammengeführt', { aus: source.number, positionen: items.length });
    logEvent(db, sourceId, user, 'In andere Liste zusammengeführt', { nach: target.number });
    audit(db, user, 'Einkaufslisten zusammengeführt', 'list', targetId, { aus: source.number, nach: target.number });
    touch(db, targetId); touch(db, sourceId);
    return { ok: true, merged: items.length };
  });
}

/** Übernimmt alle aktuellen Bestellempfehlungen in die Liste (ohne Doppelbestellungen). */
function addRecommendations(db, user, can, listId) {
  return db.transaction(() => {
    const list = getListRow(db, listId);
    assertEditable(list, can);
    const { loadArticles } = require('./articles');
    const arts = loadArticles(db, { department: list.department, includeInactive: false, excludeListId: listId })
      .filter((a) => a.recommended > 0 && !a.unavailable_since);
    let added = 0;
    for (const a of arts) {
      const ex = db.get('SELECT id FROM purchase_items WHERE list_id = ? AND article_id = ?', listId, a.id);
      if (ex) continue;
      upsertItem(db, user, () => true, listId, a.id, { qty: a.recommended, source: 'auto' });
      added++;
    }
    return { added };
  });
}

module.exports = {
  STATUS_LABELS, OPEN_LIST_STATUSES, createList, activeDraft, ensureActiveDraft, upsertItem, updateItem, removeItem,
  loadList, changeStatus, receive, mergeLists, addRecommendations, logEvent, evaluate,
};
