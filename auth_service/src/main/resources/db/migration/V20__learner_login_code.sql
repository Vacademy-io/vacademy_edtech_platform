-- Signed-in-by-link codes for the learner portal's passwordless routes
-- (/go/<username>, /subscriptions/<username>, /study-library/live-class/<username>, any route
-- via ?lc=<code>).
--
-- learner_login_code: one row per code handed out. The plaintext code is returned once and
-- never stored, only its SHA-256 hex (code_hash, UNIQUE), so a database read does not yield
-- working links. A code is bound to one learner in one institute and stops working at
-- expires_at or revoked_at. Codes are reusable until then (a learner may open the same
-- WhatsApp link twice, or on two devices); use_count / last_used_* are for audit.
--
--   created_via  API_KEY  - an institute's own server, POST /auth-service/open/v1/login-codes
--                           with a login_links key (admin_core institute_api_key)
--                INTERNAL - our own services over HMAC (live-class reminders, workflows)
--   created_by   apikey:<institute_api_key.id> | the calling service's client name
--
-- institute_login_link_policy: per-institute switch. While require_login_code is false (the
-- default, and the state of every institute without a row) codes are ignored and the
-- username-only links keep working exactly as before; once true, a valid code is the only
-- way login-by-username-trusted signs in a learner of that institute. Codes may be minted
-- while it is false, so links can carry them ahead of the switch.

CREATE TABLE IF NOT EXISTS public.learner_login_code (
    id            varchar(36)  PRIMARY KEY,
    code_hash     char(64)     NOT NULL,
    user_id       varchar(255) NOT NULL,
    institute_id  varchar(255) NOT NULL,
    expires_at    timestamp    NOT NULL,
    created_via   varchar(16)  NOT NULL,
    created_by    varchar(255) NULL,
    created_at    timestamp    NOT NULL DEFAULT now(),
    revoked_at    timestamp    NULL,
    use_count     integer      NOT NULL DEFAULT 0,
    last_used_at  timestamp    NULL,
    last_used_ip  varchar(64)  NULL,
    CONSTRAINT uq_learner_login_code_hash UNIQUE (code_hash),
    CONSTRAINT chk_learner_login_code_via CHECK (created_via IN ('API_KEY', 'INTERNAL'))
);

CREATE INDEX IF NOT EXISTS idx_learner_login_code_user ON public.learner_login_code (user_id, institute_id);
CREATE INDEX IF NOT EXISTS idx_learner_login_code_expires ON public.learner_login_code (expires_at);

CREATE TABLE IF NOT EXISTS public.institute_login_link_policy (
    institute_id        varchar(255) PRIMARY KEY,
    require_login_code  boolean      NOT NULL DEFAULT false,
    updated_by          varchar(255) NULL,
    updated_at          timestamp    NOT NULL DEFAULT now()
);
