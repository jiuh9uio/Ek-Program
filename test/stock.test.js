'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { roundUpToStep, evaluate, allowedMaxQty } = require('../src/services/stock');

const now = Date.now();
const fresh = new Date(now - 3600e3).toISOString();
const old = new Date(now - 30 * 86400e3).toISOString();
const art = (o) => ({ min_stock: 3, max_stock: 10, current_stock: null, order_step: 1, min_order_qty: 0, stock_checked_at: fresh, check_result: 'counted', ...o });

test('Beispiel aus der Anforderung: MIN 3, MAX 10, Ist 2 → 8 Kästen', () => {
  const r = evaluate(art({ current_stock: 2 }), 0, 7, now);
  assert.equal(r.recommended, 8);
  assert.equal(r.status, 'below');
});

test('Ist = MIN → gelb + Empfehlung bis MAX', () => {
  const r = evaluate(art({ current_stock: 3 }), 0, 7, now);
  assert.equal(r.status, 'at_min');
  assert.equal(r.recommended, 7);
});

test('Ist > MIN → grün, keine Empfehlung', () => {
  const r = evaluate(art({ current_stock: 5 }), 0, 7, now);
  assert.equal(r.status, 'ok');
  assert.equal(r.recommended, 0);
});

test('Nicht kontrolliert wird NICHT als 0 interpretiert', () => {
  const r = evaluate(art({ current_stock: null, stock_checked_at: null, check_result: null }), 0, 7, now);
  assert.equal(r.status, 'unchecked');
  assert.equal(r.recommended, 0);
  assert.equal(r.effective_stock, null);
});

test('Bereits bestellte Mengen verhindern Doppelbestellung', () => {
  const full = evaluate(art({ current_stock: 2 }), 8, 7, now);
  assert.equal(full.recommended, 0);
  assert.equal(full.status, 'ordered');
  const partial = evaluate(art({ current_stock: 0 }), 2, 7, now); // effektiv 2 ≤ MIN 3
  assert.equal(partial.recommended, 8);
});

test('Gebindeschritt und Mindestbestellmenge', () => {
  assert.equal(roundUpToStep(7, 6, 0), 12);
  assert.equal(roundUpToStep(2, 1, 6), 6);
  assert.equal(roundUpToStep(0, 6, 6), 0);
  assert.equal(roundUpToStep(0.5, 0.25, 0), 0.5);
  const r = evaluate(art({ min_stock: 6, max_stock: 24, current_stock: 5, order_step: 6, min_order_qty: 6 }), 0, 7, now);
  assert.equal(r.recommended, 24); // 19 → auf 6er-Schritt aufgerundet
});

test('Veraltete Kontrolle → grau, Empfehlung bleibt bei Unterschreitung erhalten', () => {
  assert.equal(evaluate(art({ current_stock: 8, stock_checked_at: old }), 0, 7, now).status, 'unchecked');
  const r = evaluate(art({ current_stock: 1, stock_checked_at: old }), 0, 7, now);
  assert.equal(r.status, 'below');
  assert.equal(r.recommended, 9);
});

test('"Bestand ausreichend" überstimmt die Rechnung', () => {
  const r = evaluate(art({ current_stock: 1, check_result: 'ok' }), 0, 7, now);
  assert.equal(r.status, 'ok');
  assert.equal(r.recommended, 0);
});

test('Ohne MAX keine automatische Empfehlung, keine Mengenbegrenzung', () => {
  const r = evaluate(art({ min_stock: 0, max_stock: 0, current_stock: 0 }), 0, 7, now);
  assert.equal(r.recommended, 0);
  assert.equal(allowedMaxQty(art({ max_stock: 0 }), 0), Infinity);
});

test('Erlaubte Höchstmenge für Servicemitarbeiter', () => {
  assert.equal(allowedMaxQty(art({ current_stock: 2 }), 0), 8);
  assert.equal(allowedMaxQty(art({ current_stock: null }), 0), 10); // unbekannt → konservativ 0 angenommen
  assert.equal(allowedMaxQty(art({ current_stock: 2 }), 5), 3);
  assert.equal(allowedMaxQty(art({ current_stock: 2, order_step: 6 }), 0), 12);
});
