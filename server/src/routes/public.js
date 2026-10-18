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
import { validate, bad, notFound, normPhone, nowIso, todayStr, hmac, safeEqual } from '../lib/util.js';
import { rateLimit } from '../lib/auth.js';
import { notifyRole } from '../domain/notify.js';
import { integrationStatus } from '../lib/integrations.js';

export const pub = Router();

pub.get('/health', (_req, res) => res.json({ ok: true, time: nowIso(), demo: config.demoMode }));

pub.get('/config', (_req, res) => res.json({
  demo_mode: config.demoMode, vat_rate: config.vatRate, emirates: EMIRATES, courier_fees: COURIER_FEE, readiness_review_fee: READINESS_REVIEW_FEE, countries: COUNTRIES.map(([code, en, ar]) => ({ code, en, ar })),
  integrations: integrationStatus(whatsappStatus().mode),
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

// Echo receiver so the sample employer webhook endpoint shows real delivered/failed states (sample-data mode only).
pub.post('/webhook-echo', (req, res) => {
  if (!config.demoMode) throw notFound();
  res.json({ received: true, signature_present: !!req.headers['x-emirattest-signature'] });
});

// ---- personal calendar feed (ICS): appointments, saved reminders and case target dates ----
const icsText = (t) => String(t ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsDate = (d) => String(d).slice(0, 10).replace(/-/g, '');
pub.get('/calendar/:token.ics', (req, res) => {
  const [uid, sig] = String(req.params.token).split('.');
  if (!uid || !sig || !safeEqual(sig, hmac(`ics:${uid}`))) throw notFound();
  const user = get("SELECT id FROM users WHERE id = ? AND status = 'active'", Number(uid));
  if (!user) throw notFound();
  const ev = [];
  for (const a of all("SELECT * FROM appointments WHERE user_id = ? AND status = 'booked'", user.id)) {
    const start = new Date(String(a.at).replace(' ', 'T') + (a.at.includes('Z') ? '' : 'Z'));
    const fmt = (d) => d.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
    ev.push(['BEGIN:VEVENT', `UID:appt-${a.id}@emirattest`, `DTSTAMP:${fmt(new Date())}`, `DTSTART:${fmt(start)}`, `DTEND:${fmt(new Date(start.getTime() + 3600000))}`, `SUMMARY:${icsText(`Emirattest: ${a.kind.replace(/_/g, ' ')}`)}`, `LOCATION:${icsText(a.location || '')}`, 'END:VEVENT']);
  }
  for (const r of all("SELECT * FROM reminders WHERE user_id = ? AND status != 'dismissed'", user.id)) ev.push(['BEGIN:VEVENT', `UID:rem-${r.id}@emirattest`, `DTSTAMP:${icsDate(todayStr())}T000000Z`, `DTSTART;VALUE=DATE:${icsDate(r.due_date)}`, `SUMMARY:${icsText(r.title)}`, 'END:VEVENT']);
  for (const c of all("SELECT * FROM cases WHERE customer_id = ? AND target_date IS NOT NULL AND status NOT IN ('completed','dispatched','delivered','cancelled','refunded')", user.id)) ev.push(['BEGIN:VEVENT', `UID:case-${c.id}@emirattest`, `DTSTAMP:${icsDate(todayStr())}T000000Z`, `DTSTART;VALUE=DATE:${icsDate(c.target_date)}`, `SUMMARY:${icsText(`Target date — ${c.title} (${c.ref})`)}`, 'END:VEVENT']);
  const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Emirattest//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Emirattest', ...ev.flat(), 'END:VCALENDAR'].join('\r\n') + '\r\n';
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.send(body);
});
