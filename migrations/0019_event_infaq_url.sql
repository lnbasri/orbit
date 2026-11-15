-- Voluntary infaq payment link (ING payment request) per event: shown as the "Berikan Infaq" button in the confirmation email.
-- Plain column, editable in /admin/settings. NULL = the whole infaq block is left out of the email.
ALTER TABLE events ADD COLUMN infaq_url TEXT;

UPDATE events
SET infaq_url = 'https://www.ing.nl/payreq/m/X9CLufQNF0vMV8TUwk4MRhKo2ZfMzfNC'
WHERE slug = 'kajian-aisah-dahlan-2026';
