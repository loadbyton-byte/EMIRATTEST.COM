import { seoResponse, sitemap, robots, llmsIndex } from './lib/seo.js';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { openDb } from './db.js';
import { authenticate } from './lib/auth.js';
import { HttpError } from './lib/util.js';
import { auth } from './routes/auth.js';
import { pub } from './routes/public.js';
import { cases } from './routes/cases.js';
import { documents } from './routes/documents.js';
import { payments } from './routes/payments.js';
import { account } from './routes/account.js';
import { org, invites } from './routes/org.js';
import { provider } from './routes/provider.js';
import { agent } from './routes/agent.js';
import { ops } from './routes/ops.js';
import { whatsapp } from './routes/whatsapp.js';
import { v1 } from './routes/v1.js';
import { logger } from './lib/logger.js';
import { captureError } from './lib/sentry.js';
import { registry, metricsMiddleware } from './lib/metrics.js';
import { get } from './db.js';

export function createApp() {
  openDb();
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), geolocation=(self), microphone=()');
    next();
  });
  app.use(express.json({ limit: '2mb', verify: (req, _res, buf) => { req.rawBody = buf; }, type: (req) => /json/.test(req.headers['content-type'] || '') && !req.url.startsWith('/api/payments/webhook') }));
  // CORS for the Android (Capacitor) shell and other approved origins. Cookie sessions stay same-origin; native apps use Bearer tokens.
  const allowed = new Set(['https://localhost', 'http://localhost', 'capacitor://localhost', 'http://localhost:5173', ...(process.env.CORS_ORIGINS || '').split(',').map((x) => x.trim()).filter(Boolean)]);
  app.use('/api', (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowed.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Requested-With, X-Channel, Idempotency-Key');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use(metricsMiddleware);
  app.use((req, res, next) => {
    const t0 = process.hrtime.bigint();
    res.on('finish', () => {
      if (req.path === '/healthz' || req.path === '/metrics') return;
      logger.info({ method: req.method, path: req.path, status: res.statusCode, ms: Number(process.hrtime.bigint() - t0) / 1e6, user: req.user?.id }, 'request');
    });
    next();
  });
  // Liveness / readiness for load balancers and uptime monitors; Prometheus scrape protected by METRICS_TOKEN when set.
  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.get('/readyz', (_req, res) => { try { get('SELECT 1 AS ok'); res.json({ ok: true }); } catch { res.status(503).json({ ok: false }); } });
  app.get('/metrics', async (req, res) => {
    const token = config.observability.metricsToken;
    if (token && req.headers.authorization !== `Bearer ${token}`) return res.sendStatus(401);
    if (!token && config.nodeEnv === 'production') return res.sendStatus(404);
    res.setHeader('Content-Type', registry.contentType);
    res.end(await registry.metrics());
  });
  app.use('/api', authenticate);
  app.use('/api/auth', auth);
  app.use('/api/public', pub);
  app.use('/api/cases', cases);
  app.use('/api/documents', documents);
  app.use('/api/payments', payments);
  app.use('/api/account', account);
  app.use('/api/org', org);
  app.use('/api/invites', invites);
  app.use('/api/provider', provider);
  app.use('/api/agent', agent);
  app.use('/api/ops', ops);
  app.use('/api/whatsapp', whatsapp);
  app.use('/api/v1', v1);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Unknown API route')));

  app.get('/sitemap.xml', (_req, res) => res.type('application/xml').send(sitemap()));
  app.get('/robots.txt', (_req, res) => res.type('text/plain').send(robots()));
  app.get('/llms.txt', (_req, res) => res.type('text/plain').send(llmsIndex()));

  app.use((req, res, next) => {
    if (req.method === 'GET' && req.path.length > 1 && /\/$/.test(req.path) && !req.path.startsWith('/api')) return res.redirect(301, req.path.replace(/\/+$/, '') + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''));
    next();
  });
  // Built web app (production / demo hosting)
  if (fs.existsSync(path.join(config.webDist, 'index.html'))) {
    app.use(express.static(config.webDist, { maxAge: '1h', index: false, setHeaders: (res, p) => { if (p.endsWith('sw.js') || p.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache'); } }));
    app.get(/^(?!\/api\/).*/, (req, res) => {
      const {html, seo} = seoResponse(req.path, fs.readFileSync(path.join(config.webDist, 'index.html'), 'utf8'));
      res.setHeader('Cache-Control', 'no-cache');
      if (seo.noindex) res.setHeader('X-Robots-Tag', 'noindex, follow');
      res.status(seo.found ? 200 : 404).type('html').send(html);
    });
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status || (err.type === 'entity.too.large' ? 413 : err.type === 'entity.parse.failed' ? 400 : 500);
    if (status >= 500) { logger.error({ err, path: _req.path }, 'unhandled error'); captureError(err, { path: _req.path }); }
    res.status(status).json({ error: status >= 500 ? 'Something went wrong on our side. Please try again.' : err.message, ...(err.extra || {}) });
  });
  return app;
}
