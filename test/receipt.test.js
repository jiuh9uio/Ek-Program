'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/print/receipt');
const T = require('../src/print/transport');
const { listPdf } = require('../src/print/pdf');

const list = {
  number: 'EK-00001', title: null, note: null, status: 'draft', status_label: 'Entwurf', created_at: new Date().toISOString(), created_by_name: 'Service',
  items: [
    { article_name: 'Coca-Cola', qty: 8, unit_name: 'Kasten', unit_plural: 'Kästen', category_name: 'Alkoholfreie Getränke', category_sort: 10, supplier_id: 1, supplier_name: 'Huber', unit_price_est: 14.9, est_total: 119.2, open_qty: 8 },
    { article_name: 'Bacardi', qty: 1, unit_name: 'Flasche', unit_plural: 'Flaschen', category_name: 'Spirituosen', category_sort: 50, supplier_id: 2, supplier_name: 'Metro', unit_price_est: 11.2, est_total: 11.2, open_qty: 1 },
    { article_name: 'Jack Daniel’s Tennessee Whiskey Old No. 7 Extra Long Name', qty: 3, unit_name: 'Flasche', unit_plural: 'Flaschen', category_name: 'Spirituosen', category_sort: 50, supplier_id: 2, supplier_name: 'Metro', unit_price_est: 17.9, est_total: 53.7, note: 'nur 0,7 l', open_qty: 3 },
  ],
  supplier_groups: [{ supplier_id: 1, supplier_name: 'Huber', est_total: 119.2, min_order_value: 150, below_min_order: true, missing_to_min: 30.8 }, { supplier_id: 2, supplier_name: 'Metro', est_total: 64.9 }],
  totals: { est_goods: 184.1, shipping: 0, est_total: 184.1, actual_goods: null },
  actual_cost: null,
};

test('Bon-Layout: Kopf, Gruppen, Checkboxen, Einheiten (Ein-/Mehrzahl), Positionszahl', () => {
  const doc = R.buildListDoc(list, { width: 48, userName: 'Service', company: 'Hotel' });
  const text = R.toText(doc, 48);
  assert.match(text, /S E R V I C E - E I N K A U F/);
  assert.match(text, /Liste: EK-00001/);
  assert.match(text, /ALKOHOLFREIE GETRÄNKE/);
  assert.match(text, /\[ \] Coca-Cola\s+8 Kästen/);
  assert.match(text, /\[ \] Bacardi\s+1 Flasche\n/);
  assert.match(text, /Positionen: 3/);
  for (const line of text.split('\n')) assert.ok(line.length <= 48, `Zeile zu lang: "${line}"`);
  assert.ok(text.indexOf('ALKOHOLFREIE') < text.indexOf('SPIRITUOSEN'), 'Kategorien-Reihenfolge');
});

test('Separater Bon je Lieferant filtert Positionen', () => {
  const doc = R.buildListDoc(list, { width: 48, supplierId: 2, supplierName: 'Metro' });
  const text = R.toText(doc, 48);
  assert.doesNotMatch(text, /Coca-Cola/);
  assert.match(text, /Lieferant: Metro/);
  assert.match(text, /Positionen: 2/);
});

test('58-mm-Bon (32 Zeichen) bricht sauber um', () => {
  const text = R.toText(R.buildListDoc(list, { width: 32 }), 32);
  for (const line of text.split('\n')) assert.ok(line.length <= 32, `Zeile zu lang: "${line}"`);
});

test('ESC/POS: Init, Codepage PC858, Umlaute, Schnitt', () => {
  const buf = R.toEscPos(R.buildListDoc(list, { width: 48 }), { width: 48, codepage: 'cp858', cut: true });
  assert.deepEqual([...buf.subarray(0, 5)], [0x1B, 0x40, 0x1B, 0x74, 19]);
  assert.ok(buf.includes(Buffer.from([0x4B, 0x84, 0x73, 0x74, 0x65, 0x6E])), 'Kästen in CP858'); // "Kästen"
  const tail = [...buf.subarray(buf.length - 4)];
  assert.deepEqual(tail.slice(0, 3), [0x1D, 0x56, 0x42]);
  const noCut = R.toEscPos([{ text: 'x', align: 'left' }], { cut: false });
  assert.ok(!noCut.includes(Buffer.from([0x1D, 0x56])));
});

test('Zeichenkodierung: € in CP858, Ersatz in CP437', () => {
  assert.deepEqual(R.encodeText('€', 'cp858'), [0xD5]);
  assert.deepEqual(R.encodeText('€', 'cp437'), [0x45, 0x55, 0x52]);
  assert.deepEqual(R.encodeText('ß', 'cp437'), [0xE1]);
  assert.deepEqual(R.encodeText('’', 'cp858'), [0x27]);
});

test('ePOS-XML ist wohlgeformt und escaped', () => {
  const xml = R.toEposXml([{ text: 'A & B <C>', align: 'center', bold: true, size: 'double' }], { width: 48 });
  assert.match(xml, /<epos-print xmlns="http:\/\/www.epson-pos.com\/schemas\/2011\/03\/epos-print">/);
  assert.match(xml, /A &amp; B &lt;C&gt;/);
  assert.match(xml, /<cut type="feed"\/>/);
});

test('DLE-EOT-Status wird korrekt ausgewertet', () => {
  assert.equal(T.parseDleEot(Buffer.from([0x12, 0x12, 0x12])).online, true);
  const paper = T.parseDleEot(Buffer.from([0x12, 0x12 | 0x20, 0x12 | 0x60]));
  assert.equal(paper.online, false);
  assert.match(paper.message, /Papier leer/);
  assert.match(T.parseDleEot(Buffer.from([0x12, 0x12 | 0x04, 0x12])).message, /Deckel offen/);
  assert.equal(T.parseDleEot(Buffer.from([0x12, 0x12, 0x12 | 0x0C])).paper_near_end, true);
});

test('ePOS-Antwort wird ausgewertet', () => {
  assert.equal(T.parseEposResponse('<response success="true" code="" status="251658262"/>').success, true);
  const r = T.parseEposResponse('<response success="false" code="EPTR_REC_EMPTY" status="524296"/>');
  assert.equal(r.success, false);
  assert.ok(r.problems.includes('Papier leer'));
});

test('PDF ist gültig aufgebaut', () => {
  const pdf = listPdf(list, { company: 'Hotel Test', groupBy: 'supplier' });
  const s = pdf.toString('latin1');
  assert.ok(s.startsWith('%PDF-1.4'));
  assert.ok(s.trimEnd().endsWith('%%EOF'));
  assert.match(s, /Mindestbestellwert/);
  // xref-Offsets prüfen
  const startxref = Number(/startxref\n(\d+)/.exec(s)[1]);
  assert.equal(s.slice(startxref, startxref + 4), 'xref');
  const offsets = [...s.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  offsets.forEach((o, i) => assert.equal(s.slice(o, o + String(i + 1).length + 6), `${i + 1} 0 obj`));
});
