-- One-off charges: staff add a single extra charge to one learner.
-- The charge itself is an ordinary admin invoice (invoice.source = 'ADMIN_MANUAL'), so it is paid
-- online and shown in the fee screens like any other invoice; this table keeps what an invoice has
-- no place for (the batch, a staff note, where it came from).
-- New table only: nothing existing is altered, so no institute without a row here is affected.
-- No foreign key to invoice on purpose: deleting an invoice must keep working as before; a
-- missing invoice reads as a cancelled charge.

CREATE TABLE IF NOT EXISTS one_off_due (
    id VARCHAR(255) PRIMARY KEY,
    institute_id VARCHAR(255) NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    invoice_id VARCHAR(255) NULL,
    package_session_id VARCHAR(255) NULL,
    title VARCHAR(200) NOT NULL,
    note TEXT NULL,
    amount NUMERIC(12, 2) NOT NULL,
    currency VARCHAR(10) NULL,
    due_date DATE NOT NULL,
    source_type VARCHAR(40) NOT NULL,                   -- MANUAL | REENTRY_BRIDGE | ...
    source_id VARCHAR(255) NULL,
    created_by VARCHAR(255) NULL,
    cancelled_by VARCHAR(255) NULL,
    cancelled_at TIMESTAMP NULL,
    cancel_reason VARCHAR(500) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_one_off_due_user ON one_off_due (user_id, institute_id);
CREATE INDEX IF NOT EXISTS idx_one_off_due_source ON one_off_due (institute_id, source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_one_off_due_invoice ON one_off_due (invoice_id);
