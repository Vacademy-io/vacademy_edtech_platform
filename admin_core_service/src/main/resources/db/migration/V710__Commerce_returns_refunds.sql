-- Commerce WP-32: returns of delivered goods, refunds (money given back), the order's refund
-- ledger columns, and the backoff of the background sweeps. Commerce tables only; every table
-- touched is a commerce table. Re-runnable: IF NOT EXISTS everywhere, constraints through DO
-- blocks that test pg_constraint. New columns are NOT NULL with a constant default or nullable.
SET LOCAL lock_timeout = '5s';

-- A staff-created return of delivered goods. Returns never change the order status.
-- REQUESTED -> APPROVED | REJECTED; APPROVED -> RECEIVED | REJECTED; RECEIVED -> CLOSED.
CREATE TABLE IF NOT EXISTS commerce_return (
    id                    VARCHAR(36)    PRIMARY KEY,
    institute_id          VARCHAR(36)    NOT NULL,
    return_number         VARCHAR(32)    NOT NULL,
    order_id              VARCHAR(36)    NOT NULL REFERENCES commerce_order (id),
    status                VARCHAR(16)    NOT NULL,
    reason                VARCHAR(32)    NOT NULL,
    reason_note           VARCHAR(500),
    requested_via         VARCHAR(16)    NOT NULL DEFAULT 'PHONE',
    -- where the goods come back; RETURN movements post here
    location_id           VARCHAR(36)    NOT NULL REFERENCES stock_location (id),
    requested_by          VARCHAR(36)    NOT NULL,
    policy_warnings_json  JSONB,
    override_reason       VARCHAR(500),
    photo_media_ids_json  JSONB,
    approved_at           TIMESTAMP,
    approved_by           VARCHAR(36),
    rejected_at           TIMESTAMP,
    rejected_by           VARCHAR(36),
    reject_reason         VARCHAR(500),
    received_at           TIMESTAMP,
    received_by           VARCHAR(36),
    closed_at             TIMESTAMP,
    credit_note_id        VARCHAR(36)    REFERENCES commerce_credit_note (id),
    -- total of the return's credit note; what the return is worth to the buyer
    credit_total          NUMERIC(12, 2) NOT NULL DEFAULT 0,
    -- the part of credit_total raised into commerce_order.refund_due (less until a COD order is remitted)
    due_raised            NUMERIC(12, 2) NOT NULL DEFAULT 0,
    note                  VARCHAR(500),
    client_request_id     VARCHAR(64)    NOT NULL,
    request_hash          VARCHAR(64)    NOT NULL,
    created_at            TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_commerce_return_number  UNIQUE (institute_id, return_number),
    CONSTRAINT uq_commerce_return_request UNIQUE (institute_id, client_request_id),
    CONSTRAINT ck_commerce_return_status CHECK (status IN ('REQUESTED', 'APPROVED', 'REJECTED', 'RECEIVED', 'CLOSED')),
    CONSTRAINT ck_commerce_return_reason CHECK (reason IN (
        'DEFECTIVE', 'WRONG_ITEM', 'DAMAGED_IN_TRANSIT', 'SIZE', 'CHANGED_MIND', 'OTHER')),
    CONSTRAINT ck_commerce_return_via CHECK (requested_via IN ('PHONE', 'WHATSAPP', 'EMAIL', 'COUNTER', 'OTHER')),
    CONSTRAINT ck_commerce_return_money CHECK (
        credit_total >= 0 AND due_raised >= 0 AND due_raised <= credit_total)
);
CREATE INDEX IF NOT EXISTS idx_commerce_return_order ON commerce_return (order_id);
CREATE INDEX IF NOT EXISTS idx_commerce_return_status ON commerce_return (institute_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_commerce_return_open
    ON commerce_return (institute_id, created_at) WHERE status IN ('REQUESTED', 'APPROVED', 'RECEIVED');

-- One row per order line on a return. A line may come back part resaleable, part damaged.
CREATE TABLE IF NOT EXISTS commerce_return_line (
    id               VARCHAR(36)    PRIMARY KEY,
    institute_id     VARCHAR(36)    NOT NULL,
    return_id        VARCHAR(36)    NOT NULL REFERENCES commerce_return (id),
    order_line_id    VARCHAR(36)    NOT NULL REFERENCES commerce_order_line (id),
    quantity         INTEGER        NOT NULL,
    qty_resaleable   INTEGER        NOT NULL DEFAULT 0,
    qty_damaged      INTEGER        NOT NULL DEFAULT 0,
    piece_ids_json   JSONB,
    credited_value   NUMERIC(12, 2),
    cost_total       NUMERIC(12, 2),
    created_at       TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_commerce_return_line UNIQUE (return_id, order_line_id),
    CONSTRAINT ck_commerce_return_line_qty CHECK (
        quantity >= 1 AND qty_resaleable >= 0 AND qty_damaged >= 0
        AND (qty_resaleable + qty_damaged = 0 OR qty_resaleable + qty_damaged = quantity))
);
CREATE INDEX IF NOT EXISTS idx_commerce_return_line_order_line ON commerce_return_line (order_line_id);

-- Money given back. kind ORDER counts against commerce_order.amount_paid; kind EXTRA_PAYMENT
-- gives back a captured payment that never counted (a second payment).
CREATE TABLE IF NOT EXISTS commerce_refund (
    id                  VARCHAR(36)    PRIMARY KEY,
    institute_id        VARCHAR(36)    NOT NULL,
    order_id            VARCHAR(36)    NOT NULL REFERENCES commerce_order (id),
    return_id           VARCHAR(36)    REFERENCES commerce_return (id),
    credit_note_id      VARCHAR(36),
    payment_log_id      VARCHAR(36),
    pos_session_id      VARCHAR(36),
    kind                VARCHAR(16)    NOT NULL DEFAULT 'ORDER',
    source              VARCHAR(24)    NOT NULL,
    method              VARCHAR(24)    NOT NULL,
    status              VARCHAR(16)    NOT NULL,
    amount              NUMERIC(12, 2) NOT NULL,
    currency            VARCHAR(8)     NOT NULL,
    gateway_vendor      VARCHAR(32),
    gateway_payment_id  VARCHAR(64),
    gateway_refund_id   VARCHAR(64),
    gateway_status      VARCHAR(32),
    -- payout reference typed by staff (UTR, UPI ref), or the bank reference the gateway reports
    reference           VARCHAR(100),
    applied_order_id    VARCHAR(36),
    paid_on             DATE,
    reason              VARCHAR(500),
    failure_code        VARCHAR(64),
    failure_reason      VARCHAR(500),
    last_error          VARCHAR(500),
    idempotency_key     VARCHAR(100)   NOT NULL,
    attempt_count       INTEGER        NOT NULL DEFAULT 0,
    poll_count          INTEGER        NOT NULL DEFAULT 0,
    claimed_at          TIMESTAMP,
    next_poll_at        TIMESTAMP,
    last_polled_at      TIMESTAMP,
    stuck_alerted_at    TIMESTAMP,
    processed_at        TIMESTAMP,
    failed_at           TIMESTAMP,
    created_by          VARCHAR(36),
    processed_by        VARCHAR(36),
    money_account_id    VARCHAR(36),
    created_at          TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_commerce_refund_key UNIQUE (institute_id, idempotency_key),
    CONSTRAINT ck_commerce_refund_kind CHECK (kind IN ('ORDER', 'EXTRA_PAYMENT')),
    CONSTRAINT ck_commerce_refund_source CHECK (source IN ('STAFF', 'OVERSOLD_PAID', 'DUPLICATE_PAYMENT', 'EXCHANGE')),
    CONSTRAINT ck_commerce_refund_method CHECK (method IN ('GATEWAY', 'BANK_TRANSFER', 'UPI', 'CASH', 'EXCHANGE_CREDIT')),
    CONSTRAINT ck_commerce_refund_status CHECK (status IN ('PENDING', 'IN_PROGRESS', 'PROCESSED', 'FAILED')),
    CONSTRAINT ck_commerce_refund_amount CHECK (amount > 0),
    CONSTRAINT ck_commerce_refund_gateway CHECK (method <> 'GATEWAY' OR gateway_payment_id IS NOT NULL),
    CONSTRAINT ck_commerce_refund_exchange CHECK (method <> 'EXCHANGE_CREDIT' OR applied_order_id IS NOT NULL),
    CONSTRAINT ck_commerce_refund_extra CHECK (kind <> 'EXTRA_PAYMENT' OR method = 'GATEWAY'),
    CONSTRAINT ck_commerce_refund_progress CHECK (status <> 'IN_PROGRESS' OR method = 'GATEWAY')
);
CREATE INDEX IF NOT EXISTS idx_commerce_refund_order ON commerce_refund (order_id);
CREATE INDEX IF NOT EXISTS idx_commerce_refund_return ON commerce_refund (return_id) WHERE return_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_commerce_refund_status ON commerce_refund (institute_id, status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_commerce_refund_gateway_refund
    ON commerce_refund (gateway_vendor, gateway_refund_id) WHERE gateway_refund_id IS NOT NULL;
-- One live refund of a second payment; one live exchange per return.
CREATE UNIQUE INDEX IF NOT EXISTS uq_commerce_refund_extra_payment
    ON commerce_refund (gateway_vendor, gateway_payment_id) WHERE kind = 'EXTRA_PAYMENT' AND status <> 'FAILED';
CREATE UNIQUE INDEX IF NOT EXISTS uq_commerce_refund_exchange_return
    ON commerce_refund (return_id) WHERE method = 'EXCHANGE_CREDIT' AND status <> 'FAILED';
-- The poll job: gateway refunds waiting for their call or their outcome.
CREATE INDEX IF NOT EXISTS idx_commerce_refund_gateway_due
    ON commerce_refund (next_poll_at) WHERE method = 'GATEWAY' AND status IN ('PENDING', 'IN_PROGRESS');

-- refund_committed = sum of ORDER refunds not FAILED; amount_refunded = sum of ORDER refunds PROCESSED.
-- Both written only under the order row lock. Open due = refund_due - refund_committed.
-- sweep_failures: how often a background sweep failed on the order (the sweeps back off on it).
ALTER TABLE commerce_order
    ADD COLUMN IF NOT EXISTS refund_committed  NUMERIC(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS amount_refunded   NUMERIC(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS sweep_failures    INTEGER        NOT NULL DEFAULT 0;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_commerce_order_refunds') THEN
        ALTER TABLE commerce_order ADD CONSTRAINT ck_commerce_order_refunds CHECK (
            amount_refunded >= 0 AND amount_refunded <= refund_committed
            AND refund_committed <= refund_due AND refund_due <= amount_paid AND sweep_failures >= 0);
    END IF;
END
$$;

-- returned_value: what the credit notes of the line's returns gave back (as cancelled_value does for cancels).
ALTER TABLE commerce_order_line
    ADD COLUMN IF NOT EXISTS returned_value NUMERIC(12, 2) NOT NULL DEFAULT 0;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_commerce_order_line_returned') THEN
        ALTER TABLE commerce_order_line ADD CONSTRAINT ck_commerce_order_line_returned CHECK (returned_value >= 0);
    END IF;
END
$$;

-- The automatic refund made for an OVERSOLD_PAID or DUPLICATE_PAYMENT row.
ALTER TABLE commerce_payment_exception ADD COLUMN IF NOT EXISTS refund_id VARCHAR(36);

CREATE INDEX IF NOT EXISTS idx_commerce_order_refund_open
    ON commerce_order (institute_id, created_at) WHERE refund_due > refund_committed;
-- The invoice backlog reads by failures, then age.
CREATE INDEX IF NOT EXISTS idx_commerce_order_invoice_sweep
    ON commerce_order (sweep_failures, updated_at)
    WHERE status IN ('CONFIRMED', 'PACKED', 'SHIPPED', 'DELIVERED') AND channel <> 'POS';
CREATE INDEX IF NOT EXISTS idx_commerce_payment_exception_unrefunded
    ON commerce_payment_exception (created_at)
    WHERE status = 'OPEN' AND refund_id IS NULL AND kind IN ('OVERSOLD_PAID', 'DUPLICATE_PAYMENT');
