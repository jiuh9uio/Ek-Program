// Einkaufslisten: Übersicht, Detail, Statusworkflow, Wareneingang, Druck & PDF, Historie.
import { get, post, put, del } from '../api.js';
import { esc, fmtQty, fmtEur, fmtDateTime, unitFor, parseNum, listBadge, LIST_STATUS, toast, modal, confirmDialog, debounce, matches, options, emptyState, download } from '../ui.js';
import { navigate } from '../app.js';
import { newListWizard } from './newlist.js';

export async function render(el, ctx) {
  if (ctx.params[0]) return renderDetail(el, ctx, Number(ctx.params[0]));
  return renderOverview(el, ctx);
}

// ======================= Übersicht =======================
const FILTERS = [
  ['open', 'Offen', 'draft,ready'], ['orders', 'Bestellt', 'ordered,partial'], ['delivered', 'Geliefert', 'delivered'],
  ['closed', 'Abgeschlossen', 'closed'], ['cancelled', 'Storniert', 'cancelled'], ['all', 'Alle', 'all'],
];

async function renderOverview(el, { can, setActions }) {
  let filter = sessionStorage.getItem('ek.lists.filter') || 'open';
  let q = '';
  const actions = setActions(can('list.create') ? '<button class="btn btn-primary" id="new-list">+ Neue Einkaufsliste</button>' : '');
  actions.querySelector('#new-list')?.addEventListener('click', () => newListWizard());

  el.innerHTML = `
    <div class="toolbar">
      <div class="chips">${FILTERS.map(([k, l]) => `<button class="chip ${k === filter ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}</div>
      <input type="search" class="search" id="q" placeholder="Nummer, Bezeichnung oder Artikel …">
    </div>
    <div id="lists"></div>`;
  const box = el.querySelector('#lists');

  const load = async () => {
    const st = FILTERS.find((f) => f[0] === filter)[2];
    const rows = await get(`/api/lists?status=${st}${q ? '&q=' + encodeURIComponent(q) : ''}`);
    if (!rows.length) { box.innerHTML = emptyState('Keine Einkaufslisten in dieser Ansicht.'); return; }
    box.innerHTML = `<div class="table-wrap"><table class="table table-click">
      <thead><tr><th>Nummer</th><th>Status</th><th>Bezeichnung</th><th>Erstellt</th><th class="num">Pos.</th><th class="num">Geschätzt</th><th class="num">Tatsächlich</th><th>Lieferanten</th><th class="num">Drucke</th></tr></thead>
      <tbody>${rows.map((l) => `<tr data-id="${l.id}">
        <td><strong>${esc(l.number)}</strong></td><td>${listBadge(l.status)}</td><td>${esc(l.title || '')}</td>
        <td>${fmtDateTime(l.created_at)}<br><small class="muted">${esc(l.created_by_name || '')}</small></td>
        <td class="num">${l.positions}</td><td class="num">${fmtEur(l.est_total)}</td>
        <td class="num">${l.actual_cost !== null ? fmtEur(l.actual_cost) : l.actual_goods ? fmtEur(l.actual_goods) : '–'}</td>
        <td><small>${esc(l.suppliers || '')}</small></td><td class="num">${l.print_count}</td></tr>`).join('')}</tbody></table></div>`;
  };
  box.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) navigate(`/lists/${tr.dataset.id}`); });
  el.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => {
    filter = b.dataset.f; sessionStorage.setItem('ek.lists.filter', filter);
    el.querySelectorAll('[data-f]').forEach((x) => x.classList.toggle('on', x === b)); load();
  }));
  el.querySelector('#q').addEventListener('input', debounce((e) => { q = e.target.value.trim(); load(); }, 250));
  await load();
}

// ======================= Detail =======================
async function renderDetail(el, { can, setTitle, setActions }, id) {
  let list = await get(`/api/lists/${id}`);
  let groupBy = localStorage.getItem('ek.list.group') || 'supplier';
  let tab = 'items';
  let suppliers = [];
  let printers = [];
  try { suppliers = await get('/api/suppliers'); } catch { /* optional */ }
  try { printers = await get('/api/printers'); } catch { /* optional */ }

  const editable = () => ['draft', 'ready'].includes(list.status) || (['ordered', 'partial'].includes(list.status) && can('orders.approve'));
  const closedish = () => ['closed', 'cancelled'].includes(list.status);

  function renderActions() {
    const s = list.status;
    const b = [];
    if (s === 'draft' && can('list.create')) b.push(['ready', 'Einkaufsbereit', 'btn-primary']);
    if (['draft', 'ready'].includes(s) && can('orders.approve')) b.push(['ordered', 'Freigeben & bestellt', 'btn-primary']);
    if (s === 'ready' && can('list.create')) b.push(['draft', 'Zurück zu Entwurf', '']);
    if (['ready', 'ordered', 'partial', 'delivered'].includes(s) && can('goods.receive')) b.push(['receive', 'Wareneingang', 'btn-primary']);
    if (['ready', 'ordered', 'partial', 'delivered'].includes(s) && can('orders.approve')) b.push(['closed', 'Abschließen', s === 'delivered' ? 'btn-primary' : '']);
    if (s === 'closed' && can('orders.approve')) b.push(['reopen', 'Erneut öffnen', '']);
    if (s === 'cancelled' && can('orders.approve')) b.push(['draft', 'Wiederherstellen', '']);
    if (can('print') && list.items.length) { b.push(['print', '⎙ Bon drucken', '']); b.push(['pdf', 'PDF', '']); }
    if (['draft', 'ready'].includes(s) && can('list.create')) b.push(['cancelled', 'Stornieren', 'btn-danger-ghost']);
    else if (['ordered', 'partial'].includes(s) && can('orders.approve')) b.push(['cancelled', 'Stornieren', 'btn-danger-ghost']);
    const a = setActions(b.map(([k, l, c]) => `<button class="btn ${c}" data-a="${k}">${l}</button>`).join(''));
    a.querySelectorAll('[data-a]').forEach((btn) => btn.addEventListener('click', () => onAction(btn.dataset.a)));
  }

  async function reload(newList) { list = newList || await get(`/api/lists/${id}`); draw(); }

  async function onAction(a) {
    try {
      if (a === 'print') return printDialog();
      if (a === 'pdf') return pdfDialog();
      if (a === 'receive') return receiveDialog();
      if (a === 'closed') return closeDialog();
      const labels = { ready: 'Liste als einkaufsbereit markieren?', ordered: 'Bestellung freigeben und als bestellt markieren?', draft: 'Liste wieder als Entwurf öffnen?', reopen: 'Abgeschlossene Liste erneut öffnen?', cancelled: 'Liste wirklich stornieren? Die Mengen gelten dann nicht mehr als bestellt.' };
      if (!(await confirmDialog(labels[a], { danger: a === 'cancelled', ok: a === 'cancelled' ? 'Stornieren' : 'Bestätigen' }))) return;
      const r = await post(`/api/lists/${id}/status`, { status: a });
      r.warnings.forEach((w) => toast(w, 'warn', 7000));
      toast(`Status: ${LIST_STATUS[r.status].label}`, 'success');
      reload(r.list);
    } catch (e) { toast(e.message, 'error'); }
  }

  function supplierCards() {
    return `<div class="sup-cards">${list.supplier_groups.map((g) => {
      const s = suppliers.find((x) => x.id === g.supplier_id);
      return `<div class="sup-card ${g.below_min_order ? 'warn' : ''}">
        <div class="sup-card-head"><strong>${esc(g.supplier_name)}</strong><span>${g.items} Pos.</span></div>
        <div class="sup-card-val">${fmtEur(g.est_total)}</div>
        ${g.min_order_value > 0 ? `<div class="small ${g.below_min_order ? 'text-red' : 'muted'}">${g.below_min_order ? `⚠ Mindestbestellwert ${fmtEur(g.min_order_value)} nicht erreicht – es fehlen ${fmtEur(g.missing_to_min)}` : `Mindestbestellwert ${fmtEur(g.min_order_value)} erreicht`}</div>` : ''}
        ${g.shipping_cost > 0 ? `<div class="small muted">Versand: ${fmtEur(g.shipping_cost)}</div>` : ''}
        ${s && (s.order_days || s.delivery_days) ? `<div class="small muted">Bestelltage: ${dayNames(s.order_days)} · Liefertage: ${dayNames(s.delivery_days)}</div>` : ''}
      </div>`;
    }).join('')}</div>`;
  }

  function itemsTable() {
    if (!list.items.length) return emptyState(list.status === 'draft' ? 'Noch keine Positionen. Artikel über „Artikel hinzufügen“, „Empfehlungen übernehmen“ oder den Einkaufsmodus aufnehmen.' : 'Keine Positionen.');
    const keyOf = (i) => groupBy === 'supplier' ? i.supplier_name || 'Ohne Lieferant' : groupBy === 'location' ? i.location_name || 'Ohne Lagerort' : i.category_name || 'Ohne Kategorie';
    const groups = new Map();
    for (const i of list.items) { const k = keyOf(i); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); }
    const ed = editable() && can('list.create');
    const showRecv = list.items.some((i) => i.qty_received > 0) || ['ordered', 'partial', 'delivered', 'closed'].includes(list.status);
    return `<div class="table-wrap"><table class="table items-table">
      <thead><tr><th title="eingekauft">✓</th><th>Artikel</th><th class="num">Menge</th><th>Lieferant</th><th>Lagerort</th><th class="num">EK netto</th><th class="num">Summe</th>${showRecv ? '<th class="num">Geliefert</th>' : ''}<th></th></tr></thead>
      ${[...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'de')).map(([k, items]) => `
        <tbody><tr class="group-row"><td colspan="${showRecv ? 9 : 8}">${esc(k)} <small>(${items.length})</small></td></tr>
        ${items.map((i) => `<tr data-item="${i.id}" class="${i.purchased ? 'is-purchased' : ''}">
          <td><button class="tick ${i.purchased ? 'on' : ''}" data-i="purchased" ${closedish() || !(can('list.create') || can('print')) ? 'disabled' : ''} aria-label="eingekauft">${i.purchased ? '✓' : ''}</button></td>
          <td><strong>${esc(i.article_name)}</strong><br><small class="muted">${esc([i.article_no, i.pack_size].filter(Boolean).join(' · '))}</small>
            ${i.note ? `<div class="note-text">„${esc(i.note)}“</div>` : ''}${!i.article_active ? '<div class="text-red small">Artikel inaktiv</div>' : ''}</td>
          <td class="num">${ed ? `<div class="stepper stepper-sm"><button data-i="qty-">−</button><input data-i="qty" inputmode="decimal" value="${fmtQty(i.qty)}"><button data-i="qty+">+</button></div>` : `<strong>${fmtQty(i.qty)}</strong>`}
            <small>${esc(unitFor(i.qty, i.unit_name, i.unit_plural))}</small></td>
          <td>${ed ? `<select data-i="supplier">${options(suppliers.filter((s) => s.active || s.id === i.supplier_id), i.supplier_id, { empty: 'Ohne Lieferant' })}</select>` : esc(i.supplier_name || '–')}</td>
          <td>${esc(i.location_name || '–')}</td>
          <td class="num">${ed && can('prices.manage') ? `<input class="input-sm num" data-i="price" inputmode="decimal" value="${Number(i.unit_price_est).toFixed(2).replace('.', ',')}">` : fmtEur(i.unit_price_est)}</td>
          <td class="num">${fmtEur(i.est_total)}</td>
          ${showRecv ? `<td class="num ${i.qty_received >= i.qty ? 'text-green' : i.qty_received > 0 ? 'text-amber' : ''}">${fmtQty(i.qty_received)} / ${fmtQty(i.qty)}${i.unit_price_actual !== null ? `<br><small>${fmtEur(i.unit_price_actual)}</small>` : ''}</td>` : ''}
          <td class="row-actions">${!closedish() && can('list.create') ? `<button class="btn-icon" data-i="note" title="Bemerkung">✎</button>` : ''}${ed && i.qty_received === 0 ? `<button class="btn-icon danger" data-i="remove" title="Entfernen">🗑</button>` : ''}</td>
        </tr>`).join('')}</tbody>`).join('')}
      <tfoot>
        <tr><td colspan="6" class="num">Warenwert netto (geschätzt)</td><td class="num">${fmtEur(list.totals.est_goods)}</td><td colspan="${showRecv ? 2 : 1}"></td></tr>
        ${list.totals.shipping ? `<tr><td colspan="6" class="num">Versandkosten</td><td class="num">${fmtEur(list.totals.shipping)}</td><td colspan="${showRecv ? 2 : 1}"></td></tr>` : ''}
        <tr class="total-row"><td colspan="6" class="num">Gesamtkosten geschätzt</td><td class="num">${fmtEur(list.totals.est_total)}</td><td colspan="${showRecv ? 2 : 1}"></td></tr>
        ${list.totals.actual_goods !== null || list.actual_cost !== null ? `<tr><td colspan="6" class="num">Tatsächliche Kosten</td><td class="num">${fmtEur(list.actual_cost ?? list.totals.actual_goods)}</td><td colspan="${showRecv ? 2 : 1}"></td></tr>` : ''}
      </tfoot></table></div>`;
  }

  function eventsHtml() {
    if (!list.events.length) return emptyState('Kein Verlauf.');
    return `<ul class="timeline">${list.events.map((e) => `<li><time>${fmtDateTime(e.at)}</time><strong>${esc(e.action)}</strong> <span class="muted">– ${esc(e.user_name || '')}</span>
      ${e.details ? `<div class="small muted">${esc(detailText(e.details))}</div>` : ''}</li>`).join('')}</ul>`;
  }

  function printsHtml() {
    if (!list.prints.length) return emptyState('Diese Liste wurde noch nicht gedruckt.', '⎙');
    return `<div class="table-wrap"><table class="table"><thead><tr><th>Zeit</th><th>Bon</th><th>Drucker</th><th>Benutzer</th><th>Status</th><th></th></tr></thead>
      <tbody>${list.prints.map((p) => `<tr><td>${fmtDateTime(p.at)}</td><td>${esc(p.title)}</td><td>${esc(p.printer_name || '')}</td><td>${esc(p.user_name || '')}</td>
        <td>${p.status === 'ok' ? '<span class="badge st-green">gedruckt</span>' : `<span class="badge st-red">Fehler</span><div class="small text-red">${esc(p.error)}</div>`}</td>
        <td>${can('print') ? `<button class="btn btn-sm" data-reprint="${p.id}">Erneut drucken</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function draw() {
    setTitle(`Einkaufsliste ${list.number}`);
    renderActions();
    const ed = !closedish() && can('list.create');
    el.innerHTML = `
      <a href="#/lists" class="back">← Alle Einkaufslisten</a>
      <div class="list-head card">
        <div class="list-head-main">
          <div class="list-head-title">${listBadge(list.status)} ${list.count ? `<a class="pill" href="#/count/${list.count.id}">📋 Zählung ${esc(list.count.number)}${list.count.status === 'open' ? ' – weiterzählen' : ''}</a>` : ''} <span class="muted">erstellt ${fmtDateTime(list.created_at)} von ${esc(list.created_by_name || '–')}${list.ordered_at ? ` · bestellt ${fmtDateTime(list.ordered_at)}${list.approved_by_name ? ' (' + esc(list.approved_by_name) + ')' : ''}` : ''}${list.closed_at ? ` · abgeschlossen ${fmtDateTime(list.closed_at)}` : ''}</span></div>
          <form id="head-form" class="head-form">
            <label class="field"><span>Bezeichnung</span><input name="title" value="${esc(list.title || '')}" ${ed ? '' : 'disabled'}></label>
            <label class="field"><span>Hinweis</span><input name="note" value="${esc(list.note || '')}" ${ed ? '' : 'disabled'}></label>
            ${ed ? '<button class="btn" type="submit">Zwischenspeichern</button>' : ''}
          </form>
        </div>
        <div class="kpis">
          <div><span>Positionen</span><strong>${list.totals.positions}</strong></div>
          <div><span>Eingekauft</span><strong>${list.totals.purchased}/${list.totals.positions}</strong></div>
          <div><span>Geschätzt</span><strong>${fmtEur(list.totals.est_total)}</strong></div>
          ${list.totals.actual_goods !== null || list.actual_cost !== null ? `<div><span>Tatsächlich</span><strong>${fmtEur(list.actual_cost ?? list.totals.actual_goods)}</strong></div>` : ''}
        </div>
      </div>
      ${list.supplier_groups.length ? supplierCards() : ''}
      <div class="toolbar">
        <div class="seg">${[['items', `Positionen (${list.items.length})`], ['events', 'Verlauf'], ['prints', `Druckhistorie (${list.prints.length})`]].map(([k, l]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        ${tab === 'items' ? `<label class="sel-inline">Gruppieren <select id="grp"><option value="supplier">nach Lieferant</option><option value="category">nach Kategorie</option><option value="location">nach Lagerort</option></select></label>` : ''}
        ${tab === 'items' && editable() && can('list.create') ? `<div class="btn-row">
          <button class="btn" id="add-art">+ Artikel hinzufügen</button>
          ${list.status === 'draft' ? '<button class="btn" id="add-rec">Empfehlungen übernehmen</button><button class="btn" id="merge">Listen zusammenführen</button><button class="btn" id="to-mode">Im Einkaufsmodus bearbeiten</button>' : ''}
        </div>` : ''}
      </div>
      <div id="tab-body">${tab === 'items' ? itemsTable() : tab === 'events' ? eventsHtml() : printsHtml()}</div>`;

    el.querySelector('#grp') && (el.querySelector('#grp').value = groupBy);
    el.querySelector('#grp')?.addEventListener('change', (e) => { groupBy = e.target.value; localStorage.setItem('ek.list.group', groupBy); draw(); });
    el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; draw(); }));
    const hf = el.querySelector('#head-form');
    const saveHead = async (silent) => {
      try { list = await put(`/api/lists/${id}`, { title: hf.title.value, note: hf.note.value, version: list.version }); if (!silent) toast('Gespeichert.', 'success'); } catch (e) { toast(e.message, 'error'); }
    };
    hf.addEventListener('submit', (e) => { e.preventDefault(); saveHead(false).then(draw); });
    hf.querySelectorAll('input').forEach((i) => i.addEventListener('change', () => saveHead(true)));
    el.querySelector('#add-art')?.addEventListener('click', addArticleDialog);
    el.querySelector('#add-rec')?.addEventListener('click', async () => {
      try { const r = await post(`/api/lists/${id}/recommendations`); toast(`${r.added} Empfehlung(en) übernommen.`, r.added ? 'success' : 'info'); reload(r.list); } catch (e) { toast(e.message, 'error'); }
    });
    el.querySelector('#merge')?.addEventListener('click', mergeDialog);
    el.querySelector('#to-mode')?.addEventListener('click', async () => { await post(`/api/lists/${id}/activate`); navigate('/mode'); });
    el.querySelectorAll('[data-reprint]').forEach((b) => b.addEventListener('click', () => reprint(Number(b.dataset.reprint))));
    bindItems();
  }

  function bindItems() {
    const body = el.querySelector('#tab-body');
    const savers = new Map();
    const saveQty = (itemId, v) => {
      if (!savers.has(itemId)) savers.set(itemId, debounce(async (q) => {
        try { reload(await put(`/api/lists/${id}/items/${itemId}`, { qty: q })); } catch (e) { toast(e.message, 'error'); reload(); }
      }, 800));
      savers.get(itemId)(v);
    };
    body.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-i]');
      if (!b || b.tagName === 'INPUT' || b.tagName === 'SELECT') return;
      const tr = b.closest('tr[data-item]');
      const itemId = Number(tr.dataset.item);
      const item = list.items.find((i) => i.id === itemId);
      try {
        if (b.dataset.i === 'purchased') reload(await put(`/api/lists/${id}/items/${itemId}`, { purchased: !item.purchased }));
        else if (b.dataset.i === 'remove') {
          if (await confirmDialog(`„${item.article_name}“ aus der Liste entfernen?`, { danger: true, ok: 'Entfernen' })) reload(await del(`/api/lists/${id}/items/${itemId}`));
        } else if (b.dataset.i === 'note') {
          const { promptDialog } = await import('../ui.js');
          const n = await promptDialog('Bemerkung zur Position:', { title: item.article_name, value: item.note || '' });
          if (n !== null) reload(await put(`/api/lists/${id}/items/${itemId}`, { note: n }));
        } else if (b.dataset.i === 'qty-' || b.dataset.i === 'qty+') {
          const inp = tr.querySelector('[data-i="qty"]');
          const step = item.order_step > 0 ? item.order_step : 1;
          const cur = parseNum(inp.value) || 0;
          const next = Math.round((cur + (b.dataset.i === 'qty+' ? step : -step)) * 1000) / 1000;
          if (next <= 0) { toast('Menge muss größer 0 sein – zum Entfernen 🗑 verwenden.', 'warn'); return; }
          inp.value = fmtQty(next);
          saveQty(itemId, next);
        }
      } catch (err) { toast(err.message, 'error'); }
    });
    body.addEventListener('input', (e) => {
      if (e.target.dataset.i !== 'qty') return;
      const v = parseNum(e.target.value);
      if (!(v > 0)) { e.target.classList.add('invalid'); return; }
      e.target.classList.remove('invalid');
      saveQty(Number(e.target.closest('tr').dataset.item), v);
    });
    body.addEventListener('change', async (e) => {
      const tr = e.target.closest('tr[data-item]');
      if (!tr) return;
      const itemId = Number(tr.dataset.item);
      try {
        if (e.target.dataset.i === 'supplier') reload(await put(`/api/lists/${id}/items/${itemId}`, { supplier_id: e.target.value || null }));
        if (e.target.dataset.i === 'price') {
          const p = parseNum(e.target.value);
          if (!(p >= 0)) { toast('Ungültiger Preis.', 'error'); return; }
          reload(await put(`/api/lists/${id}/items/${itemId}`, { unit_price_est: p }));
        }
      } catch (err) { toast(err.message, 'error'); reload(); }
    });
  }

  async function addArticleDialog() {
    const arts = (await get('/api/articles')).filter((a) => a.active);
    const m = modal({
      title: 'Artikel hinzufügen', wide: true,
      body: `<input type="search" class="search" id="as" placeholder="Artikel suchen …">
        <div class="pick-list" id="al"></div>`,
    });
    const al = m.body.querySelector('#al');
    const draw2 = (q) => {
      const found = arts.filter((a) => !q || matches(`${a.name} ${a.article_no} ${a.supplier_name || ''} ${a.category_name || ''}`, q)).slice(0, 80);
      al.innerHTML = found.map((a) => {
        const inList = list.items.find((i) => i.article_id === a.id);
        const def = a.recommended || Math.max(a.order_step || 1, a.min_order_qty || 0);
        return `<div class="pick-row" data-id="${a.id}">
          <div><strong>${esc(a.name)}</strong><br><small class="muted">${esc([a.article_no, a.supplier_name, a.category_name].filter(Boolean).join(' · '))} · Ist ${a.current_stock === null ? '–' : fmtQty(a.current_stock)} · MIN ${fmtQty(a.min_stock)} / MAX ${fmtQty(a.max_stock)}${a.on_order ? ` · bestellt ${fmtQty(a.on_order)}` : ''}</small>
          ${inList ? `<div class="small text-amber">bereits auf dieser Liste (${fmtQty(inList.qty)}) – wird zusammengeführt</div>` : ''}</div>
          <input class="input-sm num" inputmode="decimal" value="${fmtQty(def)}" aria-label="Menge">
          <button class="btn btn-primary btn-sm" data-add>+</button></div>`;
      }).join('') || emptyState('Kein Artikel gefunden.');
    };
    draw2('');
    m.body.querySelector('#as').addEventListener('input', (e) => draw2(e.target.value));
    al.addEventListener('click', async (e) => {
      if (!e.target.closest('[data-add]')) return;
      const row = e.target.closest('.pick-row');
      const qty = parseNum(row.querySelector('input').value);
      if (!(qty > 0)) return toast('Bitte eine Menge > 0 eingeben.', 'error');
      try {
        const r = await post(`/api/lists/${id}/items`, { article_id: Number(row.dataset.id), qty });
        if (r.merged) toast('Position zusammengeführt (Menge addiert).', 'info');
        else toast('Hinzugefügt.', 'success');
        if (r.other_open.length) toast(`Achtung: auch auf ${r.other_open.map((l) => l.number).join(', ')} offen.`, 'warn');
        list = r.list; draw(); draw2(m.body.querySelector('#as').value);
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  async function mergeDialog() {
    const others = (await get('/api/lists?status=draft,ready')).filter((l) => l.id !== id);
    if (!others.length) return toast('Keine weiteren offenen Listen zum Zusammenführen.', 'info');
    modal({
      title: 'Listen zusammenführen',
      body: `<p>Positionen der gewählten Liste werden in <strong>${esc(list.number)}</strong> übernommen. Doppelte Artikel werden addiert, die Quellliste wird storniert.</p>
        <label class="field"><span>Quellliste</span><select id="src">${others.map((l) => `<option value="${l.id}">${esc(l.number)} – ${esc(l.title || '')} (${l.positions} Pos., ${LIST_STATUS[l.status].label})</option>`).join('')}</select></label>`,
      actions: [{ label: 'Abbrechen' }, {
        label: 'Zusammenführen', cls: 'btn-primary', onClick: async (m) => {
          const r = await post(`/api/lists/${id}/merge`, { source_id: Number(m.body.querySelector('#src').value) });
          toast(`${r.merged} Position(en) zusammengeführt.`, 'success'); reload(r.list);
        },
      }],
    });
  }

  function receiveDialog() {
    const open = list.items;
    const m = modal({
      title: `Wareneingang ${list.number}`, wide: true,
      body: `<p class="muted">Gelieferte Mengen erfassen. Sie werden dem Ist-Bestand zugebucht. Korrekturen sind mit negativen Werten möglich.</p>
        <div class="btn-row"><button class="btn btn-sm" id="all-open">Alle offenen Mengen übernehmen</button><button class="btn btn-sm" id="all-zero">Alle auf 0</button></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>Artikel</th><th class="num">Bestellt</th><th class="num">Bisher geliefert</th><th class="num">Jetzt geliefert</th><th class="num">EK netto tatsächlich</th>${can('prices.manage') ? '<th>Preis übernehmen</th>' : ''}</tr></thead>
        <tbody>${open.map((i) => `<tr data-item="${i.id}" data-open="${i.open_qty}"><td><strong>${esc(i.article_name)}</strong><br><small class="muted">${esc(i.supplier_name || '')}</small></td>
          <td class="num">${fmtQty(i.qty)} ${esc(unitFor(i.qty, i.unit_name, i.unit_plural))}</td><td class="num">${fmtQty(i.qty_received)}</td>
          <td class="num"><input class="input-sm num" data-r="qty" inputmode="decimal" value="${i.open_qty > 0 ? fmtQty(i.open_qty) : '0'}"></td>
          <td class="num"><input class="input-sm num" data-r="price" inputmode="decimal" value="${Number(i.unit_price_actual ?? i.unit_price_est).toFixed(2).replace('.', ',')}"></td>
          ${can('prices.manage') ? '<td class="center"><input type="checkbox" data-r="upd"></td>' : ''}</tr>`).join('')}</tbody></table></div>
        <label class="field"><span>Bemerkung (z. B. Lieferschein-Nr.)</span><input id="rnote"></label>`,
      actions: [{ label: 'Abbrechen' }, {
        label: 'Wareneingang buchen', cls: 'btn-primary', onClick: async (mm) => {
          const entries = [];
          for (const tr of mm.body.querySelectorAll('tr[data-item]')) {
            const qty = parseNum(tr.querySelector('[data-r="qty"]').value);
            const price = parseNum(tr.querySelector('[data-r="price"]').value);
            if (Number.isNaN(qty) || Number.isNaN(price)) throw new Error('Bitte gültige Zahlen eingeben.');
            const item = list.items.find((i) => i.id === Number(tr.dataset.item));
            const priceChanged = price !== null && Math.abs(price - (item.unit_price_actual ?? item.unit_price_est)) > 0.0001;
            if ((qty || 0) !== 0 || priceChanged) entries.push({ item_id: item.id, qty: qty || 0, unit_price_actual: price, update_price: !!tr.querySelector('[data-r="upd"]')?.checked });
          }
          if (!entries.length) throw new Error('Keine Mengen erfasst.');
          const r = await post(`/api/lists/${id}/receive`, { entries, note: mm.body.querySelector('#rnote').value });
          toast(`Wareneingang gebucht (${r.booked} Pos.). Status: ${LIST_STATUS[r.status].label}`, 'success');
          reload(r.list);
        },
      }],
    });
    m.body.querySelector('#all-open').addEventListener('click', () => m.body.querySelectorAll('tr[data-item]').forEach((tr) => { tr.querySelector('[data-r="qty"]').value = fmtQty(Math.max(0, Number(tr.dataset.open))); }));
    m.body.querySelector('#all-zero').addEventListener('click', () => m.body.querySelectorAll('[data-r="qty"]').forEach((i) => { i.value = '0'; }));
  }

  function closeDialog() {
    const openPos = list.items.filter((i) => i.open_qty > 0).length;
    modal({
      title: `Liste ${list.number} abschließen`,
      body: `${openPos ? `<p class="text-amber">⚠ ${openPos} Position(en) sind noch nicht vollständig geliefert. Nach dem Abschluss gelten diese Mengen nicht mehr als bestellt.</p>` : '<p>Alle Positionen wurden geliefert.</p>'}
        <label class="field"><span>Tatsächliche Gesamtkosten laut Rechnung (optional, netto)</span><input id="ac" inputmode="decimal" placeholder="${(list.totals.actual_goods ?? list.totals.est_total).toFixed(2).replace('.', ',')}"></label>`,
      actions: [{ label: 'Abbrechen' }, {
        label: 'Abschließen', cls: 'btn-primary', onClick: async (m) => {
          const v = m.body.querySelector('#ac').value.trim();
          const ac = v ? parseNum(v) : null;
          if (Number.isNaN(ac)) throw new Error('Ungültiger Betrag.');
          const r = await post(`/api/lists/${id}/status`, { status: 'closed', actual_cost: ac });
          r.warnings.forEach((w) => toast(w, 'warn', 6000));
          toast('Liste abgeschlossen.', 'success'); reload(r.list);
        },
      }],
    });
  }

  function printDialog() {
    if (!printers.length) {
      toast('Kein Bondrucker eingerichtet.' + (can('printers.manage') ? ' Bitte unter „Drucker“ anlegen.' : ' Bitte Administrator informieren.'), 'error');
      return;
    }
    const prefs = JSON.parse(localStorage.getItem('ek.print.prefs') || '{"group_by":"category","per_supplier":false,"only_open":false,"show_prices":false}');
    const m = modal({
      title: 'Einkaufsbon drucken', wide: true,
      body: `<div class="print-grid"><form id="pf" class="form-grid">
        <label class="field"><span>Drucker</span><select name="printer_id">${printers.filter((p) => p.active).map((p) => `<option value="${p.id}" ${p.is_default ? 'selected' : ''}>${esc(p.name)}${p.is_default ? ' (Standard)' : ''}</option>`).join('')}</select></label>
        <label class="field"><span>Gruppierung auf dem Bon</span><select name="group_by"><option value="category">nach Kategorie</option><option value="location">nach Lagerort</option><option value="supplier">nach Lieferant</option></select></label>
        <label class="check"><input type="checkbox" name="per_supplier"> Separaten Bon je Lieferant drucken</label>
        <label class="check"><input type="checkbox" name="only_open"> Nur offene (nicht eingekaufte/gelieferte) Positionen</label>
        <label class="check"><input type="checkbox" name="show_prices"> Geschätzte Preise drucken</label>
        <div class="muted small" id="pstatus"></div>
      </form><pre class="bon-preview" id="pv">Vorschau …</pre></div>`,
      actions: [{ label: 'Abbrechen' }, {
        label: '⎙ Drucken', cls: 'btn-primary', onClick: async (mm) => {
          const body = opts(mm);
          localStorage.setItem('ek.print.prefs', JSON.stringify(body));
          const r = await post(`/api/lists/${id}/print`, body);
          const errs = r.results.filter((x) => x.status === 'error');
          if (errs.length) { toast(`Druckfehler: ${errs[0].error}`, 'error', 9000); reload(); return false; }
          toast(`${r.results.length} Bon(s) an ${r.results[0].printer} gesendet.`, 'success');
          reload();
        },
      }],
    });
    const f = m.body.querySelector('#pf');
    f.group_by.value = prefs.group_by; f.per_supplier.checked = prefs.per_supplier; f.only_open.checked = prefs.only_open; f.show_prices.checked = prefs.show_prices;
    const opts = (mm) => { const ff = mm.body.querySelector('#pf'); return { printer_id: Number(ff.printer_id.value), group_by: ff.group_by.value, per_supplier: ff.per_supplier.checked, only_open: ff.only_open.checked, show_prices: ff.show_prices.checked }; };
    const preview = async () => {
      try {
        const r = await post(`/api/lists/${id}/preview`, opts(m), { quiet: true });
        m.body.querySelector('#pv').textContent = r.bons.map((b) => b.text).join('\n\n✂ - - - - - - - - - - - - - - - - - - - - - - -\n\n');
        m.body.querySelector('#pv').style.setProperty('--cols', r.width);
      } catch (e) { m.body.querySelector('#pv').textContent = e.message; }
    };
    const status = async () => {
      const ps = m.body.querySelector('#pstatus');
      ps.textContent = 'Druckerstatus wird abgefragt …';
      try { const s = await get(`/api/printers/${f.printer_id.value}/status`, { quiet: true }); ps.innerHTML = `${s.online ? '🟢' : '🔴'} ${esc(s.message)}`; } catch (e) { ps.textContent = e.message; }
    };
    f.addEventListener('change', (e) => { preview(); if (e.target.name === 'printer_id') status(); });
    preview(); status();
  }

  function pdfDialog() {
    modal({
      title: 'PDF exportieren',
      body: `<form id="pdff" class="form-grid">
        <label class="field"><span>Gruppierung</span><select name="group"><option value="supplier">nach Lieferant</option><option value="category">nach Kategorie</option><option value="location">nach Lagerort</option></select></label>
        <label class="check"><input type="checkbox" name="prices" checked> Preise und Summen anzeigen</label></form>`,
      actions: [{ label: 'Abbrechen' }, {
        label: 'Öffnen', onClick: (m) => { const f = m.body.querySelector('#pdff'); window.open(`/api/lists/${id}/pdf?group=${f.group.value}&prices=${f.prices.checked ? 1 : 0}&inline=1`, '_blank'); },
      }, {
        label: 'Herunterladen', cls: 'btn-primary', onClick: (m) => { const f = m.body.querySelector('#pdff'); download(`/api/lists/${id}/pdf?group=${f.group.value}&prices=${f.prices.checked ? 1 : 0}`); },
      }],
    });
  }

  async function reprint(jobId) {
    try {
      const r = await post(`/api/print-jobs/${jobId}/reprint`, {});
      if (r.status === 'ok') toast('Erneut gedruckt.', 'success'); else toast(`Druckfehler: ${r.error}`, 'error', 8000);
      reload();
    } catch (e) { toast(e.message, 'error'); }
  }

  draw();
  // Andere Geräte könnten parallel ändern → regelmäßig aktualisieren, wenn nichts fokussiert ist
  const timer = setInterval(async () => {
    if (document.hidden || document.querySelector('.modal-backdrop') || ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
    try {
      const fresh = await get(`/api/lists/${id}`, { quiet: true });
      if (fresh.version !== list.version) { list = fresh; draw(); }
    } catch { /* ignorieren */ }
  }, 30000);
  return { destroy() { clearInterval(timer); } };
}

const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
function dayNames(csv) { return csv ? csv.split(',').map((d) => DAYS[Number(d) - 1]).join(', ') : '–'; }

function detailText(d) {
  if (!d || typeof d !== 'object') return String(d ?? '');
  return Object.entries(d).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => {
    if (Array.isArray(v)) return `${k}: ${v.map((x) => (typeof x === 'object' ? Object.values(x).filter((y) => y !== null).join(' ') : x)).join('; ')}`;
    if (typeof v === 'object') return `${k}: ${v.von ?? '–'} → ${v.nach ?? '–'}`;
    return `${k}: ${v}`;
  }).join(' · ');
}
export { detailText };
