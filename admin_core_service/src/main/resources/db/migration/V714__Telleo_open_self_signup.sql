-- V714: open Telleo self sign-up (as V643 opened Evalezy's).
-- V713 created product.telleo with sign-up closed. This turns on only self_signup_enabled and
-- leaves every other setting as it is. A no-op when the row is missing or already open.
UPDATE ai_platform_settings
   SET setting_value = setting_value || '{"self_signup_enabled": true}'::jsonb,
       updated_by    = 'V714',
       updated_at    = CURRENT_TIMESTAMP
 WHERE setting_key = 'product.telleo'
   AND COALESCE(setting_value ->> 'self_signup_enabled', 'false') <> 'true';
