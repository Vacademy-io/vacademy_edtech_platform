-- LLM token rates PER MODEL, keyed by the model each call records.
--
-- V542's three llm_*_per_mtok rows are Gemini 2.5 Flash's, and every call's
-- tokens were priced at them. Since 2026-10-26 14:47 UTC calls talk on Sarvam's
-- gemma4 (diagnostics.llm.vendor = 'sarvam/gemma4'), which Sarvam bills at Rs 35
-- input / Rs 10 cached input / Rs 90 output per 1M tokens. Its calls are ~83%
-- cached tokens, which the Gemini card priced at Rs 2.868, so they read about
-- half their real LLM cost: call 15:10 UTC Rs 0.15 on the card against Rs 0.38.
--
-- SuperAdminCallService looks up '<component>@<diagnostics.llm.vendor>' first
-- and falls back to the plain V542 rows, so calls on Gemini, and older calls,
-- keep the numbers they showed before. Rs per MILLION TOKENS, in INR as Sarvam
-- prices them (pricing page, 2026-10-26). sarvam-105b serves post-call analysis
-- and the agents routed to it.
INSERT INTO voice_call_rate_card (component, inr_per_min, kind, is_measured, notes)
SELECT v.component, v.rate, 'COST', false, v.notes
FROM (VALUES
    ('llm_in_per_mtok@sarvam/gemma4',          35.0000, 'Sarvam gemma4 input, Rs 35/1M (pricing page 2026-10-26)'),
    ('llm_cached_per_mtok@sarvam/gemma4',      10.0000, 'Sarvam gemma4 cached input, Rs 10/1M (pricing page 2026-10-26)'),
    ('llm_out_per_mtok@sarvam/gemma4',         90.0000, 'Sarvam gemma4 output, Rs 90/1M (pricing page 2026-10-26)'),
    ('llm_in_per_mtok@sarvam/sarvam-105b',     15.0000, 'Sarvam 105B input, Rs 15/1M (pricing page 2026-10-26)'),
    ('llm_cached_per_mtok@sarvam/sarvam-105b',  5.0000, 'Sarvam 105B cached input, Rs 5/1M (pricing page 2026-10-26)'),
    ('llm_out_per_mtok@sarvam/sarvam-105b',    60.0000, 'Sarvam 105B output, Rs 60/1M (pricing page 2026-10-26)')
) AS v(component, rate, notes)
WHERE NOT EXISTS (SELECT 1 FROM voice_call_rate_card c
                  WHERE c.component = v.component AND c.is_active);
