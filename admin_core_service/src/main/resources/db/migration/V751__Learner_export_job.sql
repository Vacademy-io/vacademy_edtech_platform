-- Background learner-list export. The job runs on one replica and is polled from any
-- replica, so its state lives here, not in memory. New table only.
CREATE TABLE IF NOT EXISTS learner_export_job (
    id VARCHAR(255) PRIMARY KEY,
    institute_id VARCHAR(255) NOT NULL,
    requested_by VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL,            -- QUEUED, RUNNING, COMPLETED, FAILED
    filter_json TEXT NOT NULL,
    processed_rows INTEGER NOT NULL DEFAULT 0,
    total_rows INTEGER,
    file_id VARCHAR(255),
    error_message TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_learner_export_job_requester
    ON learner_export_job (requested_by, created_at DESC);
