# Free-tier deployment

## Fastest: Render (free web service, Docker)
1. Push this repo to GitHub (already done for this branch).
2. Render → **New → Blueprint** → select the repo → it reads `render.yaml` at the repo root and builds `Dockerfile`.
3. After first deploy set `APP_BASE_URL` to the service URL and redeploy. Open `/demo`.

Free instances sleep and have no persistent disk: the demo database re-seeds on every cold start (~10 s). Attach a disk or move to Postgres for persistence.

## Any container host (Fly.io, Railway, Koyeb, Cloud Run)
`docker build -t emirattest . && docker run -p 8787:8787 -e DEMO_MODE=1 emirattest` — one process serves API + web.

## Environment
See `.env.example` for every switch (`DEMO_MODE`, `STRIPE_*`, `WHATSAPP_*`, `TWILIO_*`, `LLM_*`, `SMTP_*`, `S3_*`, `CLAMD_*`, `VAPID_*`, `OIDC_*`, `REQUIRE_STAFF_MFA`, `CORS_ORIGINS`).

For production set `DEMO_MODE=0`: the persona launcher, mock card gateway and open WhatsApp simulator are disabled, and `SESSION_SECRET` must be set.

## Production checklist

1. Copy `.env.example` to `.env`; set `SESSION_SECRET` (`openssl rand -hex 32`), `APP_BASE_URL`, `DEMO_MODE=0`, `REQUIRE_STAFF_MFA=1`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`.
2. `docker compose up -d --build`. First boot loads the catalogue and creates the administrator; run `docker compose exec app node server/scripts/create-admin.js you@example.org` (with `ADMIN_PASSWORD` set) to print the authenticator key. Remove `ADMIN_PASSWORD` from the environment afterwards.
3. Put a TLS reverse proxy (Caddy, Traefik, nginx) in front; the app trusts one proxy hop.
4. Configure mail (`SMTP_*`), storage mirror (`S3_*`), ClamAV (`CLAMD_HOST`) and, if wanted, an LLM endpoint.
5. Scrape `/metrics` with Prometheus using `METRICS_TOKEN`; point an uptime monitor at `/healthz`.
6. Backups run every `BACKUP_EVERY_HOURS` into `BACKUP_DIR` (and S3 when set). Restore with the server stopped: `npm run restore -w server -- <file>.db.gz`. Test a restore before launch.
7. Continuous replication is possible with Litestream against `DATA_DIR/emirattest.db`.
