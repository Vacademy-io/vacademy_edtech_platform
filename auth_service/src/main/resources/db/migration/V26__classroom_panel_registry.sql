-- Vacademy Classroom: rooms, classroom panels and their sign-in sessions.
--
-- New tables only. Nothing else reads them, so this migration is dark until the panel
-- endpoints are switched on with panel.enabled. Secrets are stored as SHA-256 hex in
-- varchar(64) columns, never char(64), so JDBC varchar parameters use the unique indexes.
-- If the service is ever reverted, keep this file: Flyway validation needs it.

CREATE TABLE IF NOT EXISTS public.classroom_room (
    id            varchar(36)  PRIMARY KEY,
    institute_id  varchar(255) NOT NULL,
    name          varchar(120) NOT NULL,
    status        varchar(16)  NOT NULL DEFAULT 'ACTIVE',
    created_by    varchar(255) NULL,
    created_at    timestamp    NOT NULL DEFAULT now(),
    updated_at    timestamp    NOT NULL DEFAULT now(),
    CONSTRAINT chk_classroom_room_status CHECK (status IN ('ACTIVE','ARCHIVED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_classroom_room_name
    ON public.classroom_room (institute_id, lower(name)) WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS public.panel_pairing (
    id            varchar(36)  PRIMARY KEY,
    code_hash     varchar(64)  NOT NULL,
    secret_hash   varchar(64)  NOT NULL,
    match_code    smallint     NOT NULL,
    match_options varchar(16)  NOT NULL,
    install_id    varchar(64)  NOT NULL,
    device_info   varchar(600) NULL,
    state         varchar(16)  NOT NULL DEFAULT 'PENDING',
    device_id     varchar(36)  NULL,
    picked_up_at  timestamp    NULL,
    created_ip    varchar(64)  NULL,
    expires_at    timestamp    NOT NULL,
    created_at    timestamp    NOT NULL DEFAULT now(),
    CONSTRAINT uq_panel_pairing_code UNIQUE (code_hash),
    CONSTRAINT uq_panel_pairing_secret UNIQUE (secret_hash),
    CONSTRAINT chk_panel_pairing_state CHECK (state IN ('PENDING','CLAIMED','CANCELLED','EXPIRED'))
);
CREATE INDEX IF NOT EXISTS idx_panel_pairing_expires ON public.panel_pairing (expires_at);
CREATE INDEX IF NOT EXISTS idx_panel_pairing_pending
    ON public.panel_pairing (expires_at) WHERE state = 'PENDING';

CREATE TABLE IF NOT EXISTS public.panel_device (
    id                     varchar(36)  PRIMARY KEY,
    institute_id           varchar(255) NOT NULL,
    room_id                varchar(36)  NOT NULL REFERENCES public.classroom_room(id),
    secret_hash            varchar(64)  NOT NULL,
    status                 varchar(16)  NOT NULL,
    install_id             varchar(64)  NULL,
    institute_name         varchar(255) NULL,
    theme_code             varchar(64)  NULL,
    approve_base_url       varchar(255) NULL,
    branding_synced_at     timestamp    NULL,
    password_login_allowed boolean      NOT NULL DEFAULT false,
    manufacturer           varchar(120) NULL,
    model                  varchar(120) NULL,
    sdk_int                integer      NULL,
    webview_major          integer      NULL,
    app_version_code       integer      NULL,
    last_seen_at           timestamp    NULL,
    last_ip                varchar(64)  NULL,
    claimed_by             varchar(255) NOT NULL,
    claimed_by_name        varchar(255) NULL,
    claimed_at             timestamp    NOT NULL DEFAULT now(),
    confirmed_at           timestamp    NULL,
    revoked_by             varchar(255) NULL,
    revoked_at             timestamp    NULL,
    CONSTRAINT uq_panel_device_secret UNIQUE (secret_hash),
    CONSTRAINT chk_panel_device_status CHECK (status IN ('CLAIMED','ACTIVE','REVOKED'))
);
CREATE INDEX IF NOT EXISTS idx_panel_device_institute ON public.panel_device (institute_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_panel_device_room
    ON public.panel_device (room_id) WHERE status IN ('CLAIMED','ACTIVE');

CREATE TABLE IF NOT EXISTS public.panel_session (
    id                 varchar(36)  PRIMARY KEY,
    device_id          varchar(36)  NOT NULL REFERENCES public.panel_device(id),
    institute_id       varchar(255) NOT NULL,
    room_id            varchar(36)  NOT NULL,
    user_id            varchar(255) NOT NULL,
    started_via        varchar(16)  NOT NULL,
    refresh_hash       varchar(64)  NULL,
    status             varchar(16)  NOT NULL DEFAULT 'ACTIVE',
    expires_at         timestamp    NOT NULL,
    created_at         timestamp    NOT NULL DEFAULT now(),
    last_refreshed_at  timestamp    NOT NULL DEFAULT now(),
    ended_at           timestamp    NULL,
    end_reason         varchar(24)  NULL,
    ended_by           varchar(255) NULL,
    remote_token_hash  varchar(64)  NULL,
    remote_nav_counter integer      NOT NULL DEFAULT 0,
    remote_client_seq  bigint       NOT NULL DEFAULT 0,
    remote_nav_at      timestamp    NULL,
    remote_seen_at     timestamp    NULL,
    panel_seen_at      timestamp    NULL,
    state_index        integer      NULL,
    state_total        integer      NULL,
    state_title        varchar(200) NULL,
    state_updated_at   timestamp    NULL,
    CONSTRAINT uq_panel_session_refresh UNIQUE (refresh_hash),
    CONSTRAINT uq_panel_session_remote UNIQUE (remote_token_hash),
    CONSTRAINT chk_panel_session_via CHECK (started_via IN ('QR','PASSWORD')),
    CONSTRAINT chk_panel_session_status CHECK (status IN ('ACTIVE','ENDED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_panel_session_device_active
    ON public.panel_session (device_id) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX IF NOT EXISTS uq_panel_session_user_active
    ON public.panel_session (user_id) WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS public.panel_login_challenge (
    id               varchar(36)  PRIMARY KEY,
    device_id        varchar(36)  NOT NULL REFERENCES public.panel_device(id),
    institute_id     varchar(255) NOT NULL,
    purpose          varchar(16)  NOT NULL,
    session_id       varchar(36)  NULL,
    token_hash       varchar(64)  NOT NULL,
    user_code_hash   varchar(64)  NOT NULL,
    match_code       smallint     NOT NULL,
    match_options    varchar(16)  NOT NULL,
    state            varchar(16)  NOT NULL DEFAULT 'PENDING',
    scanned_by_name  varchar(255) NULL,
    approved_user_id varchar(255) NULL,
    approved_ip      varchar(64)  NULL,
    approved_at      timestamp    NULL,
    redeemed_at      timestamp    NULL,
    expires_at       timestamp    NOT NULL,
    created_at       timestamp    NOT NULL DEFAULT now(),
    CONSTRAINT uq_panel_challenge_token UNIQUE (token_hash),
    CONSTRAINT uq_panel_challenge_code UNIQUE (user_code_hash),
    CONSTRAINT chk_panel_challenge_purpose CHECK (purpose IN ('SIGN_IN','ATTACH_REMOTE')),
    CONSTRAINT chk_panel_challenge_state
        CHECK (state IN ('PENDING','SCANNED','APPROVED','REDEEMED','DEAD','EXPIRED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_panel_challenge_device_open
    ON public.panel_login_challenge (device_id) WHERE state IN ('PENDING','SCANNED','APPROVED');
CREATE INDEX IF NOT EXISTS idx_panel_challenge_expires ON public.panel_login_challenge (expires_at);
