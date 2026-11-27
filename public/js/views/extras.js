// Sonderwünsche: freie Positionen, die (noch) nicht in der Artikelliste stehen – z. B. ein neuer Wein zum Probieren.
import { get, post } from '../api.js';
import { esc, toast, modal, options, matches, parseNum, norm } from '../ui.js';
import { can } from '../app.js';
import { sound, haptic } from '../reward.js';

let cache = null;
async function refs() {
  if (!cache) {
    const [arts, sups, units] = await Promise.all([get('/api/articles'), get('/api/suppliers'), get('/api/units')]);
    cache = { arts: arts.filter((a) => a.active), sups: sups.filter((s) => s.active), units };
    setTimeout(() => { cache = null; }, 60000);
  }
  return cache;
}

/** Dialog „Sonderwunsch hinzufügen“. Resolves true, wenn etwas hinzugefügt wurde. */
export async function extraDialog(listId, { supplierId = null, title = '✍️ Sonderwunsch hinzufügen' } = {}) {
  const { arts, sups, units } = await refs();
  let added = 0;
  return new Promise((resolve) => {
    const m = modal({
      title, wide: true,
      body: `<p class="muted">Etwas, das nicht in der Artikelliste steht – z. B. ein neuer Wein zum Probieren, Deko für eine Feier oder ein Wunsch vom Küchenchef.</p>
        <form id="xf" class="form-grid form-2col" autocomplete="off">
          <label class="field span2"><span>Was soll besorgt werden? *</span><input name="name" maxlength="120" placeholder="z. B. Grauburgunder Weingut Huber, 0,75 l"></label>
          <div class="span2" id="xs"></div>
          <label class="field"><span>Menge</span><div class="stepper"><button type="button" data-q="-">−</button><input name="qty" inputmode="decimal" value="1"><button type="button" data-q="+">+</button></div></label>
          <label class="field"><span>Einheit</span><input name="unit" list="xunits" placeholder="z. B. Flaschen"><datalist id="xunits">${units.map((u) => `<option value="${esc(u.plural)}">`).join('')}</datalist></label>
          <label class="field"><span>Lieferant / Einkaufsort</span><select name="supplier_id">${options(sups, supplierId, { empty: '– egal / offen –' })}</select></label>
          <label class="field"><span>Preis ca. (€ je Einheit, optional)</span><input name="price" inputmode="decimal"></label>
          <label class="field span2"><span>Bemerkung</span><input name="note" maxlength="300" placeholder="z. B. für die Weinkarte testen, Wunsch von …"></label>
        </form><div id="xadded" class="mt"></div>`,
      actions: [
        { label: 'Fertig', onClick: () => true },
        { label: '+ Hinzufügen & weiteren', onClick: async (mm) => { await submit(mm, true); return false; } },
        { label: 'Hinzufügen', cls: 'btn-primary', onClick: async (mm) => submit(mm, false) },
      ],
      onClose: () => resolve(added > 0),
    });
    const f = m.body.querySelector('#xf');
    const sug = m.body.querySelector('#xs');
    f.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => {
      const v = parseNum(f.qty.value) || 0;
      f.qty.value = String(Math.max(1, v + (b.dataset.q === '+' ? 1 : -1)));
    }));
    // Vorhandene Artikel vorschlagen, damit nichts doppelt angelegt wird
    f.name.addEventListener('input', () => {
      const q = f.name.value.trim();
      const hits = q.length >= 3 ? arts.filter((a) => matches(`${a.name} ${a.article_no}`, q)).slice(0, 4) : [];
      sug.innerHTML = hits.length ? `<div class="hint">Gibt es schon als Artikel: ${hits.map((a) => `<button type="button" class="chip" data-art="${a.id}">${esc(a.name)}</button>`).join(' ')} – antippen, um den vorhandenen Artikel zu bestellen.</div>` : '';
      sug.querySelectorAll('[data-art]').forEach((b) => b.addEventListener('click', async () => {
        const a = arts.find((x) => x.id === Number(b.dataset.art));
        const qty = parseNum(f.qty.value) || 1;
        try {
          const r = await post(`/api/lists/${listId}/items`, { article_id: a.id, qty });
          added++; sound.pop(); haptic(12);
          toast(`„${a.name}“ (${qty}) hinzugefügt${r.merged ? ' – Menge zusammengeführt' : ''}.`, 'success');
          reset();
        } catch (e) { toast(e.message, 'error'); }
      }));
    });
    const reset = () => { f.name.value = ''; f.qty.value = '1'; f.unit.value = ''; f.price.value = ''; f.note.value = ''; sug.innerHTML = ''; f.name.focus(); renderAdded(); };
    const list = [];
    const renderAdded = () => {
      m.body.querySelector('#xadded').innerHTML = list.length ? `<p class="small muted">Hinzugefügt: ${list.map((x) => `<b>${esc(x)}</b>`).join(', ')}</p>` : '';
    };
    async function submit(mm, again) {
      const name = f.name.value.trim();
      if (!name) { if (!again && added) return true; throw new Error('Bitte eintragen, was besorgt werden soll.'); }
      const qty = parseNum(f.qty.value);
      if (!(qty > 0)) throw new Error('Bitte eine Menge größer 0 eingeben.');
      const price = f.price.value.trim() ? parseNum(f.price.value) : null;
      if (Number.isNaN(price)) throw new Error('Ungültiger Preis.');
      await post(`/api/lists/${listId}/extras`, { name, qty, unit: f.unit.value.trim(), supplier_id: f.supplier_id.value || null, price, note: f.note.value.trim() });
      added++; list.push(`${name} (${qty}${f.unit.value ? ' ' + f.unit.value.trim() : ''})`);
      sound.pop(); haptic(12);
      toast(`Sonderwunsch „${name}“ hinzugefügt.`, 'success');
      if (again) { reset(); return false; }
      return true;
    }
    setTimeout(() => f.name.focus(), 50);
  });
}

/** Sonderwunsch fest ins Sortiment übernehmen (neuer Artikel oder vorhandenem zuordnen). */
export async function convertDialog(listId, item) {
  if (!can('articles.manage')) return false;
  const [{ arts, sups, units }, cats] = await Promise.all([refs(), get('/api/categories')]);
  const unitMatch = units.find((u) => item.unit_name && (norm(u.plural) === norm(item.unit_name) || norm(u.name) === norm(item.unit_name)));
  return new Promise((resolve) => {
    let done = false;
    const m = modal({
      title: `„${item.article_name}“ ins Sortiment übernehmen`, wide: true,
      body: `<p class="muted">Der Sonderwunsch wird zu einem festen Artikel – mit MIN/MAX, Lagerort und Barcode wie alle anderen. Die Position auf dieser Liste wird automatisch verknüpft.</p>
        <form id="cf" class="form-grid form-2col">
          <label class="field span2"><span>Artikelname *</span><input name="name" value="${esc(item.article_name)}"></label>
          <label class="field"><span>Kategorie</span><select name="category_id">${options(cats.filter((c) => c.active), cats.find((c) => /wein/i.test(c.name) && /wein/i.test(item.article_name))?.id)}</select></label>
          <label class="field"><span>Lieferant</span><select name="supplier_id">${options(sups, item.supplier_id)}</select></label>
          <label class="field"><span>Mengeneinheit</span><select name="unit_id">${options(units, unitMatch?.id)}</select></label>
          <label class="field"><span>EK netto (€ je Einheit)</span><input name="price_net" inputmode="decimal" value="${item.unit_price_actual ?? (item.unit_price_est || '')}"></label>
          <label class="field"><span>MIN</span><input name="min_stock" inputmode="decimal" value="0"></label>
          <label class="field"><span>MAX</span><input name="max_stock" inputmode="decimal" value="0"></label>
        </form>
        <details class="mt"><summary>… oder einem vorhandenen Artikel zuordnen</summary>
          <input type="search" class="search mt" id="cq" placeholder="Artikel suchen …"><div class="pick-list" id="cl"></div></details>`,
      actions: [{ label: 'Abbrechen' }, {
        label: 'Als neuen Artikel anlegen', cls: 'btn-primary', onClick: async (mm) => {
          const f = mm.body.querySelector('#cf');
          const d = { name: f.name.value, category_id: f.category_id.value, supplier_id: f.supplier_id.value, unit_id: f.unit_id.value };
          for (const k of ['price_net', 'min_stock', 'max_stock']) { const n = parseNum(f[k].value); if (Number.isNaN(n)) throw new Error('Bitte gültige Zahlen eingeben.'); d[k] = n ?? 0; }
          const a = await post('/api/articles', d);
          await post(`/api/lists/${listId}/items/${item.id}/convert`, { article_id: a.id });
          toast(`„${a.name}“ ist jetzt fester Artikel (${a.article_no}).`, 'success');
          sound.success(); done = true;
        },
      }],
      onClose: () => resolve(done),
    });
    const cl = m.body.querySelector('#cl');
    const draw = (q) => {
      cl.innerHTML = arts.filter((a) => !q || matches(`${a.name} ${a.article_no}`, q)).slice(0, 40).map((a) => `<button type="button" class="pick-row pick-btn" data-id="${a.id}"><div><strong>${esc(a.name)}</strong><br><small class="muted">${esc(a.article_no)}</small></div><span class="btn btn-sm">Zuordnen</span></button>`).join('');
    };
    draw(item.article_name.split(' ')[0]);
    m.body.querySelector('#cq').addEventListener('input', (e) => draw(e.target.value));
    cl.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-id]'); if (!b) return;
      try {
        await post(`/api/lists/${listId}/items/${item.id}/convert`, { article_id: Number(b.dataset.id) });
        toast('Sonderwunsch dem Artikel zugeordnet.', 'success'); done = true; m.close();
      } catch (err) { toast(err.message, 'error'); }
    });
  });
}
