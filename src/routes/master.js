'use strict';
/** Stammdaten: Kategorien, Lagerorte, Mengeneinheiten, Lieferanten. */
const { notFound, conflict, unprocessable } = require('../http/core');
const v = require('../http/validate');
const { audit, diff } = require('../services/audit');

const dep = (q) => (q && q.department) || 'service';

module.exports = function register(router) {
  // ---------- Kategorien & Lagerorte (gleiches Schema) ----------
  for (const [table, label, pathName] of [['categories', 'Kategorie', 'categories'], ['locations', 'Lagerort', 'locations']]) {
    router.get(`/api/${pathName}`, {}, ({ db, query }) => db.all(`SELECT t.*, (SELECT COUNT(*) FROM articles a WHERE a.${table === 'categories' ? 'category_id' : 'location_id'} = t.id AND a.archived = 0) AS article_count
      FROM ${table} t WHERE department = ? ORDER BY sort_order, name COLLATE NOCASE`, dep(query)));

    router.post(`/api/${pathName}`, { perm: 'articles.manage' }, ({ db, user, body, query }) => {
      const name = v.str(body.name, 'name', { required: true, max: 80, label });
      const so = v.num(body.sort_order, 'sort_order', { integer: true, min: 0, max: 100000 }) || ((db.get(`SELECT MAX(sort_order) AS m FROM ${table} WHERE department = ?`, dep(query)).m || 0) + 10);
      const id = Number(db.run(`INSERT INTO ${table}(department, name, sort_order, active) VALUES(?,?,?,1)`, dep(query), name, so).lastInsertRowid);
      audit(db, user, `${label} angelegt`, table, id, { name });
      return db.get(`SELECT * FROM ${table} WHERE id = ?`, id);
    });

    router.put(`/api/${pathName}/:id`, { perm: 'articles.manage' }, ({ db, user, body, params }) => {
      const before = db.get(`SELECT * FROM ${table} WHERE id = ?`, params.id);
      if (!before) throw notFound();
      const upd = {
        name: v.str(body.name ?? before.name, 'name', { required: true, max: 80, label }),
        sort_order: v.num(body.sort_order ?? before.sort_order, 'sort_order', { integer: true, min: 0, max: 100000 }),
        active: body.active === undefined ? before.active : (v.bool(body.active) ? 1 : 0),
      };
      db.run(`UPDATE ${table} SET name = ?, sort_order = ?, active = ? WHERE id = ?`, upd.name, upd.sort_order, upd.active, before.id);
      audit(db, user, `${label} geändert`, table, before.id, diff(before, upd, ['name', 'sort_order', 'active']));
      return db.get(`SELECT * FROM ${table} WHERE id = ?`, before.id);
    });

    // Reihenfolge per Drag & Drop / Pfeiltasten
    router.post(`/api/${pathName}/reorder`, { perm: 'articles.manage' }, ({ db, user, body }) => {
      if (!Array.isArray(body.ids)) throw unprocessable('ids fehlt.');
      db.transaction(() => body.ids.forEach((id, i) => db.run(`UPDATE ${table} SET sort_order = ? WHERE id = ?`, (i + 1) * 10, Number(id))));
      audit(db, user, `${label}: Reihenfolge geändert`, table, null);
      return { ok: true };
    });

    router.delete(`/api/${pathName}/:id`, { perm: 'articles.manage' }, ({ db, user, params }) => {
      const before = db.get(`SELECT * FROM ${table} WHERE id = ?`, params.id);
      if (!before) throw notFound();
      const used = db.get(`SELECT COUNT(*) AS n FROM articles WHERE ${table === 'categories' ? 'category_id' : 'location_id'} = ?`, before.id).n;
      if (used) throw conflict(`${label} "${before.name}" wird von ${used} Artikel(n) verwendet. Bitte zuerst umhängen oder deaktivieren.`);
      db.run(`DELETE FROM ${table} WHERE id = ?`, before.id);
      audit(db, user, `${label} gelöscht`, table, before.id, { name: before.name });
      return { ok: true };
    });
  }

  // ---------- Mengeneinheiten ----------
  router.get('/api/units', {}, ({ db }) => db.all('SELECT u.*, (SELECT COUNT(*) FROM articles a WHERE a.unit_id = u.id) AS article_count FROM units u ORDER BY sort_order, name'));
  router.post('/api/units', { perm: 'articles.manage' }, ({ db, user, body }) => {
    const name = v.str(body.name, 'name', { required: true, max: 40, label: 'Einheit' });
    const plural = v.str(body.plural || name, 'plural', { required: true, max: 40, label: 'Mehrzahl' });
    const so = (db.get('SELECT MAX(sort_order) AS m FROM units').m || 0) + 10;
    const id = Number(db.run('INSERT INTO units(name, plural, sort_order) VALUES(?,?,?)', name, plural, so).lastInsertRowid);
    audit(db, user, 'Mengeneinheit angelegt', 'unit', id, { name, plural });
    return db.get('SELECT * FROM units WHERE id = ?', id);
  });
  router.put('/api/units/:id', { perm: 'articles.manage' }, ({ db, user, body, params }) => {
    const before = db.get('SELECT * FROM units WHERE id = ?', params.id);
    if (!before) throw notFound();
    const name = v.str(body.name, 'name', { required: true, max: 40, label: 'Einheit' });
    const plural = v.str(body.plural || name, 'plural', { required: true, max: 40, label: 'Mehrzahl' });
    db.run('UPDATE units SET name = ?, plural = ? WHERE id = ?', name, plural, before.id);
    audit(db, user, 'Mengeneinheit geändert', 'unit', before.id, diff(before, { name, plural }, ['name', 'plural']));
    return db.get('SELECT * FROM units WHERE id = ?', before.id);
  });
  router.delete('/api/units/:id', { perm: 'articles.manage' }, ({ db, user, params }) => {
    const before = db.get('SELECT * FROM units WHERE id = ?', params.id);
    if (!before) throw notFound();
    const used = db.get('SELECT COUNT(*) AS n FROM articles WHERE unit_id = ?', before.id).n;
    if (used) throw conflict(`Einheit "${before.name}" wird von ${used} Artikel(n) verwendet.`);
    db.run('DELETE FROM units WHERE id = ?', before.id);
    audit(db, user, 'Mengeneinheit gelöscht', 'unit', before.id, { name: before.name });
    return { ok: true };
  });

  // ---------- Lieferanten ----------
  const SUP_FIELDS = ['name', 'customer_no', 'contact_person', 'phone', 'email', 'order_days', 'delivery_days', 'min_order_value', 'shipping_cost', 'notes', 'active'];
  function supplierInput(body) {
    return {
      name: v.str(body.name, 'name', { required: true, max: 120, label: 'Firmenname' }),
      customer_no: v.optStr(body.customer_no, 'customer_no', { max: 60, label: 'Kundennummer' }),
      contact_person: v.optStr(body.contact_person, 'contact_person', { max: 120, label: 'Ansprechpartner' }),
      phone: v.optStr(body.phone, 'phone', { max: 60, label: 'Telefon' }),
      email: v.email(body.email, 'email', 'E-Mail'),
      order_days: v.days(body.order_days, 'order_days', 'Bestelltage'),
      delivery_days: v.days(body.delivery_days, 'delivery_days', 'Liefertage'),
      min_order_value: v.num(body.min_order_value, 'min_order_value', { min: 0, max: 1e7, label: 'Mindestbestellwert' }),
      shipping_cost: v.num(body.shipping_cost, 'shipping_cost', { min: 0, max: 1e6, label: 'Versandkosten' }),
      notes: v.optStr(body.notes, 'notes', { max: 2000, label: 'Notizen' }),
      active: body.active === undefined ? 1 : (v.bool(body.active) ? 1 : 0),
    };
  }

  router.get('/api/suppliers', {}, ({ db }) => db.all(`SELECT s.*,
      (SELECT COUNT(*) FROM articles a WHERE a.supplier_id = s.id AND a.archived = 0) AS article_count
    FROM suppliers s ORDER BY s.active DESC, s.name COLLATE NOCASE`));

  router.get('/api/suppliers/:id', {}, ({ db, params }) => {
    const s = db.get('SELECT * FROM suppliers WHERE id = ?', params.id);
    if (!s) throw notFound('Lieferant nicht gefunden.');
    s.articles = db.all(`SELECT a.id, a.article_no, a.name, a.price_net, a.active, a.archived, u.name AS unit_name, c.name AS category_name
      FROM articles a LEFT JOIN units u ON u.id = a.unit_id LEFT JOIN categories c ON c.id = a.category_id
      WHERE a.supplier_id = ? ORDER BY a.archived, a.name COLLATE NOCASE`, s.id);
    return s;
  });

  router.post('/api/suppliers', { perm: 'suppliers.manage' }, ({ db, user, body }) => {
    const s = supplierInput(body);
    const t = new Date().toISOString();
    const id = Number(db.run(`INSERT INTO suppliers(${SUP_FIELDS.join(',')}, created_at, updated_at) VALUES(${SUP_FIELDS.map(() => '?').join(',')},?,?)`,
      ...SUP_FIELDS.map((f) => s[f]), t, t).lastInsertRowid);
    audit(db, user, 'Lieferant angelegt', 'supplier', id, { name: s.name });
    return db.get('SELECT * FROM suppliers WHERE id = ?', id);
  });

  router.put('/api/suppliers/:id', { perm: 'suppliers.manage' }, ({ db, user, body, params }) => {
    const before = db.get('SELECT * FROM suppliers WHERE id = ?', params.id);
    if (!before) throw notFound('Lieferant nicht gefunden.');
    const s = supplierInput(body);
    db.run(`UPDATE suppliers SET ${SUP_FIELDS.map((f) => `${f} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...SUP_FIELDS.map((f) => s[f]), new Date().toISOString(), before.id);
    audit(db, user, 'Lieferant geändert', 'supplier', before.id, diff(before, s, SUP_FIELDS));
    return db.get('SELECT * FROM suppliers WHERE id = ?', before.id);
  });

  // Artikel einem Lieferanten zuordnen (Mehrfachauswahl)
  router.post('/api/suppliers/:id/assign', { perm: ['suppliers.manage', 'articles.manage'] }, ({ db, user, body, params }) => {
    const s = db.get('SELECT * FROM suppliers WHERE id = ?', params.id);
    if (!s) throw notFound('Lieferant nicht gefunden.');
    const ids = (Array.isArray(body.article_ids) ? body.article_ids : []).map(Number).filter(Number.isInteger);
    db.transaction(() => ids.forEach((id) => db.run('UPDATE articles SET supplier_id = ?, updated_at = ? WHERE id = ?', s.id, new Date().toISOString(), id)));
    audit(db, user, 'Artikel Lieferant zugeordnet', 'supplier', s.id, { artikel: ids.length });
    return { ok: true, assigned: ids.length };
  });

  router.delete('/api/suppliers/:id', { perm: 'suppliers.manage' }, ({ db, user, params }) => {
    const before = db.get('SELECT * FROM suppliers WHERE id = ?', params.id);
    if (!before) throw notFound('Lieferant nicht gefunden.');
    const used = db.get('SELECT (SELECT COUNT(*) FROM articles WHERE supplier_id = ?) + (SELECT COUNT(*) FROM purchase_items WHERE supplier_id = ?) AS n', before.id, before.id).n;
    if (used) {
      db.run('UPDATE suppliers SET active = 0, updated_at = ? WHERE id = ?', new Date().toISOString(), before.id);
      audit(db, user, 'Lieferant deaktiviert (in Verwendung)', 'supplier', before.id, { name: before.name });
      return { ok: true, deactivated: true };
    }
    db.run('DELETE FROM suppliers WHERE id = ?', before.id);
    audit(db, user, 'Lieferant gelöscht', 'supplier', before.id, { name: before.name });
    return { ok: true, deleted: true };
  });
};
