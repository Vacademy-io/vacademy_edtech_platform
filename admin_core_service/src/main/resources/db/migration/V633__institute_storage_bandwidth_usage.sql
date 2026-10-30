-- Daily storage and bandwidth per institute, written by UsageMeteringJob from
-- S3 Inventory (storage), CloudFront access logs and S3 server access logs
-- (bandwidth). One row per day x institute x bucket/channel x category; a re-run
-- for a day replaces that day's rows. institute_id is '_UNASSIGNED' for files whose
-- key could not be traced to an institute.

CREATE TABLE IF NOT EXISTS institute_storage_usage_daily (
    id           VARCHAR(255) PRIMARY KEY,
    usage_date   DATE         NOT NULL,
    institute_id VARCHAR(255) NOT NULL,
    bucket       VARCHAR(255) NOT NULL,
    category     VARCHAR(32)  NOT NULL,
    bytes        BIGINT       NOT NULL,
    object_count BIGINT       NOT NULL,
    created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_institute_storage_usage_daily UNIQUE (usage_date, institute_id, bucket, category)
);

CREATE INDEX IF NOT EXISTS idx_institute_storage_usage_daily_institute
    ON institute_storage_usage_daily (institute_id, usage_date);

CREATE TABLE IF NOT EXISTS institute_bandwidth_usage_daily (
    id           VARCHAR(255) PRIMARY KEY,
    usage_date   DATE         NOT NULL,
    institute_id VARCHAR(255) NOT NULL,
    channel      VARCHAR(32)  NOT NULL,
    category     VARCHAR(32)  NOT NULL,
    bytes        BIGINT       NOT NULL,
    requests     BIGINT       NOT NULL,
    created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_institute_bandwidth_usage_daily UNIQUE (usage_date, institute_id, channel, category)
);

CREATE INDEX IF NOT EXISTS idx_institute_bandwidth_usage_daily_institute
    ON institute_bandwidth_usage_daily (institute_id, usage_date);
