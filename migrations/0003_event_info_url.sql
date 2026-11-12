-- Public event page on the PPME website, linked from the registration form.
ALTER TABLE events ADD COLUMN info_url TEXT;

UPDATE events
SET info_url = 'https://www.ppmedenhaag.nl/id/event/kajian-dr-aisah-dahlan/'
WHERE slug = 'kajian-aisah-dahlan-2026';
