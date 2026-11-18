-- Commerce WP-42: POS registers, sessions and cash movements; the walk-in buyer; cash handed over on a tender.
-- New tables first, then one nullable column and two partial indexes on commerce tables. Re-runnable.
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS pos_register (
    id            VARCHAR(36)  PRIMARY KEY,
    institute_id  VARCHAR(36)  NOT NULL,
    location_id   VARCHAR(36)  NOT NULL REFERENCES stock_location (id),
    code          VARCHAR(16)  NOT NULL,
    name          VARCHAR(60)  NOT NULL,
    status        VARCHAR(16)  NOT NULL DEFAULT 'ACTIVE',
    created_by    VARCHAR(36),
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_pos_register_code UNIQUE (institute_id, code),
    CONSTRAINT ck_pos_register_status CHECK (status IN ('ACTIVE', 'INACTIVE'))
);
CREATE INDEX IF NOT EXISTS idx_pos_register_location ON pos_register (institute_id, location_id);

CREATE TABLE IF NOT EXISTS pos_session (
    id                         VARCHAR(36)    PRIMARY KEY,
    institute_id               VARCHAR(36)    NOT NULL,
    register_id                VARCHAR(36)    NOT NULL REFERENCES pos_register (id),
    location_id                VARCHAR(36)    NOT NULL,
    cashier_user_id            VARCHAR(36)    NOT NULL,
    status                     VARCHAR(16)    NOT NULL DEFAULT 'OPEN',
    opened_at                  TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    opening_cash               NUMERIC(12, 2) NOT NULL,
    opening_note               VARCHAR(500),
    previous_session_id        VARCHAR(36),
    previous_counted_cash      NUMERIC(12, 2),
    open_request_id            VARCHAR(64),
    closed_at                  TIMESTAMP,
    closed_by                  VARCHAR(36),
    close_request_id           VARCHAR(64),
    expected_cash              NUMERIC(12, 2),
    counted_cash               NUMERIC(12, 2),
    variance                   NUMERIC(12, 2),
    counted_denominations_json JSONB,
    close_note                 VARCHAR(500),
    z_report_json              JSONB,
    -- PA §3.7: cash taken out at close. Written by WP-63; NULL until then. No FK (money tables come later).
    handover_amount            NUMERIC(12, 2),
    handover_account_id        VARCHAR(36),
    handover_transfer_id       VARCHAR(36),
    created_at                 TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at                 TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_pos_session_status CHECK (status IN ('OPEN', 'CLOSED')),
    CONSTRAINT ck_pos_session_money CHECK (opening_cash >= 0 AND (counted_cash IS NULL OR counted_cash >= 0)
        AND (handover_amount IS NULL OR handover_amount >= 0)),
    CONSTRAINT ck_pos_session_closed CHECK (
        (status = 'OPEN' AND closed_at IS NULL)
        OR (status = 'CLOSED' AND closed_at IS NOT NULL AND expected_cash IS NOT NULL
            AND counted_cash IS NOT NULL AND variance IS NOT NULL)),
    CONSTRAINT uq_pos_session_open_request UNIQUE (institute_id, open_request_id)
);
-- One open session per register, and one per cashier.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_session_open_register
    ON pos_session (institute_id, register_id) WHERE status = 'OPEN';
CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_session_open_cashier
    ON pos_session (institute_id, cashier_user_id) WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS idx_pos_session_register ON pos_session (institute_id, register_id, opened_at);
CREATE INDEX IF NOT EXISTS idx_pos_session_location ON pos_session (institute_id, location_id, opened_at);

CREATE TABLE IF NOT EXISTS pos_cash_movement (
    id                 VARCHAR(36)    PRIMARY KEY,
    institute_id       VARCHAR(36)    NOT NULL,
    session_id         VARCHAR(36)    NOT NULL REFERENCES pos_session (id),
    type               VARCHAR(16)    NOT NULL,
    amount             NUMERIC(12, 2) NOT NULL,
    reason             VARCHAR(200)   NOT NULL,
    actor_user_id      VARCHAR(36)    NOT NULL,
    -- PA §3.7: what the movement was for. WP-42 writes NONE; WP-63 writes the others.
    reference_type     VARCHAR(32)    NOT NULL DEFAULT 'NONE',
    reference_id       VARCHAR(36),
    document_date      DATE,
    review_status      VARCHAR(16)    NOT NULL DEFAULT 'NONE',
    client_request_id  VARCHAR(64),
    created_at         TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_pos_cash_movement_type CHECK (type IN ('CASH_IN', 'CASH_OUT')),
    CONSTRAINT ck_pos_cash_movement_amount CHECK (amount > 0),
    CONSTRAINT ck_pos_cash_movement_reference CHECK (reference_type IN ('EXPENSE', 'SUPPLIER_PAYMENT',
        'MONEY_TRANSFER', 'MONEY_VOUCHER', 'CUSTOMER_RECEIPT', 'ORDER_TENDER', 'NONE')),
    CONSTRAINT ck_pos_cash_movement_review CHECK (review_status IN ('NONE', 'TO_REVIEW', 'REVIEWED')),
    CONSTRAINT uq_pos_cash_movement_request UNIQUE (institute_id, client_request_id)
);
CREATE INDEX IF NOT EXISTS idx_pos_cash_movement_session ON pos_cash_movement (institute_id, session_id);

-- The one "walk-in customer" auth user of an institute (ARCH §4.3).
CREATE TABLE IF NOT EXISTS commerce_pos_walk_in (
    id            VARCHAR(36)  PRIMARY KEY,
    institute_id  VARCHAR(36)  NOT NULL,
    user_id       VARCHAR(36)  NOT NULL,
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_commerce_pos_walk_in UNIQUE (institute_id)
);

-- Cash the buyer handed over for a CASH tender; change = cash_tendered - amount. NULL elsewhere.
ALTER TABLE commerce_order_tender ADD COLUMN IF NOT EXISTS cash_tendered NUMERIC(12, 2);

-- Day close and the session's bills read by session.
CREATE INDEX IF NOT EXISTS idx_commerce_order_pos_session
    ON commerce_order (pos_session_id) WHERE pos_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_commerce_refund_pos_session
    ON commerce_refund (pos_session_id) WHERE pos_session_id IS NOT NULL;
