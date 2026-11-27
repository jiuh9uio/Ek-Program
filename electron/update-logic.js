'use strict';
/**
 * Reine Update-Logik (ohne Electron, testbar):
 * - Versionsvergleich
 * - Auswertung der Update-Quelle (GitHub-„latest release“ oder einfache JSON-Datei)
 * - Auswahl der passenden Datei (Installer bei installierter Version, sonst Programmordner-ZIP)
 */

const DEFAULT_URL = 'https://api.github.com/repos/jiuh9uio/Ek-Program/releases/latest';

function parseVersion(v) {
  const m = String(v || '').trim().replace(/^v/i, '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  return m ? [Number(m[1]), Number(m[2] || 0), Number(m[3] || 0)] : null;
}

/** >0 wenn a neuer als b, 0 gleich, <0 älter */
function compareVersions(a, b) {
  const x = parseVersion(a); const y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/**
 * Antwort der Update-Quelle in ein einheitliches Format bringen.
 * GitHub: { tag_name, name, body, html_url, assets: [{ name, browser_download_url, size, digest }] }
 * Eigene JSON-Datei: { version, notes, setup: { url, size, sha256 }, zip: { url, size, sha256 } }
 */
function normalizeRelease(json) {
  if (!json || typeof json !== 'object') throw new Error('Ungültige Antwort der Update-Quelle.');
  if (Array.isArray(json.assets)) {
    const files = json.assets.map((a) => ({
      name: a.name, url: a.browser_download_url, size: a.size || 0,
      sha256: typeof a.digest === 'string' && a.digest.startsWith('sha256:') ? a.digest.slice(7).toLowerCase() : null,
    }));
    return {
      version: String(json.tag_name || json.name || '').replace(/^v/i, ''),
      notes: String(json.body || '').trim(),
      page: json.html_url || null,
      date: json.published_at || null,
      setup: files.find((f) => /^EK-Service-Setup.*\.exe$/i.test(f.name)) || null,
      zip: files.find((f) => /^EK-Service-Programm.*\.zip$/i.test(f.name)) || null,
    };
  }
  if (json.version) {
    const f = (o, name) => (o && o.url ? { name: o.name || name, url: o.url, size: o.size || 0, sha256: o.sha256 ? String(o.sha256).toLowerCase() : null } : null);
    return { version: String(json.version).replace(/^v/i, ''), notes: String(json.notes || ''), page: json.page || null, date: json.date || null, setup: f(json.setup, 'EK-Service-Setup.exe'), zip: f(json.zip, 'EK-Service-Programm.zip') };
  }
  throw new Error('Die Update-Quelle enthält keine Versionsangabe.');
}

/** Welche Datei passt zu dieser Installation? installed = per Installer installiert */
function pickAsset(release, installed) {
  // Installierte Version → Installer; Programmordner-Variante → ZIP (ein Installer würde eine zweite Kopie anlegen)
  const a = installed ? release.setup : release.zip;
  if (!a || !/^https?:\/\//i.test(a.url || '')) return null;
  return a;
}

/** Ergebnis der Prüfung für die Oberfläche */
function evaluate(current, json, installed) {
  const release = normalizeRelease(json);
  const asset = pickAsset(release, installed);
  const newer = compareVersions(release.version, current) > 0;
  return {
    current, latest: release.version, available: newer && !!asset,
    notes: release.notes.slice(0, 4000), page: release.page, date: release.date,
    asset: asset ? { name: asset.name, url: asset.url, size: asset.size, sha256: asset.sha256 } : null,
    kind: asset ? (/\.zip$/i.test(asset.name) ? 'ordner' : 'setup') : null,
    reason: !newer ? 'aktuell' : (!asset ? 'keine-datei' : null),
  };
}

module.exports = { DEFAULT_URL, parseVersion, compareVersions, normalizeRelease, pickAsset, evaluate };
