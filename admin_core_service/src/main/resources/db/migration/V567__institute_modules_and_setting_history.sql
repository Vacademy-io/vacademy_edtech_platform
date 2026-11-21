-- ================================================================================
-- V567: Institute modules (entitlements) + institute setting history
-- ================================================================================
--
-- INSTITUTE_MODULES_AND_CONFIG_SPEC.md §5. New tables only: nothing here ALTERs an
-- existing table (prod tables such as `institutes` are owned by another role, and an
-- ALTER on them fails with 42501).
--
-- institute_module_policy        LEGACY (default: every feature on, today's behaviour)
--                                or MANAGED (entitlement rows decide). No row = LEGACY.
-- institute_module_entitlement   one row per (institute, module key | feature key).
--                                Keys come from capabilities/catalog.json.
-- institute_module_entitlement_log
--                                every change of a row above, and of the mode (key
--                                '_mode', enabled = MANAGED), with the reason.
-- module_preset                  named module sets the platform team applies in bulk.
-- institute_setting_history      every write of an institutes.setting_json key, old and
--                                new value of THAT key only; source TENANT | PLATFORM.

CREATE TABLE IF NOT EXISTS institute_module_policy (
    institute_id   VARCHAR(255) PRIMARY KEY,
    mode           VARCHAR(16)  NOT NULL DEFAULT 'LEGACY',      -- LEGACY | MANAGED
    updated_by     VARCHAR(255),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS institute_module_entitlement (
    institute_id   VARCHAR(255) NOT NULL,
    key            VARCHAR(128) NOT NULL,                       -- module key or feature key
    enabled        BOOLEAN      NOT NULL,
    expires_at     TIMESTAMPTZ  NULL,                           -- trials / time-boxed add-ons
    note           TEXT,
    updated_by     VARCHAR(255),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (institute_id, key)
);

CREATE TABLE IF NOT EXISTS institute_module_entitlement_log (
    id               VARCHAR(36)  PRIMARY KEY,
    institute_id     VARCHAR(255) NOT NULL,
    key              VARCHAR(128) NOT NULL,                     -- '_mode' for mode changes
    old_enabled      BOOLEAN      NULL,                         -- NULL = no row before
    new_enabled      BOOLEAN      NULL,
    old_expires_at   TIMESTAMPTZ  NULL,
    new_expires_at   TIMESTAMPTZ  NULL,
    old_note         TEXT,
    new_note         TEXT,
    reason           TEXT         NOT NULL,
    actor            VARCHAR(255),
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_institute_module_entitlement_log_inst
    ON institute_module_entitlement_log (institute_id, created_at DESC);

CREATE TABLE IF NOT EXISTS module_preset (
    key            VARCHAR(64)  PRIMARY KEY,
    name           VARCHAR(255) NOT NULL,
    description    TEXT,
    entitlements   JSONB        NOT NULL DEFAULT '{"modules": []}'::jsonb,   -- {"modules": [key, ...]}
    updated_by     VARCHAR(255),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS institute_setting_history (
    id             VARCHAR(36)  PRIMARY KEY,
    institute_id   VARCHAR(255) NOT NULL,
    setting_key    VARCHAR(255) NOT NULL,
    old_value      TEXT,                                        -- JSON of setting.<KEY>, NULL = absent
    new_value      TEXT,
    actor          VARCHAR(255),
    source         VARCHAR(16)  NOT NULL,                       -- TENANT | PLATFORM
    reason         TEXT,                                        -- platform writes carry one
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_institute_setting_history_inst
    ON institute_setting_history (institute_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_institute_setting_history_inst_key
    ON institute_setting_history (institute_id, setting_key, created_at DESC);

-- Seed presets. Module keys must exist in capabilities/catalog.json; core modules are
-- always on and are not listed.
INSERT INTO module_preset (key, name, description, entitlements, updated_by)
VALUES
    ('full_suite', 'Full suite', 'Every module.',
     '{"modules": ["lms", "assessments", "live_classes", "crm", "communications", "automation", "website", "finance", "sub_orgs", "inventory", "erp", "ai"]}'::jsonb,
     'system'),
    ('lms_suite', 'LMS suite', 'Courses, assessments, live classes, communications, fees and AI tools.',
     '{"modules": ["lms", "assessments", "live_classes", "communications", "finance", "ai"]}'::jsonb,
     'system'),
    ('crm_suite', 'CRM suite', 'Leads, admissions, calling, communications, automation and website.',
     '{"modules": ["crm", "communications", "automation", "website"]}'::jsonb,
     'system')
ON CONFLICT (key) DO NOTHING;
