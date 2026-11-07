-- Migration: drop the legacy mode CHECK left behind by the input_videos rename
-- Date: 2026-08-29
--
-- rename_input_videos_to_input_assets.sql generalized ai_input_videos into
-- ai_input_assets and added a mode CHECK covering both kinds:
--     mode IN ('podcast','demo','photo','screenshot','diagram')
-- It first ran DROP CONSTRAINT IF EXISTS ai_input_assets_mode_check — but that
-- constraint did not exist under that name. ALTER TABLE ... RENAME TO renames
-- the table, NOT its constraints, so the original check survived as
-- ai_input_videos_mode_check, still spelling:
--     mode IN ('podcast','demo')
--
-- Postgres enforces every CHECK on a table, so the two ANDed together allow
-- only the video modes. Creating any image asset has failed since the rename
-- with a 500:
--     CheckViolation: new row for relation "ai_input_assets" violates check
--     constraint "ai_input_videos_mode_check"
--
-- The surviving constraint is strictly narrower than the one that replaced it
-- (same two video modes, minus the three image modes), so dropping it loses no
-- enforcement. ai_input_assets_mode_check continues to police the column.

BEGIN;

ALTER TABLE ai_input_assets
  DROP CONSTRAINT IF EXISTS ai_input_videos_mode_check;

-- The replacement was added NOT VALID so the rename could not abort on a
-- pre-existing odd row. Validate it now: it has been gating every insert since,
-- and a scan confirms the existing rows conform. Takes a SHARE UPDATE EXCLUSIVE
-- lock only — reads and writes continue.
ALTER TABLE ai_input_assets
  VALIDATE CONSTRAINT ai_input_assets_mode_check;

COMMIT;
