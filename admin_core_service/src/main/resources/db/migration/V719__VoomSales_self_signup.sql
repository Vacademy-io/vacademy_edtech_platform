-- V719: VoomSales self sign-up (docs/PRODUCT_SELF_SIGNUP.md, the Evalezy flow).
--
-- The product row only. A new VoomSales workspace gets the blue theme and a CRM-only sidebar
-- when admin-core creates it (UserInstituteService, VoomSalesDisplaySettings).
--
-- Sign-up stays CLOSED (self_signup_enabled=false) until someone opens it from the health
-- dashboard Products page after the go-live test. No institute has product = voomsales yet,
-- so this row brings no existing institute under the trial gate.
--
-- Host: voomsales.vacademy.io, an extra domain of the dashboard deployment with no routing row
-- (product-host.ts). app.voomsales.com stays routed to the VoomSales team institute.
--
-- Trial and plans match the website (voom-sales-landing lib/pricing.ts): 7 days, 1 user,
-- 50 AI credits, then Starter / Growth / Pro billed yearly. Plan credits are 0: AI calling is
-- charged per minute on every plan, so no credits come bundled.
--
-- The new sign-up alert goes to the same people as Evalezy, copied from product.evalezy when that
-- row has them, and editable on the Alerts tab afterwards.
INSERT INTO ai_platform_settings (setting_key, setting_value, updated_by, updated_at)
SELECT 'product.voomsales',
       jsonb_build_object(
           'display_name', 'VoomSales',
           'from_email', 'hello@voomsales.com',
           'from_name', 'VoomSales',
           'website_url', 'https://www.voomsales.com',
           'contact_email', 'hello@voomsales.com',
           -- The website button blue, dark enough for white text.
           'theme_color', '#2558D9',
           'logo_url', '/voomsales-logo.png',
           -- PNG over https: the code mail shows it (Gmail drops SVG).
           'email_logo_url', 'https://www.voomsales.com/icon-192.png',
           'app_path', '/audience-manager/list',
           'login_url', 'https://voomsales.vacademy.io/login',
           'trial_days', 7,
           'demo_credits', 50,
           'self_signup_enabled', false,
           'return_hosts', 'vacademy.io,voomsales.com',
           'signup_rules', jsonb_build_object(
               'phone_verification_required', false,
               'hide_teachers', true,
               'institute_types', jsonb_build_array(
                   'real_estate', 'education', 'healthcare', 'finance', 'insurance',
                   'automotive', 'retail', 'travel', 'services', 'other')),
           'plans', jsonb_build_array(
               jsonb_build_object('key', 'starter', 'name', 'Starter', 'price_inr', 32000, 'credits', 0, 'users', 10),
               jsonb_build_object('key', 'growth', 'name', 'Growth', 'price_inr', 62000, 'credits', 0, 'users', 25),
               jsonb_build_object('key', 'pro', 'name', 'Pro', 'price_inr', 112000, 'credits', 0, 'users', 50)),
           'plan_validity_months', 12)
       || COALESCE((SELECT jsonb_strip_nulls(jsonb_build_object(
                        'signup_alert_emails', e.setting_value -> 'signup_alert_emails',
                        'signup_alert_whatsapp', e.setting_value -> 'signup_alert_whatsapp',
                        'signup_alert_template', e.setting_value -> 'signup_alert_template',
                        'signup_alert_language', e.setting_value -> 'signup_alert_language',
                        'whatsapp_waba_id', e.setting_value -> 'whatsapp_waba_id'))
                      FROM ai_platform_settings e
                     WHERE e.setting_key = 'product.evalezy'), '{}'::jsonb),
       'V719',
       CURRENT_TIMESTAMP
ON CONFLICT (setting_key) DO NOTHING;
