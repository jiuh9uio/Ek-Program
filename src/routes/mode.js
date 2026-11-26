'use strict';
/** Schneller Einkaufsmodus (Schnellauswahl & Bestandskontrolle) – touchoptimierte Endpunkte. */
const { notFound, unprocessable } = require('../http/core');
const v = require('../http/validate');
const { loadArticles } = require('../services/articles');
const { allowedMaxQty, round3, stepOf } = require('../services/stock');
const L = require('../services/lists');
const { audit } = require('../services/audit');

function modeArticle(db, articleId, draftId) {
  const a = loadArticles(db, { includeInactive: false, ids: [articleId], excludeListId: draftId })[0];
  if (!a) return null;
  return decorate(db, a, draftId);
}

function decorate(db, a, draftId, itemsByArticle) {
  const item = itemsByArticle ? itemsByArticle.get(a.id) : (draftId ? db.get('SELECT id, qty, note, source FROM purchase_items WHERE list_id = ? AND article_id = ?', draftId, a.id) : null);
  const allowed = allowedMaxQty(a, a.on_order);
  return {
    id: a.id, article_no: a.article_no, name: a.name, category_id: a.category_id, category_name: a.category_name, category_sort: a.category_sort,
    supplier_id: a.supplier_id, supplier_name: a.supplier_name, location_id: a.location_id, location_name: a.location_name, location_sort: a.location_sort,
    pack_size: a.pack_size, unit_name: a.unit_name, unit_plural: a.unit_plural, manufacturer: a.manufacturer,
    min_stock: a.min_stock, max_stock: a.max_stock, current_stock: a.current_stock, order_step: a.order_step, min_order_qty: a.min_order_qty, step: stepOf(a), units_per_order: a.units_per_order, order_unit_name: a.order_unit_name, order_unit_plural: a.order_unit_plural,
    stock_checked_at: a.stock_checked_at, stock_checked_by_name: a.stock_checked_by_name, check_result: a.check_result, check_note: a.check_note,
    unavailable_since: a.unavailable_since, price_net: a.price_net, has_image: a.has_image, sort_order: a.sort_order,
    status: a.status,
    recommended: a.recommended, on_order: a.on_order, open_lists: a.open_lists, stock_fresh: a.stock_fresh,
    allowed_max: Number.isFinite(allowed) ? allowed : null,
    item: item ? { id: item.id, qty: item.qty, note: item.note, source: item.source } : null,
  };
}

module.exports = function register(router) {
  router.get('/api/mode', { perm: ['stock.count', 'list.create'] }, ({ db, query }) => {
    const department = query.department || 'service';
    const draft = L.activeDraft(db, department);
    const items = new Map();
    if (draft) db.all('SELECT id, article_id, qty, note, source FROM purchase_items WHERE list_id = ?', draft.id).forEach((i) => items.set(i.article_id, i));
    const arts = loadArticles(db, { department, includeInactive: false, excludeListId: draft ? draft.id : null });
    return {
      draft: draft ? { id: draft.id, number: draft.number, title: draft.title, positions: items.size, updated_at: draft.updated_at } : null,
      articles: arts.map((a) => decorate(db, a, draft && draft.id, items)),
      check_valid_days: Number(db.getSetting('check_valid_days', 7)),
    };
  });

  // Ist-Bestand erfassen; optional Bestellmenge automatisch übernehmen
  router.post('/api/mode/stock', { perm: 'stock.count' }, ({ db, user, body, can }) => {
    const articleId = v.id(body.article_id, 'article_id', { required: true });
    const stock = v.num(body.stock, 'stock', { nullable: true, min: 0, max: 1e6, label: 'Ist-Bestand' });
    const autoAdd = body.auto_add !== false;
    return db.transaction(() => {
      const a = db.get('SELECT * FROM articles WHERE id = ? AND archived = 0', articleId);
      if (!a) throw notFound('Artikel nicht gefunden.');
      const t = new Date().toISOString();
      if (stock === null) {
        // Eingabe gelöscht → wieder "nicht kontrolliert" (kein Bestand 0!)
        db.run('UPDATE articles SET current_stock = NULL, stock_checked_at = NULL, check_result = NULL, updated_at = ? WHERE id = ?', t, a.id);
      } else {
        db.run("UPDATE articles SET current_stock = ?, stock_checked_at = ?, stock_checked_by = ?, check_result = 'counted', updated_at = ? WHERE id = ?", stock, t, user.id, t, a.id);
      }
      // Zählungen kurz hintereinander (Plus/Minus) zu einer Bewegung zusammenfassen
      const last = db.get("SELECT * FROM stock_movements WHERE article_id = ? AND type = 'count' AND user_id = ? ORDER BY id DESC LIMIT 1", a.id, user.id);
      if (last && Date.now() - Date.parse(last.at) < 120e3) {
        db.run('UPDATE stock_movements SET qty_after = ?, delta = CASE WHEN qty_before IS NULL OR ? IS NULL THEN NULL ELSE ? - qty_before END, at = ? WHERE id = ?', stock, stock, stock, t, last.id);
      } else {
        db.run("INSERT INTO stock_movements(article_id, at, user_id, type, qty_before, qty_after, delta, note) VALUES(?,?,?,'count',?,?,?,'Bestandskontrolle')",
          a.id, t, user.id, a.current_stock, stock, stock === null || a.current_stock === null ? null : round3(stock - a.current_stock));
      }

      let draft = L.activeDraft(db);
      let info = null;
      if (autoAdd && can('list.create') && a.active && !a.unavailable_since) {
        const cur = modeArticle(db, a.id, draft && draft.id);
        const item = cur.item;
        if (cur.recommended > 0 && (!item || item.source === 'count')) {
          const listId = draft ? draft.id : L.ensureActiveDraft(db, user);
          info = L.upsertItem(db, user, () => true, listId, a.id, { qty: cur.recommended, mode: 'set', source: 'count' });
          if (!item) db.run("UPDATE purchase_items SET source = 'count' WHERE id = ?", info.item_id);
        } else if (cur.recommended === 0 && item && item.source === 'count') {
          L.removeItem(db, user, () => true, draft.id, item.id);
        }
        draft = L.activeDraft(db);
      }
      return { article: modeArticle(db, a.id, draft && draft.id), draft: draft ? { id: draft.id, number: draft.number } : null, info };
    });
  });

  // Artikel in Einkaufsliste aufnehmen / Menge setzen / entfernen
  router.post('/api/mode/item', { perm: 'list.create' }, ({ db, user, body, can }) => {
    const articleId = v.id(body.article_id, 'article_id', { required: true });
    const qty = v.num(body.qty, 'qty', { nullable: true, min: 0, max: 1e6, label: 'Bestellmenge' });
    return db.transaction(() => {
      let draft = L.activeDraft(db);
      let info = null;
      if (qty && qty > 0) {
        const listId = draft ? draft.id : L.ensureActiveDraft(db, user);
        info = L.upsertItem(db, user, can, listId, articleId, { qty, mode: 'set', source: body.source === 'count' ? 'count' : 'quick', note: body.note === undefined ? undefined : (body.note || null) });
        if (body.source !== 'count') db.run("UPDATE purchase_items SET source = 'quick' WHERE id = ?", info.item_id);
      } else if (draft) {
        const item = db.get('SELECT id FROM purchase_items WHERE list_id = ? AND article_id = ?', draft.id, articleId);
        if (item) L.removeItem(db, user, can, draft.id, item.id);
      }
      draft = L.activeDraft(db);
      return { article: modeArticle(db, articleId, draft && draft.id), draft: draft ? { id: draft.id, number: draft.number } : null, info };
    });
  });

  // "Bestand ausreichend"
  router.post('/api/mode/ok', { perm: 'stock.count' }, ({ db, user, body, can }) => {
    const articleId = v.id(body.article_id, 'article_id', { required: true });
    return db.transaction(() => {
      const a = db.get('SELECT * FROM articles WHERE id = ?', articleId);
      if (!a) throw notFound('Artikel nicht gefunden.');
      const t = new Date().toISOString();
      db.run("UPDATE articles SET check_result = 'ok', stock_checked_at = ?, stock_checked_by = ?, unavailable_since = NULL, updated_at = ? WHERE id = ?", t, user.id, t, a.id);
      db.run("INSERT INTO stock_movements(article_id, at, user_id, type, qty_before, qty_after, delta, note) VALUES(?,?,?,'count',?,?,NULL,'Bestand ausreichend')", a.id, t, user.id, a.current_stock, a.current_stock);
      const draft = L.activeDraft(db);
      if (draft && can('list.create')) {
        const item = db.get('SELECT id FROM purchase_items WHERE list_id = ? AND article_id = ?', draft.id, a.id);
        if (item) L.removeItem(db, user, can, draft.id, item.id);
      }
      return { article: modeArticle(db, a.id, draft && draft.id) };
    });
  });

  // "Nicht verfügbar" (z. B. beim Lieferanten nicht lieferbar) – umschaltbar
  router.post('/api/mode/unavailable', { perm: 'stock.count' }, ({ db, user, body, can }) => {
    const articleId = v.id(body.article_id, 'article_id', { required: true });
    const flag = body.unavailable !== false;
    return db.transaction(() => {
      const a = db.get('SELECT * FROM articles WHERE id = ?', articleId);
      if (!a) throw notFound('Artikel nicht gefunden.');
      const t = new Date().toISOString();
      const note = body.note === undefined ? a.check_note : v.optStr(body.note, 'note', { max: 300, label: 'Bemerkung' });
      db.run('UPDATE articles SET unavailable_since = ?, check_note = ?, updated_at = ? WHERE id = ?', flag ? t : null, note, t, a.id);
      audit(db, user, flag ? 'Artikel als nicht verfügbar markiert' : 'Artikel wieder verfügbar', 'article', a.id, { name: a.name, bemerkung: note || undefined });
      const draft = L.activeDraft(db);
      if (flag && draft && can('list.create')) {
        const item = db.get('SELECT id FROM purchase_items WHERE list_id = ? AND article_id = ?', draft.id, a.id);
        if (item) L.removeItem(db, user, can, draft.id, item.id);
      }
      return { article: modeArticle(db, a.id, draft && draft.id) };
    });
  });

  // Bemerkung: an der Listenposition (falls vorhanden), sonst am Artikel (Kontrollnotiz)
  router.post('/api/mode/note', { perm: ['stock.count', 'list.create'] }, ({ db, user, body, can }) => {
    const articleId = v.id(body.article_id, 'article_id', { required: true });
    const note = v.optStr(body.note, 'note', { max: 300, label: 'Bemerkung' });
    return db.transaction(() => {
      const a = db.get('SELECT id FROM articles WHERE id = ?', articleId);
      if (!a) throw notFound('Artikel nicht gefunden.');
      const draft = L.activeDraft(db);
      const item = draft ? db.get('SELECT id FROM purchase_items WHERE list_id = ? AND article_id = ?', draft.id, articleId) : null;
      if (item) {
        if (!can('list.create')) throw unprocessable('Keine Berechtigung für Listenbemerkungen.');
        L.updateItem(db, user, can, draft.id, item.id, { note });
      } else {
        db.run('UPDATE articles SET check_note = ?, updated_at = ? WHERE id = ?', note, new Date().toISOString(), articleId);
      }
      return { article: modeArticle(db, articleId, draft && draft.id) };
    });
  });
};
