-- Storage and bandwidth allowance per institute: what its plan includes and what each
-- extra GB costs. Opt-in: an institute without a row has no allowance and its admins
-- see plain usage, as before. Nothing blocks uploads or raises invoices from this table;
-- UsageAllowanceService works out the month's extra charge for the screens.
--   included_storage_gb   compared with the month's AVERAGE stored GB (nightly snapshots)
--   included_bandwidth_gb compared with the month's TOTAL delivered GB
--   *_rate_per_gb          price per extra GB, in currency (storage per GB-month)

CREATE TABLE IF NOT EXISTS institute_usage_allowance (
    institute_id          VARCHAR(255)   PRIMARY KEY,
    included_storage_gb   NUMERIC(14, 3) NOT NULL DEFAULT 0,
    included_bandwidth_gb NUMERIC(14, 3) NOT NULL DEFAULT 0,
    storage_rate_per_gb   NUMERIC(14, 4) NOT NULL DEFAULT 0,
    bandwidth_rate_per_gb NUMERIC(14, 4) NOT NULL DEFAULT 0,
    currency              VARCHAR(3)     NOT NULL DEFAULT 'INR',
    note                  TEXT,
    updated_by            VARCHAR(255),
    created_at            TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP
);
