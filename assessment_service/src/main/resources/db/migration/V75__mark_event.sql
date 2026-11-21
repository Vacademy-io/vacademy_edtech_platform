-- Submission review, phase 1a (spec 8.2): append-only history of every mark change.
-- Live autosave scoring never writes here (spec R9).
CREATE TABLE IF NOT EXISTS mark_event (
  id                        VARCHAR(36)  PRIMARY KEY,
  institute_id              VARCHAR(255) NOT NULL,
  assessment_id             VARCHAR(255) NOT NULL,
  attempt_id                VARCHAR(255) NOT NULL,
  section_id                VARCHAR(255),
  question_id               VARCHAR(255),
  event_type                VARCHAR(40)  NOT NULL,
  old_marks                 NUMERIC(10,2),
  new_marks                 NUMERIC(10,2),
  max_marks                 NUMERIC(10,2),
  old_source                VARCHAR(20),
  new_source                VARCHAR(20),
  old_state                 VARCHAR(20),
  new_state                 VARCHAR(20),
  old_feedback              TEXT,
  new_feedback              TEXT,
  reason                    TEXT,
  actor_type                VARCHAR(10)  NOT NULL,
  actor_user_id             VARCHAR(255),
  ai_process_id             VARCHAR(36),
  ai_question_evaluation_id VARCHAR(36),
  rubric_version            INT,
  credits_charged           NUMERIC(10,2),
  after_release             BOOLEAN      NOT NULL DEFAULT FALSE,
  payload_json              TEXT,
  created_at                TIMESTAMP    NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mark_event_attempt  ON mark_event (attempt_id, created_at);
CREATE INDEX IF NOT EXISTS idx_mark_event_question ON mark_event (assessment_id, section_id, question_id, created_at);
