import { all, get, insert, update, run, json, tx } from '../db.js';
import { config } from '../config.js';
import { audit } from '../lib/audit.js';
import { bad, conflict, forbidden, notFound, nowIso, todayStr, addDays, randomToken, money } from '../lib/util.js';
import { getService, getRoute, resolveRoute } from './catalog.js';
import { orgRole, profileAccess } from './access.js';
import { addBusinessHours, sqlTs, nowDate } from './time.js';
import { notify, notifyMany, notifyRole } from './notify.js';
import { emitOrgEvent } from './webhooks.js';

export const STATUS = {
  draft: { label: 'Draft', owner: 'customer', action: 'Complete your request' },
  customer_action_required: { label: 'Customer action required', owner: 'customer', action: 'Upload or correct the requested items', hours: 48, calendar: true },
  ready_for_review: { label: 'Ready for review', owner: 'emirattest', action: 'Readiness review and route confirmation', hours: 8 },
  quotation_awaiting_approval: { label: 'Quotation awaiting approval', owner: 'customer', action: 'Review and approve the quotation', hours: 72, calendar: true },
  awaiting_payment: { label: 'Awaiting payment', owner: 'customer', action: 'Pay the approved quotation', hours: 72, calendar: true },
  assigned: { label: 'Assigned', owner: 'provider', action: 'Collect or receive documents', hours: 16 },
  collected: { label: 'Collected', owner: 'provider', action: 'Submit to the authority', hours: 16 },
  submitted: { label: 'Submitted', owner: 'authority', action: 'Authority processing', hours: 48, calendar: true },
  authority_pending: { label: 'Authority pending', owner: 'authority', action: 'Waiting for the authority', hours: 48, calendar: true },
  provider_pending: { label: 'Provider pending', owner: 'provider', action: 'Provider is completing a stage', hours: 24 },
  rejected: { label: 'Rejected', owner: 'customer', action: 'Choose a recovery option', hours: 24 },
  correction_required: { label: 'Correction required', owner: 'customer', action: 'Correct the issue and resubmit', hours: 48, calendar: true },
  completed: { label: 'Completed', owner: 'emirattest', action: 'Arrange return delivery', hours: 16 },
  dispatched: { label: 'Dispatched', owner: 'agent', action: 'Deliver originals to the authorised recipient', hours: 24, calendar: true },
  delivered: { label: 'Delivered', owner: null, action: null },
  cancelled: { label: 'Cancelled', owner: 'emirattest', action: 'Review unused advance for refund', hours: 16 },
  refunded: { label: 'Refunded', owner: null, action: null },
};
export const ACTIVE_STATUSES = ['draft', 'customer_action_required', 'ready_for_review', 'quotation_awaiting_approval', 'awaiting_payment', 'assigned', 'collected', 'submitted', 'authority_pending', 'provider_pending', 'correction_required', 'rejected'];
export const CLOSED_STATUSES = ['completed', 'dispatched', 'delivered', 'cancelled', 'refunded'];

const T = {
  draft: ['customer_action_required', 'ready_for_review', 'cancelled'],
  customer_action_required: ['ready_for_review', 'cancelled'],
  ready_for_review: ['quotation_awaiting_approval', 'customer_action_required', 'cancelled'],
  quotation_awaiting_approval: ['awaiting_payment', 'customer_action_required', 'ready_for_review', 'cancelled'],
  awaiting_payment: ['assigned', 'cancelled', 'quotation_awaiting_approval'],
  assigned: ['collected', 'submitted', 'provider_pending', 'authority_pending', 'cancelled', 'customer_action_required'],
  collected: ['submitted', 'provider_pending', 'authority_pending', 'cancelled'],
  submitted: ['authority_pending', 'provider_pending', 'completed', 'rejected', 'correction_required'],
  authority_pending: ['provider_pending', 'completed', 'rejected', 'correction_required'],
  provider_pending: ['authority_pending', 'submitted', 'completed', 'rejected', 'correction_required'],
  rejected: ['correction_required', 'cancelled', 'refunded'],
  correction_required: ['submitted', 'ready_for_review', 'customer_action_required', 'cancelled'],
  completed: ['dispatched', 'delivered'],
  dispatched: ['delivered'],
  delivered: [],
  cancelled: ['refunded'],
  refunded: [],
};
export const canTransition = (from, to) => (T[from] || []).includes(to);

export function newRef() {
  const yy = String(nowDate().getUTCFullYear()).slice(2);
  const n = (get("SELECT COUNT(*) AS n FROM cases").n || 0) + 1;
  let ref;
  do { ref = `EMT-${yy}-${String(n + Math.floor(Math.random() * 3)).padStart(6, '0')}`; } while (get('SELECT 1 AS x FROM cases WHERE ref = ?', ref));
  return ref;
}

export function addEvent(caseId, actor, type, detail = {}, { visibility = 'customer', from, to } = {}) {
  return insert('case_events', { case_id: caseId, actor_user_id: actor?.id ?? null, actor_label: actor ? (actor.name || actor.label) : 'Emirattest system', type, from_status: from, to_status: to, detail: JSON.stringify(detail), visibility });
}

export function dueFor(status, now = nowDate()) {
  const s = STATUS[status];
  if (!s?.hours) return null;
  return sqlTs(s.calendar ? new Date(now.getTime() + s.hours * 3600000) : addBusinessHours(now, s.hours));
}

/** Move a case to a new status, enforcing the state machine and recording evidence. */
export function transition(c, to, actor, { detail = {}, visibility = 'customer', nextAction, owner, silent = false } = {}) {
  if (!canTransition(c.status, to)) throw conflict(`Cannot move a case from ${c.status} to ${to}`);
  const s = STATUS[to];
  const patch = { status: to, next_action: nextAction ?? s.action, next_action_owner: owner ?? s.owner, next_update_due: dueFor(to), updated_at: nowIso() };
  if (['completed', 'delivered', 'cancelled', 'refunded'].includes(to)) patch.closed_at = nowIso();
  update('cases', c.id, patch);
  addEvent(c.id, actor, 'status', { label: s.label, ...detail }, { visibility, from: c.status, to });
  audit(actor, 'case.status', 'case', c.id, { from: c.status, to });
  const fresh = get('SELECT * FROM cases WHERE id = ?', c.id);
  if (!silent) {
    const recipients = [fresh.customer_id];
    notifyMany(recipients, { title: `${fresh.ref}: ${s.label}`, body: `${fresh.title}. Next: ${patch.next_action || 'nothing further'}.`, link: `/app/cases/${fresh.id}`, kind: 'case', whatsapp: ['quotation_awaiting_approval', 'awaiting_payment', 'rejected', 'correction_required', 'completed', 'dispatched', 'delivered'].includes(to) });
  }
  if (fresh.org_id) emitOrgEvent(fresh.org_id, `case.${to}`, { case: caseBrief(fresh) });
  return fresh;
}

export const caseBrief = (c) => ({ id: c.id, ref: c.ref, status: c.status, title: c.title, client_ref: c.client_ref, customer_id: c.customer_id, org_id: c.org_id, target_date: c.target_date, updated_at: c.updated_at });

export function addTask(caseId, t) {
  return insert('case_tasks', { case_id: caseId, title: t.title, kind: t.kind || 'other', owner_kind: t.owner_kind || 'emirattest', owner_user_id: t.owner_user_id, provider_id: t.provider_id, status: 'open', due_at: t.due_at, scheduled_at: t.scheduled_at, address: t.address, emirate: t.emirate, contact_permission: t.contact_permission ? 1 : 0, depends_on_task_id: t.depends_on_task_id, next_action: t.next_action });
}
export function completeTask(taskId, actor) {
  const t = get('SELECT * FROM case_tasks WHERE id = ?', taskId);
  if (!t) throw notFound('Task not found');
  update('case_tasks', taskId, { status: 'done', completed_at: nowIso() });
  addEvent(t.case_id, actor, 'task_done', { task: t.title }, { visibility: 'customer' });
  return get('SELECT * FROM case_tasks WHERE id = ?', taskId);
}

// ---------- creation ----------
export function createCase(user, input) {
  const service = getService(input.serviceSlug);
  if (!service) throw bad('Unknown service');
  if (service.kind !== 'case') throw bad('This service is not a managed case. Use the booking flow or free guidance.');
  let org = null;
  if (input.orgId) {
    const m = orgRole(user.id, Number(input.orgId));
    if (!m || !['owner', 'submitter', 'approver'].includes(m.role)) throw forbidden('You cannot submit cases for this organisation');
    org = get('SELECT * FROM orgs WHERE id = ?', Number(input.orgId));
  }
  let profile = null;
  if (input.profileId) {
    profile = get('SELECT * FROM profiles WHERE id = ?', Number(input.profileId));
    if (!profile) throw bad('Unknown profile');
    const pa = profileAccess(user, profile);
    const orgOk = org && profile.org_id === org.id;
    if (!(pa?.manage || orgOk)) throw forbidden('You cannot create cases for this profile');
    if (orgOk && profile.consent_status !== 'consented' && profile.relation === 'employee') throw conflict('Employee has not consented to document collection yet');
  }
  const route = resolveRoute({ serviceSlug: service.slug, routeSlug: input.routeSlug, apostille: input.apostille });
  const docCount = Math.max(1, Math.min(200, Number(input.docCount || 1)));
  const channel = input.channel || 'web';
  const target = input.targetDate || null;
  if (target && !/^\d{4}-\d{2}-\d{2}$/.test(target)) throw bad('targetDate must be YYYY-MM-DD');
  const title = input.title || `${service.name_en}${profile ? ` — ${profile.full_name}` : ''}`;
  const credit = !org && service.slug !== 'readiness-review' ? findReadinessCredit(user.id) : null;
  const id = tx(() => {
    const cid = insert('cases', {
      ref: newRef(), customer_id: user.id, org_id: org?.id, profile_id: profile?.id, service_id: service.id, route_id: route?.id, route_version: route?.version,
      title, purpose: input.purpose, destination_country: input.destinationCountry, issuing_country: input.issuingCountry || route?.issuing_country, doc_count: docCount, target_date: target,
      status: 'customer_action_required', next_action: 'Upload your documents', next_action_owner: 'customer', next_update_due: dueFor('customer_action_required'), channel,
      client_ref: input.clientRef, client_alias: input.clientAlias, expedited: input.expedited ? 1 : 0, pickup_emirate: input.pickupEmirate, delivery_emirate: input.deliveryEmirate,
      po_number: input.poNumber, cost_center_id: input.costCenterId, readiness_review_paid: credit ? 1 : 0, share_with_employer: input.shareWithEmployer ? 1 : 0,
      details: JSON.stringify(input.details || {}),
    });
    addEvent(cid, user, 'created', { channel, service: service.name_en, route: route?.slug, route_version: route?.version });
    addTask(cid, { title: 'Upload original documents', kind: 'upload', owner_kind: 'customer', owner_user_id: user.id, next_action: 'Upload scans or photos of every document', due_at: dueFor('customer_action_required') });
    addTask(cid, { title: 'Acknowledge enquiry (4 business hour standard)', kind: 'ack', owner_kind: 'emirattest', due_at: sqlTs(addBusinessHours(nowDate(), 4)) });
    if (credit) { update('cases', credit.id, { details: JSON.stringify({ ...json(credit.details, {}), credit_applied_to: cid }) }); addEvent(cid, null, 'credit', { readiness_review_credit: credit.ref }); }
    audit(user, 'case.create', 'case', cid, { service: service.slug, channel, org: org?.id });
    return cid;
  });
  const c = get('SELECT * FROM cases WHERE id = ?', id);
  notifyRole(['support', 'ops'], { title: `New case ${c.ref}`, body: `${c.title} (${channel})`, link: `/ops/cases/${c.id}`, kind: 'ops' });
  if (org) emitOrgEvent(org.id, 'case.created', { case: caseBrief(c) });
  return c;
}

/** A paid readiness review whose credit has not been consumed yet. */
export function findReadinessCredit(userId) {
  const rr = getService('readiness-review');
  const rows = all("SELECT * FROM cases WHERE customer_id = ? AND service_id = ? AND status IN ('completed','delivered','dispatched')", userId, rr.id);
  return rows.find((r) => !json(r.details, {}).credit_applied_to) || null;
}

// ---------- staff-side first response (SLA) ----------
export function markFirstResponse(c, actor) {
  if (c.first_response_at) return;
  update('cases', c.id, { first_response_at: nowIso() });
  const t = get("SELECT id FROM case_tasks WHERE case_id = ? AND kind = 'ack' AND status = 'open'", c.id);
  if (t) completeTask(t.id, actor);
}

// ---------- tasks tied to custody/appointments ----------
export function openCustomerTasks(caseId) {
  return all("SELECT * FROM case_tasks WHERE case_id = ? AND owner_kind = 'customer' AND status = 'open'", caseId);
}

export function submitForReview(c, actor) {
  const docs = get("SELECT COUNT(*) AS n FROM documents WHERE case_id = ? AND deleted_at IS NULL AND scan_status = 'clean'", c.id).n;
  if (!docs) throw conflict('Upload at least one document before submitting for review');
  const open = all("SELECT * FROM case_tasks WHERE case_id = ? AND kind = 'upload' AND status = 'open'", c.id);
  open.forEach((t) => update('case_tasks', t.id, { status: 'done', completed_at: nowIso() }));
  const from = c.status;
  const next = transition(c, 'ready_for_review', actor, { detail: { documents: docs } });
  addTask(c.id, { title: 'Readiness review & route confirmation', kind: 'review', owner_kind: 'emirattest', due_at: next.next_update_due });
  return { from, case: next };
}

export function caseSummary(c) {
  const svc = get('SELECT slug, name_en, name_ar, category FROM services WHERE id = ?', c.service_id);
  return { ...c, details: json(c.details, {}), status_label: STATUS[c.status]?.label || c.status, service: svc };
}
