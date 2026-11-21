-- Commerce WP-33: buyer messages for order events (an outbox written in the same transaction as the
-- order change, one delivery row per channel), per-shop settings rows, and the revocation counter of
-- signed order links. Commerce tables only. Re-runnable.
SET LOCAL lock_timeout = '5s';

-- Bumped to revoke every signed link of the order that is not yet opened.
ALTER TABLE commerce_order ADD COLUMN IF NOT EXISTS link_epoch SMALLINT NOT NULL DEFAULT 0;

-- One row per shop and trigger, only when staff changed something; no row = the defaults.
CREATE TABLE IF NOT EXISTS commerce_notification_setting (
    institute_id            VARCHAR(36)   NOT NULL,
    trigger_code            VARCHAR(32)   NOT NULL,
    enabled                 BOOLEAN       NOT NULL DEFAULT TRUE,
    email_enabled           BOOLEAN       NOT NULL DEFAULT TRUE,
    whatsapp_enabled        BOOLEAN       NOT NULL DEFAULT TRUE,
    whatsapp_template_name  VARCHAR(100),
    email_subject_hi        VARCHAR(200),
    email_body_hi           TEXT,
    email_subject_en        VARCHAR(200),
    email_body_en           TEXT,
    version                 INTEGER       NOT NULL DEFAULT 0,
    updated_by              VARCHAR(36),
    updated_at              TIMESTAMP     NOT NULL DEFAULT now(),
    PRIMARY KEY (institute_id, trigger_code)
);

-- The outbox: one row per order event worth a message.
CREATE TABLE IF NOT EXISTS commerce_notification_event (
    id               VARCHAR(36)   PRIMARY KEY,
    institute_id     VARCHAR(36)   NOT NULL,
    order_id         VARCHAR(36)   NOT NULL REFERENCES commerce_order (id),
    trigger_code     VARCHAR(32)   NOT NULL,
    ref_id           VARCHAR(36)   NOT NULL DEFAULT '',   -- shipment, return or refund id; '' for the order
    status           VARCHAR(16)   NOT NULL DEFAULT 'PENDING',
    skip_reason      VARCHAR(32),
    attempts         SMALLINT      NOT NULL DEFAULT 0,
    next_attempt_at  TIMESTAMP     NOT NULL DEFAULT now(),
    created_at       TIMESTAMP     NOT NULL DEFAULT now(),
    planned_at       TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_commerce_notification_event_key
    ON commerce_notification_event (institute_id, order_id, trigger_code, ref_id);
CREATE INDEX IF NOT EXISTS idx_commerce_notification_event_due
    ON commerce_notification_event (next_attempt_at) WHERE status = 'PENDING';

-- One row per event and channel: the dedupe key of "one message per order, trigger, ref and channel".
CREATE TABLE IF NOT EXISTS commerce_notification_delivery (
    id                   VARCHAR(36)   PRIMARY KEY,
    event_id             VARCHAR(36)   NOT NULL REFERENCES commerce_notification_event (id),
    institute_id         VARCHAR(36)   NOT NULL,
    order_id             VARCHAR(36)   NOT NULL,
    trigger_code         VARCHAR(32)   NOT NULL,
    channel              VARCHAR(16)   NOT NULL,
    locale               VARCHAR(8)    NOT NULL,
    status               VARCHAR(16)   NOT NULL DEFAULT 'PENDING',
    recipient_hash       VARCHAR(64),     -- HMAC of the normalised address; never the address
    recipient_masked     VARCHAR(64),     -- ••••••3210 / a•••@example.com
    template_name        VARCHAR(100),
    attempts             SMALLINT      NOT NULL DEFAULT 0,
    next_attempt_at      TIMESTAMP     NOT NULL DEFAULT now(),
    claimed_at           TIMESTAMP,
    sent_at              TIMESTAMP,
    provider_message_id  VARCHAR(128),
    error_code           VARCHAR(48),
    error_detail         VARCHAR(300),    -- cleaned of digits runs and e-mail addresses
    created_at           TIMESTAMP     NOT NULL DEFAULT now(),
    updated_at           TIMESTAMP     NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_commerce_notification_delivery_channel
    ON commerce_notification_delivery (event_id, channel);
CREATE INDEX IF NOT EXISTS idx_commerce_notification_delivery_due
    ON commerce_notification_delivery (next_attempt_at) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_commerce_notification_delivery_sending
    ON commerce_notification_delivery (claimed_at) WHERE status = 'SENDING';
CREATE INDEX IF NOT EXISTS idx_commerce_notification_delivery_order
    ON commerce_notification_delivery (order_id);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_commerce_order_link_epoch') THEN
        ALTER TABLE commerce_order ADD CONSTRAINT ck_commerce_order_link_epoch CHECK (link_epoch >= 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_commerce_notification_setting_trigger_code') THEN
        ALTER TABLE commerce_notification_setting ADD CONSTRAINT ck_commerce_notification_setting_trigger_code
            CHECK (trigger_code IN ('ORDER_CONFIRMED', 'COD_CONFIRMATION_NEEDED', 'ORDER_SHIPPED', 'ORDER_DELIVERED',
                'ORDER_CANCELLED', 'ORDER_RTO', 'RETURN_APPROVED', 'REFUND_PROCESSED', 'POS_BILL_ISSUED'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_commerce_notification_event_trigger_code') THEN
        ALTER TABLE commerce_notification_event ADD CONSTRAINT ck_commerce_notification_event_trigger_code
            CHECK (trigger_code IN ('ORDER_CONFIRMED', 'COD_CONFIRMATION_NEEDED', 'ORDER_SHIPPED', 'ORDER_DELIVERED',
                'ORDER_CANCELLED', 'ORDER_RTO', 'RETURN_APPROVED', 'REFUND_PROCESSED', 'POS_BILL_ISSUED'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_commerce_notification_event_status') THEN
        ALTER TABLE commerce_notification_event ADD CONSTRAINT ck_commerce_notification_event_status
            CHECK (status IN ('PENDING', 'PLANNED', 'SKIPPED'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_commerce_notification_delivery_trigger_code') THEN
        ALTER TABLE commerce_notification_delivery ADD CONSTRAINT ck_commerce_notification_delivery_trigger_code
            CHECK (trigger_code IN ('ORDER_CONFIRMED', 'COD_CONFIRMATION_NEEDED', 'ORDER_SHIPPED', 'ORDER_DELIVERED',
                'ORDER_CANCELLED', 'ORDER_RTO', 'RETURN_APPROVED', 'REFUND_PROCESSED', 'POS_BILL_ISSUED'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_commerce_notification_delivery_channel') THEN
        ALTER TABLE commerce_notification_delivery ADD CONSTRAINT ck_commerce_notification_delivery_channel
            CHECK (channel IN ('EMAIL', 'WHATSAPP', 'WORKFLOW'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_commerce_notification_delivery_status') THEN
        ALTER TABLE commerce_notification_delivery ADD CONSTRAINT ck_commerce_notification_delivery_status
            CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED', 'UNKNOWN', 'EXPIRED'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_commerce_notification_delivery_locale') THEN
        ALTER TABLE commerce_notification_delivery ADD CONSTRAINT ck_commerce_notification_delivery_locale
            CHECK (locale IN ('hi', 'en'));
    END IF;
END
$$;
