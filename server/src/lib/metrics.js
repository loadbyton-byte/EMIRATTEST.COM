import client from 'prom-client';
import { all } from '../db.js';

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry, prefix: 'emirattest_' });

export const httpDuration = new client.Histogram({
  name: 'emirattest_http_request_duration_seconds', help: 'HTTP request duration', labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5], registers: [registry],
});
new client.Gauge({
  name: 'emirattest_cases_open', help: 'Open cases by status', labelNames: ['status'], registers: [registry],
  collect() {
    this.reset();
    for (const r of all("SELECT status, COUNT(*) AS n FROM cases WHERE status NOT IN ('completed','dispatched','delivered','cancelled','refunded') GROUP BY status")) this.set({ status: r.status }, r.n);
  },
});
new client.Gauge({
  name: 'emirattest_outbox_pending', help: 'Messages waiting to be delivered', labelNames: ['channel'], registers: [registry],
  collect() {
    this.reset();
    for (const r of all("SELECT channel, COUNT(*) AS n FROM outbox WHERE status IN ('pending','queued_no_transport') GROUP BY channel")) this.set({ channel: r.channel }, r.n);
  },
});

/** Express middleware recording request duration by route pattern (never raw URLs, so ids do not explode label cardinality). */
export function metricsMiddleware(req, res, next) {
  const end = httpDuration.startTimer();
  res.on('finish', () => end({ method: req.method, route: req.route?.path ? `${req.baseUrl}${req.route.path}` : req.baseUrl || 'unmatched', status: res.statusCode }));
  next();
}
