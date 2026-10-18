// Emirattest database schema (SQLite via node:sqlite). Money is stored as AED with 2dp (REAL) for demo readability.
export const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, phone TEXT, name TEXT NOT NULL,
  password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'customer', lang TEXT NOT NULL DEFAULT 'en',
  mfa_secret TEXT, mfa_enabled INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active',
  demo_label TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL, revoked_at TEXT, device TEXT
);

CREATE TABLE IF NOT EXISTS orgs (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, trn TEXT, tier TEXT NOT NULL DEFAULT 'per_case',
  credit_limit REAL NOT NULL DEFAULT 0, account_manager_id INTEGER REFERENCES users(id), status TEXT NOT NULL DEFAULT 'active',
  non_solicit_terms TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS org_members (
  org_id INTEGER NOT NULL REFERENCES orgs(id), user_id INTEGER NOT NULL REFERENCES users(id),
  role TEXT NOT NULL, approval_limit REAL NOT NULL DEFAULT 0, department TEXT, PRIMARY KEY (org_id, user_id)
);
CREATE TABLE IF NOT EXISTS cost_centers (
  id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES orgs(id), code TEXT NOT NULL, name TEXT NOT NULL, budget REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS purchase_orders (
  id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES orgs(id), number TEXT NOT NULL, cost_center_id INTEGER REFERENCES cost_centers(id),
  amount REAL NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES orgs(id), plan TEXT NOT NULL, price_aed REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', started_at TEXT NOT NULL DEFAULT (datetime('now')), cancelled_at TEXT
);

CREATE TABLE IF NOT EXISTS profiles (
  id INTEGER PRIMARY KEY, owner_user_id INTEGER NOT NULL REFERENCES users(id), org_id INTEGER REFERENCES orgs(id),
  relation TEXT NOT NULL DEFAULT 'self', full_name TEXT NOT NULL, dob TEXT, nationality TEXT, passport_no TEXT, emirates_id TEXT,
  email TEXT, phone TEXT, is_minor INTEGER NOT NULL DEFAULT 0, guardian_note TEXT, consent_status TEXT NOT NULL DEFAULT 'self',
  invite_token TEXT, invite_status TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS profile_grants (
  id INTEGER PRIMARY KEY, profile_id INTEGER NOT NULL REFERENCES profiles(id), grantee_user_id INTEGER NOT NULL REFERENCES users(id),
  scope_type TEXT NOT NULL, scope_id INTEGER, purpose TEXT NOT NULL, expires_at TEXT, granted_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')), revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS consents (
  user_id INTEGER NOT NULL REFERENCES users(id), kind TEXT NOT NULL, granted INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (user_id, kind)
);
CREATE TABLE IF NOT EXISTS dsr_requests (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
  note TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS routes (
  id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, title_en TEXT NOT NULL, title_ar TEXT, doc_category TEXT NOT NULL,
  issuing_country TEXT, use_destination TEXT, purpose TEXT, apostille_applicable INTEGER NOT NULL DEFAULT 0, summary TEXT,
  version INTEGER NOT NULL DEFAULT 1, effective_date TEXT, reviewed_on TEXT, reviewer TEXT, review_interval_days INTEGER NOT NULL DEFAULT 90,
  source_urls TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'active', digital_available INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS route_stages (
  id INTEGER PRIMARY KEY, route_id INTEGER NOT NULL REFERENCES routes(id), seq INTEGER NOT NULL, name TEXT NOT NULL, name_ar TEXT,
  owner TEXT NOT NULL DEFAULT 'provider', necessity TEXT NOT NULL DEFAULT 'required', min_days INTEGER NOT NULL DEFAULT 1,
  max_days INTEGER NOT NULL DEFAULT 3, official_fee_aed REAL NOT NULL DEFAULT 0, note TEXT
);
CREATE TABLE IF NOT EXISTS route_requirements (
  id INTEGER PRIMARY KEY, route_id INTEGER NOT NULL REFERENCES routes(id), seq INTEGER NOT NULL, label TEXT NOT NULL, label_ar TEXT, mandatory INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS route_versions (
  id INTEGER PRIMARY KEY, route_id INTEGER NOT NULL REFERENCES routes(id), version INTEGER NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (datetime('now')), changed_by INTEGER REFERENCES users(id), summary TEXT, snapshot TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rule_change_reviews (
  id INTEGER PRIMARY KEY, route_id INTEGER NOT NULL REFERENCES routes(id), from_version INTEGER, to_version INTEGER,
  case_id INTEGER, status TEXT NOT NULL DEFAULT 'open', assigned_to INTEGER REFERENCES users(id), impact TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, category TEXT NOT NULL, name_en TEXT NOT NULL, name_ar TEXT NOT NULL,
  summary_en TEXT NOT NULL, summary_ar TEXT NOT NULL, pricing_basis TEXT NOT NULL, base_fee_aed REAL NOT NULL DEFAULT 0,
  business_fee_aed REAL NOT NULL DEFAULT 0, regulated INTEGER NOT NULL DEFAULT 0, eligibility_note TEXT, default_route_slug TEXT,
  requirements TEXT NOT NULL DEFAULT '[]', delivery_note TEXT, icon TEXT, sort INTEGER NOT NULL DEFAULT 0, kind TEXT NOT NULL DEFAULT 'case'
);

CREATE TABLE IF NOT EXISTS providers (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, license_no TEXT, license_verified INTEGER NOT NULL DEFAULT 0,
  emirates TEXT NOT NULL DEFAULT '[]', covers TEXT NOT NULL DEFAULT '[]', price_factor REAL NOT NULL DEFAULT 1,
  capacity_per_week INTEGER NOT NULL DEFAULT 20, sponsored INTEGER NOT NULL DEFAULT 0, disclosure TEXT, status TEXT NOT NULL DEFAULT 'active',
  contact_name TEXT, contact_phone TEXT, contact_email TEXT, bio TEXT, price_schedule TEXT NOT NULL DEFAULT '{}',
  suspended_reason TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS provider_users (provider_id INTEGER NOT NULL REFERENCES providers(id), user_id INTEGER NOT NULL REFERENCES users(id), PRIMARY KEY (provider_id, user_id));
CREATE TABLE IF NOT EXISTS provider_feedback (
  id INTEGER PRIMARY KEY, provider_id INTEGER NOT NULL REFERENCES providers(id), case_id INTEGER, rating INTEGER NOT NULL, comment TEXT,
  verified INTEGER NOT NULL DEFAULT 1, challenged INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS agent_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id), emirates TEXT NOT NULL DEFAULT '[]', capacity_per_day INTEGER NOT NULL DEFAULT 8,
  vehicle TEXT, status TEXT NOT NULL DEFAULT 'active', employer TEXT
);

CREATE TABLE IF NOT EXISTS cases (
  id INTEGER PRIMARY KEY, ref TEXT UNIQUE NOT NULL, customer_id INTEGER NOT NULL REFERENCES users(id), org_id INTEGER REFERENCES orgs(id),
  profile_id INTEGER REFERENCES profiles(id), service_id INTEGER NOT NULL REFERENCES services(id), route_id INTEGER REFERENCES routes(id),
  route_version INTEGER, title TEXT NOT NULL, purpose TEXT, destination_country TEXT, issuing_country TEXT, doc_count INTEGER NOT NULL DEFAULT 1,
  target_date TEXT, status TEXT NOT NULL DEFAULT 'draft', next_action TEXT, next_action_owner TEXT, next_update_due TEXT,
  owner_staff_id INTEGER REFERENCES users(id), provider_id INTEGER REFERENCES providers(id), channel TEXT NOT NULL DEFAULT 'web',
  client_ref TEXT, client_alias TEXT, expedited INTEGER NOT NULL DEFAULT 0, pickup_emirate TEXT, delivery_emirate TEXT,
  po_number TEXT, cost_center_id INTEGER REFERENCES cost_centers(id), readiness_review_paid INTEGER NOT NULL DEFAULT 0,
  rejection_reason TEXT, root_cause TEXT, share_with_employer INTEGER NOT NULL DEFAULT 0, details TEXT NOT NULL DEFAULT '{}',
  first_response_at TEXT, quoted_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), closed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_cases_customer ON cases(customer_id);
CREATE INDEX IF NOT EXISTS idx_cases_org ON cases(org_id);
CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);
CREATE TABLE IF NOT EXISTS case_events (
  id INTEGER PRIMARY KEY, case_id INTEGER NOT NULL REFERENCES cases(id), ts TEXT NOT NULL DEFAULT (datetime('now')),
  actor_user_id INTEGER, actor_label TEXT, type TEXT NOT NULL, from_status TEXT, to_status TEXT, detail TEXT, visibility TEXT NOT NULL DEFAULT 'customer'
);
CREATE INDEX IF NOT EXISTS idx_events_case ON case_events(case_id);
CREATE TABLE IF NOT EXISTS case_tasks (
  id INTEGER PRIMARY KEY, case_id INTEGER NOT NULL REFERENCES cases(id), title TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'other',
  owner_kind TEXT NOT NULL DEFAULT 'emirattest', owner_user_id INTEGER REFERENCES users(id), provider_id INTEGER REFERENCES providers(id),
  status TEXT NOT NULL DEFAULT 'open', due_at TEXT, scheduled_at TEXT, address TEXT, emirate TEXT, contact_permission INTEGER NOT NULL DEFAULT 0,
  depends_on_task_id INTEGER, next_action TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_case ON case_tasks(case_id);
CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY, case_id INTEGER NOT NULL REFERENCES cases(id), version INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'quotation',
  status TEXT NOT NULL DEFAULT 'draft', lines TEXT NOT NULL DEFAULT '[]', subtotal_fee REAL NOT NULL DEFAULT 0, vat REAL NOT NULL DEFAULT 0,
  pass_through_total REAL NOT NULL DEFAULT 0, total REAL NOT NULL DEFAULT 0, valid_until TEXT, exclusions TEXT NOT NULL DEFAULT '[]',
  assumptions TEXT NOT NULL DEFAULT '[]', created_by INTEGER REFERENCES users(id), approved_by INTEGER REFERENCES users(id), accepted_at TEXT,
  emergency_limit_aed REAL NOT NULL DEFAULT 0, parent_quote_id INTEGER, reason TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_quotes_case ON quotes(case_id);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY, case_id INTEGER REFERENCES cases(id), profile_id INTEGER REFERENCES profiles(id), owner_user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL, filename TEXT NOT NULL, mime TEXT, size INTEGER NOT NULL DEFAULT 0, sha256 TEXT, storage_key TEXT,
  version INTEGER NOT NULL DEFAULT 1, replaces_id INTEGER, role TEXT NOT NULL DEFAULT 'original', scan_status TEXT NOT NULL DEFAULT 'pending', scan_note TEXT,
  extracted TEXT NOT NULL DEFAULT '{}', extraction_source TEXT, confirmed INTEGER NOT NULL DEFAULT 0, issues TEXT NOT NULL DEFAULT '[]',
  purpose TEXT, issuing_authority TEXT, issuing_country TEXT, doc_number TEXT, holder_name TEXT, issue_date TEXT, expiry_date TEXT,
  pages_declared INTEGER, pages_uploaded INTEGER, verification_method TEXT, verification_result TEXT, verification_source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_docs_case ON documents(case_id);
CREATE TABLE IF NOT EXISTS document_access_log (
  id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL, user_id INTEGER, action TEXT NOT NULL, purpose TEXT, ts TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY, case_id INTEGER REFERENCES cases(id), quote_id INTEGER REFERENCES quotes(id), user_id INTEGER REFERENCES users(id),
  org_id INTEGER, kind TEXT NOT NULL DEFAULT 'quote', method TEXT NOT NULL DEFAULT 'card', provider TEXT NOT NULL DEFAULT 'mock', provider_ref TEXT,
  token TEXT UNIQUE, amount REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'AED', status TEXT NOT NULL DEFAULT 'pending', receipt_no TEXT,
  proof_note TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), verified_at TEXT
);
CREATE TABLE IF NOT EXISTS ledger_entries (
  id INTEGER PRIMARY KEY, ts TEXT NOT NULL DEFAULT (datetime('now')), case_id INTEGER, payment_id INTEGER, provider_id INTEGER, org_id INTEGER,
  account TEXT NOT NULL, amount REAL NOT NULL, state TEXT NOT NULL DEFAULT 'open', memo TEXT, category TEXT
);
CREATE INDEX IF NOT EXISTS idx_ledger_case ON ledger_entries(case_id);
CREATE TABLE IF NOT EXISTS refunds (
  id INTEGER PRIMARY KEY, case_id INTEGER REFERENCES cases(id), payment_id INTEGER REFERENCES payments(id), amount REAL NOT NULL, reason TEXT,
  status TEXT NOT NULL DEFAULT 'requested', requested_by INTEGER REFERENCES users(id), approver1 INTEGER REFERENCES users(id), approver2 INTEGER REFERENCES users(id),
  expected_window TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), paid_at TEXT
);
CREATE TABLE IF NOT EXISTS provider_settlements (
  id INTEGER PRIMARY KEY, provider_id INTEGER NOT NULL REFERENCES providers(id), case_id INTEGER REFERENCES cases(id), amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'accrued', invoice_ref TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), paid_at TEXT
);
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY, number TEXT UNIQUE NOT NULL, org_id INTEGER REFERENCES orgs(id), user_id INTEGER REFERENCES users(id), period TEXT,
  lines TEXT NOT NULL DEFAULT '[]', subtotal REAL NOT NULL DEFAULT 0, vat REAL NOT NULL DEFAULT 0, total REAL NOT NULL DEFAULT 0, due_date TEXT,
  status TEXT NOT NULL DEFAULT 'issued', po_number TEXT, kind TEXT NOT NULL DEFAULT 'consolidated', created_at TEXT NOT NULL DEFAULT (datetime('now')), paid_at TEXT
);

CREATE TABLE IF NOT EXISTS custody_events (
  id INTEGER PRIMARY KEY, case_id INTEGER NOT NULL REFERENCES cases(id), task_id INTEGER, agent_user_id INTEGER REFERENCES users(id),
  type TEXT NOT NULL, from_party TEXT, to_party TEXT, location TEXT, lat REAL, lng REAL, ack_name TEXT, ack_method TEXT, note TEXT,
  item_summary TEXT, photo_key TEXT, authority_ref TEXT, captured_at TEXT NOT NULL, synced_at TEXT NOT NULL DEFAULT (datetime('now')), offline INTEGER NOT NULL DEFAULT 0,
  client_event_id TEXT UNIQUE
);
CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY, ref TEXT UNIQUE NOT NULL, case_id INTEGER REFERENCES cases(id), severity TEXT NOT NULL DEFAULT 'medium', type TEXT NOT NULL,
  owner_user_id INTEGER REFERENCES users(id), status TEXT NOT NULL DEFAULT 'open', detail TEXT, corrective_actions TEXT NOT NULL DEFAULT '[]',
  reported_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now')), closed_at TEXT
);
CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY, case_id INTEGER REFERENCES cases(id), user_id INTEGER REFERENCES users(id), kind TEXT NOT NULL, at TEXT NOT NULL,
  location TEXT, emirate TEXT, status TEXT NOT NULL DEFAULT 'booked', note TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY, case_id INTEGER NOT NULL REFERENCES cases(id), sender_user_id INTEGER, sender_kind TEXT NOT NULL,
  body TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT 'customer', channel TEXT NOT NULL DEFAULT 'web', created_at TEXT NOT NULL DEFAULT (datetime('now')), read_at TEXT
);
CREATE TABLE IF NOT EXISTS complaints (
  id INTEGER PRIMARY KEY, ref TEXT UNIQUE NOT NULL, case_id INTEGER REFERENCES cases(id), user_id INTEGER NOT NULL REFERENCES users(id),
  subject TEXT NOT NULL, detail TEXT, owner_user_id INTEGER REFERENCES users(id), status TEXT NOT NULL DEFAULT 'open', ack_at TEXT,
  resolution TEXT, remedy_aed REAL NOT NULL DEFAULT 0, failure_source TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), resolved_at TEXT
);
CREATE TABLE IF NOT EXISTS callbacks (
  id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, phone TEXT NOT NULL, topic TEXT, status TEXT NOT NULL DEFAULT 'open',
  assigned_to INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY, channel TEXT NOT NULL DEFAULT 'whatsapp', wa_id TEXT NOT NULL, user_id INTEGER, name TEXT, lang TEXT NOT NULL DEFAULT 'en',
  state TEXT NOT NULL DEFAULT 'menu', context TEXT NOT NULL DEFAULT '{}', handoff INTEGER NOT NULL DEFAULT 0, assigned_staff_id INTEGER,
  case_id INTEGER, last_msg_at TEXT NOT NULL DEFAULT (datetime('now')), created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(channel, wa_id)
);
CREATE TABLE IF NOT EXISTS conv_messages (
  id INTEGER PRIMARY KEY, conversation_id INTEGER NOT NULL REFERENCES conversations(id), direction TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'text',
  body TEXT, media_key TEXT, wa_msg_id TEXT, sender TEXT, ts TEXT NOT NULL DEFAULT (datetime('now')), status TEXT NOT NULL DEFAULT 'sent'
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY, ref TEXT UNIQUE NOT NULL, case_id INTEGER REFERENCES cases(id), user_id INTEGER NOT NULL REFERENCES users(id), org_id INTEGER,
  kind TEXT NOT NULL, service_slug TEXT, supplier_id INTEGER REFERENCES providers(id), details TEXT NOT NULL DEFAULT '{}', price_aed REAL NOT NULL DEFAULT 0,
  supplier_amount REAL NOT NULL DEFAULT 0, commission_aed REAL NOT NULL DEFAULT 0, fee_aed REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'quoted',
  terms TEXT, cancellation_terms TEXT, supplier_ref TEXT, consent_linked INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), kind TEXT NOT NULL DEFAULT 'info', title TEXT NOT NULL, body TEXT, link TEXT,
  read_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY, channel TEXT NOT NULL, to_addr TEXT NOT NULL, subject TEXT, body TEXT, status TEXT NOT NULL DEFAULT 'pending',
  provider_ref TEXT, error TEXT, user_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), sent_at TEXT
);
CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), profile_id INTEGER, document_id INTEGER, org_id INTEGER,
  title TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'expiry', due_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'scheduled', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS kb_articles (
  id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, lang TEXT NOT NULL DEFAULT 'en', title TEXT NOT NULL, body TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'approved', approved_by TEXT, approved_at TEXT
);

CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES orgs(id), name TEXT NOT NULL, prefix TEXT NOT NULL, key_hash TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT '[]', last_used_at TEXT, revoked_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES orgs(id), url TEXT NOT NULL, secret TEXT NOT NULL, events TEXT NOT NULL DEFAULT '["*"]',
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id INTEGER PRIMARY KEY, endpoint_id INTEGER NOT NULL REFERENCES webhook_endpoints(id), event TEXT NOT NULL, payload TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', response_code INTEGER, error TEXT, next_attempt_at TEXT,
  delivery_id TEXT UNIQUE, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT NOT NULL, scope TEXT NOT NULL, response TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (key, scope)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY, ts TEXT NOT NULL DEFAULT (datetime('now')), actor_user_id INTEGER, actor_label TEXT, action TEXT NOT NULL,
  entity TEXT, entity_id TEXT, detail TEXT, prev_hash TEXT, hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS user_tokens (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), kind TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), endpoint TEXT UNIQUE NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
  user_agent TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sso_identities (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), issuer TEXT NOT NULL, subject TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (issuer, subject)
);
CREATE TABLE IF NOT EXISTS job_runs (
  name TEXT PRIMARY KEY, last_run_at TEXT, last_ok_at TEXT, status TEXT, detail TEXT
);
`;

/** Columns added after the first release; applied idempotently on open. [table, column, definition] */
export const COLUMNS = [
  ['users', 'email_verified_at', 'TEXT'],
  ['users', 'last_login_at', 'TEXT'],
  ['users', 'anonymised_at', 'TEXT'],
  ['documents', 'scan_engine', 'TEXT'],
  ['documents', 'mirrored_at', 'TEXT'],
  ['dsr_requests', 'processed_at', 'TEXT'],
  ['dsr_requests', 'result', 'TEXT'],
  ['outbox', 'attempts', 'INTEGER NOT NULL DEFAULT 0'],
];
