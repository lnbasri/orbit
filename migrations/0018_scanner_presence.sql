-- Presence of the scanner phones: the app sends a heartbeat every ~20 s with its state, so a team lead can see which
-- phones are online, idle, have a camera problem, or have gone quiet. Additive columns only.
ALTER TABLE scanner_sessions ADD COLUMN last_seen_at TEXT;
-- 'scanning' = camera running, 'idle' = app open but not scanning, 'camera_problem' = camera denied/failed, 'background' = app left.
ALTER TABLE scanner_sessions ADD COLUMN last_state TEXT;
