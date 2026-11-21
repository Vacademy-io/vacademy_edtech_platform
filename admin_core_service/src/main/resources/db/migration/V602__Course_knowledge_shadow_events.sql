-- ================================================================================
-- V602: Course knowledge shadow results
--
-- In shadow mode (course_knowledge.retrieval_mode = 'shadow') every learner turn
-- runs the course retrieval it would use and throws the result away. Until now
-- the result was only a log line (course_kb.shadow ...), and pod logs reset on
-- every ai_service deploy, so the go-live numbers (p95 added latency, how often
-- lessons match, leak_blocked = 0) never covered more than a few hours. One row
-- per probe here keeps them across deploys. ai_service writes it (raw SQL,
-- app/services/course_knowledge/shadow_events.py) and the drift sweep deletes
-- rows older than 30 days. No learner text is stored: counts and timings only.
--
-- Additive and idempotent: a new table, nothing existing is touched.
-- ================================================================================

CREATE TABLE IF NOT EXISTS course_knowledge_shadow_event (
    id             BIGSERIAL     PRIMARY KEY,
    institute_id   VARCHAR(255)  NOT NULL,
    session_id     VARCHAR(255),
    open_lessons   INTEGER       NOT NULL DEFAULT 0,
    hits           INTEGER       NOT NULL DEFAULT 0,
    signposts      INTEGER       NOT NULL DEFAULT 0,
    kb_refs        INTEGER       NOT NULL DEFAULT 0,
    top_similarity REAL,
    latency_ms     INTEGER       NOT NULL DEFAULT 0,
    total_ms       INTEGER       NOT NULL DEFAULT 0,
    truncated      BOOLEAN       NOT NULL DEFAULT FALSE,
    block_chars    INTEGER       NOT NULL DEFAULT 0,
    leak_blocked   INTEGER       NOT NULL DEFAULT 0,
    error          VARCHAR(64),
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ckse_institute_time
    ON course_knowledge_shadow_event (institute_id, created_at DESC);
