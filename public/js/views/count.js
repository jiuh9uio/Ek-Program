// Geführte Bestandszählung (Inventur): Artikel für Artikel zählen → Nachkaufmenge automatisch auf die Einkaufsliste.
import { get, post } from '../api.js';
import { esc, fmtQty, fmtEur, fmtDateTime, fmtAgo, unitFor, parseNum, toast, confirmDialog, emptyState, download } from '../ui.js';
import { navigate } from '../app.js';
import { newListWizard } from './newlist.js';

export async function render(el, ctx) {
  if (ctx.params[0]) return renderSession(el, ctx, Number(ctx.params[0]));
  return renderHistory(el, ctx);
}

// ---------------- Historie der Zählungen ----------------
async function renderHistory(el, { can, setActions }) {
  const a = setActions(can('list.create') ? '<button class="btn btn-primary" id="nl">+ Neue Einkaufsliste</button>' : '');
  a.querySelector('#nl')?.addEventListener('click', newListWizard);
  const rows = await get('/api/counts');
  el.innerHTML = `<p class="muted">Jede Einkaufsliste mit Bestandszählung erzeugt einen Zählbeleg. Gezählte Mengen, Soll/Ist-Differenzen und Bestellvorschläge bleiben dokumentiert.</p>
    ${rows.length ? `<div class="table-wrap"><table class="table table-click"><thead><tr><th>Zählung</th><th>Status</th><th>Gestartet</th><th class="num">Gezählt</th><th class="num">Differenzen</th><th class="num">Auf Liste</th><th>Einkaufsliste</th></tr></thead>
    <tbody>${rows.map((r) => `<tr data-id="${r.id}"><td><strong>${esc(r.number)}</strong></td>
      <td>${r.status === 'open' ? '<span class="badge st-yellow">läuft</span>' : '<span class="badge st-green">abgeschlossen</span>'}</td>
      <td>${fmtDateTime(r.created_at)}<br><small class="muted">${esc(r.created_by_name || '')}</small></td>
      <td class="num">${r.counted}/${r.total}</td><td class="num">${r.differences || 0}</td><td class="num">${r.on_list || 0}</td>
      <td>${r.list_id ? `<a href="#/lists/${r.list_id}">${esc(r.list_number)}</a>` : '–'}</td></tr>`).join('')}</tbody></table></div>`
    : emptyState('Noch keine Bestandszählungen. Starte mit „Neue Einkaufsliste“.', '📋')}`;
  el.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', (e) => { if (!e.target.closest('a')) navigate(`/count/${tr.dataset.id}`); }));
}

// ---------------- Zählbildschirm ----------------
function suggest(i, counted) {
  // gleiche Regel wie der Server: Ist + bereits bestellt ≤ MIN → auffüllen bis MAX (Gebindeschritt/Mindestmenge)
  if (counted === null || !(i.max_stock > 0) || i.unavailable_since) return 0;
  const eff = counted + (i.on_order || 0);
  if (eff > i.min_stock + 1e-9) return 0;
  const step = i.order_step > 0 ? i.order_step : 1;
  let q = Math.ceil((i.max_stock - eff) / step - 1e-9) * step;
  if (q <= 0) return 0;
  if (i.min_order_qty > 0 && q < i.min_order_qty) q = Math.ceil(i.min_order_qty / step - 1e-9) * step;
  return Math.round(q * 1000) / 1000;
}

async function renderSession(el, { can, setTitle, setActions }, id) {
  let c = await get(`/api/counts/${id}`);
  let cur = null;           // aktueller Artikel (Zählposition)
  let entry = '';           // eingegebene Menge (Text)
  let orderOverride = null; // manuell angepasste Bestellmenge
  let showList = window.matchMedia('(min-width: 1100px)').matches;
  let summary = false;
  const coarse = window.matchMedia('(pointer: coarse)').matches;

  const firstOpen = (afterSeq = 0) => c.items.find((i) => i.state === 'open' && i.seq > afterSeq) || c.items.find((i) => i.state === 'open') || null;
  const select = (item) => {
    cur = item; orderOverride = null;
    entry = item && item.counted_qty !== null ? fmtQty(item.counted_qty) : '';
    summary = !item;
    draw();
  };

  function header() {
    const s = c.summary;
    const pct = Math.round(((s.counted + s.skipped) / Math.max(1, s.total)) * 100);
    setTitle(`Bestandszählung ${c.number}`);
    const acts = setActions(`${c.status === 'open' ? `<button class="btn" id="sum">Übersicht</button><button class="btn btn-primary" id="done">Zählung abschließen</button>` : ''}<button class="btn" id="csv">CSV</button>`);
    acts.querySelector('#sum')?.addEventListener('click', () => select(null));
    acts.querySelector('#done')?.addEventListener('click', complete);
    acts.querySelector('#csv').addEventListener('click', () => download(`/api/counts/${id}/export.csv`));
    return `<div class="count-head">
      <div class="count-progress"><div class="count-progress-bar" style="width:${pct}%"></div></div>
      <div class="count-stats"><span><b>${s.counted}</b>/${s.total} gezählt</span>${s.skipped ? `<span>${s.skipped} übersprungen</span>` : ''}
        <span>🛒 <b>${s.on_list}</b> auf <a href="#/lists/${c.list_id}">${esc(c.list_number || '')}</a> · ca. ${fmtEur(s.order_value)}</span>
        ${c.status !== 'open' ? '<span class="badge st-green">abgeschlossen</span>' : ''}
        <button class="btn btn-sm" id="toggle-list">${showList ? 'Zählliste ausblenden' : '☰ Zählliste'}</button></div></div>`;
  }

  function countList() {
    let loc = null;
    return `<aside class="count-list"><ol>${c.items.map((i) => {
      const head = i.location_name !== loc ? `<li class="cl-head">${esc((loc = i.location_name) || 'Ohne Lagerort')}</li>` : '';
      const icon = i.state === 'counted' ? '✓' : i.state === 'skipped' ? '⏭' : '○';
      return `${head}<li class="cl-row cl-${i.state} ${cur && cur.id === i.id ? 'cur' : ''}" data-jump="${i.id}"><span class="cl-ico">${icon}</span><span class="grow">${esc(i.name)}</span>
        <span class="cl-val">${i.state === 'counted' ? fmtQty(i.counted_qty) : ''}${i.order ? ` <b class="text-blue">+${fmtQty(i.order.qty)}</b>` : ''}</span></li>`;
    }).join('')}</ol></aside>`;
  }

  function itemCard(i) {
    const unit = (q) => unitFor(q, i.unit_name, i.unit_plural);
    const counted = parseNum(entry);
    const valid = counted !== null && !Number.isNaN(counted) && counted >= 0;
    const auto = valid ? suggest(i, counted) : (i.counted_qty !== null ? (i.order ? i.order.qty : 0) : 0);
    const order = orderOverride !== null ? orderOverride : (i.order && (i.order.source !== 'count' || !valid) ? i.order.qty : auto);
    const idx = c.items.indexOf(i) + 1;
    const ro = c.status !== 'open';
    return `<section class="count-card">
      <div class="count-where">📍 ${esc(i.location_name || 'Ohne Lagerort')} <span class="muted">· Artikel ${idx} von ${c.items.length}</span></div>
      <div class="count-art">
        ${i.has_image ? `<img src="/api/articles/${i.article_id}/image" alt="">` : ''}
        <div><h2>${esc(i.name)}</h2><p class="muted">${esc([i.pack_size, i.article_no, i.supplier_name].filter(Boolean).join(' · '))}</p></div>
      </div>
      <div class="mcard-meta">
        <span class="minmax"><b>MIN</b> ${fmtQty(i.min_stock)}</span><span class="minmax"><b>MAX</b> ${fmtQty(i.max_stock)}</span>
        <span class="minmax"><b>LETZTER BESTAND</b> ${i.expected_qty === null ? 'unbekannt' : fmtQty(i.expected_qty)}</span>
        ${i.on_order > 0 ? `<span class="pill pill-blue">bereits bestellt: ${fmtQty(i.on_order)} (${esc(i.open_lists.map((l) => l.number).join(', '))})</span>` : ''}
        ${i.unavailable_since ? '<span class="pill pill-dark">als nicht verfügbar markiert</span>' : ''}
      </div>
      <div class="count-body"><div class="count-entry">
      <label class="count-q" for="cnt">Wie viele <b>${esc(i.unit_plural || 'Einheiten')}</b> sind noch da?</label>
      <div class="count-input">
        <button data-k="minus" ${ro ? 'disabled' : ''} aria-label="minus">−</button>
        <input id="cnt" value="${esc(entry)}" placeholder="?" autocomplete="off" ${coarse ? 'inputmode="none"' : 'inputmode="decimal"'} ${ro ? 'disabled' : ''}>
        <button data-k="plus" ${ro ? 'disabled' : ''} aria-label="plus">+</button>
      </div>
      ${ro ? '' : `<div class="keypad">${['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', '⌫'].map((k) => `<button data-k="${k}">${k}</button>`).join('')}</div>
      <div class="btn-row center-row"><button class="btn" data-k="zero">Nichts mehr da (0)</button>${i.expected_qty !== null ? `<button class="btn" data-k="same">Unverändert (${fmtQty(i.expected_qty)})</button>` : ''}${i.max_stock > 0 ? `<button class="btn" data-k="full">Voll (${fmtQty(i.max_stock)})</button>` : ''}</div>`}
      </div><div class="count-side">
      <div class="count-result ${valid || i.counted_qty !== null ? (order > 0 ? 'need' : 'fine') : ''}">
        ${!valid && i.counted_qty === null ? '<span class="muted">Menge eingeben – das System berechnet die Nachkaufmenge.</span>'
    : `<div class="cr-text">${order > 0 ? `🛒 Nachkaufen: <b>${fmtQty(order)} ${esc(unit(order))}</b> <small class="muted">${orderOverride !== null || (i.order && i.order.source === 'manual') ? '(manuell angepasst)' : `(auffüllen bis MAX ${fmtQty(i.max_stock)})`}</small>`
      : `✓ Genug da – kein Einkauf nötig${i.on_order > 0 ? ' (Nachschub ist bereits bestellt)' : ''}${!(i.max_stock > 0) ? ' <small class="muted">(kein MAX hinterlegt)</small>' : ''}`}</div>
          ${can('list.create') && !ro ? `<div class="stepper stepper-order"><span class="stepper-label">Menge</span><button data-k="o-">−</button><input id="ord" inputmode="decimal" value="${order ? fmtQty(order) : ''}" placeholder="0"><button data-k="o+">+</button><span class="stepper-unit">${esc(unit(order || 2))}</span></div>` : ''}`}
      </div>
      ${ro ? '' : `<div class="count-nav">
        <button class="btn btn-lg" data-k="back">← Zurück</button>
        <button class="btn btn-lg" data-k="skip">Überspringen</button>
        <button class="btn btn-primary btn-lg grow" data-k="next" ${valid ? '' : 'disabled'}>Speichern &amp; weiter →</button>
      </div>`}
      </div></div>
    </section>`;
  }

  function summaryView() {
    const s = c.summary;
    const ordered = c.items.filter((i) => i.order);
    const diffs = c.items.filter((i) => i.difference !== null && Math.abs(i.difference) > 1e-9);
    const rest = c.items.filter((i) => i.state !== 'counted');
    return `<section class="card">
      <h2>${c.status === 'open' ? (s.open ? 'Zwischenstand' : 'Alle Artikel gezählt 🎉') : 'Zählung abgeschlossen'}</h2>
      <div class="kpis mt"><div><span>Gezählt</span><strong>${s.counted}/${s.total}</strong></div><div><span>Übersprungen</span><strong>${s.skipped}</strong></div>
        <div><span>Offen</span><strong>${s.open}</strong></div><div><span>Auf der Einkaufsliste</span><strong>${s.on_list}</strong></div><div><span>Geschätzt</span><strong>${fmtEur(s.order_value)}</strong></div></div>
      <div class="btn-row mt">
        <a class="btn btn-primary btn-lg" href="#/lists/${c.list_id}">🛒 Einkaufsliste ${esc(c.list_number || '')} öffnen</a>
        ${c.status === 'open' && rest.length ? '<button class="btn btn-lg" id="cont">Offene/übersprungene weiterzählen</button>' : ''}
        ${c.status === 'open' ? '<button class="btn btn-lg" id="fin">Zählung abschließen</button>' : ''}
      </div>
      ${c.status === 'open' && rest.length ? '<p class="muted small">Nicht gezählte Artikel bleiben „nicht kontrolliert“ – sie werden nicht als Bestand 0 gewertet.</p>' : ''}
    </section>
    <div class="grid-2 mt">
      <section class="card"><h2>Bestellvorschlag (${ordered.length})</h2>${ordered.length ? `<table class="table table-sm"><thead><tr><th>Artikel</th><th class="num">Gezählt</th><th class="num">Nachkaufen</th></tr></thead>
        <tbody>${ordered.map((i) => `<tr data-jump="${i.id}"><td>${esc(i.name)}</td><td class="num">${i.counted_qty === null ? '–' : fmtQty(i.counted_qty)}</td><td class="num"><b>${fmtQty(i.order.qty)}</b> ${esc(unitFor(i.order.qty, i.unit_name, i.unit_plural))}</td></tr>`).join('')}</tbody></table>` : emptyState('Nichts nachzukaufen.', '👍')}</section>
      <section class="card"><h2>Soll/Ist-Differenzen (${diffs.length})</h2>${diffs.length ? `<table class="table table-sm"><thead><tr><th>Artikel</th><th class="num">Soll</th><th class="num">Ist</th><th class="num">Differenz</th></tr></thead>
        <tbody>${diffs.map((i) => `<tr data-jump="${i.id}"><td>${esc(i.name)}</td><td class="num">${fmtQty(i.expected_qty)}</td><td class="num">${fmtQty(i.counted_qty)}</td><td class="num ${i.difference < 0 ? 'text-red' : 'text-green'}">${i.difference > 0 ? '+' : ''}${fmtQty(i.difference)}</td></tr>`).join('')}</tbody></table>
        <p class="muted small">Soll = letzter bekannter Bestand beim Start der Zählung. Verbrauch seit der letzten Zählung erscheint als negative Differenz.</p>` : emptyState('Keine Differenzen zum letzten bekannten Bestand.', '✅')}</section>
    </div>`;
  }

  function draw() {
    if (!cur && !summary) { const f = firstOpen(); if (f && c.status === 'open') { cur = f; entry = ''; } else summary = true; }
    el.innerHTML = `${header()}<div class="count-layout ${showList ? 'with-list' : ''}"><div class="count-main">${summary || !cur ? summaryView() : itemCard(cur)}</div>${showList ? countList() : ''}</div>`;
    bind();
    const inp = el.querySelector('#cnt');
    if (inp && !coarse) { inp.focus(); inp.select(); }
    el.querySelector('.cl-row.cur')?.scrollIntoView({ block: 'nearest' });
  }

  function refreshResult() {
    // nur Ergebnisbereich + Weiter-Button aktualisieren (Eingabefeld behält Fokus)
    const tmp = document.createElement('div');
    tmp.innerHTML = itemCard(cur);
    el.querySelector('.count-result').replaceWith(tmp.querySelector('.count-result'));
    const next = el.querySelector('[data-k="next"]');
    const v = parseNum(entry);
    if (next) next.disabled = !(v !== null && !Number.isNaN(v) && v >= 0);
    bindResult();
  }

  async function save(body, advance) {
    try {
      c = await post(`/api/counts/${id}/items/${cur.id}`, body, { quiet: true });
      const updated = c.items.find((x) => x.id === cur.id);
      if (advance) select(firstOpen(updated.seq));
      else { cur = updated; draw(); }
    } catch (e) { toast(e.message, 'error'); }
  }

  async function complete() {
    const s = c.summary;
    if (!(await confirmDialog(`Zählung abschließen?${s.open + s.skipped ? ` ${s.open + s.skipped} Artikel wurden nicht gezählt und bleiben „nicht kontrolliert“.` : ''} Die Einkaufsliste ${c.list_number} bleibt als Entwurf zum Drucken/Bestellen erhalten.`, { ok: 'Abschließen' }))) return;
    try { c = await post(`/api/counts/${id}/complete`); toast('Zählung abgeschlossen.', 'success'); select(null); } catch (e) { toast(e.message, 'error'); }
  }

  function bindResult() {
    const ord = el.querySelector('#ord');
    if (!ord) return;
    ord.addEventListener('input', () => { const v = parseNum(ord.value); if (v !== null && !Number.isNaN(v) && v >= 0) orderOverride = v; else if (ord.value.trim() === '') orderOverride = 0; });
    ord.addEventListener('change', () => { if (cur.state === 'counted' && orderOverride !== null && parseNum(entry) === cur.counted_qty) save({ order_qty: orderOverride }, false); });
  }

  function bind() {
    el.querySelector('#toggle-list')?.addEventListener('click', () => { showList = !showList; draw(); });
    el.querySelectorAll('[data-jump]').forEach((r) => r.addEventListener('click', () => select(c.items.find((x) => x.id === Number(r.dataset.jump)))));
    el.querySelector('#cont')?.addEventListener('click', () => { const r = c.items.find((i) => i.state !== 'counted'); select(r); });
    el.querySelector('#fin')?.addEventListener('click', complete);
    const inp = el.querySelector('#cnt');
    if (inp) {
      inp.addEventListener('input', () => { entry = inp.value; orderOverride = null; refreshResult(); });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); el.querySelector('[data-k="next"]')?.click(); } });
    }
    bindResult();
    el.querySelector('.count-card')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-k]');
      if (!b) return;
      const k = b.dataset.k;
      const setEntry = (v) => { entry = v; orderOverride = null; if (inp) inp.value = v; refreshResult(); };
      const cur0 = parseNum(entry);
      const step = cur.order_step > 0 ? cur.order_step : 1;
      if (/^[0-9]$/.test(k)) setEntry(entry + k);
      else if (k === ',') { if (!entry.includes(',')) setEntry((entry || '0') + ','); }
      else if (k === '⌫') setEntry(entry.slice(0, -1));
      else if (k === 'plus') setEntry(fmtQty((Number.isNaN(cur0) || cur0 === null ? 0 : cur0) + 1));
      else if (k === 'minus') setEntry(fmtQty(Math.max(0, (Number.isNaN(cur0) || cur0 === null ? 1 : cur0) - 1)));
      else if (k === 'zero') setEntry('0');
      else if (k === 'same') setEntry(fmtQty(cur.expected_qty));
      else if (k === 'full') setEntry(fmtQty(cur.max_stock));
      else if (k === 'o-' || k === 'o+') {
        const o = el.querySelector('#ord');
        const v = parseNum(o.value) || 0;
        orderOverride = Math.max(0, Math.round((v + (k === 'o+' ? step : -step)) * 1000) / 1000);
        refreshResult();
        if (cur.state === 'counted' && parseNum(entry) === cur.counted_qty) save({ order_qty: orderOverride }, false);
      } else if (k === 'skip') save({ skip: true }, true);
      else if (k === 'back') {
        const i = c.items.indexOf(cur);
        if (i > 0) select(c.items[i - 1]);
      } else if (k === 'next') {
        const v = parseNum(entry);
        if (v === null || Number.isNaN(v) || v < 0) return;
        const body = { counted_qty: v };
        if (orderOverride !== null) body.order_qty = orderOverride;
        save(body, true);
      }
    });
  }

  draw();
}
