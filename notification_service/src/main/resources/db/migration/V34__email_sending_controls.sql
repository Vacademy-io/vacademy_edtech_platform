-- Email sending controls for outbound campaigns:
--   * email_daily_quota   — per-sender per-day counter behind EMAIL_SETTING.data.<type>.max_per_day
--   * deferred_email      — sends that exceeded the cap, replayed by DeferredEmailDrainer next window
--   * email_unsubscribes  — recipient opt-outs (List-Unsubscribe / footer link), honoured before send

CREATE TABLE IF NOT EXISTS email_daily_quota (
    sender_key   VARCHAR(512) NOT NULL,   -- instituteId|emailType|from (lowercased)
    quota_date   DATE         NOT NULL,   -- calendar day in the sender's configured timezone
    sent         INTEGER      NOT NULL DEFAULT 0,
    updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT email_daily_quota_pkey PRIMARY KEY (sender_key, quota_date)
);

CREATE TABLE IF NOT EXISTS deferred_email (
    id                 VARCHAR(255) PRIMARY KEY,
    institute_id       VARCHAR(255),
    email_type         VARCHAR(100),
    sender_key         VARCHAR(512) NOT NULL,
    to_email           VARCHAR(255) NOT NULL,
    subject            TEXT,
    body               TEXT,
    service            VARCHAR(255),
    custom_from_email  VARCHAR(255),
    custom_from_name   VARCHAR(255),
    correlation_id     VARCHAR(255),
    user_id            VARCHAR(255),
    cc                 TEXT,            -- JSON array of addresses
    cc_mode            VARCHAR(10),
    send_after         TIMESTAMP    NOT NULL,
    status             VARCHAR(20)  NOT NULL DEFAULT 'PENDING', -- PENDING | SENT | FAILED | CANCELLED
    attempts           INTEGER      NOT NULL DEFAULT 0,
    last_error         TEXT,
    created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_deferred_email_due ON deferred_email (status, send_after);
CREATE INDEX IF NOT EXISTS idx_deferred_email_sender ON deferred_email (sender_key, status);

CREATE TABLE IF NOT EXISTS email_unsubscribes (
    id            VARCHAR(255) PRIMARY KEY,
    email         VARCHAR(255) NOT NULL,   -- lowercased
    institute_id  VARCHAR(255) NOT NULL,
    source        VARCHAR(30)  NOT NULL,   -- ONE_CLICK | LINK | MANUAL | REPLY
    reason        TEXT,
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_email_unsubscribes UNIQUE (email, institute_id)
);
CREATE INDEX IF NOT EXISTS idx_email_unsubscribes_lookup ON email_unsubscribes (email, institute_id, is_active);

COMMENT ON TABLE email_daily_quota IS 'Per-sender daily send counter; reserved atomically before dispatch.';
COMMENT ON TABLE deferred_email IS 'Emails held back by a per-sender daily cap, replayed when the next sending window opens.';
COMMENT ON TABLE email_unsubscribes IS 'Recipient opt-outs per institute; honoured for promotional sends and List-Unsubscribe-enabled senders.';
