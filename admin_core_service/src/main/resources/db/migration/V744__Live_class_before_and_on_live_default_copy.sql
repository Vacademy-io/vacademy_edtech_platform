-- LIVE_CLASS_BEFORE_LIVE and LIVE_CLASS_ON_LIVE system defaults get their own copy.
--
-- V177 seeded both rows with the LIVE_CLASS_ON_CREATE invitation body, so only the subject and
-- {{ACTION}} differed and a learner got invite wording (upcoming class, see you there) when the
-- class was about to start or had already started. This rewrites the two DEFAULT bodies with
-- starting-soon and started-now wording. Layout, styling and placeholders are unchanged and are
-- the ones LiveSessionNotificationProcessor fills for these events: NAME, SESSION_TITLE, ACTION,
-- LINK, THEME_COLOR, ALL_TIMEZONE_TIMES, INSTITUTE_NAME, YEAR.
--
-- Scope: only the two platform DEFAULT rows, and only while they still carry the copied
-- invitation body, so a re-run (or a DEFAULT already rewritten by hand) is left alone.
-- Institute-owned templates are never touched.

UPDATE templates
SET content = $tpl$<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>Live Class Starting Soon</title>
  </head>
  <body style="margin:0; padding:0; background-color:#fdf5f2; font-family: Arial, sans-serif;">
    <table role="presentation" style="width:100%; border-collapse:collapse; background-color:#fdf5f2; padding:40px 0;">
      <tr>
        <td align="center">
          <table role="presentation" style="width:600px; background:#ffffff; border-radius:10px; overflow:hidden; box-shadow:0 4px 10px rgba(0,0,0,0.1);">
            <tr>
              <td style="background:{{THEME_COLOR}}; padding:20px; text-align:center; color:#fff;">
                <h1 style="margin:0; font-size:24px;">⏰ Live Class {{ACTION}} Soon</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:30px; color:#333;">
                <p style="font-size:16px;">Hi <strong>{{NAME}}</strong>,</p>
                <p style="font-size:16px; line-height:1.6;">
                  This is a quick reminder that <strong>{{SESSION_TITLE}}</strong> is starting soon. Get ready and join a few minutes early so you don't miss the start.
                </p>
                <p style="font-size:14px; font-weight:bold; color:#555; margin-bottom:8px;">🕐 Starts at (by Time Zone):</p>
                <table role="presentation" style="margin:0 0 20px 0; width:100%;">
                  <tr>
                    <td style="padding:16px; background:#fff3ec; border:1px solid #ffe0d1; border-radius:8px;">
                      {{ALL_TIMEZONE_TIMES}}
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
                  Please check your internet connection, audio and camera before you join. See you in class!
                </p>
                <p style="font-size:15px; line-height:1.6; margin-top:20px;">
                  Best regards,<br/>
                  <strong>{{INSTITUTE_NAME}}</strong>
                </p>
              </td>
            </tr>
            <tr>
              <td style="background:#fbeae3; text-align:center; padding:15px; font-size:12px; color:#777;">
                © {{YEAR}} {{INSTITUTE_NAME}}. All rights reserved.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>$tpl$,
    updated_at = now()
WHERE id = 'default-live-class-before-live-email'
  AND institute_id = 'DEFAULT'
  AND content LIKE '%to invite you to our upcoming%';

UPDATE templates
SET content = $tpl$<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>Live Class Started</title>
  </head>
  <body style="margin:0; padding:0; background-color:#fdf5f2; font-family: Arial, sans-serif;">
    <table role="presentation" style="width:100%; border-collapse:collapse; background-color:#fdf5f2; padding:40px 0;">
      <tr>
        <td align="center">
          <table role="presentation" style="width:600px; background:#ffffff; border-radius:10px; overflow:hidden; box-shadow:0 4px 10px rgba(0,0,0,0.1);">
            <tr>
              <td style="background:{{THEME_COLOR}}; padding:20px; text-align:center; color:#fff;">
                <h1 style="margin:0; font-size:24px;">🔴 Live Class {{ACTION}}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:30px; color:#333;">
                <p style="font-size:16px;">Hi <strong>{{NAME}}</strong>,</p>
                <p style="font-size:16px; line-height:1.6;">
                  <strong>{{SESSION_TITLE}}</strong> has started and is live right now. Join now so you don't miss anything.
                </p>
                <p style="font-size:14px; font-weight:bold; color:#555; margin-bottom:8px;">🕐 Scheduled start (by Time Zone):</p>
                <table role="presentation" style="margin:0 0 20px 0; width:100%;">
                  <tr>
                    <td style="padding:16px; background:#fff3ec; border:1px solid #ffe0d1; border-radius:8px;">
                      {{ALL_TIMEZONE_TIMES}}
                    </td>
                  </tr>
                </table>
                <div style="text-align:center; margin:30px 0;">
                  <a href="{{LINK}}" target="_blank"
                     style="display:inline-block; padding:12px 24px; background:{{THEME_COLOR}}; color:#fff;
                            font-size:16px; font-weight:bold; text-decoration:none; border-radius:6px;">
                    Join Now
                  </a>
                </div>
                <p style="font-size:15px; line-height:1.6;">
                  Running a little late? You can still join &mdash; just use the button above.
                </p>
                <p style="font-size:15px; line-height:1.6; margin-top:20px;">
                  Best regards,<br/>
                  <strong>{{INSTITUTE_NAME}}</strong>
                </p>
              </td>
            </tr>
            <tr>
              <td style="background:#fbeae3; text-align:center; padding:15px; font-size:12px; color:#777;">
                © {{YEAR}} {{INSTITUTE_NAME}}. All rights reserved.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>$tpl$,
    updated_at = now()
WHERE id = 'default-live-class-on-live-email'
  AND institute_id = 'DEFAULT'
  AND content LIKE '%to invite you to our upcoming%';
