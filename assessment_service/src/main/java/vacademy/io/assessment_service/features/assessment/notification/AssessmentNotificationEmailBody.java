package vacademy.io.assessment_service.features.assessment.notification;

import org.springframework.util.StringUtils;
import org.springframework.web.util.HtmlUtils;
import vacademy.io.assessment_service.features.assessment.service.ThemeColorResolver;

public class AssessmentNotificationEmailBody {

    /** Accent used when the institute's theme is unknown. */
    static final String NEUTRAL = "#333333";

    public static String getAssessmentReportBody() {
        return getAssessmentReportBody(null, null);
    }

    /**
     * The built-in "your report is attached" email. Coloured with the institute's theme (neutral
     * when blank) and signed with its name when known; no links, the report is the attachment.
     */
    public static String getAssessmentReportBody(String instituteName, String themeCode) {
        return """
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1">
                    <title>Assessment Report</title>
                </head>
                <body style="font-family: Arial, sans-serif; background-color: #f4f4f4; margin: 0; padding: 40px;">
                    <table align="center" width="600" style="background: white; border-radius: 12px; box-shadow: 0px 4px 10px rgba(0, 0, 0, 0.1); padding: 20px; border-collapse: collapse;">
                        <tr>
                            <td align="center" style="border-top: 4px solid %1$s; padding: 18px; border-radius: 12px 12px 0 0;">
                                <h2 style="color: #333333; margin: 0; font-size: 24px;">📄 Assessment Report</h2>
                            </td>
                        </tr>
                        <tr>
                            <td style="padding: 25px; text-align: left; color: #333; line-height: 1.6;">
                                <p style="font-size: 18px; font-weight: bold;">Dear {{learner_name}},</p>
                                <p>We are pleased to share your assessment report. Your performance and feedback are detailed in the attached document.</p>
                                <p>For any questions, feel free to reach out. We appreciate your dedication to learning! 🚀</p>
                            </td>
                        </tr>
                        %2$s
                    </table>
                </body>
                </html>
                """.formatted(accent(themeCode), footer(instituteName));
    }

    /** Subject of the one message a learner gets when a released result is changed. */
    public static String resultUpdatedSubject(String assessmentName) {
        String name = assessmentName == null ? "" : assessmentName.trim();
        return name.isEmpty() ? "Your result was updated" : "Your result for " + name + " was updated";
    }

    /**
     * Body of that message ("Send updated result" in the submission review): not the
     * "result released" message again, and no links the sender may not fill in.
     */
    public static String getResultUpdatedBody() {
        return """
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1">
                    <title>Your result was updated</title>
                </head>
                <body style="font-family: Arial, sans-serif; background-color: #f4f4f4; margin: 0; padding: 40px;">
                    <table align="center" width="600" style="background: white; border-radius: 12px; box-shadow: 0px 4px 10px rgba(0, 0, 0, 0.1); padding: 20px; border-collapse: collapse;">
                        <tr>
                            <td align="center" style="border-top: 4px solid #333333; padding: 18px; border-radius: 12px 12px 0 0;">
                                <h2 style="color: #333333; margin: 0; font-size: 24px;">Your result was updated</h2>
                            </td>
                        </tr>
                        <tr>
                            <td style="padding: 25px; text-align: left; color: #333; line-height: 1.6;">
                                <p style="font-size: 18px; font-weight: bold;">Dear {{learner_name}},</p>
                                <p>Your teacher changed the marks on a result that was already released to you.</p>
                                <p>The updated report is attached. In the app, the result shows the latest marks and is tagged "Revised".</p>
                            </td>
                        </tr>
                    </table>
                </body>
                </html>
                """;
    }

    private static String accent(String themeCode) {
        String resolved = ThemeColorResolver.resolve(themeCode);
        return resolved != null ? resolved : NEUTRAL;
    }

    private static String footer(String instituteName) {
        if (!StringUtils.hasText(instituteName)) return "";
        return "<tr><td style=\"padding: 15px; text-align: center; font-size: 14px; color: #666;\">"
                + HtmlUtils.htmlEscape(instituteName.trim()) + "</td></tr>";
    }
}
