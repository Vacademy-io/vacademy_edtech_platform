-- Payment-confirmation receipt shows what the order cost, not just what was taken.
--
-- A multi-course product-page checkout is recorded as one child PaymentLog per
-- course, and the confirmation email quoted whichever log it was sent from. A
-- parent who paid Rs 949 for four subjects therefore received four emails, each
-- announcing Rs 949/4 worth of a single course, and none of them matching their
-- bank statement. The code now sends ONE email carrying the ORDER's figures.
--
-- This adds the two rows that make the arithmetic visible above "Amount Paid":
--
--     4 courses            Rs 1,396.00
--     Discount            -Rs   497.00
--     Amount Paid          Rs   899.00
--
-- {{amount_breakdown_html}} carries the whole block and is EMPTY when nothing was
-- discounted, the same trick {{receipt_button}} already uses in this template --
-- placeholder substitution is a literal {{key}} replace with no conditionals, so
-- an unconditional "Discount" row would print a blank line on every ordinary
-- single-course receipt.
--
-- Matched on the receipt markup itself rather than on template_category: the
-- seeded row carries category 'NOTIFICATION' (the 'PAYMENT_CONFIRMATION' string
-- in V422 belongs to its notification_event_config, not to the template), so a
-- category filter would have matched nothing. The markup below is unique to this
-- receipt, and any institute that copied it gets the same improvement.
-- Re-running is a no-op.

UPDATE templates
SET content = REPLACE(
        content,
        '<tr class="amount-row"><td class="total-label">Amount Paid</td>',
        '{{amount_breakdown_html}}<tr class="amount-row"><td class="total-label">Amount Paid</td>'
    ),
    updated_at = NOW()
WHERE content LIKE '%<tr class="amount-row"><td class="total-label">Amount Paid</td>%'
  AND content NOT LIKE '%{{amount_breakdown_html}}%';
