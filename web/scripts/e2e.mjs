// End-to-end smoke test: boots the real server on a temp DB, drives Chromium through every role's key screens,
// fails on console errors / failed API calls, and saves screenshots to web/test-results/.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = path.join(root, 'web', 'test-results'); fs.mkdirSync(out, { recursive: true });
const PORT = 8800 + Math.floor(Math.random() * 100);
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'emt-e2e-'));
const server = spawn('node', ['--disable-warning=ExperimentalWarning', 'server/src/index.js'], { cwd: root, env: { ...process.env, PORT: String(PORT), DATA_DIR: data, APP_BASE_URL: `http://localhost:${PORT}`, EMT_DISABLE_RATE_LIMIT: '1', EMT_NO_JOBS: '1', DEMO_MODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; server.stdout.on('data', (d) => { log += d; }); server.stderr.on('data', (d) => { log += d; });
const base = `http://localhost:${PORT}`;
for (let i = 0; i < 80; i++) { try { const r = await fetch(`${base}/api/public/health`); if (r.ok) break; } catch { /* waiting */ } await new Promise((r) => setTimeout(r, 500)); }

const exe = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers') ? fs.readdirSync('/opt/pw-browsers').filter((d) => d.startsWith('chromium')).map((d) => { const p = path.join('/opt/pw-browsers', d, 'chrome-linux', 'chrome'); return fs.existsSync(p) ? p : null; }).find(Boolean) : undefined);
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const failures = []; let shots = 0;

async function session(email, steps, { mobile = false, lang } = {}) {
  const ctx = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1360, height: 900 }, locale: lang === 'ar' ? 'ar-AE' : 'en-GB' });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource.*(401|403|404|409|422)/.test(m.text() + m.location().url)) failures.push(`[${email || 'anon'}] console: ${m.text()}`); });
  page.on('pageerror', (e) => failures.push(`[${email || 'anon'}] pageerror: ${e.message}`));
  if (email) { await page.goto(`${base}/login`); await page.fill('input[type=email]', email); await page.fill('input[type=password]', 'Demo@12345'); await page.click('button:has-text("Sign in")'); await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 }); }
  for (const [name, url, expects, fn] of steps) {
    try {
      await page.goto(`${base}${url}`, { waitUntil: 'networkidle' });
      for (const e of expects || []) await page.getByText(e, { exact: false }).first().waitFor({ timeout: 8000 });
      if (fn) await fn(page);
      await page.screenshot({ path: path.join(out, `${String(++shots).padStart(2, '0')}-${name}.png`), fullPage: false });
    } catch (e) { failures.push(`[${email || 'anon'}] ${name} (${url}): ${e.message.split('\n')[0]}`); await page.screenshot({ path: path.join(out, `FAIL-${name}.png`) }).catch(() => {}); }
  }
  await ctx.close();
}

await session(null, [['home', '/', ['Clear requirements']], ['services', '/services', ['Service catalogue']], ['service-detail', '/services/educational-attestation', ['Indicative cost']], ['calculator', '/calculator', ['ESTIMATE']], ['requirements', '/requirements', ['Requirements & routes']], ['business', '/business', ['Business workspace']], ['whatsapp', '/whatsapp-demo', ['WhatsApp assistant']], ['demo', '/demo', ['Demo personas']]]);
await session(null, [['home-ar', '/', ['متطلبات واضحة']]], { lang: 'ar' });
await session('sara@emirattest.example', [['cust-dash', '/app', ['Hello, Sara']], ['cust-requests', '/app/requests', ['My requests']], ['cust-new', '/app/new?service=personal-attestation', ['What do you need']], ['cust-family', '/app/family', ['Family workspace']], ['cust-docs', '/app/documents', ['readiness records']], ['cust-planner', '/app/planner', ['planner']], ['cust-bookings', '/app/bookings', ['Travel']], ['cust-settings', '/app/settings', ['Your choices']]]);
await session('noor@emirattest.example', [['org-overview', '/app/business/1', ['Gulf Talent Solutions']], ['org-bulk', '/app/business/1/bulk', ['CSV intake']], ['org-employees', '/app/business/1/employees', ['readiness']], ['org-purchasing', '/app/business/1/purchasing', ['Cost centres']], ['org-billing', '/app/business/1/billing', ['Invoices']], ['org-integrations', '/app/business/1/integrations', ['API keys']]]);
await session('ops@emirattest.example', [['ops-dash', '/ops', ['Operations overview']], ['ops-cases', '/ops/cases', ['Case queue']], ['ops-network', '/ops/network', ['Field network']], ['ops-registry', '/ops/registry', ['Requirements & fee registry']], ['ops-providers', '/ops/providers', ['Providers & partners']], ['ops-support', '/ops/support', ['Support & communications']]]);
await session('finance@emirattest.example', [['fin', '/ops/finance', ['Finance', 'Completed revenue']]]);
await session('admin@emirattest.example', [['admin-users', '/ops/admin', ['Users & organisations']], ['admin-audit', '/ops/audit', ['Chain verified']], ['admin-settings', '/ops/settings', ['Integration status']]]);
await session('provider.capital@emirattest.example', [['prov-home', '/provider', ['Assignments']], ['prov-profile', '/provider/profile', ['Profile']], ['prov-settle', '/provider/settlements', ['Settlements']]]);
await session('agent@emirattest.example', [['agent-home', '/agent', ['Covering']]], { mobile: true });
await session('sara@emirattest.example', [['cust-mobile', '/app', ['Hello, Sara']]], { mobile: true });

// ---- deeper flows ----
const click = (sel) => async (p) => { await p.click(sel); await p.waitForLoadState('networkidle'); };
await session('sara@emirattest.example', [
  ['cust-case', '/app/requests', ['My requests'], async (p) => { await p.click('tr.click >> nth=0'); await p.getByText('NEXT ACTION').waitFor(); await p.waitForTimeout(300); }],
  ['cust-case-docs', '/app/requests', ['My requests'], async (p) => { await p.getByText('Educational certificate attestation').first().click(); await p.getByRole('tab', { name: /Documents/ }).click(); await p.getByText('blocking issue').first().waitFor(); }],
  ['cust-case-quote', '/app/requests', ['My requests'], async (p) => { await p.getByText('Family residency services').first().click(); await p.getByRole('tab', { name: /Quotes/ }).click(); await p.getByText('Approve & pay by card').waitFor(); }],
  ['cust-new-flow', '/app/new?service=personal-attestation', ['What do you need'], async (p) => { await p.click('button:has-text("Continue")'); await p.selectOption('select >> nth=0', { index: 1 }); await p.selectOption('select >> nth=1', { label: 'India' }); await p.click('button:has-text("See the estimate")'); await p.getByText('ESTIMATE').first().waitFor(); }],
]);
await session('ops@emirattest.example', [
  ['ops-case', '/ops/cases', ['Case queue'], async (p) => { await p.click('tr.click >> nth=0'); await p.getByText('NEXT ACTION').waitFor(); }],
  ['ops-case-actions', '/ops/cases', ['Case queue'], async (p) => { await p.click('tr.click >> nth=0'); await p.getByRole('tab', { name: 'Actions' }).click(); await p.getByText('Move case').waitFor(); }],
  ['ops-case-quote', '/ops/cases', ['Case queue'], async (p) => { await p.click('tr.click >> nth=0'); await p.getByRole('tab', { name: 'Quotation' }).click(); await p.getByText('New variation').waitFor(); }],
]);
await session('agent@emirattest.example', [['agent-task', '/agent', ['Covering'], async (p) => { await p.click('.card.link >> nth=0'); await p.getByText('Record custody event').waitFor(); }]], { mobile: true });
await session('provider.capital@emirattest.example', [['prov-case', '/provider', ['Assignments'], async (p) => { await p.click('tr.click >> nth=0'); await p.getByText('Route stages').waitFor(); }]]);
await session('finance@emirattest.example', [['fin-refunds', '/ops/finance', ['Finance'], async (p) => { await p.getByRole('tab', { name: /Refunds/ }).click(); await p.getByText('two different finance approvers').waitFor(); }], ['fin-forecast', '/ops/finance', ['Finance'], async (p) => { await p.getByRole('tab', { name: /13-week/ }).click(); await p.getByText('Minimum balance').waitFor(); }]]);
await session(null, [['wa-flow', '/whatsapp-demo', ['WhatsApp assistant'], async (p) => { await p.click('.quick button:has-text("menu")'); await p.getByText('Check requirements for a document').waitFor(); await p.click('.quick button:has-text("3")'); await p.getByText(/EMT-\d\d-\d{6}/).first().waitFor(); }],
  ['pay-demo', '/track', ['Track your case']]]);
await browser.close(); server.kill();
fs.rmSync(data, { recursive: true, force: true });
if (failures.length) { console.error(`\nE2E FAILURES (${failures.length}):\n - ${failures.join('\n - ')}\n\nserver log tail:\n${log.slice(-800)}`); process.exit(1); }
console.log(`E2E OK — ${shots} screens captured in web/test-results/`);
