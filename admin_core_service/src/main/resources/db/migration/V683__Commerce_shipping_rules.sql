-- Commerce cart pricing (docs/commerce/ARCHITECTURE.md section 3.3 and 5, BUILD_PLAN WP-11).
-- New tables only: no existing table is altered.

-- The delivery charge of an institute. The shipping line of a cart is computed on the server
-- from the one ACTIVE row; a change archives the old row and inserts a new one, so an order
-- can name the rule it was priced with.
--   basis FLAT         tiers_json = [{"up_to": null, "charge": 80}]
--   basis ORDER_VALUE  up_to is the value of the goods after discounts, in rupees
--   basis WEIGHT       up_to is the weight of the cart in grams
-- A tier applies up to and including up_to; the last tier has up_to null (no upper end).
CREATE TABLE IF NOT EXISTS commerce_shipping_rule (
    id            VARCHAR(36)    PRIMARY KEY,
    institute_id  VARCHAR(36)    NOT NULL,
    basis         VARCHAR(32)    NOT NULL DEFAULT 'FLAT',
    tiers_json    JSONB          NOT NULL,
    free_above    NUMERIC(12, 2),
    cod_charge    NUMERIC(12, 2) NOT NULL DEFAULT 0,
    tax_class_id  VARCHAR(36),
    status        VARCHAR(32)    NOT NULL DEFAULT 'ACTIVE',
    created_by    VARCHAR(36),
    created_at    TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_commerce_shipping_rule_basis CHECK (basis IN ('FLAT', 'ORDER_VALUE', 'WEIGHT')),
    CONSTRAINT ck_commerce_shipping_rule_status CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    CONSTRAINT ck_commerce_shipping_rule_free_above CHECK (free_above IS NULL OR free_above >= 0),
    CONSTRAINT ck_commerce_shipping_rule_cod_charge CHECK (cod_charge >= 0)
);

-- Phase 1: one ACTIVE rule per institute.
CREATE UNIQUE INDEX IF NOT EXISTS uq_commerce_shipping_rule_active
    ON commerce_shipping_rule (institute_id) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_commerce_shipping_rule_institute
    ON commerce_shipping_rule (institute_id, created_at);

-- Pincode directory for the public pincode check: city and GST state code of a pincode.
-- Reference data shared by every institute, so it carries no institute_id. It starts empty;
-- until it is loaded the state comes from the first digits of the pincode and the city is unknown.
CREATE TABLE IF NOT EXISTS commerce_pincode (
    pincode     VARCHAR(6)   PRIMARY KEY,
    city        VARCHAR(100),
    district    VARCHAR(100),
    state_code  VARCHAR(8)   NOT NULL,
    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
