-- Per-institute OAuth client, for white-label "Continue with Google".
--
-- Google names the app on its sign-in screen after the OAuth client that started the login, so a
-- brand that wants its own name there ("STEMx India" instead of "vacademy.io") needs its own Google
-- Cloud project and client. A row here makes auth_service start that institute's logins with the
-- brand's client; institutes with no row keep using the platform client from application properties.
--
-- client_secret_encrypted is AES-256-GCM (key = OAUTH_TOKEN_ENCRYPTION_KEY, the same key admin-core
-- uses for OAuth tokens). Rows are written only through the super-admin API, which does the
-- encryption; a plaintext secret inserted by hand will fail to decrypt and the institute will fall
-- back to the platform client.

CREATE TABLE IF NOT EXISTS public.institute_oauth_client (
    id                       varchar(255) PRIMARY KEY,
    institute_id             varchar(255) NOT NULL,
    provider                 varchar(50)  NOT NULL,
    client_id                varchar(512) NOT NULL,
    client_secret_encrypted  text         NOT NULL,
    enabled                  boolean      NOT NULL DEFAULT true,
    updated_by               varchar(255) NULL,
    created_at               timestamp    DEFAULT CURRENT_TIMESTAMP,
    updated_at               timestamp    DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_institute_oauth_client_institute_provider UNIQUE (institute_id, provider)
);
