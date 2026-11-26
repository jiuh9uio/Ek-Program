// Code-128-Barcode als SVG (Zeichensatz B für Text, C für lange Ziffernfolgen). Ohne externe Bibliothek.
const P = ['212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111', '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412', '211214', '211232', '2331112'];
const START_B = 104; const STOP = 106;

/** Werte (Start B, Daten, Prüfzeichen, Stopp). Zeichensatz B: von allen Scannern sicher lesbar. */
export function encodeValues(text) {
  const s = String(text);
  if (!s.length || !/^[\x20-\x7e]+$/.test(s)) throw new Error('Code128 unterstützt nur ASCII-Zeichen.');
  const vals = [START_B, ...[...s].map((ch) => ch.charCodeAt(0) - 32)];
  let sum = vals[0];
  for (let k = 1; k < vals.length; k++) sum += vals[k] * k;
  vals.push(sum % 103, STOP);
  return vals;
}

/** Balkenmuster als Breitenfolge (abwechselnd Strich/Lücke, beginnend mit Strich). */
export function widths(text) { return encodeValues(text).map((v) => P[v]).join(''); }

export function svg(text, { height = 48, module = 1.6, quiet = 10, showText = true, fontSize = 11 } = {}) {
  const w = widths(text);
  let x = quiet; const bars = [];
  for (let k = 0; k < w.length; k++) {
    const width = Number(w[k]) * module;
    if (k % 2 === 0) bars.push(`<rect x="${x.toFixed(2)}" y="0" width="${width.toFixed(2)}" height="${height}"/>`);
    x += width;
  }
  const total = x + quiet;
  const th = showText ? fontSize + 4 : 0;
  const esc = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total.toFixed(2)} ${height + th}" class="barcode" preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges">
    <rect width="100%" height="100%" fill="#fff"/><g fill="#000">${bars.join('')}</g>
    ${showText ? `<text x="${(total / 2).toFixed(2)}" y="${height + fontSize + 1}" font-family="Consolas, monospace" font-size="${fontSize}" text-anchor="middle">${esc}</text>` : ''}</svg>`;
}
