import { all, get, run, insert, update, json, tx } from '../db.js';
import { CATEGORIES, SERVICES, ROUTES, KB } from './catalog-data.js';
import { todayStr, daysBetween, nowIso } from '../lib/util.js';
import { audit } from '../lib/audit.js';

export function seedCatalog() {
  tx(() => {
    SERVICES.forEach((s, i) => {
      insert('services', {
        slug: s.slug, category: s.category, name_en: s.en, name_ar: s.ar, summary_en: s.sen, summary_ar: s.sar,
        pricing_basis: s.pricing_basis, base_fee_aed: s.base, business_fee_aed: s.biz, regulated: s.regulated ? 1 : 0,
        eligibility_note: s.elig || null, default_route_slug: s.route || null, requirements: JSON.stringify(s.reqs || []), icon: s.icon, sort: i, kind: s.kind,
      });
    });
    for (const r of ROUTES) {
      const rid = insert('routes', {
        slug: r.slug, title_en: r.title, title_ar: r.ar, doc_category: r.cat, issuing_country: r.issuing, use_destination: r.dest, purpose: r.purpose,
        apostille_applicable: r.apostille, summary: r.summary, version: 1, effective_date: '2026-01-01', reviewed_on: r.reviewed, reviewer: r.reviewer,
        review_interval_days: 90, source_urls: JSON.stringify(r.src), digital_available: r.digital,
      });
      r.stages.forEach((st, i) => insert('route_stages', {
        route_id: rid, seq: i + 1, name: st[0], name_ar: st[1], owner: st[2], necessity: st[3], min_days: st[4], max_days: st[5], official_fee_aed: st[6], note: st[7],
      }));
      r.reqs.forEach((label, i) => insert('route_requirements', { route_id: rid, seq: i + 1, label, mandatory: 1 }));
      insert('route_versions', { route_id: rid, version: 1, summary: 'Initial registry entry', snapshot: JSON.stringify(routeSnapshot(rid)) });
    }
    for (const [slug, lang, title, body, tags] of KB) {
      insert('kb_articles', { slug: `${slug}:${lang}`, lang, title, body, tags, status: 'approved', approved_by: 'Requirements desk', approved_at: '2026-10-01 09:00:00' });
    }
  });
}

export const categories = () => CATEGORIES;

export function listServices({ category, q } = {}) {
  let rows = all('SELECT * FROM services ORDER BY sort');
  if (category) rows = rows.filter((s) => s.category === category);
  if (q) {
    const n = q.toLowerCase();
    rows = rows.filter((s) => [s.name_en, s.summary_en, s.name_ar, s.summary_ar, s.slug].join(' ').toLowerCase().includes(n));
  }
  return rows.map(serviceOut);
}
export const serviceOut = (s) => ({ ...s, requirements: json(s.requirements, []), regulated: !!s.regulated });
export const getService = (slugOrId) => {
  const s = typeof slugOrId === 'number' || /^\d+$/.test(String(slugOrId))
    ? get('SELECT * FROM services WHERE id = ?', Number(slugOrId)) : get('SELECT * FROM services WHERE slug = ?', slugOrId);
  return s ? serviceOut(s) : null;
};

export function routeStale(r, today = todayStr()) {
  const age = daysBetween(r.reviewed_on, today);
  return { age_days: age, stale: age > r.review_interval_days, due_in_days: r.review_interval_days - age };
}
export function getRoute(slugOrId) {
  const r = typeof slugOrId === 'number' || /^\d+$/.test(String(slugOrId))
    ? get('SELECT * FROM routes WHERE id = ?', Number(slugOrId)) : get('SELECT * FROM routes WHERE slug = ?', slugOrId);
  if (!r) return null;
  return {
    ...r, apostille_applicable: !!r.apostille_applicable, digital_available: !!r.digital_available, source_urls: json(r.source_urls, []),
    stages: all('SELECT * FROM route_stages WHERE route_id = ? ORDER BY seq', r.id),
    requirements: all('SELECT * FROM route_requirements WHERE route_id = ? ORDER BY seq', r.id),
    freshness: routeStale(r),
  };
}
const routeSnapshot = (id) => {
  const r = get('SELECT * FROM routes WHERE id = ?', id);
  return { route: r, stages: all('SELECT * FROM route_stages WHERE route_id = ? ORDER BY seq', id), requirements: all('SELECT * FROM route_requirements WHERE route_id = ? ORDER BY seq', id) };
};
export const listRoutes = ({ category, q } = {}) => {
  let rows = all('SELECT id, slug FROM routes ORDER BY title_en').map((r) => getRoute(r.id));
  if (category) rows = rows.filter((r) => r.doc_category === category);
  if (q) rows = rows.filter((r) => `${r.title_en} ${r.title_ar} ${r.purpose} ${r.summary}`.toLowerCase().includes(q.toLowerCase()));
  return rows;
};

/** Pick the best route for a service + destination/apostille preference. */
export function resolveRoute({ serviceSlug, routeSlug, apostille }) {
  if (routeSlug) return getRoute(routeSlug);
  const svc = getService(serviceSlug);
  let slug = svc?.default_route_slug;
  if (slug === 'edu-degree-uae-to-abroad' && apostille) slug = 'edu-degree-uae-to-abroad-apostille';
  return slug ? getRoute(slug) : null;
}

const ACTIVE = ['draft', 'customer_action_required', 'ready_for_review', 'quotation_awaiting_approval', 'awaiting_payment', 'assigned', 'collected', 'submitted', 'authority_pending', 'provider_pending', 'correction_required'];

/** Update a route (new version) and find active cases it affects. Does not auto-authorise new spending. */
export function updateRoute(slug, patch, user, summary) {
  const cur = get('SELECT * FROM routes WHERE slug = ?', slug);
  if (!cur) return null;
  return tx(() => {
    const oldStages = all('SELECT * FROM route_stages WHERE route_id = ? ORDER BY seq', cur.id);
    const newVersion = cur.version + 1;
    const fields = {};
    for (const k of ['title_en', 'summary', 'apostille_applicable', 'use_destination', 'purpose']) if (patch[k] !== undefined) fields[k] = patch[k];
    update('routes', cur.id, { ...fields, version: newVersion, reviewed_on: todayStr(), reviewer: user?.name || 'Requirements desk', effective_date: patch.effective_date || todayStr() });
    let feeDelta = 0;
    if (Array.isArray(patch.stages)) {
      const before = oldStages.reduce((a, s) => a + (s.necessity === 'required' ? s.official_fee_aed : 0), 0);
      run('DELETE FROM route_stages WHERE route_id = ?', cur.id);
      patch.stages.forEach((st, i) => insert('route_stages', {
        route_id: cur.id, seq: i + 1, name: st.name, name_ar: st.name_ar || null, owner: st.owner || 'provider', necessity: st.necessity || 'required',
        min_days: st.min_days ?? 1, max_days: st.max_days ?? 3, official_fee_aed: st.official_fee_aed ?? 0, note: st.note || null,
      }));
      const after = patch.stages.reduce((a, s) => a + ((s.necessity || 'required') === 'required' ? (s.official_fee_aed ?? 0) : 0), 0);
      feeDelta = after - before;
    }
    insert('route_versions', { route_id: cur.id, version: newVersion, changed_by: user?.id, summary: summary || 'Registry update', snapshot: JSON.stringify(routeSnapshot(cur.id)) });
    const affected = all(
      `SELECT c.id, c.ref, c.status, c.customer_id, c.doc_count FROM cases c WHERE c.route_id = ? AND c.status IN (${ACTIVE.map(() => '?').join(',')})`, cur.id, ...ACTIVE);
    for (const c of affected) {
      const impact = { feeDeltaPerDoc: feeDeltaOrZero(feeDelta), estimatedDelta: feeDeltaOrZero(feeDelta) * c.doc_count, scopeChanged: Array.isArray(patch.stages), note: 'Review required; customer is notified only if scope, price or action changes. No new spending is authorised automatically.' };
      insert('rule_change_reviews', { route_id: cur.id, from_version: cur.version, to_version: newVersion, case_id: c.id, status: 'open', impact: JSON.stringify(impact) });
      insert('case_events', { case_id: c.id, actor_user_id: user?.id, actor_label: 'Requirements desk', type: 'route_changed', detail: JSON.stringify({ route: slug, from: cur.version, to: newVersion, ...impact }), visibility: 'internal' });
    }
    audit(user, 'route.update', 'route', cur.id, { version: newVersion, affected: affected.length, feeDelta });
    return { version: newVersion, affected: affected.length, feeDelta };
  });
}
const feeDeltaOrZero = (n) => (Number.isFinite(n) ? n : 0);

export function staleRoutes() {
  return all('SELECT id FROM routes').map((r) => getRoute(r.id)).filter((r) => r.freshness.stale)
    .map((r) => ({ slug: r.slug, title: r.title_en, reviewed_on: r.reviewed_on, age_days: r.freshness.age_days, interval: r.review_interval_days }));
}
export const markRouteReviewed = (slug, user) => {
  const r = get('SELECT * FROM routes WHERE slug = ?', slug);
  if (!r) return null;
  update('routes', r.id, { reviewed_on: todayStr(), reviewer: user.name });
  audit(user, 'route.review', 'route', r.id, {});
  return getRoute(r.id);
};
export const _t = { nowIso };
