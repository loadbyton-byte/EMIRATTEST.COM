import express, { Router } from 'express';
import crypto from 'node:crypto';
import { all, get, insert, update, run, json, tx } from '../db.js';
import { config } from '../config.js';
import { requireAuth, hashPassword } from '../lib/auth.js';
import { validate, bad, forbidden, notFound, conflict, nowIso, todayStr, addDays, money, randomToken, parseCsv, toCsv, normPhone, emailOk, daysBetween, sha256 } from '../lib/util.js';
import { audit } from '../lib/audit.js';
import { orgRole } from '../domain/access.js';
import { createCase, caseSummary, STATUS, ACTIVE_STATUSES } from '../domain/cases.js';
import { getService } from '../domain/catalog.js';
import { emitOrgEvent, runWebhookQueue } from '../domain/webhooks.js';
import { notify } from '../domain/notify.js';
import { antivirusGate } from '../lib/clamav.js';
import { storeDocument, MAX_UPLOAD, docOut } from '../domain/documents.js';
import { config as _c } from '../config.js';

export const org = Router();

/** Public invitation endpoints for employees (token is the secret). */
export const invites = Router();
const rawUpload = express.raw({ type: () => true, limit: MAX_UPLOAD + 1024 });

invites.get('/:token', (req, res) => {
  const p = get("SELECT p.*, o.name AS org_name FROM profiles p JOIN orgs o ON o.id = p.org_id WHERE p.invite_token = ?", req.params.token);
  if (!p) throw notFound('Invitation not found or already used');
  res.json({ org: p.org_name, name: p.full_name, status: p.consent_status, purposes: ['Collect and review your documents for UAE employment and residency coordination', 'Share document readiness status (not the files) with your employer HR team'], never: ['Your family records are never shared with your employer', 'Marketing or unrelated cross-selling'] });
});
invites.post('/:token/consent', (req, res) => {
  const p = get('SELECT * FROM profiles WHERE invite_token = ?', req.params.token);
  if (!p) throw notFound();
  const { agree } = validate(req.body, { agree: 'boolean!' });
  update('profiles', p.id, { consent_status: agree ? 'consented' : 'declined', invite_status: agree ? 'accepted' : 'declined' });
  audit(null, agree ? 'employee.consent' : 'employee.decline', 'profile', p.id, {});
  res.json({ ok: true, status: agree ? 'consented' : 'declined' });
});
invites.post('/:token/documents', rawUpload, async (req, res) => {
  const p = get('SELECT * FROM profiles WHERE invite_token = ?', req.params.token);
  if (!p || p.consent_status !== 'consented') throw forbidden('Consent is required before uploading documents');
  const owner = get('SELECT * FROM users WHERE id = ?', p.owner_user_id);
  const q = req.query;
  await antivirusGate(req.body);
  const d = storeDocument({ user: owner, profileId: p.id, kind: String(q.kind || 'other'), filename: String(q.filename || 'document'), buffer: req.body, meta: { holder_name: q.holder_name || p.full_name } });
  res.status(201).json({ document: docOut(d) });
});

org.use(requireAuth);
function guard(req, roles) {
  const id = Number(req.params.id);
  const m = orgRole(req.user.id, id);
  if (!m || (roles && !roles.includes(m.role))) throw forbidden('Your organisation role cannot do this');
  return { id, m, o: get('SELECT * FROM orgs WHERE id = ?', id) };
}

org.get('/:id', (req, res) => {
  const { id, m, o } = guard(req);
  const rows = all('SELECT * FROM cases WHERE org_id = ?', id);
  const active = rows.filter((c) => ACTIVE_STATUSES.includes(c.status));
  const done = rows.filter((c) => ['completed', 'dispatched', 'delivered'].includes(c.status) && c.closed_at);
  const turn = done.length ? Math.round(done.reduce((a, c) => a + daysBetween(c.created_at.slice(0, 10), c.closed_at.slice(0, 10)), 0) / done.length) : null;
  const spend = get("SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE org_id = ? AND status = 'verified'", id).s;
  const pendingApprovals = all("SELECT c.id, c.ref, c.title, q.total FROM cases c JOIN quotes q ON q.case_id = c.id AND q.status = 'awaiting_approval' WHERE c.org_id = ?", id);
  const credit = get("SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE org_id = ? AND method = 'credit_account' AND status = 'verified' AND (proof_note IS NULL OR proof_note NOT LIKE 'invoice:%')", id).s;
  res.json({ org: o, my_role: m.role, my_limit: m.approval_limit, stats: { total_cases: rows.length, active: active.length, completed: done.length, rejected: rows.filter((c) => c.status === 'rejected').length, avg_turnaround_days: turn, spend: money(spend), credit_used: money(credit), credit_limit: o.credit_limit }, by_status: Object.entries(rows.reduce((a, c) => ({ ...a, [c.status]: (a[c.status] || 0) + 1 }), {})).map(([status, n]) => ({ status, label: STATUS[status]?.label, n })), pending_approvals: pendingApprovals, subscription: get("SELECT * FROM subscriptions WHERE org_id = ? AND status = 'active'", id) || null });
});

// ---------- members ----------
org.get('/:id/members', (req, res) => { const { id } = guard(req); res.json({ members: all('SELECT u.id, u.name, u.email, m.role, m.approval_limit, m.department FROM org_members m JOIN users u ON u.id = m.user_id WHERE m.org_id = ? ORDER BY m.role, u.name', id) }); });
org.post('/:id/members', (req, res) => {
  const { id } = guard(req, ['owner']);
  const b = validate(req.body, { email: 'string!', role: ['submitter', 'approver', 'finance', 'hr', 'auditor', 'owner'], approval_limit: 'number', department: 'string' });
  const u = get('SELECT * FROM users WHERE email = ?', b.email.toLowerCase());
  if (!u) throw notFound('That person needs an Emirattest account first. A company email address alone confers no access.');
  run('INSERT INTO org_members(org_id,user_id,role,approval_limit,department) VALUES(?,?,?,?,?) ON CONFLICT(org_id,user_id) DO UPDATE SET role=excluded.role, approval_limit=excluded.approval_limit, department=excluded.department', id, u.id, b.role || 'submitter', b.approval_limit ?? 0, b.department || null);
  audit(req.user, 'org.member', 'org', id, { user: u.id, role: b.role });
  notify(u.id, { title: `You were added to ${get('SELECT name FROM orgs WHERE id = ?', id).name}`, body: `Role: ${b.role || 'submitter'}`, link: '/app/business', kind: 'org' });
  res.status(201).json({ ok: true });
});
org.delete('/:id/members/:uid', (req, res) => {
  const { id } = guard(req, ['owner']);
  if (Number(req.params.uid) === req.user.id) throw conflict('Owners cannot remove themselves');
  run('DELETE FROM org_members WHERE org_id = ? AND user_id = ?', id, Number(req.params.uid)); audit(req.user, 'org.member_remove', 'org', id, { user: req.params.uid }); res.json({ ok: true });
});

// ---------- purchasing controls ----------
org.get('/:id/purchasing', (req, res) => {
  const { id } = guard(req, ['owner', 'approver', 'finance', 'auditor']);
  const ccs = all('SELECT * FROM cost_centers WHERE org_id = ?', id).map((c) => ({ ...c, spent: get("SELECT COALESCE(SUM(p.amount),0) AS s FROM payments p JOIN cases k ON k.id = p.case_id WHERE k.cost_center_id = ? AND p.status = 'verified'", c.id).s }));
  res.json({ cost_centers: ccs, purchase_orders: all('SELECT * FROM purchase_orders WHERE org_id = ? ORDER BY id DESC', id) });
});
org.post('/:id/cost-centers', (req, res) => { const { id } = guard(req, ['owner', 'finance']); const b = validate(req.body, { code: 'string!', name: 'string!', budget: 'number' }); res.status(201).json({ id: insert('cost_centers', { org_id: id, code: b.code, name: b.name, budget: b.budget || 0 }) }); });
org.post('/:id/purchase-orders', (req, res) => { const { id } = guard(req, ['owner', 'finance', 'approver']); const b = validate(req.body, { number: 'string!', amount: 'number!', cost_center_id: 'number' }); res.status(201).json({ id: insert('purchase_orders', { org_id: id, number: b.number, amount: b.amount, cost_center_id: b.cost_center_id, created_by: req.user.id }) }); });

// ---------- bulk intake ----------
const BULK_COLS = ['service', 'full_name', 'passport_no', 'doc_count', 'destination_country', 'client_ref', 'client_alias', 'target_date', 'pickup_emirate', 'authority_confirmed'];
function validateBulk(orgId, csv) {
  const rows = parseCsv(String(csv || '').trim());
  if (rows.length < 2) throw bad('CSV needs a header row and at least one data row');
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const missing = ['service', 'full_name', 'authority_confirmed'].filter((c) => !header.includes(c));
  if (missing.length) throw bad(`Missing required column(s): ${missing.join(', ')}. Expected: ${BULK_COLS.join(', ')}`);
  const out = []; const seenRefs = new Set(); const seenKeys = new Set();
  rows.slice(1, 501).forEach((r, i) => {
    const row = Object.fromEntries(header.map((h, k) => [h, (r[k] || '').trim()]));
    const errors = []; const warnings = [];
    const svc = getService(row.service);
    if (!svc || svc.kind !== 'case') errors.push(`Unknown or non-case service "${row.service}"`);
    if (!row.full_name) errors.push('full_name required');
    if (!/^(yes|true|y|1)$/i.test(row.authority_confirmed)) errors.push('authority_confirmed must be yes — record authority to act for the applicant');
    const n = Number(row.doc_count || 1); if (!(n >= 1 && n <= 50)) errors.push('doc_count must be 1–50');
    if (row.target_date && !/^\d{4}-\d{2}-\d{2}$/.test(row.target_date)) errors.push('target_date must be YYYY-MM-DD');
    if (row.client_ref) {
      if (seenRefs.has(row.client_ref) || get('SELECT 1 AS x FROM cases WHERE org_id = ? AND client_ref = ?', orgId, row.client_ref)) errors.push(`Duplicate client_ref ${row.client_ref}`);
      seenRefs.add(row.client_ref);
    }
    const key = `${row.service}|${row.full_name.toLowerCase()}|${row.passport_no}`;
    if (seenKeys.has(key) || get("SELECT 1 AS x FROM cases c JOIN profiles p ON p.id = c.profile_id JOIN services s ON s.id = c.service_id WHERE c.org_id = ? AND s.slug = ? AND lower(p.full_name) = ? AND c.status IN ('customer_action_required','ready_for_review','quotation_awaiting_approval','awaiting_payment','assigned','collected','submitted','authority_pending','provider_pending')", orgId, row.service, row.full_name.toLowerCase())) warnings.push('Possible duplicate: an open case already exists for this person and service');
    seenKeys.add(key);
    out.push({ line: i + 2, row, errors, warnings });
  });
  return { rows: out, valid: out.filter((r) => !r.errors.length).length, invalid: out.filter((r) => r.errors.length).length, warnings: out.filter((r) => r.warnings.length).length };
}
org.post('/:id/bulk/validate', (req, res) => { const { id } = guard(req, ['owner', 'submitter']); res.json(validateBulk(id, req.body?.csv)); });
org.post('/:id/bulk/commit', (req, res) => {
  const { id } = guard(req, ['owner', 'submitter']);
  const v = validateBulk(id, req.body?.csv);
  const allowDup = !!req.body?.allowDuplicates;
  const created = [];
  for (const r of v.rows) {
    if (r.errors.length || (r.warnings.length && !allowDup)) continue;
    const pid = insert('profiles', { owner_user_id: req.user.id, org_id: id, relation: 'client', full_name: r.row.full_name, passport_no: r.row.passport_no || null, consent_status: 'authority_recorded' });
    const c = createCase(req.user, { serviceSlug: r.row.service, orgId: id, profileId: pid, docCount: Number(r.row.doc_count || 1), destinationCountry: r.row.destination_country, clientRef: r.row.client_ref, clientAlias: r.row.client_alias, targetDate: r.row.target_date || undefined, pickupEmirate: r.row.pickup_emirate || undefined, channel: 'bulk' });
    created.push({ line: r.line, id: c.id, ref: c.ref });
  }
  audit(req.user, 'org.bulk_commit', 'org', id, { created: created.length, skipped: v.rows.length - created.length });
  res.status(201).json({ created, skipped: v.rows.length - created.length, note: 'Bulk submission never bypasses consent, readiness review or price approval: each case still needs documents, a reviewed quotation and approval.' });
});
org.get('/:id/bulk/template', (req, res) => { res.type('text/csv').send(`${BULK_COLS.join(',')}\neducational-attestation,Aisha Khan,P1234567,2,India,CLIENT-001,Client A,${addDays(todayStr(), 21)},Dubai,yes\n`); });

// ---------- employee readiness ----------
const REQUIRED_KINDS = ['passport', 'photo', 'degree', 'offer_letter'];
org.post('/:id/employees', (req, res) => {
  const { id, o } = guard(req, ['owner', 'hr']);
  const b = validate(req.body, { full_name: 'string!', email: 'string', phone: 'string' });
  const token = randomToken(18);
  const pid = insert('profiles', { owner_user_id: req.user.id, org_id: id, relation: 'employee', full_name: b.full_name, email: b.email, phone: normPhone(b.phone), consent_status: 'invited', invite_token: token, invite_status: 'sent' });
  insert('outbox', { channel: b.phone ? 'whatsapp' : 'email', to_addr: b.phone ? normPhone(b.phone).replace('+', '') : b.email || 'n/a', subject: `${o.name} invited you`, body: `${o.name} invited you to prepare your documents with Emirattest: ${config.baseUrl}/invite/${token}. We never ask for passwords or UAE Pass codes.`, status: 'pending' });
  audit(req.user, 'employee.invite', 'profile', pid, {});
  res.status(201).json({ profile_id: pid, invite_url: `/invite/${token}` });
});
org.get('/:id/employees', (req, res) => {
  const { id } = guard(req, ['owner', 'hr']);
  const profs = all("SELECT * FROM profiles WHERE org_id = ? AND relation = 'employee' ORDER BY full_name", id);
  const employees = profs.map((p) => {
    const consented = p.consent_status === 'consented';
    const kinds = consented ? all("SELECT DISTINCT kind FROM documents WHERE profile_id = ? AND deleted_at IS NULL AND scan_status = 'clean'", p.id).map((d) => d.kind) : [];
    const missing = consented ? REQUIRED_KINDS.filter((k) => !kinds.includes(k)) : REQUIRED_KINDS;
    const cs = consented ? all("SELECT ref, status, title, target_date FROM cases WHERE profile_id = ? AND org_id = ?", p.id, id) : [];
    // HR sees readiness only — never family/personal files. Document names are not exposed.
    return { id: p.id, name: p.full_name, email: p.email, consent: p.consent_status, invite_status: p.invite_status, provided: kinds, missing, blockers: cs.filter((c) => ['customer_action_required', 'correction_required', 'rejected'].includes(c.status)).map((c) => `${c.ref}: ${STATUS[c.status].label}`), cases: cs, ready: consented && missing.length === 0 };
  });
  res.json({ required: REQUIRED_KINDS, employees, summary: { total: employees.length, ready: employees.filter((e) => e.ready).length, awaiting_consent: employees.filter((e) => e.consent === 'invited').length } });
});

// ---------- finance ----------
org.get('/:id/invoices', (req, res) => { const { id } = guard(req, ['owner', 'finance', 'auditor']); res.json({ invoices: all('SELECT * FROM invoices WHERE org_id = ? ORDER BY id DESC', id).map((i) => ({ ...i, lines: json(i.lines, []) })) }); });
org.post('/:id/invoices/generate', (req, res) => {
  const { id } = guard(req, ['owner', 'finance']);
  const pays = all("SELECT p.*, c.ref, c.title, c.po_number FROM payments p JOIN cases c ON c.id = p.case_id WHERE p.org_id = ? AND p.method = 'credit_account' AND p.status = 'verified' AND (p.proof_note IS NULL OR p.proof_note NOT LIKE 'invoice:%')", id);
  if (!pays.length) throw conflict('Nothing to invoice');
  const total = money(pays.reduce((a, p) => a + p.amount, 0));
  const vat = money(total - total / (1 + config.vatRate));
  const number = `INV-${new Date().getUTCFullYear()}-${String(get('SELECT COUNT(*) AS n FROM invoices').n + 1).padStart(5, '0')}`;
  const iid = insert('invoices', { number, org_id: id, user_id: req.user.id, period: todayStr().slice(0, 7), lines: pays.map((p) => ({ case: p.ref, description: p.title, amount: p.amount, po: p.po_number })), subtotal: money(total - vat), vat, total, due_date: addDays(todayStr(), 30), status: 'issued' });
  pays.forEach((p) => update('payments', p.id, { proof_note: `invoice:${iid}` }));
  audit(req.user, 'invoice.generate', 'invoice', iid, { total });
  res.status(201).json({ invoice: get('SELECT * FROM invoices WHERE id = ?', iid) });
});

org.get('/:id/reports/:type', (req, res) => {
  const { id } = guard(req, ['owner', 'finance', 'auditor', 'approver', 'hr']);
  const cs = all('SELECT c.*, s.name_en AS service, s.category FROM cases c JOIN services s ON s.id = c.service_id WHERE c.org_id = ?', id);
  let rows;
  switch (req.params.type) {
    case 'aging': rows = cs.filter((c) => ACTIVE_STATUSES.includes(c.status)).map((c) => ({ ref: c.ref, title: c.title, status: STATUS[c.status].label, age_days: daysBetween(c.created_at.slice(0, 10), todayStr()), next_action: c.next_action, owner: c.next_action_owner })); break;
    case 'turnaround': rows = cs.filter((c) => c.closed_at && ['completed', 'dispatched', 'delivered'].includes(c.status)).map((c) => ({ ref: c.ref, service: c.service, days: daysBetween(c.created_at.slice(0, 10), c.closed_at.slice(0, 10)) })); break;
    case 'cost': rows = all("SELECT c.ref, c.title, c.cost_center_id, c.po_number, p.amount, p.receipt_no, p.verified_at FROM payments p JOIN cases c ON c.id = p.case_id WHERE p.org_id = ? AND p.status = 'verified' ORDER BY p.verified_at DESC", id); break;
    case 'rejections': rows = cs.filter((c) => c.rejection_reason).map((c) => ({ ref: c.ref, title: c.title, reason: c.rejection_reason, responsible: c.root_cause })); break;
    case 'readiness': rows = all("SELECT full_name, consent_status, invite_status FROM profiles WHERE org_id = ? AND relation = 'employee'", id); break;
    case 'audit': { const m = orgRole(req.user.id, id); if (!['owner', 'auditor'].includes(m.role)) throw forbidden(); rows = all("SELECT ts, actor_label, action, entity, entity_id FROM audit_log WHERE entity = 'org' AND entity_id = ? ORDER BY id DESC LIMIT 500", String(id)); break; }
    default: throw notFound('Unknown report');
  }
  if (req.query.format === 'csv') { res.type('text/csv').setHeader('Content-Disposition', `attachment; filename="${req.params.type}-report.csv"`); return res.send(toCsv(rows)); }
  res.json({ type: req.params.type, rows });
});

// ---------- subscription ----------
org.post('/:id/subscription', (req, res) => {
  const { id } = guard(req, ['owner']);
  if (get("SELECT 1 AS x FROM subscriptions WHERE org_id = ? AND status = 'active'", id)) throw conflict('Already subscribed');
  const sid = insert('subscriptions', { org_id: id, plan: 'team', price_aed: 299 });
  insert('ledger_entries', { org_id: id, account: 'subscription_revenue', amount: 299, state: 'recognised', memo: 'Business workspace — month 1', category: 'business' });
  audit(req.user, 'subscription.start', 'org', id, {});
  res.status(201).json({ subscription: get('SELECT * FROM subscriptions WHERE id = ?', sid), note: 'Cancelling never removes access to purchased completion evidence.' });
});
org.delete('/:id/subscription', (req, res) => { const { id } = guard(req, ['owner']); run("UPDATE subscriptions SET status = 'cancelled', cancelled_at = datetime('now') WHERE org_id = ? AND status = 'active'", id); res.json({ ok: true, note: 'Core tracking, price clarity and access to purchased completion evidence continue after cancellation.' }); });

// ---------- integrations ----------
org.get('/:id/integrations', (req, res) => {
  const { id } = guard(req, ['owner']);
  res.json({ api_keys: all('SELECT id, name, prefix, scopes, last_used_at, revoked_at, created_at FROM api_keys WHERE org_id = ? ORDER BY id DESC', id).map((k) => ({ ...k, scopes: json(k.scopes, []) })), webhooks: all('SELECT id, url, events, active FROM webhook_endpoints WHERE org_id = ?', id).map((w) => ({ ...w, events: json(w.events, []) })), deliveries: all('SELECT d.id, d.event, d.status, d.attempt, d.response_code, d.error, d.created_at FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id = d.endpoint_id WHERE e.org_id = ? ORDER BY d.id DESC LIMIT 25', id),
    notice: 'An external system is described as connected only when its credentials, permissions and a tested interface exist. Use the test button to verify delivery.' });
});
org.post('/:id/api-keys', (req, res) => {
  const { id } = guard(req, ['owner']);
  const b = validate(req.body, { name: 'string!', scopes: 'array' });
  const scopes = (b.scopes || ['cases:read']).filter((s) => ['cases:read', 'cases:create', 'documents:read'].includes(s));
  const raw = `emt_live_${randomToken(24)}`;
  const kid = insert('api_keys', { org_id: id, name: b.name, prefix: raw.slice(0, 12), key_hash: sha256(Buffer.from(raw)), scopes });
  audit(req.user, 'apikey.create', 'org', id, { key: kid, scopes });
  res.status(201).json({ id: kid, key: raw, scopes, warning: 'Store this key now; it cannot be shown again.' });
});
org.delete('/:id/api-keys/:kid', (req, res) => { const { id } = guard(req, ['owner']); run("UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ? AND org_id = ?", Number(req.params.kid), id); audit(req.user, 'apikey.revoke', 'org', id, { key: req.params.kid }); res.json({ ok: true }); });
org.post('/:id/webhooks', (req, res) => {
  const { id } = guard(req, ['owner']);
  const b = validate(req.body, { url: 'string!', events: 'array' });
  if (!/^https:\/\//.test(b.url) && !(config.nodeEnv !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1)/.test(b.url))) throw bad('Webhook URL must use https');
  const secret = `whsec_${randomToken(20)}`;
  const wid = insert('webhook_endpoints', { org_id: id, url: b.url, secret, events: b.events || ['*'] });
  res.status(201).json({ id: wid, secret, note: 'Verify deliveries with HMAC-SHA256 over `${timestamp}.${body}` using this secret (X-Emirattest-Signature).' });
});
org.delete('/:id/webhooks/:wid', (req, res) => { const { id } = guard(req, ['owner']); run('UPDATE webhook_endpoints SET active = 0 WHERE id = ? AND org_id = ?', Number(req.params.wid), id); res.json({ ok: true }); });
org.post('/:id/webhooks/test', async (req, res) => {
  const { id } = guard(req, ['owner']);
  emitOrgEvent(id, 'ping', { message: 'Test delivery from Emirattest' });
  await runWebhookQueue();
  res.json({ deliveries: all('SELECT d.id, d.event, d.status, d.attempt, d.response_code, d.error FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id = d.endpoint_id WHERE e.org_id = ? ORDER BY d.id DESC LIMIT 5', id) });
});
export const _o = { crypto, hashPassword, emailOk, caseSummary, tx };
