'use strict';
/** Serverseitige Validierung von Eingaben. */
const { unprocessable } = require('./core');

function str(v, field, { required = false, max = 500, label = field } = {}) {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string' && typeof v !== 'number') throw unprocessable(`${label}: ungültiger Wert.`, { field });
  const s = String(v).trim();
  if (required && !s) throw unprocessable(`${label} ist ein Pflichtfeld.`, { field });
  if (s.length > max) throw unprocessable(`${label} darf höchstens ${max} Zeichen lang sein.`, { field });
  return s;
}

function optStr(v, field, opts) { const s = str(v, field, opts); return s === '' ? null : s; }

function num(v, field, { required = false, min = -Infinity, max = Infinity, label = field, nullable = false, integer = false } = {}) {
  if (v === '' || v === undefined || v === null) {
    if (nullable) return null;
    if (required) throw unprocessable(`${label} ist ein Pflichtfeld.`, { field });
    return 0;
  }
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n)) throw unprocessable(`${label} muss eine Zahl sein.`, { field });
  if (integer && !Number.isInteger(n)) throw unprocessable(`${label} muss eine ganze Zahl sein.`, { field });
  if (n < min) throw unprocessable(`${label} darf nicht kleiner als ${min} sein.`, { field });
  if (n > max) throw unprocessable(`${label} darf nicht größer als ${max} sein.`, { field });
  return Math.round(n * 1000) / 1000;
}

function bool(v) { return v === true || v === 1 || v === '1' || v === 'true' || v === 'on'; }

function id(v, field, { required = false, label = field } = {}) {
  if (v === '' || v === undefined || v === null) {
    if (required) throw unprocessable(`${label} ist ein Pflichtfeld.`, { field });
    return null;
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw unprocessable(`${label}: ungültige Auswahl.`, { field });
  return n;
}

function oneOf(v, field, allowed, { label = field } = {}) {
  if (!allowed.includes(v)) throw unprocessable(`${label}: ungültiger Wert.`, { field });
  return v;
}

function days(v, field, label) {
  // Wochentage als Liste 1..7 (Mo..So)
  const arr = Array.isArray(v) ? v : String(v || '').split(',').filter(Boolean);
  const out = [...new Set(arr.map(Number))].filter((d) => Number.isInteger(d) && d >= 1 && d <= 7).sort();
  if (arr.length && out.length !== new Set(arr.map(String)).size) throw unprocessable(`${label}: ungültige Wochentage.`, { field });
  return out.join(',');
}

function email(v, field, label) {
  const s = optStr(v, field, { max: 200, label });
  if (s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw unprocessable(`${label}: ungültige E-Mail-Adresse.`, { field });
  return s;
}

function image(v, field) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (typeof v !== 'string' || !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(v)) throw unprocessable('Artikelbild: ungültiges Bildformat (PNG, JPEG, WebP).', { field });
  if (v.length > 1_500_000) throw unprocessable('Artikelbild ist zu groß (max. ca. 1 MB).', { field });
  return v;
}

module.exports = { str, optStr, num, bool, id, oneOf, days, email, image };
