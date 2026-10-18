# EMIRATTEST experience review — 18 October 2026

## Scope and evidence

Source inventory and architecture comparison, targeted reading of public experience, shared components, styling, routes, portals and domain boundaries. This is not a line-by-line security audit or a claim that every logistics feature has been ported.

Loadbyton reference: 66 web source entries. EMIRATTEST retains its existing API and role boundaries.

## Adaptation decisions

| Reference | EMIRATTEST adaptation |
| --- | --- |
| Cinematic hero with contextual record | Practical document review photograph and route finder |
| Logistics job lifecycle | Review → approve → follow → receive |
| Sector navigation | Education, family and business journeys plus existing complete catalogue |
| Shared page hero | Consistent introductions on catalogue, fees, requirements, business, tracking and trust |
| Operational record presentation | Clearly labelled illustrative team desk; real tracking stays behind existing verification |
| Product and sector photographs | Original document handover, Khor Fakkan coast, Al Ain oasis and office review imagery |
| Shared UI primitives | Existing React primitives restyled across customer, business, provider, agent and ops portals |

## Competitor findings

- Prompt / attestationuae.com: document and country navigation, fee enquiry, collection/delivery, tracking and related services.
- BVS Global: end-to-end service framing, status visibility, document collection and case support.
- Benchmark: educational, personal and commercial documents, collection and progress updates.
- Applied the useful customer journeys; did not copy competitor endorsements, certifications, customer counts, ratings, prices or service guarantees.

Sources inspected:
- https://attestationuae.com/
- https://www.bvsglobal.com/uae/certificate-document-attestation-dubai-abu-dhabi/
- https://certificateattestation.ae/about-benchmark-attestation-services/

## Existing functionality retained

Customer requests, private document storage, family records, planner, bookings, organisation approvals, bulk intake, purchasing, billing, reports, integrations, provider assignments, field-agent tasks, operations queue, registry, support, finance, privacy, audit and system screens. New CTAs use these existing routes.

## Quality and release limits

- Production Vite build and existing 35-test server suite pass.
- Responsive rules cover 320px through desktop, including inline two-column form overrides and compact mobile navigation.
- Keyboard-native controls, menu expanded state, skip link and reduced-motion handling added.
- Browser visual and interaction testing was not completed: no browser executable/control-browser surface is available in this checkout.
- Existing legal drafts, demonstration accounts and integration requirements remain visible; this UI change does not activate external services.
- English-first editorial copy is added. Core hero/finder has Arabic strings; remaining new editorial copy requires full Arabic localisation before claiming a fully bilingual redesign.
- No live deployment was performed by this change.

## Source inventory

### Loadbyton web

| File | Lines |
| --- | ---: |
| `admin-console.tsx` | 147 |
| `admin-einvoice.tsx` | 50 |
| `admin-readiness.tsx` | 50 |
| `admin.tsx` | 225 |
| `api-delivery.ts` | 106 |
| `api.tsx` | 88 |
| `app-core.tsx` | 791 |
| `app-customs.tsx` | 394 |
| `app-delivery.tsx` | 566 |
| `app-driver.tsx` | 257 |
| `app-fulfil.tsx` | 547 |
| `app-ops.tsx` | 273 |
| `app-sales.tsx` | 333 |
| `app-specialists.tsx` | 50 |
| `app-transport.tsx` | 239 |
| `app-warehouse.tsx` | 407 |
| `appkit.tsx` | 165 |
| `assistant.tsx` | 24 |
| `auth.tsx` | 332 |
| `brand.tsx` | 70 |
| `brochure.tsx` | 187 |
| `carrier-booking.tsx` | 63 |
| `carrier-feeds.tsx` | 57 |
| `chargeable-weight.tsx` | 25 |
| `chat.tsx` | 162 |
| `connections.tsx` | 24 |
| `count-schedules.tsx` | 24 |
| `delivery-finance.tsx` | 44 |
| `device-certs.tsx` | 38 |
| `devices.tsx` | 95 |
| `document-drafts.tsx` | 39 |
| `eawb.tsx` | 47 |
| `einvoice.tsx` | 135 |
| `experience.tsx` | 106 |
| `extraction.tsx` | 58 |
| `feeds.tsx` | 79 |
| `finance-bridge.tsx` | 175 |
| `freight-commercial.tsx` | 219 |
| `fulfil-lots.tsx` | 25 |
| `fulfil-ops.tsx` | 71 |
| `fulfil-sites.tsx` | 45 |
| `fulfil-storage.tsx` | 25 |
| `home.tsx` | 219 |
| `inbound.tsx` | 103 |
| `ledger.tsx` | 74 |
| `mw.ts` | 147 |
| `order-pulls.tsx` | 61 |
| `pages-marketing.tsx` | 279 |
| `portal.tsx` | 521 |
| `printing.tsx` | 57 |
| `privacy.tsx` | 26 |
| `public.tsx` | 474 |
| `requests.tsx` | 444 |
| `rf-pins.tsx` | 22 |
| `sector-demo.tsx` | 185 |
| `security.tsx` | 30 |
| `service.tsx` | 45 |
| `site-kit.tsx` | 83 |
| `stock-migration.tsx` | 62 |
| `storefront.tsx` | 79 |
| `thread.tsx` | 22 |
| `transport-live.tsx` | 47 |
| `ui.tsx` | 365 |
| `verify.tsx` | 86 |
| `warehouse-policy.tsx` | 69 |
| `workspace.tsx` | 71 |

### EMIRATTEST web

| File | Lines |
| --- | ---: |
| `App.jsx` | 46 |
| `api.js` | 44 |
| `app/Shell.jsx` | 28 |
| `app/agent.jsx` | 70 |
| `app/case.jsx` | 131 |
| `app/customer.jsx` | 158 |
| `app/ops.jsx` | 158 |
| `app/org.jsx` | 88 |
| `app/provider.jsx` | 48 |
| `auth.jsx` | 37 |
| `components/Experience.jsx` | 56 |
| `experience.css` | 7 |
| `i18n.jsx` | 47 |
| `main.jsx` | 12 |
| `pages/account.jsx` | 29 |
| `pages/auth.jsx` | 102 |
| `pages/public.jsx` | 168 |
| `styles.css` | 123 |
| `ui.jsx` | 111 |

### EMIRATTEST server

| File | Lines |
| --- | ---: |
| `app.js` | 100 |
| `bootstrap.js` | 27 |
| `config.js` | 47 |
| `db.js` | 81 |
| `domain/access.js` | 77 |
| `domain/ai.js` | 95 |
| `domain/cases.js` | 186 |
| `domain/catalog-data.js` | 311 |
| `domain/catalog.js` | 134 |
| `domain/documents.js` | 138 |
| `domain/finance.js` | 107 |
| `domain/notify.js` | 56 |
| `domain/operations.js` | 147 |
| `domain/payments.js` | 136 |
| `domain/planner.js` | 36 |
| `domain/pricing.js` | 78 |
| `domain/privacy.js` | 69 |
| `domain/providers.js` | 48 |
| `domain/quotes.js` | 137 |
| `domain/time.js` | 36 |
| `domain/webhooks.js` | 33 |
| `domain/whatsapp-transport.js` | 36 |
| `domain/whatsapp.js` | 185 |
| `index.js` | 33 |
| `jobs.js` | 56 |
| `lib/audit.js` | 25 |
| `lib/auth.js` | 127 |
| `lib/backup.js` | 40 |
| `lib/clamav.js` | 50 |
| `lib/integrations.js` | 19 |
| `lib/llm.js` | 26 |
| `lib/logger.js` | 9 |
| `lib/mailer.js` | 31 |
| `lib/metrics.js` | 31 |
| `lib/objectstore.js` | 62 |
| `lib/ocr.js` | 92 |
| `lib/oidc.js` | 58 |
| `lib/pdf.js` | 96 |
| `lib/push.js` | 31 |
| `lib/sentry.js` | 11 |
| `lib/util.js` | 83 |
| `routes/account.js` | 174 |
| `routes/agent.js` | 62 |
| `routes/auth.js` | 187 |
| `routes/cases.js` | 221 |
| `routes/documents.js` | 97 |
| `routes/ops.js` | 269 |
| `routes/org.js` | 238 |
| `routes/payments.js` | 68 |
| `routes/provider.js` | 85 |
| `routes/public.js` | 96 |
| `routes/v1.js` | 46 |
| `routes/whatsapp.js` | 74 |
| `schema.js` | 295 |
| `seed.js` | 332 |
