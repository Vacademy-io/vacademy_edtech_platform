-- Vendor-cost side of the super-admin call card, re-measured 2026-09-23.
--
-- These rows feed ONLY SuperAdminCallService's cost/margin breakdown — never
-- what an institute is billed (that is billed_base_credits_per_min + the
-- ai_tts_model_pricing surcharges, untouched here). The August values predate
-- Gemini, Smallest Pro at today's FX and Plivo's 30-second pulses, and put a
-- 1:45 Shreya call at Rs 5.17 against ~Rs 3.9 actually spent.
--
--   plivo            Rs 0.38/min, billed per 30 s pulse (the pulse rounding is
--                    in SuperAdminCallService.breakdown, not here).
--   stt_sarvam       Sarvam bills PROCESSED SPEECH only (Rs 30/h), not the call:
--                    its 22 Sep dashboard was Rs 16.21 over 191.5 call-minutes
--                    = Rs 0.085 per call-minute.
--   llm              Gemini 2.5 Flash on Vertex, Google bill for 23 Sep:
--                    Rs 78.78 over 134.1 call-minutes = Rs 0.59 (54% of input
--                    tokens served from Gemini's implicit cache at ~10%).
--   tts_smallest_pro $0.195 per 10K chars x Rs 95.6/USD (the rate implied by the
--                    same Google bill) x 779 chars/call-min = Rs 1.45. Only the
--                    fallback now: the bot meters diagnostics.tts.chars exactly
--                    for Smallest, and the card prices those characters.
--
-- voice_call_rate_card's unique index is PARTIAL (WHERE is_active), so rows
-- are addressed by component AND is_active.

UPDATE voice_call_rate_card SET inr_per_min = 0.3800, updated_at = now(),
       notes = 'Plivo Rs 0.38/min, 30 s pulses (ceiled in code). Re-measured 2026-09-23.'
 WHERE component = 'plivo' AND is_active;

UPDATE voice_call_rate_card SET inr_per_min = 0.0850, updated_at = now(),
       notes = 'Sarvam STT Rs 30/h of processed speech = Rs 16.21 / 191.5 call-min (22 Sep dashboard).'
 WHERE component = 'stt_sarvam' AND is_active;

UPDATE voice_call_rate_card SET inr_per_min = 0.5900, updated_at = now(),
       notes = 'Gemini 2.5 Flash (Vertex) Rs 78.78 / 134.1 call-min, Google bill 23 Sep 2026.'
 WHERE component = 'llm' AND is_active;

UPDATE voice_call_rate_card SET inr_per_min = 1.4500, updated_at = now(),
       notes = 'Smallest Pro $0.195/10K chars x Rs 95.6 x 779 chars/call-min; per-call chars preferred.'
 WHERE component = 'tts_smallest_pro' AND is_active;
