-- Submission review, phase 1a (spec 8.1). One record per answer says how it was
-- marked, by whom, and when. NULL mark_state = a legacy row; its state is derived on
-- read (MarkStateDeriver). No backfill. response_hash is phase 1b, not added here.
SET LOCAL lock_timeout = '5s';
ALTER TABLE question_wise_marks
  ADD COLUMN IF NOT EXISTS mark_state                VARCHAR(20),
  ADD COLUMN IF NOT EXISTS max_marks                 NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS marked_by                 VARCHAR(255),
  ADD COLUMN IF NOT EXISTS marked_at                 TIMESTAMP,
  ADD COLUMN IF NOT EXISTS revision                  INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_question_evaluation_id VARCHAR(36),
  ADD COLUMN IF NOT EXISTS pending_ai_evaluation_id  VARCHAR(36),
  ADD COLUMN IF NOT EXISTS part_marks_json           TEXT,
  ADD COLUMN IF NOT EXISTS answer_pages              VARCHAR(64);
