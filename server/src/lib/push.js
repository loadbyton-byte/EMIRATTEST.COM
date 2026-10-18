import { config } from '../config.js';
import { all, run } from '../db.js';

export const pushEnabled = () => !!(config.push.publicKey && config.push.privateKey);

let wp = null;
async function lib() {
  if (!wp) {
    wp = (await import('web-push')).default;
    wp.setVapidDetails(config.push.subject, config.push.publicKey, config.push.privateKey);
  }
  return wp;
}
export const resetPush = () => { wp = null; };

/** Deliver a Web Push message to every browser/PWA/Android subscription of a user. Dead subscriptions are removed. */
export async function pushToUser(userId, { title, body, link }) {
  if (!pushEnabled()) return { sent: 0, skipped: true };
  const subs = all('SELECT * FROM push_subscriptions WHERE user_id = ?', userId);
  const webpush = await lib();
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ title, body, link: link || '/app' }), { TTL: 3600 });
      sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) run('DELETE FROM push_subscriptions WHERE id = ?', s.id);
    }
  }
  return { sent };
}
