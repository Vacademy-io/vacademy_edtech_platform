-- ============================================================================
-- V590: AI plan payments, GST documents and the storefront (schema only)
--
-- Everything here is additive and inert until the billing flags are turned on
-- (billing.subscriptions.payments.enabled, billing.autopay.enabled,
-- billing.storefront.mode, billing.invoice.series_v2.enabled: all default off):
--   * NEW admin_core tables (VARCHAR ids, assigned by Hibernate, like V244):
--       platform_billing_profile   the buyer's GST identity for platform bills
--                                  (institutes.gstin / state_code are never
--                                  written again)
--       platform_document_sequence per-financial-year counters for the v2
--                                  series VT/{FY}/I##### and VT/{FY}/C#####
--       platform_credit_note       GST credit note per refund
--   * NEW ai_service tables (UUID ids, like V588):
--       ai_subscription_mandate    UPI Autopay / card / e-mandate token on the
--                                  platform Razorpay account
--       ai_subscription_charge     every amount owed by a PAYMENT subscription
--       ai_institute_segment       hand-filled institute -> segment keys
--       ai_storefront_audience     who may see the storefront / a plan
--       ai_storefront_institute    super-admin per-institute switches
--   * NEW nullable / defaulted columns on ai_billing_feature, ai_plan,
--     platform_payment_config, platform_invoice, platform_payment_item and
--     platform_payment, plus institute_ai_subscription.status widened to
--     VARCHAR(16) (adds PENDING).
--   * platform_payment_item.pack_id becomes nullable, guarded by a CHECK that
--     a CREDIT_PACK item still needs a pack.
--   * partial UNIQUE on platform_payment.vendor_payment_id (prod had no
--     duplicates on 2026-10-16; see the guarded block at the end).
--
-- Existing rows: every new column is NULL or a constant default that keeps the
-- current behaviour (item_kind CREDIT_PACK, disposition NORMAL, source_kind
-- CREDIT_PACK, ai_plan.listed FALSE). No row is rewritten.
--
-- Vocabularies (no CHECK on the ai_* enum-like columns, like V586-V588; they
-- are validated in ai_service metering/billing_models.py; the platform_* ones
-- by the Java enums):
--   charge kind           PERIOD | UPGRADE
--   charge status         DUE | LINK_SENT | DEBIT_SCHEDULED | PAID | FAILED | VOID |
--                         REFUNDED | PARTIALLY_REFUNDED
--   mandate method        UPI | CARD | EMANDATE
--   mandate status        PENDING | ACTIVE | PAUSED | CANCELLED | REJECTED | EXPIRED
--   audience_mode         ALL | ALLOWLIST | SEGMENT      audience rule  INCLUDE | EXCLUDE
--   brand mode            VACADEMY | NEUTRAL             tax_head       CGST_SGST | IGST | EXPORT
--   item_kind             CREDIT_PACK | AI_SUBSCRIPTION  disposition    NORMAL | DUPLICATE | LATE
--   sub status            + PENDING (checkout created, first charge not paid; never live)
--
-- Lock discipline: small / new tables first, the ALTERs of the hot billing
-- tables last; every statement waits at most 5 s for a lock.
-- ============================================================================
SET LOCAL lock_timeout = '5s';

-- ── admin_core: buyer billing identity ────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_billing_profile (
    institute_id   VARCHAR(255) PRIMARY KEY,
    legal_name     VARCHAR(255),
    gstin          VARCHAR(15),
    state_code     VARCHAR(2),
    address        TEXT,
    billing_email  VARCHAR(255),
    updated_by     VARCHAR(255),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_pbp_gstin_format CHECK (gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
    CONSTRAINT ck_pbp_state_format CHECK (state_code IS NULL OR state_code ~ '^[0-9]{2}$'),
    CONSTRAINT ck_pbp_gstin_state CHECK (gstin IS NULL OR state_code IS NULL OR substr(gstin, 1, 2) = state_code)
);

-- ── admin_core: document number counters (v2 series) ──────────────────────
-- series_key 'I' = tax invoice, 'C' = credit note; fy '2627' = 1 Apr 2026 ..
-- 31 Mar 2027 in Asia/Kolkata. next_no = the next number to hand out; allocate
-- in the document's own transaction with
--   INSERT ... VALUES (:k, :fy, 2) ON CONFLICT (series_key, fy)
--   DO UPDATE SET next_no = platform_document_sequence.next_no + 1 RETURNING next_no - 1
CREATE TABLE IF NOT EXISTS platform_document_sequence (
    series_key  VARCHAR(8) NOT NULL,
    fy          VARCHAR(4) NOT NULL,
    next_no     INT NOT NULL DEFAULT 1,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (series_key, fy),
    CONSTRAINT ck_pds_next_no CHECK (next_no >= 1),
    CONSTRAINT ck_pds_fy CHECK (fy ~ '^[0-9]{4}$')
);

-- ── admin_core: GST credit notes (one per refund; snapshot like platform_invoice) ──
CREATE TABLE IF NOT EXISTS platform_credit_note (
    id                    VARCHAR(255) PRIMARY KEY,
    credit_note_number    VARCHAR(16) NOT NULL UNIQUE,
    series_key            VARCHAR(8) NOT NULL DEFAULT 'C',
    fy                    VARCHAR(4) NOT NULL,
    invoice_id            VARCHAR(255) NOT NULL REFERENCES platform_invoice(id),
    invoice_number        VARCHAR(64) NOT NULL,
    invoice_issued_at     TIMESTAMPTZ NOT NULL,
    platform_payment_id   VARCHAR(255) NOT NULL,
    vendor_refund_id      VARCHAR(64),
    item_kind             VARCHAR(16) NOT NULL DEFAULT 'CREDIT_PACK',
    brand_mode            VARCHAR(10),
    reason                VARCHAR(255) NOT NULL,
    supplier_legal_name   VARCHAR(255) NOT NULL,
    supplier_gstin        VARCHAR(15),
    supplier_state_code   VARCHAR(2) NOT NULL,
    supplier_address      TEXT NOT NULL,
    buyer_institute_id    VARCHAR(255) NOT NULL,
    buyer_legal_name      VARCHAR(255) NOT NULL,
    buyer_gstin           VARCHAR(15),
    buyer_state_code      VARCHAR(2),
    buyer_address         TEXT,
    place_of_supply       VARCHAR(2) NOT NULL,
    tax_head              VARCHAR(12) NOT NULL,
    currency              VARCHAR(3) NOT NULL,
    description           VARCHAR(255) NOT NULL,
    hsn_sac_code          VARCHAR(8) NOT NULL,
    base_amount_minor     BIGINT NOT NULL,
    cgst_rate_bps         INT NOT NULL DEFAULT 0,
    cgst_amount_minor     BIGINT NOT NULL DEFAULT 0,
    sgst_rate_bps         INT NOT NULL DEFAULT 0,
    sgst_amount_minor     BIGINT NOT NULL DEFAULT 0,
    igst_rate_bps         INT NOT NULL DEFAULT 0,
    igst_amount_minor     BIGINT NOT NULL DEFAULT 0,
    total_amount_minor    BIGINT NOT NULL,
    pdf_s3_url            TEXT,
    created_by            VARCHAR(255),
    issued_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_pcn_amounts CHECK (base_amount_minor >= 0 AND cgst_amount_minor >= 0 AND sgst_amount_minor >= 0
                                     AND igst_amount_minor >= 0 AND total_amount_minor > 0),
    CONSTRAINT ck_pcn_total CHECK (total_amount_minor = base_amount_minor + cgst_amount_minor + sgst_amount_minor
                                   + igst_amount_minor),
    CONSTRAINT ck_pcn_number_len CHECK (length(credit_note_number) <= 16)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_pcn_vendor_refund ON platform_credit_note (vendor_refund_id)
    WHERE vendor_refund_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_pcn_invoice ON platform_credit_note (invoice_id);
CREATE INDEX IF NOT EXISTS ix_pcn_buyer ON platform_credit_note (buyer_institute_id, issued_at);

-- ── ai_service: storefront audience and per-institute switches ────────────
CREATE TABLE IF NOT EXISTS ai_institute_segment (
    institute_id  VARCHAR(64) NOT NULL,
    segment_key   VARCHAR(48) NOT NULL,
    created_by    VARCHAR(255) NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (institute_id, segment_key)
);
CREATE INDEX IF NOT EXISTS ix_ais_segment ON ai_institute_segment (segment_key);

-- plan_id NULL = access to the storefront itself (billing.storefront.mode
-- ALLOWLIST / SEGMENTS); plan_id set = who sees that plan (ai_plan.audience_mode
-- ALLOWLIST / SEGMENT). EXCLUDE rows always win over INCLUDE rows.
CREATE TABLE IF NOT EXISTS ai_storefront_audience (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id       UUID REFERENCES ai_plan(id),
    rule          VARCHAR(8) NOT NULL DEFAULT 'INCLUDE',
    institute_id  VARCHAR(64),
    segment_key   VARCHAR(48),
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    reason        TEXT,
    created_by    VARCHAR(255) NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_asa_target CHECK ((institute_id IS NULL) <> (segment_key IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_asa_rule ON ai_storefront_audience
    (COALESCE(CAST(plan_id AS TEXT), ''), rule, COALESCE(institute_id, ''), COALESCE(segment_key, ''))
    WHERE is_active;
CREATE INDEX IF NOT EXISTS ix_asa_institute ON ai_storefront_audience (institute_id);

-- Super-admin written only (tenants never write it). storefront_enabled:
-- NULL = the rollout mode decides, TRUE = on (allow-listed), FALSE = off
-- whatever the mode. brand_mode_override NULL = resolve from the admin domain.
CREATE TABLE IF NOT EXISTS ai_storefront_institute (
    institute_id         VARCHAR(64) PRIMARY KEY,
    brand_mode_override  VARCHAR(10),
    storefront_enabled   BOOLEAN,
    reason               TEXT,
    updated_by           VARCHAR(255),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── ai_service: autopay mandates (Razorpay recurring tokens) ──────────────
CREATE TABLE IF NOT EXISTS ai_subscription_mandate (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institute_id           VARCHAR(64) NOT NULL,
    subscription_id        UUID REFERENCES institute_ai_subscription(id),
    razorpay_customer_id   VARCHAR(64),
    token_id               VARCHAR(64),
    method                 VARCHAR(10),
    max_amount_minor       BIGINT,
    frequency              VARCHAR(16),
    status                 VARCHAR(12) NOT NULL DEFAULT 'PENDING',
    registration_link_id   VARCHAR(64),
    registration_link_url  TEXT,
    auth_order_id          VARCHAR(64),
    auth_payment_id        VARCHAR(64),
    token_expires_at       TIMESTAMPTZ,
    failure_reason         VARCHAR(255),
    cancelled_at           TIMESTAMPTZ,
    -- created_at of the newest Razorpay token.* webhook applied: an older (late or
    -- retried) event is dropped, so it can never undo a newer pause / cancel
    last_event_at          TIMESTAMPTZ,
    created_by             VARCHAR(255),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_asm_max_amount CHECK (max_amount_minor IS NULL OR max_amount_minor > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_asm_token ON ai_subscription_mandate (token_id)
    WHERE token_id IS NOT NULL;
-- at most one usable token per subscription
CREATE UNIQUE INDEX IF NOT EXISTS ux_asm_usable ON ai_subscription_mandate (subscription_id)
    WHERE status IN ('ACTIVE','PAUSED');
CREATE INDEX IF NOT EXISTS ix_asm_inst ON ai_subscription_mandate (institute_id, created_at);
CREATE INDEX IF NOT EXISTS ix_asm_customer ON ai_subscription_mandate (razorpay_customer_id);
CREATE INDEX IF NOT EXISTS ix_asm_order ON ai_subscription_mandate (auth_order_id)
    WHERE auth_order_id IS NOT NULL;

-- ── ai_service: every amount owed by a PAYMENT subscription ───────────────
-- period_id stays NULL until the charge is paid (critique #4: no period is
-- pre-created at T-7). tax_minor / total_minor / place_of_supply / tax_head are
-- the server-side snapshot written by admin_core when it prices the charge;
-- /paid compares the paid amount with total_minor. Inclusive prices:
-- tax_minor = total_minor - base_minor.
CREATE TABLE IF NOT EXISTS ai_subscription_charge (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id           UUID NOT NULL REFERENCES institute_ai_subscription(id),
    institute_id              VARCHAR(64) NOT NULL,
    kind                      VARCHAR(8) NOT NULL,
    status                    VARCHAR(20) NOT NULL DEFAULT 'DUE',
    service_start             TIMESTAMPTZ NOT NULL,
    service_end               TIMESTAMPTZ NOT NULL,
    plan_version_id           UUID NOT NULL REFERENCES ai_plan_version(id),
    from_plan_version_id      UUID,
    currency                  VARCHAR(3) NOT NULL DEFAULT 'INR',
    is_tax_inclusive          BOOLEAN NOT NULL DEFAULT FALSE,
    sac_code                  VARCHAR(16),
    description               VARCHAR(255),
    base_minor                BIGINT NOT NULL,
    tax_minor                 BIGINT,
    total_minor               BIGINT,
    place_of_supply           VARCHAR(2),
    tax_head                  VARCHAR(12),
    quote_json                JSONB,
    idempotency_key           VARCHAR(64),
    platform_payment_id       VARCHAR(255),
    vendor_payment_id         VARCHAR(64),
    payment_link_id           VARCHAR(64),
    payment_link_url          TEXT,
    link_expires_at           TIMESTAMPTZ,
    mandate_id                UUID REFERENCES ai_subscription_mandate(id),
    debit_attempts            INT NOT NULL DEFAULT 0,
    next_attempt_at           TIMESTAMPTZ,
    pre_debit_notice_sent_at  TIMESTAMPTZ,
    period_id                 UUID REFERENCES ai_subscription_period(id),
    paid_minor                BIGINT,
    paid_at                   TIMESTAMPTZ,
    refunded_minor            BIGINT NOT NULL DEFAULT 0,
    void_reason               VARCHAR(64),
    last_error                VARCHAR(255),
    created_by                VARCHAR(255),
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_asc_currency CHECK (currency = 'INR'),
    CONSTRAINT ck_asc_window CHECK (service_end > service_start),
    CONSTRAINT ck_asc_amounts CHECK (base_minor >= 0 AND (tax_minor IS NULL OR tax_minor >= 0)
                                     AND (total_minor IS NULL OR total_minor >= 0)),
    CONSTRAINT ck_asc_total CHECK (total_minor IS NULL OR tax_minor IS NULL OR total_minor = base_minor + tax_minor),
    CONSTRAINT ck_asc_refund CHECK (refunded_minor >= 0 AND (paid_minor IS NULL OR refunded_minor <= paid_minor)),
    CONSTRAINT ck_asc_attempts CHECK (debit_attempts >= 0)
);
-- one live PERIOD charge per (subscription, service start), even while
-- period_id is NULL (critique #5); a FAILED charge must be VOIDed before a
-- replacement for the same period is created
CREATE UNIQUE INDEX IF NOT EXISTS ux_asc_period ON ai_subscription_charge (subscription_id, service_start)
    WHERE kind = 'PERIOD' AND status <> 'VOID';
-- at most one open (still owed) upgrade per subscription
CREATE UNIQUE INDEX IF NOT EXISTS ux_asc_open_upgrade ON ai_subscription_charge (subscription_id)
    WHERE kind = 'UPGRADE' AND status IN ('DUE','LINK_SENT','DEBIT_SCHEDULED','FAILED');
CREATE UNIQUE INDEX IF NOT EXISTS ux_asc_vendor ON ai_subscription_charge (vendor_payment_id)
    WHERE vendor_payment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_asc_idem ON ai_subscription_charge (institute_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_asc_collect ON ai_subscription_charge (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS ix_asc_sub ON ai_subscription_charge (subscription_id, service_start);
CREATE INDEX IF NOT EXISTS ix_asc_payment ON ai_subscription_charge (platform_payment_id)
    WHERE platform_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_asc_link ON ai_subscription_charge (payment_link_id)
    WHERE payment_link_id IS NOT NULL;

-- ── small tables: tenant label, plan listing, document identity ───────────
-- tenant-facing feature label (NULL = label); fixes "Vacademy Assistant" (F13)
ALTER TABLE ai_billing_feature ADD COLUMN IF NOT EXISTS tenant_label VARCHAR(128);
UPDATE ai_billing_feature
SET tenant_label = 'Admin AI assistant'
WHERE feature_key = 'admin_assistant'
  AND tenant_label IS NULL;

-- owner default 2026-10-16: new plan versions carry SAC 998315 (V588 had 998313;
-- existing versions keep theirs: published terms are frozen)
ALTER TABLE ai_plan_version ALTER COLUMN sac_code SET DEFAULT '998315';

-- storefront listing (ai_plan is not frozen; ai_plan_version is, V588)
ALTER TABLE ai_plan
    ADD COLUMN IF NOT EXISTS listed              BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS tagline             VARCHAR(160),
    ADD COLUMN IF NOT EXISTS highlights          JSONB,
    ADD COLUMN IF NOT EXISTS badge               VARCHAR(32),
    ADD COLUMN IF NOT EXISTS sort_order          INT NOT NULL DEFAULT 100,
    ADD COLUMN IF NOT EXISTS audience_mode       VARCHAR(10) NOT NULL DEFAULT 'ALLOWLIST',
    ADD COLUMN IF NOT EXISTS listing_updated_by  VARCHAR(255),
    ADD COLUMN IF NOT EXISTS listing_updated_at  TIMESTAMPTZ;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_ai_plan_highlights_array') THEN
        ALTER TABLE ai_plan ADD CONSTRAINT ck_ai_plan_highlights_array
            CHECK (highlights IS NULL OR jsonb_typeof(highlights) = 'array');
    END IF;
END $$;

-- brand identity for documents (singleton row). VACADEMY brand mode shows
-- trade_name + brand_logo_url next to the legal supplier; NEUTRAL shows the
-- legal supplier only and uses neutral_display_name where a short name is needed.
ALTER TABLE platform_payment_config
    ADD COLUMN IF NOT EXISTS trade_name             VARCHAR(120) NOT NULL DEFAULT 'Vacademy',
    ADD COLUMN IF NOT EXISTS brand_logo_url         TEXT,
    ADD COLUMN IF NOT EXISTS neutral_display_name   VARCHAR(120) NOT NULL DEFAULT 'Vidyayatan Technologies',
    ADD COLUMN IF NOT EXISTS billing_support_email  VARCHAR(255),
    ADD COLUMN IF NOT EXISTS billing_from_name      VARCHAR(120),
    ADD COLUMN IF NOT EXISTS billing_from_email     VARCHAR(255);

-- invoices: item kind, v2 series, service period, instant of issue, brand
ALTER TABLE platform_invoice
    ADD COLUMN IF NOT EXISTS source_kind           VARCHAR(16) NOT NULL DEFAULT 'CREDIT_PACK',
    ADD COLUMN IF NOT EXISTS series_key            VARCHAR(8),
    ADD COLUMN IF NOT EXISTS fy                    VARCHAR(4),
    ADD COLUMN IF NOT EXISTS service_period_start  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS service_period_end    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS issued_at_tz          TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS brand_mode            VARCHAR(10);

-- ── hot billing tables last ───────────────────────────────────────────────
-- pack-less items (AI_SUBSCRIPTION). pack_code_snapshot / credits stay NOT NULL:
-- a subscription item writes 'AI_SUB:<plan_key>' and 0.
ALTER TABLE platform_payment_item ALTER COLUMN pack_id DROP NOT NULL;
ALTER TABLE platform_payment_item
    ADD COLUMN IF NOT EXISTS item_kind               VARCHAR(16) NOT NULL DEFAULT 'CREDIT_PACK',
    ADD COLUMN IF NOT EXISTS subscription_charge_id  VARCHAR(36),
    ADD COLUMN IF NOT EXISTS description_snapshot    VARCHAR(255),
    ADD COLUMN IF NOT EXISTS service_period_start    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS service_period_end      TIMESTAMPTZ;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_ppi_pack_required') THEN
        ALTER TABLE platform_payment_item ADD CONSTRAINT ck_ppi_pack_required
            CHECK (item_kind <> 'CREDIT_PACK' OR pack_id IS NOT NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_ppi_item_kind') THEN
        ALTER TABLE platform_payment_item ADD CONSTRAINT ck_ppi_item_kind
            CHECK (item_kind IN ('CREDIT_PACK', 'AI_SUBSCRIPTION'));
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_ppi_subscription_charge ON platform_payment_item (subscription_charge_id)
    WHERE subscription_charge_id IS NOT NULL;

-- buyer identity + tax snapshot taken at order time (critique #2); the invoice
-- and credit note read only this snapshot. The amounts snapshot is the existing
-- base_amount_minor / tax_amount_minor / total_amount_minor.
ALTER TABLE platform_payment
    ADD COLUMN IF NOT EXISTS buyer_legal_name       VARCHAR(255),
    ADD COLUMN IF NOT EXISTS buyer_gstin            VARCHAR(15),
    ADD COLUMN IF NOT EXISTS buyer_state_code       VARCHAR(2),
    ADD COLUMN IF NOT EXISTS buyer_address          TEXT,
    ADD COLUMN IF NOT EXISTS place_of_supply        VARCHAR(2),
    ADD COLUMN IF NOT EXISTS tax_head               VARCHAR(12),
    ADD COLUMN IF NOT EXISTS brand_mode             VARCHAR(10),
    ADD COLUMN IF NOT EXISTS disposition            VARCHAR(12) NOT NULL DEFAULT 'NORMAL',
    ADD COLUMN IF NOT EXISTS refund_requested_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS refunded_amount_minor  BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS link_expires_at        TIMESTAMPTZ,
    -- when the row became PAID (updated_at is never written after INSERT): the
    -- invoice reconcile measures its grace from here
    ADD COLUMN IF NOT EXISTS paid_at                TIMESTAMPTZ;

-- One platform_payment per Razorpay payment id (critique #7). Prod had 7
-- non-NULL ids and no duplicate on 2026-10-16. Should a duplicate appear before
-- this runs, the index is built WITHOUT those ids (and a WARNING names them) so
-- boot never fails; the ids must then be cleaned up and the index rebuilt.
DO $$
DECLARE
    v_dups TEXT;
BEGIN
    IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ux_platform_payment_vendor_payment') THEN
        RETURN;
    END IF;
    SELECT string_agg(quote_literal(vendor_payment_id), ', ' ORDER BY vendor_payment_id) INTO v_dups
    FROM (SELECT vendor_payment_id FROM platform_payment
          WHERE vendor_payment_id IS NOT NULL
          GROUP BY vendor_payment_id HAVING count(*) > 1) d;
    IF v_dups IS NULL THEN
        EXECUTE 'CREATE UNIQUE INDEX ux_platform_payment_vendor_payment ON platform_payment (vendor_payment_id) '
             || 'WHERE vendor_payment_id IS NOT NULL';
    ELSE
        RAISE WARNING 'V590: duplicate platform_payment.vendor_payment_id values %, excluded from ux_platform_payment_vendor_payment', v_dups;
        EXECUTE 'CREATE UNIQUE INDEX ux_platform_payment_vendor_payment ON platform_payment (vendor_payment_id) '
             || 'WHERE vendor_payment_id IS NOT NULL AND vendor_payment_id NOT IN (' || v_dups || ')';
    END IF;
END $$;

-- subscription status: VARCHAR(12) -> VARCHAR(16) (no rewrite; 0 rows on prod
-- 2026-10-16) and at most one PENDING checkout per institute.
ALTER TABLE institute_ai_subscription ALTER COLUMN status TYPE VARCHAR(16);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ias_pending ON institute_ai_subscription (institute_id)
    WHERE status = 'PENDING';
