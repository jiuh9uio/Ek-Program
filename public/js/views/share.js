// Ausgabe einer Einkaufsliste: PDF ansehen, A4 drucken, Bon drucken, E-Mail senden.
import { get, post } from '../api.js';
import { esc, toast, modal, download } from '../ui.js';
import { can } from '../app.js';
import { sound, haptic, checkAchievements } from '../reward.js';

const noop = () => {};

/** Vier große Ausgabe-Knöpfe (HTML); mit bindShare() aktivieren. */
export function shareButtons(listId, { big = true } = {}) {
  if (!can('print')) return '';
  const b = (k, icon, label, sub) => `<button type="button" class="share-btn ${big ? 'share-big' : ''}" data-share="${k}" data-list="${listId}"><span class="share-ico">${icon}</span><span><strong>${label}</strong>${sub && big ? `<small>${sub}</small>` : ''}</span></button>`;
  return `<div class="share-grid ${big ? '' : 'share-compact'}">
    ${b('pdf', '📄', 'PDF ansehen', 'öffnen, speichern, teilen')}
    ${b('a4', '🖨️', 'A4 drucken', 'Bürodrucker')}
    ${b('bon', '🧾', 'Bon drucken', 'Bondrucker 80 mm')}
    ${b('mail', '✉️', 'E-Mail senden', 'PDF als Anhang')}
  </div>`;
}

export function bindShare(root, { onDone = noop } = {}) {
  root.querySelectorAll('[data-share]').forEach((btn) => btn.addEventListener('click', () => {
    const id = Number(btn.dataset.list);
    const k = btn.dataset.share;
    if (k === 'pdf') openPdf(id);
    else if (k === 'a4') printA4(id);
    else if (k === 'bon') printBonDialog(id, { onDone });
    else if (k === 'mail') emailDialog(id, { onDone });
  }));
}

const groupPref = () => localStorage.getItem('ek.share.group') || 'supplier';

export function openPdf(id) {
  window.open(`/api/lists/${id}/pdf?group=${groupPref()}&prices=1&inline=1`, '_blank');
}

/** A4: druckfertige Seite in neuem Fenster, Druckdialog öffnet sich automatisch. */
export function printA4(id) {
  const w = window.open(`/print.html#${id}/${groupPref()}`, '_blank', 'width=900,height=1000');
  if (!w) toast('Das Druckfenster wurde blockiert – bitte Pop-ups für EK-Service erlauben.', 'error');
}

export function pdfOptionsDialog(id) {
  modal({
    title: 'PDF exportieren',
    body: `<form id="pdff" class="form-grid">
      <label class="field"><span>Gruppierung</span><select name="group"><option value="supplier">nach Lieferant</option><option value="category">nach Kategorie</option><option value="location">nach Lagerort</option></select></label>
      <label class="check"><input type="checkbox" name="prices" checked> Preise und Summen anzeigen</label></form>`,
    onOpen: (m) => { m.body.querySelector('[name=group]').value = groupPref(); },
    actions: [{ label: 'Abbrechen' }, {
      label: 'Öffnen', onClick: (m) => { const f = m.body.querySelector('#pdff'); localStorage.setItem('ek.share.group', f.group.value); window.open(`/api/lists/${id}/pdf?group=${f.group.value}&prices=${f.prices.checked ? 1 : 0}&inline=1`, '_blank'); },
    }, {
      label: 'Herunterladen', cls: 'btn-primary', onClick: (m) => { const f = m.body.querySelector('#pdff'); localStorage.setItem('ek.share.group', f.group.value); download(`/api/lists/${id}/pdf?group=${f.group.value}&prices=${f.prices.checked ? 1 : 0}`); },
    }],
  });
}

export async function printBonDialog(id, { onDone = noop } = {}) {
  let printers = [];
  try { printers = (await get('/api/printers')).filter((p) => p.active); } catch (e) { toast(e.message, 'error'); return; }
  if (!printers.length) {
    toast('Kein Bondrucker eingerichtet.' + (can('printers.manage') ? ' Bitte unter „Drucker“ anlegen.' : ' Bitte Administrator informieren.'), 'error');
    return;
  }
  const prefs = JSON.parse(localStorage.getItem('ek.print.prefs') || '{"group_by":"category","per_supplier":false,"only_open":false,"show_prices":false}');
  const opts = (m) => { const ff = m.body.querySelector('#pf'); return { printer_id: Number(ff.printer_id.value), group_by: ff.group_by.value, per_supplier: ff.per_supplier.checked, only_open: ff.only_open.checked, show_prices: ff.show_prices.checked }; };
  const m = modal({
    title: 'Einkaufsbon drucken', wide: true,
    body: `<div class="print-grid"><form id="pf" class="form-grid">
      <label class="field"><span>Drucker</span><select name="printer_id">${printers.map((p) => `<option value="${p.id}" ${p.is_default ? 'selected' : ''}>${esc(p.name)}${p.is_default ? ' (Standard)' : ''}</option>`).join('')}</select></label>
      <label class="field"><span>Gruppierung auf dem Bon</span><select name="group_by"><option value="category">nach Kategorie</option><option value="location">nach Lagerort</option><option value="supplier">nach Lieferant</option></select></label>
      <label class="check"><input type="checkbox" name="per_supplier"> Separaten Bon je Lieferant drucken</label>
      <label class="check"><input type="checkbox" name="only_open"> Nur offene (nicht eingekaufte/gelieferte) Positionen</label>
      <label class="check"><input type="checkbox" name="show_prices"> Geschätzte Preise drucken</label>
      <div class="muted small" id="pstatus"></div>
    </form><pre class="bon-preview" id="pv">Vorschau …</pre></div>`,
    actions: [{ label: 'Abbrechen' }, {
      label: '🧾 Drucken', cls: 'btn-primary', onClick: async (mm) => {
        const body = opts(mm);
        localStorage.setItem('ek.print.prefs', JSON.stringify(body));
        const r = await post(`/api/lists/${id}/print`, body);
        const errs = r.results.filter((x) => x.status === 'error');
        if (errs.length) { toast(`Druckfehler: ${errs[0].error}`, 'error', 9000); onDone(); return false; }
        toast(`${r.results.length} Bon(s) an ${r.results[0].printer} gesendet.`, 'success');
        sound.success(); haptic(15); checkAchievements();
        onDone();
      },
    }],
  });
  const f = m.body.querySelector('#pf');
  f.group_by.value = prefs.group_by; f.per_supplier.checked = prefs.per_supplier; f.only_open.checked = prefs.only_open; f.show_prices.checked = prefs.show_prices;
  const preview = async () => {
    try {
      const r = await post(`/api/lists/${id}/preview`, opts(m), { quiet: true });
      m.body.querySelector('#pv').textContent = r.bons.map((b) => b.text).join('\n\n✂ - - - - - - - - - - - - - - - - - - - - - - -\n\n');
      m.body.querySelector('#pv').style.setProperty('--cols', r.width);
    } catch (e) { m.body.querySelector('#pv').textContent = e.message; }
  };
  const status = async () => {
    const ps = m.body.querySelector('#pstatus');
    ps.textContent = 'Druckerstatus wird abgefragt …';
    try { const s = await get(`/api/printers/${f.printer_id.value}/status`, { quiet: true }); ps.innerHTML = `${s.online ? '🟢' : '🔴'} ${esc(s.message)}`; } catch (e) { ps.textContent = e.message; }
  };
  f.addEventListener('change', (e) => { preview(); if (e.target.name === 'printer_id') status(); });
  preview(); status();
}

export async function emailDialog(id, { onDone = noop } = {}) {
  let d;
  try { d = await get(`/api/lists/${id}/email-defaults`); } catch (e) { toast(e.message, 'error'); return; }
  if (!d.configured) {
    modal({
      title: 'E-Mail senden',
      body: `<p>Der E-Mail-Versand ist noch nicht eingerichtet.${can('system.manage') ? ' Bitte unter <b>System → E-Mail-Versand</b> den Mailserver eintragen (z. B. Gmail, Outlook, IONOS).' : ' Bitte den Administrator bitten, den E-Mail-Versand unter „System“ einzurichten.'}</p>
        <p class="muted">Alternativ: PDF herunterladen und im eigenen E-Mail-Programm anhängen, oder die Liste als Text im E-Mail-Programm öffnen.</p>`,
      actions: [{ label: 'Schließen' },
        { label: 'PDF herunterladen', onClick: () => download(`/api/lists/${id}/pdf?group=${groupPref()}`) },
        { label: 'Im E-Mail-Programm öffnen', cls: 'btn-primary', onClick: () => { location.href = `mailto:${encodeURIComponent(d.default_to || '')}?subject=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(d.message)}`; } }],
    });
    return;
  }
  const m = modal({
    title: 'Einkaufsliste per E-Mail senden', wide: true,
    body: `<form id="mf" class="form-grid">
      <label class="field"><span>An * (mehrere mit Komma trennen)</span><input name="to" type="text" inputmode="email" autocapitalize="none" value="${esc(d.default_to || '')}"></label>
      ${d.suppliers.length ? `<div class="chips">${d.suppliers.map((s) => `<button type="button" class="chip" data-add="${esc(s.email)}">+ ${esc(s.name)} &lt;${esc(s.email)}&gt;</button>`).join('')}</div>` : ''}
      <label class="field"><span>Kopie (CC, optional)</span><input name="cc" type="text" inputmode="email" autocapitalize="none"></label>
      <label class="field"><span>Betreff</span><input name="subject" value="${esc(d.subject)}"></label>
      <label class="field"><span>Nachricht</span><textarea name="message" rows="8">${esc(d.message)}</textarea></label>
      <div class="form-2col form-grid">
        <label class="field"><span>PDF gruppiert</span><select name="group"><option value="supplier">nach Lieferant</option><option value="category">nach Kategorie</option><option value="location">nach Lagerort</option></select></label>
        <label class="check"><input type="checkbox" name="prices" checked> Preise im PDF</label>
      </div>
      <p class="muted small">📎 Anhang: Einkaufsliste als PDF</p>
    </form>`,
    actions: [{ label: 'Abbrechen' }, {
      label: '✉️ Senden', cls: 'btn-primary', onClick: async (mm) => {
        const f = mm.body.querySelector('#mf');
        if (!f.to.value.trim()) throw new Error('Bitte einen Empfänger eingeben.');
        const r = await post(`/api/lists/${id}/email`, { to: f.to.value, cc: f.cc.value, subject: f.subject.value, message: f.message.value, group: f.group.value, prices: f.prices.checked });
        toast(`E-Mail an ${[...r.to, ...r.cc].join(', ')} gesendet. ✉️`, 'success', 5000);
        sound.success(); haptic(15); checkAchievements();
        onDone();
      },
    }],
  });
  const f = m.body.querySelector('#mf');
  f.group.value = groupPref();
  m.body.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => {
    const cur = f.to.value.split(/[,;]\s*/).map((s) => s.trim()).filter(Boolean);
    if (!cur.includes(b.dataset.add)) cur.push(b.dataset.add);
    f.to.value = cur.join(', ');
  }));
}
