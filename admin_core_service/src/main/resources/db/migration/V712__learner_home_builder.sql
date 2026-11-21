-- Learner home builder (Phase 1): per-institute block layouts for the learner dashboard,
-- per-learner notice state and the analytics tables. New tables only; no existing table is altered.

CREATE TABLE IF NOT EXISTS learner_home_layout (
    id                    VARCHAR(36)  PRIMARY KEY,
    institute_id          VARCHAR(36)  NOT NULL,
    status                VARCHAR(16)  NOT NULL,
    version               INTEGER      NOT NULL DEFAULT 0,
    base_version          INTEGER,
    revision              INTEGER      NOT NULL DEFAULT 1,
    template_key          VARCHAR(32),
    settings_json         JSONB        NOT NULL DEFAULT '{}'::jsonb,
    created_by_user_id    VARCHAR(36),
    updated_by_user_id    VARCHAR(36),
    published_by_user_id  VARCHAR(36),
    published_at          TIMESTAMPTZ,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT chk_lhl_status CHECK (status IN ('DRAFT','PUBLISHED','ARCHIVED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lhl_one_draft     ON learner_home_layout (institute_id) WHERE status = 'DRAFT';
CREATE UNIQUE INDEX IF NOT EXISTS uq_lhl_one_published ON learner_home_layout (institute_id) WHERE status = 'PUBLISHED';
CREATE INDEX        IF NOT EXISTS idx_lhl_inst_version ON learner_home_layout (institute_id, version DESC);

CREATE TABLE IF NOT EXISTS learner_home_block (
    id                 VARCHAR(36)  PRIMARY KEY,
    layout_id          VARCHAR(36)  NOT NULL REFERENCES learner_home_layout(id) ON DELETE CASCADE,
    institute_id       VARCHAR(36)  NOT NULL,
    block_key          VARCHAR(36)  NOT NULL,
    type               VARCHAR(32)  NOT NULL,
    builtin_widget     VARCHAR(48),
    position           INTEGER      NOT NULL,
    desktop_placement  VARCHAR(8)   NOT NULL DEFAULT 'MAIN',
    devices            VARCHAR(8)   NOT NULL DEFAULT 'BOTH',
    enabled            BOOLEAN      NOT NULL DEFAULT TRUE,
    admin_label        VARCHAR(120),
    starts_at          TIMESTAMPTZ,
    ends_at            TIMESTAMPTZ,
    audience_json      JSONB        NOT NULL DEFAULT '{"mode":"EVERYONE"}'::jsonb,
    config_json        JSONB        NOT NULL DEFAULT '{}'::jsonb,
    schema_version     SMALLINT     NOT NULL DEFAULT 1,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_lhb_layout_key UNIQUE (layout_id, block_key),
    CONSTRAINT chk_lhb_type CHECK (type IN ('BANNER_CAROUSEL','SHORTCUTS','COURSE_SHELF','NOTICE','EVENT','BUILTIN')),
    CONSTRAINT chk_lhb_place CHECK (desktop_placement IN ('FULL','MAIN','RAIL')),
    CONSTRAINT chk_lhb_devices CHECK (devices IN ('BOTH','PHONE','DESKTOP')),
    CONSTRAINT chk_lhb_window CHECK (starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at),
    CONSTRAINT chk_lhb_builtin CHECK ((type = 'BUILTIN') = (builtin_widget IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_lhb_layout_position ON learner_home_block (layout_id, position);
CREATE INDEX IF NOT EXISTS idx_lhb_inst_key        ON learner_home_block (institute_id, block_key);

CREATE TABLE IF NOT EXISTS learner_home_block_user_state (
    institute_id     VARCHAR(36) NOT NULL,
    user_id          VARCHAR(36) NOT NULL,
    block_key        VARCHAR(36) NOT NULL,
    dismissed_at     TIMESTAMPTZ,
    acknowledged_at  TIMESTAMPTZ,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (institute_id, user_id, block_key)
);
CREATE INDEX IF NOT EXISTS idx_lhbus_ack ON learner_home_block_user_state (institute_id, block_key)
    WHERE acknowledged_at IS NOT NULL;

-- Click, dismiss and acknowledge events, one row each. Rows older than 180 days are deleted nightly.
CREATE TABLE IF NOT EXISTS learner_home_event (
    id              VARCHAR(36) PRIMARY KEY,
    institute_id    VARCHAR(36) NOT NULL,
    block_key       VARCHAR(36) NOT NULL,
    item_key        VARCHAR(36),
    event_type      VARCHAR(16) NOT NULL,
    user_id         VARCHAR(36) NOT NULL,
    layout_version  INTEGER,
    device          VARCHAR(8),
    platform        VARCHAR(12),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lhe_inst_block_created ON learner_home_event (institute_id, block_key, created_at);
CREATE INDEX IF NOT EXISTS idx_lhe_inst_created       ON learner_home_event (institute_id, created_at);
-- For the nightly retention delete, which runs across institutes.
CREATE INDEX IF NOT EXISTS idx_lhe_created            ON learner_home_event (created_at);

-- Views, counted into daily totals per institute day (institute timezone).
CREATE TABLE IF NOT EXISTS learner_home_view_daily (
    institute_id  VARCHAR(36) NOT NULL,
    day           DATE        NOT NULL,
    block_key     VARCHAR(36) NOT NULL,
    item_key      VARCHAR(36) NOT NULL DEFAULT '',
    device        VARCHAR(8)  NOT NULL,
    views         BIGINT      NOT NULL DEFAULT 0,
    PRIMARY KEY (institute_id, day, block_key, item_key, device)
);
