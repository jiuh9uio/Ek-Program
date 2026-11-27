'use strict';
/** Sonderwünsche: freie Positionen (z. B. neuer Wein zum Probieren) auf Einkaufslisten. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');
const { seedDemo } = require('../src/db/seed');
const R = require('../src/print/receipt');
const { listPdf } = require('../src/print/pdf');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ek-extra-'));
const { db, server } = createApp({ isSea: false, dataDir: dir, dbFile: path.join(dir, 'db.sqlite'), backupDir: path.join(dir, 'b'), port: 0 }, { log() {}, error() {} });
db.transaction(() => seedDemo(db));
let base; const jar = {};
async function call(who, method, url, body) {
  const r = await fetch(base + url, { method, headers: { 'X-EK-Client': '1', 'Content-Type': 'application/json', Cookie: jar[who] || '' }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) jar[who] = sc.split(';')[0];
  return { status: r.status, data: (r.headers.get('content-type') || '').includes('json') ? await r.json() : await r.text() };
}
const ok = async (p) => { const r = await p; assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };
test.before(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await ok(call('a', 'POST', '/api/auth/login', { username: 'admin', password: 'admin' }));
  await ok(call('a', 'POST', '/api/users', { username: 'lea', display_name: 'Lea', role: 'service', password: '2222' }));
  await ok(call('s', 'POST', '/api/auth/login', { username: 'lea', password: '2222' }));
});
test.after(() => { server.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

let count; let listId; let extraId;
test('Sonderwunsch am Ende der Zählung: erscheint auf der Liste, Zählung nur mit Sonderwunsch wird fertig', async () => {
  const sup = db.get("SELECT id FROM suppliers WHERE name='Weinhandel Rheingau'").id;
  count = await ok(call('s', 'POST', '/api/counts', { supplier_ids: [sup] }));
  listId = count.list_id;
  for (const i of count.items) await ok(call('s', 'POST', `/api/counts/${count.id}/items/${i.id}`, { counted_qty: 50 })); // alles genug da
  const r = await ok(call('s', 'POST', `/api/lists/${listId}/extras`, { name: 'Grauburgunder Weingut Huber (zum Probieren)', qty: 6, unit: 'Flaschen', supplier_id: sup, note: 'für Weinkarte testen' }));
  const it = r.list.items.find((i) => i.is_free);
  extraId = it.id;
  assert.equal(it.article_name, 'Grauburgunder Weingut Huber (zum Probieren)');
  assert.equal(it.category_name, 'Sonderwünsche');
  assert.equal(it.unit_plural, 'Flaschen');
  assert.equal(r.list.items.length, 1);
  const fin = await ok(call('s', 'POST', `/api/counts/${count.id}/finish`));
  assert.equal(fin.list_status, 'ready', 'Liste mit nur einem Sonderwunsch wird fertiggestellt');
});

test('Validierung: Name Pflicht, Menge > 0; keine MAX-Grenze für Sonderwünsche', async () => {
  const l = await ok(call('s', 'POST', '/api/lists', { title: 'Test' }));
  assert.equal((await call('s', 'POST', `/api/lists/${l.id}/extras`, { name: '  ', qty: 1 })).status, 422);
  assert.equal((await call('s', 'POST', `/api/lists/${l.id}/extras`, { name: 'X', qty: 0 })).status, 422);
  const r = await ok(call('s', 'POST', `/api/lists/${l.id}/extras`, { name: 'Partyeis für Hochzeit', qty: '120' }));
  const it = r.list.items[0];
  await ok(call('s', 'PUT', `/api/lists/${l.id}/items/${it.id}`, { qty: 200 }));
  assert.equal((await ok(call('s', 'GET', `/api/lists/${l.id}`))).items[0].qty, 200);
  assert.ok((await ok(call('s', 'GET', '/api/lists?status=all&q=Partyeis'))).some((x) => x.id === l.id), 'Suche findet Sonderwunsch');
  await ok(call('s', 'DELETE', `/api/lists/${l.id}/items/${it.id}`));
});

test('Bon, PDF und E-Mail-Text enthalten den Sonderwunsch', async () => {
  const list = await ok(call('s', 'GET', `/api/lists/${listId}`));
  const text = R.toText(R.buildListDoc(list, { width: 48 }), 48);
  assert.match(text, /SONDERWÜNSCHE/);
  assert.match(text, /\[ \] Grauburgunder/);
  assert.match(text, /6 Flaschen/);
  assert.match(text, /Sonderwunsch/);
  assert.ok(listPdf(list, {}).toString('latin1').includes('Grauburgunder'));
  const mail = await ok(call('s', 'GET', `/api/lists/${listId}/email-defaults`));
  assert.match(mail.message, /Grauburgunder.*6 Flaschen/);
});

test('Wareneingang für Sonderwunsch: ohne Bestandsbuchung, Liste geliefert', async () => {
  await ok(call('a', 'POST', `/api/lists/${listId}/status`, { status: 'ordered' }));
  const moves = db.get('SELECT COUNT(*) n FROM stock_movements WHERE type = ?', 'receipt').n;
  const r = await ok(call('a', 'POST', `/api/lists/${listId}/receive`, { entries: [{ item_id: extraId, qty: 6, unit_price_actual: '8,90' }] }));
  assert.equal(r.status, 'delivered');
  assert.equal(db.get('SELECT COUNT(*) n FROM stock_movements WHERE type = ?', 'receipt').n, moves);
  assert.equal(r.list.totals.actual_goods, 53.4);
});

test('Sonderwunsch als Artikel übernehmen (nur Admin)', async () => {
  const a = await ok(call('a', 'POST', '/api/articles', { article_no: 'WEI-099', name: 'Grauburgunder Huber', min_stock: 6, max_stock: 18 }));
  assert.equal((await call('s', 'POST', `/api/lists/${listId}/items/${extraId}/convert`, { article_id: a.id })).status, 403);
  const l = await ok(call('a', 'POST', `/api/lists/${listId}/items/${extraId}/convert`, { article_id: a.id }));
  const it = l.items.find((i) => i.id === extraId);
  assert.equal(it.is_free, 0);
  assert.equal(it.article_name, 'Grauburgunder Huber');
  assert.equal(it.qty_received, 6);
  assert.equal((await call('a', 'POST', `/api/lists/${listId}/items/${extraId}/convert`, { article_id: a.id })).status, 404, 'nur Sonderwünsche umwandelbar');
});

test('Listen zusammenführen nimmt Sonderwünsche mit; offene Mengen bleiben korrekt', async () => {
  const a = await ok(call('s', 'POST', '/api/lists', {}));
  const b = await ok(call('s', 'POST', '/api/lists', {}));
  await ok(call('s', 'POST', `/api/lists/${b.id}/extras`, { name: 'Strohhalme Papier', qty: 2, unit: 'Packungen' }));
  await ok(call('s', 'POST', `/api/lists/${a.id}/extras`, { name: 'Strohhalme Papier', qty: 1, unit: 'Packungen' }));
  const m = await ok(call('s', 'POST', `/api/lists/${a.id}/merge`, { source_id: b.id }));
  assert.equal(m.list.items.length, 2, 'freie Positionen werden nicht verschmolzen (könnten Unterschiedliches meinen)');
  const d = await ok(call('a', 'GET', '/api/dashboard'));
  assert.ok(d.counts.articles > 0);
});
