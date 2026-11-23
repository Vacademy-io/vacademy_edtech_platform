-- Scan station: a clerk scans a pile of answer sheets in two passes (fronts, then
-- the pile turned over for the backs), load by load. ai_service reads each load
-- (which pass is the fronts, the name label on every front, which back belongs to
-- which front, which backs are blank); the copies, flags and verdict are worked
-- out from those facts plus the clerk's decisions every time the session is read
-- and are never stored. Once the verdict is READY one PDF per student is built
-- and handed to the existing bulk copy intake (ai_copy_intake_batch, source SCAN).
--
-- JSON is kept as TEXT, and there are no CHECK constraints, as in V46.

CREATE TABLE IF NOT EXISTS ai_scan_session (
    id                 VARCHAR(36)  PRIMARY KEY,
    assessment_id      VARCHAR(255) NOT NULL,
    institute_id       VARCHAR(255) NOT NULL,
    created_by_user_id VARCHAR(255),
    created_by_name    VARCHAR(255),
    status             VARCHAR(20)  NOT NULL DEFAULT 'OPEN',  -- OPEN | BUILDING | BUILT | STARTING | STARTED | FAILED
    decisions_json     TEXT,                                  -- {"fronts_direction": "FORWARD" | "REVERSED" | null}
    built_json         TEXT,                                  -- [{copy_key, file_id, page_count, file_name, page_map}]
    build_fingerprint  VARCHAR(64),
    intake_batch_id    VARCHAR(36),
    error_message      TEXT,
    version            BIGINT       NOT NULL DEFAULT 0,
    created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ai_scan_session_assessment ON ai_scan_session (assessment_id, institute_id, status);

CREATE TABLE IF NOT EXISTS ai_scan_load (
    id             VARCHAR(36)  PRIMARY KEY,
    session_id     VARCHAR(36)  NOT NULL REFERENCES ai_scan_session (id),
    load_no        INTEGER      NOT NULL,
    status         VARCHAR(20)  NOT NULL DEFAULT 'PENDING',   -- PENDING | ANALYSING | DONE | FAILED | REMOVED
    passes_json    TEXT         NOT NULL,                     -- the load request as the dashboard sent it
    result_json    TEXT,                                      -- ai_service's analyse-load answer, verbatim
    decisions_json TEXT,                                      -- the clerk's decisions on this load
    attempts       INTEGER      NOT NULL DEFAULT 0,
    claimed_at     TIMESTAMP,
    error_message  TEXT,
    version        BIGINT       NOT NULL DEFAULT 0,
    created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_ai_scan_load_session_load UNIQUE (session_id, load_no)
);
CREATE INDEX IF NOT EXISTS idx_ai_scan_load_status ON ai_scan_load (status);
