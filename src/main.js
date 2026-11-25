'use strict';
/**
 * Einstiegspunkt der EK-Service-Anwendung (auch für die Windows-EXE).
 * Startet den lokalen Server (inkl. Druckdienst) und öffnet die Oberfläche.
 */
const { execFile, spawn } = require('node:child_process');
const { loadConfig } = require('./config');
const { createApp } = require('./app');
const { startScheduler } = require('./services/backup');
const { lanUrls } = require('./routes/system');
const { VERSION } = require('./version');

function findEdge() {
  const fs = require('node:fs');
  const path = require('node:path');
  const roots = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
  for (const r of roots) {
    const p = path.join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function openUi(url, appWindow) {
  try {
    if (process.platform === 'win32') {
      // Bevorzugt Edge im App-Modus (randloses Fenster, touchfreundlich), sonst Standardbrowser
      const edge = appWindow ? findEdge() : null;
      if (edge) spawn(edge, [`--app=${url}`, '--start-maximized'], { detached: true, stdio: 'ignore' }).unref();
      else spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else if (process.platform === 'darwin') execFile('open', [url], () => {});
    else execFile('xdg-open', [url], () => {});
  } catch { /* Browser konnte nicht geöffnet werden – URL steht in der Konsole */ }
}

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

async function main() {
  if (process.platform === 'win32') process.title = `EK-Service ${VERSION}`;
  const config = loadConfig();
  console.log(`EK-Service ${VERSION} – Einkaufs- und Bestandsmanagement Service`);
  console.log(`Daten: ${config.dataDir}`);
  const { db, server } = createApp(config);

  // Bereits laufende Instanz? Dann nur die Oberfläche öffnen.
  try {
    const r = await fetch(`http://127.0.0.1:${config.port}/api/health`, { signal: AbortSignal.timeout(800) });
    if (r.ok && (await r.json()).ok) {
      console.log('EK-Service läuft bereits – öffne Oberfläche.');
      if (config.openBrowser) openUi(`http://localhost:${config.port}`, config.appWindow);
      setTimeout(() => process.exit(0), 1500);
      return;
    }
  } catch { /* läuft nicht */ }

  const port = await listen(server, config.port, config.host);
  config.port = port;
  startScheduler(db, config.backupDir);
  const local = `http://localhost:${port}`;
  console.log('');
  console.log(`Bereit:  ${local}`);
  for (const u of lanUrls(port)) console.log(`Im WLAN: ${u}   (Smartphones/Tablets)`);
  console.log('');
  console.log('Dieses Fenster geöffnet lassen. Beenden mit Strg+C.');
  if (config.openBrowser) openUi(local, config.appWindow);

  const shutdown = () => {
    console.log('Beende EK-Service …');
    server.close();
    try { db.close(); } catch { /* bereits geschlossen */ }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('uncaughtException', (e) => console.error('[Fehler]', e));
  process.on('unhandledRejection', (e) => console.error('[Fehler]', e));
}

main().catch((e) => {
  console.error('Start fehlgeschlagen:', e);
  if (process.platform === 'win32') setTimeout(() => process.exit(1), 30000); // Fenster offen lassen zum Lesen
  else process.exit(1);
});
