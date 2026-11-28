-- V25: index the last 10 normalised digits of users.mobile_number.
--
-- UserRepository.findLatestUserByMobileNumber[AndInstitute] (phone / OTP login) matched
-- REGEXP_REPLACE(mobile_number, '[^0-9]', '', 'g') against the typed number, so every call
-- normalised all 254k users' numbers: ~350 ms per lookup (pg_stat_statements, 2026-10-23).
-- Both queries now also require RIGHT(<that>, 10) = RIGHT(:digitsOnly, 10), which their
-- existing conditions already imply, and this index serves it: under 20 ms.
--
-- The expression must stay identical to the one in the queries.
--
-- Prod already has it, built by hand with CREATE INDEX CONCURRENTLY; IF NOT EXISTS makes
-- this a no-op there.

CREATE INDEX IF NOT EXISTS idx_users_mobile_last10
    ON users (RIGHT(REGEXP_REPLACE(mobile_number, '[^0-9]', '', 'g'), 10))
    WHERE mobile_number IS NOT NULL;
