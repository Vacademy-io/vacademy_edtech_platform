-- Payment reminder schedule (FEE_REMINDER_SETTING): one row per reminder sent, so each step of a
-- membership's due date goes out once even with several replicas. New table only.
CREATE TABLE IF NOT EXISTS fee_reminder_log (
    id VARCHAR(255) PRIMARY KEY,
    institute_id VARCHAR(255) NOT NULL,
    user_plan_id VARCHAR(255) NOT NULL,
    due_date DATE NOT NULL,
    step VARCHAR(40) NOT NULL,          -- BEFORE_7, DUE, OVERDUE_4, RED_LIST ...
    sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_fee_reminder_step UNIQUE (user_plan_id, due_date, step)
);
CREATE INDEX IF NOT EXISTS idx_fee_reminder_log_institute ON fee_reminder_log (institute_id, sent_at);
