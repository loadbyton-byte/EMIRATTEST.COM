import { all, get, insert, update, json, tx, getSetting } from '../db.js';
import { audit } from '../lib/audit.js';
import { bad, conflict, forbidden, notFound, nowIso, todayStr, addDays, money } from '../lib/util.js';
import { getService, getRoute } from './catalog.js';
import { buildLines, totals, STANDARD_ASSUMPTIONS, STANDARD_EXCLUSIONS, QUOTE_VALID_DAYS, PROCESSING_PER_DOC } from './pricing.js';
import { transition, addEvent, addTask, markFirstResponse } from './cases.js';
import { orgRole } from './access.js';
import { createPayment } from './payments.js';
import { notify, notifyMany } from './notify.js';

export const quoteOut = (q) => q && ({ ...q, lines: json(q.lines, []), exclusions: json(q.exclusions, []), assumptions: json(q.assumptions, []) });

export function draftQuote(c, staff, { lines, validDays = QUOTE_VALID_DAYS, emergencyLimit = 0, reason, kind = 'quotation', parentQuoteId } = {}) {
  const svc = getService(c.service_id);
  const route = c.route_id ? getRoute(c.route_id) : null;
  const provider = c.provider_id ? get('SELECT * FROM providers WHERE id = ?', c.provider_id) : null;
  if (kind === 'quotation' && svc.kind === 'case' && route && !provider) throw conflict('The customer must choose a provider before a quotation can be issued');
  const generated = buildLines({ service: svc, route, docCount: c.doc_count, expedited: !!c.expedited, pickupEmirate: c.pickup_emirate, deliveryEmirate: c.delivery_emirate, business: !!c.org_id, readinessCredit: !!c.readiness_review_paid, providerFactor: provider?.price_factor || 1 });
  let finalLines = lines || generated;
  if (lines) {
    for (const l of lines) {
      if (!l.label || !Number.isFinite(Number(l.amount)) || !['emirattest', 'authority', 'courier', 'provider'].includes(l.party)) throw bad('Each line needs label, numeric amount and a valid party');
    }
    finalLines = lines.map((l) => ({ ...l, amount: money(l.amount), kind: l.party === 'emirattest' ? 'fee' : 'pass_through' }));
  }
  const t = totals(finalLines);
  const version = (get('SELECT MAX(version) AS v FROM quotes WHERE case_id = ?', c.id).v || 0) + 1;
  const id = insert('quotes', {
    case_id: c.id, version, kind, status: 'draft', lines: finalLines, subtotal_fee: t.subtotal_fee, vat: t.vat, pass_through_total: t.pass_through_total, total: t.total,
    valid_until: addDays(todayStr(), validDays), exclusions: STANDARD_EXCLUSIONS, assumptions: STANDARD_ASSUMPTIONS, created_by: staff?.id, emergency_limit_aed: emergencyLimit, parent_quote_id: parentQuoteId, reason,
  });
  return quoteOut(get('SELECT * FROM quotes WHERE id = ?', id));
}

export function issueQuote(c, quoteId, staff) {
  const q = get('SELECT * FROM quotes WHERE id = ? AND case_id = ?', quoteId, c.id);
  if (!q) throw notFound('Quote not found');
  if (q.status !== 'draft') throw conflict('Only draft quotes can be issued');
  return tx(() => {
    all("SELECT id FROM quotes WHERE case_id = ? AND status = 'awaiting_approval' AND kind = ?", c.id, q.kind).forEach((o) => update('quotes', o.id, { status: 'superseded' }));
    update('quotes', q.id, { status: 'awaiting_approval', approved_by: staff.id });
    let next = c;
    if (q.kind === 'quotation') {
      if (c.status === 'ready_for_review') next = transition(c, 'quotation_awaiting_approval', staff, { detail: { quote_version: q.version, total: q.total } });
      else if (c.status === 'awaiting_payment') next = transition(c, 'quotation_awaiting_approval', staff, { detail: { quote_version: q.version, total: q.total } });
      update('cases', c.id, { quoted_at: nowIso() });
      markFirstResponse(c, staff);
    } else {
      addEvent(c.id, staff, 'variation_requested', { quote_id: q.id, total: q.total, reason: q.reason });
      notify(c.customer_id, { title: `${c.ref}: variation needs your approval`, body: `${q.reason || 'Scope changed'} — AED ${q.total}. No additional spending happens until you approve.`, link: `/app/cases/${c.id}`, kind: 'case', whatsapp: true });
    }
    audit(staff, 'quote.issue', 'quote', q.id, { case: c.id, total: q.total, kind: q.kind });
    return quoteOut(get('SELECT * FROM quotes WHERE id = ?', q.id));
  });
}

function approvalLimit(user, c) {
  if (!c.org_id) return Infinity;
  if (c.customer_id === user.id || true) {
    const m = orgRole(user.id, c.org_id);
    if (!m) return 0;
    if (m.role === 'owner') return Infinity;
    return m.approval_limit || 0;
  }
}

/** Customer / org approver accepts a quote. Enforces expiry, approval limits and cost-centre budgets; then opens payment (or approved credit). */
export function acceptQuote(c, quoteId, user, { method = 'card' } = {}) {
  const q = get('SELECT * FROM quotes WHERE id = ? AND case_id = ?', quoteId, c.id);
  if (!q) throw notFound('Quote not found');
  if (q.status !== 'awaiting_approval') throw conflict(`Quote is ${q.status}`);
  if (q.valid_until < todayStr()) { update('quotes', q.id, { status: 'expired' }); throw conflict('This quotation has expired. Ask for a refreshed quotation.'); }
  if (c.org_id) {
    const lim = approvalLimit(user, c);
    if (q.total > lim) {
      addEvent(c.id, user, 'approval_requested', { quote_id: q.id, total: q.total, limit: lim === Infinity ? null : lim }, { visibility: 'customer' });
      const approvers = all("SELECT user_id FROM org_members WHERE org_id = ? AND role IN ('owner','approver') AND approval_limit >= ?", c.org_id, q.total).map((r) => r.user_id);
      const owners = all("SELECT user_id FROM org_members WHERE org_id = ? AND role = 'owner'", c.org_id).map((r) => r.user_id);
      notifyMany([...approvers, ...owners], { title: `${c.ref}: approval needed (AED ${q.total})`, body: `Exceeds ${user.name}'s approval limit.`, link: `/app/cases/${c.id}`, kind: 'approval' });
      throw conflict(`AED ${q.total} exceeds your approval limit. An approver has been asked to approve.`, { needs_approval: true });
    }
    if (c.cost_center_id) {
      const cc = get('SELECT * FROM cost_centers WHERE id = ?', c.cost_center_id);
      const spent = get("SELECT COALESCE(SUM(p.amount),0) AS s FROM payments p JOIN cases k ON k.id = p.case_id WHERE k.cost_center_id = ? AND p.status = 'verified'", cc.id).s;
      if (cc.budget && spent + q.total > cc.budget && lim_unlimited(user, c) === false) throw conflict(`Cost centre ${cc.code} budget (AED ${cc.budget}) would be exceeded`, { budget_exceeded: true });
    }
  }
  return tx(() => {
    update('quotes', q.id, { status: 'accepted', accepted_at: nowIso() });
    audit(user, 'quote.accept', 'quote', q.id, { case: c.id, total: q.total });
    addEvent(c.id, user, 'quote_accepted', { quote_id: q.id, version: q.version, total: q.total, kind: q.kind });
    let payMethod = method;
    if (method === 'credit_account') {
      const org = c.org_id ? get('SELECT * FROM orgs WHERE id = ?', c.org_id) : null;
      if (!org || !org.credit_limit) throw conflict('No approved credit account is available');
      const exposure = get("SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE org_id = ? AND method = 'credit_account' AND status = 'verified' AND kind != 'settled'", org.id).s;
      if (exposure + q.total > org.credit_limit) throw conflict(`Credit limit AED ${org.credit_limit} would be exceeded`);
    }
    const pay = createPayment({ c, quote: q, user, method: payMethod });
    let next = c;
    if (q.kind === 'quotation' && c.status === 'quotation_awaiting_approval') next = transition(c, 'awaiting_payment', user, { detail: { payment_token: undefined, method: payMethod } });
    return { quote: quoteOut(get('SELECT * FROM quotes WHERE id = ?', q.id)), payment: pay.payment, case: get('SELECT * FROM cases WHERE id = ?', next.id), checkout: pay.checkout };
  });
}
const lim_unlimited = (user, c) => approvalLimit(user, c) === Infinity;

export function rejectQuote(c, quoteId, user, reason) {
  const q = get('SELECT * FROM quotes WHERE id = ? AND case_id = ?', quoteId, c.id);
  if (!q || q.status !== 'awaiting_approval') throw conflict('Quote cannot be rejected');
  update('quotes', q.id, { status: 'rejected' });
  addEvent(c.id, user, 'quote_rejected', { quote_id: q.id, reason });
  let next = c;
  if (q.kind === 'quotation' && c.status === 'quotation_awaiting_approval') next = transition(c, 'ready_for_review', user, { detail: { reason }, nextAction: 'Revise the quotation', owner: 'emirattest' });
  return get('SELECT * FROM cases WHERE id = ?', next.id);
}

/** Staff creates a variation for new document counts, authority changes or extra work. Needs customer approval unless within an agreed emergency limit. */
export function createVariation(c, staff, { reason, lines, emergency = false }) {
  if (!reason) throw bad('A reason is required');
  const accepted = get("SELECT * FROM quotes WHERE case_id = ? AND kind = 'quotation' AND status = 'accepted' ORDER BY version DESC LIMIT 1", c.id);
  if (!accepted) throw conflict('No accepted quotation to vary');
  const draft = draftQuote(c, staff, { lines, reason, kind: 'variation', parentQuoteId: accepted.id, validDays: 5 });
  if (emergency) {
    const used = get("SELECT COALESCE(SUM(total),0) AS s FROM quotes WHERE case_id = ? AND kind = 'variation' AND status = 'accepted' AND reason LIKE 'EMERGENCY:%'", c.id).s;
    if (!accepted.emergency_limit_aed || draft.total + used > accepted.emergency_limit_aed) throw forbidden(`Emergency handling is limited to AED ${accepted.emergency_limit_aed || 0} agreed in the accepted quotation`);
    update('quotes', draft.id, { reason: `EMERGENCY: ${reason}` });
    addEvent(c.id, staff, 'emergency_variation', { amount: draft.total, limit: accepted.emergency_limit_aed, reason });
  }
  return issueQuote(c, draft.id, staff);
}

export const expireQuotes = () => {
  const rows = all("SELECT id FROM quotes WHERE status = 'awaiting_approval' AND valid_until < ?", todayStr());
  rows.forEach((r) => update('quotes', r.id, { status: 'expired' }));
  return rows.length;
};
export const _x = { PROCESSING_PER_DOC, getSetting };
