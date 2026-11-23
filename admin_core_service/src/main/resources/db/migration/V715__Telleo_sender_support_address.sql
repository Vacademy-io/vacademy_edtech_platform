-- V715: Telleo mails go out from support@telleo.ai (telleo.ai is verified in SES).
-- V713 set hello@telleo.ai. Only from_email changes; a no-op when the row is missing or already set.
UPDATE ai_platform_settings
   SET setting_value = setting_value || '{"from_email": "support@telleo.ai"}'::jsonb,
       updated_by    = 'V715',
       updated_at    = CURRENT_TIMESTAMP
 WHERE setting_key = 'product.telleo'
   AND COALESCE(setting_value ->> 'from_email', '') <> 'support@telleo.ai';
