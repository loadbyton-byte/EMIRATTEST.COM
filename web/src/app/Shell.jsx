import { useEffect, useState } from 'react';
import { Link, Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { useI18n } from '../i18n.jsx';
import { Icon, SideLink, useApi, Badge, Modal, Btn } from '../ui.jsx';
import { post, ago } from '../api.js';

export function Shell({ menu, bottom, title, brand }) {
  const { user, logout, unread, refresh } = useAuth(); const { lang, setLang } = useI18n(); const nav = useNavigate(); const loc = useLocation();
  const [bell, setBell] = useState(false); const notes = useApi(bell ? '/api/account/notifications' : null, [bell]);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => { const on = () => setOnline(true); const off = () => setOnline(false); window.addEventListener('online', on); window.addEventListener('offline', off); return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); }; }, []);
  useEffect(() => { const t = setInterval(refresh, 60000); return () => clearInterval(t); }, [refresh]);
  const markRead = async () => { await post('/api/account/notifications/read'); refresh(); };
  return <div className="shell">
    <aside className="side" aria-label="Navigation"><Link to="/" className="logo"><img src="/brand/compact-full-color.svg" alt="Emirattest" /></Link>
      {menu.map((m, i) => m.group ? <div key={i} className="group">{m.group}</div> : <SideLink key={m.to} to={m.to} icon={m.icon} end={m.end}>{m.label}</SideLink>)}
      <div style={{ marginTop: 'auto' }} className="col gap-s"><div className="small muted" style={{ padding: '0 12px' }}>{user.name}<div className="tiny">{user.role}</div></div><button className="btn ghost sm" onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}>{lang === 'en' ? 'العربية' : 'English'}</button><button className="btn ghost sm" onClick={async () => { await logout(); nav('/'); }}><Icon name="logout" size={16} /> Sign out</button></div></aside>
    <div className="main"><div className="head"><b className="grow">{title}</b>
      {!online && <Badge kind="amber">Offline</Badge>}
      <button className="btn ghost sm bell" onClick={() => setBell(true)} aria-label="Notifications"><Icon name="bell" size={18} />{unread > 0 && <span className="dot">{unread}</span>}</button>
      <button className="btn ghost sm" onClick={() => setLang(lang === 'en' ? 'ar' : 'en')} style={{ display: 'none' }}>lang</button>
      <button className="btn ghost sm mobile-only" onClick={async () => { await logout(); nav('/'); }} aria-label="Sign out" title="Sign out"><Icon name="logout" size={18} /></button></div>
      <div className="content" key={loc.pathname}><Outlet /></div></div>
    <nav className="bottomnav" aria-label="Primary">{(bottom || menu.filter((m) => m.to)).slice(0, 5).map((m) => <NavLink key={m.to} to={m.to} end={m.end} className={({ isActive }) => (isActive ? 'active' : '')}><Icon name={m.icon} />{m.short || m.label}</NavLink>)}</nav>
    {bell && <Modal title="Notifications" onClose={() => { setBell(false); markRead(); }}>{notes.loading ? '…' : notes.data?.notifications.length ? <div className="col">{notes.data.notifications.map((n) => <div key={n.id} className="card flat"><div className="row between"><b className="small">{n.title}</b>{!n.read_at && <Badge kind="red">new</Badge>}</div><div className="small muted">{n.body}</div><div className="row between tiny muted"><span>{ago(n.created_at)}</span>{n.link && <Link to={n.link} onClick={() => setBell(false)}>Open</Link>}</div></div>)}</div> : <div className="empty">No notifications yet</div>}</Modal>}
  </div>;
}
