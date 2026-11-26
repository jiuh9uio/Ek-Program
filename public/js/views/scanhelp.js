// Hilfen für Scans: unbekannten Code einem Artikel zuordnen.
import { get, post } from '../api.js';
import { esc, modal, toast, matches } from '../ui.js';
import { can } from '../app.js';

/** Code einem Artikel zuordnen (Admin). Liefert { id, name } oder null. */
export function assignCodeDialog(code, { preferIds = [] } = {}) {
  if (!can('articles.manage')) {
    toast(`Unbekannter Code „${code}“ – bitte einen Administrator bitten, ihn einem Artikel zuzuordnen.`, 'error', 7000);
    return Promise.resolve(null);
  }
  return new Promise(async (resolve) => {
    let arts = [];
    try { arts = (await get('/api/articles')).filter((a) => a.active); } catch (e) { toast(e.message, 'error'); resolve(null); return; }
    arts.sort((a, b) => (preferIds.includes(b.id) - preferIds.includes(a.id)) || a.name.localeCompare(b.name, 'de'));
    let done = false;
    const m = modal({
      title: 'Unbekannter Code',
      wide: true,
      body: `<p>Der Code <code>${esc(code)}</code> ist noch keinem Artikel zugeordnet. Zu welchem Artikel gehört er?</p>
        <input type="search" class="search" id="aq" placeholder="Artikel suchen …">
        <div class="pick-list" id="al"></div>`,
      onClose: () => { if (!done) resolve(null); },
    });
    const al = m.body.querySelector('#al');
    const draw = (q) => {
      al.innerHTML = arts.filter((a) => !q || matches(`${a.name} ${a.article_no} ${a.supplier_name || ''}`, q)).slice(0, 60).map((a) => `
        <button type="button" class="pick-row pick-btn" data-id="${a.id}"><div><strong>${esc(a.name)}</strong><br><small class="muted">${esc([a.article_no, a.pack_size, a.location_name].filter(Boolean).join(' · '))}${a.codes.length ? ` · ${a.codes.length} Code(s)` : ''}</small></div><span class="btn btn-sm btn-primary">Zuordnen</span></button>`).join('');
    };
    draw('');
    m.body.querySelector('#aq').addEventListener('input', (e) => draw(e.target.value));
    al.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-id]'); if (!b) return;
      try {
        await post(`/api/articles/${b.dataset.id}/codes`, { code });
        const a = arts.find((x) => x.id === Number(b.dataset.id));
        toast(`Code ${code} → „${a.name}“ gespeichert. Ab jetzt wird er sofort erkannt.`, 'success');
        done = true; m.close(); resolve({ id: a.id, name: a.name });
      } catch (err) { toast(err.message, 'error'); }
    });
  });
}

/** Code nachschlagen; bei unbekanntem Code Zuordnung anbieten. */
export async function resolveCode(code, opts) {
  try { return (await get(`/api/codes/${encodeURIComponent(code)}`, { quiet: true })).article; } catch (e) {
    if (e.status !== 404) { toast(e.message, 'error'); return null; }
    return assignCodeDialog(code, opts);
  }
}
