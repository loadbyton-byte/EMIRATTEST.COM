import { Router } from 'express';
import { get, update, all, json } from '../db.js';
import { requireAuth, isStaff } from '../lib/auth.js';
import { validate, bad, forbidden, notFound, conflict, HttpError } from '../lib/util.js';
import { caseAccess, profileAccess } from '../domain/access.js';
import { signedUrl, checkSigned, readFileBytes, logAccess, docOut, readinessCheck, recordVerification } from '../domain/documents.js';
import { extractDocument } from '../domain/ai.js';
import { audit } from '../lib/audit.js';
import { authenticate } from '../lib/auth.js';

export const documents = Router();

function docAccess(user, d) {
  if (d.case_id) { const c = get('SELECT * FROM cases WHERE id = ?', d.case_id); const a = caseAccess(user, c); return a && a.docs ? { c, a } : null; }
  const p = d.profile_id ? get('SELECT * FROM profiles WHERE id = ?', d.profile_id) : null;
  if (d.owner_user_id === user.id) return { a: { kind: 'owner', docs: true } };
  if (p && profileAccess(user, p)?.kind === 'grant') return { a: { kind: 'grant', docs: true } };
  return null;
}
const loadDoc = (user, id) => {
  const d = get('SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL', Number(id));
  const acc = d && docAccess(user, d);
  if (!acc) throw notFound('Document not found');
  return { d, ...acc };
};

// File download via expiring signed link. Link is bound to a user id; session still has to match.
documents.get('/:id/file', (req, res) => {
  const d = get('SELECT * FROM documents WHERE id = ?', Number(req.params.id));
  if (!d || !checkSigned(d.id, req.query.u, req.query.e, req.query.s)) throw new HttpError(403, 'Link expired or invalid');
  if (!req.user || String(req.user.id) !== String(req.query.u)) throw new HttpError(401, 'Sign in as the recipient of this link');
  const acc = docAccess(req.user, d); if (!acc) throw notFound('Document not found');
  logAccess(d.id, req.user, 'download', req.query.purpose);
  audit(req.user, 'document.download', 'document', d.id, { case: d.case_id });
  const buf = readFileBytes(d);
  res.setHeader('Content-Type', d.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${d.filename.replace(/"/g, '')}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(buf);
});

documents.use(requireAuth);
documents.get('/:id/link', (req, res) => {
  const { d } = loadDoc(req.user, req.params.id);
  const purpose = String(req.query.purpose || (isStaff(req.user) ? 'service_review' : 'owner_view'));
  logAccess(d.id, req.user, 'link', purpose);
  res.json({ url: `${signedUrl(d.id, req.user.id)}&purpose=${encodeURIComponent(purpose)}`, expires_in: 300 });
});
documents.get('/:id/history', (req, res) => {
  const { d } = loadDoc(req.user, req.params.id);
  let root = d; while (root.replaces_id) root = get('SELECT * FROM documents WHERE id = ?', root.replaces_id) || { replaces_id: null, ...root };
  const chain = all('SELECT id, version, filename, size, sha256, role, created_at FROM documents WHERE id = ? OR replaces_id = ? OR id = ? ORDER BY version', d.replaces_id || d.id, d.replaces_id || d.id, d.id);
  res.json({ versions: chain, access_log: isStaff(req.user) || d.owner_user_id === req.user.id ? all('SELECT l.*, u.name FROM document_access_log l LEFT JOIN users u ON u.id = l.user_id WHERE document_id = ? ORDER BY l.id DESC LIMIT 50', d.id) : [] });
});

documents.post('/:id/extract', async (req, res) => {
  const { d, a } = loadDoc(req.user, req.params.id);
  if (!a.act && !isStaff(req.user)) throw forbidden();
  if (d.scan_status !== 'clean') throw conflict('File has not passed the security scan');
  const buf = d.storage_key ? readFileBytes(d) : null;
  const out = await extractDocument(d, buf);
  const f = out.fields;
  if (out.source !== 'none') update('documents', d.id, { extracted: f, extraction_source: out.source, confirmed: 0, holder_name: f.holder_name ?? d.holder_name, doc_number: f.doc_number ?? d.doc_number, issue_date: f.issue_date ?? d.issue_date, expiry_date: f.expiry_date ?? d.expiry_date, issuing_authority: f.issuing_authority ?? d.issuing_authority, issuing_country: f.issuing_country ?? d.issuing_country, pages_declared: f.pages ?? d.pages_declared, pages_uploaded: d.pages_uploaded ?? f.pages ?? null });
  audit(req.user, 'document.extract', 'document', d.id, { source: out.source });
  const fresh = get('SELECT * FROM documents WHERE id = ?', d.id);
  res.json({ document: docOut(fresh), source: out.source, confidence: out.confidence, notice: out.notice, readiness: d.case_id ? readinessCheck(get('SELECT * FROM cases WHERE id = ?', d.case_id)) : null });
});

documents.patch('/:id', (req, res) => {
  const { d, a } = loadDoc(req.user, req.params.id);
  if (!a.act && !isStaff(req.user)) throw forbidden();
  const b = validate(req.body, { kind: 'string', holder_name: 'string', doc_number: 'string', issue_date: 'string', expiry_date: 'string', issuing_authority: 'string', issuing_country: 'string', pages_declared: 'number', pages_uploaded: 'number', purpose: 'string', confirmed: 'boolean' });
  update('documents', d.id, b);
  const readiness = d.case_id ? readinessCheck(get('SELECT * FROM cases WHERE id = ?', d.case_id)) : null;
  res.json({ document: docOut(get('SELECT * FROM documents WHERE id = ?', d.id)), readiness });
});

documents.post('/:id/verification', (req, res) => {
  if (!['ops', 'admin', 'support'].includes(req.user.role)) throw forbidden('Verification records are entered by reviewers');
  const { d } = loadDoc(req.user, req.params.id);
  const b = validate(req.body, { method: 'string!', result: 'string!', source: 'string!' });
  res.json({ document: docOut(recordVerification(d.id, req.user, b)) });
});

documents.delete('/:id', (req, res) => {
  const { d, a } = loadDoc(req.user, req.params.id);
  if (!a.act) throw forbidden();
  if (d.case_id) { const c = get('SELECT status FROM cases WHERE id = ?', d.case_id); if (!['draft', 'customer_action_required', 'correction_required'].includes(c.status)) throw bad('Documents cannot be removed once the case is under review; upload a replacement version instead'); }
  update('documents', d.id, { deleted_at: new Date().toISOString() });
  audit(req.user, 'document.delete', 'document', d.id, {});
  res.json({ ok: true });
});
export const _d = { authenticate, json };
