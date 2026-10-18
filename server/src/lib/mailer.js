import nodemailer from 'nodemailer';
import { config } from '../config.js';

let transport = null;

export const mailMode = () => (config.mail.smtpUrl || config.mail.host ? 'smtp' : config.mail.resendKey ? 'resend' : 'none');

function getTransport() {
  if (transport) return transport;
  transport = config.mail.smtpUrl
    ? nodemailer.createTransport(config.mail.smtpUrl)
    : nodemailer.createTransport({ host: config.mail.host, port: config.mail.port, secure: config.mail.secure, auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined });
  return transport;
}
export const resetMailer = () => { transport = null; };

/** Send one email through SMTP (Mailpit, Brevo, SES, Gmail relay…) or Resend. Returns { sent, id, error }. */
export async function sendMail({ to, subject, html, text, attachments }) {
  const mode = mailMode();
  if (mode === 'smtp') {
    const info = await getTransport().sendMail({ from: config.mail.from, to, subject, html, text, attachments });
    return { sent: true, id: info.messageId };
  }
  if (mode === 'resend') {
    const resp = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${config.mail.resendKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: config.mail.from, to: [to], subject, html, text }) });
    const j = await resp.json().catch(() => ({}));
    if (!resp.ok) return { sent: false, error: JSON.stringify(j).slice(0, 300) };
    return { sent: true, id: j.id };
  }
  return { sent: false, skipped: true };
}
