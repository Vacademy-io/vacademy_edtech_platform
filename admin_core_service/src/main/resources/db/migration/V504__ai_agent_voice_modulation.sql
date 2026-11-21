-- Per-agent voice modulation (pitch-range expansion) for AI calls.
--
-- Clients, 2026-09-11: "the tone is very simple and linear — bot like". The TTS
-- engines expose no usable prosody control, and the founder wants a fix that does
-- not depend on the engine, so the voice bot now reshapes the AUDIO itself
-- (voice_bot_service/app/prosody.py): every pitch excursion around the voice's
-- own median is scaled by this factor. 1.0 = off (the audio is untouched),
-- 1.6 = conversational (measured: Smallest/mrunal 2.9 -> 3.9 semitones of pitch
-- spread, Hindi 3.4 -> 4.7), 2.5 = hard ceiling, matched by the bot's own clamp.
--
-- A column and not an env var for the same reason as speech_cache_mode (V466):
-- rollout is per agent — one agent, one listening test, then widen — and that
-- belongs where the agent is configured. The bot's PROSODY_EXPAND env stays as
-- the global default (off) and kill switch.
--
-- NULL = "use the bot's global default". No DEFAULT on purpose: a NULL is a real
-- state here (follow the box), distinct from an explicit 1.0 (off, whatever the
-- box says). Nullable for the Hibernate @Builder reason documented in V466.
ALTER TABLE ai_agent
    ADD COLUMN IF NOT EXISTS voice_modulation DOUBLE PRECISION;

ALTER TABLE ai_agent DROP CONSTRAINT IF EXISTS ck_ai_agent_voice_modulation;
ALTER TABLE ai_agent ADD CONSTRAINT ck_ai_agent_voice_modulation
    CHECK (voice_modulation IS NULL OR (voice_modulation >= 1.0 AND voice_modulation <= 2.5));
