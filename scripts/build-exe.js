'use strict';
/**
 * Erzeugt eine eigenständige ausführbare Datei (Node.js Single Executable Application).
 *   node scripts/build-exe.js --target win-x64     → dist/EK-Service.exe
 *   node scripts/build-exe.js --target linux-x64   → dist/ek-service (zum Testen)
 *
 * Ablauf: Quellcode bündeln (esbuild) → Oberfläche als SEA-Assets einbetten →
 * passende node-Binärdatei laden → Blob injizieren (postject).
 * Funktioniert plattformübergreifend (Windows-EXE kann unter Linux gebaut werden).
 */
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const BUILD = path.join(ROOT, 'build');
const DIST = path.join(ROOT, 'dist');
const CACHE = path.join(BUILD, 'cache');
const args = process.argv.slice(2);
const target = args[args.indexOf('--target') + 1] || 'win-x64';
const nodeVersion = process.version; // Blob muss mit derselben Node-Version erzeugt werden
const FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

function log(...a) { console.log('[build]', ...a); }

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const get = (u, redirects = 0) => https.get(u, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) { res.resume(); return get(new URL(res.headers.location, u).toString(), redirects + 1); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`Download fehlgeschlagen (${res.statusCode}): ${u}`)); }
      const tmp = dest + '.part';
      const out = fs.createWriteStream(tmp);
      res.pipe(out);
      out.on('finish', () => { out.close(() => { fs.renameSync(tmp, dest); resolve(); }); });
      out.on('error', reject);
    }).on('error', reject);
    get(url);
  });
}

async function nodeBinary() {
  fs.mkdirSync(CACHE, { recursive: true });
  if (target === 'win-x64') {
    const file = path.join(CACHE, `node-${nodeVersion}-win-x64.exe`);
    if (!fs.existsSync(file)) {
      log(`Lade node.exe ${nodeVersion} (win-x64) …`);
      await download(`https://nodejs.org/dist/${nodeVersion}/win-x64/node.exe`, file);
    }
    return file;
  }
  if (target === `${process.platform}-${process.arch}`) return process.execPath;
  throw new Error(`Ziel ${target} wird nicht unterstützt (win-x64 oder ${process.platform}-${process.arch}).`);
}

/** Entfernt die Authenticode-Signatur aus einer PE-Datei (sonst ungültig nach Injektion). */
function stripPeSignature(file) {
  const buf = fs.readFileSync(file);
  const peOff = buf.readUInt32LE(0x3C);
  if (buf.toString('latin1', peOff, peOff + 4) !== 'PE\0\0') throw new Error('Keine PE-Datei');
  const opt = peOff + 24;
  const magic = buf.readUInt16LE(opt);
  const dirBase = opt + (magic === 0x20B ? 112 : 96);
  const secEntry = dirBase + 4 * 8;
  const certOff = buf.readUInt32LE(secEntry);
  const certSize = buf.readUInt32LE(secEntry + 4);
  if (!certOff || !certSize) return buf;
  buf.writeUInt32LE(0, secEntry);
  buf.writeUInt32LE(0, secEntry + 4);
  const out = certOff + certSize >= buf.length - 8 ? buf.subarray(0, certOff) : buf;
  fs.writeFileSync(file, out);
  log(`Signatur entfernt (${certSize} Bytes).`);
  return out;
}

/** Programmsymbol (assets/icon.ico) und Dateieigenschaften in die EXE schreiben. */
function setWindowsIconAndVersion(file) {
  const ResEdit = require('resedit');
  const pkg = require(path.join(ROOT, 'package.json'));
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(file), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);
  const icon = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(ROOT, 'assets', 'icon.ico')));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const groupId = groups.length ? groups[0].id : 1;
  const lang = groups.length ? groups[0].lang : 1031;
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, groupId, lang, icon.icons.map((i) => i.data));

  const [maj, min, pat] = pkg.version.split('.').map(Number);
  const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0] || ResEdit.Resource.VersionInfo.createEmpty();
  vi.setFileVersion(maj, min, pat, 0);
  vi.setProductVersion(maj, min, pat, 0);
  const strings = {
    FileDescription: 'EK-Service – Einkauf & Bestand (Service)',
    ProductName: 'EK-Service',
    CompanyName: '',
    InternalName: 'EK-Service',
    OriginalFilename: 'EK-Service.exe',
    LegalCopyright: '',
    FileVersion: pkg.version,
    ProductVersion: pkg.version,
  };
  const langs = vi.getAllLanguagesForStringValues();
  for (const l of (langs.length ? langs : [{ lang: 1031, codepage: 1200 }])) vi.setStringValues(l, strings);
  vi.outputToResourceEntries(res.entries);
  res.outputResource(exe);
  fs.writeFileSync(file, Buffer.from(exe.generate()));
  log(`Programmsymbol (${icon.icons.length} Größen) und Versionsinfo ${pkg.version} gesetzt.`);
}

function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? listFiles(full, base) : [path.relative(base, full).split(path.sep).join('/')];
  });
}

async function main() {
  fs.mkdirSync(BUILD, { recursive: true });
  fs.mkdirSync(DIST, { recursive: true });

  log('Bündele Quellcode …');
  const esbuild = require('esbuild');
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'src', 'main.js')],
    bundle: true, platform: 'node', format: 'cjs', target: 'node22',
    outfile: path.join(BUILD, 'bundle.js'), minify: false, legalComments: 'none', logLevel: 'warning',
  });

  const assets = {};
  for (const rel of listFiles(path.join(ROOT, 'public'))) assets[`public/${rel}`] = path.join(ROOT, 'public', rel);
  log(`${Object.keys(assets).length} Oberflächen-Dateien werden eingebettet.`);

  const seaConfig = {
    main: path.join(BUILD, 'bundle.js'),
    output: path.join(BUILD, 'sea-prep.blob'),
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
    assets,
  };
  fs.writeFileSync(path.join(BUILD, 'sea-config.json'), JSON.stringify(seaConfig, null, 2));
  execFileSync(process.execPath, ['--experimental-sea-config', path.join(BUILD, 'sea-config.json')], { stdio: 'inherit' });

  const src = await nodeBinary();
  const outName = target.startsWith('win') ? 'EK-Service.exe' : 'ek-service';
  const out = path.join(DIST, outName);
  fs.copyFileSync(src, out);
  fs.chmodSync(out, 0o755);
  if (target.startsWith('win')) stripPeSignature(out);

  log('Injiziere Anwendung …');
  const { inject } = require('postject');
  await inject(out, 'NODE_SEA_BLOB', fs.readFileSync(seaConfig.output), { sentinelFuse: FUSE });
  // Symbol erst nach der Injektion setzen (resedit übernimmt alle Ressourcen inkl. NODE_SEA_BLOB)
  if (target.startsWith('win')) setWindowsIconAndVersion(out);
  const mb = (fs.statSync(out).size / 1024 / 1024).toFixed(1);
  log(`Fertig: ${path.relative(ROOT, out)} (${mb} MB, Node ${nodeVersion})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
