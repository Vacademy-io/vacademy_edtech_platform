-- Single sign-on (OIDC) for an institute's own identity provider (Entra ID, Okta, Google
-- Workspace, Keycloak...). A learner signs in at the partner's provider and lands in the learner
-- portal signed in; the account is created at first sign-in and its batches follow the
-- provider's groups.
--
-- One connection per institute. Written only through the institute-admin API
-- (/auth-service/v1/institutes/{id}/sso-connection), which encrypts client_secret with the same
-- AES-256-GCM key as institute_oauth_client (institute.oauth.client.encryption-key).

CREATE TABLE IF NOT EXISTS public.institute_sso_connection (
    id                          varchar(255) PRIMARY KEY,
    institute_id                varchar(255) NOT NULL,
    protocol                    varchar(20)  NOT NULL DEFAULT 'OIDC',
    display_name                varchar(255) NOT NULL,
    issuer                      varchar(1024) NOT NULL,
    client_id                   varchar(512) NOT NULL,
    client_secret_encrypted     text         NULL,
    token_auth_method           varchar(40)  NOT NULL DEFAULT 'client_secret_basic',
    scopes                      varchar(512) NOT NULL DEFAULT 'openid profile email',
    -- comma-separated, lower case; only these email domains may sign in through the connection
    email_domains               text         NOT NULL,
    claim_user_id               varchar(100) NOT NULL DEFAULT 'sub',
    claim_email                 varchar(100) NOT NULL DEFAULT 'email',
    claim_name                  varchar(100) NOT NULL DEFAULT 'name',
    claim_given_name            varchar(100) NOT NULL DEFAULT 'given_name',
    claim_family_name           varchar(100) NOT NULL DEFAULT 'family_name',
    claim_phone                 varchar(100) NULL,
    claim_groups                varchar(100) NULL,
    -- ALL = anyone the provider lets through; GROUPS = only members of allowed_groups
    access_mode                 varchar(20)  NOT NULL DEFAULT 'ALL',
    allowed_groups              text         NULL,  -- JSON array of group names / ids
    default_package_session_ids text         NULL,  -- JSON array: batches everyone gets
    group_rules                 text         NULL,  -- JSON array of {group, package_session_ids}
    remove_access_on_group_loss boolean      NOT NULL DEFAULT true,
    -- link an existing learner of THIS institute with the same email when the provider does not
    -- send email_verified (Entra ID never does)
    trust_provider_email        boolean      NOT NULL DEFAULT false,
    auto_redirect               boolean      NOT NULL DEFAULT false,
    enabled                     boolean      NOT NULL DEFAULT false,
    created_by                  varchar(255) NULL,
    updated_by                  varchar(255) NULL,
    created_at                  timestamp    DEFAULT CURRENT_TIMESTAMP,
    updated_at                  timestamp    DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_institute_sso_connection_institute UNIQUE (institute_id)
);

-- The provider's permanent user id ("sub") → our user. Email is never the key.
CREATE TABLE IF NOT EXISTS public.user_sso_identity (
    id                          varchar(255) PRIMARY KEY,
    connection_id               varchar(255) NOT NULL,
    institute_id                varchar(255) NOT NULL,
    -- the provider that vouched for this person; a connection removed and set up again with
    -- the same issuer gets its people back instead of creating second accounts
    issuer                      varchar(1024) NOT NULL,
    subject                     varchar(512) NOT NULL,
    user_id                     varchar(255) NOT NULL,
    email                       varchar(512) NULL,
    -- JSON array of package sessions this connection enrolled the user in (to remove on group loss)
    granted_package_session_ids text         NULL,
    last_login_at               timestamp    NULL,
    created_at                  timestamp    DEFAULT CURRENT_TIMESTAMP,
    updated_at                  timestamp    DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_user_sso_identity_subject UNIQUE (connection_id, issuer, subject)
);
CREATE INDEX IF NOT EXISTS idx_user_sso_identity_user ON public.user_sso_identity (user_id);

-- One row per sign-in started at the provider: state, nonce and PKCE verifier, used once.
-- Kept in the database (not the HTTP session) so the callback can land on any pod.
CREATE TABLE IF NOT EXISTS public.sso_login_attempt (
    state                       varchar(128) PRIMARY KEY,
    connection_id               varchar(255) NOT NULL,
    nonce                       varchar(128) NOT NULL,
    code_verifier               varchar(256) NOT NULL,
    portal_origin               varchar(512) NOT NULL,
    return_path                 varchar(1024) NULL,
    mode                        varchar(20)  NOT NULL DEFAULT 'LOGIN',
    expires_at                  timestamp    NOT NULL,
    used_at                     timestamp    NULL,
    created_at                  timestamp    DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sso_login_attempt_expires ON public.sso_login_attempt (expires_at);

-- The one-time code the learner portal swaps for tokens (60 seconds, single use).
-- Only the SHA-256 of the code is stored.
CREATE TABLE IF NOT EXISTS public.sso_handoff_code (
    code_hash                   varchar(128) PRIMARY KEY,
    user_id                     varchar(255) NOT NULL,
    institute_id                varchar(255) NOT NULL,
    connection_id               varchar(255) NOT NULL,
    expires_at                  timestamp    NOT NULL,
    used_at                     timestamp    NULL,
    created_at                  timestamp    DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sso_handoff_code_expires ON public.sso_handoff_code (expires_at);
