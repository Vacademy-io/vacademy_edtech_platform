-- LIVE_CLASS_ON_EDIT system default, so a fresh database matches production.
--
-- LiveClassTemplateService falls back to the DEFAULT template id for each live-class event.
-- The on-edit (reschedule) template was only ever created by hand in production, under id
-- default-edit-live-class-email together with a DEFAULT event-config binding; no migration
-- seeded either, and the Java map pointed at an id nothing created. This adds both rows.
--
-- Idempotent: the template insert is skipped when the id or the DEFAULT name already exists,
-- and the binding insert is skipped when any DEFAULT LIVE_CLASS_ON_EDIT EMAIL binding exists,
-- so this is a no-op in production. Only institute_id DEFAULT / source_id DEFAULT rows.

INSERT INTO templates (
    id, type, institute_id, name, subject, content, content_type, template_category,
    can_delete, dynamic_parameters, status, created_by, updated_by, created_at, updated_at
)
SELECT
    'default-edit-live-class-email',
    'EMAIL',
    'DEFAULT',
    'Live Class Reschedule Email',
    'Live Class Rescheduled – {{SESSION_TITLE}}',
    $tpl$<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>Live Class Rescheduled</title>
  </head>
  <body style="margin:0; padding:0; background-color:#fdf5f2; font-family: Arial, sans-serif;">
    <table role="presentation" style="width:100%; border-collapse:collapse; background-color:#fdf5f2; padding:40px 0;">
      <tr>
        <td align="center">
          <table role="presentation" style="width:600px; background:#ffffff; border-radius:10px; overflow:hidden; box-shadow:0 4px 10px rgba(0,0,0,0.1);">
            <tr>
              <td style="background:{{THEME_COLOR}}; padding:20px; text-align:center; color:#fff;">
                <h1 style="margin:0; font-size:24px;">🔄 Live Class {{ACTION}}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:30px; color:#333;">
                <p style="font-size:16px;">Hi <strong>{{NAME}}</strong>,</p>

                <p style="font-size:16px; line-height:1.6;">
                  Please note that your live class <strong>{{SESSION_TITLE}}</strong> has been updated. Below are the latest schedule details — kindly take a moment to review them.
                </p>
                <table role="presentation" style="margin:20px 0; width:100%;">
                  <tr>
                    <td style="padding:15px; background:#fff3ec; border:1px solid #ffe0d1; border-radius:6px;">
                      <p style="margin:5px 0 0 0; font-size:15px; text-align:center"> {{ALL_TIMEZONE_TIMES}}</p>
                    </td>
                  </tr>
                </table>

                <div style="text-align:center; margin:30px 0;">
                  <a href="{{LINK}}" target="_blank"
                     style="display:inline-block; padding:12px 24px; background:{{THEME_COLOR}}; color:#fff;
                            font-size:16px; font-weight:bold; text-decoration:none; border-radius:6px;">
                    Join the Live Class
                  </a>
                </div>

                <p style="font-size:15px; line-height:1.6;">
                  We apologise for any inconvenience the change may cause and look forward to seeing you at the new time.
                </p>
                <p style="font-size:15px; line-height:1.6; margin-top:20px;">
                  Best regards,<br/>
                  <strong>Your Team</strong>
                </p>
              </td>
            </tr>
            <tr>
              <td style="background:#fbeae3; text-align:center; padding:15px; font-size:12px; color:#777;">
                © 2025 Your Organization. All rights reserved.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
$tpl$,
    'HTML',
    'LIVE_CLASS',
    false,
    '["NAME", "SESSION_TITLE", "ACTION", "LINK", "THEME_COLOR", "ALL_TIMEZONE_TIMES", "DATE", "TIME"]',
    'ACTIVE',
    'system',
    'system',
    now(), now()
WHERE NOT EXISTS (
    SELECT 1 FROM templates
    WHERE id = 'default-edit-live-class-email'
       OR (institute_id = 'DEFAULT' AND name = 'Live Class Reschedule Email')
)
ON CONFLICT DO NOTHING;

INSERT INTO notification_event_config (
    id, event_name, source_type, source_id, template_type, template_id, template_name,
    is_active, created_by, created_at, updated_at
)
SELECT
    'default-live-class-on-edit-config',
    'LIVE_CLASS_ON_EDIT',
    'INSTITUTE',
    'DEFAULT',
    'EMAIL',
    t.id,
    NULL,
    true,
    'system',
    now(), now()
FROM templates t
WHERE t.id = 'default-edit-live-class-email'
  AND t.institute_id = 'DEFAULT'
  AND NOT EXISTS (
      SELECT 1 FROM notification_event_config
      WHERE event_name = 'LIVE_CLASS_ON_EDIT'
        AND source_type = 'INSTITUTE'
        AND source_id = 'DEFAULT'
        AND template_type = 'EMAIL'
  )
ON CONFLICT DO NOTHING;
