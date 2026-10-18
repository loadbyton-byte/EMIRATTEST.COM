import { bookingOut, requestCancellation } from '../domain/bookings.js';
import { assertOperational } from '../domain/readiness.js';
import { Router } from 'express';
import { all, get, insert, update, run, json, tx } from '../db.js';
import { requireAuth, isStaff, revokeAllSessions } from '../lib/auth.js';
import { validate, bad, forbidden, notFound, conflict, nowIso, todayStr, addDays, normPhone, money, randomToken } from '../lib/util.js';
import { audit } from '../lib/audit.js';
import { profileAccess, activeGrants, userOrgs } from '../domain/access.js';
import { getService } from '../domain/catalog.js';
import { providerOut } from '../domain/providers.js';
import { createBookingPayment } from '../domain/payments.js';
import { notify } from '../domain/notify.js';
import { caseDetail } from './cases.js';
import { config } from '../config.js';
import { pushEnabled } from '../lib/push.js';
import { caseAccess } from '../domain/access.js';
import { listServices } from '../domain/catalog.js';
import { hmac } from '../lib/util.js';

export const account = Router();
account.use(requireAuth);

// ---------- notifications ----------
account.get('/notifications', (req, res) => res.json({ notifications: all('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 60', req.user.id) }));
account.post('/notifications/read', (req, res) => { run("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL", req.user.id); res.json({ ok: true }); });

// ---------- family workspace ----------
account.get('/profiles', (req, res) => {
  const own = all('SELECT * FROM profiles WHERE owner_user_id = ? AND org_id IS NULL ORDER BY id', req.user.id);
  const sharedIds = activeGrants(req.user.id).map((g) => g.profile_id);
  const shared = sharedIds.length ? all(`SELECT * FROM profiles WHERE id IN (${sharedIds.map(() => '?').join(',')})`, ...sharedIds) : [];
  const withStats = (p) => ({ ...p, passport_no: p.passport_no ? `••••${p.passport_no.slice(-3)}` : null, cases: get("SELECT COUNT(*) AS n FROM cases WHERE profile_id = ? AND status NOT IN ('delivered','refunded','cancelled')", p.id).n, documents: get('SELECT COUNT(*) AS n FROM documents WHERE profile_id = ? AND deleted_at IS NULL', p.id).n, grants: all('SELECT g.*, u.name AS grantee_name FROM profile_grants g JOIN users u ON u.id = g.grantee_user_id WHERE g.profile_id = ? AND g.revoked_at IS NULL', p.id) });
  res.json({ profiles: own.map(withStats), shared_with_me: shared.map((p) => ({ id: p.id, full_name: p.full_name, relation: p.relation, owner_user_id: p.owner_user_id })) });
});
account.post('/profiles', (req, res) => {
  const b = validate(req.body, { relation: ['spouse', 'child', 'parent', 'other'], full_name: 'string!', dob: 'string', nationality: 'string', passport_no: 'string', emirates_id: 'string', is_minor: 'boolean', guardian_note: 'string' });
  const id = insert('profiles', { ...b, relation: b.relation || 'other', owner_user_id: req.user.id, consent_status: 'self' });
  audit(req.user, 'profile.create', 'profile', id, {});
  res.status(201).json({ profile: get('SELECT * FROM profiles WHERE id = ?', id) });
});
account.patch('/profiles/:id', (req, res) => {
  const p = get('SELECT * FROM profiles WHERE id = ?', Number(req.params.id));
  if (!p || !profileAccess(req.user, p)?.manage) throw notFound();
  const b = validate(req.body, { full_name: 'string', dob: 'string', nationality: 'string', passport_no: 'string', emirates_id: 'string', guardian_note: 'string' });
  update('profiles', p.id, b); res.json({ profile: get('SELECT * FROM profiles WHERE id = ?', p.id) });
});
account.post('/profiles/:id/grants', (req, res) => {
  const p = get('SELECT * FROM profiles WHERE id = ?', Number(req.params.id));
  if (!p || p.owner_user_id !== req.user.id) throw notFound();
  if (p.is_minor && !p.guardian_note) throw bad('Record guardian authority for this minor before sharing');
  if (!p.is_minor && p.relation !== 'self' && !isStaff(req.user)) { /* owner of a dependant record controls it */ }
  const b = validate(req.body, { granteeEmail: 'string!', scope_type: ['profile', 'document', 'case', 'task'], scope_id: 'number', purpose: 'string!', days: 'number' });
  const grantee = get('SELECT * FROM users WHERE email = ?', b.granteeEmail.toLowerCase());
  if (!grantee) throw notFound('No Emirattest account with that email — ask them to register first');
  if (grantee.id === req.user.id) throw bad('You already own this record');
  const id = insert('profile_grants', { profile_id: p.id, grantee_user_id: grantee.id, scope_type: b.scope_type || 'profile', scope_id: b.scope_id, purpose: b.purpose, expires_at: b.days ? `${addDays(todayStr(), b.days)} 23:59:59` : null, granted_by: req.user.id });
  audit(req.user, 'grant.create', 'profile', p.id, { grantee: grantee.id, purpose: b.purpose });
  notify(grantee.id, { title: `${req.user.name} shared ${p.full_name}'s records with you`, body: `Purpose: ${b.purpose}`, link: '/app/family', kind: 'share' });
  res.status(201).json({ grant: get('SELECT * FROM profile_grants WHERE id = ?', id) });
});
account.delete('/grants/:id', (req, res) => {
  const g = get('SELECT g.*, p.owner_user_id FROM profile_grants g JOIN profiles p ON p.id = g.profile_id WHERE g.id = ?', Number(req.params.id));
  if (!g || (g.owner_user_id !== req.user.id && g.grantee_user_id !== req.user.id)) throw notFound();
  update('profile_grants', g.id, { revoked_at: nowIso() }); audit(req.user, 'grant.revoke', 'profile', g.profile_id, {}); res.json({ ok: true });
});

// ---------- consents, reminders, rights ----------
account.get('/consents', (req, res) => res.json({ consents: all('SELECT kind, granted, updated_at FROM consents WHERE user_id = ?', req.user.id).map((c) => ({ ...c, granted: !!c.granted })) }));
account.put('/consents/:kind', (req, res) => {
  if (!['storage', 'renewal_reminders', 'partner_referrals', 'marketing'].includes(req.params.kind)) throw bad('Unknown consent');
  const g = req.body?.granted ? 1 : 0;
  run('INSERT INTO consents(user_id,kind,granted,updated_at) VALUES(?,?,?,datetime(\'now\')) ON CONFLICT(user_id,kind) DO UPDATE SET granted=excluded.granted, updated_at=excluded.updated_at', req.user.id, req.params.kind, g);
  audit(req.user, 'consent.set', 'user', req.user.id, { kind: req.params.kind, granted: !!g });
  res.json({ ok: true });
});
account.get('/reminders', (req, res) => res.json({ reminders: all("SELECT r.*, p.full_name FROM reminders r LEFT JOIN profiles p ON p.id = r.profile_id WHERE r.user_id = ? AND r.status != 'dismissed' ORDER BY due_date", req.user.id) }));
account.post('/reminders', (req, res) => {
  const b = validate(req.body, { title: 'string!', due_date: 'string!', profile_id: 'number', document_id: 'number', kind: ['expiry', 'renewal', 'review'] });
  const consent = get("SELECT granted FROM consents WHERE user_id = ? AND kind = 'renewal_reminders'", req.user.id);
  if (!consent?.granted) throw conflict('Turn on renewal reminders in Privacy settings first (reminders are voluntary).');
  const id = insert('reminders', { ...b, kind: b.kind || 'expiry', user_id: req.user.id });
  res.status(201).json({ reminder: get('SELECT * FROM reminders WHERE id = ?', id) });
});
account.delete('/reminders/:id', (req, res) => { run("UPDATE reminders SET status = 'dismissed' WHERE id = ? AND user_id = ?", Number(req.params.id), req.user.id); res.json({ ok: true }); });

/** Document readiness records: reusable, purpose-specific, never a universal acceptance certificate. */
account.get('/readiness-records', (req, res) => {
  const pids = all('SELECT id FROM profiles WHERE owner_user_id = ?', req.user.id).map((p) => p.id);
  if (!pids.length) return res.json({ records: [] });
  const today = todayStr();
  const docs = all(`SELECT d.*, p.full_name FROM documents d LEFT JOIN profiles p ON p.id = d.profile_id WHERE d.profile_id IN (${pids.map(() => '?').join(',')}) AND d.deleted_at IS NULL AND d.role = 'original' ORDER BY d.created_at DESC`, ...pids);
  res.json({ disclaimer: 'A readiness record is purpose-specific. It is not a government identity, a new official credential or a universal acceptance certificate. Acceptance periods are set by the receiving institution.', records: docs.map((d) => ({ id: d.id, holder: d.full_name, kind: d.kind, filename: d.filename, purpose: d.purpose, issuing_authority: d.issuing_authority, issuing_country: d.issuing_country, doc_number: d.doc_number, issue_date: d.issue_date, expiry_date: d.expiry_date, expired: !!(d.expiry_date && d.expiry_date < today), verification: d.verification_method ? { method: d.verification_method, result: d.verification_result, source: d.verification_source } : null, confirmed: !!d.confirmed, case_id: d.case_id, issues: json(d.issues, []) })) });
});

// ---------- web push ----------
account.get('/push/key', (_req, res) => res.json({ enabled: pushEnabled(), publicKey: pushEnabled() ? config.push.publicKey : null }));
account.post('/push/subscribe', (req, res) => {
  if (!pushEnabled()) throw conflict('Push notifications are not enabled on this server');
  const b = req.body || {};
  if (typeof b.endpoint !== 'string' || !/^https:\/\//.test(b.endpoint) || !b.keys?.p256dh || !b.keys?.auth) throw bad('Invalid push subscription');
  run('DELETE FROM push_subscriptions WHERE endpoint = ?', b.endpoint);
  insert('push_subscriptions', { user_id: req.user.id, endpoint: b.endpoint, p256dh: String(b.keys.p256dh), auth: String(b.keys.auth), user_agent: String(req.headers['user-agent'] || '').slice(0, 200) });
  res.status(201).json({ ok: true });
});
account.post('/push/unsubscribe', (req, res) => { run('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?', req.user.id, String(req.body?.endpoint || '')); res.json({ ok: true }); });

// ---------- search (only records the caller may open) ----------
account.get('/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ cases: [], documents: [], services: [] });
  const like = `%${q.replace(/[%_]/g, '')}%`;
  const caseRows = all('SELECT * FROM cases WHERE ref LIKE ? OR title LIKE ? OR client_ref LIKE ? OR client_alias LIKE ? ORDER BY updated_at DESC LIMIT 60', like, like, like, like)
    .filter((c) => caseAccess(req.user, c)).slice(0, 15).map((c) => ({ id: c.id, ref: c.ref, title: c.title, status: c.status }));
  const docRows = all('SELECT d.id, d.filename, d.kind, d.case_id, d.profile_id FROM documents d WHERE d.deleted_at IS NULL AND (d.filename LIKE ? OR d.doc_number LIKE ? OR d.holder_name LIKE ?) ORDER BY d.id DESC LIMIT 80', like, like, like)
    .filter((d) => (d.case_id ? caseAccess(req.user, get('SELECT * FROM cases WHERE id = ?', d.case_id)) : (() => { const pa = profileAccess(req.user, get('SELECT * FROM profiles WHERE id = ?', d.profile_id)); return pa && !pa.limited; })()))
    .slice(0, 15).map((d) => ({ id: d.id, filename: d.filename, kind: d.kind, case_id: d.case_id }));
  res.json({ cases: caseRows, documents: docRows, services: listServices({ q }).slice(0, 8).map((s) => ({ slug: s.slug, name_en: s.name_en, name_ar: s.name_ar })) });
});

// ---------- calendar feed (ICS) ----------
const feedToken = (uid) => `${uid}.${hmac(`ics:${uid}`)}`;
account.get('/calendar-link', (req, res) => res.json({ url: `${config.baseUrl}/api/public/calendar/${feedToken(req.user.id)}.ics`, note: 'Anyone with this link can see your appointment and reminder dates. Do not share it.' }));
account.get('/dsr', (req, res) => res.json({ requests: all('SELECT id, kind, status, note, result, created_at, resolved_at FROM dsr_requests WHERE user_id = ? ORDER BY id DESC', req.user.id) }));

account.post('/dsr', (req, res) => {
  const b = validate(req.body, { kind: ['access', 'export', 'correction', 'deletion'], note: 'string' });
  const id = insert('dsr_requests', { user_id: req.user.id, kind: b.kind || 'access', note: b.note });
  audit(req.user, 'dsr.create', 'user', req.user.id, { kind: b.kind });
  res.status(201).json({ id, message: 'Request recorded. Deletion is subject to lawful retention (for example financial and custody records); we will explain what is retained and why.' });
});
account.get('/export', (req, res) => {
  const u = req.user;
  const data = { exported_at: nowIso(), user: { id: u.id, name: u.name, email: u.email, phone: u.phone, lang: u.lang }, profiles: all('SELECT * FROM profiles WHERE owner_user_id = ?', u.id), consents: all('SELECT * FROM consents WHERE user_id = ?', u.id), cases: all('SELECT * FROM cases WHERE customer_id = ?', u.id), documents: all('SELECT id, case_id, kind, filename, size, sha256, created_at FROM documents WHERE owner_user_id = ? AND deleted_at IS NULL', u.id), payments: all('SELECT id, case_id, amount, status, receipt_no, created_at FROM payments WHERE user_id = ?', u.id), reminders: all('SELECT * FROM reminders WHERE user_id = ?', u.id), bookings: all('SELECT * FROM bookings WHERE user_id = ?', u.id).map(b=>bookingOut(b)) };
  audit(u, 'user.export', 'user', u.id, {});
  res.setHeader('Content-Disposition', 'attachment; filename="emirattest-data-export.json"');
  res.json(data);
});

// ---------- bookings (travel, insurance, resident setup) ----------
const BOOKING_KINDS = { flights: 'flight', 'tours-packages': 'tour', 'gcc-visit-visa': 'gcc_visa', 'umrah-hajj': 'umrah', 'insurance-partner': 'insurance', 'bank-assistance': 'bank', 'sim-utility': 'sim_utility' };
account.get('/suppliers', (req, res) => {
  const slug = String(req.query.service || '');
  const rows = all("SELECT * FROM providers WHERE status = 'active' AND license_verified = 1 AND kind IN ('travel_supplier','insurer','bank_partner','telecom')").map(providerOut).filter((p) => !slug || p.covers.includes(slug) || p.covers.includes('*'));
  res.json({ suppliers: rows.map((p) => ({ id: p.id, name: p.name, kind: p.kind, bio: p.bio, sponsored: p.sponsored, disclosure: p.disclosure, price: p.price_schedule[slug] || null })) });
});
account.get('/bookings', (req, res) => res.json({ bookings: all('SELECT b.*, p.name AS supplier_name FROM bookings b LEFT JOIN providers p ON p.id = b.supplier_id WHERE b.user_id = ? ORDER BY b.id DESC', req.user.id).map((b) => ({ ...bookingOut(b), checkout: null })) }));
account.post('/bookings', (req, res) => {
  const b = validate(req.body, { serviceSlug: 'string!', supplierId: 'number!', details: 'object', caseId: 'number', consentLinked: 'boolean' });
  const svc = getService(b.serviceSlug);
  if (!svc || !BOOKING_KINDS[svc.slug]) throw bad('Not a bookable service');
  const sup = get("SELECT * FROM providers WHERE id = ? AND status = 'active'", b.supplierId);
  if (!sup) throw notFound('Supplier not available');
  const sched = json(sup.price_schedule, {})[svc.slug];
  if (!sched) throw bad('This supplier has no published price for this service');
  if (b.caseId) { const c = get('SELECT id FROM cases WHERE id = ? AND customer_id = ?', b.caseId, req.user.id); if (!c) throw notFound('Case not found'); if (!b.consentLinked) throw bad('Linking a booking to a relocation case needs your consent'); }
  assertOperational(svc.slug,sup.id);
  if(!sup.license_verified||!['travel_supplier','insurer','bank_partner','telecom'].includes(sup.kind)||!(json(sup.covers,[]).includes(svc.slug)||json(sup.covers,[]).includes('*')))throw bad('Supplier is not authorised for this booking');
  if(!sched.terms||!sched.cancellation||!Number.isFinite(Number(sched.price))||Number(sched.price)<0)throw bad('Supplier price and terms need review');
  const supplier_amount = money(sched.price);
  const pct=Number(sched.commission_pct||0);if(!Number.isFinite(pct)||pct<0||pct>100)throw bad('Invalid supplier commission');
  const commission = money(supplier_amount * pct / 100);
  const vat=money(svc.base_fee_aed*config.vatRate);
  const ref = `BK-${String(get('SELECT COUNT(*) AS n FROM bookings').n + 1).padStart(5, '0')}`;
  const id = insert('bookings', { ref, case_id: b.caseId, user_id: req.user.id, kind: BOOKING_KINDS[svc.slug], service_slug: svc.slug, supplier_id: sup.id, details: b.details || {}, price_aed: supplier_amount, supplier_amount, commission_aed: commission, fee_aed: svc.base_fee_aed, vat_aed:vat, status: 'quoted', terms: sched.terms, cancellation_terms: sched.cancellation, consent_linked: b.consentLinked ? 1 : 0 });
  res.status(201).json({ booking: get('SELECT * FROM bookings WHERE id = ?', id), breakdown: { supplier_amount, emirattest_booking_fee: svc.base_fee_aed, vat, commission_note: commission ? 'Earned commission is paid by the supplier and included in the supplier price — shown here for transparency.' : null, total: money(supplier_amount + svc.base_fee_aed + vat) } });
});
account.post('/bookings/:id/confirm', (req, res) => {
  const bk = get('SELECT * FROM bookings WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
  if (!bk) throw notFound();
  if (bk.status !== 'quoted') throw conflict(`Booking is ${bk.status}`);
  const p = createBookingPayment(bk, req.user);
  res.json({ payment: { token: p.token, amount: p.amount }, checkout: { url: `/pay/${p.token}` } });
});
account.post('/bookings/:id/cancel', (req,res)=>{const b=get('SELECT * FROM bookings WHERE id=? AND user_id=?',Number(req.params.id),req.user.id);if(!b)throw notFound();const booking=requestCancellation(b,req.user,req.body?.reason);res.json({booking,note:booking.status==='cancelled'?'Unpaid quotation cancelled.':'Cancellation requested. Supplier cancellation and any refund are reviewed separately.'});});
export const _ac = { userOrgs, caseDetail, revokeAllSessions, normPhone, randomToken, tx };
