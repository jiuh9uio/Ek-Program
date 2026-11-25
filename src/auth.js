'use strict';
const crypto = require('node:crypto');

/** Alle Berechtigungen des Systems. */
const PERMISSIONS = {
  'stock.count': 'Bestände kontrollieren',
  'list.create': 'Einkaufslisten erstellen und bearbeiten',
  'print': 'Einkaufsbons drucken / PDF',
  'list.exceed_max': 'Maximalbestand überschreiten',
  'goods.receive': 'Wareneingang buchen',
  'orders.approve': 'Bestellungen freigeben, abschließen, erneut öffnen',
  'articles.manage': 'Artikel und Stammdaten verwalten',
  'minmax.manage': 'MIN/MAX-Bestände festlegen',
  'prices.manage': 'Einkaufspreise verwalten',
  'suppliers.manage': 'Lieferanten verwalten',
  'stats.view': 'Statistiken und Kosten einsehen',
  'printers.manage': 'Drucker konfigurieren',
  'users.manage': 'Benutzer und Rechte verwalten',
  'system.manage': 'Einstellungen, Datensicherung, Protokoll',
};

const ROLE_DEFAULTS = {
  service: ['stock.count', 'list.create', 'print'],
  admin: Object.keys(PERMISSIONS),
};

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const [algo, saltB64, hashB64] = stored.split('$');
  if (algo !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(String(password), Buffer.from(saltB64, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, actual);
}

function effectivePermissions(user) {
  if (!user) return [];
  if (user.role === 'admin') return [...ROLE_DEFAULTS.admin];
  let extra = [];
  try { extra = JSON.parse(user.permissions || '[]'); } catch { extra = []; }
  return [...new Set([...(ROLE_DEFAULTS[user.role] || []), ...extra.filter((p) => PERMISSIONS[p])])];
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id, username: user.username, display_name: user.display_name, role: user.role,
    active: !!user.active, extra_permissions: safeJson(user.permissions, []),
    permissions: effectivePermissions(user), last_login_at: user.last_login_at,
    created_at: user.created_at,
  };
}

function safeJson(s, fallback) { try { return JSON.parse(s); } catch { return fallback; } }

const MAX_FAILED = 5;
const LOCK_MINUTES = 5;

function createSession(db, userId, userAgent) {
  const token = crypto.randomBytes(32).toString('base64url');
  const hours = Number(db.getSetting('session_hours', 12)) || 12;
  const now = new Date();
  db.run('INSERT INTO sessions(token, user_id, created_at, expires_at, last_seen_at, user_agent) VALUES(?,?,?,?,?,?)',
    token, userId, now.toISOString(), new Date(now.getTime() + hours * 3600e3).toISOString(), now.toISOString(), String(userAgent || '').slice(0, 200));
  return token;
}

function resolveSession(db, token) {
  if (!token) return null;
  const row = db.get(`SELECT s.token, s.expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`, token);
  if (!row) return null;
  if (!row.active || row.expires_at < new Date().toISOString()) {
    db.run('DELETE FROM sessions WHERE token = ?', token);
    return null;
  }
  // gleitende Ablaufzeit
  const hours = Number(db.getSetting('session_hours', 12)) || 12;
  db.run('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token = ?', new Date().toISOString(), new Date(Date.now() + hours * 3600e3).toISOString(), token);
  return row;
}

module.exports = {
  PERMISSIONS, ROLE_DEFAULTS, hashPassword, verifyPassword, effectivePermissions, publicUser,
  createSession, resolveSession, MAX_FAILED, LOCK_MINUTES,
};
