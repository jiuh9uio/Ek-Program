'use strict';
/**
 * Desktop-Verhalten wie ein normales Windows-Programm:
 *  - eigenes App-Fenster (Edge im App-Modus mit eigenem Profil, ohne Adressleiste/Tabs)
 *  - Protokoll in Datei statt Konsolenfenster
 *  - Fehlermeldungen als Windows-Meldungsfenster
 *  - Verknüpfungen auf dem Desktop und im Startmenü
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');

/** Ausgaben in ek-data/logs/ek-service.log schreiben (die EXE hat kein Konsolenfenster). */
function setupFileLog(dataDir) {
  const dir = path.join(dataDir, 'logs');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'ek-service.log');
  try { if (fs.statSync(file).size > 5 * 1024 * 1024) fs.renameSync(file, path.join(dir, 'ek-service.old.log')); } catch { /* neu */ }
  const write = (level, args) => {
    const line = `${new Date().toISOString()} ${level} ${args.map((a) => (a instanceof Error ? a.stack : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`;
    try { fs.appendFileSync(file, line); } catch { /* Platte voll o. ä. */ }
  };
  console.log = (...a) => write('INFO ', a);
  console.info = console.log;
  console.warn = (...a) => write('WARN ', a);
  console.error = (...a) => write('ERROR', a);
  return file;
}

function runPs(script) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve('');
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: 60000 }, (err, stdout) => resolve(err ? '' : String(stdout)));
  });
}

const psStr = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** Windows-Meldungsfenster (blockiert bis OK). */
function messageBox(text, title = 'EK-Service', icon = 'Error') {
  if (process.platform !== 'win32') { process.stderr.write(`${title}: ${text}\n`); return Promise.resolve(); }
  return runPs(`Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show(${psStr(text)}, ${psStr(title)}, 'OK', '${icon}') | Out-Null`);
}

/** Verknüpfungen auf Desktop und im Startmenü (einmalig, mit Programmsymbol). */
async function ensureShortcuts(exePath) {
  if (process.platform !== 'win32') return false;
  const script = `
$ws = New-Object -ComObject WScript.Shell
$targets = @([Environment]::GetFolderPath('Desktop'), (Join-Path ([Environment]::GetFolderPath('Programs')) ''))
foreach ($dir in $targets) {
  if (-not $dir) { continue }
  $lnk = Join-Path $dir 'EK-Service.lnk'
  $s = $ws.CreateShortcut($lnk)
  $s.TargetPath = ${psStr(exePath)}
  $s.WorkingDirectory = ${psStr(path.dirname(exePath))}
  $s.IconLocation = ${psStr(exePath + ',0')}
  $s.Description = 'EK-Service – Einkauf & Bestand (Service)'
  $s.Save()
}
Write-Output 'OK'`;
  return (await runPs(script)).includes('OK');
}

function findEdge() {
  const roots = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
  for (const r of roots) {
    const p = path.join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Programmfenster öffnen: Edge im App-Modus mit eigenem Profil (getrennt vom normalen Browser,
 * keine Adressleiste, kein Tab-Leiste). Fallback: Standardbrowser.
 */
function openAppWindow(url, { dataDir, appWindow = true } = {}) {
  try {
    if (process.platform === 'win32') {
      const edge = appWindow ? findEdge() : null;
      if (edge) {
        const profile = path.join(dataDir, 'fenster');
        fs.mkdirSync(profile, { recursive: true });
        spawn(edge, [
          `--app=${url}`, `--user-data-dir=${profile}`, '--start-maximized', '--no-first-run', '--no-default-browser-check',
          '--disable-features=Translate,msEdgeSidebarV2,msHubApps,EdgeCollections', '--disable-sync', '--hide-crash-restore-bubble',
        ], { detached: true, stdio: 'ignore' }).unref();
      } else {
        spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      }
    } else if (process.platform === 'darwin') execFile('open', [url], () => {});
    else execFile('xdg-open', [url], () => {});
  } catch (e) { console.error('Fenster konnte nicht geöffnet werden', e); }
}

module.exports = { setupFileLog, messageBox, ensureShortcuts, openAppWindow, findEdge };
