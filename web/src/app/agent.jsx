import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, get, post, fdt, API_BASE } from '../api.js';
import { useApi, Loading, Card, Badge, Btn, Field, Input, Select, Textarea, Alert, Empty, PageHead, StatusBadge, useAction, useToast, Icon } from '../ui.jsx';

const QKEY = 'emt_agent_queue';
const readQ = () => { try { return JSON.parse(localStorage.getItem(QKEY) || '[]'); } catch { return []; } };
const writeQ = (q) => { try { localStorage.setItem(QKEY, JSON.stringify(q)); } catch { /* storage unavailable */ } };
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

/** Offline-first queue: events keep their capture time and sync later; duplicates are ignored server-side via client_event_id. */
export function useAgentQueue() {
  const [q, setQ] = useState(readQ); const [online, setOnline] = useState(navigator.onLine); const [syncing, setSyncing] = useState(false); const toast = useToast();
  const sync = useCallback(async () => {
    const cur = readQ(); if (!cur.length || !navigator.onLine) return;
    setSyncing(true);
    try {
      const r = await api('/api/agent/events', { method: 'POST', body: { events: cur } });
      const ok = new Set(r.results.filter((x) => x.ok).map((x) => x.client_event_id)); const rest = cur.filter((e) => !ok.has(e.client_event_id)); writeQ(rest); setQ(rest);
      if (ok.size) toast(`Synced ${ok.size} event(s)`, 'good'); if (rest.length) toast(`${rest.length} event(s) need attention: ${r.results.find((x) => !x.ok)?.error}`, 'bad');
    } catch { /* still offline */ } finally { setSyncing(false); }
  }, [toast]);
  useEffect(() => { const on = () => { setOnline(true); sync(); }; const off = () => setOnline(false); window.addEventListener('online', on); window.addEventListener('offline', off); sync(); return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); }; }, [sync]);
  const enqueue = async (evt) => {
    const e = { ...evt, client_event_id: uuid(), captured_at: new Date().toISOString(), offline: !navigator.onLine };
    if (navigator.onLine) {
      try { const r = await api('/api/agent/events', { method: 'POST', body: e }); if (r.results[0].ok) return { synced: true, id: r.results[0].id }; throw new Error(r.results[0].error); }
      catch (err) { if (err.status && err.status < 500) throw err; if (err.message && !/fetch|network|failed/i.test(err.message) && err.status !== undefined) throw err; e.offline = true; }
    }
    const nq = [...readQ(), e]; writeQ(nq); setQ(nq); return { synced: false };
  };
  return { queue: q, online, syncing, sync, enqueue };
}

export function AgentHome() {
  const r = useApi('/api/agent/tasks'); const nav = useNavigate(); const { queue, online, syncing, sync } = useAgentQueue();
  return <div style={{ maxWidth: 640 }}><PageHead title="My tasks" sub={r.data?.profile ? `Covering ${r.data.profile.emirates.join(', ')}` : ''}><Badge kind={online ? 'green' : 'amber'}>{online ? 'Online' : 'Offline mode'}</Badge></PageHead>
    {queue.length > 0 && <Alert kind="warn"><b>{queue.length} event(s) waiting to sync.</b> They keep their capture time and are never shown as live updates. <Btn size="sm" onClick={sync} disabled={!online || syncing}>{syncing ? 'Syncing…' : 'Sync now'}</Btn></Alert>}
    <Loading state={r} />{r.data?.tasks.length === 0 && <Card><Empty>No open tasks. Enjoy the quiet.</Empty></Card>}
    <div className="col">{r.data?.tasks.map((t) => <Card key={t.id} className="link" style={{ cursor: 'pointer' }} onClick={() => nav(`/agent/tasks/${t.id}`)}><div className="row between"><b>{t.title}</b><Badge kind={t.kind === 'pickup' ? 'blue' : t.kind === 'delivery' ? 'green' : ''}>{t.kind}</Badge></div><div className="small muted">{t.case_ref} · {t.case_title}</div><div className="row small mt"><Icon name="calendar" size={16} /> {fdt(t.scheduled_at || t.due_at)}{t.emirate && <Badge>{t.emirate}</Badge>}<Badge>{t.doc_count} doc(s)</Badge></div></Card>)}</div>
    {r.data?.recent.length > 0 && <><h3 className="mt2">Recently completed</h3>{r.data.recent.map((t) => <div key={t.id} className="small muted">✓ {t.title} · {t.case_ref}</div>)}</>}</div>;
}

export function AgentTask() {
  const { id } = useParams(); const r = useApi(`/api/agent/tasks/${id}`); const nav = useNavigate(); const toast = useToast(); const { enqueue, online } = useAgentQueue(); const [run, busy] = useAction();
  const [f, setF] = useState({ type: '', ack_name: '', ack_method: 'id_check_and_signature', location: '', item_summary: '', note: '', authority_ref: '' }); const [geo, setGeo] = useState(null); const [photo, setPhoto] = useState(null);
  useEffect(() => { navigator.geolocation?.getCurrentPosition((p) => setGeo({ lat: p.coords.latitude, lng: p.coords.longitude }), () => {}, { timeout: 4000 }); }, []);
  if (r.loading && !r.data) return <Loading state={r} />; if (r.error) return <Loading state={r} />;
  const t = r.data.task; const type = f.type || (t.kind === 'delivery' ? 'return' : t.kind === 'pickup' ? 'pickup' : 'submission');
  const submit = () => run(async () => {
    const out = await enqueue({ ...f, type, task_id: t.id, from_party: type === 'return' ? 'Emirattest agent' : f.ack_name, to_party: type === 'return' ? f.ack_name : 'Emirattest agent', lat: geo?.lat, lng: geo?.lng });
    if (out.synced && photo && out.id) { const buf = await photo.arrayBuffer(); await api(`/api/agent/events/${out.id}/photo?filename=${encodeURIComponent(photo.name)}`, { method: 'POST', raw: buf }); }
    toast(out.synced ? 'Recorded' : 'Saved offline — will sync automatically', out.synced ? 'good' : ''); nav('/agent');
  });
  const incident = () => run(async () => { await post('/api/agent/incidents', { task_id: t.id, type: 'lost_original', severity: 'high', detail: f.note || 'Escalated by field agent' }); toast('Incident opened — containment started', 'good'); });
  return <div style={{ maxWidth: 640 }}><PageHead title={t.title} sub={`${t.case_ref} · ${t.case_title}`}><Badge kind={online ? 'green' : 'amber'}>{online ? 'Online' : 'Offline'}</Badge></PageHead>
    <Card className="mb"><div className="row between"><b>When</b><span>{fdt(t.scheduled_at || t.due_at)}</span></div><div className="row between"><b>Where</b><span>{t.address || t.emirate || '—'}</span></div><div className="row between"><b>Documents</b><span>{t.doc_count}</span></div>
      {t.contact ? <Alert kind="good"><b>{t.contact.name}</b> · <a href={`tel:${t.contact.phone}`}>{t.contact.phone}</a><div className="tiny">{t.contact_note}</div></Alert> : <Alert kind="info">{t.contact_note}</Alert>}</Card>
    <Card><h3>Record custody event</h3><Field label="Event"><Select value={type} onChange={(e) => setF({ ...f, type: e.target.value })}>{['pickup', 'handover', 'submission', 'return', 'failed_attempt'].map((x) => <option key={x}>{x}</option>)}</Select></Field>
      <div className="grid g2"><Field label={type === 'return' ? 'Authorised recipient name' : 'Name of person handing over'}><Input value={f.ack_name} onChange={(e) => setF({ ...f, ack_name: e.target.value })} /></Field><Field label="Recipient check method"><Select value={f.ack_method} onChange={(e) => setF({ ...f, ack_method: e.target.value })}>{['id_check_and_signature', 'in_person', 'one_time_code', 'authority_receipt'].map((x) => <option key={x}>{x}</option>)}</Select></Field></div>
      {type === 'submission' && <Field label="Authority reference"><Input value={f.authority_ref} onChange={(e) => setF({ ...f, authority_ref: e.target.value })} /></Field>}
      <Field label="Location"><Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder={t.emirate || 'Where are you?'} /></Field>
      <Field label="Items / condition check"><Input value={f.item_summary} onChange={(e) => setF({ ...f, item_summary: e.target.value })} placeholder="e.g. 2 originals, sealed bag #4412, no damage" /></Field>
      <Field label={type === 'failed_attempt' ? 'Reason (required)' : 'Note'}><Textarea value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      <Field label="Photo (optional, supports but never replaces the recipient check)"><input type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto(e.target.files[0])} /></Field>
      {geo && <p className="tiny muted">Location captured: {geo.lat.toFixed(4)}, {geo.lng.toFixed(4)}</p>}
      <div className="row"><Btn onClick={submit} disabled={busy || (type !== 'submission' && type !== 'failed_attempt' && !f.ack_name) || (type === 'failed_attempt' && !f.note)} style={{ flex: 1 }}>{online ? 'Save event' : 'Save offline'}</Btn><Btn kind="danger" onClick={incident} disabled={busy}>Report incident</Btn></div></Card>
    {r.data.custody.length > 0 && <Card className="mt"><h4>History</h4>{r.data.custody.map((c) => <div key={c.id} className="small">{c.type} · {fdt(c.captured_at)}{c.offline ? ' · offline capture' : ''}</div>)}</Card>}</div>;
}
export const _a = { get, API_BASE, StatusBadge };
