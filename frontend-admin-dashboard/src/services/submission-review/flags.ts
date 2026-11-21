/**
 * The old AI review page (/assessment/evaluation-ai/$attemptId/$processId) redirects to the
 * Submission page when this is true (contract §9.2). It ships true because the Submission
 * page carries everything the old page did: per-question marks + feedback (Edit marks),
 * the AI's criteria breakdown and reasons, CBE sheets + model solution, pen-note edits,
 * Redraw checked copy, live run progress with Stop, and the rubric-changed badge.
 * Set it to false (and redeploy the admin app) to bring the old page back.
 */
export const SUBMISSION_PAGE_REPLACES_AI_REVIEW = true;
