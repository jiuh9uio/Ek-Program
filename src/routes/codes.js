'use strict';
/** Barcodes/QR-Codes je Artikel, Scanner-Suche, Etiketten. */
const C = require('../services/codes');
const P = require('../services/printing');
const receipt = require('../print/receipt');
const { audit } = require('../services/audit');

module.exports = function register(router) {
  // Scanner: Code → Artikel (Codes und Artikelnummer)
  router.get('/api/codes/:code', {}, ({ db, params }) => C.lookup(db, params.code));

  router.get('/api/articles/:id/codes', {}, ({ db, params }) => (C.codesFor(db, [Number(params.id)]).get(Number(params.id)) || [])
    .map((c) => ({ ...c, ean_valid: C.eanValid(c.code) })));
  router.post('/api/articles/:id/codes', { perm: 'articles.manage' }, ({ db, user, params, body }) => C.addCode(db, user, Number(params.id), body));
  router.post('/api/articles/:id/codes/generate', { perm: 'articles.manage' }, ({ db, user, params }) => C.generateOwn(db, user, Number(params.id)));
  router.delete('/api/articles/:id/codes/:codeId', { perm: 'articles.manage' }, ({ db, user, params }) => C.removeCode(db, user, Number(params.id), Number(params.codeId)));

  // Etiketten: Daten (fehlende Codes werden erzeugt, wenn berechtigt)
  router.post('/api/labels/data', { perm: ['print', 'articles.manage'] }, ({ db, user, body, can }) =>
    C.labelData(db, user, Array.isArray(body.article_ids) ? body.article_ids : [], { generate: body.generate !== false && can('articles.manage') }));

  router.post('/api/labels/print', { perm: ['print', 'articles.manage'] }, async ({ db, user, body, can }) => {
    const labels = C.labelData(db, user, Array.isArray(body.article_ids) ? body.article_ids : [], { generate: can('articles.manage') });
    const printer = P.getPrinter(db, body.printer_id ? Number(body.printer_id) : null);
    const copies = Math.min(20, Math.max(1, Number(body.copies) || 1));
    const all = labels.flatMap((l) => Array(copies).fill(l));
    const r = await P.printDoc(db, user, printer, C.labelDoc(all, printer.chars_per_line), { kind: 'label', title: `Etiketten (${all.length})` });
    audit(db, user, 'Etiketten gedruckt', 'article', null, { anzahl: all.length, drucker: printer.name, status: r.status });
    return { ...r, count: all.length, preview: receipt.toText(C.labelDoc(labels.slice(0, 3), printer.chars_per_line), printer.chars_per_line) };
  });
};
