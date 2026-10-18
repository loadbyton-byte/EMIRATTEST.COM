import crypto from 'node:crypto';
import { all, get, insert, update, json } from '../db.js';
import { randomToken, nowIso } from '../lib/util.js';

/** Queue signed webhook deliveries for an organisation's active endpoints. */
export function emitOrgEvent(orgId, event, data) {
  const eps = all('SELECT * FROM webhook_endpoints WHERE org_id = ? AND active = 1', orgId).filter((e) => { const ev = json(e.events, ['*']); return ev.includes('*') || ev.includes(event); });
  for (const ep of eps) {
    const delivery_id = `evt_${randomToken(10)}`;
    insert('webhook_deliveries', { endpoint_id: ep.id, event, payload: JSON.stringify({ id: delivery_id, type: event, created: new Date().toISOString(), data }), delivery_id, status: 'pending', next_attempt_at: nowIso() });
  }
}
export const signPayload = (secret, ts, body) => crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');

const BACKOFF_MIN = [0, 1, 5, 30, 120];
/** Deliver due webhooks with retries and exponential-ish backoff; failures stay visible. Idempotent via delivery id header. */
export async function runWebhookQueue(limit = 20, fetchImpl = fetch) {
  const due = all("SELECT * FROM webhook_deliveries WHERE status IN ('pending','retrying') AND next_attempt_at <= ? ORDER BY id LIMIT ?", nowIso(), limit);
  for (const d of due) {
    const ep = get('SELECT * FROM webhook_endpoints WHERE id = ?', d.endpoint_id);
    const ts = Math.floor(Date.now() / 1000);
    try {
      const resp = await fetchImpl(ep.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Emirattest-Event': d.event, 'X-Emirattest-Delivery': d.delivery_id, 'X-Emirattest-Timestamp': String(ts), 'X-Emirattest-Signature': `sha256=${signPayload(ep.secret, ts, d.payload)}` }, body: d.payload, signal: AbortSignal.timeout(8000) });
      if (resp.ok) update('webhook_deliveries', d.id, { status: 'delivered', attempt: d.attempt + 1, response_code: resp.status, error: null });
      else throw Object.assign(new Error(`HTTP ${resp.status}`), { code: resp.status });
    } catch (e) {
      const attempt = d.attempt + 1;
      if (attempt >= BACKOFF_MIN.length) update('webhook_deliveries', d.id, { status: 'failed', attempt, error: String(e.message).slice(0, 200), response_code: e.code || null });
      else update('webhook_deliveries', d.id, { status: 'retrying', attempt, error: String(e.message).slice(0, 200), response_code: e.code || null, next_attempt_at: new Date(Date.now() + BACKOFF_MIN[attempt] * 60000).toISOString().replace('T', ' ').slice(0, 19) });
    }
  }
  return due.length;
}
