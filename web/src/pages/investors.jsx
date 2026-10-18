import { useState } from 'react';
import { Link } from 'react-router-dom';
import { get, money } from '../api.js';
import { useApi, Loading, Card, Badge, Btn, Stat, Table, BarChart, Donut, Alert, Money, Icon } from '../ui.jsx';

// Plan traceability: business-plan section → what is implemented → honest status.
const TRACE = [
  ['§5 Attestation, translation & recognition', 'Route registry (9 versioned routes, stages, sources, review dates), apostille-vs-embassy logic, translation & recognition cases', 'live', '/requirements'],
  ['§6 Embassy network & logistics', 'Pickup/return tasks, custody events, authorised-recipient check, failed-attempt rescheduling, incidents, all 7 emirates coverage view', 'live', '/login?demo=agent'],
  ['§7 PRO, residency & company', 'Family residency, employment, Golden Visa (screening ≠ eligibility), document clearing, company setup as managed cases', 'live', '/services?category=pro'],
  ['§8 Outbound immigration & relocation', 'Free guidance, regulated specialist referral with disclosures, corporate relocation case', 'live', '/services?category=mobility'],
  ['§9 Travel, religious travel & insurance', 'Supplier bookings with terms, cancellation rules, commission separated from supplier amounts', 'sim', '/app/bookings'],
  ['§10 Resident setup', 'Bank, SIM/utility, resident bundle; reminders only with consent and real expiry dates', 'live', '/services?category=resident'],
  ['§11 Consumer app & AI', 'Responsive web + installable PWA + Android app; purpose-based intake, fee breakdown, secure uploads, case dashboard; AI assistant with guardrails', 'live', '/app'],
  ['§12 Readiness, family & deadlines', 'Readiness records, mismatch controls, family workspace with scoped/expiring grants, deadline planner, rule-change impact, rejection recovery, completion pack', 'live', '/login?demo=sara'],
  ['§13 Business & enterprise workspace', 'Org roles, bulk CSV intake, employee consent & readiness, POs/budgets/credit, consolidated invoices, reports & CSV exports, API keys & signed webhooks', 'live', '/login?demo=noor'],
  ['§14 Provider, agent & support', 'Provider portal, field-agent app with offline queue, support console, WhatsApp handoff, complaints, supplier escalation, partner transfer', 'live', '/login?demo=provider'],
  ['§15 Case operations & assurance', 'Full status lifecycle, quotation control with variations & emergency limits, SLA tracking (4 business hours / 1 business day), complaints & remedies', 'live', '/login?demo=ops'],
  ['§16–17 Pricing, payments & finance', 'Itemised pricing, VAT, ledger separating fees/pass-through/VAT/refunds, dual-approval refunds, bank reconciliation, 13-week cash forecast', 'sim', '/login?demo=finance'],
  ['§18 Technology & integrations', 'Identity/MFA, registry, case engine, document platform, AI service, integration gateway (idempotent API, signed webhooks)', 'live', '/login?demo=noor'],
  ['§19 Privacy, security & governance', 'Hash-chained audit log, access logs, expiring document links, malware/type checks, consent per purpose, DSR export/deletion request', 'live', '/login?demo=admin'],
  ['§20 Brand', 'Brand kit applied across web, email, PWA, Android, WhatsApp; Arabic/English with RTL', 'live', '/'],
  ['§21–23 Organisation, model & controls', 'Management dashboards, workload & aging, financial model & funding envelope below', 'live', '#model'],
];
const STATUS = { live: ['green', 'Working in demo'], sim: ['amber', 'Working; external provider simulated'], fund: ['blue', 'Needs funding / licence'] };

const FUNDED = [
  ['Production infrastructure', 'Managed Postgres, object storage, private networking, backups with tested restore (RPO 24h / RTO 8 business hours), multi-region failover design, staging environment, CI/CD with rollback.'],
  ['Security & compliance', 'Independent penetration test, secrets management, staff SSO + enforced MFA, DLP on document storage, data-protection impact assessment, UAE data-residency decisions, incident response runbooks.'],
  ['Licences & partner contracts', 'Authorised-delivery mapping per service; contracts with attestation processors, translators, couriers, insurers and travel operators; regulated partners for PRO, immigration, insurance and religious travel.'],
  ['Live payments', 'Production card acquiring and bank reconciliation, PCI scope review, merchant-of-record/tax treatment confirmed by a qualified adviser, finance controls audited.'],
  ['WhatsApp Business & messaging', 'Verified business number, approved message templates, opt-in management, Arabic template review, SMS/email deliverability (SPF/DKIM).'],
  ['Production AI', 'Document extraction evaluated on real (consented) samples, human-in-the-loop review tooling, prompt-injection testing, model cost controls, Arabic quality review.'],
  ['Native app release', 'Play Store listing, signed release builds, push notifications (FCM), biometric unlock, camera-based document capture with edge detection, iOS build.'],
  ['People & operations', 'Requirements desk, support and PRO desks, account managers, quality & compliance lead, field-agent network contracts.'],
];

export default function Investors() {
  const [mult, setMult] = useState(1);
  const model = useApi(`/api/public/investor/model?mult=${mult}`, [mult]);
  const plat = useApi('/api/public/investor/platform');
  const m = model.data; const p = plat.data;
  return <div>
    <section className="hero"><div className="wrap"><Badge kind="green">Investor overview · Business Plan v2.0 · 18 October 2026</Badge>
      <h1 className="mt">The operating system for document-led life events in the UAE.</h1>
      <p className="lead">Emirattest turns attestation, PRO, relocation and resident setup into one accountable workflow: clear routes, itemised approved prices, tracked custody and reusable family and employer records — across web, Android and WhatsApp.</p>
      <div className="pill-row"><Btn to="/demo" size="lg">Explore every role live</Btn><Btn to="/whatsapp-demo" kind="secondary" size="lg">Try the WhatsApp bot</Btn><a className="btn ghost lg" href="#model">Financial model</a><a className="btn ghost lg" href="#funding">What funding unlocks</a></div>
      <Alert kind="warn"><b>Transparency note.</b> This is a working product demonstration with fictional data. Payments, WhatsApp delivery, email and AI run in demonstration mode unless credentials are configured. No licence, partner contract, government integration or customer traction is claimed. See <span className="code">docs/REAL_VS_SIMULATED.md</span>.</Alert></div></section>

    <section className="section"><div className="wrap"><h2>The problem we solve</h2>
      <div className="grid g3 mt">{[['Opaque routes & prices', 'People face unclear chains, unexpected extra charges and no view of where their originals are.'], ['Fragmented records', 'Families and employers re-collect the same documents again and again; nothing links dependants, deadlines and permissions.'], ['Unaccountable fulfilment', 'Typing centres and agencies run on phone calls; custody, rejections and refunds lack evidence.']].map(([h, t]) => <Card key={h}><h3>{h}</h3><p className="small muted">{t}</p></Card>)}</div></div></section>

    <section className="section alt"><div className="wrap"><h2>Plan → product traceability</h2><p className="sub">Every section of the business plan maps to implemented, testable software. 23 automated tests cover isolation, money flow, custody, WhatsApp and registry behaviour.</p>
      <div className="tablewrap"><table><thead><tr><th>Business plan section</th><th>Implemented in this build</th><th>Status</th><th /></tr></thead><tbody>{TRACE.map(([s, d, st, to]) => <tr key={s}><td><b>{s}</b></td><td className="small">{d}</td><td><Badge kind={STATUS[st][0]}>{STATUS[st][1]}</Badge></td><td>{to.startsWith('#') ? <a href={to}>View</a> : <Link to={to.startsWith('/login') ? '/demo' : to}>Open</Link>}</td></tr>)}</tbody></table></div></div></section>

    <section className="section"><div className="wrap"><h2>Live platform snapshot</h2><p className="sub">{p?.label}</p><Loading state={plat} />
      {p && <><div className="grid g4"><Stat label="Services in catalogue" value={p.counts.services} /><Stat label="Versioned requirement routes" value={p.counts.routes} /><Stat label="Providers & partners" value={p.counts.providers} /><Stat label="Cases (demo)" value={p.counts.cases} /></div>
        <div className="grid g4 mt"><Stat label="Documents scanned & stored" value={p.counts.documents} /><Stat label="Custody events" value={p.counts.custody_events} /><Stat label="WhatsApp messages" value={p.counts.whatsapp_messages} /><Stat label="Hash-chained audit entries" value={p.counts.audit_entries} /></div>
        <div className="grid g2 mt"><Card><h3>Cases by status</h3><Donut parts={p.status_breakdown.slice(0, 7).map((s) => ({ label: s.label, value: s.n }))} /></Card>
          <Card><h3>Revenue separation (ledger)</h3><Table cols={[{ h: 'Measure', k: 'k' }, { h: 'AED', num: true, r: (r) => <Money v={r.v} /> }]} rows={[{ k: 'Recognised service fees (completed)', v: p.finance.completed_revenue }, { k: 'Deposits not yet earned', v: p.finance.deposits_deferred }, { k: 'Authority pass-through owed', v: p.finance.pass_through.authority_payable }, { k: 'Supplier amounts owed', v: p.finance.pass_through.supplier_payable }, { k: 'VAT payable', v: p.finance.vat_payable }, { k: 'Subscription MRR', v: p.finance.subscription_mrr }]} /><p className="tiny muted mt">Large customer payments are not automatically revenue — pass-through, VAT and deposits are separated.</p></Card></div></>}</div></section>

    <section className="section alt" id="model"><div className="wrap"><h2>Financial model (plan assumptions)</h2><p className="sub">Illustrative planning assumptions in AED from the business plan — not supplier quotations, licensing costs or established sales. Move the slider to change utilisation across the complete catalogue.</p>
      <Loading state={model} />
      {m && <><Card className="mb"><div className="row between"><b>Utilisation multiplier: {mult.toFixed(2)}×</b><div className="row">{[0.6, 1, 1.4].map((x) => <button key={x} className={`btn sm ${mult === x ? '' : 'ghost'}`} onClick={() => setMult(x)}>{x === 0.6 ? 'Lower 0.6×' : x === 1 ? 'Reference 1.0×' : 'Higher 1.4×'}</button>)}</div></div><input type="range" min="0.4" max="2" step="0.05" value={mult} onChange={(e) => setMult(Number(e.target.value))} style={{ width: '100%', accentColor: 'var(--green)' }} aria-label="Utilisation multiplier" /></Card>
        <div className="grid g4"><Stat label="Net retained revenue / month" value={money(m.net_retained_revenue)} /><Stat label="Variable cost" value={money(m.variable_cost)} /><Stat label="Contribution" value={money(m.contribution)} kind="good" /><Stat label="Operating result" value={money(m.operating_result)} kind={m.operating_result >= 0 ? 'good' : 'bad'} sub={`after ${money(m.fixed_overhead)} fixed overhead`} /></div>
        <div className="grid g2 mt"><Card><h3>Contribution by category</h3><Table cols={[{ h: 'Category', k: 'label' }, { h: 'Qty', num: true, r: (r) => Math.round(r.qty * 10) / 10 }, { h: 'Net fee', num: true, k: 'fee' }, { h: 'Var. cost', num: true, k: 'varCost' }, { h: 'Contribution', num: true, r: (r) => r.contribution.toLocaleString() }]} rows={m.rows} /></Card>
          <Card><h3>Revenue vs cost</h3><BarChart height={200} data={[{ label: 'Revenue', value: m.net_retained_revenue }, { label: 'Variable', value: m.variable_cost, color: 'var(--red)' }, { label: 'Fixed', value: m.fixed_overhead, color: '#b7791f' }, { label: 'Result', value: Math.max(m.operating_result, 0), color: '#1d5fa8' }]} fmt={(v) => `${Math.round(v / 1000)}k`} /><p className="small">Operating breakeven ≈ <b>{money(m.breakeven_revenue)}</b> net monthly retained revenue (≈ {m.breakeven_pct_of_reference_contribution}% of reference contribution). A mix-based illustration, not a universal case-count target.</p></Card></div>
        <div className="tablewrap mt"><table><thead><tr><th>Illustrative steady monthly scenario</th>{m.scenarios.map((s) => <th key={s.name} className="num">{s.name} ({s.multiplier}×)</th>)}</tr></thead><tbody>{[['Net retained revenue', 'revenue'], ['Variable cost', 'variable'], ['Contribution', 'contribution'], ['Fixed overhead', 'fixed'], ['Monthly operating result', 'result']].map(([l, k]) => <tr key={k}><td>{l}</td>{m.scenarios.map((s) => <td key={s.name} className="num" style={k === 'result' ? { fontWeight: 700, color: s[k] < 0 ? 'var(--red)' : 'var(--green)' } : undefined}>{s[k].toLocaleString()}</td>)}</tr>)}</tbody></table></div></>}</div></section>

    <section className="section" id="funding"><div className="wrap"><div className="grid g2" style={{ alignItems: 'start' }}><div><h2>Funding envelope</h2><p className="sub">An enterprise budgeting example from the plan — a planning envelope rather than a verified quote or minimum legal capital. Excludes amounts that must remain available for authorities and customer refunds.</p>
      {m && <Card><Donut size={170} parts={m.funding.map((f) => ({ label: `${f.label.split(',')[0]} — AED ${f.amount.toLocaleString()}`, value: f.amount }))} /><p className="mt"><b>Total: {money(m.funding_total)}</b></p></Card>}</div>
      <div><h2>What this build already proves</h2><ul><li>One case engine serving consumers, families, employers, agencies, providers, field agents and staff with server-enforced isolation.</li><li>Accountable money flow: estimate → reviewed quote → approved variation → verified payment → ledger → dual-approved refund.</li><li>WhatsApp, web and Android sharing the same records and rules.</li><li>Custody evidence with offline capture and idempotent sync.</li></ul><Btn to="/demo">Run the full demo</Btn></div></div>
      <h2 className="mt2">What funding unlocks (the “complete IT structure”)</h2><div className="grid g2 mt">{FUNDED.map(([h, t]) => <Card key={h}><div className="row between"><h3>{h}</h3><Badge kind="blue">Funded workstream</Badge></div><p className="small muted">{t}</p></Card>)}</div></div></section>

    <section className="section alt"><div className="wrap"><h2>Architecture</h2><Card><Architecture /></Card>
      <h2 className="mt2">Roadmap</h2><div className="grid g3 mt">{[['0–3 months', ['Production hosting & security baseline', 'Partner contracts (processors, couriers)', 'Live payments & WhatsApp Business verification', 'Requirements desk populates the registry']], ['3–6 months', ['Soft launch: consumer + typing-centre pilots', 'Play Store release, push notifications', 'Real-sample AI extraction evaluation', 'Support & finance operating cadence']], ['6–12 months', ['Enterprise integrations (HRIS, ERP)', 'Additional authorised partner categories', 'iOS app, deeper Arabic content', 'Quarterly controls & penetration retest']]].map(([h, items]) => <Card key={h}><h3>{h}</h3><ul className="small">{items.map((i) => <li key={i}>{i}</li>)}</ul></Card>)}</div>
      <Alert kind="info">Definition of completeness (plan §23): a service is presented as operational only with the appropriate actual delivery arrangement. This document sets the launch scope without claiming that an unimplemented feature or unauthorised integration is already live.</Alert></div></section></div>;
}

function Architecture() {
  const box = (x, y, w, h, t, sub, fill = '#e5f3ec') => <g><rect x={x} y={y} width={w} height={h} rx="8" fill={fill} stroke="#007A45" /><text x={x + w / 2} y={y + 20} textAnchor="middle" fontSize="12" fontWeight="700" fill="#151B18">{t}</text>{sub && <text x={x + w / 2} y={y + 36} textAnchor="middle" fontSize="9.5" fill="#58645E">{sub}</text>}</g>;
  return <svg viewBox="0 0 900 330" style={{ width: '100%' }} role="img" aria-label="System architecture">
    {box(10, 10, 200, 50, 'Web app / PWA', 'React · EN/AR · offline shell')}{box(230, 10, 200, 50, 'Android app', 'Capacitor shell · camera · APK via CI')}{box(450, 10, 200, 50, 'WhatsApp', 'Meta Cloud API · Twilio · simulator')}{box(670, 10, 220, 50, 'Enterprise API', 'API keys · idempotency · webhooks')}
    <path d="M110 60v28M330 60v28M550 60v28M780 60v28" stroke="#007A45" strokeWidth="2" /><rect x="10" y="88" width="880" height="34" rx="8" fill="#151B18" /><text x="450" y="110" textAnchor="middle" fill="#fff" fontSize="13" fontWeight="700">Express API · auth/MFA · role & record isolation · rate limits · audit chain</text>
    {box(10, 140, 135, 62, 'Case engine', 'lifecycle · tasks · SLA')}{box(155, 140, 135, 62, 'Fee engine', 'quotes · variations · VAT')}{box(300, 140, 135, 62, 'Requirements registry', 'versions · sources · impact')}{box(445, 140, 135, 62, 'Document platform', 'scan · versions · links')}{box(590, 140, 135, 62, 'Ledger & finance', 'pass-through · refunds')}{box(735, 140, 155, 62, 'Assistants', 'AI + KB · WhatsApp engine')}
    <path d="M450 202v28" stroke="#007A45" strokeWidth="2" />
    {box(10, 230, 280, 80, 'Data', 'SQLite (demo) → managed Postgres · private object storage', '#f2f7f4')}{box(310, 230, 280, 80, 'Integrations (env-configured)', 'Stripe · Resend · Meta/Twilio WhatsApp · Claude', '#f2f7f4')}{box(610, 230, 280, 80, 'Operations consoles', 'Support · ops · finance · provider · field agent', '#f2f7f4')}
  </svg>;
}
