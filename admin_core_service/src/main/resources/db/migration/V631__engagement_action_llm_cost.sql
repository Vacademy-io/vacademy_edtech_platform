-- V631: what the engine's thinking cost, per decision.
--
-- The brain's token counts came back on every LLM response but were dropped before reaching
-- engagement_action (llm_tokens_in/out existed and stayed NULL). From now on each action the brain
-- produced carries its tokens (summed across the strict-JSON retry), the model that answered, and
-- the USD price at decision time (ai_models per-1M prices). The engagement daily report sums these
-- per engine per day. Rows written before this migration stay NULL — there is nothing to backfill.

-- engagement_action is written by every engine tick: the ALTERs' brief exclusive lock must not
-- queue behind a long transaction (and stall the engines behind it). If the lock is not free in
-- 10 s the migration fails cleanly (Flyway runs it in one transaction) and the next deploy retries.
SET LOCAL lock_timeout = '10s';

ALTER TABLE engagement_action ADD COLUMN IF NOT EXISTS llm_model VARCHAR(255);
ALTER TABLE engagement_action ADD COLUMN IF NOT EXISTS llm_cost_usd NUMERIC(14,8);
