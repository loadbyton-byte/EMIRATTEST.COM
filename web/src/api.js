const isNative = () => typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();
export const API_BASE = () => {
  try { const s = localStorage.getItem('emt_api_base'); if (s) return s.replace(/\/$/, ''); } catch { /* storage unavailable */ }
  return (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');
};
const tokenKey = 'emt_token';
export const getToken = () => { try { return localStorage.getItem(tokenKey); } catch { return null; } };
export const setToken = (t) => { try { t ? localStorage.setItem(tokenKey, t) : localStorage.removeItem(tokenKey); } catch { /* ignore */ } };

export class ApiError extends Error {
  constructor(status, message, data) { super(message); this.status = status; this.data = data; }
}

export async function api(path, { method = 'GET', body, raw, headers = {}, signal } = {}) {
  const h = { 'X-Requested-With': 'emirattest', 'X-Channel': isNative() ? 'app' : 'web', ...headers };
  const tok = getToken();
  if (tok) h.Authorization = `Bearer ${tok}`;
  let payload;
  if (raw !== undefined) { h['Content-Type'] = 'application/octet-stream'; payload = raw; }
  else if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(`${API_BASE()}${path}`, { method, headers: h, body: payload, credentials: 'include', signal });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json().catch(() => ({})) : await res.text();
  if (!res.ok && res.status !== 202 && res.status !== 207) throw new ApiError(res.status, data?.error || res.statusText, data);
  return data;
}
export const get = (p) => api(p);
export const post = (p, body) => api(p, { method: 'POST', body: body ?? {} });
export const put = (p, body) => api(p, { method: 'PUT', body });
export const patch = (p, body) => api(p, { method: 'PATCH', body });
export const del = (p) => api(p, { method: 'DELETE' });
export const upload = (p, file, params = {}) => {
  const q = new URLSearchParams({ filename: file.name, ...params }).toString();
  return file.arrayBuffer().then((buf) => api(`${p}${p.includes('?') ? '&' : '?'}${q}`, { method: 'POST', raw: buf }));
};
export const money = (n, cur = 'AED') => `${cur} ${Number(n || 0).toLocaleString('en-AE', { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
export const fdate = (s) => (s ? new Date(String(s).includes('T') || String(s).length <= 10 ? s : `${s.replace(' ', 'T')}Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const fdt = (s) => (s ? new Date(String(s).includes('T') ? s : `${String(s).replace(' ', 'T')}Z`).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
export const ago = (s) => {
  if (!s) return '—';
  const d = (Date.now() - new Date(`${String(s).replace(' ', 'T')}${String(s).includes('Z') ? '' : 'Z'}`).getTime()) / 60000;
  if (d < 1) return 'just now'; if (d < 60) return `${Math.floor(d)}m ago`; if (d < 1440) return `${Math.floor(d / 60)}h ago`; return `${Math.floor(d / 1440)}d ago`;
};
export { isNative };
