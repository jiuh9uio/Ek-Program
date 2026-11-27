// Einstieg der Oberfläche: Anmeldung, Navigation, Hash-Router.
import { get, post, setUnauthorizedHandler } from './api.js';
import { esc, toast, modal } from './ui.js';
import { enableScanner, setFallbackHandler } from './scanner.js';
import { initUpdater, renderUpdateBanner } from './update.js';
import { setUser, prefs as rwPrefs, setPrefs as rwSetPrefs, checkAchievements, sound } from './reward.js';

const VIEWS = {
  dashboard: { label: 'Dashboard', icon: '▦', load: () => import('./views/dashboard.js') },
  mode: { label: 'Einkaufsmodus', icon: '✓', load: () => import('./views/mode.js'), perm: ['stock.count', 'list.create'] },
  count: { label: 'Bestandszählungen', icon: '📋', load: () => import('./views/count.js'), perm: ['stock.count'] },
  lists: { label: 'Einkaufslisten', icon: '☰', load: () => import('./views/lists.js') },
  articles: { label: 'Artikel', icon: '▤', load: () => import('./views/articles.js') },
  suppliers: { label: 'Lieferanten', icon: '⛟', load: () => import('./views/suppliers.js') },
  master: { label: 'Stammdaten', icon: '⚙', load: () => import('./views/master.js'), perm: ['articles.manage'] },
  printers: { label: 'Drucker', icon: '⎙', load: () => import('./views/printers.js'), perm: ['printers.manage'] },
  users: { label: 'Benutzer', icon: '👤', load: () => import('./views/users.js'), perm: ['users.manage'] },
  achievements: { label: 'Meine Erfolge', icon: '🏆', load: () => import('./views/achievements.js') },
  audit: { label: 'Protokoll', icon: '⧗', load: () => import('./views/audit.js'), perm: ['system.manage'] },
  settings: { label: 'System', icon: '⛭', load: () => import('./views/settings.js'), perm: ['system.manage'] },
};

export const state = { user: null, company: '', catalog: {}, defaultAdminPassword: false };
export const can = (p) => !!state.user && state.user.permissions.includes(p);
const allowed = (v) => !v.perm || v.perm.some(can);

let currentView = null;

setUnauthorizedHandler(() => { if (state.user) { state.user = null; toast('Sitzung abgelaufen – bitte erneut anmelden.', 'error'); renderLogin(); } });

async function boot() {
  initUpdater();
  try {
    const me = await get('/api/auth/me', { quiet: true });
    applyMe(me);
    renderShell();
  } catch {
    renderLogin();
  }
}

function applyMe(me) {
  state.user = me.user;
  state.company = me.company_name;
  state.catalog = me.permissions_catalog;
  state.defaultAdminPassword = me.default_admin_password;
  setUser(me.user.id);
  enableScanner(true);
  setTimeout(() => checkAchievements(), 1500);
}

// ---------------- Anmeldung (touchfreundlich: Benutzerkacheln + PIN-Feld) ----------------
// Scan außerhalb von Zählung/Einkaufsmodus/Artikeln: Artikel öffnen bzw. Code zuordnen
setFallbackHandler(async (code) => {
  if (!state.user || document.querySelector('.modal-backdrop')) return;
  const { resolveCode } = await import('./views/scanhelp.js');
  const art = await resolveCode(code);
  if (!art) return;
  toast(`📷 ${art.name}`, 'info');
  sessionStorage.setItem('ek.openArticle', String(art.id));
  navigate('/articles');
});

async function renderLogin() {
  enableScanner(false);
  if (currentView && currentView.destroy) currentView.destroy();
  currentView = null;
  const app = document.getElementById('app');
  let users = [];
  try { users = await get('/api/auth/users', { quiet: true }); } catch (e) { toast(e.message, 'error'); }
  app.innerHTML = `
    <div class="login">
      <div class="login-card">
        <div class="login-brand"><img src="/icon.svg" alt=""><div><h1>EK-Service</h1><p>Einkauf &amp; Bestand · Service</p></div></div>
        <div class="user-tiles">${users.map((u) => `<button type="button" class="user-tile" data-user="${esc(u.username)}"><span class="avatar">${esc(u.display_name.slice(0, 1).toUpperCase())}</span><span>${esc(u.display_name)}</span><small>${u.role === 'admin' ? 'Administrator' : 'Service'}</small></button>`).join('')}</div>
        <form id="login-form" autocomplete="off">
          <label class="field"><span>Benutzername</span><input name="username" autocapitalize="none" required></label>
          <label class="field"><span>PIN / Passwort</span><input name="password" type="password" required></label>
          <div class="pinpad" aria-label="Ziffernblock">${[1, 2, 3, 4, 5, 6, 7, 8, 9, '⌫', 0, '↵'].map((k) => `<button type="button" class="pin-key" data-key="${k}">${k}</button>`).join('')}</div>
          <button class="btn btn-primary btn-block btn-lg" type="submit">Anmelden</button>
        </form>
      </div>
    </div>`;
  const form = app.querySelector('#login-form');
  const pw = form.password;
  app.querySelectorAll('.user-tile').forEach((b) => b.addEventListener('click', () => {
    app.querySelectorAll('.user-tile').forEach((x) => x.classList.toggle('sel', x === b));
    form.username.value = b.dataset.user; pw.value = ''; pw.focus();
  }));
  app.querySelectorAll('.pin-key').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.key;
    if (k === '⌫') pw.value = pw.value.slice(0, -1);
    else if (k === '↵') form.requestSubmit();
    else pw.value += k;
  }));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await post('/api/auth/login', { username: form.username.value, password: pw.value });
      applyMe(await get('/api/auth/me'));
      renderShell();
    } catch (err) { toast(err.message, 'error'); pw.value = ''; pw.focus(); }
  });
}

// ---------------- Rahmen mit Navigation ----------------
function renderShell() {
  const app = document.getElementById('app');
  const nav = Object.entries(VIEWS).filter(([, v]) => allowed(v));
  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar" id="sidebar">
        <div class="brand"><img src="/icon.svg" alt=""><div><strong>EK-Service</strong><small>${esc(state.company || 'Service')}</small></div></div>
        <nav>${nav.map(([k, v]) => `<a href="#/${k}" data-view="${k}"><span class="nav-ico">${v.icon}</span>${esc(v.label)}</a>`).join('')}</nav>
        <div class="sidebar-foot">
          <button class="user-chip" id="user-menu" type="button"><span class="avatar">${esc(state.user.display_name.slice(0, 1).toUpperCase())}</span><span><strong>${esc(state.user.display_name)}</strong><small>${state.user.role === 'admin' ? 'Administrator' : 'Servicemitarbeiter'}</small></span></button>
        </div>
      </aside>
      <div class="main-wrap">
        <header class="topbar">
          <button class="btn-icon menu-btn" id="menu-btn" aria-label="Menü">☰</button>
          <h1 id="view-title"></h1>
          <div class="topbar-actions" id="topbar-actions"></div>
        </header>
        ${state.defaultAdminPassword ? '<div class="banner banner-warn">Sicherheitshinweis: Das Standardpasswort „admin“ ist noch aktiv. Bitte über das Benutzermenü (unten links) ändern.</div>' : ''}
        <div id="update-slot"></div>
        <main id="view" class="view"></main>
      </div>
      <nav class="bottom-nav">${nav.filter(([k]) => ['dashboard', 'mode', 'lists', 'articles'].includes(k)).map(([k, v]) => `<a href="#/${k}" data-view="${k}"><span>${v.icon}</span><small>${esc(v.label)}</small></a>`).join('')}<button type="button" id="more-btn"><span>⋯</span><small>Mehr</small></button></nav>
    </div>`;
  const sidebar = app.querySelector('#sidebar');
  app.querySelector('#menu-btn').addEventListener('click', () => sidebar.classList.toggle('open'));
  app.querySelector('#more-btn').addEventListener('click', () => sidebar.classList.toggle('open'));
  sidebar.addEventListener('click', (e) => { if (e.target.closest('a')) sidebar.classList.remove('open'); });
  app.querySelector('#user-menu').addEventListener('click', userMenu);
  window.onhashchange = route;
  renderUpdateBanner();
  route();
}

function userMenu() {
  const m = modal({
    title: state.user.display_name,
    body: `<p class="muted">Angemeldet als <strong>${esc(state.user.username)}</strong> (${state.user.role === 'admin' ? 'Administrator' : 'Servicemitarbeiter'})</p>
      <form id="pw-form" class="form-grid">
        <label class="field"><span>Aktuelles Passwort/PIN</span><input type="password" name="current" required></label>
        <label class="field"><span>Neues Passwort/PIN (mind. 4 Zeichen)</span><input type="password" name="next" required minlength="4"></label>
        <button class="btn" type="submit">Passwort ändern</button>
      </form>
      <hr><h3>Rückmeldungen auf diesem Gerät</h3>
      <div class="form-grid" id="rw-prefs">
        <label class="check"><input type="checkbox" data-rw="sound" ${rwPrefs().sound ? 'checked' : ''}> 🔊 Töne</label>
        <label class="check"><input type="checkbox" data-rw="haptics" ${rwPrefs().haptics ? 'checked' : ''}> 📳 Vibration (Smartphone/Tablet)</label>
        <label class="check"><input type="checkbox" data-rw="motion" ${rwPrefs().motion ? 'checked' : ''}> ✨ Animationen &amp; Konfetti</label>
      </div>
      <hr><details><summary>Meine Berechtigungen</summary><ul class="perm-list">${state.user.permissions.map((p) => `<li>${esc(state.catalog[p] || p)}</li>`).join('')}</ul></details>`,
    actions: [{ label: 'Abmelden', cls: 'btn-danger', onClick: async () => { await post('/api/auth/logout'); state.user = null; renderLogin(); } }, { label: 'Schließen' }],
  });
  m.body.querySelectorAll('[data-rw]').forEach((c) => c.addEventListener('change', () => { rwSetPrefs({ [c.dataset.rw]: c.checked }); if (c.dataset.rw === 'sound' && c.checked) sound.success(); }));
  m.body.querySelector('#pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await post('/api/auth/password', { current: f.current.value, next: f.next.value });
      toast('Passwort geändert.', 'success');
      state.defaultAdminPassword = false;
      document.querySelector('.banner-warn')?.remove();
      m.close();
    } catch (err) { toast(err.message, 'error'); }
  });
}

async function route() {
  const hash = location.hash.replace(/^#\/?/, '') || 'dashboard';
  const [name, ...rest] = hash.split('/');
  const def = VIEWS[name] && allowed(VIEWS[name]) ? VIEWS[name] : VIEWS.dashboard;
  const key = VIEWS[name] && allowed(VIEWS[name]) ? name : 'dashboard';
  if (currentView && currentView.destroy) currentView.destroy();
  document.querySelectorAll('[data-view]').forEach((a) => a.classList.toggle('active', a.dataset.view === key));
  document.getElementById('view-title').textContent = def.label;
  document.getElementById('topbar-actions').innerHTML = '';
  const el = document.getElementById('view');
  el.innerHTML = '<div class="loading">Lädt …</div>';
  el.scrollTop = 0;
  try {
    const mod = await def.load();
    currentView = (await mod.render(el, { params: rest, state, can, setTitle, setActions })) || null;
  } catch (e) {
    console.error(e);
    el.innerHTML = `<div class="error-box"><strong>Fehler beim Laden</strong><p>${esc(e.message)}</p><button class="btn" id="retry">Erneut versuchen</button></div>`;
    el.querySelector('#retry').addEventListener('click', route);
  }
}

function setTitle(t) { document.getElementById('view-title').textContent = t; }
function setActions(html) {
  const el = document.getElementById('topbar-actions');
  el.innerHTML = html;
  return el;
}

export function navigate(path) { if (location.hash === '#' + path) route(); else location.hash = path; }

// Offenes Fenster melden: Schließt man alle Fenster, beendet sich EK-Service automatisch
try { new EventSource('/api/presence'); } catch { /* ältere Browser */ }

boot();
