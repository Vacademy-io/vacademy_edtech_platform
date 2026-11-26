-- Journey status: where a learner stands in each batch (Learning, Temporary Break, At Risk, ...),
-- one row per learner per batch. The status list itself is the institute's
-- JOURNEY_STATUS_SETTING (off by default); a learner-in-batch without a row has the default
-- status. Every change is also written to the learner's timeline (timeline_event type
-- JOURNEY_CASE), the same place imported journey cases live.

CREATE TABLE IF NOT EXISTS learner_journey_status (
    id                 VARCHAR(255) PRIMARY KEY,
    institute_id       VARCHAR(255) NOT NULL,
    user_id            VARCHAR(255) NOT NULL,
    package_session_id VARCHAR(255) NOT NULL,
    status_key         VARCHAR(64)  NOT NULL,
    reason             VARCHAR(500),
    next_action_date   DATE,
    since              TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by_user_id VARCHAR(255),
    updated_by_name    VARCHAR(255),
    source             VARCHAR(20)  NOT NULL DEFAULT 'MANUAL',
    created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_learner_journey_status UNIQUE (institute_id, user_id, package_session_id)
);

CREATE INDEX IF NOT EXISTS idx_learner_journey_status_institute ON learner_journey_status (institute_id, status_key);
