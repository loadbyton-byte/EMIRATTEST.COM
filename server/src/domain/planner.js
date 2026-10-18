import { all, get, json } from '../db.js';
import { getRoute } from './catalog.js';
import { todayStr, addDays, daysBetween } from '../lib/util.js';

/**
 * Deadline & dependency planner. Authority estimates (ranges) are kept separate from Emirattest commitments,
 * and a probabilistic range is never presented as a guarantee.
 */
export function deadlinePlan(c) {
  const route = c.route_id ? getRoute(c.route_id) : null;
  const today = todayStr();
  const done = json(c.details, {}).stages_done || [];
  const openCustomer = all("SELECT title, due_at FROM case_tasks WHERE case_id = ? AND owner_kind = 'customer' AND status = 'open'", c.id);
  const appts = all("SELECT kind, at, location FROM appointments WHERE case_id = ? AND status = 'booked' AND at >= ? ORDER BY at", c.id, today);
  if (!route) return { stages: [], remaining: { min: 0, max: 0 }, target_date: c.target_date, status: 'no_route', message: 'This service has no staged route; Emirattest will confirm timing in your quotation.', open_customer_actions: openCustomer, appointments: appts, commitments: commitments() };
  let cumMin = 0; let cumMax = 0;
  const stages = route.stages.map((s) => {
    const skip = s.necessity === 'unnecessary_if_done';
    const completed = done.includes(s.seq);
    const counted = !skip && !completed && s.necessity !== 'conditional';
    if (counted) { cumMin += s.min_days; cumMax += s.max_days; }
    return { seq: s.seq, name: s.name, owner: s.owner, necessity: s.necessity, min_days: s.min_days, max_days: s.max_days, status: completed ? 'completed' : skip ? 'not_required' : 'pending', earliest: counted ? addDays(today, cumMin) : null, latest: counted ? addDays(today, cumMax) : null, note: s.note, source: s.owner === 'authority' ? 'Authority estimate' : 'Partner estimate' };
  });
  const earliest = addDays(today, cumMin); const latest = addDays(today, cumMax);
  let status = 'on_track'; let message = `Authority and partner estimates suggest ${cumMin}–${cumMax} days remaining.`;
  const uncertain = route.freshness.stale || route.stages.some((s) => s.owner === 'authority' && !done.includes(s.seq) && s.necessity === 'required');
  if (c.target_date) {
    const slack = daysBetween(latest, c.target_date);
    if (c.target_date < earliest) { status = 'insufficient'; message = `Your target date ${c.target_date} is earlier than the fastest estimate (${earliest}). Consider expedited handling (it prices extra effort; it cannot guarantee an authority decision) or a later date.`; }
    else if (slack < 0) { status = 'tight'; message = `Target date ${c.target_date} falls inside the estimate window (${earliest} to ${latest}); completion by then is possible but not assured.`; }
    else if (uncertain) { status = 'uncertain'; message = `Estimates fit your target date ${c.target_date}, but they include authority timing or registry data not under Emirattest's control.`; }
  } else status = uncertain ? 'uncertain' : 'on_track';
  if (openCustomer.length) message += ` ${openCustomer.length} customer action(s) open — delays on your side move every date.`;
  return { stages, remaining: { min: cumMin, max: cumMax }, earliest, latest, target_date: c.target_date, status, message, open_customer_actions: openCustomer, appointments: appts, route: { slug: route.slug, version: route.version, reviewed_on: route.reviewed_on, stale: route.freshness.stale }, commitments: commitments() };
}
const commitments = () => ({ enquiry_acknowledgement: 'within 4 business hours', standard_quotation: 'within 1 business day after complete information', updates: 'at agreed milestones and whenever an exception materially changes the service', note: 'These are service targets measured against published business hours. Authority timings are estimates, not commitments.' });
