-- V717: Telleo sign-up without the WhatsApp phone code, like Evalezy's.
-- The phone is typed on the form. This also ends the one-trial-per-phone check, which only applies
-- when the phone is proven; the fixed trial credits are the limit. "Call me now" rings the typed phone.
UPDATE ai_platform_settings
   SET setting_value = jsonb_set(setting_value, '{signup_rules,phone_verification_required}', 'false'::jsonb, true),
       updated_by    = 'V717',
       updated_at    = CURRENT_TIMESTAMP
 WHERE setting_key = 'product.telleo'
   AND jsonb_typeof(setting_value -> 'signup_rules') = 'object'
   AND COALESCE(setting_value #>> '{signup_rules,phone_verification_required}', 'false') <> 'false';
