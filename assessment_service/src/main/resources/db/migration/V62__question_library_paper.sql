-- Whole question papers in the Question Library.
--
-- The library now holds only what the platform provides: its topics and questions belong
-- to one owner institute (question.library.owner-institute-id), and every other institute
-- reads it and copies what it picks. V61 could only place a paper's questions under a
-- topic, so the paper itself was lost. This table keeps the paper under the topic too, so
-- an institute can add all of it to a section in one go.
--
-- No foreign key to question_paper, for the same reason V61 has none to question: the
-- service checks the paper against the owner institute before writing.

CREATE TABLE IF NOT EXISTS question_library_paper (
    node_id           VARCHAR(255) NOT NULL REFERENCES question_library_node (id) ON DELETE CASCADE,
    question_paper_id VARCHAR(255) NOT NULL,
    institute_id      VARCHAR(255) NOT NULL,
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_question_library_paper PRIMARY KEY (node_id, question_paper_id)
);

CREATE INDEX IF NOT EXISTS idx_question_library_paper_institute
    ON question_library_paper (institute_id);

CREATE INDEX IF NOT EXISTS idx_question_library_paper_paper
    ON question_library_paper (question_paper_id);
