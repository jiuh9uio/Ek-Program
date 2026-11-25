// Stammdaten: Kategorien, Lagerorte, Mengeneinheiten (frei konfigurierbar, sortierbar).
import { get, post, put, del } from '../api.js';
import { esc, toast, confirmDialog, promptDialog, modal } from '../ui.js';

export async function render(el) {
  el.innerHTML = `<div class="grid-3">
    <section class="card" id="cat"></section>
    <section class="card" id="loc"></section>
    <section class="card" id="unit"></section></div>`;

  const sortable = (box, title, path, hint) => {
    const load = async () => {
      const rows = await get(`/api/${path}`);
      box.innerHTML = `<div class="card-head"><h2>${title}</h2><button class="btn btn-sm btn-primary" data-new>+ Neu</button></div>
        <p class="muted small">${hint}</p>
        <ul class="sort-list">${rows.map((r, i) => `<li data-id="${r.id}" class="${r.active ? '' : 'muted'}">
          <span class="grow">${esc(r.name)} <small class="muted">(${r.article_count} Artikel)${r.active ? '' : ' · inaktiv'}</small></span>
          <button class="btn-icon" data-up ${i === 0 ? 'disabled' : ''} aria-label="nach oben">▲</button>
          <button class="btn-icon" data-down ${i === rows.length - 1 ? 'disabled' : ''} aria-label="nach unten">▼</button>
          <button class="btn-icon" data-edit aria-label="umbenennen">✎</button>
          <button class="btn-icon" data-toggle title="${r.active ? 'deaktivieren' : 'aktivieren'}">${r.active ? '⏸' : '▶'}</button>
          <button class="btn-icon danger" data-del aria-label="löschen">🗑</button></li>`).join('')}</ul>`;
      box.querySelector('[data-new]').addEventListener('click', async () => {
        const name = await promptDialog('Name:', { title: `${title}: neu` });
        if (!name) return;
        try { await post(`/api/${path}`, { name }); toast('Angelegt.', 'success'); load(); } catch (e) { toast(e.message, 'error'); }
      });
      box.querySelector('.sort-list').addEventListener('click', async (e) => {
        const li = e.target.closest('li'); if (!li) return;
        const id = Number(li.dataset.id); const r = rows.find((x) => x.id === id);
        try {
          if (e.target.closest('[data-up],[data-down]')) {
            const ids = rows.map((x) => x.id); const i = ids.indexOf(id); const j = i + (e.target.closest('[data-up]') ? -1 : 1);
            [ids[i], ids[j]] = [ids[j], ids[i]];
            await post(`/api/${path}/reorder`, { ids }); load();
          } else if (e.target.closest('[data-edit]')) {
            const name = await promptDialog('Neuer Name:', { title: 'Umbenennen', value: r.name });
            if (name) { await put(`/api/${path}/${id}`, { name }); load(); }
          } else if (e.target.closest('[data-toggle]')) {
            await put(`/api/${path}/${id}`, { active: !r.active }); load();
          } else if (e.target.closest('[data-del]')) {
            if (await confirmDialog(`„${r.name}“ löschen?`, { danger: true, ok: 'Löschen' })) { await del(`/api/${path}/${id}`); toast('Gelöscht.', 'success'); load(); }
          }
        } catch (err) { toast(err.message, 'error'); }
      });
    };
    return load();
  };

  const units = async () => {
    const box = el.querySelector('#unit');
    const rows = await get('/api/units');
    box.innerHTML = `<div class="card-head"><h2>Mengeneinheiten</h2><button class="btn btn-sm btn-primary" data-new>+ Neu</button></div>
      <p class="muted small">Einzahl/Mehrzahl werden auf Bon und Liste automatisch verwendet (1 Flasche, 3 Flaschen).</p>
      <ul class="sort-list">${rows.map((u) => `<li data-id="${u.id}"><span class="grow">${esc(u.name)} / ${esc(u.plural)} <small class="muted">(${u.article_count})</small></span>
        <button class="btn-icon" data-edit>✎</button><button class="btn-icon danger" data-del>🗑</button></li>`).join('')}</ul>`;
    const dlg = (u) => modal({
      title: u ? 'Einheit bearbeiten' : 'Neue Einheit',
      body: `<form class="form-grid" id="uf"><label class="field"><span>Einzahl</span><input name="name" value="${esc(u?.name || '')}"></label><label class="field"><span>Mehrzahl</span><input name="plural" value="${esc(u?.plural || '')}"></label></form>`,
      actions: [{ label: 'Abbrechen' }, { label: 'Speichern', cls: 'btn-primary', onClick: async (m) => {
        const f = m.body.querySelector('#uf');
        if (u) await put(`/api/units/${u.id}`, { name: f.name.value, plural: f.plural.value }); else await post('/api/units', { name: f.name.value, plural: f.plural.value });
        units();
      } }],
    });
    box.querySelector('[data-new]').addEventListener('click', () => dlg(null));
    box.querySelector('.sort-list').addEventListener('click', async (e) => {
      const li = e.target.closest('li'); if (!li) return;
      const u = rows.find((x) => x.id === Number(li.dataset.id));
      if (e.target.closest('[data-edit]')) dlg(u);
      if (e.target.closest('[data-del]') && await confirmDialog(`Einheit „${u.name}“ löschen?`, { danger: true, ok: 'Löschen' })) {
        try { await del(`/api/units/${u.id}`); units(); } catch (err) { toast(err.message, 'error'); }
      }
    });
  };

  await Promise.all([
    sortable(el.querySelector('#cat'), 'Kategorien', 'categories', 'Reihenfolge bestimmt die Gruppierung auf Bon und im Einkaufsmodus.'),
    sortable(el.querySelector('#loc'), 'Lagerorte', 'locations', 'Reihenfolge = Laufweg durchs Lager im Einkaufsmodus.'),
    units(),
  ]);
}
