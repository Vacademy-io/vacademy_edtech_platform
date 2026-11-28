-- Breaks and holds (docs/ENROLMENT_BREAKS.md).
-- A HOLD stops reminders for a learner until a date; a PAUSE also stops billing and expiry and can
-- switch course access off, then moves the dates forward on resume.
-- New table only: nothing existing is altered, so no institute without a break row is affected.

CREATE TABLE IF NOT EXISTS enrolment_break (
    id VARCHAR(255) PRIMARY KEY,
    institute_id VARCHAR(255) NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    -- Null = every course of the learner at this institute.
    package_session_id VARCHAR(255) NULL,
    -- The membership whose billing pauses (PAUSE only).
    user_plan_id VARCHAR(255) NULL,
    kind VARCHAR(20) NOT NULL,                          -- HOLD | PAUSE
    stop_class_reminders BOOLEAN NOT NULL DEFAULT TRUE,
    stop_fee_reminders BOOLEAN NOT NULL DEFAULT TRUE,
    remove_access BOOLEAN NOT NULL DEFAULT FALSE,
    starts_on DATE NOT NULL,
    -- Null = until an admin resumes it.
    ends_on DATE NULL,
    status VARCHAR(20) NOT NULL,                        -- SCHEDULED | ACTIVE | ENDED | CANCELLED
    reason VARCHAR(100) NULL,
    note TEXT NULL,
    -- Access rows (student_session_institute_group_mapping ids) this break switched off, so the
    -- resume restores exactly those and nothing else.
    paused_access_ids TEXT NULL,
    started_at TIMESTAMP NULL,
    ended_at TIMESTAMP NULL,
    ended_by_user_id VARCHAR(255) NULL,
    end_kind VARCHAR(20) NULL,                          -- SCHEDULED | MANUAL | CANCELLED
    resume_mode VARCHAR(30) NULL,                       -- SHIFT_BY_PAUSED_DAYS | KEEP_DATES | NEW_DATE
    shifted_days INTEGER NULL,
    plan_end_before TIMESTAMP NULL,
    plan_end_after TIMESTAMP NULL,
    created_by_user_id VARCHAR(255) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_enrolment_break_institute_status ON enrolment_break (institute_id, status);
CREATE INDEX IF NOT EXISTS idx_enrolment_break_user ON enrolment_break (user_id, institute_id);
CREATE INDEX IF NOT EXISTS idx_enrolment_break_plan ON enrolment_break (user_plan_id);
CREATE INDEX IF NOT EXISTS idx_enrolment_break_status_dates ON enrolment_break (status, starts_on, ends_on);
