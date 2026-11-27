'use strict';
/**
 * Baut die Programmversion als Ordner (ohne Installer) und packt sie als ZIP:
 *   node scripts/build-portable.js   → dist-app/EK-Service-Programm-<version>.zip
 * Funktioniert unter Linux/macOS/Windows (kein wine nötig). Symbol und Versionsinfo
 * der EK-Service.exe werden per resedit gesetzt.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const pkg = require(path.join(ROOT, 'package.json'));
const OUT = path.join(ROOT, 'dist-app');
const log = (...a) => console.log('[portable]', ...a);

function stripPeSignature(buf) {
  const peOff = buf.readUInt32LE(0x3C);
  const opt = peOff + 24;
  const dirBase = opt + (buf.readUInt16LE(opt) === 0x20B ? 112 : 96);
  const sec = dirBase + 4 * 8;
  const off = buf.readUInt32LE(sec); const size = buf.readUInt32LE(sec + 4);
  if (!off || !size) return buf;
  buf.writeUInt32LE(0, sec); buf.writeUInt32LE(0, sec + 4);
  return off + size >= buf.length - 8 ? buf.subarray(0, off) : buf;
}

function setIconAndVersion(file) {
  const ResEdit = require('resedit');
  const exe = ResEdit.NtExecutable.from(stripPeSignature(fs.readFileSync(file)), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);
  const icon = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(ROOT, 'assets', 'icon.ico')));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, groups.length ? groups[0].id : 1, groups.length ? groups[0].lang : 1033, icon.icons.map((i) => i.data));
  const [maj, min, pat] = pkg.version.split('.').map(Number);
  const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0] || ResEdit.Resource.VersionInfo.createEmpty();
  vi.setFileVersion(maj, min, pat, 0); vi.setProductVersion(maj, min, pat, 0);
  const strings = { FileDescription: 'EK-Service – Einkauf & Bestand (Service)', ProductName: 'EK-Service', CompanyName: 'EK-Service', InternalName: 'EK-Service', OriginalFilename: 'EK-Service.exe', LegalCopyright: '', FileVersion: pkg.version, ProductVersion: pkg.version };
  const langs = vi.getAllLanguagesForStringValues();
  for (const l of (langs.length ? langs : [{ lang: 1033, codepage: 1200 }])) vi.setStringValues(l, strings);
  vi.outputToResourceEntries(res.entries);
  res.outputResource(exe);
  fs.writeFileSync(file, Buffer.from(exe.generate()));
}

log(`Baue Programmordner (Version ${pkg.version}) …`);
fs.rmSync(path.join(OUT, 'win-unpacked'), { recursive: true, force: true });
execFileSync(process.execPath, [require.resolve('electron-builder/cli.js'), '--win', 'dir', '--x64', '--publish', 'never', '-c.win.signAndEditExecutable=false'], { cwd: ROOT, stdio: 'inherit' });
const dir = path.join(OUT, 'win-unpacked');
const exe = path.join(dir, 'EK-Service.exe');
setIconAndVersion(exe);
log('Symbol und Versionsinfo gesetzt.');

// Ordner als „EK-Service“ verpacken
const stage = path.join(OUT, 'zip-stage');
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
fs.cpSync(dir, path.join(stage, 'EK-Service'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'README.md'), path.join(stage, 'EK-Service', 'ANLEITUNG.md'));
const zip = path.join(OUT, `EK-Service-Programm-${pkg.version}.zip`);
fs.rmSync(zip, { force: true });
if (process.platform === 'win32') {
  execFileSync('powershell.exe', ['-NoProfile', '-Command', `Compress-Archive -Path 'EK-Service' -DestinationPath '${zip.replace(/'/g, "''")}' -CompressionLevel Optimal`], { cwd: stage, stdio: 'inherit' });
} else {
  execFileSync('zip', ['-9', '-q', '-r', zip, 'EK-Service'], { cwd: stage, stdio: 'inherit' });
}
fs.rmSync(stage, { recursive: true, force: true });
log(`Fertig: ${path.relative(ROOT, zip)} (${(fs.statSync(zip).size / 1048576).toFixed(1)} MB)`);
