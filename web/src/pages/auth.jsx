import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, homeFor } from '../auth.jsx';
import { useI18n } from '../i18n.jsx';
import { useApi, Card, Field, Input, Btn, Alert, Loading, Badge, useAction, Icon } from '../ui.jsx';
import { post, isNative, API_BASE } from '../api.js';

export function Login() {
  const { t } = useI18n(); const { login } = useAuth(); const nav = useNavigate(); const loc = useLocation();
  const [f, setF] = useState({ email: '', password: '', otp: '' }); const [mfa, setMfa] = useState(false); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const go = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { const r = await login(f.email, f.password, f.otp || undefined); if (r.mfa) { setMfa(true); } else nav(loc.state?.from || homeFor(r.user), { replace: true }); }
    catch (er) { setErr(er.message); } finally { setBusy(false); }
  };
  return <div className="wrap section" style={{ maxWidth: 460 }}><h1>{t('login_title')}</h1>
    <Card><form onSubmit={go}>{err && <Alert kind="bad">{err}</Alert>}
      <Field label={t('email')}><Input type="email" autoComplete="username" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></Field>
      <Field label={t('password')}><Input type="password" autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required /></Field>
      {mfa && <Field label="Authentication code" hint="6-digit code from your authenticator app"><Input inputMode="numeric" value={f.otp} onChange={(e) => setF({ ...f, otp: e.target.value })} autoFocus /></Field>}
      {isNative() && <details className="small mb"><summary>Server</summary><Field label="API server URL" hint="The Emirattest server this app connects to"><Input defaultValue={API_BASE()} placeholder="https://your-emirattest-host" onChange={(e) => { try { localStorage.setItem('emt_api_base', e.target.value.trim()); } catch { /* ignore */ } }} /></Field></details>}
      <Btn disabled={busy} style={{ width: '100%' }}>{t('signin')}</Btn></form>
      <p className="small mt">No account? <Link to="/register">{t('signup')}</Link> · <Link to="/demo">Demo personas</Link></p>
      <p className="tiny muted">We never ask for your password or UAE Pass one-time codes by chat, email or phone.</p></Card></div>;
}

export function Register() {
  const { t, lang } = useI18n(); const { register } = useAuth(); const nav = useNavigate();
  const [f, setF] = useState({ name: '', email: '', phone: '', password: '' }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const go = async (e) => { e.preventDefault(); setBusy(true); setErr(''); try { await register({ ...f, lang }); nav('/app'); } catch (er) { setErr(er.message); } finally { setBusy(false); } };
  return <div className="wrap section" style={{ maxWidth: 480 }}><h1>{t('register_title')}</h1><Card><form onSubmit={go}>{err && <Alert kind="bad">{err}</Alert>}
    <Field label={t('name')}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
    <Field label={t('email')}><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></Field>
    <Field label={t('phone')} hint="Used to recognise you on WhatsApp. Optional."><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="+971 5x xxx xxxx" /></Field>
    <Field label={t('password')} hint="At least 10 characters with letters and numbers"><Input type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required /></Field>
    <Btn disabled={busy} style={{ width: '100%' }}>{t('signup')}</Btn></form><p className="small mt">Already registered? <Link to="/login">{t('signin')}</Link></p></Card></div>;
}

export function Demo() {
  const { t } = useI18n(); const { login } = useAuth(); const nav = useNavigate(); const r = useApi('/api/auth/demo-personas'); const [run, busy] = useAction();
  const go = (email) => run(async () => { const x = await login(email, r.data.password); nav(homeFor(x.user)); });
  const groups = [['Customers & families', ['customer']], ['Organisations', ['customer']], ['Operations & finance', ['admin', 'ops', 'support', 'finance']], ['Providers & field network', ['provider', 'agent']]];
  const list = r.data?.personas || [];
  const roleOf = (p) => (['admin', 'ops', 'support', 'finance'].includes(p.role) ? 1 : ['provider', 'agent'].includes(p.role) ? 2 : /Employer|Typing|sub-agent|organisation/i.test(p.demo_label) ? 3 : 0);
  const sections = [['Consumers & families', 0], ['Organisations (business workspace)', 3], ['Operations, support & finance', 1], ['Provider & field network', 2]];
  return <div className="wrap section"><h1>{t('demo_title')}</h1><p className="sub muted">{t('demo_lead')} Password for every persona: <span className="code">{r.data?.password}</span></p><Loading state={r} />
    {sections.map(([title, k]) => <div key={title} className="mb"><h3>{title}</h3><div className="grid g3">{list.filter((p) => roleOf(p) === k).map((p) => <Card key={p.email} className="link" style={{ cursor: 'pointer' }} onClick={() => !busy && go(p.email)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && go(p.email)}><div className="row between"><b>{p.name}</b><Badge>{p.role}</Badge></div><p className="small muted mt">{p.demo_label}</p><div className="tiny code">{p.email}</div></Card>)}</div></div>)}
    <Alert kind="info">Try the WhatsApp assistant as <b>Sara</b> (+971 50 123 4567) or <b>منى</b> (+971 50 345 6789) on the <Link to="/whatsapp-demo">WhatsApp demo</Link>.</Alert></div>;
}

export function Pay() {
  const { token } = (window.location.pathname.match(/\/pay\/(.+)$/) && { token: window.location.pathname.split('/pay/')[1] }) || {};
  const p = useApi(`/api/payments/${token}`); const [card, setCard] = useState('4242 4242 4242 4242'); const [res, setRes] = useState(null); const [run, busy] = useAction();
  const pay = (e) => { e.preventDefault(); run(async () => { try { setRes(await post(`/api/payments/${token}/charge`, { card })); } catch (er) { setRes({ status: 'failed', error: er.message }); } }, { quiet: true }); };
  if (p.loading || p.error) return <div className="wrap section"><Loading state={p} /></div>;
  const d = p.data;
  return <div className="wrap section" style={{ maxWidth: 520 }}><img src="/brand/primary-full-color.svg" alt="Emirattest" style={{ height: 52, marginBottom: 20 }} /><h1>Secure payment</h1>
    <Card><KVPay d={d} />
      {(res?.status === 'verified' || d.status === 'verified') ? <><Alert kind="good"><b>Payment verified.</b> Receipt {res?.receipt_no || d.receipt_no}. Your case advances once the server has verified the payment.</Alert><Btn to="/app">Back to my workspace</Btn></> :
        d.provider === 'mock' ? <form onSubmit={pay}><Alert kind="warn">Demo gateway — no real money moves. Use test card 4242 4242 4242 4242 (success) or 4000 0000 0000 0002 (declined).</Alert>{res?.status === 'failed' && <Alert kind="bad">{res.error}</Alert>}<Field label="Card number"><Input value={card} onChange={(e) => setCard(e.target.value)} inputMode="numeric" /></Field><div className="grid g2"><Field label="Expiry"><Input defaultValue="12/30" /></Field><Field label="CVC"><Input defaultValue="123" /></Field></div><Btn disabled={busy} style={{ width: '100%' }}>Pay AED {d.amount}</Btn></form> :
        <Alert kind="info">This payment uses an external checkout (Stripe test mode). Return to your case and choose “Pay”.</Alert>}</Card></div>;
}
const KVPay = ({ d }) => <div className="row between mb"><div><div className="muted small">{d.ref}</div><b>{d.title}</b></div><div style={{ fontSize: '1.6rem', fontWeight: 700 }}>AED {d.amount}</div></div>;

export function Invite() {
  const token = window.location.pathname.split('/invite/')[1]; const r = useApi(`/api/invites/${token}`); const [done, setDone] = useState(null); const [file, setFile] = useState(null); const [kind, setKind] = useState('passport'); const [run, busy] = useAction();
  const consent = (agree) => run(async () => { const x = await post(`/api/invites/${token}/consent`, { agree }); setDone(x.status); r.reload(); });
  const upload = () => run(async () => { const buf = await file.arrayBuffer(); const x = await fetch(`/api/invites/${token}/documents?kind=${kind}&filename=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: buf }); if (!x.ok) throw new Error((await x.json()).error); setFile(null); }, { ok: 'Uploaded and scanned' });
  if (r.loading || r.error) return <div className="wrap section"><Loading state={r} /></div>;
  const d = r.data;
  return <div className="wrap section" style={{ maxWidth: 640 }}><h1>{d.org} invited you</h1><p className="muted">Hello {d.name}. Your employer asked you to prepare documents for UAE employment and residency coordination.</p>
    <Card><h3>What you agree to</h3><ul>{d.purposes.map((x) => <li key={x}>{x}</li>)}</ul><h4>What never happens</h4><ul>{d.never.map((x) => <li key={x}>{x}</li>)}</ul>
      {d.status === 'invited' ? <div className="row"><Btn onClick={() => consent(true)} disabled={busy}>I agree</Btn><Btn kind="ghost" onClick={() => consent(false)} disabled={busy}>Decline</Btn></div> : d.status === 'consented' ? <><Alert kind="good">Consent recorded. Upload your documents below.</Alert><div className="row"><Select value={kind} onChange={(e) => setKind(e.target.value)} style={{ maxWidth: 220 }}>{['passport', 'photo', 'degree', 'offer_letter', 'other'].map((k) => <option key={k}>{k}</option>)}</Select><input type="file" onChange={(e) => setFile(e.target.files[0])} accept=".pdf,.png,.jpg,.jpeg,.webp" /><Btn onClick={upload} disabled={!file || busy}>Upload</Btn></div></> : <Alert kind="warn">You declined. No documents will be collected.</Alert>}{done && <p className="small muted">Status: {done}</p>}</Card></div>;
}

export function WhatsAppDemo() {
  const { lang } = useI18n(); const cfg = useApi('/api/public/config'); const demo = useApi('/api/auth/demo-personas');
  const [phone, setPhone] = useState('+971501234567'); const [msgs, setMsgs] = useState([]); const [text, setText] = useState(''); const [busy, setBusy] = useState(false);
  const [handoff, setHandoff] = useState(false);
  const load = async (ph) => { try { const r = await fetch(`/api/whatsapp/simulate/${encodeURIComponent(ph)}`); const j = await r.json(); setMsgs((j.messages || []).map((m) => ({ dir: m.direction, text: m.body }))); setHandoff(!!j.handoff); } catch { /* ignore */ } };
  useEffect(() => { load('+971501234567'); }, []);
  const send = async (t, media) => {
    if (!t && !media) return; setBusy(true); setMsgs((m) => [...m, { dir: 'in', text: media ? `📎 ${media.filename}` : t }]); setText('');
    try { const r = await post('/api/whatsapp/simulate', { phone, name: 'Demo user', text: t || '', media }); setMsgs((m) => [...m, ...r.replies.map((x) => ({ dir: 'out', text: x }))]); setHandoff(r.handoff); }
    catch (e) { setMsgs((m) => [...m, { dir: 'out', text: `⚠️ ${e.message}` }]); } finally { setBusy(false); }
  };
  const attach = (e) => { const f = e.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => send('', { filename: f.name, mime: f.type, base64: String(rd.result).split(',')[1] }); rd.readAsDataURL(f); e.target.value = ''; };
  const quick = ['menu', '1', '2', '3', '5', '6', '7', 'How long does attestation take?'];
  const personas = (demo.data?.personas || []).filter((p) => p.role === 'customer');
  const sw = (ph) => { setPhone(ph); setMsgs([]); load(ph); };
  return <div className="wrap section"><h1>WhatsApp assistant</h1><p className="sub muted">The same conversation engine serves the live WhatsApp Business webhook (Meta Cloud API or Twilio). This simulator lets you try it now — switch the sender number to see how the bot recognises a linked customer, or try an unknown number.</p>
    <div className="grid g2" style={{ gridTemplateColumns: '360px 1fr', alignItems: 'start' }}>
      <div><div className="phone"><div className="wa-head"><img src="/icons/icon-192.png" alt="" /><div><b>Emirattest</b><div className="tiny">Business account · {handoff ? 'with a person' : 'assistant'}</div></div></div>
        <div className="wa-body">{msgs.length === 0 && <div className="wa-msg out">Say <b>hi</b> or <b>menu</b> to start. / اكتب <b>مرحبا</b> للبدء.</div>}{msgs.map((m, i) => <div key={i} className={`wa-msg ${m.dir}`}>{m.text}</div>)}{busy && <div className="wa-msg out">…</div>}</div>
        <div className="quick">{quick.map((q) => <button key={q} onClick={() => send(q)}>{q}</button>)}</div>
        <form className="wa-in" onSubmit={(e) => { e.preventDefault(); send(text); }}><label className="btn sm ghost" style={{ cursor: 'pointer' }} title="Attach document">📎<input type="file" hidden onChange={attach} /></label><input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message" aria-label="Message" /><button className="btn sm">➤</button></form></div></div>
      <div className="col"><Card><h3>Sender</h3><Field label="WhatsApp number"><Input value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={() => sw(phone)} /></Field><div className="row">{personas.map((p) => <button key={p.email} className="btn sm ghost" onClick={() => sw({ 'sara@emirattest.example': '+971501234567', 'rahul@emirattest.example': '+971502345678', 'mona@emirattest.example': '+971503456789' }[p.email] || phone)}>{p.name.split(' ')[0]}</button>).filter((_, i) => i < 3)}<button className="btn sm ghost" onClick={() => sw('+971555000111')}>Unknown number</button></div></Card>
        <Card><h3>What the bot does</h3><ul className="small"><li>Requirements per document, destination and apostille route, with sources and review date</li><li>Itemised fee estimates with VAT and an explicit disclaimer</li><li>Case tracking — only for the number linked to the customer account</li><li>Quote approval (<span className="code">APPROVE EMT-26-000123</span>) returning a secure payment link</li><li>Document upload to a case: virus scan, format check, receipt — no authenticity claim</li><li>Pickup requests, human handoff with full context, Arabic & English</li><li>Never asks for passwords or UAE Pass one-time codes</li></ul></Card>
        <Card className="tint"><h3>Go live</h3><p className="small">Webhook URLs: <span className="code">/api/whatsapp/webhook</span> (Meta Cloud API — free test number) and <span className="code">/api/whatsapp/twilio</span> (Twilio sandbox). Mode now: <b>{cfg.data?.integrations?.whatsapp || '…'}</b>. See docs/WHATSAPP.md.</p></Card></div></div></div>;
}
