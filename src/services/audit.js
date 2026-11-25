'use strict';
/** Änderungsprotokoll (Audit-Log) für alle relevanten Aktionen. */
function audit(db, user, action, entity = null, entityId = null, details = null) {
  db.run('INSERT INTO audit_log(at, user_id, user_name, action, entity, entity_id, details) VALUES(?,?,?,?,?,?,?)',
    new Date().toISOString(), user ? user.id : null, user ? user.display_name : 'System', action, entity,
    entityId === null || entityId === undefined ? null : Number(entityId),
    details === null || details === undefined ? null : JSON.stringify(details));
}

/** Ermittelt geänderte Felder zwischen altem und neuem Datensatz. */
function diff(before, after, fields) {
  const changes = {};
  for (const f of fields) {
    const a = before ? before[f] : undefined;
    const b = after[f];
    if (b === undefined) continue;
    const norm = (v) => (v === undefined || v === '' ? null : v);
    if (String(norm(a)) !== String(norm(b))) changes[f] = { von: norm(a), nach: norm(b) };
  }
  return changes;
}

module.exports = { audit, diff };
