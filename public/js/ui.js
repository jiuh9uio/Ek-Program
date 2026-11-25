// Gemeinsame UI-Helfer: Formatierung, Toasts, Dialoge, Status-Badges.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const fmtQty = (n) => (n === null || n === undefined || n === '' ? '–' : Number(n).toLocaleString('de-DE', { maximumFractionDigits: 3 }));
export const fmtEur = (n) => (n === null || n === undefined ? '–' : Number(n).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }));
export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('de-DE') : '–');
export const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–');
export const fmtAgo = (iso) => {
  if (!iso) return 'nie';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'gerade eben';
  if (s < 3600) return `vor ${Math.floor(s / 60)} Min.`;
  if (s < 86400) return `vor ${Math.floor(s / 3600)} Std.`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'gestern' : `vor ${d} Tagen`;
};
export const unitFor = (qty, unit, plural) => (!unit ? '' : Math.abs(Number(qty) - 1) < 1e-9 ? unit : (plural || unit));
export const parseNum = (s) => {
  if (s === null || s === undefined) return null;
  const t = String(s).trim().replace(/\s/g, '').replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};

export const STATUS = {
  ok: { label: 'Ausreichend', cls: 'st-green' },
  at_min: { label: 'MIN erreicht', cls: 'st-yellow' },
  below: { label: 'Unter MIN', cls: 'st-red' },
  unchecked: { label: 'Nicht kontrolliert', cls: 'st-grey' },
  ordered: { label: 'Bestellt', cls: 'st-blue' },
};
export const statusBadge = (st, extra = '') => `<span class="badge ${STATUS[st]?.cls || ''}">${esc(STATUS[st]?.label || st)}${extra}</span>`;

export const LIST_STATUS = {
  draft: { label: 'Entwurf', cls: 'ls-draft' },
  ready: { label: 'Einkaufsbereit', cls: 'ls-ready' },
  ordered: { label: 'Bestellt', cls: 'ls-ordered' },
  partial: { label: 'Teilweise geliefert', cls: 'ls-partial' },
  delivered: { label: 'Vollständig geliefert', cls: 'ls-delivered' },
  closed: { label: 'Abgeschlossen', cls: 'ls-closed' },
  cancelled: { label: 'Storniert', cls: 'ls-cancelled' },
};
export const listBadge = (st) => `<span class="badge ${LIST_STATUS[st]?.cls || ''}">${esc(LIST_STATUS[st]?.label || st)}</span>`;

export const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
export const fmtDays = (csv) => (csv ? String(csv).split(',').filter(Boolean).map((d) => WEEKDAYS[Number(d) - 1]).join(', ') : '–');

// ---------- Toasts ----------
export function toast(msg, type = 'info', ms = 3500) {
  const root = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  root.appendChild(el);
  setTimeout(() => { el.classList.add('hide'); setTimeout(() => el.remove(), 400); }, type === 'error' ? Math.max(ms, 6000) : ms);
}

// ---------- Modale Dialoge ----------
let modalStack = [];
export function modal({ title, body, actions = [], wide = false, onOpen, onClose }) {
  const root = document.getElementById('modal-root');
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-head"><h2>${esc(title)}</h2><button class="btn-icon" data-close aria-label="Schließen">✕</button></div>
    <div class="modal-body"></div>
    <div class="modal-foot"></div></div>`;
  const bodyEl = wrap.querySelector('.modal-body');
  if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
  const foot = wrap.querySelector('.modal-foot');
  const close = (result) => {
    wrap.remove();
    modalStack = modalStack.filter((m) => m !== api);
    document.removeEventListener('keydown', onKey);
    if (onClose) onClose(result);
  };
  const api = { el: wrap, body: bodyEl, close };
  for (const a of actions) {
    const b = document.createElement('button');
    b.className = `btn ${a.cls || ''}`;
    b.textContent = a.label;
    b.type = 'button';
    b.addEventListener('click', async () => {
      if (!a.onClick) return close(a.value);
      b.disabled = true;
      try { const r = await a.onClick(api); if (r !== false) close(a.value); } catch (e) { toast(e.message, 'error'); } finally { b.disabled = false; }
    });
    foot.appendChild(b);
  }
  if (!actions.length) foot.remove();
  wrap.querySelector('[data-close]').addEventListener('click', () => close(null));
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(null); });
  const onKey = (e) => { if (e.key === 'Escape' && modalStack[modalStack.length - 1] === api) close(null); };
  document.addEventListener('keydown', onKey);
  root.appendChild(wrap);
  modalStack.push(api);
  if (onOpen) onOpen(api);
  const first = wrap.querySelector('input:not([type=hidden]):not([readonly]), select, textarea');
  if (first && !('ontouchstart' in window)) setTimeout(() => first.focus(), 30);
  return api;
}

export function confirmDialog(message, { title = 'Bitte bestätigen', ok = 'OK', danger = false } = {}) {
  return new Promise((resolve) => {
    modal({
      title, body: `<p class="confirm-text">${esc(message)}</p>`,
      actions: [{ label: 'Abbrechen', value: false }, { label: ok, cls: danger ? 'btn-danger' : 'btn-primary', value: true }],
      onClose: (v) => resolve(!!v),
    });
  });
}

export function promptDialog(message, { title = 'Eingabe', value = '', ok = 'OK', type = 'text', inputmode = '' } = {}) {
  return new Promise((resolve) => {
    let input;
    modal({
      title,
      body: `<label class="field"><span>${esc(message)}</span><input type="${type}" ${inputmode ? `inputmode="${inputmode}"` : ''} value="${esc(value)}"></label>`,
      onOpen: (m) => {
        input = m.body.querySelector('input');
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') m.el.querySelector('.btn-primary').click(); });
      },
      actions: [{ label: 'Abbrechen', value: null }, { label: ok, cls: 'btn-primary', onClick: () => { resolve(input.value); } }],
      onClose: (v) => { if (v === null) resolve(null); },
    });
  });
}

export function debounce(fn, ms) {
  let t; let last = []; let pending = false;
  const d = (...args) => { last = args; pending = true; clearTimeout(t); t = setTimeout(() => { pending = false; fn(...last); }, ms); };
  d.flush = (...args) => { clearTimeout(t); if (args.length) last = args; if (pending || args.length) { pending = false; fn(...last); } };
  d.cancel = () => { clearTimeout(t); pending = false; };
  d.pending = () => pending;
  return d;
}

/** Formularwerte als Objekt lesen. */
export function formData(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') {
      if (el.dataset.group) { (out[el.dataset.group] ||= []); if (el.checked) out[el.dataset.group].push(el.value); } else out[el.name] = el.checked;
    } else out[el.name] = el.value;
  }
  return out;
}

export function options(list, selected, { empty = '– keine Auswahl –', label = (x) => x.name, value = (x) => x.id } = {}) {
  return (empty !== null ? `<option value="">${esc(empty)}</option>` : '')
    + list.map((x) => `<option value="${esc(value(x))}" ${String(value(x)) === String(selected ?? '') ? 'selected' : ''}>${esc(label(x))}</option>`).join('');
}

/** Einfache Suche: alle Wörter müssen vorkommen (Groß/Klein, Umlaute tolerant). */
export function norm(s) { return String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss'); }
export function matches(haystack, query) {
  const h = norm(haystack);
  return norm(query).split(/\s+/).filter(Boolean).every((w) => h.includes(w));
}

export function download(url) {
  const a = document.createElement('a');
  a.href = url; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
}

export function emptyState(text, icon = '📭') { return `<div class="empty"><div class="empty-icon">${icon}</div><p>${esc(text)}</p></div>`; }
