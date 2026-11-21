-- Product settings move to the existing platform settings table: one row per product, key
-- product.<product_key>, the settings as JSON. institutes.product stays the marker on each institute.
-- ai_service ignores keys it does not declare, so these rows do not appear on the AI Settings page.
INSERT INTO ai_platform_settings (setting_key, setting_value, updated_by, updated_at)
SELECT 'product.' || product_key,
       jsonb_build_object(
           'display_name', display_name,
           'from_email', from_email,
           'from_name', from_name,
           'website_url', website_url,
           'contact_email', contact_email,
           'theme_color', theme_color,
           'logo_url', logo_url,
           'app_path', app_path,
           'login_url', login_url,
           'trial_days', trial_days,
           'self_signup_enabled', self_signup_enabled,
           'return_hosts', return_hosts),
       updated_by,
       updated_at
FROM platform_product
ON CONFLICT (setting_key) DO NOTHING;

DROP TABLE IF EXISTS platform_product;
