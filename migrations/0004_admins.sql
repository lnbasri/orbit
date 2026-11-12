-- Committee members allowed to use /admin. Managed from the admin UI (/admin/admins).
-- Emails are stored lower-case. The table is seeded once from the ADMIN_EMAILS var when it is empty.
CREATE TABLE admins (
  email TEXT PRIMARY KEY CHECK (email = lower(email)),
  name TEXT,
  added_by TEXT NOT NULL,
  added_at TEXT NOT NULL,
  last_login_at TEXT
);
