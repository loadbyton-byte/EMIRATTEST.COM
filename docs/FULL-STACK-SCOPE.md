# Full-stack implementation and operating boundaries

This implementation maps the supplied Emirattest business plan (version 2.0, 18 October 2026) to persisted workflows. Catalogue presence is not evidence of a licence, supplier contract or government approval.

| Business-plan capability | Implemented application surface |
|---|---|
| Thirty services with distinct commercial models | Shared catalogue, service details, intake, requirements and estimates; production readiness register per service |
| Individuals and families | Authenticated customer workspace, consent, family records, private documents, cases, quotes, payments, tracking, delivery and feedback |
| Business customers | Organisation membership and roles, employees, bulk intake, approvals, cost centres, invoices, API keys and paid workspace subscription |
| Operations and providers | Case review, provider assignments, stages, evidence, courier custody, supplier fulfilment desk and customer-visible booking history |
| Travel and related supplier bookings | Persisted bookings, payment collection, awaiting-supplier queue, evidence-backed issue, failure/retry, cancellation request and supplier cancellation confirmation |
| Refunds and finance | Independent approval, additional approver at configured threshold, actual payout reference, partial refunds, supplier recovery records, receipts and ledger events |
| Privacy and resilience | Role and tenant authorization, private file access, deletion guards, retention, antivirus integration, backups, SMTP outbox and audit chain |
| Channels and knowledge | Website, WhatsApp integration/simulator, mobile layouts, reviewed guidance, source links, sitemap and structured data |

## Newly enforced boundaries

A collected payment does not issue a supplier booking. Only an authorised provider or operations user can record issuance, with a supplier reference and evidence reference. Pending coordination income is deferred until issuance. Cancellation after collection remains a request until supplier confirmation. Refund approval does not claim money has moved: finance records a separate payout reference. Supplier reimbursement is tracked separately from the customer's refund.

A business subscription starts pending payment. Verified collection activates its paid period; expiry removes the paid tier while retaining core case and purchased evidence access. Checkout retries reuse the outstanding payment. Signed Stripe completion events must also report a paid AED session with the expected amount and session identity.

In production, services default to enquiry-only. Administrators activate a delivery arrangement by recording the legal operating entity, jurisdiction, activity scope, licence/agreement/permission references, responsible manager, applicable authorised supplier and review expiry. Expired arrangements block new checkout. This register is an internal evidence control; it does not independently validate documents or confer authority.

## Deployment and acceptance

Follow [DEPLOY.md](DEPLOY.md) and [INTEGRATIONS.md](INTEGRATIONS.md). Run `npm test` and `npm run build`; GitHub CI additionally runs the browser suite. The enterprise integration tests cover tenant isolation, supplier issuance, cancellation, independently approved refunds, actual payout references, bank reconciliation identity, production readiness, subscription collection/expiry and Stripe payment verification.

Use persistent storage and `DEMO_MODE=0`, configure the real payment processor and webhook, staff MFA, mail, malware scanning and backups. Review all migrated financial records and pre-existing subscriptions before accepting production collections. Existing demo fixtures are fictional. Test a restore and perform operational acceptance with real authorised suppliers before launch.

Supplier/API contracts, regulated permissions, bank disbursement automation and authority approvals require actual commercial and operational setup. Manual payout recording does not initiate a bank transfer. No universal legal-country coverage, guaranteed search ranking, certification of accounting treatment or live production deployment is claimed. Country guidance requires continuing review against official sources; unpublished/unreviewed country records remain marked for review.
