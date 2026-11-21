-- =============================================================================
-- Follow-up gist + measured caller engagement on AI voice calls.
--
-- TWO SEPARATE JOBS, deliberately in one migration because the voice bot starts
-- emitting both in the same release.
--
-- 1. FOLLOW-UP GIST (follow_up, follow_up_gist) — ONE SENTENCE written for the
--    counsellor deciding whether to pick up the phone for this lead themselves:
--    the recommendation and the concrete reason from the call.
--      "Worth a call — runs a 50-member hybrid studio, sends links by hand,
--       asked about pricing."
--      "Skip — reached a school reception, not a yoga trainer."
--      "Call back Tuesday after 4pm — she asked for that slot; sounded keen."
--    It is NOT a grade of our agent and NOT the disposition restated. The
--    disposition is a label from a closed list; lead_rating is a number; neither
--    tells a human what happened on the call or what to do about it. This does,
--    in one glance from the Call Log — including on the calls that ended
--    Incomplete because the audio broke or a label was refused, which is exactly
--    where the engaged-but-unjudged routing below now hands a counsellor a lead
--    with no usable label.
--    follow_up (CALL / CALL_LATER / SKIP) exists only to colour the sentence and
--    to filter on ("show me the ones worth calling"). It is never rendered as a
--    word on its own.
--
-- 2. ENGAGEMENT (caller_word_count) — how many words the caller actually said.
--    A MEASURED number, not a model judgement, and that is the whole point: the
--    outcome classifier now routes an "engaged but unjudged" call to a human off
--    this column instead of off the disposition string. The 2026-09-09 audit
--    found a 428-second call in which the caller said 433 words land on
--    Incomplete_Call, and a 196-second engaged call land on Incomplete and go to
--    RETRY — i.e. re-dial someone who had just held a three-minute conversation.
--    Routing on a fact rather than on the label fixes that without trusting the
--    classifier we had just caught inventing things.
--
-- ALL THREE COLUMNS ARE NULLABLE. Every existing row predates the fields, and
-- non-AI providers never send them. For follow_up a NULL means NOT ASSESSED —
-- never read it as CALL, the same contract V416 set for diag_health. For
-- caller_word_count a NULL means NOT MEASURED, which is NOT the same as 0 (a
-- genuine silent pickup); the classifier treats null as "unknown, do not change
-- routing" so untouched history keeps its current behaviour.
-- =============================================================================

ALTER TABLE ai_call_result ADD COLUMN IF NOT EXISTS follow_up         varchar(16)  NULL;
ALTER TABLE ai_call_result ADD COLUMN IF NOT EXISTS follow_up_gist    varchar(255) NULL;
ALTER TABLE ai_call_result ADD COLUMN IF NOT EXISTS caller_word_count integer      NULL;

COMMENT ON COLUMN ai_call_result.follow_up IS
    'CALL / CALL_LATER / SKIP — should a human counsellor call this lead next. Colours follow_up_gist and feeds a filter; never shown as a word on its own. NULL = not assessed; never read as CALL.';
COMMENT ON COLUMN ai_call_result.follow_up_gist IS
    'One sentence for the counsellor deciding whether to call this lead themselves: the recommendation and the concrete reason from the call, e.g. "Worth a call - runs a 50-member hybrid studio, asked about pricing." Capped at 240 chars by the bot. NULL = not assessed.';
COMMENT ON COLUMN ai_call_result.caller_word_count IS
    'Words the caller actually contributed, measured from the transcript (synthetic bracketed cues excluded). Drives the classifier''s engaged-but-unjudged -> assign-to-human branch. NULL = not measured (pre-existing rows), which is NOT 0.';

-- Counsellor view: "show me the leads worth calling". Partial, because the vast
-- majority of history has no recommendation at all and indexing nulls would only
-- bloat it — the same shape as idx_ai_call_result_diag_health.
CREATE INDEX IF NOT EXISTS idx_ai_call_result_follow_up
    ON ai_call_result (institute_id, follow_up, received_at DESC)
    WHERE follow_up IS NOT NULL;
