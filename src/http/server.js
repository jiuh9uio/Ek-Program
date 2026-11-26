'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { HttpError, RawResponse } = require('./core');
const { resolveSession, effectivePermissions } = require('../auth');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/** Liefert statische Dateien – aus der EXE (SEA-Assets) oder dem public-Ordner. */
function createAssetLoader(isSea) {
  const cache = new Map();
  let sea = null;
  if (isSea) sea = require('node:sea');
  const publicDir = path.resolve(__dirname, '..', '..', 'public');
  return (rel) => {
    if (cache.has(rel)) return cache.get(rel);
    let buf = null;
    try {
      if (sea) buf = Buffer.from(sea.getAsset('public/' + rel));
      else {
        const full = path.join(publicDir, rel);
        if (!full.startsWith(publicDir)) return null;
        buf = fs.readFileSync(full);
      }
    } catch { buf = null; }
    if (sea && buf) cache.set(rel, buf); // im Dev-Modus nicht cachen (Live-Änderungen)
    return buf;
  };
}

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Anfrage ist zu groß.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(res, status, body, headers = {}, req) {
  let buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const h = { 'Cache-Control': 'no-store', ...headers };
  const type = h['Content-Type'] || '';
  if (req && buf.length > 1024 && /json|text|javascript|svg/.test(type) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    buf = zlib.gzipSync(buf);
    h['Content-Encoding'] = 'gzip';
  }
  h['Content-Length'] = buf.length;
  res.writeHead(status, h);
  res.end(buf);
}

function createServer({ db, router, isSea, log = console }) {
  const asset = createAssetLoader(isSea);

  // Offene Programmfenster (für automatisches Beenden, wenn alle Fenster geschlossen sind)
  const presence = { count: 0, lastActive: Date.now(), seen: false };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    if (pathname === '/api/presence' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write('retry: 2000\n\n');
      presence.count++; presence.seen = true; presence.lastActive = Date.now();
      const ping = setInterval(() => res.write(': ping\n\n'), 20000);
      req.on('close', () => { clearInterval(ping); presence.count--; presence.lastActive = Date.now(); });
      return;
    }
    const security = {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'",
    };

    // ---------- API ----------
    if (pathname.startsWith('/api/')) {
      const sendJson = (status, obj) => send(res, status, JSON.stringify(obj), { ...security, 'Content-Type': 'application/json; charset=utf-8' }, req);
      try {
        const m = router.match(req.method, pathname);
        if (!m) throw new HttpError(404, 'Unbekannter API-Endpunkt.');
        if (m.methodNotAllowed) throw new HttpError(405, 'Methode nicht erlaubt.');
        const { route, params } = m;

        // CSRF-Schutz: schreibende Anfragen nur per fetch mit Spezialheader
        if (req.method !== 'GET' && req.headers['x-ek-client'] !== '1') throw new HttpError(403, 'Ungültige Anfrage (CSRF-Schutz).');

        const cookies = parseCookies(req.headers.cookie);
        const sessionUser = resolveSession(db, cookies.ek_session);
        if (route.opts.auth && !sessionUser) throw new HttpError(401, 'Bitte anmelden.');
        const perms = effectivePermissions(sessionUser);
        if (route.opts.perm) {
          const need = Array.isArray(route.opts.perm) ? route.opts.perm : [route.opts.perm];
          if (!need.some((p) => perms.includes(p))) throw new HttpError(403, 'Keine Berechtigung für diese Aktion.');
        }

        let body = {};
        let raw = null;
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          const limit = route.opts.rawBody ? 512 * 1024 * 1024 : 8 * 1024 * 1024;
          raw = await readBody(req, limit);
          if (!route.opts.rawBody && raw.length) {
            try { body = JSON.parse(raw.toString('utf8')); } catch { throw new HttpError(400, 'Ungültiges JSON.'); }
            if (body === null || typeof body !== 'object') throw new HttpError(400, 'Ungültiges JSON.');
          }
        }

        const ctx = {
          req, res, params, body, raw, db,
          query: Object.fromEntries(url.searchParams),
          user: sessionUser || null,
          perms,
          can: (p) => perms.includes(p),
          token: cookies.ek_session,
          setCookie: (value, maxAgeSec) => {
            res.setHeader('Set-Cookie', `ek_session=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}`);
          },
        };
        const result = await route.handler(ctx);
        if (result instanceof RawResponse) {
          const disp = result.filename ? { 'Content-Disposition': `${result.inline ? 'inline' : 'attachment'}; filename="${result.filename.replace(/[^\w.\-]/g, '_')}"` } : {};
          send(res, 200, result.body, { ...security, 'Content-Type': result.contentType, ...disp }, req);
        } else {
          sendJson(200, result === undefined ? { ok: true } : result);
        }
      } catch (err) {
        if (err instanceof HttpError) {
          sendJson(err.status, { error: err.message, ...(err.extra || {}) });
        } else if (err && /UNIQUE constraint failed/.test(err.message)) {
          sendJson(409, { error: 'Ein Eintrag mit diesem Namen/dieser Nummer existiert bereits.' });
        } else if (err && /FOREIGN KEY constraint failed/.test(err.message)) {
          sendJson(409, { error: 'Der Eintrag wird noch verwendet und kann nicht gelöscht werden.' });
        } else if (err && /CHECK constraint failed/.test(err.message)) {
          sendJson(422, { error: 'Ungültige Werte (Plausibilitätsprüfung der Datenbank).' });
        } else {
          log.error('[API-Fehler]', req.method, pathname, err);
          sendJson(500, { error: 'Interner Fehler: ' + (err && err.message ? err.message : String(err)) });
        }
      }
      return;
    }

    // ---------- Statische Dateien / SPA ----------
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    let rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    if (rel.includes('..')) return send(res, 400, 'Bad request');
    let buf = asset(rel);
    if (!buf && !path.extname(rel)) { rel = 'index.html'; buf = asset(rel); } // SPA-Fallback
    if (!buf) return send(res, 404, 'Nicht gefunden', { 'Content-Type': 'text/plain; charset=utf-8' });
    const type = MIME[path.extname(rel)] || 'application/octet-stream';
    send(res, 200, buf, { ...security, 'Content-Type': type, 'Cache-Control': rel === 'index.html' ? 'no-cache' : 'no-cache' }, req);
  });
  server.presence = presence;
  return server;
}

module.exports = { createServer };
