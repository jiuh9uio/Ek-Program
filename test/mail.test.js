'use strict';
/** E-Mail-Versand (simulierter SMTP-Server), Fertigstellen nach Zählung, Schnellzugriff fertiger Listen. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const { createApp } = require('../src/app');
const { seedDemo } = require('../src/db/seed');

// --- simulierter SMTP-Server (AUTH PLAIN/LOGIN, kein TLS) ---
const mails = [];
function fakeSmtp({ authMethods = 'PLAIN LOGIN', password = 'geheim' } = {}) {
  return net.createServer((s) => {
    let data = null; let state = 'cmd'; let user = '';
    const cur = { rcpt: [] };
    s.write('220 fake.smtp ESMTP\r\n');
    let buf = '';
    s.on('data', (d) => {
      buf += d.toString('latin1');
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (state === 'data') {
          if (line === '.') { state = 'cmd'; cur.raw = data.join('\r\n'); mails.push({ ...cur }); s.write('250 OK queued\r\n'); } else data.push(line.startsWith('..') ? line.slice(1) : line);
          continue;
        }
        if (state === 'login-user') { user = Buffer.from(line, 'base64').toString(); state = 'login-pass'; s.write('334 UGFzc3dvcmQ6\r\n'); continue; }
        if (state === 'login-pass') { state = 'cmd'; cur.auth = `${user}:${Buffer.from(line, 'base64').toString()}`; s.write(Buffer.from(line, 'base64').toString() === password ? '235 ok\r\n' : '535 bad\r\n'); continue; }
        const [cmd, ...rest] = line.split(' ');
        switch (cmd.toUpperCase()) {
          case 'EHLO': s.write(`250-fake.smtp\r\n250-AUTH ${authMethods}\r\n250 8BITMIME\r\n`); break;
          case 'AUTH':
            if (rest[0] === 'PLAIN') { const [, u, p] = Buffer.from(rest[1], 'base64').toString().split('\0'); cur.auth = `${u}:${p}`; s.write(p === password ? '235 ok\r\n' : '535 bad\r\n'); }
            else { state = 'login-user'; s.write('334 VXNlcm5hbWU6\r\n'); }
            break;
          case 'MAIL': cur.from = line; s.write('250 ok\r\n'); break;
          case 'RCPT': cur.rcpt.push(line.match(/<(.+)>/)[1]); s.write('250 ok\r\n'); break;
          case 'DATA': data = []; state = 'data'; s.write('354 go\r\n'); break;
          case 'QUIT': s.write('221 bye\r\n'); s.end(); break;
          default: s.write('500 ?\r\n');
        }
      }
    });
    s.on('error', () => {});
  });
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ek-mail-'));
const { db, server } = createApp({ isSea: false, dataDir: dir, dbFile: path.join(dir, 'db.sqlite'), backupDir: path.join(dir, 'b'), port: 0 }, { log() {}, error() {} });
db.transaction(() => seedDemo(db));
const smtp = fakeSmtp();
const smtpLogin = fakeSmtp({ authMethods: 'LOGIN' });
let base; let cookie = '';
async function call(method, url, body) {
  const r = await fetch(base + url, { method, headers: { 'X-EK-Client': '1', 'Content-Type': 'application/json', Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return { status: r.status, data: (r.headers.get('content-type') || '').includes('json') ? await r.json() : await r.text() };
}
const ok = async (p) => { const r = await p; assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };

test.before(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  await new Promise((r) => smtp.listen(0, '127.0.0.1', r));
  await new Promise((r) => smtpLogin.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await ok(call('POST', '/api/auth/login', { username: 'admin', password: 'admin' }));
});
test.after(() => { server.close(); smtp.close(); smtpLogin.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

let count; let listId;
test('Zählen → Fertigstellen → Liste ist einkaufsbereit und im Schnellzugriff', async () => {
  const sup = db.get("SELECT id FROM suppliers WHERE name='Großmarkt (Abholung)'").id;
  count = await ok(call('POST', '/api/counts', { supplier_ids: [sup] }));
  listId = count.list_id;
  const ap = count.items.find((i) => i.name === 'Aperol');
  await ok(call('POST', `/api/counts/${count.id}/items/${ap.id}`, { counted_qty: 0 }));
  const fin = await ok(call('POST', `/api/counts/${count.id}/finish`));
  assert.equal(fin.status, 'completed');
  assert.equal(fin.list_status, 'ready');
  const recent = await ok(call('GET', '/api/lists-finished'));
  assert.equal(recent.days, 2);
  assert.equal(recent.lists[0].id, listId);
  // älter als die Anzeigedauer → nicht mehr im Schnellzugriff, aber weiterhin in der Historie
  db.run('UPDATE purchase_lists SET ready_at = ? WHERE id = ?', new Date(Date.now() - 3 * 86400e3).toISOString(), listId);
  assert.equal((await ok(call('GET', '/api/lists-finished'))).lists.length, 0);
  assert.ok((await ok(call('GET', '/api/lists?status=all'))).some((l) => l.id === listId));
  db.run('UPDATE purchase_lists SET ready_at = ? WHERE id = ?', new Date().toISOString(), listId);
  // erneutes Fertigstellen ist harmlos
  assert.equal((await ok(call('POST', `/api/counts/${count.id}/finish`))).list_status, 'ready');
});

test('Ohne SMTP-Konfiguration: verständliche Meldung', async () => {
  const d = await ok(call('GET', `/api/lists/${listId}/email-defaults`));
  assert.equal(d.configured, false);
  assert.match(d.message, /Aperol: 1 Karton|Aperol: \d+ Flaschen/);
  const r = await call('POST', `/api/lists/${listId}/email`, { to: 'chef@hotel.example', subject: 'x', message: 'y' });
  assert.equal(r.status, 422);
  assert.match(r.data.error, /nicht eingerichtet/);
});

test('E-Mail mit PDF-Anhang über SMTP (AUTH PLAIN)', async () => {
  await ok(call('PUT', '/api/settings/mail', { smtp_host: '127.0.0.1', smtp_port: smtp.address().port, smtp_secure: 'none', smtp_user: 'ek@hotel.example', smtp_pass: 'geheim', smtp_from: 'ek@hotel.example', smtp_from_name: 'Hotel Größe', mail_default_to: 'chef@hotel.example' }));
  const st = await ok(call('GET', '/api/settings'));
  assert.equal(st.smtp_has_password, true);
  assert.equal(st.smtp_pass, undefined, 'Passwort wird nie ausgeliefert');
  const d = await ok(call('GET', `/api/lists/${listId}/email-defaults`));
  assert.equal(d.configured, true);
  assert.equal(d.default_to, 'chef@hotel.example');
  const r = await ok(call('POST', `/api/lists/${listId}/email`, { to: 'chef@hotel.example; einkauf@hotel.example', cc: 'bar@hotel.example', subject: 'Einkaufsliste – Großmarkt', message: 'Hallo\n.\nZeile mit Punkt' }));
  assert.deepEqual(r.to, ['chef@hotel.example', 'einkauf@hotel.example']);
  const m = mails.at(-1);
  assert.equal(m.auth, 'ek@hotel.example:geheim');
  assert.deepEqual(m.rcpt, ['chef@hotel.example', 'einkauf@hotel.example', 'bar@hotel.example']);
  assert.match(m.raw, /Subject: =\?UTF-8\?B\?/);
  assert.match(m.raw, /From: =\?UTF-8\?B\?[^?]+\?= <ek@hotel.example>/);
  const b64 = m.raw.split('Content-Disposition: attachment')[1].split('\r\n\r\n')[1].split('--ek_')[0].replace(/\s/g, '');
  const pdf = Buffer.from(b64, 'base64');
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.toString('latin1').trimEnd().endsWith('%%EOF'));
  const text = Buffer.from(m.raw.split('Content-Transfer-Encoding: base64\r\n\r\n')[1].split('--ek_')[0].replace(/\s/g, ''), 'base64').toString('utf8');
  assert.equal(text, 'Hallo\n.\nZeile mit Punkt', 'Punkt-Zeile übersteht Dot-Stuffing');
  const list = await ok(call('GET', `/api/lists/${listId}`));
  assert.ok(list.events.some((e) => e.action === 'E-Mail versendet'));
});

test('AUTH LOGIN, falsches Passwort, ungültige Adressen, Testmail', async () => {
  await ok(call('PUT', '/api/settings/mail', { smtp_host: '127.0.0.1', smtp_port: smtpLogin.address().port, smtp_secure: 'none', smtp_user: 'u', smtp_from: 'ek@hotel.example' }));
  const t = await ok(call('POST', '/api/settings/mail/test', { to: 'chef@hotel.example' }));
  assert.deepEqual(t.to, ['chef@hotel.example']);
  assert.equal(mails.at(-1).auth, 'u:geheim', 'Passwort bleibt erhalten, wenn leer gelassen');
  await ok(call('PUT', '/api/settings/mail', { smtp_host: '127.0.0.1', smtp_port: smtp.address().port, smtp_secure: 'none', smtp_user: 'u', smtp_pass: 'falsch', smtp_from: 'ek@hotel.example' }));
  const bad = await call('POST', '/api/settings/mail/test', { to: 'chef@hotel.example' });
  assert.equal(bad.status, 422);
  assert.match(bad.data.error, /Anmeldung am Mailserver fehlgeschlagen/);
  assert.equal((await call('POST', `/api/lists/${listId}/email`, { to: 'kein-mail', subject: 'x', message: 'y' })).status, 422);
  assert.equal((await call('PUT', '/api/settings/mail', { smtp_host: 'mail.example', smtp_from: 'ungültig' })).status, 422);
  await ok(call('PUT', '/api/settings/mail', { smtp_host: '127.0.0.1', smtp_port: 1, smtp_secure: 'none', smtp_from: 'ek@hotel.example' }));
  const refused = await call('POST', '/api/settings/mail/test', { to: 'chef@hotel.example' });
  assert.match(refused.data.error, /verweigert die Verbindung/);
});
