-- V716: Telleo wears its green.
-- 1. Product mails (sign-up code, welcome): Telleo's brand green instead of the default orange.
UPDATE ai_platform_settings
   SET setting_value = setting_value || '{"theme_color": "#14C47C"}'::jsonb,
       updated_by    = 'V716',
       updated_at    = CURRENT_TIMESTAMP
 WHERE setting_key = 'product.telleo'
   AND COALESCE(setting_value ->> 'theme_color', '') <> '#14C47C';

-- 2. Telleo workspaces made before new ones started getting it: the dashboard's preset green,
--    only where nobody has picked a theme yet.
UPDATE institutes
   SET institute_theme_code = 'green'
 WHERE product = 'telleo'
   AND COALESCE(institute_theme_code, '') = '';
