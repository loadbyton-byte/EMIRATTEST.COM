import { assertOperational } from './readiness.js';
import { bookingEvent } from './bookings.js';
import crypto from 'node:crypto';
import { all, get, insert, update, run, json, tx, getSetting } from '../db.js';
import { config } from '../config.js';
import { audit } from '../lib/audit.js';
import { bad, conflict, forbidden, notFound, nowIso, randomToken, money, safeEqual } from '../lib/util.js';
import { notify, notifyRole } from './notify.js';

const receiptNo = () => `RC-${String(config.now().getUTCFullYear()).slice(2)}-${String((get('SELECT COUNT(*) AS n FROM payments WHERE receipt_no IS NOT NULL').n || 0) + 1).padStart(5, '0')}`;

export function createPayment({ c, quote, user, method }) {
  const q = typeof quote === 'object' ? quote : get('SELECT * FROM quotes WHERE id = ?', quote);
  assertOperational(get('SELECT slug FROM services WHERE id = ?',c.service_id).slug,c.provider_id);
  const pending=get("SELECT * FROM payments WHERE quote_id=? AND user_id=? AND status='pending'",q.id,user.id);
  if(pending)return {payment:pending,checkout:{url:`/pay/${pending.token}`,provider:pending.provider}};
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
  const body = new URLSearchParams({ mode: 'payment', success_url: successUrl, cancel_url: cancelUrl, 'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': 'aed', 'line_items[0][price_data][unit_amount]': String(Math.round(payment.amount * 100)), 'line_items[0][price_data][product_data][name]': `Emirattest ${payment.kind} payment #${payment.id}`, 'metadata[payment_id]': String(payment.id), 'metadata[token]': payment.token });
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
    if (['verified','partially_refunded','refunded'].includes(p.status)) return p;
    if(providerRef?.startsWith('bank:')){if(get("SELECT id FROM payments WHERE bank_reference=? AND id!=?",providerRef.slice(5),p.id))throw conflict('This bank reference has already been reconciled');update('payments',p.id,{bank_reference:providerRef.slice(5)});}
    if (p.kind === 'subscription') return verifySubscriptionPayment(p,providerRef);
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
  if (r.requested_by === user.id) throw forbidden('You cannot approve a refund you requested');
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
function finalizeRefund(r,user,patch){
 update('refunds',r.id,{...patch,status:'approved'});audit(user,'refund.approved','refund',r.id,{});return get('SELECT * FROM refunds WHERE id=?',r.id);
}
export function recordRefundPayout(id,user,reference){
 if(!['admin','finance'].includes(user.role))throw forbidden();
 if(!reference?.trim())throw bad('An actual payout reference is required');
 return tx(()=>{
 const r=get('SELECT * FROM refunds WHERE id=?',id);if(!r)throw notFound();if(r.status!=='approved')throw conflict('Refund must be independently approved before payout');
 if(get('SELECT id FROM refunds WHERE payout_reference=?',reference)||get('SELECT id FROM booking_refund_requests WHERE payout_reference=?',reference))throw conflict('Payout reference already used');
 update('refunds',r.id,{status:'paid',paid_at:nowIso(),payout_reference:reference});const c=get('SELECT * FROM cases WHERE id=?',r.case_id);
 insert('ledger_entries',{case_id:c.id,payment_id:r.payment_id,org_id:c.org_id,account:'refund',amount:-r.amount,state:'settled',memo:`Actual refund payout ${reference}`,category:get('SELECT category FROM services WHERE id=?',c.service_id)?.category});
 const pay=get('SELECT * FROM payments WHERE id=?',r.payment_id);const total=get("SELECT SUM(amount) AS n FROM refunds WHERE payment_id=? AND status='paid'",r.payment_id).n;if(pay)update('payments',pay.id,{status:total>=pay.amount-.001?'refunded':'partially_refunded'});
 audit(user,'refund.payout','refund',r.id,{reference});notify(c.customer_id,{title:`Refund payout recorded: ${c.ref}`,body:`AED ${r.amount}. Receipt reference ${reference}.`,link:`/app/cases/${c.id}`,kind:'payment'});return get('SELECT * FROM refunds WHERE id=?',r.id);
 });
}
export const rejectRefund=(id,user,note)=>{const r=get('SELECT * FROM refunds WHERE id=?',id);if(!r)throw notFound();if(!['requested','approved_1'].includes(r.status))throw conflict('Refund cannot be rejected in this state');update('refunds',id,{status:'rejected'});audit(user,'refund.reject','refund',id,{note});return get('SELECT * FROM refunds WHERE id=?',id);};
export const _p = { all, run, conflict };

// ---------- supplier bookings (travel, insurance, resident services) ----------
export function createBookingPayment(booking, user) {
  assertOperational(booking.service_slug,booking.supplier_id);
  const pending=get("SELECT * FROM payments WHERE booking_id=? AND user_id=? AND status='pending'",booking.id,user.id);if(pending)return pending;
  const total = money(booking.price_aed + booking.fee_aed + (booking.vat_aed||0));
  const id = insert('payments', { case_id: booking.case_id, user_id: user.id, org_id: booking.org_id, booking_id:booking.id, kind: 'booking', method: config.stripe.key||config.demoMode?'card':'bank_transfer', provider: config.stripe.key ? 'stripe' : config.demoMode ? 'mock' : 'manual', token:randomToken(16), amount: total, status: 'pending', proof_note: `booking:${booking.id}` });
  return get('SELECT * FROM payments WHERE id = ?', id);
}
function verifyBookingPayment(p, providerRef) {
  const b = get('SELECT * FROM bookings WHERE id = ?',p.booking_id||Number((p.proof_note || '').split(':')[1]));
  if(!b)throw conflict('Booking link is missing; finance must review this payment');
  if(get("SELECT id FROM payments WHERE booking_id=? AND id!=? AND status IN ('verified','partially_refunded','refunded')",b.id,p.id))throw conflict('Another collection is already recorded for this booking');
  update('payments', p.id, { status: 'verified', booking_id:b.id, provider_ref: providerRef || p.provider_ref, verified_at: nowIso(), receipt_no: receiptNo() });
  const post = (account, amount, memo, state = 'open', extra = {}) => amount && insert('ledger_entries', { payment_id: p.id, case_id: b.case_id, org_id: b.org_id, account, amount: money(amount), state, memo, category: 'travel', ...extra });
  post('cash', p.amount, `Booking ${b.ref} collection`, 'settled');
  post('supplier_payable', b.supplier_amount-b.commission_aed, `Supplier net amount — ${b.kind} (${b.ref})`, 'open', { provider_id: b.supplier_id });
  post('vat_payable',b.vat_aed||0,'VAT on booking coordination fee');
  post('deferred_service_fee', b.fee_aed + b.commission_aed, 'Booking fee and supplier commission; awaiting evidenced issuance', 'deferred');
  const status=['cancelled','cancellation_requested'].includes(b.status)?'cancellation_requested':'awaiting_supplier';
  update('bookings', b.id, { status, supplier_ref:null });
  bookingEvent(b,null,'payment_verified',status,{note:status==='cancellation_requested'?'Collection arrived after cancellation; review refund obligation.':'Collection verified. Supplier issuance is still pending.'});
  audit(null, 'booking.paid', 'booking', b.id, { amount: p.amount });
  notify(p.user_id, { title: `Payment received: ${b.ref}`, body:'Payment does not confirm ticketing, policy issuance or supplier acceptance. Follow the supplier status in your workspace.', link: '/app/bookings', kind: 'payment' });
  notifyRole(['ops','finance'],{title:`Supplier action required: ${b.ref}`,body:'Collection verified; fulfilment evidence is required.',link:'/ops/bookings',kind:'booking'});
  return get('SELECT * FROM payments WHERE id = ?', p.id);
}
export function createSubscriptionPayment(orgId,user){
 assertOperational('business-workspace');
 return tx(()=>{
 const active=get("SELECT id FROM subscriptions WHERE org_id=? AND status='active' AND (paid_through IS NULL OR paid_through>=?)",orgId,new Date().toISOString().slice(0,10));if(active)throw conflict('This organisation already has an active subscription');
 let sub=get("SELECT * FROM subscriptions WHERE org_id=? AND status='pending_payment'",orgId);
 if(!sub){const id=insert('subscriptions',{org_id:orgId,user_id:user.id,plan:'team',price_aed:299,status:'pending_payment'});sub=get('SELECT * FROM subscriptions WHERE id=?',id);}
 let payment=get("SELECT * FROM payments WHERE subscription_id=? AND status='pending'",sub.id);
 if(!payment){const id=insert('payments',{org_id:orgId,user_id:user.id,subscription_id:sub.id,kind:'subscription',method:config.stripe.key||config.demoMode?'card':'bank_transfer',provider:config.stripe.key?'stripe':config.demoMode?'mock':'manual',token:randomToken(16),amount:money(sub.price_aed*(1+config.vatRate)),status:'pending'});payment=get('SELECT * FROM payments WHERE id=?',id);}
 audit(user,'subscription.checkout','subscription',sub.id,{});
 return {subscription:sub,payment:{id:payment.id,amount:payment.amount,status:payment.status},checkout:{url:`/pay/${payment.token}`},note:'The workspace plan activates only after server-verified collection. Core case records remain accessible.'};
 });
}
function verifySubscriptionPayment(p,ref){
 const sub=get('SELECT * FROM subscriptions WHERE id=?',p.subscription_id);if(!sub)throw conflict('Subscription link missing');
 if(get("SELECT id FROM payments WHERE subscription_id=? AND id!=? AND status='verified'",sub.id,p.id))throw conflict('Subscription already collected');
 update('payments',p.id,{status:'verified',provider_ref:ref||p.provider_ref,verified_at:nowIso(),receipt_no:receiptNo()});
 const post=(account,amount,state)=>insert('ledger_entries',{payment_id:p.id,org_id:p.org_id,account,amount:money(amount),state,category:'business',memo:`Business workspace subscription ${sub.id}`});
 post('cash',p.amount,'settled');
 if(sub.status==='cancelled'){
  post('subscription_advance',sub.price_aed,'open');post('vat_payable',p.amount-sub.price_aed,'open');
  notifyRole(['finance','admin'],{title:'Cancelled subscription received a payment',body:`Payment ${p.id} needs refund review. No subscription was activated.`,link:'/ops/finance',kind:'finance'});
 }else{
  const date=config.now();const day=date.getUTCDate();date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+1);const max=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();date.setUTCDate(Math.min(day,max));
  update('subscriptions',sub.id,{status:'active',paid_through:date.toISOString().slice(0,10),started_at:nowIso()});update('orgs',sub.org_id,{tier:'team'});
  post('subscription_revenue',sub.price_aed,'recognised');post('vat_payable',p.amount-sub.price_aed,'open');
 }
 audit(null,'subscription.payment_verified','subscription',sub.id,{payment:p.id});return get('SELECT * FROM payments WHERE id=?',p.id);
}
