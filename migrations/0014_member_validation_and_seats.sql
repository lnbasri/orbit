-- 1. Members are validated BEFORE they get a QR code: new registration status 'pending_membership' (waiting for an admin
--    to check the member claim) and new participant status 'pending_membership'.
-- 2. New email kind 'membership_pending' (acknowledgement sent while the member waits for validation).
-- 3. registrations.seats = people that count toward the quota (remaja + dewasa only; balita and anak do not).
--
-- The CHECK constraints change, so registrations, participants and email_log are rebuilt (SQLite cannot alter a CHECK).
-- Same dance as 0013: child rows are parked first, because dropping a referenced parent with child rows fails the
-- foreign-key check on commit. Existing rows keep their status (already accepted members stay accepted with their QR).
CREATE TABLE participants_bak AS SELECT * FROM participants;
CREATE TABLE email_log_bak AS SELECT * FROM email_log;
DELETE FROM participants;
DELETE FROM email_log;
DROP TABLE participants;
DROP TABLE email_log;

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
  status TEXT NOT NULL CHECK (status IN ('accepted', 'pending_payment', 'pending_membership', 'expired', 'rejected_quota', 'rejected_membership')),
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
  media_notice_version TEXT,
  seats INTEGER NOT NULL DEFAULT 0
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

-- One active registration per email and event; a member waiting for validation is active too.
CREATE UNIQUE INDEX uq_reg_event_email ON registrations(event_id, lower(email))
  WHERE status IN ('accepted', 'pending_payment', 'pending_membership') AND email IS NOT NULL;
CREATE INDEX idx_reg_quota ON registrations(event_id, is_member, source, status);
CREATE INDEX idx_reg_created ON registrations(event_id, created_at);

CREATE TABLE participants (
  id TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL REFERENCES registrations(id),
  position INTEGER NOT NULL,
  full_name TEXT NOT NULL,
  gender TEXT CHECK (gender IN ('laki-laki', 'perempuan')),
  status TEXT NOT NULL CHECK (status IN ('accepted', 'pending_payment', 'pending_membership', 'expired', 'rejected')),
  qr_token TEXT UNIQUE,
  checked_in_at TEXT,
  checked_in_by TEXT,
  age_group TEXT NOT NULL DEFAULT 'dewasa' CHECK (age_group IN ('balita', 'anak', 'remaja', 'dewasa'))
);
CREATE INDEX idx_part_reg ON participants(registration_id);

CREATE TABLE email_log (
  registration_id TEXT NOT NULL REFERENCES registrations(id),
  kind TEXT NOT NULL CHECK (kind IN ('confirmation', 'payment_instructions', 'reminder', 'expired', 'membership_pending')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  provider_id TEXT,
  sent_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (registration_id, kind)
);

INSERT INTO participants (id, registration_id, position, full_name, gender, status, qr_token, checked_in_at, checked_in_by, age_group)
SELECT id, registration_id, position, full_name, gender, status, qr_token, checked_in_at, checked_in_by, age_group FROM participants_bak;
INSERT INTO email_log (registration_id, kind, status, attempts, provider_id, sent_at, last_error, updated_at)
SELECT registration_id, kind, status, attempts, provider_id, sent_at, last_error, updated_at FROM email_log_bak;
DROP TABLE participants_bak;
DROP TABLE email_log_bak;

-- Backfill: seats = remaja + dewasa participants of each registration.
UPDATE registrations SET seats = (
  SELECT COUNT(*) FROM participants p
  WHERE p.registration_id = registrations.id AND p.age_group IN ('remaja', 'dewasa'));
