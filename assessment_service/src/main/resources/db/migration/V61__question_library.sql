-- Question Library: an institute's questions organised by topic.
--
-- question_library_node is a free-form tree (Subject > Chapter > Topic, or whatever
-- shape the institute uses), at most 4 levels deep, enforced in the service.
-- question_library_mapping places a question under one or more nodes. A question can
-- sit in several topics, and deleting a node never deletes a question: its questions
-- just go back to "Unsorted".
--
-- question_library_version records "old question was replaced by new question". When
-- a question that is already used by an assessment is edited from the library, the
-- edit is saved as a NEW question row, so tests that were already taken keep exactly
-- the question their students saw. The old row is hidden from the library and the
-- question-bank pickers through this table.
--
-- No foreign key to question: question is a hot table during live exams, and adding
-- an FK that points at it takes a lock on it. The service checks every question id
-- against the institute before writing a mapping.

CREATE TABLE IF NOT EXISTS question_library_node (
    id            VARCHAR(255) PRIMARY KEY,
    institute_id  VARCHAR(255) NOT NULL,
    parent_id     VARCHAR(255) NULL REFERENCES question_library_node (id) ON DELETE CASCADE,
    name          VARCHAR(255) NOT NULL,
    description   TEXT NULL,
    display_order INTEGER NOT NULL DEFAULT 0,
    status        VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    created_by    VARCHAR(255) NULL,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_question_library_node_institute
    ON question_library_node (institute_id, status, parent_id);

CREATE INDEX IF NOT EXISTS idx_question_library_node_parent
    ON question_library_node (parent_id);

CREATE TABLE IF NOT EXISTS question_library_mapping (
    node_id      VARCHAR(255) NOT NULL REFERENCES question_library_node (id) ON DELETE CASCADE,
    question_id  VARCHAR(255) NOT NULL,
    institute_id VARCHAR(255) NOT NULL,
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_question_library_mapping PRIMARY KEY (node_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_question_library_mapping_question
    ON question_library_mapping (question_id);

CREATE INDEX IF NOT EXISTS idx_question_library_mapping_institute
    ON question_library_mapping (institute_id);

CREATE TABLE IF NOT EXISTS question_library_version (
    old_question_id VARCHAR(255) PRIMARY KEY,
    new_question_id VARCHAR(255) NOT NULL,
    institute_id    VARCHAR(255) NOT NULL,
    created_by      VARCHAR(255) NULL,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_question_library_version_new
    ON question_library_version (new_question_id);
