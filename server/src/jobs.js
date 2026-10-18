import { all, get, update, run } from './db.js';
import { config } from './config.js';
import { createBackup } from './lib/backup.js';
import { mirrorPending } from './lib/objectstore.js';
import { applyRetention, housekeeping } from './domain/privacy.js';
import { logger } from './lib/logger.js';
import { captureError } from './lib/sentry.js';
import { flushOutbox, notify } from './domain/notify.js';
import { runWebhookQueue } from './domain/webhooks.js';
import { expireQuotes } from './domain/quotes.js';
import { addDays, todayStr } from './lib/util.js';

/** Create reminders-due notifications only for genuine expiry/renewal dates and only with the user's consent. */
export function generateReminderNotices() {
  const horizon = addDays(todayStr(), 30);
  const rows = all("SELECT * FROM reminders WHERE status = 'scheduled' AND due_date <= ?", horizon);
  let n = 0;
  for (const r of rows) {
    const consent = get("SELECT granted FROM consents WHERE user_id = ? AND kind = 'renewal_reminders'", r.user_id);
    if (!consent?.granted) continue;
    notify(r.user_id, { title: `Reminder: ${r.title}`, body: `Due ${r.due_date}. This reminder is based on a real expiry/renewal date you saved.`, link: '/app/documents', kind: 'reminder', whatsapp: true });
    update('reminders', r.id, { status: 'notified' });
    n++;
  }
  return n;
}
/** Record a named job run so operators can see when it last succeeded. */
async function tracked(name, everyMs, fn) {
  const last = get('SELECT * FROM job_runs WHERE name = ?', name);
  if (everyMs && last?.last_ok_at && Date.now() - new Date(last.last_ok_at.replace(' ', 'T') + 'Z').getTime() < everyMs) return null;
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  try {
    const out = await fn();
    run('INSERT INTO job_runs(name,last_run_at,last_ok_at,status,detail) VALUES(?,?,?,?,?) ON CONFLICT(name) DO UPDATE SET last_run_at=excluded.last_run_at,last_ok_at=excluded.last_ok_at,status=excluded.status,detail=excluded.detail', name, now, now, 'ok', JSON.stringify(out ?? null));
    return out;
  } catch (e) {
    logger.error({ err: e, job: name }, 'job failed');
    captureError(e, { job: name });
    run('INSERT INTO job_runs(name,last_run_at,status,detail) VALUES(?,?,?,?) ON CONFLICT(name) DO UPDATE SET last_run_at=excluded.last_run_at,status=excluded.status,detail=excluded.detail', name, now, 'failed', String(e.message).slice(0, 300));
    return null;
  }
}
export function expireSubscriptions(){
 const rows=all("SELECT id,org_id FROM subscriptions WHERE status='active' AND paid_through IS NOT NULL AND paid_through < ?",todayStr());
 for(const s of rows){update('subscriptions',s.id,{status:'expired'});if(!get("SELECT id FROM subscriptions WHERE org_id=? AND status='active'",s.org_id))update('orgs',s.org_id,{tier:'per_case'});}return rows.length;
}
export async function tick() {
  const out = { subscriptions_expired:expireSubscriptions(), quotes_expired: expireQuotes(), reminders: generateReminderNotices(), outbox: await flushOutbox(), webhooks: await runWebhookQueue() };
  out.mirrored = await tracked('s3_mirror', 0, mirrorPending);
  out.backup = await tracked('backup', config.backup.everyHours * 3600000, createBackup);
  out.retention = await tracked('retention', 24 * 3600000, () => applyRetention());
  await tracked('housekeeping', 6 * 3600000, async () => housekeeping());
  return out;
}
export function startJobs(ms = 15000) {
  if (process.env.EMT_NO_JOBS === '1') return null;
  const t = setInterval(() => tick().catch((e) => logger.error({ err: e }, 'job tick failed')), ms);
  t.unref();
  return t;
}
