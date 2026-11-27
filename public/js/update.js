// Eingebauter Updater (nur im Windows-Programm): Hinweis-Banner, Fortschritt, Installation.
import { esc, toast, confirmDialog } from './ui.js';

const desk = window.ekDesktop;
let pending = null;   // gefundene neue Version
let dismissed = null; // „Später“ für diese Version
let overlay = null;

const mb = (b) => (b / 1048576).toFixed(b > 104857600 ? 0 : 1).replace('.', ',');

export const updaterAvailable = () => !!(desk && desk.checkUpdate);

/** Banner in den Platzhalter #update-slot zeichnen (nach jedem Neuaufbau der Oberfläche aufrufen). */
export function renderUpdateBanner() {
  const slot = document.getElementById('update-slot');
  if (!slot) return;
  if (!pending || dismissed === pending.latest) { slot.innerHTML = ''; return; }
  slot.innerHTML = `<div class="banner banner-update"><span>⬆️ Neue Version <strong>${esc(pending.latest)}</strong> ist da (du hast ${esc(pending.current)}).</span>
    <span class="btn-row"><button class="btn btn-primary btn-sm" id="upd-now">Jetzt aktualisieren</button><button class="btn btn-sm" id="upd-later">Später</button></span></div>`;
  slot.querySelector('#upd-now').addEventListener('click', () => startUpdate(pending));
  slot.querySelector('#upd-later').addEventListener('click', () => { dismissed = pending.latest; renderUpdateBanner(); });
}

function showOverlay(html) {
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'update-overlay';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `<div class="update-box">${html}</div>`;
}
function hideOverlay() { if (overlay) { overlay.remove(); overlay = null; } }

/** Nachfragen, herunterladen, installieren. */
export async function startUpdate(info) {
  const notes = info.notes ? `<details class="upd-notes"><summary>Was ist neu?</summary><pre>${esc(info.notes)}</pre></details>` : '';
  const size = info.asset && info.asset.size ? ` (${mb(info.asset.size)} MB)` : '';
  const ok = await confirmDialog(`Version ${info.latest} jetzt installieren${size}? EK-Service wird dafür kurz beendet und startet danach von selbst neu. Datenbank und alte Version werden vorher gesichert – deine Daten bleiben erhalten.`, { ok: 'Jetzt aktualisieren', html: notes });
  if (!ok) return;
  showOverlay(`<h2>⬆️ Update auf ${esc(info.latest)}</h2><p id="upd-txt">Verbinde …</p><div class="upd-bar"><div id="upd-fill"></div></div><p class="muted small">Bitte warten – das Fenster nicht schließen.</p>`);
  const r = await desk.installUpdate();
  if (!r || !r.ok) { hideOverlay(); toast(`Update fehlgeschlagen: ${(r && r.error) || 'unbekannter Fehler'}`, 'error', 10000); }
}

function onMessage(msg) {
  if (msg.type === 'available') { pending = msg.info; renderUpdateBanner(); }
  else if (msg.type === 'progress' && overlay) {
    const pct = msg.total ? Math.min(100, Math.round((msg.received / msg.total) * 100)) : null;
    const fill = overlay.querySelector('#upd-fill'); const txt = overlay.querySelector('#upd-txt');
    if (fill) fill.style.width = `${pct ?? 50}%`;
    if (txt) txt.textContent = pct != null ? `Lade herunter … ${pct} % (${mb(msg.received)} von ${mb(msg.total)} MB)` : `Lade herunter … ${mb(msg.received)} MB`;
  } else if (msg.type === 'installing') {
    showOverlay(`<h2>✅ Download fertig</h2><p>Version ${esc(msg.latest)} wird jetzt installiert.<br>EK-Service schließt sich und startet gleich von selbst neu.</p><div class="upd-bar"><div style="width:100%"></div></div>`);
  }
}

/** Einmalig beim Programmstart aufrufen. */
export async function initUpdater() {
  if (!updaterAvailable()) return;
  desk.onUpdate(onMessage);
  try { const s = await desk.updateState(); if (s && s.available) pending = s; } catch { /* egal */ }
}

/** „Nach Updates suchen“ (System). Liefert das Prüfergebnis. */
export async function checkNow() {
  const r = await desk.checkUpdate();
  if (r.ok && r.available) { pending = r; dismissed = null; renderUpdateBanner(); }
  return r;
}
