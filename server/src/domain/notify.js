import { all, get, insert, update, run } from '../db.js';
import { config } from '../config.js';
import { nowIso, waIdOf } from '../lib/util.js';
import { mailMode, sendMail } from '../lib/mailer.js';
import { pushEnabled, pushToUser } from '../lib/push.js';

/** Create an in-app notification and queue email/WhatsApp according to the recipient's consent and channel availability. */
export function notify(userId, { title, body, link, kind = 'info', email = true, whatsapp = false }) {
  const u = get('SELECT * FROM users WHERE id = ?', userId);
  if (!u) return;
  insert('notifications', { user_id: userId, kind, title, body: body || null, link: link || null });
  if (email && u.email && !u.email.endsWith('.example')) {
    insert('outbox', { channel: 'email', to_addr: u.email, subject: title, body: renderEmail(u, title, body, link), user_id: userId });
  }
  if (pushEnabled() && get('SELECT 1 AS x FROM push_subscriptions WHERE user_id = ? LIMIT 1', userId)) {
    insert('outbox', { channel: 'push', to_addr: String(userId), subject: title, body: JSON.stringify({ body: body || '', link: link || '/app' }), user_id: userId });
  }
  if (whatsapp && u.phone) {
    const consent = get("SELECT granted FROM consents WHERE user_id = ? AND kind = 'renewal_reminders'", userId);
    if (!consent || consent.granted) insert('outbox', { channel: 'whatsapp', to_addr: waIdOf(u.phone), subject: title, body: `${title}\n${body || ''}${link ? `\n${config.baseUrl}${link}` : ''}`.trim(), user_id: userId });
  }
}
export const notifyMany = (ids, payload) => [...new Set(ids.filter(Boolean))].forEach((id) => notify(id, payload));
export const notifyRole = (roles, payload) => all(`SELECT id FROM users WHERE role IN (${roles.map(() => '?').join(',')}) AND status = 'active'`, ...roles).forEach((u) => notify(u.id, { email: false, ...payload }));

export function renderEmail(u, title, body, link) {
  const url = link ? `${config.baseUrl}${link}` : config.baseUrl;
  return `<!doctype html><html><body style="margin:0;background:#F2F7F4;font-family:Arial,sans-serif;color:#151B18"><table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px"><table width="600" style="max-width:600px;width:100%;background:#fff;border-radius:8px"><tr><td style="padding:28px"><img src="${config.baseUrl}/brand/primary-full-color.png" alt="Emirattest. Documents cleared. Life moves." width="360" style="max-width:100%;height:auto"></td></tr><tr><td style="padding:0 28px 28px"><h1 style="font-size:22px;margin:0 0 12px">${esc(title)}</h1><p>Hello ${esc(u.name)},</p><p style="line-height:1.6">${esc(body || '')}</p><p><a href="${esc(url)}" style="display:inline-block;background:#007A45;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Open in Emirattest</a></p><p style="font-size:12px;color:#58645E;margin-top:28px">Emirattest never asks for your password or UAE Pass one-time codes by email, chat or phone.</p></td></tr></table></td></tr></table></body></html>`;
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Deliver pending outbox rows. Sends via SMTP/Resend and WhatsApp when configured; without a transport the rows stay visible as 'queued_no_transport' and are retried once one is configured. */
export async function flushOutbox(limit = 25) {
  const rows = all("SELECT * FROM outbox WHERE status = 'pending' ORDER BY id LIMIT ?", limit);
  for (const r of rows) {
    try {
      if (r.channel === 'email') {
        if (mailMode() === 'none') { update('outbox', r.id, { status: 'queued_no_transport' }); continue; }
        const out = await sendMail({ to: r.to_addr, subject: r.subject, html: r.body });
        update('outbox', r.id, out.sent ? { status: 'sent', provider_ref: out.id, sent_at: nowIso() } : { status: 'failed', error: out.error || 'send failed' });
      } else if (r.channel === 'push') {
        const p = JSON.parse(r.body || '{}');
        const out = await pushToUser(Number(r.to_addr), { title: r.subject, body: p.body, link: p.link });
        update('outbox', r.id, { status: out.sent ? 'sent' : 'failed', error: out.sent ? null : 'no live subscription', sent_at: nowIso() });
      } else if (r.channel === 'whatsapp') {
        const { sendWhatsAppText } = await import('./whatsapp-transport.js');
        const out = await sendWhatsAppText(r.to_addr, r.body);
        update('outbox', r.id, out.sent ? { status: 'sent', provider_ref: out.id || null, sent_at: nowIso() } : { status: 'queued_no_transport' });
      } else update('outbox', r.id, { status: 'failed', error: 'unknown channel' });
    } catch (e) {
      update('outbox', r.id, { status: 'failed', error: String(e.message).slice(0, 300) });
    }
  }
  return rows.length;
}
export const _r = { run };
