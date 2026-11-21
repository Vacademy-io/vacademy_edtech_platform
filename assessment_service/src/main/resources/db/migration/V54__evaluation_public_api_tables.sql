-- AI Evaluation public API v1 (docs/AI_EVALUATION_PUBLIC_API.md sections 5, 7.0, 7.5,
-- 11.5; build plan T1.17). Tables owned by the partner-API facade in assessment_service.
--
-- Nothing here changes an existing table except one new nullable column on
-- ai_question_evaluation (review_meta). Every statement is idempotent (IF NOT EXISTS),
-- so a partial run or a re-run is safe. No backfill: every table starts empty.
--
-- Ids are VARCHAR like the rest of this schema (assessment.id, student_attempt.id are
-- varchar(255); new ids minted by the facade are UUID strings, varchar(36)).

-- ---------------------------------------------------------------------------
-- Exams created through the API. One row per assessment with source = 'API'.
-- assessment_id = assessment.id = the public exam id. API-only fields live here so
-- the assessment table and the dashboard stay unchanged.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_exam (
    assessment_id      VARCHAR(255) PRIMARY KEY,
    institute_id       VARCHAR(255) NOT NULL,
    key_id             VARCHAR(36)  NOT NULL,
    external_ref       VARCHAR(128),
    mode               VARCHAR(16)  NOT NULL,                 -- handwritten | typed
    level              VARCHAR(16)  NOT NULL DEFAULT 'school', -- school | ug | pg | upsc
    subject            VARCHAR(120),
    board              VARCHAR(64),
    class_name         VARCHAR(32),
    answer_language    VARCHAR(8)   NOT NULL DEFAULT 'en',
    feedback_language  VARCHAR(8)   NOT NULL DEFAULT 'en',
    instructions       TEXT,                                  -- plain text (escaped on write)
    opened_at          TIMESTAMP,
    finalized_at       TIMESTAMP,
    -- Day (UTC) of the last "N copies graded" staff digest bell for this exam; the
    -- digest job claims a day with a guarded UPDATE so two pods never both send it.
    digest_sent_on     DATE,
    created_at         TIMESTAMP    NOT NULL DEFAULT now(),
    updated_at         TIMESTAMP    NOT NULL DEFAULT now()
);
-- Natural key that makes "create exam" safe to retry (409 exam_exists).
CREATE UNIQUE INDEX IF NOT EXISTS ux_api_exam_ref
    ON api_exam (institute_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_api_exam_feed
    ON api_exam (institute_id, updated_at, assessment_id);

-- ---------------------------------------------------------------------------
-- Candidates: per institute, reused across exams, addressed by the partner's own
-- external_id. Registration rows use user_id = 'apic_' || id (cannot log in).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_candidate (
    id                 VARCHAR(36)  PRIMARY KEY,
    institute_id       VARCHAR(255) NOT NULL,
    external_id        VARCHAR(128) NOT NULL,
    name               VARCHAR(255),
    roll_number        VARCHAR(64),
    section_or_class   VARCHAR(64),
    metadata           JSONB,                                 -- partner object, <= 2 KB, echoed back
    created_by_key_id  VARCHAR(36),
    created_at         TIMESTAMP    NOT NULL DEFAULT now(),
    updated_at         TIMESTAMP    NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_api_candidate_external
    ON api_candidate (institute_id, external_id);

-- ---------------------------------------------------------------------------
-- Submissions: attempt_id = student_attempt.id = the public submission id.
-- One LIVE submission per (exam, candidate), enforced here.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_submission (
    attempt_id         VARCHAR(255) PRIMARY KEY,
    exam_id            VARCHAR(255) NOT NULL,
    candidate_id       VARCHAR(36)  NOT NULL,
    institute_id       VARCHAR(255) NOT NULL,
    status             VARCHAR(16)  NOT NULL,                 -- LIVE | REPLACED | DELETED
    created_at         TIMESTAMP    NOT NULL DEFAULT now(),
    updated_at         TIMESTAMP    NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_api_submission_live
    ON api_submission (exam_id, candidate_id) WHERE status = 'LIVE';
CREATE INDEX IF NOT EXISTS idx_api_submission_feed
    ON api_submission (institute_id, updated_at, attempt_id);
CREATE INDEX IF NOT EXISTS idx_api_submission_exam
    ON api_submission (exam_id, updated_at, attempt_id);

-- ---------------------------------------------------------------------------
-- Uploads: proof that a media file belongs to this institute (gate G12). A
-- submission accepts only a ready upload of its own institute, once.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS eval_api_upload (
    id                         VARCHAR(36)  PRIMARY KEY,
    institute_id               VARCHAR(255) NOT NULL,
    key_id                     VARCHAR(36)  NOT NULL,
    file_id                    VARCHAR(255) NOT NULL,         -- media_service file_metadata id
    filename                   VARCHAR(255),
    content_type               VARCHAR(64)  NOT NULL,
    size_bytes                 BIGINT       NOT NULL,
    sha256                     CHAR(64),
    pages                      INT,
    status                     VARCHAR(16)  NOT NULL DEFAULT 'pending', -- pending | ready | rejected
    reject_reason              VARCHAR(32),
    consumed_by_submission_id  VARCHAR(255),
    created_at                 TIMESTAMP    NOT NULL DEFAULT now(),
    updated_at                 TIMESTAMP    NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_eval_api_upload_file
    ON eval_api_upload (file_id);
CREATE INDEX IF NOT EXISTS idx_eval_api_upload_institute
    ON eval_api_upload (institute_id, created_at);

-- ---------------------------------------------------------------------------
-- Idempotency-Key store (section 7.0). Scoped per institute, kept 48 h (purged by
-- a scheduled job). response_body is NULL for responses that carry a secret
-- (body_stored = false): a replay re-reads the resource instead.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_idempotency_key (
    institute_id       VARCHAR(255) NOT NULL,
    idem_key           VARCHAR(255) NOT NULL,
    key_id             VARCHAR(36),
    request_hash       CHAR(64)     NOT NULL,
    status             VARCHAR(16)  NOT NULL,                 -- IN_PROGRESS | COMPLETED
    http_status        INT,
    response_body      JSONB,
    body_stored        BOOLEAN      NOT NULL DEFAULT TRUE,
    resource_id        VARCHAR(255),
    created_at         TIMESTAMP    NOT NULL DEFAULT now(),
    completed_at       TIMESTAMP,
    PRIMARY KEY (institute_id, idem_key)
);
CREATE INDEX IF NOT EXISTS idx_api_idempotency_created
    ON api_idempotency_key (created_at);

-- ---------------------------------------------------------------------------
-- Daily quotas (section 11.5), incremented with one guarded
-- UPDATE ... WHERE copies + :n <= :limit RETURNING, never read-then-write.
-- day is the UTC calendar day.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_quota_usage (
    institute_id        VARCHAR(255) NOT NULL,
    day                 DATE         NOT NULL,
    copies              INT          NOT NULL DEFAULT 0,
    typed               INT          NOT NULL DEFAULT 0,
    pages               INT          NOT NULL DEFAULT 0,
    identify_pages      INT          NOT NULL DEFAULT 0,
    rubric_generations  INT          NOT NULL DEFAULT 0,
    PRIMARY KEY (institute_id, day)
);

CREATE TABLE IF NOT EXISTS api_key_quota_usage (
    key_id              VARCHAR(36)  NOT NULL,
    day                 DATE         NOT NULL,
    copies              INT          NOT NULL DEFAULT 0,
    PRIMARY KEY (key_id, day)
);

-- ---------------------------------------------------------------------------
-- Internal choice ("any 5 of 8", "33 OR 33-OR"), section 7.2. Sent to ai_service as
-- choice_groups + paper_max. question_ids is a JSON array of question ids.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assessment_choice_group (
    id                 VARCHAR(36)  PRIMARY KEY,
    assessment_id      VARCHAR(255) NOT NULL,
    label              VARCHAR(255),
    question_ids       JSONB        NOT NULL,
    attempt            INT          NOT NULL,
    policy             VARCHAR(16)  NOT NULL,                 -- first | best
    display_order      INT          NOT NULL DEFAULT 0,
    created_at         TIMESTAMP    NOT NULL DEFAULT now(),
    updated_at         TIMESTAMP    NOT NULL DEFAULT now(),
    CONSTRAINT ck_choice_group_attempt CHECK (attempt >= 1),
    CONSTRAINT ck_choice_group_policy CHECK (policy IN ('first', 'best'))
);
CREATE INDEX IF NOT EXISTS idx_choice_group_assessment
    ON assessment_choice_group (assessment_id);

-- ---------------------------------------------------------------------------
-- Reviewer shown on the dashboard for an API override:
-- {"reviewer":{"ref":"T-0042","name":"Mrs. Iyer"},"reason":"…","approved_by":…}
-- Plain text values, escaped on write. Nullable; no existing row changes.
-- ---------------------------------------------------------------------------
ALTER TABLE ai_question_evaluation ADD COLUMN IF NOT EXISTS review_meta JSONB;

-- ---------------------------------------------------------------------------
-- Exam facade bookkeeping (T1.21). Nullable / defaulted, so no existing row changes.
--  - conducted_on: the partner's exam date as sent. bound_start_time is clamped to the
--    open time when conducted_on is in the future, so the date itself is kept here.
--  - blind: Phase 3 flag, stored and echoed in v1.
--  - rubric_pending: rubric / model-answer changes accepted by the API but not yet
--    confirmed by ai_service ({"<question_id>": {"rubric": {...}|null,
--    "model_answer": "..."|null}}). Pushed after commit; a scheduled job retries while it
--    is non-null. rubric_pending_seq increments on every merge, so a push only clears
--    the outbox it actually sent.
-- ---------------------------------------------------------------------------
ALTER TABLE api_exam ADD COLUMN IF NOT EXISTS conducted_on DATE;
ALTER TABLE api_exam ADD COLUMN IF NOT EXISTS blind BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE api_exam ADD COLUMN IF NOT EXISTS rubric_pending JSONB;
ALTER TABLE api_exam ADD COLUMN IF NOT EXISTS rubric_pending_seq BIGINT NOT NULL DEFAULT 0;
ALTER TABLE api_exam ADD COLUMN IF NOT EXISTS rubric_pending_since TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_api_exam_rubric_pending
    ON api_exam (rubric_pending_since) WHERE rubric_pending IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Facade review fixes (T1.21 / 7.4). Nullable, so no existing row changes.
--  - deleted_external_ref: DELETE /exams/{id} moves external_ref here, so the partner can
--    reuse the ERP ref for a new exam (ux_api_exam_ref spans deleted rows too) while the
--    deleted exam still shows it in the feed.
--  - rubric_sync_error: a rubric / model-answer change ai_service refused for good
--    ({"status", "code", "question_ids", "at"}); shown as sync "failed" until later writes
--    of those questions sync. Never holds partner text.
-- ---------------------------------------------------------------------------
ALTER TABLE api_exam ADD COLUMN IF NOT EXISTS deleted_external_ref VARCHAR(128);
ALTER TABLE api_exam ADD COLUMN IF NOT EXISTS rubric_sync_error JSONB;

-- ---------------------------------------------------------------------------
-- Submissions, uploads, review and finalize (T1.23-T1.28, spec 7.5-7.10).
-- Nullable / defaulted, so no existing row changes. Every table here starts empty
-- except ai_evaluation_process, which only gains an index.
--  api_submission
--   - key_id, mode (handwritten | typed), upload_id, pages: what was accepted.
--   - metadata: the partner's object (<= 2 KB), echoed back.
--   - review_reasons: submission-level reasons the copy needs a human
--     (["pages_beyond_vision_limit"] for 41-80 page copies).
--   - approved_at / approved_by: POST /submissions/{id}/approve; cleared by a re-run.
--   - replaced_by: the submission that replaced this one (replace: true).
--  eval_api_upload
--   - upload_expires_at: when the presigned PUT stops working; until then the object
--     can still be overwritten, so a submission re-checks an upload validated before it.
--   - validated_at: last HEAD + inspect.
--  ai_evaluation_process (updated_at): lets the feed job find processes that moved
--  since its last pass, so GET /submissions?updated_since= sees engine progress.
-- ---------------------------------------------------------------------------
ALTER TABLE api_submission ADD COLUMN IF NOT EXISTS key_id VARCHAR(36);
ALTER TABLE api_submission ADD COLUMN IF NOT EXISTS mode VARCHAR(16);
ALTER TABLE api_submission ADD COLUMN IF NOT EXISTS upload_id VARCHAR(36);
ALTER TABLE api_submission ADD COLUMN IF NOT EXISTS pages INT;
ALTER TABLE api_submission ADD COLUMN IF NOT EXISTS metadata JSONB;
ALTER TABLE api_submission ADD COLUMN IF NOT EXISTS review_reasons JSONB;
ALTER TABLE api_submission ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP;
ALTER TABLE api_submission ADD COLUMN IF NOT EXISTS approved_by VARCHAR(255);
ALTER TABLE api_submission ADD COLUMN IF NOT EXISTS replaced_by VARCHAR(255);

ALTER TABLE eval_api_upload ADD COLUMN IF NOT EXISTS upload_expires_at TIMESTAMP;
ALTER TABLE eval_api_upload ADD COLUMN IF NOT EXISTS validated_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_ai_eval_process_updated
    ON ai_evaluation_process (updated_at);
