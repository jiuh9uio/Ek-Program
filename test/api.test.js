'use strict';
/** End-to-End-Tests der API inkl. Rechte, Bestandsbuchungen, Druck (simulierter Bondrucker), Sicherung. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const { createApp } = require('../src/app');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ek-test-'));
const config = { isSea: false, dataDir: dir, dbFile: path.join(dir, 'db.sqlite'), backupDir: path.join(dir, 'backups'), port: 0 };
const quiet = { log() {}, error() {} };
const { db, server } = createApp(config, quiet);
let base;

class Client {
  constructor() { this.cookie = ''; }
  async req(method, url, body, headers = {}) {
    const res = await fetch(base + url, {
      method, headers: { 'X-EK-Client': '1', 'Content-Type': 'application/json', Cookie: this.cookie, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const sc = res.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data };
  }
  get(u) { return this.req('GET', u); }
  post(u, b = {}) { return this.req('POST', u, b); }
  put(u, b = {}) { return this.req('PUT', u, b); }
  del(u) { return this.req('DELETE', u); }
}
const ok = (r) => { assert.ok(r.status === 200, `HTTP ${r.status}: ${JSON.stringify(r.data)}`); return r.data; };

// Simulierter ESC/POS-Netzwerkdrucker
const received = [];
const fakePrinter = net.createServer((sock) => {
  const chunks = [];
  sock.on('data', (d) => {
    chunks.push(d);
    if (d.length === 9 && d[0] === 0x10 && d[1] === 0x04) sock.write(Buffer.from([0x12, 0x12, 0x12])); // DLE EOT → bereit
  });
  sock.on('end', () => { received.push(Buffer.concat(chunks)); sock.end(); });
  sock.on('error', () => {});
});
// Simulierter Epson-ePOS-Drucker
const eposBodies = [];
const fakeEpos = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => { b += c; });
  req.on('end', () => {
    eposBodies.push(b);
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end('<?xml version="1.0"?><s:Envelope><s:Body><response success="true" code="" status="251658262" battery="0"/></s:Body></s:Envelope>');
  });
});

const admin = new Client();
const svc = new Client();
const ids = {};

test.before(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await new Promise((r) => fakePrinter.listen(0, '127.0.0.1', r));
  await new Promise((r) => fakeEpos.listen(0, '127.0.0.1', r));
});
test.after(() => { server.close(); fakePrinter.close(); fakeEpos.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('Sicherheit: ohne Anmeldung 401, ohne CSRF-Header 403, falsches Passwort 401', async () => {
  const c = new Client();
  assert.equal((await c.get('/api/articles')).status, 401);
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"username":"admin","password":"admin"}' });
  assert.equal(r.status, 403);
  assert.equal((await c.post('/api/auth/login', { username: 'admin', password: 'falsch' })).status, 401);
});

test('Anmeldung Administrator + Stammdaten anlegen', async () => {
  const me = ok(await admin.post('/api/auth/login', { username: 'admin', password: 'admin' }));
  assert.equal(me.user.role, 'admin');
  const cats = ok(await admin.get('/api/categories'));
  assert.equal(cats.length, 12);
  ids.cat = cats.find((c) => c.name === 'Alkoholfreie Getränke').id;
  ids.unit = ok(await admin.get('/api/units')).find((u) => u.name === 'Kasten').id;
  ids.loc = ok(await admin.get('/api/locations'))[0].id;
  ids.sup = ok(await admin.post('/api/suppliers', { name: 'Getränke Huber', min_order_value: 150, shipping_cost: 5, order_days: '1,4', delivery_days: [2, 5] })).id;
  // Validierung
  assert.equal((await admin.post('/api/suppliers', { name: '' })).status, 422);
  assert.equal((await admin.post('/api/suppliers', { name: 'X', email: 'kein-mail' })).status, 422);
  assert.equal((await admin.post('/api/suppliers', { name: 'Getränke Huber' })).status, 409);
});

test('Artikel anlegen, validieren, duplizieren, archivieren', async () => {
  const a = ok(await admin.post('/api/articles', { article_no: 'AFG-1', name: 'Coca-Cola', category_id: ids.cat, supplier_id: ids.sup, location_id: ids.loc, unit_id: ids.unit, price_net: '14,90', min_stock: 3, max_stock: 10, order_step: 1 }));
  ids.coke = a.id;
  assert.equal(a.price_net, 14.9);
  assert.equal(a.current_stock, null);
  assert.equal(a.status, 'unchecked');
  assert.equal((await admin.post('/api/articles', { article_no: 'AFG-1', name: 'Doppelt' })).status, 409);
  assert.equal((await admin.post('/api/articles', { article_no: 'X', name: 'X', min_stock: 5, max_stock: 2 })).status, 422);
  assert.equal((await admin.post('/api/articles', { article_no: 'Y', name: 'Y', order_step: 0 })).status, 422);
  assert.equal((await admin.post('/api/articles', { article_no: 'Z', name: 'Z', price_net: -1 })).status, 422);
  ids.fanta = ok(await admin.post('/api/articles', { article_no: 'AFG-2', name: 'Fanta', category_id: ids.cat, supplier_id: ids.sup, unit_id: ids.unit, price_net: 14.9, min_stock: 2, max_stock: 6 })).id;
  const dup = ok(await admin.post(`/api/articles/${ids.fanta}/duplicate`));
  assert.equal(dup.article_no, 'AFG-2-K');
  ok(await admin.post(`/api/articles/${dup.id}/archive`, { archived: true }));
  assert.ok(!ok(await admin.get('/api/articles')).some((x) => x.id === dup.id));
  ok(await admin.del(`/api/articles/${dup.id}`)); // ohne Historie löschbar
});

test('Servicemitarbeiter anlegen und Rechte prüfen', async () => {
  ok(await admin.post('/api/users', { username: 'anna', display_name: 'Anna', role: 'service', password: '1234' }));
  assert.equal((await admin.post('/api/users', { username: 'kurz', display_name: 'K', role: 'service', password: '12' })).status, 422);
  ok(await svc.post('/api/auth/login', { username: 'anna', password: '1234' }));
  assert.equal((await svc.post('/api/articles', { article_no: 'S', name: 'S' })).status, 403);
  assert.equal((await svc.put(`/api/articles/${ids.coke}`, { min_stock: 1 })).status, 403);
  assert.equal((await svc.post('/api/suppliers', { name: 'S' })).status, 403);
  assert.equal((await svc.post('/api/printers', { name: 'P', protocol: 'escpos_tcp', host: '1.2.3.4' })).status, 403);
  assert.equal((await svc.get('/api/users')).status, 403);
  assert.equal((await svc.get('/api/audit')).status, 403);
  const d = ok(await svc.get('/api/dashboard'));
  assert.equal(d.stats, null, 'Service sieht keine Kostenstatistik');
});

test('Bestandskontrolle: Ist 2 → automatische Empfehlung 8 in Entwurfsliste', async () => {
  const r = ok(await svc.post('/api/mode/stock', { article_id: ids.coke, stock: 2 }));
  assert.equal(r.article.current_stock, 2);
  assert.equal(r.article.recommended, 8);
  assert.equal(r.article.status, 'below');
  assert.equal(r.article.item.qty, 8);
  ids.draft = r.draft.id;
  // Bestand korrigiert auf 5 → keine Empfehlung mehr → automatisch übernommene Position wird entfernt
  const r2 = ok(await svc.post('/api/mode/stock', { article_id: ids.coke, stock: 5 }));
  assert.equal(r2.article.item, null);
  assert.equal(r2.article.status, 'ok');
  const r3 = ok(await svc.post('/api/mode/stock', { article_id: ids.coke, stock: 2 }));
  assert.equal(r3.article.item.qty, 8);
  // Fanta nicht kontrolliert → bleibt grau, keine Empfehlung
  const mode = ok(await svc.get('/api/mode'));
  const fanta = mode.articles.find((a) => a.id === ids.fanta);
  assert.equal(fanta.status, 'unchecked');
  assert.equal(fanta.recommended, 0);
  assert.equal(fanta.current_stock, null);
});

test('Schnellauswahl: MAX-Grenze für Service, Überschreitung nur für Admin', async () => {
  const bad = await svc.post('/api/mode/item', { article_id: ids.fanta, qty: 7 });
  assert.equal(bad.status, 422);
  assert.equal(bad.data.code, 'EXCEEDS_MAX');
  ok(await svc.post('/api/mode/item', { article_id: ids.fanta, qty: 6 }));
  ok(await admin.post('/api/mode/item', { article_id: ids.fanta, qty: 12 })); // Admin darf MAX überschreiten
  const list = ok(await admin.get(`/api/lists/${ids.draft}`));
  assert.equal(list.items.find((i) => i.article_id === ids.fanta).qty, 12);
  ok(await svc.post('/api/mode/item', { article_id: ids.fanta, qty: 2 }));
  assert.equal((await svc.post('/api/mode/item', { article_id: ids.fanta, qty: -1 })).status, 422);
});

test('Nicht verfügbar / Bestand ausreichend / Bemerkung', async () => {
  const n = ok(await svc.post('/api/mode/note', { article_id: ids.fanta, note: 'nur Glas' }));
  assert.equal(n.article.item.note, 'nur Glas');
  const u = ok(await svc.post('/api/mode/unavailable', { article_id: ids.fanta, unavailable: true, note: 'Lieferengpass' }));
  assert.ok(u.article.unavailable_since);
  assert.equal(u.article.item, null, 'Position wird bei "nicht verfügbar" entfernt');
  const back = ok(await svc.post('/api/mode/unavailable', { article_id: ids.fanta, unavailable: false }));
  assert.equal(back.article.unavailable_since, null);
  const okr = ok(await svc.post('/api/mode/ok', { article_id: ids.fanta }));
  assert.equal(okr.article.status, 'ok');
  assert.equal(okr.article.current_stock, null, '"ausreichend" setzt keinen erfundenen Bestand');
});

test('Doppelbestellschutz: neue Liste mit Empfehlungen übernimmt Coca-Cola nicht erneut', async () => {
  const l = ok(await svc.post('/api/lists', { title: 'Zweite', with_recommendations: true }));
  assert.ok(!l.items.some((i) => i.article_id === ids.coke));
  const add = ok(await svc.post(`/api/lists/${l.id}/items`, { article_id: ids.fanta, qty: 2 }));
  assert.equal(add.merged, false);
  const add2 = ok(await svc.post(`/api/lists/${l.id}/items`, { article_id: ids.fanta, qty: 1 }));
  assert.equal(add2.merged, true, 'gleicher Artikel wird zusammengeführt');
  assert.equal(add2.list.items.find((i) => i.article_id === ids.fanta).qty, 3);
  // Listen zusammenführen
  const m = ok(await svc.post(`/api/lists/${ids.draft}/merge`, { source_id: l.id }));
  assert.equal(m.list.items.length, 2);
  const src = ok(await svc.get(`/api/lists/${l.id}`));
  assert.equal(src.status, 'cancelled');
});

test('Workflow: Einkaufsbereit → Freigabe (nur Admin) → Wareneingang → Abschluss → Wiedereröffnen', async () => {
  const sup = ok(await admin.get(`/api/suppliers/${ids.sup}`));
  ok(await admin.put(`/api/suppliers/${ids.sup}`, { ...sup, min_order_value: 300 }));
  const lst = ok(await svc.get(`/api/lists/${ids.draft}`));
  const g = lst.supplier_groups[0];
  assert.equal(g.below_min_order, true, 'Mindestbestellwert-Warnung');
  ok(await svc.post(`/api/lists/${ids.draft}/status`, { status: 'ready' }));
  assert.equal((await svc.post(`/api/lists/${ids.draft}/status`, { status: 'ordered' })).status, 403);
  const ord = ok(await admin.post(`/api/lists/${ids.draft}/status`, { status: 'ordered' }));
  assert.ok(ord.warnings.some((w) => w.includes('Mindestbestellwert')));
  assert.equal((await svc.put(`/api/lists/${ids.draft}/items/${lst.items[0].id}`, { qty: 1 })).status, 409, 'Service kann bestellte Liste nicht ändern');
  // Bestellt → Status blau, keine neue Empfehlung
  const mode = ok(await svc.get('/api/mode'));
  const coke = mode.articles.find((a) => a.id === ids.coke);
  assert.equal(coke.status, 'ordered');
  assert.equal(coke.on_order, 8);
  assert.equal(coke.recommended, 0);

  const cokeItem = lst.items.find((i) => i.article_id === ids.coke);
  assert.equal((await svc.post(`/api/lists/${ids.draft}/receive`, { entries: [{ item_id: cokeItem.id, qty: 5 }] })).status, 403);
  const r1 = ok(await admin.post(`/api/lists/${ids.draft}/receive`, { entries: [{ item_id: cokeItem.id, qty: 5, unit_price_actual: '15,10' }] }));
  assert.equal(r1.status, 'partial');
  let a = ok(await admin.get(`/api/articles/${ids.coke}`));
  assert.equal(a.current_stock, 7);
  assert.equal(a.on_order, 3);
  const fantaItem = lst.items.find((i) => i.article_id === ids.fanta);
  const r2 = ok(await admin.post(`/api/lists/${ids.draft}/receive`, { entries: [{ item_id: cokeItem.id, qty: 3 }, { item_id: fantaItem.id, qty: fantaItem.qty, unit_price_actual: 14.9, update_price: true }] }));
  assert.equal(r2.status, 'delivered');
  a = ok(await admin.get(`/api/articles/${ids.coke}`));
  assert.equal(a.current_stock, 10);
  assert.equal(a.on_order, 0);
  const fanta = ok(await admin.get(`/api/articles/${ids.fanta}`));
  assert.equal(fanta.current_stock, null, 'unbekannter Bestand bleibt unbekannt');
  assert.equal((await admin.post(`/api/lists/${ids.draft}/receive`, { entries: [{ item_id: cokeItem.id, qty: -20 }] })).status, 422);
  assert.equal((await admin.post(`/api/lists/${ids.draft}/status`, { status: 'cancelled' })).status, 409);
  const cl = ok(await admin.post(`/api/lists/${ids.draft}/status`, { status: 'closed', actual_cost: '230,50' }));
  assert.equal(cl.list.actual_cost, 230.5);
  const ro = ok(await admin.post(`/api/lists/${ids.draft}/status`, { status: 'reopen' }));
  assert.equal(ro.status, 'delivered');
  ok(await admin.post(`/api/lists/${ids.draft}/status`, { status: 'closed' }));
  const final = ok(await admin.get(`/api/lists/${ids.draft}`));
  assert.ok(final.events.length >= 8, 'Änderungshistorie wird protokolliert');
  // Dashboard-Statistik
  const d = ok(await admin.get('/api/dashboard?period=1'));
  assert.ok(d.stats.monthly.at(-1).value > 0);
  assert.equal(d.stats.by_supplier[0].name, 'Getränke Huber');
  assert.ok(Math.abs(d.stats.by_supplier[0].value - (8 * 15.1 + 3 * 14.9)) < 0.01, "Nachlieferung übernimmt den tatsächlichen Preis");
});

test('Drucken: ESC/POS über TCP, Status, Fehler, Nachdruck, ePOS, separate Lieferantenbons', async () => {
  const port = fakePrinter.address().port;
  const p = ok(await admin.post('/api/printers', { name: 'Bar TM-m30II', protocol: 'escpos_tcp', host: '127.0.0.1', port, paper_width: 80 }));
  assert.equal(p.is_default, 1, 'erster Drucker wird Standard');
  assert.equal(p.chars_per_line, 48);
  assert.equal((await admin.post('/api/printers', { name: 'X', protocol: 'escpos_tcp', host: 'bad host;' })).status, 422);
  const st = ok(await admin.get(`/api/printers/${p.id}/status`));
  assert.equal(st.online, true);
  const t = ok(await admin.post(`/api/printers/${p.id}/test`));
  assert.equal(t.status, 'ok');

  const l = ok(await svc.post('/api/lists', { title: 'Druck' }));
  // Bestand 10 = MAX → Service darf nichts mehr bestellen, Admin schon
  assert.equal((await svc.post(`/api/lists/${l.id}/items`, { article_id: ids.coke, qty: 2 })).status, 422);
  ok(await admin.post(`/api/lists/${l.id}/items`, { article_id: ids.coke, qty: 2 }));
  const before = received.length;
  const pr = ok(await svc.post(`/api/lists/${l.id}/print`, { group_by: 'category' }));
  assert.equal(pr.results[0].status, 'ok');
  await new Promise((r) => setTimeout(r, 100));
  const bytes = received.at(-1);
  assert.ok(received.length > before);
  assert.ok(bytes.includes(Buffer.from('SERVICE-EINKAUF')));
  assert.ok(bytes.includes(Buffer.from('[ ] Coca-Cola')));
  assert.ok(bytes.includes(Buffer.from([0x1D, 0x56, 0x42])), 'Papierschnitt');

  const prev = ok(await svc.post(`/api/lists/${l.id}/preview`, { per_supplier: true }));
  assert.equal(prev.bons.length, 1);
  assert.match(prev.bons[0].text, /Lieferant: Getränke Huber/);

  // Fehlerfall: Drucker nicht erreichbar
  const dead = ok(await admin.post('/api/printers', { name: 'Offline', protocol: 'escpos_tcp', host: '127.0.0.1', port: 1 }));
  const pe = ok(await svc.post(`/api/lists/${l.id}/print`, { printer_id: dead.id }));
  assert.equal(pe.results[0].status, 'error');
  assert.match(pe.results[0].error, /verweigert|nicht erreichbar|Zeitüberschreitung/);
  const ds = ok(await admin.get(`/api/printers/${dead.id}/status`));
  assert.equal(ds.online, false);
  // Nachdruck des fehlgeschlagenen Auftrags auf funktionierendem Drucker
  const re = ok(await svc.post(`/api/print-jobs/${pe.results[0].job_id}/reprint`, { printer_id: p.id }));
  assert.equal(re.status, 'ok');
  const detail = ok(await svc.get(`/api/lists/${l.id}`));
  assert.equal(detail.prints.length, 3, 'Druckhistorie');

  // Epson ePOS-Print
  const ep = ok(await admin.post('/api/printers', { name: 'ePOS', protocol: 'epos_http', host: '127.0.0.1', port: fakeEpos.address().port }));
  const er = ok(await svc.post(`/api/lists/${l.id}/print`, { printer_id: ep.id, per_supplier: true }));
  assert.equal(er.results[0].status, 'ok');
  assert.match(eposBodies.at(-1), /Coca-Cola/);
  assert.equal(ok(await admin.get(`/api/printers/${ep.id}/status`)).online, true);

  // PDF
  const pdf = await svc.get(`/api/lists/${l.id}/pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.data.subarray(0, 5).toString(), '%PDF-');
  // Leere Liste kann nicht gedruckt werden
  const empty = ok(await svc.post('/api/lists', {}));
  assert.equal((await svc.post(`/api/lists/${empty.id}/print`, {})).status, 422);
});

test('Datensicherung und Wiederherstellung', async () => {
  const b = ok(await admin.post('/api/backups'));
  assert.ok(fs.existsSync(path.join(config.backupDir, b.name)));
  const before = ok(await admin.get('/api/suppliers')).length;
  ok(await admin.post('/api/suppliers', { name: 'Nach Sicherung' }));
  const r = ok(await admin.post(`/api/backups/${b.name}/restore`));
  assert.ok(r.safety_backup);
  assert.equal(ok(await admin.get('/api/suppliers')).length, before);
  assert.equal((await admin.post('/api/backups/..%2F..%2Fetc/restore')).status, 422);
  assert.equal((await svc.post('/api/backups')).status, 403);
});

test('CSV-Export/-Import und Protokoll', async () => {
  const csv = await admin.get('/api/articles/export.csv');
  assert.equal(csv.status, 200);
  const text = csv.data.toString('utf8');
  assert.match(text, /Artikelnummer;Artikelname/);
  const imp = ok(await admin.post('/api/articles/import', { csv: 'Artikelnummer;Artikelname;Kategorie;MIN;MAX;EK netto\nNEU-1;Tonic Water;Alkoholfreie Getränke;2;8;0,85\nAFG-1;Coca-Cola 0,2 l;;3;12;14,90\n;ohne Nummer;;;;' }));
  assert.equal(imp.created, 1);
  assert.equal(imp.updated, 1);
  assert.equal(imp.errors.length, 1);
  const log = ok(await admin.get('/api/audit?limit=1000'));
  if (!log.some((e) => e.action === 'Wareneingang gebucht')) console.log(log.map((e) => e.action));
  assert.ok(log.some((e) => e.action === 'Artikel importiert (CSV)'));
  assert.ok(log.some((e) => e.action === 'Wareneingang gebucht'));
  // letzter Admin darf nicht entfernt werden
  const me = ok(await admin.get('/api/auth/me'));
  assert.equal((await admin.put(`/api/users/${me.user.id}`, { username: 'admin', display_name: 'A', role: 'service' })).status, 409);
});
