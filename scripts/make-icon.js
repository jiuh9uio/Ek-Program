'use strict';
/**
 * Erzeugt assets/icon.ico (Windows-Programmsymbol) aus assets/icon.svg und assets/icon-small.svg.
 * Benötigt Playwright/Chromium (nur zum Erzeugen; das fertige .ico liegt im Repository).
 *   node scripts/make-icon.js
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];

function buildIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  const entries = []; let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); e.writeUInt8(0, 3); e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8); e.writeUInt32LE(offset, 12);
    entries.push(e); offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

(async () => {
  const big = fs.readFileSync(path.join(ROOT, 'assets', 'icon.svg'), 'utf8');
  const small = fs.readFileSync(path.join(ROOT, 'assets', 'icon-small.svg'), 'utf8');
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const pngs = [];
  fs.mkdirSync(path.join(ROOT, 'assets', 'png'), { recursive: true });
  for (const size of SIZES) {
    const svg = size <= 32 ? small : big;
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    const data = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    fs.writeFileSync(path.join(ROOT, 'assets', 'png', `icon-${size}.png`), data);
    pngs.push({ size, data });
  }
  await browser.close();
  fs.writeFileSync(path.join(ROOT, 'assets', 'icon.ico'), buildIco(pngs));
  console.log(`assets/icon.ico erstellt (${SIZES.join(', ')} px)`);
})().catch((e) => { console.error(e); process.exit(1); });
