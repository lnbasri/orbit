-- Age groups: split "anak" into balita (under 5) and anak (5 to under 12). Existing rows keep their value (anak) as is.
-- The CHECK constraint changes, so the table is rebuilt (SQLite cannot alter a CHECK). Nothing references participants.
CREATE TABLE participants_new (
  id TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL REFERENCES registrations(id),
  position INTEGER NOT NULL,
  full_name TEXT NOT NULL,
  gender TEXT CHECK (gender IN ('laki-laki', 'perempuan')),
  status TEXT NOT NULL CHECK (status IN ('accepted', 'pending_payment', 'expired', 'rejected')),
  qr_token TEXT UNIQUE,
  checked_in_at TEXT,
  checked_in_by TEXT,
  age_group TEXT NOT NULL DEFAULT 'dewasa' CHECK (age_group IN ('balita', 'anak', 'remaja', 'dewasa'))
);

INSERT INTO participants_new (id, registration_id, position, full_name, gender, status, qr_token, checked_in_at, checked_in_by, age_group)
SELECT id, registration_id, position, full_name, gender, status, qr_token, checked_in_at, checked_in_by, age_group
FROM participants;

DROP TABLE participants;
ALTER TABLE participants_new RENAME TO participants;
CREATE INDEX idx_part_reg ON participants(registration_id);
