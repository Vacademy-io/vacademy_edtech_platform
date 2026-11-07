-- ============================================================
-- V550: TAT / follow-up SLA durations at minute precision.
-- tat_minutes / followup_sla_minutes are the source of truth from now on, so an
-- institute can configure e.g. 1h 30m instead of whole hours only.
-- The legacy *_hours columns stay (NOT NULL, kept in sync as CEIL(minutes / 60) by the
-- service) so an image rollback still reads a sane value.
-- ============================================================

ALTER TABLE lead_sla_config
    ADD COLUMN IF NOT EXISTS tat_minutes INTEGER,
    ADD COLUMN IF NOT EXISTS followup_sla_minutes INTEGER;

UPDATE lead_sla_config
SET tat_minutes = tat_hours * 60
WHERE tat_minutes IS NULL;

UPDATE lead_sla_config
SET followup_sla_minutes = followup_sla_hours * 60
WHERE followup_sla_minutes IS NULL;

ALTER TABLE lead_sla_config
    ALTER COLUMN tat_minutes SET DEFAULT 1440,
    ALTER COLUMN tat_minutes SET NOT NULL,
    ALTER COLUMN followup_sla_minutes SET DEFAULT 1440,
    ALTER COLUMN followup_sla_minutes SET NOT NULL;
