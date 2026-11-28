-- Commerce catalogue (docs/commerce/ARCHITECTURE.md section 3.1).
-- New tables only: no existing table is altered, so no lock on package or package_session.
-- Ids of legacy rows (package, package_session, media file) are VARCHAR(255) like the columns
-- they point at. They carry no foreign key on purpose: adding one would lock the legacy table.

CREATE TABLE IF NOT EXISTS commerce_product (
    id                  VARCHAR(36)  PRIMARY KEY,
    institute_id        VARCHAR(36)  NOT NULL,
    package_id          VARCHAR(255) NOT NULL,
    slug                VARCHAR(255) NOT NULL,
    stock_mode          VARCHAR(32)  NOT NULL DEFAULT 'QUANTITY',
    tax_class_id        VARCHAR(36),
    brand               VARCHAR(255),
    unit                VARCHAR(32)  NOT NULL DEFAULT 'PCS',
    qty_scale           INTEGER      NOT NULL DEFAULT 1,
    qty_step            INTEGER      NOT NULL DEFAULT 1,
    origin_location_id  VARCHAR(36),
    status              VARCHAR(32)  NOT NULL DEFAULT 'DRAFT',
    published_at        TIMESTAMP,
    seo_i18n            JSONB,
    external_ref        VARCHAR(255),
    created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_commerce_product_package UNIQUE (package_id),
    CONSTRAINT uq_commerce_product_slug UNIQUE (institute_id, slug),
    CONSTRAINT ck_commerce_product_stock_mode CHECK (stock_mode IN ('QUANTITY', 'PIECE')),
    CONSTRAINT ck_commerce_product_status CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED')),
    CONSTRAINT ck_commerce_product_qty_scale CHECK (qty_scale >= 1),
    CONSTRAINT ck_commerce_product_qty_step CHECK (qty_step >= 1)
);

-- One product per external reference per institute, so a repeated import updates.
CREATE UNIQUE INDEX IF NOT EXISTS uq_commerce_product_external_ref
    ON commerce_product (institute_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_commerce_product_institute_status
    ON commerce_product (institute_id, status);

CREATE TABLE IF NOT EXISTS commerce_product_translation (
    id                 VARCHAR(36)  PRIMARY KEY,
    institute_id       VARCHAR(36)  NOT NULL,
    package_id         VARCHAR(255) NOT NULL,
    locale             VARCHAR(16)  NOT NULL,
    name               VARCHAR(255) NOT NULL,
    short_description  TEXT,
    description_html   TEXT,
    content_blocks     JSONB,
    search_text        TEXT,
    created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_commerce_product_translation UNIQUE (package_id, locale)
);

CREATE INDEX IF NOT EXISTS idx_commerce_product_translation_institute
    ON commerce_product_translation (institute_id, package_id);

CREATE TABLE IF NOT EXISTS commerce_variant (
    id                  VARCHAR(36)  PRIMARY KEY,
    institute_id        VARCHAR(36)  NOT NULL,
    package_session_id  VARCHAR(255) NOT NULL,
    package_id          VARCHAR(255) NOT NULL,
    sku                 VARCHAR(100) NOT NULL,
    barcode             VARCHAR(100),
    label_code          VARCHAR(32),
    stock_policy        VARCHAR(32)  NOT NULL DEFAULT 'TRACKED',
    lead_time_days      INTEGER,
    weight_grams        INTEGER,
    length_mm           INTEGER,
    width_mm            INTEGER,
    height_mm           INTEGER,
    -- Unit cost per base unit: four decimals (PURCHASES_AND_ACCOUNTS.md section 13).
    cost_price          NUMERIC(14, 4),
    standard_cost       NUMERIC(14, 4),
    media_id            VARCHAR(255),
    position            INTEGER      NOT NULL DEFAULT 0,
    status              VARCHAR(32)  NOT NULL DEFAULT 'ACTIVE',
    external_ref        VARCHAR(255),
    created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_commerce_variant_package_session UNIQUE (package_session_id),
    CONSTRAINT uq_commerce_variant_sku UNIQUE (institute_id, sku),
    CONSTRAINT uq_commerce_variant_label_code UNIQUE (label_code),
    CONSTRAINT ck_commerce_variant_stock_policy CHECK (stock_policy IN ('TRACKED', 'UNTRACKED')),
    CONSTRAINT ck_commerce_variant_status CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_commerce_variant_barcode
    ON commerce_variant (institute_id, barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_commerce_variant_institute_package
    ON commerce_variant (institute_id, package_id);
CREATE INDEX IF NOT EXISTS idx_commerce_variant_external_ref
    ON commerce_variant (institute_id, external_ref) WHERE external_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS commerce_attribute (
    id             VARCHAR(36) PRIMARY KEY,
    institute_id   VARCHAR(36) NOT NULL,
    code           VARCHAR(64) NOT NULL,
    name_i18n      JSONB       NOT NULL,
    kind           VARCHAR(32) NOT NULL DEFAULT 'TEXT',
    is_filterable  BOOLEAN     NOT NULL DEFAULT FALSE,
    position       INTEGER     NOT NULL DEFAULT 0,
    created_at     TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_commerce_attribute_code UNIQUE (institute_id, code),
    CONSTRAINT ck_commerce_attribute_kind CHECK (kind IN ('TEXT', 'SWATCH', 'SIZE'))
);

CREATE TABLE IF NOT EXISTS commerce_attribute_value (
    id            VARCHAR(36) PRIMARY KEY,
    institute_id  VARCHAR(36) NOT NULL,
    attribute_id  VARCHAR(36) NOT NULL REFERENCES commerce_attribute (id),
    code          VARCHAR(64) NOT NULL,
    label_i18n    JSONB       NOT NULL,
    swatch_hex    VARCHAR(9),
    position      INTEGER     NOT NULL DEFAULT 0,
    created_at    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_commerce_attribute_value_code UNIQUE (attribute_id, code)
);

CREATE INDEX IF NOT EXISTS idx_commerce_attribute_value_institute
    ON commerce_attribute_value (institute_id, attribute_id);

CREATE TABLE IF NOT EXISTS commerce_product_attribute_value (
    id                  VARCHAR(36)  PRIMARY KEY,
    institute_id        VARCHAR(36)  NOT NULL,
    package_id          VARCHAR(255) NOT NULL,
    attribute_value_id  VARCHAR(36)  NOT NULL REFERENCES commerce_attribute_value (id),
    created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_commerce_product_attribute_value UNIQUE (package_id, attribute_value_id)
);

CREATE INDEX IF NOT EXISTS idx_commerce_product_attribute_value_value
    ON commerce_product_attribute_value (attribute_value_id);

CREATE TABLE IF NOT EXISTS commerce_product_option (
    id            VARCHAR(36)  PRIMARY KEY,
    institute_id  VARCHAR(36)  NOT NULL,
    package_id    VARCHAR(255) NOT NULL,
    attribute_id  VARCHAR(36)  NOT NULL REFERENCES commerce_attribute (id),
    position      INTEGER      NOT NULL DEFAULT 0,
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_commerce_product_option UNIQUE (package_id, attribute_id)
);

CREATE TABLE IF NOT EXISTS commerce_variant_option_value (
    id                  VARCHAR(36)  PRIMARY KEY,
    institute_id        VARCHAR(36)  NOT NULL,
    package_session_id  VARCHAR(255) NOT NULL,
    attribute_id        VARCHAR(36)  NOT NULL REFERENCES commerce_attribute (id),
    attribute_value_id  VARCHAR(36)  NOT NULL REFERENCES commerce_attribute_value (id),
    created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_commerce_variant_option_value UNIQUE (package_session_id, attribute_id)
);

CREATE INDEX IF NOT EXISTS idx_commerce_variant_option_value_value
    ON commerce_variant_option_value (attribute_value_id);

CREATE TABLE IF NOT EXISTS commerce_product_media (
    id                  VARCHAR(36)  PRIMARY KEY,
    institute_id        VARCHAR(36)  NOT NULL,
    package_id          VARCHAR(255) NOT NULL,
    package_session_id  VARCHAR(255),
    media_id            VARCHAR(255) NOT NULL,
    kind                VARCHAR(32)  NOT NULL DEFAULT 'IMAGE',
    tag                 VARCHAR(32),
    alt_i18n            JSONB,
    width               INTEGER,
    height              INTEGER,
    renditions_json     JSONB,
    position            INTEGER      NOT NULL DEFAULT 0,
    created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_commerce_product_media_kind CHECK (kind IN ('IMAGE', 'VIDEO'))
);

CREATE INDEX IF NOT EXISTS idx_commerce_product_media_package
    ON commerce_product_media (package_id, position);

CREATE TABLE IF NOT EXISTS commerce_collection (
    id                  VARCHAR(36)  PRIMARY KEY,
    institute_id        VARCHAR(36)  NOT NULL,
    parent_id           VARCHAR(36)  REFERENCES commerce_collection (id),
    kind                VARCHAR(32)  NOT NULL DEFAULT 'CATEGORY',
    slug                VARCHAR(255) NOT NULL,
    name_i18n           JSONB        NOT NULL,
    description_i18n    JSONB,
    media_id            VARCHAR(255),
    return_window_days  INTEGER,
    position            INTEGER      NOT NULL DEFAULT 0,
    status              VARCHAR(32)  NOT NULL DEFAULT 'ACTIVE',
    external_ref        VARCHAR(255),
    created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_commerce_collection_slug UNIQUE (institute_id, slug),
    CONSTRAINT ck_commerce_collection_kind CHECK (kind IN ('CATEGORY', 'COLLECTION')),
    CONSTRAINT ck_commerce_collection_status CHECK (status IN ('ACTIVE', 'ARCHIVED'))
);

CREATE INDEX IF NOT EXISTS idx_commerce_collection_parent
    ON commerce_collection (institute_id, parent_id);

CREATE TABLE IF NOT EXISTS commerce_product_collection (
    id             VARCHAR(36)  PRIMARY KEY,
    institute_id   VARCHAR(36)  NOT NULL,
    collection_id  VARCHAR(36)  NOT NULL REFERENCES commerce_collection (id),
    package_id     VARCHAR(255) NOT NULL,
    position       INTEGER      NOT NULL DEFAULT 0,
    created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_commerce_product_collection UNIQUE (collection_id, package_id)
);

CREATE INDEX IF NOT EXISTS idx_commerce_product_collection_package
    ON commerce_product_collection (package_id);
