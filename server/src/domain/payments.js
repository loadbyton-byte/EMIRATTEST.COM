import crypto from 'node:crypto';
import { all, get, insert, update, run, json, tx, getSetting } from '../db.js';
import { config } from '../config.js';
import { audit } from '../lib/audit.js';
import { bad, conflict, forbidden, notFound, nowIso, randomToken, money, safeEqual } from '../lib/util.js';
import { notify, notifyRole } from './notify.js';

const receiptNo = () => `RC-${String(config.now().getUTCFullYear()).slice(2)}-${String((get('SELECT COUNT(*) AS n FROM payments WHERE receipt_no IS NOT NULL').n || 0) + 1).padStart(5, '0')}`;

export function createPayment({ c, quote, user, method }) {
  const q = typeof quote === 'object' ? quote : get('SELECT * FROM quotes WHERE id = ?', quote);
  const token = randomToken(16);
  const provider = method === 'card' && config.stripe.key ? 'stripe' : method === 'card' && config.demoMode ? 'mock' : 'manual';
  const id = insert('payments', { case_id: c.id, quote_id: q.id, user_id: user.id, org_id: c.org_id, kind: q.kind === 'variation' ? 'variation' : 'quote', method, provider, token, amount: q.total, status: 'pending' });
  const payment = get('SELECT * FROM payments WHERE id = ?', id);
  let checkout = { url: `/pay/${token}`, provider };
  if (method === 'credit_account') { verifyPayment(id, 'credit-account'); checkout = { url: null, provider: 'credit_account' }; }
  return { payment: get('SELECT * FROM payments WHERE id = ?', id) || payment, checkout };
}

/** Optional Stripe Checkout (test mode) session. Falls back to the built-in mock gateway page. */
export async function startStripeCheckout(payment, successUrl, cancelUrl) {
  if (!config.stripe.key) return null;
  const body = new URLSearchParams({ mode: 'payment', success_url: successUrl, cancel_url: cancelUrl, 'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': 'aed', 'line_items[0][price_data][unit_amount]': String(Math.round(payment.amount * 100)), 'line_items[0][price_data][product_data][name]': `Emirattest case payment #${payment.case_id}`, 'metadata[payment_id]': String(payment.id), 'metadata[token]': payment.token });
  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { Authorization: `Bearer ${config.stripe.key}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || 'Stripe error');
  update('payments', payment.id, { provider_ref: j.id });
  return { url: j.url, id: j.id };
}
export function verifyStripeSignature(raw, header) {
  if (!config.stripe.webhookSecret || !header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const expected = crypto.createHmac('sha256', config.stripe.webhookSecret).update(`${parts.t}.${raw}`).digest('hex');
  return safeEqual(parts.v1 || '', expected) && Math.abs(Date.now() / 1000 - Number(parts.t)) < 600;
}

/** Built-in mock gateway for demos. Test card 4242 4242 4242 4242 succeeds; 4000 0000 0000 0002 is declined. */
export function mockCharge(payment, card) {
  const n = String(card || '').replace(/\s/g, '');
  if (!/^\d{13,19}$/.test(n)) throw bad('Enter a valid card number');
  if (n === '4000000000000002') { update('payments', payment.id, { status: 'failed' }); return { ok: false, reason: 'Card declined (test card)' }; }
  if (n !== '4242424242424242' && !/^(4|5)\d{15}$/.test(n)) throw bad('Use a test card: 4242 4242 4242 4242');
  return { ok: true, ref: `mock_${randomToken(8)}` };
}

/** Server-side verification: the ONLY path that moves money state and advances a case after payment. */
export function verifyPayment(paymentId, providerRef) {
  return tx(() => {
    const p = get('SELECT * FROM payments WHERE id = ?', paymentId);
    if (!p) throw notFound('Payment not found');
    if (p.status === 'verified') return p;
    if (p.kind === 'booking') return verifyBookingPayment(p, providerRef);
    const q = get('SELECT * FROM quotes WHERE id = ?', p.quote_id);
    const c = get('SELECT * FROM cases WHERE id = ?', p.case_id);
    update('payments', p.id, { status: 'verified', provider_ref: providerRef || p.provider_ref, verified_at: nowIso(), receipt_no: receiptNo() });
    const lines = json(q.lines, []);
    const cat = get('SELECT category FROM services WHERE id = ?', c.service_id)?.category;
    const post = (account, amount, memo, extra = {}) => amount && insert('ledger_entries', { case_id: c.id, payment_id: p.id, org_id: c.org_id, account, amount: money(amount), state: account === 'cash' ? 'settled' : account === 'deferred_service_fee' ? 'deferred' : 'open', memo, category: cat, ...extra });
    post('cash', q.total, `Collection ${p.method} (${p.provider})`);
    post('deferred_service_fee', q.subtotal_fee, 'Emirattest service fees (recognised on completion)');
    post('vat_payable', q.vat, 'VAT on service fees');
    for (const l of lines.filter((x) => x.kind === 'pass_through' && !x.conditional)) {
      post(l.party === 'authority' ? 'authority_payable' : 'supplier_payable', l.amount, l.label, l.party === 'provider' && c.provider_id ? { provider_id: c.provider_id } : {});
    }
    audit(null, 'payment.verified', 'payment', p.id, { case: c.id, amount: p.amount, ref: providerRef });
    notify(p.user_id, { title: `Payment received for ${c.ref}`, body: `Receipt ${get('SELECT receipt_no FROM payments WHERE id = ?', p.id).receipt_no}. AED ${p.amount} verified.`, link: `/app/cases/${c.id}`, kind: 'payment' });
    return get('SELECT * FROM payments WHERE id = ?', p.id);
  });
}

// ---------- refunds with dual approval ----------
export function requestRefund(c, user, { amount, reason, paymentId }) {
  const paid = get("SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE case_id = ? AND status = 'verified'", c.id).s;
  const refunded = get("SELECT COALESCE(SUM(amount),0) AS s FROM refunds WHERE case_id = ? AND status IN ('requested','approved_1','approved','paid')", c.id).s;
  amount = money(amount);
  if (!(amount > 0)) throw bad('Refund amount must be positive');
  if (amount + refunded > paid) throw conflict(`Refund exceeds amounts paid (paid ${paid}, already requested ${refunded})`);
  const pay = paymentId ? get('SELECT * FROM payments WHERE id = ?', paymentId) : get("SELECT * FROM payments WHERE case_id = ? AND status = 'verified' ORDER BY id LIMIT 1", c.id);
  const id = insert('refunds', { case_id: c.id, payment_id: pay?.id, amount, reason, requested_by: user.id, status: 'requested', expected_window: '5–10 business days after approval' });
  audit(user, 'refund.request', 'refund', id, { case: c.id, amount });
  notifyRole(['finance'], { title: `Refund requested: ${c.ref} AED ${amount}`, body: reason, link: '/ops/finance', kind: 'finance' });
  return get('SELECT * FROM refunds WHERE id = ?', id);
}
export function approveRefund(refundId, user) {
  const r = get('SELECT * FROM refunds WHERE id = ?', refundId);
  if (!r) throw notFound('Refund not found');
  if (!['finance', 'admin'].includes(user.role)) throw forbidden('Only finance or admin can approve refunds');
  if (r.requested_by === user.id && user.role !== 'admin') throw forbidden('You cannot approve a refund you requested');
  const threshold = Number(getSetting('refund_dual_threshold', 300));
  if (r.status === 'requested') {
    if (r.amount < threshold) return finalizeRefund(r, user, { approver1: user.id });
    update('refunds', r.id, { status: 'approved_1', approver1: user.id });
    audit(user, 'refund.approve1', 'refund', r.id, {});
    return get('SELECT * FROM refunds WHERE id = ?', r.id);
  }
  if (r.status === 'approved_1') {
    if (r.approver1 === user.id) throw forbidden(`Refunds of AED ${threshold}+ need two different approvers`);
    return finalizeRefund(r, user, { approver2: user.id });
  }
  throw conflict(`Refund is ${r.status}`);
}
function finalizeRefund(r, user, patch) {
  return tx(() => {
    update('refunds', r.id, { ...patch, status: 'paid', paid_at: nowIso() });
    const c = get('SELECT * FROM cases WHERE id = ?', r.case_id);
    insert('ledger_entries', { case_id: c.id, payment_id: r.payment_id, org_id: c.org_id, account: 'refund', amount: -r.amount, state: 'settled', memo: `Refund: ${r.reason || ''}`, category: get('SELECT category FROM services WHERE id = ?', c.service_id)?.category });
    const pay = get('SELECT * FROM payments WHERE id = ?', r.payment_id);
    if (pay) update('payments', pay.id, { status: r.amount >= pay.amount ? 'refunded' : 'partially_refunded' });
    audit(user, 'refund.paid', 'refund', r.id, { amount: r.amount });
    notify(c.customer_id, { title: `Refund approved: ${c.ref}`, body: `AED ${r.amount} will reach you in 5–10 business days.`, link: `/app/cases/${c.id}`, kind: 'payment' });
    return get('SELECT * FROM refunds WHERE id = ?', r.id);
  });
}
export const rejectRefund = (id, user, note) => { update('refunds', id, { status: 'rejected' }); audit(user, 'refund.reject', 'refund', id, { note }); return get('SELECT * FROM refunds WHERE id = ?', id); };
export const _p = { all, run, conflict };

// ---------- supplier bookings (travel, insurance, resident services) ----------
export function createBookingPayment(booking, user) {
  const total = money(booking.price_aed + booking.fee_aed);
  const token = randomToken(16);
  const id = insert('payments', { case_id: booking.case_id, user_id: user.id, org_id: booking.org_id, kind: 'booking', method: 'card', provider: config.stripe.key ? 'stripe' : config.demoMode ? 'mock' : 'manual', token, amount: total, status: 'pending', proof_note: `booking:${booking.id}` });
  return get('SELECT * FROM payments WHERE id = ?', id);
}
function verifyBookingPayment(p, providerRef) {
  const b = get('SELECT * FROM bookings WHERE id = ?', Number((p.proof_note || '').split(':')[1]));
  update('payments', p.id, { status: 'verified', provider_ref: providerRef || p.provider_ref, verified_at: nowIso(), receipt_no: receiptNo() });
  const post = (account, amount, memo, state = 'open', extra = {}) => amount && insert('ledger_entries', { payment_id: p.id, case_id: b.case_id, org_id: b.org_id, account, amount: money(amount), state, memo, category: 'travel', ...extra });
  post('cash', p.amount, `Booking ${b.ref} collection`, 'settled');
  post('supplier_payable', b.supplier_amount, `Supplier amount — ${b.kind} (${b.ref})`, 'open', { provider_id: b.supplier_id });
  post('deferred_service_fee', b.fee_aed + b.commission_aed, 'Booking fee and earned commission (recognised on ticketing/issue)', 'deferred');
  update('bookings', b.id, { status: 'booked', supplier_ref: `SUP-${randomToken(4).toUpperCase()}` });
  audit(null, 'booking.paid', 'booking', b.id, { amount: p.amount });
  notify(p.user_id, { title: `Booking ${b.ref} confirmed`, body: `Supplier terms and cancellation rules are in your booking. Receipt ${get('SELECT receipt_no FROM payments WHERE id = ?', p.id).receipt_no}.`, link: '/app/bookings', kind: 'payment' });
  return get('SELECT * FROM payments WHERE id = ?', p.id);
}
