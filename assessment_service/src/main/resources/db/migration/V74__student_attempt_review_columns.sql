-- Submission review, phase 1a (spec 8.3): the revision counter behind
-- "Released, changed (update not sent)", the learner "Revised" tag, and
-- "release the rest automatically once marked", and "Hide result again" (result_withheld_at:
-- a teacher hid the result; no automatic release puts it back, only a teacher's release).
-- Phase 3 columns are not added here.
-- Written only by targeted UPDATEs (the JPA entity maps them read-only).
SET LOCAL lock_timeout = '5s';
ALTER TABLE student_attempt
  ADD COLUMN IF NOT EXISTS marks_revision      INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notified_revision   INT,
  ADD COLUMN IF NOT EXISTS result_revised_at   TIMESTAMP,
  ADD COLUMN IF NOT EXISTS release_when_marked BOOLEAN,
  ADD COLUMN IF NOT EXISTS result_withheld_at  TIMESTAMP;
