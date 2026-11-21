-- Data-only backfill: users.last_login_time for accounts that DID sign in but never had it
-- stamped. The Teams page reads last_login_time IS NULL as "Not signed in yet"; on prod
-- ~70 active staff with a NULL stamp have sign-in evidence:
--   refresh_token  one row per user, written by every login (created_on / created_at)
--   user_session   one row per learner-portal session (login_time)
--
-- Only NULL stamps are filled, only where evidence exists, with the latest evidence, and only
-- for STAFF (a role here other than STUDENT/PARENT, any status). Learners are left alone on
-- purpose: UserRepository.findUsersInactiveOnDate falls back to created_at for a NULL stamp,
-- so filling theirs would start "inactive for N days" messages that never fired before.
-- Re-running changes nothing (no NULL row with evidence is left). No schema change; nothing
-- but last_login_time is set by this statement (the existing BEFORE UPDATE trigger on users
-- may still refresh updated_at, exactly as any application update does). Needs only UPDATE
-- on users and SELECT on refresh_token / user_session — no ownership, no ALTER.
-- One aggregate pass per evidence table (GROUP BY), joined once — no per-row subqueries.
UPDATE public.users u
SET last_login_time = ev.signed_in_at
FROM (
    SELECT e.user_id, MAX(e.signed_in_at) AS signed_in_at
    FROM (
        SELECT rt.user_id, GREATEST(rt.created_on, rt.created_at) AS signed_in_at
        FROM public.refresh_token rt
        WHERE rt.user_id IS NOT NULL
        UNION ALL
        SELECT us.user_id, us.login_time AS signed_in_at
        FROM public.user_session us
    ) e
    WHERE e.signed_in_at IS NOT NULL
    GROUP BY e.user_id
) ev
WHERE u.id = ev.user_id
  AND u.last_login_time IS NULL
  AND EXISTS (SELECT 1
                FROM public.user_role ur
                JOIN public.roles r ON r.id = ur.role_id
               WHERE ur.user_id = u.id
                 AND upper(r.role_name) NOT IN ('STUDENT', 'PARENT'));
