import { Router } from 'express';
import { all, get, insert, json } from '../db.js';
import { config } from '../config.js';
import { categories, listServices, getService, listRoutes, getRoute, staleRoutes } from '../domain/catalog.js';
import { estimate } from '../domain/pricing.js';
import { eligibleProviders } from '../domain/providers.js';
import { answer } from '../domain/ai.js';
import { financialModel, liveFinance } from '../domain/finance.js';
import { COUNTRIES, EMIRATES, COURIER_FEE, READINESS_REVIEW_FEE } from '../domain/catalog-data.js';
import { deadlinePlan } from '../domain/planner.js';
import { STATUS } from '../domain/cases.js';
import { whatsappStatus } from '../domain/whatsapp-transport.js';
import { validate, bad, notFound, normPhone, nowIso } from '../lib/util.js';
import { rateLimit } from '../lib/auth.js';
import { notifyRole } from '../domain/notify.js';

export const pub = Router();

pub.get('/health', (_req, res) => res.json({ ok: true, time: nowIso(), demo: config.demoMode }));

pub.get('/config', (_req, res) => res.json({
  demo_mode: config.demoMode, vat_rate: config.vatRate, emirates: EMIRATES, courier_fees: COURIER_FEE, readiness_review_fee: READINESS_REVIEW_FEE, countries: COUNTRIES.map(([code, en, ar]) => ({ code, en, ar })),
  integrations: { payments: config.stripe.key ? 'stripe_test' : 'mock', whatsapp: whatsappStatus().mode, ai: config.ai.key ? 'claude' : 'knowledge_base', email: config.mail.resendKey ? 'resend' : 'outbox_only' },
  commitments: { enquiry_ack_hours: 4, quote_business_days: 1 }, support_hours: 'Mon–Fri 09:00–18:00 GST',
}));

pub.get('/categories', (_req, res) => res.json({ categories: categories() }));
pub.get('/services', (req, res) => res.json({ services: listServices({ category: req.query.category, q: req.query.q }) }));
pub.get('/services/:slug', (req, res) => {
  const s = getService(req.params.slug); if (!s) throw notFound('Service not found');
  const route = s.default_route_slug ? getRoute(s.default_route_slug) : null;
  res.json({ service: s, route, estimate: s.kind === 'case' || s.kind === 'booking' ? estimate({ serviceSlug: s.slug, docCount: 1 }) : null });
});
pub.get('/routes', (req, res) => res.json({ routes: listRoutes({ category: req.query.category, q: req.query.q }) }));
pub.get('/routes/:slug', (req, res) => { const r = getRoute(req.params.slug); if (!r) throw notFound('Route not found'); res.json({ route: r }); });

pub.post('/estimate', rateLimit({ windowMs: 60000, max: 60, name: 'estimate' }), (req, res) => {
  const b = validate(req.body, { serviceSlug: 'string!', routeSlug: 'string', docCount: 'number', expedited: 'boolean', pickupEmirate: 'string', deliveryEmirate: 'string', apostille: 'boolean', business: 'boolean', readinessCredit: 'boolean' });
  const e = estimate({ ...b, docCount: Math.max(1, Math.min(200, b.docCount || 1)) });
  if (!e) throw bad('Unknown service');
  res.json({ estimate: e });
});
pub.post('/providers/eligible', (req, res) => {
  const b = validate(req.body, { serviceSlug: 'string!', routeSlug: 'string', emirate: 'string', docCount: 'number' });
  res.json(eligibleProviders(b));
});

pub.post('/assistant', rateLimit({ windowMs: 60000, max: 20, name: 'ai' }), async (req, res) => {
  const b = validate(req.body, { question: 'string!', lang: ['en', 'ar'] });
  res.json(await answer({ question: b.question, lang: b.lang || 'en' }));
});
pub.get('/kb', (req, res) => res.json({ articles: all("SELECT slug, lang, title, body FROM kb_articles WHERE status = 'approved' AND lang = ? ORDER BY title", req.query.lang === 'ar' ? 'ar' : 'en') }));

pub.post('/callback', rateLimit({ windowMs: 60000, max: 5, name: 'cb' }), (req, res) => {
  const b = validate(req.body, { name: 'string!', phone: 'string!', topic: 'string' });
  const id = insert('callbacks', { name: b.name, phone: normPhone(b.phone), topic: b.topic || 'Callback request' });
  notifyRole(['support'], { title: `Callback requested: ${b.name}`, body: b.topic || '', link: '/ops/support', kind: 'ops' });
  res.status(201).json({ id, message: 'Thank you. We acknowledge enquiries within 4 business hours (Mon–Fri 09:00–18:00 GST).' });
});

/** Public tracking: case reference + last 4 digits of the contact phone. Returns minimal status only. */
pub.post('/track', rateLimit({ windowMs: 60000, max: 10, name: 'track' }), (req, res) => {
  const b = validate(req.body, { ref: 'string!', phoneLast4: 'string!' });
  const c = get('SELECT c.*, u.phone FROM cases c JOIN users u ON u.id = c.customer_id WHERE c.ref = ?', b.ref.toUpperCase().trim());
  if (!c || !c.phone || !c.phone.endsWith(b.phoneLast4.trim())) throw notFound('No matching case. Check the reference and phone digits, or sign in.');
  res.json({ ref: c.ref, status: c.status, status_label: STATUS[c.status].label, next_action: c.next_action, next_action_owner: c.next_action_owner, next_update_due: c.next_update_due, updated_at: c.updated_at, target_date: c.target_date, plan_status: deadlinePlan(c).status });
});

/** Investor overview data: plan financial model and (clearly separated) live demo-platform metrics. */
pub.get('/investor/model', (req, res) => res.json(financialModel({ multiplier: Number(req.query.mult || 1), fixedOverhead: req.query.fixed ? Number(req.query.fixed) : undefined })));
pub.get('/investor/platform', (_req, res) => {
  const n = (sql, ...p) => get(sql, ...p).n;
  res.json({
    label: 'Live metrics from the seeded demonstration database — illustrative, not commercial traction.',
    counts: { services: n('SELECT COUNT(*) AS n FROM services'), routes: n('SELECT COUNT(*) AS n FROM routes'), providers: n('SELECT COUNT(*) AS n FROM providers'), cases: n('SELECT COUNT(*) AS n FROM cases'), organisations: n('SELECT COUNT(*) AS n FROM orgs'), documents: n('SELECT COUNT(*) AS n FROM documents'), custody_events: n('SELECT COUNT(*) AS n FROM custody_events'), messages: n('SELECT COUNT(*) AS n FROM messages'), whatsapp_messages: n('SELECT COUNT(*) AS n FROM conv_messages'), audit_entries: n('SELECT COUNT(*) AS n FROM audit_log') },
    status_breakdown: all('SELECT status, COUNT(*) AS n FROM cases GROUP BY status ORDER BY n DESC').map((r) => ({ ...r, label: STATUS[r.status]?.label })),
    finance: liveFinance(), stale_routes: staleRoutes(),
  });
});

// Demo webhook receiver so the seeded employer endpoint shows real delivered/failed states.
pub.post('/webhook-echo', (req, res) => {
  if (!config.demoMode) throw notFound();
  res.json({ received: true, signature_present: !!req.headers['x-emirattest-signature'] });
});
