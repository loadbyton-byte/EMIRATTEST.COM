import crypto from 'node:crypto';
import { config } from '../config.js';

export const nowIso = () => config.now().toISOString().replace('T', ' ').slice(0, 19);
export const todayStr = () => config.now().toISOString().slice(0, 10);
export const addDays = (date, days) => {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
export const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
export const money = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const randomToken = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
export const hmac = (data, secret = config.sessionSecret) => crypto.createHmac('sha256', secret).update(data).digest('base64url');
export const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}
export const bad = (msg, extra) => new HttpError(400, msg, extra);
export const forbidden = (msg = 'You do not have access to this resource') => new HttpError(403, msg);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);
export const conflict = (msg, extra) => new HttpError(409, msg, extra);

/** Tiny validator: spec = { field: 'string!' | 'number' | 'boolean' | 'array' | 'object' | ['a','b'] (enum) } ('!' = required). */
export function validate(body, spec) {
  const out = {};
  const b = body && typeof body === 'object' ? body : {};
  for (const [key, rule] of Object.entries(spec)) {
    const required = typeof rule === 'string' ? rule.endsWith('!') : false;
    const type = typeof rule === 'string' ? rule.replace('!', '') : 'enum';
    let v = b[key];
    if (v === undefined || v === null || v === '') {
      if (required) throw bad(`${key} is required`);
      continue;
    }
    if (type === 'string') v = String(v).trim().slice(0, 4000);
    else if (type === 'number') { v = Number(v); if (!Number.isFinite(v)) throw bad(`${key} must be a number`); }
    else if (type === 'boolean') v = v === true || v === 'true' || v === 1 || v === '1';
    else if (type === 'array') { if (!Array.isArray(v)) throw bad(`${key} must be an array`); }
    else if (type === 'object') { if (typeof v !== 'object') throw bad(`${key} must be an object`); }
    else if (type === 'enum') { if (!rule.includes(v)) throw bad(`${key} must be one of ${rule.join(', ')}`); }
    out[key] = v;
  }
  return out;
}

export const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || '');
export const normPhone = (p) => {
  if (!p) return null;
  let s = String(p).replace(/[^\d+]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (!s.startsWith('+')) s = s.startsWith('0') ? '+971' + s.slice(1) : '+' + s;
  return s;
};
export const waIdOf = (p) => (normPhone(p) || '').replace('+', '');

export const csvEscape = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (rows, cols) => {
  const keys = cols || (rows[0] ? Object.keys(rows[0]) : []);
  return [keys.join(','), ...rows.map((r) => keys.map((k) => csvEscape(r[k])).join(','))].join('\n');
};
export function parseCsv(text) {
  const rows = []; let row = []; let cur = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some((x) => x !== '')) rows.push(row); row = []; }
    else cur += c;
  }
  row.push(cur); if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}
