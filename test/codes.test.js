'use strict';
/** Barcodes/QR-Codes je Artikel, Scanner-Suche, Etiketten, Zählung per Scan. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const { createApp } = require('../src/app');
const { seedDemo } = require('../src/db/seed');
const C = require('../src/services/codes');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ek-codes-'));
const { db, server } = createApp({ isSea: false, dataDir: dir, dbFile: path.join(dir, 'db.sqlite'), backupDir: path.join(dir, 'b'), port: 0 }, { log() {}, error() {} });
db.transaction(() => seedDemo(db));
const bytes = [];
const printer = net.createServer((s) => { const c = []; s.on('data', (d) => c.push(d)); s.on('end', () => { bytes.push(Buffer.concat(c)); s.end(); }); s.on('error', () => {}); });
let base; let cookie = '';
async function call(method, url, body) {
  const r = await fetch(base + url, { method, headers: { 'X-EK-Client': '1', 'Content-Type': 'application/json', Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return { status: r.status, data: await r.json() };
}
const ok = async (p) => { const r = await p; assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };
const art = (no) => db.get('SELECT id FROM articles WHERE article_no = ?', no).id;
test.before(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  await new Promise((r) => printer.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await ok(call('POST', '/api/auth/login', { username: 'admin', password: 'admin' }));
});
test.after(() => { server.close(); printer.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('EAN-Prüfziffer und Code-Art', () => {
  assert.equal(C.eanValid('4006381333931'), true);
  assert.equal(C.eanValid('4006381333932'), false);
  assert.equal(C.eanValid('ABC'), null);
  assert.equal(C.guessKind('4006381333931'), 'ean');
  assert.equal(C.guessKind('EK000012'), 'own');
});

test('Codes zuordnen, eindeutig, suchen (auch per Artikelnummer, Groß/Klein egal)', async () => {
  const cola = art('AFG-001'); const fanta = art('AFG-002');
  const c1 = await ok(call('POST', `/api/articles/${cola}/codes`, { code: ' 5449000000996 ' }));
  assert.equal(c1.code, '5449000000996'); assert.equal(c1.kind, 'ean');
  await ok(call('POST', `/api/articles/${cola}/codes`, { code: '5449000131805', kind: 'case' }));
  const dup = await call('POST', `/api/articles/${fanta}/codes`, { code: '5449000000996' });
  assert.equal(dup.status, 409); assert.match(dup.data.error, /Coca-Cola/);
  assert.equal((await call('POST', `/api/articles/${fanta}/codes`, { code: 'afg-001' })).status, 409, 'Artikelnummer eines anderen Artikels');
  assert.equal((await ok(call('GET', '/api/codes/5449000131805'))).article.id, cola);
  assert.equal((await ok(call('GET', '/api/codes/afg-002'))).via, 'article_no');
  assert.equal((await call('GET', '/api/codes/0000')).status, 404);
  const own = await ok(call('POST', `/api/articles/${fanta}/codes/generate`));
  assert.match(own.code, /^EK\d{6}$/);
  assert.equal((await ok(call('POST', `/api/articles/${fanta}/codes/generate`))).existing, true, 'nur einmal erzeugt');
  const list = await ok(call('GET', '/api/articles'));
  assert.deepEqual(list.find((a) => a.id === cola).codes, ['5449000000996', '5449000131805']);
  const codes = await ok(call('GET', `/api/articles/${cola}/codes`));
  await ok(call('DELETE', `/api/articles/${cola}/codes/${codes[1].id}`));
  assert.equal((await call('GET', '/api/codes/5449000131805')).status, 404);
});

test('Zählung: gescannter Artikel außerhalb des Umfangs wird ergänzt', async () => {
  const loc = db.get("SELECT id FROM locations WHERE name='Bar'").id;
  const c = await ok(call('POST', '/api/counts', { location_ids: [loc] }));
  assert.ok(!c.items.some((i) => i.article_id === art('AFG-001')));
  const r = await ok(call('POST', `/api/counts/${c.id}/add-article`, { article_id: art('AFG-001') }));
  const added = r.items.find((i) => i.id === r.added_item_id);
  assert.equal(added.name, 'Coca-Cola 0,2 l');
  assert.equal(added.seq, c.items.length + 1);
  const again = await ok(call('POST', `/api/counts/${c.id}/add-article`, { article_id: art('AFG-001') }));
  assert.equal(again.items.length, r.items.length, 'kein Duplikat');
});

test('Etiketten: fehlende Codes werden erzeugt, Bon mit Code128', async () => {
  const ids = [art('SPI-001'), art('SPI-002')];
  const data = await ok(call('POST', '/api/labels/data', { article_ids: ids }));
  assert.equal(data.length, 2);
  assert.ok(data.every((l) => /^EK\d{6}$/.test(l.code)));
  const p = await ok(call('POST', '/api/printers', { name: 'Bon', protocol: 'escpos_tcp', host: '127.0.0.1', port: printer.address().port }));
  const r = await ok(call('POST', '/api/labels/print', { article_ids: ids, printer_id: p.id, copies: 2 }));
  assert.equal(r.status, 'ok'); assert.equal(r.count, 4);
  await new Promise((res) => setTimeout(res, 100));
  const b = bytes.at(-1);
  const occurrences = b.toString('latin1').split('\x1dk\x49').length - 1;
  assert.equal(occurrences, 4, '4 Barcodes (GS k Code128)');
  assert.ok(b.includes(Buffer.from('{B' + data[0].code)));
});

test('Tabellen-Import mit Barcode-Spalte', async () => {
  const r = await ok(call('POST', '/api/articles/paste-import', { text: '| Artikelname | EAN | MIN | MAX |\n|---|---|---|---|\n| Aperol | 8002230000302 | 2 | 6 |\n| Tonic | 4001234567891 | 6 | 24 |', apply: true }));
  assert.equal(r.counts.error, 0, JSON.stringify(r.rows));
  assert.equal((await ok(call('GET', '/api/codes/8002230000302'))).article.name, 'Aperol');
  assert.equal((await ok(call('GET', '/api/codes/4001234567891'))).article.name, 'Tonic');
});
