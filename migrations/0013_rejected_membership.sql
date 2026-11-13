-- New registration status 'rejected_membership': an admin could not validate the member claim.
-- The status CHECK changes, so registrations is rebuilt (SQLite cannot alter a CHECK). participants and email_log
-- reference it, so their rows are parked in temp copies first and put back afterwards: dropping a referenced parent
-- with child rows present fails the foreign-key check on commit.
CREATE TABLE participants_bak AS SELECT * FROM participants;
CREATE TABLE email_log_bak AS SELECT * FROM email_log;
DELETE FROM participants;
DELETE FROM email_log;

CREATE TABLE registrations_new (
  id TEXT PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id),
  created_at TEXT NOT NULL,
  registrant_name TEXT NOT NULL,
  is_member INTEGER NOT NULL CHECK (is_member IN (0, 1)),
  email TEXT,
  whatsapp TEXT,
  people INTEGER NOT NULL CHECK (people BETWEEN 1 AND 8),
  source TEXT NOT NULL CHECK (source IN ('online', 'manual')),
  status TEXT NOT NULL CHECK (status IN ('accepted', 'pending_payment', 'expired', 'rejected_quota', 'rejected_membership')),
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
  notes TEXT,
  edit_rev TEXT,
  updated_at TEXT,
  media_consent_at TEXT,
  media_notice_version TEXT
);

INSERT INTO registrations_new (id, event_id, created_at, registrant_name, is_member, email, whatsapp, people, source, status,
  payment_status, payment_code, amount_cents, pay_deadline, paid_at, confirmed_by, membership_verified_at, membership_verified_by,
  consent_at, privacy_version, marketing_opt_in, idempotency_key, notes, edit_rev, updated_at, media_consent_at, media_notice_version)
SELECT id, event_id, created_at, registrant_name, is_member, email, whatsapp, people, source, status,
  payment_status, payment_code, amount_cents, pay_deadline, paid_at, confirmed_by, membership_verified_at, membership_verified_by,
  consent_at, privacy_version, marketing_opt_in, idempotency_key, notes, edit_rev, updated_at, media_consent_at, media_notice_version
FROM registrations;

DROP TABLE registrations;
ALTER TABLE registrations_new RENAME TO registrations;

CREATE UNIQUE INDEX uq_reg_event_email ON registrations(event_id, lower(email))
  WHERE status IN ('accepted', 'pending_payment') AND email IS NOT NULL;
CREATE INDEX idx_reg_quota ON registrations(event_id, is_member, source, status);
CREATE INDEX idx_reg_created ON registrations(event_id, created_at);

INSERT INTO participants SELECT * FROM participants_bak;
INSERT INTO email_log SELECT * FROM email_log_bak;
DROP TABLE participants_bak;
DROP TABLE email_log_bak;
