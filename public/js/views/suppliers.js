// Lieferantenverwaltung inkl. Artikelzuordnung.
import { get, post, put, del } from '../api.js';
import { esc, fmtEur, toast, modal, confirmDialog, matches, parseNum, emptyState, WEEKDAYS, fmtDays, debounce } from '../ui.js';

export async function render(el, { can, setActions }) {
  let sups = [];
  let q = '';
  const a = setActions(can('suppliers.manage') ? '<button class="btn btn-primary" id="new">+ Neuer Lieferant</button>' : '');
  a.querySelector('#new')?.addEventListener('click', () => edit(null));
  el.innerHTML = '<div class="toolbar"><input type="search" class="search" id="q" placeholder="Lieferant suchen …"></div><div id="tbl"></div>';
  el.querySelector('#q').addEventListener('input', debounce((e) => { q = e.target.value; draw(); }, 150));
  const tbl = el.querySelector('#tbl');

  async function load() { sups = await get('/api/suppliers'); draw(); }
  function draw() {
    const rows = sups.filter((s) => !q || matches(`${s.name} ${s.customer_no || ''} ${s.contact_person || ''} ${s.email || ''}`, q));
    if (!rows.length) { tbl.innerHTML = emptyState('Keine Lieferanten vorhanden.'); return; }
    tbl.innerHTML = `<div class="table-wrap"><table class="table table-click"><thead><tr><th>Firma</th><th>Kundennr.</th><th>Ansprechpartner</th><th>Kontakt</th><th>Bestelltage</th><th>Liefertage</th><th class="num">Mindestbestellwert</th><th class="num">Versand</th><th class="num">Artikel</th></tr></thead>
      <tbody>${rows.map((s) => `<tr data-id="${s.id}" class="${s.active ? '' : 'row-muted'}"><td><strong>${esc(s.name)}</strong>${s.active ? '' : ' <small>(inaktiv)</small>'}</td><td>${esc(s.customer_no || '–')}</td>
        <td>${esc(s.contact_person || '–')}</td><td>${s.phone ? `<a href="tel:${esc(s.phone)}">${esc(s.phone)}</a>` : ''}${s.email ? `<br><a href="mailto:${esc(s.email)}">${esc(s.email)}</a>` : ''}</td>
        <td>${fmtDays(s.order_days)}</td><td>${fmtDays(s.delivery_days)}</td><td class="num">${s.min_order_value ? fmtEur(s.min_order_value) : '–'}</td>
        <td class="num">${s.shipping_cost ? fmtEur(s.shipping_cost) : '–'}</td><td class="num">${s.article_count}</td></tr>`).join('')}</tbody></table></div>`;
  }
  tbl.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) edit(Number(tr.dataset.id)); });

  async function edit(id) {
    const s = id ? await get(`/api/suppliers/${id}`) : { active: 1, order_days: '', delivery_days: '', articles: [] };
    const ro = !can('suppliers.manage');
    const dis = ro ? 'disabled' : '';
    const dayBoxes = (name, csv) => `<div class="day-boxes">${WEEKDAYS.map((d, i) => `<label class="day"><input type="checkbox" data-group="${name}" name="${name}_${i + 1}" value="${i + 1}" ${String(csv || '').split(',').includes(String(i + 1)) ? 'checked' : ''} ${dis}><span>${d}</span></label>`).join('')}</div>`;
    const m = modal({
      title: id ? s.name : 'Neuer Lieferant', wide: true,
      body: `<form id="sf" class="form-grid form-2col">
        <label class="field"><span>Firmenname *</span><input name="name" value="${esc(s.name || '')}" required ${dis}></label>
        <label class="field"><span>Kundennummer</span><input name="customer_no" value="${esc(s.customer_no || '')}" ${dis}></label>
        <label class="field"><span>Ansprechpartner</span><input name="contact_person" value="${esc(s.contact_person || '')}" ${dis}></label>
        <label class="field"><span>Telefon</span><input name="phone" type="tel" value="${esc(s.phone || '')}" ${dis}></label>
        <label class="field"><span>E-Mail</span><input name="email" type="email" value="${esc(s.email || '')}" ${dis}></label>
        <label class="check"><input type="checkbox" name="active" ${s.active ? 'checked' : ''} ${dis}> Aktiv</label>
        <div class="field"><span>Bestelltage</span>${dayBoxes('order_days', s.order_days)}</div>
        <div class="field"><span>Liefertage</span>${dayBoxes('delivery_days', s.delivery_days)}</div>
        <label class="field"><span>Mindestbestellwert (€ netto)</span><input name="min_order_value" inputmode="decimal" value="${String(s.min_order_value ?? 0).replace('.', ',')}" ${dis}></label>
        <label class="field"><span>Versandkosten (€ netto)</span><input name="shipping_cost" inputmode="decimal" value="${String(s.shipping_cost ?? 0).replace('.', ',')}" ${dis}></label>
        <label class="field span2"><span>Notizen</span><textarea name="notes" rows="2" ${dis}>${esc(s.notes || '')}</textarea></label>
      </form>
      ${id ? `<h3 class="mt">Zugeordnete Artikel (${s.articles.length})</h3>
        ${s.articles.length ? `<ul class="art-chips">${s.articles.map((x) => `<li class="${x.archived || !x.active ? 'muted' : ''}">${esc(x.name)} <small>${esc(x.article_no)} · ${fmtEur(x.price_net)}</small></li>`).join('')}</ul>` : '<p class="muted">Keine Artikel zugeordnet.</p>'}
        ${can('articles.manage') ? '<button type="button" class="btn btn-sm" id="assign">Artikel zuordnen …</button>' : ''}` : ''}`,
      actions: [
        ...(id && !ro ? [{ label: 'Löschen', cls: 'btn-danger-ghost', onClick: async () => {
          if (!(await confirmDialog(`Lieferant „${s.name}“ löschen? Wird er noch verwendet, wird er nur deaktiviert.`, { danger: true, ok: 'Löschen' }))) return false;
          const r = await del(`/api/suppliers/${id}`); toast(r.deactivated ? 'Lieferant deaktiviert (noch in Verwendung).' : 'Gelöscht.', 'success'); await load();
        } }] : []),
        { label: 'Schließen' },
        ...(ro ? [] : [{ label: 'Speichern', cls: 'btn-primary', onClick: async (mm) => {
          const f = mm.body.querySelector('#sf');
          const d = { name: f.name.value, customer_no: f.customer_no.value, contact_person: f.contact_person.value, phone: f.phone.value, email: f.email.value, notes: f.notes.value, active: f.active.checked };
          d.order_days = [...f.querySelectorAll('[data-group="order_days"]:checked')].map((x) => x.value).join(',');
          d.delivery_days = [...f.querySelectorAll('[data-group="delivery_days"]:checked')].map((x) => x.value).join(',');
          d.min_order_value = parseNum(f.min_order_value.value) ?? 0; d.shipping_cost = parseNum(f.shipping_cost.value) ?? 0;
          if (Number.isNaN(d.min_order_value) || Number.isNaN(d.shipping_cost)) throw new Error('Bitte gültige Beträge eingeben.');
          if (id) await put(`/api/suppliers/${id}`, d); else await post('/api/suppliers', d);
          toast('Lieferant gespeichert.', 'success'); await load();
        } }]),
      ],
    });
    m.body.querySelector('#assign')?.addEventListener('click', () => assignDialog(s, m));
  }

  async function assignDialog(s, parent) {
    const arts = await get('/api/articles');
    const m = modal({
      title: `Artikel zuordnen: ${s.name}`, wide: true,
      body: `<input type="search" class="search" id="aq" placeholder="Artikel filtern …"><div class="pick-list" id="pl">${arts.map((a) => `<label class="pick-row check" data-txt="${esc(a.name + ' ' + a.article_no + ' ' + (a.supplier_name || ''))}"><input type="checkbox" value="${a.id}" ${a.supplier_id === s.id ? 'checked disabled' : ''}> <span><strong>${esc(a.name)}</strong> <small class="muted">${esc(a.article_no)} · bisher: ${esc(a.supplier_name || '–')}</small></span></label>`).join('')}</div>`,
      actions: [{ label: 'Abbrechen' }, { label: 'Zuordnen', cls: 'btn-primary', onClick: async (mm) => {
        const ids = [...mm.body.querySelectorAll('input[type=checkbox]:checked:not(:disabled)')].map((x) => Number(x.value));
        if (!ids.length) throw new Error('Keine Artikel gewählt.');
        await post(`/api/suppliers/${s.id}/assign`, { article_ids: ids });
        toast(`${ids.length} Artikel zugeordnet.`, 'success'); parent.close(); await load(); edit(s.id);
      } }],
    });
    m.body.querySelector('#aq').addEventListener('input', (e) => m.body.querySelectorAll('.pick-row').forEach((r) => { r.hidden = !matches(r.dataset.txt, e.target.value); }));
  }

  await load();
}
