-- Doubt Management: trackable custom statuses + an audit trail.
--
-- 1) workflow_status: the institute-configurable status key (PENDING / RESOLVED are built in;
--    admins add e.g. IN_PROGRESS, WAITING_ON_LEARNER, ESCALATED in DOUBT_MANAGEMENT_SETTING.statuses).
--    NULL on legacy rows ⇒ derived from the coarse `status` column (RESOLVED → 'RESOLVED', else
--    'PENDING'), so nothing needs a backfill and the learner app's ACTIVE/RESOLVED contract is kept.
ALTER TABLE doubts ADD COLUMN IF NOT EXISTS workflow_status VARCHAR(64);

-- 2) doubt_activity: who did what to a doubt, and whether a person or a routing rule did it.
--    One row per event — assignment (manual or by rule), un-assignment, status change (with an
--    optional remark), or a standalone remark. Read by the admin/teacher timeline; never exposed to
--    learners.
CREATE TABLE IF NOT EXISTS doubt_activity (
    id             VARCHAR(255) PRIMARY KEY,
    doubt_id       VARCHAR(255) NOT NULL,
    action         VARCHAR(32)  NOT NULL,              -- CREATED | ASSIGNED | UNASSIGNED | STATUS_CHANGED | REMARK
    actor_type     VARCHAR(16)  NOT NULL,              -- USER | RULE | SYSTEM
    actor_user_id  VARCHAR(255),                       -- the person, when actor_type = USER
    target_user_id VARCHAR(255),                       -- the (un)assigned staff member
    from_value     VARCHAR(64),                        -- previous status key
    to_value       VARCHAR(64),                        -- new status key (or the status a remark was left on)
    rule_source    VARCHAR(255),                       -- e.g. TYPE:TECHNICAL:ROLE:ADMIN, DEFAULT:SUBJECT_TEACHER, SUB_ORG
    remark         TEXT,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_doubt_activity_doubt_created ON doubt_activity (doubt_id, created_at);

-- 3) Assignee filter in the inbox/board: "doubts assigned to X" is an EXISTS on doubt_assignee by
--    (source_id, status); the same index serves "unassigned only".
CREATE INDEX IF NOT EXISTS idx_doubt_assignee_source_status ON doubt_assignee (source_id, status, doubt_id);
