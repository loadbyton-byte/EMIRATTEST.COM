import crypto from 'node:crypto';
import { get, all, run } from '../db.js';

/** Append to the hash-chained audit log. Each row's hash covers the previous hash, making tampering detectable. */
export function audit(actor, action, entity, entityId, detail = {}) {
  const prev = get('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1')?.hash || 'GENESIS';
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const actorId = actor?.id ?? null;
  const label = actor ? `${actor.name} (${actor.role})` : 'system';
  const body = JSON.stringify(detail);
  const hash = crypto.createHash('sha256').update([prev, ts, actorId, action, entity, entityId == null ? null : String(entityId), body].join('|')).digest('hex');
  run('INSERT INTO audit_log(ts,actor_user_id,actor_label,action,entity,entity_id,detail,prev_hash,hash) VALUES(?,?,?,?,?,?,?,?,?)',
    ts, actorId, label, action, entity ?? null, entityId == null ? null : String(entityId), body, prev, hash);
}

export function verifyAuditChain() {
  const rows = all('SELECT * FROM audit_log ORDER BY id ASC');
  let prev = 'GENESIS';
  for (const r of rows) {
    const h = crypto.createHash('sha256').update([prev, r.ts, r.actor_user_id, r.action, r.entity, r.entity_id, r.detail].join('|')).digest('hex');
    if (r.prev_hash !== prev || r.hash !== h) return { ok: false, brokenAt: r.id, checked: rows.length };
    prev = r.hash;
  }
  return { ok: true, checked: rows.length };
}
