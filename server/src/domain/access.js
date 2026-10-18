import { get, all } from '../db.js';
import { isStaff } from '../lib/auth.js';
import { forbidden, notFound, nowIso } from '../lib/util.js';

/** Organisation role of a user in an org (or null). */
export const orgRole = (userId, orgId) => orgId ? get('SELECT * FROM org_members WHERE org_id = ? AND user_id = ?', orgId, userId) : null;
export const userOrgs = (userId) => all('SELECT o.*, m.role AS member_role, m.approval_limit, m.department FROM org_members m JOIN orgs o ON o.id = m.org_id WHERE m.user_id = ?', userId);

export const activeGrants = (userId, where = '', ...params) =>
  all(`SELECT * FROM profile_grants WHERE grantee_user_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) ${where}`, userId, nowIso(), ...params);

/**
 * Resolve what a user may do with a case. Returns null if no access.
 * Separate roles never see each other's records: a company email or shared phone confers nothing.
 */
export function caseAccess(user, c) {
  if (!user || !c) return null;
  if (isStaff(user)) {
    const finance = user.role === 'finance';
    return { kind: finance ? 'finance_staff' : 'staff', view: true, docs: !finance, finance: true, act: !finance, approve: false, internal: true, contact: !finance };
  }
  if (c.customer_id === user.id) return { kind: 'owner', view: true, docs: true, finance: true, act: true, approve: true, internal: false, contact: true };
  if (c.org_id) {
    const m = orgRole(user.id, c.org_id);
    if (m) {
      const r = m.role;
      if (r === 'owner') return { kind: 'org_owner', view: true, docs: true, finance: true, act: true, approve: true, internal: false, contact: true, orgRole: r, limit: Infinity };
      if (r === 'approver') return { kind: 'org_approver', view: true, docs: true, finance: true, act: false, approve: true, internal: false, contact: true, orgRole: r, limit: m.approval_limit };
      if (r === 'finance') return { kind: 'org_finance', view: true, docs: false, finance: true, act: false, approve: false, internal: false, contact: false, orgRole: r };
      if (r === 'auditor') return { kind: 'org_auditor', view: true, docs: false, finance: true, act: false, approve: false, internal: false, contact: false, orgRole: r, readOnly: true };
      if (r === 'hr') {
        const p = c.profile_id ? get('SELECT * FROM profiles WHERE id = ?', c.profile_id) : null;
        if (p && p.org_id === c.org_id && p.consent_status === 'consented') return { kind: 'org_hr', view: true, docs: false, finance: false, act: false, approve: false, internal: false, contact: false, orgRole: r };
      }
      // submitters only see cases they submitted (covered by owner check above)
    }
  }
  if (c.profile_id) {
    const g = activeGrants(user.id, "AND profile_id = ? AND (scope_type = 'profile' OR (scope_type = 'case' AND scope_id = ?))", c.profile_id, c.id)[0];
    if (g) return { kind: 'grant', view: true, docs: true, finance: false, act: false, approve: false, internal: false, contact: false, grant: g };
  }
  if (c.provider_id) {
    const pu = get('SELECT 1 AS x FROM provider_users WHERE provider_id = ? AND user_id = ?', c.provider_id, user.id);
    if (pu) return { kind: 'provider', view: true, docs: true, finance: false, act: true, approve: false, internal: false, contact: false };
  }
  if (user.role === 'agent') {
    const t = get("SELECT id FROM case_tasks WHERE case_id = ? AND owner_user_id = ? AND status != 'cancelled'", c.id, user.id);
    if (t) return { kind: 'agent', view: true, docs: false, finance: false, act: false, approve: false, internal: false, contact: false };
  }
  return null;
}

export function loadCaseFor(user, id, need = 'view') {
  const c = /^\d+$/.test(String(id)) ? get('SELECT * FROM cases WHERE id = ?', Number(id)) : get('SELECT * FROM cases WHERE ref = ?', String(id));
  if (!c) throw notFound('Case not found');
  const a = caseAccess(user, c);
  if (!a) throw notFound('Case not found'); // do not reveal existence
  if (need !== 'view' && !a[need]) throw forbidden('Your access level cannot perform this action');
  return { c, a };
}

/** Documents visible to this user for a case. */
export const canSeeDocs = (a) => !!a?.docs;

export function profileAccess(user, p) {
  if (!user || !p) return null;
  if (isStaff(user) && user.role !== 'finance') return { kind: 'staff', manage: true };
  if (p.owner_user_id === user.id) return { kind: 'owner', manage: true };
  const g = activeGrants(user.id, 'AND profile_id = ?', p.id)[0];
  if (g) return { kind: 'grant', manage: false, grant: g };
  if (p.org_id) {
    const m = orgRole(user.id, p.org_id);
    if (m && ['owner', 'hr'].includes(m.role) && p.consent_status === 'consented') return { kind: 'org_' + m.role, manage: false, limited: true };
    if (m && m.role === 'owner') return { kind: 'org_owner', manage: false, limited: true };
  }
  return null;
}
