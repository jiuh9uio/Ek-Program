// Druckerverwaltung: ESC/POS-Netzwerk, Epson ePOS (TM-m30II), Windows-Drucker; Testdruck, Status, Druckhistorie.
import { get, post, put, del } from '../api.js';
import { esc, fmtDateTime, toast, modal, confirmDialog, emptyState } from '../ui.js';

const PROTO = {
  escpos_tcp: 'ESC/POS über Netzwerk (RAW, Port 9100)',
  epos_http: 'Epson ePOS-Print (HTTP) – z. B. TM-m30II',
  windows_raw: 'Windows-Drucker (USB/Bluetooth, RAW)',
};

export async function render(el, { setActions }) {
  const a = setActions('<button class="btn btn-primary" id="new">+ Drucker hinzufügen</button>');
  a.querySelector('#new').addEventListener('click', () => edit(null));
  el.innerHTML = `<div id="plist"></div>
    <section class="card mt"><h2>Hinweise zur Einrichtung</h2>
      <ul class="help">
        <li><b>Epson TM-m30II (empfohlen):</b> Protokoll „ESC/POS über Netzwerk“, IP-Adresse des Druckers, Port 9100. Alternativ „Epson ePOS-Print“ (Port 80; ePOS-Print muss in der Drucker-Weboberfläche aktiviert sein) – liefert detaillierte Statusmeldungen.</li>
        <li><b>IP-Adresse ermitteln:</b> Drucker ausschalten, Papiervorschubtaste gedrückt halten und einschalten → Statusbon mit IP. Feste IP im Router vergeben.</li>
        <li><b>USB-Bondrucker:</b> Epson-Treiber unter Windows installieren und „Windows-Drucker“ wählen – Druck läuft ohne Dialog direkt über die Druckwarteschlange.</li>
        <li>Der Druck erfolgt direkt aus dem EK-Service-Programm (lokaler Druckdienst) – kein Browser-Druckdialog nötig. Auch Smartphones im WLAN drucken über diesen Dienst.</li>
      </ul></section>
    <section class="card mt"><div class="card-head"><h2>Druckhistorie</h2></div><div id="jobs"></div></section>`;

  async function load() {
    const ps = await get('/api/printers');
    const box = el.querySelector('#plist');
    box.innerHTML = ps.length ? `<div class="printer-cards">${ps.map((p) => `<div class="card printer-card ${p.active ? '' : 'row-muted'}" data-id="${p.id}">
      <div class="card-head"><h2>${esc(p.name)} ${p.is_default ? '<span class="badge st-blue">Standard</span>' : ''}</h2><span class="pstatus" data-status="${p.id}">${p.last_status ? esc(p.last_status) : ''}</span></div>
      <dl class="dl"><dt>Protokoll</dt><dd>${esc(PROTO[p.protocol])}</dd>
      ${p.protocol === 'windows_raw' ? `<dt>Windows-Drucker</dt><dd>${esc(p.windows_name)}</dd>` : `<dt>Adresse</dt><dd>${esc(p.host)}:${p.port}</dd>`}
      <dt>Papier</dt><dd>${p.paper_width} mm · ${p.chars_per_line} Zeichen/Zeile · ${esc(p.codepage.toUpperCase())}</dd>
      <dt>Papierabschnitt</dt><dd>${p.auto_cut ? 'automatisch' : 'aus'}</dd>
      <dt>Letzter Status</dt><dd>${p.last_status_at ? fmtDateTime(p.last_status_at) : '–'}</dd></dl>
      <div class="btn-row"><button class="btn" data-a="status">Status prüfen</button><button class="btn btn-primary" data-a="test">Testdruck</button><button class="btn" data-a="edit">Bearbeiten</button>
      ${p.is_default ? '' : '<button class="btn" data-a="default">Als Standard</button>'}</div></div>`).join('')}</div>`
      : emptyState('Noch kein Bondrucker eingerichtet.', '⎙');
    box.querySelectorAll('.printer-card').forEach((card) => card.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-a]'); if (!b) return;
      const p = ps.find((x) => x.id === Number(card.dataset.id));
      b.disabled = true;
      try {
        if (b.dataset.a === 'status') {
          const st = card.querySelector('.pstatus'); st.textContent = 'Prüfe …';
          const s = await get(`/api/printers/${p.id}/status`);
          st.innerHTML = `${s.online ? '🟢' : '🔴'} ${esc(s.message)}`;
        } else if (b.dataset.a === 'test') {
          const r = await post(`/api/printers/${p.id}/test`);
          if (r.status === 'ok') toast('Testdruck gesendet.', 'success'); else toast(`Testdruck fehlgeschlagen: ${r.error}`, 'error', 9000);
          loadJobs();
        } else if (b.dataset.a === 'edit') edit(p);
        else if (b.dataset.a === 'default') { await put(`/api/printers/${p.id}`, { ...p, is_default: true }); load(); }
      } catch (err) { toast(err.message, 'error'); } finally { b.disabled = false; }
    }));
  }

  async function loadJobs() {
    const jobs = await get('/api/print-jobs');
    const box = el.querySelector('#jobs');
    box.innerHTML = jobs.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Zeit</th><th>Art</th><th>Liste</th><th>Drucker</th><th>Benutzer</th><th>Status</th><th></th></tr></thead>
      <tbody>${jobs.map((j) => `<tr><td>${fmtDateTime(j.at)}</td><td>${esc(j.title)}</td><td>${j.list_id ? `<a href="#/lists/${j.list_id}">${esc(j.list_number)}</a>` : '–'}</td><td>${esc(j.printer_name || '')}</td><td>${esc(j.user_name || '')}</td>
      <td>${j.status === 'ok' ? '<span class="badge st-green">OK</span>' : `<span class="badge st-red">Fehler</span> <small class="text-red">${esc(j.error)}</small>`}</td>
      <td><button class="btn btn-sm" data-re="${j.id}">Erneut drucken</button></td></tr>`).join('')}</tbody></table></div>` : emptyState('Noch keine Druckaufträge.');
    box.querySelectorAll('[data-re]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try { const r = await post(`/api/print-jobs/${b.dataset.re}/reprint`, {}); toast(r.status === 'ok' ? 'Erneut gedruckt.' : `Fehler: ${r.error}`, r.status === 'ok' ? 'success' : 'error'); loadJobs(); } catch (e) { toast(e.message, 'error'); } finally { b.disabled = false; }
    }));
  }

  function edit(p) {
    const d = p || { protocol: 'escpos_tcp', port: 9100, paper_width: 80, chars_per_line: 48, codepage: 'cp858', auto_cut: 1, active: 1, is_default: 0 };
    const m = modal({
      title: p ? `Drucker: ${p.name}` : 'Neuer Bondrucker', wide: true,
      body: `<form id="pf" class="form-grid form-2col">
        <label class="field"><span>Druckername *</span><input name="name" value="${esc(d.name || '')}" placeholder="z. B. Bar TM-m30II" required></label>
        <label class="field"><span>Druckprotokoll</span><select name="protocol">${Object.entries(PROTO).map(([k, l]) => `<option value="${k}" ${d.protocol === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field net"><span>IP-Adresse / Hostname *</span><input name="host" value="${esc(d.host || '')}" placeholder="192.168.1.50" inputmode="decimal"></label>
        <label class="field net"><span>Port</span><input name="port" value="${d.port || ''}" inputmode="numeric"></label>
        <label class="field win span2"><span>Windows-Druckername *</span><div class="row"><input name="windows_name" value="${esc(d.windows_name || '')}" list="winp"><button type="button" class="btn btn-sm" id="findwin">Drucker suchen</button></div><datalist id="winp"></datalist></label>
        <label class="field"><span>Papierbreite</span><select name="paper_width"><option value="80">80 mm</option><option value="58">58 mm</option></select></label>
        <label class="field"><span>Zeichen pro Zeile</span><input name="chars_per_line" value="${d.chars_per_line}" inputmode="numeric"></label>
        <label class="field"><span>Zeichensatz (Umlaute)</span><select name="codepage"><option value="cp858">PC858 (Euro, Umlaute) – empfohlen</option><option value="cp850">PC850</option><option value="cp437">PC437</option></select></label>
        <div class="field"><span>Optionen</span>
          <label class="check"><input type="checkbox" name="auto_cut" ${d.auto_cut ? 'checked' : ''}> Automatischer Papierabschnitt</label>
          <label class="check"><input type="checkbox" name="is_default" ${d.is_default ? 'checked' : ''}> Standarddrucker</label>
          <label class="check"><input type="checkbox" name="active" ${d.active ? 'checked' : ''}> Aktiv</label></div>
      </form>`,
      actions: [
        ...(p ? [{ label: 'Löschen', cls: 'btn-danger-ghost', onClick: async () => {
          if (!(await confirmDialog(`Drucker „${p.name}“ löschen?`, { danger: true, ok: 'Löschen' }))) return false;
          await del(`/api/printers/${p.id}`); toast('Drucker gelöscht.', 'success'); load();
        } }] : []),
        { label: 'Abbrechen' },
        { label: 'Speichern', cls: 'btn-primary', onClick: async (mm) => {
          const f = mm.body.querySelector('#pf');
          const body = { name: f.name.value, protocol: f.protocol.value, host: f.host.value.trim(), port: f.port.value, windows_name: f.windows_name.value, paper_width: Number(f.paper_width.value), chars_per_line: Number(f.chars_per_line.value), codepage: f.codepage.value, auto_cut: f.auto_cut.checked, is_default: f.is_default.checked, active: f.active.checked };
          if (p) await put(`/api/printers/${p.id}`, body); else await post('/api/printers', body);
          toast('Drucker gespeichert. Tipp: Testdruck ausführen.', 'success'); load();
        } },
      ],
    });
    const f = m.body.querySelector('#pf');
    f.paper_width.value = String(d.paper_width); f.codepage.value = d.codepage;
    const sync = () => {
      const win = f.protocol.value === 'windows_raw';
      m.body.querySelectorAll('.net').forEach((x) => { x.hidden = win; });
      m.body.querySelectorAll('.win').forEach((x) => { x.hidden = !win; });
    };
    f.protocol.addEventListener('change', () => { if (!f.port.value || ['9100', '80'].includes(f.port.value)) f.port.value = f.protocol.value === 'epos_http' ? 80 : 9100; sync(); });
    f.paper_width.addEventListener('change', () => { f.chars_per_line.value = f.paper_width.value === '58' ? 32 : 48; });
    sync();
    m.body.querySelector('#findwin').addEventListener('click', async () => {
      const r = await get('/api/printers-windows');
      if (!r.available) return toast(r.error || 'Windows-Drucker nicht verfügbar.', 'error');
      m.body.querySelector('#winp').innerHTML = r.printers.map((x) => `<option value="${esc(x.name)}">${esc(x.driver)} – ${esc(x.port)}</option>`).join('');
      toast(`${r.printers.length} Windows-Drucker gefunden – im Feld auswählen.`, 'info');
    });
  }

  await Promise.all([load(), loadJobs()]);
}
