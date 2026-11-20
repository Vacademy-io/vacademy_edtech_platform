-- V735: Commerce accounts foundation (WP-60a): institute-wide staff scope, account heads, suppliers and their
-- encrypted identifiers, the supplier ledger, the period lock, and the supplier key on goods receipts.
-- New tables only, plus one foreign key on stock_receipt (validated against its few rows). Re-runnable.
SET LOCAL lock_timeout = '5s';

-- A manager or accountant who acts for every location of the institute (no row per location needed).
CREATE TABLE IF NOT EXISTS commerce_staff_scope (
    id            VARCHAR(36)  PRIMARY KEY,
    institute_id  VARCHAR(36)  NOT NULL,
    user_id       VARCHAR(36)  NOT NULL,
    all_locations BOOLEAN      NOT NULL DEFAULT false,
    set_by        VARCHAR(36),
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_commerce_staff_scope UNIQUE (institute_id, user_id)
);

-- What a money entry was for ("category" on screen). One level of parent. account_code is reserved.
CREATE TABLE IF NOT EXISTS commerce_account_head (
    id                       VARCHAR(36)  PRIMARY KEY,
    institute_id             VARCHAR(36)  NOT NULL,
    code                     VARCHAR(32)  NOT NULL,
    name_i18n                JSONB        NOT NULL,
    parent_id                VARCHAR(36)  REFERENCES commerce_account_head (id),
    nature                   VARCHAR(32)  NOT NULL,
    expense_kind             VARCHAR(32),
    is_capital               BOOLEAN      NOT NULL DEFAULT false,
    default_itc_eligibility  VARCHAR(32),
    default_hsn_code         VARCHAR(8),
    account_code             VARCHAR(32),
    is_system                BOOLEAN      NOT NULL DEFAULT false,
    position                 INTEGER      NOT NULL DEFAULT 0,
    status                   VARCHAR(32)  NOT NULL DEFAULT 'ACTIVE',
    created_by               VARCHAR(36),
    updated_by               VARCHAR(36),
    created_at               TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at               TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_commerce_account_head_code UNIQUE (institute_id, code),
    CONSTRAINT ck_commerce_account_head_code CHECK (code ~ '^[A-Z0-9_]{1,32}$'),
    CONSTRAINT ck_commerce_account_head_nature CHECK (nature IN (
        'EXPENSE', 'INCOME', 'ASSET', 'LIABILITY', 'STATUTORY')),
    CONSTRAINT ck_commerce_account_head_kind CHECK (expense_kind IS NULL
        OR (nature = 'EXPENSE' AND expense_kind IN ('DIRECT', 'INDIRECT'))),
    CONSTRAINT ck_commerce_account_head_itc CHECK (default_itc_eligibility IS NULL OR default_itc_eligibility IN (
        'ELIGIBLE', 'BLOCKED', 'NOT_CLAIMED', 'NOT_APPLICABLE')),
    CONSTRAINT ck_commerce_account_head_hsn CHECK (default_hsn_code IS NULL OR default_hsn_code ~ '^[0-9]{4,8}$'),
    CONSTRAINT ck_commerce_account_head_status CHECK (status IN ('ACTIVE', 'INACTIVE')),
    CONSTRAINT ck_commerce_account_head_parent CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX IF NOT EXISTS idx_commerce_account_head_list
    ON commerce_account_head (institute_id, nature, status, position);

-- Anyone the seller owes or pays. The kind (trader, worker, landlord, courier) is group_code, data not schema.
CREATE TABLE IF NOT EXISTS commerce_supplier (
    id                  VARCHAR(36)   PRIMARY KEY,
    institute_id        VARCHAR(36)   NOT NULL,
    code                VARCHAR(32)   NOT NULL,
    name                VARCHAR(255)  NOT NULL,
    legal_name          VARCHAR(255),
    name_alt            VARCHAR(255),
    group_code          VARCHAR(32)   NOT NULL DEFAULT 'SUPPLIER',
    phone               VARCHAR(20),
    email               VARCHAR(255),
    address_line1       VARCHAR(255),
    address_line2       VARCHAR(255),
    city                VARCHAR(100),
    country_code        VARCHAR(2)    NOT NULL DEFAULT 'IN',
    state_code          VARCHAR(2),
    pincode             VARCHAR(10),
    registration_type   VARCHAR(32)   NOT NULL DEFAULT 'UNREGISTERED',
    gstin               VARCHAR(15),
    payment_terms_days  INTEGER       NOT NULL DEFAULT 0,
    tds_applicable      BOOLEAN       NOT NULL DEFAULT false,
    default_tds_code    VARCHAR(32),
    upi_id              VARCHAR(100),
    payment_note        VARCHAR(500),
    default_head_id     VARCHAR(36)   REFERENCES commerce_account_head (id),
    customer_id         VARCHAR(36)   REFERENCES commerce_customer (id),
    search_text         TEXT          NOT NULL DEFAULT '',
    notes               TEXT,
    status              VARCHAR(32)   NOT NULL DEFAULT 'ACTIVE',
    external_ref        VARCHAR(100),
    version             BIGINT        NOT NULL DEFAULT 0,
    client_request_id   VARCHAR(64),
    request_hash        VARCHAR(64),
    created_by          VARCHAR(36),
    updated_by          VARCHAR(36),
    created_at          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_commerce_supplier_code UNIQUE (institute_id, code),
    CONSTRAINT uq_commerce_supplier_client_request UNIQUE (institute_id, client_request_id),
    CONSTRAINT ck_commerce_supplier_registration CHECK (registration_type IN (
        'REGULAR', 'COMPOSITION', 'UNREGISTERED')),
    CONSTRAINT ck_commerce_supplier_gstin CHECK (
        (registration_type = 'UNREGISTERED' AND gstin IS NULL)
        OR (registration_type IN ('REGULAR', 'COMPOSITION') AND gstin IS NOT NULL
            AND country_code = 'IN' AND substr(gstin, 1, 2) = state_code)),
    CONSTRAINT ck_commerce_supplier_status CHECK (status IN ('ACTIVE', 'INACTIVE')),
    CONSTRAINT ck_commerce_supplier_terms CHECK (payment_terms_days BETWEEN 0 AND 365)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_commerce_supplier_external_ref
    ON commerce_supplier (institute_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_commerce_supplier_status_name
    ON commerce_supplier (institute_id, status, name);
CREATE INDEX IF NOT EXISTS idx_commerce_supplier_phone
    ON commerce_supplier (institute_id, phone);
CREATE INDEX IF NOT EXISTS idx_commerce_supplier_gstin
    ON commerce_supplier (institute_id, gstin);

-- The supplier's PAN, encrypted by the commerce field cipher (prefix cfc1:<key id>:). Read only by the reveal
-- route (and later the TDS export and the payment voucher). Lists never read this table.
CREATE TABLE IF NOT EXISTS commerce_supplier_secret (
    id             VARCHAR(36)  PRIMARY KEY,
    institute_id   VARCHAR(36)  NOT NULL,
    supplier_id    VARCHAR(36)  NOT NULL REFERENCES commerce_supplier (id),
    pan_encrypted  TEXT         NOT NULL,
    key_id         VARCHAR(16)  NOT NULL,
    pan_hash       VARCHAR(64)  NOT NULL,
    pan_last4      VARCHAR(4)   NOT NULL,
    updated_by     VARCHAR(36),
    created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_commerce_supplier_secret_supplier UNIQUE (supplier_id),
    CONSTRAINT ck_commerce_supplier_secret_prefix CHECK (pan_encrypted LIKE 'cfc1:%')
);
CREATE INDEX IF NOT EXISTS idx_commerce_supplier_secret_hash
    ON commerce_supplier_secret (institute_id, pan_hash);

-- What changed a supplier's balance. Append-only; the only writer is SupplierLedgerService.post.
-- amount > 0: we owe more; < 0: we owe less (payment, debit note, TDS) or hold an advance.
CREATE TABLE IF NOT EXISTS commerce_supplier_ledger (
    id                 VARCHAR(36)    PRIMARY KEY,
    institute_id       VARCHAR(36)    NOT NULL,
    supplier_id        VARCHAR(36)    NOT NULL REFERENCES commerce_supplier (id),
    book_date          DATE           NOT NULL,
    type               VARCHAR(32)    NOT NULL,
    amount             NUMERIC(12, 2) NOT NULL,
    reference_type     VARCHAR(32),
    reference_id       VARCHAR(36),
    document_number    VARCHAR(64),
    location_id        VARCHAR(36)    REFERENCES stock_location (id),
    note               VARCHAR(500),
    actor_user_id      VARCHAR(36),
    reverses_entry_id  VARCHAR(36)    REFERENCES commerce_supplier_ledger (id),
    idempotency_key    VARCHAR(100)   NOT NULL,
    created_at         TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_commerce_supplier_ledger_key UNIQUE (institute_id, idempotency_key),
    CONSTRAINT ck_commerce_supplier_ledger_type CHECK (type IN (
        'OPENING', 'BILL', 'EXPENSE', 'DEBIT_NOTE', 'PAYMENT', 'TDS', 'REFUND_RECEIVED', 'SETTLEMENT', 'SET_OFF')),
    CONSTRAINT ck_commerce_supplier_ledger_amount CHECK (amount <> 0),
    CONSTRAINT ck_commerce_supplier_ledger_reverses CHECK (reverses_entry_id IS NULL OR reverses_entry_id <> id)
);
CREATE INDEX IF NOT EXISTS idx_commerce_supplier_ledger_supplier
    ON commerce_supplier_ledger (institute_id, supplier_id, book_date, created_at);
CREATE INDEX IF NOT EXISTS idx_commerce_supplier_ledger_reference
    ON commerce_supplier_ledger (institute_id, reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_commerce_supplier_ledger_reversal
    ON commerce_supplier_ledger (institute_id, reverses_entry_id) WHERE reverses_entry_id IS NOT NULL;

-- One row per institute: the date through which the books are closed (NULL = nothing closed). The row is created
-- on first need by the period-lock service; posts read it FOR SHARE, lock and unlock take it FOR UPDATE.
CREATE TABLE IF NOT EXISTS commerce_period_lock (
    id              VARCHAR(36)  PRIMARY KEY,
    institute_id    VARCHAR(36)  NOT NULL,
    locked_through  DATE,
    locked_by       VARCHAR(36),
    locked_at       TIMESTAMP,
    created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_commerce_period_lock UNIQUE (institute_id)
);

-- Goods receipts name a supplier of the same table from now on (stock_receipt holds no supplier rows yet).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_stock_receipt_supplier'
                                                 AND conrelid = 'stock_receipt'::regclass) THEN
        ALTER TABLE stock_receipt ADD CONSTRAINT fk_stock_receipt_supplier
            FOREIGN KEY (supplier_id) REFERENCES commerce_supplier (id);
    END IF;
END
$$;
