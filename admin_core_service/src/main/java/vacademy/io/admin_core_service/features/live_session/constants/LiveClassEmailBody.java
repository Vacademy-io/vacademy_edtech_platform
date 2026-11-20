package vacademy.io.admin_core_service.features.live_session.constants;

public class LiveClassEmailBody {

    public static String Live_Class_Email_Body="""
            <!DOCTYPE html>
            <html>
              <head>
                <meta charset="UTF-8" />
                <title>Live Class Invitation</title>
              </head>
              <body style="margin:0; padding:0; background-color:#fdf5f2; font-family: Arial, sans-serif;">
                <table role="presentation" style="width:100%; border-collapse:collapse; background-color:#fdf5f2; padding:40px 0;">
                  <tr>
                    <td align="center">
                      <table role="presentation" style="width:600px; background:#ffffff; border-radius:10px; overflow:hidden; box-shadow:0 4px 10px rgba(0,0,0,0.1);">
                        <tr>
                          <td style="background:{{THEME_COLOR}}; padding:20px; text-align:center; color:#fff;">
                            <h1 style="margin:0; font-size:24px;">📢 Live Class {{ACTION}}</h1>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding:30px; color:#333;">
                            <p style="font-size:16px;">Hi <strong>{{NAME}}</strong>,</p>
                            
                            <p style="font-size:16px; line-height:1.6;">
                              We're excited to invite you to our upcoming <strong>{{SESSION_TITLE}}</strong>, designed to help you learn and grow with us. 
                            </p>
                            <table role="presentation" style="margin:20px 0; width:100%;">
                                          <tr>
                                            <td style="padding:10px; background:#fff3ec; border:1px solid #ffe0d1; border-radius:6px;">
              
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
                              We look forward to seeing you there!
                            </p>
                            <p style="font-size:15px; line-height:1.6; margin-top:20px;">
                              Best regards,<br/>
                              <strong>Your Team</strong>
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
            </html>
            """;

    public static String Live_Class_Edit_Email_Body="""
            <!DOCTYPE html>
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
                            © {{YEAR}} {{INSTITUTE_NAME}}. All rights reserved.
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </body>
            </html>
            """;

    public static String Live_Class_Delete_Email_Body="""
            <!DOCTYPE html>
            <html>
              <head>
                <meta charset="UTF-8" />
                <title>Live Class Cancellation Notice</title>
              </head>
              <body style="margin:0; padding:0; background-color:#fdf5f2; font-family: Arial, sans-serif;">
                <table role="presentation" style="width:100%; border-collapse:collapse; background-color:#fdf5f2; padding:40px 0;">
                  <tr>
                    <td align="center">
                      <table role="presentation" style="width:600px; background:#ffffff; border-radius:10px; overflow:hidden; box-shadow:0 4px 10px rgba(0,0,0,0.1);">
                        <tr>
                          <td style="background:{{THEME_COLOR}}; padding:20px; text-align:center; color:#fff;">
                            <h1 style="margin:0; font-size:24px;">❌ Live Class Cancelled</h1>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding:30px; color:#333;">
                            <p style="font-size:16px;">Hi <strong>{{NAME}}</strong>,</p>
                            
                            <p style="font-size:16px; line-height:1.6;">
                              We regret to inform you that the live class <strong>{{SESSION_TITLE}}</strong> has been cancelled.
                            </p>
                            
                            <table role="presentation" style="margin:20px 0; width:100%;">
                              <tr>
                                <td style="padding:15px; background:#f8d7da; border:1px solid #f5c6cb; border-radius:6px;">
                                  <p style="margin:5px 0 0 0; font-size:15px; color:#721c24; text-align:center">{{ALL_TIMEZONE_TIMES}}</p>
                                </td>
                              </tr>
                            </table>

                            <p style="font-size:16px; line-height:1.6;">
                              We apologize for any inconvenience this may cause. We will notify you about any rescheduled sessions or alternative arrangements.
                            </p>

                            <p style="font-size:15px; line-height:1.6;">
                              If you have any questions or concerns, please don't hesitate to contact us.
                            </p>
                            
                            <p style="font-size:15px; line-height:1.6; margin-top:20px;">
                              Thank you for your understanding,<br/>
                              <strong>Your Team</strong>
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
            </html>
            """;

    public static String Live_Class_Before_Live_Email_Body="""
            <!DOCTYPE html>
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
            </html>
            """;

    public static String Live_Class_On_Live_Email_Body="""
            <!DOCTYPE html>
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
            </html>
            """;
}
