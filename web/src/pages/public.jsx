import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate, useParams, useSearchParams, useLocation } from 'react-router-dom';
import { api, get, post, money, fdate } from '../api.js';
import { useAuth, homeFor } from '../auth.jsx';
import { useI18n } from '../i18n.jsx';
import { Icon, useApi, Loading, Card, Badge, Btn, Field, Input, Select, Alert, Spinner, Empty, useAction, useToast, KV, Money, StatusBadge, qs } from '../ui.jsx';

const WA_NUMBER = '971500000000';

export function PublicLayout() {
  const { t, lang, setLang } = useI18n();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [chat, setChat] = useState(false);
  const cfg = useApi('/api/public/config');
  const loc = useLocation();
  useEffect(() => { setOpen(false); window.scrollTo(0, 0); }, [loc.pathname]);
  const link = (to, k) => <NavLink to={to} className={({ isActive }) => (isActive ? 'active' : '')}>{t(k)}</NavLink>;
  return (
    <>
      {cfg.data?.demo_mode && <div className="demo-banner">DEMONSTRATION ENVIRONMENT — fictional data. <Link to="/demo">Open demo personas</Link> · <Link to="/investors">Investor overview</Link></div>}
      <header className="topbar"><div className="wrap inner">
        <Link to="/" className="logo" aria-label="Emirattest home"><img src="/brand/primary-full-color.svg" alt="Emirattest — Documents cleared. Life moves." /></Link>
        <nav className={open ? 'open' : ''} aria-label="Main">{link('/services', 'nav_services')}{link('/calculator', 'nav_calc')}{link('/requirements', 'nav_req')}{link('/business', 'nav_business')}{link('/track', 'nav_track')}{link('/trust', 'nav_trust')}{link('/investors', 'nav_investors')}</nav>
        <div className="row" style={{ marginInlineStart: 'auto', flexWrap: 'nowrap' }}>
          <button className="btn ghost sm" onClick={() => setLang(lang === 'en' ? 'ar' : 'en')} aria-label="Switch language">{lang === 'en' ? 'العربية' : 'English'}</button>
          {user ? <><Btn to={homeFor(user)} size="sm">{t('my_app')}</Btn><button className="btn ghost sm" onClick={logout}>{t('signout')}</button></> : <><Btn to="/login" kind="ghost" size="sm">{t('signin')}</Btn><Btn to="/register" size="sm">{t('signup')}</Btn></>}
          <button className="btn ghost sm burger" onClick={() => setOpen(!open)} aria-label="Menu"><Icon name={open ? 'x' : 'menu'} size={18} /></button>
        </div>
      </div><div className="ribbon" /></header>
      <main><Outlet /></main>
      <Footer />
      <div className="float-actions print-hide">
        <Link to="/whatsapp-demo" className="fab wa" aria-label={t('open_whatsapp')} title={t('open_whatsapp')}><Icon name="wa" /></Link>
        <button className="fab ai" onClick={() => setChat(!chat)} aria-label={t('ask_ai')} title={t('ask_ai')}><Icon name="chat" /></button>
      </div>
      {chat && <AssistantChat onClose={() => setChat(false)} />}
    </>
  );
}

function Footer() {
  const { t } = useI18n();
  return <footer className="footer"><div className="wrap">
    <div className="grid g4"><div><img src="/brand/primary-on-dark.svg" alt="Emirattest" style={{ height: 44 }} /><p className="small mt">{t('tagline')}</p></div>
      <div><h4>Services</h4><div className="col gap-s small"><Link to="/services?category=attestation">Attestation & translation</Link><Link to="/services?category=pro">PRO & residency</Link><Link to="/services?category=travel">Travel & insurance</Link><Link to="/services?category=logistics">Document logistics</Link></div></div>
      <div><h4>Company</h4><div className="col gap-s small"><Link to="/trust">Trust & privacy</Link><Link to="/business">For business</Link><Link to="/investors">Investor overview</Link><Link to="/legal/terms">Terms (draft)</Link><Link to="/legal/privacy">Privacy notice (draft)</Link></div></div>
      <div><h4>Contact</h4><div className="col gap-s small"><span>Mon–Fri 09:00–18:00 GST</span><Link to="/whatsapp-demo">WhatsApp assistant</Link><span>emirattest.com</span></div></div></div>
    <p className="small mt2">{t('footer_disclaimer')}</p></div></footer>;
}

function AssistantChat({ onClose }) {
  const { t, lang } = useI18n();
  const [msgs, setMsgs] = useState([{ who: 'bot', text: t('ai_hello') }]);
  const [q, setQ] = useState(''); const [busy, setBusy] = useState(false); const end = useRef();
  useEffect(() => end.current?.scrollIntoView({ behavior: 'smooth' }), [msgs]);
  const send = async (e) => {
    e.preventDefault(); const text = q.trim(); if (!text) return;
    setMsgs((m) => [...m, { who: 'me', text }]); setQ(''); setBusy(true);
    try { const r = await post('/api/public/assistant', { question: text, lang }); setMsgs((m) => [...m, { who: 'bot', text: r.answer, meta: r }]); }
    catch (err) { setMsgs((m) => [...m, { who: 'bot', text: err.message }]); } finally { setBusy(false); }
  };
  return <div className="chat" role="dialog" aria-label={t('ask_ai')}><header><b>{t('ask_ai')}</b><button className="btn sm ghost" style={{ color: '#fff', borderColor: 'rgba(255,255,255,.4)' }} onClick={onClose}>✕</button></header>
    <div className="msgs">{msgs.map((m, i) => <div key={i} className={`bubble ${m.who}`}>{m.text}{m.meta?.sources?.length > 0 && <div className="tiny muted mt">Sources: {m.meta.sources.map((s) => s.title).join(' · ')}</div>}{m.meta?.handoff && <div className="mt"><a href={`/whatsapp-demo`} className="tiny">Talk to a person →</a></div>}{m.meta?.disclaimer && <div className="tiny muted mt">{m.meta.disclaimer}</div>}</div>)}{busy && <div className="bubble bot"><Spinner /></div>}<div ref={end} /></div>
    <form onSubmit={send} className="row" style={{ padding: 10, flexWrap: 'nowrap' }}><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('type_here')} aria-label={t('type_here')} /><button className="btn" disabled={busy}>{t('send')}</button></form></div>;
}

export function Home() {
  const { t, pick, lang } = useI18n();
  const cats = useApi('/api/public/categories');
  const svcs = useApi('/api/public/services');
  const icons = { attestation: 'stamp', pro: 'id', mobility: 'globe', travel: 'plane', resident: 'home', logistics: 'truck', business: 'building' };
  return <>
    <section className="hero"><div className="wrap">
      <h1>{t('hero_title')}</h1><p className="lead">{t('hero_lead')}</p>
      <div className="pill-row"><Btn to="/requirements" size="lg">{t('cta_review')}</Btn><Btn to="/calculator" kind="secondary" size="lg">{t('cta_quote')}</Btn><Btn to="/track" kind="ghost" size="lg">{t('cta_track')}</Btn><Btn to="/whatsapp-demo" kind="ghost" size="lg">{t('cta_talk')}</Btn></div>
      <p className="small muted mt">{t('hero_foot')}</p>
    </div></section>
    <section className="section"><div className="wrap"><h2>{t('cats_title')}</h2><p className="sub">{t('cats_sub')}</p>
      <Loading state={cats} />
      <div className="grid g3">{cats.data?.categories.map((c) => { const n = svcs.data?.services.filter((s) => s.category === c.key) || []; return <Link key={c.key} to={`/services?category=${c.key}`} className="card link"><div className="icon-box"><Icon name={icons[c.key]} /></div><h3>{c[lang]}</h3><div className="small muted">{n.slice(0, 4).map((s) => pick(s, 'name')).join(' · ')}{n.length > 4 ? ` · +${n.length - 4}` : ''}</div></Link>; })}</div></div></section>
    <section className="section alt"><div className="wrap"><h2>{t('how_title')}</h2><div className="steps mt">{[1, 2, 3, 4].map((i) => <div key={i}><h4>{t(`how${i}`)}</h4><p className="small muted">{t(`how${i}d`)}</p></div>)}</div></div></section>
    <section className="section"><div className="wrap"><h2>{t('trust_title')}</h2><div className="grid g3 mt">{[1, 2, 3].map((i) => <Card key={i}><h3>{t(`trust${i}`)}</h3><p className="small muted">{t(`trust${i}d`)}</p></Card>)}</div></div></section>
    <section className="section alt"><div className="wrap"><div className="grid g2" style={{ alignItems: 'center' }}><div><h2>{t('biz_title')}</h2><p className="sub">{t('biz_lead')}</p><Btn to="/business">Explore the business workspace</Btn></div><Card className="tint"><h3>Business workspace — AED 299 / org / month</h3><ul className="small"><li>Roles: owner, submitter, approver, finance, HR, auditor</li><li>Bulk CSV intake with duplicate checks</li><li>Employee readiness board with consent</li><li>POs, budgets, credit limits, consolidated invoices</li><li>API keys, signed webhooks</li></ul></Card></div></div></section>
  </>;
}

export function Services() {
  const [sp, setSp] = useSearchParams();
  const category = sp.get('category') || ''; const [q, setQ] = useState('');
  const { lang, pick } = useI18n();
  const cats = useApi('/api/public/categories'); const svcs = useApi(`/api/public/services${qs({ category, q })}`, []);
  return <div className="wrap section"><h1>Service catalogue</h1><p className="sub muted">Every service belongs to the launch scope. The order engine confirms the authorised provider, supported jurisdiction and case eligibility for each request.</p>
    <div className="row mb"><button className={`btn sm ${!category ? '' : 'ghost'}`} onClick={() => setSp({})}>All</button>{cats.data?.categories.map((c) => <button key={c.key} className={`btn sm ${category === c.key ? '' : 'ghost'}`} onClick={() => setSp({ category: c.key })}>{c[lang]}</button>)}<input className="input" style={{ maxWidth: 260, marginInlineStart: 'auto' }} placeholder="Search services" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search services" /></div>
    <Loading state={svcs} />
    <div className="grid g3">{svcs.data?.services.map((s) => <Link key={s.slug} to={`/services/${s.slug}`} className="card link"><div className="row between"><div className="icon-box"><Icon name={s.icon} /></div><PriceTag s={s} /></div><h3>{pick(s, 'name')}</h3><p className="small muted">{pick(s, 'summary')}</p><div className="row gap-s">{s.regulated && <Badge kind="amber">Authorised partner required</Badge>}<Badge>{s.kind === 'info' ? 'Free guidance' : s.kind === 'booking' ? 'Booking' : s.kind === 'subscription' ? 'Subscription' : 'Managed case'}</Badge></div></Link>)}</div></div>;
}
const PriceTag = ({ s }) => s.pricing_basis === 'free' ? <Badge kind="green">Free</Badge> : s.pricing_basis === 'partner' ? <Badge>Partner terms</Badge> : s.pricing_basis === 'custom' ? <Badge>Custom</Badge> : s.pricing_basis === 'actual_plus_coordination' ? <Badge>Actual cost + coordination</Badge> : <Badge kind="blue">{s.pricing_basis === 'scoped' ? 'from ' : ''}{money(s.base_fee_aed)}</Badge>;

export function ServiceDetail() {
  const { slug } = useParams(); const nav = useNavigate(); const { user } = useAuth(); const { pick, lang } = useI18n();
  const r = useApi(`/api/public/services/${slug}`);
  if (r.loading || r.error) return <div className="wrap section"><Loading state={r} /></div>;
  const { service: s, route, estimate: e } = r.data;
  const start = () => nav(user ? `/app/new?service=${s.slug}` : `/login`, { state: { from: `/app/new?service=${s.slug}` } });
  return <div className="wrap section"><Link to="/services" className="small">← All services</Link>
    <div className="grid g2 mt" style={{ alignItems: 'start', gridTemplateColumns: '1.4fr 1fr' }}>
      <div><div className="icon-box"><Icon name={s.icon} /></div><h1>{pick(s, 'name')}</h1><p className="lead muted">{pick(s, 'summary')}</p>
        {s.eligibility_note && <Alert kind="warn">{s.eligibility_note}</Alert>}{s.regulated && <Alert kind="info">Delivered through an appropriately authorised arrangement. Full catalogue availability does not imply automatic approval of every applicant or route.</Alert>}
        <h3 className="mt2">What you will need</h3><ul>{s.requirements.map((x) => <li key={x}>{x}</li>)}</ul>
        {route && <><h3 className="mt2">Route on file</h3><Card className="flat"><div className="row between"><b>{route.title_en}</b><Badge kind={route.freshness.stale ? 'amber' : 'green'}>Reviewed {fdate(route.reviewed_on)} (v{route.version})</Badge></div><div className="stages mt">{route.stages.map((st) => <div key={st.id} className={`stage ${st.necessity === 'unnecessary_if_done' ? 'skip' : ''}`}><span className="n">{st.seq}</span><div><b>{lang === 'ar' && st.name_ar ? st.name_ar : st.name}</b><div className="tiny muted">{st.owner === 'authority' ? 'Authority estimate' : 'Partner estimate'}{st.necessity === 'conditional' ? ' · only if required' : ''}{st.necessity === 'unnecessary_if_done' ? ' · not required on this route' : ''}</div></div><span className="small muted">{st.max_days ? `${st.min_days}–${st.max_days} d` : '—'}</span></div>)}</div>
          <p className="tiny muted mt">Sources: {route.source_urls.length ? route.source_urls.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer">{new URL(u).hostname}</a>) : 'internal specialist guidance'} · No universal sequence is implied.</p></Card></>}
      </div>
      <div><Card><h3>{e ? 'Indicative cost (ESTIMATE)' : 'Pricing'}</h3>
        {e ? <><table><tbody>{e.lines.map((l) => <tr key={l.code}><td>{l.label}<div className="tiny muted">{l.basis}</div></td><td className="num"><Money v={l.amount} /></td></tr>)}<tr><td>VAT 5% on Emirattest fees</td><td className="num"><Money v={e.vat} /></td></tr><tr><td><b>Estimated total</b></td><td className="num"><b><Money v={e.total} /></b></td></tr></tbody></table><p className="tiny muted mt">1 document. A reviewed quotation confirms the final price. Authority and partner charges are actual costs, shown separately.</p></> : <p className="muted">{s.pricing_basis === 'free' ? 'This guidance is free.' : s.pricing_basis === 'custom' ? 'Contracted usage — contact our team.' : 'Priced per scope in an approved quotation.'}</p>}
        <div className="col mt">{s.kind === 'case' && <Btn onClick={start}>Start a request</Btn>}{s.kind === 'booking' && <Btn onClick={() => nav(user ? `/app/bookings?service=${s.slug}` : '/login', { state: { from: `/app/bookings?service=${s.slug}` } })}>Get supplier quotes</Btn>}{s.kind === 'subscription' && <Btn to="/business">See business plans</Btn>}<Btn kind="secondary" to={`/calculator?service=${s.slug}`}>Open fee calculator</Btn><Btn kind="ghost" to="/whatsapp-demo">Ask on WhatsApp</Btn></div></Card></div>
    </div></div>;
}

export function Calculator() {
  const { t, pick } = useI18n(); const [sp] = useSearchParams();
  const svcs = useApi('/api/public/services'); const cfg = useApi('/api/public/config');
  const [f, setF] = useState({ serviceSlug: sp.get('service') || 'educational-attestation', docCount: 1, pickupEmirate: '', deliveryEmirate: '', expedited: false, apostille: false, business: false });
  const [est, setEst] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { const body = { ...f, pickupEmirate: f.pickupEmirate || undefined, deliveryEmirate: f.deliveryEmirate || f.pickupEmirate || undefined }; post('/api/public/estimate', body).then((r) => { setEst(r.estimate); setErr(''); }).catch((e) => setErr(e.message)); }, [f]);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const priced = svcs.data?.services.filter((s) => s.kind === 'case' || s.kind === 'booking');
  return <div className="wrap section"><h1>{t('calc_title')}</h1><Alert kind="warn"><b>{t('estimate').toUpperCase()}.</b> {t('calc_note')}</Alert>
    <div className="grid g2" style={{ gridTemplateColumns: '1fr 1.2fr', alignItems: 'start' }}>
      <Card><Field label={t('service')}><Select value={f.serviceSlug} onChange={(e) => set('serviceSlug', e.target.value)}>{priced?.map((s) => <option key={s.slug} value={s.slug}>{pick(s, 'name')}</option>)}</Select></Field>
        <Field label={t('docs')}><Input type="number" min="1" max="50" value={f.docCount} onChange={(e) => set('docCount', Number(e.target.value))} /></Field>
        <div className="grid g2"><Field label={t('pickup')}><Select value={f.pickupEmirate} onChange={(e) => set('pickupEmirate', e.target.value)}><option value="">No pickup</option>{cfg.data?.emirates.map((x) => <option key={x}>{x}</option>)}</Select></Field><Field label="Return to"><Select value={f.deliveryEmirate} onChange={(e) => set('deliveryEmirate', e.target.value)}><option value="">Same as pickup</option>{cfg.data?.emirates.map((x) => <option key={x}>{x}</option>)}</Select></Field></div>
        <label className="check"><input type="checkbox" checked={f.expedited} onChange={(e) => set('expedited', e.target.checked)} /><span>{t('expedite')}<div className="hint">Prices extra coordination/transport effort. It does not guarantee an authority decision.</div></span></label>
        <label className="check"><input type="checkbox" checked={f.apostille} onChange={(e) => set('apostille', e.target.checked)} /><span>Receiving country accepts an apostille<div className="hint">Applies only where currently accepted; removes the embassy stage.</div></span></label>
        <label className="check"><input type="checkbox" checked={f.business} onChange={(e) => set('business', e.target.checked)} /><span>Business account (volume terms)</span></label></Card>
      <Card>{err && <Alert kind="bad">{err}</Alert>}{est ? <><div className="row between"><h3>{est.service.name_en}</h3><Badge kind="amber">ESTIMATE</Badge></div>
        <div className="tablewrap"><table><tbody>{est.lines.map((l) => <tr key={l.code}><td>{l.label}<div className="tiny muted">{l.party === 'emirattest' ? 'Emirattest fee' : l.party === 'authority' ? 'Authority (actual cost)' : l.party === 'courier' ? 'Courier (actual cost)' : 'Partner charge'} · {l.basis}</div></td><td className="num"><Money v={l.amount} /></td></tr>)}
          <tr><td>VAT {Math.round(0.05 * 100)}% on Emirattest fees</td><td className="num"><Money v={est.vat} /></td></tr><tr><td><b>{t('total')}</b></td><td className="num"><b><Money v={est.total} /></b></td></tr></tbody></table></div>
        {est.max_total_with_conditional > est.total && <p className="small muted mt">Up to <Money v={est.max_total_with_conditional} /> if conditional stages (for example embassy legalisation) apply to your route.</p>}
        {est.authority_estimate_days && <p className="small mt">Timing (authority/partner estimates, not a commitment): <b>{est.authority_estimate_days.min}–{est.authority_estimate_days.max} days</b></p>}
        {est.route && <p className="tiny muted">Route: {est.route.title_en} · v{est.route.version} · reviewed {fdate(est.route.reviewed_on)} by {est.route.reviewer}{est.route.stale ? ' · ⚠ registry due for review' : ''}</p>}
        <details className="small mt"><summary>Assumptions and exclusions</summary><ul>{[...est.assumptions, ...est.exclusions].map((a) => <li key={a}>{a}</li>)}</ul></details>
        <div className="row mt"><Btn to={`/services/${est.service.slug}`} kind="ghost">Service details</Btn><Btn to={`/app/new?service=${est.service.slug}`}>Start this request</Btn></div></> : <Spinner />}</Card>
    </div></div>;
}

export function Requirements() {
  const { lang } = useI18n(); const [q, setQ] = useState(''); const [cat, setCat] = useState('');
  const r = useApi(`/api/public/routes${qs({ q, category: cat })}`);
  return <div className="wrap section"><h1>Requirements & routes</h1><p className="sub muted">Free guidance from our maintained registry. Each route shows which stages are required, conditional or unnecessary, with sources and the date it was last reviewed. Official digital services are a legitimate option — use them directly where they suit you.</p>
    <div className="row mb"><input className="input" style={{ maxWidth: 320 }} placeholder="Search e.g. degree, marriage, invoice" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search routes" /><Select value={cat} onChange={(e) => setCat(e.target.value)} style={{ maxWidth: 220 }}><option value="">All document types</option>{['educational', 'personal', 'commercial', 'translation', 'recognition', 'pro'].map((c) => <option key={c} value={c}>{c}</option>)}</Select></div>
    <Loading state={r} /><div className="col">{r.data?.routes.map((rt) => <Card key={rt.slug}><div className="row between"><div><h3 style={{ marginBottom: 2 }}>{lang === 'ar' && rt.title_ar ? rt.title_ar : rt.title_en}</h3><div className="small muted">{rt.purpose} · issued: {rt.issuing_country} · use: {rt.use_destination}</div></div><div className="row"><Badge kind={rt.apostille_applicable ? 'blue' : ''}>{rt.apostille_applicable ? 'Apostille route' : 'Standard route'}</Badge><Badge kind={rt.freshness.stale ? 'amber' : 'green'}>{rt.freshness.stale ? `Due for review (${rt.freshness.age_days}d)` : `Reviewed ${fdate(rt.reviewed_on)}`}</Badge></div></div>
      <p className="small mt">{rt.summary}</p>
      <div className="grid g2"><div><h4>Stages</h4><div className="stages">{rt.stages.map((s) => <div key={s.id} className={`stage ${s.necessity === 'unnecessary_if_done' ? 'skip' : ''}`}><span className="n">{s.seq}</span><div><b>{lang === 'ar' && s.name_ar ? s.name_ar : s.name}</b><div className="tiny muted">{s.necessity.replace(/_/g, ' ')} · {s.owner}{s.note ? ` · ${s.note}` : ''}</div></div><span className="small muted">{s.max_days ? `${s.min_days}–${s.max_days}d` : ''}</span></div>)}</div></div>
        <div><h4>Checklist (free)</h4><ul>{rt.requirements.map((x) => <li key={x.id}>{x.label}</li>)}</ul><h4>Sources</h4><ul className="small">{rt.source_urls.length ? rt.source_urls.map((u) => <li key={u}><a href={u} target="_blank" rel="noreferrer">{u}</a></li>) : <li>Specialist guidance — no public source</li>}</ul><div className="row"><Btn to={`/calculator?service=${rt.doc_category === 'translation' ? 'legal-translation' : rt.doc_category === 'personal' ? 'personal-attestation' : rt.doc_category === 'commercial' ? 'commercial-attestation' : rt.doc_category === 'pro' ? 'document-clearing' : 'educational-attestation'}`} size="sm">Estimate cost</Btn></div></div></div></Card>)}</div></div>;
}

export function Business() {
  const nav = useNavigate();
  return <><section className="hero"><div className="wrap"><Badge kind="green">Business workspace</Badge><h1 className="mt">Document operations your team can audit.</h1><p className="lead">Typing centres, HR teams, agencies, SMEs and enterprises: bulk intake, role-based approvals, employee readiness with consent, purchase controls, consolidated billing and an API — in one organisation workspace.</p><div className="pill-row"><Btn to="/register" size="lg">Create an organisation account</Btn><Btn to="/demo" kind="secondary" size="lg">Try the employer demo</Btn></div></div></section>
    <section className="section"><div className="wrap"><div className="grid g3">{[['users', 'Roles & segregation', 'Owners manage memberships; submitters create requests; approvers authorise spending; finance sees billing; HR sees employee readiness; auditors get read-only evidence. A company email address alone confers no access.'], ['layers', 'Bulk case intake', 'CSV import with validation, multi-file upload, client references and duplicate checks. Bulk never bypasses consent, readiness review or price approval.'], ['check', 'Employee readiness', 'Invite employees by link; they consent per purpose and upload their own documents. HR sees missing items and blockers — never family files.'], ['coin', 'Purchasing controls', 'Approval limits, purchase orders, departments, budgets and cost centres. Credit limits with consolidated monthly invoices.'], ['shield', 'Agency protection', 'Client aliases, authorised branded requests and agreed non-solicitation terms protect your client relationships.'], ['server', 'Integrations', 'Scoped API keys, signed webhooks with retries and idempotent writes. Described as connected only once credentials and a tested interface exist.']].map(([i, h, p]) => <Card key={h}><div className="icon-box"><Icon name={i} /></div><h3>{h}</h3><p className="small muted">{p}</p></Card>)}</div></div></section>
    <section className="section alt"><div className="wrap"><h2>Pricing (planning policy, AED)</h2><div className="tablewrap mt"><table><thead><tr><th>Line</th><th>Basis</th><th className="num">Planning example</th></tr></thead><tbody><tr><td>Business document coordination</td><td>Per standard case under volume terms</td><td className="num">120</td></tr><tr><td>Business workspace</td><td>Monthly subscription plus case charges</td><td className="num">299 / organisation</td></tr><tr><td>Enterprise account</td><td>Contracted usage, integrations and account support</td><td className="num">Custom agreement</td></tr></tbody></table></div><p className="small muted mt">Excludes separately identified authority, supplier and courier charges and applicable taxes. Cancelling never removes access to purchased completion evidence.</p><Btn kind="secondary" onClick={() => nav('/investors')}>See the financial model</Btn></div></section></>;
}

export function TrackPublic() {
  const [f, setF] = useState({ ref: '', phoneLast4: '' }); const [res, setRes] = useState(null); const [err, setErr] = useState(''); const [run, busy] = useAction();
  const go = async (e) => { e.preventDefault(); setErr(''); setRes(null); const r = await run(() => post('/api/public/track', f), { quiet: true }).catch(() => null); if (r) setRes(r); else setErr('No matching case. Check the reference and last 4 phone digits, or sign in.'); };
  return <div className="wrap section" style={{ maxWidth: 640 }}><h1>Track your case</h1><p className="muted">Enter your case reference and the last four digits of your phone number. For full details — documents, custody, messages — sign in.</p>
    <Card><form onSubmit={go}><Field label="Case reference"><Input value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} placeholder="EMT-26-000123" required /></Field><Field label="Last 4 digits of phone"><Input value={f.phoneLast4} onChange={(e) => setF({ ...f, phoneLast4: e.target.value })} maxLength={4} required /></Field><Btn disabled={busy}>Check status</Btn></form></Card>
    {err && <Alert kind="bad">{err}</Alert>}
    {res && <Card className="mt"><div className="row between"><h3>{res.ref}</h3><StatusBadge status={res.status} label={res.status_label} /></div><KV items={[['Next action', res.next_action], ['Responsible', res.next_action_owner], ['Next update due', res.next_update_due], ['Target date', res.target_date], ['Timing outlook', res.plan_status?.replace('_', ' ')]]} /><p className="tiny muted mt">Public tracking shows status only. Never share your password or a UAE Pass one-time code with anyone.</p></Card>}</div>;
}

export function Trust() {
  return <div className="wrap section" style={{ maxWidth: 860 }}><h1>Trust, accountability & privacy</h1>
    {[['Who we are', 'Emirattest is an independent facilitator and service coordinator. Official attestations, immigration decisions, licences, insurance cover and banking decisions remain with the responsible authorities or authorised providers. We never use government symbols, endorsements or accreditations unless actually authorised.'], ['What you can rely on', 'Itemised approved prices; no hidden markup on authority and courier charges; variations only with your approval; visible refund reason, approval and expected processing window; a named route for resolving exceptions; evidence of every handover.'], ['What we will not do', 'Guarantee authority approvals, invent urgency, apply one generic chain to every document, treat a recognised stamp or QR code as proof of authenticity, alter an original official record to make it match, or ask for passwords or UAE Pass one-time codes.'], ['AI & automation', 'AI classifies documents provisionally, extracts fields for human confirmation, explains approved routes and drafts messages. Prices come from maintained data. Uncertain routes, important discrepancies, regulated advice and final quotations are handled by people or rules. Your data is not used for unrelated AI training.'], ['Your data', 'Storage, renewal reminders, partner referrals and marketing are separate choices. You can access, correct, export or request deletion (subject to lawful retention). Documents are stored privately with expiring links and access logs.'], ['Sponsored placement', 'Providers can pay for visibility. Sponsored cards are always labelled and never affect eligibility or ranking.']].map(([h, p]) => <Card key={h} className="mb"><h3>{h}</h3><p>{p}</p></Card>)}
    <Alert kind="warn">Licences, partner contracts and integrations are not asserted by this demonstration. Terms and privacy notices are drafts for legal review.</Alert></div>;
}

export function Legal() {
  const { doc } = useParams();
  return <div className="wrap section" style={{ maxWidth: 800 }}><Alert kind="warn">DRAFT for demonstration — requires review by a qualified UAE legal adviser before launch.</Alert><h1>{doc === 'privacy' ? 'Privacy notice' : 'Terms of service'}</h1>
    {doc === 'privacy' ? <><p>This draft describes the intended handling of personal data in line with the UAE personal data protection framework. Lawful basis, processors (cloud, AI, support and overseas providers), cross-border transfers and retention periods must be documented for the real arrangement.</p><ul><li>Purpose-specific consent for storage, reminders, referrals and marketing.</li><li>Rights of access, correction, export, sharing changes and deletion subject to lawful retention.</li><li>Guardian and delegated access verified before sharing.</li><li>Employers and agencies cannot use service access for unrelated surveillance or marketing.</li></ul></> : <><p>Draft terms covering scope, fees, quotations and variations, cancellation and refunds, complaints, limitation of liability, document custody and permitted use. Specialist advice is attributed to the qualified professional. Emirattest does not guarantee any authority decision.</p></>}</div>;
}
