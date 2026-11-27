// Artikelverwaltung: anlegen, bearbeiten, duplizieren, archivieren, sortieren, CSV, Bilder.
import { get, post, put, del } from '../api.js';
import { pushScanHandler } from '../scanner.js';
import { assignCodeDialog } from './scanhelp.js';
import { svg as barcodeSvg } from '../code128.js';
import { searchCatalog, describe as describeCat, COMMON_ORDERS } from '../catalog.js';
import { esc, fmtQty, fmtEur, fmtDateTime, statusBadge, STATUS, toast, modal, confirmDialog, debounce, matches, options, parseNum, emptyState, download, formData } from '../ui.js';

export async function render(el, { can, setActions }) {
  const [cats, sups, locs, units] = await Promise.all([get('/api/categories'), get('/api/suppliers'), get('/api/locations'), get('/api/units')]);
  let arts = [];
  let lastRows = [];
  const f = JSON.parse(sessionStorage.getItem('ek.art.filter') || '{"q":"","cat":"","sup":"","loc":"","status":"","view":"active","sort":"name","dir":1}');
  const saveF = () => sessionStorage.setItem('ek.art.filter', JSON.stringify(f));

  const acts = setActions(`${can('articles.manage') ? '<button class="btn" id="csv-exp">CSV-Export</button><button class="btn" id="csv-imp">CSV-Import</button><button class="btn" id="paste-imp">📋 Tabelle einfügen (MIN/MAX)</button><button class="btn" id="labels">🏷️ Etiketten</button><button class="btn btn-primary" id="new-art">+ Neuer Artikel</button>' : ''}`);
  acts.querySelector('#new-art')?.addEventListener('click', () => editDialog(null));
  acts.querySelector('#csv-exp')?.addEventListener('click', () => download('/api/articles/export.csv'));
  acts.querySelector('#csv-imp')?.addEventListener('click', importDialog);
  acts.querySelector('#paste-imp')?.addEventListener('click', () => pasteDialog(sups, load));
  acts.querySelector('#labels')?.addEventListener('click', () => labelsDialog(lastRows.map((a) => a.id), lastRows.filter((a) => !a.codes.length).map((a) => a.id)));

  el.innerHTML = `
    <div class="toolbar toolbar-wrap">
      <input type="search" class="search" id="q" placeholder="Name, Nummer, Hersteller …" value="${esc(f.q)}">
      <select id="cat"><option value="">Alle Kategorien</option>${cats.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
      <select id="sup"><option value="">Alle Lieferanten</option>${sups.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
      <select id="loc"><option value="">Alle Lagerorte</option>${locs.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select>
      <select id="status"><option value="">Jeder Status</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select>
      <div class="seg">${[['active', 'Aktiv'], ['inactive', 'Inaktiv'], ['archived', 'Archiv']].map(([k, l]) => `<button data-view="${k}" class="${f.view === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    </div>
    <div class="legend">${Object.values(STATUS).map((s) => `<span class="badge ${s.cls}">${s.label}</span>`).join('')}</div>
    <div id="tbl"></div>`;
  for (const k of ['cat', 'sup', 'loc', 'status']) { const s = el.querySelector('#' + k); s.value = f[k]; s.addEventListener('change', () => { f[k] = s.value; saveF(); draw(); }); }
  el.querySelector('#q').addEventListener('input', debounce((e) => { f.q = e.target.value; saveF(); draw(); }, 150));
  el.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', async () => {
    f.view = b.dataset.view; saveF(); el.querySelectorAll('[data-view]').forEach((x) => x.classList.toggle('on', x === b)); await load();
  }));
  const tbl = el.querySelector('#tbl');

  async function load() { arts = await get(`/api/articles${f.view === 'archived' ? '?archived=1' : ''}`); draw(); }

  const COLS = [
    ['sort_order', '#'], ['name', 'Artikel'], ['category_name', 'Kategorie'], ['supplier_name', 'Lieferant'], ['location_name', 'Lagerort'],
    ['min_stock', 'MIN'], ['max_stock', 'MAX'], ['current_stock', 'Ist'], ['recommended', 'Empf.'], ['price_net', 'EK netto'], ['status', 'Status'],
  ];

  function draw() {
    let rows = arts.filter((a) => (f.view === 'inactive' ? !a.active : f.view === 'active' ? a.active : true));
    rows = rows.filter((a) => (!f.cat || String(a.category_id) === f.cat) && (!f.sup || String(a.supplier_id) === f.sup) && (!f.loc || String(a.location_id) === f.loc) && (!f.status || a.status === f.status));
    if (f.q) rows = rows.filter((a) => matches(`${a.name} ${a.article_no} ${a.manufacturer || ''} ${a.notes || ''} ${a.pack_size || ''} ${a.codes.join(' ')}`, f.q));
    rows.sort((a, b) => {
      const x = a[f.sort]; const y = b[f.sort];
      if (x === y) return a.name.localeCompare(b.name, 'de');
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'de')) * f.dir;
    });
    lastRows = rows;
    if (!rows.length) { tbl.innerHTML = emptyState(arts.length ? 'Kein Artikel entspricht dem Filter.' : 'Noch keine Artikel vorhanden.'); return; }
    const manual = f.sort === 'sort_order' && can('articles.manage') && !f.q && !f.cat && !f.sup && !f.loc && !f.status;
    tbl.innerHTML = `<div class="muted small">${rows.length} Artikel${manual ? ' · Reihenfolge mit ▲▼ ändern (wirkt im Einkaufsmodus)' : ' · Spaltenkopf antippen zum Sortieren'}</div>
      <div class="table-wrap"><table class="table table-click"><thead><tr>${COLS.map(([k, l]) => `<th data-sort="${k}" class="${['min_stock', 'max_stock', 'current_stock', 'recommended', 'price_net'].includes(k) ? 'num' : ''} sortable">${l}${f.sort === k ? (f.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}<th></th></tr></thead>
      <tbody>${rows.map((a) => `<tr data-id="${a.id}" class="${a.active ? '' : 'row-muted'}">
        <td>${manual ? `<button class="btn-icon" data-mv="-1">▲</button><button class="btn-icon" data-mv="1">▼</button>` : `<small class="muted">${a.sort_order}</small>`}</td>
        <td><strong>${esc(a.name)}</strong><br><small class="muted">${esc([a.article_no, a.pack_size, a.manufacturer].filter(Boolean).join(' · '))}</small>${a.codes.length ? ` <span class="pill" title="${esc(a.codes.join(', '))}">🏷️ ${a.codes.length}</span>` : ''}${a.unavailable_since ? '<br><span class="pill pill-dark">nicht verfügbar</span>' : ''}</td>
        <td>${esc(a.category_name || '–')}</td><td>${esc(a.supplier_name || '–')}</td><td>${esc(a.location_name || '–')}</td>
        <td class="num">${fmtQty(a.min_stock)}</td><td class="num">${fmtQty(a.max_stock)}</td>
        <td class="num">${a.current_stock === null ? '<span class="muted">?</span>' : fmtQty(a.current_stock)} <small>${esc(a.unit_plural || '')}</small></td>
        <td class="num">${a.recommended ? `<strong>${fmtQty(a.recommended)}</strong>` : '–'}</td>
        <td class="num">${fmtEur(a.price_net)}</td><td>${statusBadge(a.status)}${a.on_order ? `<br><small>bestellt ${fmtQty(a.on_order)}</small>` : ''}</td>
        <td class="row-actions">${can('articles.manage') ? `<button class="btn-icon" data-dup title="Duplizieren">⧉</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
    tbl.querySelectorAll('[data-sort]').forEach((th) => th.addEventListener('click', () => {
      if (f.sort === th.dataset.sort) f.dir = -f.dir; else { f.sort = th.dataset.sort; f.dir = 1; }
      saveF(); draw();
    }));
  }

  tbl.addEventListener('click', async (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const id = Number(tr.dataset.id);
    try {
      if (e.target.closest('[data-mv]')) {
        const vis = [...tbl.querySelectorAll('tr[data-id]')].map((r) => Number(r.dataset.id));
        const i = vis.indexOf(id); const j = i + Number(e.target.closest('[data-mv]').dataset.mv);
        if (j < 0 || j >= vis.length) return;
        [vis[i], vis[j]] = [vis[j], vis[i]];
        const others = arts.filter((a) => !vis.includes(a.id)).sort((a, b) => a.sort_order - b.sort_order).map((a) => a.id);
        await post('/api/articles/reorder', { ids: [...vis, ...others] });
        await load();
      } else if (e.target.closest('[data-dup]')) {
        const a = await post(`/api/articles/${id}/duplicate`);
        toast(`Kopie „${a.name}“ angelegt.`, 'success');
        await load();
        editDialog(a.id);
      } else editDialog(id);
    } catch (err) { toast(err.message, 'error'); }
  });

  async function editDialog(id, { code: presetCode = '' } = {}) {
    const a = id ? await get(`/api/articles/${id}`) : { active: 1, order_step: 1, min_order_qty: 0, price_net: 0, min_stock: 0, max_stock: 0 };
    let codes = id ? await get(`/api/articles/${id}/codes`) : [];
    const ro = !can('articles.manage');
    const roMM = !can('minmax.manage');
    const roP = !can('prices.manage');
    let image = a.image || null;
    const dis = (x) => (x ? 'disabled' : '');
    const m = modal({
      title: id ? `Artikel: ${a.name}` : 'Neuer Artikel', wide: true,
      body: `<form id="af" class="form-grid form-2col">
        <div class="field cat-wrap"><span>Artikelname * ${ro ? '' : '<small class="muted">– tippen für Vorschläge aus dem Produktkatalog</small>'}</span><input name="name" value="${esc(a.name || '')}" required autocomplete="off" ${dis(ro)}>
          <div class="cat-sug" id="cat-sug" hidden></div></div>
        <label class="field"><span>Artikelnummer <small class="muted">(leer = automatisch)</small></span><input name="article_no" value="${esc(a.article_no || '')}" placeholder="z. B. AFG-001" ${dis(ro)}></label>
        <label class="field"><span>Kategorie</span><select name="category_id" ${dis(ro)}>${options(cats.filter((c) => c.active || c.id === a.category_id), a.category_id)}</select></label>
        <label class="field"><span>Hersteller</span><input name="manufacturer" value="${esc(a.manufacturer || '')}" ${dis(ro)}></label>
        <label class="field"><span>Lieferant</span><select name="supplier_id" ${dis(ro)}>${options(sups.filter((s) => s.active || s.id === a.supplier_id), a.supplier_id)}</select></label>
        <label class="field"><span>Lagerort</span><select name="location_id" ${dis(ro)}>${options(locs.filter((l) => l.active || l.id === a.location_id), a.location_id)}</select></label>
        <label class="field"><span>Gebindegröße</span><input name="pack_size" value="${esc(a.pack_size || '')}" placeholder="z. B. 24 x 0,33 l" ${dis(ro)}></label>
        <label class="field"><span>Mengeneinheit (Zähleinheit)</span><select name="unit_id" ${dis(ro)}>${options(units, a.unit_id)}</select></label>
        <label class="field"><span>Bestelleinheit (optional, z. B. Karton)</span><select name="order_unit_id" ${dis(ro)}>${options(units, a.order_unit_id, { empty: '– wie Zähleinheit –' })}</select></label>
        <label class="field"><span>Inhalt je Bestelleinheit (in Zähleinheiten)</span><input name="units_per_order" inputmode="decimal" value="${fmtNum(a.units_per_order ?? 1)}" ${dis(ro)}></label>
        ${ro ? '' : '<div class="field span2 order-how"><span>📦 Wie wird bestellt?</span><div class="chips" id="order-chips"></div></div>'}
        <label class="field"><span>Einkaufspreis netto (€ je Einheit)</span><input name="price_net" inputmode="decimal" value="${fmtNum(a.price_net)}" ${dis(roP)}></label>
        <label class="field"><span>Mindestbestellmenge</span><input name="min_order_qty" inputmode="decimal" value="${fmtNum(a.min_order_qty)}" ${dis(ro)}></label>
        <label class="field"><span>Mindestbestand (MIN)</span><input name="min_stock" inputmode="decimal" value="${fmtNum(a.min_stock)}" ${dis(roMM)}></label>
        <label class="field"><span>Maximalbestand (MAX, Zielbestand)</span><input name="max_stock" inputmode="decimal" value="${fmtNum(a.max_stock)}" ${dis(roMM)}></label>
        <label class="field"><span>Bestellintervall / Gebindeschritt</span><input name="order_step" inputmode="decimal" value="${fmtNum(a.order_step)}" ${dis(ro)}></label>
        ${id ? `<div class="field"><span>Aktueller Ist-Bestand</span><div class="static">${a.current_stock === null ? 'nicht kontrolliert' : fmtQty(a.current_stock) + ' ' + esc(a.unit_plural || '')} ${a.stock_checked_at ? `<small class="muted">(${fmtDateTime(a.stock_checked_at)})</small>` : ''}
          ${can('articles.manage') ? '<button type="button" class="btn btn-sm" id="corr">Korrigieren</button>' : ''}</div></div>`
        : `<label class="field"><span>Anfangsbestand (optional)</span><input name="current_stock" inputmode="decimal" placeholder="leer = nicht kontrolliert"></label>`}
        <label class="field"><span>Sortierung (Einkaufsmodus)</span><input name="sort_order" inputmode="numeric" value="${a.sort_order ?? 0}" ${dis(ro)}></label>
        <label class="check"><input type="checkbox" name="active" ${a.active ? 'checked' : ''} ${dis(ro)}> Aktiv (im Einkaufsmodus sichtbar)</label>
        <label class="field span2"><span>Bemerkungen</span><textarea name="notes" rows="2" ${dis(ro)}>${esc(a.notes || '')}</textarea></label>
        <div class="field span2"><span>Artikelbild (optional)</span>
          <div class="img-edit"><img id="img-prev" alt="" ${image ? `src="${image}"` : 'hidden'}>
          ${ro ? '' : '<label class="btn btn-sm">Bild wählen / Foto<input type="file" accept="image/*" capture="environment" id="img-in" hidden></label><button type="button" class="btn btn-sm" id="img-del">Bild entfernen</button>'}</div></div>
        <div class="hint span2" id="calc-hint"></div>
        <div class="field span2 codes-box"><span>🏷️ Barcodes / QR-Codes / Etiketten-Code</span>
          <div id="code-list"></div>
          ${ro ? '' : `<div class="row"><input id="code-in" data-scan-accept placeholder="Code scannen oder eintippen, dann Enter" autocomplete="off" value="${esc(presetCode)}">
            <button type="button" class="btn btn-sm" id="code-add">Hinzufügen</button>${id ? '<button type="button" class="btn btn-sm" id="code-gen">Eigenen Code erzeugen</button>' : ''}</div>`}
          ${id ? '<div class="btn-row mt"><button type="button" class="btn btn-sm" id="lbl-a4">🖨️ Etikett A4</button><button type="button" class="btn btn-sm" id="lbl-bon">🧾 Etikett Bondrucker</button></div>' : ''}
        </div>
      </form>
      ${id && a.movements?.length ? `<details class="mt"><summary>Bestandsbewegungen (${a.movements.length})</summary><div class="table-wrap"><table class="table table-sm"><thead><tr><th>Zeit</th><th>Art</th><th class="num">Vorher</th><th class="num">Nachher</th><th class="num">Änderung</th><th>Benutzer</th><th>Bemerkung</th></tr></thead>
        <tbody>${a.movements.map((mv) => `<tr><td>${fmtDateTime(mv.at)}</td><td>${({ count: 'Kontrolle', receipt: 'Wareneingang', correction: 'Korrektur' })[mv.type]}</td><td class="num">${mv.qty_before === null ? '–' : fmtQty(mv.qty_before)}</td><td class="num">${mv.qty_after === null ? '–' : fmtQty(mv.qty_after)}</td><td class="num">${mv.delta === null ? '' : (mv.delta > 0 ? '+' : '') + fmtQty(mv.delta)}</td><td>${esc(mv.user_name || '')}</td><td>${esc([mv.note, mv.list_number].filter(Boolean).join(' · '))}</td></tr>`).join('')}</tbody></table></div></details>` : ''}`,
      actions: [
        ...(id && can('articles.manage') ? [{ label: a.archived ? 'Wiederherstellen' : 'Archivieren', cls: 'btn-danger-ghost', onClick: async () => {
          if (!a.archived && !(await confirmDialog(`„${a.name}“ archivieren? Archivierte Artikel erscheinen nicht mehr im Einkaufsmodus.`))) return false;
          await post(`/api/articles/${id}/archive`, { archived: !a.archived }); toast(a.archived ? 'Wiederhergestellt.' : 'Archiviert.', 'success'); await load();
        } }] : []),
        ...(id && can('articles.manage') && a.archived ? [{ label: 'Endgültig löschen', cls: 'btn-danger', onClick: async () => {
          if (!(await confirmDialog('Artikel endgültig löschen? (nur ohne Historie möglich)', { danger: true, ok: 'Löschen' }))) return false;
          await del(`/api/articles/${id}`); toast('Gelöscht.', 'success'); await load();
        } }] : []),
        { label: 'Abbrechen' },
        ...(ro && roMM && roP ? [] : [{ label: 'Speichern', cls: 'btn-primary', onClick: async (mm) => {
          const form = mm.body.querySelector('#af');
          const d = formData(form);
          for (const k of ['price_net', 'min_stock', 'max_stock', 'min_order_qty', 'order_step', 'current_stock', 'units_per_order']) if (d[k] !== undefined) { const n = parseNum(d[k]); if (Number.isNaN(n)) throw new Error('Bitte gültige Zahlen eingeben.'); d[k] = n; }
          d.active = form.active.checked;
          if (!ro) d.image = image;
          const saved = id ? await put(`/api/articles/${id}`, d) : await post('/api/articles', d);
          const pending = mm.body.querySelector('#code-in')?.value.trim();
          if (pending) { try { await post(`/api/articles/${saved.id}/codes`, { code: pending }); } catch (e) { toast(`Artikel gespeichert, Code nicht: ${e.message}`, 'warn', 7000); } }
          toast(`„${saved.name}“ gespeichert.`, 'success');
          await load();
        } }]),
      ],
    });
    const form = m.body.querySelector('#af');
    const hint = () => {
      const min = parseNum(form.min_stock.value) || 0; const max = parseNum(form.max_stock.value) || 0;
      const h = m.body.querySelector('#calc-hint');
      if (max > 0 && max < min) h.innerHTML = '<span class="text-red">MAX muss ≥ MIN sein.</span>';
      else if (max > 0 && (parseNum(form.units_per_order.value) || 1) > 1 && form.order_unit_id.value) h.textContent = `Bestellempfehlung, sobald Ist + bestellt ≤ ${fmtQty(min)} – aufgefüllt bis ${fmtQty(max)}, immer in ganzen ${form.order_unit_id.selectedOptions[0].text}-Einheiten à ${fmtQty(parseNum(form.units_per_order.value))}.`;
      else if (max > 0) h.textContent = `Bestellempfehlung entsteht, sobald Ist-Bestand + bestellte Menge ≤ ${fmtQty(min)} ist – aufgefüllt wird bis ${fmtQty(max)} (gerundet auf Gebindeschritt ${fmtQty(parseNum(form.order_step.value) || 1)}).`;
      else h.textContent = 'Ohne MAX (> 0) wird keine automatische Bestellempfehlung erzeugt.';
    };
    form.addEventListener('input', hint); hint();

    // ---------- Produktkatalog: Namen vervollständigen, Einheit & Kasten/Karton vorschlagen ----------
    let catOrders = null; // Bestelloptionen des gewählten Katalogeintrags
    const unitByName = (n) => units.find((u) => u.name === n || u.plural === n);
    const ensureUnit = async (n) => {
      let u = unitByName(n);
      if (u) return u;
      u = await post('/api/units', { name: n, plural: n });
      units.push(u);
      for (const sel of [form.unit_id, form.order_unit_id]) sel.insertAdjacentHTML('beforeend', `<option value="${u.id}">${esc(u.name)}</option>`);
      return u;
    };
    const drawOrderChips = () => {
      const box = m.body.querySelector('#order-chips');
      if (!box) return;
      const base = units.find((u) => String(u.id) === form.unit_id.value);
      const baseName = base ? base.name : 'Zähleinheit';
      const opts = [{ unit: null, per: 1 }, ...(catOrders && catOrders.length ? catOrders : COMMON_ORDERS)];
      const curUnit = units.find((u) => String(u.id) === form.order_unit_id.value);
      const curPer = parseNum(form.units_per_order.value) || 1;
      const isOn = (o) => (o.unit === null ? !curUnit || curPer <= 1 : curUnit && curUnit.name === o.unit && Math.abs(curPer - o.per) < 1e-9);
      box.innerHTML = opts.map((o, i) => `<button type="button" class="chip ${isOn(o) ? 'on' : ''}" data-ord="${i}">${o.unit === null ? `einzeln (${esc(baseName)})` : `${esc(o.unit)} à ${o.per}`}</button>`).join('')
        + '<button type="button" class="chip" data-ord="custom">anders …</button>'
        + `<small class="muted order-note">${catOrders && catOrders.length ? 'Typisches Gebinde laut Katalog – bitte mit dem Lieferanten abgleichen.' : 'Die Zählung schlägt dann ganze Kästen/Kartons vor.'}</small>`;
      box.querySelectorAll('[data-ord]').forEach((b) => b.addEventListener('click', async () => {
        if (b.dataset.ord === 'custom') { form.order_unit_id.focus(); return; }
        const o = opts[Number(b.dataset.ord)];
        if (o.unit === null) { form.order_unit_id.value = ''; form.units_per_order.value = '1'; } else {
          const u = await ensureUnit(o.unit);
          form.order_unit_id.value = String(u.id); form.units_per_order.value = String(o.per);
        }
        drawOrderChips(); hint();
      }));
    };
    if (!ro) {
      drawOrderChips();
      ['unit_id', 'order_unit_id', 'units_per_order'].forEach((n) => form[n].addEventListener('change', drawOrderChips));
      const sug = m.body.querySelector('#cat-sug');
      const applyCat = async (e) => {
        form.name.value = e.name;
        if (!form.manufacturer.value && e.maker) form.manufacturer.value = e.maker;
        if (!form.pack_size.value) form.pack_size.value = /^\d/.test(e.size) ? e.size : '';
        const cat = cats.find((c) => c.name === e.category);
        if (cat && (!id || !form.category_id.value)) form.category_id.value = String(cat.id);
        const u = await ensureUnit(e.unit);
        form.unit_id.value = String(u.id);
        catOrders = e.orders;
        if (e.orders.length) {
          const ou = await ensureUnit(e.orders[0].unit);
          form.order_unit_id.value = String(ou.id); form.units_per_order.value = String(e.orders[0].per);
        } else { form.order_unit_id.value = ''; form.units_per_order.value = '1'; }
        sug.hidden = true;
        drawOrderChips(); hint();
        toast(`Übernommen: ${e.name} – ${describeCat(e)}`, 'success');
        form.min_stock.focus();
      };
      form.name.addEventListener('input', () => {
        const q = form.name.value;
        const hits = searchCatalog(q, 8);
        const dup = arts.find((x) => x.id !== id && x.name.toLowerCase() === q.trim().toLowerCase());
        if (!hits.length && !dup) { sug.hidden = true; return; }
        sug.innerHTML = (dup ? `<div class="cat-dup">⚠ „${esc(dup.name)}“ gibt es schon als Artikel (${esc(dup.article_no)}).</div>` : '')
          + hits.map((e, i) => `<button type="button" class="cat-item" data-cat="${i}"><strong>${esc(e.name)}</strong><small>${esc([e.maker, e.category].filter(Boolean).join(' · '))}</small><span class="cat-units">${esc(describeCat(e))}</span></button>`).join('');
        sug.hidden = false;
        sug.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => applyCat(hits[Number(b.dataset.cat)])));
      });
      form.name.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') sug.hidden = true; });
      form.name.addEventListener('blur', () => setTimeout(() => { sug.hidden = true; }, 200));
    }
    m.body.querySelector('#img-in')?.addEventListener('change', async (e) => {
      const file = e.target.files[0]; if (!file) return;
      try { image = await resizeImage(file, 480); const p = m.body.querySelector('#img-prev'); p.src = image; p.hidden = false; } catch { toast('Bild konnte nicht gelesen werden.', 'error'); }
    });
    m.body.querySelector('#img-del')?.addEventListener('click', () => { image = null; m.body.querySelector('#img-prev').hidden = true; });
    m.body.querySelector('#corr')?.addEventListener('click', () => correctDialog(a, m));
    const KIND = { ean: 'EAN', own: 'Eigener Code', case: 'Karton-EAN', other: 'Code' };
    const drawCodes = () => {
      const box = m.body.querySelector('#code-list');
      box.innerHTML = codes.length ? `<ul class="code-list">${codes.map((c) => `<li><span class="code-svg">${(() => { try { return barcodeSvg(c.code, { height: 28, module: 1.2, quiet: 4, fontSize: 9 }); } catch { return ''; } })()}</span>
        <span class="grow"><code>${esc(c.code)}</code> <small class="muted">${KIND[c.kind]}${c.ean_valid === false ? ' · <span class="text-red">Prüfziffer ungültig</span>' : ''}</small></span>
        ${ro ? '' : `<button type="button" class="btn-icon danger" data-del-code="${c.id}" title="Code entfernen">🗑</button>`}</li>`).join('')}</ul>`
        : `<p class="muted small">${id ? 'Noch kein Code. Ware scannen, eintippen oder eigenen Code erzeugen (für Regaletiketten).' : 'Optional: Code jetzt scannen – er wird beim Speichern zugeordnet.'}</p>`;
      box.querySelectorAll('[data-del-code]').forEach((b) => b.addEventListener('click', async () => {
        try { await del(`/api/articles/${id}/codes/${b.dataset.delCode}`); codes = await get(`/api/articles/${id}/codes`); drawCodes(); } catch (e) { toast(e.message, 'error'); }
      }));
    };
    drawCodes();
    const addCode = async () => {
      const inp = m.body.querySelector('#code-in');
      const v = inp.value.trim(); if (!v || !id) return;
      try { await post(`/api/articles/${id}/codes`, { code: v }); inp.value = ''; codes = await get(`/api/articles/${id}/codes`); drawCodes(); toast('Code gespeichert.', 'success'); } catch (e) { toast(e.message, 'error'); }
    };
    m.body.querySelector('#code-add')?.addEventListener('click', addCode);
    m.body.querySelector('#code-in')?.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Tab') { if (id) { e.preventDefault(); addCode(); } else if (e.key === 'Enter') e.preventDefault(); } });
    m.body.querySelector('#code-gen')?.addEventListener('click', async () => { try { await post(`/api/articles/${id}/codes/generate`); codes = await get(`/api/articles/${id}/codes`); drawCodes(); } catch (e) { toast(e.message, 'error'); } });
    m.body.querySelector('#lbl-a4')?.addEventListener('click', () => openA4Labels([id], {}));
    m.body.querySelector('#lbl-bon')?.addEventListener('click', () => printBonLabels([id], 1).then(async () => { codes = await get(`/api/articles/${id}/codes`); drawCodes(); }));
  }

  function correctDialog(a, parent) {
    modal({
      title: `Bestand korrigieren: ${a.name}`,
      body: `<form class="form-grid" id="cf"><label class="field"><span>Neuer Ist-Bestand (leer = nicht kontrolliert)</span><input name="stock" inputmode="decimal" value="${a.current_stock === null ? '' : fmtNum(a.current_stock)}"></label>
        <label class="field"><span>Grund *</span><input name="note" required placeholder="z. B. Bruch, Inventur"></label></form>`,
      actions: [{ label: 'Abbrechen' }, { label: 'Korrigieren', cls: 'btn-primary', onClick: async (m) => {
        const f2 = m.body.querySelector('#cf'); const s = parseNum(f2.stock.value);
        if (Number.isNaN(s)) throw new Error('Ungültige Zahl.');
        await post(`/api/articles/${a.id}/correct-stock`, { stock: s, note: f2.note.value });
        toast('Bestand korrigiert.', 'success'); parent.close(); await load(); editDialog(a.id);
      } }],
    });
  }

  function importDialog() {
    modal({
      title: 'Artikel aus CSV importieren', wide: true,
      body: `<p>CSV mit Semikolon (Excel-Export „CSV UTF-8“). Erforderliche Spalten: <b>Artikelnummer</b>, <b>Artikelname</b>. Optional: Kategorie, Hersteller, Lieferant, Lagerort, Gebindegröße, Mengeneinheit, EK netto, MIN, MAX, Mindestbestellmenge, Gebindeschritt, Bemerkungen, Aktiv.
        Vorhandene Artikelnummern werden aktualisiert, neue angelegt. Fehlende Kategorien/Lieferanten/Lagerorte/Einheiten werden automatisch angelegt. Tipp: Zuerst „CSV-Export“ als Vorlage verwenden.</p>
        <input type="file" accept=".csv,text/csv" id="csvf"><pre class="small" id="res"></pre>`,
      actions: [{ label: 'Schließen' }, { label: 'Importieren', cls: 'btn-primary', onClick: async (m) => {
        const file = m.body.querySelector('#csvf').files[0];
        if (!file) throw new Error('Bitte eine CSV-Datei wählen.');
        const buf = await file.arrayBuffer();
        let text = new TextDecoder('utf-8').decode(buf);
        if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buf);
        const r = await post('/api/articles/import', { csv: text });
        m.body.querySelector('#res').textContent = `Neu: ${r.created} · Aktualisiert: ${r.updated}${r.errors.length ? '\nFehler:\n' + r.errors.join('\n') : ''}`;
        toast(`Import: ${r.created} neu, ${r.updated} aktualisiert, ${r.errors.length} Fehler.`, r.errors.length ? 'warn' : 'success');
        await load();
        return false;
      } }],
    });
  }

  // Scanner: gescannter Artikel öffnet sich; unbekannter Code → anlegen oder zuordnen
  const popScan = pushScanHandler(async (code) => {
    if (document.querySelector('.modal-backdrop')) return;
    try {
      const r = await get(`/api/codes/${encodeURIComponent(code)}`, { quiet: true });
      editDialog(r.article.id);
    } catch (e) {
      if (e.status !== 404) return toast(e.message, 'error');
      if (!can('articles.manage')) return toast(`Unbekannter Code „${code}“.`, 'error');
      modal({
        title: 'Unbekannter Code', body: `<p>Der Code <code>${esc(code)}</code> ist noch keinem Artikel zugeordnet.</p>`,
        actions: [{ label: 'Abbrechen' },
          { label: 'Vorhandenem Artikel zuordnen', onClick: async () => { const a = await assignCodeDialog(code); if (a) { await load(); editDialog(a.id); } } },
          { label: '+ Neuen Artikel anlegen', cls: 'btn-primary', onClick: () => { editDialog(null, { code }); } }],
      });
    }
  });
  const open = sessionStorage.getItem('ek.openArticle');
  if (open) { sessionStorage.removeItem('ek.openArticle'); editDialog(Number(open)); }

  await load();
  return { destroy() { popScan(); } };
}

/** A4-Etikettenbogen in neuem Fenster. */
function openA4Labels(ids, { layout = '3x8', copies = 1, skip = 0, minmax = false }) {
  const w = window.open(`/labels.html#ids=${ids.join(',')}&layout=${layout}&copies=${copies}&skip=${skip}&minmax=${minmax ? 1 : 0}`, '_blank', 'width=900,height=1000');
  if (!w) toast('Das Druckfenster wurde blockiert – bitte Pop-ups erlauben.', 'error');
}

async function printBonLabels(ids, copies) {
  try {
    const r = await post('/api/labels/print', { article_ids: ids, copies });
    if (r.status === 'ok') toast(`${r.count} Etikett(en) an ${r.printer} gesendet.`, 'success'); else toast(`Druckfehler: ${r.error}`, 'error', 8000);
  } catch (e) { toast(e.message, 'error'); }
}

function labelsDialog(visibleIds, withoutCodeIds) {
  if (!visibleIds.length) return toast('Keine Artikel in der aktuellen Ansicht.', 'info');
  modal({
    title: 'Etiketten drucken',
    body: `<form id="lf" class="form-grid">
      <div class="field"><span>Welche Artikel?</span>
        <label class="check"><input type="radio" name="sel" value="all" checked> Alle in der aktuellen Ansicht (${visibleIds.length})</label>
        <label class="check"><input type="radio" name="sel" value="nocode" ${withoutCodeIds.length ? '' : 'disabled'}> Nur Artikel ohne Code (${withoutCodeIds.length})</label></div>
      <div class="field"><span>Format</span>
        <label class="check"><input type="radio" name="fmt" value="3x8" checked> A4-Bogen 3 × 8 (63,5 × 33,9 mm, z. B. Avery Zweckform L7159)</label>
        <label class="check"><input type="radio" name="fmt" value="2x7"> A4-Bogen 2 × 7 (99,1 × 38,1 mm, z. B. L7163)</label>
        <label class="check"><input type="radio" name="fmt" value="bon"> Bondrucker (ein Etikett je Abschnitt)</label></div>
      <div class="form-2col form-grid"><label class="field"><span>Exemplare je Artikel</span><input name="copies" inputmode="numeric" value="1"></label>
        <label class="field"><span>Bereits benutzte Etiketten auf dem Bogen überspringen</span><input name="skip" inputmode="numeric" value="0"></label></div>
      <label class="check"><input type="checkbox" name="minmax"> MIN/MAX auf dem Etikett anzeigen</label>
      <p class="muted small">Artikel ohne Code erhalten automatisch einen eigenen Code (EK…), der sofort scannbar ist. Der Barcode (Code 128) wird von Barcode- und QR-Scannern gelesen.</p></form>`,
    actions: [{ label: 'Abbrechen' }, { label: '🏷️ Drucken', cls: 'btn-primary', onClick: async (m) => {
      const f = m.body.querySelector('#lf');
      const ids = f.sel.value === 'nocode' ? withoutCodeIds : visibleIds;
      const copies = Math.max(1, Math.min(50, Number(f.copies.value) || 1));
      if (f.fmt.value === 'bon') await printBonLabels(ids, copies);
      else openA4Labels(ids, { layout: f.fmt.value, copies, skip: Number(f.skip.value) || 0, minmax: f.minmax.checked });
    } }],
  });
}

const FIELD_LABELS = {
  article_no: 'Artikelnummer', name: 'Artikelname', category: 'Kategorie', category_id: 'Kategorie', manufacturer: 'Hersteller', supplier: 'Lieferant', supplier_id: 'Lieferant',
  location: 'Lagerort', location_id: 'Lagerort', pack_size: 'Gebinde', unit: 'Zähleinheit', unit_id: 'Zähleinheit', order_unit: 'Bestelleinheit', order_unit_id: 'Bestelleinheit',
  units_per_order: 'Inhalt je Bestelleinheit', min_stock: 'MIN', max_stock: 'MAX', price_net: 'EK netto', min_order_qty: 'Mindestbestellmenge', order_step: 'Gebindeschritt', notes: 'Bemerkung', active: 'Aktiv', sort_order: 'Sortierung',
};

function claudePrompt(markdown) {
  return `Du bist Einkaufsexperte für den Servicebereich (Bar, Restaurant, Frühstück) eines Hotels.
Berechne für die folgenden Artikel sinnvolle Mindestbestände (MIN) und Maximalbestände (MAX).

Regeln:
- MIN = Meldebestand: Menge, die bis zur nächsten Lieferung bzw. zum nächsten Einkauf reicht, plus kleine Sicherheitsreserve.
- MAX = Zielbestand direkt nach dem Einkauf – so niedrig wie möglich (wenig gebundenes Kapital), aber ausreichend bis zum übernächsten Einkauf.
- MIN und MAX immer in der Zähleinheit (z. B. Flaschen, Kästen). MAX - MIN sollte zu ganzen Bestelleinheiten passen (z. B. Karton à 6).
- Fehlende Bestelleinheit und Inhalt (z. B. Karton, 6) gern ergänzen, wenn typisch.
- Weitere übliche Artikel darfst du als neue Zeilen ergänzen (Artikelnummer leer lassen).

Angaben zu meinem Betrieb (bitte ergänzen):
- Öffnungstage / Gäste pro Woche: …
- Wie oft wird eingekauft bzw. geliefert: …
- Ungefährer Verbrauch pro Woche (falls bekannt): …

Antworte mit genau einer Markdown-Tabelle mit exakt diesen Spalten (Zahlen mit Komma, keine Einheiten in den Zahlenspalten):

${markdown}`;
}

function pasteDialog(sups, reload) {
  let preview = null;
  const m = modal({
    title: 'Tabelle einfügen – MIN/MAX z. B. von Claude', wide: true,
    body: `<div class="steps"><span>1. Anfrage kopieren</span><span>2. In Claude einfügen &amp; Betrieb beschreiben</span><span>3. Antwort-Tabelle hier einfügen</span><span>4. Vorschau prüfen → Übernehmen</span></div>
      <div class="btn-row"><select id="tpl-sup"><option value="">Alle Artikel</option>${sups.map((s) => `<option value="${s.id}">nur ${esc(s.name)}</option>`).join('')}</select>
        <button class="btn" id="tpl">📋 Anfrage für Claude kopieren</button></div>
      <textarea id="tpl-text" class="paste-area mt" readonly hidden></textarea>
      <label class="field mt"><span>Tabelle hier einfügen (Markdown von Claude, aus Excel kopiert oder CSV)</span>
        <textarea id="paste" class="paste-area" placeholder="| Artikelname | MIN | MAX |&#10;|---|---|---|&#10;| Aperol | 3 | 12 |"></textarea></label>
      <label class="check"><input type="checkbox" id="create" checked> Unbekannte Artikel neu anlegen (fehlende Lieferanten, Kategorien, Einheiten werden ergänzt)</label>
      <div id="pv" class="mt"></div>`,
    actions: [{ label: 'Schließen' }, { label: 'Vorschau', cls: '', onClick: () => runPreview().then(() => false) }, {
      label: 'Übernehmen', cls: 'btn-primary', onClick: async (mm) => {
        if (!preview) { await runPreview(); return false; }
        const r = await post('/api/articles/paste-import', { text: mm.body.querySelector('#paste').value, apply: true, create_new: mm.body.querySelector('#create').checked });
        toast(`Übernommen: ${r.counts.create} neu, ${r.counts.update} aktualisiert${r.counts.error ? `, ${r.counts.error} Fehler` : ''}.`, r.counts.error ? 'warn' : 'success', 6000);
        await reload();
        return !r.counts.error;
      },
    }],
  });
  const pv = m.body.querySelector('#pv');
  const applyBtn = m.el.querySelector('.modal-foot .btn-primary');
  m.body.querySelector('#paste').addEventListener('input', () => { preview = null; pv.innerHTML = ''; });
  m.body.querySelector('#create').addEventListener('change', () => { preview = null; });
  m.body.querySelector('#tpl').addEventListener('click', async () => {
    const sid = m.body.querySelector('#tpl-sup').value;
    const t = await get(`/api/articles/claude-template${sid ? '?supplier_id=' + sid : ''}`);
    const text = claudePrompt(t.markdown);
    const ta = m.body.querySelector('#tpl-text');
    ta.value = text; ta.hidden = false;
    try { await navigator.clipboard.writeText(text); toast(`Anfrage mit ${t.count} Artikeln kopiert – jetzt in Claude einfügen.`, 'success'); } catch { ta.select(); toast('Bitte den markierten Text kopieren (Strg+C).', 'info'); }
  });

  async function runPreview() {
    const text = m.body.querySelector('#paste').value;
    if (!text.trim()) { toast('Bitte zuerst eine Tabelle einfügen.', 'error'); return; }
    try {
      preview = await post('/api/articles/paste-import', { text, create_new: m.body.querySelector('#create').checked });
    } catch (e) { preview = null; pv.innerHTML = `<div class="error-box">${esc(e.message)}</div>`; return; }
    const ch = (c) => Object.entries(c || {}).map(([k, v]) => `${esc(FIELD_LABELS[k] || k)}: ${v.von === null || v.von === undefined ? '' : `${esc(fmtCell(v.von))} → `}<b>${esc(fmtCell(v.nach))}</b>`).join(' · ');
    const A = { create: ['st-green', 'neu'], update: ['st-blue', 'ändern'], unchanged: ['st-grey', 'unverändert'], error: ['st-red', 'Fehler'], skipped: ['st-grey', 'übersprungen'] };
    const c = preview.counts;
    pv.innerHTML = `<div class="hint">Erkannt als <b>${esc(preview.format)}</b> · ${c.create} neu · ${c.update} ändern · ${c.unchanged} unverändert${c.error ? ` · <span class="text-red">${c.error} mit Fehler (werden nicht übernommen)</span>` : ''}</div>
      <div class="chips mt">${preview.columns.map((col) => `<span class="pill ${col.field ? '' : 'muted'}" title="${col.field ? 'wird übernommen' : 'nicht erkannt – wird ignoriert'}">${esc(col.header)} → ${col.field ? esc(FIELD_LABELS[col.field]) : 'ignoriert'}</span>`).join('')}</div>
      <div class="table-wrap mt"><table class="table table-sm"><thead><tr><th>Zeile</th><th>Aktion</th><th>Artikel</th><th>Änderungen</th></tr></thead><tbody>
      ${preview.rows.map((r) => `<tr class="imp-row-${r.action}"><td>${r.line}</td><td><span class="badge ${A[r.action][0]}">${A[r.action][1]}</span></td><td><strong>${esc(r.name || '')}</strong><br><small class="muted">${esc(r.article_no || '')}</small></td>
        <td class="small">${r.error ? `<span class="text-red">${esc(r.error)}</span>` : ch(r.changes)}</td></tr>`).join('')}</tbody></table></div>
      ${preview.created_refs.length ? `<p class="small muted">Wird zusätzlich angelegt: ${esc(preview.created_refs.join(', '))}</p>` : ''}`;
    applyBtn.disabled = !(c.create + c.update);
  }
}
const fmtCell = (v) => (typeof v === 'number' ? String(v).replace('.', ',') : v === true ? 'ja' : v === false ? 'nein' : String(v ?? '–'));

const fmtNum = (n) => (n === null || n === undefined ? '' : String(n).replace('.', ','));

function resizeImage(file, max) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = reject;
    img.src = url;
  });
}
