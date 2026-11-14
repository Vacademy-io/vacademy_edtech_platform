-- package_session_learner_invitation_to_payment_option links an enroll invite
-- to its courses and payment options. It had no index besides its primary key,
-- so every lookup by invite or by course was a full scan: 1.6M seq scans,
-- 15.9B rows read on prod by 2026-09-29. Hot paths:
--   * learner opens an invite link  -> WHERE enroll_invite_id = ?
--   * invite lists (admin Invite page, course details, product-page Courses
--     tab) -> EXISTS / sub-select per invite on enroll_invite_id and
--     package_session_id
-- Measured on a copy of the prod tables: product-page Courses batch
-- 170-254 ms -> 18-20 ms; single-invite lookup 0.89 ms -> 0.04 ms.
-- About 12k rows, so the build takes milliseconds.
CREATE INDEX IF NOT EXISTS idx_package_session_learner_invitation_enroll_invite_id
    ON package_session_learner_invitation_to_payment_option (enroll_invite_id);

CREATE INDEX IF NOT EXISTS idx_package_session_learner_invitation_package_session_id
    ON package_session_learner_invitation_to_payment_option (package_session_id);
