-- Migration: default the video LLM stages to gemini-3.7-flash
-- Date: 2026-08-29
--
-- Benchmarked on a real run: a 5-minute (300s) product explainer planned from
-- 20 indexed screenshots, same prompt and same assets for every model.
--
--   model                          shots  images used  duration  calls  cost
--   google/gemini-3.7-flash          24       20/20       279s     1    $0.0443
--   openai/gpt-5.6-luna              12       11/20       254s     1    $0.0094
--   google/gemini-3-flash-preview    12        9/20       119s     1    $0.0163
--
-- The incumbent default planned 119 seconds of content against a 300-second
-- target — a 60% shortfall that would ship a two-minute video from a
-- five-minute brief — and used fewer than half the user's screenshots. It is
-- also the more expensive of the two ($0.50/$3.00 per 1M vs $0.37/$1.87).
--
-- The likely mechanism: the client never sends a `reasoning` parameter, so each
-- model runs at its provider default. Measured on these calls, 3.7-flash spends
-- ~1,877 reasoning tokens unrequested while 3-flash-preview spends 0. The
-- thinking is what produces the complete shot list.
--
-- Scope: primary model only, and only where the incumbent is the primary.
--   * vision_review stays pinned to gemini-2.5-pro — it is the quality gate.
--   * fallback_model_id is deliberately left as gemini-3-flash-preview so a
--     failure still fails over to a DIFFERENT, known-working model rather than
--     retrying the same one.
--
-- Both models accept the same input modalities (text, image, video, file,
-- audio) and both carry a 1,048,576-token context, so no stage that sends
-- reference images loses a capability here.
--
-- Rollback: swap the two ids in the UPDATE below.

BEGIN;

UPDATE ai_model_stage_assignments
   SET model_id  = 'google/gemini-3.7-flash',
       updated_at = now()
 WHERE use_case  = 'video'
   AND model_id  = 'google/gemini-3-flash-preview';

COMMIT;
