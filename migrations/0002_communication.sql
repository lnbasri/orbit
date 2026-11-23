CREATE TABLE email_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  html TEXT NOT NULL,
  text TEXT,
  kind TEXT NOT NULL DEFAULT 'general',
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE send_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES email_templates(id),
  recipient_email TEXT NOT NULL,
  recipient_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'bounced', 'unsubscribed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  sent_at TEXT,
  failed_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  processed_at TEXT
);

CREATE INDEX idx_send_queue_status ON send_queue(status, created_at);
CREATE INDEX idx_send_queue_recipient ON send_queue(recipient_email);

CREATE TABLE unsubscribes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  unsubscribe_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE communication_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  communication_name TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed', 'bounced', 'opened', 'clicked')),
  sent_at TEXT,
  opened_at TEXT,
  clicked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_communication_logs_communication ON communication_logs(communication_name, created_at);
CREATE INDEX idx_communication_logs_recipient ON communication_logs(recipient_email, created_at);
