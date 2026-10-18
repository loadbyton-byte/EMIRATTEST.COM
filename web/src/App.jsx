import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, Protected, useAuth, homeFor } from './auth.jsx';
import { I18nProvider, useI18n } from './i18n.jsx';
import { ToastProvider } from './ui.jsx';
import { PublicLayout, Home, Services, ServiceDetail, Calculator, Requirements, Business, TrackPublic, Trust, Legal } from './pages/public.jsx';
import { Login, Register, Demo, Pay, Invite, WhatsAppDemo } from './pages/auth.jsx';
import { Shell } from './app/Shell.jsx';
import CaseDetail from './app/case.jsx';
import { Dashboard, Requests, NewRequest, Documents, Family, Planner, Bookings, Settings } from './app/customer.jsx';
import { OrgLayout, OrgOverview, OrgCases, OrgBulk, OrgEmployees, OrgPurchasing, OrgBilling, OrgReports, OrgTeam, OrgIntegrations } from './app/org.jsx';
import { ProviderHome, ProviderCase, ProviderProfile, ProviderSettlements } from './app/provider.jsx';
import { AgentHome, AgentTask } from './app/agent.jsx';
import { OpsDashboard, OpsCases, OpsCase, OpsNetwork, OpsRegistry, OpsProviders, OpsSupport, OpsFinance, OpsAdmin, OpsAudit, OpsSettings } from './app/ops.jsx';

function CustomerShell() {
  const { t } = useI18n(); const { orgs } = useAuth();
  const menu = [{ to: '/app', icon: 'home', label: t('dashboard'), short: 'Home', end: true }, { to: '/app/requests', icon: 'list', label: t('requests'), short: 'Requests' }, { to: '/app/new', icon: 'plus', label: t('new_request'), short: 'New' }, { to: '/app/documents', icon: 'file', label: t('documents'), short: 'Docs' }, { to: '/app/family', icon: 'family', label: t('family'), short: 'Family' }, { to: '/app/planner', icon: 'calendar', label: t('planner'), short: 'Plan' }, { to: '/app/bookings', icon: 'plane', label: t('bookings'), short: 'Book' },
    ...orgs.map((o) => ({ to: `/app/business/${o.id}`, icon: 'building', label: o.name, short: 'Business' })), { to: '/app/settings', icon: 'settings', label: t('settings'), short: 'Settings' }];
  return <Shell menu={menu} bottom={[menu[0], menu[1], menu[2], menu[4], menu[menu.length - 1]]} title="Emirattest" />;
}
const providerMenu = [{ to: '/provider', icon: 'list', label: 'Assignments', end: true }, { to: '/provider/profile', icon: 'building', label: 'Profile & coverage', short: 'Profile' }, { to: '/provider/settlements', icon: 'coin', label: 'Settlements', short: 'Money' }];
const agentMenu = [{ to: '/agent', icon: 'truck', label: 'My tasks', end: true, short: 'Tasks' }];
function OpsShell() {
  const { user } = useAuth(); const fin = user.role === 'finance';
  const menu = fin ? [{ to: '/ops/finance', icon: 'coin', label: 'Finance', short: 'Finance' }, { to: '/ops/audit', icon: 'shield', label: 'Audit log', short: 'Audit' }] : [{ to: '/ops', icon: 'chart', label: 'Overview', end: true }, { to: '/ops/cases', icon: 'list', label: 'Case queue', short: 'Cases' }, { to: '/ops/network', icon: 'truck', label: 'Field network', short: 'Network' }, { to: '/ops/registry', icon: 'stamp', label: 'Registry', short: 'Registry' }, { to: '/ops/providers', icon: 'building', label: 'Providers', short: 'Partners' }, { to: '/ops/support', icon: 'chat', label: 'Support', short: 'Support' }, ...(user.role === 'admin' ? [{ to: '/ops/finance', icon: 'coin', label: 'Finance', short: 'Finance' }, { to: '/ops/admin', icon: 'users', label: 'Users & orgs', short: 'Users' }, { to: '/ops/audit', icon: 'shield', label: 'Audit log', short: 'Audit' }, { to: '/ops/settings', icon: 'settings', label: 'Settings', short: 'Settings' }] : user.role === 'ops' ? [{ to: '/ops/audit', icon: 'shield', label: 'Audit log', short: 'Audit' }] : [])];
  return <Shell menu={menu} title={`Operations · ${user.role}`} />;
}
function Landing() { const { user, loading } = useAuth(); return loading ? null : <Navigate to={homeFor(user)} replace />; }
function SW() { useEffect(() => { if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !window.Capacitor?.isNativePlatform?.()) navigator.serviceWorker.register('/sw.js').catch(() => {}); }, []); return null; }

export default function App() {
  return <BrowserRouter><I18nProvider><ToastProvider><AuthProvider><SW /><Routes>
    <Route element={<PublicLayout />}>
      <Route index element={<Home />} /><Route path="services" element={<Services />} /><Route path="services/:slug" element={<ServiceDetail />} /><Route path="calculator" element={<Calculator />} /><Route path="requirements" element={<Requirements />} /><Route path="business" element={<Business />} /><Route path="track" element={<TrackPublic />} /><Route path="trust" element={<Trust />} /><Route path="legal/:doc" element={<Legal />} /><Route path="login" element={<Login />} /><Route path="register" element={<Register />} /><Route path="demo" element={<Demo />} /><Route path="whatsapp-demo" element={<WhatsAppDemo />} /><Route path="pay/:token" element={<Pay />} /><Route path="invite/:token" element={<Invite />} /></Route>
    <Route path="/app" element={<Protected roles={['customer']}><CustomerShell /></Protected>}>
      <Route index element={<Dashboard />} /><Route path="requests" element={<Requests />} /><Route path="new" element={<NewRequest />} /><Route path="cases/:id" element={<CaseDetail />} /><Route path="documents" element={<Documents />} /><Route path="family" element={<Family />} /><Route path="planner" element={<Planner />} /><Route path="bookings" element={<Bookings />} /><Route path="settings" element={<Settings />} />
      <Route path="business/:id" element={<OrgLayout />}><Route index element={<OrgOverview />} /><Route path="cases" element={<OrgCases />} /><Route path="bulk" element={<OrgBulk />} /><Route path="employees" element={<OrgEmployees />} /><Route path="purchasing" element={<OrgPurchasing />} /><Route path="billing" element={<OrgBilling />} /><Route path="reports" element={<OrgReports />} /><Route path="team" element={<OrgTeam />} /><Route path="integrations" element={<OrgIntegrations />} /></Route></Route>
    <Route path="/provider" element={<Protected roles={['provider']}><Shell menu={providerMenu} title="Provider portal" /></Protected>}><Route index element={<ProviderHome />} /><Route path="cases/:id" element={<ProviderCase />} /><Route path="profile" element={<ProviderProfile />} /><Route path="settlements" element={<ProviderSettlements />} /></Route>
    <Route path="/agent" element={<Protected roles={['agent']}><Shell menu={agentMenu} title="Field agent" /></Protected>}><Route index element={<AgentHome />} /><Route path="tasks/:id" element={<AgentTask />} /></Route>
    <Route path="/ops" element={<Protected roles={['support', 'ops', 'finance', 'admin']}><OpsShell /></Protected>}><Route index element={<OpsDashboard />} /><Route path="cases" element={<OpsCases />} /><Route path="cases/:id" element={<OpsCase />} /><Route path="network" element={<OpsNetwork />} /><Route path="registry" element={<OpsRegistry />} /><Route path="providers" element={<OpsProviders />} /><Route path="support" element={<OpsSupport />} /><Route path="finance" element={<OpsFinance />} /><Route path="admin" element={<OpsAdmin />} /><Route path="audit" element={<OpsAudit />} /><Route path="settings" element={<OpsSettings />} /></Route>
    <Route path="*" element={<Landing />} />
  </Routes></AuthProvider></ToastProvider></I18nProvider></BrowserRouter>;
}
