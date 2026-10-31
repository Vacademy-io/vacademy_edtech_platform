-- ============================================================
-- V585: regional (country-based) pricing for payment plans.
--
-- payment_option.regional_pricing_enabled is the master switch. When it is on, a
-- learner checkout price is looked up from payment_plan_regional_price by the
-- viewer country (Cloudflare CF-IPCountry header) instead of payment_plan.actual_price.
-- regional_pricing_currencies lists the currencies the system keeps an AUTO
-- (exchange-rate converted, rounded) row for on every plan of the option,
-- stored as comma-separated ISO-4217 codes such as USD,GBP,AED.
--
-- A regional row is either AUTO (recomputed from the base price and fx_rate) or
-- MANUAL (typed by an admin and never overwritten). A NULL country_code means
-- every country whose currency is this one. A row with a country_code wins over it.
--
-- user_plan.regional_price, regional_currency and regional_country lock the price
-- the learner bought at, so renewals, invoices and the ledger keep charging that
-- currency and amount even if the learner later travels or the admin edits prices.
--
-- Purely additive: new nullable columns, new columns with a FALSE default, new tables.
-- Every existing row keeps behaving exactly as before.
-- No string literals in this file. status and price_source are always written by
-- the application (RegionalPriceService), and uniqueness of one live row per
-- plan, currency and country is enforced there as well.
-- ============================================================

ALTER TABLE payment_option
    ADD COLUMN IF NOT EXISTS regional_pricing_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS regional_pricing_currencies TEXT;

CREATE TABLE IF NOT EXISTS payment_plan_regional_price (
    id                    VARCHAR(255)   PRIMARY KEY,
    payment_plan_id       VARCHAR(255)   NOT NULL REFERENCES payment_plan (id),
    currency              VARCHAR(3)     NOT NULL,
    country_code          VARCHAR(2),
    actual_price          NUMERIC(14, 2) NOT NULL,
    elevated_price        NUMERIC(14, 2),
    price_source          VARCHAR(10)    NOT NULL,
    base_price_at_compute NUMERIC(14, 2),
    base_currency         VARCHAR(3),
    fx_rate_used          NUMERIC(24, 10),
    computed_at           TIMESTAMP,
    needs_review          BOOLEAN        NOT NULL DEFAULT FALSE,
    status                VARCHAR(20)    NOT NULL,
    created_at            TIMESTAMP      DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP      DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pprp_plan
    ON payment_plan_regional_price (payment_plan_id);

-- Daily exchange rates, all quoted against USD (units of the currency per 1 USD).
CREATE TABLE IF NOT EXISTS fx_rate (
    currency      VARCHAR(3)      PRIMARY KEY,
    units_per_usd NUMERIC(24, 10) NOT NULL,
    source        VARCHAR(255),
    fetched_at    TIMESTAMP       NOT NULL
);

ALTER TABLE user_plan
    ADD COLUMN IF NOT EXISTS regional_price    NUMERIC(14, 2),
    ADD COLUMN IF NOT EXISTS regional_currency VARCHAR(3),
    ADD COLUMN IF NOT EXISTS regional_country  VARCHAR(2);
