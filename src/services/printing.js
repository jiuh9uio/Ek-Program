'use strict';
const { unprocessable, notFound } = require('../http/core');
const receipt = require('../print/receipt');
const transport = require('../print/transport');
const { loadList, logEvent } = require('./lists');
const { audit } = require('./audit');

// Druckaufträge je Drucker nacheinander abarbeiten (keine überlappenden Verbindungen)
const queues = new Map();
function enqueue(printerId, fn) {
  const prev = queues.get(printerId) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  const tail = next.catch(() => {}).finally(() => { if (queues.get(printerId) === tail) queues.delete(printerId); });
  queues.set(printerId, tail);
  return next;
}

function getPrinter(db, printerId) {
  const p = printerId
    ? db.get('SELECT * FROM printers WHERE id = ?', printerId)
    : db.get('SELECT * FROM printers WHERE is_default = 1 AND active = 1') || db.get('SELECT * FROM printers WHERE active = 1 ORDER BY id LIMIT 1');
  if (!p) throw unprocessable('Kein Drucker eingerichtet. Bitte unter "Drucker" einen Bondrucker anlegen.');
  if (!p.active) throw unprocessable(`Drucker "${p.name}" ist deaktiviert.`);
  return p;
}

async function sendDoc(printer, doc) {
  const width = printer.chars_per_line || 48;
  if (printer.protocol === 'escpos_tcp') {
    if (!printer.host) throw unprocessable('Für den Drucker ist keine IP-Adresse hinterlegt.');
    await transport.sendTcp(printer.host, printer.port || 9100, receipt.toEscPos(doc, { width, codepage: printer.codepage, cut: !!printer.auto_cut }));
  } else if (printer.protocol === 'epos_http') {
    if (!printer.host) throw unprocessable('Für den Drucker ist keine IP-Adresse hinterlegt.');
    await transport.sendEpos(printer.host, printer.port || 80, receipt.toEposXml(doc, { width, cut: !!printer.auto_cut }));
  } else if (printer.protocol === 'windows_raw') {
    if (!printer.windows_name) throw unprocessable('Kein Windows-Druckername hinterlegt.');
    await transport.sendWindowsRaw(printer.windows_name, receipt.toEscPos(doc, { width, codepage: printer.codepage, cut: !!printer.auto_cut }));
  } else {
    throw unprocessable('Unbekanntes Druckprotokoll.');
  }
}

/** Druckt ein Dokument und protokolliert den Auftrag (auch Fehler). */
async function printDoc(db, user, printer, doc, { kind, title, listId = null }) {
  let status = 'ok';
  let error = null;
  try {
    await enqueue(printer.id, () => sendDoc(printer, doc));
  } catch (e) {
    status = 'error';
    error = e.message;
  }
  const t = new Date().toISOString();
  const jobId = Number(db.run(`INSERT INTO print_jobs(printer_id, printer_name, list_id, kind, title, status, error, user_id, user_name, at, doc)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`, printer.id, printer.name, listId, kind, title, status, error, user.id, user.display_name, t, JSON.stringify(doc)).lastInsertRowid);
  db.run('UPDATE printers SET last_status = ?, last_status_at = ? WHERE id = ?', status === 'ok' ? 'Letzter Druck erfolgreich' : `Fehler: ${error}`, t, printer.id);
  if (listId) logEvent(db, listId, user, status === 'ok' ? 'Bon gedruckt' : 'Druckfehler', { drucker: printer.name, art: title, fehler: error || undefined });
  return { job_id: jobId, status, error, printer: printer.name };
}

function listDocs(db, user, listId, opts) {
  const list = loadList(db, listId);
  if (!list.items.length) throw unprocessable('Die Liste enthält keine Positionen.');
  const printer = opts.printer;
  const width = printer ? printer.chars_per_line : 48;
  const company = db.getSetting('company_name', '');
  const base = { width, company, userName: user.display_name, groupBy: opts.groupBy || 'category', onlyOpen: !!opts.onlyOpen, showPrices: !!opts.showPrices };
  if (!opts.perSupplier) {
    return [{ title: 'Einkaufsliste', doc: receipt.buildListDoc(list, base) }];
  }
  return list.supplier_groups.map((g) => ({
    title: `Lieferant ${g.supplier_name}`,
    doc: receipt.buildListDoc(list, { ...base, supplierId: g.supplier_id || 0, supplierName: g.supplier_name, groupBy: opts.groupBy === 'supplier' ? 'category' : base.groupBy }),
  })).filter((d) => d.doc.length);
}

async function printList(db, user, listId, opts = {}) {
  const printer = getPrinter(db, opts.printer_id);
  const docs = listDocs(db, user, listId, { ...opts, printer });
  const results = [];
  for (const d of docs) results.push(await printDoc(db, user, printer, d.doc, { kind: opts.perSupplier ? 'supplier' : 'list', title: d.title, listId }));
  audit(db, user, 'Einkaufsbon gedruckt', 'list', listId, { drucker: printer.name, bons: results.length, fehler: results.filter((r) => r.status === 'error').length });
  return { results };
}

function previewList(db, user, listId, opts = {}) {
  let width = 48;
  try { width = getPrinter(db, opts.printer_id).chars_per_line; } catch { /* ohne Drucker: Standardbreite */ }
  const docs = listDocs(db, user, listId, { ...opts, printer: { chars_per_line: width } });
  return { width, bons: docs.map((d) => ({ title: d.title, text: receipt.toText(d.doc, width) })) };
}

async function testPrint(db, user, printerId) {
  const printer = getPrinter(db, printerId);
  const doc = receipt.buildTestDoc(printer, { company: db.getSetting('company_name', '') });
  const r = await printDoc(db, user, printer, doc, { kind: 'test', title: 'Testdruck' });
  audit(db, user, 'Testdruck', 'printer', printer.id, { status: r.status, fehler: r.error });
  return r;
}

async function reprint(db, user, jobId, printerId) {
  const job = db.get('SELECT * FROM print_jobs WHERE id = ?', jobId);
  if (!job) throw notFound('Druckauftrag nicht gefunden.');
  const printer = getPrinter(db, printerId || job.printer_id);
  const r = await printDoc(db, user, printer, JSON.parse(job.doc), { kind: job.kind, title: `${job.title} (Nachdruck)`, listId: job.list_id });
  return r;
}

async function printerStatus(db, printerId) {
  const p = db.get('SELECT * FROM printers WHERE id = ?', printerId);
  if (!p) throw notFound('Drucker nicht gefunden.');
  let s;
  if (p.protocol === 'escpos_tcp') s = await transport.statusTcp(p.host, p.port || 9100);
  else if (p.protocol === 'epos_http') s = await transport.statusEpos(p.host, p.port || 80);
  else s = await transport.statusWindows(p.windows_name);
  db.run('UPDATE printers SET last_status = ?, last_status_at = ? WHERE id = ?', s.message, new Date().toISOString(), p.id);
  return s;
}

module.exports = { printList, previewList, testPrint, reprint, printerStatus, getPrinter, printDoc };
