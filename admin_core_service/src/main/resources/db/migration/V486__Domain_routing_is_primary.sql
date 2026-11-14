-- =====================================================================
-- V486: Remember which white-label host is an institute's portal URL
-- =====================================================================
-- institutes.learner_portal_base_url / admin_portal_base_url /
-- teacher_portal_base_url are the one curated portal origin per role.
-- Every outbound learner link is built from them (LearnerPortalUrlResolver,
-- LearnerPortalAccessService, enrollment mails, bulk assignment), so a
-- value that does not actually serve is a dead link in a real email.
--
-- Until now the choice of WHICH configured host becomes that value lived
-- only in the setup request body (`is_primary` on a WhiteLabelSetupRequest
-- entry) and was applied immediately, with two consequences:
--
--  1. A host was stamped into the institute row the moment it was
--     submitted -- including a Cloudflare Pages custom domain still in
--     `pending`, which does not serve until the customer's CNAME lands and
--     Cloudflare validates it. That can be hours, or never.
--
--  2. The intent was then forgotten. When the host finally went active
--     nothing revisited it, and a portal added without the star ticked
--     never reached the institute row at all -- the column kept the
--     stamped platform default (learner.vacademy.io / dash.vacademy.io /
--     teacher.vacademy.io) forever.
--
-- Persisting the flag on the routing row turns that one-shot write into a
-- standing instruction: PortalUrlReconciler re-reads it on every
-- white-label setup and status read, and adopts the host into the
-- institute row as soon as Cloudflare reports it ACTIVE.
--
-- "At most one primary row per role token" is enforced in
-- WhiteLabelService, not here: `role` is a comma-separated token list
-- ('ADMIN,MANAGE_LEAD'), so the invariant is per-token and not expressible
-- as a unique index over the column. The reconciler is order-deterministic
-- and so tolerates a violation rather than failing on one.
-- =====================================================================

ALTER TABLE institute_domain_routing
    ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN institute_domain_routing.is_primary IS
    'True when this host is the institute''s chosen portal URL for the roles it serves. Adopted into institutes.<role>_portal_base_url by PortalUrlReconciler once the host is ACTIVE on Cloudflare Pages.';

-- Backfill: any row whose host is ALREADY the institute's stored portal URL
-- for one of its roles was, by definition, the primary choice. Matching on
-- host means the pre-existing 'https://'-prefixed column values written by
-- WhiteLabelService and the bare-host column defaults both compare equal.
--
-- The role match is a LIKE because `role` is a comma-separated token list, and
-- it is deliberately loose: a custom role whose name merely contains 'ADMIN'
-- can only be selected here if its host is an exact match for the institute's
-- admin portal URL, which makes it the right row to flag anyway.
WITH candidate AS (
    SELECT r.id                                                  AS routing_id,
           upper(r.role)                                         AS role,
           CASE
               WHEN r.subdomain IS NULL OR btrim(r.subdomain) IN ('', '*')
                   THEN lower(btrim(r.domain))
               ELSE lower(btrim(r.subdomain)) || '.' || lower(btrim(r.domain))
           END                                                   AS host,
           lower(regexp_replace(regexp_replace(
               btrim(coalesce(i.learner_portal_base_url, '')), '^https?://', ''), '/.*$', ''))  AS learner_host,
           lower(regexp_replace(regexp_replace(
               btrim(coalesce(i.admin_portal_base_url, '')), '^https?://', ''), '/.*$', ''))    AS admin_host,
           lower(regexp_replace(regexp_replace(
               btrim(coalesce(i.teacher_portal_base_url, '')), '^https?://', ''), '/.*$', ''))  AS teacher_host
    FROM institute_domain_routing r
    JOIN institutes i ON i.id = r.institute_id
    WHERE r.is_primary = FALSE
)
UPDATE institute_domain_routing r
SET is_primary = TRUE
FROM candidate c
WHERE c.routing_id = r.id
  AND (
         (c.role LIKE '%LEARNER%' AND c.host <> '' AND c.host = c.learner_host)
      OR (c.role LIKE '%ADMIN%'   AND c.host <> '' AND c.host = c.admin_host)
      OR (c.role LIKE '%TEACHER%' AND c.host <> '' AND c.host = c.teacher_host)
  );
