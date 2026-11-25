'use strict';
/** Minimaler HTTP-Router ohne externe Abhängigkeiten. */

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const bad = (msg, extra) => new HttpError(400, msg, extra);
const forbidden = (msg = 'Keine Berechtigung für diese Aktion.') => new HttpError(403, msg);
const notFound = (msg = 'Nicht gefunden.') => new HttpError(404, msg);
const conflict = (msg, extra) => new HttpError(409, msg, extra);
const unprocessable = (msg, extra) => new HttpError(422, msg, extra);

class Router {
  constructor() { this.routes = []; }

  /**
   * @param {string} method
   * @param {string} pattern z. B. '/api/articles/:id'
   * @param {object} opts { auth: true|false, perm: 'x' | ['x','y'] (eine davon) }
   * @param {Function} handler async (ctx) => any
   */
  add(method, pattern, opts, handler) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/\/:([a-zA-Z_]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
    this.routes.push({ method, re, keys, opts: { auth: true, ...opts }, handler });
  }
  get(p, o, h) { this.add('GET', p, o, h); }
  post(p, o, h) { this.add('POST', p, o, h); }
  put(p, o, h) { this.add('PUT', p, o, h); }
  delete(p, o, h) { this.add('DELETE', p, o, h); }

  match(method, pathname) {
    let pathMatched = false;
    for (const r of this.routes) {
      const m = r.re.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route: r, params };
    }
    return pathMatched ? { methodNotAllowed: true } : null;
  }
}

/** Rohantwort (Datei/Download) statt JSON */
class RawResponse {
  constructor(body, contentType, filename, inline = false) {
    this.body = body; this.contentType = contentType; this.filename = filename; this.inline = inline;
  }
}

module.exports = { Router, HttpError, RawResponse, bad, forbidden, notFound, conflict, unprocessable };
