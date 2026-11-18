package vacademy.io.assessment_service.features.assessment.notification;

public class AssessmentNotificationEmailBody {

    public static String getAssessmentReportBody() {
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
                            <td align="center" style="background: #e06623; padding: 18px; border-radius: 12px 12px 0 0;">
                                <h2 style="color: white; margin: 0; font-size: 24px;">📄 Assessment Report</h2>
                            </td>
                        </tr>
                        <tr>
                            <td style="padding: 25px; text-align: left; color: #333; line-height: 1.6;">
                                <p style="font-size: 18px; font-weight: bold;">Dear {{learner_name}},</p>
                                <p>We are pleased to share your assessment report. Your performance and feedback are detailed in the attached document.</p>
                                <p>For any questions, feel free to reach out. We appreciate your dedication to learning! 🚀</p>
                                <div style="text-align: center; margin-top: 20px;">
                                    <a href="{{report_link}}" style="background: #e06623; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-size: 16px; font-weight: bold; display: inline-block;">📥 Download Report</a>
                                </div>
                            </td>
                        </tr>
                        <tr>
                            <td style="background: #f8f8f8; padding: 15px; text-align: center; font-size: 14px; color: #666; border-radius: 0 0 12px 12px;">
                                <p>Need help? <a href="{{support_link}}" style="color: #e06623; text-decoration: none; font-weight: bold;">Contact Support</a></p>
                            </td>
                        </tr>
                    </table>
                </body>
                </html>
                """;
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
                            <td align="center" style="background: #e06623; padding: 18px; border-radius: 12px 12px 0 0;">
                                <h2 style="color: white; margin: 0; font-size: 24px;">Your result was updated</h2>
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
}
