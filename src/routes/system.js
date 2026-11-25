'use strict';
/** Drucker, Dashboard, Protokoll, Einstellungen, Datensicherung. */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { notFound, unprocessable, conflict, RawResponse } = require('../http/core');
const v = require('../http/validate');
const { audit, diff } = require('../services/audit');
const P = require('../services/printing');
const transport = require('../print/transport');
const B = require('../services/backup');
const { dashboard } = require('../services/dashboard');
const { seedDemo } = require('../db/seed');
const migrations = require('../db/schema');

const PRINTER_FIELDS = ['name', 'protocol', 'host', 'port', 'windows_name', 'paper_width', 'chars_per_line', 'codepage', 'auto_cut', 'is_default', 'active'];

function printerInput(body) {
  const protocol = v.oneOf(body.protocol, 'protocol', ['escpos_tcp', 'epos_http', 'windows_raw'], { label: 'Druckprotokoll' });
  const p = {
    name: v.str(body.name, 'name', { required: true, max: 80, label: 'Druckername' }),
    protocol,
    host: protocol === 'windows_raw' ? null : v.str(body.host, 'host', { required: true, max: 120, label: 'IP-Adresse' }),
    port: protocol === 'windows_raw' ? null : v.num(body.port || (protocol === 'epos_http' ? 80 : 9100), 'port', { integer: true, min: 1, max: 65535, label: 'Port' }),
    windows_name: protocol === 'windows_raw' ? v.str(body.windows_name, 'windows_name', { required: true, max: 200, label: 'Windows-Druckername' }) : null,
    paper_width: v.oneOf(Number(body.paper_width || 80), 'paper_width', [80, 58], { label: 'Papierbreite' }),
    chars_per_line: 0,
    codepage: v.oneOf(body.codepage || 'cp858', 'codepage', ['cp858', 'cp850', 'cp437'], { label: 'Zeichensatz' }),
    auto_cut: v.bool(body.auto_cut === undefined ? true : body.auto_cut) ? 1 : 0,
    is_default: v.bool(body.is_default) ? 1 : 0,
    active: v.bool(body.active === undefined ? true : body.active) ? 1 : 0,
  };
  if (p.host && !/^[a-zA-Z0-9.\-:]+$/.test(p.host)) throw unprocessable('IP-Adresse/Hostname enthält ungültige Zeichen.', { field: 'host' });
  const cpl = body.chars_per_line ? Number(body.chars_per_line) : (p.paper_width === 58 ? 32 : 48);
  p.chars_per_line = v.num(cpl, 'chars_per_line', { integer: true, min: 24, max: 64, label: 'Zeichen pro Zeile' });
  return p;
}

module.exports = function register(router, { config, log }) {
  // ---------- Drucker ----------
  router.get('/api/printers', { perm: ['print', 'printers.manage'] }, ({ db }) => db.all('SELECT * FROM printers ORDER BY is_default DESC, name'));

  router.post('/api/printers', { perm: 'printers.manage' }, ({ db, user, body }) => {
    const p = printerInput(body);
    const t = new Date().toISOString();
    return db.transaction(() => {
      const first = !db.get('SELECT id FROM printers LIMIT 1');
      if (first) p.is_default = 1;
      if (p.is_default) db.run('UPDATE printers SET is_default = 0');
      const id = Number(db.run(`INSERT INTO printers(${PRINTER_FIELDS.join(',')}, created_at, updated_at) VALUES(${PRINTER_FIELDS.map(() => '?').join(',')},?,?)`,
        ...PRINTER_FIELDS.map((f) => p[f]), t, t).lastInsertRowid);
      audit(db, user, 'Drucker angelegt', 'printer', id, p);
      return db.get('SELECT * FROM printers WHERE id = ?', id);
    });
  });

  router.put('/api/printers/:id', { perm: 'printers.manage' }, ({ db, user, body, params }) => {
    const before = db.get('SELECT * FROM printers WHERE id = ?', params.id);
    if (!before) throw notFound('Drucker nicht gefunden.');
    const p = printerInput(body);
    return db.transaction(() => {
      if (p.is_default) db.run('UPDATE printers SET is_default = 0');
      db.run(`UPDATE printers SET ${PRINTER_FIELDS.map((f) => `${f} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...PRINTER_FIELDS.map((f) => p[f]), new Date().toISOString(), before.id);
      if (!db.get('SELECT id FROM printers WHERE is_default = 1')) db.run('UPDATE printers SET is_default = 1 WHERE id = (SELECT id FROM printers WHERE active = 1 ORDER BY id LIMIT 1)');
      audit(db, user, 'Drucker geändert', 'printer', before.id, diff(before, p, PRINTER_FIELDS));
      return db.get('SELECT * FROM printers WHERE id = ?', before.id);
    });
  });

  router.delete('/api/printers/:id', { perm: 'printers.manage' }, ({ db, user, params }) => {
    const before = db.get('SELECT * FROM printers WHERE id = ?', params.id);
    if (!before) throw notFound('Drucker nicht gefunden.');
    db.transaction(() => {
      db.run('DELETE FROM printers WHERE id = ?', before.id);
      if (before.is_default) db.run('UPDATE printers SET is_default = 1 WHERE id = (SELECT id FROM printers WHERE active = 1 ORDER BY id LIMIT 1)');
    });
    audit(db, user, 'Drucker gelöscht', 'printer', before.id, { name: before.name });
    return { ok: true };
  });

  router.post('/api/printers/:id/test', { perm: 'printers.manage' }, ({ db, user, params }) => P.testPrint(db, user, Number(params.id)));
  router.get('/api/printers/:id/status', { perm: ['print', 'printers.manage'] }, ({ db, params }) => P.printerStatus(db, Number(params.id)));
  router.get('/api/printers-windows', { perm: 'printers.manage' }, async () => {
    try { return { available: true, printers: await transport.listWindowsPrinters() }; } catch (e) { return { available: false, printers: [], error: e.message }; }
  });

  // ---------- Dashboard ----------
  router.get('/api/dashboard', {}, ({ db, can, query }) => dashboard(db, {
    withStats: can('stats.view'),
    periodMonths: [1, 3, 6, 12].includes(Number(query.period)) ? Number(query.period) : 1,
  }));

  // ---------- Protokoll ----------
  router.get('/api/audit', { perm: 'system.manage' }, ({ db, query }) => {
    const where = []; const params = [];
    if (query.q) { where.push('(action LIKE ? OR user_name LIKE ? OR details LIKE ?)'); const q = `%${query.q}%`; params.push(q, q, q); }
    if (query.entity) { where.push('entity = ?'); params.push(query.entity); }
    if (query.from) { where.push('at >= ?'); params.push(query.from); }
    const limit = Math.min(1000, Number(query.limit) || 300);
    return db.all(`SELECT * FROM audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ${limit}`, ...params)
      .map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null }));
  });

  // ---------- Einstellungen ----------
  router.get('/api/settings', { perm: 'system.manage' }, ({ db }) => ({
    company_name: db.getSetting('company_name', ''),
    check_valid_days: db.getSetting('check_valid_days', 7),
    auto_backup: db.getSetting('auto_backup', true),
    backup_keep: db.getSetting('backup_keep', 30),
    session_hours: db.getSetting('session_hours', 12),
    data_dir: config.dataDir,
    db_file: config.dbFile,
    version: require('../version').VERSION,
    lan_urls: lanUrls(config.port),
  }));

  router.put('/api/settings', { perm: 'system.manage' }, ({ db, user, body }) => {
    const before = { company_name: db.getSetting('company_name'), check_valid_days: db.getSetting('check_valid_days'), auto_backup: db.getSetting('auto_backup'), backup_keep: db.getSetting('backup_keep'), session_hours: db.getSetting('session_hours') };
    const s = {
      company_name: v.str(body.company_name, 'company_name', { max: 120, label: 'Betriebsname' }),
      check_valid_days: v.num(body.check_valid_days, 'check_valid_days', { integer: true, min: 1, max: 365, label: 'Gültigkeit Bestandskontrolle' }),
      auto_backup: v.bool(body.auto_backup),
      backup_keep: v.num(body.backup_keep, 'backup_keep', { integer: true, min: 3, max: 365, label: 'Anzahl Sicherungen' }),
      session_hours: v.num(body.session_hours, 'session_hours', { integer: true, min: 1, max: 720, label: 'Sitzungsdauer' }),
    };
    for (const [k, val] of Object.entries(s)) db.setSetting(k, val);
    audit(db, user, 'Einstellungen geändert', 'settings', null, diff(before, s, Object.keys(s)));
    return { ok: true };
  });

  router.post('/api/demo-data', { perm: 'system.manage' }, ({ db, user }) => {
    if (db.get('SELECT COUNT(*) AS n FROM articles').n > 0) throw conflict('Beispieldaten können nur in eine leere Artikelliste geladen werden.');
    db.transaction(() => seedDemo(db));
    audit(db, user, 'Beispieldaten geladen', 'system', null);
    return { ok: true };
  });

  // ---------- Datensicherung ----------
  router.get('/api/backups', { perm: 'system.manage' }, () => ({ dir: config.backupDir, backups: B.listBackups(config.backupDir) }));
  router.post('/api/backups', { perm: 'system.manage' }, ({ db, user }) => {
    const b = B.createBackup(db, config.backupDir, 'manuell');
    audit(db, user, 'Datensicherung erstellt', 'system', null, b);
    return b;
  });
  router.get('/api/backups/:name', { perm: 'system.manage' }, ({ params }) => {
    const file = B.backupPath(config.backupDir, params.name);
    return new RawResponse(fs.readFileSync(file), 'application/octet-stream', params.name);
  });
  router.post('/api/backups/:name/restore', { perm: 'system.manage' }, ({ db, user, params }) => {
    const file = B.backupPath(config.backupDir, params.name);
    const tmp = path.join(os.tmpdir(), `ek-restore-${Date.now()}.db`);
    fs.copyFileSync(file, tmp);
    try {
      const r = B.restore(db, config.backupDir, tmp, migrations.length);
      audit(db, user, 'Datensicherung wiederhergestellt', 'system', null, { sicherung: params.name, ...r });
      return r;
    } finally { fs.rmSync(tmp, { force: true }); }
  });
  router.post('/api/backups-upload', { perm: 'system.manage', rawBody: true }, ({ db, user, raw }) => {
    if (!raw || raw.length < 1024) throw unprocessable('Keine gültige Sicherungsdatei.');
    const tmp = path.join(os.tmpdir(), `ek-upload-${Date.now()}.db`);
    fs.writeFileSync(tmp, raw);
    try {
      const r = B.restore(db, config.backupDir, tmp, migrations.length);
      audit(db, user, 'Datensicherung aus Datei wiederhergestellt', 'system', null, r);
      return r;
    } finally { fs.rmSync(tmp, { force: true }); }
  });

  router.get('/api/health', { auth: false }, () => ({ ok: true, version: require('../version').VERSION }));
};

function lanUrls(port) {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(`http://${i.address}:${port}`);
  }
  return out;
}
module.exports.lanUrls = lanUrls;
