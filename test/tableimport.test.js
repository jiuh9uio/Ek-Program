'use strict';
/** Eingefügte Tabelle (z. B. von Claude) mit MIN/MAX, Bestelleinheiten und Lieferanten-Zählung. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');
const { seedDemo } = require('../src/db/seed');
const { parseTable, looseNum, fieldFor } = require('../src/services/tableimport');
const R = require('../src/print/receipt');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ek-tab-'));
const { db, server } = createApp({ isSea: false, dataDir: dir, dbFile: path.join(dir, 'db.sqlite'), backupDir: path.join(dir, 'b'), port: 0 }, { log() {}, error() {} });
db.transaction(() => seedDemo(db));
let base; let cookie = '';
async function call(method, url, body) {
  const r = await fetch(base + url, { method, headers: { 'X-EK-Client': '1', 'Content-Type': 'application/json', Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return { status: r.status, data: (r.headers.get('content-type') || '').includes('json') ? await r.json() : await r.text() };
}
const ok = async (p) => { const r = await p; assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };
test.before(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await ok(call('POST', '/api/auth/login', { username: 'admin', password: 'admin' }));
});
test.after(() => { server.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const CLAUDE_TABLE = `Hier ist die berechnete Tabelle mit sinnvollen MIN/MAX-Werten:

| Artikelnummer | Artikelname | Lieferant | Kategorie | Zähleinheit | Bestelleinheit | Inhalt je Bestelleinheit | MIN | MAX | EK netto |
|---|---|---|:---:|---|---|---|---:|---:|---:|
| SPI-001 | Aperol | Großmarkt (Abholung) | Spirituosen | Flaschen | Karton | 6 | **3** | 12 | 12,50 |
| | Tonic Water 0,2 l | Großmarkt (Abholung) | Alkoholfreie Getränke | Flaschen | Karton | 24 | 24 | 72 | 0,79 |
| AFG-001 | Coca-Cola 0,2 l | | | | | | 3 | 10 | |

Begründung: Aperol wird ca. 6 Flaschen pro Woche verbraucht …`;

test('Parser: Markdown, Excel (Tab), CSV, deutsche Zahlen, Spaltensynonyme', () => {
  const md = parseTable(CLAUDE_TABLE);
  assert.equal(md.format, 'markdown');
  assert.equal(md.rows.length, 3);
  assert.equal(md.rows[0].cells[7], '3', 'Fettdruck entfernt');
  assert.equal(parseTable('Artikel\tMIN\tMAX\nCola\t3\t10').format, 'tabelle');
  assert.equal(parseTable('Artikel;MIN;MAX\n"Cola; 0,2";3;10').rows[0].cells[0], 'Cola; 0,2');
  assert.equal(looseNum('1.234,5'), 1234.5); assert.equal(looseNum('12,5'), 12.5); assert.equal(looseNum('3 Kästen'), 3); assert.equal(looseNum('1,234.5'), 1234.5);
  assert.equal(fieldFor('Mindestbestand'), 'min_stock'); assert.equal(fieldFor('Max.'), 'max_stock'); assert.equal(fieldFor('Stück pro Karton'), 'units_per_order');
  assert.equal(fieldFor('Einkaufsort'), 'supplier'); assert.equal(fieldFor('Mindestbestellmenge'), 'min_order_qty');
});

test('Vorschau ändert nichts, Übernehmen aktualisiert/legt an', async () => {
  const prev = await ok(call('POST', '/api/articles/paste-import', { text: CLAUDE_TABLE }));
  assert.equal(prev.dry_run, true);
  assert.deepEqual([prev.counts.update, prev.counts.create, prev.counts.unchanged, prev.counts.error], [1, 1, 1, 0]);
  const ap = prev.rows.find((r) => r.name === 'Aperol');
  assert.deepEqual(ap.changes.min_stock, { von: 2, nach: 3 });
  assert.equal(ap.changes.order_unit_id.nach, 'Karton');
  assert.equal(db.get("SELECT min_stock FROM articles WHERE article_no='SPI-001'").min_stock, 2, 'Vorschau schreibt nicht');
  assert.equal(db.get("SELECT COUNT(*) n FROM articles WHERE name LIKE 'Tonic%'").n, 0);

  const done = await ok(call('POST', '/api/articles/paste-import', { text: CLAUDE_TABLE, apply: true }));
  assert.equal(done.counts.create, 1);
  const a = db.get("SELECT * FROM articles WHERE article_no='SPI-001'");
  assert.deepEqual([a.min_stock, a.max_stock, a.units_per_order], [3, 12, 6]);
  const tonic = db.get("SELECT * FROM articles WHERE name LIKE 'Tonic%'");
  assert.match(tonic.article_no, /^A-\d{4}$/);
  assert.equal(tonic.price_net, 0.79);
  // Wiederholung → unverändert
  const again = await ok(call('POST', '/api/articles/paste-import', { text: CLAUDE_TABLE }));
  assert.equal(again.counts.unchanged, 3);
});

test('Fehlerhafte Zeilen werden gemeldet, Rest bleibt gültig', async () => {
  const r = await ok(call('POST', '/api/articles/paste-import', { text: 'Artikel;MIN;MAX\nAperol;9;4\nFanta 0,2 l;abc;6\nRiesling trocken;6;30' }));
  assert.equal(r.counts.error, 2);
  assert.match(r.rows[0].error, /Maximalbestand/);
  assert.equal(r.counts.update, 1);
  assert.equal((await call('POST', '/api/articles/paste-import', { text: 'foo\nbar' })).status, 422);
});

test('Claude-Vorlage enthält Artikel als Markdown', async () => {
  const t = await ok(call('GET', '/api/articles/claude-template'));
  assert.match(t.markdown, /^\| Artikelnummer \| Artikelname/);
  assert.match(t.markdown, /\| SPI-001 \| Aperol \|.*\| Karton \| 6 \| 3 \| 12 \|/);
});

test('Lieferant wählen → Zählung nur dessen Artikel; Vorschlag in ganzen Kartons', async () => {
  const sup = db.get("SELECT id FROM suppliers WHERE name='Großmarkt (Abholung)'").id;
  const c = await ok(call('POST', '/api/counts', { supplier_ids: [sup] }));
  assert.ok(c.items.every((i) => i.supplier_name === 'Großmarkt (Abholung)'));
  assert.match((await ok(call('GET', `/api/lists/${c.list_id}`))).title, /Großmarkt/);
  const ap = c.items.find((i) => i.name === 'Aperol');
  assert.equal(ap.step, 6);
  // 2 Flaschen da, MIN 3, MAX 12 → 10 fehlen → 2 Kartons à 6 = 12 Flaschen
  const r = await ok(call('POST', `/api/counts/${c.id}/items/${ap.id}`, { counted_qty: 2 }));
  const item = r.items.find((i) => i.id === ap.id);
  assert.equal(item.order.qty, 12);
  // Selbst eintragen: 1 Karton (= 6)
  const r2 = await ok(call('POST', `/api/counts/${c.id}/items/${ap.id}`, { order_qty: 6 }));
  assert.equal(r2.items.find((i) => i.id === ap.id).order.qty, 6);
  const list = await ok(call('GET', `/api/lists/${c.list_id}`));
  const text = R.toText(R.buildListDoc(list, { width: 48 }), 48);
  assert.match(text, /\[ \] Aperol\s+1 Karton/);
  assert.match(text, /= 6 Flaschen/);
});
