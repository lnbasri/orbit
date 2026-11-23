ALTER TABLE households ADD COLUMN email TEXT;
ALTER TABLE households ADD COLUMN phone TEXT;

UPDATE households
SET
  email = (
    SELECT NULLIF(trim(m.email), '')
    FROM members m
    WHERE m.id = households.head_member_id
  ),
  phone = (
    SELECT NULLIF(trim(m.phone), '')
    FROM members m
    WHERE m.id = households.head_member_id
  )
WHERE head_member_id IS NOT NULL;
