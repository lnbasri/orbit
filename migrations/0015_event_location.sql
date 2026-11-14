-- Event location: shown on the registration form, in the confirmation emails and in the calendar entry (.ics / Google / Outlook).
-- Plain columns (no CHECK change), so ALTER TABLE is enough. Editable in /admin/settings.
ALTER TABLE events ADD COLUMN location_name TEXT;
ALTER TABLE events ADD COLUMN location_address TEXT;
ALTER TABLE events ADD COLUMN location_map_url TEXT;

UPDATE events
SET location_name = 'Masjid Al Hikmah',
    location_address = 'Medlerstraat 4, 2531 HA Den Haag',
    location_map_url = 'https://maps.app.goo.gl/7nLnjw15QhfiC6tA7'
WHERE slug = 'kajian-aisah-dahlan-2026';
