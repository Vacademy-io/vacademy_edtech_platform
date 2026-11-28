-- Email billing (notification-service V40): emails beyond each institute's 1,000 free a month cost
-- 0.04 credit per recipient (25 per credit), from the same wallet as AI. notification-service
-- totals the usage and charges it hourly through /admin-core-service/internal/credits/v1/email/charge,
-- which deducts a precomputed amount (CreditClient.deductPrecomputed, request_type 'email').

-- Rate on record. The CHARGED amount is computed by notification-service (email_billing_settings
-- .credits_per_unit) and MUST be kept in sync with token_rate here.
INSERT INTO credit_pricing (request_type, base_cost, token_rate, minimum_charge, unit_type, description, is_active)
VALUES ('email', 0, 0.04, 0, 'emails',
        'Emails sent through Vacademy beyond the 1,000 free each month (per recipient, 25 per credit)', TRUE)
ON CONFLICT (request_type) DO NOTHING;

-- Always charged: an AI plan never includes emails.
INSERT INTO ai_billing_feature (feature_key, label, description, eligibility, locked, display_order, updated_by)
VALUES ('email_sends', 'Emails', 'Emails sent to learners, staff and leads beyond the free monthly allowance.',
        'ALWAYS_CHARGED', TRUE, 97, 'V653')
ON CONFLICT (feature_key) DO NOTHING;

-- Usage history shows these charges as "Emails sent" instead of unknown.
INSERT INTO ai_use_case_catalog
    (use_case, feature_group, label, label_template, count_unit_label, model_use_case,
     legacy_request_types, tool_keys, capability_key, default_surface, actor_kind, unit_kind,
     billing_policy, plan_eligible, limit_eligible, reserve_on_authorize, intentionally_separate,
     is_active, display_order, updated_by, billing_feature_key)
VALUES ('email_send', 'email', 'Emails sent', 'Emails sent — {units} beyond the free allowance', 'emails', NULL,
        '{email}', '{}', NULL, 'SCHEDULED', 'SYSTEM', 'REQUESTS',
        'AS_TODAY', FALSE, FALSE, FALSE, FALSE,
        TRUE, 175, 'V653', 'email_sends')
ON CONFLICT (use_case) DO NOTHING;
