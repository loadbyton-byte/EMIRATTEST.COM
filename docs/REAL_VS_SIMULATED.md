# What is real, what is simulated

Everything below is exercised by `npm test` / `npm run e2e` unless marked otherwise.

| Area | Status | Notes |
|---|---|---|
| Case lifecycle, tasks, SLA, quotations, variations, refunds, ledger, registry versioning, audit chain | **Real software** | Runs on SQLite; the same code runs on any SQL store after a repository swap (see ARCHITECTURE). |
| Authentication, MFA (TOTP), sessions, role & record isolation, rate limits, CSRF guard | **Real software** | Tested for cross-role isolation. |
| Document upload scan | **Real but basic** | Content/extension agreement, executable signatures, EICAR test signature. A production deployment needs a real AV engine (ClamAV/cloud). |
| Document field extraction | **Sample unless `ANTHROPIC_API_KEY` is set** | Without a key the API returns clearly labelled SAMPLE fields so the review workflow can be shown. With a key it asks Claude to read images/PDFs (untested against real documents here). |
| AI assistant | **Knowledge-base retrieval; Claude if key set** | Answers only from approved articles; legal/eligibility questions are flagged for a person. |
| Card payments | **Mock gateway** (test cards) or **Stripe test mode** with `STRIPE_SECRET_KEY` | The Stripe path (Checkout Session + signed webhook) is implemented but needs your key to run end-to-end. No real money moves. |
| Bank transfers | Real workflow | Case advances only after finance reconciliation. |
| WhatsApp | **Engine real; transport needs credentials** | Simulator uses the same engine. Meta Cloud API (free test number) and Twilio sandbox adapters are implemented; live delivery requires your tokens. Webhook verification, signature check and de-duplication are tested. |
| Email | **Outbox + Resend adapter** | Without `RESEND_API_KEY` messages are stored in the outbox (visible to admins). |
| Android app | **Real native shell** | Capacitor wraps the production web build; APK is built by GitHub Actions (not by this sandbox). Push notifications and Play Store release are future work. |
| Requirement routes, official fees, stage durations, provider data, supplier prices, KB articles | **Sample registry data** | Fictional/illustrative. Each route shows its source link and review date, but values must be re-verified by the requirements desk before live use. |
| Providers, partners, customers, employers, staff | **Fictional** | Emails use the reserved `.example` domain. |
| Licences, partner contracts, MOFA/MoHESR/immigration integrations | **Not claimed** | The plan states no government API is presumed openly available; the app has no such integration. Tracking of authority steps is by recorded evidence, not live government data. |
| Financial figures | **Plan assumptions** | The model page reproduces plan v2.0 figures exactly (tested). Platform metrics on /investors are from seeded demo data, not traction. |
| Legal terms & privacy notice | **Drafts** | Require review by a qualified UAE adviser. |
