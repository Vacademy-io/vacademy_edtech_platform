-- OMR sheets for pen-and-paper MCQ exams.
--
-- The admin prints one OMR sheet per paper set (A, B, ...), students bubble their
-- roll number (= institute enrollment number), the set code and one option per
-- question, and the filled sheets come back as scans. Each scanned page is read by
-- OMRChecker (ai_service), matched to a learner by the bubbled roll number, and
-- graded through the normal offline-entry marking. Results stay held until the
-- admin releases them.
--
-- The paper sets themselves live in assessment_set_mapping (json = the saved
-- question and option order of that set), so a set's answer key can always be
-- rebuilt exactly as it was printed.

-- {setCount, shuffleQuestions, shuffleOptions, rollDigits, density, layoutVersion, lockedAt}
ALTER TABLE assessment ADD COLUMN IF NOT EXISTS omr_config JSONB;

CREATE TABLE IF NOT EXISTS omr_scan_batch (
    id              VARCHAR(36)  PRIMARY KEY,
    assessment_id   VARCHAR(255) NOT NULL,
    institute_id    VARCHAR(255) NOT NULL,
    set_id          VARCHAR(255) NOT NULL,           -- assessment_set_mapping.id the sheets were printed for
    status          VARCHAR(32)  NOT NULL,           -- RUNNING | NEEDS_REVIEW | COMPLETED | FAILED
    -- Per-status counts are counted from the items on read (as in ai_copy_intake_batch),
    -- so parallel workers never fight over one row's counters.
    total_files     INTEGER      NOT NULL DEFAULT 0,
    created_by      VARCHAR(255),
    created_by_name VARCHAR(255),
    error_message   TEXT,
    completed_at    TIMESTAMP,
    created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_omr_scan_batch_assessment ON omr_scan_batch (assessment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_omr_scan_batch_status ON omr_scan_batch (status);

-- One uploaded file. A multi-page PDF is split into one SHEET row per page once read,
-- and the FILE row is then marked SPLIT, so every sheet has its own status.
CREATE TABLE IF NOT EXISTS omr_scan_item (
    id                    VARCHAR(36)  PRIMARY KEY,
    batch_id              VARCHAR(36)  NOT NULL REFERENCES omr_scan_batch (id),
    parent_item_id        VARCHAR(36),                  -- the FILE row a page came from
    file_id               VARCHAR(255) NOT NULL,        -- the uploaded file (PDF or image)
    file_name             VARCHAR(512),
    page_no               INTEGER,                      -- 1-based page within file_id, null for a FILE row
    status                VARCHAR(32)  NOT NULL,        -- PENDING | READING | SPLIT | GRADED | NEEDS_REVIEW | FAILED | SKIPPED
    reason_code           VARCHAR(64),                  -- why it needs review / failed (ROLL_BLANK, ROLL_UNMATCHED, SET_MISMATCH, ...)
    reason                TEXT,
    sheet_image_file_id   VARCHAR(255),                 -- the page as scanned (JPEG)
    marked_image_file_id  VARCHAR(255),                 -- OMRChecker's overlay of the detected bubbles
    name_crop_file_id     VARCHAR(255),                 -- the handwritten name box, for the reviewer's eye only
    read_roll             VARCHAR(64),                  -- digits as read; '?' for a blank/multi digit
    read_set              VARCHAR(16),
    answers_json          TEXT,                         -- {"1":"B","2":"","3":"AC",...} as read
    flags_json            TEXT,                         -- {"3":"MULTI","7":"LOW_CONFIDENCE"}
    fixes_json            TEXT,                         -- admin corrections of flagged questions, with who and when
    roll_low_confidence   BOOLEAN      NOT NULL DEFAULT FALSE,
    matched_user_id       VARCHAR(255),
    matched_name          VARCHAR(255),
    registration_id       VARCHAR(255),
    attempt_id            VARCHAR(255),
    resolved_by           VARCHAR(255),
    created_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_omr_scan_item_batch ON omr_scan_item (batch_id, status);
CREATE INDEX IF NOT EXISTS idx_omr_scan_item_attempt ON omr_scan_item (attempt_id);
CREATE INDEX IF NOT EXISTS idx_omr_scan_item_user ON omr_scan_item (matched_user_id);
