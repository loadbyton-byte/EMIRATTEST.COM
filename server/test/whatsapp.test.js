import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { api, base, closeAll, db, pdf } from './helpers.js';

after(closeAll);
const sim = (phone, text, extra = {}) => api(null, 'POST', '/api/whatsapp/simulate', { phone, text, ...extra });
const SARA = '+971501234567';

test('menu, language switch and Arabic detection', async () => {
  const m = await sim('+971500000001', 'hi');
  assert.match(m.data.replies[0], /Emirattest/);
  assert.match(m.data.replies[0], /password|UAE Pass/);
  const ar = await sim('+971500000002', 'مرحبا');
  assert.equal(ar.data.lang, 'ar');
  assert.match(ar.data.replies[0], /إيميراتست/);
});

test('requirements flow returns stages, sources, review date and disclaimer', async () => {
  const p = '+971500000003';
  await sim(p, 'menu'); await sim(p, '1');
  await sim(p, '1');
  const r = await sim(p, 'apostille');
  assert.match(r.data.replies[0], /apostille route/i);
  assert.match(r.data.replies[0], /Last reviewed/);
  assert.match(r.data.replies[0], /Estimate only|Not legal advice/);
});

test('estimate flow produces an itemised estimate with explicit disclaimer', async () => {
  const p = '+971500000004';
  await sim(p, 'menu'); await sim(p, '2'); await sim(p, '1'); await sim(p, '2'); await sim(p, '1');
  const r = await sim(p, '2');
  const text = r.data.replies[0];
  assert.match(text, /ESTIMATE/);
  assert.match(text, /VAT 5%/);
  assert.match(text, /Estimated total/);
  assert.match(text, /Pickup|Return/);
});

test('case tracking only for the linked WhatsApp number; unknown numbers are refused', async () => {
  const known = await sim(SARA, 'menu');
  const t = await sim(SARA, '3');
  const joined = t.data.replies.join('\n');
  assert.match(joined, /EMT-\d\d-\d{6}/);
  const ref = joined.match(/EMT-\d\d-\d{6}/)[0];
  const other = '+971500000005';
  await sim(other, 'menu');
  const denied = await sim(other, '3');
  assert.match(denied.data.replies[0], /could not match|privacy/i);
  // Sara asking about Rahul's case is refused
  const rahulRef = db.get("SELECT ref FROM cases WHERE customer_id = (SELECT id FROM users WHERE email = 'rahul@emirattest.example') LIMIT 1").ref;
  await sim(SARA, 'menu'); await sim(SARA, '3');
  const x = await sim(SARA, rahulRef);
  assert.match(x.data.replies.join(' '), /could not match|privacy|cases linked/i);
  assert.ok(known && ref);
});

test('quote approval over WhatsApp returns a secure payment link and respects ownership', async () => {
  const c = db.get("SELECT c.* FROM cases c JOIN quotes q ON q.case_id = c.id WHERE c.customer_id = (SELECT id FROM users WHERE email = 'sara@emirattest.example') AND q.status = 'awaiting_approval' AND c.org_id IS NULL LIMIT 1");
  assert.ok(c);
  const bad = await sim('+971500000006', `APPROVE ${c.ref}`);
  assert.match(bad.data.replies[0], /only act on cases linked/i);
  const ok = await sim(SARA, `APPROVE ${c.ref}`);
  assert.match(ok.data.replies[0], /Pay securely|\/pay\//);
  assert.equal(db.get('SELECT status FROM cases WHERE id = ?', c.id).status, 'awaiting_payment');
});

test('document upload over WhatsApp is scanned, attached and acknowledged without claiming authenticity', async () => {
  const c = db.get("SELECT * FROM cases WHERE customer_id = (SELECT id FROM users WHERE email = 'sara@emirattest.example') AND status = 'customer_action_required' AND org_id IS NULL LIMIT 1");
  await sim(SARA, 'menu'); await sim(SARA, '5');
  const ready = await sim(SARA, c.ref);
  assert.match(ready.data.replies[0], /Ready/);
  const up = await sim(SARA, '', { media: { filename: 'scan.pdf', mime: 'application/pdf', base64: pdf('wa').toString('base64') } });
  assert.match(up.data.replies[0], /virus-scanned/);
  assert.match(up.data.replies[0], /not an authenticity check/);
  assert.ok(db.get("SELECT id FROM documents WHERE case_id = ? AND filename = 'scan.pdf'", c.id));
  const exe = await sim(SARA, '', { media: { filename: 'x.pdf', mime: 'application/pdf', base64: Buffer.from('MZ\x90\x00').toString('base64') } });
  assert.match(exe.data.replies[0], /⚠️/);
});

test('human handoff silences the bot, notifies support, and staff replies are recorded', async () => {
  const p = '+971500000007';
  const h = await sim(p, 'I want a person please');
  assert.equal(h.data.handoff, true);
  const quiet = await sim(p, 'hello?');
  assert.deepEqual(quiet.data.replies, []);
  const conv = db.get("SELECT * FROM conversations WHERE wa_id = '971500000007'");
  const r = await api('support@emirattest.example', 'POST', `/api/ops/conversations/${conv.id}/reply`, { body: 'Hi, Reem here.' });
  assert.equal(r.status, 201);
  assert.match(r.data.delivery, /simulated|sent/);
  const msgs = db.all('SELECT * FROM conv_messages WHERE conversation_id = ?', conv.id);
  assert.ok(msgs.some((m) => m.sender.startsWith('staff:')));
  assert.ok(db.get("SELECT id FROM notifications WHERE title LIKE 'WhatsApp handoff%' LIMIT 1"));
  const back = await sim(p, 'menu');
  assert.match(back.data.replies[0], /Emirattest/);
});

test('free-text questions use approved knowledge; legal questions suggest a person', async () => {
  const q = await sim('+971500000008', 'how long does attestation take');
  assert.match(q.data.replies[0], /business hours|days/i);
  const l = await sim('+971500000008', 'am I eligible for a visa, guarantee it');
  assert.match(l.data.replies.join(' '), /qualified adviser|reply 6/i);
});

test('Meta webhook: verification handshake, signature enforcement and idempotent message ids; Twilio TwiML', async () => {
  const ok = await fetch(`${base}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=emirattest-verify&hub.challenge=12345`);
  assert.equal(await ok.text(), '12345');
  const bad = await fetch(`${base}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1`);
  assert.equal(bad.status, 403);
  const payload = { entry: [{ changes: [{ value: { contacts: [{ wa_id: '971500000009', profile: { name: 'Meta User' } }], messages: [{ from: '971500000009', id: 'wamid.TEST1', type: 'text', text: { body: 'menu' } }] } }] }] };
  const r1 = await fetch(`${base}/api/whatsapp/webhook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  assert.equal(r1.status, 200);
  await new Promise((r) => setTimeout(r, 300));
  await fetch(`${base}/api/whatsapp/webhook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  await new Promise((r) => setTimeout(r, 300));
  const conv = db.get("SELECT * FROM conversations WHERE wa_id = '971500000009'");
  assert.equal(db.all("SELECT * FROM conv_messages WHERE conversation_id = ? AND direction = 'in'", conv.id).length, 1, 'duplicate delivery ignored');
  const tw = await fetch(`${base}/api/whatsapp/twilio`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'From=whatsapp%3A%2B971500000010&Body=menu&ProfileName=Tw' });
  const xml = await tw.text();
  assert.match(xml, /<Response><Message>/);
  assert.match(xml, /Emirattest/);
});
