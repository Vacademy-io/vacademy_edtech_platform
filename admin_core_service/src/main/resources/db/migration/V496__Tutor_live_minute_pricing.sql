-- Live AI Tutor (docs/ai-tutor/LIVE_TUTOR_DESIGN.md §4.8 / §13): meter voice
-- lessons per started minute. Text lessons are billed per decision turn
-- already; a voice minute also carries Sarvam / Smallest TTS and Sarvam STT,
-- so it is charged as a flat per-minute rate. The rate is the per_unit value
-- of this row (edit it here; the platform default is 3 credits / minute —
-- about the ₹2-3 of vendor cost per learner-minute in the design's §12).
INSERT INTO ai_tool_pricing (tool_key, request_type, flat_base_credits, per_unit_credits, unit_field, params_json)
VALUES ('tutor_live_minute', 'conversation', 0, 3, 'audio_minutes', '{"min_credits": 0}')
ON CONFLICT (tool_key) DO NOTHING;
