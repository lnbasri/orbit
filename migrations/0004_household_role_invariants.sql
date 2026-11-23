UPDATE households
SET head_member_id = (
  SELECT member_id
  FROM member_households
  WHERE household_id = households.id
    AND valid_until IS NULL
    AND role = 'head'
  LIMIT 1
)
WHERE head_member_id IS NOT (
  SELECT member_id
  FROM member_households
  WHERE household_id = households.id
    AND valid_until IS NULL
    AND role = 'head'
  LIMIT 1
);

CREATE TRIGGER households_head_insert_guard
BEFORE INSERT ON households
WHEN NEW.head_member_id IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'household head requires a current head assignment'); END;

CREATE TRIGGER households_head_update_guard
BEFORE UPDATE OF head_member_id ON households
WHEN (NEW.head_member_id IS NULL AND EXISTS (
    SELECT 1 FROM member_households
    WHERE household_id = NEW.id AND valid_until IS NULL AND role = 'head'
  ))
  OR (NEW.head_member_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM member_households
    WHERE household_id = NEW.id
      AND member_id = NEW.head_member_id
      AND valid_until IS NULL
      AND role = 'head'
  ))
BEGIN SELECT RAISE(ABORT, 'household head must match a current head assignment'); END;

CREATE TRIGGER member_households_set_head_after_insert
AFTER INSERT ON member_households
WHEN NEW.valid_until IS NULL AND NEW.role = 'head'
BEGIN UPDATE households SET head_member_id = NEW.member_id WHERE id = NEW.household_id AND head_member_id IS NOT NEW.member_id; END;

CREATE TRIGGER member_households_clear_old_head_after_update
AFTER UPDATE OF member_id, household_id, role, valid_until ON member_households
WHEN OLD.valid_until IS NULL
  AND OLD.role = 'head'
  AND (NEW.valid_until IS NOT NULL OR NEW.role <> 'head' OR NEW.household_id <> OLD.household_id OR NEW.member_id <> OLD.member_id)
BEGIN UPDATE households SET head_member_id = NULL WHERE id = OLD.household_id AND head_member_id = OLD.member_id; END;

CREATE TRIGGER member_households_set_new_head_after_update
AFTER UPDATE OF member_id, household_id, role, valid_until ON member_households
WHEN NEW.valid_until IS NULL AND NEW.role = 'head'
BEGIN UPDATE households SET head_member_id = NEW.member_id WHERE id = NEW.household_id AND head_member_id IS NOT NEW.member_id; END;

CREATE TRIGGER member_households_clear_head_after_delete
AFTER DELETE ON member_households
WHEN OLD.valid_until IS NULL AND OLD.role = 'head'
BEGIN UPDATE households SET head_member_id = NULL WHERE id = OLD.household_id AND head_member_id = OLD.member_id; END;

CREATE TRIGGER member_households_active_insert_guard
BEFORE INSERT ON member_households
WHEN NEW.valid_until IS NULL AND NOT EXISTS (
  SELECT 1 FROM households WHERE id = NEW.household_id AND status = 'active'
)
BEGIN SELECT RAISE(ABORT, 'current member assignments require an active household'); END;

CREATE TRIGGER member_households_active_update_guard
BEFORE UPDATE OF household_id, valid_until ON member_households
WHEN NEW.valid_until IS NULL AND NOT EXISTS (
  SELECT 1 FROM households WHERE id = NEW.household_id AND status = 'active'
)
BEGIN SELECT RAISE(ABORT, 'current member assignments require an active household'); END;
