# WhatsApp bot — free-tier setup

The conversation engine is channel-independent (`server/src/domain/whatsapp.js`). Out of the box it runs in **simulated** mode (`/whatsapp-demo` and `POST /api/whatsapp/simulate`). To go live use either free option:

## Option A — Meta WhatsApp Cloud API (free test number)
1. developers.facebook.com → Create app → *Business* → add **WhatsApp**. Meta gives a free test phone number and lets you add up to 5 recipient numbers.
2. Copy the **temporary access token** and **Phone number ID** to env: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`. Optionally `WHATSAPP_APP_SECRET` to enforce `X-Hub-Signature-256`.
3. Expose your server over HTTPS (Render URL or `ngrok http 8787`). In *WhatsApp → Configuration* set Callback URL `https://<host>/api/whatsapp/webhook` and Verify token = `WHATSAPP_VERIFY_TOKEN` (default `emirattest-verify`); subscribe to **messages**.
4. Message the test number. To be recognised as a customer the sender number must match a user's phone (Settings → profile).

## Option B — Twilio WhatsApp sandbox (free trial)
1. Twilio Console → Messaging → *Try it out → Send a WhatsApp message*; join the sandbox from your phone.
2. Set the sandbox **When a message comes in** URL to `https://<host>/api/whatsapp/twilio` (HTTP POST). Replies are returned as TwiML.
3. For proactive sends (staff replies, reminders) set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`.

## Behaviour guarantees (tested)
* Never asks for passwords or UAE Pass one-time codes; says so in the menu.
* Case details only for the number linked to the customer account; others get a privacy refusal and a handoff offer.
* `APPROVE EMT-26-000123` accepts the quotation (respecting approval limits) and returns a secure payment link; payment is verified server-side.
* Media uploads are scanned, attached to the case and acknowledged **without** claiming authenticity.
* Handoff keeps context, silences the bot, notifies support; staff replies from Operations → Support go out through the same transport.
* Duplicate webhook deliveries (same message id) are ignored.
* Outside the 24-hour window Meta only allows approved templates — register templates before using proactive notifications in production.
