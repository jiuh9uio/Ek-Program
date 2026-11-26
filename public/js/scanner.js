// Barcode-/QR-Scanner (Tastatur-Modus, USB/Bluetooth/eingebaut): erkennt schnelle Zeichenfolgen mit Enter/Tab.
// Ansichten registrieren einen Handler; gescannte Zeichen landen nicht im gerade fokussierten Eingabefeld.

const MAX_GAP = 50;      // ms zwischen zwei Zeichen eines Scans
const MIN_LEN = 4;
const handlers = [];
let fallback = null;
let buf = [];
let last = 0;
let snapshot = null;     // Zustand des fokussierten Feldes vor Scanbeginn
let enabled = false;

export function pushScanHandler(fn) {
  handlers.push(fn);
  return () => { const i = handlers.lastIndexOf(fn); if (i >= 0) handlers.splice(i, 1); };
}
export function setFallbackHandler(fn) { fallback = fn; }
export function enableScanner(on = true) { enabled = on; buf = []; }

function isTextField(el) {
  return el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit'].includes(el.type)));
}

function onKey(e) {
  if (!enabled || e.ctrlKey || e.altKey || e.metaKey) return;
  const el = document.activeElement;
  if (el && el.dataset && el.dataset.scanAccept !== undefined) return; // Feld nimmt Scans direkt an
  const now = performance.now();
  if (e.key === 'Enter' || e.key === 'Tab') {
    const fast = buf.length >= MIN_LEN && now - last < 120;
    if (fast) {
      e.preventDefault(); e.stopPropagation();
      const code = buf.join('');
      if (snapshot && snapshot.el && isTextField(snapshot.el)) {
        snapshot.el.value = snapshot.value; // eingetippte Scan-Zeichen wieder entfernen
        snapshot.el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      buf = []; snapshot = null;
      dispatch(code);
    } else { buf = []; snapshot = null; }
    return;
  }
  if (e.key.length !== 1) return;
  if (now - last > MAX_GAP) { buf = []; snapshot = isTextField(el) ? { el, value: el.value } : { el: null }; }
  buf.push(e.key);
  last = now;
}

function dispatch(code) {
  const h = handlers[handlers.length - 1] || fallback;
  if (h) Promise.resolve(h(code)).catch((err) => console.error('Scan-Handler', err));
}

window.addEventListener('keydown', onKey, true);

/** Für Tests/Bedienung ohne Scanner: Code manuell auslösen. */
export function simulateScan(code) { dispatch(code); }
