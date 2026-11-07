-- Bulk AI copy-check intake: a batch of scanned answer sheets uploaded without
-- a student attached. Each item is read for the handwritten name, matched to a
-- student of the assessment's batches, turned into an attempt and queued for
-- the AI check. Items the reader could not place (no name, two students with
-- that name) wait for an admin to resolve them.

CREATE TABLE IF NOT EXISTS ai_copy_intake_batch (
    id              VARCHAR(36)  PRIMARY KEY,
    assessment_id   VARCHAR(255) NOT NULL,
    institute_id    VARCHAR(255) NOT NULL,
    created_by      VARCHAR(255),
    created_by_name VARCHAR(255),
    created_by_email VARCHAR(255),
    preferred_model VARCHAR(100),
    status          VARCHAR(32)  NOT NULL,          -- RUNNING | NEEDS_REVIEW | COMPLETED | FAILED
    -- Per-status counts are NOT stored here: they are counted from the items
    -- on read, so parallel workers never fight over one row's counters.
    total_items     INTEGER      NOT NULL DEFAULT 0,
    notify_email    BOOLEAN      NOT NULL DEFAULT TRUE,
    email_status    VARCHAR(32),                     -- SENT | FAILED | SKIPPED
    notified_status VARCHAR(32),                     -- batch status the last notification described
    notified_at     TIMESTAMP,
    completed_at    TIMESTAMP,
    error_message   TEXT,
    created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ai_copy_intake_batch_assessment ON ai_copy_intake_batch (assessment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_copy_intake_batch_status ON ai_copy_intake_batch (status);

CREATE TABLE IF NOT EXISTS ai_copy_intake_item (
    id              VARCHAR(36)  PRIMARY KEY,
    batch_id        VARCHAR(36)  NOT NULL REFERENCES ai_copy_intake_batch (id),
    file_id         VARCHAR(255) NOT NULL,
    file_name       VARCHAR(512),
    page_count      INTEGER,
    status          VARCHAR(32)  NOT NULL,          -- PENDING | IDENTIFYING | MATCHED | AMBIGUOUS | UNMATCHED | QUEUED | EVALUATING | COMPLETED | FAILED | SKIPPED
    extracted_name  VARCHAR(255),
    extracted_roll  VARCHAR(128),
    extracted_class VARCHAR(128),
    extract_confidence NUMERIC(4,3),
    candidates_json TEXT,                            -- [{user_id, registration_id, name, batch_id, score}]
    match_score     NUMERIC(4,3),
    matched_user_id VARCHAR(255),
    matched_name    VARCHAR(255),
    registration_id VARCHAR(255),
    attempt_id      VARCHAR(255),
    process_id      VARCHAR(36),
    resolved_by     VARCHAR(255),
    error_message   TEXT,
    created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ai_copy_intake_item_batch ON ai_copy_intake_item (batch_id, status);
CREATE INDEX IF NOT EXISTS idx_ai_copy_intake_item_process ON ai_copy_intake_item (process_id);
CREATE INDEX IF NOT EXISTS idx_ai_copy_intake_item_attempt ON ai_copy_intake_item (attempt_id);
