import { all, get, update } from './db.js';
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
export async function tick() {
  const out = { quotes_expired: expireQuotes(), reminders: generateReminderNotices(), outbox: await flushOutbox(), webhooks: await runWebhookQueue() };
  return out;
}
export function startJobs(ms = 15000) {
  if (process.env.EMT_NO_JOBS === '1') return null;
  const t = setInterval(() => tick().catch((e) => console.error('[jobs]', e.message)), ms);
  t.unref();
  return t;
}
