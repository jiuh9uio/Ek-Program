'use strict';
/**
 * Einstiegspunkt der EK-Service-Anwendung (Windows-EXE).
 * Verhält sich wie ein normales Programm: Doppelklick öffnet das Programmfenster,
 * Schließen des Fensters beendet das Programm. Der interne Dienst (Datenbank, Druck,
 * E-Mail, WLAN-Zugriff) läuft unsichtbar im Hintergrund.
 */
const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('./config');
const { VERSION } = require('./version');
const desktop = require('./desktop');

const IDLE_AFTER_CLOSE_MS = 15000;   // Fenster zu → nach 15 s beenden (Neuladen/Seitenwechsel überbrücken)
const IDLE_BEFORE_OPEN_MS = 120000;  // Start ohne Fenster (z. B. Edge fehlt) → nach 2 Min. beenden

function listen(server, port, host, attempts = 10) {
  return new Promise((resolve, reject) => {
    const tryPort = (p, left) => {
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && left > 0) tryPort(p + 1, left - 1);
        else reject(err);
      });
      server.listen(p, host, () => resolve(p));
    };
    tryPort(port, attempts);
  });
}

async function alreadyRunning(runFile, port) {
  const ports = [port];
  try { const r = JSON.parse(fs.readFileSync(runFile, 'utf8')); if (r.port) ports.unshift(r.port); } catch { /* keine Datei */ }
  for (const p of [...new Set(ports)]) {
    try {
      const r = await fetch(`http://127.0.0.1:${p}/api/health`, { signal: AbortSignal.timeout(800) });
      if (r.ok && (await r.json()).ok) return p;
    } catch { /* läuft nicht */ }
  }
  return null;
}

async function main() {
  if (process.platform === 'win32') process.title = `EK-Service ${VERSION}`;
  const config = loadConfig();
  const desktopMode = config.isSea && process.platform === 'win32';
  if (desktopMode || process.env.EK_LOG_FILE === '1') desktop.setupFileLog(config.dataDir);
  console.log(`EK-Service ${VERSION} startet – Daten: ${config.dataDir}`);

  // Läuft das Programm schon? Dann nur das Fenster (erneut) öffnen.
  const runFile = path.join(config.dataDir, 'laeuft.json');
  const running = await alreadyRunning(runFile, config.port);
  if (running) {
    console.log(`EK-Service läuft bereits auf Port ${running} – öffne Fenster.`);
    if (config.openBrowser) desktop.openAppWindow(`http://localhost:${running}`, { dataDir: config.dataDir, appWindow: config.appWindow });
    setTimeout(() => process.exit(0), 1500);
    return;
  }

  const { createApp } = require('./app');
  const { startScheduler } = require('./services/backup');
  const { lanUrls } = require('./routes/system');
  const { db, server } = createApp(config);
  const port = await listen(server, config.port, config.host);
  config.port = port;
  fs.writeFileSync(runFile, JSON.stringify({ pid: process.pid, port, started: new Date().toISOString() }));
  startScheduler(db, config.backupDir);
  const local = `http://localhost:${port}`;
  console.log(`Bereit: ${local} | WLAN: ${lanUrls(port).join(', ') || '–'}`);

  let stopping = false;
  const shutdown = (reason) => {
    if (stopping) return;
    stopping = true;
    console.log(`EK-Service wird beendet (${reason}).`);
    try { fs.rmSync(runFile, { force: true }); } catch { /* egal */ }
    server.close();
    try { db.close(); } catch { /* bereits geschlossen */ }
    setTimeout(() => process.exit(0), 300);
  };
  process.on('SIGINT', () => shutdown('Strg+C'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (e) => console.error('[Fehler]', e));
  process.on('unhandledRejection', (e) => console.error('[Fehler]', e));

  if (config.openBrowser) {
    desktop.openAppWindow(local, { dataDir: config.dataDir, appWindow: config.appWindow });
    // Programm beendet sich, sobald kein Fenster mehr offen ist (auch keine Handys/Tablets im WLAN)
    if (config.autoShutdown) startIdleWatch();
  } else if (process.argv.includes('--auto-shutdown')) startIdleWatch(); // für automatische Tests

  function startIdleWatch() {
    {
      setInterval(() => {
        const p = server.presence;
        const idle = Date.now() - p.lastActive;
        if (p.count === 0 && idle > (p.seen ? IDLE_AFTER_CLOSE_MS : IDLE_BEFORE_OPEN_MS)) shutdown('alle Fenster geschlossen');
      }, 3000).unref();
    }
  }

  // Beim ersten Start: Verknüpfungen auf Desktop und im Startmenü
  const marker = path.join(config.dataDir, '.verknuepfungen');
  if (desktopMode && config.createShortcuts && !fs.existsSync(marker)) {
    desktop.ensureShortcuts(process.execPath).then((ok) => {
      if (ok) fs.writeFileSync(marker, new Date().toISOString());
      console.log(ok ? 'Verknüpfungen auf Desktop und im Startmenü angelegt.' : 'Verknüpfungen konnten nicht angelegt werden.');
    });
  }
}

main().catch(async (e) => {
  console.error('Start fehlgeschlagen:', e);
  const hint = e && e.code === 'EADDRINUSE' ? '\n\nDer Netzwerk-Port ist belegt. Bitte den Rechner neu starten oder in ek-data\\config.json einen anderen Port eintragen.'
    : e && /SQLITE_BUSY|database is locked/i.test(String(e.message)) ? '\n\nDie Datenbank wird gerade von einem anderen Programm verwendet.' : '';
  await desktop.messageBox(`EK-Service konnte nicht gestartet werden.\n\n${e && e.message ? e.message : e}${hint}`);
  process.exit(1);
});
