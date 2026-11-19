package vacademy.io.auth_service.feature.notification.service;

import org.springframework.util.StringUtils;
import org.springframework.web.util.HtmlUtils;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Welcome mail of a product self sign-up (a product with its own name, sender and look). It welcomes
 * the person to the product, not to the workspace the sign-up created for them; the institute welcome
 * ({@link NotificationEmailBody#createWelcomeEmailBody}) is for people an institute adds.
 *
 * <p>Everything visible comes from the product settings and the new account: product name, theme,
 * logo, login URL, contact email and website. Same layout as the sign-up code mail (tables and inline
 * styles, which Gmail and Outlook keep), so the two read as one product.
 */
public final class ProductWelcomeEmailBody {

    private static final String BODY_GREY = "#4B5563";
    private static final String MUTED_GREY = "#9CA3AF";
    private static final String WHITE = "#FFFFFF";
    private static final String BLACK = "#000000";
    /** Brand-neutral, used only when the product has no valid theme colour. */
    private static final String NEUTRAL = "#111827";

    private ProductWelcomeEmailBody() {
    }

    /** A link the mail lists under the sign-in details, like one of the product's video tutorials. */
    public record Link(String title, String url, String subtitle) {
    }

    /** The welcome without a list of links. */
    public static String build(String productName, String themeHex, String logoUrl, String fullName,
            String workspaceName, String username, String password, String loginUrl, String contactEmail,
            String websiteUrl) {
        return build(productName, themeHex, logoUrl, fullName, workspaceName, username, password, loginUrl,
                contactEmail, websiteUrl, List.of());
    }

    /**
     * @param productName   the product's display name; required
     * @param themeHex      the product theme as #RRGGBB, else a neutral dark grey
     * @param logoUrl       public logo URL, or null for a theme-coloured initial tile
     * @param fullName      the new account's name, may be null
     * @param workspaceName the workspace the sign-up created; shown when it differs from the person's name
     * @param username      login username
     * @param password      login password, or null to leave the row out
     * @param loginUrl      where the button goes, or null for no button
     * @param contactEmail  footer email, or null to omit
     * @param websiteUrl    footer website, or null to omit
     * @param videos        the product's video tutorials, listed under the button; https links only, empty for none
     */
    public static String build(String productName, String themeHex, String logoUrl, String fullName,
            String workspaceName, String username, String password, String loginUrl, String contactEmail,
            String websiteUrl, List<Link> videos) {
        String theme = themeHex != null && themeHex.trim().matches("^#[0-9A-Fa-f]{6}$") ? themeHex.trim() : NEUTRAL;
        String big = readable(theme, 3.0);
        String ink = readable(theme, 4.5);
        String body = mix(ink, BODY_GREY, 0.35);
        String muted = mix(ink, MUTED_GREY, 0.25);
        String soft = mix(theme, WHITE, 0.06);
        String border = mix(theme, WHITE, 0.22);
        String note = mix(theme, WHITE, 0.05);

        String name = esc(StringUtils.hasText(productName) ? productName.trim() : "");
        String greeting = StringUtils.hasText(fullName) ? "Hi " + esc(fullName.trim()) + "," : "Hi,";

        String header = StringUtils.hasText(logoUrl)
                ? "<img src=\"" + esc(logoUrl.trim()) + "\" width=\"64\" height=\"64\" alt=\"" + name + "\""
                        + " style=\"display:block;margin:0 auto 12px;width:64px;height:64px;border-radius:14px;border:0;\">"
                : "<div style=\"width:56px;height:56px;line-height:56px;margin:0 auto 12px;border-radius:14px;"
                        + "background:" + big + ";color:#FFFFFF;font-size:24px;font-weight:700;text-align:center;\">"
                        + esc(initial(productName)) + "</div>";

        boolean showWorkspace = StringUtils.hasText(workspaceName)
                && !workspaceName.trim().equalsIgnoreCase(fullName == null ? "" : fullName.trim());
        String intro = "Your " + name + " account is ready"
                + (showWorkspace ? " and your workspace <b style=\"color:" + ink + ";\">" + esc(workspaceName.trim())
                        + "</b> has been created" : "")
                + ". Sign in with the details below.";

        String rows = row("Username", username, ink, body)
                + (StringUtils.hasText(password) ? row("Password", password, ink, body) : "");

        String button = StringUtils.hasText(loginUrl)
                ? "<tr><td align=\"center\" style=\"padding:0 32px 28px;\">"
                        + "<a href=\"" + esc(loginUrl.trim()) + "\" style=\"display:inline-block;background:" + big
                        + ";color:#FFFFFF;padding:13px 28px;border-radius:10px;font-size:15px;font-weight:700;"
                        + "text-decoration:none;\">Open " + name + "</a></td></tr>"
                : "";

        String videoList = videos(videos, name, big, ink, body, muted);

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
                <title>Welcome to {{name}}</title>
                </head>
                <body style="margin:0;padding:0;background:#F3F4F6;">
                <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your {{name}} account is ready. Here are your sign-in details.</div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;"><tr><td align="center" style="padding:32px 16px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border-radius:16px;overflow:hidden;border:1px solid #E5E7EB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                <tr><td style="height:4px;background:{{theme}};font-size:0;line-height:0;">&nbsp;</td></tr>
                <tr><td align="center" style="padding:32px 32px 8px;">
                {{header}}
                <div style="font-size:14px;font-weight:700;color:{{ink}};letter-spacing:.2px;">{{name}}</div>
                </td></tr>
                <tr><td align="center" style="padding:16px 32px 0;">
                <h1 style="margin:0;font-size:24px;line-height:32px;font-weight:700;color:{{big}};">Welcome to {{name}}</h1>
                </td></tr>
                <tr><td style="padding:20px 32px 0;font-size:15px;line-height:23px;color:{{body}};">
                <p style="margin:0 0 8px;">{{greeting}}</p>
                <p style="margin:0;">{{intro}}</p>
                </td></tr>
                <tr><td style="padding:20px 32px 24px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{{soft}};border:1px solid {{border}};border-radius:12px;">
                {{rows}}
                </table>
                </td></tr>
                {{button}}
                {{videos}}
                <tr><td style="padding:0 32px 28px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{{note}};border:1px solid {{border}};border-radius:10px;"><tr><td style="padding:14px 16px;font-size:13px;line-height:20px;color:{{body}};">
                &#128274; <b style="color:{{ink}};">Keep these details private.</b> {{name}} will never ask for your password on a call, chat or email.
                </td></tr></table>
                </td></tr>
                <tr><td align="center" style="padding:18px 32px 24px;border-top:1px solid {{note}};font-size:12px;line-height:18px;color:{{muted}};">
                <div style="color:{{ink}};font-weight:700;">{{name}}</div>{{contact}}
                <div style="margin-top:8px;">You are receiving this because you signed up for {{name}}.</div>
                </td></tr>
                </table>
                </td></tr></table>
                </body>
                </html>
                """
                // Every inserted value is HTML-escaped or a computed colour.
                .replace("{{header}}", header)
                .replace("{{contact}}", contactRow)
                .replace("{{button}}", button)
                .replace("{{videos}}", videoList)
                .replace("{{rows}}", rows)
                .replace("{{theme}}", theme)
                .replace("{{big}}", big)
                .replace("{{ink}}", ink)
                .replace("{{body}}", body)
                .replace("{{muted}}", muted)
                .replace("{{soft}}", soft)
                .replace("{{border}}", border)
                .replace("{{note}}", note)
                .replace("{{name}}", name)
                .replace("{{intro}}", intro)
                .replace("{{greeting}}", greeting);
    }

    /** "Watch the video tutorials": one row per video, the whole row is the link. Empty when there are none. */
    private static String videos(List<Link> videos, String name, String big, String ink, String body, String muted) {
        if (videos == null || videos.isEmpty()) return "";
        StringBuilder rows = new StringBuilder();
        int shown = 0;
        for (Link v : videos) {
            if (v == null || !StringUtils.hasText(v.title()) || v.url() == null || !v.url().trim().startsWith("https://")) {
                continue;
            }
            String href = esc(v.url().trim());
            String cell = "border-top:" + (shown == 0 ? "0" : "1px solid #F3F4F6") + ";";
            rows.append("<tr><td style=\"padding:11px 14px;").append(cell).append("\">")
                    .append("<a href=\"").append(href).append("\" style=\"text-decoration:none;color:").append(ink)
                    .append(";font-size:14px;line-height:20px;font-weight:600;\">")
                    .append("<span style=\"display:inline-block;width:22px;height:22px;line-height:22px;border-radius:50%;background:")
                    .append(big).append(";color:#FFFFFF;font-size:9px;text-align:center;vertical-align:middle;margin-right:10px;\">&#9654;</span>")
                    .append(esc(v.title().trim())).append("</a></td>")
                    .append("<td align=\"right\" style=\"padding:11px 14px;").append(cell).append("font-size:12px;color:")
                    .append(muted).append(";white-space:nowrap;\">")
                    .append(StringUtils.hasText(v.subtitle()) ? esc(v.subtitle().trim()) : "").append("</td></tr>");
            shown++;
        }
        if (shown == 0) return "";
        return "<tr><td style=\"padding:0 32px 24px;\">"
                + "<div style=\"font-size:16px;line-height:22px;font-weight:700;color:" + big + ";\">Watch the video tutorials</div>"
                + "<div style=\"margin:2px 0 12px;font-size:13px;line-height:19px;color:" + body + ";\">Short videos that show each step in "
                + name + ".</div>"
                + "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"border:1px solid #E5E7EB;border-radius:12px;\">"
                + rows + "</table></td></tr>";
    }

    private static String row(String label, String value, String ink, String body) {
        return "<tr><td style=\"padding:12px 16px 0;font-size:12px;line-height:16px;font-weight:700;color:" + ink
                + ";text-transform:uppercase;letter-spacing:.6px;\">" + label + "</td></tr>"
                + "<tr><td style=\"padding:4px 16px 12px;font-family:'SF Mono',Menlo,Consolas,'Courier New',monospace;"
                + "font-size:17px;line-height:24px;font-weight:600;color:" + body
                + ";-webkit-user-select:all;user-select:all;\">" + esc(value == null ? "" : value) + "</td></tr>";
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
