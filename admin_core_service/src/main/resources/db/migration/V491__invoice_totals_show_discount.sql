-- Invoice PDFs show the whole sum, not just the final figure.
--
-- The seeded "Sample Invoice (PDF Layout)" prints
--
--     Subtotal: {{subtotal}}
--     Discount: {{discount_amount}}
--     Total:    {{total_amount}}
--
-- and both of the first two are wrong for a discounted order. {{subtotal}} means
-- pre-TAX (total / 1+rate), not pre-DISCOUNT, so a Rs 899 order that listed at
-- Rs 1,396 rendered "Subtotal 899 / Discount 497 / Total 899" -- arithmetic that
-- cannot be checked. {{discount_amount}} is also unconditional, so every
-- full-price invoice printed an empty "Discount:" line.
--
-- {{totals_rows}} is rendered by InvoiceService from the invoice's own figures
-- and drops the rows that do not apply:
--
--     Amount        Rs 1,396.00
--     Discount     -Rs   497.00
--     Total Paid    Rs   899.00
--
-- {{subtotal}} itself is deliberately NOT redefined: 12 of the 17 live invoice
-- templates pair it with {{tax_amount}} to show "Subtotal + Tax = Total", and
-- changing its meaning would silently break every one of them.
--
-- Scoped to the exact seeded markup, so a template someone has since laid out
-- differently is left alone. Re-running is a no-op.

UPDATE templates
SET content = REPLACE(
        content,
        'Subtotal: {{subtotal}}<br>Discount: {{discount_amount}}<br><strong style="font-size:15px;color:#124a34;">Total: {{total_amount}}</strong>',
        '{{totals_rows}}'
    ),
    updated_at = NOW()
WHERE type = 'INVOICE'
  AND content LIKE '%Subtotal: {{subtotal}}<br>Discount: {{discount_amount}}<br>%'
  AND content NOT LIKE '%{{totals_rows}}%';
