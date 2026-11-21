-- Phase F4: the ERP journal layer — the seed of the Accounting/GL module.
-- Payroll posts here on approval; fees and future accounting post into the
-- same pair, so cross-module P&L reads one table.

CREATE TABLE IF NOT EXISTS erp_journal_entry (
    id             VARCHAR(255) PRIMARY KEY,
    institute_id   VARCHAR(255) NOT NULL,
    entry_date     DATE NOT NULL,
    period_month   INT,
    period_year    INT,
    source_module  VARCHAR(50) NOT NULL,      -- HR_PAYROLL | FEES | MANUAL | ...
    source_id      VARCHAR(255),               -- e.g. payroll_run_id (idempotency key with module)
    reference      VARCHAR(255),
    memo           TEXT,
    currency       VARCHAR(3) NOT NULL DEFAULT 'INR',
    status         VARCHAR(20) NOT NULL DEFAULT 'POSTED',   -- POSTED | REVERSED
    reversal_of_entry_id VARCHAR(255),          -- set on the reversing entry
    total_debit    DECIMAL(18,2) NOT NULL DEFAULT 0,
    total_credit   DECIMAL(18,2) NOT NULL DEFAULT 0,
    created_by     VARCHAR(255),
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- One POSTED entry per source object (reversals reference, not collide).
CREATE UNIQUE INDEX IF NOT EXISTS ux_erp_journal_source
    ON erp_journal_entry (source_module, source_id)
    WHERE status = 'POSTED' AND reversal_of_entry_id IS NULL AND source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_erp_journal_inst_period
    ON erp_journal_entry (institute_id, period_year, period_month);

CREATE TABLE IF NOT EXISTS erp_journal_line (
    id               VARCHAR(255) PRIMARY KEY,
    journal_entry_id VARCHAR(255) NOT NULL REFERENCES erp_journal_entry(id),
    line_no          INT NOT NULL,
    gl_account_code  VARCHAR(50) NOT NULL,
    gl_account_name  VARCHAR(255),
    debit            DECIMAL(18,2) NOT NULL DEFAULT 0,
    credit           DECIMAL(18,2) NOT NULL DEFAULT 0,
    department_id    VARCHAR(255),               -- cost-center dimension
    employee_id      VARCHAR(255),               -- optional detail dimension
    notes            TEXT,
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_erp_journal_line_entry ON erp_journal_line (journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_erp_journal_line_account ON erp_journal_line (gl_account_code);

-- Component -> GL account mapping (institutes may override per component;
-- unmapped components fall to type-based defaults in JournalService).
ALTER TABLE hr_salary_component ADD COLUMN IF NOT EXISTS gl_account_code VARCHAR(50);
