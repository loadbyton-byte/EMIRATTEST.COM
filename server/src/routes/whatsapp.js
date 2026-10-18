import express, { Router } from 'express';
import crypto from 'node:crypto';
import { all, get } from '../db.js';
import { config } from '../config.js';
import { handleInbound, conversationMessages } from '../domain/whatsapp.js';
import { sendWhatsAppText, downloadMetaMedia, whatsappStatus } from '../domain/whatsapp-transport.js';
import { isStaff, rateLimit } from '../lib/auth.js';
import { validate, bad, forbidden, waIdOf, safeEqual } from '../lib/util.js';

export const whatsapp = Router();

whatsapp.get('/status', (_req, res) => res.json({ ...whatsappStatus(), webhook_path: '/api/whatsapp/webhook', twilio_path: '/api/whatsapp/twilio', verify_token_configured: !!config.whatsapp.verifyToken }));

// Meta Cloud API verification handshake
whatsapp.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && safeEqual(req.query['hub.verify_token'] || '', config.whatsapp.verifyToken)) return res.status(200).send(String(req.query['hub.challenge']));
  res.sendStatus(403);
});

function validSignature(req) {
  if (!config.whatsapp.appSecret) return true; // unsigned only when no app secret configured (local/dev)
  const sig = (req.headers['x-hub-signature-256'] || '').replace('sha256=', '');
  const expected = crypto.createHmac('sha256', config.whatsapp.appSecret).update(req.rawBody || '').digest('hex');
  return safeEqual(sig, expected);
}

whatsapp.post('/webhook', async (req, res) => {
  if (!validSignature(req)) return res.sendStatus(401);
  res.sendStatus(200); // acknowledge fast; process after
  try {
    for (const entry of req.body?.entry || []) for (const ch of entry.changes || []) {
      const v = ch.value || {};
      for (const m of v.messages || []) {
        const name = v.contacts?.find((c) => c.wa_id === m.from)?.profile?.name;
        let text = ''; let media = null;
        if (m.type === 'text') text = m.text?.body || '';
        else if (m.type === 'interactive') text = m.interactive?.button_reply?.id || m.interactive?.list_reply?.id || '';
        else if (['image', 'document'].includes(m.type)) { const id = m[m.type]?.id; const dl = id ? await downloadMetaMedia(id).catch(() => null) : null; text = m[m.type]?.caption || ''; media = dl ? { buffer: dl.buffer, mime: dl.mime, filename: m.document?.filename || `${m.type}-${m.id}` } : null; if (!media) text = text || '[media]'; }
        const out = await handleInbound({ channel: 'whatsapp', waId: m.from, name, text, media, waMsgId: m.id });
        for (const r of out.replies) await sendWhatsAppText(m.from, r).catch((e) => console.error('[whatsapp] send failed', e.message));
      }
    }
  } catch (e) { console.error('[whatsapp] webhook error', e); }
});

// Twilio WhatsApp sandbox (application/x-www-form-urlencoded) → TwiML
whatsapp.post('/twilio', express.urlencoded({ extended: false }), async (req, res) => {
  const from = waIdOf((req.body.From || '').replace('whatsapp:', ''));
  if (!from) return res.sendStatus(400);
  let media = null;
  if (Number(req.body.NumMedia) > 0 && req.body.MediaUrl0) {
    try { const r = await fetch(req.body.MediaUrl0, { headers: config.whatsapp.twilioSid ? { Authorization: `Basic ${Buffer.from(`${config.whatsapp.twilioSid}:${config.whatsapp.twilioToken}`).toString('base64')}` } : {} }); media = { buffer: Buffer.from(await r.arrayBuffer()), mime: req.body.MediaContentType0, filename: `twilio-${Date.now()}` }; } catch { /* ignore */ }
  }
  const out = await handleInbound({ channel: 'whatsapp', waId: from, name: req.body.ProfileName, text: req.body.Body || '', media, waMsgId: req.body.MessageSid });
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?><Response>${out.replies.map((r) => `<Message>${esc(r)}</Message>`).join('')}</Response>`);
});

/** Browser simulator used for sample-data mode and tests. Identical engine to the live webhook. */
whatsapp.post('/simulate', rateLimit({ windowMs: 60000, max: 120, name: 'wasim' }), async (req, res) => {
  if (!config.demoMode && !isStaff(req.user)) throw forbidden('Simulator is available in demo mode or to staff');
  const b = validate(req.body, { phone: 'string!', name: 'string', text: 'string', media: 'object' });
  const waId = waIdOf(b.phone);
  if (!/^\d{8,15}$/.test(waId)) throw bad('Enter a phone number in international format');
  const media = b.media?.base64 ? { buffer: Buffer.from(b.media.base64, 'base64'), mime: b.media.mime, filename: b.media.filename } : null;
  const out = await handleInbound({ channel: 'sim', waId, name: b.name, text: b.text || '', media });
  res.json({ replies: out.replies, handoff: !!out.conversation.handoff, state: out.conversation.state, lang: out.conversation.lang });
});
whatsapp.get('/simulate/:phone', (req, res) => {
  if (!config.demoMode && !isStaff(req.user)) throw forbidden();
  const c = get("SELECT * FROM conversations WHERE channel = 'sim' AND wa_id = ?", waIdOf(req.params.phone));
  res.json({ messages: c ? conversationMessages(c.id).map((m) => ({ direction: m.direction, body: m.body, sender: m.sender, ts: m.ts })) : [], handoff: !!c?.handoff });
});
export const _wa = { all };
