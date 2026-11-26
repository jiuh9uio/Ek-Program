'use strict';
/**
 * MIN/MAX-Logik: Bestandsstatus, Bestellempfehlung, offene Bestellmengen.
 *
 * Regeln:
 *  - Ist-Bestand NULL = nicht kontrolliert (wird NIE als 0 interpretiert).
 *  - Effektiver Bestand = Ist-Bestand + bereits bestellte, noch nicht gelieferte Menge.
 *  - Empfehlung, sobald effektiver Bestand <= MIN:  MAX - effektiver Bestand,
 *    aufgerundet auf den Gebindeschritt und mindestens die Mindestbestellmenge.
 *  - MAX ist Zielbestand, keine harte Grenze (Überschreitung mit Berechtigung).
 */

const OPEN_LIST_STATUSES = ['draft', 'ready', 'ordered', 'partial'];
const EPS = 1e-9;

const round3 = (n) => Math.round(n * 1000) / 1000;

/** Bestellschritt: bei Bestelleinheit (z. B. Karton à 6) immer ganze Bestelleinheiten. */
function stepOf(a) {
  const upo = Number(a.units_per_order) || 1;
  const step = Number(a.order_step) > 0 ? Number(a.order_step) : 1;
  return upo > 1 ? upo * Math.max(1, Math.round(step / upo) || 1) : step;
}

function roundUpToStep(qty, step, minOrderQty = 0) {
  if (!(qty > EPS)) return 0;
  const s = step > 0 ? step : 1;
  let q = Math.ceil(qty / s - EPS) * s;
  if (minOrderQty > 0 && q < minOrderQty - EPS) q = Math.ceil(minOrderQty / s - EPS) * s;
  return round3(q);
}

/**
 * Offene Mengen je Artikel (Listen in Entwurf/Einkaufsbereit/Bestellt/Teilweise geliefert).
 * @returns Map<articleId, {qty, lists: string[]}>
 */
function openQuantities(db, { department = 'service', excludeListId = null, articleId = null } = {}) {
  const params = [department];
  let where = `pl.department = ? AND pl.status IN (${OPEN_LIST_STATUSES.map(() => '?').join(',')})`;
  params.push(...OPEN_LIST_STATUSES);
  if (excludeListId) { where += ' AND pl.id <> ?'; params.push(excludeListId); }
  if (articleId) { where += ' AND pi.article_id = ?'; params.push(articleId); }
  const rows = db.all(`
    SELECT pi.article_id AS article_id,
           SUM(MAX(pi.qty - pi.qty_received, 0)) AS qty,
           GROUP_CONCAT(pl.number || ':' || pl.status || ':' || (pi.qty - pi.qty_received), '|') AS lists
    FROM purchase_items pi JOIN purchase_lists pl ON pl.id = pi.list_id
    WHERE ${where}
    GROUP BY pi.article_id`, ...params);
  const map = new Map();
  for (const r of rows) {
    const lists = String(r.lists || '').split('|').filter(Boolean).map((s) => {
      const [number, status, open] = s.split(':');
      return { number, status, open: Math.max(0, Number(open)) };
    }).filter((l) => l.open > 0);
    if (r.qty > EPS) map.set(r.article_id, { qty: round3(r.qty), lists });
  }
  return map;
}

function isFresh(checkedAt, validDays, now = Date.now()) {
  if (!checkedAt) return false;
  return now - Date.parse(checkedAt) <= validDays * 86400e3;
}

/**
 * Berechnet Status + Empfehlung für einen Artikel.
 * @param a Artikelzeile
 * @param onOrder Menge, die bereits bestellt/auf Listen ist (ohne die betrachtete Liste)
 */
function evaluate(a, onOrder = 0, validDays = 7, now = Date.now()) {
  const stock = a.current_stock === null || a.current_stock === undefined ? null : Number(a.current_stock);
  const min = Number(a.min_stock) || 0;
  const max = Number(a.max_stock) || 0;
  const fresh = isFresh(a.stock_checked_at, validDays, now);
  const confirmedOk = a.check_result === 'ok' && fresh;
  const effective = stock === null ? null : round3(stock + onOrder);
  const minMaxConfigured = max > 0;

  let recommended = 0;
  if (!confirmedOk && minMaxConfigured && effective !== null && effective <= min + EPS) {
    recommended = roundUpToStep(max - effective, stepOf(a), a.min_order_qty);
  }

  let status;
  if (onOrder > EPS && (stock === null || recommended === 0)) status = 'ordered'; // blau
  else if (confirmedOk) status = 'ok';                                            // grün
  else if (stock === null) status = 'unchecked';                                  // grau
  else if (stock < min - EPS) status = 'below';                                   // rot
  else if (minMaxConfigured && stock <= min + EPS) status = 'at_min';             // gelb
  else if (!fresh) status = 'unchecked';                                          // grau (veraltet)
  else status = 'ok';                                                             // grün

  return {
    status,
    recommended,
    effective_stock: effective,
    on_order: round3(onOrder),
    stock_fresh: fresh,
    stock_known: stock !== null,
  };
}

/**
 * Höchstmenge, die ohne Berechtigung "list.exceed_max" bestellt werden darf.
 * Unbekannter Bestand wird konservativ als 0 angenommen, damit MAX nie überschritten wird.
 */
function allowedMaxQty(a, onOrder = 0) {
  const max = Number(a.max_stock) || 0;
  if (max <= 0) return Infinity;
  const stock = a.current_stock === null || a.current_stock === undefined ? 0 : Number(a.current_stock);
  const gap = Math.max(0, max - stock - onOrder);
  const evalRec = evaluate(a, onOrder, Infinity).recommended;
  // Aufrunden auf Gebinde ist erlaubt, ebenso die Mindestbestellmenge
  return Math.max(roundUpToStep(gap, stepOf(a), gap > 0 ? a.min_order_qty : 0), evalRec);
}

module.exports = { OPEN_LIST_STATUSES, stepOf, roundUpToStep, openQuantities, evaluate, allowedMaxQty, isFresh, round3 };
