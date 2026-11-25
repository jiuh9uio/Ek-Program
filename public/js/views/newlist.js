// Assistent "Neue Einkaufsliste": geführte Bestandszählung (empfohlen), Empfehlungen oder leere Liste.
import { get, post } from '../api.js';
import { esc, modal, toast } from '../ui.js';
import { navigate, can } from '../app.js';

export async function newListWizard() {
  const counting = can('stock.count') && can('list.create');
  let locs = []; let cats = [];
  if (counting) [locs, cats] = await Promise.all([get('/api/locations'), get('/api/categories')]);
  const chips = (rows, name) => rows.filter((r) => r.active && r.article_count > 0).map((r) => `<label class="chip-check"><input type="checkbox" name="${name}" value="${r.id}" checked><span>${esc(r.name)} <small>${r.article_count}</small></span></label>`).join('');

  const m = modal({
    title: 'Neue Einkaufsliste', wide: true,
    body: `<div class="wiz-options">
      ${counting ? `<label class="wiz-opt"><input type="radio" name="mode" value="count" checked><span><strong>📋 Mit Bestandszählung <em>empfohlen</em></strong>
        <small>Das System führt dich Artikel für Artikel durchs Lager und fragt, wie viel noch da ist. Die Nachkaufmenge bis zum Maximalbestand kommt automatisch auf die Einkaufsliste.</small></span></label>` : ''}
      <label class="wiz-opt"><input type="radio" name="mode" value="rec" ${counting ? '' : 'checked'}><span><strong>⚡ Aktuelle Empfehlungen übernehmen</strong>
        <small>Ohne Zählung: alle Artikel, die laut letztem Bestand unter/am Minimum sind.</small></span></label>
      <label class="wiz-opt"><input type="radio" name="mode" value="empty"><span><strong>📝 Leere Liste</strong><small>Artikel selbst hinzufügen.</small></span></label>
    </div>
    <form id="wf" class="form-grid">
      <label class="field"><span>Bezeichnung (optional)</span><input name="title" placeholder="z. B. Wocheneinkauf"></label>
      ${counting ? `<div class="count-opts">
        <div class="field"><span>Welche Lagerorte zählen? <button type="button" class="link-btn" data-all="loc">alle/keine</button></span><div class="chip-checks">${chips(locs, 'loc')}</div></div>
        <div class="field"><span>Welche Kategorien? <button type="button" class="link-btn" data-all="cat">alle/keine</button></span><div class="chip-checks">${chips(cats, 'cat')}</div></div>
        <label class="check"><input type="checkbox" name="only_due"> Nur fällige Artikel (nicht aktuell gezählt oder knapp)</label>
        <label class="check"><input type="checkbox" name="only_minmax" checked> Nur Artikel mit hinterlegtem MIN/MAX</label>
      </div>` : ''}
    </form>`,
    actions: [{ label: 'Abbrechen' }, {
      label: 'Starten', cls: 'btn-primary btn-lg', onClick: async (mm) => {
        const mode = mm.body.querySelector('input[name=mode]:checked').value;
        const f = mm.body.querySelector('#wf');
        if (mode === 'count') {
          const sel = (n) => [...f.querySelectorAll(`input[name=${n}]`)];
          const pick = (n) => { const all = sel(n); const on = all.filter((x) => x.checked).map((x) => Number(x.value)); if (!on.length) throw new Error('Bitte mindestens einen Lagerort und eine Kategorie wählen.'); return on.length === all.length ? [] : on; };
          const c = await post('/api/counts', { title: f.title.value, location_ids: pick('loc'), category_ids: pick('cat'), only_due: f.only_due.checked, only_minmax: f.only_minmax.checked });
          toast(`Zählung ${c.number} gestartet – ${c.items.length} Artikel.`, 'success');
          navigate(`/count/${c.id}`);
        } else {
          const l = await post('/api/lists', { title: f.title.value, with_recommendations: mode === 'rec' });
          toast(`Liste ${l.number} angelegt (${l.items.length} Positionen).`, 'success');
          navigate(`/lists/${l.id}`);
        }
      },
    }],
  });
  const sync = () => { const c = m.body.querySelector('.count-opts'); if (c) c.hidden = m.body.querySelector('input[name=mode]:checked').value !== 'count'; };
  m.body.querySelectorAll('input[name=mode]').forEach((r) => r.addEventListener('change', sync));
  m.body.querySelectorAll('[data-all]').forEach((b) => b.addEventListener('click', () => {
    const boxes = [...m.body.querySelectorAll(`input[name=${b.dataset.all}]`)];
    const on = !boxes.every((x) => x.checked);
    boxes.forEach((x) => { x.checked = on; });
  }));
  sync();
}
