-- HR & Payroll Wave 1 hardening (see docs/erp/hr-payroll-review-and-gap-plan.md, Phase A + B1).

-- 1) Optimistic locking on financially sensitive tables (@Version).
ALTER TABLE hr_payroll_run              ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 0;
ALTER TABLE hr_payroll_entry            ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 0;
ALTER TABLE hr_leave_balance            ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 0;
ALTER TABLE hr_employee_loan            ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 0;
ALTER TABLE hr_employee_salary_structure ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 0;

-- 2) Payroll runs: a CANCELLED run must not block the month forever, and
--    off-cycle runs (FNF/BONUS/OFF_CYCLE, Phase C) need a type column now.
--    Replace the hard UNIQUE(institute_id, month, year) with a partial unique
--    index over non-cancelled REGULAR runs.
ALTER TABLE hr_payroll_run ADD COLUMN IF NOT EXISTS run_type VARCHAR(30) NOT NULL DEFAULT 'REGULAR';
ALTER TABLE hr_payroll_run DROP CONSTRAINT IF EXISTS hr_payroll_run_institute_id_month_year_key;
CREATE UNIQUE INDEX IF NOT EXISTS ux_hr_payroll_run_active_regular
    ON hr_payroll_run (institute_id, month, year)
    WHERE status <> 'CANCELLED' AND run_type = 'REGULAR';

-- 3) Per-employee processing errors: replaces the silent empty-catch in
--    PayrollCalculationService. One row per employee whose entry failed.
CREATE TABLE IF NOT EXISTS hr_payroll_entry_error (
    id             VARCHAR(255) PRIMARY KEY,
    payroll_run_id VARCHAR(255) NOT NULL REFERENCES hr_payroll_run(id),
    employee_id    VARCHAR(255) NOT NULL REFERENCES hr_employee_profile(id),
    error_stage    VARCHAR(50),
    error_message  TEXT,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_hr_payroll_entry_error_run ON hr_payroll_entry_error(payroll_run_id);

-- 4) Field-level encryption at rest (AES-256-GCM via EncryptedStringConverter,
--    "ENCv1:"-prefixed base64; legacy plaintext rows read through unchanged).
--    Widen the columns to hold ciphertext; statutory_info becomes TEXT because
--    ciphertext is not valid jsonb (nothing queries it in SQL).
ALTER TABLE hr_employee_bank_detail ALTER COLUMN account_number TYPE VARCHAR(512);
ALTER TABLE hr_employee_profile     ALTER COLUMN pan_number     TYPE VARCHAR(512);
ALTER TABLE hr_employee_profile     ALTER COLUMN uan_number     TYPE VARCHAR(512);
ALTER TABLE hr_employee_profile     ALTER COLUMN statutory_info TYPE TEXT USING statutory_info::text;

-- 5) hr_tax_computation duplicated on every reprocess (no unique, no cleanup).
--    Dedupe whatever exists, then enforce one row per employee per period.
DELETE FROM hr_tax_computation a
USING hr_tax_computation b
WHERE a.ctid < b.ctid
  AND a.employee_id = b.employee_id
  AND a.financial_year = b.financial_year
  AND a.month = b.month
  AND a.year = b.year;
ALTER TABLE hr_tax_computation
    ADD CONSTRAINT ux_hr_tax_computation_period UNIQUE (employee_id, financial_year, month, year);

-- 6) Missing indexes on hot lookups found in review.
CREATE INDEX IF NOT EXISTS idx_hr_loan_repayment_payroll_entry ON hr_loan_repayment(payroll_entry_id);
CREATE INDEX IF NOT EXISTS idx_hr_reimbursement_payroll_entry  ON hr_reimbursement(payroll_entry_id);
CREATE INDEX IF NOT EXISTS idx_hr_attendance_record_inst_date  ON hr_attendance_record(institute_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_hr_leave_application_applied_to ON hr_leave_application(applied_to);
CREATE INDEX IF NOT EXISTS idx_hr_salary_structure_emp_status  ON hr_employee_salary_structure(employee_id, status);
