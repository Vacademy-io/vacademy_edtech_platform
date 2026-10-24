-- Navana (Bodhi) TTS on the call card's vendor-cost side.
--
-- Navana's pricing page (seen 2026-09-30): Rs 12 per 10K characters, billed on
-- input characters counted by Unicode code point, streaming at no extra charge.
-- The card stores TTS per CALL-MINUTE on the same 779 chars/call-min basis as
-- every other engine: 12 / 10000 x 779 = Rs 0.9348. The bot meters Navana's real
-- characters (diagnostics.tts.chars), so calls are priced on those; this rate is
-- the per-character price through that basis, and the fallback for calls without.
-- Vendor cost only — what an institute is billed is not changed here.
INSERT INTO voice_call_rate_card (component, inr_per_min, kind, is_measured, notes)
SELECT 'tts_navana', 0.9348, 'COST', false,
       'Navana (Bodhi) Rs 12/10K chars x 779 chars/call-min (pricing page 2026-09-30)'
WHERE NOT EXISTS (SELECT 1 FROM voice_call_rate_card
                  WHERE component = 'tts_navana' AND is_active);
