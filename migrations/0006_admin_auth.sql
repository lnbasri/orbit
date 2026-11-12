-- App-owned admin login (replaces Cloudflare Access). Identity = a session cookie issued after a one-time PIN
-- sent by email (or, when configured, Google sign-in); authorization = the admins table, checked on every request.

-- One-time login codes. Only the salted SHA-256 of the 6-digit code is stored. A code is valid for 10 minutes,
-- allows 5 attempts and can be used once; issuing a new code supersedes older unused ones.
CREATE TABLE admin_login_codes (
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
CREATE INDEX admin_login_codes_email ON admin_login_codes (email, created_at);

-- Admin sessions. The cookie holds a random 256-bit token; only its SHA-256 is stored here.
-- Sessions last 24 hours (absolute). The session lookup joins `admins`, so removing an admin ends access at once;
-- removeAdmin also deletes their rows. (No FK cascade on purpose: D1 then reports changes = 0 for the admin delete.)
CREATE TABLE admin_sessions (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL CHECK (email = lower(email)),
  method TEXT NOT NULL CHECK (method IN ('pin', 'google')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX admin_sessions_email ON admin_sessions (email);
CREATE INDEX admin_sessions_expires ON admin_sessions (expires_at);
