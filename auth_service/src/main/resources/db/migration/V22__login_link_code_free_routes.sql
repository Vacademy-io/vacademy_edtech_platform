-- Per-route exemptions for "Require login code" (institute_login_link_policy).
-- Comma-separated LoginLinkRoute names (GO, LIVE_CLASS, SUBSCRIPTIONS, SUB_ORG_LEARNERS,
-- PROFILE_EDIT). A route listed here keeps signing learners in from the username alone even
-- while require_login_code is true. NULL / empty = every route needs a code.
ALTER TABLE public.institute_login_link_policy
    ADD COLUMN IF NOT EXISTS code_free_routes varchar(255) NULL;
