// API-Client mit Fehlerbehandlung. Schreibende Anfragen tragen den CSRF-Header.

export class ApiError extends Error {
  constructor(status, message, data) { super(message); this.status = status; this.data = data; }
}

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

let pending = 0;
const busyEl = () => document.getElementById('busy');
function busy(delta) {
  pending += delta;
  const el = busyEl();
  if (el) el.classList.toggle('on', pending > 0);
}

export async function api(method, url, body, { raw = false, quiet = false } = {}) {
  const opts = { method, headers: { 'X-EK-Client': '1' }, credentials: 'same-origin' };
  if (body !== undefined) {
    if (body instanceof Blob || body instanceof ArrayBuffer) { opts.body = body; opts.headers['Content-Type'] = 'application/octet-stream'; } else { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  }
  if (!quiet) busy(1);
  let res;
  try {
    res = await fetch(url, opts);
  } catch {
    throw new ApiError(0, 'Keine Verbindung zum EK-Server. Läuft die Anwendung noch? Bitte Netzwerk prüfen.');
  } finally { if (!quiet) busy(-1); }
  if (raw && res.ok) return res;
  let data = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('json')) { try { data = await res.json(); } catch { data = null; } }
  if (!res.ok) {
    if (res.status === 401 && !url.includes('/auth/login')) onUnauthorized();
    throw new ApiError(res.status, (data && data.error) || `Fehler ${res.status}`, data);
  }
  return data;
}

export const get = (u, o) => api('GET', u, undefined, o);
export const post = (u, b, o) => api('POST', u, b ?? {}, o);
export const put = (u, b, o) => api('PUT', u, b ?? {}, o);
export const del = (u, o) => api('DELETE', u, undefined, o);
