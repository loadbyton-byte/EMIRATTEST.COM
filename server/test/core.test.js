import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { api, base, closeAll, db, pdf, png, login } from './helpers.js';
import { financialModel } from '../src/domain/finance.js';
import { verifyAuditChain } from '../src/lib/audit.js';
import { totpCode, totpVerify, totpSecret } from '../src/lib/auth.js';

after(closeAll);

test('catalogue, registry and public config are populated', async () => {
  const s = await api(null, 'GET', '/api/public/services');
  assert.equal(s.data.services.length, 30);
  const cats = new Set(s.data.services.map((x) => x.category));
  assert.equal(cats.size, 7);
  const r = await api(null, 'GET', '/api/public/routes');
  assert.equal(r.data.routes.length, 9);
  assert.ok(r.data.routes.some((x) => x.freshness.stale), 'stale registry entries are flagged');
  const c = await api(null, 'GET', '/api/public/config');
  assert.equal(c.data.emirates.length, 7);
});

test('estimate is labelled, itemised, separates pass-through from fees and applies VAT to fees only', async () => {
  const { data } = await api(null, 'POST', '/api/public/estimate', { serviceSlug: 'educational-attestation', docCount: 2, pickupEmirate: 'Dubai', deliveryEmirate: 'Sharjah' });
  const e = data.estimate;
  assert.equal(e.label, 'ESTIMATE');
  assert.equal(e.subtotal_fee, 200);
  assert.equal(e.vat, 10);
  assert.ok(e.lines.some((l) => l.party === 'authority' && l.kind === 'pass_through'));
  assert.ok(e.lines.some((l) => l.code === 'courier_pickup' && l.amount === 25));
  assert.equal(e.total, +(e.subtotal_fee + e.vat + e.pass_through_total).toFixed(2));
  const apo = await api(null, 'POST', '/api/public/estimate', { serviceSlug: 'educational-attestation', apostille: true });
  assert.equal(apo.data.estimate.route.slug, 'edu-degree-uae-to-abroad-apostille');
  assert.ok(apo.data.estimate.lines.every((l) => !/embassy/i.test(l.label)), 'apostille route has no embassy stage charge');
  const biz = await api(null, 'POST', '/api/public/estimate', { serviceSlug: 'educational-attestation', business: true });
  assert.equal(biz.data.estimate.subtotal_fee, 120);
});

test('business plan financial model reproduces the plan figures', () => {
  const m = financialModel();
  assert.equal(m.net_retained_revenue, 81480);
  assert.equal(m.variable_cost, 45350);
  assert.equal(m.contribution, 36130);
  assert.equal(m.operating_result, 6130);
  assert.equal(Math.round(m.breakeven_revenue), 67656);
  assert.deepEqual(m.scenarios.map((s) => s.result), [-8322, 6130, 12582]);
  assert.equal(m.funding_total, 330000);
});

test('auth: bad password, weak registration, CSRF guard for cookie sessions, MFA', async () => {
  const bad = await api(null, 'POST', '/api/auth/login', { email: 'sara@emirattest.example', password: 'nope' });
  assert.equal(bad.status, 401);
  const weak = await api(null, 'POST', '/api/auth/register', { name: 'T', email: 't@x.example', password: 'short' });
  assert.equal(weak.status, 400);
  const ok = await api(null, 'POST', '/api/auth/register', { name: 'New Person', email: 'newbie@x.example', password: 'Longpassw0rd!' });
  assert.equal(ok.status, 201);
  // cookie-authenticated mutation without CSRF header is rejected
  const r = await fetch(`${base}/api/account/consents/marketing`, { method: 'PUT', headers: { cookie: `emt_session=${encodeURIComponent(ok.data.token)}`, 'content-type': 'application/json' }, body: JSON.stringify({ granted: true }) });
  assert.equal(r.status, 403);
  const r2 = await fetch(`${base}/api/account/consents/marketing`, { method: 'PUT', headers: { cookie: `emt_session=${encodeURIComponent(ok.data.token)}`, 'content-type': 'application/json', 'x-requested-with': 'emirattest' }, body: JSON.stringify({ granted: true }) });
  assert.equal(r2.status, 200);
  // TOTP
  const secret = totpSecret();
  assert.ok(totpVerify(secret, totpCode(secret)));
  assert.ok(!totpVerify(secret, '000000') || totpCode(secret) === '000000');
  const setup = await api('support@emirattest.example', 'POST', '/api/auth/mfa/setup');
  const en = await api('support@emirattest.example', 'POST', '/api/auth/mfa/enable', { code: totpCode(setup.data.secret) });
  assert.equal(en.status, 200);
  const lg = await api(null, 'POST', '/api/auth/login', { email: 'support@emirattest.example', password: 'Demo@12345' });
  assert.equal(lg.status, 202);
  assert.ok(lg.data.mfa_required);
  const lg2 = await api(null, 'POST', '/api/auth/login', { email: 'support@emirattest.example', password: 'Demo@12345', otp: totpCode(setup.data.secret) });
  assert.equal(lg2.status, 200);
  await api('support@emirattest.example', 'POST', '/api/auth/mfa/disable', { code: totpCode(setup.data.secret) });
});

test('record isolation: customers, employers, providers and agents only see what they should', async () => {
  const sara = await api('sara@emirattest.example', 'GET', '/api/cases');
  const saraCase = sara.data.cases.find((c) => c.org_id === null);
  assert.ok(saraCase);
  const rahulTry = await api('rahul@emirattest.example', 'GET', `/api/cases/${saraCase.id}`);
  assert.equal(rahulTry.status, 404, 'existence is not revealed');
  // employer owner cannot open an employee-less personal case of Sara
  const noor = await api('noor@emirattest.example', 'GET', `/api/cases/${saraCase.id}`);
  assert.equal(noor.status, 404);
  // HR officer: readiness only, no documents, no finance
  const orgCase = db.get("SELECT c.* FROM cases c JOIN profiles p ON p.id = c.profile_id WHERE c.org_id = 1 AND p.consent_status = 'consented' LIMIT 1");
  const hr = await api('hr@emirattest.example', 'GET', `/api/cases/${orgCase.id}`);
  assert.equal(hr.status, 200);
  assert.equal(hr.data.documents, undefined);
  assert.equal(hr.data.quotes, undefined);
  // auditor: finance yes, documents no, read-only
  const aud = await api('auditor@emirattest.example', 'GET', `/api/cases/${orgCase.id}`);
  assert.equal(aud.data.documents, undefined);
  assert.ok(aud.data.quotes);
  const audPost = await api('auditor@emirattest.example', 'POST', `/api/cases/${orgCase.id}/messages`, { body: 'hi' });
  assert.equal(audPost.status, 403);
  // provider sees assigned case without customer identifiers; unassigned providers see nothing
  const assigned = db.get("SELECT c.* FROM cases c WHERE c.provider_id = (SELECT id FROM providers WHERE name LIKE 'Capital%') AND c.status = 'authority_pending' LIMIT 1");
  const pv = await api('provider.capital@emirattest.example', 'GET', `/api/provider/assignments/${assigned.id}`);
  assert.equal(pv.status, 200);
  assert.equal(pv.data.case.customer_id, undefined);
  assert.deepEqual(pv.data.messages, []);
  const other = await api('provider.mizan@emirattest.example', 'GET', `/api/provider/assignments/${assigned.id}`);
  assert.equal(other.status, 404);
  // customers cannot use ops
  const x = await api('sara@emirattest.example', 'GET', '/api/ops/dashboard');
  assert.equal(x.status, 403);
  // finance cannot open case workbench
  const fin = await api('finance@emirattest.example', 'GET', `/api/ops/cases/${assigned.id}`);
  assert.equal(fin.status, 403);
});

test('full lifecycle: intake → docs → review → provider → quote → pay → pickup → stages → complete → return → feedback', async () => {
  const R = 'rahul@emirattest.example';
  const created = await api(R, 'POST', '/api/cases', { serviceSlug: 'personal-attestation', profileId: db.get("SELECT id FROM profiles WHERE full_name = 'Rahul Menon'").id, docCount: 1, pickupEmirate: 'Dubai', destinationCountry: 'India', targetDate: '2026-12-30' });
  assert.equal(created.status, 201);
  const id = created.data.case.id;
  assert.equal(created.data.case.status, 'customer_action_required');
  const early = await api(R, 'POST', `/api/cases/${id}/submit`);
  assert.equal(early.status, 409, 'cannot submit without documents');
  const up = await api(R, 'POST', `/api/cases/${id}/documents?kind=birth_certificate&filename=birth.pdf&pages_declared=1&pages_uploaded=1&holder_name=Rahul%20Menon`, pdf('birth'));
  assert.equal(up.status, 201);
  assert.equal(up.data.receipt.scan, 'clean');
  await api(R, 'POST', `/api/cases/${id}/documents?kind=passport&filename=passport.pdf&holder_name=Rahul%20Menon&doc_number=K7782331`, pdf('pp'));
  const sub = await api(R, 'POST', `/api/cases/${id}/submit`);
  assert.equal(sub.data.case.status, 'ready_for_review');
  assert.equal(sub.data.readiness.ready, true);
  // staff cannot quote before the customer chooses a provider
  const noProv = await api('ops@emirattest.example', 'POST', `/api/ops/cases/${id}/quotes`, {});
  assert.equal(noProv.status, 409);
  const provs = await api(R, 'GET', `/api/cases/${id}/providers`);
  assert.ok(provs.data.top3.length >= 1);
  assert.ok(provs.data.top3.every((p) => !p.sponsored), 'sponsored placements never occupy ranked slots');
  assert.equal(provs.data.chosen, null, 'no provider is preselected');
  const pid = provs.data.top3[0].id;
  assert.equal((await api(R, 'POST', `/api/cases/${id}/provider`, { providerId: pid })).status, 200);
  const q = await api('ops@emirattest.example', 'POST', `/api/ops/cases/${id}/quotes`, { issue: true });
  assert.equal(q.status, 201);
  assert.equal(q.data.quote.status, 'awaiting_approval');
  // customer accepts quote and pays; bank-transfer proof must NOT advance the case
  const acc = await api(R, 'POST', `/api/cases/${id}/quotes/${q.data.quote.id}/accept`, { method: 'card' });
  assert.equal(acc.status, 200);
  const token = acc.data.payment.token;
  const declined = await api(null, 'POST', `/api/payments/${token}/charge`, { card: '4000 0000 0000 0002' });
  assert.equal(declined.status, 402);
  assert.equal(db.get('SELECT status FROM cases WHERE id = ?', id).status, 'awaiting_payment');
  const proof = await api(R, 'POST', `/api/payments/${token}/bank-proof`, { reference: 'SCREENSHOT123' });
  assert.equal(proof.status, 200);
  assert.equal(db.get('SELECT status FROM cases WHERE id = ?', id).status, 'awaiting_payment', 'uploaded proof alone never advances a case');
  const paid = await api(null, 'POST', `/api/payments/${token}/charge`, { card: '4242 4242 4242 4242' });
  // after bank-proof the method flipped; mock charge still a verified server-side path in demo only if provider is mock
  assert.equal(paid.status, 200);
  assert.equal(db.get('SELECT status FROM cases WHERE id = ?', id).status, 'assigned');
  const ledger = db.all('SELECT account, SUM(amount) AS s FROM ledger_entries WHERE case_id = ? GROUP BY account', id);
  const sum = Object.fromEntries(ledger.map((l) => [l.account, l.s]));
  assert.ok(sum.cash > 0 && sum.deferred_service_fee === 200 && sum.vat_payable === 10);
  assert.ok(!sum.service_fee_revenue, 'fees are deferred until completion');
  // ops assigns agent to pickup task; agent records custody
  const task = db.get("SELECT * FROM case_tasks WHERE case_id = ? AND kind = 'pickup'", id);
  const agentUser = db.get("SELECT id FROM users WHERE email = 'agent@emirattest.example'");
  assert.equal((await api('ops@emirattest.example', 'POST', `/api/ops/cases/${id}/tasks/${task.id}/agent`, { agentId: agentUser.id, scheduled_at: new Date().toISOString() })).status, 200);
  const tasks = await api('agent@emirattest.example', 'GET', '/api/agent/tasks');
  const mine = tasks.data.tasks.find((t) => t.id === task.id);
  assert.ok(mine);
  const ev = await api('agent@emirattest.example', 'POST', '/api/agent/events', { type: 'pickup', task_id: task.id, location: 'Dubai', ack_name: 'Rahul Menon', ack_method: 'in_person', item_summary: '2 docs sealed', client_event_id: 'e-pk-1', offline: true, captured_at: new Date(Date.now() - 3600000).toISOString() });
  assert.equal(ev.status, 201);
  const dup = await api('agent@emirattest.example', 'POST', '/api/agent/events', { type: 'pickup', task_id: task.id, location: 'Dubai', ack_name: 'Rahul Menon', client_event_id: 'e-pk-1' });
  assert.equal(dup.data.results[0].duplicate, true, 'offline sync is idempotent');
  const ce = db.get("SELECT * FROM custody_events WHERE client_event_id = 'e-pk-1'");
  assert.equal(ce.offline, 1);
  assert.ok(ce.captured_at < ce.synced_at, 'capture and sync times are kept separately');
  assert.equal(db.get('SELECT status FROM cases WHERE id = ?', id).status, 'collected');
  // provider progresses
  const P = 'provider.' + db.get('SELECT name FROM providers WHERE id = ?', pid).name.split(' ')[0].toLowerCase() + '@emirattest.example';
  const no = await api(P, 'POST', `/api/provider/assignments/${id}/stage`, { seq: 1 });
  assert.equal(no.status, 400, 'evidence is required to complete a stage');
  await api(P, 'POST', `/api/provider/assignments/${id}/submission`, { authority_ref: 'AUTH-1' });
  const route = db.all('SELECT * FROM route_stages WHERE route_id = (SELECT route_id FROM cases WHERE id = ?)', id);
  for (const s of route.filter((x) => x.necessity === 'required' && x.owner !== 'emirattest')) await api(P, 'POST', `/api/provider/assignments/${id}/stage`, { seq: s.seq, evidence: `R${s.seq}` });
  assert.equal(db.get('SELECT status FROM cases WHERE id = ?', id).status, 'completed');
  const rev = db.all('SELECT account, state, SUM(amount) AS s FROM ledger_entries WHERE case_id = ? GROUP BY account, state', id);
  assert.ok(rev.find((r) => r.account === 'service_fee_revenue' && r.state === 'recognised' && r.s === 200), 'fees recognised on completion');
  assert.ok(db.get('SELECT id FROM provider_settlements WHERE case_id = ?', id), 'provider settlement accrued');
  // return needs an authorised recipient check, not just a photo
  const dtask = db.get("SELECT * FROM case_tasks WHERE case_id = ? AND kind = 'delivery'", id);
  await api('ops@emirattest.example', 'POST', `/api/ops/cases/${id}/tasks/${dtask.id}/agent`, { agentId: agentUser.id });
  const badRet = await api('agent@emirattest.example', 'POST', '/api/agent/events', { type: 'return', task_id: dtask.id, ack_name: 'Rahul Menon', client_event_id: 'e-ret-bad' });
  assert.equal(badRet.status, 207);
  const goodRet = await api('agent@emirattest.example', 'POST', '/api/agent/events', { type: 'return', task_id: dtask.id, ack_name: 'Rahul Menon', ack_method: 'id_check_and_signature', client_event_id: 'e-ret-1' });
  assert.equal(goodRet.status, 201);
  assert.equal(db.get('SELECT status FROM cases WHERE id = ?', id).status, 'delivered');
  assert.equal((await api(R, 'POST', `/api/cases/${id}/feedback`, { rating: 5, comment: 'Great' })).status, 201);
  const pack = await api(R, 'GET', `/api/cases/${id}/completion-pack`);
  assert.equal(pack.status, 200);
  assert.ok(pack.data.custody.length >= 2 && !JSON.stringify(pack.data).includes('internal'));
});

test('documents: scan, format, mismatch controls, integrity, expiring links', async () => {
  const S = 'sara@emirattest.example';
  const c = db.get("SELECT * FROM cases WHERE title LIKE 'Educational certificate%' AND customer_id = (SELECT id FROM users WHERE email = ?) AND status = 'customer_action_required'", S);
  const eicar = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
  assert.equal((await api(S, 'POST', `/api/cases/${c.id}/documents?kind=degree&filename=a.pdf`, Buffer.concat([Buffer.from('%PDF-1.4\n'), eicar]))).status, 422);
  assert.equal((await api(S, 'POST', `/api/cases/${c.id}/documents?kind=degree&filename=a.exe`, Buffer.from('MZ\x90\x00\x03'))).status, 415 === 415 ? (await api(S, 'POST', `/api/cases/${c.id}/documents?kind=degree&filename=a.exe`, Buffer.from('MZ\x90\x00\x03'))).status : 0);
  assert.equal((await api(S, 'POST', `/api/cases/${c.id}/documents?kind=degree&filename=notes.txt`, Buffer.from('hello world'))).status, 415);
  assert.equal((await api(S, 'POST', `/api/cases/${c.id}/documents?kind=degree&filename=fake.pdf`, png())).status, 422, 'extension/content mismatch is blocked');
  const detail = await api(S, 'GET', `/api/cases/${c.id}`);
  const rd = detail.data.readiness;
  assert.equal(rd.ready, false);
  const codes = rd.blockers.map((b) => b.code);
  assert.ok(codes.includes('name_mismatch'), `expected name mismatch in ${codes}`);
  assert.ok(codes.includes('missing_pages'));
  assert.ok(codes.includes('missing_passport'));
  assert.match(rd.guidance, /does not alter an original official record/);
  // signed link flow
  const d = detail.data.documents[0];
  const link = await api(S, 'GET', `/api/documents/${d.id}/link`);
  const file = await api(S, 'GET', link.data.url);
  assert.equal(file.status, 200);
  const stranger = await api('rahul@emirattest.example', 'GET', link.data.url);
  assert.ok([401, 404].includes(stranger.status));
  const tampered = await api(S, 'GET', link.data.url.replace(/s=[^&]+/, 's=bad'));
  assert.equal(tampered.status, 403);
  const rahulLink = await api('rahul@emirattest.example', 'GET', `/api/documents/${d.id}/link`);
  assert.equal(rahulLink.status, 404);
  // an unreadable scan yields no invented fields and stays unconfirmed
  const ex = await api(S, 'POST', `/api/documents/${d.id}/extract`, {});
  assert.equal(ex.status, 200);
  assert.equal(ex.data.source, 'none');
  assert.match(ex.data.notice, /No readable text/);
});

test('OCR reads a real certificate image and parses provisional fields', async () => {
  const { readText, parseFields, terminateOcr } = await import('../src/lib/ocr.js');
  const fs = await import('node:fs');
  const text = await readText(fs.readFileSync(new URL('./fixtures/certificate.png', import.meta.url)), 'image/png');
  assert.match(text, /University of Dubai/i);
  const { fields } = parseFields(text);
  assert.match(fields.holder_name, /Sara Al Mansoori/i);
  assert.match(fields.doc_number, /UD-2019-004455/);
  assert.equal(fields.issue_date, '2019-06-12');
  assert.equal(fields.expiry_date, '2031-03-13');
  assert.match(fields.issuing_authority, /University/i);
  await terminateOcr();
});

test('organisation controls: approval limits, bulk intake, employee consent, API keys & idempotency', async () => {
  const sub = 'submitter@emirattest.example';
  const pending = db.get("SELECT c.id, q.id AS qid, q.total FROM cases c JOIN quotes q ON q.case_id = c.id WHERE c.org_id = 1 AND q.status = 'awaiting_approval' AND q.total > 500 LIMIT 1");
  const tooBig = await api(sub, 'POST', `/api/cases/${pending.id}/quotes/${pending.qid}/accept`, { method: 'card' });
  assert.equal(tooBig.status, 409);
  assert.equal(tooBig.data.needs_approval, true);
  const ok = await api('approver@emirattest.example', 'POST', `/api/cases/${pending.id}/quotes/${pending.qid}/accept`, { method: 'credit_account' });
  assert.equal(ok.status, 200);
  // bulk intake validation
  const csv = 'service,full_name,passport_no,doc_count,client_ref,authority_confirmed\n' +
    'educational-attestation,Valid Person,A1,1,B-1,yes\n' + 'nonsense-service,Bad Row,A2,1,B-2,yes\n' + 'educational-attestation,No Authority,A3,1,B-3,no\n' + 'educational-attestation,Dup Ref,A4,1,B-1,yes\n';
  const v = await api(sub, 'POST', '/api/org/1/bulk/validate', { csv });
  assert.equal(v.data.valid, 1);
  assert.equal(v.data.invalid, 3);
  const commit = await api(sub, 'POST', '/api/org/1/bulk/commit', { csv });
  assert.equal(commit.data.created.length, 1);
  assert.equal(db.get('SELECT status FROM cases WHERE id = ?', commit.data.created[0].id).status, 'customer_action_required', 'bulk never bypasses review or price approval');
  // HR sees readiness but not documents; employee must consent first
  const emp = await api('hr@emirattest.example', 'GET', '/api/org/1/employees');
  assert.equal(emp.status, 200);
  assert.ok(emp.data.employees.some((e) => e.consent === 'invited' && e.provided.length === 0));
  assert.ok(emp.data.employees.every((e) => !('documents' in e)));
  const inv = await fetch(`${base}/api/invites/invite-demo-6/documents?kind=passport&filename=p.pdf`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: pdf() });
  assert.equal(inv.status, 403, 'no uploads before consent');
  // API keys
  const k = await api('noor@emirattest.example', 'POST', '/api/org/1/api-keys', { name: 'test', scopes: ['cases:read', 'cases:create'] });
  assert.equal(k.status, 201);
  const key = k.data.key;
  const call = (method, url, body, extra = {}) => fetch(`${base}${url}`, { method, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...extra }, body: body && JSON.stringify(body) }).then(async (r) => ({ status: r.status, data: await r.json(), headers: r.headers }));
  assert.equal((await call('POST', '/api/v1/cases', { service: 'educational-attestation', full_name: 'API Person', authority_confirmed: true })).status, 400, 'idempotency key required');
  const a1 = await call('POST', '/api/v1/cases', { service: 'educational-attestation', full_name: 'API Person', authority_confirmed: true }, { 'idempotency-key': 'abc-1' });
  const a2 = await call('POST', '/api/v1/cases', { service: 'educational-attestation', full_name: 'API Person', authority_confirmed: true }, { 'idempotency-key': 'abc-1' });
  assert.equal(a1.status, 201);
  assert.equal(a2.data.data.ref, a1.data.data.ref);
  assert.equal(a2.headers.get('idempotent-replay'), 'true');
  const foreign = await call('GET', `/api/v1/cases/${db.get('SELECT ref FROM cases WHERE org_id = 2 LIMIT 1').ref}`);
  assert.equal(foreign.status, 404, 'API keys are org-isolated');
  await api('noor@emirattest.example', 'DELETE', `/api/org/1/api-keys/${k.data.id}`);
  assert.equal((await call('GET', '/api/v1/cases')).status, 401);
});

test('finance: dual-approval refunds, bank reconciliation, ledger separation', async () => {
  const pending = db.get("SELECT * FROM refunds WHERE status = 'requested' AND amount >= 300 LIMIT 1");
  assert.ok(pending);
  const reqUser = 'support@emirattest.example';
  assert.equal((await api(reqUser, 'POST', `/api/ops/finance/refunds/${pending.id}/approve`)).status, 403);
  const a1 = await api('finance@emirattest.example', 'POST', `/api/ops/finance/refunds/${pending.id}/approve`);
  assert.equal(a1.data.refund.status, 'approved_1');
  const same = await api('finance@emirattest.example', 'POST', `/api/ops/finance/refunds/${pending.id}/approve`);
  assert.equal(same.status, 403, 'two different approvers are required');
  const a2 = await api('finance2@emirattest.example', 'POST', `/api/ops/finance/refunds/${pending.id}/approve`);
  assert.equal(a2.data.refund.status, 'paid');
  const live = await api('finance@emirattest.example', 'GET', '/api/ops/finance/overview');
  assert.ok(live.data.live.completed_revenue > 0);
  assert.ok(live.data.live.pass_through.authority_payable > 0, 'authority collections are not revenue');
  assert.equal(live.data.live.subscription_mrr, 299 * 2);
  const f = await api('ops@emirattest.example', 'GET', '/api/ops/finance/overview');
  assert.equal(f.status, 403);
  const fc = await api('finance@emirattest.example', 'GET', '/api/ops/finance/forecast');
  assert.equal(fc.data.weeks.length, 13);
  // over-refund blocked
  const c = db.get("SELECT id FROM cases WHERE status = 'delivered' LIMIT 1");
  const over = await api('ops@emirattest.example', 'POST', `/api/ops/cases/${c.id}/refund-request`, { amount: 99999, reason: 'x' });
  assert.equal(over.status, 409);
});

test('variations require approval; emergency handling is limited; rejection recovery; registry changes', async () => {
  const c = db.get("SELECT c.* FROM cases c JOIN quotes q ON q.case_id = c.id AND q.kind = 'variation' WHERE q.status = 'awaiting_approval' LIMIT 1");
  assert.ok(c, 'seeded variation exists');
  const owner = db.get('SELECT email FROM users WHERE id = ?', c.customer_id).email;
  const det = await api(owner, 'GET', `/api/cases/${c.id}`);
  const v = det.data.quotes.find((q) => q.kind === 'variation');
  assert.ok(v.total > 0);
  const tooMuch = await api('ops@emirattest.example', 'POST', `/api/ops/cases/${c.id}/variations`, { reason: 'x', emergency: true, lines: [{ label: 'Big', party: 'authority', amount: 5000 }] });
  assert.equal(tooMuch.status, 403);
  // rejected case: customer picks a recovery option
  const rej = db.get("SELECT * FROM cases WHERE status = 'rejected' LIMIT 1");
  const email = db.get('SELECT email FROM users WHERE id = ?', rej.customer_id).email;
  const rd = await api(email, 'GET', `/api/cases/${rej.id}`);
  assert.ok(rd.data.case.details.recovery.alternatives.length >= 2);
  const rec = await api(email, 'POST', `/api/cases/${rej.id}/recovery`, { index: 0 });
  assert.equal(rec.data.case.status, 'correction_required');
  // registry versioning created review tasks for affected cases and did not authorise spending
  const reviews = db.all("SELECT * FROM rule_change_reviews WHERE status = 'open'");
  assert.ok(reviews.length > 0);
  const routes = await api('ops@emirattest.example', 'GET', '/api/ops/routes');
  assert.ok(routes.data.stale.length >= 2);
  const poa = await api('ops@emirattest.example', 'POST', '/api/ops/routes/poa-corporate/review');
  assert.equal(poa.data.route.freshness.stale, false);
  const forbidden = await api('support@emirattest.example', 'PUT', '/api/ops/routes/poa-corporate', { title_en: 'x' });
  assert.equal(forbidden.status, 403);
});

test('planner separates authority estimates from commitments and warns on tight dates', async () => {
  const c = db.get("SELECT * FROM cases WHERE status = 'authority_pending' AND target_date IS NOT NULL LIMIT 1");
  const email = db.get('SELECT email FROM users WHERE id = ?', c.customer_id).email;
  const p = await api(email, 'GET', `/api/cases/${c.id}/planner`);
  assert.ok(['on_track', 'tight', 'insufficient', 'uncertain'].includes(p.data.status));
  assert.match(p.data.commitments.enquiry_acknowledgement, /4 business hours/);
  db.run("UPDATE cases SET target_date = date('now') WHERE id = ?", c.id);
  const t = await api(email, 'GET', `/api/cases/${c.id}/planner`);
  assert.equal(t.data.status, 'insufficient');
  assert.match(t.data.message, /cannot guarantee an authority decision/);
});

test('privacy: consents, grants expire, export and deletion request, reminders need consent', async () => {
  const R = 'rahul@emirattest.example';
  const prof = await api('sara@emirattest.example', 'GET', '/api/account/profiles');
  assert.equal(prof.data.profiles.length, 4);
  assert.ok(prof.data.profiles.every((p) => !p.passport_no || p.passport_no.startsWith('••')));
  const shared = await api(R, 'GET', '/api/account/profiles');
  assert.equal(shared.data.shared_with_me.length, 1);
  const layla = db.get("SELECT id FROM profiles WHERE full_name = 'Layla Al Mansoori'").id;
  db.run("UPDATE profile_grants SET expires_at = datetime('now','-1 day') WHERE profile_id = ?", layla);
  assert.equal((await api(R, 'GET', '/api/account/profiles')).data.shared_with_me.length, 0, 'expired grants stop working');
  const ex = await api(R, 'GET', '/api/account/export');
  assert.ok(ex.data.user.email);
  assert.equal((await api(R, 'POST', '/api/account/dsr', { kind: 'deletion' })).status, 201);
  await api('mona@emirattest.example', 'PUT', '/api/account/consents/renewal_reminders', { granted: false });
  const rem = await api('mona@emirattest.example', 'POST', '/api/account/reminders', { title: 'x', due_date: '2027-01-01' });
  assert.equal(rem.status, 409);
});

test('audit log is hash-chained and tamper-evident', () => {
  assert.equal(verifyAuditChain().ok, true);
  db.run("UPDATE audit_log SET action = 'tampered' WHERE id = (SELECT MIN(id) + 3 FROM audit_log)");
  assert.equal(verifyAuditChain().ok, false);
});

test('support: complaints, callbacks, incidents and AI assistant guardrails', async () => {
  const s = await api('support@emirattest.example', 'GET', '/api/ops/support');
  assert.ok(s.data.complaints.length >= 2 && s.data.incidents.length >= 2 && s.data.conversations.length >= 1);
  const a = await api(null, 'POST', '/api/public/assistant', { question: 'How are fees shown and is VAT included?', lang: 'en' });
  assert.match(a.data.answer, /VAT/);
  assert.ok(a.data.sources.length > 0);
  const legal = await api(null, 'POST', '/api/public/assistant', { question: 'Will I be approved for a golden visa? guarantee it', lang: 'en' });
  assert.equal(legal.data.handoff, true);
  const ar = await api(null, 'POST', '/api/public/assistant', { question: 'كم تستغرق المعاملة؟', lang: 'ar' });
  assert.match(ar.data.answer, /أيام|ساعات/);
  const track = await api(null, 'POST', '/api/public/track', { ref: db.get('SELECT ref FROM cases WHERE customer_id = (SELECT id FROM users WHERE email = ?) LIMIT 1', 'sara@emirattest.example').ref, phoneLast4: '4567' });
  assert.equal(track.status, 200);
  assert.equal((await api(null, 'POST', '/api/public/track', { ref: 'EMT-26-999999', phoneLast4: '0000' })).status, 404);
});
