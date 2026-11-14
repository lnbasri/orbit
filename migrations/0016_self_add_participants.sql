-- Quota control for "Pendaftaran Saya": may registrants ADD new participants themselves? Default 0 = no (editing and
-- removing stay possible). An admin switches it on at /admin/settings. Plain column, so ALTER TABLE is enough.
ALTER TABLE events ADD COLUMN self_add_allowed INTEGER NOT NULL DEFAULT 0 CHECK (self_add_allowed IN (0, 1));
