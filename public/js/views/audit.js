// Änderungsprotokoll.
import { get } from '../api.js';
import { esc, fmtDateTime, debounce, emptyState } from '../ui.js';
import { detailText } from './lists.js';

const ENT = { '': 'Alle Bereiche', article: 'Artikel', list: 'Einkaufslisten', supplier: 'Lieferanten', user: 'Benutzer', printer: 'Drucker', settings: 'Einstellungen', system: 'System', categories: 'Kategorien', locations: 'Lagerorte', unit: 'Einheiten' };

export async function render(el) {
  el.innerHTML = `<div class="toolbar"><input type="search" class="search" id="q" placeholder="Aktion, Benutzer, Details …">
    <select id="ent">${Object.entries(ENT).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div><div id="log"></div>`;
  const load = async () => {
    const q = el.querySelector('#q').value; const ent = el.querySelector('#ent').value;
    const rows = await get(`/api/audit?limit=500${q ? '&q=' + encodeURIComponent(q) : ''}${ent ? '&entity=' + ent : ''}`);
    el.querySelector('#log').innerHTML = rows.length ? `<div class="table-wrap"><table class="table table-sm"><thead><tr><th>Zeit</th><th>Benutzer</th><th>Aktion</th><th>Bereich</th><th>Details</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td class="nowrap">${fmtDateTime(r.at)}</td><td>${esc(r.user_name || '')}</td><td>${esc(r.action)}</td><td>${esc(ENT[r.entity] || r.entity || '')}${r.entity === 'list' && r.entity_id ? ` <a href="#/lists/${r.entity_id}">öffnen</a>` : ''}</td>
      <td class="small">${esc(detailText(r.details))}</td></tr>`).join('')}</tbody></table></div>` : emptyState('Keine Einträge.');
  };
  el.querySelector('#q').addEventListener('input', debounce(load, 300));
  el.querySelector('#ent').addEventListener('change', load);
  await load();
}
