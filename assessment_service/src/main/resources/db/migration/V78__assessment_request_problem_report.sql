-- PROBLEM_REPORT in the learner request inbox (assessment_reattempt_request): a learner in a
-- live exam reports a problem with the question in front of them (a broken image, a missing
-- option, wrong text). question_id records that question so the admin sees which one is
-- meant. An admin closes it as RESOLVED.
ALTER TABLE assessment_reattempt_request ADD COLUMN IF NOT EXISTS question_id VARCHAR(255);

-- The old index allowed one open request per learner, assessment and type. That still holds
-- for REATTEMPT and TIME_INCREASE, but a learner may report several questions, so problem
-- reports allow one open report per question instead.
DROP INDEX IF EXISTS uq_reattempt_request_open;
CREATE UNIQUE INDEX IF NOT EXISTS uq_reattempt_request_open
    ON assessment_reattempt_request (assessment_id, user_id, request_type)
    WHERE status = 'PENDING' AND request_type <> 'PROBLEM_REPORT';
CREATE UNIQUE INDEX IF NOT EXISTS uq_problem_report_open
    ON assessment_reattempt_request (assessment_id, user_id, COALESCE(question_id, ''))
    WHERE status = 'PENDING' AND request_type = 'PROBLEM_REPORT';
