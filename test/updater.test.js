'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { compareVersions, normalizeRelease, evaluate } = require('../electron/update-logic');

const gh = (tag, names) => ({
  tag_name: tag, body: 'Neu: Updater', html_url: 'https://github.com/x/y/releases/tag/' + tag,
  assets: names.map((n) => ({ name: n, browser_download_url: 'https://example.com/' + n, size: 1234, digest: 'sha256:ABCDEF' })),
});

test('Versionsvergleich', () => {
  assert.ok(compareVersions('1.5.10', '1.5.9') > 0);
  assert.ok(compareVersions('v2.0.0', '1.99.99') > 0);
  assert.strictEqual(compareVersions('1.5.0', 'v1.5.0'), 0);
  assert.ok(compareVersions('1.4.0', '1.5.0') < 0);
  assert.strictEqual(compareVersions('unsinn', '1.0.0'), 0);
});

test('GitHub-Antwort wird ausgewertet (Prüfsumme, Dateien)', () => {
  const r = normalizeRelease(gh('v1.5.20', ['EK-Service-Setup-1.5.20.exe', 'EK-Service-Programm-1.5.20.zip', 'EK-Service-Update.bat']));
  assert.strictEqual(r.version, '1.5.20');
  assert.strictEqual(r.setup.name, 'EK-Service-Setup-1.5.20.exe');
  assert.strictEqual(r.zip.name, 'EK-Service-Programm-1.5.20.zip');
  assert.strictEqual(r.zip.sha256, 'abcdef');
});

test('Passende Datei: Installer für installierte, ZIP für Programmordner', () => {
  const json = gh('v1.5.20', ['EK-Service-Setup-1.5.20.exe', 'EK-Service-Programm-1.5.20.zip']);
  const inst = evaluate('1.5.0', json, true);
  assert.strictEqual(inst.available, true);
  assert.strictEqual(inst.kind, 'setup');
  const port = evaluate('1.5.0', json, false);
  assert.strictEqual(port.kind, 'ordner');
  assert.match(port.asset.url, /Programm-1\.5\.20\.zip$/);
});

test('Kein Update bei gleicher/älterer Version oder fehlender Datei', () => {
  assert.strictEqual(evaluate('1.5.20', gh('v1.5.20', ['EK-Service-Programm-1.5.20.zip']), false).reason, 'aktuell');
  assert.strictEqual(evaluate('1.6.0', gh('v1.5.20', ['EK-Service-Programm-1.5.20.zip']), false).available, false);
  const noFile = evaluate('1.5.0', gh('v1.5.20', ['EK-Service-Setup-1.5.20.exe']), false);
  assert.strictEqual(noFile.available, false);
  assert.strictEqual(noFile.reason, 'keine-datei');
});

test('Eigene Update-Quelle (einfache JSON-Datei)', () => {
  const r = evaluate('1.0.0', { version: '1.2.3', notes: 'x', zip: { url: 'http://nas/ek.zip', size: 5, sha256: 'AA' } }, false);
  assert.strictEqual(r.available, true);
  assert.strictEqual(r.asset.sha256, 'aa');
  assert.throws(() => normalizeRelease({ foo: 1 }), /Versionsangabe/);
});
