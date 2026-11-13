-- Store gender as Indonesian words (pria / wanita), consistent with the CSV export and age_group values.
-- The CHECK constraint changes, so the table is rebuilt (SQLite cannot alter a CHECK). Nothing references participants.
CREATE TABLE participants_new (
  id TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL REFERENCES registrations(id),
  position INTEGER NOT NULL,
  full_name TEXT NOT NULL,
  gender TEXT CHECK (gender IN ('pria', 'wanita')),
  status TEXT NOT NULL CHECK (status IN ('accepted', 'pending_payment', 'expired', 'rejected')),
  qr_token TEXT UNIQUE,
  checked_in_at TEXT,
  checked_in_by TEXT,
  age_group TEXT NOT NULL DEFAULT 'dewasa' CHECK (age_group IN ('anak', 'remaja', 'dewasa'))
);

INSERT INTO participants_new (id, registration_id, position, full_name, gender, status, qr_token, checked_in_at, checked_in_by, age_group)
SELECT id, registration_id, position, full_name,
       CASE gender WHEN 'male' THEN 'pria' WHEN 'female' THEN 'wanita' ELSE gender END,
       status, qr_token, checked_in_at, checked_in_by, age_group
FROM participants;

DROP TABLE participants;
ALTER TABLE participants_new RENAME TO participants;
CREATE INDEX idx_part_reg ON participants(registration_id);
