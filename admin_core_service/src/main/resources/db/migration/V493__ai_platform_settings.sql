-- ================================================================================
-- V493: Platform-level AI runtime settings, editable from the super-admin portal
-- ================================================================================
--
-- Background:
-- Which LLM serves the learner chatbot, and which TTS engine voices the voice
-- call, were deployment constants: LLM_DEFAULT_MODEL is pinned as a literal env
-- value in the ai-service Deployment spec, and the voice call was hard-wired to
-- Sarvam. Changing either meant a devops-repo edit and a rollout.
--
-- This table holds those switches so the super-admin portal (vacademy-health-check
-- -> AI Settings) can flip them at runtime. ai_service reads it with a short TTL
-- cache (see app/services/platform_settings_service.py), so a change is live on
-- every replica within ~30s, no redeploy.
--
-- A key that is ABSENT means "use the environment default" — the service never
-- needs a row to exist, and deleting a row resets that setting. The set of valid
-- keys and their types is declared in code (SETTING_SPECS), not here, so adding
-- a setting is a code change, never a migration.
--
-- Model choices are validated against ai_models (V101) at write time; that
-- registry is where the portal's dropdown comes from.
-- ================================================================================

CREATE TABLE IF NOT EXISTS ai_platform_settings (
    setting_key   VARCHAR(100) PRIMARY KEY,
    setting_value JSONB        NOT NULL,          -- scalar wrapped as JSON: "gemini", true, 0.4
    updated_by    VARCHAR(100),                    -- super-admin user id that last set it
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMENT ON TABLE ai_platform_settings IS
    'Platform-wide AI runtime switches (chatbot model, voice TTS engine, rollout flags) set from the super-admin portal; absent key = environment default';
