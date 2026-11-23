CREATE TRIGGER contribution_void_guard
BEFORE UPDATE OF voided_at ON contributions
WHEN OLD.voided_at IS NULL
  AND NEW.voided_at IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM contribution_payments
    WHERE contribution_id = OLD.id AND voided_at IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'Contribution has active payments');
END;
