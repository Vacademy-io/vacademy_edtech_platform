-- ================================================================================
-- V569: ai_model_change_log + model-default rows for every new AI use case
-- ================================================================================
--
-- Release 2 of "every feature's model from the DB": each chat-LLM feature reads
-- its model from ai_model_defaults by use-case key (GLM by default, one non-GLM
-- fallback), and a super admin changes them from the portal
-- (ai_service /super-admin/v1/models/*).
--
-- ai_model_change_log   audit trail of every portal change to ai_model_defaults
--                       and ai_model_stage_assignments: old/new value, reason,
--                       actor. Written by ai_service (which answers 503 while
--                       this table is missing, so deploy admin_core first).
--                       row_key = use_case for ai_model_defaults,
--                       '<use_case>/<quality_tier>/<stage_id>' for stage rows.
--
-- Seed rows for the 23 new use-case keys (default z-ai/glm-5.3-flash,
-- fallback google/gemini-2.5-flash). ON CONFLICT DO NOTHING: a row a super admin
-- already set is never overwritten. reels_selection is seeded because its rerank
-- call now goes through llm_router.chat_with_chain (reasoning low + max_tokens
-- headroom); if that rewire does not ship with this migration, drop its row
-- below. HELD and not touched here:
--   student_report   - existing row, left on its current default (GLM timed out
--                      >170 s on comprehensive reports).
--
-- New tables only; no ALTER of an existing (possibly postgres-owned) table.
-- ================================================================================

CREATE TABLE IF NOT EXISTS ai_model_change_log (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name  TEXT         NOT NULL,               -- 'ai_model_defaults' | 'ai_model_stage_assignments'
    row_key     TEXT         NOT NULL,
    old_value   JSONB,                               -- NULL when the row was created
    new_value   JSONB,
    reason      TEXT         NOT NULL,
    actor       TEXT,                                -- auth user id of the super admin
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_model_change_log_row
    ON ai_model_change_log (table_name, row_key, created_at DESC);

INSERT INTO ai_model_defaults (use_case, default_model_id, fallback_model_id, free_tier_model_id, description)
VALUES
    ('parent_assistant', 'z-ai/glm-5.3-flash', 'google/gemini-2.5-flash', NULL, 'Parent portal assistant'),
    ('kb_companion', 'z-ai/glm-5.3-flash', 'google/gemini-2.5-flash', NULL, 'KB Companions (lesson cards, ask, practice)'),
    ('live_session_summary', 'z-ai/glm-5.3-flash', 'google/gemini-2.5-flash', NULL, 'Live class summary & action points'),
    ('html_document', 'z-ai/glm-5.3-flash', 'google/gemini-2.5-flash', NULL, 'AI HTML documents'),
    ('course_assist', 'z-ai/glm-5.3-flash', 'google/gemini-2.5-flash', NULL, 'Course step-1 copywriting assist'),
    ('transcript_notes', 'z-ai/glm-5.3-flash', 'google/gemini-2.5-flash', NULL, 'Transcript to study notes'),
    ('brand_kit', 'z-ai/glm-5.3-flash', 'google/gemini-2.5-flash', NULL, 'Brand-kit scrape'),
    ('image_keyword', 'z-ai/glm-5.3-flash', 'google/gemini-2.5-flash', NULL, 'Image-search keywords'),
    ('engagement_plan', 'z-ai/glm-5.3-flash', 'google/gemini-2.5-flash', NULL, 'Engagement plans'),
    ('copy_check_deduction', 'z-ai/glm-5.3-flash', 'google/gemini-2.5-flash', NULL, 'Copy-check deduction re-check'),
    ('class_report', 'z-ai/glm-5.3-flash', 'google/gemini-2.5-flash', NULL, 'Class-level assessment narrative'),
    ('reels_selection', 'z-ai/glm-5.3-flash', 'google/gemini-2.5-flash', NULL, 'Reels scan selection'),
    ('reels_preview', 'z-ai/glm-5.3-flash', 'google/gemini-2.5-flash', NULL, 'Reels preview enrichment'),
    ('reels_director', 'z-ai/glm-5.3-flash', 'google/gemini-2.5-flash', NULL, 'Reels director'),
    ('studio_plan', 'z-ai/glm-5.3-flash', 'google/gemini-2.5-flash', NULL, 'Studio plan'),
    ('assistant', 'z-ai/glm-5.3-flash', 'google/gemini-2.5-flash', NULL, 'Vacademy Assistant (admin)'),
    ('admin_agent', 'z-ai/glm-5.3-flash', 'google/gemini-2.5-flash', NULL, 'Admin AI agent chat'),
    ('chatbot_flow', 'z-ai/glm-5.3-flash', 'google/gemini-2.5-flash', NULL, 'WhatsApp chatbot-flow AI reply'),
    ('engagement', 'z-ai/glm-5.3-flash', 'google/gemini-2.5-flash', NULL, 'Engagement brain'),
    ('workflow_draft', 'z-ai/glm-5.3-flash', 'google/gemini-2.5-flash', NULL, 'Workflow builder AI draft'),
    ('agent_assist', 'z-ai/glm-5.3-flash', 'google/gemini-2.5-flash', NULL, 'AI calling-agent prompt assistant'),
    ('call_intelligence', 'z-ai/glm-5.3-flash', 'google/gemini-2.5-flash', NULL, 'CRM call intelligence'),
    ('platform_default', 'z-ai/glm-5.3-flash', 'google/gemini-2.5-flash', NULL, 'Platform default (model-less calls)')
ON CONFLICT (use_case) DO NOTHING;
