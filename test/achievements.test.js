'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');
const { seedDemo } = require('../src/db/seed');
const { weekIndex } = require('../src/services/achievements');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ek-ach-'));
const { db, server } = createApp({ isSea: false, dataDir: dir, dbFile: path.join(dir, 'db.sqlite'), backupDir: path.join(dir, 'b'), port: 0 }, { log() {}, error() {} });
db.transaction(() => seedDemo(db));
let base; let cookie = '';
async function call(method, url, body) {
  const r = await fetch(base + url, { method, headers: { 'X-EK-Client': '1', 'Content-Type': 'application/json', Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return { status: r.status, data: await r.json() };
}
const ok = async (p) => { const r = await p; assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };
test.before(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await ok(call('POST', '/api/auth/login', { username: 'admin', password: 'admin' }));
});
test.after(() => { server.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('Wochenindex: aufeinanderfolgende Wochen', () => {
  assert.equal(weekIndex(new Date(2026, 10, 23)) + 1, weekIndex(new Date(2026, 10, 30)));
  assert.equal(weekIndex(new Date(2026, 10, 23)), weekIndex(new Date(2026, 10, 29)), 'Mo–So gleiche Woche');
});

test('Neu: Level 1, keine Abzeichen; nach vollständiger Zählung: Erste Zählung + Vollständig', async () => {
  const a0 = await ok(call('GET', '/api/me/achievements'));
  assert.equal(a0.level, 1); assert.equal(a0.earned, 0); assert.equal(a0.xp, 0);
  const loc = db.get("SELECT id FROM locations WHERE name='Getränkelager'").id;
  const c = await ok(call('POST', '/api/counts', { location_ids: [loc] }));
  for (const i of c.items) await ok(call('POST', `/api/counts/${c.id}/items/${i.id}`, { counted_qty: 1 }));
  await ok(call('POST', `/api/counts/${c.id}/finish`));
  const a = await ok(call('GET', '/api/me/achievements'));
  assert.equal(a.stats.articles_counted, 3);
  assert.equal(a.stats.today_counted, 3);
  assert.equal(a.stats.counts_finished, 1);
  assert.equal(a.stats.perfect_counts, 1);
  assert.equal(a.stats.lists_finished, 1);
  assert.equal(a.stats.week_streak, 1);
  const earned = a.badges.filter((b) => b.earned).map((b) => b.key);
  assert.ok(earned.includes('first_count') && earned.includes('perfect'));
  assert.equal(a.xp, 3 + 10 + 15 + 5 + 2 * 25);
  assert.equal(a.level, 2);
  assert.equal(a.badges.find((b) => b.key === 'counted_50').progress, 3);
});

test('Dashboard liefert Lagergesundheit', async () => {
  const d = await ok(call('GET', '/api/dashboard'));
  assert.ok(d.health.total > 0);
  assert.ok(d.health.percent >= 0 && d.health.percent <= 100);
});
