-- V23: expression index for case-insensitive email lookups.
--
-- The login and user-lookup queries all filter WHERE LOWER(u.email) = LOWER(:email).
-- The existing idx_users_email is on the raw column, which that expression cannot use,
-- so every call seq-scanned users (254k rows): 434 ms average over 83k calls for the
-- role-joined variant alone (pg_stat_statements, 2026-10-22).
--
-- Prod already has this index, built by hand with CREATE INDEX CONCURRENTLY; IF NOT
-- EXISTS makes this a no-op there and brings every other environment into line.

CREATE INDEX IF NOT EXISTS idx_users_lower_email
    ON users (LOWER(email));
