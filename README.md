<p align="center"><img src="web/public/brand/primary-full-color.png" alt="Emirattest — Documents cleared. Life moves." width="420"></p>

# Emirattest — attestation, PRO & relocation platform

Full-stack platform built from **Emirattest Business Plan v2.0** and the Emirattest brand kit. Every integration uses free tiers or open-source software that you can self-host.

| Channel | What it is | Where |
|---|---|---|
| **Web app** (responsive + installable PWA, push notifications) | Public site, customer workspace, business workspace, provider portal, field-agent tool, operations/support/finance/admin consoles | `web/` |
| **Android app** | Capacitor shell around the same app (camera capture, offline agent queue), built into an APK by GitHub Actions | `mobile/`, `.github/workflows/android.yml` |
| **WhatsApp bot** | One conversation engine behind the Meta Cloud API webhook, a Twilio webhook and an in-browser phone simulator | `server/src/domain/whatsapp.js` |
| **API** | Express 5 + SQLite (`node:sqlite`); enterprise `/api/v1` with API keys, idempotency and signed webhooks | `server/` |

## Run it

```bash
npm install
npm run build        # builds the React app into web/dist
npm start            # API + web on http://localhost:8787
```

* **Evaluation / training** (`DEMO_MODE=1`, the default outside production): an empty database is filled with fictional people and cases; **/demo** lists every persona (password `Demo@12345`), **/whatsapp-demo** drives the bot.
* **Real deployment** (`DEMO_MODE=0`): only the catalogue, routes, requirements registry and knowledge base are loaded, plus one administrator from `ADMIN_EMAIL` / `ADMIN_PASSWORD` (or `npm run create-admin -w server -- you@example.org`, which prints an authenticator key).
* **Docker**: `cp .env.example .env && docker compose up --build` (app + Mailpit inbox on :8025). `docker compose --profile full up` adds ClamAV, MinIO and Ollama.

Development with hot reload: `npm run dev` (web on :5173, API on :8787). Tests: `npm test` · `npm run e2e` (Chromium drives every role).

## Free-tier / open-source stack

| Need | Component | Configure |
|---|---|---|
| Document text extraction | **Tesseract** (English + Arabic, bundled, offline) and **pdf-parse** | `OCR_*` |
| AI assistant & field refinement | Any **OpenAI-compatible** server: Ollama, llama.cpp, vLLM, Groq / OpenRouter free tiers | `LLM_*` |
| Antivirus | **ClamAV** (`clamd` INSTREAM) | `CLAMD_*` |
| Email | **SMTP** (Mailpit, Brevo, Mailjet, SES, own server) or Resend | `SMTP_*`, `RESEND_API_KEY` |
| Push notifications | **Web Push** (VAPID, no third party) | `VAPID_*` |
| Off-box storage & backups | **S3-compatible** (MinIO, Cloudflare R2, Backblaze B2, Wasabi) | `S3_*` |
| Single sign-on | **OpenID Connect** (Keycloak, Authentik, Authelia, Google, Entra) | `OIDC_*` |
| Cards | **Stripe** (test mode free) | `STRIPE_*` |
| WhatsApp | **Meta Cloud API** test number or **Twilio** sandbox | `WHATSAPP_*`, `TWILIO_*` |
| Monitoring | **Prometheus** `/metrics`, **pino** logs, `/healthz`, optional **Sentry/GlitchTip** | `METRICS_TOKEN`, `SENTRY_DSN` |

## What is in the box (mapped to the plan)

* **Catalogue** — all 7 plan categories, 30 services; versioned **requirements registry** (stages, sources, reviewer, review date, stale alerts, apostille-vs-embassy logic, rule-change impact on active cases).
* **Fee engine** — estimate → reviewed quotation → approved variation; authority/courier charges shown as actual-cost pass-through; VAT only on Emirattest fees; readiness-review credit; emergency limit.
* **Case engine** — 17-state lifecycle with evidence-based progress, tasks with owners and next-update dates, SLA tracking (4 business hours / 1 business day), rejection recovery, completion pack.
* **Documents** — private storage, SHA-256 receipts, upload scan (type/extension mismatch, executables, EICAR) plus ClamAV when configured, versioning, expiring signed links with access log, mismatch/completeness controls, Tesseract OCR extraction (provisional until confirmed), optional open-source LLM refinement, verification records.
* **Money** — double-entry-style ledger separating deferred fees, recognised revenue, authority/supplier pass-through, VAT, refunds; server-side payment verification (card via mock gateway or Stripe test mode; bank transfer needs finance reconciliation); dual-approval refunds; provider settlements; 13-week cash forecast; planning model for finance users.
* **People & permissions** — consumer, family (scoped/expiring grants, guardians), organisation roles (owner/submitter/approver/finance/HR/auditor), providers, field agents, support, ops, finance, admin; MFA (TOTP); hash-chained audit log.
* **Business workspace** — bulk CSV intake, employee consent & readiness board, POs/budgets/credit limits, consolidated invoices, reports + CSV export, API keys, signed webhooks.
* **Field network** — offline-first agent app: custody events keep capture time vs sync time, idempotent sync, authorised-recipient check, incidents.
* **WhatsApp** — requirements, estimates, tracking (linked number only), quote approval → payment link, document upload, pickup request, human handoff, Arabic/English.
* **Brand** — official logo, icons, colours and DejaVu Sans applied across web, email, PWA, Android and WhatsApp; Arabic RTL.

## Documentation

[`ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`API.md`](docs/API.md) · [`WHATSAPP.md`](docs/WHATSAPP.md) · [`ANDROID.md`](docs/ANDROID.md) · [`DEPLOY.md`](docs/DEPLOY.md) · [`INTEGRATIONS.md`](docs/INTEGRATIONS.md)

## Public guidance and search metadata

The knowledge centre is at `/guides`; the country/territory directory is at `/countries`. Published procedural summaries carry source links, a fixed editorial source-check date and a 30-day review-due state. Unreviewed country entries do not assert a procedure and are excluded from the sitemap. These pages are not individual legal advice or a claim of support in every jurisdiction.

Set `SEO_BASE_URL` to the production canonical origin. The Node server supplies article text and metadata in initial HTML, `/sitemap.xml`, `/robots.txt` and `/llms.txt`. Deploy with the supplied Docker/Node runtime, including `shared/`; a static-only Vite deployment does not run those server routes. Search metadata is an implementation foundation, not a guarantee of ranking or AI citation.

See `docs/KNOWLEDGE-SEO-REVIEW.md` for scope, source limitations and verification. Browser smoke coverage includes the new public pages; run the existing CI workflow for Chromium checks.
