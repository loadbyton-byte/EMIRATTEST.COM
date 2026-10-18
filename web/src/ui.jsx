import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { api, money as fmoney } from './api.js';

/* ---------------- icons (24px stroke set) ---------------- */
const P = {
  stamp: 'M5 20h14M8 16h8l-1-5a3 3 0 1 0-6 0z M12 4v3',
  id: 'M3 6h18v12H3z M7 11h4M7 14h6M15 10h3v4h-3z',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  plane: 'M2 12l20-8-6 16-4-6-6-2z M22 4L12 14',
  home: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  truck: 'M2 6h11v10H2zM13 9h5l3 3v4h-8zM6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  building: 'M4 21V4h10v17M14 9h6v12M8 8h2M8 12h2M8 16h2M17 13h0M17 17h0',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  check: 'M20 6L9 17l-5-5', cap: 'M2 9l10-5 10 5-10 5zM6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5', briefcase: 'M3 8h18v12H3zM8 8V5h8v3M3 13h18',
  flag: 'M5 21V4M5 4h13l-2 4 2 4H5', lang: 'M4 5h8M8 3v2M5 5c0 4 3 7 7 8M11 5c-1 4-4 7-7 8M14 21l4-10 4 10M15.5 18h5', award: 'M12 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM8.5 13.5L7 22l5-3 5 3-1.5-8.5',
  family: 'M9 7a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM3 21v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3M17 21v-2.5a3 3 0 0 0-2-2.8', users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2M17 3.1a4 4 0 0 1 0 7.8M22 21v-2a5 5 0 0 0-3.5-4.8',
  star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z', clear: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13', compass: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM15.5 8.5l-2 5-5 2 2-5z', scale: 'M12 3v18M5 21h14M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z', box: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',
  map: 'M9 3L3 5v16l6-2 6 2 6-2V3l-6 2zM9 3v16M15 5v16', visa: 'M4 4h16v16H4zM8 9h8M8 13h5', moon: 'M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10z', shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', bank: 'M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18', plug: 'M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4',
  gift: 'M3 9h18v4H3zM5 13v8h14v-8M12 9v12M12 9c-3 0-5-1-5-3s3-3 5 0c2-3 5-2 5 0s-2 3-5 3', run: 'M13 4a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 21l3-6 3 2v5M9 15l-1-4 5-2 3 3 3 1M13 9l-1-3', mail: 'M3 5h18v14H3zM3 6l9 7 9-7', layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17l9 5 9-5', grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z', server: 'M3 4h18v6H3zM3 14h18v6H3zM7 7h.01M7 17h.01',
  bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 21a2 2 0 0 0 4 0', chat: 'M21 12a8 8 0 0 1-11.5 7.2L3 21l1.8-5.5A8 8 0 1 1 21 12z', menu: 'M3 6h18M3 12h18M3 18h18', x: 'M6 6l12 12M18 6L6 18', plus: 'M12 5v14M5 12h14', file: 'M6 2h9l5 5v15H6zM14 2v6h6', upload: 'M12 16V4M7 9l5-5 5 5M4 20h16', calendar: 'M4 5h16v16H4zM4 10h16M9 3v4M15 3v4', cart: 'M3 4h3l3 12h10l2-8H7M10 20h.01M18 20h.01', coin: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v10M9.5 9.5C9.5 8.5 11 8 12 8s2.5.5 2.5 1.8c0 2.6-5 1.4-5 4 0 1.3 1.5 1.8 2.5 1.8s2.5-.5 2.5-1.5', chart: 'M4 20V4M4 20h16M8 16v-4M13 16V8M18 16v-7', settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.7a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2l.4 2.7h4l.4-2.7a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z', logout: 'M9 4H4v16h5M16 8l4 4-4 4M20 12H9', search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5', alert: 'M12 3L2 21h20zM12 10v5M12 18h.01', wa: 'M20 12a8 8 0 0 1-12 6.9L4 20l1.2-3.8A8 8 0 1 1 20 12zM9 9c0 3 3 6 6 6l1-1.5-2-1-1 .8c-1-.4-2-1.4-2.4-2.4l.8-1-1-2z',
};
export const Icon = ({ name, size }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={P[name] || P.file} /></svg>
);

/* ---------------- toasts ---------------- */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((msg, kind = '') => { const id = Math.random(); setItems((x) => [...x, { id, msg, kind }]); setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 4500); }, []);
  return <ToastCtx.Provider value={push}>{children}<div className="toasts" role="status" aria-live="polite">{items.map((i) => <div key={i.id} className={`toast ${i.kind}`}>{i.msg}</div>)}</div></ToastCtx.Provider>;
}

/* ---------------- data hooks ---------------- */
export function useApi(path, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: !!path });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return undefined;
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    api(path).then((d) => live && setState({ data: d, error: null, loading: false })).catch((e) => live && setState({ data: null, error: e, loading: false }));
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, ...deps]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn, { ok, quiet } = {}) => {
    setBusy(true);
    try { const r = await fn(); if (ok) toast(ok, 'good'); return r; } catch (e) { if (!quiet) toast(e.message || 'Something went wrong', 'bad'); return undefined; } finally { setBusy(false); }
  }, [toast]);
  return [run, busy];
}

/* ---------------- primitives ---------------- */
export const Spinner = () => <span className="spinner" role="status" aria-label="Loading" />;
export const Loading = ({ state }) => state.loading ? <div className="empty"><Spinner /></div> : state.error ? <div className="alert bad">{state.error.message}</div> : null;
export const Empty = ({ children }) => <div className="empty">{children}</div>;
export const Card = ({ children, className = '', ...p }) => <div className={`card ${className}`} {...p}>{children}</div>;
export const Badge = ({ kind = '', children }) => <span className={`badge ${kind}`}>{children}</span>;
export const Alert = ({ kind = '', children }) => <div className={`alert ${kind}`}>{children}</div>;
export const Stat = ({ label, value, sub, kind = '' }) => <div className={`stat ${kind}`}><div className="v">{value}</div><div className="l">{label}</div>{sub && <div className="s muted">{sub}</div>}</div>;
export const Money = ({ v, cur }) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmoney(v, cur)}</span>;
export function Field({ label, hint, error, children }) { return <div className="field">{label && <label>{label}</label>}{children}{hint && <span className="hint">{hint}</span>}{error && <span className="err">{error}</span>}</div>; }
export const Input = (p) => <input className="input" {...p} />;
export const Select = ({ children, ...p }) => <select className="input" {...p}>{children}</select>;
export const Textarea = (p) => <textarea className="input" {...p} />;
export const Btn = ({ kind = '', size = '', children, to, ...p }) => to ? <Link className={`btn ${kind} ${size}`} to={to} {...p}>{children}</Link> : <button className={`btn ${kind} ${size}`} {...p}>{children}</button>;
export function Modal({ title, onClose, children, wide }) {
  useEffect(() => { const h = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  return <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><div className="modal" role="dialog" aria-modal="true" aria-label={title} style={wide ? { width: 'min(820px,100%)' } : undefined}><div className="row between"><h3>{title}</h3><button className="btn ghost sm" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button></div>{children}</div></div>;
}
export const Tabs = ({ tabs, value, onChange }) => <div className="tabs" role="tablist">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={value === k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{l}</button>)}</div>;
export function Table({ cols, rows, onRow, empty = 'Nothing to show' }) {
  if (!rows?.length) return <Empty>{empty}</Empty>;
  return <div className="tablewrap"><table><thead><tr>{cols.map((c) => <th key={c.k || c.h} className={c.num ? 'num' : ''}>{c.h}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={r.id ?? i} className={onRow ? 'click' : ''} onClick={onRow ? () => onRow(r) : undefined}>{cols.map((c) => <td key={c.k || c.h} className={c.num ? 'num' : ''}>{c.r ? c.r(r) : r[c.k]}</td>)}</tr>)}</tbody></table></div>;
}
export const PageHead = ({ title, children, sub }) => <div className="pagehead"><div><h1>{title}</h1>{sub && <div className="muted">{sub}</div>}</div><div className="row">{children}</div></div>;
export const KV = ({ items }) => <dl className="kv">{items.filter(Boolean).map(([k, v]) => <><dt key={`k${k}`}>{k}</dt><dd key={`v${k}`}>{v ?? '—'}</dd></>)}</dl>;

/* ---------------- charts (SVG, no dependency) ---------------- */
export function BarChart({ data, height = 160, color = 'var(--green)', fmt = (v) => v }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const w = 100 / Math.max(data.length, 1);
  return <svg viewBox={`0 0 100 ${height / 2}`} preserveAspectRatio="none" style={{ width: '100%', height }} role="img" aria-label="bar chart">{data.map((d, i) => { const h = (d.value / max) * (height / 2 - 14); return <g key={i}><rect x={i * w + w * 0.15} y={height / 2 - 12 - h} width={w * 0.7} height={h} rx="1" fill={d.color || color} /><text x={i * w + w / 2} y={height / 2 - 3} fontSize="3.2" textAnchor="middle" fill="#58645E">{d.label}</text><text x={i * w + w / 2} y={height / 2 - 14 - h} fontSize="3.2" textAnchor="middle" fill="#151B18">{fmt(d.value)}</text></g>; })}</svg>;
}
export function Donut({ parts, size = 150 }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1; let acc = 0; const r = 15.9;
  const colors = ['var(--green)', 'var(--red)', '#1d5fa8', '#b7791f', '#6b7a72', '#7c4dff', '#00897b'];
  return <div className="row"><svg viewBox="0 0 36 36" width={size} height={size} role="img" aria-label="donut chart">{parts.map((p, i) => { const frac = (p.value / total) * 100; const el = <circle key={i} cx="18" cy="18" r={r} fill="none" stroke={p.color || colors[i % colors.length]} strokeWidth="4" strokeDasharray={`${frac} ${100 - frac}`} strokeDashoffset={25 - acc} />; acc += frac; return el; })}</svg><ul style={{ margin: 0, paddingInlineStart: 0, listStyle: 'none', fontSize: '.82rem' }}>{parts.map((p, i) => <li key={i}><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: p.color || colors[i % colors.length], marginInlineEnd: 6 }} />{p.label} <b>{p.value}</b></li>)}</ul></div>;
}
export function LineChart({ points, height = 140, color = 'var(--green)', fmt = (v) => v }) {
  if (!points.length) return <Empty>No data</Empty>;
  const max = Math.max(1, ...points.map((p) => p.value)); const min = Math.min(0, ...points.map((p) => p.value)); const W = 100; const H = height / 2;
  const xy = points.map((p, i) => [(i / Math.max(points.length - 1, 1)) * (W - 8) + 4, H - 10 - ((p.value - min) / (max - min || 1)) * (H - 20)]);
  return <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height }} role="img" aria-label="line chart"><polyline fill="none" stroke={color} strokeWidth="0.9" points={xy.map((p) => p.join(',')).join(' ')} />{xy.map((p, i) => <g key={i}><circle cx={p[0]} cy={p[1]} r="1.1" fill={color} /><text x={p[0]} y={H - 2} fontSize="3" textAnchor="middle" fill="#58645E">{points[i].label}</text><text x={p[0]} y={p[1] - 2.5} fontSize="3" textAnchor="middle">{fmt(points[i].value)}</text></g>)}</svg>;
}

/* status → badge colour */
const GREEN = ['completed', 'delivered', 'dispatched', 'verified', 'accepted', 'paid', 'resolved', 'closed', 'booked', 'clean', 'active', 'clear'];
const RED = ['rejected', 'failed', 'cancelled', 'blocked', 'suspended', 'overdue', 'expired', 'declined'];
const AMBER = ['customer_action_required', 'correction_required', 'awaiting_payment', 'quotation_awaiting_approval', 'pending', 'investigating', 'open', 'tight', 'quoted'];
export const StatusBadge = ({ status, label }) => <Badge kind={GREEN.includes(status) ? 'green' : RED.includes(status) ? 'red' : AMBER.includes(status) ? 'amber' : 'blue'}>{label || String(status).replace(/_/g, ' ')}</Badge>;
export const SideLink = ({ to, icon, children, end }) => <NavLink to={to} end={end} className={({ isActive }) => `nav ${isActive ? 'active' : ''}`}><Icon name={icon} />{children}</NavLink>;
export function useDebounced(v, ms = 300) { const [d, setD] = useState(v); const t = useRef(); useEffect(() => { clearTimeout(t.current); t.current = setTimeout(() => setD(v), ms); return () => clearTimeout(t.current); }, [v, ms]); return d; }
export const qs = (o) => { const p = new URLSearchParams(); Object.entries(o).forEach(([k, v]) => v !== '' && v !== undefined && v !== null && p.set(k, v)); const s = p.toString(); return s ? `?${s}` : ''; };
