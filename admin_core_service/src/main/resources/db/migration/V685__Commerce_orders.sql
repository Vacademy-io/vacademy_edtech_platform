-- Commerce orders and customers (docs/commerce/ARCHITECTURE.md section 3.3, BUILD_PLAN WP-12).
-- New tables only: no existing table is altered. commerce_counter exists since V681.

-- A buyer known to the shop. The phone is the identity of a shopper inside one institute;
-- user_id is the auth user the order rows were written for (no role, no enrolment).
CREATE TABLE IF NOT EXISTS commerce_customer (
    id                 VARCHAR(36)   PRIMARY KEY,
    institute_id       VARCHAR(36)   NOT NULL,
    user_id            VARCHAR(36),
    phone              VARCHAR(20)   NOT NULL,
    name               VARCHAR(200),
    email              VARCHAR(320),
    marketing_consent  BOOLEAN       NOT NULL DEFAULT FALSE,
    consent_at         TIMESTAMP,
    consent_source     VARCHAR(64),
    cod_refusals       INTEGER       NOT NULL DEFAULT 0,
    notes              TEXT,
    external_ref       VARCHAR(100),
    anonymised_at      TIMESTAMP,
    created_at         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_commerce_customer_phone UNIQUE (institute_id, phone)
);
CREATE INDEX IF NOT EXISTS idx_commerce_customer_user
    ON commerce_customer (institute_id, user_id);

-- The address book. An order copies the address it was placed with.
CREATE TABLE IF NOT EXISTS commerce_customer_address (
    id            VARCHAR(36)   PRIMARY KEY,
    institute_id  VARCHAR(36)   NOT NULL,
    customer_id   VARCHAR(36)   NOT NULL REFERENCES commerce_customer (id),
    label         VARCHAR(64),
    name          VARCHAR(200),
    phone         VARCHAR(20),
    line1         VARCHAR(300)  NOT NULL,
    line2         VARCHAR(300),
    landmark      VARCHAR(200),
    city          VARCHAR(100),
    state_code    VARCHAR(8),
    pincode       VARCHAR(6)    NOT NULL,
    is_default    BOOLEAN       NOT NULL DEFAULT FALSE,
    status        VARCHAR(32)   NOT NULL DEFAULT 'ACTIVE',
    created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_commerce_customer_address_status CHECK (status IN ('ACTIVE', 'DELETED'))
);
CREATE INDEX IF NOT EXISTS idx_commerce_customer_address_customer
    ON commerce_customer_address (institute_id, customer_id);

-- One header per checkout. payment_group_id is the group of its payment logs; the order
-- reference the gateway and the webhook use is the id of this row.
CREATE TABLE IF NOT EXISTS commerce_order (
    id                          VARCHAR(36)    PRIMARY KEY,
    institute_id                VARCHAR(36)    NOT NULL,
    order_number                VARCHAR(32)    NOT NULL,
    payment_group_id            VARCHAR(36)    NOT NULL,
    channel                     VARCHAR(16)    NOT NULL DEFAULT 'ONLINE',
    user_id                     VARCHAR(36),
    customer_id                 VARCHAR(36),
    customer_name               VARCHAR(200),
    customer_phone              VARCHAR(20),
    customer_email              VARCHAR(320),
    shipping_address_json       JSONB,
    billing_address_json        JSONB,
    buyer_gstin                 VARCHAR(15),
    place_of_supply_state       VARCHAR(8),
    subtotal                    NUMERIC(12, 2) NOT NULL DEFAULT 0,
    discount                    NUMERIC(12, 2) NOT NULL DEFAULT 0,
    shipping                    NUMERIC(12, 2) NOT NULL DEFAULT 0,
    cod_charge                  NUMERIC(12, 2) NOT NULL DEFAULT 0,
    tax                         NUMERIC(12, 2) NOT NULL DEFAULT 0,
    round_off                   NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total                       NUMERIC(12, 2) NOT NULL,
    amount_paid                 NUMERIC(12, 2) NOT NULL DEFAULT 0,
    currency                    VARCHAR(8)     NOT NULL,
    payment_method              VARCHAR(16)    NOT NULL,
    payment_status              VARCHAR(24)    NOT NULL DEFAULT 'UNPAID',
    status                      VARCHAR(32)    NOT NULL,
    cancel_reason               VARCHAR(32),
    cod_amount                  NUMERIC(12, 2),
    cod_collected_at            TIMESTAMP,
    cod_remittance_id           VARCHAR(36),
    fulfilment_location_id      VARCHAR(36),
    pos_session_id              VARCHAR(36),
    document_date               DATE,
    exchange_of_order_id        VARCHAR(36),
    customer_note               VARCHAR(500),
    gift_note                   VARCHAR(500),
    client_request_id           VARCHAR(64),
    request_hash                VARCHAR(64),
    locale                      VARCHAR(16),
    created_by                  VARCHAR(36),
    -- The CartPriceSnapshot the order was placed with; the invoice is written from its tax result.
    price_snapshot_json         JSONB,
    coupon_code                 VARCHAR(64),
    applied_coupon_discount_id  VARCHAR(36),
    -- The payment log every stock hold of the order is attached to.
    primary_payment_log_id      VARCHAR(36),
    gateway_vendor              VARCHAR(32),
    gateway_order_id            VARCHAR(64),
    gateway_key_id              VARCHAR(64),
    -- Set by the one caller that is talking to the gateway now; see CommerceCheckoutService.
    gateway_attempt_at          TIMESTAMP,
    hold_expires_at             TIMESTAMP,
    confirmed_at                TIMESTAMP,
    cancelled_at                TIMESTAMP,
    created_at                  TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at                  TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_commerce_order_number UNIQUE (institute_id, order_number),
    CONSTRAINT uq_commerce_order_payment_group UNIQUE (payment_group_id),
    CONSTRAINT uq_commerce_order_client_request UNIQUE (institute_id, client_request_id),
    CONSTRAINT ck_commerce_order_channel CHECK (channel IN ('ONLINE', 'ADMIN', 'POS')),
    CONSTRAINT ck_commerce_order_status CHECK (status IN (
        'PENDING_PAYMENT', 'COD_PENDING_CONFIRMATION', 'CONFIRMED', 'PACKED', 'SHIPPED',
        'DELIVERED', 'RTO', 'CANCELLED')),
    CONSTRAINT ck_commerce_order_payment_status CHECK (payment_status IN (
        'UNPAID', 'PARTIALLY_PAID', 'PAID')),
    CONSTRAINT ck_commerce_order_total CHECK (total >= 0 AND amount_paid >= 0)
);
CREATE INDEX IF NOT EXISTS idx_commerce_order_status
    ON commerce_order (institute_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_commerce_order_phone
    ON commerce_order (institute_id, customer_phone);
CREATE INDEX IF NOT EXISTS idx_commerce_order_customer
    ON commerce_order (institute_id, customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_commerce_order_email
    ON commerce_order (institute_id, customer_email) WHERE status = 'PENDING_PAYMENT';
-- The expiry sweep and the paid-order reconcile read only unpaid orders.
CREATE INDEX IF NOT EXISTS idx_commerce_order_pending_expiry
    ON commerce_order (hold_expires_at) WHERE status = 'PENDING_PAYMENT';
-- The paid-order reconcile reads unpaid and cancelled orders of the last days, of all institutes.
CREATE INDEX IF NOT EXISTS idx_commerce_order_reconcile
    ON commerce_order (created_at) WHERE status IN ('PENDING_PAYMENT', 'CANCELLED');
CREATE INDEX IF NOT EXISTS idx_commerce_order_gateway_order
    ON commerce_order (gateway_order_id) WHERE gateway_order_id IS NOT NULL;

-- Line facts are frozen at placement. An ITEM line owns one user_plan and one payment_log;
-- a SHIPPING or COD_CHARGE line owns neither (its money rides on the log of the largest item).
CREATE TABLE IF NOT EXISTS commerce_order_line (
    id                  VARCHAR(36)    PRIMARY KEY,
    institute_id        VARCHAR(36)    NOT NULL,
    order_id            VARCHAR(36)    NOT NULL REFERENCES commerce_order (id),
    line_no             INTEGER        NOT NULL,
    line_ref            VARCHAR(64),
    user_plan_id        VARCHAR(36),
    payment_log_id      VARCHAR(36),
    package_session_id  VARCHAR(36),
    package_id          VARCHAR(36),
    piece_id            VARCHAR(36),
    line_type           VARCHAR(16)    NOT NULL DEFAULT 'ITEM',
    name_snapshot       VARCHAR(500),
    sku_snapshot        VARCHAR(100),
    variant_label       VARCHAR(300),
    unit                VARCHAR(32),
    qty_scale           INTEGER        NOT NULL DEFAULT 1,
    quantity            INTEGER        NOT NULL,
    unit_price          NUMERIC(12, 2) NOT NULL DEFAULT 0,
    mrp                 NUMERIC(12, 2),
    gross               NUMERIC(12, 2) NOT NULL DEFAULT 0,
    discount            NUMERIC(12, 2) NOT NULL DEFAULT 0,
    price_override_by   VARCHAR(36),
    tax_class_id        VARCHAR(36),
    hsn_code            VARCHAR(16),
    tax_rate            NUMERIC(6, 3),
    taxable_value       NUMERIC(12, 2) NOT NULL DEFAULT 0,
    tax_amount          NUMERIC(12, 2) NOT NULL DEFAULT 0,
    -- What the buyer pays for the line: taxable value plus tax.
    line_total          NUMERIC(12, 2) NOT NULL DEFAULT 0,
    -- What the payment log of the line carries: line_total plus, on one line, the delivery
    -- charge and the round-off. The logs of an order sum to commerce_order.total.
    log_amount          NUMERIC(12, 2),
    weight_grams        INTEGER,
    qty_cancelled       INTEGER        NOT NULL DEFAULT 0,
    qty_shipped         INTEGER        NOT NULL DEFAULT 0,
    qty_returned        INTEGER        NOT NULL DEFAULT 0,
    cost_total          NUMERIC(12, 2),
    created_at          TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_commerce_order_line_plan UNIQUE (user_plan_id),
    CONSTRAINT ck_commerce_order_line_type CHECK (line_type IN ('ITEM', 'SHIPPING', 'COD_CHARGE')),
    CONSTRAINT ck_commerce_order_line_quantities CHECK (
        quantity >= 1 AND qty_cancelled >= 0 AND qty_shipped >= 0 AND qty_returned >= 0
        AND qty_returned <= qty_shipped AND qty_shipped <= quantity - qty_cancelled)
);
CREATE INDEX IF NOT EXISTS idx_commerce_order_line_order
    ON commerce_order_line (order_id);
CREATE INDEX IF NOT EXISTS idx_commerce_order_line_log
    ON commerce_order_line (payment_log_id);
CREATE INDEX IF NOT EXISTS idx_commerce_order_line_session
    ON commerce_order_line (institute_id, package_session_id);

-- Every order has tender rows, online ones included.
CREATE TABLE IF NOT EXISTS commerce_order_tender (
    id                VARCHAR(36)    PRIMARY KEY,
    institute_id      VARCHAR(36)    NOT NULL,
    order_id          VARCHAR(36)    NOT NULL REFERENCES commerce_order (id),
    pos_session_id    VARCHAR(36),
    mode              VARCHAR(32)    NOT NULL,
    amount            NUMERIC(12, 2) NOT NULL,
    reference         VARCHAR(100),
    status            VARCHAR(16)    NOT NULL DEFAULT 'PENDING',
    received_at       TIMESTAMP,
    recorded_by       VARCHAR(36),
    money_account_id  VARCHAR(36),
    created_at        TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_commerce_order_tender_status CHECK (status IN ('RECEIVED', 'PENDING', 'VOID')),
    CONSTRAINT ck_commerce_order_tender_amount CHECK (amount >= 0)
);
CREATE INDEX IF NOT EXISTS idx_commerce_order_tender_order
    ON commerce_order_tender (order_id);
CREATE INDEX IF NOT EXISTS idx_commerce_order_tender_session
    ON commerce_order_tender (pos_session_id) WHERE pos_session_id IS NOT NULL;

-- Append-only timeline.
CREATE TABLE IF NOT EXISTS commerce_order_status_history (
    id             VARCHAR(36)  PRIMARY KEY,
    institute_id   VARCHAR(36)  NOT NULL,
    order_id       VARCHAR(36)  NOT NULL REFERENCES commerce_order (id),
    from_status    VARCHAR(32),
    to_status      VARCHAR(32)  NOT NULL,
    actor_user_id  VARCHAR(36),
    note           VARCHAR(500),
    created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_commerce_order_history_order
    ON commerce_order_status_history (order_id, created_at);
