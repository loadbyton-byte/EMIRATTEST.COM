# API overview

Base path `/api`. JSON in/out. Auth: httpOnly cookie (web, needs `X-Requested-With: emirattest` on writes) or `Authorization: Bearer <token>` (native, API clients). Errors: `{ "error": "message" }`.

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/register · /auth/login (202 → mfa_required) · /auth/logout · GET /auth/me · PATCH /auth/me · POST /auth/password · /auth/mfa/{setup,enable,disable} · GET /auth/sessions · POST /auth/sessions/revoke-all · GET /auth/demo-personas` |
| Public | `GET /public/{config,categories,services,services/:slug,routes,routes/:slug,kb} · POST /public/{estimate,providers/eligible,assistant,callback,track} · GET /public/investor/{model,platform}` |
| Cases | `GET/POST /cases · GET /cases/:id · /cases/:id/{planner,readiness,providers,completion-pack} · POST /cases/:id/{documents,submit,provider,messages,cancel,recovery,appointments,complaints,feedback} · POST /cases/:id/quotes/:qid/{accept,reject}` |
| Documents | `GET /documents/:id/{link,history,file(signed)} · POST /documents/:id/{extract,verification} · PATCH/DELETE /documents/:id` |
| Payments | `GET /payments/:token · POST /payments/:token/{charge,stripe,bank-proof} · POST /payments/webhook/stripe` |
| Account | `GET /account/{notifications,profiles,consents,reminders,readiness-records,export,suppliers,bookings} · POST /account/{profiles,profiles/:id/grants,reminders,dsr,bookings,bookings/:id/confirm}` |
| Organisation | `GET /org/:id · /org/:id/{members,purchasing,employees,invoices,reports/:type,integrations} · POST /org/:id/{bulk/validate,bulk/commit,employees,cost-centers,purchase-orders,invoices/generate,subscription,api-keys,webhooks,webhooks/test}` · public `GET/POST /invites/:token…` |
| Provider | `GET /provider/{me,assignments,assignments/:id,settlements} · POST /provider/assignments/:id/{request-info,stage,submission,exception} · PATCH /provider/profile` |
| Field agent | `GET /agent/tasks[/:id] · POST /agent/events (single or batch, idempotent by client_event_id) · POST /agent/events/:id/photo · POST /agent/incidents` |
| Operations | `GET /ops/{dashboard,cases,cases/:id,network,routes,providers,support,finance/*,users,audit,settings,outbox}` and workbench actions under `/ops/cases/:id/*` |
| WhatsApp | `GET/POST /whatsapp/webhook (Meta) · POST /whatsapp/twilio · POST /whatsapp/simulate · GET /whatsapp/status` |
| Enterprise API | `GET /v1/cases[/:ref] · POST /v1/cases` with `Authorization: Bearer emt_live_…` and mandatory `Idempotency-Key` |

Webhook deliveries (`POST` to your endpoint) carry `X-Emirattest-Event`, `X-Emirattest-Delivery` (unique id), `X-Emirattest-Timestamp` and `X-Emirattest-Signature: sha256=HMAC(secret, "<timestamp>.<body>")`; failures retry with backoff (0, 1, 5, 30, 120 min) and stay visible in the workspace.
