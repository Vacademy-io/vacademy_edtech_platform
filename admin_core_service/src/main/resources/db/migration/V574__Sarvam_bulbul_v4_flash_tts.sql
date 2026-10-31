-- Sarvam Bulbul v4 Flash as a selectable engine ("sarvam_v4", model bulbul:v4-flash).
--
-- A SEPARATE engine id from "sarvam" (v3): the voice palettes are disjoint and the
-- API rejects a v3 speaker on v4 ("Speaker 'priya' is not compatible with model
-- bulbul:v4-flash") — a silent call.
--
-- COST: Rs 1 per 1,000 characters (Sarvam's model page, 2026-10-14; the same on REST,
-- HTTP streaming and WebSocket). At our measured 779 chars/call-min that is
-- Rs 0.779/call-min, under every engine that already carries a zero surcharge
-- (Smallest Rs 1.20, Google Rs 2.06), so it carries none either: 6 credits/min all-in.

INSERT INTO ai_tts_model_pricing (model, surcharge_credits_per_min, description, is_active)
VALUES (
    'sarvam_v4',
    0.0000,
    'Sarvam Bulbul v4 Flash — Rs 1/1K chars (~Rs 0.78/call-min), a third of v3, so no '
    'surcharge. Persona voices (<speaker>_<lang>_<style>) are DISJOINT from v3; a v3 '
    'speaker is rejected outright.',
    TRUE
)
ON CONFLICT (model) DO UPDATE
    SET surcharge_credits_per_min = EXCLUDED.surcharge_credits_per_min,
        description               = EXCLUDED.description,
        is_active                 = EXCLUDED.is_active;

-- Vendor-cost side of the margin report (SuperAdminCallService looks up
-- "tts_" || tts_model). The partial unique index needs its predicate repeated.
INSERT INTO voice_call_rate_card (component, inr_per_min, is_active)
VALUES ('tts_sarvam_v4', 0.7790, TRUE)
ON CONFLICT (component) WHERE is_active DO UPDATE
    SET inr_per_min = EXCLUDED.inr_per_min;
