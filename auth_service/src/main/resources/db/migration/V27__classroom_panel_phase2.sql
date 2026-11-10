-- Vacademy Classroom, phase 2: usage history, room seats, installer organisations, app releases.
--
-- One migration for the whole phase. Nothing reads the new tables or columns until the matching
-- panel.* switches are turned on, and every new column is nullable or has a default that keeps
-- phase 1 behaviour (approval_state defaults to APPROVED). Seat counts, periods and grace days are
-- rows entered by platform staff; nothing here seeds a value.
--
-- lock_timeout is transaction-scoped (SET LOCAL), so it is safe behind pgbouncer in transaction
-- mode: the ALTERs on panel_session and panel_device fail fast instead of queueing behind syncs.
-- If the service is ever reverted, keep this file: Flyway validation needs it.

SET LOCAL lock_timeout = '5s';

-- ------------------------------------------------------------------ usage ---

ALTER TABLE public.panel_session ADD COLUMN IF NOT EXISTS active_until timestamp NULL;
CREATE INDEX IF NOT EXISTS idx_panel_session_inst_created ON public.panel_session (institute_id, created_at);
CREATE INDEX IF NOT EXISTS idx_panel_session_dev_created ON public.panel_session (device_id, created_at);

CREATE TABLE IF NOT EXISTS public.panel_activity (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session_id   varchar(36)  NOT NULL REFERENCES public.panel_session(id),
    device_id    varchar(36)  NOT NULL,
    institute_id varchar(255) NOT NULL,
    room_id      varchar(36)  NOT NULL,
    user_id      varchar(255) NOT NULL,
    client_seq   integer      NOT NULL,
    kind         varchar(16)  NOT NULL,
    ref_id       varchar(64)  NULL,
    parent_id    varchar(64)  NULL,
    title        varchar(200) NULL,
    started_at   timestamp    NOT NULL,
    created_at   timestamp    NOT NULL DEFAULT now(),
    CONSTRAINT uq_panel_activity_seq UNIQUE (session_id, client_seq),
    CONSTRAINT chk_panel_activity_kind CHECK (kind IN ('LESSON','DECK','DECK_LIVE','CLASS','WHITEBOARD','HOME'))
);
CREATE INDEX IF NOT EXISTS idx_panel_activity_inst_started ON public.panel_activity (institute_id, started_at);
CREATE INDEX IF NOT EXISTS idx_panel_activity_created ON public.panel_activity (created_at);

-- ------------------------------------------------------- rooms and panels ---

ALTER TABLE public.classroom_room ADD COLUMN IF NOT EXISTS licensed_at timestamp NULL;
ALTER TABLE public.classroom_room ADD COLUMN IF NOT EXISTS licensed_by varchar(255) NULL;
ALTER TABLE public.classroom_room ADD COLUMN IF NOT EXISTS partner_id varchar(36) NULL;

ALTER TABLE public.panel_device ADD COLUMN IF NOT EXISTS approval_state varchar(16) NOT NULL DEFAULT 'APPROVED'
    CONSTRAINT chk_panel_device_approval CHECK (approval_state IN ('APPROVED','PENDING','REJECTED'));
ALTER TABLE public.panel_device ADD COLUMN IF NOT EXISTS installed_by_partner_id varchar(36) NULL;
ALTER TABLE public.panel_device ADD COLUMN IF NOT EXISTS approved_by varchar(255) NULL;
ALTER TABLE public.panel_device ADD COLUMN IF NOT EXISTS approved_at timestamp NULL;
ALTER TABLE public.panel_device ADD COLUMN IF NOT EXISTS app_channel varchar(16) NULL;
CREATE INDEX IF NOT EXISTS idx_panel_device_partner
    ON public.panel_device (installed_by_partner_id, institute_id) WHERE installed_by_partner_id IS NOT NULL;

-- ---------------------------------------------------------------- seats ---

CREATE TABLE IF NOT EXISTS public.panel_licence_setting (
    institute_id varchar(255) PRIMARY KEY,
    enforcement  varchar(8)   NOT NULL,
    updated_by   varchar(255) NOT NULL,
    updated_at   timestamp    NOT NULL DEFAULT now(),
    CONSTRAINT chk_panel_licence_enf CHECK (enforcement IN ('OFF','SHADOW','LIVE'))
);

CREATE TABLE IF NOT EXISTS public.panel_licence_grant (
    id           varchar(36)  PRIMARY KEY,
    institute_id varchar(255) NOT NULL,
    kind         varchar(16)  NOT NULL,
    seats        integer      NOT NULL,
    starts_at    timestamp    NOT NULL,
    ends_at      timestamp    NOT NULL,
    grace_days   integer      NOT NULL DEFAULT 0,
    status       varchar(16)  NOT NULL DEFAULT 'ACTIVE',
    partner_id   varchar(36)  NULL,
    external_ref varchar(120) NULL,
    note         varchar(500) NULL,
    created_by   varchar(255) NOT NULL,
    created_at   timestamp    NOT NULL DEFAULT now(),
    cancelled_by varchar(255) NULL,
    cancelled_at timestamp    NULL,
    CONSTRAINT chk_plg_kind   CHECK (kind IN ('TRIAL','PAID','COMPLIMENTARY')),
    CONSTRAINT chk_plg_status CHECK (status IN ('ACTIVE','CANCELLED')),
    CONSTRAINT chk_plg_seats  CHECK (seats > 0 AND grace_days >= 0 AND ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_plg_institute ON public.panel_licence_grant (institute_id, status, ends_at);

-- Defaults for an automatic trial. No row means no automatic trial.
CREATE TABLE IF NOT EXISTS public.panel_licence_template (
    key        varchar(32)  PRIMARY KEY,
    kind       varchar(16)  NOT NULL,
    seats      integer      NOT NULL,
    days       integer      NOT NULL,
    grace_days integer      NOT NULL DEFAULT 0,
    active     boolean      NOT NULL DEFAULT true,
    updated_by varchar(255) NOT NULL,
    updated_at timestamp    NOT NULL DEFAULT now(),
    CONSTRAINT chk_plt_kind  CHECK (kind IN ('TRIAL','PAID','COMPLIMENTARY')),
    CONSTRAINT chk_plt_seats CHECK (seats > 0 AND days > 0 AND grace_days >= 0)
);

-- Seat history: one row per assignment or release.
CREATE TABLE IF NOT EXISTS public.panel_licence_event (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    institute_id varchar(255) NOT NULL,
    room_id      varchar(36)  NOT NULL,
    action       varchar(16)  NOT NULL,
    reason       varchar(24)  NOT NULL,
    partner_id   varchar(36)  NULL,
    actor        varchar(255) NULL,
    at           timestamp    NOT NULL DEFAULT now(),
    CONSTRAINT chk_ple_action CHECK (action IN ('ASSIGNED','RELEASED')),
    CONSTRAINT chk_ple_reason
        CHECK (reason IN ('AUTO_ACTIVATE','AUTO_APPROVE','ADMIN','ROOM_ARCHIVED','SUPER_ADMIN'))
);
CREATE INDEX IF NOT EXISTS idx_ple_inst_at ON public.panel_licence_event (institute_id, at);

-- ------------------------------------------------------ installer orgs ---

CREATE TABLE IF NOT EXISTS public.panel_partner (
    id                   varchar(36)  PRIMARY KEY,
    name                 varchar(120) NOT NULL,
    partner_institute_id varchar(255) NOT NULL,
    status               varchar(16)  NOT NULL DEFAULT 'ACTIVE',
    created_by           varchar(255) NOT NULL,
    created_at           timestamp    NOT NULL DEFAULT now(),
    CONSTRAINT uq_panel_partner_inst UNIQUE (partner_institute_id),
    CONSTRAINT chk_panel_partner_status CHECK (status IN ('ACTIVE','SUSPENDED'))
);

CREATE TABLE IF NOT EXISTS public.panel_partner_link (
    id             varchar(36)  PRIMARY KEY,
    partner_id     varchar(36)  NOT NULL REFERENCES public.panel_partner(id),
    institute_id   varchar(255) NOT NULL,
    institute_name varchar(255) NULL,
    status         varchar(16)  NOT NULL DEFAULT 'ACTIVE',
    linked_via     varchar(16)  NOT NULL,
    install_until  timestamp    NULL,
    created_by     varchar(255) NOT NULL,
    created_at     timestamp    NOT NULL DEFAULT now(),
    revoked_by     varchar(255) NULL,
    revoked_at     timestamp    NULL,
    CONSTRAINT chk_ppl_status CHECK (status IN ('ACTIVE','REVOKED')),
    CONSTRAINT chk_ppl_via CHECK (linked_via IN ('SCHOOL_CODE','SUPER_ADMIN'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ppl_active
    ON public.panel_partner_link (partner_id, institute_id) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_ppl_institute ON public.panel_partner_link (institute_id, status);

-- Invite codes are stored as SHA-256 hex in varchar(64), like every other panel secret.
CREATE TABLE IF NOT EXISTS public.panel_partner_invite (
    id                 varchar(36)  PRIMARY KEY,
    institute_id       varchar(255) NOT NULL,
    code_hash          varchar(64)  NOT NULL,
    state              varchar(16)  NOT NULL DEFAULT 'PENDING',
    install_days       integer      NOT NULL,
    expires_at         timestamp    NOT NULL,
    created_by         varchar(255) NOT NULL,
    created_at         timestamp    NOT NULL DEFAULT now(),
    used_by_partner_id varchar(36)  NULL,
    used_at            timestamp    NULL,
    CONSTRAINT uq_ppi_code UNIQUE (code_hash),
    CONSTRAINT chk_ppi_state CHECK (state IN ('PENDING','USED','CANCELLED','EXPIRED'))
);
CREATE INDEX IF NOT EXISTS idx_ppi_institute ON public.panel_partner_invite (institute_id, state);
CREATE INDEX IF NOT EXISTS idx_ppi_expires ON public.panel_partner_invite (expires_at);

-- ------------------------------------------------------------- releases ---

CREATE TABLE IF NOT EXISTS public.panel_app_release (
    id              varchar(36)  PRIMARY KEY,
    channel         varchar(16)  NOT NULL,
    version_code    integer      NOT NULL,
    version_name    varchar(32)  NOT NULL,
    apk_url         varchar(500) NULL,
    sha256          varchar(64)  NULL,
    size_bytes      bigint       NULL,
    min_sdk         integer      NOT NULL DEFAULT 24,
    rollout_percent integer      NOT NULL DEFAULT 0,
    required        boolean      NOT NULL DEFAULT false,
    status          varchar(16)  NOT NULL DEFAULT 'DRAFT',
    notes           varchar(500) NULL,
    created_by      varchar(255) NOT NULL,
    created_at      timestamp    NOT NULL DEFAULT now(),
    published_at    timestamp    NULL,
    CONSTRAINT uq_par_channel_code UNIQUE (channel, version_code),
    CONSTRAINT chk_par_channel CHECK (channel IN ('PLAY','DIRECT')),
    CONSTRAINT chk_par_status CHECK (status IN ('DRAFT','LIVE','PULLED')),
    CONSTRAINT chk_par_rollout CHECK (rollout_percent BETWEEN 0 AND 100)
);
