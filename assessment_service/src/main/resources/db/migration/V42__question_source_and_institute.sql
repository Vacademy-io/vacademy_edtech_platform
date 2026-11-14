-- Provenance and institute scoping for individual questions.
--
-- Two gaps this closes:
--
-- 1. `question` has no institute. Questions are only reachable today by dumping a
--    whole question_paper, because the only way to scope a question to an institute
--    is the two-hop chain
--      question -> question_question_paper_mapping -> institute_question_paper.
--    That is far too expensive to filter on per row, which is why no question-level
--    browse or search API exists at all.
--
-- 2. Questions generated from a knowledge base lose every trace of where they came
--    from the moment they are saved. The KB pipeline knows the source book, the topic
--    nodes and the exact page; none of it survives into the question bank, so a
--    generated question can never be found again by topic, and a teacher checking a
--    citation has nowhere to look.
--
-- All three columns are NULLABLE with no default. Nothing existing reads them, no
-- existing query gains a predicate, and rolling this back is a no-op.

ALTER TABLE question ADD COLUMN institute_id VARCHAR(255);

-- MANUAL | UPLOAD | AI | KNOWLEDGE_BASE. Deliberately a plain varchar rather than a
-- CHECK constraint: new generators appear regularly and a CHECK here would mean a
-- migration every time one does.
ALTER TABLE question ADD COLUMN source_type VARCHAR(50);

-- {kb_id, node_ids[], topic, source_page, generation_id, figures[]} for KB questions;
-- open-ended for other sources. JSONB so it can be indexed and queried, rather than
-- TEXT which would force a full scan to answer "which questions came from this book".
ALTER TABLE question ADD COLUMN source_meta JSONB;

-- Backfill institute_id from the existing link chain. DISTINCT ON picks one institute
-- per question: a question shared across papers belonging to different institutes is
-- possible in principle, and this column is a scoping hint for the new browse endpoint,
-- not a new source of truth -- the paper-level institute_question_paper link remains
-- authoritative and is untouched.
--
-- Questions belonging to no institute-linked paper stay NULL. That is correct: they are
-- public/community questions, and the browse endpoint filters on institute_id, so they
-- simply do not appear in an institute's own bank.
-- Batched. `question` is a hot table during live exams, and a single UPDATE over every
-- row would hold row locks for the whole statement. 5000 rows at a time keeps each
-- statement short; the loop stops as soon as a pass updates nothing.
DO $$
DECLARE
    updated_rows INTEGER;
BEGIN
    LOOP
        -- Selected from the RESOLVABLE set, not from "every question still NULL".
        -- Questions belonging to no institute-linked paper can never be filled in, so a
        -- batch drawn from the NULL rows would keep re-picking the same unresolvable
        -- ones and the loop would never terminate. Every row selected here is updated,
        -- so ROW_COUNT reaching 0 means genuinely finished.
        WITH resolved AS (
            SELECT DISTINCT ON (m.question_id) m.question_id, iqp.institute_id
            FROM question_question_paper_mapping m
            JOIN institute_question_paper iqp ON iqp.question_paper_id = m.question_paper_id
            JOIN question q ON q.id = m.question_id AND q.institute_id IS NULL
            ORDER BY m.question_id, iqp.created_on NULLS LAST
            LIMIT 5000
        )
        UPDATE question q
        SET institute_id = resolved.institute_id
        FROM resolved
        WHERE resolved.question_id = q.id;

        GET DIAGNOSTICS updated_rows = ROW_COUNT;
        EXIT WHEN updated_rows = 0;
    END LOOP;
END $$;

-- Plain CREATE INDEX, not CONCURRENTLY, matching V34: CONCURRENTLY cannot run inside
-- the transaction Flyway wraps each migration in, and a plain build rolls back cleanly
-- instead of leaving an INVALID index behind for IF NOT EXISTS to skip silently later.
CREATE INDEX IF NOT EXISTS idx_question_institute_status
    ON question (institute_id, status);

CREATE INDEX IF NOT EXISTS idx_question_institute_type
    ON question (institute_id, question_type);

CREATE INDEX IF NOT EXISTS idx_question_institute_difficulty
    ON question (institute_id, difficulty);

-- jsonb_path_ops over the default: smaller and faster for the only query shape we run
-- against this column, containment ("which questions came from kb X / node Y").
CREATE INDEX IF NOT EXISTS idx_question_source_meta
    ON question USING GIN (source_meta jsonb_path_ops);

CREATE INDEX IF NOT EXISTS idx_question_source_type
    ON question (source_type);
