'use strict';
/**
 * Eingebauter Updater:
 *  1. fragt die Update-Quelle (Standard: neueste GitHub-Version dieses Projekts) – kein Link nötig
 *  2. lädt die passende Datei (Installer oder Programmordner-ZIP) mit Fortschritt herunter
 *  3. prüft Größe und SHA-256-Prüfsumme
 *  4. beendet EK-Service und spielt das Update über EK-Service-Update.bat ein
 *     (Sicherung von Datenbank und alter Version, Rückfall bei Fehlern, danach Neustart)
 * Quelle änderbar über config.json im Datenordner: { "updateUrl": "https://…" }, abschaltbar mit { "updateCheck": false }.
 */
const { app, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const logic = require('./update-logic');

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

function createUpdater({ dataDir, send }) {
  const exeDir = path.dirname(process.execPath);
  const installed = fs.existsSync(path.join(exeDir, 'Uninstall EK-Service.exe'));
  const bat = path.join(exeDir, 'EK-Service-Update.bat');
  let last = null; // letztes Prüfergebnis
  let busy = false;
  let timer = null;
  const dryRun = process.env.EK_UPDATE_DRYRUN === '1'; // Test: alles außer dem Austausch

  function cfg() {
    try { return JSON.parse(fs.readFileSync(path.join(dataDir(), 'config.json'), 'utf8')); } catch { return {}; }
  }
  const sourceUrl = () => process.env.EK_UPDATE_URL || cfg().updateUrl || logic.DEFAULT_URL;

  async function fetchWithTimeout(url, ms, opts = {}) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), ms);
    try {
      return await net.fetch(url, { ...opts, signal: ac.signal, headers: { 'User-Agent': 'EK-Service-Updater', Accept: 'application/vnd.github+json, application/json', ...(opts.headers || {}) } });
    } finally { clearTimeout(t); }
  }

  async function check() {
    let res;
    try { res = await fetchWithTimeout(sourceUrl(), 20000); } catch (e) {
      throw new Error(e && e.name === 'AbortError' ? 'Zeitüberschreitung bei der Update-Prüfung.' : 'Keine Verbindung zum Update-Server. Internetverbindung prüfen.');
    }
    if (res.status === 404) throw new Error('Es ist noch keine Version veröffentlicht.');
    if (res.status === 403 || res.status === 429) throw new Error('Der Update-Server ist gerade ausgelastet. Bitte später erneut versuchen.');
    if (!res.ok) throw new Error(`Update-Server antwortet mit Fehler ${res.status}.`);
    const json = await res.json();
    last = { ...logic.evaluate(app.getVersion(), json, installed), installed, checked_at: new Date().toISOString(), can_install: dryRun || (fs.existsSync(bat) && app.isPackaged) };
    return last;
  }

  async function download(info, onProgress = () => {}) {
    const a = info.asset;
    const dir = path.join(os.tmpdir(), 'ek-service-update');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, path.basename(a.name).replace(/[^\w.\-]/g, '_'));
    let res;
    try { res = await fetchWithTimeout(a.url, 30 * 60 * 1000, { headers: { Accept: 'application/octet-stream' } }); } catch (e) {
      throw new Error('Download abgebrochen. Internetverbindung prüfen und erneut versuchen.');
    }
    if (!res.ok || !res.body) throw new Error(`Download fehlgeschlagen (Fehler ${res.status}).`);
    const total = Number(res.headers.get('content-length')) || a.size || 0;
    const hash = crypto.createHash('sha256');
    const fd = fs.openSync(file, 'w');
    let got = 0; let lastTick = 0;
    try {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const buf = Buffer.from(value);
        fs.writeSync(fd, buf); hash.update(buf); got += buf.length;
        const now = Date.now();
        if (now - lastTick > 250) { lastTick = now; onProgress({ received: got, total }); }
      }
    } finally { fs.closeSync(fd); }
    onProgress({ received: got, total });
    if (a.size && got !== a.size) throw new Error('Download unvollständig. Bitte erneut versuchen.');
    const sha = hash.digest('hex');
    if (a.sha256 && sha !== a.sha256) throw new Error('Prüfsumme stimmt nicht – die Datei ist beschädigt. Bitte erneut versuchen.');
    const head = Buffer.alloc(2); const h = fs.openSync(file, 'r'); fs.readSync(h, head, 0, 2, 0); fs.closeSync(h);
    const sig = head.toString('latin1');
    if (sig !== 'PK' && sig !== 'MZ') throw new Error('Die heruntergeladene Datei ist kein EK-Service-Update.');
    return { file, size: got, sha256: sha, verified: !!a.sha256 };
  }

  /** Update-Datei unbeaufsichtigt starten und EK-Service beenden; die Datei startet EK-Service danach neu. */
  function apply(file) {
    if (dryRun) { console.log('Update-Probelauf: würde einspielen', file); return; }
    if (!app.isPackaged) throw new Error('Updates werden nur im fertigen Programm eingespielt.');
    if (!fs.existsSync(bat)) throw new Error('Update-Datei (EK-Service-Update.bat) fehlt im Programmordner.');
    const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', bat], {
      cwd: exeDir, detached: true, stdio: 'ignore', windowsHide: false,
      env: { ...process.env, EK_UPDATE_SOURCE: file, EK_UPDATE_YES: '1', EK_UPDATE_APP: '1' },
    });
    child.unref();
    setTimeout(() => app.quit(), 700);
  }

  async function install(onProgress) {
    if (busy) throw new Error('Das Update läuft bereits.');
    busy = true;
    try {
      const info = last && last.available ? last : await check();
      if (!info.available) throw new Error('Es gibt keine neuere Version.');
      if (!info.can_install) throw new Error('Updates werden nur im fertigen Programm eingespielt.');
      const dl = await download(info, onProgress);
      send({ type: 'installing', latest: info.latest });
      apply(dl.file);
      return { ok: true, latest: info.latest };
    } finally { busy = false; }
  }

  async function autoCheck() {
    if (cfg().updateCheck === false) return;
    try {
      const r = await check();
      if (r.available) send({ type: 'available', info: r });
    } catch (e) { console.log('Update-Prüfung:', e.message); }
  }

  function startAuto() {
    setTimeout(autoCheck, 8000);
    timer = setInterval(autoCheck, CHECK_EVERY_MS);
    timer.unref?.();
  }

  return { check, download, install, startAuto, state: () => last, installed };
}

module.exports = { createUpdater };
