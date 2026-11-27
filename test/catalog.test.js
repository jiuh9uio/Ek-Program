'use strict';
/** Plausibilität des eingebauten Produktkatalogs. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { DEFAULT_CATEGORIES } = require('../src/db/seed');

const UNITS = ['Flasche', 'Kasten', 'Karton', 'Stück', 'Liter', 'Packung', 'Dose', 'Fass', 'Kanister', 'Rolle', 'Beutel', 'Kilogramm'];
let C;
test.before(async () => { C = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'catalog.js')).href); });

test('Katalog: Kategorien und Einheiten existieren, Gebinde plausibel, Namen eindeutig', () => {
  assert.ok(C.CATALOG.length > 250, `nur ${C.CATALOG.length} Einträge`);
  const names = new Set();
  for (const e of C.CATALOG) {
    assert.ok(DEFAULT_CATEGORIES.includes(e.category), `Kategorie fehlt: ${e.category}`);
    assert.ok(UNITS.includes(e.unit), `Einheit fehlt: ${e.unit} (${e.name})`);
    for (const o of e.orders) {
      assert.ok(UNITS.includes(o.unit), `Bestelleinheit fehlt: ${o.unit}`);
      assert.ok(Number.isInteger(o.per) && o.per > 1 && o.per <= 50, `Inhalt unplausibel: ${e.name} ${o.per}`);
    }
    assert.ok(!names.has(e.name), `doppelt: ${e.name}`);
    names.add(e.name);
    assert.ok(!/(\d+ \w+) .*\1$/.test(e.name), `Größe doppelt im Namen: ${e.name}`);
  }
});

test('Suche: Teilwörter, Umlaute/Akzente egal, beste Treffer zuerst', () => {
  const cola = C.searchCatalog('cola');
  assert.equal(cola[0].name, 'Coca-Cola 0,2 l');
  assert.equal(cola[0].unit, 'Flasche');
  assert.deepEqual(cola[0].orders, [{ unit: 'Kasten', per: 24 }]);
  assert.ok(C.searchCatalog('cola 1,0')[0].name.startsWith('Coca-Cola 1,0 l'));
  assert.equal(C.searchCatalog('cola 1,0')[0].orders[0].per, 12);
  assert.ok(C.searchCatalog('kahlua').some((e) => e.base.startsWith('Kahlúa')));
  assert.ok(C.searchCatalog('augustiner')[0].orders[0].per === 20);
  assert.ok(C.searchCatalog('monin vanille').length === 1);
  assert.equal(C.searchCatalog('x').length, 0);
  assert.equal(C.describe(cola[0]), 'Flasche · Kasten à 24');
});
