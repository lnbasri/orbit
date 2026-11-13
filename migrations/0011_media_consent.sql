-- Separate acknowledgement that the event is documented (photo/video) and live streamed.
-- Kept apart from the privacy consent (consent_at) so each purpose has its own timestamp and wording version.
-- Existing rows are backfilled at the bottom of this file.
ALTER TABLE registrations ADD COLUMN media_consent_at TEXT;
ALTER TABLE registrations ADD COLUMN media_notice_version TEXT;

-- Pre-release data: every existing registration counts as agreed (same time as its privacy consent, else its creation time).
UPDATE registrations
   SET media_consent_at = COALESCE(consent_at, created_at),
       media_notice_version = '2026-11-v1'
 WHERE media_consent_at IS NULL;
