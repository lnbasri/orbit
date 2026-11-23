CREATE UNIQUE INDEX uq_email_templates_name ON email_templates(name);

CREATE TABLE communications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'notice',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'queued', 'completed', 'failed')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE send_queue ADD COLUMN communication_id INTEGER REFERENCES communications(id);
ALTER TABLE send_queue ADD COLUMN recipient_data_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE send_queue ADD COLUMN purpose TEXT;
ALTER TABLE send_queue ADD COLUMN scheduled_at TEXT;
ALTER TABLE send_queue ADD COLUMN updated_at TEXT;
CREATE INDEX idx_send_queue_communication ON send_queue(communication_id, created_at);
