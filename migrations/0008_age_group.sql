-- GDPR data minimisation: replace the exact birth year with an age group (anak / remaja / dewasa).
-- Existing rows are translated using the age the participant reaches in the event year:
--   anak   = 0 to under 12   (age <= 11)
--   remaja = 12 to under 18  (age 12-17)
--   dewasa = 18 and above
ALTER TABLE participants ADD COLUMN age_group TEXT NOT NULL DEFAULT 'dewasa'
  CHECK (age_group IN ('anak', 'remaja', 'dewasa'));

UPDATE participants SET age_group = CASE
  WHEN (SELECT CAST(strftime('%Y', e.starts_at) AS INTEGER) FROM registrations r JOIN events e ON e.id = r.event_id
        WHERE r.id = participants.registration_id) - birth_year <= 11 THEN 'anak'
  WHEN (SELECT CAST(strftime('%Y', e.starts_at) AS INTEGER) FROM registrations r JOIN events e ON e.id = r.event_id
        WHERE r.id = participants.registration_id) - birth_year <= 17 THEN 'remaja'
  ELSE 'dewasa' END;

ALTER TABLE participants DROP COLUMN birth_year;
