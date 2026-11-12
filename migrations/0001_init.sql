-- PPME event registration: initial schema (see FRD section 8.3)
-- All timestamps are UTC ISO-8601 strings (lexicographically comparable).

CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  speaker TEXT,
  theme TEXT,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Europe/Amsterdam',
  registration_opens_at TEXT,
  registration_closes_at TEXT,
  quota_member INTEGER NOT NULL CHECK (quota_member >= 0),
  quota_non_member INTEGER NOT NULL CHECK (quota_non_member >= 0),
  price_non_member_cents INTEGER NOT NULL,
  max_family INTEGER NOT NULL DEFAULT 8,
  pay_window_min INTEGER NOT NULL DEFAULT 360,
  reminder_after_min INTEGER NOT NULL DEFAULT 300,
  payment_prefix TEXT NOT NULL,
  payment_counter INTEGER NOT NULL DEFAULT 0,
  privacy_version TEXT NOT NULL DEFAULT '2026-11-v1',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('draft', 'open', 'closed'))
);

CREATE TABLE registrations (
  id TEXT PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id),
  created_at TEXT NOT NULL,
  registrant_name TEXT NOT NULL,
  is_member INTEGER NOT NULL CHECK (is_member IN (0, 1)),
  email TEXT,
  whatsapp TEXT,
  people INTEGER NOT NULL CHECK (people BETWEEN 1 AND 8),
  source TEXT NOT NULL CHECK (source IN ('online', 'manual')),
  status TEXT NOT NULL CHECK (status IN ('accepted', 'pending_payment', 'expired', 'rejected_quota')),
  payment_status TEXT NOT NULL CHECK (payment_status IN ('free', 'pending', 'paid', 'expired', 'not_processed', 'manual')),
  payment_code TEXT UNIQUE,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  pay_deadline TEXT,
  paid_at TEXT,
  confirmed_by TEXT,
  membership_verified_at TEXT,
  membership_verified_by TEXT,
  consent_at TEXT,
  privacy_version TEXT,
  marketing_opt_in INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT UNIQUE,
  notes TEXT
);

-- B5 / FR-REG-6: email is the registration key per event (one active registration per email).
CREATE UNIQUE INDEX uq_reg_event_email ON registrations(event_id, lower(email))
  WHERE status IN ('accepted', 'pending_payment') AND email IS NOT NULL;
CREATE INDEX idx_reg_quota ON registrations(event_id, is_member, source, status);
CREATE INDEX idx_reg_created ON registrations(event_id, created_at);

CREATE TABLE participants (
  id TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL REFERENCES registrations(id),
  position INTEGER NOT NULL,
  full_name TEXT NOT NULL,
  birth_year INTEGER NOT NULL,
  gender TEXT CHECK (gender IN ('male', 'female')),
  status TEXT NOT NULL CHECK (status IN ('accepted', 'pending_payment', 'expired', 'rejected')),
  -- Opaque random ticket code: the only thing encoded in the QR. Carries no personal data.
  qr_token TEXT UNIQUE,
  checked_in_at TEXT,
  checked_in_by TEXT
);
CREATE INDEX idx_part_reg ON participants(registration_id);

CREATE TABLE email_log (
  registration_id TEXT NOT NULL REFERENCES registrations(id),
  kind TEXT NOT NULL CHECK (kind IN ('confirmation', 'payment_instructions', 'reminder', 'expired')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  provider_id TEXT,
  sent_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (registration_id, kind)
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT
);

-- Local/dev outbox used when EMAIL_MODE=log (lets you preview emails and QR codes without sending).
CREATE TABLE dev_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  registration_id TEXT,
  kind TEXT,
  to_address TEXT NOT NULL,
  subject TEXT NOT NULL,
  html TEXT NOT NULL,
  attachments_json TEXT NOT NULL DEFAULT '[]'
);
