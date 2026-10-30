-- engagement_asset was never created on environments that had already applied the OTHER
-- V625 (template reuse) before it was renumbered to V627: Flyway treated 625 as done and
-- skipped this table. Idempotent re-create of V625__engagement_assets.sql, so it is a no-op
-- wherever the table already exists.
CREATE TABLE IF NOT EXISTS engagement_asset (
    id            VARCHAR(255) PRIMARY KEY,
    engine_id     VARCHAR(255) NOT NULL,
    institute_id  VARCHAR(255) NOT NULL,
    title         VARCHAR(200) NOT NULL,
    description   TEXT,
    media_type    VARCHAR(20)  NOT NULL,
    url           TEXT         NOT NULL,
    file_id       VARCHAR(255),
    filename      VARCHAR(255),
    mime_type     VARCHAR(120),
    size_bytes    BIGINT,
    created_by    VARCHAR(255),
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ea_engine ON engagement_asset (engine_id);
