-- CRM Call Intelligence: on by default for AI-agent calls, cheaper for human calls.
--
-- Founder decisions 2026-09-11:
--   * Every AI-agent call is analysed automatically and at NO extra charge — the
--     call is already billed per minute (ai_call_out/in), and the analysis now
--     costs us ~$0.002/min on OpenRouter (gpt-4o-mini-transcribe + GLM-5.3-flash)
--     instead of a CPU Whisper box that answered "at capacity" on 45% of runs.
--     The free/paid split is decided by the poller (ai_service) from
--     telephony_call_log.provider_type; the enqueue default lives in
--     CallIntelligenceEnqueueService.
--   * Human/telephony calls stay manual (institute setting) and drop from 0.5 to
--     0.15 credits per minute of recording.
--
-- `short_update`: the analysis' two-line "what happened / what's next" for the
-- call log row (schema 1.1). Nullable — rows analysed before this migration
-- have none until re-analysed.
ALTER TABLE call_intelligence ADD COLUMN IF NOT EXISTS short_update VARCHAR(200);

UPDATE credit_pricing
SET token_rate = 0.15,
    minimum_charge = 0.15,
    base_cost = 0,
    unit_type = 'minutes',
    description = 'Call recording transcription + analysis (per minute of recording; human calls only — AI-agent calls are analysed free)',
    updated_at = now()
WHERE request_type = 'call_intelligence';

-- Backfill: every AI-agent call whose analysis died on the old transcription box
-- ("Transcription server at capacity (429)" — 525 rows in 60 days), got stuck
-- mid-pipeline, or was skipped for credits now gets one fresh run. Free for
-- these providers, so no institute is charged; human-call failures are left
-- alone (a re-run would bill them).
UPDATE call_intelligence ci
SET status = 'PENDING', attempts = 0, error = NULL, skip_reason = NULL, job_id = NULL,
    updated_at = now()
FROM telephony_call_log t
WHERE t.id = ci.call_log_id
  AND t.provider_type IN ('VACADEMY_AI', 'AAVTAAR', 'MOCK')
  AND t.recording_storage_key IS NOT NULL
  AND (ci.status = 'FAILED'
       OR (ci.status IN ('TRANSCRIBING', 'ANALYZING') AND ci.updated_at < now() - interval '1 hour')
       OR (ci.status = 'SKIPPED' AND ci.skip_reason = 'INSUFFICIENT_CREDITS'));
