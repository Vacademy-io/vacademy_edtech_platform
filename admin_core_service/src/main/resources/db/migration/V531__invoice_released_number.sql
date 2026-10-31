-- Invoice numbers freed by a PERMANENT delete, so the next invoice in the same series takes them
-- back instead of leaving a hole in the sequence.
--
-- The counter is MAX(invoice.seq_no) + 1 per (institute, seq_scope_key). Deleting the newest
-- invoice already frees its number that way; deleting one from the middle leaves a gap MAX can
-- never see. Each hard delete (PaymentDeletionService) records the position it freed here, and
-- InvoiceNumberService hands out the lowest free recorded position in the current series before
-- counting on from MAX.
--
-- Only positions freed by a delete are ever reused. A plain "fill any gap" rule would also fill
-- gaps an admin created on purpose with the start-number floor (start at 100 after issuing 1-5).
--
-- seq_scope_key carries the series namespace ("PRO:<window>" for proformas), so a freed proforma
-- number can never come back as a tax invoice. A row stays after its position is re-issued; the
-- lookup skips positions an invoice holds again.

CREATE TABLE IF NOT EXISTS invoice_released_number (
    id             VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    institute_id   VARCHAR(255) NOT NULL,
    seq_scope_key  VARCHAR(32)  NOT NULL,
    seq_no         BIGINT       NOT NULL,
    invoice_number VARCHAR(100),
    released_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_released_number
    ON invoice_released_number (institute_id, seq_scope_key, seq_no);
