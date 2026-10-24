-- ================================================================================
-- V501: Meter the Automations chatbot (WhatsApp flow AI_RESPONSE nodes) on AI credits.
--
-- Until now the chatbot flow's AI node was the only LLM surface on the platform that
-- ran for free: notification_service -> /internal/chatbot-ai/respond -> LLMService
-- logged an ai_token_usage row (bucketed as 'agent') and never called /credits/v1/deduct.
-- An institute with a zero balance could still burn OpenRouter spend on every inbound
-- WhatsApp message, and none of it showed up in the AI usage screens as chatbot spend.
--
-- Two things this migration has to do:
--   1. Allow request_type='chatbot' on ai_token_usage. The billing path writes the
--      usage row FIRST, so a value missing from this CHECK throws a CheckViolation,
--      the whole charge is swallowed by best-effort billing, and NO credits move.
--      Exactly the trap fixed in V102 / V217 / V225 / V325 / V345 / V384 / V435.
--   2. Seed credit_pricing so the charge is bucketed as 'chatbot' rather than falling
--      back to the 'content' row (see CreditService._get_pricing).
--
-- Expand-only on the CHECK: the value set is a strict superset of V435's, so
-- validation cannot fail on existing rows.
-- ================================================================================

-- --------------------------------------------------------------------------------
-- 1. ai_token_usage.request_type CHECK — V435's set plus 'chatbot'.
-- --------------------------------------------------------------------------------
ALTER TABLE ai_token_usage DROP CONSTRAINT IF EXISTS ai_token_usage_request_type_check;

ALTER TABLE ai_token_usage ADD CONSTRAINT ai_token_usage_request_type_check
    CHECK (request_type IN (
        'outline',
        'image',
        'content',
        'video',
        'tts',
        'tts_premium',
        'embedding',
        'evaluation',
        'presentation',
        'conversation',
        'lecture',
        'course_content',
        'pdf_questions',
        'agent',
        'analytics',
        'copilot',
        'incident',
        'question_metadata',
        'stock',
        'avatar_video',
        'reels_preview',
        'ai_video',
        'assessment',
        'notes',
        'transcription',
        'call_intelligence',
        'coding_question',
        'translation',
        'knowledge_base',
        'chatbot'
    ));

COMMENT ON COLUMN ai_token_usage.request_type IS
    'Type of AI request. Keep in sync with RequestType in ai_service/app/models/ai_token_usage.py — adding a new value REQUIRES expanding this CHECK (see V102/V217/V225/V325/V435/V501).';

-- --------------------------------------------------------------------------------
-- 2. credit_pricing row for the chatbot bucket.
--
-- Same shape as the other token-metered LLM buckets on the V190 scale: the real
-- charge comes from the model's own USD pricing in ai_models (the "real-cost path"
-- in CreditService.calculate_credits), and base_cost/min_charge only floor it. A
-- WhatsApp turn is a few hundred tokens, so the 0.05 floor is what most turns pay.
-- --------------------------------------------------------------------------------
INSERT INTO credit_pricing (request_type, base_cost, token_rate, minimum_charge, unit_type, description, is_active)
VALUES ('chatbot', 0.05, 0.00001, 0.05, 'tokens',
        'Automations chatbot AI reply (one WhatsApp/flow AI_RESPONSE turn)', TRUE)
ON CONFLICT (request_type) DO NOTHING;
