import crypto from 'node:crypto';
import { config } from '../config.js';
import { get, run, insert, update, all } from '../db.js';
import { hmac, safeEqual, randomToken, nowIso, HttpError, forbidden } from './util.js';

export const STAFF_ROLES = ['support', 'ops', 'finance', 'admin'];
export const isStaff = (u) => !!u && STAFF_ROLES.includes(u.role);

// ---------- Passwords (scrypt) ----------
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}
export function verifyPassword(pw, stored) {
  const [alg, s, k] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const key = crypto.scryptSync(pw, Buffer.from(s, 'base64'), 64, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(key, Buffer.from(k, 'base64'));
}
export const passwordProblem = (pw) =>
  !pw || pw.length < 10 ? 'Password must be at least 10 characters' : !/[A-Za-z]/.test(pw) || !/\d/.test(pw) ? 'Password must contain letters and numbers' : null;

// ---------- Signed session tokens (revocable via sessions table) ----------
export function createSession(userId, device = '') {
  const id = randomToken(18);
  const expires = new Date(config.now().getTime() + 14 * 86400000).toISOString().replace('T', ' ').slice(0, 19);
  run('INSERT INTO sessions(id,user_id,expires_at,device) VALUES(?,?,?,?)', id, userId, expires, String(device).slice(0, 200));
  const payload = Buffer.from(JSON.stringify({ sid: id, uid: userId })).toString('base64url');
  return `${payload}.${hmac(payload)}`;
}
export function readToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  if (!safeEqual(sig, hmac(payload))) return null;
  try {
    const { sid, uid } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const s = get('SELECT * FROM sessions WHERE id = ? AND user_id = ?', sid, uid);
    if (!s || s.revoked_at || s.expires_at < nowIso()) return null;
    return { sid, uid };
  } catch { return null; }
}
export const revokeSession = (sid) => run("UPDATE sessions SET revoked_at = datetime('now') WHERE id = ?", sid);
export const revokeAllSessions = (uid) => run("UPDATE sessions SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL", uid);

export const publicUser = (u) =>
  u && { id: u.id, email: u.email, phone: u.phone, name: u.name, role: u.role, lang: u.lang, mfa_enabled: !!u.mfa_enabled, demo_label: u.demo_label };

function parseCookies(h = '') {
  return Object.fromEntries(h.split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}

/** Attach req.user from cookie or Bearer token. Does not reject. */
export function authenticate(req, _res, next) {
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const cookieTok = parseCookies(req.headers.cookie).emt_session;
  const tok = bearer || cookieTok;
  const sess = readToken(tok);
  if (sess) {
    const u = get('SELECT * FROM users WHERE id = ? AND status = ?', sess.uid, 'active');
    if (u) { req.user = u; req.sessionId = sess.sid; req.viaCookie = !bearer; }
  }
  // CSRF guard for cookie-authenticated mutations: browsers can't set this header cross-site without CORS preflight.
  if (req.user && req.viaCookie && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-requested-with'] !== 'emirattest') {
    if (!req.path.startsWith('/api/payments/webhook')) return next(new HttpError(403, 'Missing CSRF header'));
  }
  next();
}
export const requireAuth = (req, _res, next) => (req.user ? next() : next(new HttpError(401, 'Sign in required')));
export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'Sign in required'));
  if (!roles.includes(req.user.role)) return next(forbidden('Your role cannot perform this action'));
  next();
};
export const requireStaff = (req, res, next) => requireRole(...STAFF_ROLES)(req, res, next);

export function setSessionCookie(res, token) {
  const secure = config.nodeEnv === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `emt_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${14 * 86400}${secure}`);
}
export const clearSessionCookie = (res) => res.setHeader('Set-Cookie', 'emt_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');

// ---------- TOTP (RFC 6238) ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function totpSecret() {
  const buf = crypto.randomBytes(20); let bits = ''; let out = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}
const b32decode = (s) => {
  let bits = ''; for (const c of s.replace(/=+$/, '')) bits += B32.indexOf(c).toString(2).padStart(5, '0');
  const bytes = []; for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
};
export function totpCode(secret, atMs = Date.now(), step = 30) {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 1000 / step)));
  const h = crypto.createHmac('sha1', b32decode(secret)).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  const code = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(code % 1e6).padStart(6, '0');
}
export const totpVerify = (secret, code, atMs = Date.now()) =>
  [-1, 0, 1].some((w) => safeEqual(totpCode(secret, atMs + w * 30000), String(code).trim()));

// ---------- Rate limiting (in-memory sliding window) ----------
const buckets = new Map();
export function rateLimit({ windowMs, max, key = (req) => req.ip, name = 'rl' }) {
  return (req, res, next) => {
    if (process.env.EMT_DISABLE_RATE_LIMIT === '1') return next();
    const k = `${name}:${key(req)}`; const t = Date.now();
    const arr = (buckets.get(k) || []).filter((x) => t - x < windowMs);
    if (arr.length >= max) {
      res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
      return next(new HttpError(429, 'Too many requests. Please wait and try again.'));
    }
    arr.push(t); buckets.set(k, arr); next();
  };
}
export const resetRateLimits = () => buckets.clear();

// ---------- Login throttling per email ----------
const fails = new Map();
export const loginThrottled = (email) => (fails.get(email) || []).filter((t) => Date.now() - t < 15 * 60000).length >= 8;
export const noteLoginFail = (email) => fails.set(email, [...(fails.get(email) || []).filter((t) => Date.now() - t < 15 * 60000), Date.now()]);
export const clearLoginFails = (email) => fails.delete(email);
export const _unused = { insert, update, all };
