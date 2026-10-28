-- Email templates of an Engagement Engine: written by AI from the engine brief, reviewed and
-- approved by an admin, then picked by the brain and rendered by the dispatcher.
-- name is stable across versions. Editing an APPROVED template creates the next version, and the
-- older approved row becomes SUPERSEDED only when the new one is approved.
-- status: AI_PROPOSED, USER_REVIEW, APPROVED, SUPERSEDED, ARCHIVED
CREATE TABLE IF NOT EXISTS engagement_email_template (
    id               VARCHAR(255) PRIMARY KEY,
    engine_id        VARCHAR(255) NOT NULL,
    institute_id     VARCHAR(255) NOT NULL,
    name             VARCHAR(120) NOT NULL,
    version          INT          NOT NULL DEFAULT 1,
    title            VARCHAR(255),
    purpose          VARCHAR(120),
    language         VARCHAR(10)  NOT NULL DEFAULT 'en',
    subject          VARCHAR(255) NOT NULL,
    preheader        VARCHAR(255),
    body_html        TEXT         NOT NULL,
    variable_names   JSONB        NOT NULL DEFAULT '[]',
    sample_values    JSONB        NOT NULL DEFAULT '[]',
    variable_sources JSONB        NOT NULL DEFAULT '{}',
    warnings         JSONB        NOT NULL DEFAULT '[]',
    status           VARCHAR(20)  NOT NULL DEFAULT 'AI_PROPOSED',
    rationale        TEXT,
    created_by       VARCHAR(255),
    approved_by      VARCHAR(255),
    approved_at      TIMESTAMP,
    created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_eet_engine_status
    ON engagement_email_template (engine_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS ux_eet_engine_name_version
    ON engagement_email_template (engine_id, name, version);

-- At most one approved version of a template per engine.
CREATE UNIQUE INDEX IF NOT EXISTS ux_eet_one_approved
    ON engagement_email_template (engine_id, name)
    WHERE status = 'APPROVED';
