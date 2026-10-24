-- ============================================================
-- V557: admin discounts on ONE_TIME / SUBSCRIPTION payments (admin side only:
-- manual enroll, bulk assign, admin invoice). Learner checkout keeps using coupons.
--
-- An admin discount is just another applied_coupon_discount row with
-- discount_source = 'ADMIN' and no coupon_code_id, attached to the user_plan via
-- the existing applied_coupon_discount_id. That keeps the gateway amount, the
-- negative payment_log_line_item, the invoice discount line and the ledger
-- discount on the rail coupons already use.
--
-- granted_by_user_id is the admin who created the discount. user_plan carries its own
-- discount_granted_by_user_id because an admin can also apply an EXISTING coupon,
-- whose rule row is shared across every redemption and cannot hold "who applied it".
-- ============================================================

ALTER TABLE applied_coupon_discount
    ADD COLUMN IF NOT EXISTS granted_by_user_id            VARCHAR(255),
    ADD COLUMN IF NOT EXISTS granted_at                    TIMESTAMP,
    ADD COLUMN IF NOT EXISTS grant_reason                  TEXT,
    ADD COLUMN IF NOT EXISTS institute_id                  VARCHAR(255),
    -- NULL = every billing cycle (ADMIN rows only), 1 = first payment only, N = N charges
    ADD COLUMN IF NOT EXISTS apply_for_cycles              INTEGER;

ALTER TABLE user_plan
    ADD COLUMN IF NOT EXISTS discount_granted_by_user_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS discount_granted_at         TIMESTAMP,
    -- how many charges (first payment + renewals) the attached discount has reduced
    ADD COLUMN IF NOT EXISTS discount_cycles_applied     INTEGER NOT NULL DEFAULT 0;

ALTER TABLE invoice
    ADD COLUMN IF NOT EXISTS discount_granted_by_user_id VARCHAR(255);
