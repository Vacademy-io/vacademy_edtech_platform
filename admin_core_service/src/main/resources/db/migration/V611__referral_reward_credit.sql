-- ============================================================
-- V611: referral rewards that are spent on a LATER charge.
--
-- A referrer's discount is earned on someone else's enrolment but spent on the
-- referrer's own next renewal, possibly months later and possibly several times
-- over (one credit per successful referral, one credit per renewal). The rule
-- itself is an ordinary applied_coupon_discount row with discount_source =
-- 'REFERRAL_REWARD', so the charge rides the same rail as an admin discount: the
-- gateway amount, the negative payment_log_line_item, the invoice discount line.
--
-- Lifecycle:
--   PENDING   referee signed up but has not paid yet (a trial converts at its first real charge)
--   AVAILABLE referee converted; the next renewal of any of the referrer's plans may use it
--   RESERVED  a renewal charge picked it (user_plan_id = that plan); a dunning retry reuses it
--   CONSUMED  that renewal was confirmed PAID (consumed_payment_log_id)
--
-- The referee's own discount on a trial is NOT a credit: it is attached to the
-- referee's plan as applied_coupon_discount_id with apply_for_cycles = 1, which
-- the existing renewal discount path already applies to the first real charge.
--
-- No foreign keys on purpose: some environments (Vet Ed's own RDS) lost the primary
-- keys on older tables, and a REFERENCES to a column without one fails this migration
-- and with it the service's startup.
-- ============================================================

CREATE TABLE IF NOT EXISTS referral_reward_credit (
    id                          VARCHAR(255) PRIMARY KEY,
    institute_id                VARCHAR(255) NOT NULL,
    user_id                     VARCHAR(255) NOT NULL,
    beneficiary                 VARCHAR(50)  NOT NULL,
    referral_mapping_id         VARCHAR(255) NOT NULL,
    applied_coupon_discount_id  VARCHAR(255) NOT NULL,
    user_plan_id                VARCHAR(255),
    status                      VARCHAR(50)  NOT NULL,
    consumed_payment_log_id     VARCHAR(255),
    consumed_at                 TIMESTAMP,
    created_at                  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at                  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_referral_reward_credit_mapping UNIQUE (referral_mapping_id, beneficiary)
);

-- The renewal charge looks up the oldest usable credit of the member being charged.
CREATE INDEX IF NOT EXISTS idx_referral_reward_credit_user_status
    ON referral_reward_credit (user_id, institute_id, status, created_at);
