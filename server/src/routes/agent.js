import express, { Router } from 'express';
import { all, get, insert, update, json } from '../db.js';
import { requireRole } from '../lib/auth.js';
import { validate, bad, forbidden, notFound, todayStr, nowIso } from '../lib/util.js';
import { recordCustody, openIncident } from '../domain/operations.js';
import { storeDocument, MAX_UPLOAD } from '../domain/documents.js';
import { STATUS } from '../domain/cases.js';

export const agent = Router();
agent.use(requireRole('agent'));
const rawUpload = express.raw({ type: () => true, limit: MAX_UPLOAD + 1024 });

/** Agents see assigned tasks only. Customer contact details appear only on the day of a permitted task. */
function taskView(t) {
  const c = get('SELECT c.*, u.name AS customer_name, u.phone AS customer_phone, p.full_name AS holder FROM cases c JOIN users u ON u.id = c.customer_id LEFT JOIN profiles p ON p.id = c.profile_id WHERE c.id = ?', t.case_id);
  const day = (t.scheduled_at || t.due_at || '').slice(0, 10);
  const permitted = !!t.contact_permission && day === todayStr();
  return { ...t, case_ref: c.ref, case_title: c.title, case_status: STATUS[c.status].label, doc_count: c.doc_count, expedited: !!c.expedited, contact: permitted ? { name: c.client_alias || c.customer_name, phone: c.customer_phone } : null, contact_note: permitted ? 'Visible for today’s permitted task only.' : 'Contact details are hidden until the day of the task.' };
}
agent.get('/tasks', (req, res) => {
  const rows = all("SELECT * FROM case_tasks WHERE owner_user_id = ? AND status IN ('open','blocked','waiting') ORDER BY COALESCE(scheduled_at, due_at)", req.user.id);
  const done = all("SELECT * FROM case_tasks WHERE owner_user_id = ? AND status = 'done' ORDER BY completed_at DESC LIMIT 10", req.user.id);
  const profile = get('SELECT * FROM agent_profiles WHERE user_id = ?', req.user.id);
  res.json({ tasks: rows.map(taskView), recent: done.map(taskView), profile: profile && { ...profile, emirates: json(profile.emirates, []) } });
});
agent.get('/tasks/:id', (req, res) => {
  const t = get('SELECT * FROM case_tasks WHERE id = ? AND owner_user_id = ?', Number(req.params.id), req.user.id);
  if (!t) throw notFound('Task not found');
  res.json({ task: taskView(t), custody: all('SELECT * FROM custody_events WHERE case_id = ? ORDER BY captured_at', t.case_id) });
});

/** Accepts one event or a batch (offline sync). Duplicate client_event_id values are ignored (idempotent). Captured and synced times stay separate. */
agent.post('/events', (req, res) => {
  const list = Array.isArray(req.body?.events) ? req.body.events : [req.body];
  if (list.length > 100) throw bad('Too many events in one sync');
  const results = list.map((e) => {
    try {
      const t = e.task_id ? get('SELECT * FROM case_tasks WHERE id = ? AND owner_user_id = ?', Number(e.task_id), req.user.id) : null;
      if (!t) throw forbidden('Task is not assigned to you');
      const c = get('SELECT * FROM cases WHERE id = ?', t.case_id);
      const out = recordCustody(c, req.user, { ...e, task_id: t.id });
      return { client_event_id: e.client_event_id, ok: true, duplicate: !!out.duplicate, id: out.event?.id };
    } catch (err) { return { client_event_id: e.client_event_id, ok: false, error: err.message }; }
  });
  res.status(results.every((r) => r.ok) ? 201 : 207).json({ results, synced_at: nowIso() });
});
agent.post('/events/:id/photo', rawUpload, (req, res) => {
  const ev = get('SELECT * FROM custody_events WHERE id = ? AND agent_user_id = ?', Number(req.params.id), req.user.id);
  if (!ev) throw notFound();
  const d = storeDocument({ user: req.user, caseId: ev.case_id, kind: 'custody_photo', filename: String(req.query.filename || 'custody-photo.jpg'), buffer: req.body, role: 'supporting' });
  update('custody_events', ev.id, { photo_key: String(d.id) });
  res.status(201).json({ ok: true, note: 'A delivery photograph supports, but never replaces, the authorised recipient check.' });
});
agent.post('/incidents', (req, res) => {
  const b = validate(req.body, { task_id: 'number', type: ['lost_original', 'damage', 'unauthorised_handover', 'fraud', 'data_exposure', 'other'], severity: ['low', 'medium', 'high', 'critical'], detail: 'string!' });
  const t = b.task_id ? get('SELECT * FROM case_tasks WHERE id = ? AND owner_user_id = ?', b.task_id, req.user.id) : null;
  const c = t ? get('SELECT * FROM cases WHERE id = ?', t.case_id) : null;
  res.status(201).json({ incident: openIncident(c, req.user, { type: b.type || 'other', severity: b.severity || 'high', detail: b.detail }), note: 'Containment started. A named incident owner has been assigned.' });
});
export const _ag = { insert };
