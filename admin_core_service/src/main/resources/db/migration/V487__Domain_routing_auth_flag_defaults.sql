-- =====================================================================
-- V487: Give institute_domain_routing's auth flags an actual value
-- =====================================================================
-- allow_signup / allow_google_auth / allow_github_auth /
-- allow_email_otp_auth / allow_phone_auth / allow_username_password_auth
-- have been nullable since V5, and nothing ever filled them in when a
-- caller omitted the field. NULL was never a designed third state -- it
-- just means "this row was written by someone who didn't send the field".
--
-- The damage is that the two screens reading these columns disagree about
-- what NULL means:
--
--   * the login pages treat it as PERMITTED
--     (login-form.tsx: `setAllowSignup(cached.allowSignup !== false)`)
--   * the white-label wizard renders it as an OFF switch
--     (WhiteLabelSettings.tsx: `checked={!!config[field]}`)
--
-- So an admin configured a portal looking at six switches that all read
-- "off", saved, and shipped a portal with all six on -- including a
-- self-signup link they never asked for.
--
-- Counts before this migration (prod, 2026-09-01) -- note how much of the
-- table is stranded in the ambiguous state:
--
--     flag                          true  false  null
--     allow_signup                     8    104     7
--     allow_google_auth               54     25    40
--     allow_github_auth                9     97    13
--     allow_email_otp_auth            68     10    41
--     allow_phone_auth                 9     88    22
--     allow_username_password_auth    74      5    40
--
-- WHY MOST AUTH METHODS BACKFILL TO TRUE: true is what NULL already did.
-- Google, GitHub, email-OTP and username/password are read as
-- `!== false` in every frontend that consults them (verified: zero
-- `=== true` reads across both dashboards), so those rows are already
-- serving logins with the method enabled. Writing true down changes no
-- behaviour -- it only makes the wizard stop claiming the opposite.
--
-- WHY allow_phone_auth IS THE EXCEPTION AND BACKFILLS TO FALSE: it is the
-- single flag the frontends read as `allowPhoneAuth === true` -- on the
-- login page of BOTH dashboards, and in step-two-form.tsx /
-- useInviteForm.tsx where it decides whether a learner account is created
-- with a phone number as its username. NULL therefore already means OFF
-- for phone. Backfilling it to true would not be recording existing
-- behaviour: it would switch phone login on for 22 portals that never
-- chose it and change how their learners get enrolled.
--
-- WHY allow_signup BACKFILLS TO FALSE: it is the one flag where "on"
-- carries real consequence (an open self-registration link), and false is
-- already what 104 of 119 rows say. All seven NULL rows were checked
-- first and every one is a test or personal-domain row --
-- shiksha.localhost (orphaned institute id), *.neerajhariyale.tech,
-- test.enarkuplift.in, admin-test.enarkuplift.in, test.google.com -- so no
-- real learner portal loses its signup link here.
--
-- Columns are left NULLABLE on purpose. DEFAULTs below stop a raw INSERT
-- from reintroducing a NULL, and DomainRoutingAdminService now resolves
-- every flag before writing, so nothing in the application produces one.
-- A NOT NULL would add nothing beyond turning any writer we have missed
-- into a runtime 500 on the login-branding path.
-- =====================================================================

UPDATE institute_domain_routing
SET allow_signup = FALSE
WHERE allow_signup IS NULL;

UPDATE institute_domain_routing
SET allow_google_auth = TRUE
WHERE allow_google_auth IS NULL;

UPDATE institute_domain_routing
SET allow_github_auth = TRUE
WHERE allow_github_auth IS NULL;

UPDATE institute_domain_routing
SET allow_email_otp_auth = TRUE
WHERE allow_email_otp_auth IS NULL;

UPDATE institute_domain_routing
SET allow_phone_auth = FALSE
WHERE allow_phone_auth IS NULL;

UPDATE institute_domain_routing
SET allow_username_password_auth = TRUE
WHERE allow_username_password_auth IS NULL;

-- Belt and braces for any writer that bypasses the service layer.
ALTER TABLE institute_domain_routing
    ALTER COLUMN allow_signup                 SET DEFAULT FALSE,
    ALTER COLUMN allow_google_auth            SET DEFAULT TRUE,
    ALTER COLUMN allow_github_auth            SET DEFAULT TRUE,
    ALTER COLUMN allow_email_otp_auth         SET DEFAULT TRUE,
    ALTER COLUMN allow_phone_auth             SET DEFAULT FALSE,
    ALTER COLUMN allow_username_password_auth SET DEFAULT TRUE;

COMMENT ON COLUMN institute_domain_routing.allow_signup IS
    'Self-signup on this portal. Defaults FALSE -- off until an admin asks for it.';

COMMENT ON COLUMN institute_domain_routing.allow_phone_auth IS
    'Phone login. Defaults FALSE, unlike the other allow_* methods, because the frontends read this one as `=== true` (null already meant off) and it also drives phone-as-username enrolment.';
