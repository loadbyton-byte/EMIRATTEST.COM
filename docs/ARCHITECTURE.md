# Architecture

```
 Web / PWA (React)   Android (Capacitor)   WhatsApp (Meta / Twilio)   Enterprise API (/api/v1)
        └───────────────┴────────────────────┴────────────────────────────┘
                                   Express 5 API
            auth · MFA · record isolation · rate limits · CSRF guard · hash-chained audit
   ┌────────────┬──────────────┬─────────────────┬──────────────┬────────────┬────────────┐
   Case engine  Fee engine     Requirements      Documents      Ledger &     Assistants
   lifecycle    quotes/        registry          scan/versions  finance      AI + KB +
   tasks/SLA    variations     versions/impact   signed links   settlements  WhatsApp
   └────────────┴──────────────┴─────────────────┴──────────────┴────────────┴────────────┘
        SQLite (node:sqlite) · private upload dir · outbox/webhook queues · background jobs
```

## Principles taken from the business plan
* **One case owner, named task owners** — every status has an owner and a next action with a due time (`domain/cases.js`).
* **Estimate ≠ quotation ≠ variation** — `domain/pricing.js`, `domain/quotes.js`; accepted versions are immutable; extra spend needs approval.
* **Official charges ≠ retained revenue** — ledger accounts `authority_payable`, `supplier_payable`, `vat_payable`, `deferred_service_fee`, `service_fee_revenue`, `refund` (`domain/payments.js`, `domain/finance.js`).
* **Evidence, not elapsed time, moves cases** — stages complete only with an evidence reference; custody events record capture vs sync time.
* **Access by explicit permission** — `domain/access.js` resolves a case/profile access level per user; a shared phone or email domain grants nothing. Separate tests prove customer ↔ customer, employer ↔ family, HR ↔ documents, provider ↔ unassigned cases.
* **Registry as a product** — routes carry version, sources, reviewer, review interval; changing one creates review tasks for affected active cases without authorising spend (`domain/catalog.js`).

## Code map
```
server/src/
  app.js index.js jobs.js seed.js config.js db.js schema.js
  lib/    auth.js (scrypt, sessions, TOTP, rate limit) audit.js util.js
  domain/ catalog* pricing providers cases quotes payments operations documents
          planner finance access notify webhooks ai whatsapp whatsapp-transport time
  routes/ auth public cases documents payments account org provider agent ops whatsapp v1
web/src/  pages/ (public, auth, account)  app/ (customer, case, org, provider, agent, ops, Shell)
mobile/   Capacitor config + brand icon/splash sources
```

## Path to production (the "complete IT structure" funding buys)
1. **Data** — move `db.js` from SQLite to managed Postgres (schema is plain SQL; wrapper is 60 lines); object storage for uploads (S3-compatible, UAE-resident if required).
2. **Identity** — SSO for staff with enforced MFA (`REQUIRE_STAFF_MFA=1`), enterprise IdP integration for organisations, device/session management (already revocable).
3. **Queues** — outbox, webhook and reminder jobs already isolated in `jobs.js`; move to a durable queue/worker.
4. **Security** — real AV, WAF, secrets manager, pen-test, backup/restore drills (RPO 24h, RTO 8 business hours as proposed in the plan).
5. **Observability** — structured logs/metrics/alerts; error tracking.
6. **Integrations** — only where credentials and tested interfaces exist: payment acquirer, WhatsApp Business, courier/travel/insurance suppliers.
