-- One payment the learner made can be stored as several payment_log rows, one per course it paid for:
-- an admission package payment split between its courses, a multi-course (cart) checkout. Every row of
-- such a payment carries the same payment_group_id, so screens can show and count it once while each
-- course keeps its own row for dues, plan activation and course-wise revenue.
--
-- NULL means the row is a payment on its own (every payment before this release, and every
-- single-course payment after it). Readers group by COALESCE(payment_group_id, id).
--
-- A product-page checkout also writes a planless parent row holding the gateway total; it carries the
-- group id too (its own id), and money reports skip it while course rows of the same group are paid
-- or voided, because those rows hold that money.

ALTER TABLE payment_log ADD COLUMN IF NOT EXISTS payment_group_id VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_payment_log_group
    ON payment_log (payment_group_id)
    WHERE payment_group_id IS NOT NULL;
