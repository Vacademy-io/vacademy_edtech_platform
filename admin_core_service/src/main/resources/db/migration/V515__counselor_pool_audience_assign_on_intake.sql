-- Per-list choice of WHEN a pool hands out a counsellor.
--
-- Until now every pooled list assigned at intake: the moment a lead was submitted, the
-- round-robin picked an owner. That is wrong for an AI-first list, where the bot should
-- call the lead first and a person should only be assigned once the call qualified it
-- (or the retries ran out). The CALL_AI node refuses to dial an owned lead, so intake
-- assignment and AI-first calling were mutually exclusive.
--
-- assign_on_intake = TRUE  (default)  : unchanged — assign when the lead arrives.
-- assign_on_intake = FALSE            : intake skips this list; the pool still answers
--                                       on-demand requests (the AI-call outcome processor,
--                                       the exhausted-retries hand-off).
ALTER TABLE public.counselor_pool_audience
    ADD COLUMN IF NOT EXISTS assign_on_intake BOOLEAN NOT NULL DEFAULT TRUE;
