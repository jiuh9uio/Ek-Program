'use strict';
const fs = require('node:fs');
const path = require('node:path');

// node:sqlite meldet sich als "experimental" – Warnung unterdrücken, Funktion ist stabil nutzbar.
const origEmit = process.emitWarning;
process.emitWarning = function (warning, ...args) {
  const msg = typeof warning === 'string' ? warning : warning && warning.message;
  if (msg && msg.includes('SQLite')) return;
  return origEmit.call(process, warning, ...args);
};
const { DatabaseSync } = require('node:sqlite');

const migrations = require('./schema');
const { seedDefaults } = require('./seed');

const nowIso = () => new Date().toISOString();

class Db {
  constructor(file) {
    this.file = file;
    this.open();
  }

  open() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.conn = new DatabaseSync(this.file);
    this.conn.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
    this.stmtCache = new Map();
    this.txDepth = 0;
    this.migrate();
  }

  close() {
    if (this.conn) { this.conn.close(); this.conn = null; }
    this.stmtCache = new Map();
  }

  migrate() {
    const current = this.conn.prepare('PRAGMA user_version').get().user_version;
    const fresh = current === 0;
    for (let v = current; v < migrations.length; v++) {
      this.transaction(() => {
        this.conn.exec(migrations[v]);
        this.conn.exec(`PRAGMA user_version = ${v + 1}`);
      });
    }
    if (fresh) this.transaction(() => seedDefaults(this));
  }

  stmt(sql) {
    let s = this.stmtCache.get(sql);
    if (!s) { s = this.conn.prepare(sql); this.stmtCache.set(sql, s); }
    return s;
  }

  all(sql, ...params) { return this.stmt(sql).all(...params).map(plain); }
  get(sql, ...params) { const r = this.stmt(sql).get(...params); return r ? plain(r) : undefined; }
  run(sql, ...params) { return this.stmt(sql).run(...params); }
  exec(sql) { this.conn.exec(sql); }

  /** Verschachtelbare Transaktion (Savepoints). */
  transaction(fn) {
    const sp = `sp${this.txDepth}`;
    if (this.txDepth === 0) this.conn.exec('BEGIN IMMEDIATE'); else this.conn.exec(`SAVEPOINT ${sp}`);
    this.txDepth++;
    try {
      const result = fn();
      this.txDepth--;
      if (this.txDepth === 0) this.conn.exec('COMMIT'); else this.conn.exec(`RELEASE ${sp}`);
      return result;
    } catch (e) {
      this.txDepth--;
      if (this.txDepth === 0) this.conn.exec('ROLLBACK'); else this.conn.exec(`ROLLBACK TO ${sp}; RELEASE ${sp}`);
      throw e;
    }
  }

  getSetting(key, fallback = null) {
    const r = this.get('SELECT value FROM settings WHERE key = ?', key);
    if (!r) return fallback;
    try { return JSON.parse(r.value); } catch { return r.value; }
  }

  setSetting(key, value) {
    this.run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
  }

  nextNumber(name) {
    this.run('INSERT INTO counters(name, value) VALUES(?, 0) ON CONFLICT(name) DO NOTHING', name);
    this.run('UPDATE counters SET value = value + 1 WHERE name = ?', name);
    return this.get('SELECT value FROM counters WHERE name = ?', name).value;
  }
}

function plain(row) {
  // node:sqlite liefert Objekte mit null-Prototyp – für JSON/Spread normalisieren
  const o = {};
  for (const k of Object.keys(row)) o[k] = row[k];
  return o;
}

module.exports = { Db, nowIso };
