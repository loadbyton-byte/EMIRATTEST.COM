import { all, get, json, update } from '../db.js';
import { getService, getRoute } from './catalog.js';

export const providerOut = (p) => ({ ...p, emirates: json(p.emirates, []), covers: json(p.covers, []), price_schedule: json(p.price_schedule, {}), license_verified: !!p.license_verified, sponsored: !!p.sponsored });

/** Completed-case metrics over the last 90 days with an explicit sample size. */
export function providerMetrics(providerId, today = new Date()) {
  const since = new Date(today.getTime() - 90 * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  const done = all("SELECT id, target_date, closed_at, created_at FROM cases WHERE provider_id = ? AND status IN ('completed','dispatched','delivered') AND COALESCE(closed_at, updated_at) >= ?", providerId, since);
  const completed = done.length;
  const onTime = done.filter((c) => !c.target_date || (c.closed_at || '').slice(0, 10) <= c.target_date).length;
  const fb = all('SELECT rating FROM provider_feedback WHERE provider_id = ? AND verified = 1 AND challenged = 0 AND created_at >= ?', providerId, since);
  const avg = fb.length ? fb.reduce((a, r) => a + r.rating, 0) / fb.length : null;
  const total = get("SELECT COUNT(*) AS n FROM cases WHERE provider_id = ? AND status IN ('completed','dispatched','delivered')", providerId).n;
  const openLoad = get("SELECT COUNT(*) AS n FROM cases WHERE provider_id = ? AND status IN ('assigned','collected','submitted','authority_pending','provider_pending','correction_required')", providerId).n;
  return { period: 'last 90 days', completed_cases: completed, lifetime_completed: total, on_time_pct: completed ? Math.round((onTime / completed) * 100) : null, feedback_avg: avg === null ? null : Math.round(avg * 10) / 10, feedback_n: fb.length, open_load: openLoad };
}

/** Eligible providers for a service/route/emirate. Sponsored placement is shown separately and never influences ranking. */
export function eligibleProviders({ serviceSlug, routeSlug, emirate, docCount = 1 }) {
  const svc = getService(serviceSlug);
  const route = routeSlug ? getRoute(routeSlug) : (svc?.default_route_slug ? getRoute(svc.default_route_slug) : null);
  const kinds = route
    ? route.doc_category === 'translation' ? ['translator'] : route.doc_category === 'pro' ? ['pro_firm'] : ['attestation_processor']
    : svc?.category === 'travel' ? ['travel_supplier', 'insurer'] : svc?.category === 'mobility' ? ['consultant'] : svc?.category === 'resident' ? ['bank_partner', 'telecom'] : svc?.category === 'logistics' ? ['courier'] : svc?.category === 'pro' ? ['pro_firm'] : ['attestation_processor'];
  const list = all("SELECT * FROM providers WHERE status = 'active' AND license_verified = 1").map(providerOut).filter((p) => kinds.includes(p.kind));
  const rows = [];
  for (const p of list) {
    const reasons = [];
    if (route && p.covers.length && !p.covers.includes(route.slug) && !p.covers.includes('*') && !p.covers.includes(route.doc_category)) continue;
    if (svc && p.covers.length && route === null && !p.covers.includes(svc.slug) && !p.covers.includes('*') && !p.covers.includes(svc.category)) continue;
    if (emirate && p.emirates.length && !p.emirates.includes(emirate)) reasons.push(`Does not collect in ${emirate}`);
    const m = providerMetrics(p.id);
    if (m.open_load + docCount > p.capacity_per_week * 2) reasons.push('At capacity');
    const score = (m.on_time_pct ?? 70) * 0.4 + ((m.feedback_avg ?? 3.5) / 5) * 100 * 0.3 + Math.min(m.lifetime_completed / 100, 1) * 100 * 0.2 + (1 - Math.min(Math.max(p.price_factor - 0.8, 0), 0.6) / 0.6) * 100 * 0.1;
    rows.push({ id: p.id, name: p.name, kind: p.kind, bio: p.bio, emirates: p.emirates, price_factor: p.price_factor, sponsored: p.sponsored, disclosure: p.disclosure, license_verified: p.license_verified, metrics: m, score: Math.round(score * 10) / 10, ineligible_reasons: reasons, eligible: reasons.length === 0 });
  }
  const eligible = rows.filter((r) => r.eligible);
  const organic = eligible.filter((r) => !r.sponsored).sort((a, b) => b.score - a.score);
  return {
    top3: organic.slice(0, 3).map((r, i) => ({ ...r, rank: i + 1 })),
    all: eligible.sort((a, b) => b.score - a.score),
    sponsored: eligible.filter((r) => r.sponsored),
    unavailable: rows.filter((r) => !r.eligible),
    note: 'No provider is preselected. Ranking uses service-route coverage, capacity, completed-case counts, on-time rate and verified feedback; sponsored placement is labelled and excluded from ranking.',
  };
}
export const _u = { update };
