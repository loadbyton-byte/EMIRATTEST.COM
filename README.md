<p align="center"><img src="web/public/brand/primary-full-color.png" alt="Emirattest — Documents cleared. Life moves." width="420"></p>

# Emirattest — attestation, PRO & relocation platform

Full-stack investor demonstration built from **Emirattest Business Plan v2.0 (18 Oct 2026)** and the Emirattest brand kit:

| Channel | What it is | Where |
|---|---|---|
| **Web app** (responsive + installable PWA) | Public site, customer workspace, business workspace, provider portal, field-agent tool, operations/support/finance/admin consoles, investor overview | `web/` |
| **Android app** | Capacitor shell around the same app (camera capture, offline agent queue), built into an APK by GitHub Actions | `mobile/`, `.github/workflows/emirattest-android.yml` |
| **WhatsApp bot** | One conversation engine behind the Meta Cloud API webhook, a Twilio sandbox webhook, and an in-browser phone simulator | `server/src/domain/whatsapp.js` |
| **API** | Express 5 + SQLite (`node:sqlite`), 23 automated tests; enterprise `/api/v1` with API keys, idempotency and signed webhooks | `server/` |

> **Read this first:** it is a working product with fictional data. Payments, WhatsApp delivery, email and AI run in *demonstration mode* until you add free-tier credentials; no licence, partner contract, government integration or customer traction is claimed. See [`docs/REAL_VS_SIMULATED.md`](docs/REAL_VS_SIMULATED.md).

## Run it (2 minutes)

```bash
npm install
npm run build        # builds the React app into web/dist
npm start            # API + web on http://localhost:8787 (seeds demo data on first boot)
```

Development with hot reload: `npm run dev` (web on :5173, API on :8787).
Tests: `npm test` (API/WhatsApp, 23 tests) · `npm run e2e` (Chromium drives every role; screenshots in `web/test-results/`).

Open **/demo** for one-click access to every persona (password `Demo@12345`), **/investors** for the investor overview and live financial model, **/whatsapp-demo** for the bot.

## What is in the box (mapped to the plan)

* **Catalogue** — all 7 plan categories, 30 services; versioned **requirements registry** (stages, sources, reviewer, review date, stale alerts, apostille-vs-embassy logic, rule-change impact on active cases).
* **Fee engine** — estimate → reviewed quotation → approved variation; authority/courier charges shown as actual-cost pass-through; VAT only on Emirattest fees; readiness-review credit; emergency limit.
* **Case engine** — 17-state lifecycle with evidence-based progress, tasks with owners and next-update dates, SLA tracking (4 business hours / 1 business day), rejection recovery, completion pack.
* **Documents** — private storage, SHA-256 receipts, upload scan (type/extension mismatch, executables, EICAR), versioning, expiring signed links with access log, mismatch/completeness controls, provisional AI extraction (clearly labelled), verification records.
* **Money** — double-entry-style ledger separating deferred fees, recognised revenue, authority/supplier pass-through, VAT, refunds; server-side payment verification (card via mock gateway or Stripe test mode; bank transfer needs finance reconciliation); dual-approval refunds; provider settlements; 13-week cash forecast; plan financial model.
* **People & permissions** — consumer, family (scoped/expiring grants, guardians), organisation roles (owner/submitter/approver/finance/HR/auditor), providers, field agents, support, ops, finance, admin; MFA (TOTP); hash-chained audit log.
* **Business workspace** — bulk CSV intake, employee consent & readiness board, POs/budgets/credit limits, consolidated invoices, reports + CSV export, API keys, signed webhooks.
* **Field network** — offline-first agent app: custody events keep capture time vs sync time, idempotent sync, authorised-recipient check, incidents.
* **WhatsApp** — requirements, estimates, tracking (linked number only), quote approval → payment link, document upload, pickup request, human handoff, Arabic/English.
* **Brand** — official logo, icons, colours and DejaVu Sans applied across web, email, PWA, Android and WhatsApp; Arabic RTL.

## Documentation

[`INVESTOR_BRIEF.md`](docs/INVESTOR_BRIEF.md) · [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`API.md`](docs/API.md) · [`WHATSAPP.md`](docs/WHATSAPP.md) · [`ANDROID.md`](docs/ANDROID.md) · [`DEPLOY.md`](docs/DEPLOY.md) · [`REAL_VS_SIMULATED.md`](docs/REAL_VS_SIMULATED.md)

