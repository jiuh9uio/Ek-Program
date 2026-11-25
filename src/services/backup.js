'use strict';
/** Datensicherung: konsistente SQLite-Kopien per VACUUM INTO, automatische Rotation, Wiederherstellung. */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { unprocessable, notFound } = require('../http/core');

const pad = (n) => String(n).padStart(2, '0');
function stamp(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function createBackup(db, backupDir, reason = 'manuell') {
  fs.mkdirSync(backupDir, { recursive: true });
  const name = `ek-service_${stamp()}_${reason.replace(/[^a-z0-9]/gi, '')}.db`;
  const file = path.join(backupDir, name);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  db.conn.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  prune(db, backupDir);
  return { name, size: fs.statSync(file).size };
}

function listBackups(backupDir) {
  if (!fs.existsSync(backupDir)) return [];
  return fs.readdirSync(backupDir).filter((f) => /^ek-service_.*\.db$/.test(f)).map((f) => {
    const st = fs.statSync(path.join(backupDir, f));
    return { name: f, size: st.size, created_at: st.mtime.toISOString() };
  }).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function prune(db, backupDir) {
  const keep = Math.max(3, Number(db.getSetting('backup_keep', 30)) || 30);
  const auto = listBackups(backupDir).filter((b) => /_auto\.db$/.test(b.name));
  for (const b of auto.slice(keep)) fs.rmSync(path.join(backupDir, b.name), { force: true });
}

function backupPath(backupDir, name) {
  if (!/^ek-service_[\w-]+\.db$/.test(name)) throw unprocessable('Ungültiger Sicherungsname.');
  const file = path.join(backupDir, name);
  if (!fs.existsSync(file)) throw notFound('Sicherung nicht gefunden.');
  return file;
}

/** Prüft, ob eine Datei eine gültige EK-Service-Datenbank ist. */
function validateDbFile(file, maxVersion) {
  const head = Buffer.alloc(16);
  const fd = fs.openSync(file, 'r');
  fs.readSync(fd, head, 0, 16, 0);
  fs.closeSync(fd);
  if (head.toString('latin1') !== 'SQLite format 3\u0000') throw unprocessable('Die Datei ist keine SQLite-Datenbank.');
  const test = new DatabaseSync(file, { readOnly: true });
  try {
    const ic = test.prepare('PRAGMA integrity_check').get();
    if (Object.values(ic)[0] !== 'ok') throw unprocessable('Die Sicherung ist beschädigt (Integritätsprüfung fehlgeschlagen).');
    const v = test.prepare('PRAGMA user_version').get().user_version;
    if (v < 1 || v > maxVersion) throw unprocessable('Die Sicherung stammt nicht aus einer kompatiblen EK-Service-Version.');
    const t = test.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('articles','purchase_lists','users')").get();
    if (t.n !== 3) throw unprocessable('Die Datei enthält keine EK-Service-Daten.');
  } finally { test.close(); }
}

/** Stellt eine Sicherung wieder her (vorher automatische Sicherung des aktuellen Stands). */
function restore(db, backupDir, sourceFile, maxVersion) {
  validateDbFile(sourceFile, maxVersion);
  const safety = createBackup(db, backupDir, 'vor-wiederherstellung');
  db.close();
  try {
    for (const ext of ['-wal', '-shm']) fs.rmSync(db.file + ext, { force: true });
    fs.copyFileSync(sourceFile, db.file);
  } finally {
    db.open(); // führt ggf. Migrationen aus
  }
  return { safety_backup: safety.name };
}

function startScheduler(db, backupDir, log = console) {
  const run = () => {
    try {
      if (!db.getSetting('auto_backup', true)) return;
      const last = listBackups(backupDir).find((b) => /_auto\.db$/.test(b.name));
      if (last && Date.now() - Date.parse(last.created_at) < 20 * 3600e3) return;
      const b = createBackup(db, backupDir, 'auto');
      log.log(`[Sicherung] automatische Sicherung erstellt: ${b.name}`);
    } catch (e) { log.error('[Sicherung] Fehler:', e.message); }
  };
  setTimeout(run, 5000).unref();
  setInterval(run, 3600e3).unref();
}

module.exports = { createBackup, listBackups, backupPath, restore, startScheduler, validateDbFile };
