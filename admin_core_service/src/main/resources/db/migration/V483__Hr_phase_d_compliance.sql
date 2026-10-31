-- HR & Payroll Phase D: India compliance pack.
-- TDS challans: deposits made against withheld TDS, mapped into Form 24Q.
-- Institute-level statutory identifiers (TAN, employer PAN, PF establishment
-- id, ESI employer code, PT registration) live in the existing
-- hr_tax_configuration.statutory_settings JSONB — documented keys:
--   deductor_name, deductor_address, employer_pan, tan,
--   pf_establishment_id, esi_employer_code, pt_registration_number
CREATE TABLE IF NOT EXISTS hr_tds_challan (
    id             VARCHAR(255) PRIMARY KEY,
    institute_id   VARCHAR(255) NOT NULL,
    financial_year VARCHAR(10) NOT NULL,          -- "2025-26"
    quarter        VARCHAR(2) NOT NULL,           -- Q1..Q4 (FY quarters: Q1=Apr-Jun)
    month          INT,                            -- optional: the salary month it covers
    year           INT,
    deposit_date   DATE NOT NULL,
    bsr_code       VARCHAR(10),
    challan_serial VARCHAR(10),
    amount         DECIMAL(15,2) NOT NULL,        -- TDS deposited
    interest       DECIMAL(15,2) DEFAULT 0,
    fee            DECIMAL(15,2) DEFAULT 0,
    notes          TEXT,
    created_by     VARCHAR(255),
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_hr_tds_challan_inst_fy ON hr_tds_challan(institute_id, financial_year, quarter);
