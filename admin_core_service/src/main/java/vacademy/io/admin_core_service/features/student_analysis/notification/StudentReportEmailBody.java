package vacademy.io.admin_core_service.features.student_analysis.notification;

import vacademy.io.admin_core_service.features.student_analysis.service.aggregation.ThemeColorResolver;

/**
 * Themed HTML email body for the "your report is ready" learner notification.
 * Mirrors the certificate/live-class email pattern: institute theme color + name, learner name,
 * report name, and a CTA deep-linking to the report on the institute's (white-label) learner portal.
 */
public final class StudentReportEmailBody {

    private static final String DEFAULT_THEME = "#333333";

    private StudentReportEmailBody() {
    }

    public static String build(String themeColor, String instituteName, String studentName,
                               String reportName, String reportUrl) {
        // institute_theme_code may be a preset name ("primary", "blue", ...) that CSS cannot paint.
        String resolvedTheme = ThemeColorResolver.resolve(themeColor);
        String theme = resolvedTheme != null ? resolvedTheme : DEFAULT_THEME;
        return """
                <!DOCTYPE html>
                <html>
                <head><meta charset="utf-8"/>
                <style>
                  body { background:#f6f7f9; font-family:Arial,Helvetica,sans-serif; margin:0; padding:0; }
                  .container { max-width:600px; margin:24px auto; background:#ffffff; border-radius:10px; overflow:hidden; border:1px solid #ececec; }
                  .header { background:%s; padding:24px; text-align:center; }
                  .header h1 { color:#ffffff; font-size:20px; margin:0; }
                  .content { padding:28px 32px; color:#333333; font-size:15px; line-height:1.6; }
                  .report-name { font-size:17px; font-weight:bold; color:#1f2937; margin:12px 0; }
                  .cta { display:inline-block; margin:20px 0; background:%s; color:#ffffff; text-decoration:none; padding:12px 28px; border-radius:6px; font-weight:bold; }
                  .meta { color:#888888; font-size:12px; margin-top:24px; word-break:break-all; }
                  .footer { background:#fafafa; padding:16px; text-align:center; color:#9ca3af; font-size:12px; }
                </style>
                </head>
                <body>
                  <div class="container">
                    <div class="header"><h1>%s</h1></div>
                    <div class="content">
                      <p>Hi %s,</p>
                      <p>Your performance report is now available:</p>
                      <p class="report-name">%s</p>
                      <p>Tap below to view your detailed report — attendance, marks, progress, and personalised insights.</p>
                      <p style="text-align:center;"><a class="cta" href="%s">View My Report</a></p>
                      <p class="meta">If the button doesn't work, copy this link into your browser:<br/>%s</p>
                    </div>
                    <div class="footer">Sent by %s</div>
                  </div>
                </body>
                </html>
                """.formatted(theme, theme, escape(instituteName), escape(studentName), escape(reportName),
                // BUG-20: escape reportUrl in the href attribute to prevent HTML injection;
                // the plaintext copy (second occurrence) is left unescaped for readability.
                escape(reportUrl), reportUrl, escape(instituteName));
    }

    private static String escape(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }
}
