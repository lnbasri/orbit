-- D-day check-in: scanning team (own table, never the admins table), their sessions and login codes, the check-in log,
-- revoked tickets, escalation contacts, device self-tests and the check-in gate settings. See docs/scanner-plan.md.

-- Volunteers and leads. `participant_id` links a scanner to the participant record of their own admission (a scanner
-- cannot scan their own ticket). `active` = 0 locks a scanner out without deleting the row.
CREATE TABLE scanners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
  name TEXT,
  role TEXT NOT NULL DEFAULT 'scanner' CHECK (role IN ('scanner', 'lead')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  participant_id TEXT,
  added_by TEXT NOT NULL,
  added_at TEXT NOT NULL,
  last_login_at TEXT
);

-- Same mechanism as admin_login_codes (6 digits, 10 minutes, 5 attempts, newest code only), separate table.
CREATE TABLE scanner_login_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL CHECK (email = lower(email)),
  code_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used_at TEXT,
  ip TEXT
);
CREATE INDEX scanner_login_codes_email ON scanner_login_codes (email, created_at);

-- Scanner sessions: random 256-bit token in an HttpOnly cookie, only its SHA-256 here. 48 hours, absolute.
CREATE TABLE scanner_sessions (
  token_hash TEXT PRIMARY KEY,
  scanner_id INTEGER NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('pin', 'google')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  device_label TEXT
);
CREATE INDEX scanner_sessions_scanner ON scanner_sessions (scanner_id);
CREATE INDEX scanner_sessions_expires ON scanner_sessions (expires_at);

-- Append-only history of every scan decision. `scanner_label` is a snapshot of the scanner's name/email for display.
-- After the retention period it is replaced by 'scanner-<id>' and device/IP data is cleared (anonymisation).
CREATE TABLE checkin_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  event_id INTEGER,
  participant_id TEXT,
  registration_id TEXT,
  scanner_id INTEGER,
  scanner_label TEXT,
  device_label TEXT,
  action TEXT NOT NULL CHECK (action IN ('admit', 'deny', 'duplicate', 'invalid', 'blocked', 'undo', 'override', 'escalate', 'admin_admit', 'admin_undo')),
  reason TEXT,
  request_id TEXT,
  detail TEXT
);
CREATE INDEX checkin_log_at ON checkin_log (at);
CREATE INDEX checkin_log_participant ON checkin_log (participant_id);
CREATE INDEX checkin_log_scanner ON checkin_log (scanner_id, at);
-- A retried tap (same request id) must not log or admit twice.
CREATE UNIQUE INDEX checkin_log_request ON checkin_log (request_id, participant_id, action) WHERE request_id IS NOT NULL;

-- Ticket codes that were valid once and are gone (admin deleted, registrant cancelled or removed a person, membership
-- rejected). A revoked code carries no personal data and is worthless, so it is stored as is.
CREATE TABLE revoked_tickets (
  code TEXT PRIMARY KEY,
  event_id INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('admin_deleted', 'self_cancelled', 'self_removed', 'membership_rejected')),
  revoked_at TEXT NOT NULL
);

-- Who to call when a dispute at the door cannot be settled by the scanner (1 = security, 2 = panitia, 3 = bestuur).
CREATE TABLE escalation_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level INTEGER NOT NULL CHECK (level IN (1, 2, 3)),
  name TEXT NOT NULL,
  role_label TEXT,
  phone TEXT NOT NULL,
  note TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

-- Result of the device self-test a scanner runs before the event (readiness board in /admin/scanners).
CREATE TABLE scanner_selftests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scanner_id INTEGER NOT NULL,
  at TEXT NOT NULL,
  device_label TEXT,
  app_version TEXT,
  passed INTEGER NOT NULL CHECK (passed IN (0, 1)),
  result_json TEXT NOT NULL
);
CREATE INDEX scanner_selftests_scanner ON scanner_selftests (scanner_id, at);

-- Check-in gate: kill switch plus an optional window override (UTC ISO). NULL window = 1 hour before the event
-- starts until 1 hour after it ends.
ALTER TABLE events ADD COLUMN checkin_enabled INTEGER NOT NULL DEFAULT 1 CHECK (checkin_enabled IN (0, 1));
ALTER TABLE events ADD COLUMN checkin_opens_at TEXT;
ALTER TABLE events ADD COLUMN checkin_closes_at TEXT;

-- First scanner lead (user request, 14 Nov 2026). More scanners and leads are managed at /admin/scanners.
INSERT OR IGNORE INTO scanners (email, name, role, added_by, added_at)
VALUES ('rostiarso@gmail.com', NULL, 'lead', 'migration-0017', '2026-11-14T12:00:00.000Z');
