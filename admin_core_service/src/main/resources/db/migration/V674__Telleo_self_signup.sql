-- V674: Telleo self sign-up (TELLEO_SELF_SIGNUP_PLAN.md).
--
-- Everything here is additive. Existing institutes have no row in these tables, so the trial
-- guard, the caller-ID lock and onboarding never apply to them.

-- Where a self-signed-up Telleo account stands. TRIAL accounts may only call the phone number
-- they verified at sign-up and stop calling when the trial ends; LIVE accounts call normally;
-- SUSPENDED accounts place no real calls at all. No row = not a Telleo self sign-up.
CREATE TABLE IF NOT EXISTS institute_telleo_state (
    institute_id  VARCHAR(255) PRIMARY KEY,
    state         VARCHAR(16)  NOT NULL,
    updated_by    VARCHAR(255) NULL,
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT institute_telleo_state_state_check CHECK (state IN ('TRIAL', 'LIVE', 'SUSPENDED'))
);

-- The phone number proven by a WhatsApp code at sign-up. Unique, so one phone gets one trial,
-- and it is the only number a TRIAL account may call.
CREATE TABLE IF NOT EXISTS telleo_trial_phone (
    phone_e164    VARCHAR(20)  PRIMARY KEY,
    institute_id  VARCHAR(255) NOT NULL UNIQUE,
    verified_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The onboarding questions and how far setting the account up has got. Each step is
-- idempotent, so a retry or a refresh resumes where it stopped.
CREATE TABLE IF NOT EXISTS telleo_onboarding (
    institute_id     VARCHAR(255) PRIMARY KEY,
    answers          TEXT         NULL,
    status           VARCHAR(16)  NOT NULL DEFAULT 'NEW',
    line_status      VARCHAR(16)  NOT NULL DEFAULT 'PENDING',
    settings_status  VARCHAR(16)  NOT NULL DEFAULT 'PENDING',
    agent_status     VARCHAR(16)  NOT NULL DEFAULT 'PENDING',
    agent_id         VARCHAR(255) NULL,
    agent_source     VARCHAR(16)  NULL,
    error            TEXT         NULL,
    created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The product row. Sign-up stays CLOSED (self_signup_enabled=false) until someone opens it
-- from the health dashboard's Products page. Edits there keep signup_rules.
INSERT INTO ai_platform_settings (setting_key, setting_value, updated_by, updated_at)
VALUES ('product.telleo',
        jsonb_build_object(
            'display_name', 'Telleo',
            'from_email', 'hello@telleo.ai',
            'from_name', 'Telleo',
            'website_url', 'https://telleo.ai',
            'contact_email', 'hello@telleo.ai',
            'logo_url', 'https://telleo.ai/icon-192.png',
            'app_path', '/telleo/setup',
            'login_url', 'https://dash.vacademy.io/login',
            'trial_days', 7,
            'demo_credits', 60,
            'self_signup_enabled', false,
            'return_hosts', 'vacademy.io,telleo.ai',
            'signup_rules', jsonb_build_object(
                'phone_verification_required', true,
                'trial_dial_lock', true,
                'hide_teachers', true,
                'institute_types', jsonb_build_array(
                    'real_estate', 'education', 'healthcare', 'finance', 'insurance',
                    'automotive', 'retail', 'travel', 'services', 'other'))),
        'V674',
        CURRENT_TIMESTAMP)
ON CONFLICT (setting_key) DO NOTHING;
