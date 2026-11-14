-- Access Pass: one purchasable product that unlocks a set of courses (package sessions).
-- Design: docs/accesspass/ACCESS_PASS_IMPLEMENTATION.md
--
-- The pass owns ONE system-managed enroll_invite (tag ACCESS_PASS). Checkout, payment,
-- renewal and cancel all run on that invite and its user_plans, unchanged. These tables
-- add what an invite cannot hold: product identity (slug, tags, cover) for the catalogue,
-- the item list as the source of truth, and a grant ledger so later course additions /
-- removals can be applied to existing holders safely.

CREATE TABLE IF NOT EXISTS access_pass (
    id VARCHAR(36) PRIMARY KEY,
    institute_id VARCHAR(36) NOT NULL,
    name VARCHAR(255) NOT NULL,
    -- URL key for the learner details page, unique per institute among live passes.
    slug VARCHAR(255) NOT NULL,
    short_description TEXT,
    description TEXT,
    cover_image_url TEXT,
    -- Comma-separated, same convention as package.comma_separated_tags.
    tags TEXT,
    -- DRAFT | ACTIVE | ARCHIVED | DELETED. Only ACTIVE passes are listed or purchasable.
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
    -- B2C: sold to learners (catalogue + invite checkout).
    -- B2B: held by sub-orgs (access_pass_sub_org); its courses are pushed to each one.
    audience_type VARCHAR(16) NOT NULL DEFAULT 'B2C',
    -- SELECTED: the items an admin picked. ALL_COURSES: every live course batch of the
    -- institute, kept current by the sync job (new courses join, deleted ones leave).
    course_scope VARCHAR(32) NOT NULL DEFAULT 'SELECTED',
    -- The payment option every included course is sold through (price lives on its plans).
    payment_option_id VARCHAR(255),
    -- The generated invite. Never edited by admins directly.
    enroll_invite_id VARCHAR(255),
    -- What happens to CURRENT holders when a course is removed:
    -- KEEP_FOR_EXISTING (keep until their plan ends) | REVOKE (access removed on next sync).
    on_item_removed VARCHAR(32) NOT NULL DEFAULT 'KEEP_FOR_EXISTING',
    display_order INTEGER NOT NULL DEFAULT 0,
    -- Reserved for tiers / drip / landing-page config.
    settings_json TEXT,
    -- Set when items change; cleared by AccessPassSyncJob once every holder is reconciled.
    needs_sync BOOLEAN NOT NULL DEFAULT FALSE,
    last_synced_at TIMESTAMP,
    created_by VARCHAR(255),
    updated_by VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_access_pass_institute_status
    ON access_pass (institute_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_access_pass_institute_slug_live
    ON access_pass (institute_id, slug)
    WHERE status <> 'DELETED';

CREATE INDEX IF NOT EXISTS idx_access_pass_enroll_invite
    ON access_pass (enroll_invite_id);

CREATE TABLE IF NOT EXISTS access_pass_item (
    id VARCHAR(36) PRIMARY KEY,
    access_pass_id VARCHAR(36) NOT NULL,
    -- Denormalised from the pass so lookups are tenant-scoped on their own.
    institute_id VARCHAR(36) NOT NULL,
    package_session_id VARCHAR(255) NOT NULL,
    -- ACTIVE | REMOVED. Removal is soft so the history of what a pass held survives.
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    display_order INTEGER NOT NULL DEFAULT 0,
    added_by VARCHAR(255),
    removed_by VARCHAR(255),
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    removed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_access_pass_item_pass_status
    ON access_pass_item (access_pass_id, status);

CREATE INDEX IF NOT EXISTS idx_access_pass_item_package_session
    ON access_pass_item (package_session_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_access_pass_item_active
    ON access_pass_item (access_pass_id, package_session_id)
    WHERE status = 'ACTIVE';

-- Grant ledger: one row per (holder plan, course). GRANTED = the access row carries the
-- holder's plan (the pass owns it, so it may revoke it). COVERED = the learner already
-- held the course through another plan, so the pass left that row alone.
CREATE TABLE IF NOT EXISTS access_pass_grant (
    id VARCHAR(36) PRIMARY KEY,
    access_pass_id VARCHAR(36) NOT NULL,
    user_plan_id VARCHAR(255) NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    package_session_id VARCHAR(255) NOT NULL,
    ssigm_id VARCHAR(255),
    grant_type VARCHAR(32) NOT NULL,
    -- ACTIVE | REVOKED
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMP,
    revoke_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_access_pass_grant_plan_ps
    ON access_pass_grant (user_plan_id, package_session_id);

CREATE INDEX IF NOT EXISTS idx_access_pass_grant_pass_status
    ON access_pass_grant (access_pass_id, status);

CREATE INDEX IF NOT EXISTS idx_access_pass_grant_user
    ON access_pass_grant (user_id);

-- B2B: which sub-orgs hold a pass. The sync job pushes the pass's courses to each
-- ACTIVE row through SubOrgSubscriptionService.addSubOrgPackageSessions.
CREATE TABLE IF NOT EXISTS access_pass_sub_org (
    id VARCHAR(36) PRIMARY KEY,
    access_pass_id VARCHAR(36) NOT NULL,
    institute_id VARCHAR(36) NOT NULL,
    sub_org_id VARCHAR(255) NOT NULL,
    -- ACTIVE | REMOVED
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    assigned_by VARCHAR(255),
    removed_by VARCHAR(255),
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    removed_at TIMESTAMP,
    last_synced_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_access_pass_sub_org_active
    ON access_pass_sub_org (access_pass_id, sub_org_id)
    WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_access_pass_sub_org_sub_org
    ON access_pass_sub_org (sub_org_id, status);
