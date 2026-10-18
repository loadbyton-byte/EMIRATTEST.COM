import { config } from '../config.js';

let Sentry = null;
/** Error tracking is optional: set SENTRY_DSN (Sentry free tier or self-hosted GlitchTip). */
export async function initSentry() {
  if (!config.observability.sentryDsn) return null;
  Sentry = await import('@sentry/node');
  Sentry.init({ dsn: config.observability.sentryDsn, environment: config.nodeEnv, tracesSampleRate: 0 });
  return Sentry;
}
export const captureError = (e, ctx) => { if (Sentry) Sentry.captureException(e, { extra: ctx }); };
