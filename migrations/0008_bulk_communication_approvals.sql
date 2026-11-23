DROP TRIGGER approval_request_sync_resource;

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
  SET status = 'failed',
      failed_at = NEW.decision_at,
      last_error = 'Approval rejected',
      updated_at = NEW.decision_at
  WHERE status = 'pending' AND NEW.status = 'rejected'
    AND NEW.resource_type = 'communication'
    AND (
      queue_key = NEW.resource_id
      OR (
        NEW.resource_id LIKE 'bulk:%'
        AND communication_id = CAST(substr(NEW.resource_id, 6) AS INTEGER)
      )
    );

  UPDATE communications
  SET status = 'failed', updated_at = NEW.decision_at
  WHERE NEW.resource_type = 'communication'
    AND NEW.status = 'rejected'
    AND NEW.resource_id LIKE 'bulk:%'
    AND id = CAST(substr(NEW.resource_id, 6) AS INTEGER);
END;

CREATE TRIGGER send_queue_communication_status
AFTER UPDATE OF status ON send_queue
WHEN NEW.communication_id IS NOT NULL AND NEW.status <> OLD.status
BEGIN
  UPDATE communications
  SET status = CASE
        WHEN EXISTS (
          SELECT 1 FROM send_queue
          WHERE communication_id = NEW.communication_id AND status IN ('pending', 'sending')
        ) THEN 'queued'
        WHEN EXISTS (
          SELECT 1 FROM send_queue
          WHERE communication_id = NEW.communication_id AND status IN ('failed', 'bounced')
        ) THEN 'failed'
        ELSE 'completed'
      END,
      updated_at = NEW.updated_at
  WHERE id = NEW.communication_id;
END;
