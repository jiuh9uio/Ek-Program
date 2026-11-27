'use strict';
const { loadArticles } = require('./articles');
const { round3 } = require('./stock');

const monthKey = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

function dashboard(db, { department = 'service', withStats = false, months = 12, periodMonths = 1 } = {}) {
  const arts = loadArticles(db, { department, includeInactive: false });
  const pick = (a) => ({ id: a.id, name: a.name, current_stock: a.current_stock, min_stock: a.min_stock, max_stock: a.max_stock, recommended: a.recommended, unit_plural: a.unit_plural, unit_name: a.unit_name, location_name: a.location_name, on_order: a.on_order, status: a.status });
  const below = arts.filter((a) => a.status === 'below');
  const atMin = arts.filter((a) => a.status === 'at_min');
  const unchecked = arts.filter((a) => a.status === 'unchecked');
  const ordered = arts.filter((a) => a.status === 'ordered');
  const unavailable = arts.filter((a) => a.unavailable_since);
  const recValue = arts.reduce((s, a) => s + a.recommended * a.price_net, 0);

  const lists = db.all(`SELECT pl.id, pl.number, pl.title, pl.status, pl.created_at, pl.updated_at, pl.ordered_at, u.display_name AS created_by_name,
      COUNT(pi.id) AS positions, COALESCE(SUM(pi.qty * pi.unit_price_est), 0) AS est_total,
      COALESCE(SUM(MAX(pi.qty - pi.qty_received, 0) * pi.unit_price_est), 0) AS open_value,
      COALESCE(SUM(CASE WHEN pi.qty_received < pi.qty - 1e-9 THEN 1 ELSE 0 END), 0) AS open_positions
    FROM purchase_lists pl LEFT JOIN purchase_items pi ON pi.list_id = pl.id LEFT JOIN users u ON u.id = pl.created_by
    WHERE pl.department = ? AND pl.status IN ('draft','ready','ordered','partial')
    GROUP BY pl.id ORDER BY pl.updated_at DESC`, department);
  const openLists = lists.filter((l) => ['draft', 'ready'].includes(l.status));
  const openOrders = lists.filter((l) => ['ordered', 'partial'].includes(l.status));
  const pendingDeliveries = db.all(`SELECT pi.id, pl.id AS list_id, pl.number, COALESCE(a.name, pi.free_name) AS article_name, s.name AS supplier_name,
      (pi.qty - pi.qty_received) AS open_qty, COALESCE(u.plural, pi.free_unit) AS unit_plural, COALESCE(u.name, pi.free_unit) AS unit_name, pl.ordered_at
    FROM purchase_items pi JOIN purchase_lists pl ON pl.id = pi.list_id LEFT JOIN articles a ON a.id = pi.article_id
    LEFT JOIN suppliers s ON s.id = pi.supplier_id LEFT JOIN units u ON u.id = a.unit_id
    WHERE pl.department = ? AND pl.status IN ('ordered','partial') AND pi.qty_received < pi.qty - 1e-9
    ORDER BY pl.ordered_at, a.name`, department);

  const lastCheck = db.get(`SELECT a.stock_checked_at AS at, u.display_name AS user_name,
      (SELECT COUNT(*) FROM articles x WHERE x.department = ? AND x.stock_checked_at >= date(a.stock_checked_at)) AS articles_that_day
    FROM articles a LEFT JOIN users u ON u.id = a.stock_checked_by
    WHERE a.department = ? AND a.stock_checked_at IS NOT NULL ORDER BY a.stock_checked_at DESC LIMIT 1`, department, department) || null;

  const result = {
    counts: {
      articles: arts.length, below: below.length, at_min: atMin.length, unchecked: unchecked.length, ordered: ordered.length,
      unavailable: unavailable.length, open_lists: openLists.length, open_orders: openOrders.length, pending_deliveries: pendingDeliveries.length,
      recommendations: arts.filter((a) => a.recommended > 0).length,
    },
    below: below.map(pick), at_min: atMin.map(pick), unavailable: unavailable.map(pick),
    open_lists: openLists, open_orders: openOrders, pending_deliveries: pendingDeliveries.slice(0, 50),
    last_check: lastCheck,
    estimated: {
      open_lists_value: round3(openLists.reduce((s, l) => s + l.est_total, 0)),
      open_orders_value: round3(openOrders.reduce((s, l) => s + l.open_value, 0)),
      recommendations_value: round3(recValue),
    },
    stats: null,
    // Lagergesundheit (Team): Anteil der Artikel, die ausreichend vorhanden oder bereits nachbestellt sind
    health: {
      percent: arts.length ? Math.round((arts.filter((a) => ['ok', 'ordered'].includes(a.status)).length / arts.length) * 100) : 0,
      good: arts.filter((a) => ['ok', 'ordered'].includes(a.status)).length,
      total: arts.length,
    },
  };

  if (withStats) {
    const since = new Date(); since.setDate(1); since.setHours(0, 0, 0, 0); since.setMonth(since.getMonth() - (months - 1));
    const rows = db.all(`SELECT m.at, m.delta * COALESCE(m.unit_price, 0) AS value, c.name AS category, COALESCE(s.name, 'Ohne Lieferant') AS supplier
      FROM stock_movements m JOIN articles a ON a.id = m.article_id LEFT JOIN categories c ON c.id = a.category_id
      LEFT JOIN suppliers s ON s.id = m.supplier_id
      WHERE m.type = 'receipt' AND a.department = ? AND m.at >= ?`, department, since.toISOString());
    const monthly = new Map();
    for (let i = 0; i < months; i++) { const d = new Date(since); d.setMonth(since.getMonth() + i); monthly.set(monthKey(d.toISOString()), 0); }
    const pStart = new Date(); pStart.setDate(1); pStart.setHours(0, 0, 0, 0); pStart.setMonth(pStart.getMonth() - (periodMonths - 1));
    const byCat = new Map(); const bySup = new Map();
    for (const r of rows) {
      const k = monthKey(r.at);
      if (monthly.has(k)) monthly.set(k, monthly.get(k) + r.value);
      if (r.at >= pStart.toISOString()) {
        const c = r.category || 'Ohne Kategorie';
        byCat.set(c, (byCat.get(c) || 0) + r.value);
        bySup.set(r.supplier, (bySup.get(r.supplier) || 0) + r.value);
      }
    }
    const toArr = (m) => [...m.entries()].map(([name, value]) => ({ name, value: round3(value) })).filter((x) => Math.abs(x.value) > 0.004).sort((a, b) => b.value - a.value);
    result.stats = {
      monthly: [...monthly.entries()].map(([month, value]) => ({ month, value: round3(value) })),
      by_category: toArr(byCat),
      by_supplier: toArr(bySup),
      period_months: periodMonths,
      stock_value: round3(arts.reduce((s, a) => s + (a.current_stock || 0) * a.price_net, 0)),
      overstock: arts.filter((a) => a.max_stock > 0 && a.current_stock !== null && a.current_stock > a.max_stock)
        .map((a) => ({ ...pick(a), excess_value: round3((a.current_stock - a.max_stock) * a.price_net) })),
    };
  }
  return result;
}

module.exports = { dashboard };
