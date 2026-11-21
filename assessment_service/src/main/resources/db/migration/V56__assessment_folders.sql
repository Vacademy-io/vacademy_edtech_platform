-- Folders that group assessments for admins and learners, e.g. an English folder
-- holding every English test. One level is used today; parent_id keeps room for
-- nesting later. An assessment sits in at most one folder.

CREATE TABLE IF NOT EXISTS assessment_folder (
    id            VARCHAR(255) PRIMARY KEY,
    institute_id  VARCHAR(255) NOT NULL,
    parent_id     VARCHAR(255) NULL,
    name          VARCHAR(255) NOT NULL,
    description   TEXT NULL,
    image_url     TEXT NULL,
    display_order INTEGER NOT NULL DEFAULT 0,
    status        VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    created_by    VARCHAR(255) NULL,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_assessment_folder_institute
    ON assessment_folder (institute_id, status, display_order);

CREATE TABLE IF NOT EXISTS assessment_folder_mapping (
    id            VARCHAR(255) PRIMARY KEY,
    folder_id     VARCHAR(255) NOT NULL REFERENCES assessment_folder (id) ON DELETE CASCADE,
    assessment_id VARCHAR(255) NOT NULL,
    institute_id  VARCHAR(255) NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_assessment_folder_mapping_assessment UNIQUE (assessment_id)
);

CREATE INDEX IF NOT EXISTS idx_assessment_folder_mapping_folder
    ON assessment_folder_mapping (folder_id);
