-- ============================================================
-- V558: payment_log_line_item.amount int4 -> numeric(12,2).
--
-- Discount line items were rounded to whole currency units (a 10% discount of
-- 12.90 was stored as -13), so invoices showed the plan at 129.10 with a 13.00
-- discount instead of 129.00 and 12.90. Existing integer values convert exactly.
-- ============================================================

ALTER TABLE payment_log_line_item
    ALTER COLUMN amount TYPE NUMERIC(12, 2) USING amount::numeric;
