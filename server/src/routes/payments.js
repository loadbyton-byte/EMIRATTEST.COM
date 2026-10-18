import express, { Router } from 'express';
import { get, update, all, insert } from '../db.js';
import { config } from '../config.js';
import { validate, bad, notFound, conflict, forbidden, nowIso } from '../lib/util.js';
import { mockCharge, verifyPayment, verifyStripeSignature, startStripeCheckout } from '../domain/payments.js';
import { assignAfterPayment } from '../domain/operations.js';
import { addEvent } from '../domain/cases.js';
import { requireAuth, rateLimit } from '../lib/auth.js';
import { audit } from '../lib/audit.js';

export const payments = Router();

function afterVerified(p) {
  if (p.kind === 'quote') { const c = get('SELECT * FROM cases WHERE id = ?', p.case_id); if (c) assignAfterPayment(c, null); }
  else if (p.kind === 'variation') addEvent(p.case_id, null, 'variation_paid', { amount: p.amount });
}

// Stripe webhook (raw body signature check). Only this and the mock/finance paths can verify a payment.
payments.post('/webhook/stripe', express.raw({ type: '*/*', limit: '1mb' }), (req, res) => {
  const raw = req.body.toString('utf8');
  if (!verifyStripeSignature(raw, req.headers['stripe-signature'])) return res.status(400).json({ error: 'Invalid signature' });
  const evt = JSON.parse(raw);
  if (evt.type === 'checkout.session.completed') {
    const pid = Number(evt.data?.object?.metadata?.payment_id);
    const p = get('SELECT * FROM payments WHERE id = ?', pid);
    if (p && p.provider === 'stripe' && evt.data.object.payment_status === 'paid' && String(evt.data.object.currency).toLowerCase() === 'aed' && (!p.provider_ref || p.provider_ref === evt.data.object.id) && Number(evt.data.object.amount_total) === Math.round(p.amount * 100)) afterVerified(verifyPayment(pid, evt.data.object.id));
  }
  res.json({ received: true });
});

payments.get('/:token', (req, res) => {
  const p = get('SELECT * FROM payments WHERE token = ?', req.params.token);
  if (!p) throw notFound('Payment link not found');
  const c = p.case_id ? get('SELECT ref, title FROM cases WHERE id = ?', p.case_id) : null;
  res.json({ amount: p.amount, currency: p.currency, status: p.status, provider: p.provider, ref: c?.ref, title: c?.title || (p.kind==='subscription'?'Business workspace subscription':'Supplier booking'), kind:p.kind, return_to:p.kind==='subscription'?`/app/business/${p.org_id}`:p.kind==='booking'?'/app/bookings':`/app/cases/${p.case_id}`, receipt_no: p.receipt_no, test_cards: p.provider === 'mock' ? { success: '4242 4242 4242 4242', declined: '4000 0000 0000 0002' } : null, demo: config.demoMode });
});

payments.post('/:token/charge', rateLimit({ windowMs: 60000, max: 12, name: 'charge' }), (req, res) => {
  const p = get('SELECT * FROM payments WHERE token = ?', req.params.token);
  if (!p) throw notFound('Payment link not found');
  if (p.provider !== 'mock') throw conflict('This payment uses an external checkout');
  if (p.status === 'verified') return res.json({ status: 'verified', receipt_no: p.receipt_no });
  if(!['pending','failed'].includes(p.status))throw conflict('This payment is not open for collection');
  const { card } = validate(req.body, { card: 'string!' });
  const r = mockCharge(p, card);
  if (!r.ok) return res.status(402).json({ status: 'failed', error: r.reason });
  const v = verifyPayment(p.id, r.ref);
  afterVerified(v);
  res.json({ status: 'verified', receipt_no: v.receipt_no });
});

payments.post('/:token/stripe', requireAuth, async (req, res) => {
  const p = get("SELECT * FROM payments WHERE token = ? AND (user_id = ? OR org_id IN (SELECT org_id FROM org_members WHERE user_id=? AND role IN ('owner','finance')))", req.params.token, req.user.id,req.user.id);
  if (!p || p.provider !== 'stripe') throw notFound('No Stripe payment for this link');
  if(p.status!=='pending')throw conflict('This payment is not awaiting collection');
  const s = await startStripeCheckout(p, `${config.baseUrl}/pay/${p.token}?returned=1`, `${config.baseUrl}/pay/${p.token}`);
  res.json(s);
});

// Customer states that they paid by bank transfer. This NEVER advances the case; finance reconciles first.
payments.post('/:token/bank-proof', requireAuth, (req, res) => {
  const p = get("SELECT * FROM payments WHERE token = ? AND (user_id = ? OR org_id IN (SELECT org_id FROM org_members WHERE user_id=? AND role IN ('owner','finance')))", req.params.token, req.user.id,req.user.id);
  if (!p) throw notFound();
  if(!['pending','failed'].includes(p.status))throw conflict('This payment is not awaiting reconciliation');
  const { reference } = validate(req.body, { reference: 'string!' });
  update('payments', p.id, { method: 'bank_transfer', customer_bank_reference: reference, status: 'pending' });
  audit(req.user, 'payment.bank_proof', 'payment', p.id, { reference });
  res.json({ ok: true, message: 'Thank you. Your case will advance after finance reconciles the transfer against our bank statement.' });
});
export const _pm = { all, insert, bad, forbidden, nowIso };
export { afterVerified };
