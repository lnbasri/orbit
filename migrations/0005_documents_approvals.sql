CREATE TABLE approval_requests (
  id TEXT PRIMARY KEY,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('document', 'communication')),
  resource_id TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  assigned_to TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  decision_by TEXT,
  decision_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (resource_type, resource_id)
);
CREATE INDEX idx_approval_requests_assignee ON approval_requests(assigned_to, status, created_at);

CREATE TABLE approval_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_approval_comments_request ON approval_comments(request_id, created_at);

CREATE TABLE admin_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient TEXT NOT NULL,
  request_id TEXT NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  href TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read_at TEXT
);
CREATE INDEX idx_admin_notifications_recipient ON admin_notifications(recipient, read_at, created_at DESC);

CREATE TABLE document_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  title_template TEXT NOT NULL,
  body_template TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE generated_documents (
  id TEXT PRIMARY KEY,
  series_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  template_id TEXT NOT NULL REFERENCES document_templates(id),
  member_id TEXT REFERENCES members(id),
  household_id TEXT REFERENCES households(id),
  title TEXT NOT NULL,
  rendered_text TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  approval_request_id TEXT NOT NULL REFERENCES approval_requests(id),
  status TEXT NOT NULL DEFAULT 'pending_approval'
    CHECK (status IN ('pending_approval', 'approved', 'rejected')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT,
  CHECK ((member_id IS NOT NULL) OR (household_id IS NOT NULL)),
  UNIQUE (series_id, version)
);
CREATE INDEX idx_generated_documents_created ON generated_documents(created_at DESC);
CREATE INDEX idx_generated_documents_member ON generated_documents(member_id, created_at DESC);

ALTER TABLE email_templates ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1));
ALTER TABLE email_templates ADD COLUMN updated_by TEXT;
ALTER TABLE send_queue ADD COLUMN approval_request_id TEXT REFERENCES approval_requests(id);
ALTER TABLE send_queue ADD COLUMN queue_key TEXT;
ALTER TABLE send_queue ADD COLUMN provider_message_id TEXT;
ALTER TABLE send_queue ADD COLUMN delivered_at TEXT;
ALTER TABLE send_queue ADD COLUMN bounced_at TEXT;
CREATE INDEX idx_send_queue_approval ON send_queue(approval_request_id, status);
CREATE UNIQUE INDEX uq_send_queue_provider_message ON send_queue(provider_message_id)
  WHERE provider_message_id IS NOT NULL;
CREATE UNIQUE INDEX uq_send_queue_queue_key ON send_queue(queue_key)
  WHERE queue_key IS NOT NULL;

CREATE TRIGGER approval_request_sync_resource
AFTER UPDATE OF status ON approval_requests
WHEN OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected')
BEGIN
  UPDATE generated_documents
  SET status = CASE NEW.status WHEN 'approved' THEN 'approved' ELSE 'rejected' END,
      approved_by = CASE NEW.status WHEN 'approved' THEN NEW.decision_by ELSE NULL END,
      approved_at = CASE NEW.status WHEN 'approved' THEN NEW.decision_at ELSE NULL END
  WHERE id = NEW.resource_id AND NEW.resource_type = 'document';

  UPDATE send_queue
  SET status = CASE NEW.status WHEN 'rejected' THEN 'failed' ELSE status END,
      failed_at = CASE NEW.status WHEN 'rejected' THEN NEW.decision_at ELSE failed_at END,
      last_error = CASE NEW.status WHEN 'rejected' THEN 'Approval rejected' ELSE last_error END,
      updated_at = NEW.decision_at
  WHERE queue_key = NEW.resource_id AND NEW.resource_type = 'communication';
END;

INSERT INTO document_templates
  (id, name, title_template, body_template, created_by, created_at, updated_at)
VALUES
  ('membership-certificate', 'Membership certificate', 'Membership Certificate',
   'This certifies that {{full_name}} is a valued member of ORBIT.\n\nMember since: {{joined_on}}\n\nIssued on: {{generated_at}}',
   'system', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('payment-receipt', 'Payment receipt', 'Payment Receipt',
   'Receipt for {{contribution_amount}} contribution paid on {{contribution_date}} for {{household_name}}.\n\nIssued on: {{generated_at}}',
   'system', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('household-summary', 'Household summary', 'Household Summary: {{household_name}}',
   'Household: {{household_name}}\nTotal members: {{total_members}}\n\nIssued on: {{generated_at}}',
   'system', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT OR IGNORE INTO email_templates
  (name, subject, html, text, kind, is_system, created_at, updated_at)
VALUES
  ('welcome', 'Welcome to ORBIT', '<h1>Welcome to ORBIT, {{preferred_name}}!</h1><p>We are delighted to have you in our community.</p>',
   'Welcome to ORBIT, {{preferred_name}}!\n\nWe are delighted to have you in our community.', 'general', 1,
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('notice', '{{title}}', '<h1>{{title}}</h1><div>{{{content}}}</div>',
   '{{title}}\n\n{{content}}', 'general', 1,
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('reminder', 'Reminder: {{title}}', '<h1>Reminder: {{title}}</h1><div>{{{content}}}</div>',
   'Reminder: {{title}}\n\n{{content}}', 'general', 1,
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('announcement', 'Announcement: {{title}}', '<h1>Announcement: {{title}}</h1><div>{{{content}}}</div>',
   'Announcement: {{title}}\n\n{{content}}', 'general', 1,
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
