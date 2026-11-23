-- Folders that group question papers on the Question Banks and Papers page, e.g. a
-- "Class 10 Maths" folder. One level is used today; parent_id keeps room for subfolders
-- later. A paper sits in at most one folder of an institute.
--
-- No foreign key to question_paper, for the same reason V62 has none: the service checks
-- that every paper belongs to the institute before it writes a mapping. Deleting a folder
-- removes its mappings only; the papers stay and show under "Not in a folder".

CREATE TABLE IF NOT EXISTS question_paper_folder (
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

CREATE INDEX IF NOT EXISTS idx_question_paper_folder_institute
    ON question_paper_folder (institute_id, display_order);

CREATE TABLE IF NOT EXISTS question_paper_folder_mapping (
    id                VARCHAR(255) PRIMARY KEY,
    folder_id         VARCHAR(255) NOT NULL REFERENCES question_paper_folder (id) ON DELETE CASCADE,
    question_paper_id VARCHAR(255) NOT NULL,
    institute_id      VARCHAR(255) NOT NULL,
    display_order     INTEGER NOT NULL DEFAULT 0,
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_question_paper_folder_mapping_paper UNIQUE (institute_id, question_paper_id)
);

CREATE INDEX IF NOT EXISTS idx_question_paper_folder_mapping_folder
    ON question_paper_folder_mapping (folder_id);
