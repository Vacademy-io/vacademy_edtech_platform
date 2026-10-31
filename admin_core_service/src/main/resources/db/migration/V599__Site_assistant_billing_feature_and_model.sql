-- ================================================================================
-- Site Assistant: register it like every other AI feature in the super-admin portal.
--
-- 1. Billing feature "Website assistant answers" (AI plans page), and the V598
--    metering catalog row mapped to it, so its usage is no longer "unmapped".
--    INCLUDABLE like the other chat features; no plan item is added (a super
--    admin includes it in a plan from the portal).
-- 2. The model default shows what actually answers. The engine needs a model
--    whose reasoning can be switched off (a chat widget has a ~2 s first-token
--    budget; GLM-5.3-flash always reasons), so the default is Gemini 2.5 Flash
--    with GLM as the fallback. Applied only when the row still holds the V598
--    seed (a portal edit is never overwritten), and logged in
--    ai_model_change_log like a portal change.
-- ================================================================================

INSERT INTO ai_billing_feature (feature_key, label, description, eligibility, locked, display_order, updated_by)
VALUES ('site_assistant', 'Website assistant answers',
        'Answers from the AI assistant on institute websites (hosted sites and the embed snippet).',
        'INCLUDABLE', FALSE, 71, 'V599')
ON CONFLICT (feature_key) DO NOTHING;

UPDATE ai_use_case_catalog
SET billing_feature_key = 'site_assistant'
WHERE use_case = 'site_assistant'
  AND billing_feature_key IS NULL;

INSERT INTO ai_model_change_log (table_name, row_key, old_value, new_value, reason, actor)
SELECT 'ai_model_defaults', d.use_case,
       jsonb_build_object('default_model_id', d.default_model_id, 'fallback_model_id', d.fallback_model_id),
       jsonb_build_object('default_model_id', 'google/gemini-2.5-flash', 'fallback_model_id', 'z-ai/glm-5.3-flash'),
       'Site Assistant is a public chat widget: it needs a model whose reasoning can be turned off for a fast first answer. GLM stays as the fallback.',
       'V599'
FROM ai_model_defaults d
WHERE d.use_case = 'site_assistant'
  AND d.default_model_id = 'z-ai/glm-5.3-flash'
  AND d.fallback_model_id = 'google/gemini-2.5-flash';

UPDATE ai_model_defaults
SET default_model_id  = 'google/gemini-2.5-flash',
    fallback_model_id = 'z-ai/glm-5.3-flash',
    description       = 'Site Assistant: public website chatbot answers. Needs a model with reasoning off (fast first answer); GLM is the fallback.',
    updated_at        = CURRENT_TIMESTAMP
WHERE use_case = 'site_assistant'
  AND default_model_id = 'z-ai/glm-5.3-flash'
  AND fallback_model_id = 'google/gemini-2.5-flash';
