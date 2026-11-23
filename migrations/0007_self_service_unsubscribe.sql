CREATE TABLE unsubscribe_tokens (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE,
  queue_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX idx_unsubscribe_tokens_email ON unsubscribe_tokens(email, created_at DESC);

UPDATE email_templates
SET html = html || '<p style="font-size:12px;color:#6b7280">This message was sent to {{email}}. <a href="{{unsubscribe_url}}">Unsubscribe</a></p>',
    text = COALESCE(text, '') || char(10) || 'Unsubscribe: {{unsubscribe_url}}',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE is_system = 1 AND html NOT LIKE '%unsubscribe_url%';
