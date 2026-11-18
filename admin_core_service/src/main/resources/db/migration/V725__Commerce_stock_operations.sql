-- V725: Commerce stock operations (WP-40): transfers with delivery challan, stock counts, label requests.
-- New tables only; nothing existing is altered. Foreign keys to stock_location lock it briefly. Re-runnable.
SET LOCAL lock_timeout = '5s';

-- A move of stock between two own locations. The number is a running number (TRF-000001, gaps allowed); the
-- delivery challan number comes from a DELIVERY_CHALLAN document series at dispatch (no gaps).
CREATE TABLE IF NOT EXISTS stock_transfer (
    id                  VARCHAR(36)  PRIMARY KEY,
    institute_id        VARCHAR(36)  NOT NULL,
    transfer_number     VARCHAR(32)  NOT NULL,
    from_location_id    VARCHAR(36)  NOT NULL REFERENCES stock_location (id),
    to_location_id      VARCHAR(36)  NOT NULL REFERENCES stock_location (id),
    status              VARCHAR(16)  NOT NULL DEFAULT 'DRAFT',
    document_type       VARCHAR(32),
    document_number     VARCHAR(64),
    document_series_id  VARCHAR(36),
    document_date       DATE,
    from_gstin          VARCHAR(15),
    to_gstin            VARCHAR(15),
    eway_bill_no        VARCHAR(32),
    note                VARCHAR(500),
    receive_note        VARCHAR(500),
    created_by          VARCHAR(36),
    dispatched_at       TIMESTAMP,
    dispatched_by       VARCHAR(36),
    received_at         TIMESTAMP,
    received_by         VARCHAR(36),
    cancelled_at        TIMESTAMP,
    cancelled_by        VARCHAR(36),
    client_request_id   VARCHAR(64),
    request_hash        VARCHAR(64),
    created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_stock_transfer_number UNIQUE (institute_id, transfer_number),
    CONSTRAINT uq_stock_transfer_request UNIQUE (institute_id, client_request_id),
    CONSTRAINT ck_stock_transfer_status CHECK (status IN ('DRAFT', 'DISPATCHED', 'RECEIVED', 'CANCELLED')),
    CONSTRAINT ck_stock_transfer_places CHECK (from_location_id <> to_location_id),
    CONSTRAINT ck_stock_transfer_document_type CHECK (document_type IS NULL
        OR document_type IN ('DELIVERY_CHALLAN', 'EXTERNAL_INVOICE')),
    CONSTRAINT ck_stock_transfer_dispatched CHECK (status IN ('DRAFT', 'CANCELLED')
        OR (document_type IS NOT NULL AND document_number IS NOT NULL AND document_date IS NOT NULL
            AND dispatched_at IS NOT NULL)),
    CONSTRAINT ck_stock_transfer_received CHECK ((status = 'RECEIVED') = (received_at IS NOT NULL)),
    CONSTRAINT ck_stock_transfer_cancelled CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_transfer_challan
    ON stock_transfer (institute_id, document_number) WHERE document_type = 'DELIVERY_CHALLAN';
CREATE INDEX IF NOT EXISTS idx_stock_transfer_status ON stock_transfer (institute_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_from ON stock_transfer (institute_id, from_location_id, status);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_to ON stock_transfer (institute_id, to_location_id, status);

-- One item of a transfer: a quantity of one variant, or one piece. unit_value, hsn_code, sku and item_name are
-- copied at dispatch so the challan reads the same whenever it is printed.
CREATE TABLE IF NOT EXISTS stock_transfer_line (
    id                  VARCHAR(36)    PRIMARY KEY,
    institute_id        VARCHAR(36)    NOT NULL,
    transfer_id         VARCHAR(36)    NOT NULL REFERENCES stock_transfer (id),
    package_session_id  VARCHAR(255)   NOT NULL,
    piece_id            VARCHAR(36),
    qty_sent            INTEGER        NOT NULL,
    qty_received        INTEGER,
    shortfall_reason    VARCHAR(32),
    unit_value          NUMERIC(14, 4),
    hsn_code            VARCHAR(16),
    sku                 VARCHAR(64),
    item_name           VARCHAR(255),
    note                VARCHAR(200),
    created_at          TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_stock_transfer_line_sent CHECK (qty_sent > 0),
    CONSTRAINT ck_stock_transfer_line_piece CHECK (piece_id IS NULL OR qty_sent = 1),
    CONSTRAINT ck_stock_transfer_line_received CHECK (qty_received IS NULL
        OR (qty_received >= 0 AND qty_received <= qty_sent)),
    CONSTRAINT ck_stock_transfer_line_reason CHECK (shortfall_reason IS NULL
        OR shortfall_reason IN ('DAMAGED_IN_TRANSIT', 'LOST'))
);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_line_transfer ON stock_transfer_line (institute_id, transfer_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_transfer_line_variant
    ON stock_transfer_line (transfer_id, package_session_id) WHERE piece_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_transfer_line_piece
    ON stock_transfer_line (transfer_id, piece_id) WHERE piece_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stock_transfer_line_piece
    ON stock_transfer_line (institute_id, piece_id) WHERE piece_id IS NOT NULL;

-- A physical count of one location (or of one collection there). kind RECOUNT is a blind second count of a
-- sample by another person; it never posts movements, it is compared with the count it rechecks.
CREATE TABLE IF NOT EXISTS stock_count (
    id                   VARCHAR(36)  PRIMARY KEY,
    institute_id         VARCHAR(36)  NOT NULL,
    count_number         VARCHAR(32)  NOT NULL,
    location_id          VARCHAR(36)  NOT NULL REFERENCES stock_location (id),
    scope_collection_id  VARCHAR(36),
    kind                 VARCHAR(16)  NOT NULL DEFAULT 'COUNT',
    recount_of_count_id  VARCHAR(36)  REFERENCES stock_count (id),
    status               VARCHAR(16)  NOT NULL DEFAULT 'OPEN',
    note                 VARCHAR(500),
    started_by           VARCHAR(36)  NOT NULL,
    started_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    posted_at            TIMESTAMP,
    posted_by            VARCHAR(36),
    uncounted_choice     VARCHAR(8),
    summary_json         JSONB,
    cancelled_at         TIMESTAMP,
    cancelled_by         VARCHAR(36),
    client_request_id    VARCHAR(64),
    request_hash         VARCHAR(64),
    created_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_stock_count_number UNIQUE (institute_id, count_number),
    CONSTRAINT uq_stock_count_request UNIQUE (institute_id, client_request_id),
    CONSTRAINT ck_stock_count_status CHECK (status IN ('OPEN', 'POSTED', 'CANCELLED')),
    CONSTRAINT ck_stock_count_kind CHECK ((kind = 'COUNT' AND recount_of_count_id IS NULL)
        OR (kind = 'RECOUNT' AND recount_of_count_id IS NOT NULL)),
    CONSTRAINT ck_stock_count_uncounted CHECK (uncounted_choice IS NULL OR uncounted_choice IN ('SKIP', 'ZERO')),
    CONSTRAINT ck_stock_count_posted CHECK ((status = 'POSTED') = (posted_at IS NOT NULL))
);
-- One open count per location; one open recount per count.
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_count_open
    ON stock_count (institute_id, location_id) WHERE status = 'OPEN' AND kind = 'COUNT';
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_count_open_recount
    ON stock_count (institute_id, recount_of_count_id) WHERE status = 'OPEN' AND kind = 'RECOUNT';
CREATE INDEX IF NOT EXISTS idx_stock_count_location ON stock_count (institute_id, location_id, started_at);

-- What was counted. counted_at is the database time of the last change of the line (the posting formula of
-- ARCHITECTURE 4.8 compares it with stock_movement.created_at, also database time).
CREATE TABLE IF NOT EXISTS stock_count_line (
    id                  VARCHAR(36)  PRIMARY KEY,
    institute_id        VARCHAR(36)  NOT NULL,
    count_id            VARCHAR(36)  NOT NULL REFERENCES stock_count (id),
    package_session_id  VARCHAR(255) NOT NULL,
    piece_id            VARCHAR(36),
    counted_qty         INTEGER      NOT NULL,
    counted_at          TIMESTAMP    NOT NULL,
    counted_by          VARCHAR(36),
    on_hand_at_post     INTEGER,
    moved_since         INTEGER,
    adjustment          INTEGER,
    movement_id         VARCHAR(36),
    created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_stock_count_line_qty CHECK (counted_qty >= 0),
    CONSTRAINT ck_stock_count_line_piece CHECK (piece_id IS NULL OR counted_qty = 1)
);
CREATE INDEX IF NOT EXISTS idx_stock_count_line_count ON stock_count_line (institute_id, count_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_count_line_variant
    ON stock_count_line (count_id, package_session_id) WHERE piece_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_count_line_piece
    ON stock_count_line (count_id, piece_id) WHERE piece_id IS NOT NULL;

-- The label print queue and the reprint log (ARCHITECTURE 3.2).
CREATE TABLE IF NOT EXISTS commerce_label_request (
    id                  VARCHAR(36)    PRIMARY KEY,
    institute_id        VARCHAR(36)    NOT NULL,
    location_id         VARCHAR(36)    NOT NULL REFERENCES stock_location (id),
    package_session_id  VARCHAR(255)   NOT NULL,
    piece_id            VARCHAR(36),
    quantity            INTEGER        NOT NULL,
    reason              VARCHAR(32)    NOT NULL,
    reprint_reason      VARCHAR(32),
    note                VARCHAR(200),
    source_type         VARCHAR(32)    NOT NULL DEFAULT 'MANUAL',
    source_id           VARCHAR(36),
    status              VARCHAR(16)    NOT NULL DEFAULT 'PENDING',
    requested_by        VARCHAR(36),
    printed_at          TIMESTAMP,
    printed_by          VARCHAR(36),
    printed_price       NUMERIC(14, 4),
    printed_mrp         NUMERIC(14, 4),
    cancelled_at        TIMESTAMP,
    cancelled_by        VARCHAR(36),
    created_at          TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_commerce_label_request_quantity CHECK (quantity BETWEEN 1 AND 10000),
    CONSTRAINT ck_commerce_label_request_piece CHECK (piece_id IS NULL OR quantity = 1),
    CONSTRAINT ck_commerce_label_request_reason CHECK (reason IN ('NEW_RECEIPT', 'REPRINT', 'PRICE_CHANGE')),
    CONSTRAINT ck_commerce_label_request_reprint CHECK (reprint_reason IS NULL
        OR reprint_reason IN ('TORN', 'LOST', 'PRICE_CHANGED', 'NOT_PRINTED', 'OTHER')),
    CONSTRAINT ck_commerce_label_request_source CHECK (source_type IN ('STOCK_RECEIPT', 'STOCK_TRANSFER', 'MANUAL')),
    CONSTRAINT ck_commerce_label_request_status CHECK (status IN ('PENDING', 'PRINTED', 'CANCELLED')),
    CONSTRAINT ck_commerce_label_request_printed CHECK ((status = 'PRINTED') = (printed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_commerce_label_request_queue
    ON commerce_label_request (institute_id, status, location_id, created_at);
CREATE INDEX IF NOT EXISTS idx_commerce_label_request_source
    ON commerce_label_request (institute_id, source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_commerce_label_request_variant
    ON commerce_label_request (institute_id, package_session_id, status);
-- A receipt queues its labels once.
CREATE UNIQUE INDEX IF NOT EXISTS uq_commerce_label_request_receipt
    ON commerce_label_request (institute_id, source_id, package_session_id, COALESCE(piece_id, ''))
    WHERE reason = 'NEW_RECEIPT';
