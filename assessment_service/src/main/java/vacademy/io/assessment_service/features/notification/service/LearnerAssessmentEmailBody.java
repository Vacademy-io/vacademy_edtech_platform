package vacademy.io.assessment_service.features.notification.service;

import org.springframework.util.StringUtils;
import org.springframework.web.util.HtmlUtils;

import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Date;
import java.util.Locale;
import java.util.Map;

/**
 * Emails a learner gets about one assessment: registered, added by the institute, starts in N
 * minutes, and live now.
 *
 * <p>Everything visible comes from the institute (name, logo, theme colour, learner domain) or
 * the assessment — no platform name, domain or colour is written here, because white-label
 * institutes send these under their own name. When the institute has no learner domain the
 * "Open assessment" button is left out rather than pointing at a shared domain.
 *
 * <p>The learner's name is the per-recipient placeholder {@code {{learner_name}}}, filled in by
 * the notification service.
 */
public final class LearnerAssessmentEmailBody {

    public enum Kind { REGISTERED, ASSIGNED, REMINDER, LIVE }

    /** What the email shows about the institute. Any field may be blank. */
    public record Institute(String name, String themeCode, String logoUrl) {
    }

    /** What the email shows about the assessment. {@code link} may be null (no button then). */
    public record Details(String assessmentName, Date start, Date end, Integer durationMinutes,
                          Integer minutesBefore, String link) {
    }

    public record Content(String subject, String html) {
    }

    /** Neutral dark grey used when the institute's theme code is blank or unknown. */
    static final String NEUTRAL = "#1F2937";

    /** Mock and practice tests are stored as "open until 9999-12-31"; such dates are hidden. */
    private static final int OPEN_ENDED_YEAR = 9000;

    private static final DateTimeFormatter WHEN =
            DateTimeFormatter.ofPattern("d MMM yyyy, h:mm a z", Locale.ENGLISH);

    /** Preset theme codes the apps use; same table as notification_service's ThemeColorResolver. */
    private static final Map<String, String> PRESETS = Map.ofEntries(
            Map.entry("primary", "#ED7424"), Map.entry("blue", "#1E88E5"), Map.entry("green", "#43A047"),
            Map.entry("purple", "#8E24AA"), Map.entry("red", "#E53935"), Map.entry("pink", "#D81B60"),
            Map.entry("indigo", "#3949AB"), Map.entry("amber", "#FFB300"), Map.entry("cyan", "#00ACC1"),
            Map.entry("teal", "#00897B"), Map.entry("lime", "#7CB342"), Map.entry("violet", "#5E35B1"),
            Map.entry("maroon", "#9B2242"), Map.entry("navy", "#1A237E"), Map.entry("brown", "#6D4C41"),
            Map.entry("slate", "#546E7A"), Map.entry("charcoal", "#424242"), Map.entry("holistic", "#622335"),
            Map.entry("neutral", "#6B7280"));

    private LearnerAssessmentEmailBody() {
    }

    public static Content build(Kind kind, Institute institute, Details details, ZoneId zone) {
        String assessment = esc(details.assessmentName());
        String instituteName = institute != null && StringUtils.hasText(institute.name())
                ? esc(institute.name()) : null;

        String subject;
        String heading;
        String lead;
        switch (kind) {
            case REGISTERED -> {
                subject = "You're registered: " + details.assessmentName();
                heading = "You're registered";
                lead = "You have registered for <strong>" + assessment + "</strong>"
                        + (instituteName != null ? " at " + instituteName : "") + ".";
            }
            case ASSIGNED -> {
                subject = "New assessment: " + details.assessmentName();
                heading = "You have a new assessment";
                lead = (instituteName != null ? instituteName : "Your institute")
                        + " has added you to <strong>" + assessment + "</strong>.";
            }
            case REMINDER -> {
                int minutes = details.minutesBefore() == null ? 0 : details.minutesBefore();
                String in = minutes == 1 ? "1 minute" : minutes + " minutes";
                subject = details.assessmentName() + " starts in " + in;
                heading = "Starts in " + in;
                lead = "<strong>" + assessment + "</strong> starts in " + in
                        + ". Keep your device charged and your internet on.";
            }
            case LIVE -> {
                subject = details.assessmentName() + " has started";
                heading = "Your assessment is live";
                lead = "<strong>" + assessment + "</strong> has started. You can begin now.";
            }
            default -> throw new IllegalArgumentException("Unknown kind " + kind);
        }

        String color = resolveColor(institute != null ? institute.themeCode() : null);
        String buttonText = isLight(color) ? "#111827" : "#FFFFFF";

        StringBuilder rows = new StringBuilder();
        String start = formatWhen(details.start(), zone);
        String end = formatWhen(details.end(), zone);
        if (start != null) rows.append(row("Starts", start));
        if (end != null) rows.append(row("Ends", end));
        if (details.durationMinutes() != null && details.durationMinutes() > 0) {
            rows.append(row("Duration", details.durationMinutes() + " minutes"));
        }

        String button = StringUtils.hasText(details.link())
                ? "<tr><td style=\"padding:8px 0 4px\"><a href=\"" + esc(details.link()) + "\""
                + " style=\"display:inline-block;background:" + color + ";color:" + buttonText + ";"
                + "text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:8px\">"
                + (kind == Kind.LIVE ? "Start assessment" : "Open assessment") + "</a></td></tr>"
                : "";

        String signInNote = kind == Kind.REGISTERED || kind == Kind.ASSIGNED
                ? "<tr><td style=\"padding:12px 0 0;font-size:13px;color:#6B7280\">"
                + "Sign in with this email address to take the assessment.</td></tr>"
                : "";

        String logo = institute != null && StringUtils.hasText(institute.logoUrl())
                ? "<img src=\"" + esc(institute.logoUrl()) + "\" alt=\"" + (instituteName != null ? instituteName : "")
                + "\" height=\"40\" style=\"display:block;height:40px;max-width:180px;border:0\">"
                : (instituteName != null
                ? "<div style=\"font-size:16px;font-weight:700;color:#111827\">" + instituteName + "</div>" : "");

        String footer = instituteName != null
                ? "<p style=\"margin:16px 0 0;font-size:12px;color:#9CA3AF;text-align:center\">Sent by "
                + instituteName + "</p>"
                : "";

        String html = "<!DOCTYPE html><html><head><meta charset=\"UTF-8\">"
                + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"></head>"
                + "<body style=\"margin:0;padding:0;background:#F3F4F6;font-family:Arial,Helvetica,sans-serif\">"
                + "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background:#F3F4F6;padding:24px 12px\">"
                + "<tr><td align=\"center\">"
                + "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:520px;background:#FFFFFF;border-radius:12px;border-top:4px solid " + color + ";padding:28px\">"
                + (logo.isEmpty() ? "" : "<tr><td style=\"padding-bottom:20px\">" + logo + "</td></tr>")
                + "<tr><td style=\"font-size:20px;font-weight:700;color:#111827;padding-bottom:8px\">" + heading + "</td></tr>"
                + "<tr><td style=\"font-size:15px;color:#374151;line-height:22px;padding-bottom:4px\">Hi {{learner_name}},</td></tr>"
                + "<tr><td style=\"font-size:15px;color:#374151;line-height:22px;padding-bottom:16px\">" + lead + "</td></tr>"
                + (rows.length() == 0 ? "" : "<tr><td style=\"padding-bottom:16px\">"
                + "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background:#F9FAFB;border-radius:8px;padding:12px 16px\">"
                + rows + "</table></td></tr>")
                + button
                + signInNote
                + "</table>"
                + footer
                + "</td></tr></table></body></html>";

        return new Content(subject, html);
    }

    private static String row(String label, String value) {
        return "<tr><td style=\"font-size:13px;color:#6B7280;padding:4px 0;width:90px\">" + label + "</td>"
                + "<td style=\"font-size:14px;color:#111827;padding:4px 0;font-weight:600\">" + esc(value) + "</td></tr>";
    }

    static String formatWhen(Date date, ZoneId zone) {
        if (date == null) return null;
        ZonedDateTime when = date.toInstant().atZone(zone);
        if (when.getYear() >= OPEN_ENDED_YEAR) return null;
        return WHEN.format(when).replace("AM", "am").replace("PM", "pm");
    }

    /** The institute's theme as "#RRGGBB"; neutral grey when blank or not recognised. */
    static String resolveColor(String themeCode) {
        if (!StringUtils.hasText(themeCode)) return NEUTRAL;
        String c = themeCode.trim();
        String preset = PRESETS.get(c.toLowerCase(Locale.ROOT));
        if (preset != null) return preset;
        String hex = c.startsWith("#") ? c.substring(1) : c;
        if (!hex.matches("[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8}")) return NEUTRAL;
        if (hex.length() == 3) {
            hex = "" + hex.charAt(0) + hex.charAt(0) + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2);
        }
        return "#" + hex.substring(0, 6).toUpperCase(Locale.ROOT);
    }

    /** True when white text on this colour would be hard to read (amber, lime, cyan…). */
    static boolean isLight(String hex) {
        int r = Integer.parseInt(hex.substring(1, 3), 16);
        int g = Integer.parseInt(hex.substring(3, 5), 16);
        int b = Integer.parseInt(hex.substring(5, 7), 16);
        double luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return luminance > 0.62;
    }

    private static String esc(String value) {
        return value == null ? "" : HtmlUtils.htmlEscape(value);
    }
}
