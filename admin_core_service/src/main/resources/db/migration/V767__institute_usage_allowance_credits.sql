-- Storage plans charged from the credit wallet (V766 follow-up).
--   currency 'CREDITS'      rates and add-on price are in credits; the month's extra is
--                           deducted from the institute's wallet by UsageChargeJob
--                           (any real currency, e.g. INR, stays shown-only / billed by hand)
--   addon_storage_gb        a storage pack added to included_storage_gb
--   addon_price_per_month   the pack's fixed monthly price, in currency
--   charge_from_month       first month charged (YYYY-MM); never earlier than the month
--                           the plan was set, so nothing is charged retroactively

ALTER TABLE institute_usage_allowance ALTER COLUMN currency TYPE VARCHAR(8);
ALTER TABLE institute_usage_allowance ADD COLUMN IF NOT EXISTS addon_storage_gb NUMERIC(14, 3) NOT NULL DEFAULT 0;
ALTER TABLE institute_usage_allowance ADD COLUMN IF NOT EXISTS addon_price_per_month NUMERIC(14, 4) NOT NULL DEFAULT 0;
ALTER TABLE institute_usage_allowance ADD COLUMN IF NOT EXISTS charge_from_month VARCHAR(7);

-- One row per institute and month charged to the wallet. credits = 0 when the month
-- stayed within the plan. FAILED rows are retried by the next run.
CREATE TABLE IF NOT EXISTS institute_usage_charge (
    id                    VARCHAR(255)   PRIMARY KEY,
    institute_id          VARCHAR(255)   NOT NULL,
    month                 VARCHAR(7)     NOT NULL,
    status                VARCHAR(16)    NOT NULL,
    credits               NUMERIC(14, 2) NOT NULL DEFAULT 0,
    storage_average_bytes BIGINT         NOT NULL DEFAULT 0,
    storage_extra_bytes   BIGINT         NOT NULL DEFAULT 0,
    bandwidth_bytes       BIGINT         NOT NULL DEFAULT 0,
    bandwidth_extra_bytes BIGINT         NOT NULL DEFAULT 0,
    addon_credits         NUMERIC(14, 2) NOT NULL DEFAULT 0,
    idempotency_key       VARCHAR(255)   NOT NULL,
    error                 TEXT,
    created_at            TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_institute_usage_charge UNIQUE (institute_id, month)
);
