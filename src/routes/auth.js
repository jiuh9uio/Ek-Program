'use strict';
const { HttpError, unprocessable, notFound, conflict, forbidden } = require('../http/core');
const v = require('../http/validate');
const A = require('../auth');
const { audit, diff } = require('../services/audit');

module.exports = function register(router) {
  // Benutzerkacheln für die Touch-Anmeldung (nur Namen, keine sensiblen Daten)
  router.get('/api/auth/users', { auth: false }, ({ db }) =>
    db.all('SELECT id, username, display_name, role FROM users WHERE active = 1 ORDER BY role DESC, display_name COLLATE NOCASE'));

  router.post('/api/auth/login', { auth: false }, ({ db, body, req, setCookie }) => {
    const username = v.str(body.username, 'username', { required: true, label: 'Benutzer' });
    const password = String(body.password ?? '');
    const user = db.get('SELECT * FROM users WHERE username = ?', username);
    const t = new Date();
    if (user && user.locked_until && user.locked_until > t.toISOString()) {
      throw new HttpError(429, 'Zu viele Fehlversuche. Bitte in einigen Minuten erneut versuchen.');
    }
    if (!user || !user.active || !A.verifyPassword(password, user.pass_hash)) {
      if (user) {
        const fails = user.failed_logins + 1;
        const lock = fails >= A.MAX_FAILED ? new Date(t.getTime() + A.LOCK_MINUTES * 60e3).toISOString() : null;
        db.run('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?', lock ? 0 : fails, lock, user.id);
        audit(db, null, 'Anmeldung fehlgeschlagen', 'user', user.id, { benutzer: user.username, gesperrt: !!lock });
      }
      throw new HttpError(401, 'Benutzername oder PIN/Passwort falsch.');
    }
    db.run('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?', t.toISOString(), user.id);
    db.run('DELETE FROM sessions WHERE expires_at < ?', t.toISOString());
    const token = A.createSession(db, user.id, req.headers['user-agent']);
    setCookie(token, 60 * 60 * 24 * 30);
    audit(db, user, 'Anmeldung', 'user', user.id);
    return { user: A.publicUser(user) };
  });

  router.post('/api/auth/logout', { auth: false }, ({ db, token, setCookie }) => {
    if (token) db.run('DELETE FROM sessions WHERE token = ?', token);
    setCookie('', 0);
    return { ok: true };
  });

  router.get('/api/auth/me', {}, ({ db, user }) => ({
    user: A.publicUser(user),
    company_name: db.getSetting('company_name', ''),
    default_admin_password: user.role === 'admin' && !!db.getSetting('default_admin_password', false),
    permissions_catalog: A.PERMISSIONS,
  }));

  router.post('/api/auth/password', {}, ({ db, user, body }) => {
    const current = String(body.current ?? '');
    const next = v.str(body.next, 'next', { required: true, max: 100, label: 'Neues Passwort/PIN' });
    if (next.length < 4) throw unprocessable('PIN/Passwort muss mindestens 4 Zeichen lang sein.');
    const row = db.get('SELECT * FROM users WHERE id = ?', user.id);
    if (!A.verifyPassword(current, row.pass_hash)) throw unprocessable('Das aktuelle Passwort ist falsch.');
    db.run('UPDATE users SET pass_hash = ?, updated_at = ? WHERE id = ?', A.hashPassword(next), new Date().toISOString(), user.id);
    if (user.username.toLowerCase() === 'admin') db.setSetting('default_admin_password', false);
    audit(db, user, 'Eigenes Passwort geändert', 'user', user.id);
    return { ok: true };
  });

  // ---------------- Benutzerverwaltung ----------------
  router.get('/api/users', { perm: 'users.manage' }, ({ db }) =>
    db.all('SELECT * FROM users ORDER BY active DESC, display_name COLLATE NOCASE').map(A.publicUser));

  function userInput(body, isNew) {
    const out = {
      username: v.str(body.username, 'username', { required: true, max: 50, label: 'Benutzername' }),
      display_name: v.str(body.display_name, 'display_name', { required: true, max: 80, label: 'Anzeigename' }),
      role: v.oneOf(body.role, 'role', ['admin', 'service'], { label: 'Rolle' }),
      active: body.active === undefined ? 1 : (v.bool(body.active) ? 1 : 0),
      permissions: JSON.stringify((Array.isArray(body.extra_permissions) ? body.extra_permissions : []).filter((p) => A.PERMISSIONS[p])),
    };
    if (!/^[\w.\-äöüÄÖÜß]+$/.test(out.username)) throw unprocessable('Benutzername: nur Buchstaben, Ziffern, Punkt, Binde- und Unterstrich.');
    if (isNew || body.password) {
      const pw = String(body.password ?? '');
      if (pw.length < 4) throw unprocessable('PIN/Passwort muss mindestens 4 Zeichen lang sein.', { field: 'password' });
      out.pass_hash = A.hashPassword(pw);
    }
    return out;
  }

  function assertAdminRemains(db, excludingId) {
    const n = db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id <> ?", excludingId).n;
    if (!n) throw conflict('Es muss mindestens ein aktiver Administrator bestehen bleiben.');
  }

  router.post('/api/users', { perm: 'users.manage' }, ({ db, user, body }) => {
    const u = userInput(body, true);
    const t = new Date().toISOString();
    const id = Number(db.run('INSERT INTO users(username, display_name, role, pass_hash, permissions, active, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)',
      u.username, u.display_name, u.role, u.pass_hash, u.permissions, u.active, t, t).lastInsertRowid);
    audit(db, user, 'Benutzer angelegt', 'user', id, { benutzer: u.username, rolle: u.role, rechte: JSON.parse(u.permissions) });
    return A.publicUser(db.get('SELECT * FROM users WHERE id = ?', id));
  });

  router.put('/api/users/:id', { perm: 'users.manage' }, ({ db, user, body, params }) => {
    const id = Number(params.id);
    const before = db.get('SELECT * FROM users WHERE id = ?', id);
    if (!before) throw notFound('Benutzer nicht gefunden.');
    const u = userInput(body, false);
    if (before.role === 'admin' && (u.role !== 'admin' || !u.active)) db.transaction(() => assertAdminRemains(db, id));
    if (id === user.id && !u.active) throw forbidden('Sie können sich nicht selbst deaktivieren.');
    db.run(`UPDATE users SET username = ?, display_name = ?, role = ?, permissions = ?, active = ?, updated_at = ?${u.pass_hash ? ', pass_hash = ?, failed_logins = 0, locked_until = NULL' : ''} WHERE id = ?`,
      ...[u.username, u.display_name, u.role, u.permissions, u.active, new Date().toISOString(), ...(u.pass_hash ? [u.pass_hash] : []), id]);
    if (!u.active) db.run('DELETE FROM sessions WHERE user_id = ?', id);
    if (u.pass_hash && before.username.toLowerCase() === 'admin') db.setSetting('default_admin_password', false);
    const changes = diff(before, u, ['username', 'display_name', 'role', 'permissions', 'active']);
    if (u.pass_hash) changes.passwort = 'geändert';
    audit(db, user, 'Benutzer geändert', 'user', id, changes);
    return A.publicUser(db.get('SELECT * FROM users WHERE id = ?', id));
  });

  router.delete('/api/users/:id', { perm: 'users.manage' }, ({ db, user, params }) => {
    const id = Number(params.id);
    const before = db.get('SELECT * FROM users WHERE id = ?', id);
    if (!before) throw notFound('Benutzer nicht gefunden.');
    if (id === user.id) throw forbidden('Sie können sich nicht selbst löschen.');
    if (before.role === 'admin') assertAdminRemains(db, id);
    // Benutzer mit Historie werden deaktiviert statt gelöscht (Nachvollziehbarkeit)
    const used = db.get('SELECT (SELECT COUNT(*) FROM purchase_lists WHERE created_by = ?) + (SELECT COUNT(*) FROM stock_movements WHERE user_id = ?) AS n', id, id).n;
    if (used) {
      db.run('UPDATE users SET active = 0, updated_at = ? WHERE id = ?', new Date().toISOString(), id);
      db.run('DELETE FROM sessions WHERE user_id = ?', id);
      audit(db, user, 'Benutzer deaktiviert (hat Historie)', 'user', id, { benutzer: before.username });
      return { ok: true, deactivated: true };
    }
    db.run('DELETE FROM users WHERE id = ?', id);
    audit(db, user, 'Benutzer gelöscht', 'user', id, { benutzer: before.username });
    return { ok: true, deleted: true };
  });
};
