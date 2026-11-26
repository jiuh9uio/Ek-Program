// Schneller Einkaufsmodus: Schnellauswahl & Bestandskontrolle (touchoptimiert, automatische Speicherung).
import { get, post } from '../api.js';
import { sound, haptic, pop } from '../reward.js';
import { pushScanHandler } from '../scanner.js';
import { resolveCode } from './scanhelp.js';
import { orderText, esc, fmtQty, fmtAgo, unitFor, parseNum, statusBadge, toast, debounce, matches, promptDialog, emptyState } from '../ui.js';
import { navigate } from '../app.js';

const LS_KEY = 'ek.mode.prefs';
const loadPrefs = () => { try { return { mode: 'count', group: 'location', filter: 'all', autoAdd: true, ...JSON.parse(localStorage.getItem(LS_KEY) || '{}') }; } catch { return { mode: 'count', group: 'location', filter: 'all', autoAdd: true }; } };
const savePrefs = (p) => { try { localStorage.setItem(LS_KEY, JSON.stringify(p)); } catch { /* egal */ } };

export async function render(el, { can, setActions }) {
  const prefs = loadPrefs();
  if (!can('stock.count')) prefs.mode = 'quick';
  let data = await get('/api/mode');
  let search = '';
  const byId = new Map(data.articles.map((a) => [a.id, a]));
  const seq = new Map();          // Änderungszähler je Artikel (veraltete Antworten ignorieren)
  const retryQueue = new Map();   // nicht gespeicherte Änderungen (Offline)
  let retryTimer = null;

  setActions(`<span class="save-state" id="save-state" title="Speicherstatus">✓ gespeichert</span>`);

  el.innerHTML = `
    <div class="mode-toolbar">
      <div class="seg" role="tablist" aria-label="Arbeitsweise">
        <button data-mode="quick" class="${prefs.mode === 'quick' ? 'on' : ''}">Schnellauswahl</button>
        ${can('stock.count') ? `<button data-mode="count" class="${prefs.mode === 'count' ? 'on' : ''}">Bestandskontrolle</button>` : ''}
      </div>
      <input type="search" id="mode-search" class="search" placeholder="Artikel suchen …" aria-label="Suche">
      <div class="mode-filters">
        <label class="sel-inline">Sortierung
          <select id="mode-group">
            <option value="location">nach Lagerort</option><option value="category">nach Kategorie</option><option value="supplier">nach Lieferant</option>
          </select>
        </label>
        <div class="chips" id="mode-filter">
          ${[['all', 'Alle'], ['need', 'Bedarf'], ['unchecked', 'Nicht kontrolliert'], ['onlist', 'Auf der Liste']].map(([k, l]) => `<button data-filter="${k}" class="chip ${prefs.filter === k ? 'on' : ''}">${l}</button>`).join('')}
        </div>
        ${can('list.create') && can('stock.count') ? `<label class="switch" title="Empfohlene Bestellmenge automatisch in die Liste übernehmen"><input type="checkbox" id="auto-add" ${prefs.autoAdd ? 'checked' : ''}><span>Empfehlung automatisch übernehmen</span></label>` : ''}
      </div>
    </div>
    <div class="draft-bar" id="draft-bar"></div>
    <div id="mode-list" class="mode-list"></div>`;

  el.querySelector('#mode-group').value = prefs.group;
  const listEl = el.querySelector('#mode-list');
  const saveState = document.getElementById('save-state');
  const setSave = (s) => {
    if (!saveState) return;
    saveState.className = `save-state ${s}`;
    saveState.textContent = s === 'saving' ? '… speichert' : s === 'offline' ? '⚠ nicht gespeichert – erneuter Versuch' : '✓ gespeichert';
  };

  const renderDraftBar = () => {
    const d = data.draft;
    const n = data.articles.filter((a) => a.item).length;
    const value = data.articles.reduce((s, a) => s + (a.item ? a.item.qty * a.price_net : 0), 0);
    el.querySelector('#draft-bar').innerHTML = d || n
      ? `<div><strong>Einkaufsliste ${esc(d ? d.number : '')}</strong> · ${n} Position${n === 1 ? '' : 'en'} · ca. ${value.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</div>
         <button class="btn btn-primary" id="open-draft" ${d ? '' : 'disabled'}>Zur Einkaufsliste →</button>`
      : '<div class="muted">Noch keine Artikel ausgewählt. Gewählte Artikel landen automatisch in der aktuellen Einkaufsliste.</div>';
    el.querySelector('#open-draft')?.addEventListener('click', () => navigate(`/lists/${d.id}`));
  };

  const groupKey = (a) => prefs.group === 'location' ? [a.location_sort ?? 9999, a.location_name || 'Ohne Lagerort']
    : prefs.group === 'category' ? [a.category_sort ?? 9999, a.category_name || 'Ohne Kategorie']
      : [0, a.supplier_name || 'Ohne Lieferant'];

  const visible = (a) => {
    if (search && !matches(`${(a.codes || []).join(' ')} ${a.name} ${a.article_no} ${a.manufacturer || ''} ${a.supplier_name || ''} ${a.location_name || ''} ${a.category_name || ''}`, search)) return false;
    if (prefs.filter === 'need') return a.recommended > 0 || a.item || ['below', 'at_min'].includes(a.status);
    if (prefs.filter === 'unchecked') return !a.stock_fresh && a.check_result !== 'ok' || a.current_stock === null && a.check_result !== 'ok';
    if (prefs.filter === 'onlist') return !!a.item;
    return true;
  };

  function cardHtml(a) {
    const unit = (q) => unitFor(q, a.unit_name, a.unit_plural);
    const qtyVal = a.item ? a.item.qty : (a.recommended || '');
    const checked = !!a.item;
    const showStock = prefs.mode === 'count';
    const onOrderTxt = a.on_order > 0 ? `<span class="pill pill-blue" title="${esc(a.open_lists.map((l) => `${l.number}: ${fmtQty(l.open)}`).join(', '))}">bereits bestellt: ${fmtQty(a.on_order)}</span>` : '';
    const unavailable = a.unavailable_since ? '<span class="pill pill-dark">nicht verfügbar</span>' : '';
    const checkedInfo = a.check_result === 'ok' && a.stock_fresh ? `ausreichend · ${fmtAgo(a.stock_checked_at)}` : a.stock_checked_at ? `kontrolliert ${fmtAgo(a.stock_checked_at)}${a.stock_checked_by_name ? ' (' + esc(a.stock_checked_by_name) + ')' : ''}` : 'noch nie kontrolliert';
    const note = a.item ? a.item.note : a.check_note;
    return `
    <article class="mcard st-border-${a.status} ${checked ? 'is-on' : ''} ${a.unavailable_since ? 'is-unavail' : ''}" data-id="${a.id}">
      <button class="bigcheck ${checked ? 'on' : ''}" data-act="toggle" aria-pressed="${checked}" aria-label="${esc(a.name)} in Einkaufsliste" ${can('list.create') ? '' : 'disabled'}>${checked ? '✓' : ''}</button>
      <div class="mcard-main">
        <div class="mcard-head">
          ${a.has_image ? `<img class="thumb" loading="lazy" src="/api/articles/${a.id}/image" alt="">` : ''}
          <div class="mcard-title"><strong>${esc(a.name)}</strong><small>${esc([a.pack_size, a.article_no, prefs.group !== 'supplier' ? a.supplier_name : a.location_name].filter(Boolean).join(' · '))}</small></div>
          ${statusBadge(a.status)}
        </div>
        <div class="mcard-meta">
          <span class="minmax"><b>MIN</b> ${fmtQty(a.min_stock)}</span><span class="minmax"><b>MAX</b> ${fmtQty(a.max_stock)}</span>
          ${prefs.mode !== 'count' ? `<span class="minmax"><b>IST</b> ${a.current_stock === null ? '–' : fmtQty(a.current_stock)}</span>` : ''}
          ${onOrderTxt}${unavailable}<span class="muted small">${checkedInfo}</span>
        </div>
        <div class="mcard-inputs">
          ${showStock ? `
          <div class="stepper" aria-label="Ist-Bestand">
            <span class="stepper-label">Ist-Bestand</span>
            <button data-act="stock-" aria-label="Bestand minus">−</button>
            <input data-field="stock" inputmode="decimal" value="${a.current_stock === null ? '' : fmtQty(a.current_stock)}" placeholder="?" aria-label="Ist-Bestand ${esc(a.name)}">
            <button data-act="stock+" aria-label="Bestand plus">+</button>
            <span class="stepper-unit">${esc(unit(a.current_stock ?? 2))}</span>
          </div>` : ''}
          ${can('list.create') ? `
          <div class="stepper stepper-order" aria-label="Bestellmenge">
            <span class="stepper-label">Bestellen</span>
            <button data-act="qty-" aria-label="Bestellmenge minus">−</button>
            <input data-field="qty" inputmode="decimal" value="${qtyVal === '' ? '' : fmtQty(qtyVal)}" placeholder="0" aria-label="Bestellmenge ${esc(a.name)}">
            <button data-act="qty+" aria-label="Bestellmenge plus">+</button>
            <span class="stepper-unit">${esc(unit(qtyVal || 2))}</span>
          </div>
          <div class="rec">${a.recommended > 0 ? `Empfehlung: <b>${fmtQty(a.recommended)}</b> ${esc(unit(a.recommended))}${orderText(a.recommended, a).base ? ` <span class="text-blue">(${esc(orderText(a.recommended, a).main)})</span>` : ''}` : a.current_stock === null && a.check_result !== 'ok' ? '<span class="muted">Empfehlung nach Bestandseingabe</span>' : '<span class="muted">kein Bedarf</span>'}${a.allowed_max !== null && !can('list.exceed_max') ? ` <span class="muted small">(max. ${fmtQty(a.allowed_max)})</span>` : ''}</div>` : ''}
        </div>
        <div class="mcard-actions">
          ${can('stock.count') ? `<button class="btn btn-ok" data-act="ok">✓ Bestand ausreichend</button>
          <button class="btn ${a.unavailable_since ? 'btn-dark' : ''}" data-act="unavail">${a.unavailable_since ? '↺ Wieder verfügbar' : '⊘ Nicht verfügbar'}</button>` : ''}
          <button class="btn btn-ghost" data-act="note">✎ ${note ? 'Bemerkung ändern' : 'Bemerkung'}</button>
          ${note ? `<span class="note-text">„${esc(note)}“</span>` : ''}
        </div>
      </div>
    </article>`;
  }

  function renderList() {
    const arts = data.articles.filter(visible);
    if (!arts.length) { listEl.innerHTML = emptyState(data.articles.length ? 'Keine Artikel für diesen Filter.' : 'Noch keine Artikel angelegt. Ein Administrator kann unter „Artikel“ Artikel anlegen.'); renderDraftBar(); return; }
    const groups = new Map();
    for (const a of arts) {
      const [s, n] = groupKey(a);
      if (!groups.has(n)) groups.set(n, { sort: s, name: n, items: [] });
      groups.get(n).items.push(a);
    }
    const today = new Date().toDateString();
    listEl.innerHTML = [...groups.values()].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'de')).map((g) => {
      g.items.sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name, 'de'));
      const done = g.items.filter((a) => a.stock_checked_at && new Date(a.stock_checked_at).toDateString() === today).length;
      return `<section class="mgroup"><h3 class="mgroup-head"><span>${esc(g.name)}</span><small>${prefs.mode === 'count' ? `${done}/${g.items.length} heute kontrolliert` : `${g.items.filter((a) => a.item).length} gewählt`}</small></h3>
        ${g.items.map(cardHtml).join('')}</section>`;
    }).join('');
    renderDraftBar();
  }

  function replaceCard(a) {
    const old = listEl.querySelector(`.mcard[data-id="${a.id}"]`);
    if (!old) return renderDraftBar();
    const focused = document.activeElement && old.contains(document.activeElement) ? document.activeElement.dataset.field : null;
    const tmp = document.createElement('div');
    tmp.innerHTML = cardHtml(a);
    const neu = tmp.firstElementChild;
    old.replaceWith(neu);
    if (focused) { const f = neu.querySelector(`[data-field="${focused}"]`); if (f) { f.focus(); f.setSelectionRange?.(f.value.length, f.value.length); } }
    renderDraftBar();
  }

  function applyResult(r, s, id) {
    if (r.draft !== undefined) data.draft = r.draft ? { ...(data.draft || {}), ...r.draft } : data.draft;
    if (r.article) {
      byId.set(r.article.id, r.article);
      data.articles = data.articles.map((x) => (x.id === r.article.id ? r.article : x));
      if (seq.get(id) === s) replaceCard(r.article);
    }
    if (r.info && r.info.other_open && r.info.other_open.length) {
      toast(`Achtung: Artikel steht bereits auf ${r.info.other_open.map((l) => l.number).join(', ')} – bitte Doppelbestellung prüfen.`, 'warn');
    }
  }

  // Speichern mit Wiederholung bei Verbindungsproblemen
  async function send(key, url, body, id) {
    const s = (seq.get(id) || 0) + 1;
    seq.set(id, s);
    setSave('saving');
    try {
      const r = await post(url, body, { quiet: true });
      retryQueue.delete(key);
      applyResult(r, s, id);
      setSave(retryQueue.size ? 'offline' : 'saved');
      return r;
    } catch (e) {
      if (e.status === 0) {
        retryQueue.set(key, { url, body, id });
        setSave('offline');
        scheduleRetry();
      } else {
        toast(e.message, 'error');
        setSave('saved');
        // Serverstand wiederherstellen
        const prev = byId.get(id);
        if (prev) replaceCard(prev);
      }
      return null;
    }
  }
  function scheduleRetry() {
    if (retryTimer) return;
    retryTimer = setTimeout(async () => {
      retryTimer = null;
      for (const [key, j] of [...retryQueue]) { await send(key, j.url, j.body, j.id); }
    }, 5000);
  }

  const stockSavers = new Map();
  const qtySavers = new Map();
  const saver = (map, id, fn) => { if (!map.has(id)) map.set(id, debounce(fn, 700)); return map.get(id); };

  const saveStock = (id, value) => saver(stockSavers, id, (v) => send(`stock-${id}`, '/api/mode/stock', { article_id: id, stock: v, auto_add: prefs.autoAdd }, id))(value);
  const saveQty = (id, value) => saver(qtySavers, id, (v) => send(`qty-${id}`, '/api/mode/item', { article_id: id, qty: v }, id))(value);

  function localUpdate(a, patch) {
    Object.assign(a, patch);
    const card = listEl.querySelector(`.mcard[data-id="${a.id}"]`);
    return card;
  }

  listEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const card = btn.closest('.mcard');
    const id = Number(card.dataset.id);
    const a = data.articles.find((x) => x.id === id);
    const act = btn.dataset.act;
    const step = a.step > 0 ? a.step : (a.order_step > 0 ? a.order_step : 1);

    if (act === 'toggle') {
      if (!a.item) { sound.pop(); haptic(12); } else sound.soft();
      if (a.item) { a.item = null; replaceCard(a); qtySavers.get(id)?.cancel(); send(`qty-${id}`, '/api/mode/item', { article_id: id, qty: null }, id); return; }
      const inp = card.querySelector('[data-field="qty"]');
      let q = parseNum(inp?.value);
      if (!(q > 0)) q = a.recommended > 0 ? a.recommended : Math.max(step, a.min_order_qty || 0);
      a.item = { qty: q, note: null, source: 'quick' };
      setTimeout(() => pop(listEl.querySelector(`.mcard[data-id="${id}"] .bigcheck`)), 20);
      replaceCard(a);
      qtySavers.get(id)?.cancel();
      send(`qty-${id}`, '/api/mode/item', { article_id: id, qty: q }, id);
    } else if (act === 'stock-' || act === 'stock+') {
      const inp = card.querySelector('[data-field="stock"]');
      let cur = parseNum(inp.value);
      if (cur === null || Number.isNaN(cur)) cur = act === 'stock+' ? 0 : 1; // erster Tipp setzt bewusst einen Wert
      const next = Math.max(0, Math.round((cur + (act === 'stock+' ? 1 : -1)) * 1000) / 1000);
      inp.value = fmtQty(next);
      saveStock(id, next);
    } else if (act === 'qty-' || act === 'qty+') {
      const inp = card.querySelector('[data-field="qty"]');
      let cur = parseNum(inp.value);
      if (cur === null || Number.isNaN(cur)) cur = 0;
      let next = act === 'qty+' ? cur + step : cur - step;
      if (act === 'qty+' && a.min_order_qty > 0 && next < a.min_order_qty) next = a.min_order_qty;
      next = Math.max(0, Math.round(next * 1000) / 1000);
      inp.value = next ? fmtQty(next) : '';
      localUpdate(a, {});
      card.querySelector('.bigcheck').classList.toggle('on', next > 0);
      card.querySelector('.bigcheck').textContent = next > 0 ? '✓' : '';
      card.classList.toggle('is-on', next > 0);
      saveQty(id, next || null);
    } else if (act === 'ok') {
      sound.success(); haptic(15);
      stockSavers.get(id)?.cancel(); qtySavers.get(id)?.cancel();
      await send(`ok-${id}`, '/api/mode/ok', { article_id: id }, id);
    } else if (act === 'unavail') {
      if (a.unavailable_since) await send(`un-${id}`, '/api/mode/unavailable', { article_id: id, unavailable: false }, id);
      else {
        const note = await promptDialog(`„${a.name}“ als nicht verfügbar markieren. Optionaler Grund:`, { title: 'Nicht verfügbar', value: a.check_note || '', ok: 'Markieren' });
        if (note === null) return;
        await send(`un-${id}`, '/api/mode/unavailable', { article_id: id, unavailable: true, note }, id);
      }
    } else if (act === 'note') {
      const note = await promptDialog(a.item ? 'Bemerkung zur Bestellposition:' : 'Bemerkung zum Artikel (Kontrolle):', { title: a.name, value: (a.item ? a.item.note : a.check_note) || '', ok: 'Speichern' });
      if (note === null) return;
      await send(`note-${id}`, '/api/mode/note', { article_id: id, note }, id);
    }
  });

  listEl.addEventListener('input', (e) => {
    const inp = e.target.closest('[data-field]');
    if (!inp) return;
    const id = Number(inp.closest('.mcard').dataset.id);
    const v = parseNum(inp.value);
    if (Number.isNaN(v) || (v !== null && v < 0)) { inp.classList.add('invalid'); return; }
    inp.classList.remove('invalid');
    if (inp.dataset.field === 'stock') saveStock(id, v);
    else {
      const card = inp.closest('.mcard');
      card.querySelector('.bigcheck').classList.toggle('on', v > 0);
      card.querySelector('.bigcheck').textContent = v > 0 ? '✓' : '';
      saveQty(id, v > 0 ? v : null);
    }
  });
  listEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('[data-field]')) {
      e.preventDefault();
      // Enter springt zum nächsten Eingabefeld gleicher Art (schnelles Durchzählen)
      const field = e.target.dataset.field;
      const all = [...listEl.querySelectorAll(`[data-field="${field}"]`)];
      const i = all.indexOf(e.target);
      (field === 'stock' ? stockSavers : qtySavers).get(Number(e.target.closest('.mcard').dataset.id))?.flush(parseNum(e.target.value));
      if (all[i + 1]) { all[i + 1].focus(); all[i + 1].select(); all[i + 1].scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    }
  });
  listEl.addEventListener('focusin', (e) => { if (e.target.matches('[data-field]')) e.target.select(); });

  el.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    prefs.mode = b.dataset.mode; savePrefs(prefs);
    el.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('on', x === b));
    renderList();
  }));
  el.querySelector('#mode-group').addEventListener('change', (e) => { prefs.group = e.target.value; savePrefs(prefs); renderList(); });
  el.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => {
    prefs.filter = b.dataset.filter; savePrefs(prefs);
    el.querySelectorAll('[data-filter]').forEach((x) => x.classList.toggle('on', x === b));
    renderList();
  }));
  el.querySelector('#auto-add')?.addEventListener('change', (e) => { prefs.autoAdd = e.target.checked; savePrefs(prefs); });
  el.querySelector('#mode-search').addEventListener('input', debounce((e) => { search = e.target.value; renderList(); }, 150));

  renderList();

  // Regelmäßig aktualisieren (mehrere Geräte gleichzeitig), nur wenn nichts aussteht
  const refresh = setInterval(async () => {
    const busy = [...stockSavers.values(), ...qtySavers.values()].some((d) => d.pending());
    if (document.hidden || retryQueue.size || busy || document.activeElement?.dataset?.field) return;
    try {
      const fresh = await get('/api/mode', { quiet: true });
      data = fresh;
      data.articles.forEach((a) => byId.set(a.id, a));
      const y = window.scrollY;
      renderList();
      window.scrollTo(0, y);
    } catch { /* offline – später erneut */ }
  }, 60000);

  // Scanner: zum gescannten Artikel springen und Eingabefeld fokussieren
  const popScan = pushScanHandler(async (code) => {
    const art = await resolveCode(code);
    if (!art) return;
    const a = data.articles.find((x) => x.id === art.id);
    if (!a) { toast(`„${art.name}“ ist inaktiv oder archiviert.`, 'warn'); return; }
    if (!visible(a)) {
      search = ''; el.querySelector('#mode-search').value = '';
      prefs.filter = 'all'; el.querySelectorAll('[data-filter]').forEach((x) => x.classList.toggle('on', x.dataset.filter === 'all'));
      renderList();
    }
    const card = listEl.querySelector(`.mcard[data-id="${a.id}"]`);
    if (!card) return;
    card.scrollIntoView({ block: 'center', behavior: 'smooth' });
    card.classList.remove('scan-hit'); void card.offsetWidth; card.classList.add('scan-hit');
    sound.pop(); haptic(20);
    const f = card.querySelector(prefs.mode === 'count' ? '[data-field="stock"]' : '[data-field="qty"]');
    if (f) setTimeout(() => { f.focus(); f.select(); }, 350);
  });

  return {
    destroy() {
      popScan();
      clearInterval(refresh);
      // ausstehende Eingaben sofort speichern
      [...stockSavers.values(), ...qtySavers.values()].forEach((d) => d.flush());
      if (retryTimer) clearTimeout(retryTimer);
    },
  };
}
