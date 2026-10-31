package vacademy.io.admin_core_service.features.live_session.constants;

/**
 * Email sent to a learner when their attendance for a live class is recorded.
 *
 * <p>Deliberately separate from {@link LiveClassEmailBody}, which is an
 * <em>invitation</em>: it opens "We're excited to invite you to our upcoming
 * ...", carries a "Join the Live Class" button and closes "We look forward to
 * seeing you there!". Attendance notifications reused it, so a learner marked
 * absent for a class that had already finished was invited to attend it, given
 * a button pointing at "#", and told the whole sentence explaining their
 * absence inside the 24px header.
 *
 * <p>Placeholders: NAME, SESSION_TITLE, SESSION_DATE, STATUS, STATUS_COLOR,
 * STATUS_NOTE, THEME_COLOR, INSTITUTE_NAME, YEAR. STATUS_NOTE may be empty.
 */
public class AttendanceEmailBody {

    public static final String Attendance_Email_Body = """
            <!DOCTYPE html>
            <html>
              <body style="margin:0; padding:0; font-family:Arial, Helvetica, sans-serif; background-color:#f4f5f7;">
                <table role="presentation" style="width:100%; border-collapse:collapse; background-color:#f4f5f7; padding:40px 0;">
                  <tr>
                    <td align="center">
                      <table role="presentation" style="width:600px; background:#ffffff; border-radius:10px; overflow:hidden; box-shadow:0 4px 10px rgba(0,0,0,0.08);">
                        <tr>
                          <td style="background:{{THEME_COLOR}}; padding:20px; text-align:center; color:#ffffff;">
                            <h1 style="margin:0; font-size:22px;">Attendance Recorded</h1>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding:30px; color:#333333;">
                            <p style="font-size:16px; margin:0 0 18px 0;">Hi <strong>{{NAME}}</strong>,</p>

                            <p style="font-size:16px; line-height:1.6; margin:0 0 20px 0;">
                              Your attendance for <strong>{{SESSION_TITLE}}</strong> on {{SESSION_DATE}} has been recorded as:
                            </p>

                            <table role="presentation" style="margin:0 0 20px 0; width:100%;">
                              <tr>
                                <td align="center" style="padding:14px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px;">
                                  <span style="display:inline-block; padding:6px 18px; border-radius:999px; font-size:16px; font-weight:bold; color:#ffffff; background:{{STATUS_COLOR}};">
                                    {{STATUS}}
                                  </span>
                                </td>
                              </tr>
                            </table>

                            {{STATUS_NOTE}}

                            <p style="font-size:14px; line-height:1.6; color:#64748b; margin:24px 0 0 0;">
                              If you believe this is incorrect, please contact your instructor.
                              If there is any discrepancy, please contact the faculty.
                            </p>

                            <p style="font-size:15px; line-height:1.6; margin-top:20px;">
                              Best regards,<br/>
                              <strong>{{INSTITUTE_NAME}}</strong>
                            </p>
                          </td>
                        </tr>
                        <tr>
                          <td style="background:#f1f5f9; text-align:center; padding:15px; font-size:12px; color:#777777;">
                            &copy; {{YEAR}} {{INSTITUTE_NAME}}. All rights reserved.
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </body>
            </html>
            """;

    /** Wraps the explanation in its own block; empty string when there is nothing to add. */
    public static String noteBlock(String note) {
        if (note == null || note.isBlank()) {
            return "";
        }
        return "<div style=\"padding:12px 14px; background:#fff7ed; border:1px solid #fed7aa;"
                + " border-radius:8px; font-size:14px; line-height:1.6; color:#9a3412;\">"
                + note + "</div>";
    }
}
