-- Commerce order desk and cash on delivery (BUILD_PLAN WP-30, WP-31).
-- Commerce tables only: new tables, nullable or constant-default columns on commerce_order and
-- commerce_order_line, one CHECK on commerce_payment_exception and one index on stock_movement.
-- Every commerce table is empty in production when this runs (commerce is switched off for every
-- institute). Re-runnable: IF NOT EXISTS everywhere, constraints through DO blocks.

-- The payment webhook and checkout read commerce_order. Never queue behind a long transaction
-- holding it: if a lock is not free within 5 s the migration fails cleanly and the next deploy
-- retries (as V687).
SET LOCAL lock_timeout = '5s';

-- Replay guard of every staff state change: the first request with a key inserts its row inside
-- the transaction of the change; a repeat finds it and is answered from the current state.
CREATE TABLE IF NOT EXISTS commerce_request (
    id                 VARCHAR(36)  PRIMARY KEY,
    institute_id       VARCHAR(36)  NOT NULL,
    client_request_id  VARCHAR(64)  NOT NULL,
    action             VARCHAR(32)  NOT NULL,
    reference_type     VARCHAR(32),
    reference_id       VARCHAR(36),
    request_hash       VARCHAR(64)  NOT NULL,
    response_json      JSONB,
    actor_user_id      VARCHAR(36),
    created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_commerce_request UNIQUE (institute_id, client_request_id)
);
CREATE INDEX IF NOT EXISTS idx_commerce_request_reference
    ON commerce_request (institute_id, reference_type, reference_id);

-- One live shipment per order in Phase 1; cod_amount per shipment is kept for Phase 2.
--   status PACKED        goods put aside, invoice issued, nothing has left
--          SHIPPED       handed to the courier: the SALE movements are posted
--          DELIVERED     the buyer has the goods
--          RTO           the courier is bringing the parcel back; no movement yet
--          RTO_RECEIVED  the parcel is back and was inspected (RETURN, and DAMAGE for damaged units)
--          CANCELLED     unpacked or the order was cancelled before it shipped
CREATE TABLE IF NOT EXISTS commerce_shipment (
    id                    VARCHAR(36)    PRIMARY KEY,
    institute_id          VARCHAR(36)    NOT NULL,
    order_id              VARCHAR(36)    NOT NULL REFERENCES commerce_order (id),
    location_id           VARCHAR(36)    NOT NULL REFERENCES stock_location (id),
    carrier_code          VARCHAR(32)    NOT NULL DEFAULT 'MANUAL',
    carrier_name          VARCHAR(100),
    tracking_number       VARCHAR(64),
    tracking_url          VARCHAR(500),
    status                VARCHAR(32)    NOT NULL,
    cod_amount            NUMERIC(12, 2),
    -- Raised by every ship; part of the SALE idempotency key, so a re-ship after "undo shipped"
    -- posts new rows instead of being answered by the first ship's rows.
    ship_count            INTEGER        NOT NULL DEFAULT 0,
    weight_grams          INTEGER,
    eway_bill_no          VARCHAR(32),
    carrier_payload_json  JSONB,
    invoice_id            VARCHAR(255),
    rto_reason            VARCHAR(32),
    note                  VARCHAR(500),
    packed_at             TIMESTAMP,
    packed_by             VARCHAR(36),
    shipped_at            TIMESTAMP,
    shipped_by            VARCHAR(36),
    delivered_on          DATE,
    delivered_at          TIMESTAMP,
    delivered_by          VARCHAR(36),
    rto_at                TIMESTAMP,
    rto_by                VARCHAR(36),
    rto_received_at       TIMESTAMP,
    rto_received_by       VARCHAR(36),
    cancelled_at          TIMESTAMP,
    cancelled_by          VARCHAR(36),
    created_at            TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_commerce_shipment_status CHECK (status IN (
        'PACKED', 'SHIPPED', 'DELIVERED', 'RTO', 'RTO_RECEIVED', 'CANCELLED')),
    CONSTRAINT ck_commerce_shipment_carrier CHECK (carrier_code IN ('MANUAL', 'HANDOVER')),
    CONSTRAINT ck_commerce_shipment_ship_count CHECK (ship_count >= 0),
    CONSTRAINT ck_commerce_shipment_weight CHECK (weight_grams IS NULL OR weight_grams > 0),
    CONSTRAINT ck_commerce_shipment_rto_reason CHECK (rto_reason IS NULL OR rto_reason IN (
        'REFUSED', 'UNREACHABLE', 'ADDRESS_ISSUE', 'DAMAGED', 'OTHER'))
);
CREATE INDEX IF NOT EXISTS idx_commerce_shipment_order ON commerce_shipment (order_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_commerce_shipment_live_order
    ON commerce_shipment (order_id) WHERE status <> 'CANCELLED';
CREATE INDEX IF NOT EXISTS idx_commerce_shipment_tracking
    ON commerce_shipment (institute_id, tracking_number) WHERE tracking_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_commerce_shipment_status
    ON commerce_shipment (institute_id, status, updated_at);

CREATE TABLE IF NOT EXISTS commerce_shipment_line (
    id             VARCHAR(36)  PRIMARY KEY,
    institute_id   VARCHAR(36)  NOT NULL,
    shipment_id    VARCHAR(36)  NOT NULL REFERENCES commerce_shipment (id),
    order_line_id  VARCHAR(36)  NOT NULL REFERENCES commerce_order_line (id),
    quantity       INTEGER      NOT NULL,
    created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_commerce_shipment_line UNIQUE (shipment_id, order_line_id),
    CONSTRAINT ck_commerce_shipment_line_quantity CHECK (quantity >= 1)
);
CREATE INDEX IF NOT EXISTS idx_commerce_shipment_line_order_line ON commerce_shipment_line (order_line_id);

-- Cash on delivery money handed over by a courier for a batch of delivered orders.
-- gross_amount is what the courier says it collected, deductions its fees, net_amount what
-- reached the bank. A gross that differs from the orders' total needs a written reason.
CREATE TABLE IF NOT EXISTS commerce_cod_remittance (
    id                 VARCHAR(36)    PRIMARY KEY,
    institute_id       VARCHAR(36)    NOT NULL,
    reference          VARCHAR(100)   NOT NULL,
    courier_name       VARCHAR(100),
    received_on        DATE           NOT NULL,
    gross_amount       NUMERIC(12, 2) NOT NULL,
    deductions         NUMERIC(12, 2) NOT NULL DEFAULT 0,
    net_amount         NUMERIC(12, 2) NOT NULL,
    orders_total       NUMERIC(12, 2) NOT NULL,
    order_count        INTEGER        NOT NULL,
    difference_reason  VARCHAR(500),
    note               VARCHAR(500),
    recorded_by        VARCHAR(36)    NOT NULL,
    money_account_id   VARCHAR(36),
    client_request_id  VARCHAR(64)    NOT NULL,
    request_hash       VARCHAR(64)    NOT NULL,
    created_at         TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_commerce_cod_remittance_reference UNIQUE (institute_id, reference),
    CONSTRAINT uq_commerce_cod_remittance_request UNIQUE (institute_id, client_request_id),
    CONSTRAINT ck_commerce_cod_remittance_amounts CHECK (
        gross_amount >= 0 AND deductions >= 0 AND net_amount = gross_amount - deductions
        AND orders_total >= 0 AND order_count >= 1),
    CONSTRAINT ck_commerce_cod_remittance_adds_up CHECK (
        gross_amount = orders_total OR difference_reason IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_commerce_cod_remittance_received
    ON commerce_cod_remittance (institute_id, received_on);

-- refund_due: money of a paid order that must go back (cancel, line cancel, RTO); the refund
-- work package turns it into refund rows. stock_short: open units of the order are no longer on
-- the shelf (damage, count, receipt reversal), set after that posting commits.
-- sweep_retry_after: a background sweep (the invoice backlog, the COD confirmation timer) failed
-- on this order; the sweeps leave it alone until then, so one failing order never holds up the
-- orders behind it. Written by the sweeps only, never by the entity.
ALTER TABLE commerce_order
    ADD COLUMN IF NOT EXISTS refund_due          NUMERIC(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS stock_short         BOOLEAN        NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS stock_short_at      TIMESTAMP,
    ADD COLUMN IF NOT EXISTS packed_at           TIMESTAMP,
    ADD COLUMN IF NOT EXISTS shipped_at          TIMESTAMP,
    ADD COLUMN IF NOT EXISTS delivered_at        TIMESTAMP,
    ADD COLUMN IF NOT EXISTS cod_confirm_due_at  TIMESTAMP,
    ADD COLUMN IF NOT EXISTS sweep_retry_after   TIMESTAMP;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_commerce_order_refund_due') THEN
        ALTER TABLE commerce_order ADD CONSTRAINT ck_commerce_order_refund_due CHECK (refund_due >= 0);
    END IF;
END
$$;

-- list_unit_price: the catalogue price when staff typed another one (price_override_by set).
-- cancelled_value: what the cancelled units of the line took off the order total.
ALTER TABLE commerce_order_line
    ADD COLUMN IF NOT EXISTS stock_short_qty  INTEGER        NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS list_unit_price  NUMERIC(12, 2),
    ADD COLUMN IF NOT EXISTS cancelled_value  NUMERIC(12, 2) NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_commerce_order_line_short') THEN
        ALTER TABLE commerce_order_line ADD CONSTRAINT ck_commerce_order_line_short
            CHECK (stock_short_qty >= 0 AND cancelled_value >= 0);
    END IF;
END
$$;

-- REFUND_DUE: money of a paid order that is due back after a cancel, a line cancel or an RTO.
-- gateway_payment_id carries the event key, so the UNIQUE (order, kind, gateway_payment_id)
-- keeps one row per event.
ALTER TABLE commerce_payment_exception DROP CONSTRAINT IF EXISTS ck_commerce_payment_exception_kind;
ALTER TABLE commerce_payment_exception ADD CONSTRAINT ck_commerce_payment_exception_kind
    CHECK (kind IN ('OVERSOLD_PAID', 'DUPLICATE_PAYMENT', 'REFUND_DUE'));

CREATE INDEX IF NOT EXISTS idx_commerce_order_cod_confirm
    ON commerce_order (cod_confirm_due_at) WHERE status = 'COD_PENDING_CONFIRMATION';
CREATE INDEX IF NOT EXISTS idx_commerce_order_cod_collect
    ON commerce_order (institute_id, created_at)
    WHERE payment_method = 'COD' AND status = 'DELIVERED' AND payment_status = 'UNPAID';
CREATE INDEX IF NOT EXISTS idx_commerce_order_dues
    ON commerce_order (institute_id, created_at)
    WHERE channel = 'ADMIN' AND payment_status IN ('UNPAID', 'PARTIALLY_PAID');
CREATE INDEX IF NOT EXISTS idx_commerce_order_stock_short
    ON commerce_order (institute_id, created_at) WHERE stock_short;
CREATE INDEX IF NOT EXISTS idx_commerce_order_remittance
    ON commerce_order (cod_remittance_id) WHERE cod_remittance_id IS NOT NULL;
-- SALE and RETURN rows of a shipment line, and undo lookups. V681 already created an index of
-- this name and these columns; IF NOT EXISTS keeps this statement a no-op where it exists.
CREATE INDEX IF NOT EXISTS idx_stock_movement_reference
    ON stock_movement (institute_id, reference_type, reference_id);
