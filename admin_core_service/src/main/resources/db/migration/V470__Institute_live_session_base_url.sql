-- =====================================================================
-- V470: Per-institute live-class domain (BBB white-labelling)
-- =====================================================================
-- Institutes that serve live classes from their own subdomain (e.g.
-- meet.zoeedtech.com) record it here. NULL means "use the platform
-- default", i.e. the pool server's own domain (meet.vacademy.io).
--
-- Sits alongside learner_portal_base_url / admin_portal_base_url /
-- teacher_portal_base_url, which are the same kind of fact about the
-- same entity.
--
-- Two deliberate constraints on how this value is used, both enforced in
-- BbbMeetingManager rather than here:
--
--  1. ONLY the join URL handed to a participant is rewritten to this
--     host. Control-plane calls (create / isMeetingRunning /
--     getRecordings / getAttendance) always use the pool server's own
--     api_url. A broken custom domain therefore costs branding on a
--     link, never a class: meetings still get created and recorded.
--
--  2. The rewrite is skipped unless the meeting was placed on the
--     PRIMARY pool server. The institute's A record points at exactly
--     one box; if a meeting spills to a lower-priority server and we
--     still rewrote the host, we would send the learner to a server
--     that does not have their meeting. Falling back to the canonical
--     domain gives an off-brand URL that works, instead of a branded
--     URL that does not.
--
-- Stored as a bare hostname (no scheme, no path, no port) and
-- normalised on write. Note the sibling *_portal_base_url columns are
-- inconsistent about this -- their defaults are bare hosts while
-- WhiteLabelService writes https://-prefixed values -- so this column
-- deliberately does not follow that precedent.
-- =====================================================================

ALTER TABLE institutes
    ADD COLUMN IF NOT EXISTS live_session_base_url VARCHAR(255);

COMMENT ON COLUMN institutes.live_session_base_url IS
    'Custom live-class hostname, e.g. meet.zoeedtech.com. NULL = use the default pool domain. Must resolve to the PRIMARY BBB pool server, and must be present as a SAN on that server''s certificate.';
