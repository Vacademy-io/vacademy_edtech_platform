package vacademy.io.notification_service.features.email_otp.service;

import org.springframework.util.StringUtils;
import org.springframework.web.util.HtmlUtils;
import vacademy.io.notification_service.util.ThemeColorResolver;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * HTML body of the email OTP (login, signup, invite registration all share it).
 *
 * <p>Everything visible comes from the caller: institute name, theme, logo, contact email and
 * website. The text is painted in the institute's theme; a light theme (yellow, lime, …) is
 * darkened until it reads on white, so no theme can make the code disappear again. Styles are
 * inline and the layout is tables, which is what Gmail and Outlook keep.
 *
 * <p>Email clients run no JavaScript, so there is no copy button: the code box is
 * {@code user-select: all}, one tap selects the whole code, and the letter spacing is CSS only,
 * so what gets copied has no spaces.
 */
public final class OtpEmailBody {

    private static final String BODY_GREY = "#4B5563";
    private static final String MUTED_GREY = "#9CA3AF";
    private static final String WHITE = "#FFFFFF";
    private static final String BLACK = "#000000";

    private OtpEmailBody() {
    }

    /**
     * @param instituteName shown in the header, copy and footer; required
     * @param themeCode     institute_theme_code (preset code or hex); blank/unknown = app default
     * @param otp           the code
     * @param logoUrl       public logo URL, or null for a theme-coloured initial tile
     * @param contactEmail  footer email, or null to omit
     * @param websiteUrl    footer website, or null to omit (never a platform fallback)
     */
    public static String build(String instituteName, String themeCode, String otp, String logoUrl,
            String contactEmail, String websiteUrl) {
        String theme = ThemeColorResolver.resolveOrDefault(themeCode);
        String big = readable(theme, 3.0);      // heading + code: large bold text, AA-large
        String ink = readable(theme, 4.5);      // small emphasised text, AA
        String body = mix(ink, BODY_GREY, 0.35);
        String muted = mix(ink, MUTED_GREY, 0.25);
        String soft = mix(theme, WHITE, 0.08);
        String border = mix(theme, WHITE, 0.25);
        String note = mix(theme, WHITE, 0.05);

        String name = esc(StringUtils.hasText(instituteName) ? instituteName.trim() : "");
        String code = esc(otp == null ? "" : otp);

        String header = StringUtils.hasText(logoUrl)
                ? "<img src=\"" + esc(logoUrl.trim()) + "\" width=\"64\" height=\"64\" alt=\"" + name + "\""
                        + " style=\"display:block;margin:0 auto 12px;width:64px;height:64px;border-radius:14px;border:0;\">"
                : "<div style=\"width:56px;height:56px;line-height:56px;margin:0 auto 12px;border-radius:14px;"
                        + "background:" + big + ";color:#FFFFFF;font-size:24px;font-weight:700;text-align:center;\">"
                        + esc(initial(instituteName)) + "</div>";

        List<String> contact = new ArrayList<>();
        if (StringUtils.hasText(contactEmail)) {
            String e = esc(contactEmail.trim());
            contact.add("<a href=\"mailto:" + e + "\" style=\"color:" + ink + ";text-decoration:underline;\">" + e + "</a>");
        }
        if (StringUtils.hasText(websiteUrl)) {
            String shown = websiteUrl.trim();
            String href = shown.matches("(?i)^[a-z][a-z0-9+.\\-]*://.*") ? shown : "https://" + shown;
            shown = shown.replaceFirst("(?i)^https?://", "").replaceFirst("/$", "");
            contact.add("<a href=\"" + esc(href) + "\" style=\"color:" + ink + ";text-decoration:underline;\">"
                    + esc(shown) + "</a>");
        }
        String contactRow = contact.isEmpty() ? ""
                : "<div style=\"margin-top:4px;\">" + String.join(" &nbsp;&middot;&nbsp; ", contact) + "</div>";

        return """
                <!DOCTYPE html>
                <html>
                <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width,initial-scale=1">
                <title>Verification code</title>
                </head>
                <body style="margin:0;padding:0;background:#F3F4F6;">
                <div style="display:none;max-height:0;overflow:hidden;opacity:0;">{{code}} is your {{name}} verification code. It expires in 10 minutes.</div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;"><tr><td align="center" style="padding:32px 16px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border-radius:16px;overflow:hidden;border:1px solid #E5E7EB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                <tr><td style="height:4px;background:{{theme}};font-size:0;line-height:0;">&nbsp;</td></tr>
                <tr><td align="center" style="padding:32px 32px 8px;">
                {{header}}
                <div style="font-size:14px;font-weight:700;color:{{ink}};letter-spacing:.2px;">{{name}}</div>
                </td></tr>
                <tr><td align="center" style="padding:16px 32px 0;">
                <h1 style="margin:0;font-size:22px;line-height:30px;font-weight:700;color:{{big}};">Your verification code</h1>
                <p style="margin:8px 0 0;font-size:15px;line-height:22px;color:{{body}};">Enter this code to continue to {{name}}.</p>
                </td></tr>
                <tr><td align="center" style="padding:24px 32px;">
                <div style="display:inline-block;padding:16px 28px;background:{{soft}};border:1px solid {{border}};border-radius:12px;font-family:'SF Mono',Menlo,Consolas,'Courier New',monospace;font-size:34px;line-height:40px;font-weight:700;letter-spacing:10px;-webkit-user-select:all;user-select:all;cursor:pointer;color:{{big}};">{{code}}</div>
                <p style="margin:14px 0 0;font-size:13px;line-height:20px;color:{{body}};"><span style="color:{{ink}};font-weight:600;">Tap the code to select it, then copy</span><br>Expires in <b style="color:{{ink}};">10 minutes</b> &middot; can be used only once</p>
                </td></tr>
                <tr><td style="padding:0 32px 28px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{{note}};border:1px solid {{border}};border-radius:10px;"><tr><td style="padding:14px 16px;font-size:13px;line-height:20px;color:{{body}};">
                &#128274; <b style="color:{{ink}};">Keep this code private.</b> {{name}} will never ask for it on a call, chat or email. If you didn't request it, you can safely ignore this email.
                </td></tr></table>
                </td></tr>
                <tr><td align="center" style="padding:18px 32px 24px;border-top:1px solid {{note}};font-size:12px;line-height:18px;color:{{muted}};">
                <div style="color:{{ink}};font-weight:700;">{{name}}</div>{{contact}}
                <div style="margin-top:8px;">This is an automated message &mdash; please don't reply.</div>
                </td></tr>
                </table>
                </td></tr></table>
                </body>
                </html>
                """
                // Every inserted value is HTML-escaped or a computed colour.
                .replace("{{header}}", header)
                .replace("{{contact}}", contactRow)
                .replace("{{theme}}", theme)
                .replace("{{big}}", big)
                .replace("{{ink}}", ink)
                .replace("{{body}}", body)
                .replace("{{muted}}", muted)
                .replace("{{soft}}", soft)
                .replace("{{border}}", border)
                .replace("{{note}}", note)
                .replace("{{code}}", code)
                .replace("{{name}}", name);
    }

    private static String esc(String s) {
        return HtmlUtils.htmlEscape(s == null ? "" : s);
    }

    private static String initial(String name) {
        if (!StringUtils.hasText(name)) return "";
        String t = name.trim();
        return new String(Character.toChars(t.codePointAt(0))).toUpperCase(Locale.ROOT);
    }

    /** The theme, darkened just enough to reach {@code minContrast} against white. */
    static String readable(String hex, double minContrast) {
        String c = hex;
        double keep = 1.0;
        while (contrastOnWhite(c) < minContrast && keep > 0.3) {
            keep -= 0.05;
            c = mix(hex, BLACK, keep);
        }
        return c;
    }

    /** {@code a * t + b * (1 - t)} per channel. */
    static String mix(String a, String b, double t) {
        int[] x = rgb(a);
        int[] y = rgb(b);
        int[] out = new int[3];
        for (int i = 0; i < 3; i++) {
            out[i] = (int) Math.max(0, Math.min(255, Math.round(x[i] * t + y[i] * (1 - t))));
        }
        return String.format("#%02X%02X%02X", out[0], out[1], out[2]);
    }

    static double contrastOnWhite(String hex) {
        return 1.05 / (luminance(hex) + 0.05);
    }

    private static double luminance(String hex) {
        int[] c = rgb(hex);
        double[] l = new double[3];
        for (int i = 0; i < 3; i++) {
            double v = c[i] / 255.0;
            l[i] = v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        }
        return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
    }

    private static int[] rgb(String hex) {
        String h = hex.startsWith("#") ? hex.substring(1) : hex;
        return new int[] { Integer.parseInt(h.substring(0, 2), 16), Integer.parseInt(h.substring(2, 4), 16),
                Integer.parseInt(h.substring(4, 6), 16) };
    }
}
