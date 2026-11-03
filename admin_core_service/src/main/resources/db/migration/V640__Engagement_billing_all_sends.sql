-- Engagement Engine billing covers every sent message (autonomous, approved by a person, AI reply),
-- charges the AI decisions by their tokens, and refunds a message the provider refused after it was charged.

ALTER TABLE engagement_action ADD COLUMN IF NOT EXISTS billing_exempt BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE engagement_action ADD COLUMN IF NOT EXISTS llm_billed_at TIMESTAMP;
ALTER TABLE engagement_action ADD COLUMN IF NOT EXISTS credits_refunded_at TIMESTAMP;

-- Rows from before this release were free under the old rule: they are never charged later.
-- Autonomous sends were always charged and keep their reconciliation, see findUnbilledSent.
UPDATE engagement_action SET billing_exempt = TRUE WHERE billing_exempt = FALSE;

CREATE INDEX IF NOT EXISTS idx_ea_unbilled_send
    ON engagement_action (dispatched_at)
    WHERE status = 'SENT' AND credits_billed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ea_unbilled_llm
    ON engagement_action (created_at)
    WHERE llm_billed_at IS NULL AND billing_exempt = FALSE AND llm_tokens_in IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ea_unrefunded
    ON engagement_action (updated_at)
    WHERE status = 'FAILED' AND credits_billed_at IS NOT NULL AND credits_refunded_at IS NULL;

-- The AI decision bucket: token-metered like the chatbot bucket (V501). The model USD price sets
-- the charge, base_cost and minimum_charge only floor it.
INSERT INTO credit_pricing (request_type, base_cost, token_rate, minimum_charge, unit_type, description, is_active)
VALUES ('engagement_decision', 0.05, 0.00001, 0.05, 'tokens',
        'One Engagement Engine AI decision (what to do next for a person, or a reply draft)', TRUE)
ON CONFLICT (request_type) DO NOTHING;

-- ai_service stores a usage event under its use_case only when the catalog knows it, else as unknown,
-- and the engine report reads the AI decision credits by this use_case.
INSERT INTO ai_use_case_catalog
    (use_case, feature_group, label, label_template, count_unit_label, model_use_case,
     legacy_request_types, tool_keys, capability_key, default_surface, actor_kind, unit_kind,
     billing_policy, plan_eligible, limit_eligible, reserve_on_authorize, intentionally_separate,
     is_active, display_order, updated_by, billing_feature_key)
VALUES ('engagement_decision', 'engagement', 'Engagement AI decisions', NULL, 'decisions', 'engagement',
        '{engagement_decision}', '{}', NULL, 'SCHEDULED', 'SYSTEM', 'TOKENS',
        'AS_TODAY', TRUE, TRUE, FALSE, FALSE,
        TRUE, 173, 'V640', 'engagement_messages')
ON CONFLICT (use_case) DO NOTHING;
