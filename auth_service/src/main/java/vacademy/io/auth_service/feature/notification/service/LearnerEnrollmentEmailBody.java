package vacademy.io.auth_service.feature.notification.service;

import org.springframework.util.StringUtils;
import org.springframework.web.util.HtmlUtils;

import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The built-in "You're enrolled!" mail a learner gets when an institute enrolls them and has no
 * enrollment template of its own. Same look as {@link ProductWelcomeEmailBody} (tables and inline
 * styles, which Gmail and Outlook keep), painted with the institute's theme and logo.
 *
 * <p>Two wordings: a learner who has never signed in is welcomed to a new account; a learner who
 * already uses the account is told the course was added to it and their details are unchanged.
 * Both show the sign-in details, as the mail always has.
 */
public final class LearnerEnrollmentEmailBody {

    private static final String BODY_GREY = "#4B5563";
    private static final String MUTED_GREY = "#9CA3AF";
    private static final String WHITE = "#FFFFFF";
    private static final Pattern PLACEHOLDER = Pattern.compile("\\{\\{(\\w+)}}");

    private LearnerEnrollmentEmailBody() {
    }

    /**
     * @param instituteName  shown in the copy and the footer; required
     * @param themeCode      institutes.institute_theme_code (preset or hex); blank or unknown paints neutral
     * @param logoUrl        public logo URL, or null for a theme-coloured initial tile
     * @param fullName       the learner's name, may be null
     * @param username       login username
     * @param password       login password, or null to leave the row out
     * @param loginUrl       where the button goes, or null for no button
     * @param supportEmail   footer contact address, or null to omit
     * @param returning      true when the learner already uses this account, false for a first sign-in
     */
    public static String build(String instituteName, String themeCode, String logoUrl, String fullName,
            String username, String password, String loginUrl, String supportEmail, boolean returning) {
        String theme = ThemeColorResolver.resolveOrNeutral(themeCode);
        String big = ProductWelcomeEmailBody.readable(theme, 3.0);
        String ink = ProductWelcomeEmailBody.readable(theme, 4.5);
        String body = ProductWelcomeEmailBody.mix(ink, BODY_GREY, 0.35);
        String muted = ProductWelcomeEmailBody.mix(ink, MUTED_GREY, 0.25);
        String soft = ProductWelcomeEmailBody.mix(theme, WHITE, 0.06);
        String border = ProductWelcomeEmailBody.mix(theme, WHITE, 0.22);
        String note = ProductWelcomeEmailBody.mix(theme, WHITE, 0.05);

        String name = esc(StringUtils.hasText(instituteName) ? instituteName.trim() : "");
        String strongName = "<b style=\"color:" + ink + ";\">" + name + "</b>";

        String header = isWebUrl(logoUrl)
                // Width only, so a logo that is not square keeps its shape.
                ? "<img src=\"" + esc(logoUrl.trim()) + "\" width=\"128\" alt=\"" + name + "\""
                        + " style=\"display:block;margin:0 auto 4px;width:128px;max-width:128px;height:auto;border:0;\">"
                : "<div style=\"width:56px;height:56px;line-height:56px;margin:0 auto 12px;border-radius:14px;"
                        + "background:" + big + ";color:#FFFFFF;font-size:24px;font-weight:700;text-align:center;\">"
                        + esc(initial(instituteName)) + "</div>"
                        + "<div style=\"font-size:14px;font-weight:700;color:" + ink + ";letter-spacing:.2px;\">" + name + "</div>";

        String preheader;
        String intro;
        String cta;
        String noteText;
        if (returning) {
            preheader = "You're enrolled in a new course at " + name + ". Sign in with your existing account.";
            intro = "You've been enrolled in a new course at " + strongName + ". It's added to your existing"
                    + " account, so sign in with the same details as before.";
            cta = "Continue learning";
            noteText = "&#128273; <b style=\"color:" + ink + ";\">These are your existing login details.</b>"
                    + " Nothing has changed. If you've forgotten your password, use <i>Forgot password</i> on the"
                    + " sign-in page.";
        } else {
            preheader = "You're enrolled at " + name + ". Here are your sign-in details.";
            intro = "Welcome to " + strongName + ". Your enrollment is complete and your learner account is ready."
                    + " Sign in with the details below to start learning.";
            cta = "Start learning";
            noteText = "&#128274; <b style=\"color:" + ink + ";\">Keep these details private.</b>"
                    + " Don't share your password with anyone.";
        }

        String rows = (StringUtils.hasText(username) ? row("Username", username, ink, body) : "")
                + (StringUtils.hasText(password) ? row("Password", password, ink, body) : "");
        String credentials = rows.isEmpty() ? ""
                : "<tr><td style=\"padding:20px 32px 24px;\">"
                        + "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background:"
                        + soft + ";border:1px solid " + border + ";border-radius:12px;\">" + rows + "</table></td></tr>";

        String button = "";
        if (StringUtils.hasText(loginUrl)) {
            String href = esc(loginUrl.trim());
            String shown = esc(loginUrl.trim().replaceFirst("(?i)^https?://", "").replaceFirst("/$", ""));
            button = "<tr><td align=\"center\" style=\"padding:0 32px 8px;\">"
                    + "<a href=\"" + href + "\" style=\"display:inline-block;background:" + big + ";color:#FFFFFF;"
                    + "padding:13px 32px;border-radius:10px;font-size:15px;font-weight:700;text-decoration:none;\">"
                    + cta + "</a></td></tr>"
                    + "<tr><td align=\"center\" style=\"padding:0 32px 24px;font-size:12px;line-height:18px;color:" + muted
                    + ";\">or open <a href=\"" + href + "\" style=\"color:" + ink + ";text-decoration:underline;\">"
                    + shown + "</a></td></tr>";
        }

        String contact = "";
        if (StringUtils.hasText(supportEmail)) {
            String e = esc(supportEmail.trim());
            contact = "<div style=\"margin-top:4px;\">Questions? <a href=\"mailto:" + e + "\" style=\"color:" + ink
                    + ";text-decoration:underline;\">" + e + "</a></div>";
        }

        Map<String, String> values = new HashMap<>();
        values.put("name", name);
        values.put("preheader", preheader);
        values.put("theme", theme);
        values.put("header", header);
        values.put("soft", soft);
        values.put("border", border);
        values.put("ink", ink);
        values.put("big", big);
        values.put("body", body);
        values.put("muted", muted);
        values.put("note", note);
        values.put("greeting", StringUtils.hasText(fullName) ? "Hi " + esc(fullName.trim()) + "," : "Hi,");
        values.put("intro", intro);
        values.put("credentials", credentials);
        values.put("button", button);
        values.put("noteText", noteText);
        values.put("contact", contact);

        return fill("""
                <!DOCTYPE html>
                <html>
                <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width,initial-scale=1">
                <title>Course Enrollment - {{name}}</title>
                </head>
                <body style="margin:0;padding:0;background:#F3F4F6;">
                <div style="display:none;max-height:0;overflow:hidden;opacity:0;">{{preheader}}</div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;"><tr><td align="center" style="padding:32px 16px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border-radius:16px;overflow:hidden;border:1px solid #E5E7EB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                <tr><td style="height:4px;background:{{theme}};font-size:0;line-height:0;">&nbsp;</td></tr>
                <tr><td align="center" style="padding:24px 32px 0;">{{header}}</td></tr>
                <tr><td align="center" style="padding:12px 32px 0;">
                <div style="display:inline-block;padding:4px 12px;border-radius:999px;background:{{soft}};border:1px solid {{border}};font-size:12px;font-weight:700;color:{{ink}};">&#10003; Enrollment complete</div>
                <h1 style="margin:12px 0 0;font-size:26px;line-height:34px;font-weight:700;color:{{big}};">You're enrolled!</h1>
                </td></tr>
                <tr><td style="padding:20px 32px 0;font-size:15px;line-height:23px;color:{{body}};">
                <p style="margin:0 0 8px;">{{greeting}}</p>
                <p style="margin:0;">{{intro}}</p>
                </td></tr>
                {{credentials}}
                {{button}}
                <tr><td style="padding:0 32px 28px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{{note}};border:1px solid {{border}};border-radius:10px;"><tr><td style="padding:14px 16px;font-size:13px;line-height:20px;color:{{body}};">
                {{noteText}}
                </td></tr></table>
                </td></tr>
                <tr><td align="center" style="padding:18px 32px 24px;border-top:1px solid {{note}};font-size:12px;line-height:18px;color:{{muted}};">
                <div style="color:{{ink}};font-weight:700;">{{name}}</div>{{contact}}
                <div style="margin-top:8px;">You're receiving this because you enrolled at {{name}}.</div>
                </td></tr>
                </table>
                </td></tr></table>
                </body>
                </html>
                """, values);
    }

    /** One pass, so a value that happens to contain "{{x}}" is never filled in again. */
    private static String fill(String template, Map<String, String> values) {
        Matcher m = PLACEHOLDER.matcher(template);
        StringBuilder out = new StringBuilder();
        while (m.find()) {
            String v = values.get(m.group(1));
            m.appendReplacement(out, Matcher.quoteReplacement(v != null ? v : m.group(0)));
        }
        m.appendTail(out);
        return out.toString();
    }

    private static String row(String label, String value, String ink, String body) {
        return "<tr><td style=\"padding:12px 16px 0;font-size:12px;line-height:16px;font-weight:700;color:" + ink
                + ";text-transform:uppercase;letter-spacing:.6px;\">" + label + "</td></tr>"
                + "<tr><td style=\"padding:4px 16px 12px;font-family:'SF Mono',Menlo,Consolas,'Courier New',monospace;"
                + "font-size:17px;line-height:24px;font-weight:600;color:" + body
                + ";word-break:break-all;-webkit-user-select:all;user-select:all;\">" + esc(value) + "</td></tr>";
    }

    private static boolean isWebUrl(String url) {
        return url != null && url.trim().matches("(?i)^https?://\\S+$");
    }

    private static String esc(String s) {
        return HtmlUtils.htmlEscape(s == null ? "" : s);
    }

    private static String initial(String name) {
        if (!StringUtils.hasText(name)) return "";
        String t = name.trim();
        return new String(Character.toChars(t.codePointAt(0))).toUpperCase(Locale.ROOT);
    }
}
