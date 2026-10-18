import express, { Router } from 'express';
import { all, get, insert, update, json, tx } from '../db.js';
import { config } from '../config.js';
import { requireAuth, isStaff } from '../lib/auth.js';
import { validate, bad, conflict, forbidden, notFound, nowIso, todayStr, normPhone, money } from '../lib/util.js';
import { audit } from '../lib/audit.js';
import { caseAccess, loadCaseFor, orgRole, userOrgs, activeGrants } from '../domain/access.js';
import { createCase, caseSummary, submitForReview, addEvent, addTask, completeTask, transition, STATUS, markFirstResponse } from '../domain/cases.js';
import { estimate } from '../domain/pricing.js';
import { quotationPdf, receiptPdf, caseSummaryPdf } from '../lib/pdf.js';
import { antivirusGate } from '../lib/clamav.js';
import { storeDocument, docOut, caseDocs, readinessCheck, MAX_UPLOAD } from '../domain/documents.js';
import { eligibleProviders, providerMetrics, providerOut } from '../domain/providers.js';
import { quoteOut, acceptQuote, rejectQuote } from '../domain/quotes.js';
import { chooseProvider, chooseRecovery, cancelCase } from '../domain/operations.js';
import { deadlinePlan } from '../domain/planner.js';
import { notify, notifyRole, notifyMany } from '../domain/notify.js';
import { startStripeCheckout } from '../domain/payments.js';
import { getRoute } from '../domain/catalog.js';

export const cases = Router();
cases.use(requireAuth);

const rawUpload = express.raw({ type: () => true, limit: MAX_UPLOAD + 1024 });

function visibleCaseIds(user) {
  const ids = new Set(all('SELECT id FROM cases WHERE customer_id = ?', user.id).map((r) => r.id));
  for (const m of all('SELECT * FROM org_members WHERE user_id = ?', user.id)) {
    if (['owner', 'approver', 'finance', 'auditor'].includes(m.role)) all('SELECT id FROM cases WHERE org_id = ?', m.org_id).forEach((r) => ids.add(r.id));
    if (m.role === 'hr') all("SELECT c.id FROM cases c JOIN profiles p ON p.id = c.profile_id WHERE c.org_id = ? AND p.org_id = ? AND p.consent_status = 'consented'", m.org_id, m.org_id).forEach((r) => ids.add(r.id));
  }
  for (const g of activeGrants(user.id)) all('SELECT id FROM cases WHERE profile_id = ?', g.profile_id).forEach((r) => ids.add(r.id));
  return [...ids];
}

cases.get('/', (req, res) => {
  const ids = visibleCaseIds(req.user);
  if (!ids.length) return res.json({ cases: [] });
  let rows = all(`SELECT * FROM cases WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY updated_at DESC`, ...ids);
  if (req.query.status) rows = rows.filter((c) => c.status === req.query.status);
  if (req.query.org) rows = rows.filter((c) => c.org_id === Number(req.query.org));
  if (req.query.q) { const q = String(req.query.q).toLowerCase(); rows = rows.filter((c) => `${c.ref} ${c.title} ${c.client_ref || ''}`.toLowerCase().includes(q)); }
  res.json({ cases: rows.slice(0, 300).map((c) => ({ ...caseSummary(c), access: caseAccess(req.user, c)?.kind })) });
});

cases.post('/', (req, res) => {
  const b = validate(req.body, { serviceSlug: 'string!', profileId: 'number', orgId: 'number', routeSlug: 'string', apostille: 'boolean', docCount: 'number', destinationCountry: 'string', issuingCountry: 'string', purpose: 'string', targetDate: 'string', pickupEmirate: 'string', deliveryEmirate: 'string', expedited: 'boolean', clientRef: 'string', clientAlias: 'string', poNumber: 'string', costCenterId: 'number', title: 'string', details: 'object', shareWithEmployer: 'boolean', providerId: 'number' });
  const c = createCase(req.user, { ...b, channel: req.headers['x-channel'] === 'app' ? 'app' : 'web' });
  if (b.providerId) chooseProvider(c, req.user, b.providerId);
  res.status(201).json({ case: caseSummary(get('SELECT * FROM cases WHERE id = ?', c.id)), estimate: estimate({ serviceSlug: b.serviceSlug, routeSlug: b.routeSlug, docCount: b.docCount || 1, pickupEmirate: b.pickupEmirate, deliveryEmirate: b.deliveryEmirate, expedited: b.expedited, business: !!b.orgId }) });
});

/** Aggregate view of a case, redacted to the caller's access level. Internal notes are never returned to customers. */
export function caseDetail(user, c, a) {
  const svc = get('SELECT * FROM services WHERE id = ?', c.service_id);
  const route = c.route_id ? getRoute(c.route_id) : null;
  const events = all('SELECT * FROM case_events WHERE case_id = ? ORDER BY id DESC LIMIT 200', c.id).filter((e) => a.internal || e.visibility === 'customer').map((e) => ({ ...e, detail: json(e.detail, {}) }));
  const tasks = all('SELECT * FROM case_tasks WHERE case_id = ? ORDER BY id', c.id).filter((t) => a.kind === 'agent' ? t.owner_user_id === user.id : a.kind === 'provider' ? t.provider_id === c.provider_id : true);
  const provider = c.provider_id ? get('SELECT id, name, kind, sponsored FROM providers WHERE id = ?', c.provider_id) : null;
  const profile = c.profile_id ? get('SELECT id, full_name, relation, nationality, is_minor FROM profiles WHERE id = ?', c.profile_id) : null;
  const out = {
    case: { ...caseSummary(c), client_alias: c.client_alias },
    access: { kind: a.kind, act: a.act, approve: a.approve, docs: a.docs, finance: a.finance, internal: a.internal, read_only: !!a.readOnly },
    service: { slug: svc.slug, name_en: svc.name_en, name_ar: svc.name_ar, category: svc.category, regulated: !!svc.regulated, eligibility_note: svc.eligibility_note },
    route, events, tasks, provider, profile, plan: deadlinePlan(c),
    appointments: all('SELECT * FROM appointments WHERE case_id = ? ORDER BY at', c.id),
    custody: a.docs || a.kind === 'agent' || a.internal ? all('SELECT * FROM custody_events WHERE case_id = ? ORDER BY captured_at', c.id) : [],
    messages: a.contact || a.internal ? all('SELECT * FROM messages WHERE case_id = ? ORDER BY id', c.id).filter((m) => a.internal || m.visibility === 'customer') : [],
  };
  if (a.finance) {
    out.quotes = all('SELECT * FROM quotes WHERE case_id = ? ORDER BY id DESC', c.id).filter((q) => q.status !== 'draft' || a.internal).map(quoteOut);
    out.payments = all('SELECT id, kind, method, provider, amount, currency, status, receipt_no, token, created_at, verified_at FROM payments WHERE case_id = ? ORDER BY id', c.id).map((p) => (a.kind === 'owner' || a.kind === 'org_owner' || a.internal ? p : { ...p, token: undefined }));
    out.refunds = all('SELECT * FROM refunds WHERE case_id = ? ORDER BY id', c.id);
  }
  if (a.docs) { out.documents = caseDocs(c.id).map((d) => docOut(d, { internal: a.internal })); out.readiness = readinessCheck(c); }
  if (a.kind === 'provider' || a.kind === 'agent') { out.case.customer_id = undefined; }
  if (a.kind === 'provider' || a.kind === 'agent' || a.kind === 'org_finance' || a.kind === 'org_auditor') out.messages = [];
  return out;
}

cases.get('/:id', (req, res) => {
  const { c, a } = loadCaseFor(req.user, req.params.id);
  if (a.internal) audit(req.user, 'case.view', 'case', c.id, {});
  res.json(caseDetail(req.user, c, a));
});

cases.get('/:id/planner', (req, res) => { const { c } = loadCaseFor(req.user, req.params.id); res.json(deadlinePlan(c)); });
cases.get('/:id/readiness', (req, res) => { const { c } = loadCaseFor(req.user, req.params.id, 'docs'); res.json(readinessCheck(c)); });

cases.post('/:id/documents', rawUpload, async (req, res) => {
  const { c } = loadCaseFor(req.user, req.params.id, 'act');
  if (!Buffer.isBuffer(req.body)) throw bad('Send the file as the raw request body (Content-Type application/octet-stream) with ?filename=');
  const q = req.query;
  const av = await antivirusGate(req.body);
  const doc = storeDocument({ user: req.user, caseId: c.id, profileId: c.profile_id, kind: String(q.kind || 'other'), filename: String(q.filename || 'document'), buffer: req.body, role: ['original', 'supporting', 'derivative', 'working_copy'].includes(q.role) ? q.role : 'original', replacesId: q.replaces ? Number(q.replaces) : null,
    meta: { scan_engine: av.engine, holder_name: q.holder_name, doc_number: q.doc_number, issue_date: q.issue_date, expiry_date: q.expiry_date, issuing_authority: q.issuing_authority, issuing_country: q.issuing_country, pages_declared: q.pages_declared ? Number(q.pages_declared) : null, pages_uploaded: q.pages_uploaded ? Number(q.pages_uploaded) : null, purpose: q.purpose } });
  addEvent(c.id, req.user, 'document_uploaded', { filename: doc.filename, kind: doc.kind, version: doc.version, receipt: `${doc.sha256.slice(0, 10)}` });
  if (c.status === 'correction_required' || c.status === 'customer_action_required') update('cases', c.id, { updated_at: nowIso() });
  res.status(201).json({ document: docOut(doc), receipt: { sha256: doc.sha256, size: doc.size, uploaded_at: doc.created_at, scan: doc.scan_status } });
});

cases.post('/:id/submit', (req, res) => {
  const { c } = loadCaseFor(req.user, req.params.id, 'act');
  if (!['customer_action_required', 'correction_required', 'draft'].includes(c.status)) throw conflict(`Case is ${c.status}`);
  const { case: next } = c.status === 'correction_required' ? { case: transition(c, 'ready_for_review', req.user, { detail: { resubmitted: true } }) } : submitForReview(c, req.user);
  res.json({ case: caseSummary(next), readiness: readinessCheck(next) });
});

cases.get('/:id/providers', (req, res) => {
  const { c } = loadCaseFor(req.user, req.params.id, 'act');
  const svc = get('SELECT slug FROM services WHERE id = ?', c.service_id);
  const route = c.route_id ? get('SELECT slug FROM routes WHERE id = ?', c.route_id) : null;
  res.json({ ...eligibleProviders({ serviceSlug: svc.slug, routeSlug: route?.slug, emirate: c.pickup_emirate, docCount: c.doc_count }), chosen: c.provider_id });
});
cases.post('/:id/provider', (req, res) => {
  const { c } = loadCaseFor(req.user, req.params.id, 'act');
  const { providerId } = validate(req.body, { providerId: 'number!' });
  res.json({ case: caseSummary(chooseProvider(c, req.user, providerId)) });
});

cases.post('/:id/quotes/:qid/accept', async (req, res) => {
  const { c } = loadCaseFor(req.user, req.params.id, 'approve');
  const b = validate(req.body, { method: ['card', 'bank_transfer', 'credit_account'] });
  const out = acceptQuote(c, Number(req.params.qid), req.user, { method: b.method || 'card' });
  if (out.payment.provider === 'stripe' && out.payment.status === 'pending') {
    try { const s = await startStripeCheckout(out.payment, `${config.baseUrl}/app/cases/${c.id}?paid=1`, `${config.baseUrl}/app/cases/${c.id}`); if (s) out.checkout = { url: s.url, provider: 'stripe', external: true }; } catch (e) { out.checkout.error = e.message; }
  }
  res.json(out);
});
cases.post('/:id/quotes/:qid/reject', (req, res) => {
  const { c } = loadCaseFor(req.user, req.params.id, 'approve');
  const { reason } = validate(req.body, { reason: 'string' });
  res.json({ case: caseSummary(rejectQuote(c, Number(req.params.qid), req.user, reason || '')) });
});

cases.post('/:id/messages', (req, res) => {
  const { c, a } = loadCaseFor(req.user, req.params.id);
  if (!a.contact && !a.internal) throw forbidden('Your access level cannot send case messages');
  const b = validate(req.body, { body: 'string!', internal: 'boolean' });
  const staff = isStaff(req.user);
  const internal = staff && !!b.internal;
  const id = insert('messages', { case_id: c.id, sender_user_id: req.user.id, sender_kind: staff ? 'staff' : 'customer', body: b.body, visibility: internal ? 'internal' : 'customer' });
  if (staff && !internal) { markFirstResponse(c, req.user); notify(c.customer_id, { title: `${c.ref}: new message from Emirattest`, body: b.body.slice(0, 140), link: `/app/cases/${c.id}`, kind: 'message', whatsapp: true }); }
  else if (!staff) notifyRole(['support'], { title: `Customer message on ${c.ref}`, body: b.body.slice(0, 140), link: `/ops/cases/${c.id}`, kind: 'message' });
  res.status(201).json({ message: get('SELECT * FROM messages WHERE id = ?', id) });
});

cases.post('/:id/cancel', (req, res) => {
  const { c } = loadCaseFor(req.user, req.params.id, 'act');
  const { reason } = validate(req.body, { reason: 'string' });
  res.json({ case: caseSummary(cancelCase(c, req.user, reason || 'Cancelled by customer')) });
});
cases.post('/:id/recovery', (req, res) => {
  const { c } = loadCaseFor(req.user, req.params.id, 'act');
  const { index } = validate(req.body, { index: 'number!' });
  res.json({ case: caseSummary(chooseRecovery(c, req.user, index)) });
});

cases.post('/:id/appointments', (req, res) => {
  const { c } = loadCaseFor(req.user, req.params.id, 'act');
  const b = validate(req.body, { kind: ['pickup', 'embassy', 'authority', 'medical', 'biometrics'], at: 'string!', location: 'string', emirate: 'string' });
  const at = new Date(b.at); if (Number.isNaN(at.getTime()) || at < new Date()) throw bad('Choose a future date and time');
  const id = insert('appointments', { case_id: c.id, user_id: req.user.id, kind: b.kind || 'pickup', at: b.at, location: b.location, emirate: b.emirate || c.pickup_emirate });
  addEvent(c.id, req.user, 'appointment_booked', { kind: b.kind || 'pickup', at: b.at, location: b.location });
  if ((b.kind || 'pickup') === 'pickup') addTask(c.id, { title: `Pickup — ${b.emirate || c.pickup_emirate || ''}`.trim(), kind: 'pickup', owner_kind: 'agent', emirate: b.emirate || c.pickup_emirate, address: b.location, scheduled_at: b.at, contact_permission: true });
  res.status(201).json({ appointment: get('SELECT * FROM appointments WHERE id = ?', id) });
});

cases.post('/:id/complaints', (req, res) => {
  const { c } = loadCaseFor(req.user, req.params.id, 'act');
  const b = validate(req.body, { subject: 'string!', detail: 'string' });
  const ref = `CMP-${String(get('SELECT COUNT(*) AS n FROM complaints').n + 1).padStart(4, '0')}`;
  const owner = get("SELECT id FROM users WHERE role = 'support' ORDER BY id LIMIT 1");
  const id = insert('complaints', { ref, case_id: c.id, user_id: req.user.id, subject: b.subject, detail: b.detail, owner_user_id: owner?.id, status: 'open' });
  addEvent(c.id, req.user, 'complaint_opened', { ref, subject: b.subject });
  notifyRole(['support'], { title: `Complaint ${ref} on ${c.ref}`, body: b.subject, link: '/ops/support', kind: 'complaint' });
  res.status(201).json({ complaint: get('SELECT * FROM complaints WHERE id = ?', id) });
});

cases.post('/:id/feedback', (req, res) => {
  const { c } = loadCaseFor(req.user, req.params.id, 'act');
  if (!['completed', 'dispatched', 'delivered'].includes(c.status)) throw conflict('Feedback opens once the case is completed');
  if (!c.provider_id) throw conflict('No provider on this case');
  const b = validate(req.body, { rating: 'number!', comment: 'string' });
  if (b.rating < 1 || b.rating > 5) throw bad('Rating must be 1–5');
  if (get('SELECT 1 AS x FROM provider_feedback WHERE case_id = ?', c.id)) throw conflict('Feedback already submitted');
  insert('provider_feedback', { provider_id: c.provider_id, case_id: c.id, rating: Math.round(b.rating), comment: b.comment, verified: 1 });
  res.status(201).json({ ok: true });
});

/** Completion pack: scope, payments, receipts, files and custody proof. Excludes internal staff notes and others' documents. */
cases.get('/:id/completion-pack', (req, res) => {
  const { c, a } = loadCaseFor(req.user, req.params.id, 'finance');
  const d = caseDetail(req.user, c, a);
  const pack = { generated_at: nowIso(), case: { ref: c.ref, title: c.title, status: c.status, service: d.service.name_en, route: d.route && { title: d.route.title_en, version: c.route_version }, provider: d.provider?.name },
    accepted_scope: (d.quotes || []).filter((q) => q.status === 'accepted').map((q) => ({ version: q.version, kind: q.kind, total: q.total, lines: q.lines })), payments: d.payments || [], refunds: d.refunds || [],
    files: (d.documents || []).map((x) => ({ id: x.id, filename: x.filename, role: x.role, version: x.version, sha256: x.sha256, uploaded_at: x.created_at })), custody: d.custody.map((x) => ({ type: x.type, at: x.captured_at, location: x.location, ack: x.ack_name, offline: !!x.offline, synced_at: x.synced_at })),
    timeline: d.events.map((e) => ({ at: e.ts, type: e.type, status: e.to_status, by: e.actor_label })) };
  res.setHeader('Content-Disposition', `attachment; filename="${c.ref}-completion-pack.json"`);
  res.json(pack);
});
// ---- PDFs: quotation, receipt, case summary (generated on request, never stored) ----
const sendPdf = (res, name, buf) => { res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="${name}"`); res.setHeader('Cache-Control', 'private, no-store'); res.send(buf); };
cases.get('/:id/quotes/:qid/pdf', async (req, res) => {
  const { c, a } = loadCaseFor(req.user, req.params.id, 'finance');
  const q = get('SELECT * FROM quotes WHERE id = ? AND case_id = ?', Number(req.params.qid), c.id);
  if (!q || (q.status === 'draft' && !a.internal)) throw notFound('Quotation not found');
  sendPdf(res, `${c.ref}-quotation-v${q.version}.pdf`, await quotationPdf({ quote: quoteOut(q), c, customer: get('SELECT name FROM users WHERE id = ?', c.customer_id) }));
});
cases.get('/:id/payments/:pid/receipt.pdf', async (req, res) => {
  const { c } = loadCaseFor(req.user, req.params.id, 'finance');
  const p = get('SELECT * FROM payments WHERE id = ? AND case_id = ?', Number(req.params.pid), c.id);
  if (!p || p.status !== 'verified') throw notFound('Receipt not available until the payment is confirmed');
  sendPdf(res, `${p.receipt_no || `receipt-${p.id}`}.pdf`, await receiptPdf({ payment: p, c, customer: get('SELECT name FROM users WHERE id = ?', p.user_id || c.customer_id) }));
});
cases.get('/:id/summary.pdf', async (req, res) => {
  const { c, a } = loadCaseFor(req.user, req.params.id, 'docs');
  const events = all('SELECT * FROM case_events WHERE case_id = ? ORDER BY id', c.id).filter((e) => a.internal || e.visibility === 'customer');
  sendPdf(res, `${c.ref}-summary.pdf`, await caseSummaryPdf({ c, events, documents: caseDocs(c.id) }));
});
export const _c = { userOrgs, orgRole, notifyMany, completeTask, todayStr, normPhone, money, providerMetrics, providerOut, STATUS, tx };
