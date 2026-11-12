-- Single event for go-live on Mon 16 Nov 2026.
-- Times in UTC: 09:00–14:30 Europe/Amsterdam (CET, UTC+1) on 5 Dec 2026.
-- registration_opens_at = Mon 16 Nov 00:00 Amsterdam (placeholder; confirm the real opening time).
INSERT INTO events (
  slug, title, speaker, theme, starts_at, ends_at,
  registration_opens_at, quota_member, quota_non_member,
  price_non_member_cents, payment_prefix
) VALUES (
  'kajian-aisah-dahlan-2026',
  'Kajian PPME Den Haag 2026',
  'dr. Aisah Dahlan',
  'Perbedaan otak laki-laki dan perempuan',
  '2026-12-05T08:00:00.000Z',
  '2026-12-05T13:30:00.000Z',
  '2026-11-15T23:00:00.000Z',
  200, 150, 500, 'PPME-2026-'
);
