-- V744: Commerce switch-over (WP-53): the old system's day totals entered during a store's parallel run, with the
-- platform figures at save time. New table only; locks only stock_location (foreign key, brief). Re-runnable.
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS commerce_parallel_run_day (
    id               VARCHAR(36)   PRIMARY KEY,
    institute_id     VARCHAR(36)   NOT NULL,
    location_id      VARCHAR(36)   NOT NULL REFERENCES stock_location (id),
    business_date    DATE          NOT NULL,
    old_bill_count   INTEGER       NOT NULL,
    old_sales_value  NUMERIC(14,2) NOT NULL,
    old_tax          NUMERIC(14,2) NOT NULL,
    old_cash         NUMERIC(14,2) NOT NULL,
    old_returns      NUMERIC(14,2),
    platform_json    TEXT          NOT NULL,
    result           VARCHAR(16)   NOT NULL,
    note             VARCHAR(500),
    reviewed_by      VARCHAR(255)  NOT NULL,
    reviewed_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version          INTEGER       NOT NULL DEFAULT 0,
    created_at       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_parallel_run_day UNIQUE (institute_id, location_id, business_date),
    CONSTRAINT ck_parallel_run_day_result CHECK (result IN ('CLEAN', 'DIFFERENT')),
    CONSTRAINT ck_parallel_run_day_counts CHECK (old_bill_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_parallel_run_day_location
    ON commerce_parallel_run_day (institute_id, location_id, business_date);
