import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Card, Field, Input, Btn, Alert, useAction } from '../ui.jsx';
import { post } from '../api.js';

export function ForgotPassword() {
  const [email, setEmail] = useState(''); const [done, setDone] = useState(false); const [err, setErr] = useState(''); const [run, busy] = useAction();
  const go = (e) => { e.preventDefault(); setErr(''); run(async () => { try { await post('/api/auth/forgot', { email }); setDone(true); } catch (er) { setErr(er.message); } }); };
  return <div className="wrap section" style={{ maxWidth: 460 }}><h1>Reset your password</h1><Card>
    {done ? <Alert kind="good">If an account exists for <b>{email}</b>, a reset link is on its way. It works once and expires in one hour.</Alert>
      : <form onSubmit={go}>{err && <Alert kind="bad">{err}</Alert>}<Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field><Btn disabled={busy} style={{ width: '100%' }}>Send reset link</Btn></form>}
    <p className="small mt"><Link to="/login">Back to sign in</Link></p></Card></div>;
}

export function ResetPassword() {
  const [q] = useSearchParams(); const nav = useNavigate(); const [pw, setPw] = useState(''); const [err, setErr] = useState(''); const [run, busy] = useAction();
  const go = (e) => { e.preventDefault(); setErr(''); run(async () => { try { await post('/api/auth/reset', { token: q.get('token'), password: pw }); nav('/login', { state: { reset: true } }); } catch (er) { setErr(er.message); } }); };
  return <div className="wrap section" style={{ maxWidth: 460 }}><h1>Choose a new password</h1><Card><form onSubmit={go}>{err && <Alert kind="bad">{err}</Alert>}
    <Field label="New password" hint="At least 10 characters with letters and numbers"><Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required autoFocus /></Field>
    <Btn disabled={busy} style={{ width: '100%' }}>Save password</Btn></form><p className="tiny muted mt">All devices are signed out when the password changes.</p></Card></div>;
}

export function VerifyEmail() {
  const [q] = useSearchParams(); const [state, setState] = useState('idle'); const [msg, setMsg] = useState('');
  const go = async () => { try { await post('/api/auth/verify', { token: q.get('token') }); setState('ok'); } catch (er) { setMsg(er.message); setState('bad'); } };
  return <div className="wrap section" style={{ maxWidth: 460 }}><h1>Confirm your email</h1><Card>
    {state === 'ok' ? <Alert kind="good">Email confirmed. Thank you.</Alert> : state === 'bad' ? <Alert kind="bad">{msg}</Alert> : <Btn onClick={go} style={{ width: '100%' }}>Confirm email address</Btn>}
    <p className="small mt"><Link to="/app">Go to your workspace</Link></p></Card></div>;
}
