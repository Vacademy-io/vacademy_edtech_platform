-- The engine's assets: brochures, demo videos, price sheets and other material the agent may send
-- when a person asks for it. The reply brain sees title + description only; the file itself is
-- sent as a native WhatsApp attachment. If nothing in the assets matches, a counsellor is alerted.
CREATE TABLE IF NOT EXISTS engagement_asset (
    id            VARCHAR(255) PRIMARY KEY,
    engine_id     VARCHAR(255) NOT NULL,
    institute_id  VARCHAR(255) NOT NULL,
    title         VARCHAR(200) NOT NULL,
    description   TEXT,                                   -- what it is and when to send it (the brain reads this)
    media_type    VARCHAR(20)  NOT NULL,                  -- document | image | video | audio | link
    url           TEXT         NOT NULL,                  -- public URL (Meta fetches it by link)
    file_id       VARCHAR(255),                           -- media_service file id; null for a plain link
    filename      VARCHAR(255),
    mime_type     VARCHAR(120),
    size_bytes    BIGINT,
    created_by    VARCHAR(255),
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ea_engine ON engagement_asset (engine_id);
