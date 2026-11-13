-- Self-service "Pendaftaran saya": a registrant signs in per event with a one-time code sent to the registration email
-- (same PIN design as the admin login, separate tables so the two can never be confused), then views and, while allowed,
-- edits their own registration.

-- Optimistic concurrency for self-service edits: every edit writes a new random revision and is conditional on the
-- revision the form was loaded with. The revision is also part of the email idempotency key, so the re-sent
-- confirmation / payment instructions after an edit are not swallowed by the provider's de-duplication.
ALTER TABLE registrations ADD COLUMN edit_rev TEXT;
ALTER TABLE registrations ADD COLUMN updated_at TEXT;

CREATE TABLE registrant_login_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id),
  email TEXT NOT NULL CHECK (email = lower(email)),
  code_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used_at TEXT,
  ip TEXT
);
CREATE INDEX registrant_login_codes_email ON registrant_login_codes (event_id, email, created_at);

-- The cookie holds a random 256-bit token; only its SHA-256 is stored. 2 hours, absolute.
CREATE TABLE registrant_sessions (
  token_hash TEXT PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id),
  email TEXT NOT NULL CHECK (email = lower(email)),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX registrant_sessions_expires ON registrant_sessions (expires_at);
