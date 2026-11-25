'use strict';
const { notFound, unprocessable, RawResponse } = require('../http/core');
const v = require('../http/validate');
const L = require('../services/lists');
const P = require('../services/printing');
const { listPdf } = require('../print/pdf');
const { audit } = require('../services/audit');

module.exports = function register(router) {
  router.get('/api/lists', {}, ({ db, query }) => {
    const where = ['pl.department = ?'];
    const params = [query.department || 'service'];
    if (query.status && query.status !== 'all') {
      const st = String(query.status).split(',').filter((s) => L.STATUS_LABELS[s]);
      if (st.length) { where.push(`pl.status IN (${st.map(() => '?').join(',')})`); params.push(...st); }
    }
    if (query.q) {
      where.push(`(pl.number LIKE ? OR pl.title LIKE ? OR EXISTS (SELECT 1 FROM purchase_items x JOIN articles a ON a.id = x.article_id WHERE x.list_id = pl.id AND a.name LIKE ?))`);
      const q = `%${query.q}%`; params.push(q, q, q);
    }
    if (query.from) { where.push('pl.created_at >= ?'); params.push(query.from); }
    if (query.to) { where.push('pl.created_at <= ?'); params.push(query.to + 'T23:59:59'); }
    const limit = Math.min(500, Number(query.limit) || 200);
    return db.all(`SELECT pl.*, u.display_name AS created_by_name,
        COUNT(pi.id) AS positions,
        COALESCE(SUM(pi.qty * pi.unit_price_est), 0) AS est_total,
        SUM(CASE WHEN pi.qty_received > 0 THEN pi.qty_received * COALESCE(pi.unit_price_actual, pi.unit_price_est) ELSE 0 END) AS actual_goods,
        GROUP_CONCAT(DISTINCT s.name) AS suppliers,
        (SELECT COUNT(*) FROM print_jobs pj WHERE pj.list_id = pl.id AND pj.status = 'ok') AS print_count
      FROM purchase_lists pl LEFT JOIN users u ON u.id = pl.created_by
      LEFT JOIN purchase_items pi ON pi.list_id = pl.id LEFT JOIN suppliers s ON s.id = pi.supplier_id
      WHERE ${where.join(' AND ')} GROUP BY pl.id ORDER BY pl.id DESC LIMIT ${limit}`, ...params)
      .map((l) => ({ ...l, status_label: L.STATUS_LABELS[l.status] }));
  });

  router.post('/api/lists', { perm: 'list.create' }, ({ db, user, body }) => {
    const id = L.createList(db, user, {
      title: v.optStr(body.title, 'title', { max: 120, label: 'Bezeichnung' }),
      note: v.optStr(body.note, 'note', { max: 1000, label: 'Hinweis' }),
    });
    if (body.with_recommendations) L.addRecommendations(db, user, () => true, id);
    return L.loadList(db, id);
  });

  router.get('/api/lists/:id', {}, ({ db, params }) => L.loadList(db, Number(params.id)));

  // Kopfdaten (Bezeichnung, Hinweis) – "Zwischenspeichern"
  router.put('/api/lists/:id', { perm: 'list.create' }, ({ db, user, body, params }) => {
    const id = Number(params.id);
    const l = db.get('SELECT * FROM purchase_lists WHERE id = ?', id);
    if (!l) throw notFound('Einkaufsliste nicht gefunden.');
    if (['closed', 'cancelled'].includes(l.status)) throw unprocessable('Abgeschlossene/stornierte Listen können nicht geändert werden.');
    const title = v.optStr(body.title, 'title', { max: 120, label: 'Bezeichnung' });
    const note = v.optStr(body.note, 'note', { max: 1000, label: 'Hinweis' });
    if (body.version !== undefined && Number(body.version) !== l.version) {
      // Hinweis bei gleichzeitiger Bearbeitung – Kopfdaten werden trotzdem gespeichert
    }
    db.run('UPDATE purchase_lists SET title = ?, note = ?, updated_at = ?, version = version + 1 WHERE id = ?', title, note, new Date().toISOString(), id);
    if (title !== l.title || note !== l.note) L.logEvent(db, id, user, 'Kopfdaten gespeichert', { bezeichnung: title, hinweis: note });
    return L.loadList(db, id);
  });

  router.post('/api/lists/:id/items', { perm: 'list.create' }, ({ db, user, body, params, can }) => {
    const id = Number(params.id);
    const articleId = v.id(body.article_id, 'article_id', { required: true, label: 'Artikel' });
    const qty = v.num(body.qty, 'qty', { required: true, min: 0.001, max: 1e6, label: 'Menge' });
    const r = L.upsertItem(db, user, can, id, articleId, { qty, mode: 'add', note: v.optStr(body.note, 'note', { max: 500 }) || undefined, source: 'manual' });
    return { ...r, list: L.loadList(db, id) };
  });

  router.post('/api/lists/:id/recommendations', { perm: 'list.create' }, ({ db, user, params, can }) => {
    const id = Number(params.id);
    const r = L.addRecommendations(db, user, can, id);
    return { ...r, list: L.loadList(db, id) };
  });

  router.put('/api/lists/:id/items/:itemId', { perm: ['list.create', 'print'] }, ({ db, user, body, params, can }) => {
    const id = Number(params.id);
    const allowed = {};
    for (const k of ['qty', 'note', 'purchased', 'supplier_id', 'unit_price_est']) if (body[k] !== undefined) allowed[k] = body[k];
    if (!can('list.create')) for (const k of Object.keys(allowed)) if (k !== 'purchased') delete allowed[k];
    L.updateItem(db, user, can, id, Number(params.itemId), allowed);
    return L.loadList(db, id);
  });

  router.delete('/api/lists/:id/items/:itemId', { perm: 'list.create' }, ({ db, user, params, can }) => {
    const id = Number(params.id);
    L.removeItem(db, user, can, id, Number(params.itemId));
    return L.loadList(db, id);
  });

  router.post('/api/lists/:id/status', { perm: ['list.create', 'orders.approve'] }, ({ db, user, body, params, can }) => {
    const id = Number(params.id);
    const r = L.changeStatus(db, user, can, id, String(body.status || ''), { note: body.note, actual_cost: body.actual_cost });
    return { ...r, list: L.loadList(db, id) };
  });

  router.post('/api/lists/:id/receive', { perm: 'goods.receive' }, ({ db, user, body, params, can }) => {
    const id = Number(params.id);
    const r = L.receive(db, user, can, id, body.entries, { note: v.optStr(body.note, 'note', { max: 500 }) });
    return { ...r, list: L.loadList(db, id) };
  });

  router.post('/api/lists/:id/merge', { perm: 'list.create' }, ({ db, user, body, params, can }) => {
    const id = Number(params.id);
    const r = L.mergeLists(db, user, can, id, v.id(body.source_id, 'source_id', { required: true, label: 'Quellliste' }));
    return { ...r, list: L.loadList(db, id) };
  });

  // Als aktive Entwurfsliste für den Einkaufsmodus setzen
  router.post('/api/lists/:id/activate', { perm: 'list.create' }, ({ db, user, params }) => {
    const l = db.get('SELECT * FROM purchase_lists WHERE id = ?', params.id);
    if (!l) throw notFound('Einkaufsliste nicht gefunden.');
    if (l.status !== 'draft') throw unprocessable('Nur Entwürfe können im Einkaufsmodus bearbeitet werden.');
    db.run('UPDATE purchase_lists SET updated_at = ? WHERE id = ?', new Date().toISOString(), l.id);
    L.logEvent(db, l.id, user, 'Für Einkaufsmodus aktiviert');
    return { ok: true };
  });

  router.get('/api/lists/:id/pdf', { perm: 'print' }, ({ db, user, params, query }) => {
    const list = L.loadList(db, Number(params.id));
    const buf = listPdf(list, {
      company: db.getSetting('company_name', ''), groupBy: query.group || 'supplier', userName: user.display_name,
      showPrices: query.prices !== '0',
    });
    L.logEvent(db, list.id, user, 'PDF exportiert');
    return new RawResponse(buf, 'application/pdf', `Einkaufsliste_${list.number}.pdf`, query.inline === '1');
  });

  // ---------- Druck ----------
  const printOpts = (body) => ({
    printer_id: body.printer_id ? Number(body.printer_id) : null,
    groupBy: ['category', 'supplier', 'location'].includes(body.group_by) ? body.group_by : 'category',
    perSupplier: !!body.per_supplier,
    onlyOpen: !!body.only_open,
    showPrices: !!body.show_prices,
  });

  router.post('/api/lists/:id/print', { perm: 'print' }, async ({ db, user, body, params }) => P.printList(db, user, Number(params.id), printOpts(body)));
  router.post('/api/lists/:id/preview', { perm: 'print' }, ({ db, user, body, params }) => P.previewList(db, user, Number(params.id), printOpts(body)));

  router.get('/api/print-jobs', { perm: 'print' }, ({ db, query }) => db.all(`SELECT pj.id, pj.printer_id, pj.printer_name, pj.list_id, pl.number AS list_number, pj.kind, pj.title, pj.status, pj.error, pj.user_name, pj.at
    FROM print_jobs pj LEFT JOIN purchase_lists pl ON pl.id = pj.list_id ${query.list_id ? 'WHERE pj.list_id = ?' : ''} ORDER BY pj.id DESC LIMIT 200`, ...(query.list_id ? [Number(query.list_id)] : [])));

  router.post('/api/print-jobs/:id/reprint', { perm: 'print' }, async ({ db, user, params, body }) => {
    const r = await P.reprint(db, user, Number(params.id), body.printer_id ? Number(body.printer_id) : null);
    audit(db, user, 'Bon erneut gedruckt', 'print_job', Number(params.id), { status: r.status });
    return r;
  });
};
