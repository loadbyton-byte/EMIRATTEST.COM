# Integrations: what runs where

Nothing is hidden behind a mock. When an integration is not configured, the feature degrades visibly (the Settings page shows each status) instead of pretending to work.

| Area | Without configuration | With configuration |
|---|---|---|
| Case lifecycle, quotations, ledger, refunds, registry, audit chain, permissions, MFA | Always active (SQLite) | Same |
| Document text extraction | Tesseract OCR (bundled, offline) and PDF text layer; fields stay provisional until a person confirms them | `LLM_BASE_URL` adds an LLM pass whose values are accepted only if they appear in the scanned text |
| Assistant | Extractive answers from approved knowledge articles; legal questions go to a person | `LLM_BASE_URL` generates answers grounded in the same articles |
| Upload scan | File type/extension agreement, executable signatures, EICAR | `CLAMD_HOST` scans every upload with ClamAV; `CLAMD_REQUIRED=1` rejects uploads when the scanner is down |
| Email | Messages wait in the outbox as `queued_no_transport` and are sent once a transport exists | `SMTP_*` or `RESEND_API_KEY` |
| Push | Disabled | `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` |
| Cards | Bank transfer with finance reconciliation | `STRIPE_SECRET_KEY` + webhook secret |
| WhatsApp | Browser simulator (same engine) | Meta Cloud API or Twilio credentials |
| Backups | Daily SQLite snapshots in `BACKUP_DIR` | `S3_*` also uploads backups and mirrors every document |
| Sign-in | Email + password + TOTP | `OIDC_*` adds single sign-on |

Not part of this software: trade licences, partner contracts, authority (MOFA / MoHESR / immigration) integrations. The product tracks authority stages from evidence supplied by people; it never claims a government connection or that a document is authentic. Legal and privacy texts are drafts that need review by a qualified UAE adviser. Registry data (routes, fees, durations) is seed data with source links and review dates and must be re-verified by operations before launch.
