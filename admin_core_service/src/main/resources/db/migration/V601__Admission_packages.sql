-- Admission packages: several courses a learner is enrolled in together, with one schedule,
-- one discount and one admission receipt. Each course still has its own user_plan and fee
-- bills (the package's share of them); these tables only record that they belong together.
-- New tables only: nothing existing is altered.

CREATE TABLE IF NOT EXISTS admission_package (
    id VARCHAR(255) PRIMARY KEY,
    institute_id VARCHAR(255) NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    fee_total NUMERIC(14, 2) NOT NULL,
    discount_total NUMERIC(14, 2) NOT NULL DEFAULT 0,
    net_total NUMERIC(14, 2) NOT NULL,
    discount_reason TEXT NULL,
    -- The package schedule as entered (due date, amount, discount per installment).
    schedule_json TEXT NULL,
    created_by_user_id VARCHAR(255) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admission_package_user ON admission_package (user_id, institute_id);

CREATE TABLE IF NOT EXISTS admission_package_course (
    id VARCHAR(255) PRIMARY KEY,
    admission_package_id VARCHAR(255) NOT NULL REFERENCES admission_package (id),
    user_plan_id VARCHAR(255) NOT NULL,
    package_session_id VARCHAR(255) NULL,
    position INTEGER NOT NULL,
    fee NUMERIC(14, 2) NOT NULL,
    discount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admission_package_course_package ON admission_package_course (admission_package_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_admission_package_course_plan ON admission_package_course (user_plan_id);
