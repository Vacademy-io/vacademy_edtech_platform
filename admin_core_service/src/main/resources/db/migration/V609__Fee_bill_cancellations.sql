-- Installments an admin stopped (a learner who dropped out or stopped paying): the bill itself
-- becomes CANCELLED with amount_expected cut to what was paid, as on course removal. This table
-- keeps what it was before, so the admin can reopen it if the learner comes back.
-- New table only: nothing existing is altered.

CREATE TABLE IF NOT EXISTS fee_bill_cancellation (
    id VARCHAR(255) PRIMARY KEY,
    -- Installments stopped together (one Stop dues) share it, and are reopened together.
    batch_id VARCHAR(255) NOT NULL,
    student_fee_payment_id VARCHAR(255) NOT NULL,
    user_plan_id VARCHAR(255) NULL,
    user_id VARCHAR(255) NULL,
    previous_status VARCHAR(50) NOT NULL,
    amount_expected_before NUMERIC(14, 2) NOT NULL,
    amount_paid NUMERIC(14, 2) NOT NULL DEFAULT 0,
    -- What the cancellation took off the learner's ledger; put back on reopen.
    ledger_reversed NUMERIC(14, 2) NOT NULL DEFAULT 0,
    reason TEXT NULL,
    cancelled_by_user_id VARCHAR(255) NULL,
    cancelled_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reopened_by_user_id VARCHAR(255) NULL,
    reopened_at TIMESTAMP NULL
);

CREATE INDEX IF NOT EXISTS idx_fee_bill_cancellation_bill ON fee_bill_cancellation (student_fee_payment_id);
CREATE INDEX IF NOT EXISTS idx_fee_bill_cancellation_plan ON fee_bill_cancellation (user_plan_id);
CREATE INDEX IF NOT EXISTS idx_fee_bill_cancellation_batch ON fee_bill_cancellation (batch_id);
