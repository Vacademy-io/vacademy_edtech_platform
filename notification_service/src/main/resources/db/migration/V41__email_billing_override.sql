-- Per-institute email pricing (custom deals). A NULL column falls back to email_billing_settings.
CREATE TABLE IF NOT EXISTS email_billing_override (
    institute_id          VARCHAR(64)   PRIMARY KEY,
    free_units_per_month  INTEGER,                 -- e.g. 5000
    credits_per_unit      NUMERIC(8,4),            -- e.g. 0.0269 (about 37 emails per credit)
    reason                TEXT,
    updated_at            TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (free_units_per_month IS NULL OR free_units_per_month >= 0),
    CHECK (credits_per_unit IS NULL OR credits_per_unit > 0)
);
