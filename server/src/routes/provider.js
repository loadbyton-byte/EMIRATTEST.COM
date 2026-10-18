import { Router } from 'express';
import { all, get, insert, update, json } from '../db.js';
import { requireRole } from '../lib/auth.js';
import { validate, bad, forbidden, notFound, conflict, nowIso, money } from '../lib/util.js';
import { audit } from '../lib/audit.js';
import { providerOut, providerMetrics } from '../domain/providers.js';
import { loadCaseFor } from '../domain/access.js';
import { addEvent, addTask, transition, STATUS } from '../domain/cases.js';
import { completeStage, recordCustody, openIncident } from '../domain/operations.js';
import { notifyRole, notify } from '../domain/notify.js';
import { caseDetail } from './cases.js';

export const provider = Router();
provider.use(requireRole('provider'));

const mine = (req) => {
  const p = get('SELECT p.* FROM providers p JOIN provider_users pu ON pu.provider_id = p.id WHERE pu.user_id = ?', req.user.id);
  if (!p) throw forbidden('No provider profile is linked to your account');
  return p;
};

provider.get('/me', (req, res) => { const p = mine(req); res.json({ provider: providerOut(p), metrics: providerMetrics(p.id), feedback: all('SELECT id, rating, comment, challenged, created_at FROM provider_feedback WHERE provider_id = ? ORDER BY id DESC LIMIT 20', p.id) }); });
provider.patch('/profile', (req, res) => {
  const p = mine(req);
  const b = validate(req.body, { contact_name: 'string', contact_phone: 'string', contact_email: 'string', capacity_per_week: 'number', emirates: 'array', bio: 'string', price_schedule: 'object' });
  update('providers', p.id, b); audit(req.user, 'provider.profile', 'provider', p.id, Object.keys(b));
  res.json({ provider: providerOut(get('SELECT * FROM providers WHERE id = ?', p.id)) });
});

provider.get('/assignments', (req, res) => {
  const p = mine(req);
  const rows = all("SELECT * FROM cases WHERE provider_id = ? AND status NOT IN ('draft') ORDER BY updated_at DESC", p.id);
  res.json({ assignments: rows.map((c) => ({ id: c.id, ref: c.ref, title: c.title, status: c.status, status_label: STATUS[c.status].label, next_action: c.next_action, target_date: c.target_date, doc_count: c.doc_count, client_alias: c.client_alias, expedited: !!c.expedited, updated_at: c.updated_at, open_tasks: get("SELECT COUNT(*) AS n FROM case_tasks WHERE case_id = ? AND provider_id = ? AND status = 'open'", c.id, p.id).n })), suspended: p.status === 'suspended' });
});
provider.get('/assignments/:id', (req, res) => { const { c, a } = loadCaseFor(req.user, req.params.id); if (a.kind !== 'provider') throw forbidden(); res.json(caseDetail(req.user, c, a)); });

provider.post('/assignments/:id/request-info', (req, res) => {
  const { c, a } = loadCaseFor(req.user, req.params.id, 'act'); if (a.kind !== 'provider') throw forbidden();
  const { message } = validate(req.body, { message: 'string!' });
  addTask(c.id, { title: `Information requested: ${message}`, kind: 'info_request', owner_kind: 'customer', owner_user_id: c.customer_id, next_action: message });
  const next = ['assigned', 'collected'].includes(c.status) ? transition(c, 'customer_action_required', req.user, { detail: { requested_by: 'provider', message }, nextAction: message }) : c;
  notifyRole(['support'], { title: `Provider requested info on ${c.ref}`, body: message, link: `/ops/cases/${c.id}`, kind: 'ops' });
  res.json({ case: { id: next.id, status: next.status } });
});
provider.post('/assignments/:id/stage', (req, res) => {
  const { c, a } = loadCaseFor(req.user, req.params.id, 'act'); if (a.kind !== 'provider') throw forbidden();
  const b = validate(req.body, { seq: 'number!', evidence: 'string!', note: 'string' });
  const next = completeStage(c, req.user, b);
  res.json({ case: { id: next.id, status: next.status } });
});
provider.post('/assignments/:id/submission', (req, res) => {
  const { c, a } = loadCaseFor(req.user, req.params.id, 'act'); if (a.kind !== 'provider') throw forbidden();
  const b = validate(req.body, { authority_ref: 'string!', location: 'string', note: 'string' });
  res.json(recordCustody(c, req.user, { type: 'submission', ...b, ack_name: undefined }));
});
provider.post('/assignments/:id/exception', (req, res) => {
  const { c, a } = loadCaseFor(req.user, req.params.id, 'act'); if (a.kind !== 'provider') throw forbidden();
  const b = validate(req.body, { type: 'string!', detail: 'string!' });
  addEvent(c.id, req.user, 'provider_exception', { type: b.type, detail: b.detail }, { visibility: 'internal' });
  const inc = openIncident(c, req.user, { type: b.type, severity: /lost|damage|unauthor|fraud/i.test(b.type) ? 'high' : 'medium', detail: b.detail });
  res.status(201).json({ incident: inc });
});

provider.get('/settlements', (req, res) => {
  const p = mine(req);
  res.json({ settlements: all('SELECT s.*, c.ref FROM provider_settlements s LEFT JOIN cases c ON c.id = s.case_id WHERE s.provider_id = ? ORDER BY s.id DESC', p.id), totals: { accrued: money(get("SELECT COALESCE(SUM(amount),0) AS s FROM provider_settlements WHERE provider_id = ? AND status = 'accrued'", p.id).s), invoiced: money(get("SELECT COALESCE(SUM(amount),0) AS s FROM provider_settlements WHERE provider_id = ? AND status = 'invoiced'", p.id).s), paid: money(get("SELECT COALESCE(SUM(amount),0) AS s FROM provider_settlements WHERE provider_id = ? AND status = 'paid'", p.id).s) } });
});
provider.post('/settlements/invoice', (req, res) => {
  const p = mine(req);
  const { invoice_ref } = validate(req.body, { invoice_ref: 'string!' });
  const rows = all("SELECT id FROM provider_settlements WHERE provider_id = ? AND status = 'accrued'", p.id);
  if (!rows.length) throw conflict('No accrued settlements to invoice');
  rows.forEach((r) => update('provider_settlements', r.id, { status: 'invoiced', invoice_ref }));
  audit(req.user, 'settlement.invoice', 'provider', p.id, { invoice_ref, n: rows.length });
  res.json({ invoiced: rows.length });
});
provider.post('/feedback/:id/challenge', (req, res) => {
  const p = mine(req);
  const f = get('SELECT * FROM provider_feedback WHERE id = ? AND provider_id = ?', Number(req.params.id), p.id);
  if (!f) throw notFound();
  update('provider_feedback', f.id, { challenged: 1 }); audit(req.user, 'feedback.challenge', 'provider', p.id, { feedback: f.id });
  notifyRole(['support'], { title: `Provider challenged feedback #${f.id}`, body: p.name, link: '/ops/providers', kind: 'ops' });
  res.json({ ok: true, note: 'Challenged feedback is excluded from public metrics while reviewed.' });
});
export const _pr = { bad, json, insert, nowIso, notify };
