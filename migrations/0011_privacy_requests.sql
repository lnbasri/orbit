CREATE TABLE privacy_requests (
  id TEXT PRIMARY KEY,
  member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  request_type TEXT NOT NULL
    CHECK (request_type IN ('access', 'rectification', 'erasure', 'restriction', 'objection', 'portability', 'other')),
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'verifying', 'in_progress', 'completed', 'declined')),
  verification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending', 'verified')),
  received_on TEXT NOT NULL,
  due_on TEXT,
  closed_at TEXT,
  internal_notes TEXT NOT NULL DEFAULT '' CHECK (length(internal_notes) <= 2000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_privacy_requests_member ON privacy_requests(member_id, created_at DESC);
CREATE INDEX idx_privacy_requests_status ON privacy_requests(status, due_on);
