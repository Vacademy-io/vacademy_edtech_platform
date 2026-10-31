-- Flexible installment schedules: an admin picks the number of installments and the gap
-- between them while enrolling a learner, instead of pre-building one fee plan per schedule.
-- See docs/CPO_FLEXIBLE_INSTALLMENTS.md. All additive; existing rows keep today's behaviour.

-- FIXED (default): bills come from the plan's aft_installments template, as before.
-- FLEXIBLE: the plan carries fee types and amounts only; the schedule is decided per learner.
ALTER TABLE complex_payment_option
    ADD COLUMN IF NOT EXISTS schedule_mode VARCHAR(20) NOT NULL DEFAULT 'FIXED';

-- Set only on system-built FLEXIBLE plans that back a one-time course price, so a learner
-- on that course can pay in installments. Such plans are hidden from fee-plan and
-- payment-option listings, and there is at most one per source plan.
ALTER TABLE complex_payment_option
    ADD COLUMN IF NOT EXISTS source_payment_plan_id VARCHAR(255) NULL;

ALTER TABLE complex_payment_option
    ADD CONSTRAINT fk_cpo_source_payment_plan
        FOREIGN KEY (source_payment_plan_id) REFERENCES payment_plan (id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cpo_source_payment_plan
    ON complex_payment_option (source_payment_plan_id)
    WHERE source_payment_plan_id IS NOT NULL;

-- Bills generated from a schedule have no aft_installments row (i_id is null), so they
-- carry their position here. Display only: reminders and dues views read it first and
-- fall back to the template's installment_number.
ALTER TABLE student_fee_payment
    ADD COLUMN IF NOT EXISTS installment_number INTEGER NULL;
