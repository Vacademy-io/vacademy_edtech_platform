-- One row per "this sub-org's staff must leave because its admin left". Only written when the
-- institute has SUB_ORG_ADMIN_EXIT_CASCADE switched on.
--
-- A hard exit writes a row due now; a soft cancel writes one due on the last access date. Both are
-- worked by SubOrgMemberCascadeJob, so a pod restart cannot leave a practice half terminated:
-- a retry only picks up staff who are still ACTIVE.
--
-- status: PENDING, DONE, FAILED, SUPERSEDED (a newer exit replaced it), REINSTATED (admin access was
-- extended before the date), SETTING_OFF (switch turned off before the date), OTHER_ADMIN (the
-- sub-org still has an active admin, so staff stay).

CREATE TABLE IF NOT EXISTS sub_org_member_cascade (
    id                 VARCHAR(255) PRIMARY KEY,
    institute_id       VARCHAR(255) NOT NULL,
    sub_org_id         VARCHAR(255) NOT NULL,
    package_session_id VARCHAR(255) NOT NULL,
    admin_user_id      VARCHAR(255) NOT NULL,
    actor_user_id      VARCHAR(255),
    effective_at       TIMESTAMP    NOT NULL,
    terminate_admin    BOOLEAN      NOT NULL DEFAULT FALSE,
    admin_notified     BOOLEAN      NOT NULL DEFAULT FALSE,
    status             VARCHAR(20)  NOT NULL DEFAULT 'PENDING',
    attempts           INT          NOT NULL DEFAULT 0,
    terminated_count   INT          NOT NULL DEFAULT 0,
    error_message      TEXT,
    processed_at       TIMESTAMP,
    created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sub_org_member_cascade_due
    ON sub_org_member_cascade (effective_at)
    WHERE status = 'PENDING';

CREATE UNIQUE INDEX IF NOT EXISTS uq_sub_org_member_cascade_pending
    ON sub_org_member_cascade (sub_org_id, package_session_id, admin_user_id)
    WHERE status = 'PENDING';
