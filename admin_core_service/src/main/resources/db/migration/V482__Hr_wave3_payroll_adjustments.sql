-- HR & Payroll Wave 3 (Phase C): variable-pay input.
-- One row per employee/month ad-hoc earning or deduction (bonus, incentive,
-- notice recovery, leave encashment, arrears...). Consumed by payroll
-- processing; the CRM-incentive and F&F flows both feed this table.
CREATE TABLE IF NOT EXISTS hr_payroll_adjustment (
    id             VARCHAR(255) PRIMARY KEY,
    institute_id   VARCHAR(255) NOT NULL,
    employee_id    VARCHAR(255) NOT NULL REFERENCES hr_employee_profile(id),
    month          INT NOT NULL,
    year           INT NOT NULL,
    type           VARCHAR(20) NOT NULL,          -- EARNING | DEDUCTION
    code           VARCHAR(30) NOT NULL,          -- component code it materializes under (e.g. BONUS, LEAVE_ENCASHMENT, NOTICE_RECOVERY)
    label          VARCHAR(100) NOT NULL,
    amount         DECIMAL(15,2) NOT NULL,
    currency       VARCHAR(3) NOT NULL DEFAULT 'INR',
    run_scope      VARCHAR(30) NOT NULL DEFAULT 'REGULAR',  -- which run type consumes it: REGULAR | OFF_CYCLE | FNF | BONUS
    source         VARCHAR(30) DEFAULT 'MANUAL',  -- MANUAL | FNF | CRM_INCENTIVE | SYSTEM
    notes          TEXT,
    payroll_entry_id VARCHAR(255),                -- set once consumed by a processed run
    created_by     VARCHAR(255),
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_hr_payroll_adjustment_period
    ON hr_payroll_adjustment(institute_id, year, month);
CREATE INDEX IF NOT EXISTS idx_hr_payroll_adjustment_employee
    ON hr_payroll_adjustment(employee_id, year, month);
CREATE INDEX IF NOT EXISTS idx_hr_payroll_adjustment_entry
    ON hr_payroll_adjustment(payroll_entry_id);
