import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'emt-test-'));
process.env.DATA_DIR = tmp;
process.env.EMT_DISABLE_RATE_LIMIT = '1';
process.env.EMT_NO_JOBS = '1';
process.env.DEMO_MODE = '1';
process.env.SESSION_SECRET = 'test-secret';

const { createApp } = await import('../src/app.js');
const { seedAll, seedAsync } = await import('../src/seed.js');
const db = await import('../src/db.js');

db.openDb();
seedAll({ quiet: true });
await seedAsync();
const app = createApp();
const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
export const base = `http://127.0.0.1:${server.address().port}`;
export const closeAll = () => { server.close(); db.closeDb(); fs.rmSync(tmp, { recursive: true, force: true }); };
export { db };

const tokens = {};
export async function login(email, password = 'Demo@12345') {
  if (tokens[email]) return tokens[email];
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const j = await r.json();
  if (!j.token) throw new Error(`login failed for ${email}: ${JSON.stringify(j)}`);
  tokens[email] = j.token;
  return j.token;
}
export async function api(email, method, url, body, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (email) headers.authorization = `Bearer ${await login(email)}`;
  let payload;
  if (body instanceof Buffer) { headers['content-type'] = 'application/octet-stream'; payload = body; }
  else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(`${base}${url}`, { method, headers, body: payload });
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : await r.text();
  return { status: r.status, data, headers: r.headers };
}
export const pdf = (n = 'x') => Buffer.from(`%PDF-1.4\n% ${n}\n${'% body\n'.repeat(300)}%%EOF\n`);
export const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(30000, 3)]);
