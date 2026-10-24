-- HR & Payroll Wave 2 (see docs/erp/hr-payroll-review-and-gap-plan.md, Phase B2/B3 + E1).

-- 1) Per-institute timezone for attendance day-bucketing (JVM stays UTC — repo rule).
ALTER TABLE hr_attendance_config ADD COLUMN IF NOT EXISTS timezone VARCHAR(60) NOT NULL DEFAULT 'Asia/Kolkata';

-- 2) Currency (E1): one currency per institute policy, stamped per record so
--    historical rows keep their currency across a future institute change.
ALTER TABLE hr_employee_salary_structure ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'INR';
ALTER TABLE hr_payroll_run              ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'INR';
ALTER TABLE hr_payroll_entry            ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'INR';
ALTER TABLE hr_payslip                  ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'INR';
ALTER TABLE hr_bank_export_log          ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'INR';
ALTER TABLE hr_employee_loan            ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'INR';
ALTER TABLE hr_reimbursement            ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'INR';

-- 3) Leave accrual ledger: one row per employee/leave-type/period. Replaces the
--    broken "accrued >= amount*month" idempotency heuristic — re-invoking accrual
--    for a period is now a no-op by unique constraint, and mid-year joiners
--    can't be double-credited. period_key: '2026-08' (monthly), '2026-Q3'
--    (quarterly), '2026' (yearly).
CREATE TABLE IF NOT EXISTS hr_leave_accrual_txn (
    id             VARCHAR(255) PRIMARY KEY,
    employee_id    VARCHAR(255) NOT NULL REFERENCES hr_employee_profile(id),
    leave_type_id  VARCHAR(255) NOT NULL REFERENCES hr_leave_type(id),
    policy_id      VARCHAR(255),
    year           INT NOT NULL,
    period_key     VARCHAR(20) NOT NULL,
    amount         DECIMAL(5,2) NOT NULL,
    source         VARCHAR(30) DEFAULT 'ACCRUAL',  -- ACCRUAL | PRO_RATA | CARRY_FORWARD
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (employee_id, leave_type_id, period_key)
);
CREATE INDEX IF NOT EXISTS idx_hr_leave_accrual_txn_emp_year ON hr_leave_accrual_txn(employee_id, year);
