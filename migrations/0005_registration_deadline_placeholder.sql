-- PLACEHOLDER registration deadline: Friday 27 Nov 2026 23:59 Europe/Amsterdam (= 22:59 UTC, CET), one week before the event.
-- Not a committee decision yet. Change it in the admin area (Pengaturan) or with:
--   UPDATE events SET registration_closes_at = '<UTC ISO>' WHERE slug = 'kajian-aisah-dahlan-2026';
UPDATE events
SET registration_closes_at = '2026-11-27T22:59:00.000Z'
WHERE slug = 'kajian-aisah-dahlan-2026' AND registration_closes_at IS NULL;
