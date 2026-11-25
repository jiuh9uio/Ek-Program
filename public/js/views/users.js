// Benutzer- und Rechteverwaltung.
import { get, post, put, del } from '../api.js';
import { esc, fmtDateTime, toast, modal, confirmDialog } from '../ui.js';
import { state } from '../app.js';

const SERVICE_DEFAULT = ['stock.count', 'list.create', 'print'];

export async function render(el, { setActions }) {
  const a = setActions('<button class="btn btn-primary" id="new">+ Neuer Benutzer</button>');
  a.querySelector('#new').addEventListener('click', () => edit(null));
  const load = async () => {
    const users = await get('/api/users');
    el.innerHTML = `<div class="table-wrap"><table class="table table-click"><thead><tr><th>Name</th><th>Benutzername</th><th>Rolle</th><th>Zusatzrechte</th><th>Letzte Anmeldung</th><th>Status</th></tr></thead>
      <tbody>${users.map((u) => `<tr data-id="${u.id}" class="${u.active ? '' : 'row-muted'}"><td><strong>${esc(u.display_name)}</strong></td><td>${esc(u.username)}</td>
      <td>${u.role === 'admin' ? '<span class="badge st-blue">Administrator</span>' : '<span class="badge">Service</span>'}</td>
      <td><small>${u.role === 'admin' ? 'alle' : (u.extra_permissions.map((p) => esc(state.catalog[p] || p)).join(', ') || '–')}</small></td>
      <td>${fmtDateTime(u.last_login_at)}</td><td>${u.active ? 'aktiv' : 'deaktiviert'}</td></tr>`).join('')}</tbody></table></div>
      <p class="muted small mt">Servicemitarbeiter dürfen standardmäßig: ${SERVICE_DEFAULT.map((p) => esc(state.catalog[p])).join(', ')}. Weitere Rechte können einzeln vergeben werden.</p>`;
    el.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => edit(users.find((u) => u.id === Number(tr.dataset.id)))));
  };

  function edit(u) {
    const d = u || { role: 'service', active: true, extra_permissions: [] };
    const extra = Object.keys(state.catalog).filter((p) => !SERVICE_DEFAULT.includes(p));
    const m = modal({
      title: u ? `Benutzer: ${u.display_name}` : 'Neuer Benutzer',
      body: `<form id="uf" class="form-grid">
        <label class="field"><span>Anzeigename *</span><input name="display_name" value="${esc(d.display_name || '')}" required></label>
        <label class="field"><span>Benutzername *</span><input name="username" value="${esc(d.username || '')}" autocapitalize="none" required></label>
        <label class="field"><span>${u ? 'Neue PIN / neues Passwort (leer = unverändert)' : 'PIN / Passwort * (mind. 4 Zeichen)'}</span><input name="password" type="password" autocomplete="new-password"></label>
        <label class="field"><span>Rolle</span><select name="role"><option value="service">Servicemitarbeiter</option><option value="admin">Administrator</option></select></label>
        <label class="check"><input type="checkbox" name="active" ${d.active ? 'checked' : ''}> Aktiv</label>
        <fieldset class="perms"><legend>Zusätzliche Rechte (nur Servicemitarbeiter)</legend>
          ${extra.map((p) => `<label class="check"><input type="checkbox" data-perm="${p}" ${d.extra_permissions.includes(p) ? 'checked' : ''}> ${esc(state.catalog[p])}</label>`).join('')}</fieldset>
      </form>`,
      actions: [
        ...(u && u.id !== state.user.id ? [{ label: 'Löschen', cls: 'btn-danger-ghost', onClick: async () => {
          if (!(await confirmDialog(`Benutzer „${u.display_name}“ löschen? Benutzer mit Historie werden deaktiviert.`, { danger: true, ok: 'Löschen' }))) return false;
          const r = await del(`/api/users/${u.id}`); toast(r.deactivated ? 'Benutzer deaktiviert (Historie bleibt erhalten).' : 'Benutzer gelöscht.', 'success'); load();
        } }] : []),
        { label: 'Abbrechen' },
        { label: 'Speichern', cls: 'btn-primary', onClick: async (mm) => {
          const f = mm.body.querySelector('#uf');
          const body = { display_name: f.display_name.value, username: f.username.value, role: f.role.value, active: f.active.checked, password: f.password.value || undefined,
            extra_permissions: [...f.querySelectorAll('[data-perm]:checked')].map((x) => x.dataset.perm) };
          if (u) await put(`/api/users/${u.id}`, body); else await post('/api/users', body);
          toast('Benutzer gespeichert.', 'success'); load();
        } },
      ],
    });
    const f = m.body.querySelector('#uf');
    f.role.value = d.role;
    const sync = () => { m.body.querySelector('.perms').disabled = f.role.value === 'admin'; };
    f.role.addEventListener('change', sync); sync();
  }
  await load();
}
