import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { api, post, setToken, isNative } from './api.js';
import { Loading } from './ui.jsx';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null, orgs: [], provider: null, unread: 0 });
  const refresh = useCallback(async () => {
    try { const r = await api('/api/auth/me'); setState({ loading: false, user: r.user, orgs: r.orgs || [], provider: r.provider, unread: r.unread || 0 }); return r.user; }
    catch { setState((s) => ({ ...s, loading: false })); return null; }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const login = async (email, password, otp) => {
    const r = await post('/api/auth/login', { email, password, otp });
    if (r.mfa_required) return { mfa: true };
    if (isNative() || r.token) setToken(isNative() ? r.token : null);
    await refresh();
    return { user: r.user };
  };
  const register = async (b) => { const r = await post('/api/auth/register', b); if (isNative()) setToken(r.token); await refresh(); return r.user; };
  const logout = async () => { try { await post('/api/auth/logout'); } catch { /* ignore */ } setToken(null); setState({ loading: false, user: null, orgs: [], provider: null, unread: 0 }); };
  return <Ctx.Provider value={{ ...state, refresh, login, register, logout }}>{children}</Ctx.Provider>;
}

export const homeFor = (u) => !u ? '/login' : ['support', 'ops', 'finance', 'admin'].includes(u.role) ? '/ops' : u.role === 'provider' ? '/provider' : u.role === 'agent' ? '/agent' : '/app';

export function Protected({ roles, children }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="empty"><Loading state={{ loading: true }} /></div>;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={homeFor(user)} replace />;
  return children;
}
