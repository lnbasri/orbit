CREATE TABLE admins (
  email TEXT PRIMARY KEY CHECK (email = lower(email)),
  name TEXT,
  role TEXT NOT NULL DEFAULT 'ADMIN'
    CHECK (role IN ('SUPER_ADMIN', 'ADMIN')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  added_by TEXT NOT NULL,
  added_at TEXT NOT NULL,
  last_login_at TEXT
);

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
CREATE INDEX admin_login_codes_email ON admin_login_codes(email, created_at);

CREATE TABLE admin_sessions (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL CHECK (email = lower(email)),
  method TEXT NOT NULL CHECK (method IN ('pin', 'google')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX admin_sessions_email ON admin_sessions(email);
CREATE INDEX admin_sessions_expires ON admin_sessions(expires_at);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT
);

CREATE TABLE dev_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  kind TEXT,
  to_address TEXT NOT NULL,
  subject TEXT NOT NULL,
  html TEXT NOT NULL,
  attachments_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE members (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  preferred_name TEXT,
  first_name TEXT,
  middle_name TEXT,
  family_name TEXT,
  date_of_birth TEXT,
  gender TEXT NOT NULL CHECK (gender IN ('male', 'female')),
  address TEXT,
  postal_code TEXT,
  city TEXT,
  country TEXT,
  preferred_language TEXT,
  communication_consent INTEGER NOT NULL DEFAULT 0 CHECK (communication_consent IN (0, 1)),
  communication_consent_updated_at TEXT,
  email TEXT,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'moved', 'deceased')),
  status_note TEXT,
  joined_on TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX idx_members_name ON members(full_name);
CREATE INDEX idx_members_status ON members(status);

CREATE TABLE households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  head_member_id TEXT REFERENCES members(id),
  address TEXT,
  postal_code TEXT,
  city TEXT,
  country TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  status_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_households_name ON households(name);

CREATE TABLE member_households (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id TEXT NOT NULL REFERENCES members(id),
  household_id TEXT NOT NULL REFERENCES households(id),
  role TEXT NOT NULL DEFAULT 'partner'
    CHECK (role IN ('head', 'partner', 'child')),
  assigned_by TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  valid_until TEXT,
  ended_by TEXT
);
CREATE UNIQUE INDEX uq_member_current_household ON member_households(member_id) WHERE valid_until IS NULL;
CREATE UNIQUE INDEX uq_household_current_head ON member_households(household_id) WHERE valid_until IS NULL AND role = 'head';
CREATE UNIQUE INDEX uq_household_current_partner ON member_households(household_id) WHERE valid_until IS NULL AND role = 'partner';
CREATE INDEX idx_member_households_household ON member_households(household_id, valid_until);

CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE member_group_memberships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id TEXT NOT NULL REFERENCES members(id),
  group_id TEXT NOT NULL REFERENCES groups(id),
  role TEXT NOT NULL DEFAULT 'member',
  assigned_by TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  valid_until TEXT,
  ended_by TEXT
);
CREATE UNIQUE INDEX uq_member_current_group ON member_group_memberships(member_id, group_id) WHERE valid_until IS NULL;
CREATE INDEX idx_group_memberships_group ON member_group_memberships(group_id, valid_until);

CREATE TABLE member_relationships (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id),
  related_member_id TEXT NOT NULL REFERENCES members(id),
  relationship TEXT NOT NULL,
  created_by TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  valid_until TEXT,
  ended_by TEXT,
  CHECK (member_id <> related_member_id)
);
CREATE UNIQUE INDEX uq_member_current_relationship
  ON member_relationships(member_id, related_member_id, relationship) WHERE valid_until IS NULL;
CREATE INDEX idx_member_relationships_related ON member_relationships(related_member_id, valid_until);

CREATE TABLE member_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id TEXT NOT NULL REFERENCES members(id),
  changed_at TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  changes_json TEXT NOT NULL
);
CREATE INDEX idx_member_history_member ON member_history(member_id, changed_at DESC);
