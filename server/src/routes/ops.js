import { integrationStatus } from '../lib/integrations.js';
import { Router } from 'express';
import { all, get, insert, update, run, json, tx, getSetting, setSetting } from '../db.js';
import { config } from '../config.js';
import { requireStaff, requireRole, hashPassword, passwordProblem, revokeAllSessions } from '../lib/auth.js';
import { validate, bad, forbidden, notFound, conflict, nowIso, todayStr, addDays, money, daysBetween, emailOk, normPhone, toCsv } from '../lib/util.js';
import { audit, verifyAuditChain } from '../lib/audit.js';
import { loadCaseFor } from '../domain/access.js';
import { caseSummary, transition, addEvent, addTask, completeTask, markFirstResponse, STATUS, ACTIVE_STATUSES, canTransition } from '../domain/cases.js';
import { draftQuote, issueQuote, createVariation, quoteOut } from '../domain/quotes.js';
import { chooseProvider, assignAgent, markCompleted, markRejected, completeStage, recordCustody, assignAfterPayment, cancelCase } from '../domain/operations.js';
import { listRoutes, getRoute, updateRoute, markRouteReviewed, staleRoutes } from '../domain/catalog.js';
import { providerOut, providerMetrics } from '../domain/providers.js';
import { requestRefund, approveRefund, rejectRefund, verifyPayment } from '../domain/payments.js';
import { afterVerified } from './payments.js';
import { liveFinance, collectionAging, cashForecast, financialModel } from '../domain/finance.js';
import { businessHoursBetween, addBusinessHours, sqlTs } from '../domain/time.js';
import { notify, notifyMany, notifyRole, flushOutbox } from '../domain/notify.js';
import { conversationMessages } from '../domain/whatsapp.js';
import { sendWhatsAppText, whatsappStatus } from '../domain/whatsapp-transport.js';
import { runWebhookQueue } from '../domain/webhooks.js';
import { caseDetail } from './cases.js';

export const ops = Router();
ops.use(requireStaff);
const financeOnly = requireRole('finance', 'admin');
const adminOnly = requireRole('admin');
const notFinance = (req, _res, next) => (req.user.role === 'finance' ? next(forbidden('Finance users cannot access case documents or operations actions')) : next());

/** SLA flags: enquiry acknowledgement within 4 business hours; reviewed standard quote within 1 business day (9h) after complete information. */
function slaFlags(c, now = new Date()) {
  const ackDue = addBusinessHours(new Date(`${c.created_at.replace(' ', 'T')}Z`), 4);
  const ackAt = c.first_response_at ? new Date(`${c.first_response_at.replace(' ', 'T')}Z`) : null;
  const ackBreached = ackAt ? ackAt > ackDue : now > ackDue;
  let quoteDue = null; let quoteBreached = false;
  if (['ready_for_review', 'quotation_awaiting_approval', 'awaiting_payment', 'assigned', 'collected', 'submitted', 'authority_pending', 'provider_pending', 'completed', 'dispatched', 'delivered'].includes(c.status) || c.quoted_at) {
    const ev = get("SELECT ts FROM case_events WHERE case_id = ? AND to_status = 'ready_for_review' ORDER BY id LIMIT 1", c.id);
    if (ev) {
      quoteDue = addBusinessHours(new Date(`${ev.ts.replace(' ', 'T')}Z`), 9);
      const q = c.quoted_at ? new Date(`${c.quoted_at.replace(' ', 'T')}Z`) : null;
      quoteBreached = q ? q > quoteDue : c.status === 'ready_for_review' && now > quoteDue;
    }
  }
  return { ack_due: ackDue.toISOString(), ack_breached: ackBreached, quote_due: quoteDue?.toISOString() || null, quote_breached: quoteBreached };
}
const overdueNextUpdate = (c) => !!c.next_update_due && c.next_update_due < nowIso() && ACTIVE_STATUSES.includes(c.status);

ops.get('/dashboard', (req, res) => {
  const rows = all('SELECT * FROM cases');
  const active = rows.filter((c) => ACTIVE_STATUSES.includes(c.status));
  const sla = active.map((c) => ({ c, f: slaFlags(c) }));
  const aging = { '0-2d': 0, '3-7d': 0, '8-14d': 0, '15d+': 0 };
  active.forEach((c) => { const d = daysBetween(c.created_at.slice(0, 10), todayStr()); aging[d <= 2 ? '0-2d' : d <= 7 ? '3-7d' : d <= 14 ? '8-14d' : '15d+']++; });
  const overdueTasks = all("SELECT t.*, c.ref FROM case_tasks t JOIN cases c ON c.id = t.case_id WHERE t.status = 'open' AND t.due_at IS NOT NULL AND t.due_at < ? ORDER BY t.due_at LIMIT 15", nowIso());
  const agents = all("SELECT u.id, u.name, a.emirates, a.capacity_per_day FROM users u JOIN agent_profiles a ON a.user_id = u.id WHERE a.status = 'active'").map((a) => ({ ...a, emirates: json(a.emirates, []), open_tasks: get("SELECT COUNT(*) AS n FROM case_tasks WHERE owner_user_id = ? AND status = 'open'", a.id).n }));
  const staff = all("SELECT u.id, u.name, u.role, (SELECT COUNT(*) FROM cases c WHERE c.owner_staff_id = u.id AND c.status IN (" + ACTIVE_STATUSES.map(() => '?').join(',') + ")) AS open_cases FROM users u WHERE u.role IN ('support','ops')", ...ACTIVE_STATUSES);
  const f = liveFinance();
  const closed = rows.filter((c) => c.closed_at && ['completed', 'dispatched', 'delivered'].includes(c.status));
  res.json({
    kpis: { total_cases: rows.length, active: active.length, awaiting_customer: active.filter((c) => c.next_action_owner === 'customer').length, awaiting_authority: active.filter((c) => c.next_action_owner === 'authority').length, awaiting_us: active.filter((c) => ['emirattest', 'provider', 'agent'].includes(c.next_action_owner)).length, rejected_open: rows.filter((c) => c.status === 'rejected').length, completed_30d: closed.filter((c) => daysBetween(c.closed_at.slice(0, 10), todayStr()) <= 30).length, avg_turnaround_days: closed.length ? Math.round(closed.reduce((a, c) => a + daysBetween(c.created_at.slice(0, 10), c.closed_at.slice(0, 10)), 0) / closed.length * 10) / 10 : null, quote_accuracy_pct: quoteAccuracy() },
    sla: { ack_breaches: sla.filter((x) => x.f.ack_breached).length, quote_breaches: sla.filter((x) => x.f.quote_breached).length, updates_overdue: active.filter(overdueNextUpdate).length, standard: 'Acknowledge within 4 business hours; reviewed standard-case quotation within 1 business day after complete information.' },
    by_status: Object.entries(rows.reduce((a, c) => ({ ...a, [c.status]: (a[c.status] || 0) + 1 }), {})).map(([status, n]) => ({ status, label: STATUS[status]?.label, n })),
    aging, overdue_tasks: overdueTasks, agents, staff,
    exceptions: { open_incidents: all("SELECT * FROM incidents WHERE status != 'closed' ORDER BY id DESC LIMIT 10"), open_complaints: get("SELECT COUNT(*) AS n FROM complaints WHERE status NOT IN ('resolved','closed')").n, handoffs: get('SELECT COUNT(*) AS n FROM conversations WHERE handoff = 1').n, callbacks: get("SELECT COUNT(*) AS n FROM callbacks WHERE status = 'open'").n, stale_routes: staleRoutes(), rule_reviews_open: get("SELECT COUNT(*) AS n FROM rule_change_reviews WHERE status = 'open'").n, failed_webhooks: get("SELECT COUNT(*) AS n FROM webhook_deliveries WHERE status = 'failed'").n },
    rejection_causes: all("SELECT COALESCE(root_cause,'unknown') AS cause, COUNT(*) AS n FROM cases WHERE rejection_reason IS NOT NULL GROUP BY root_cause"),
    revenue_snapshot: { completed_revenue: f.completed_revenue, deposits_deferred: f.deposits_deferred, outstanding_quotations: f.outstanding_quotations },
  });
});
function quoteAccuracy() {
  const q = all("SELECT case_id, total FROM quotes WHERE kind = 'quotation' AND status = 'accepted'");
  if (!q.length) return null;
  let ok = 0;
  for (const x of q) { const v = get("SELECT COALESCE(SUM(total),0) AS s FROM quotes WHERE case_id = ? AND kind = 'variation' AND status = 'accepted'", x.case_id).s; if (v <= x.total * 0.05) ok++; }
  return Math.round((ok / q.length) * 100);
}

// ---------- cases ----------
ops.get('/cases', notFinance, (req, res) => {
  let rows = all('SELECT c.*, u.name AS customer_name, o.name AS org_name, p.name AS provider_name, s.name_en AS service FROM cases c JOIN users u ON u.id = c.customer_id LEFT JOIN orgs o ON o.id = c.org_id LEFT JOIN providers p ON p.id = c.provider_id JOIN services s ON s.id = c.service_id ORDER BY c.updated_at DESC LIMIT 800');
  const q = req.query;
  if (q.status) rows = rows.filter((c) => c.status === q.status);
  if (q.active === '1') rows = rows.filter((c) => ACTIVE_STATUSES.includes(c.status));
  if (q.owner === 'me') rows = rows.filter((c) => c.owner_staff_id === req.user.id);
  if (q.q) { const n = String(q.q).toLowerCase(); rows = rows.filter((c) => `${c.ref} ${c.title} ${c.customer_name} ${c.org_name || ''} ${c.client_ref || ''}`.toLowerCase().includes(n)); }
  const out = rows.slice(0, 300).map((c) => { const f = slaFlags(c); return { id: c.id, ref: c.ref, title: c.title, status: c.status, status_label: STATUS[c.status].label, customer: c.customer_name, org: c.org_name, provider: c.provider_name, service: c.service, channel: c.channel, next_action: c.next_action, owner: c.next_action_owner, next_update_due: c.next_update_due, update_overdue: overdueNextUpdate(c), target_date: c.target_date, expedited: !!c.expedited, ...f, age_days: daysBetween(c.created_at.slice(0, 10), todayStr()) }; });
  res.json({ cases: q.sla === '1' ? out.filter((c) => c.ack_breached || c.quote_breached || c.update_overdue) : out });
});

ops.get('/cases/:id', notFinance, (req, res) => {
  const { c, a } = loadCaseFor(req.user, req.params.id);
  audit(req.user, 'case.view', 'case', c.id, {});
  const customer = get('SELECT id, name, email, phone, lang FROM users WHERE id = ?', c.customer_id);
  res.json({ ...caseDetail(req.user, c, a), customer, org: c.org_id ? get('SELECT id, name, type, tier FROM orgs WHERE id = ?', c.org_id) : null, sla: slaFlags(c), allowed_transitions: Object.keys(STATUS).filter((s) => canTransition(c.status, s)),
    staff: all("SELECT id, name, role FROM users WHERE role IN ('support','ops')"), agents: all("SELECT u.id, u.name, a.emirates FROM users u JOIN agent_profiles a ON a.user_id = u.id WHERE a.status = 'active'").map((x) => ({ ...x, emirates: json(x.emirates, []) })), providers: all("SELECT id, name, kind FROM providers WHERE status = 'active'"),
    route_changes: all('SELECT * FROM rule_change_reviews WHERE case_id = ? ORDER BY id DESC', c.id).map((r) => ({ ...r, impact: json(r.impact, {}) })), paused: !!json(c.details, {}).paused });
});
const act = (fn) => (req, res) => { const { c } = loadCaseFor(req.user, req.params.id, 'act'); return fn(req, res, c); };
ops.post('/cases/:id/status', notFinance, act((req, res, c) => {
  const b = validate(req.body, { to: 'string!', note: 'string' });
  if (b.to === 'assigned') return res.json({ case: caseSummary(assignAfterPayment(c, req.user)) });
  if (['completed'].includes(b.to)) return res.json({ case: caseSummary(markCompleted(c, req.user)) });
  markFirstResponse(c, req.user);
  res.json({ case: caseSummary(transition(c, b.to, req.user, { detail: { note: b.note } })) });
}));
ops.post('/cases/:id/owner', notFinance, act((req, res, c) => { const { staffId } = validate(req.body, { staffId: 'number!' }); update('cases', c.id, { owner_staff_id: staffId }); addEvent(c.id, req.user, 'owner_assigned', { staff: staffId }, { visibility: 'internal' }); notify(staffId, { title: `Case ${c.ref} assigned to you`, link: `/ops/cases/${c.id}`, email: false, kind: 'assignment' }); res.json({ ok: true }); }));
ops.post('/cases/:id/provider', notFinance, act((req, res, c) => { const { providerId } = validate(req.body, { providerId: 'number!' }); res.json({ case: caseSummary(chooseProvider(c, req.user, providerId)) }); }));
ops.post('/cases/:id/quotes', notFinance, act((req, res, c) => { const b = validate(req.body, { lines: 'array', validDays: 'number', emergencyLimit: 'number', issue: 'boolean' }); const q = draftQuote(c, req.user, b); res.status(201).json({ quote: b.issue ? issueQuote(c, q.id, req.user) : q }); }));
ops.post('/cases/:id/quotes/:qid/issue', notFinance, act((req, res, c) => res.json({ quote: issueQuote(c, Number(req.params.qid), req.user) })));
ops.post('/cases/:id/variations', notFinance, act((req, res, c) => { const b = validate(req.body, { reason: 'string!', lines: 'array!', emergency: 'boolean' }); res.status(201).json({ quote: createVariation(c, req.user, b) }); }));
ops.post('/cases/:id/tasks', notFinance, act((req, res, c) => { const b = validate(req.body, { title: 'string!', kind: 'string', owner_kind: ['customer', 'emirattest', 'provider', 'authority', 'agent'], due_at: 'string', next_action: 'string', emirate: 'string', address: 'string', scheduled_at: 'string', contact_permission: 'boolean' }); const id = addTask(c.id, { ...b, provider_id: b.owner_kind === 'provider' ? c.provider_id : undefined, owner_user_id: b.owner_kind === 'customer' ? c.customer_id : undefined }); res.status(201).json({ task: get('SELECT * FROM case_tasks WHERE id = ?', id) }); }));
ops.post('/cases/:id/tasks/:tid/complete', notFinance, act((req, res, c) => res.json({ task: completeTask(Number(req.params.tid), req.user) })));
ops.post('/cases/:id/tasks/:tid/agent', notFinance, act((req, res, c) => { const b = validate(req.body, { agentId: 'number!', scheduled_at: 'string' }); res.json({ task: assignAgent(c, Number(req.params.tid), b.agentId, req.user, b.scheduled_at) }); }));
ops.post('/cases/:id/reject', notFinance, act((req, res, c) => { const b = validate(req.body, { reason: 'string!', evidence: 'string', responsible: 'string!', alternatives: 'array' }); res.json({ case: caseSummary(markRejected(c, req.user, b)) }); }));
ops.post('/cases/:id/stage', notFinance, act((req, res, c) => { const b = validate(req.body, { seq: 'number!', evidence: 'string!', note: 'string' }); res.json({ case: caseSummary(completeStage(c, req.user, b)) }); }));
ops.post('/cases/:id/custody', notFinance, act((req, res, c) => res.status(201).json(recordCustody(c, req.user, req.body || {}))));
ops.post('/cases/:id/note', notFinance, act((req, res, c) => { const { body } = validate(req.body, { body: 'string!' }); insert('messages', { case_id: c.id, sender_user_id: req.user.id, sender_kind: 'staff', body, visibility: 'internal' }); res.status(201).json({ ok: true }); }));
/** Support can pause a case for safety or authority questions — it cannot bypass payment approval or open unrestricted document access. */
ops.post('/cases/:id/pause', notFinance, act((req, res, c) => { const { reason } = validate(req.body, { reason: 'string!' }); const d = json(c.details, {}); d.paused = { reason, by: req.user.name, at: nowIso() }; update('cases', c.id, { details: d }); addEvent(c.id, req.user, 'paused', { reason }); res.json({ ok: true }); }));
ops.post('/cases/:id/resume', notFinance, act((req, res, c) => { const d = json(c.details, {}); delete d.paused; update('cases', c.id, { details: d }); addEvent(c.id, req.user, 'resumed', {}); res.json({ ok: true }); }));
ops.post('/cases/:id/cancel', notFinance, act((req, res, c) => res.json({ case: caseSummary(cancelCase(c, req.user, req.body?.reason || 'Cancelled by Emirattest')) })));
ops.post('/cases/:id/refund-request', notFinance, act((req, res, c) => { const b = validate(req.body, { amount: 'number!', reason: 'string!' }); res.status(201).json({ refund: requestRefund(c, req.user, b) }); }));

// ---------- requirements registry ----------
ops.get('/routes', (req, res) => res.json({ routes: listRoutes(), stale: staleRoutes(), reviews: all("SELECT r.*, rt.slug, rt.title_en, c.ref FROM rule_change_reviews r JOIN routes rt ON rt.id = r.route_id LEFT JOIN cases c ON c.id = r.case_id ORDER BY r.id DESC LIMIT 100").map((r) => ({ ...r, impact: json(r.impact, {}) })) }));
ops.get('/routes/:slug/versions', (req, res) => { const r = get('SELECT id FROM routes WHERE slug = ?', req.params.slug); if (!r) throw notFound(); res.json({ versions: all('SELECT id, version, changed_at, summary, changed_by FROM route_versions WHERE route_id = ? ORDER BY version DESC', r.id) }); });
ops.put('/routes/:slug', requireRole('ops', 'admin'), (req, res) => {
  const b = validate(req.body, { title_en: 'string', summary: 'string', apostille_applicable: 'boolean', stages: 'array', changeSummary: 'string' });
  const r = updateRoute(req.params.slug, b, req.user, b.changeSummary);
  if (!r) throw notFound(); res.json(r);
});
ops.post('/routes/:slug/review', requireRole('ops', 'admin'), (req, res) => { const r = markRouteReviewed(req.params.slug, req.user); if (!r) throw notFound(); res.json({ route: r }); });
ops.patch('/rule-reviews/:id', requireRole('ops', 'admin', 'support'), (req, res) => {
  const rv = get('SELECT * FROM rule_change_reviews WHERE id = ?', Number(req.params.id)); if (!rv) throw notFound();
  const b = validate(req.body, { status: ['open', 'reviewed', 'customer_notified', 'no_impact'], assigned_to: 'number', notify_customer: 'boolean' });
  update('rule_change_reviews', rv.id, { status: b.status || rv.status, assigned_to: b.assigned_to ?? rv.assigned_to, resolved_at: b.status && b.status !== 'open' ? nowIso() : null });
  if (b.notify_customer && rv.case_id) { const c = get('SELECT * FROM cases WHERE id = ?', rv.case_id); const imp = json(rv.impact, {}); notify(c.customer_id, { title: `${c.ref}: requirements changed`, body: `An official requirement changed. Estimated cost effect: AED ${imp.estimatedDelta || 0}. You approve any change before more money is spent.`, link: `/app/cases/${c.id}`, kind: 'case', whatsapp: true }); addEvent(c.id, req.user, 'route_change_notified', imp); }
  res.json({ ok: true });
});

// ---------- providers & network ----------
ops.get('/providers', (req, res) => res.json({ providers: all('SELECT * FROM providers ORDER BY name').map((p) => ({ ...providerOut(p), metrics: providerMetrics(p.id), feedback_challenged: get('SELECT COUNT(*) AS n FROM provider_feedback WHERE provider_id = ? AND challenged = 1', p.id).n })) }));
ops.patch('/providers/:id', requireRole('ops', 'admin'), (req, res) => {
  const b = validate(req.body, { status: ['active', 'suspended'], suspended_reason: 'string', sponsored: 'boolean', license_verified: 'boolean' });
  update('providers', Number(req.params.id), b); audit(req.user, 'provider.update', 'provider', req.params.id, b); res.json({ ok: true });
});
/** Controlled transfer of open work (customer information and custody are preserved). */
ops.post('/providers/:id/transfer', requireRole('ops', 'admin'), (req, res) => {
  const { toProviderId } = validate(req.body, { toProviderId: 'number!' });
  const open = all("SELECT * FROM cases WHERE provider_id = ? AND status IN ('assigned','collected','submitted','authority_pending','provider_pending','correction_required')", Number(req.params.id));
  open.forEach((c) => { update('cases', c.id, { provider_id: toProviderId }); all("SELECT id FROM case_tasks WHERE case_id = ? AND provider_id = ? AND status = 'open'", c.id, Number(req.params.id)).forEach((t) => update('case_tasks', t.id, { provider_id: toProviderId })); addEvent(c.id, req.user, 'provider_transferred', { from: Number(req.params.id), to: toProviderId }); });
  audit(req.user, 'provider.transfer', 'provider', req.params.id, { to: toProviderId, cases: open.length });
  res.json({ transferred: open.length });
});
ops.get('/network', (req, res) => {
  const agents = all("SELECT u.id, u.name, a.* FROM users u JOIN agent_profiles a ON a.user_id = u.id").map((a) => ({ id: a.id, name: a.name, status: a.status, emirates: json(a.emirates, []), capacity_per_day: a.capacity_per_day, vehicle: a.vehicle, open_tasks: get("SELECT COUNT(*) AS n FROM case_tasks WHERE owner_user_id = ? AND status = 'open'", a.id).n, tasks: all("SELECT t.id, t.title, t.scheduled_at, t.due_at, t.status, c.ref FROM case_tasks t JOIN cases c ON c.id = t.case_id WHERE t.owner_user_id = ? AND t.status = 'open' ORDER BY COALESCE(t.scheduled_at,t.due_at) LIMIT 8", a.id) }));
  const coverage = ['Abu Dhabi', 'Dubai', 'Sharjah', 'Ajman', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah'].map((e) => ({ emirate: e, agents: agents.filter((a) => a.emirates.includes(e)).length, open_tasks: get("SELECT COUNT(*) AS n FROM case_tasks WHERE emirate = ? AND status = 'open'", e).n }));
  const unassigned = all("SELECT t.*, c.ref FROM case_tasks t JOIN cases c ON c.id = t.case_id WHERE t.owner_kind = 'agent' AND t.owner_user_id IS NULL AND t.status = 'open'");
  const custodyOffline = all('SELECT e.*, c.ref FROM custody_events e JOIN cases c ON c.id = e.case_id WHERE e.offline = 1 ORDER BY e.id DESC LIMIT 15');
  res.json({ agents, coverage, unassigned, offline_events: custodyOffline, note: 'Offline events retain both capture time and synchronisation time; they are never presented as live updates.' });
});

// ---------- support & communications ----------
ops.get('/support', notFinance, (req, res) => res.json({
  conversations: all('SELECT cv.*, u.name AS user_name FROM conversations cv LEFT JOIN users u ON u.id = cv.user_id ORDER BY handoff DESC, last_msg_at DESC LIMIT 60').map((c) => ({ ...c, context: undefined, last: get('SELECT body, direction FROM conv_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1', c.id) })),
  complaints: all('SELECT c.*, u.name AS customer, cs.ref AS case_ref FROM complaints c JOIN users u ON u.id = c.user_id LEFT JOIN cases cs ON cs.id = c.case_id ORDER BY c.id DESC LIMIT 60'),
  callbacks: all("SELECT * FROM callbacks ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, id DESC LIMIT 40"),
  incidents: all('SELECT i.*, c.ref AS case_ref FROM incidents i LEFT JOIN cases c ON c.id = i.case_id ORDER BY i.id DESC LIMIT 40').map((i) => ({ ...i, corrective_actions: json(i.corrective_actions, []) })),
  kb: all('SELECT id, slug, lang, title, status, approved_by, approved_at FROM kb_articles ORDER BY slug'), whatsapp: whatsappStatus(),
}));
ops.get('/conversations/:id', notFinance, (req, res) => { const c = get('SELECT cv.*, u.name AS user_name FROM conversations cv LEFT JOIN users u ON u.id = cv.user_id WHERE cv.id = ?', Number(req.params.id)); if (!c) throw notFound(); res.json({ conversation: { ...c, context: json(c.context, {}) }, messages: conversationMessages(c.id) }); });
ops.post('/conversations/:id/reply', notFinance, async (req, res) => {
  const c = get('SELECT * FROM conversations WHERE id = ?', Number(req.params.id)); if (!c) throw notFound();
  const { body } = validate(req.body, { body: 'string!' });
  insert('conv_messages', { conversation_id: c.id, direction: 'out', kind: 'text', body, sender: `staff:${req.user.name}` });
  update('conversations', c.id, { handoff: 1, assigned_staff_id: req.user.id, last_msg_at: nowIso() });
  let delivery = { sent: false };
  if (c.channel === 'whatsapp') { try { delivery = await sendWhatsAppText(c.wa_id, body); } catch (e) { delivery = { sent: false, error: e.message }; } }
  res.status(201).json({ delivery: delivery.sent ? 'sent' : 'recorded (simulated — no live WhatsApp credentials)', error: delivery.error });
});
ops.post('/conversations/:id/resolve', notFinance, (req, res) => { update('conversations', Number(req.params.id), { handoff: 0, state: 'menu', context: {} }); res.json({ ok: true }); });
ops.patch('/complaints/:id', notFinance, (req, res) => {
  const cp = get('SELECT * FROM complaints WHERE id = ?', Number(req.params.id)); if (!cp) throw notFound();
  const b = validate(req.body, { status: ['open', 'acknowledged', 'investigating', 'resolved', 'closed'], resolution: 'string', remedy_aed: 'number', failure_source: ['customer', 'emirattest', 'provider', 'authority'] });
  const patch = { ...b }; if (b.status === 'acknowledged' && !cp.ack_at) patch.ack_at = nowIso(); if (['resolved', 'closed'].includes(b.status)) patch.resolved_at = nowIso();
  update('complaints', cp.id, patch);
  if (b.status === 'resolved') notify(cp.user_id, { title: `Complaint ${cp.ref} resolved`, body: b.resolution || '', link: '/app', kind: 'complaint' });
  audit(req.user, 'complaint.update', 'complaint', cp.id, b); res.json({ ok: true });
});
ops.patch('/callbacks/:id', notFinance, (req, res) => { update('callbacks', Number(req.params.id), { status: req.body?.status === 'done' ? 'done' : 'open', assigned_to: req.user.id }); res.json({ ok: true }); });
ops.patch('/incidents/:id', notFinance, (req, res) => {
  const b = validate(req.body, { status: ['open', 'contained', 'investigating', 'closed'], corrective_actions: 'array' });
  update('incidents', Number(req.params.id), { ...b, closed_at: b.status === 'closed' ? nowIso() : null }); audit(req.user, 'incident.update', 'incident', req.params.id, b); res.json({ ok: true });
});
ops.put('/kb/:id', requireRole('ops', 'admin'), (req, res) => { const b = validate(req.body, { title: 'string', body: 'string', status: ['approved', 'draft'] }); update('kb_articles', Number(req.params.id), { ...b, approved_by: req.user.name, approved_at: nowIso() }); res.json({ ok: true }); });
ops.post('/kb', requireRole('ops', 'admin'), (req, res) => { const b = validate(req.body, { slug: 'string!', lang: ['en', 'ar'], title: 'string!', body: 'string!', tags: 'string' }); res.status(201).json({ id: insert('kb_articles', { ...b, slug: `${b.slug}:${b.lang || 'en'}`, lang: b.lang || 'en', status: 'approved', approved_by: req.user.name, approved_at: nowIso() }) }); });

// ---------- finance ----------
ops.get('/finance/overview', financeOnly, (req, res) => res.json({ live: liveFinance(), aging: collectionAging(), refunds: all('SELECT r.*, c.ref FROM refunds r JOIN cases c ON c.id = r.case_id ORDER BY r.id DESC LIMIT 50'), refund_dual_threshold: Number(getSetting('refund_dual_threshold', 300)), settlements: all('SELECT s.*, p.name AS provider, c.ref FROM provider_settlements s JOIN providers p ON p.id = s.provider_id LEFT JOIN cases c ON c.id = s.case_id ORDER BY s.id DESC LIMIT 60'), pending_transfers: all("SELECT p.*, c.ref FROM payments p JOIN cases c ON c.id = p.case_id WHERE p.status = 'pending' AND p.method = 'bank_transfer'") }));
ops.get('/finance/ledger', financeOnly, (req, res) => { const rows = req.query.case ? all('SELECT * FROM ledger_entries WHERE case_id = ? ORDER BY id', Number(req.query.case)) : all('SELECT l.*, c.ref FROM ledger_entries l LEFT JOIN cases c ON c.id = l.case_id ORDER BY l.id DESC LIMIT 300'); if (req.query.format === 'csv') { res.type('text/csv'); return res.send(toCsv(rows)); } res.json({ entries: rows }); });
ops.get('/finance/forecast', financeOnly, (req, res) => res.json(cashForecast({ newOrdersPerWeek: Number(req.query.orders || 90), avgNetFee: Number(req.query.fee || 160) })));
ops.get('/finance/model', financeOnly, (req, res) => res.json(financialModel({ multiplier: Number(req.query.mult || 1) })));
ops.post('/finance/refunds/:id/approve', financeOnly, (req, res) => res.json({ refund: approveRefund(Number(req.params.id), req.user) }));
ops.post('/finance/refunds/:id/reject', financeOnly, (req, res) => res.json({ refund: rejectRefund(Number(req.params.id), req.user, req.body?.note) }));
ops.post('/finance/payments/:id/reconcile', financeOnly, (req, res) => {
  const p = get('SELECT * FROM payments WHERE id = ?', Number(req.params.id)); if (!p) throw notFound();
  const { bank_ref } = validate(req.body, { bank_ref: 'string!' });
  const v = verifyPayment(p.id, `bank:${bank_ref}`); afterVerified(v); audit(req.user, 'payment.reconcile', 'payment', p.id, { bank_ref });
  res.json({ payment: v });
});
ops.post('/finance/settlements/:id/pay', financeOnly, (req, res) => {
  const s = get('SELECT * FROM provider_settlements WHERE id = ?', Number(req.params.id)); if (!s) throw notFound();
  tx(() => { update('provider_settlements', s.id, { status: 'paid', paid_at: nowIso() }); all("SELECT id FROM ledger_entries WHERE case_id = ? AND account = 'supplier_payable' AND provider_id = ? AND state = 'open'", s.case_id, s.provider_id).forEach((l) => update('ledger_entries', l.id, { state: 'settled' })); });
  audit(req.user, 'settlement.pay', 'settlement', s.id, { amount: s.amount }); res.json({ ok: true });
});
ops.post('/finance/authority-payments', financeOnly, (req, res) => {
  const b = validate(req.body, { case_id: 'number!', amount: 'number!', reference: 'string!' });
  const open = all("SELECT * FROM ledger_entries WHERE case_id = ? AND account = 'authority_payable' AND state = 'open'", b.case_id);
  if (!open.length) throw conflict('No authority payable open on this case');
  open.forEach((l) => update('ledger_entries', l.id, { state: 'settled', memo: `${l.memo} — paid ${b.reference}` })); audit(req.user, 'authority.pay', 'case', b.case_id, b); res.json({ settled: open.length });
});
ops.post('/finance/invoices/:id/reconcile', financeOnly, (req, res) => { update('invoices', Number(req.params.id), { status: 'paid', paid_at: nowIso() }); audit(req.user, 'invoice.reconcile', 'invoice', req.params.id, {}); res.json({ ok: true }); });
ops.get('/finance/export/:type', financeOnly, (req, res) => {
  const rows = req.params.type === 'payments' ? all("SELECT p.id, c.ref, p.amount, p.method, p.status, p.receipt_no, p.verified_at FROM payments p LEFT JOIN cases c ON c.id = p.case_id") : req.params.type === 'refunds' ? all('SELECT * FROM refunds') : all('SELECT * FROM invoices');
  res.type('text/csv').setHeader('Content-Disposition', `attachment; filename="${req.params.type}.csv"`); res.send(toCsv(rows));
});

// ---------- administration ----------
ops.get('/users', adminOnly, (req, res) => res.json({ users: all('SELECT id, name, email, phone, role, status, mfa_enabled, created_at FROM users ORDER BY id DESC LIMIT 300'), orgs: all('SELECT o.*, (SELECT COUNT(*) FROM org_members m WHERE m.org_id = o.id) AS members FROM orgs o ORDER BY o.id DESC') }));
ops.post('/users', adminOnly, (req, res) => {
  const b = validate(req.body, { name: 'string!', email: 'string!', password: 'string!', role: ['support', 'ops', 'finance', 'admin', 'provider', 'agent', 'customer'] });
  if (!emailOk(b.email)) throw bad('Invalid email'); const pp = passwordProblem(b.password); if (pp) throw bad(pp);
  if (get('SELECT 1 AS x FROM users WHERE email = ?', b.email.toLowerCase())) throw conflict('Email already in use');
  const id = insert('users', { name: b.name, email: b.email.toLowerCase(), password_hash: hashPassword(b.password), role: b.role || 'support' }); audit(req.user, 'user.create', 'user', id, { role: b.role }); res.status(201).json({ id });
});
ops.patch('/users/:id', adminOnly, (req, res) => {
  const b = validate(req.body, { role: ['support', 'ops', 'finance', 'admin', 'provider', 'agent', 'customer'], status: ['active', 'disabled'], resetMfa: 'boolean' });
  const patch = {}; if (b.role) patch.role = b.role; if (b.status) patch.status = b.status; if (b.resetMfa) { patch.mfa_enabled = 0; patch.mfa_secret = null; }
  if (Number(req.params.id) === req.user.id && (b.status === 'disabled' || (b.role && b.role !== 'admin'))) throw conflict('You cannot demote or disable yourself');
  update('users', Number(req.params.id), patch); if (b.status === 'disabled') revokeAllSessions(Number(req.params.id)); audit(req.user, 'user.update', 'user', req.params.id, b); res.json({ ok: true });
});
ops.patch('/orgs/:id', requireRole('ops', 'admin'), (req, res) => { const b = validate(req.body, { tier: ['per_case', 'team', 'enterprise'], credit_limit: 'number', account_manager_id: 'number', status: ['active', 'suspended'] }); update('orgs', Number(req.params.id), b); audit(req.user, 'org.update', 'org', req.params.id, b); res.json({ ok: true }); });
ops.get('/audit', requireRole('admin', 'ops', 'finance'), (req, res) => res.json({ entries: all('SELECT id, ts, actor_label, action, entity, entity_id, detail, hash FROM audit_log ORDER BY id DESC LIMIT ?', Math.min(Number(req.query.limit || 150), 500)), chain: verifyAuditChain() }));
ops.get('/settings', adminOnly, (req, res) => res.json({ settings: { refund_dual_threshold: getSetting('refund_dual_threshold', 300), opening_cash: getSetting('opening_cash', 330000), require_staff_mfa: config.requireStaffMfa }, integrations: { ...integrationStatus(whatsappStatus().mode), demo_mode: config.demoMode } }));
ops.put('/settings', adminOnly, (req, res) => { const b = validate(req.body, { refund_dual_threshold: 'number', opening_cash: 'number' }); Object.entries(b).forEach(([k, v]) => setSetting(k, v)); audit(req.user, 'settings.update', 'settings', null, b); res.json({ ok: true }); });
ops.get('/outbox', adminOnly, (req, res) => res.json({ messages: all('SELECT id, channel, to_addr, subject, status, error, created_at, sent_at FROM outbox ORDER BY id DESC LIMIT 100') }));
ops.post('/jobs/run', adminOnly, async (req, res) => { const sent = await flushOutbox(50); const hooks = await runWebhookQueue(50); res.json({ outbox_processed: sent, webhooks_processed: hooks }); });
export const _op = { addDays, money, normPhone, run, sqlTs, businessHoursBetween, notifyMany, notifyRole, quoteOut, config };
