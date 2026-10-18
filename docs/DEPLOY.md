# Free-tier deployment

## Fastest: Render (free web service, Docker)
1. Push this repo to GitHub (already done for this branch).
2. Render → **New → Blueprint** → select the repo → it reads `render.yaml` at the repo root and builds `Dockerfile`.
3. After first deploy set `APP_BASE_URL` to the service URL and redeploy. Open `/demo`.

Free instances sleep and have no persistent disk: the demo database re-seeds on every cold start (~10 s). Attach a disk or move to Postgres for persistence.

## Any container host (Fly.io, Railway, Koyeb, Cloud Run)
`docker build -t emirattest . && docker run -p 8787:8787 -e DEMO_MODE=1 emirattest` — one process serves API + web.

## Environment
See `.env.example`. Key switches: `DEMO_MODE` (persona launcher, mock gateway, simulator), `STRIPE_SECRET_KEY`, `WHATSAPP_*`, `TWILIO_*`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `REQUIRE_STAFF_MFA`, `CORS_ORIGINS`.

For production set `DEMO_MODE=0`: the persona launcher, mock card gateway and open WhatsApp simulator are disabled, and `SESSION_SECRET` must be set.
