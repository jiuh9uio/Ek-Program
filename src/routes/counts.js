'use strict';
const { RawResponse, forbidden } = require('../http/core');
const C = require('../services/counts');

const csvCell = (x) => { if (x === null || x === undefined) return ''; const s = typeof x === 'number' ? String(x).replace('.', ',') : String(x); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

module.exports = function register(router) {
  const perm = ['stock.count'];
  router.get('/api/counts', { perm }, ({ db }) => C.listCounts(db));
  router.post('/api/counts', { perm: 'list.create' }, ({ db, user, body, can }) => {
    if (!can('stock.count')) throw forbidden('Keine Berechtigung für Bestandskontrollen.');
    return C.loadCount(db, C.createCount(db, user, body));
  });
  router.get('/api/counts/:id', { perm }, ({ db, params }) => C.loadCount(db, Number(params.id)));
  router.post('/api/counts/:id/items/:itemId', { perm }, ({ db, user, can, params, body }) => C.recordItem(db, user, can, Number(params.id), Number(params.itemId), body));
  router.post('/api/counts/:id/complete', { perm }, ({ db, user, params }) => C.completeCount(db, user, Number(params.id)));
  router.get('/api/counts/:id/export.csv', { perm }, ({ db, params }) => {
    const c = C.loadCount(db, Number(params.id));
    const lines = ['Nr;Artikelnummer;Artikel;Lagerort;Einheit;Soll (letzter Bestand);Gezählt;Differenz;Bestellt;Gezählt von;Zeitpunkt'];
    for (const i of c.items) lines.push([i.seq, i.article_no, i.name, i.location_name, i.unit_plural, i.expected_qty, i.counted_qty, i.difference, i.order ? i.order.qty : null, i.counted_by_name, i.counted_at].map(csvCell).join(';'));
    return new RawResponse('﻿' + lines.join('\r\n'), 'text/csv; charset=utf-8', `Zaehlung_${c.number}.csv`);
  });
};
