-- Channel-partner (sub-org) onboarding: typed certificates + the partner welcome email.
--
-- 1. issued_certificate.certificate_type — which kind of certificate a row is. Every row so far
--    is a course-completion certificate, so NULL reads as COURSE_COMPLETION and nothing is
--    backfilled. The new SUB_ORG_AFFILIATION kind can then coexist with a course certificate on
--    the same learner/batch without the two sharing a number.
--
-- 2. A platform-wide DEFAULT template + event config for SUB_ORG_PARTNER_WELCOME: the one mail a
--    partner admin gets when their subscription becomes active — login details, the admin-portal
--    link, and (when the institute issues one) the Certificate of Affiliation attached.
--    Institutes override it exactly like the payment-confirmation mail: their own template +
--    config row. The send itself is opt-in per institute
--    (SUB_ORG_ONBOARDING_SETTING.sendWelcomeEmail), so seeding a DEFAULT here mails nobody by itself.
--
--    Nothing in the template is fixed to one institute: name, logo, colour, portal link and the
--    footer address are all variables; the logo <img> is sized inline so clients that drop <style>
--    cannot blow it up (see V516).
--
-- Idempotent: re-running is a no-op.

ALTER TABLE issued_certificate ADD COLUMN IF NOT EXISTS certificate_type VARCHAR(50);

INSERT INTO templates (
    id, type, vendor_id, institute_id, name, subject, content, content_type,
    setting_json, dynamic_parameters, can_delete, status, template_category, created_at, updated_at
)
SELECT
    'default-partner-welcome-email',
    'EMAIL',
    'default',
    'DEFAULT',
    'Partner Welcome Email',
    'Welcome to {{institute_name}} — your partner account is ready',
    $tpl$<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Welcome to {{institute_name}}</title>
    <style>
        body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
        table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
        img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
        table { border-collapse: collapse !important; }
        body { height: 100% !important; margin: 0 !important; padding: 0 !important; width: 100% !important; background-color: #f6f8fc; font-family: Arial, Helvetica, sans-serif; }
        .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; }
        .header { background: {{theme_color}}; color: #ffffff; padding: 28px 20px; text-align: center; }
        .header h1 { margin: 0; font-size: 26px; font-weight: 700; }
        .header p { margin: 8px 0 0 0; font-size: 15px; opacity: 0.95; }
        .logo-container { padding: 24px 0 8px 0; text-align: center; }
        .content { padding: 24px 30px 32px 30px; font-size: 15px; line-height: 1.7; color: #444444; }
        .content p { margin: 0 0 16px 0; }
        .credentials { background: #f8f8f8; border-radius: 8px; padding: 18px 20px; margin: 20px 0; }
        .credentials td { padding: 4px 0; font-size: 15px; color: #333333; }
        .credentials .label { color: #777777; width: 110px; }
        .cta-button { background-color: {{theme_color}}; color: #ffffff !important; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-size: 15px; font-weight: 600; display: inline-block; }
        .muted { color: #777777; font-size: 13px; }
        .footer { background-color: #f9fafb; padding: 24px 30px; text-align: center; font-size: 12px; color: #999999; }
    </style>
</head>
<body>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" width="100%" style="background-color: #f6f8fc;">
        <tr>
            <td align="center" style="padding: 32px 16px;">
                <table role="presentation" class="container" cellspacing="0" cellpadding="0" border="0" width="600">
                    <tr><td class="logo-container">{{institute_logo}}</td></tr>
                    <tr><td class="header" style="background: {{theme_color}}; color: #ffffff; padding: 28px 20px; text-align: center;">
                        <h1 style="margin: 0; font-size: 26px; font-weight: 700; color: #ffffff;">Welcome aboard, {{organisation_name}}</h1>
                        <p style="margin: 8px 0 0 0; font-size: 15px; color: #ffffff;">You are now an authorised partner of {{institute_name}}</p>
                    </td></tr>
                    <tr><td class="content">
                        <p>Dear {{user_full_name}},</p>
                        <p>Your partner account with <strong>{{institute_name}}</strong> is active. Use the details below to sign in to your admin portal and start onboarding learners.</p>
                        <table role="presentation" class="credentials" cellspacing="0" cellpadding="0" border="0" width="100%" style="background: #f8f8f8; border-radius: 8px;">
                            <tr><td style="padding: 18px 20px 4px 20px;"><strong>Login details</strong></td></tr>
                            <tr><td style="padding: 0 20px;">
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                                    <tr><td class="label" style="color: #777777; width: 110px; padding: 4px 0;">Portal</td><td style="padding: 4px 0;"><a href="{{portal_url}}" style="color: {{theme_color}};">{{portal_url}}</a></td></tr>
                                    <tr><td class="label" style="color: #777777; width: 110px; padding: 4px 0;">Username</td><td style="padding: 4px 0;">{{user_name}}</td></tr>
                                    <tr><td class="label" style="color: #777777; width: 110px; padding: 4px 0 18px 0;">Password</td><td style="padding: 4px 0 18px 0;">{{user_password}}</td></tr>
                                </table>
                            </td></tr>
                        </table>
                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin: 8px 0 24px 0;">
                            <tr><td align="center"><a href="{{portal_url}}" class="cta-button" style="background-color: {{theme_color}}; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-size: 15px; font-weight: 600; display: inline-block;">Sign in to your portal</a></td></tr>
                        </table>
                        {{certificate_note}}
                        <p class="muted">For security, keep your login details private. You can change your password from the portal after signing in.</p>
                        <p>Warm regards,<br>The {{institute_name}} Team</p>
                    </td></tr>
                    <tr><td class="footer">
                        <p style="margin: 0;">&copy; {{year}} {{institute_name}}. All rights reserved.<br>{{institute_address}}</p>
                    </td></tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>$tpl$,
    'text/html',
    '{"variables":[],"isDefault":true,"templateType":"transactional"}',
    '{}',
    false,
    'ACTIVE',
    'NOTIFICATION',
    now(), now()
WHERE NOT EXISTS (
    SELECT 1 FROM templates
    WHERE id = 'default-partner-welcome-email'
       OR (institute_id = 'DEFAULT' AND name = 'Partner Welcome Email')
);

INSERT INTO notification_event_config (
    id, event_name, source_type, source_id, template_type, template_id, template_name,
    is_active, created_at, updated_at
)
SELECT
    'default-partner-welcome-email-config',
    'SUB_ORG_PARTNER_WELCOME',
    'INSTITUTE',
    'DEFAULT',
    'EMAIL',
    t.id,
    t.name,
    true,
    now(), now()
FROM templates t
WHERE t.institute_id = 'DEFAULT'
  AND t.name = 'Partner Welcome Email'
  AND NOT EXISTS (
      SELECT 1 FROM notification_event_config
      WHERE event_name = 'SUB_ORG_PARTNER_WELCOME'
        AND source_type = 'INSTITUTE'
        AND source_id = 'DEFAULT'
        AND template_type = 'EMAIL'
  );
