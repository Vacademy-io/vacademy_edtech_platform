-- Set Vacademy's supplier GSTIN on the singleton platform_payment_config row.
-- The state code MUST match the GSTIN prefix (23 = Madhya Pradesh): it is what
-- TaxResolver / PlatformInvoiceService compare against the buyer's state to
-- decide CGST+SGST (intra-state) vs IGST (inter-state).
--
-- Also stamps the GSTIN onto already-issued AI credit invoices that were
-- generated while it was NULL, so their on-demand PDFs print a valid tax
-- invoice (supplier identity is otherwise frozen at generation time).
--
-- Idempotent: safe to re-run; no-op when the row is missing.

UPDATE platform_payment_config
SET supplier_gstin      = '23AAYFV8247N1Z3',
    supplier_state_code = '23',
    updated_at          = CURRENT_TIMESTAMP
WHERE is_active = TRUE
  AND (supplier_gstin IS DISTINCT FROM '23AAYFV8247N1Z3'
       OR supplier_state_code IS DISTINCT FROM '23');

UPDATE platform_invoice
SET supplier_gstin      = '23AAYFV8247N1Z3',
    supplier_state_code = '23'
WHERE supplier_gstin IS NULL OR supplier_gstin = '';
