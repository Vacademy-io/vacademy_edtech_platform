package vacademy.io.auth_service.feature.user.service;

import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * HTML bodies for the team welcome email (new account), its "login details" resend, and the
 * no-credentials note for an account that already exists.
 *
 * Both share one layout. It is a table-based, fully inline-styled email on purpose:
 * Gmail's own stylesheet ({@code .ii a[href] {color:#15c}}) outranks any class in a
 * {@code <style>} block, which is how the old template's white button text turned blue,
 * and Outlook ignores most of the box model outside of tables. Values are substituted
 * with plain {@code String.replace} on {@code {{token}}} placeholders rather than
 * {@code String.formatted}, so the markup can use {@code %} widths freely.
 */
public class InviteUserEmailBody {

    private static final String DEFAULT_THEME_COLOR = "#E67E22";
    private static final Pattern HEX_COLOR = Pattern.compile("^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$");

    private static final String FONT_STACK =
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
    private static final String MONO_STACK =
            "SFMono-Regular, Menlo, Consolas, 'Liberation Mono', 'Courier New', monospace";

    /**
     * A new account, ready to use: the member is ACTIVE from the moment the admin adds them,
     * so this is a welcome with login details, not an invitation waiting to be accepted.
     */
    public static String createInviteUserEmail(
            String name,
            String username,
            String password,
            List<String> roles,
            String themeColor,
            String instituteName,
            String adminLoginUrl
    ) {
        String institute = escape(instituteName);
        String roleText = formatRoles(roles);
        return render(
                "Your " + institute + " account is ready — sign in with the details inside.",
                "Welcome",
                "Your account at " + institute + " is ready",
                "Hi " + escape(firstName(name)) + ", " + institute + " has added you to its team as "
                        + "<strong style=\"color:#111827;\">" + roleText + "</strong>. "
                        + "Your account is ready — sign in with the details below.",
                "Sign in",
                username, password, roles, themeColor, instituteName, adminLoginUrl
        );
    }

    /**
     * Login details again ("Resend login details"), for a member who has not signed in yet.
     * Same layout as the welcome; nothing in it suggests an invite is pending.
     */
    public static String createReminderEmail(String name, String username, String password, List<String> roles,
                                             String themeColor, String instituteName, String adminLoginUrl) {
        String institute = escape(instituteName);
        String roleText = formatRoles(roles);
        return render(
                "Your " + institute + " login details — your account is ready to use.",
                "Login details",
                "Your login details for " + institute,
                "Hi " + escape(firstName(name)) + ", you're on the " + institute + " team as "
                        + "<strong style=\"color:#111827;\">" + roleText + "</strong>. "
                        + "Your account is ready — sign in with the details below whenever you like.",
                "Sign in",
                username, password, roles, themeColor, instituteName, adminLoginUrl
        );
    }

    /**
     * For an account that already exists — added to one more institute, or reminded after it
     * has signed in before. Carries NO password: the stored one belongs to the member (they may
     * have changed it) and is never mailed out. The username is shown as a memory aid.
     *
     * @param justAdded true when this institute has just added them (invite), false for a
     *                  sign-in reminder
     */
    public static String createExistingAccountEmail(String name, String username, List<String> roles,
                                                    String themeColor, String instituteName, String adminLoginUrl,
                                                    boolean justAdded) {
        String institute = escape(instituteName);
        String roleText = formatRoles(roles);
        String hi = "Hi " + escape(firstName(name)) + ", ";
        String asRoles = "<strong style=\"color:#111827;\">" + roleText + "</strong>";
        String forgot = " If you don't remember your password, use <strong style=\"color:#111827;\">Forgot password</strong> on the sign-in page.";
        String intro = justAdded
                ? hi + institute + " has added you to its team as " + asRoles + ". "
                        + "Sign in with the login you already use — your username and password haven't changed." + forgot
                : hi + "you're on the " + institute + " team as " + asRoles + ". "
                        + "Sign in with the username and password you already use." + forgot;
        return render(
                justAdded
                        ? "You've been added to " + institute + " — sign in with your existing login."
                        : "Sign in to " + institute + " with your existing login.",
                justAdded ? "Team update" : "Sign in",
                justAdded ? "You've been added to " + institute : "Sign in to " + institute,
                intro,
                "Sign in",
                credentialRows(true, false), username, null, roles, themeColor, instituteName, adminLoginUrl
        );
    }

    /** Subject line for a new account's welcome. */
    public static String inviteSubject(String instituteName) {
        return "Your " + instituteName + " account is ready";
    }

    /** Subject line for "Resend login details". */
    public static String reminderSubject(String instituteName) {
        return "Your login details for " + instituteName;
    }

    /** Subject line for an existing account added to (or reminded of) an institute. */
    public static String existingAccountSubject(String instituteName, boolean justAdded) {
        return justAdded ? "You've been added to " + instituteName : "Sign in to " + instituteName;
    }

    private static String render(String preheader, String eyebrow, String headline, String intro, String ctaLabel,
                                 String username, String password, List<String> roles,
                                 String themeColor, String instituteName, String adminLoginUrl) {
        return render(preheader, eyebrow, headline, intro, ctaLabel, credentialRows(true, true),
                username, password, roles, themeColor, instituteName, adminLoginUrl);
    }

    private static String render(String preheader, String eyebrow, String headline, String intro, String ctaLabel,
                                 String credentialRows, String username, String password, List<String> roles,
                                 String themeColor, String instituteName, String adminLoginUrl) {
        String theme = resolveThemeColor(themeColor);
        String institute = escape(instituteName);
        String url = escape(adminLoginUrl);

        return TEMPLATE
                .replace("{{preheader}}", preheader)
                .replace("{{eyebrow}}", eyebrow)
                .replace("{{headline}}", headline)
                .replace("{{intro}}", intro)
                .replace("{{ctaLabel}}", ctaLabel)
                .replace("{{credentialRows}}", credentialRows)
                .replace("{{institute}}", institute)
                .replace("{{username}}", escape(username))
                .replace("{{password}}", escape(password))
                .replace("{{roleChips}}", roleChips(roles))
                .replace("{{roleLabel}}", roles != null && roles.size() > 1 ? "Roles" : "Role")
                .replace("{{url}}", url)
                .replace("{{theme}}", theme)
                .replace("{{font}}", FONT_STACK)
                .replace("{{mono}}", MONO_STACK)
                .replace("{{year}}", String.valueOf(java.time.Year.now().getValue()));
    }

    private static final String USERNAME_ROW = """
                                            <tr>
                                              <td style="padding:14px 0;border-bottom:1px solid #e5e7eb;">
                                                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                                                  <tr>
                                                    <td width="168" valign="middle" style="width:168px;font-family:{{font}};font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#6b7280;">Username</td>
                                                    <td valign="middle" style="font-family:{{mono}};font-size:16px;font-weight:600;color:#111827;">{{username}}</td>
                                                  </tr>
                                                </table>
                                              </td>
                                            </tr>
            """;

    private static final String PASSWORD_ROW = """
                                            <tr>
                                              <td style="padding:14px 0;border-bottom:1px solid #e5e7eb;">
                                                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                                                  <tr>
                                                    <td width="168" valign="middle" style="width:168px;font-family:{{font}};font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#6b7280;">Password</td>
                                                    <td valign="middle" style="font-family:{{mono}};font-size:16px;font-weight:600;color:#111827;">{{password}}</td>
                                                  </tr>
                                                </table>
                                              </td>
                                            </tr>
            """;

    private static String credentialRows(boolean withUsername, boolean withPassword) {
        return (withUsername ? USERNAME_ROW : "") + (withPassword ? PASSWORD_ROW : "");
    }

    // Institutes store either a hex code or a colour name in institute_theme_code; anything
    // else would land verbatim inside a style attribute, so only pass through what we can vouch for.
    static String resolveThemeColor(String themeCode) {
        if (themeCode == null || themeCode.isBlank()) {
            return DEFAULT_THEME_COLOR;
        }
        String code = themeCode.trim();
        if (HEX_COLOR.matcher(code).matches()) {
            return code;
        }
        return switch (code.toLowerCase(Locale.ROOT)) {
            case "red" -> "#e74c3c";
            case "purple" -> "#9b59b6";
            case "blue" -> "#3498db";
            case "green" -> "#27ae60";
            case "amber", "orange" -> "#f39c12";
            default -> DEFAULT_THEME_COLOR;
        };
    }

    /** "TEACHER" -> "Teacher", "COURSE_CREATOR" -> "Course Creator". */
    static String prettifyRole(String role) {
        if (role == null || role.isBlank()) {
            return "";
        }
        return java.util.Arrays.stream(role.trim().split("[_\\s]+"))
                .filter(w -> !w.isEmpty())
                .map(w -> w.substring(0, 1).toUpperCase(Locale.ROOT) + w.substring(1).toLowerCase(Locale.ROOT))
                .collect(Collectors.joining(" "));
    }

    private static String formatRoles(List<String> roles) {
        if (roles == null || roles.isEmpty()) {
            return "a team member";
        }
        List<String> pretty = roles.stream().map(InviteUserEmailBody::prettifyRole)
                .filter(r -> !r.isEmpty()).map(InviteUserEmailBody::escape).collect(Collectors.toList());
        if (pretty.isEmpty()) {
            return "a team member";
        }
        if (pretty.size() == 1) {
            return pretty.get(0);
        }
        return String.join(", ", pretty.subList(0, pretty.size() - 1)) + " and " + pretty.get(pretty.size() - 1);
    }

    private static String roleChips(List<String> roles) {
        if (roles == null || roles.isEmpty()) {
            return "<span style=\"font-family:{{font}};font-size:14px;color:#111827;\">—</span>";
        }
        return roles.stream()
                .map(InviteUserEmailBody::prettifyRole)
                .filter(r -> !r.isEmpty())
                .map(r -> "<span style=\"display:inline-block;padding:3px 10px;margin:0 6px 4px 0;border-radius:999px;"
                        + "background-color:#eef2f7;color:#111827;font-family:{{font}};font-size:13px;font-weight:600;"
                        + "line-height:18px;white-space:nowrap;\">" + escape(r) + "</span>")
                .collect(Collectors.joining());
    }

    private static String firstName(String fullName) {
        if (fullName == null || fullName.isBlank()) {
            return "there";
        }
        return fullName.trim().split("\\s+")[0];
    }

    static String escape(String value) {
        if (value == null) {
            return "";
        }
        StringBuilder sb = new StringBuilder(value.length());
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '&' -> sb.append("&amp;");
                case '<' -> sb.append("&lt;");
                case '>' -> sb.append("&gt;");
                case '"' -> sb.append("&quot;");
                case '\'' -> sb.append("&#39;");
                default -> sb.append(c);
            }
        }
        return sb.toString();
    }

    private static final String TEMPLATE = """
            <!DOCTYPE html>
            <html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <meta http-equiv="X-UA-Compatible" content="IE=edge">
              <meta name="x-apple-disable-message-reformatting">
              <meta name="color-scheme" content="light">
              <meta name="supported-color-schemes" content="light">
              <title>{{headline}}</title>
              <!--[if mso]>
              <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
              <![endif]-->
              <style>
                body { margin:0; padding:0; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
                table, td { border-collapse:collapse; mso-table-lspace:0pt; mso-table-rspace:0pt; }
                img { border:0; line-height:100%; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; }
                a[x-apple-data-detectors] { color:inherit !important; text-decoration:none !important; }
                @media only screen and (max-width: 620px) {
                  .container { width:100% !important; }
                  .px { padding-left:24px !important; padding-right:24px !important; }
                  .h1 { font-size:22px !important; line-height:30px !important; }
                }
              </style>
            </head>
            <body style="margin:0;padding:0;background-color:#f3f4f6;" bgcolor="#f3f4f6">
              <!-- Preheader: inbox preview text, hidden in the body -->
              <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#f3f4f6;opacity:0;mso-hide:all;">{{preheader}}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f4f6;" bgcolor="#f3f4f6">
                <tr>
                  <td align="center" style="padding:32px 16px;">

                    <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">

                      <!-- Card -->
                      <tr>
                        <td style="background-color:#ffffff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;" bgcolor="#ffffff">
                          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">

                            <!-- Brand accent bar -->
                            <tr>
                              <td style="height:5px;line-height:5px;font-size:5px;background-color:{{theme}};border-radius:12px 12px 0 0;" bgcolor="{{theme}}">&nbsp;</td>
                            </tr>

                            <!-- Institute wordmark -->
                            <tr>
                              <td class="px" align="center" style="padding:28px 40px 8px 40px;">
                                <span style="font-family:{{font}};font-size:20px;font-weight:700;letter-spacing:-0.2px;color:#111827;">{{institute}}</span>
                              </td>
                            </tr>

                            <!-- Eyebrow + headline -->
                            <tr>
                              <td class="px" align="center" style="padding:16px 40px 0 40px;">
                                <span style="display:inline-block;font-family:{{font}};font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:{{theme}};">{{eyebrow}}</span>
                              </td>
                            </tr>
                            <tr>
                              <td class="px h1" align="center" style="padding:8px 40px 0 40px;font-family:{{font}};font-size:26px;line-height:34px;font-weight:700;color:#111827;">
                                {{headline}}
                              </td>
                            </tr>

                            <!-- Intro -->
                            <tr>
                              <td class="px" align="center" style="padding:16px 40px 0 40px;font-family:{{font}};font-size:16px;line-height:26px;color:#4b5563;">
                                {{intro}}
                              </td>
                            </tr>

                            <!-- Credentials card -->
                            <tr>
                              <td class="px" style="padding:28px 40px 0 40px;">
                                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;" bgcolor="#f9fafb">
                                  <tr>
                                    <td style="padding:6px 20px 0 20px;">
                                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                                        {{credentialRows}}
                                        <tr>
                                          <td style="padding:14px 0 12px 0;">
                                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                                              <tr>
                                                <td width="168" valign="middle" style="width:168px;font-family:{{font}};font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#6b7280;">{{roleLabel}}</td>
                                                <td valign="middle">{{roleChips}}</td>
                                              </tr>
                                            </table>
                                          </td>
                                        </tr>
                                      </table>
                                    </td>
                                  </tr>
                                </table>
                              </td>
                            </tr>

                            <!-- CTA -->
                            <tr>
                              <td class="px" align="center" style="padding:28px 40px 0 40px;">
                                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                                  <tr>
                                    <td align="center" style="border-radius:8px;background-color:{{theme}};" bgcolor="{{theme}}">
                                      <a href="{{url}}" target="_blank"
                                         style="display:inline-block;padding:14px 32px;font-family:{{font}};font-size:16px;font-weight:700;line-height:20px;color:#ffffff !important;text-decoration:none;border-radius:8px;border:1px solid {{theme}};">
                                        <span style="color:#ffffff;">{{ctaLabel}}</span>
                                      </a>
                                    </td>
                                  </tr>
                                </table>
                              </td>
                            </tr>

                            <!-- Sign-off -->
                            <tr>
                              <td class="px" align="center" style="padding:32px 40px 36px 40px;font-family:{{font}};font-size:15px;line-height:24px;color:#4b5563;">
                                Best regards,<br>
                                <strong style="color:#111827;">{{institute}}</strong>
                              </td>
                            </tr>

                          </table>
                        </td>
                      </tr>

                      <!-- Footer -->
                      <tr>
                        <td align="center" style="padding:20px 24px 0 24px;font-family:{{font}};font-size:12px;line-height:18px;color:#9ca3af;">
                          This email was sent to you by {{institute}}.<br>
                          &copy; {{year}} {{institute}}. All rights reserved.
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
