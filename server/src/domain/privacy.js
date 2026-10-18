import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { all, get, run, update, tx } from '../db.js';
import { CLOSED_STATUSES } from './cases.js';
import { UPLOAD_DIR } from './documents.js';
import { revokeAllSessions } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { nowIso } from '../lib/util.js';

const inList = (a) => a.map(() => '?').join(',');

function removeFile(storageKey) {
  if (!storageKey) return;
  fs.rmSync(path.join(UPLOAD_DIR(), storageKey), { force: true });
}

/**
 * Process a data-subject request. Deletion anonymises the account and removes personal files, but keeps financial,
 * custody and audit records that must be retained; open cases block deletion until they are closed.
 */
export function processDsr(dsr, staff, { note } = {}) {
  const u = get('SELECT * FROM users WHERE id = ?', dsr.user_id);
  if (!u) throw new Error('User not found');
  let result;
  if (dsr.kind === 'deletion') {
    const open = get(`SELECT COUNT(*) AS n FROM cases WHERE customer_id = ? AND status NOT IN (${inList(CLOSED_STATUSES)})`, u.id, ...CLOSED_STATUSES).n;
    const activeBookings=get("SELECT COUNT(*) AS n FROM bookings WHERE user_id=? AND status NOT IN ('quoted','issued','cancelled')",u.id).n;
    const pendingRefunds=get("SELECT COUNT(*) AS n FROM booking_refund_requests r JOIN bookings b ON b.id=r.booking_id WHERE b.user_id=? AND r.status IN ('requested','approved_1','approved')",u.id).n;
    if(activeBookings||pendingRefunds)return {blocked:true,reason:'Open supplier bookings or refund obligations require resolution before deletion.'};
    if (open) return { blocked: true, reason: `${open} open case(s) must be completed or cancelled before the account can be deleted.` };
    tx(() => {
      const docs = all('SELECT id, storage_key FROM documents WHERE owner_user_id = ? AND deleted_at IS NULL', u.id);
      for (const d of docs) { removeFile(d.storage_key); update('documents', d.id, { deleted_at: nowIso(), storage_key: null, extracted: '{}', holder_name: null, doc_number: null }); }
      run("UPDATE profiles SET full_name = 'Deleted profile', dob = NULL, passport_no = NULL, emirates_id = NULL, email = NULL, phone = NULL, nationality = NULL, guardian_note = NULL, invite_token = NULL WHERE owner_user_id = ?", u.id);
      run("UPDATE bookings SET details='{}' WHERE user_id=? AND status IN ('quoted','issued','cancelled')",u.id);
      run('DELETE FROM push_subscriptions WHERE user_id = ?', u.id);
      run('DELETE FROM user_tokens WHERE user_id = ?', u.id);
      run('DELETE FROM sso_identities WHERE user_id = ?', u.id);
      run('DELETE FROM consents WHERE user_id = ?', u.id);
      run('DELETE FROM notifications WHERE user_id = ?', u.id);
      update('users', u.id, { name: 'Deleted user', email: `deleted-${u.id}@anonymised.invalid`, phone: null, status: 'disabled', mfa_secret: null, mfa_enabled: 0, anonymised_at: nowIso() });
      revokeAllSessions(u.id);
    });
    result = `Account anonymised; ${all('SELECT 1 FROM documents WHERE owner_user_id = ? AND deleted_at IS NOT NULL', u.id).length} file(s) removed. Financial, custody and audit records are retained as required by law.`;
  } else if (dsr.kind === 'access' || dsr.kind === 'export') {
    result = 'Your data export is available from Account → Privacy → Download my data.';
  } else {
    result = note || 'Correction handled by support.';
  }
  update('dsr_requests', dsr.id, { status: 'resolved', resolved_at: nowIso(), processed_at: nowIso(), result });
  audit(staff, 'dsr.process', 'dsr', dsr.id, { kind: dsr.kind });
  return { blocked: false, result };
}

/** Delete files of long-closed cases once the retention period has passed. Workspace documents the user chose to store are kept. */
export function applyRetention({ days = config.retentionDays, dryRun = false } = {}) {
  const cutoff = new Date(config.now().getTime() - days * 86400000).toISOString().replace('T', ' ').slice(0, 19);
  const rows = all(`SELECT d.id, d.storage_key FROM documents d JOIN cases c ON c.id = d.case_id
    WHERE d.deleted_at IS NULL AND d.storage_key IS NOT NULL AND c.status IN (${inList(CLOSED_STATUSES)}) AND c.updated_at < ?`, ...CLOSED_STATUSES, cutoff);
  if (!dryRun) {
    for (const d of rows) { removeFile(d.storage_key); update('documents', d.id, { deleted_at: nowIso(), storage_key: null }); }
    if (rows.length) audit(null, 'retention.purge', 'documents', null, { count: rows.length, older_than_days: days });
  }
  return rows.length;
}

/** Expire old tokens, idempotency keys and revoked sessions. */
export function housekeeping() {
  run("DELETE FROM user_tokens WHERE expires_at < datetime('now', '-7 days')");
  run("DELETE FROM idempotency_keys WHERE created_at < datetime('now', '-2 days')");
  run("DELETE FROM sessions WHERE expires_at < datetime('now', '-7 days')");
}
