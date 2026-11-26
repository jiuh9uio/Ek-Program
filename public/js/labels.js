// A4-Etikettenbögen mit Code-128-Barcode (Avery Zweckform L7159 3×8, L7163 2×7).
import { post } from './api.js';
import { esc } from './ui.js';
import { svg } from './code128.js';

const LAYOUTS = {
  '3x8': { cols: 3, rows: 8, w: 63.5, h: 33.9, left: 7.2, top: 12.9, gapX: 2.5, gapY: 0 },
  '2x7': { cols: 2, rows: 7, w: 99.1, h: 38.1, left: 4.65, top: 15.15, gapX: 2.5, gapY: 0 },
};
const params = new URLSearchParams(location.hash.replace(/^#/, ''));
const ids = (params.get('ids') || '').split(',').map(Number).filter(Boolean);
const L = LAYOUTS[params.get('layout')] || LAYOUTS['3x8'];
const layoutKey = LAYOUTS[params.get('layout')] ? params.get('layout') : '3x8';
const copies = Math.max(1, Math.min(50, Number(params.get('copies')) || 1));
const skip = Math.max(0, Number(params.get('skip')) || 0);
const showMinMax = params.get('minmax') === '1';

document.getElementById('btn-print').addEventListener('click', () => window.print());
document.getElementById('btn-close').addEventListener('click', () => window.close());

(async () => {
  const root = document.getElementById('sheets');
  let data;
  try { data = await post('/api/labels/data', { article_ids: ids }); } catch (e) { root.innerHTML = `<p style="padding:20px">${esc(e.message)}</p>`; return; }
  const labels = [...Array(skip).fill(null), ...data.flatMap((d) => Array(copies).fill(d))];
  const perSheet = L.cols * L.rows;
  const sheets = Math.ceil(labels.length / perSheet);
  document.getElementById('info').textContent = `${data.length} Artikel · ${labels.length - skip} Etiketten · ${sheets} Bogen (${layoutKey === '3x8' ? 'L7159, 3×8' : 'L7163, 2×7'})`;
  let html = '';
  for (let s = 0; s < sheets; s++) {
    html += `<section class="sheet l${layoutKey}">`;
    for (let k = 0; k < perSheet; k++) {
      const l = labels[s * perSheet + k];
      const col = k % L.cols; const row = Math.floor(k / L.cols);
      const style = `left:${L.left + col * (L.w + L.gapX)}mm;top:${L.top + row * (L.h + L.gapY)}mm;width:${L.w}mm;height:${L.h}mm`;
      if (!l) { html += `<div class="label empty" style="${style}"></div>`; continue; }
      let bc = '';
      try { bc = svg(l.code, { height: 40, module: 1.4, quiet: 8, fontSize: 10 }); } catch { bc = `<div class="sub">${esc(l.code)}</div>`; }
      html += `<div class="label" style="${style}"><div class="name">${esc(l.name)}</div>
        <div class="sub">${esc([l.pack_size, l.location_name].filter(Boolean).join(' · '))}${showMinMax && l.max_stock > 0 ? ` · MIN ${l.min_stock} / MAX ${l.max_stock}` : ''}</div>${bc}</div>`;
    }
    html += '</section>';
  }
  root.innerHTML = html;
  setTimeout(() => window.print(), 500);
})();
