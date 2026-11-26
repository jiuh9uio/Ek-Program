// Druckfertige A4-Ansicht einer Einkaufsliste mit Abhak-Kästchen (öffnet automatisch den Druckdialog).
import { get } from './api.js';
import { esc, fmtEur, fmtDateTime, orderText } from './ui.js';

const [idRaw, groupRaw] = location.hash.replace('#', '').split('/');
const id = Number(idRaw);
const group = ['supplier', 'category', 'location'].includes(groupRaw) ? groupRaw : 'supplier';

document.getElementById('btn-print').addEventListener('click', () => window.print());
document.getElementById('btn-close').addEventListener('click', () => window.close());

(async () => {
  const page = document.getElementById('page');
  let list; let me;
  try { [list, me] = await Promise.all([get(`/api/lists/${id}`), get('/api/auth/me')]); } catch (e) {
    page.innerHTML = `<p>Liste konnte nicht geladen werden: ${esc(e.message)}</p>`; return;
  }
  document.title = `Einkaufsliste ${list.number}`;
  document.getElementById('info').textContent = `Einkaufsliste ${list.number} · ${list.items.length} Positionen`;
  const key = (i) => group === 'supplier' ? (i.supplier_name || 'Ohne Lieferant') : group === 'location' ? (i.location_name || 'Ohne Lagerort') : (i.category_name || 'Ohne Kategorie');
  const groups = new Map();
  for (const i of list.items) { const k = key(i); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); }
  const sorted = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'de'));
  const sup = (name) => list.supplier_groups.find((g) => (g.supplier_name || 'Ohne Lieferant') === name);
  page.innerHTML = `
    <div class="head"><div><h1>SERVICE-EINKAUF</h1><div>${esc(me.company_name || '')}</div></div>
      <div class="no">${esc(list.number)}<div class="sub">${esc(list.status_label)}</div></div></div>
    <div class="meta"><span><b>Datum:</b> ${fmtDateTime(list.ready_at || list.created_at)}</span><span><b>Erstellt von:</b> ${esc(list.created_by_name || '–')}</span>
      ${list.title ? `<span><b>Bezeichnung:</b> ${esc(list.title)}</span>` : ''}<span><b>Positionen:</b> ${list.items.length}</span></div>
    ${list.note ? `<p class="note">Hinweis: ${esc(list.note)}</p>` : ''}
    ${sorted.map(([name, items]) => {
      const g = group === 'supplier' ? sup(name) : null;
      return `<h2>${esc(name)}</h2>
      ${g && g.below_min_order ? `<div class="warn">⚠ Mindestbestellwert ${fmtEur(g.min_order_value)} nicht erreicht (es fehlen ${fmtEur(g.missing_to_min)})</div>` : ''}
      <table><thead><tr><th style="width:20pt"></th><th>Artikel</th><th class="num">Menge</th><th>${group === 'location' ? 'Lieferant' : 'Lagerort'}</th><th class="num">EK netto</th><th class="num">Summe</th></tr></thead><tbody>
      ${items.sort((a, b) => a.article_name.localeCompare(b.article_name, 'de')).map((i) => {
        const ot = orderText(i.qty, i);
        return `<tr class="${i.purchased ? 'done' : ''}"><td><span class="box"></span></td>
          <td><b>${esc(i.article_name)}</b><div class="sub">${esc([i.article_no, i.pack_size].filter(Boolean).join(' · '))}</div>${i.note ? `<div class="note">${esc(i.note)}</div>` : ''}</td>
          <td class="qty">${esc(ot.main)}${ot.base ? `<div class="sub">${esc(ot.base)}</div>` : ''}</td>
          <td>${esc((group === 'location' ? i.supplier_name : i.location_name) || '–')}</td>
          <td class="num">${fmtEur(i.unit_price_est)}</td><td class="num">${fmtEur(i.est_total)}</td></tr>`;
      }).join('')}</tbody></table>`;
    }).join('')}
    <table class="sum"><tr><td>Warenwert netto (geschätzt)</td><td class="num">${fmtEur(list.totals.est_goods)}</td></tr>
      ${list.totals.shipping ? `<tr><td>Versandkosten</td><td class="num">${fmtEur(list.totals.shipping)}</td></tr>` : ''}
      <tr class="tot"><td>Gesamt netto</td><td class="num">${fmtEur(list.totals.est_total)}</td></tr></table>
    <div class="sign"><div>Eingekauft von / Datum</div><div>Geprüft</div></div>
    <div class="foot">EK-Service · gedruckt ${fmtDateTime(new Date().toISOString())} von ${esc(me.user.display_name)}</div>`;
  window.addEventListener('afterprint', () => setTimeout(() => window.close(), 300));
  setTimeout(() => window.print(), 400);
})();
