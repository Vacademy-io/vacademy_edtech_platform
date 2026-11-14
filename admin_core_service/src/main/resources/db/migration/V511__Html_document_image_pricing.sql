-- =============================================================================
-- V511: HTML Document slide — per-illustration surcharge
-- -----------------------------------------------------------------------------
-- AI-authored HTML doc pages now draw textbook illustrations (institute
-- feedback: the pages were walls of text, and students learn visually). Each
-- picture is a real image-model call, so charge per illustration that actually
-- came back, on top of the generation charge:
--
--   html_document_image = num_images × 2 credits  (unit_field 'images')
--
-- MUST agree with DEFAULT_TOOL_PRICING['html_document_image'] in
-- ai_service tool_cost_estimator.py. DB row wins while active; tune here.
--
-- V371 widened the unit_field check to allow 'pages'; widen it again for
-- 'images' before inserting a row that uses it.
-- =============================================================================

ALTER TABLE ai_tool_pricing
    DROP CONSTRAINT ai_tool_pricing_unit_field_valid;

ALTER TABLE ai_tool_pricing
    ADD CONSTRAINT ai_tool_pricing_unit_field_valid
        CHECK (unit_field IN ('questions', 'audio_minutes', 'chars', 'flat', 'pages', 'images'));

INSERT INTO ai_tool_pricing (tool_key, request_type, flat_base_credits, per_unit_credits, unit_field, params_json)
VALUES
    ('html_document_image', 'image', 0, 2, 'images', '{}')
ON CONFLICT (tool_key) DO NOTHING;
