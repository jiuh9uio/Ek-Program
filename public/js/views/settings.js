// Systemeinstellungen, Netzwerkzugriff, Datensicherung & Wiederherstellung.
import { get, put, post, api } from '../api.js';
import { esc, fmtDateTime, toast, confirmDialog, download, emptyState } from '../ui.js';
import { updaterAvailable, checkNow, startUpdate } from '../update.js';

const MAIL_PRESETS = {
  Gmail: { host: 'smtp.gmail.com', port: 465, secure: 'ssl' },
  'Outlook / Microsoft 365': { host: 'smtp.office365.com', port: 587, secure: 'starttls' },
  IONOS: { host: 'smtp.ionos.de', port: 465, secure: 'ssl' },
  Strato: { host: 'smtp.strato.de', port: 465, secure: 'ssl' },
  'GMX': { host: 'mail.gmx.net', port: 465, secure: 'ssl' },
  'WEB.DE': { host: 'smtp.web.de', port: 587, secure: 'starttls' },
  'T-Online': { host: 'securesmtp.t-online.de', port: 465, secure: 'ssl' },
};

export async function render(el) {
  const s = await get('/api/settings');
  el.innerHTML = `<div class="grid-2">
    <section class="card"><h2>Allgemein</h2>
      <form id="sf" class="form-grid">
        <label class="field"><span>Betriebsname (Bon/PDF)</span><input name="company_name" value="${esc(s.company_name)}"></label>
        <label class="field"><span>Bestandskontrolle gilt als aktuell für (Tage)</span><input name="check_valid_days" inputmode="numeric" value="${s.check_valid_days}"></label>
        <label class="field"><span>Fertige Einkaufslisten auf dem Dashboard anzeigen (Tage)</span><input name="finished_list_days" inputmode="numeric" value="${s.finished_list_days}"></label>
        <label class="field"><span>Automatische Abmeldung nach Inaktivität (Stunden)</span><input name="session_hours" inputmode="numeric" value="${s.session_hours}"></label>
        <label class="check"><input type="checkbox" name="auto_backup" ${s.auto_backup ? 'checked' : ''}> Tägliche automatische Datensicherung</label>
        <label class="field"><span>Anzahl aufbewahrter automatischer Sicherungen</span><input name="backup_keep" inputmode="numeric" value="${s.backup_keep}"></label>
        <button class="btn btn-primary" type="submit">Speichern</button>
      </form></section>
    <section class="card"><h2>Zugriff &amp; System</h2>
      <dl class="dl"><dt>Version</dt><dd>${esc(s.version)}</dd><dt>Datenordner</dt><dd class="break">${esc(s.data_dir)}</dd><dt>Datenbank</dt><dd class="break">${esc(s.db_file)}</dd>
      <dt>Im WLAN erreichbar</dt><dd>${s.lan_urls.length ? s.lan_urls.map((u) => `<code>${esc(u)}</code>`).join('<br>') : 'nein – nur dieses Gerät'}</dd></dl>
      <p class="muted small">${s.lan_urls.length ? 'Smartphones und Tablets im selben Netzwerk öffnen eine dieser Adressen im Browser. Beim ersten Start fragt die Windows-Firewall nach einer Freigabe – „Private Netzwerke“ erlauben.' : 'EK-Service läuft nur in diesem Programmfenster und ist von außen nicht erreichbar. Zugriff vom Handy lässt sich bei Bedarf freischalten (siehe Anleitung: <code>lanAccess</code>).'}</p>
      ${window.ekDesktop ? '<div class="btn-row"><button class="btn" id="dd">📂 Datenordner öffnen</button></div>' : ''}
      <button class="btn" id="demo">Beispieldaten laden (nur bei leerer Artikelliste)</button>
    </section>
    <section class="card span2"><div class="card-head"><h2>✉️ E-Mail-Versand</h2><span class="badge ${s.smtp_host && s.smtp_from ? 'st-green' : 'st-grey'}">${s.smtp_host && s.smtp_from ? 'eingerichtet' : 'nicht eingerichtet'}</span></div>
      <p class="muted small">Einkaufslisten werden als PDF-Anhang über Ihr eigenes E-Mail-Konto versendet. Bei Gmail und Outlook/Microsoft 365 ist meist ein <b>App-Passwort</b> nötig (in den Kontosicherheits-Einstellungen erstellen).</p>
      <div class="chips mb">${Object.keys(MAIL_PRESETS).map((k) => `<button type="button" class="chip" data-preset="${k}">${k}</button>`).join('')}</div>
      <form id="mailf" class="form-grid form-2col">
        <label class="field"><span>SMTP-Server</span><input name="smtp_host" value="${esc(s.smtp_host)}" placeholder="z. B. smtp.gmail.com" autocapitalize="none"></label>
        <div class="form-grid form-2col"><label class="field"><span>Port</span><input name="smtp_port" inputmode="numeric" value="${s.smtp_port}"></label>
          <label class="field"><span>Verschlüsselung</span><select name="smtp_secure"><option value="starttls">STARTTLS (587)</option><option value="ssl">SSL/TLS (465)</option><option value="none">keine (nur LAN)</option></select></label></div>
        <label class="field"><span>Benutzername (meist die E-Mail-Adresse)</span><input name="smtp_user" value="${esc(s.smtp_user)}" autocapitalize="none" autocomplete="off"></label>
        <label class="field"><span>Passwort / App-Passwort ${s.smtp_has_password ? '<small class="muted">(gespeichert – leer lassen = unverändert)</small>' : ''}</span><input name="smtp_pass" type="password" autocomplete="new-password"></label>
        <label class="field"><span>Absenderadresse</span><input name="smtp_from" type="email" value="${esc(s.smtp_from)}" autocapitalize="none"></label>
        <label class="field"><span>Absendername (optional)</span><input name="smtp_from_name" value="${esc(s.smtp_from_name)}" placeholder="${esc(s.company_name)}"></label>
        <label class="field span2"><span>Standard-Empfänger (z. B. Küchenchef, Einkauf – mehrere mit Komma)</span><input name="mail_default_to" value="${esc(s.mail_default_to)}" autocapitalize="none"></label>
        <div class="btn-row span2"><button class="btn btn-primary" type="submit">Speichern</button><button class="btn" type="button" id="mailtest">Test-E-Mail senden</button></div>
      </form></section>
    ${updaterAvailable() ? `<section class="card span2"><div class="card-head"><h2>Programm-Update</h2><div class="btn-row"><button class="btn btn-primary" id="upd-check">🔄 Nach Updates suchen</button><button class="btn" id="upd">Update-Datei öffnen (manuell)</button></div></div>
      <p class="muted small">EK-Service sucht beim Start und alle 6 Stunden selbst nach einer neuen Version und zeigt oben einen Hinweis. Ein Link ist nicht nötig – die neueste Version wird automatisch geholt, Datenbank und alte Version werden vorher gesichert.</p>
      <div id="upd-result" class="upd-result"></div></section>` : ''}
    <section class="card span2"><div class="card-head"><h2>Datensicherung</h2><div class="btn-row"><button class="btn btn-primary" id="bk">Jetzt sichern</button><label class="btn">Sicherung aus Datei wiederherstellen<input type="file" id="up" accept=".db" hidden></label></div></div>
      <p class="muted small">Ablage: ${esc(s.data_dir)}\\backups – Tipp: Diesen Ordner regelmäßig zusätzlich auf USB-Stick oder Netzlaufwerk kopieren.</p>
      <div id="bks"></div></section></div>`;

  el.querySelector('#sf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await put('/api/settings', { company_name: f.company_name.value, check_valid_days: f.check_valid_days.value, session_hours: f.session_hours.value, finished_list_days: f.finished_list_days.value, auto_backup: f.auto_backup.checked, backup_keep: f.backup_keep.value });
      toast('Einstellungen gespeichert.', 'success');
    } catch (err) { toast(err.message, 'error'); }
  });
  const mf = el.querySelector('#mailf');
  mf.smtp_secure.value = s.smtp_secure || 'starttls';
  el.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
    const p = MAIL_PRESETS[b.dataset.preset];
    mf.smtp_host.value = p.host; mf.smtp_port.value = p.port; mf.smtp_secure.value = p.secure;
    toast(`${b.dataset.preset}: Server übernommen – Benutzer, Passwort und Absender eintragen.`, 'info');
  }));
  const saveMail = async () => {
    const d = Object.fromEntries(['smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_pass', 'smtp_from', 'smtp_from_name', 'mail_default_to'].map((k) => [k, mf[k].value.trim()]));
    await put('/api/settings/mail', d);
    mf.smtp_pass.value = '';
  };
  mf.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await saveMail(); toast('E-Mail-Einstellungen gespeichert.', 'success'); } catch (err) { toast(err.message, 'error'); }
  });
  el.querySelector('#mailtest').addEventListener('click', async (e) => {
    const btn = e.target; btn.disabled = true; btn.textContent = 'Sende …';
    try {
      await saveMail();
      const r = await post('/api/settings/mail/test', {});
      toast(`Test-E-Mail an ${r.to.join(', ')} gesendet – bitte Posteingang prüfen.`, 'success', 6000);
    } catch (err) { toast(err.message, 'error', 10000); } finally { btn.disabled = false; btn.textContent = 'Test-E-Mail senden'; }
  });
  el.querySelector('#dd')?.addEventListener('click', () => window.ekDesktop.openDataFolder());
  el.querySelector('#upd-check')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget; const box = el.querySelector('#upd-result');
    btn.disabled = true; box.innerHTML = '<p class="muted">Suche nach Updates …</p>';
    try {
      const r = await checkNow();
      if (!r.ok) box.innerHTML = `<p class="banner-warn" style="padding:8px;border-radius:8px">⚠️ ${esc(r.error)}</p>`;
      else if (r.available) {
        box.innerHTML = `<p><strong>Neue Version ${esc(r.latest)}</strong> verfügbar (installiert: ${esc(r.current)}).</p><button class="btn btn-primary" id="upd-go">⬆️ Jetzt aktualisieren</button>`;
        box.querySelector('#upd-go').addEventListener('click', () => startUpdate(r));
      } else if (r.reason === 'keine-datei') box.innerHTML = `<p>Version ${esc(r.latest)} ist veröffentlicht, enthält aber noch keine passende Datei. Bitte später erneut versuchen.</p>`;
      else box.innerHTML = `<p>✅ EK-Service ist aktuell (Version ${esc(r.current)}).</p>`;
    } finally { btn.disabled = false; }
  });
  el.querySelector('#upd')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Die Update-Datei wird geöffnet. EK-Service muss für das Update geschlossen werden – vorher alles speichern.', { ok: 'Update-Datei öffnen' }))) return;
    const r = await window.ekDesktop.runUpdater();
    if (!r.ok) toast(`${r.error} Bei der installierten Version: Startmenü → „EK-Service aktualisieren“.`, 'error', 8000);
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
