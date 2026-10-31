-- ================================================================================
-- V600: Course knowledge — the AI can read an institute's own courses
--
-- Every published lesson of a course (documents, PDFs, videos, audio, quizzes,
-- SCORM, AI videos) is turned into text, chunked and embedded into ONE hidden
-- knowledge base per institute (purpose = 'course_content', one SLIDE source per
-- lesson). The learner chatbot, voice and tutor then answer from the lessons a
-- learner may actually open (enrolment, visible tree, drip), with citations back
-- to the lesson, page or second. Free text extraction is automatic; paid work
-- (OCR of scanned pages, transcription of uploaded media) is quoted and charged
-- to the institute's AI credits (tool keys course_kb_ocr_page and
-- course_kb_transcribe_minute, catalog row course_knowledge -> billing feature
-- kb_ingest).
--
-- admin_core only OWNS the schema. ai_service reads and writes every table here
-- with raw SQL (app/services/course_knowledge/); admin_core only inserts rows into
-- content_index_queue after a slide edit commits, and only for institutes whose
-- course_knowledge_setting.enabled is TRUE. With no setting row nothing happens:
-- behaviour for every existing institute is unchanged.
--
-- ISOLATION RULE (why kb_chunk gets a second vector column):
--   Course vectors live ONLY in kb_chunk.embedding_768_scoped, with embedding_768
--   NULL. Every legacy KB reader filters `c.embedding_768 IS NOT NULL`
--   (ai_service/app/services/kb/repository.py:1138 search_chunks and :1384
--   search_institute_wide, which searches every KB of the institute when
--   purposes=None), and idx_kb_chunk_vec_768 is a partial HNSW index on that
--   column. So course chunks are invisible to every existing KB, chatbot and
--   companion search, and never bloat that index; only the access-checked course
--   retrieval reads the scoped column, with an exact scan over allowed lessons.
--   kb_chunk_scoped_vector_exclusive makes "both columns set" impossible.
--
-- Additive and idempotent: CREATE ... IF NOT EXISTS, seeds ON CONFLICT DO NOTHING,
-- constraint swaps DROP IF EXISTS + ADD ... NOT VALID. Only the two small KB tables
-- are VALIDATEd; the kb_chunk CHECKs stay NOT VALID because each is a superset of
-- the rule existing rows already satisfy (old: dim 768 => embedding_768 set; no row
-- has embedding_768_scoped yet). request_type reuses 'knowledge_base' and
-- 'transcription', both already allowed, so ai_token_usage_request_type_check is
-- NOT touched (the trap described in the V598 header). Hot tables go last:
-- new tables and seeds, then knowledge_base, knowledge_base_source, kb_chunk.
--
-- PRE-PUSH CHECKS:
--   1. Re-list origin/main migrations; if V600 is taken, rename this file and the
--      SEEDED_LATER entry in ai_service/tests/test_metering_catalog_coverage.py.
--   2. Confirm on prod that knowledge_base, knowledge_base_source and kb_chunk are
--      owned by the Flyway role, otherwise the ALTERs fail with 42501 and the pod
--      does not boot.
--   3. Deploy off-peak: the ALTERs take brief ACCESS EXCLUSIVE locks. Under the
--      5 s lock_timeout a busy table fails the migration cleanly (the old pods keep
--      serving); retry the deploy.
-- ================================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- -------------------------------------------------------------------------------
-- 1. New tables (no lock on existing tables)
-- -------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS course_knowledge_setting (
    institute_id             VARCHAR(255) PRIMARY KEY,
    enabled                  BOOLEAN      NOT NULL DEFAULT FALSE,
    learner_answers_enabled  BOOLEAN      NOT NULL DEFAULT TRUE,
    auto_paid_enabled        BOOLEAN      NOT NULL DEFAULT FALSE,
    monthly_auto_cap_credits INTEGER      NOT NULL DEFAULT 0,
    allow_ocr                BOOLEAN      NOT NULL DEFAULT TRUE,
    allow_transcription      BOOLEAN      NOT NULL DEFAULT TRUE,
    enabled_at               TIMESTAMPTZ,
    updated_by               VARCHAR(255),
    created_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT cks_cap_nonneg CHECK (monthly_auto_cap_credits >= 0)
);
CREATE INDEX IF NOT EXISTS idx_cks_enabled ON course_knowledge_setting (institute_id) WHERE enabled = TRUE;

CREATE TABLE IF NOT EXISTS content_index_queue (
    institute_id     VARCHAR(255)  NOT NULL,
    slide_id         VARCHAR(255)  NOT NULL,
    reason           VARCHAR(48),
    status           VARCHAR(16)   NOT NULL DEFAULT 'PENDING',
    allow_paid       BOOLEAN       NOT NULL DEFAULT FALSE,
    run_id           VARCHAR(36),
    generation       BIGINT        NOT NULL DEFAULT 1,
    not_before       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    attempts         INTEGER       NOT NULL DEFAULT 0,
    budget_id        VARCHAR(300),
    reserved_credits NUMERIC(12,2) NOT NULL DEFAULT 0,
    last_error       TEXT,
    claimed_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    PRIMARY KEY (institute_id, slide_id),
    CONSTRAINT ciq_status_valid CHECK (status IN ('PENDING','PROCESSING','DONE','FAILED','SKIPPED'))
);
CREATE INDEX IF NOT EXISTS idx_ciq_pending    ON content_index_queue (not_before) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_ciq_processing ON content_index_queue (claimed_at) WHERE status = 'PROCESSING';
CREATE INDEX IF NOT EXISTS idx_ciq_run        ON content_index_queue (run_id, status) WHERE run_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS course_knowledge_run (
    id             VARCHAR(36)   PRIMARY KEY,
    institute_id   VARCHAR(255)  NOT NULL,
    package_id     VARCHAR(255)  NOT NULL,
    kind           VARCHAR(8)    NOT NULL,
    status         VARCHAR(12)   NOT NULL DEFAULT 'RUNNING',
    requested_by   VARCHAR(255),
    quoted_credits NUMERIC(12,2) NOT NULL DEFAULT 0,
    quote_json     JSONB         NOT NULL DEFAULT '{}'::jsonb,
    slides_total   INTEGER       NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    finished_at    TIMESTAMPTZ,
    CONSTRAINT ckr_kind_valid   CHECK (kind IN ('SCAN','PROCESS')),
    CONSTRAINT ckr_status_valid CHECK (status IN ('RUNNING','DONE','PARTIAL','CANCELLED'))
);
CREATE INDEX IF NOT EXISTS idx_ckr_package ON course_knowledge_run (institute_id, package_id, created_at DESC);

CREATE TABLE IF NOT EXISTS course_knowledge_budget (
    id               VARCHAR(300)  PRIMARY KEY,          -- 'run:<uuid>' | 'month:<institute_id>:<YYYY-MM>'
    institute_id     VARCHAR(255)  NOT NULL,
    kind             VARCHAR(8)    NOT NULL,
    cap_credits      NUMERIC(12,2) NOT NULL DEFAULT 0,
    reserved_credits NUMERIC(12,2) NOT NULL DEFAULT 0,
    charged_credits  NUMERIC(12,2) NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT ckb_kind_valid CHECK (kind IN ('RUN','MONTH')),
    CONSTRAINT ckb_nonneg CHECK (cap_credits >= 0 AND reserved_credits >= 0 AND charged_credits >= 0)
);
CREATE INDEX IF NOT EXISTS idx_ckb_institute ON course_knowledge_budget (institute_id, kind);

CREATE TABLE IF NOT EXISTS course_extract_cache (
    pointer_kind      VARCHAR(16)  NOT NULL,             -- file | youtube | ai_video | deck | scorm
    pointer_key       VARCHAR(512) NOT NULL,
    extractor_version INTEGER      NOT NULL,
    tier              VARCHAR(8)   NOT NULL,
    segments          JSONB        NOT NULL DEFAULT '[]'::jsonb,
    text_chars        INTEGER      NOT NULL DEFAULT 0,
    probe             JSONB        NOT NULL DEFAULT '{}'::jsonb,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (pointer_kind, pointer_key, extractor_version, tier),
    CONSTRAINT cec_tier_valid CHECK (tier IN ('FREE','PAID'))
);

CREATE TABLE IF NOT EXISTS course_knowledge_link (
    id                VARCHAR(36)  PRIMARY KEY DEFAULT gen_random_uuid()::text,
    institute_id      VARCHAR(255) NOT NULL,
    package_id        VARCHAR(255) NOT NULL,
    knowledge_base_id VARCHAR(255) NOT NULL REFERENCES knowledge_base (id) ON DELETE CASCADE,
    role              VARCHAR(16)  NOT NULL DEFAULT 'GROUNDING',
    grounding_mode    VARCHAR(10)  NOT NULL DEFAULT 'STRICT',
    use_in            TEXT[]       NOT NULL DEFAULT '{tutor,chatbot}',
    topic_node_ids    TEXT[]       NOT NULL DEFAULT '{}',
    chapter_topics    JSONB        NOT NULL DEFAULT '{}'::jsonb,   -- {chapter_id: [node_id, ...]}
    provenance        VARCHAR(24)  NOT NULL DEFAULT 'ADMIN',
    status            VARCHAR(10)  NOT NULL DEFAULT 'ACTIVE',
    created_by        VARCHAR(255),
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ckl_role_valid       CHECK (role IN ('GROUNDING','REFERENCE')),
    CONSTRAINT ckl_mode_valid       CHECK (grounding_mode IN ('STRICT','BLENDED')),
    CONSTRAINT ckl_provenance_valid CHECK (provenance IN ('AI_COURSE_CREATOR','ADMIN','LEGACY_TUTOR_SETTING')),
    CONSTRAINT ckl_status_valid     CHECK (status IN ('ACTIVE','REMOVED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ckl_package_kb ON course_knowledge_link (package_id, knowledge_base_id) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_ckl_institute_package ON course_knowledge_link (institute_id, package_id);

-- -------------------------------------------------------------------------------
-- 2. Pricing + metering vocabulary (must equal DEFAULT_TOOL_PRICING in ai_service)
-- -------------------------------------------------------------------------------
INSERT INTO ai_tool_pricing (tool_key, request_type, flat_base_credits, per_unit_credits, unit_field, params_json)
VALUES ('course_kb_ocr_page', 'knowledge_base', 0, 0.5, 'pages', '{"fixed_price": true}'::jsonb),
       ('course_kb_transcribe_minute', 'transcription', 0, 0.5, 'audio_minutes', '{"fixed_price": true, "min_credits": "1"}'::jsonb)
ON CONFLICT (tool_key) DO NOTHING;

INSERT INTO ai_use_case_catalog
    (use_case, feature_group, label, label_template, count_unit_label, model_use_case,
     legacy_request_types, tool_keys, capability_key, default_surface, actor_kind, unit_kind,
     plan_eligible, limit_eligible, reserve_on_authorize, intentionally_separate, display_order, updated_by)
VALUES ('course_knowledge', 'kb', 'Course AI knowledge (scans and videos)', NULL, 'units', NULL,
        '{}', '{course_kb_ocr_page,course_kb_transcribe_minute}', NULL, 'ADMIN_APP', 'USER', 'MIXED',
        TRUE, TRUE, FALSE, FALSE, 83, 'V600')
ON CONFLICT (use_case) DO NOTHING;

UPDATE ai_use_case_catalog SET billing_feature_key = 'kb_ingest'
 WHERE use_case = 'course_knowledge' AND billing_feature_key IS NULL;

-- -------------------------------------------------------------------------------
-- 3. knowledge_base: one hidden course_content KB per institute
-- -------------------------------------------------------------------------------
ALTER TABLE knowledge_base DROP CONSTRAINT IF EXISTS knowledge_base_purpose_valid;
ALTER TABLE knowledge_base ADD CONSTRAINT knowledge_base_purpose_valid
    CHECK (purpose IN ('general','teaching','question_bank','institute_info','course_content')) NOT VALID;
ALTER TABLE knowledge_base VALIDATE CONSTRAINT knowledge_base_purpose_valid;
CREATE UNIQUE INDEX IF NOT EXISTS uq_kb_course_content ON knowledge_base (institute_id) WHERE purpose = 'course_content';

-- -------------------------------------------------------------------------------
-- 4. knowledge_base_source: one SLIDE source per lesson
-- -------------------------------------------------------------------------------
ALTER TABLE knowledge_base_source DROP CONSTRAINT IF EXISTS kb_source_kind_valid;
ALTER TABLE knowledge_base_source ADD CONSTRAINT kb_source_kind_valid
    CHECK (source_kind IN ('PDF','URL','YOUTUBE','TEXT','SLIDE')) NOT VALID;
ALTER TABLE knowledge_base_source VALIDATE CONSTRAINT kb_source_kind_valid;
ALTER TABLE knowledge_base_source ADD COLUMN IF NOT EXISTS slide_id     VARCHAR(255);
ALTER TABLE knowledge_base_source ADD COLUMN IF NOT EXISTS index_state  VARCHAR(24);
ALTER TABLE knowledge_base_source ADD COLUMN IF NOT EXISTS centroid_768 vector(768);
ALTER TABLE knowledge_base_source DROP CONSTRAINT IF EXISTS kb_source_index_state_valid;
ALTER TABLE knowledge_base_source ADD CONSTRAINT kb_source_index_state_valid
    CHECK (index_state IS NULL OR index_state IN ('READY','NEEDS_PROCESSING','PENDING','EMPTY','UNSUPPORTED','FAILED')) NOT VALID;
ALTER TABLE knowledge_base_source VALIDATE CONSTRAINT kb_source_index_state_valid;
CREATE UNIQUE INDEX IF NOT EXISTS uq_kb_source_slide ON knowledge_base_source (knowledge_base_id, slide_id) WHERE slide_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kb_source_slide_state ON knowledge_base_source (knowledge_base_id, index_state) WHERE slide_id IS NOT NULL;

-- -------------------------------------------------------------------------------
-- 5. kb_chunk LAST (hot table): course vectors outside idx_kb_chunk_vec_768
-- -------------------------------------------------------------------------------
ALTER TABLE kb_chunk ADD COLUMN IF NOT EXISTS embedding_768_scoped vector(768);
ALTER TABLE kb_chunk DROP CONSTRAINT IF EXISTS kb_chunk_vector_matches_dim;
ALTER TABLE kb_chunk ADD CONSTRAINT kb_chunk_vector_matches_dim CHECK (
    (embedding_dim = 768 AND (embedding_768 IS NOT NULL OR embedding_768_scoped IS NOT NULL))
    OR embedding_dim NOT IN (768)) NOT VALID;
ALTER TABLE kb_chunk DROP CONSTRAINT IF EXISTS kb_chunk_scoped_vector_exclusive;
ALTER TABLE kb_chunk ADD CONSTRAINT kb_chunk_scoped_vector_exclusive
    CHECK (embedding_768 IS NULL OR embedding_768_scoped IS NULL) NOT VALID;
