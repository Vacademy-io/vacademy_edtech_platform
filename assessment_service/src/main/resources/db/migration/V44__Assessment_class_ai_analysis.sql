-- One AI-written class analysis per assessment, generated once and re-served free.
--
-- The UNIQUE (assessment_id, institute_id) is the anti-double-charge mechanism,
-- not a tidiness constraint. An idempotency key on the credit deduction stops a
-- second CHARGE but not a second MODEL CALL: two admins clicking Generate in the
-- same second would otherwise both hit OpenRouter (real cash) and the second
-- write would clobber the first. Generation claims this row with
-- ON CONFLICT DO NOTHING in its own committed transaction BEFORE calling the
-- model, so exactly one caller proceeds and the other is told it is already
-- running and will not be charged twice.
CREATE TABLE IF NOT EXISTS assessment_class_ai_analysis (
    id                  VARCHAR(255) PRIMARY KEY,
    assessment_id       VARCHAR(255) NOT NULL,
    institute_id        VARCHAR(255) NOT NULL,

    -- GENERATING -> READY | FAILED. A row is claimed as GENERATING before the
    -- model call so a concurrent request can see it.
    status              VARCHAR(32)  NOT NULL,

    -- The model's JSON (narrative, action plan, per-topic guidance) and the
    -- rendered PDF's media file id. The PDF is re-rendered from analysis_json
    -- if the file is ever lost, so analysis_json is the source of truth.
    analysis_json       TEXT,
    pdf_file_id         VARCHAR(255),

    -- Detects "the results changed after this was generated". Hashes a sorted
    -- list of (attempt_id, rounded marks) plus release/evaluation stamps —
    -- student_attempt.updated_at is insertable=false/updatable=false with no
    -- trigger, so a re-evaluation moves NO timestamp and a time-based check
    -- can never fire.
    content_fingerprint VARCHAR(128),

    model               VARCHAR(255),

    -- Billing. idempotency_key is the ROW id, never the assessment id: keying
    -- on the assessment would make every future paid regenerate a silent
    -- free no-op (ai_service short-circuits the deduction and still reports
    -- success). charge_status makes an unbilled report reconcilable, since
    -- ai_service's billing wrapper swallows every error and nothing retries.
    idempotency_key     VARCHAR(255),
    charge_status       VARCHAR(32)  NOT NULL DEFAULT 'PENDING',
    credits_quoted      NUMERIC(10, 4),

    generated_by_user_id VARCHAR(255),
    claimed_at          TIMESTAMP,
    generated_at        TIMESTAMP,
    created_at          TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_class_ai_analysis_assessment_institute
    ON assessment_class_ai_analysis (assessment_id, institute_id);

-- Lets a sweeper reclaim rows stranded in GENERATING by a pod that died
-- mid-call, rather than leaving that assessment permanently unbuildable.
CREATE INDEX IF NOT EXISTS idx_class_ai_analysis_status_claimed
    ON assessment_class_ai_analysis (status, claimed_at);
