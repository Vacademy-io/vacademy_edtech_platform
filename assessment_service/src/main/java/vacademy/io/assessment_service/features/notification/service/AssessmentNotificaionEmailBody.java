package vacademy.io.assessment_service.features.notification.service;

public class AssessmentNotificaionEmailBody {

    public static String getEmailBodyForAdminsForResultRelease(String assessmentName, String dateConducted) {
        return """
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <title>Assessment Results Published</title>
                    <style>
                        body {
                            font-family: Arial, sans-serif;
                            line-height: 1.6;
                        }
                        .container {
                            max-width: 600px;
                            margin: 0 auto;
                            padding: 20px;
                            border-left: 5px solid green;
                        }
                        .header {
                            font-size: 24px;
                            font-weight: bold;
                            color: #28a745;
                        }
                        .highlight {
                            color: green;
                            font-weight: bold;
                        }
                        .details {
                            font-weight: bold;
                        }
                        .blue-text {
                            color: blue;
                        }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <p class="header">Assessment Results Published</p>
                        <p>Dear <span class="highlight">{{user_name}}</span>,</p>
                        <p>The results for the assessment "<span class="highlight">%s</span>" have been successfully published.</p>
                        
                        <p class="details">Assessment Details:</p>
                        <ul>
                            <li><span class="blue-text">Assessment Name:</span> %s</li>
                            <li><span class="blue-text">Date Conducted:</span> %s</li>
                        </ul>

                        <p>You can now review the results and take necessary actions.</p>
                        <p>Best Regards,</p>
                        <p><strong>Vacademy Team</strong></p>
                    </div>
                </body>
                </html>
                """.formatted(assessmentName, assessmentName, dateConducted);
    }

    public static String getEmailBodyForAdminsForReevaluation(String assessmentName, String dateConducted) {
        return """
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <title>Assessment Reevaluation Completed</title>
                    <style>
                        body {
                            font-family: Arial, sans-serif;
                            line-height: 1.6;
                        }
                        .container {
                            max-width: 600px;
                            margin: 0 auto;
                            padding: 20px;
                            border-left: 5px solid #FF8C00;
                        }
                        .header {
                            font-size: 24px;
                            font-weight: bold;
                            color: #FF8C00;
                        }
                        .highlight {
                            color: #FF8C00;
                            font-weight: bold;
                        }
                        .details {
                            font-weight: bold;
                        }
                        .orange-text {
                            color: #FF8C00;
                        }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <p class="header">Assessment Reevaluation Completed</p>
                        <p>Dear <span class="highlight">{{user_name}}</span>,</p>
                        <p>The assessment "<span class="highlight">%s</span>" has been successfully reevaluated.</p>
                        
                        <p class="details">Assessment Details:</p>
                        <ul>
                            <li><span class="orange-text">Assessment Name:</span> %s</li>
                            <li><span class="orange-text">Date Conducted:</span> %s</li>
                        </ul>

                        <p>The updated results are now available for review.</p>
                        <p>Best Regards,</p>
                        <p><strong>Vacademy Team</strong></p>
                    </div>
                </body>
                </html>
                """.formatted(assessmentName, assessmentName, dateConducted);
    }

}
