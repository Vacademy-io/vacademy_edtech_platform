-- Result-release email becomes template-driven.
--
-- assessment_service used to send a hardcoded body (AssessmentNotificationEmailBody) whose
-- "Download Report" button linked nowhere. This seeds a platform DEFAULT template plus its
-- ASSESSMENT_RESULT_RELEASED event config, so every institute gets a working email with the
-- report attached, and any institute (or a single assessment) can bind its own template.
--
-- Placeholders filled per learner by assessment_service: student_name, first_name,
-- assessment_name, institute_name, score, max_score, percentage, rank, participants,
-- enrollment_number, result_date, plus any report-profile variables (e.g. scholarship_percent).
-- Unknown placeholders are removed at send time.
--
-- Idempotent.

INSERT INTO templates (
    id, type, vendor_id, institute_id, name, subject, content, content_type,
    setting_json, dynamic_parameters, can_delete, status, template_category, created_at, updated_at
)
SELECT
    'default-assessment-result-email',
    'EMAIL',
    'default',
    'DEFAULT',
    'Assessment Result Email',
    'Your result for {{assessment_name}} is ready',
    $tpl$<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your result for {{assessment_name}}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif;color:#1c2333;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;">
        <tr><td style="padding:28px 32px 8px 32px;font-size:20px;font-weight:bold;">Hi {{first_name}},</td></tr>
        <tr><td style="padding:8px 32px;font-size:15px;line-height:1.6;">
          Your result for <b>{{assessment_name}}</b> is ready. You scored <b>{{score}} out of {{max_score}}</b>.
        </td></tr>
        <tr><td style="padding:8px 32px;font-size:15px;line-height:1.6;">
          Your full report is attached to this email as a PDF. It shows your marks section by section,
          how you compare with your class, and a study plan to help you improve.
        </td></tr>
        <tr><td style="padding:8px 32px 28px 32px;font-size:15px;line-height:1.6;">
          Keep learning,<br><b>{{institute_name}}</b>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>$tpl$,
    'HTML',
    NULL,
    '["student_name","first_name","assessment_name","institute_name","score","max_score","percentage","rank","participants","enrollment_number","result_date"]',
    false,
    'ACTIVE',
    'NOTIFICATION',
    now(), now()
WHERE NOT EXISTS (
    SELECT 1 FROM templates
    WHERE id = 'default-assessment-result-email'
       OR (institute_id = 'DEFAULT' AND name = 'Assessment Result Email')
);

INSERT INTO notification_event_config (
    id, event_name, source_type, source_id, template_type, template_id, template_name,
    is_active, created_at, updated_at
)
SELECT
    'default-assessment-result-email-config',
    'ASSESSMENT_RESULT_RELEASED',
    'INSTITUTE',
    'DEFAULT',
    'EMAIL',
    t.id,
    NULL,
    true,
    now(), now()
FROM templates t
WHERE t.institute_id = 'DEFAULT'
  AND t.name = 'Assessment Result Email'
  AND NOT EXISTS (
      SELECT 1 FROM notification_event_config
      WHERE event_name = 'ASSESSMENT_RESULT_RELEASED'
        AND source_type = 'INSTITUTE'
        AND source_id = 'DEFAULT'
        AND template_type = 'EMAIL'
  );
