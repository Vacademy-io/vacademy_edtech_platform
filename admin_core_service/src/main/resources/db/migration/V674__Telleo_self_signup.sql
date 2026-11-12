-- V674: Telleo self sign-up (TELLEO_SELF_SIGNUP_PLAN.md).
--
-- Everything here is additive. Existing institutes have no row in these tables, so the
-- caller-ID lock and onboarding never apply to them.

-- The phone number proven by a WhatsApp code at sign-up. Unique, so one phone gets one trial;
-- "Call me now" rings it. The trial itself is the platform's self sign-up trial (lead_tag
-- FREE_TRIAL + demo_expires_at, docs/PRODUCT_SELF_SIGNUP.md).
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
--
-- The new sign-up alert (mail + WhatsApp to the team, template product_signup_alert, whose {{1}}
-- is the product name) goes to the same people as Evalezy's: copied from product.evalezy when
-- that row has them, and editable on the Alerts tab afterwards.
INSERT INTO ai_platform_settings (setting_key, setting_value, updated_by, updated_at)
SELECT 'product.telleo',
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
               'hide_teachers', true,
               'institute_types', jsonb_build_array(
                   'real_estate', 'education', 'healthcare', 'finance', 'insurance',
                   'automotive', 'retail', 'travel', 'services', 'other')))
       || COALESCE((SELECT jsonb_strip_nulls(jsonb_build_object(
                        'signup_alert_emails', e.setting_value -> 'signup_alert_emails',
                        'signup_alert_whatsapp', e.setting_value -> 'signup_alert_whatsapp',
                        'signup_alert_template', e.setting_value -> 'signup_alert_template',
                        'signup_alert_language', e.setting_value -> 'signup_alert_language',
                        'whatsapp_waba_id', e.setting_value -> 'whatsapp_waba_id'))
                      FROM ai_platform_settings e
                     WHERE e.setting_key = 'product.evalezy'), '{}'::jsonb),
       'V674',
       CURRENT_TIMESTAMP
ON CONFLICT (setting_key) DO NOTHING;
