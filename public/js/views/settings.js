// Systemeinstellungen, Netzwerkzugriff, Datensicherung & Wiederherstellung.
import { get, put, post, api } from '../api.js';
import { esc, fmtDateTime, toast, confirmDialog, download, emptyState } from '../ui.js';

export async function render(el) {
  const s = await get('/api/settings');
  el.innerHTML = `<div class="grid-2">
    <section class="card"><h2>Allgemein</h2>
      <form id="sf" class="form-grid">
        <label class="field"><span>Betriebsname (Bon/PDF)</span><input name="company_name" value="${esc(s.company_name)}"></label>
        <label class="field"><span>Bestandskontrolle gilt als aktuell für (Tage)</span><input name="check_valid_days" inputmode="numeric" value="${s.check_valid_days}"></label>
        <label class="field"><span>Automatische Abmeldung nach Inaktivität (Stunden)</span><input name="session_hours" inputmode="numeric" value="${s.session_hours}"></label>
        <label class="check"><input type="checkbox" name="auto_backup" ${s.auto_backup ? 'checked' : ''}> Tägliche automatische Datensicherung</label>
        <label class="field"><span>Anzahl aufbewahrter automatischer Sicherungen</span><input name="backup_keep" inputmode="numeric" value="${s.backup_keep}"></label>
        <button class="btn btn-primary" type="submit">Speichern</button>
      </form></section>
    <section class="card"><h2>Zugriff &amp; System</h2>
      <dl class="dl"><dt>Version</dt><dd>${esc(s.version)}</dd><dt>Datenordner</dt><dd class="break">${esc(s.data_dir)}</dd><dt>Datenbank</dt><dd class="break">${esc(s.db_file)}</dd>
      <dt>Im WLAN erreichbar</dt><dd>${s.lan_urls.map((u) => `<code>${esc(u)}</code>`).join('<br>') || '–'}</dd></dl>
      <p class="muted small">Smartphones und Tablets im selben Netzwerk öffnen eine dieser Adressen im Browser. Beim ersten Start fragt die Windows-Firewall nach einer Freigabe – „Private Netzwerke“ erlauben.</p>
      <button class="btn" id="demo">Beispieldaten laden (nur bei leerer Artikelliste)</button>
    </section>
    <section class="card span2"><div class="card-head"><h2>Datensicherung</h2><div class="btn-row"><button class="btn btn-primary" id="bk">Jetzt sichern</button><label class="btn">Sicherung aus Datei wiederherstellen<input type="file" id="up" accept=".db" hidden></label></div></div>
      <p class="muted small">Ablage: ${esc(s.data_dir)}\\backups – Tipp: Diesen Ordner regelmäßig zusätzlich auf USB-Stick oder Netzlaufwerk kopieren.</p>
      <div id="bks"></div></section></div>`;

  el.querySelector('#sf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await put('/api/settings', { company_name: f.company_name.value, check_valid_days: f.check_valid_days.value, session_hours: f.session_hours.value, auto_backup: f.auto_backup.checked, backup_keep: f.backup_keep.value });
      toast('Einstellungen gespeichert.', 'success');
    } catch (err) { toast(err.message, 'error'); }
  });
  el.querySelector('#demo').addEventListener('click', async () => {
    try { await post('/api/demo-data'); toast('Beispieldaten geladen.', 'success'); } catch (e) { toast(e.message, 'error'); }
  });
  el.querySelector('#bk').addEventListener('click', async () => {
    try { const b = await post('/api/backups'); toast(`Sicherung ${b.name} erstellt.`, 'success'); loadB(); } catch (e) { toast(e.message, 'error'); }
  });
  el.querySelector('#up').addEventListener('change', async (e) => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    if (!(await confirmDialog(`Datenbank aus „${file.name}“ wiederherstellen? Der aktuelle Stand wird vorher automatisch gesichert. Alle Benutzer werden ggf. abgemeldet.`, { danger: true, ok: 'Wiederherstellen' }))) return;
    try { const r = await api('POST', '/api/backups-upload', new Blob([await file.arrayBuffer()])); toast(`Wiederhergestellt. Sicherung des alten Stands: ${r.safety_backup}`, 'success', 8000); setTimeout(() => location.reload(), 1500); } catch (err) { toast(err.message, 'error'); }
  });

  async function loadB() {
    const r = await get('/api/backups');
    const box = el.querySelector('#bks');
    box.innerHTML = r.backups.length ? `<div class="table-wrap"><table class="table table-sm"><thead><tr><th>Datei</th><th>Erstellt</th><th class="num">Größe</th><th></th></tr></thead>
      <tbody>${r.backups.map((b) => `<tr><td>${esc(b.name)}</td><td>${fmtDateTime(b.created_at)}</td><td class="num">${(b.size / 1024).toFixed(0)} KB</td>
      <td class="row-actions"><button class="btn btn-sm" data-dl="${esc(b.name)}">Herunterladen</button><button class="btn btn-sm btn-danger-ghost" data-rs="${esc(b.name)}">Wiederherstellen</button></td></tr>`).join('')}</tbody></table></div>` : emptyState('Noch keine Sicherungen.');
    box.querySelectorAll('[data-dl]').forEach((b) => b.addEventListener('click', () => download(`/api/backups/${encodeURIComponent(b.dataset.dl)}`)));
    box.querySelectorAll('[data-rs]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmDialog(`Stand „${b.dataset.rs}“ wiederherstellen? Der aktuelle Stand wird vorher gesichert.`, { danger: true, ok: 'Wiederherstellen' }))) return;
      try { const x = await post(`/api/backups/${encodeURIComponent(b.dataset.rs)}/restore`); toast(`Wiederhergestellt (alter Stand: ${x.safety_backup}).`, 'success', 8000); setTimeout(() => location.reload(), 1500); } catch (e) { toast(e.message, 'error'); }
    }));
  }
  await loadB();
}
