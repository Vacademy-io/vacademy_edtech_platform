-- ================================================================================
-- V517: Curriculum libraries — pre-loaded NCERT (and later CUET / state board)
--       knowledge bases any institute can build a test from, chapter by chapter.
--
-- V445 made a PLATFORM knowledge base something an institute BUYS (50 credits,
-- one row in knowledge_base_entitlement). Curriculum is different: it is a
-- standing catalogue of ~100 books that every institute of a given board and
-- class needs, and paywalling it would put a purchase step in the middle of
-- "make me a Class 11 Chemistry test". So access to a curriculum library is
-- decided by an INSTITUTE SETTING, not by an entitlement row:
--
--     institutes.setting_json -> setting -> CURRICULUM_LIBRARY_SETTING -> data
--         { "enabled": true, "boards": ["NCERT"], "classes": ["11", "12"] }
--
-- and ai_service evaluates that setting in SQL (KbRepository.list_kbs /
-- is_usable). No entitlement rows, no sync job, one source of truth. Institutes
-- without the setting never see a curriculum library anywhere.
--
-- Two additive columns carry the rest:
--
--   knowledge_base_listing.collection  'CURRICULUM' marks a listing as part of
--       the curriculum catalogue. The ordinary Library tab excludes these rows
--       so a hundred textbooks do not bury the paid libraries, and the board /
--       level / subject / language facets that V445 already has describe the
--       book (board='NCERT', level='11', subject='Chemistry', language='English').
--
--   knowledge_base.meta_json  free-form per-base metadata. The first key is
--       topic_tree_mode='AUTHORED': the topic tree is written from the book's
--       own table of contents (one topic per chapter source, subtopics = the
--       chapter's printed headings) instead of being re-derived by an LLM after
--       every ingest. Teachers expect the OFFICIAL chapter names and numbers, and
--       the LLM merge (V443) is free to re-theme them.
-- ================================================================================

ALTER TABLE knowledge_base
    ADD COLUMN IF NOT EXISTS meta_json JSONB NOT NULL DEFAULT '{}'::jsonb;

-- institutes.setting_json is TEXT. The access check below casts it to jsonb on
-- every knowledge-base list; one malformed blob must degrade to "no setting",
-- not 500 that institute's whole page. PG16 has pg_input_is_valid for this,
-- but local development still runs PG15, so a two-line function covers both.
CREATE OR REPLACE FUNCTION kb_safe_jsonb(txt TEXT) RETURNS JSONB
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
    RETURN CAST(txt AS jsonb);
EXCEPTION WHEN others THEN
    RETURN '{}'::jsonb;
END
$$;

ALTER TABLE knowledge_base_listing
    ADD COLUMN IF NOT EXISTS collection VARCHAR(30);

-- "Which curriculum libraries match this institute's boards and classes?" —
-- asked on every knowledge-base list load for an enabled institute.
CREATE INDEX IF NOT EXISTS idx_kb_listing_curriculum
    ON knowledge_base_listing (board, level, subject)
    WHERE status = 'PUBLISHED' AND collection = 'CURRICULUM';

COMMENT ON COLUMN knowledge_base.meta_json IS
    'Per-base metadata. topic_tree_mode=AUTHORED keeps the topic tree as written '
    'from the source table of contents (curriculum libraries); curriculum{} '
    'describes the book (board, class, subject, medium, session, book_codes).';
COMMENT ON COLUMN knowledge_base_listing.collection IS
    'NULL = ordinary paid library. CURRICULUM = pre-loaded textbook library whose '
    'access is granted by CURRICULUM_LIBRARY_SETTING on the institute, not by '
    'an entitlement; hidden from the Library catalogue.';
