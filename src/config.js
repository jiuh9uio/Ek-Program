'use strict';
/**
 * Laufzeitkonfiguration.
 * Datenverzeichnis: EK_DATA_DIR > Ordner "ek-data" neben der EXE (falls beschreibbar)
 * > %LOCALAPPDATA%\EK-Service (Windows) bzw. ~/.ek-service.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

let isSea = false;
try { isSea = require('node:sea').isSea(); } catch { /* ältere Node-Version */ }

function writable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.write-test');
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return true;
  } catch { return false; }
}

function resolveDataDir() {
  if (process.env.EK_DATA_DIR) return path.resolve(process.env.EK_DATA_DIR);
  const baseDir = isSea ? path.dirname(process.execPath) : path.resolve(__dirname, '..');
  const local = path.join(baseDir, 'ek-data');
  if (writable(local)) return local;
  const appData = process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share');
  return path.join(appData, 'EK-Service');
}

function loadConfig(argv = process.argv.slice(2)) {
  const dataDir = resolveDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  const cfgFile = path.join(dataDir, 'config.json');
  let fileCfg = {};
  if (fs.existsSync(cfgFile)) {
    try { fileCfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8')); } catch (e) {
      console.error('config.json ist ungültig und wird ignoriert:', e.message);
    }
  } else {
    fileCfg = { port: 8080, host: '0.0.0.0', openBrowser: true, appWindow: true };
    fs.writeFileSync(cfgFile, JSON.stringify(fileCfg, null, 2));
  }
  const arg = (name) => argv.includes(name);
  const argVal = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  return {
    isSea,
    dataDir,
    dbFile: path.join(dataDir, 'ek-service.db'),
    backupDir: path.join(dataDir, 'backups'),
    port: Number(argVal('--port') || process.env.EK_PORT || fileCfg.port || 8080),
    host: argVal('--host') || process.env.EK_HOST || fileCfg.host || '0.0.0.0',
    openBrowser: !arg('--no-browser') && fileCfg.openBrowser !== false && process.env.EK_NO_BROWSER !== '1',
    appWindow: fileCfg.appWindow !== false,
  };
}

module.exports = { loadConfig, isSea };
