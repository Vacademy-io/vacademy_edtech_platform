-- Commerce tax and documents (docs/commerce/ARCHITECTURE.md section 3.4).
-- New tables first, then nullable columns on invoice and invoice_line_item.
-- NO tax data is seeded here. Tax classes, rates and HSN codes come from the client CA and are
-- typed in by the institute. The placeholder rates used by the calculator tests are marked TEST
-- and live in test code only.
-- No index is added to invoice or invoice_line_item: those hold live rows, so an index there
-- needs CREATE INDEX CONCURRENTLY in its own non-transactional migration.

CREATE TABLE IF NOT EXISTS commerce_tax_class (
    id            VARCHAR(36)  PRIMARY KEY,
    institute_id  VARCHAR(36)  NOT NULL,
    code          VARCHAR(64)  NOT NULL,
    name          VARCHAR(255) NOT NULL,
    hsn_code      VARCHAR(16),
    unit          VARCHAR(32),
    status        VARCHAR(32)  NOT NULL DEFAULT 'ACTIVE',
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_commerce_tax_class_code UNIQUE (institute_id, code),
    CONSTRAINT ck_commerce_tax_class_status CHECK (status IN ('ACTIVE', 'ARCHIVED'))
);

CREATE TABLE IF NOT EXISTS commerce_tax_rate_rule (
    id              VARCHAR(36)   PRIMARY KEY,
    institute_id    VARCHAR(36)   NOT NULL,
    tax_class_id    VARCHAR(36)   NOT NULL,
    min_unit_price  NUMERIC(12,2) NOT NULL DEFAULT 0,
    max_unit_price  NUMERIC(12,2),
    rate_percent    NUMERIC(6,3)  NOT NULL,
    cess_percent    NUMERIC(6,3)  NOT NULL DEFAULT 0,
    effective_from  DATE          NOT NULL,
    effective_to    DATE,
    created_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_commerce_tax_rate_rule_class FOREIGN KEY (tax_class_id) REFERENCES commerce_tax_class (id),
    CONSTRAINT ck_commerce_tax_rate_rule_rate CHECK (rate_percent >= 0 AND rate_percent <= 100),
    CONSTRAINT ck_commerce_tax_rate_rule_cess CHECK (cess_percent >= 0 AND cess_percent <= 100),
    CONSTRAINT ck_commerce_tax_rate_rule_slab CHECK (min_unit_price >= 0
        AND (max_unit_price IS NULL OR max_unit_price >= min_unit_price)),
    CONSTRAINT ck_commerce_tax_rate_rule_dates CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS idx_commerce_tax_rate_rule_class
    ON commerce_tax_rate_rule (institute_id, tax_class_id, effective_from);

-- One row per institute: the tax mode and the calculator settings (commerce.tax.*,
-- commerce.roundTotalTo, commerce.invoiceAt) and the seller fallback when a location has none.
CREATE TABLE IF NOT EXISTS commerce_tax_setting (
    id                 VARCHAR(36)  PRIMARY KEY,
    institute_id       VARCHAR(36)  NOT NULL,
    tax_mode           VARCHAR(32)  NOT NULL DEFAULT 'UNREGISTERED',
    slab_basis         VARCHAR(32)  NOT NULL DEFAULT 'NET_UNIT_PRICE',
    slab_compare       VARCHAR(32)  NOT NULL DEFAULT 'TAX_EXCLUSIVE',
    round_total_to     VARCHAR(32)  NOT NULL DEFAULT 'NONE',
    invoice_at         VARCHAR(32)  NOT NULL DEFAULT 'PACKED',
    seller_gstin       VARCHAR(15),
    seller_state_code  VARCHAR(8),
    seller_legal_name  VARCHAR(255),
    seller_address     TEXT,
    fy_start_month     INTEGER      NOT NULL DEFAULT 4,
    created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_commerce_tax_setting_institute UNIQUE (institute_id),
    CONSTRAINT ck_commerce_tax_setting_mode CHECK (tax_mode IN ('REGULAR', 'COMPOSITION', 'UNREGISTERED')),
    CONSTRAINT ck_commerce_tax_setting_basis CHECK (slab_basis IN ('NET_UNIT_PRICE', 'LIST_UNIT_PRICE')),
    CONSTRAINT ck_commerce_tax_setting_compare CHECK (slab_compare IN ('TAX_EXCLUSIVE', 'TAX_INCLUSIVE')),
    CONSTRAINT ck_commerce_tax_setting_round CHECK (round_total_to IN ('NONE', 'RUPEE')),
    CONSTRAINT ck_commerce_tax_setting_invoice_at CHECK (invoice_at IN ('PACKED', 'CONFIRMED')),
    CONSTRAINT ck_commerce_tax_setting_fy CHECK (fy_start_month BETWEEN 1 AND 12)
);

-- location_id and register_id point at stock_location and pos_register, which other work
-- packages create; they carry no foreign key so this file does not depend on their order.
CREATE TABLE IF NOT EXISTS commerce_document_series (
    id              VARCHAR(36)  PRIMARY KEY,
    institute_id    VARCHAR(36)  NOT NULL,
    seller_gstin    VARCHAR(15),
    location_id     VARCHAR(36),
    register_id     VARCHAR(36),
    channel         VARCHAR(32)  NOT NULL DEFAULT 'ALL',
    document_type   VARCHAR(32)  NOT NULL,
    kind            VARCHAR(32)  NOT NULL DEFAULT 'SYSTEM',
    prefix          VARCHAR(16)  NOT NULL,
    financial_year  VARCHAR(8)   NOT NULL,
    next_value      BIGINT       NOT NULL DEFAULT 1,
    book_from       BIGINT,
    book_to         BIGINT,
    status          VARCHAR(32)  NOT NULL DEFAULT 'ACTIVE',
    created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_commerce_document_series_prefix UNIQUE (institute_id, prefix, financial_year),
    CONSTRAINT ck_commerce_document_series_channel CHECK (channel IN ('ALL', 'ONLINE', 'POS', 'ADMIN')),
    CONSTRAINT ck_commerce_document_series_type CHECK (document_type IN
        ('TAX_INVOICE', 'BILL_OF_SUPPLY', 'INVOICE', 'CREDIT_NOTE', 'DELIVERY_CHALLAN')),
    CONSTRAINT ck_commerce_document_series_kind CHECK (kind IN ('SYSTEM', 'MANUAL_BOOK')),
    CONSTRAINT ck_commerce_document_series_status CHECK (status IN ('ACTIVE', 'CLOSED')),
    CONSTRAINT ck_commerce_document_series_next CHECK (next_value >= 1),
    CONSTRAINT ck_commerce_document_series_book CHECK (
        (kind = 'SYSTEM' AND book_from IS NULL AND book_to IS NULL)
        OR (kind = 'MANUAL_BOOK' AND book_from IS NOT NULL AND book_to IS NOT NULL
            AND book_from >= 1 AND book_to >= book_from))
);

CREATE INDEX IF NOT EXISTS idx_commerce_document_series_pick
    ON commerce_document_series (institute_id, document_type, financial_year, status);

-- invoice_id and return_id carry no foreign key: invoice is a legacy table (no lock taken on
-- it here) and commerce_return is created by a later work package.
CREATE TABLE IF NOT EXISTS commerce_credit_note (
    id                     VARCHAR(36)   PRIMARY KEY,
    institute_id           VARCHAR(36)   NOT NULL,
    credit_note_number     VARCHAR(100)  NOT NULL,
    series_id              VARCHAR(36)   NOT NULL,
    invoice_id             VARCHAR(255)  NOT NULL,
    commerce_order_id      VARCHAR(36),
    return_id              VARCHAR(36),
    reason                 TEXT,
    document_date          DATE          NOT NULL,
    seller_gstin           VARCHAR(15),
    seller_state_code      VARCHAR(8),
    buyer_gstin            VARCHAR(15),
    place_of_supply_state  VARCHAR(8),
    tax_head               VARCHAR(32)   NOT NULL DEFAULT 'NONE',
    taxable_value          NUMERIC(12,2) NOT NULL DEFAULT 0,
    cgst                   NUMERIC(12,2) NOT NULL DEFAULT 0,
    sgst                   NUMERIC(12,2) NOT NULL DEFAULT 0,
    igst                   NUMERIC(12,2) NOT NULL DEFAULT 0,
    cess                   NUMERIC(12,2) NOT NULL DEFAULT 0,
    tax_amount             NUMERIC(12,2) NOT NULL DEFAULT 0,
    round_off              NUMERIC(12,2) NOT NULL DEFAULT 0,
    total                  NUMERIC(12,2) NOT NULL,
    currency               VARCHAR(10)   NOT NULL DEFAULT 'INR',
    pdf_file_id            VARCHAR(255),
    created_by             VARCHAR(36),
    client_request_id      VARCHAR(64)   NOT NULL,
    request_hash           VARCHAR(64)   NOT NULL,
    created_at             TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at             TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_commerce_credit_note_number UNIQUE (institute_id, credit_note_number),
    -- A repeated request is answered with the first note instead of crediting twice.
    CONSTRAINT uq_commerce_credit_note_client_request UNIQUE (institute_id, client_request_id),
    CONSTRAINT fk_commerce_credit_note_series FOREIGN KEY (series_id) REFERENCES commerce_document_series (id),
    CONSTRAINT ck_commerce_credit_note_tax_head CHECK (tax_head IN ('CGST_SGST', 'IGST', 'NONE')),
    CONSTRAINT ck_commerce_credit_note_total CHECK (total >= 0)
);

CREATE INDEX IF NOT EXISTS idx_commerce_credit_note_invoice
    ON commerce_credit_note (institute_id, invoice_id);
CREATE INDEX IF NOT EXISTS idx_commerce_credit_note_date
    ON commerce_credit_note (institute_id, document_date);

CREATE TABLE IF NOT EXISTS commerce_credit_note_line (
    id                    VARCHAR(36)   PRIMARY KEY,
    institute_id          VARCHAR(36)   NOT NULL,
    credit_note_id        VARCHAR(36)   NOT NULL,
    invoice_line_item_id  VARCHAR(255)  NOT NULL,
    description           TEXT,
    hsn_code              VARCHAR(16),
    unit                  VARCHAR(32),
    quantity              INTEGER       NOT NULL,
    unit_price            NUMERIC(12,2),
    tax_rate              NUMERIC(6,3)  NOT NULL DEFAULT 0,
    taxable_value         NUMERIC(12,2) NOT NULL DEFAULT 0,
    cgst                  NUMERIC(12,2) NOT NULL DEFAULT 0,
    sgst                  NUMERIC(12,2) NOT NULL DEFAULT 0,
    igst                  NUMERIC(12,2) NOT NULL DEFAULT 0,
    cess                  NUMERIC(12,2) NOT NULL DEFAULT 0,
    amount                NUMERIC(12,2) NOT NULL,
    cost_total            NUMERIC(12,2),
    package_session_id    VARCHAR(255),
    piece_id              VARCHAR(36),
    created_at            TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_commerce_credit_note_line_note FOREIGN KEY (credit_note_id) REFERENCES commerce_credit_note (id),
    CONSTRAINT ck_commerce_credit_note_line_qty CHECK (quantity >= 0)
);

CREATE INDEX IF NOT EXISTS idx_commerce_credit_note_line_note
    ON commerce_credit_note_line (institute_id, credit_note_id);
CREATE INDEX IF NOT EXISTS idx_commerce_credit_note_line_invoice_line
    ON commerce_credit_note_line (institute_id, invoice_line_item_id);

-- Existing tables: nullable columns only, no default, so no table rewrite. The lock is brief;
-- the timeout makes the migration fail fast instead of queueing behind a long transaction.
SET LOCAL lock_timeout = '5s';

ALTER TABLE invoice
    ADD COLUMN IF NOT EXISTS document_type            VARCHAR(32),
    ADD COLUMN IF NOT EXISTS series_id                VARCHAR(36),
    ADD COLUMN IF NOT EXISTS document_date            DATE,
    ADD COLUMN IF NOT EXISTS external_invoice_number  VARCHAR(64),
    ADD COLUMN IF NOT EXISTS seller_gstin             VARCHAR(15),
    ADD COLUMN IF NOT EXISTS seller_state_code        VARCHAR(8),
    ADD COLUMN IF NOT EXISTS place_of_supply_state    VARCHAR(8),
    ADD COLUMN IF NOT EXISTS tax_head                 VARCHAR(32),
    ADD COLUMN IF NOT EXISTS buyer_gstin              VARCHAR(15),
    ADD COLUMN IF NOT EXISTS location_id              VARCHAR(36),
    ADD COLUMN IF NOT EXISTS channel                  VARCHAR(32),
    ADD COLUMN IF NOT EXISTS commerce_order_id        VARCHAR(36),
    ADD COLUMN IF NOT EXISTS round_off                NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS cancelled_at             TIMESTAMP,
    ADD COLUMN IF NOT EXISTS cancel_reason            TEXT,
    ADD COLUMN IF NOT EXISTS irn                      VARCHAR(100),
    ADD COLUMN IF NOT EXISTS eway_bill_no             VARCHAR(32);

ALTER TABLE invoice_line_item
    ADD COLUMN IF NOT EXISTS hsn_code            VARCHAR(16),
    ADD COLUMN IF NOT EXISTS unit                VARCHAR(32),
    ADD COLUMN IF NOT EXISTS tax_rate            NUMERIC(6,3),
    ADD COLUMN IF NOT EXISTS taxable_value       NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS cgst                NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS sgst                NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS igst                NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS cess                NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS discount            NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS package_session_id  VARCHAR(255),
    ADD COLUMN IF NOT EXISTS piece_id            VARCHAR(36);
