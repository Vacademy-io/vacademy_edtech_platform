-- Live-session instructors (presenters) + role-based session visibility.
--
-- Instructors are DELIBERATELY a separate table from live_session_participants:
-- that table is the LEARNER AUDIENCE (source_type USER|BATCH) and drives the
-- learner lists, notifications and the guest/paid join gates. Adding an
-- INSTRUCTOR source_type there would have put staff into every learner query
-- that filters on source_type = 'USER'.
--
-- No backfill: a session with no ACTIVE instructor row falls back to
-- live_session.created_by_user_id everywhere (see LiveSessionVisibilityService
-- and LiveSessionInstructorService), so every session that exists today keeps
-- working and stays visible to whoever created it.

CREATE TABLE IF NOT EXISTS live_session_instructors (
    id           VARCHAR(255) PRIMARY KEY,
    session_id   VARCHAR(255) NOT NULL,
    user_id      VARCHAR(255) NOT NULL,
    status       VARCHAR(50)  NOT NULL DEFAULT 'ACTIVE',
    created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One row per (session, user). Removal is a soft delete (status = 'DELETED'),
-- so the uniqueness is on the pair and not on the pair-plus-status: re-adding a
-- previously removed instructor reactivates the existing row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_live_session_instructors_session_user
    ON live_session_instructors (session_id, user_id);

-- Drives the "sessions I instruct" half of the visibility predicate.
CREATE INDEX IF NOT EXISTS idx_live_session_instructors_user_active
    ON live_session_instructors (user_id)
    WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_live_session_instructors_session_active
    ON live_session_instructors (session_id)
    WHERE status = 'ACTIVE';

-- The visibility predicate's creator-fallback arm filters on created_by_user_id
-- within an institute; that column was previously never queried.
--
-- live_session predates this service's migration user and is postgres-owned on
-- prod, where DDL against it has failed with 42501 before. This index is a pure
-- performance aid -- the predicate is correct without it -- so an ownership
-- failure must not fail the migration and block the deploy.
DO $$
BEGIN
    CREATE INDEX IF NOT EXISTS idx_live_session_institute_created_by
        ON live_session (institute_id, created_by_user_id);
EXCEPTION
    WHEN insufficient_privilege THEN
        RAISE NOTICE 'skipping idx_live_session_institute_created_by: %', SQLERRM;
END
$$;
