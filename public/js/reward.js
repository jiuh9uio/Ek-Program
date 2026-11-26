// Positive Rückmeldungen: Töne, Vibration, Animationen, Konfetti, Abzeichen-Freischaltungen.
// Alles abschaltbar (pro Gerät); "Bewegung reduzieren" des Betriebssystems wird respektiert.
import { get } from './api.js';
import { esc } from './ui.js';

const KEY = 'ek.reward.prefs';
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function prefs() {
  try { return { sound: true, haptics: true, motion: true, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { sound: true, haptics: true, motion: true }; }
}
export function setPrefs(p) { try { localStorage.setItem(KEY, JSON.stringify({ ...prefs(), ...p })); } catch { /* egal */ } }
const motionOn = () => prefs().motion && !reducedMotion();

// ---------- Töne (Web Audio, keine Dateien nötig) ----------
let ctx = null;
function audio() {
  if (!prefs().sound) return null;
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch { return null; }
}
function tone(freq, start, dur, { type = 'sine', vol = 0.08 } = {}) {
  const a = audio(); if (!a) return;
  const t = a.currentTime + start;
  const o = a.createOscillator(); const g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
export const sound = {
  tick: () => tone(880, 0, 0.07, { type: 'triangle', vol: 0.05 }),
  pop: () => { tone(660, 0, 0.06, { vol: 0.06 }); tone(990, 0.05, 0.09, { vol: 0.05 }); },
  success: () => { tone(784, 0, 0.12); tone(1046, 0.1, 0.22); },
  milestone: () => { tone(659, 0, 0.1); tone(784, 0.09, 0.1); tone(988, 0.18, 0.25); },
  fanfare: () => { [523, 659, 784, 1046].forEach((f, i) => tone(f, i * 0.11, 0.25, { vol: 0.07 })); tone(1318, 0.48, 0.5, { vol: 0.06 }); },
  soft: () => tone(520, 0, 0.12, { vol: 0.04 }),
};

// ---------- Vibration ----------
export function haptic(pattern = 12) {
  if (!prefs().haptics || !navigator.vibrate) return;
  try { navigator.vibrate(pattern); } catch { /* nicht unterstützt */ }
}

// ---------- Mini-Animationen ----------
export function pop(el) {
  if (!el || !motionOn()) return;
  el.classList.remove('rw-pop'); void el.offsetWidth; el.classList.add('rw-pop');
}
export function floatText(anchor, text) {
  if (!anchor || !motionOn()) return;
  const r = anchor.getBoundingClientRect();
  const f = document.createElement('div');
  f.className = 'rw-float'; f.textContent = text;
  f.style.left = `${r.left + r.width / 2}px`; f.style.top = `${r.top}px`;
  document.body.appendChild(f);
  setTimeout(() => f.remove(), 1100);
}

// ---------- Konfetti ----------
export function confetti({ amount = 140, duration = 2600 } = {}) {
  if (!motionOn()) return;
  const c = document.createElement('canvas');
  c.className = 'rw-confetti';
  c.width = innerWidth * devicePixelRatio; c.height = innerHeight * devicePixelRatio;
  document.body.appendChild(c);
  const g = c.getContext('2d'); g.scale(devicePixelRatio, devicePixelRatio);
  const colors = ['#2563eb', '#16a34a', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4'];
  const parts = Array.from({ length: amount }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * innerWidth * 0.3, y: innerHeight * 0.35,
    vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 13 - 4, s: 5 + Math.random() * 6,
    r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3, c: colors[(Math.random() * colors.length) | 0],
  }));
  const t0 = performance.now();
  const step = (t) => {
    const k = (t - t0) / duration;
    g.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += 0.35; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      g.save(); g.globalAlpha = Math.max(0, 1 - k); g.translate(p.x, p.y); g.rotate(p.r);
      g.fillStyle = p.c; g.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); g.restore();
    }
    if (k < 1) requestAnimationFrame(step); else c.remove();
  };
  requestAnimationFrame(step);
}

// ---------- Feier-Karte (z. B. Abzeichen, Liste fertig) ----------
let queue = Promise.resolve();
let minor = null;
function showCard({ icon, title, text, ms, big }) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = `rw-card ${big ? 'rw-big' : ''}`;
    el.setAttribute('role', 'status');
    el.innerHTML = `<div class="rw-icon">${esc(icon)}</div><div><strong>${esc(title)}</strong>${text ? `<p>${esc(text)}</p>` : ''}</div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    let done = false;
    const close = () => { if (done) return; done = true; el.classList.remove('show'); setTimeout(() => { el.remove(); resolve(); }, 350); };
    el.addEventListener('click', close);
    setTimeout(close, ms);
    el._close = close;
  });
}
/** Große Feiern (Abzeichen, Liste fertig) laufen nacheinander; kleine ersetzen sich sofort (kein Rückstau). */
export function celebrate({ icon = '🎉', title, text = '', ms = 3200, big = false }) {
  if (!big) {
    if (minor && minor._close) minor._close();
    const p = showCard({ icon, title, text, ms: Math.min(ms, 2400), big });
    minor = document.querySelector('.rw-card:not(.rw-big):last-of-type');
    return p;
  }
  if (minor && minor._close) minor._close();
  queue = queue.then(() => showCard({ icon, title, text, ms, big }));
  return queue;
}

// ---------- Abzeichen & Level ----------
let meId = null;
export function setUser(id) { meId = id; }
const seenKey = () => `ek.reward.seen.${meId}`;

/** Prüft auf neu freigeschaltete Abzeichen/Level und feiert sie. */
export async function checkAchievements() {
  if (!meId) return null;
  let a;
  try { a = await get('/api/me/achievements', { quiet: true }); } catch { return null; }
  let seen = null;
  try { seen = JSON.parse(localStorage.getItem(seenKey()) || 'null'); } catch { seen = null; }
  const earnedNow = a.badges.filter((b) => b.earned).map((b) => b.key);
  try { localStorage.setItem(seenKey(), JSON.stringify({ badges: earnedNow, level: a.level })); } catch { /* egal */ }
  if (!seen) return a; // erster Aufruf auf diesem Gerät: nichts nachträglich "feuern"
  const fresh = a.badges.filter((b) => b.earned && !seen.badges.includes(b.key));
  if (fresh.length || a.level > seen.level) { sound.fanfare(); haptic([20, 40, 20]); confetti({ amount: 90 }); }
  for (const b of fresh) celebrate({ icon: b.icon, title: `Abzeichen freigeschaltet: ${b.title}`, text: b.desc, big: true });
  if (a.level > seen.level) celebrate({ icon: '⭐', title: `Level ${a.level}: ${a.level_title}!`, text: `${a.xp} Erfahrungspunkte`, big: true });
  return a;
}

export function greeting(name) {
  const h = new Date().getHours();
  const first = String(name || '').split(' ')[0];
  if (h < 11) return `Guten Morgen, ${first}! ☀️`;
  if (h < 17) return `Hallo, ${first}! 👋`;
  return `Guten Abend, ${first}! 🌙`;
}
