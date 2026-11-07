-- One tracking row per (evaluation process, question)  (AI_EVALUATION_PUBLIC_API.md G6, T0.29).
--
-- A process that was dispatched twice (a sweeper requeue, a stale claim, the
-- 2026-09-20 double dispatch) inserted a second set of ai_question_evaluation rows.
-- One set then completed while the other stayed PENDING, a reviewer's override hit
-- "2 results were returned", and totals could count a question twice. Dispatch now
-- deletes the non-edited rows before inserting a new set; this migration removes the
-- duplicates that already exist and makes a new one impossible.
--
-- Which row survives, per (process, question):
--   1. a row a teacher edited (a human decision is never thrown away),
--   2. then a graded row (COMPLETED), then a FAILED one, then anything else,
--   3. then the newest row (the one the callback writes to), then the larger id.
--
-- Run outside exam hours: the DELETE and the constraint take a lock on the table.
-- Both steps are idempotent (no duplicates left = nothing deleted; constraint guarded).
-- The removed rows are copied to ai_question_evaluation_v53_removed first, so the
-- cleanup can be undone by hand; drop that table once the deploy has settled.

CREATE TABLE IF NOT EXISTS ai_question_evaluation_v53_removed AS
SELECT q.*, now() AS removed_at
FROM ai_question_evaluation q
WHERE false;

INSERT INTO ai_question_evaluation_v53_removed
SELECT q.*, now()
FROM ai_question_evaluation q
JOIN (
    SELECT id,
           row_number() OVER (
               PARTITION BY evaluation_process_id, question_id
               ORDER BY is_edited DESC,
                        CASE status WHEN 'COMPLETED' THEN 0 WHEN 'FAILED' THEN 1 ELSE 2 END,
                        created_at DESC NULLS LAST,
                        id DESC
           ) AS rn
    FROM ai_question_evaluation
) ranked ON ranked.id = q.id
WHERE ranked.rn > 1;

DELETE FROM ai_question_evaluation q
USING (
    SELECT id,
           row_number() OVER (
               PARTITION BY evaluation_process_id, question_id
               ORDER BY is_edited DESC,
                        CASE status WHEN 'COMPLETED' THEN 0 WHEN 'FAILED' THEN 1 ELSE 2 END,
                        created_at DESC NULLS LAST,
                        id DESC
           ) AS rn
    FROM ai_question_evaluation
) ranked
WHERE q.id = ranked.id
  AND ranked.rn > 1;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'uq_ai_question_eval_process_question'
          AND conrelid = 'ai_question_evaluation'::regclass
    ) THEN
        ALTER TABLE ai_question_evaluation
            ADD CONSTRAINT uq_ai_question_eval_process_question UNIQUE (evaluation_process_id, question_id);
    END IF;
END
$$;
