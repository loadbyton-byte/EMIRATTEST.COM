import { Router } from 'express';
import { get, all, insert, update, run } from '../db.js';
import { config } from '../config.js';
import { hashPassword, verifyPassword, passwordProblem, createSession, setSessionCookie, clearSessionCookie, requireAuth, publicUser, revokeSession, revokeAllSessions, rateLimit, loginThrottled, noteLoginFail, clearLoginFails, totpSecret, totpVerify, STAFF_ROLES } from '../lib/auth.js';
import { validate, bad, emailOk, normPhone, HttpError, notFound } from '../lib/util.js';
import { audit } from '../lib/audit.js';
import { userOrgs } from '../domain/access.js';

export const auth = Router();
const loginLimit = rateLimit({ windowMs: 60000, max: 20, name: 'login' });

auth.post('/register', loginLimit, (req, res) => {
  const b = validate(req.body, { name: 'string!', email: 'string!', password: 'string!', phone: 'string', lang: ['en', 'ar'] });
  if (!emailOk(b.email)) throw bad('Enter a valid email address');
  const pp = passwordProblem(b.password); if (pp) throw bad(pp);
  const email = b.email.toLowerCase();
  if (get('SELECT 1 AS x FROM users WHERE email = ?', email)) throw new HttpError(409, 'An account with this email already exists');
  const id = insert('users', { email, name: b.name, phone: normPhone(b.phone), password_hash: hashPassword(b.password), role: 'customer', lang: b.lang || 'en' });
  const me = get('SELECT * FROM users WHERE id = ?', id);
  insert('profiles', { owner_user_id: id, relation: 'self', full_name: b.name, email, phone: normPhone(b.phone), consent_status: 'self' });
  for (const k of ['storage']) insert('consents', { user_id: id, kind: k, granted: 1 });
  for (const k of ['renewal_reminders', 'partner_referrals', 'marketing']) insert('consents', { user_id: id, kind: k, granted: 0 });
  audit(me, 'user.register', 'user', id, {});
  const token = createSession(id, req.headers['user-agent']);
  setSessionCookie(res, token);
  res.status(201).json({ user: publicUser(me), token });
});

auth.post('/login', loginLimit, (req, res) => {
  const b = validate(req.body, { email: 'string!', password: 'string!', otp: 'string' });
  const email = b.email.toLowerCase();
  if (loginThrottled(email)) throw new HttpError(429, 'Too many failed attempts. Try again in 15 minutes.');
  const u = get("SELECT * FROM users WHERE email = ? AND status = 'active'", email);
  if (!u || !verifyPassword(b.password, u.password_hash)) { noteLoginFail(email); throw new HttpError(401, 'Incorrect email or password'); }
  const staff = STAFF_ROLES.includes(u.role);
  if (u.mfa_enabled) {
    if (!b.otp) return res.status(202).json({ mfa_required: true });
    if (!totpVerify(u.mfa_secret, b.otp)) { noteLoginFail(email); throw new HttpError(401, 'Invalid authentication code'); }
  } else if (staff && config.requireStaffMfa) throw new HttpError(403, 'Staff accounts must enrol in MFA. Ask an administrator.', { mfa_enrol_required: true });
  clearLoginFails(email);
  const token = createSession(u.id, req.headers['user-agent']);
  setSessionCookie(res, token);
  audit(u, 'user.login', 'user', u.id, {});
  res.json({ user: publicUser(u), token });
});

auth.post('/logout', (req, res) => { if (req.sessionId) revokeSession(req.sessionId); clearSessionCookie(res); res.json({ ok: true }); });

auth.get('/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  res.json({ user: publicUser(req.user), orgs: userOrgs(req.user.id), provider: get('SELECT p.id, p.name, p.kind FROM providers p JOIN provider_users pu ON pu.provider_id = p.id WHERE pu.user_id = ?', req.user.id) || null, unread: get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', req.user.id).n });
});

auth.patch('/me', requireAuth, (req, res) => {
  const b = validate(req.body, { name: 'string', phone: 'string', lang: ['en', 'ar'] });
  const patch = {}; if (b.name) patch.name = b.name; if (b.phone) patch.phone = normPhone(b.phone); if (b.lang) patch.lang = b.lang;
  update('users', req.user.id, patch);
  res.json({ user: publicUser(get('SELECT * FROM users WHERE id = ?', req.user.id)) });
});

auth.post('/password', requireAuth, (req, res) => {
  const b = validate(req.body, { current: 'string!', next: 'string!' });
  if (!verifyPassword(b.current, req.user.password_hash)) throw new HttpError(401, 'Current password is incorrect');
  const pp = passwordProblem(b.next); if (pp) throw bad(pp);
  update('users', req.user.id, { password_hash: hashPassword(b.next) });
  revokeAllSessions(req.user.id);
  const token = createSession(req.user.id, req.headers['user-agent']); setSessionCookie(res, token);
  audit(req.user, 'user.password', 'user', req.user.id, {});
  res.json({ ok: true, token });
});

auth.post('/mfa/setup', requireAuth, (req, res) => {
  const secret = totpSecret();
  update('users', req.user.id, { mfa_secret: secret, mfa_enabled: 0 });
  res.json({ secret, otpauth: `otpauth://totp/Emirattest:${encodeURIComponent(req.user.email)}?secret=${secret}&issuer=Emirattest` });
});
auth.post('/mfa/enable', requireAuth, (req, res) => {
  const { code } = validate(req.body, { code: 'string!' });
  const u = get('SELECT * FROM users WHERE id = ?', req.user.id);
  if (!u.mfa_secret || !totpVerify(u.mfa_secret, code)) throw bad('Invalid code');
  update('users', u.id, { mfa_enabled: 1 });
  audit(u, 'user.mfa_enable', 'user', u.id, {});
  res.json({ ok: true });
});
auth.post('/mfa/disable', requireAuth, (req, res) => {
  const { code } = validate(req.body, { code: 'string!' });
  const u = get('SELECT * FROM users WHERE id = ?', req.user.id);
  if (!u.mfa_enabled || !totpVerify(u.mfa_secret, code)) throw bad('Invalid code');
  update('users', u.id, { mfa_enabled: 0, mfa_secret: null });
  res.json({ ok: true });
});

auth.get('/sessions', requireAuth, (req, res) => res.json({ sessions: all('SELECT id, created_at, expires_at, device, revoked_at FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20', req.user.id).map((s) => ({ ...s, id: s.id.slice(0, 8), full: s.id, current: s.id === req.sessionId })) }));
auth.post('/sessions/revoke-all', requireAuth, (req, res) => { revokeAllSessions(req.user.id); audit(req.user, 'user.sessions_revoked', 'user', req.user.id, {}); clearSessionCookie(res); res.json({ ok: true }); });

/** Sample-account launcher. Disabled when DEMO_MODE=0. */
auth.get('/demo-personas', (_req, res) => {
  if (!config.demoMode) throw notFound();
  res.json({ password: 'Demo@12345', personas: all("SELECT email, name, role, demo_label FROM users WHERE demo_label IS NOT NULL ORDER BY id") });
});
export const _q = { run };
