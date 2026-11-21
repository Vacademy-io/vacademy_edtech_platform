-- V488: give a workflow execution a subject (the learner/lead it ran FOR) and enough
-- recorded input to re-run it.
--
-- Why: the learner side-view needs a "Workflows" tab answering "which automations ran
-- for THIS person, and did they work?", plus a Retry button. Neither was possible before:
--
--   * workflow_execution has no user column. Executions were only reachable by workflow,
--     schedule or trigger. EnrollmentWorkflowRunService had to go the long way round —
--     trigger.event_id = packageSessionId -> latest execution — which only works for
--     course-attached enrollment triggers and can never scope to one learner.
--
--   * The seed context (the trigger payload the run was handed) lived only in memory.
--     Once the run finished there was nothing left to re-run it WITH. Only paused runs
--     keep a context, in workflow_execution_state.serialized_context, and that is the
--     mid-flight context of a specific pause, not the original inputs.
--
-- Both columns are nullable and stay NULL for bulk/scheduled runs that have no single
-- subject (a QUERY node fanning out over hundreds of learners is not "a run for Priya").
--
-- This migration is schema-only. It does NOT backfill: rows written before it keep NULL,
-- are simply not listed on anyone's tab, and cannot be retried. The API says so
-- explicitly rather than guessing a subject from an idempotency key (a random UUID under
-- the default strategy, encoding no subject). Attributing historical runs is a separate,
-- deliberate decision about existing production data -- not a side effect of adding a column.

ALTER TABLE workflow_execution
    ADD COLUMN IF NOT EXISTS subject_user_id       VARCHAR(255),
    ADD COLUMN IF NOT EXISTS seed_context          JSONB,
    ADD COLUMN IF NOT EXISTS retry_of_execution_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS retried_by_user_id    VARCHAR(255);

COMMENT ON COLUMN workflow_execution.subject_user_id IS
    'The auth user this run was for, resolved from the trigger context at dispatch. NULL for bulk/scheduled runs with no single subject.';
COMMENT ON COLUMN workflow_execution.seed_context IS
    'JSON-safe snapshot of the seed context the run started from, so it can be re-run with the same inputs. NULL = not retryable.';
COMMENT ON COLUMN workflow_execution.retry_of_execution_id IS
    'Set on a run created by the Retry action; points at the execution it re-runs. Self-referencing, no FK so a purge of old executions cannot cascade.';
COMMENT ON COLUMN workflow_execution.retried_by_user_id IS
    'Admin who pressed Retry. NULL for runs the engine started on its own.';

-- The tab's only query: this learner's runs, newest first. Partial — the overwhelming
-- majority of rows are subject-less scheduled runs the index would never serve.
CREATE INDEX IF NOT EXISTS idx_workflow_execution_subject_user
    ON workflow_execution (subject_user_id, started_at DESC)
    WHERE subject_user_id IS NOT NULL;
