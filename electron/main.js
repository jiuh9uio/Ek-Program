'use strict';
/**
 * EK-Service als echtes Windows-Programm (Electron).
 * - eigenes Programmfenster, kein Browser, kein Konsolenfenster
 * - interner Dienst (Datenbank, Bondruck, E-Mail) läuft im Programm selbst, nur lokal (127.0.0.1)
 * - Fenster schließen = Programm beendet; nur eine Instanz
 * - Daten in %APPDATA%\EK-Service\daten; alte Daten (ek-data) werden beim ersten Start übernommen
 */
const { app, BrowserWindow, dialog, shell, Menu, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const ICON = path.join(ROOT, 'assets', 'icon.ico');
const argFile = (flag) => { const i = process.argv.indexOf(flag); return i > 0 ? process.argv[i + 1] : null; };
const selftestFile = argFile('--selbsttest');
const updateTestFile = argFile('--update-test'); // CI: Update prüfen + herunterladen, Ergebnis als JSON
const { createUpdater } = require('./updater');

let win = null;
let core = null; // { db, server, port }
const send = (msg) => { if (win && !win.isDestroyed()) win.webContents.send('ek:update', msg); };
const updater = createUpdater({ dataDir: () => dataDir(), send });

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
  });
  app.whenReady().then(start).catch((e) => fatal(e));
}

app.on('window-all-closed', () => app.quit());
app.on('before-quit', stopCore);

function fatal(e) {
  try { console.error(e); } catch { /* egal */ }
  dialog.showErrorBox('EK-Service', `EK-Service konnte nicht gestartet werden.\n\n${e && e.message ? e.message : e}`);
  app.exit(1);
}

// ---------------------------------------------------------------- Daten
function dataDir() {
  return process.env.EK_DATA_DIR || path.join(app.getPath('userData'), 'daten');
}

/** Ordner mit alten Daten (ek-data/ek-service.db) aus der früheren EXE-Version suchen. */
function findLegacyData() {
  const home = os.homedir();
  const roots = [
    ...(process.env.EK_LEGACY_DIR ? [process.env.EK_LEGACY_DIR] : []), // für automatische Tests
    path.dirname(process.execPath),
    'C:\\EK-Service', 'D:\\EK-Service',
    path.join(home, 'Desktop'), path.join(home, 'Documents'), path.join(home, 'Downloads'), path.join(home, 'OneDrive', 'Desktop'),
    'C:\\',
  ];
  const found = [];
  const check = (dir) => {
    for (const cand of [path.join(dir, 'ek-data'), dir]) {
      const db = path.join(cand, 'ek-service.db');
      try { if (fs.statSync(db).size > 0 && !found.some((f) => f.dir === cand)) found.push({ dir: cand, mtime: fs.statSync(db).mtime }); } catch { /* nicht da */ }
    }
  };
  for (const r of roots) {
    check(r);
    // eine Ebene tiefer (z. B. Desktop\EK-Service\ek-data, Downloads\EK-Service-Windows\ek-data)
    try { for (const e of fs.readdirSync(r, { withFileTypes: true })) if (e.isDirectory() && /ek|service|einkauf/i.test(e.name)) check(path.join(r, e.name)); } catch { /* kein Zugriff */ }
  }
  const legacyFallback = path.join(process.env.LOCALAPPDATA || '', 'EK-Service');
  if (process.env.LOCALAPPDATA) check(legacyFallback);
  return found.sort((a, b) => b.mtime - a.mtime);
}

/** Alte Datenbank konsistent übernehmen (SQLite-Sicherung, funktioniert auch mit WAL-Dateien). */
function importLegacy(fromDir, toDir) {
  const { DatabaseSync } = require('node:sqlite');
  fs.mkdirSync(toDir, { recursive: true });
  const target = path.join(toDir, 'ek-service.db');
  if (fs.existsSync(target)) fs.renameSync(target, `${target}.vor-import-${Date.now()}`);
  const src = new DatabaseSync(path.join(fromDir, 'ek-service.db'));
  try { src.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`); } finally { src.close(); }
  const bak = path.join(fromDir, 'backups');
  if (fs.existsSync(bak)) fs.cpSync(bak, path.join(toDir, 'backups'), { recursive: true, force: false, errorOnExist: false });
}

async function maybeMigrate(dir) {
  if (fs.existsSync(path.join(dir, 'ek-service.db'))) return;
  const legacy = findLegacyData();
  if (selftestFile || process.env.EK_AUTO_IMPORT === '1') { // Test: gefundene Altdaten ohne Rückfrage übernehmen
    if (process.env.EK_LEGACY_DIR && legacy.length) importLegacy(legacy[0].dir, dir);
    return;
  }
  const fmt = (d) => d.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
  const buttons = legacy.length ? ['Übernehmen', 'Anderen Ordner wählen …', 'Neu beginnen'] : ['Ordner wählen …', 'Neu beginnen'];
  const r = await dialog.showMessageBox({
    type: 'question', title: 'EK-Service – erster Start', icon: ICON, buttons, defaultId: 0, cancelId: buttons.length - 1, noLink: true,
    message: legacy.length ? 'Daten aus der bisherigen EK-Service-Version gefunden' : 'Willkommen bei EK-Service',
    detail: legacy.length
      ? `Ordner: ${legacy[0].dir}\nStand: ${fmt(legacy[0].mtime)}\n\nSollen Artikel, Listen, Zählungen und Einstellungen übernommen werden? Die alten Dateien bleiben unverändert.`
      : 'Falls du EK-Service schon benutzt hast, kannst du den alten Datenordner („ek-data“) auswählen und alles übernehmen.',
  });
  let from = null;
  const label = buttons[r.response];
  if (label === 'Übernehmen') from = legacy[0].dir;
  else if (label.endsWith('wählen …')) {
    const p = await dialog.showOpenDialog({ title: 'Alten Datenordner „ek-data“ auswählen', properties: ['openDirectory'] });
    if (!p.canceled && p.filePaths[0]) {
      const pick = p.filePaths[0];
      from = fs.existsSync(path.join(pick, 'ek-service.db')) ? pick : fs.existsSync(path.join(pick, 'ek-data', 'ek-service.db')) ? path.join(pick, 'ek-data') : null;
      if (!from) await dialog.showMessageBox({ type: 'warning', title: 'EK-Service', message: 'In diesem Ordner wurde keine EK-Service-Datenbank (ek-service.db) gefunden. Es wird neu begonnen.' });
    }
  }
  if (from) {
    importLegacy(from, dir);
    await dialog.showMessageBox({ type: 'info', title: 'EK-Service', icon: ICON, message: 'Daten übernommen', detail: `Aus: ${from}\nNach: ${dir}` });
  }
}

// ---------------------------------------------------------------- interner Dienst
async function startCore() {
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  await maybeMigrate(dir);
  process.env.EK_DATA_DIR = dir;
  const { setupFileLog } = require(path.join(ROOT, 'src', 'desktop.js'));
  if (!process.env.EK_CONSOLE_LOG) setupFileLog(dir);
  const { loadConfig } = require(path.join(ROOT, 'src', 'config.js'));
  const config = loadConfig(['--no-browser']);
  let fileCfg = {};
  try { fileCfg = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')); } catch { /* Standard */ }
  // Standard: nur dieses Gerät. Optional WLAN-Zugriff für weitere Geräte: "lanAccess": true in config.json
  const lan = fileCfg.lanAccess === true;
  config.host = lan ? '0.0.0.0' : '127.0.0.1';
  config.port = lan ? (fileCfg.port || 8080) : 0;
  const { createApp } = require(path.join(ROOT, 'src', 'app.js'));
  const { startScheduler } = require(path.join(ROOT, 'src', 'services', 'backup.js'));
  const { db, server } = createApp(config);
  const port = await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => resolve(server.address().port));
  });
  config.port = port;
  startScheduler(db, config.backupDir);
  console.log(`EK-Service ${app.getVersion()} (Programm) bereit auf ${config.host}:${port}, Daten: ${dir}`);
  core = { db, server, port, dir };
}

function stopCore() {
  if (!core) return;
  try { core.server.close(); } catch { /* egal */ }
  try { core.db.close(); } catch { /* egal */ }
  core = null;
}

// ---------------------------------------------------------------- Fenster
function createWindow() {
  const origin = `http://127.0.0.1:${core.port}`;
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600, show: false,
    title: 'EK-Service', icon: ICON, backgroundColor: '#f3f5f8', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, plugins: true, spellcheck: false },
  });
  Menu.setApplicationMenu(null);
  const wc = win.webContents;
  const internal = (url) => url.startsWith(origin + '/');

  // Druckansichten, Etiketten, PDF: eigene Programmfenster; alles andere (mailto, Webseiten) extern
  wc.setWindowOpenHandler(({ url }) => {
    if (internal(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: { icon: ICON, autoHideMenuBar: true, width: 1000, height: 1100, backgroundColor: '#e5e7eb', webPreferences: { plugins: true, sandbox: true, contextIsolation: true } } };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });
  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-navigate', (ev, url) => { if (!internal(url)) { ev.preventDefault(); shell.openExternal(url); } });
    contents.setWindowOpenHandler(({ url }) => (internal(url)
      ? { action: 'allow', overrideBrowserWindowOptions: { icon: ICON, autoHideMenuBar: true, webPreferences: { plugins: true } } }
      : (shell.openExternal(url), { action: 'deny' })));
  });

  // Tastatur: F5 neu laden, F11 Vollbild, Strg +/−/0 Zoom (für Touch auch Pinch-Zoom)
  wc.on('before-input-event', (ev, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F5') { wc.reload(); ev.preventDefault(); }
    else if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); ev.preventDefault(); }
    else if (input.control && (input.key === '+' || input.key === '=')) { wc.setZoomLevel(wc.getZoomLevel() + 0.5); ev.preventDefault(); }
    else if (input.control && input.key === '-') { wc.setZoomLevel(wc.getZoomLevel() - 0.5); ev.preventDefault(); }
    else if (input.control && input.key === '0') { wc.setZoomLevel(0); ev.preventDefault(); }
  });
  wc.setVisualZoomLevelLimits(1, 3).catch(() => {});

  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.on('page-title-updated', (e) => { e.preventDefault(); win.setTitle('EK-Service'); });
  win.loadURL(origin + '/');

  if (selftestFile) {
    wc.once('did-finish-load', async () => {
      try {
        await new Promise((r) => setTimeout(r, 1500));
        const page = await wc.executeJavaScript(`({ title: document.title, tiles: document.querySelectorAll('.user-tile').length, login: !!document.querySelector('#login-form') })`);
        const health = await (await fetch(`${origin}/api/health`)).json();
        fs.writeFileSync(selftestFile, JSON.stringify({ ok: page.login && health.ok, version: app.getVersion(), page, health, dataDir: core.dir, node: process.versions.node, electron: process.versions.electron }, null, 2));
      } catch (e) {
        fs.writeFileSync(selftestFile, JSON.stringify({ ok: false, error: String(e && e.stack || e) }));
      }
      app.quit();
    });
  }
}

// Kleine Brücke zur Oberfläche (Datenordner öffnen, Update-Datei starten)
ipcMain.handle('ek:openDataFolder', () => shell.openPath(dataDir()));
ipcMain.handle('ek:runUpdater', () => {
  const bat = path.join(path.dirname(process.execPath), 'EK-Service-Update.bat');
  if (!fs.existsSync(bat)) return { ok: false, error: 'Update-Datei nicht gefunden.' };
  shell.openPath(bat);
  return { ok: true };
});

/** ZIP-Variante (ohne Installer): beim ersten Start Verknüpfungen auf Desktop und im Startmenü anlegen. */
function ensurePortableShortcuts() {
  if (process.platform !== 'win32' || !app.isPackaged || selftestFile) return;
  const exeDir = path.dirname(process.execPath);
  if (fs.existsSync(path.join(exeDir, 'Uninstall EK-Service.exe'))) return; // per Installer installiert
  const marker = path.join(dataDir(), `.verknuepfungen-${exeDir.replace(/[^a-z0-9]/gi, '_').slice(-60)}`);
  if (fs.existsSync(marker)) return;
  require(path.join(ROOT, 'src', 'desktop.js')).ensureShortcuts(process.execPath)
    .then((ok) => { if (ok) fs.writeFileSync(marker, new Date().toISOString()); })
    .catch(() => {});
}

// Eingebauter Updater (holt die neueste Version selbst, kein Link nötig)
ipcMain.handle('ek:updateCheck', async () => {
  try { return { ok: true, ...(await updater.check()) }; } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('ek:updateState', () => updater.state());
ipcMain.handle('ek:updateInstall', async () => {
  try {
    return await updater.install((p) => send({ type: 'progress', ...p }));
  } catch (e) { send({ type: 'error', error: e.message }); return { ok: false, error: e.message }; }
});

async function runUpdateTest(file) {
  const out = {};
  try {
    out.check = await updater.check();
    if (out.check.available) out.download = await updater.download(out.check, () => {});
    out.ok = true;
  } catch (e) { out.ok = false; out.error = e.message; }
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  app.quit();
}

async function start() {
  app.setAppUserModelId('de.ekservice.app');
  if (updateTestFile) return runUpdateTest(updateTestFile);
  await startCore();
  createWindow();
  ensurePortableShortcuts();
  if (!selftestFile && app.isPackaged) updater.startAuto();
}
