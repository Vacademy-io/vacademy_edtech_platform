-- announcements.entity / entity_id already exist in production, created outside
-- Flyway (an older ddl-auto=update run). Nothing has ever written them, so they
-- went unnoticed; mapping them on the entity makes that a problem, because an
-- environment built purely from these migrations would not have the columns and
-- every announcement write would fail at runtime.
--
-- IF NOT EXISTS so this is a no-op where they are already present.
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS entity VARCHAR(255);
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS entity_id VARCHAR(255);

-- The lead-assignment alert is looked up by (institute, entity, entity_id) when
-- a counsellor's activity clears it.
CREATE INDEX IF NOT EXISTS idx_announcements_entity
    ON announcements (institute_id, entity, entity_id)
    WHERE entity IS NOT NULL;
