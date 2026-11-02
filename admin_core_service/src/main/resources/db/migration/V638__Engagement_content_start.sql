-- Daily engagement: RELATIVE plans that start when a learner completes a chosen
-- subject, module or chapter of the batch, instead of on their join day.
--
-- start_trigger      JOIN (default, every older plan) or CONTENT.
-- start_source_type  SUBJECT, MODULE or CHAPTER (CONTENT only).
-- start_source_id    the subject, module or chapter id.
-- start_source_name  its name when picked, for labels only.
-- start_threshold    completion percent that counts as done (1 to 100).
ALTER TABLE public.engagement_plan
    ADD COLUMN IF NOT EXISTS start_trigger varchar(16) NOT NULL DEFAULT 'JOIN',
    ADD COLUMN IF NOT EXISTS start_source_type varchar(16) NULL,
    ADD COLUMN IF NOT EXISTS start_source_id varchar(255) NULL,
    ADD COLUMN IF NOT EXISTS start_source_name varchar(512) NULL,
    ADD COLUMN IF NOT EXISTS start_threshold int4 NULL;

-- When each learner first counted as having completed the start content.
-- learner_operation.updated_at moves on every progress recompute, so the moment is
-- copied here once and never changed: a learner's Day 1 must not drift.
CREATE TABLE IF NOT EXISTS public.engagement_plan_learner_start (
    plan_id    varchar(255) NOT NULL,
    user_id    varchar(255) NOT NULL,
    started_at timestamp    NOT NULL,
    created_at timestamp    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT engagement_plan_learner_start_pkey PRIMARY KEY (plan_id, user_id)
);
