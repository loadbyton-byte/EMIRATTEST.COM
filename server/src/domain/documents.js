import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { all, get, insert, update, json } from '../db.js';
import { randomToken, sha256, hmac, safeEqual, bad, HttpError, nowIso, todayStr } from '../lib/util.js';
import { audit } from '../lib/audit.js';

export const UPLOAD_DIR = () => { const d = path.join(config.dataDir, 'uploads'); fs.mkdirSync(d, { recursive: true }); return d; };
export const MAX_UPLOAD = 15 * 1024 * 1024;

const SIGS = [
  { ext: ['pdf'], mime: 'application/pdf', test: (b) => b.slice(0, 5).toString() === '%PDF-' },
  { ext: ['png'], mime: 'image/png', test: (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: ['jpg', 'jpeg'], mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 },
  { ext: ['webp'], mime: 'image/webp', test: (b) => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' },
  { ext: ['tif', 'tiff'], mime: 'image/tiff', test: (b) => (b[0] === 0x49 && b[1] === 0x49) || (b[0] === 0x4d && b[1] === 0x4d) },
];
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

/** Upload-time scan: type/extension agreement, executable signatures and the EICAR test signature. */
export function scanBuffer(filename, buf) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (buf.includes(Buffer.from(EICAR))) return { status: 'blocked', note: 'Malware test signature detected', mime: null };
  if ((buf[0] === 0x4d && buf[1] === 0x5a) || buf.slice(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) return { status: 'blocked', note: 'Executable content is not allowed', mime: null };
  const sig = SIGS.find((s) => s.test(buf));
  if (!sig) return { status: 'unsupported', note: 'Unsupported file format. Upload PDF, PNG, JPEG, WebP or TIFF.', mime: null };
  if (!sig.ext.includes(ext)) return { status: 'blocked', note: `File extension .${ext} does not match its content (${sig.mime})`, mime: sig.mime };
  return { status: 'clean', note: 'No threats detected by upload scan', mime: sig.mime };
}

export function storeDocument({ user, caseId = null, profileId = null, kind = 'other', filename, buffer, role = 'original', replacesId = null, meta = {} }) {
  if (!buffer?.length) throw bad('Empty file');
  if (buffer.length > MAX_UPLOAD) throw new HttpError(413, 'File too large (limit 15 MB)');
  const safeName = String(filename || 'document').replace(/[^\w.\- ()]/g, '_').slice(-120);
  const scan = scanBuffer(safeName, buffer);
  if (scan.status === 'unsupported') throw new HttpError(415, scan.note);
  const key = randomToken(24);
  if (scan.status === 'clean') fs.writeFileSync(path.join(UPLOAD_DIR(), key), buffer);
  let version = 1;
  if (replacesId) {
    const prev = get('SELECT * FROM documents WHERE id = ?', replacesId);
    if (prev) { version = prev.version + 1; if (role === 'original') update('documents', prev.id, { role: 'superseded' }); }
  }
  const id = insert('documents', {
    case_id: caseId, profile_id: profileId, owner_user_id: user.id, kind, filename: safeName, mime: scan.mime, size: buffer.length, sha256: sha256(buffer),
    storage_key: scan.status === 'clean' ? key : null, version, replaces_id: replacesId, role, scan_status: scan.status, scan_note: scan.note,
    holder_name: meta.holder_name, doc_number: meta.doc_number, issue_date: meta.issue_date, expiry_date: meta.expiry_date, issuing_authority: meta.issuing_authority,
    issuing_country: meta.issuing_country, pages_declared: meta.pages_declared, pages_uploaded: meta.pages_uploaded, purpose: meta.purpose,
  });
  audit(user, 'document.upload', 'document', id, { case: caseId, kind, size: buffer.length, scan: scan.status, sha256: sha256(buffer).slice(0, 12) });
  if (scan.status === 'blocked') throw new HttpError(422, `Upload blocked: ${scan.note}`, { document_id: id });
  return get('SELECT * FROM documents WHERE id = ?', id);
}

export const docOut = (d, { internal = false } = {}) => {
  const o = { ...d, extracted: json(d.extracted, {}), issues: json(d.issues, []), confirmed: !!d.confirmed };
  delete o.storage_key;
  if (!internal) { delete o.scan_note; }
  return o;
};
export const caseDocs = (caseId) => all('SELECT * FROM documents WHERE case_id = ? AND deleted_at IS NULL ORDER BY created_at, id', caseId);

export function logAccess(documentId, user, action, purpose) {
  insert('document_access_log', { document_id: documentId, user_id: user?.id ?? null, action, purpose: purpose || null });
}

// ---- expiring signed links ----
export function signedUrl(docId, userId, ttlSec = 300) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = hmac(`doc:${docId}:${userId}:${exp}`);
  return `/api/documents/${docId}/file?u=${userId}&e=${exp}&s=${sig}`;
}
export function checkSigned(docId, u, e, s) {
  return Number(e) > Math.floor(Date.now() / 1000) && safeEqual(s || '', hmac(`doc:${docId}:${u}:${e}`));
}
export function readFileBytes(d) {
  if (!d.storage_key) throw new HttpError(410, 'File not available');
  const buf = fs.readFileSync(path.join(UPLOAD_DIR(), d.storage_key));
  if (sha256(buf) !== d.sha256) throw new HttpError(500, 'Integrity check failed: stored bytes differ from the original upload');
  return buf;
}

// ---- readiness / mismatch controls ----
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9؀-ۿ ]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
const nameSim = (a, b) => {
  const x = new Set(norm(a).split(' ')); const y = new Set(norm(b).split(' '));
  if (!x.size || !y.size) return 1;
  const inter = [...x].filter((t) => y.has(t)).length;
  return inter / Math.max(x.size, y.size);
};

/** Compute readiness issues for a case. Issues are shown to the reviewer with evidence; originals are never altered. */
export function readinessCheck(caseRow) {
  const docs = caseDocs(caseRow.id).filter((d) => d.role !== 'superseded' && d.role !== 'derivative');
  const profile = caseRow.profile_id ? get('SELECT * FROM profiles WHERE id = ?', caseRow.profile_id) : null;
  const today = todayStr();
  const caseIssues = [];
  const perDoc = new Map();
  const add = (d, sev, code, message, evidence) => { const list = perDoc.get(d.id) || []; list.push({ severity: sev, code, message, evidence }); perDoc.set(d.id, list); };
  const originals = docs.filter((d) => d.role === 'original' && d.kind !== 'passport' && d.kind !== 'photo');
  if (originals.length < Math.max(caseRow.doc_count, 1)) caseIssues.push({ severity: 'blocker', code: 'missing_document', message: `Request declares ${caseRow.doc_count} document(s) but ${originals.length} original(s) uploaded`, evidence: { declared: caseRow.doc_count, uploaded: originals.length } });
  const route = caseRow.route_id ? get('SELECT * FROM routes WHERE id = ?', caseRow.route_id) : null;
  if (route) {
    const reqs = all('SELECT * FROM route_requirements WHERE route_id = ?', route.id);
    if (reqs.some((r) => /passport/i.test(r.label)) && !docs.some((d) => d.kind === 'passport')) caseIssues.push({ severity: 'blocker', code: 'missing_passport', message: 'Passport copy of the holder is required for this route', evidence: {} });
  }
  const seenNumbers = new Map();
  for (const d of docs) {
    if (d.scan_status !== 'clean') add(d, 'blocker', 'scan', d.scan_note || 'File did not pass scan', {});
    if (d.pages_declared && d.pages_uploaded && d.pages_uploaded < d.pages_declared) add(d, 'blocker', 'missing_pages', `Document has ${d.pages_declared} page(s) but only ${d.pages_uploaded} uploaded`, { declared: d.pages_declared, uploaded: d.pages_uploaded });
    if (d.mime?.startsWith('image/') && d.size < 20000) add(d, 'warning', 'low_quality', 'Image is very small and may be unreadable; upload a sharper scan', { bytes: d.size });
    if (d.mime === 'application/pdf' && d.size < 1500) add(d, 'warning', 'low_quality', 'PDF appears nearly empty', { bytes: d.size });
    if (d.expiry_date && d.expiry_date < today) add(d, 'blocker', 'expired', `Document expired on ${d.expiry_date}`, { expiry: d.expiry_date });
    if (d.holder_name && profile && nameSim(d.holder_name, profile.full_name) < 0.6) add(d, 'blocker', 'name_mismatch', `Name on document "${d.holder_name}" differs from holder "${profile.full_name}"`, { document: d.holder_name, intake: profile.full_name });
    if (d.kind === 'passport' && d.doc_number && profile?.passport_no && norm(d.doc_number) !== norm(profile.passport_no)) add(d, 'blocker', 'number_mismatch', `Passport number on document (${d.doc_number}) differs from profile (${profile.passport_no})`, { document: d.doc_number, intake: profile.passport_no });
    if (d.doc_number) { const k = `${d.kind}`; if (seenNumbers.has(k) && seenNumbers.get(k) !== norm(d.doc_number) && d.kind !== 'other') add(d, 'warning', 'number_inconsistent', `Document number differs from another ${d.kind} in this case`, { first: seenNumbers.get(k), this: norm(d.doc_number) }); seenNumbers.set(k, norm(d.doc_number)); }
    if (d.holder_name && docs.some((o) => o.id !== d.id && o.holder_name && nameSim(o.holder_name, d.holder_name) < 0.6 && o.kind !== 'other' && d.kind !== 'other')) add(d, 'warning', 'cross_name', 'Holder name differs between documents in this case', { name: d.holder_name });
    if (!d.confirmed && d.extraction_source) add(d, 'info', 'unconfirmed', 'Extracted fields are provisional until a person confirms them', { source: d.extraction_source });
  }
  const all_ = [];
  for (const d of docs) { const list = perDoc.get(d.id) || []; update('documents', d.id, { issues: list }); all_.push(...list.map((i) => ({ ...i, document_id: d.id, filename: d.filename }))); }
  const issues = [...caseIssues, ...all_];
  const blockers = issues.filter((i) => i.severity === 'blocker');
  return {
    ready: blockers.length === 0 && docs.length > 0,
    blockers, warnings: issues.filter((i) => i.severity === 'warning'), info: issues.filter((i) => i.severity === 'info'),
    guidance: blockers.length ? 'Resolve differences with the issuing authority or correct the intake details. Emirattest does not alter an original official record to make it match.' : 'No blocking issues found by automated checks. A human reviewer still confirms readiness.',
    documents: docs.length, checked_at: nowIso(),
  };
}

export function recordVerification(docId, user, { method, result, source }) {
  const d = get('SELECT * FROM documents WHERE id = ?', docId);
  if (!d) return null;
  update('documents', docId, { verification_method: method, verification_result: result, verification_source: source });
  audit(user, 'document.verify', 'document', docId, { method, result, source });
  return get('SELECT * FROM documents WHERE id = ?', docId);
}
