-- Plan change (upgrade / downgrade)
--
-- A learner was previously locked to the payment_plan they bought at enrollment; the only
-- way to move them was cancel + re-enroll, which minted a NEW user_plan and lost history.
-- This migration adds:
--
--   1. Two admin opt-in flags gating which plans may be switched INTO. Both must be true
--      for a plan to be offered as a target: the option-level flag is the master switch,
--      the plan-level flag picks which intervals inside it participate.
--   2. user_plan_change_request -- the record of an in-flight or applied change. It exists
--      because a plan change is not atomic: an UPGRADE has to survive a gateway round trip
--      (PENDING_PAYMENT -> webhook -> APPLIED) and a DOWNGRADE is deliberately deferred to
--      the end of the paid cycle (SCHEDULED -> renewal -> APPLIED).
--
-- The user_plan row itself is never replaced -- same id, same package-session mappings --
-- which is what keeps payment history, invoices and the ledger continuous across a change.

ALTER TABLE payment_option
    ADD COLUMN IF NOT EXISTS plan_change_allowed BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN payment_option.plan_change_allowed IS
    'Master switch: members on another option of the same package session may switch INTO this option.';

ALTER TABLE payment_plan
    ADD COLUMN IF NOT EXISTS plan_change_allowed BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN payment_plan.plan_change_allowed IS
    'Members may switch TO this plan. Only honoured when the parent payment_option is also flagged.';

CREATE TABLE IF NOT EXISTS user_plan_change_request (
    id                     VARCHAR(255) PRIMARY KEY,
    user_plan_id           VARCHAR(255) NOT NULL REFERENCES user_plan (id),
    institute_id           VARCHAR(255) NOT NULL,

    -- from_* / to_* are a full audit record of the move. A cross-option change repoints
    -- the option AND the enroll invite (an option is reachable only through an invite),
    -- so without these columns an applied change is unreconstructable after the fact.
    from_plan_id           VARCHAR(255),
    to_plan_id             VARCHAR(255) NOT NULL,
    from_plan_json         TEXT,
    to_plan_json           TEXT,
    from_payment_option_id VARCHAR(255),
    to_payment_option_id   VARCHAR(255),
    from_enroll_invite_id  VARCHAR(255),
    to_enroll_invite_id    VARCHAR(255),

    direction              VARCHAR(20)  NOT NULL, -- UPGRADE | DOWNGRADE | LATERAL
    effective_type         VARCHAR(20)  NOT NULL, -- IMMEDIATE | END_OF_CYCLE
    status                 VARCHAR(30)  NOT NULL, -- PENDING_PAYMENT | SCHEDULED | APPLIED | FAILED | CANCELLED

    -- Proration on an upgrade: charge_amount = max(0, newPrice - proration_credit), where
    -- proration_credit is the unused value of the plan being left behind.
    proration_credit       NUMERIC(12, 2),
    charge_amount          NUMERIC(12, 2),
    currency               VARCHAR(10),

    -- payment_log.id of the upgrade charge. This is how the gateway webhook finds the
    -- request to apply -- the gateway only ever hands back the order id.
    payment_log_id         VARCHAR(255),

    -- END_OF_CYCLE only: the user_plan.end_date this change waits for.
    scheduled_for          TIMESTAMP,

    requested_by           VARCHAR(20)  NOT NULL, -- LEARNER | ADMIN | SYSTEM
    requested_by_user_id   VARCHAR(255),
    reason                 TEXT,
    applied_at             TIMESTAMP,
    created_at             TIMESTAMP DEFAULT NOW(),
    updated_at             TIMESTAMP DEFAULT NOW()
);

-- "Does this plan already have a change in flight?" -- checked on every change request and
-- on every membership listing.
CREATE INDEX IF NOT EXISTS idx_upcr_plan_status
    ON user_plan_change_request (user_plan_id, status);

-- Webhook lookup path: order id -> request.
CREATE INDEX IF NOT EXISTS idx_upcr_payment_log
    ON user_plan_change_request (payment_log_id);

-- Partial, like idx_user_plan_due_for_renewal: only SCHEDULED rows are ever swept.
CREATE INDEX IF NOT EXISTS idx_upcr_scheduled
    ON user_plan_change_request (scheduled_for)
    WHERE status = 'SCHEDULED';
