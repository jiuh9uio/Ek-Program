'use strict';
/** Geführte Bestandszählung: "Neue Einkaufsliste" → zählen → automatisch bis MAX auf die Liste. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');
const { seedDemo } = require('../src/db/seed');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ek-count-'));
const { db, server } = createApp({ isSea: false, dataDir: dir, dbFile: path.join(dir, 'db.sqlite'), backupDir: path.join(dir, 'b'), port: 0 }, { log() {}, error() {} });
db.transaction(() => seedDemo(db));
let base; let cookie = '';
async function call(method, url, body) {
  const r = await fetch(base + url, { method, headers: { 'X-EK-Client': '1', 'Content-Type': 'application/json', Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const data = (r.headers.get('content-type') || '').includes('json') ? await r.json() : await r.text();
  return { status: r.status, data };
}
const ok = async (p) => { const r = await p; assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };

test.before(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await ok(call('POST', '/api/auth/login', { username: 'admin', password: 'admin' }));
  await ok(call('POST', '/api/users', { username: 'tom', display_name: 'Tom', role: 'service', password: '1111' }));
  cookie = '';
  await ok(call('POST', '/api/auth/login', { username: 'tom', password: '1111' }));
});
test.after(() => { server.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

let count;
const item = (name) => count.items.find((i) => i.name.startsWith(name));

test('Neue Einkaufsliste mit Zählung: Zählbeleg + leere Liste, Laufweg-Reihenfolge', async () => {
  const locs = await ok(call('GET', '/api/locations'));
  const lager = locs.find((l) => l.name === 'Getränkelager');
  count = await ok(call('POST', '/api/counts', { location_ids: [lager.id] }));
  assert.match(count.number, /^INV-\d{5}$/);
  assert.equal(count.status, 'open');
  assert.equal(count.items.length, 3);
  assert.ok(count.items.every((i) => i.state === 'open'));
  assert.equal(count.summary.on_list, 0);
  assert.equal((await ok(call('GET', `/api/lists/${count.list_id}`))).count.number, count.number);
});

test('"Noch 2 Cola da" → System setzt 8 Kästen (bis MAX 10) auf die Einkaufsliste', async () => {
  count = await ok(call('POST', `/api/counts/${count.id}/items/${item('Coca-Cola').id}`, { counted_qty: 2 }));
  const cola = item('Coca-Cola');
  assert.equal(cola.state, 'counted');
  assert.equal(cola.current_stock, 2);
  assert.equal(cola.order.qty, 8);
  assert.equal(cola.difference, null, 'vorher unbekannt → keine Differenz');
  const list = await ok(call('GET', `/api/lists/${count.list_id}`));
  assert.equal(list.items.find((i) => i.article_name.startsWith('Coca')).qty, 8);
});

test('Nachzählen korrigiert den Vorschlag; genug da → Position entfällt', async () => {
  count = await ok(call('POST', `/api/counts/${count.id}/items/${item('Coca-Cola').id}`, { counted_qty: '4,0' }));
  assert.equal(item('Coca-Cola').order, null, '4 > MIN 3 → kein Bedarf');
  count = await ok(call('POST', `/api/counts/${count.id}/items/${item('Coca-Cola').id}`, { counted_qty: 0 }));
  assert.equal(item('Coca-Cola').order.qty, 10, 'Bestand 0 (bewusst gezählt) → bis MAX');
});

test('Manuelle Mengenanpassung bleibt erhalten, MAX-Grenze für Service', async () => {
  const cola = item('Coca-Cola');
  const bad = await call('POST', `/api/counts/${count.id}/items/${cola.id}`, { order_qty: 15 });
  assert.equal(bad.status, 422);
  count = await ok(call('POST', `/api/counts/${count.id}/items/${cola.id}`, { order_qty: 6 }));
  assert.equal(item('Coca-Cola').order.qty, 6);
  assert.equal(item('Coca-Cola').order.source, 'manual');
  count = await ok(call('POST', `/api/counts/${count.id}/items/${cola.id}`, { counted_qty: 1 }));
  assert.equal(item('Coca-Cola').order.qty, 6, 'manuelle Menge wird bei Nachzählung nicht überschrieben');
});

test('Überspringen ≠ Bestand 0', async () => {
  count = await ok(call('POST', `/api/counts/${count.id}/items/${item('Fanta').id}`, { skip: true }));
  assert.equal(item('Fanta').state, 'skipped');
  assert.equal(item('Fanta').current_stock, null);
  assert.equal(item('Fanta').order, null);
});

test('Abschluss mit Zusammenfassung; danach keine Änderungen; Soll/Ist-Differenz bei Folgezählung', async () => {
  count = await ok(call('POST', `/api/counts/${count.id}/items/${item('Mineralwasser').id}`, { counted_qty: 6 }));
  const done = await ok(call('POST', `/api/counts/${count.id}/complete`));
  assert.equal(done.status, 'completed');
  assert.deepEqual([done.summary.counted, done.summary.skipped, done.summary.open], [2, 1, 0]);
  assert.equal((await call('POST', `/api/counts/${count.id}/items/${item('Fanta').id}`, { counted_qty: 1 })).status, 409);
  // zweite Zählung: Soll = letzter Bestand
  const c2 = await ok(call('POST', '/api/counts', {}));
  const w = c2.items.find((i) => i.name.startsWith('Mineralwasser'));
  assert.equal(w.expected_qty, 6);
  const r = await ok(call('POST', `/api/counts/${c2.id}/items/${w.id}`, { counted_qty: 4 }));
  assert.equal(r.items.find((i) => i.id === w.id).difference, -2);
  // Cola steht bereits auf Liste 1 (offen) → kein doppelter Vorschlag in Liste 2
  const cola2 = r.items.find((i) => i.name.startsWith('Coca-Cola'));
  const r2 = await ok(call('POST', `/api/counts/${c2.id}/items/${cola2.id}`, { counted_qty: 1 }));
  assert.equal(r2.items.find((i) => i.id === cola2.id).order, null, 'Doppelbestellschutz');
  const csv = await call('GET', `/api/counts/${c2.id}/export.csv`);
  assert.match(csv.data, /Soll \(letzter Bestand\);Gezählt;Differenz/);
  const hist = await ok(call('GET', '/api/counts'));
  assert.equal(hist.length, 2);
});
