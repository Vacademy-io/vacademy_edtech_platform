-- Report profiles: pages added before and after a student's report (static PDFs/images
-- or templates with live values such as a scholarship letter), defined per institute and
-- chosen per assessment. New tables only: no ALTER on existing tables.

CREATE TABLE IF NOT EXISTS assessment_report_profile (
    id                   VARCHAR(255) PRIMARY KEY,
    institute_id         VARCHAR(255) NOT NULL,
    name                 VARCHAR(255) NOT NULL,
    config_json          TEXT         NOT NULL,
    is_institute_default BOOLEAN      NOT NULL DEFAULT FALSE,
    status               VARCHAR(50)  NOT NULL DEFAULT 'ACTIVE',
    created_at           TIMESTAMP    NOT NULL DEFAULT now(),
    updated_at           TIMESTAMP    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_report_profile_institute ON assessment_report_profile (institute_id, status);

-- Which profile an assessment uses. No row = the institute default; profile_id 'NONE' = no
-- extra pages even when the institute has a default.
CREATE TABLE IF NOT EXISTS assessment_report_profile_link (
    assessment_id VARCHAR(255) PRIMARY KEY,
    profile_id    VARCHAR(255) NOT NULL,
    created_at    TIMESTAMP    NOT NULL DEFAULT now(),
    updated_at    TIMESTAMP    NOT NULL DEFAULT now()
);
