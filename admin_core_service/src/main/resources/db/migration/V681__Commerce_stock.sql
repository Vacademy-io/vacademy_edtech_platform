-- V681: Commerce stock core and receipt cost (docs/commerce/ARCHITECTURE.md 3.2;
-- PURCHASES_AND_ACCOUNTS.md 3.3). WP-03 and WP-61.
-- New tables, plus nullable columns on stock_hold (V640) and commerce_variant (V680), added
-- last so their locks are held for the shortest time.
-- No data is moved and no table is rewritten.
-- Conventions: id VARCHAR(36); institute_id first in every index; enums VARCHAR(32) with a
-- CHECK list; quantities INTEGER in base units; unit cost NUMERIC(14,4); money NUMERIC(12,2).
-- Ids that point at legacy rows (package_session_id) are VARCHAR(255) and carry no foreign key.

-- A place of the seller: any mix of store, warehouse and source. An exhibition is a temporary
-- store. sells_online marks the location whose stock the website sells.
CREATE TABLE IF NOT EXISTS stock_location (
    id             VARCHAR(36)  PRIMARY KEY,
    institute_id   VARCHAR(36)  NOT NULL,
    code           VARCHAR(32)  NOT NULL,
    name           VARCHAR(255) NOT NULL,
    address_line1  VARCHAR(255),
    address_line2  VARCHAR(255),
    city           VARCHAR(100),
    pincode        VARCHAR(10),
    state_code     VARCHAR(8),
    gstin          VARCHAR(15),
    is_store       BOOLEAN      NOT NULL DEFAULT FALSE,
    is_warehouse   BOOLEAN      NOT NULL DEFAULT FALSE,
    is_source      BOOLEAN      NOT NULL DEFAULT FALSE,
    is_temporary   BOOLEAN      NOT NULL DEFAULT FALSE,
    starts_on      DATE,
    ends_on        DATE,
    sells_online   BOOLEAN      NOT NULL DEFAULT FALSE,
    is_pos_enabled BOOLEAN      NOT NULL DEFAULT FALSE,
    status         VARCHAR(32)  NOT NULL DEFAULT 'ACTIVE',
    created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_stock_location_code UNIQUE (institute_id, code),
    CONSTRAINT ck_stock_location_status CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

-- Phase 1: one location per institute sells online (ARCHITECTURE.md 3.2). Phase 2 drops this.
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_location_sells_online
    ON stock_location (institute_id) WHERE sells_online;

-- Physical quantity of one variant at one location. Written only by StockLedgerService.
CREATE TABLE IF NOT EXISTS stock_level (
    id                 VARCHAR(36)  PRIMARY KEY,
    institute_id       VARCHAR(36)  NOT NULL,
    location_id        VARCHAR(36)  NOT NULL REFERENCES stock_location (id),
    package_session_id VARCHAR(255) NOT NULL,
    on_hand            INTEGER      NOT NULL DEFAULT 0,
    reorder_level      INTEGER,
    created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_stock_level_location_variant UNIQUE (location_id, package_session_id),
    CONSTRAINT ck_stock_level_on_hand CHECK (on_hand >= 0)
);

CREATE INDEX IF NOT EXISTS idx_stock_level_institute_variant
    ON stock_level (institute_id, package_session_id);
CREATE INDEX IF NOT EXISTS idx_stock_level_institute_location
    ON stock_level (institute_id, location_id);

-- The stock ledger. Append-only: a correction is a new row with the opposite sign and
-- reverses_movement_id set. unit_cost and cost_provisional are stamped at post and never
-- updated; later cost changes are rows in stock_cost_adjustment.
CREATE TABLE IF NOT EXISTS stock_movement (
    id                   VARCHAR(36)  PRIMARY KEY,
    institute_id         VARCHAR(36)  NOT NULL,
    location_id          VARCHAR(36)  NOT NULL REFERENCES stock_location (id),
    package_session_id   VARCHAR(255) NOT NULL,
    piece_id             VARCHAR(36),
    type                 VARCHAR(32)  NOT NULL,
    quantity_delta       INTEGER      NOT NULL,
    balance_after        INTEGER      NOT NULL,
    affects_sellable     BOOLEAN      NOT NULL DEFAULT FALSE,
    reference_type       VARCHAR(32),
    reference_id         VARCHAR(64),
    transfer_id          VARCHAR(36),
    reverses_movement_id VARCHAR(36),
    reason               VARCHAR(32),
    note                 TEXT,
    actor_user_id        VARCHAR(36),
    idempotency_key      VARCHAR(160) NOT NULL,
    unit_cost            NUMERIC(14, 4),
    cost_provisional     BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_stock_movement_idempotency UNIQUE (institute_id, idempotency_key),
    CONSTRAINT ck_stock_movement_type CHECK (type IN (
        'RECEIPT', 'ADJUSTMENT', 'DAMAGE', 'TRANSFER_OUT', 'TRANSFER_IN',
        'SALE', 'POS_SALE', 'RETURN', 'PURCHASE_RETURN')),
    CONSTRAINT ck_stock_movement_delta CHECK (quantity_delta <> 0),
    CONSTRAINT ck_stock_movement_balance CHECK (balance_after >= 0)
);

CREATE INDEX IF NOT EXISTS idx_stock_movement_variant_created
    ON stock_movement (institute_id, package_session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stock_movement_location_created
    ON stock_movement (institute_id, location_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stock_movement_reference
    ON stock_movement (institute_id, reference_type, reference_id);
-- Stock in transit is read from the ledger (sent minus received) when a cost changes.
CREATE INDEX IF NOT EXISTS idx_stock_movement_transit
    ON stock_movement (institute_id, package_session_id)
    WHERE type IN ('TRANSFER_OUT', 'TRANSFER_IN');

-- One physical one-of-a-kind item. code is the scan code: P plus 9 random characters.
CREATE TABLE IF NOT EXISTS commerce_piece (
    id                 VARCHAR(36)  PRIMARY KEY,
    institute_id       VARCHAR(36)  NOT NULL,
    package_session_id VARCHAR(255) NOT NULL,
    code               VARCHAR(16)  NOT NULL,
    location_id        VARCHAR(36)  REFERENCES stock_location (id),
    status             VARCHAR(32)  NOT NULL DEFAULT 'IN_STOCK',
    order_line_id      VARCHAR(36),
    meta_json          JSONB,
    note               TEXT,
    unit_cost          NUMERIC(14, 4),
    receipt_line_id    VARCHAR(36),
    created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_commerce_piece_code UNIQUE (code),
    CONSTRAINT ck_commerce_piece_status CHECK (status IN (
        'IN_STOCK', 'RESERVED', 'SOLD', 'IN_TRANSIT', 'WRITTEN_OFF', 'VOIDED',
        'RETURNED_TO_SUPPLIER'))
);

CREATE INDEX IF NOT EXISTS idx_commerce_piece_variant_status
    ON commerce_piece (institute_id, package_session_id, status);
CREATE INDEX IF NOT EXISTS idx_commerce_piece_location_status
    ON commerce_piece (institute_id, location_id, status);
CREATE INDEX IF NOT EXISTS idx_commerce_piece_receipt_line
    ON commerce_piece (institute_id, receipt_line_id);

-- Header of a goods receipt. supplier_id gets its foreign key with the supplier table (WP-60a).
CREATE TABLE IF NOT EXISTS stock_receipt (
    id                      VARCHAR(36)  PRIMARY KEY,
    institute_id            VARCHAR(36)  NOT NULL,
    receipt_number          VARCHAR(32)  NOT NULL,
    location_id             VARCHAR(36)  NOT NULL REFERENCES stock_location (id),
    source_kind             VARCHAR(32)  NOT NULL,
    source_location_id      VARCHAR(36)  REFERENCES stock_location (id),
    supplier_id             VARCHAR(36),
    supplier_challan_number VARCHAR(64),
    supplier_challan_date   DATE,
    eway_bill_no            VARCHAR(32),
    eway_bill_date          DATE,
    received_date           DATE         NOT NULL,
    status                  VARCHAR(32)  NOT NULL DEFAULT 'POSTED',
    bill_status             VARCHAR(32)  NOT NULL DEFAULT 'NOT_APPLICABLE',
    no_bill_reason          VARCHAR(32),
    note                    TEXT,
    received_by             VARCHAR(36),
    posted_at               TIMESTAMP,
    reversed_by             VARCHAR(36),
    reversed_at             TIMESTAMP,
    client_request_id       VARCHAR(64),
    request_hash            VARCHAR(64),
    created_at              TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_stock_receipt_number UNIQUE (institute_id, receipt_number),
    CONSTRAINT uq_stock_receipt_client_request UNIQUE (institute_id, client_request_id),
    CONSTRAINT ck_stock_receipt_source_kind CHECK (source_kind IN (
        'OWN_SOURCE', 'SUPPLIER', 'OPENING', 'OTHER')),
    CONSTRAINT ck_stock_receipt_status CHECK (status IN ('POSTED', 'REVERSED')),
    CONSTRAINT ck_stock_receipt_bill_status CHECK (bill_status IN (
        'NOT_APPLICABLE', 'UNBILLED', 'PARTLY_BILLED', 'BILLED', 'NO_BILL')),
    CONSTRAINT ck_stock_receipt_no_bill_reason CHECK (no_bill_reason IS NULL OR no_bill_reason IN (
        'BILLED_ELSEWHERE', 'GIFT_OR_SAMPLE', 'OTHER'))
);

CREATE INDEX IF NOT EXISTS idx_stock_receipt_status_date
    ON stock_receipt (institute_id, status, received_date);
CREATE INDEX IF NOT EXISTS idx_stock_receipt_supplier_bill
    ON stock_receipt (institute_id, supplier_id, bill_status);
CREATE INDEX IF NOT EXISTS idx_stock_receipt_location
    ON stock_receipt (institute_id, location_id, received_date);

-- unit_cost is the cost in force now; its history is in stock_cost_adjustment.
-- qty_billed is kept by the bill link writer (WP-62).
CREATE TABLE IF NOT EXISTS stock_receipt_line (
    id                 VARCHAR(36)  PRIMARY KEY,
    institute_id       VARCHAR(36)  NOT NULL,
    receipt_id         VARCHAR(36)  NOT NULL REFERENCES stock_receipt (id),
    package_session_id VARCHAR(255) NOT NULL,
    qty_received       INTEGER      NOT NULL,
    qty_billed         INTEGER      NOT NULL DEFAULT 0,
    unit_cost          NUMERIC(14, 4),
    cost_source        VARCHAR(32)  NOT NULL DEFAULT 'NONE',
    note               TEXT,
    created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_stock_receipt_line_received CHECK (qty_received > 0),
    CONSTRAINT ck_stock_receipt_line_billed CHECK (qty_billed >= 0 AND qty_billed <= qty_received),
    CONSTRAINT ck_stock_receipt_line_cost_source CHECK (cost_source IN (
        'NONE', 'PROVISIONAL', 'STANDARD', 'TYPED', 'BILL')),
    CONSTRAINT ck_stock_receipt_line_cost CHECK (unit_cost IS NULL OR unit_cost >= 0)
);

CREATE INDEX IF NOT EXISTS idx_stock_receipt_line_receipt
    ON stock_receipt_line (institute_id, receipt_id);
CREATE INDEX IF NOT EXISTS idx_stock_receipt_line_variant
    ON stock_receipt_line (institute_id, package_session_id);

-- Append-only history of why a cost is what it is. Written only by StockLedgerService.
-- bill_line_id points at a purchase bill line (WP-62), so it has no foreign key yet.
CREATE TABLE IF NOT EXISTS stock_cost_adjustment (
    id                    VARCHAR(36)  PRIMARY KEY,
    institute_id          VARCHAR(36)  NOT NULL,
    movement_id           VARCHAR(36),
    receipt_line_id       VARCHAR(36),
    bill_line_id          VARCHAR(36),
    package_session_id    VARCHAR(255) NOT NULL,
    piece_id              VARCHAR(36),
    quantity              INTEGER      NOT NULL DEFAULT 0,
    old_unit_cost         NUMERIC(14, 4),
    new_unit_cost         NUMERIC(14, 4),
    qty_on_hand_at_change INTEGER,
    old_average           NUMERIC(14, 4),
    new_average           NUMERIC(14, 4),
    variance_amount       NUMERIC(16, 2) NOT NULL DEFAULT 0,
    book_date             DATE         NOT NULL,
    reason                VARCHAR(32)  NOT NULL,
    actor_user_id         VARCHAR(36),
    idempotency_key       VARCHAR(160) NOT NULL,
    created_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_stock_cost_adjustment_idempotency UNIQUE (institute_id, idempotency_key),
    CONSTRAINT ck_stock_cost_adjustment_reason CHECK (reason IN (
        'BILL_LINK', 'BILL_UNLINK', 'BILL_AMEND', 'TYPED', 'STANDARD_SET', 'VALUE_DEBIT_NOTE',
        'PURCHASE_RETURN', 'RECEIPT_REVERSAL', 'MANUAL_SET'))
);

CREATE INDEX IF NOT EXISTS idx_stock_cost_adjustment_variant_created
    ON stock_cost_adjustment (institute_id, package_session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stock_cost_adjustment_book_date
    ON stock_cost_adjustment (institute_id, book_date);

-- Month-end stock value, append-only. location_id is a stock_location id or the constant
-- IN_TRANSIT, so it has no foreign key. Written by StockValueSnapshotJob (WP-65).
CREATE TABLE IF NOT EXISTS stock_value_snapshot (
    id                 VARCHAR(36)  PRIMARY KEY,
    institute_id       VARCHAR(36)  NOT NULL,
    as_of_date         DATE         NOT NULL,
    location_id        VARCHAR(36)  NOT NULL,
    package_session_id VARCHAR(255) NOT NULL,
    piece_id           VARCHAR(36),
    on_hand            INTEGER      NOT NULL,
    unit_cost          NUMERIC(14, 4),
    cost_source        VARCHAR(32),
    value              NUMERIC(14, 2),
    created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- piece_id is null for quantity stock, and a plain UNIQUE would let two such rows in.
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_value_snapshot_row
    ON stock_value_snapshot (institute_id, as_of_date, location_id, package_session_id,
                             COALESCE(piece_id, ''));

-- Running numbers (ARCHITECTURE.md 3.3): receipt numbers now; order, return and transfer
-- numbers later. Taken in a short transaction of its own, so gaps are allowed.
CREATE TABLE IF NOT EXISTS commerce_counter (
    id           VARCHAR(36)  PRIMARY KEY,
    institute_id VARCHAR(36)  NOT NULL,
    scope_key    VARCHAR(64)  NOT NULL,
    next_value   BIGINT       NOT NULL DEFAULT 1,
    created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_commerce_counter_scope UNIQUE (institute_id, scope_key)
);

-- The two ALTERs come last and give up after 5 seconds instead of queueing behind a long
-- transaction. Both add nullable columns only (no rewrite, no default).
-- commerce_variant.sellable_deficit: units that left an online location (damage, transfer out)
-- although they were held or sold online. available_slots cannot go below zero, so the part
-- below zero is kept here and paid off first by the next inflow or released hold. NULL is 0.
SET LOCAL lock_timeout = '5s';

ALTER TABLE stock_hold
    ADD COLUMN IF NOT EXISTS release_token_hash     VARCHAR(64),
    ADD COLUMN IF NOT EXISTS fulfilment_location_id VARCHAR(36),
    ADD COLUMN IF NOT EXISTS release_reason         VARCHAR(32);

ALTER TABLE commerce_variant
    ADD COLUMN IF NOT EXISTS last_purchase_cost NUMERIC(14, 4),
    ADD COLUMN IF NOT EXISTS last_purchase_at   TIMESTAMP,
    ADD COLUMN IF NOT EXISTS sellable_deficit   INTEGER;
