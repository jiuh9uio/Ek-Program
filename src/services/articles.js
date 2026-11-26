'use strict';
const { evaluate, openQuantities } = require('./stock');

const ARTICLE_SELECT = `
  SELECT a.*, c.name AS category_name, c.sort_order AS category_sort,
         s.name AS supplier_name, l.name AS location_name, l.sort_order AS location_sort,
         u.name AS unit_name, u.plural AS unit_plural, ou.name AS order_unit_name, ou.plural AS order_unit_plural,
         cu.display_name AS stock_checked_by_name
  FROM articles a
  LEFT JOIN categories c ON c.id = a.category_id
  LEFT JOIN suppliers s ON s.id = a.supplier_id
  LEFT JOIN locations l ON l.id = a.location_id
  LEFT JOIN units u ON u.id = a.unit_id
  LEFT JOIN units ou ON ou.id = a.order_unit_id
  LEFT JOIN users cu ON cu.id = a.stock_checked_by`;

/**
 * Lädt Artikel inkl. berechnetem Status und Bestellempfehlung.
 * @param opts.excludeListId offene Mengen dieser Liste nicht als "bestellt" zählen
 */
function loadArticles(db, { department = 'service', includeArchived = false, includeInactive = true, ids = null, excludeListId = null, withImage = false } = {}) {
  const where = ['a.department = ?'];
  const params = [department];
  if (!includeArchived) where.push('a.archived = 0');
  if (!includeInactive) where.push('a.active = 1');
  if (ids) {
    if (!ids.length) return [];
    where.push(`a.id IN (${ids.map(() => '?').join(',')})`);
    params.push(...ids);
  }
  const rows = db.all(`${ARTICLE_SELECT} WHERE ${where.join(' AND ')} ORDER BY a.sort_order, a.name COLLATE NOCASE`, ...params);
  const open = openQuantities(db, { department, excludeListId });
  const validDays = Number(db.getSetting('check_valid_days', 7)) || 7;
  const now = Date.now();
  return rows.map((a) => {
    const oq = open.get(a.id);
    const ev = evaluate(a, oq ? oq.qty : 0, validDays, now);
    const out = { ...a, ...ev, open_lists: oq ? oq.lists : [], has_image: !!a.image };
    if (!withImage) delete out.image;
    return out;
  });
}

function loadArticle(db, id, opts = {}) {
  const a = db.get('SELECT department FROM articles WHERE id = ?', id);
  if (!a) return null;
  return loadArticles(db, { department: a.department, includeArchived: true, ids: [id], withImage: true, ...opts })[0] || null;
}

module.exports = { loadArticles, loadArticle, ARTICLE_SELECT };
