-- Class AI report: one AI-written analysis per ASSESSMENT (not per learner).
--
-- Flat 10 credits, charged ONCE per assessment. The generated report is stored
-- and re-downloadable free thereafter, so this is not a per-download or
-- per-teacher charge.
--
-- Why flat, and why 10. assessment_service sends the charge with
-- prompt_tokens/completion_tokens = 0, so ai_billing's
-- max(parametric, actual x markup) resolves to exactly this number — the
-- teacher is quoted a price and billed that price, with no token drift. Real
-- cost at the ~5k/4k tokens these analytics calls average (measured over
-- 21,566 prod calls) is roughly 7 credits on gemini-2.5-pro at the platform's
-- 150 credits/USD, so 10 covers the model and leaves a margin. Vacademy
-- absorbs the variance across models, which is trivial at one call per paper.
--
-- request_type reuses 'assessment' deliberately: inventing a new one would
-- fail the ai_token_usage_request_type_check CHECK inside record_usage, which
-- the best-effort billing wrapper then swallows — the preview would show a
-- price and the balance would never move.
INSERT INTO ai_tool_pricing (tool_key, request_type, flat_base_credits, per_unit_credits, unit_field, params_json)
VALUES ('assessment_class_ai_report', 'assessment', 10, 0, 'flat', '{"min_credits": 0}')
ON CONFLICT (tool_key) DO NOTHING;
