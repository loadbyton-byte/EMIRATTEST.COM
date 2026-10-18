import { Router } from 'express';
import { all, get, insert, update, json } from '../db.js';
import { sha256, validate, bad, notFound, HttpError, nowIso } from '../lib/util.js';
import { rateLimit } from '../lib/auth.js';
import { createCase, caseSummary, STATUS } from '../domain/cases.js';
import { audit } from '../lib/audit.js';

/** Enterprise API: scoped API keys, idempotent writes, org-isolated reads. */
export const v1 = Router();

v1.use((req, _res, next) => {
  const raw = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const k = raw.startsWith('emt_live_') ? get('SELECT * FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL', sha256(Buffer.from(raw))) : null;
  if (!k) return next(new HttpError(401, 'Invalid or revoked API key'));
  req.apiKey = { ...k, scopes: json(k.scopes, []) };
  update('api_keys', k.id, { last_used_at: nowIso() });
  next();
});
v1.use(rateLimit({ windowMs: 60000, max: 120, key: (req) => req.apiKey.id, name: 'v1' }));
const need = (scope) => (req, _res, next) => (req.apiKey.scopes.includes(scope) ? next() : next(new HttpError(403, `API key lacks scope ${scope}`)));
const brief = (c) => ({ ref: c.ref, status: c.status, status_label: STATUS[c.status].label, title: c.title, client_ref: c.client_ref, target_date: c.target_date, next_action: c.next_action, next_action_owner: c.next_action_owner, next_update_due: c.next_update_due, created_at: c.created_at, updated_at: c.updated_at });

v1.get('/cases', need('cases:read'), (req, res) => res.json({ data: all('SELECT * FROM cases WHERE org_id = ? ORDER BY id DESC LIMIT 200', req.apiKey.org_id).map(brief) }));
v1.get('/cases/:ref', need('cases:read'), (req, res) => {
  const c = get('SELECT * FROM cases WHERE ref = ? AND org_id = ?', req.params.ref, req.apiKey.org_id);
  if (!c) throw notFound('Case not found');
  res.json({ data: { ...brief(c), events: all("SELECT ts, type, to_status FROM case_events WHERE case_id = ? AND visibility = 'customer' ORDER BY id", c.id) } });
});
v1.post('/cases', need('cases:create'), (req, res) => {
  const idem = req.headers['idempotency-key'];
  if (!idem) throw bad('Idempotency-Key header is required for writes');
  const scope = `key:${req.apiKey.id}`;
  const prev = get('SELECT response FROM idempotency_keys WHERE key = ? AND scope = ?', idem, scope);
  if (prev) return res.status(200).set('Idempotent-Replay', 'true').json(JSON.parse(prev.response));
  const b = validate(req.body, { service: 'string!', full_name: 'string!', doc_count: 'number', destination_country: 'string', client_ref: 'string', client_alias: 'string', target_date: 'string', authority_confirmed: 'boolean!' });
  if (!b.authority_confirmed) throw bad('authority_confirmed must be true — the submitting party records authority to act for the applicant');
  const owner = get("SELECT user_id FROM org_members WHERE org_id = ? AND role = 'owner' LIMIT 1", req.apiKey.org_id);
  const user = get('SELECT * FROM users WHERE id = ?', owner.user_id);
  const pid = insert('profiles', { owner_user_id: user.id, org_id: req.apiKey.org_id, relation: 'client', full_name: b.full_name, consent_status: 'authority_recorded' });
  const c = createCase(user, { serviceSlug: b.service, orgId: req.apiKey.org_id, profileId: pid, docCount: b.doc_count || 1, destinationCountry: b.destination_country, clientRef: b.client_ref, clientAlias: b.client_alias, targetDate: b.target_date, channel: 'api' });
  const body = { data: brief(get('SELECT * FROM cases WHERE id = ?', c.id)), note: 'Case created. Documents, readiness review and price approval still apply.' };
  insert('idempotency_keys', { key: idem, scope, response: JSON.stringify(body) });
  audit(null, 'api.case_create', 'case', c.id, { key: req.apiKey.id });
  res.status(201).json(body);
});
export const _v1 = { caseSummary };
