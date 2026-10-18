import { all, get, insert, update, json, tx } from '../db.js';
import { audit } from '../lib/audit.js';
import { bad, conflict, forbidden, notFound, nowIso, todayStr, money, addDays } from '../lib/util.js';
import { transition, addEvent, addTask, completeTask, STATUS } from './cases.js';
import { notify, notifyRole, notifyMany } from './notify.js';
import { getRoute } from './catalog.js';

/** Customer chooses a provider from the eligible list (never preselected). */
export function chooseProvider(c, user, providerId) {
  const p = get("SELECT * FROM providers WHERE id = ? AND status = 'active'", providerId);
  if (!p) throw notFound('Provider not available');
  if (['assigned', 'collected', 'submitted', 'authority_pending'].includes(c.status)) throw conflict('Provider cannot change once work has started; contact support');
  update('cases', c.id, { provider_id: p.id });
  addEvent(c.id, user, 'provider_chosen', { provider: p.name, sponsored: !!p.sponsored });
  audit(user, 'case.provider', 'case', c.id, { provider: p.id });
  return get('SELECT * FROM cases WHERE id = ?', c.id);
}

/** After payment verification: create fulfilment tasks and move to assigned. */
export function assignAfterPayment(c, staff) {
  const cur = get('SELECT * FROM cases WHERE id = ?', c.id);
  if (cur.status !== 'awaiting_payment') return cur;
  const paid = get("SELECT COUNT(*) AS n FROM payments WHERE case_id = ? AND status = 'verified' AND kind = 'quote'", c.id).n;
  if (!paid) throw conflict('Payment is not verified');
  const next = transition(cur, 'assigned', staff, { detail: { provider_id: cur.provider_id } });
  const needsPickup = !!cur.pickup_emirate;
  if (needsPickup) addTask(c.id, { title: `Pickup documents — ${cur.pickup_emirate}`, kind: 'pickup', owner_kind: 'agent', emirate: cur.pickup_emirate, due_at: addDays(todayStr(), 1), contact_permission: true });
  addTask(c.id, { title: 'Provider: submit and progress route stages', kind: 'submission', owner_kind: 'provider', provider_id: cur.provider_id, due_at: addDays(todayStr(), 2) });
  if (cur.provider_id) {
    const pu = all('SELECT user_id FROM provider_users WHERE provider_id = ?', cur.provider_id).map((r) => r.user_id);
    notifyMany(pu, { title: `New assignment ${cur.ref}`, body: cur.title, link: '/provider', kind: 'assignment', email: false });
  }
  return next;
}

export function assignAgent(c, taskId, agentUserId, staff, scheduledAt) {
  const t = get('SELECT * FROM case_tasks WHERE id = ? AND case_id = ?', taskId, c.id);
  if (!t) throw notFound('Task not found');
  const agent = get("SELECT u.*, a.emirates FROM users u JOIN agent_profiles a ON a.user_id = u.id WHERE u.id = ? AND a.status = 'active'", agentUserId);
  if (!agent) throw bad('Agent not available');
  update('case_tasks', taskId, { owner_user_id: agent.id, owner_kind: 'agent', scheduled_at: scheduledAt || t.scheduled_at });
  addEvent(c.id, staff, 'agent_assigned', { task: t.title, agent: agent.name, scheduled_at: scheduledAt }, { visibility: 'customer' });
  notify(agent.id, { title: `Task assigned: ${c.ref}`, body: t.title, link: '/agent', email: false, kind: 'assignment' });
  return get('SELECT * FROM case_tasks WHERE id = ?', taskId);
}

/** Custody evidence from field agents/providers. Offline events keep capture time and sync time separately. */
export function recordCustody(c, user, e) {
  const types = ['pickup', 'handover', 'submission', 'return', 'failed_attempt', 'incident'];
  if (!types.includes(e.type)) throw bad(`type must be one of ${types.join(', ')}`);
  if (e.client_event_id && get('SELECT id FROM custody_events WHERE client_event_id = ?', e.client_event_id)) return { duplicate: true, event: get('SELECT * FROM custody_events WHERE client_event_id = ?', e.client_event_id) };
  if (['pickup', 'return', 'handover'].includes(e.type) && !e.ack_name) throw bad('Recipient/sender acknowledgement name is required');
  if (e.type === 'return' && !e.ack_method) throw bad('Authorised recipient check method is required (a photograph alone is not enough)');
  const capturedAt = e.captured_at ? String(e.captured_at).replace('T', ' ').slice(0, 19) : nowIso();
  const id = insert('custody_events', { case_id: c.id, task_id: e.task_id, agent_user_id: user.id, type: e.type, from_party: e.from_party, to_party: e.to_party, location: e.location, lat: e.lat, lng: e.lng, ack_name: e.ack_name, ack_method: e.ack_method, note: e.note, item_summary: e.item_summary, authority_ref: e.authority_ref, captured_at: capturedAt, offline: e.offline ? 1 : 0, client_event_id: e.client_event_id });
  addEvent(c.id, user, `custody_${e.type}`, { location: e.location, ack: e.ack_name, items: e.item_summary, offline: !!e.offline, captured_at: capturedAt, authority_ref: e.authority_ref });
  if (e.task_id && e.type !== 'failed_attempt' && e.type !== 'incident') completeTask(e.task_id, user);
  const cur = get('SELECT * FROM cases WHERE id = ?', c.id);
  try {
    if (e.type === 'pickup' && cur.status === 'assigned') transition(cur, 'collected', user, { detail: { items: e.item_summary } });
    else if (e.type === 'submission' && ['assigned', 'collected', 'provider_pending'].includes(cur.status)) transition(cur, 'submitted', user, { detail: { authority_ref: e.authority_ref } });
    else if (e.type === 'return' && ['completed', 'dispatched'].includes(cur.status)) transition(cur, 'delivered', user, { detail: { ack: e.ack_name } });
  } catch { /* status already beyond; event still recorded */ }
  if (e.type === 'failed_attempt') { addTask(c.id, { title: `Reschedule after failed attempt: ${e.note || 'no reason given'}`, kind: 'reschedule', owner_kind: 'emirattest', due_at: nowIso() }); notify(c.customer_id, { title: `${c.ref}: we could not complete a collection/delivery`, body: `${e.note || 'Attempt failed'}. We will contact you to reschedule.`, link: `/app/cases/${c.id}`, kind: 'case', whatsapp: true }); }
  if (e.type === 'incident') openIncident(c, user, { type: e.incident_type || 'other', severity: 'high', detail: e.note });
  return { event: get('SELECT * FROM custody_events WHERE id = ?', id) };
}

export function openIncident(c, user, { type, severity = 'medium', detail }) {
  const ref = `INC-${String(get('SELECT COUNT(*) AS n FROM incidents').n + 1).padStart(4, '0')}`;
  const owner = get("SELECT id FROM users WHERE role = 'ops' ORDER BY id LIMIT 1");
  const id = insert('incidents', { ref, case_id: c?.id, severity, type, owner_user_id: owner?.id, status: 'open', detail, reported_by: user?.id });
  if (c) addEvent(c.id, user, 'incident_opened', { ref, type, severity }, { visibility: 'internal' });
  notifyRole(['ops', 'admin'], { title: `Incident ${ref} (${severity}): ${type}`, body: detail, link: '/ops/support', kind: 'incident' });
  audit(user, 'incident.open', 'incident', id, { type, severity });
  return get('SELECT * FROM incidents WHERE id = ?', id);
}

/** Provider/staff completes a route stage. Evidence determines progress; elapsed time never does. */
export function completeStage(c, user, { seq, evidence, note }) {
  const route = getRoute(c.route_id);
  if (!route) throw bad('Case has no route');
  const st = route.stages.find((s) => s.seq === Number(seq));
  if (!st) throw bad('Unknown stage');
  if (!evidence) throw bad('Evidence reference is required to complete a stage');
  const d = json(c.details, {});
  d.stages_done = [...new Set([...(d.stages_done || []), st.seq])];
  d.stage_evidence = { ...(d.stage_evidence || {}), [st.seq]: { evidence, note, at: nowIso(), by: user.name } };
  update('cases', c.id, { details: d });
  addEvent(c.id, user, 'stage_done', { stage: st.name, evidence });
  const required = route.stages.filter((s) => s.necessity === 'required' && s.owner !== 'emirattest');
  const allDone = required.every((s) => d.stages_done.includes(s.seq));
  let cur = get('SELECT * FROM cases WHERE id = ?', c.id);
  if (allDone && ['submitted', 'authority_pending', 'provider_pending', 'assigned', 'collected'].includes(cur.status)) {
    if (['assigned', 'collected'].includes(cur.status)) cur = transition(cur, 'submitted', user, { silent: true });
    cur = markCompleted(cur, user);
  } else if (cur.status === 'submitted') cur = transition(cur, 'authority_pending', user, { silent: true });
  return cur;
}

/** Completion recognises earned revenue, accrues provider settlement and queues return delivery. */
export function markCompleted(c, user) {
  const cur = get('SELECT * FROM cases WHERE id = ?', c.id);
  return tx(() => {
    const next = transition(cur, 'completed', user, { detail: { completed: true } });
    const deferred = get("SELECT COALESCE(SUM(amount),0) AS s FROM ledger_entries WHERE case_id = ? AND account = 'deferred_service_fee' AND state = 'deferred'", c.id).s;
    if (deferred > 0) {
      all("SELECT id FROM ledger_entries WHERE case_id = ? AND account = 'deferred_service_fee' AND state = 'deferred'", c.id).forEach((r) => update('ledger_entries', r.id, { state: 'recognised' }));
      insert('ledger_entries', { case_id: c.id, org_id: c.org_id, account: 'service_fee_revenue', amount: money(deferred), state: 'recognised', memo: 'Recognised on completion', category: get('SELECT category FROM services WHERE id = ?', c.service_id)?.category });
    }
    if (c.provider_id) {
      const owed = get("SELECT COALESCE(SUM(amount),0) AS s FROM ledger_entries WHERE case_id = ? AND account = 'supplier_payable' AND provider_id = ?", c.id, c.provider_id).s;
      if (owed > 0 && !get('SELECT id FROM provider_settlements WHERE case_id = ? AND provider_id = ?', c.id, c.provider_id)) insert('provider_settlements', { provider_id: c.provider_id, case_id: c.id, amount: money(owed), status: 'accrued' });
    }
    if (c.pickup_emirate || c.delivery_emirate) addTask(c.id, { title: `Return delivery — ${c.delivery_emirate || c.pickup_emirate}`, kind: 'delivery', owner_kind: 'agent', emirate: c.delivery_emirate || c.pickup_emirate, contact_permission: true, due_at: addDays(todayStr(), 1) });
    return next;
  });
}

/** Rejection recovery: reason, evidence, responsible party, permitted alternatives, costs and approval requirements. */
export function markRejected(c, user, { reason, evidence, responsible, alternatives = [] }) {
  if (!reason || !responsible) throw bad('reason and responsible party are required');
  if (!['customer', 'emirattest', 'provider', 'authority'].includes(responsible)) throw bad('responsible must be customer, emirattest, provider or authority');
  const next = transition(c, 'rejected', user, { detail: { reason, responsible, alternatives } });
  update('cases', c.id, { rejection_reason: reason, root_cause: responsible, details: { ...json(next.details, {}), recovery: { reason, evidence, responsible, alternatives, opened_at: nowIso() } } });
  addTask(c.id, { title: 'Choose a recovery option', kind: 'recovery', owner_kind: 'customer', owner_user_id: c.customer_id, next_action: 'Review options and costs', due_at: next.next_update_due });
  return get('SELECT * FROM cases WHERE id = ?', c.id);
}
export function chooseRecovery(c, user, index) {
  const rec = json(c.details, {}).recovery;
  if (!rec) throw conflict('No recovery in progress');
  const alt = rec.alternatives[index];
  if (!alt) throw bad('Unknown option');
  all("SELECT id FROM case_tasks WHERE case_id = ? AND kind = 'recovery' AND status = 'open'", c.id).forEach((t) => completeTask(t.id, user));
  addEvent(c.id, user, 'recovery_chosen', { option: alt.label, cost: alt.cost || 0, needs_approval: (alt.cost || 0) > 0 });
  if (alt.type === 'cancel') return transition(c, 'cancelled', user, { detail: { reason: 'Customer cancelled after rejection' } });
  return transition(c, 'correction_required', user, { detail: { option: alt.label, extra_cost: alt.cost || 0 }, nextAction: (alt.cost || 0) > 0 ? 'Approve the additional cost, then correct and resubmit' : 'Correct the issue and resubmit' });
}

export function cancelCase(c, user, reason) {
  if (!['draft', 'customer_action_required', 'ready_for_review', 'quotation_awaiting_approval', 'awaiting_payment', 'assigned', 'collected', 'correction_required', 'rejected'].includes(c.status)) throw conflict('This case can no longer be cancelled');
  const paid = get("SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE case_id = ? AND status = 'verified'", c.id).s;
  const next = transition(c, 'cancelled', user, { detail: { reason, paid }, nextAction: paid ? 'Review unused advance for refund' : null, owner: paid ? 'emirattest' : null });
  return next;
}

export const _o = { STATUS };
