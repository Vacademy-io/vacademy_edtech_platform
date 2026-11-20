-- Live-class system defaults: sign off with the institute, not a generic "Your Team",
-- and replace the fixed "2025 Your Organization" footer (seeded by V177 and copied into the
-- reschedule default) with the institute name and current year.
--
-- LiveSessionNotificationProcessor fills INSTITUTE_NAME and YEAR for every live-class
-- event, so both placeholders resolve for all five templates.
--
-- Scope: only the platform DEFAULT live-class rows, and only the exact literal text, so a
-- re-run is a no-op and institute-owned templates are never touched.

UPDATE templates
SET content = replace(content, '<strong>Your Team</strong>', '<strong>{{INSTITUTE_NAME}}</strong>'),
    updated_at = CURRENT_TIMESTAMP
WHERE institute_id = 'DEFAULT'
  AND id IN ('default-live-class-on-create-email',
             'default-live-class-before-live-email',
             'default-live-class-on-live-email',
             'default-live-class-delete-email',
             'default-edit-live-class-email')
  AND content LIKE '%<strong>Your Team</strong>%';

UPDATE templates
SET content = replace(content, '© 2025 Your Organization. All rights reserved.',
                      '© {{YEAR}} {{INSTITUTE_NAME}}. All rights reserved.'),
    updated_at = CURRENT_TIMESTAMP
WHERE institute_id = 'DEFAULT'
  AND id IN ('default-live-class-on-create-email',
             'default-live-class-before-live-email',
             'default-live-class-on-live-email',
             'default-live-class-delete-email',
             'default-edit-live-class-email')
  AND content LIKE '%© 2025 Your Organization. All rights reserved.%';
