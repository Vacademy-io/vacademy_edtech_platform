-- Plivo TTS (model koyal-v1) as a selectable engine ("plivo"), and the default for
-- new agents (voice Meera) from 2026-11-27 — see TtsVoiceCatalog.NEW_AGENT_DEFAULT.
--
-- Billed at the standard per-minute rate: no surcharge, like every engine already
-- on 0. Plivo's TTS docs publish no per-character price, so no vendor-cost row is
-- added to voice_call_rate_card yet; the margin report reads a missing
-- "tts_plivo" as 0 until the real price is known.

INSERT INTO ai_tts_model_pricing (model, surcharge_credits_per_min, description, is_active)
VALUES (
    'plivo',
    0.0000,
    'Plivo TTS koyal-v1 — 33 voices, one language each (Meera: Hindi). Standard rate, no surcharge.',
    TRUE
)
ON CONFLICT (model) DO UPDATE
    SET surcharge_credits_per_min = EXCLUDED.surcharge_credits_per_min,
        description               = EXCLUDED.description,
        is_active                 = EXCLUDED.is_active;
