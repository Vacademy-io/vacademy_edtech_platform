-- LLM cost from each call's own tokens instead of a per-minute average.
--
-- The call card priced Gemini at a flat Rs 0.59 per call-minute, derived from one
-- day's Google bill (23 Sep, 54% of input served from the implicit cache). Every
-- call now reports its real usage (diagnostics.infra.llmUsage: promptTokens,
-- cachedTokens, completionTokens), and the flat rate under-read short calls, whose
-- first turns are uncached: 30 Sep calls 0504b1c7 / f6764346 cost Rs 1.71 / 2.16
-- by their tokens against Rs 1.31 / 1.90 on the card.
--
-- inr_per_min holds Rs per MILLION TOKENS for these three components (the column
-- is a generic rate; the _per_mtok suffix is what SuperAdminCallService reads).
-- Gemini 2.5 Flash on Vertex, standard tier, at the Rs 95.6/USD the rest of the
-- card uses: $0.30 input, $0.03 cached input, $2.50 output per 1M tokens.
-- The flat 'llm' row stays as the fallback for calls without usage data.
INSERT INTO voice_call_rate_card (component, inr_per_min, kind, is_measured, notes)
SELECT v.component, v.rate, 'COST', false, v.notes
FROM (VALUES
    ('llm_in_per_mtok',     28.6800, 'Gemini 2.5 Flash input, $0.30/1M x Rs 95.6'),
    ('llm_cached_per_mtok',  2.8680, 'Gemini 2.5 Flash cached input, $0.03/1M x Rs 95.6'),
    ('llm_out_per_mtok',   239.0000, 'Gemini 2.5 Flash output, $2.50/1M x Rs 95.6')
) AS v(component, rate, notes)
WHERE NOT EXISTS (SELECT 1 FROM voice_call_rate_card c
                  WHERE c.component = v.component AND c.is_active);
