-- Email billing: institutes pay credits for the emails we send through our SES.
--
-- Pricing (owner decision 2026-11-08): flat 0.04 credit per email unit (25 emails per credit),
-- the first 1,000 units per institute per calendar month (IST) free. One unit = one recipient
-- copy (TO, CC and BCC each count, SES bills per recipient); every full MiB of attachments adds
-- one more unit per copy.
--
-- Classes: FREE (OTP, password reset, login credentials, our own billing mail) is never counted
-- against the allowance, never charged, never blocked. ESSENTIAL (payment receipts, invoices)
-- is charged but never blocked. BILLABLE is everything else. EXCLUDED is mail with no institute
-- and Engagement Engine mail, which admin-core already charges per message.

-- What was sent, per institute, IST day and class. Written after every successful send.
CREATE TABLE IF NOT EXISTS email_usage_daily (
    institute_id   VARCHAR(64)  NOT NULL,
    usage_date     DATE         NOT NULL,
    billing_class  VARCHAR(16)  NOT NULL,
    emails         INTEGER      NOT NULL DEFAULT 0,
    units          INTEGER      NOT NULL DEFAULT 0,
    updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (institute_id, usage_date, billing_class)
);

-- Running monthly totals the gate and the charge job read: chargeable units sent (BILLABLE +
-- ESSENTIAL) and how many of the units beyond the free allowance have been charged.
CREATE TABLE IF NOT EXISTS email_billing_month (
    institute_id        VARCHAR(64)   NOT NULL,
    period_month        VARCHAR(7)    NOT NULL,          -- 'YYYY-MM', IST
    chargeable_units    BIGINT        NOT NULL DEFAULT 0,
    charged_units       BIGINT        NOT NULL DEFAULT 0, -- units beyond the free allowance already charged
    charged_credits     NUMERIC(12,2) NOT NULL DEFAULT 0,
    notified_free_80    BOOLEAN       NOT NULL DEFAULT FALSE,
    notified_free_100   BOOLEAN       NOT NULL DEFAULT FALSE,
    last_block_notice_at TIMESTAMP,
    updated_at          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (institute_id, period_month)
);

-- One row per charge sent to the credit ledger. idempotency_key is what admin-core passes to
-- the ledger, so a retried row can never charge twice.
CREATE TABLE IF NOT EXISTS email_billing_charge (
    id               VARCHAR(64)   PRIMARY KEY,
    institute_id     VARCHAR(64)   NOT NULL,
    period_month     VARCHAR(7)    NOT NULL,
    from_unit        BIGINT        NOT NULL,   -- exclusive, counted beyond the free allowance
    to_unit          BIGINT        NOT NULL,   -- inclusive
    credits          NUMERIC(12,2) NOT NULL,
    status           VARCHAR(16)   NOT NULL,   -- PENDING, CHARGED
    idempotency_key  VARCHAR(160)  NOT NULL UNIQUE,
    attempts         INTEGER       NOT NULL DEFAULT 0,
    last_error       TEXT,
    created_at       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    charged_at       TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_email_billing_charge_pending
    ON email_billing_charge (status, created_at) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_email_billing_charge_institute
    ON email_billing_charge (institute_id, period_month);

-- Emails not sent because the institute had no free allowance and no credits left. Kept so the
-- admin can see them and resend after topping up. Attachments are kept up to 10 MiB per email.
CREATE TABLE IF NOT EXISTS email_blocked (
    id                  VARCHAR(64)  PRIMARY KEY,
    institute_id        VARCHAR(64)  NOT NULL,
    to_email            VARCHAR(320) NOT NULL,
    cc                  TEXT,
    cc_mode             VARCHAR(8),
    subject             TEXT,
    body                TEXT,
    email_type          VARCHAR(64),
    log_source          VARCHAR(64),
    from_email          VARCHAR(320),
    from_name           VARCHAR(255),
    user_id             VARCHAR(64),
    attachments         TEXT,        -- JSON [{filename, contentBase64}] or NULL
    attachments_dropped BOOLEAN      NOT NULL DEFAULT FALSE,
    units               INTEGER      NOT NULL DEFAULT 1,
    status              VARCHAR(16)  NOT NULL DEFAULT 'BLOCKED',  -- BLOCKED, RESENT, DISCARDED
    created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at         TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_email_blocked_institute
    ON email_blocked (institute_id, status, created_at DESC);

-- Switches, read with a short cache so they change without a redeploy. Everything starts off:
-- this migration only starts counting.
CREATE TABLE IF NOT EXISTS email_billing_settings (
    id                 INTEGER       PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    enforce_enabled    BOOLEAN       NOT NULL DEFAULT FALSE,  -- block BILLABLE mail when out of free + credits
    charge_enabled     BOOLEAN       NOT NULL DEFAULT FALSE,  -- push charges to the credit ledger
    notify_enabled     BOOLEAN       NOT NULL DEFAULT FALSE,  -- allowance / block notice emails
    free_units_per_month INTEGER     NOT NULL DEFAULT 1000,
    credits_per_unit   NUMERIC(8,4)  NOT NULL DEFAULT 0.04,
    updated_at         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO email_billing_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Institutes counted but never charged or blocked (custom deals, our own test institutes).
CREATE TABLE IF NOT EXISTS email_billing_exemption (
    institute_id  VARCHAR(64)  PRIMARY KEY,
    reason        TEXT,
    until_date    DATE,                     -- NULL = until removed
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
