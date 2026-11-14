-- Time-boxed news an admin feeds an engine (a festival greeting, an offer). The brain reads the ones
-- live right now; nothing tied to one is sent after it ends.
CREATE TABLE IF NOT EXISTS engagement_update (
    id            VARCHAR(255) PRIMARY KEY,
    engine_id     VARCHAR(255) NOT NULL,
    institute_id  VARCHAR(255) NOT NULL,
    message       TEXT         NOT NULL,
    template_name VARCHAR(255),
    starts_at     TIMESTAMP    NOT NULL,
    ends_at       TIMESTAMP    NOT NULL,
    status        VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE',
    announced_at  TIMESTAMP,
    created_by    VARCHAR(255),
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_engagement_update_engine ON engagement_update (engine_id, status, ends_at);
CREATE INDEX IF NOT EXISTS idx_engagement_update_open ON engagement_update (ends_at) WHERE status = 'ACTIVE';
