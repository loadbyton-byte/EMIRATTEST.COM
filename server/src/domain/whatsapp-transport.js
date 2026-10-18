import { config } from '../config.js';

export const whatsappStatus = () => ({
  meta_cloud_api: !!(config.whatsapp.accessToken && config.whatsapp.phoneNumberId),
  twilio: !!(config.whatsapp.twilioSid && config.whatsapp.twilioToken),
  mode: config.whatsapp.accessToken && config.whatsapp.phoneNumberId ? 'meta' : config.whatsapp.twilioSid ? 'twilio' : 'simulated',
});

/** Send a text message via Meta WhatsApp Cloud API or Twilio. Returns {sent:false} in simulated mode. */
export async function sendWhatsAppText(to, body) {
  const w = config.whatsapp;
  if (w.accessToken && w.phoneNumberId) {
    const r = await fetch(`https://graph.facebook.com/v21.0/${w.phoneNumberId}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${w.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', to: String(to).replace('+', ''), type: 'text', text: { body: body.slice(0, 4000) } }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`WhatsApp send failed: ${JSON.stringify(j).slice(0, 200)}`);
    return { sent: true, id: j.messages?.[0]?.id };
  }
  if (w.twilioSid && w.twilioToken) {
    const form = new URLSearchParams({ From: w.twilioFrom, To: `whatsapp:+${String(to).replace('+', '')}`, Body: body.slice(0, 1500) });
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${w.twilioSid}/Messages.json`, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${w.twilioSid}:${w.twilioToken}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Twilio send failed: ${JSON.stringify(j).slice(0, 200)}`);
    return { sent: true, id: j.sid };
  }
  return { sent: false };
}

/** Download inbound media from the Meta Graph API (requires token). */
export async function downloadMetaMedia(mediaId) {
  const w = config.whatsapp;
  if (!w.accessToken) return null;
  const meta = await (await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, { headers: { Authorization: `Bearer ${w.accessToken}` } })).json();
  if (!meta.url) return null;
  const r = await fetch(meta.url, { headers: { Authorization: `Bearer ${w.accessToken}` } });
  return { buffer: Buffer.from(await r.arrayBuffer()), mime: meta.mime_type };
}
