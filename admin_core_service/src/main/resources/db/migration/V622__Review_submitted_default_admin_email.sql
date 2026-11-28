-- Default admin email for a new website review (catalogue_review).
--
-- When a visitor sends a review, ReviewAdminAlertService always lights the
-- admins' bell (system alert) and, unless the institute has its own ACTIVE
-- REVIEW_SUBMITTED workflow, emails every admin with this template.
--
-- One shared row (institute_id = 'DEFAULT'), like the doubt templates of V215.
-- An institute customises it by creating an EMAIL template with the same name
-- in its own Templates; that row then wins. Values are filled in at send time
-- and are already HTML-escaped by the service:
--   {{institute_name}} {{institute_theme_color}} {{recipient_name}}
--   {{reviewer_name}} {{rating}} {{rating_stars}} {{review_text}}
--   {{details_html}} {{site}} {{reviews_url}}
-- Idempotent via NOT EXISTS.
INSERT INTO templates (
    id, type, institute_id, name, subject, content, content_type,
    setting_json, can_delete, status, template_category, created_by, updated_by
)
SELECT
    gen_random_uuid()::text,
    'EMAIL',
    'DEFAULT',
    'Site Review Submitted - Admin Notification',
    'New {{rating}}-star review from {{reviewer_name}} on {{institute_name}}',
    $html$<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>New review</title></head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f4f6f8;color:#1f2937;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:24px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
        <tr><td style="background:{{institute_theme_color}};color:#ffffff;padding:20px 28px;">
          <p style="margin:0;font-size:12px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;opacity:0.85;">{{institute_name}}</p>
          <h1 style="margin:6px 0 0;font-size:20px;font-weight:600;">New review on your website</h1>
          <p style="margin:4px 0 0;font-size:13px;opacity:0.9;">It is waiting for your approval.</p>
        </td></tr>
        <tr><td style="padding:28px;">
          <p style="margin:0 0 16px;font-size:15px;">Hi {{recipient_name}},</p>
          <p style="margin:0 0 6px;font-size:22px;letter-spacing:2px;color:#f59e0b;">{{rating_stars}}</p>
          <p style="margin:0 0 16px;font-size:14px;color:#4b5563;"><strong style="color:#111827;">{{reviewer_name}}</strong> gave {{rating}} out of 5 stars{{site}}.</p>
          <div style="margin:0 0 16px;padding:14px 16px;background:#f9fafb;border-left:3px solid {{institute_theme_color}};border-radius:6px;font-size:14px;line-height:1.6;color:#374151;">{{review_text}}</div>
          {{details_html}}
          <p style="margin:24px 0 8px;">
            <a href="{{reviews_url}}" style="display:inline-block;background:{{institute_theme_color}};color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600;">Review and approve</a>
          </p>
          <p style="margin:16px 0 0;font-size:12px;color:#6b7280;">Approved reviews appear in the testimonials of your website. Nothing is public until you approve it.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>$html$,
    'HTML',
    NULL,
    true,
    'ACTIVE',
    'NOTIFICATION',
    'system',
    'system'
WHERE NOT EXISTS (
    SELECT 1 FROM templates
    WHERE institute_id = 'DEFAULT'
      AND type = 'EMAIL'
      AND name = 'Site Review Submitted - Admin Notification'
);
