-- Which institutes may see which part of the Question Library.
--
-- The library belongs to one owner institute. Until now every other institute saw all of
-- it. Now the owner assigns a topic (usually a whole course such as UPSC or Class 10) to an
-- institute, and that institute sees only the topics it was given and everything below
-- them. An institute with no row here sees nothing.
--
-- institute_name is a copy of the name taken when the row is written, so the owner's list
-- of institutes does not need a call to admin_core for every row.

CREATE TABLE IF NOT EXISTS question_library_access (
    node_id        VARCHAR(255) NOT NULL REFERENCES question_library_node (id) ON DELETE CASCADE,
    institute_id   VARCHAR(255) NOT NULL,
    institute_name VARCHAR(255) NULL,
    created_by     VARCHAR(255) NULL,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_question_library_access PRIMARY KEY (node_id, institute_id)
);

CREATE INDEX IF NOT EXISTS idx_question_library_access_institute
    ON question_library_access (institute_id);
