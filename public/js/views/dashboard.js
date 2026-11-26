// Dashboard: Bestandswarnungen, offene Listen/Bestellungen, Lieferungen, Kostenstatistik.
import { get } from '../api.js';
import { esc, fmtQty, fmtEur, fmtDateTime, fmtAgo, unitFor, listBadge, statusBadge, emptyState } from '../ui.js';
import { navigate } from '../app.js';
import { newListWizard } from './newlist.js';
import { shareButtons, bindShare } from './share.js';

const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

export async function render(el, { can, setActions }) {
  let period = Number(sessionStorage.getItem('ek.dash.period') || 1);
  const act = setActions(`${can('stock.count') || can('list.create') ? '<button class="btn" id="go-mode">✓ Einkaufsmodus</button>' : ''}${can('list.create') ? '<button class="btn btn-primary" id="new-list">+ Neue Einkaufsliste</button>' : ''}`);
  act.querySelector('#go-mode')?.addEventListener('click', () => navigate('/mode'));
  act.querySelector('#new-list')?.addEventListener('click', newListWizard);

  const draw = async () => {
    const [d, fin] = await Promise.all([get(`/api/dashboard?period=${period}`), get('/api/lists-finished').catch(() => ({ lists: [], days: 2 }))]);
    const c = d.counts;
    const kpi = (label, value, cls, href, sub = '') => `<a class="kpi ${cls}" ${href ? `href="${href}"` : ''}><span>${label}</span><strong>${value}</strong>${sub ? `<small>${sub}</small>` : ''}</a>`;
    const artRow = (a) => `<li><span class="grow"><strong>${esc(a.name)}</strong><br><small class="muted">${esc(a.location_name || '')} · Ist ${a.current_stock === null ? '–' : fmtQty(a.current_stock)} / MIN ${fmtQty(a.min_stock)} / MAX ${fmtQty(a.max_stock)}</small></span>
      ${a.recommended ? `<span class="pill">+${fmtQty(a.recommended)} ${esc(unitFor(a.recommended, a.unit_name, a.unit_plural))}</span>` : ''}${statusBadge(a.status)}</li>`;
    const bars = (rows, labelKey = 'name') => {
      if (!rows.length) return emptyState('Noch keine Wareneingänge im Zeitraum.', '📊');
      const max = Math.max(...rows.map((r) => r.value), 1);
      return `<ul class="bars">${rows.map((r) => `<li><span class="bar-label">${esc(r[labelKey])}</span><span class="bar-track"><span class="bar-fill" style="width:${Math.max(1, (r.value / max) * 100).toFixed(1)}%"></span></span><span class="bar-val">${fmtEur(r.value)}</span></li>`).join('')}</ul>`;
    };

    const finished = fin.lists.length ? `<section class="card finished-card"><div class="card-head"><h2>✅ Fertige Einkaufslisten <small class="muted">(letzte ${fin.days} Tag${fin.days === 1 ? '' : 'e'})</small></h2></div>
      ${fin.lists.map((l) => `<div class="finished-row">
        <a class="finished-info" href="#/lists/${l.id}"><strong>${esc(l.number)}</strong> ${listBadge(l.status)} <span>${esc(l.title || '')}</span>
          <small class="muted">${fmtDateTime(l.ready_at)} · ${l.positions} Pos. · ${fmtEur(l.est_total)}${l.print_count ? ` · ${l.print_count}× gedruckt` : ''}${l.mail_count ? ` · ${l.mail_count}× gemailt` : ''}</small></a>
        ${shareButtons(l.id, { big: false })}</div>`).join('')}</section>` : '';
    el.innerHTML = `${finished}
      <div class="kpi-grid">
        ${kpi('Unter Mindestbestand', c.below, c.below ? 'kpi-red' : 'kpi-ok', '#/articles', 'sofort nachbestellen')}
        ${kpi('Am Mindestbestand', c.at_min, c.at_min ? 'kpi-yellow' : 'kpi-ok', '#/articles')}
        ${kpi('Nicht kontrolliert', c.unchecked, c.unchecked ? 'kpi-grey' : 'kpi-ok', '#/mode', `${c.articles} aktive Artikel`)}
        ${kpi('Offene Einkaufslisten', c.open_lists, 'kpi-neutral', '#/lists', d.estimated.open_lists_value ? fmtEur(d.estimated.open_lists_value) : '')}
        ${kpi('Offene Bestellungen', c.open_orders, c.open_orders ? 'kpi-blue' : 'kpi-neutral', '#/lists', d.estimated.open_orders_value ? `offen ${fmtEur(d.estimated.open_orders_value)}` : '')}
        ${kpi('Ausstehende Lieferpositionen', c.pending_deliveries, c.pending_deliveries ? 'kpi-blue' : 'kpi-neutral', '#/lists')}
        ${kpi('Geschätztes Einkaufsvolumen', fmtEur(d.estimated.open_lists_value + d.estimated.open_orders_value + 0), 'kpi-neutral', '', `Empfehlungen: ${fmtEur(d.estimated.recommendations_value)}`)}
        ${kpi('Letzte Bestandskontrolle', d.last_check ? fmtAgo(d.last_check.at) : 'nie', d.last_check && Date.now() - Date.parse(d.last_check.at) < 3 * 864e5 ? 'kpi-ok' : 'kpi-grey', '#/mode', d.last_check ? `${fmtDateTime(d.last_check.at)} · ${esc(d.last_check.user_name || '')}` : '')}
      </div>
      <div class="grid-2">
        <section class="card"><div class="card-head"><h2>Unter / am Mindestbestand</h2>${c.recommendations && can('list.create') ? '<button class="btn btn-sm btn-primary" id="nl2">Neue Einkaufsliste</button>' : ''}</div>
          ${d.below.length + d.at_min.length ? `<ul class="art-list">${[...d.below, ...d.at_min].map(artRow).join('')}</ul>` : emptyState('Alle kontrollierten Artikel ausreichend bevorratet.', '✅')}
          ${d.unavailable.length ? `<h3 class="mt">Nicht verfügbar</h3><ul class="art-list">${d.unavailable.map(artRow).join('')}</ul>` : ''}</section>
        <section class="card"><h2>Offene Einkaufslisten &amp; Bestellungen</h2>
          ${[...d.open_lists, ...d.open_orders].length ? `<ul class="list-links">${[...d.open_lists, ...d.open_orders].map((l) => `<li><a href="#/lists/${l.id}"><strong>${esc(l.number)}</strong> ${listBadge(l.status)}<span class="grow">${esc(l.title || '')}</span><span>${l.positions} Pos. · ${fmtEur(l.est_total)}</span></a></li>`).join('')}</ul>` : emptyState('Keine offenen Listen.')}
          ${d.pending_deliveries.length ? `<h3 class="mt">Ausstehende Lieferungen</h3><div class="table-wrap"><table class="table table-sm"><thead><tr><th>Artikel</th><th>Lieferant</th><th class="num">offen</th><th>Liste</th></tr></thead><tbody>
            ${d.pending_deliveries.map((p) => `<tr><td>${esc(p.article_name)}</td><td>${esc(p.supplier_name || '–')}</td><td class="num">${fmtQty(p.open_qty)} ${esc(unitFor(p.open_qty, p.unit_name, p.unit_plural))}</td><td><a href="#/lists/${p.list_id}">${esc(p.number)}</a></td></tr>`).join('')}</tbody></table></div>` : ''}
        </section>
      </div>
      ${d.stats ? `
      <div class="toolbar mt"><h2 class="grow">Einkaufskosten (Wareneingänge, netto)</h2>
        <div class="seg">${[[1, 'Monat'], [3, '3 Monate'], [6, '6 Monate'], [12, '12 Monate']].map(([k, l]) => `<button data-p="${k}" class="${period === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="grid-3">
        <section class="card"><h2>Monatliche Einkaufskosten</h2>${monthChart(d.stats.monthly)}</section>
        <section class="card"><h2>Nach Kategorie</h2>${bars(d.stats.by_category)}</section>
        <section class="card"><h2>Nach Lieferant</h2>${bars(d.stats.by_supplier)}</section>
      </div>
      <div class="grid-2">
        <section class="card"><h2>Lagerwert (kontrollierte Bestände)</h2><div class="big-number">${fmtEur(d.stats.stock_value)}</div></section>
        <section class="card"><h2>Überbestände (über MAX)</h2>${d.stats.overstock.length ? `<ul class="art-list">${d.stats.overstock.map((a) => `<li><span class="grow">${esc(a.name)}<br><small class="muted">Ist ${fmtQty(a.current_stock)} / MAX ${fmtQty(a.max_stock)}</small></span><span class="pill">${fmtEur(a.excess_value)} gebunden</span></li>`).join('')}</ul>` : emptyState('Keine Überbestände – gut für die Kapitalbindung.', '👍')}</section>
      </div>` : ''}`;
    el.querySelector('#nl2')?.addEventListener('click', newListWizard);
    bindShare(el, { onDone: () => draw() });
    el.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => { period = Number(b.dataset.p); sessionStorage.setItem('ek.dash.period', period); draw(); }));
  };

  function monthChart(rows) {
    const max = Math.max(...rows.map((r) => r.value), 1);
    const total = rows.reduce((s, r) => s + r.value, 0);
    return `<div class="month-chart" role="img" aria-label="Monatliche Einkaufskosten">${rows.map((r) => {
      const [y, m] = r.month.split('-');
      return `<div class="mc-col" title="${MONTHS[Number(m) - 1]} ${y}: ${fmtEur(r.value)}"><span class="mc-val">${r.value ? Math.round(r.value).toLocaleString('de-DE') : ''}</span><span class="mc-bar" style="height:${((r.value / max) * 100).toFixed(1)}%"></span><span class="mc-lbl">${MONTHS[Number(m) - 1]}</span></div>`;
    }).join('')}</div><p class="muted small">Summe Zeitraum: ${fmtEur(total)}</p>`;
  }

  await draw();
  const t = setInterval(() => { if (!document.hidden && !document.querySelector('.modal-backdrop')) draw().catch(() => {}); }, 60000);
  return { destroy() { clearInterval(t); } };
}
