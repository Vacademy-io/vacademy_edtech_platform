package vacademy.io.admin_core_service.features.classroom.notify;

import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Renders the daily classroom panel digest email.
 *
 * Table layout with inline styles, like the scheduled report email, because that
 * is what survives the common mail clients. Every value that came from data is
 * escaped. Only the incidents that are NEW since the last digest are listed;
 * the console's Alerts tab is the place for the standing picture.
 */
@Component
public class ClassroomDigestRenderer {

    private static final String INK = "#14181f";
    private static final String MUTED = "#5e6b7a";
    private static final String RULE = "#dfe3e9";
    private static final String PANEL = "#f6f8fb";
    private static final String WARN = "#b4690e";
    private static final String BAD = "#d0342c";
    private static final String ACCENT = "#2f6df6";
    private static final String SANS =
            "-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif";

    private static final DateTimeFormatter WHEN = DateTimeFormatter.ofPattern("d MMM, HH:mm", Locale.ENGLISH);

    /** One alert as it appears in the digest. */
    public record Item(String kind, String severity, String roomName, String since) {
    }

    /** Short label per alert kind. */
    static final Map<String, String> LABELS = new LinkedHashMap<>();
    /** What an admin should do about it, one line. */
    static final Map<String, String> ACTIONS = new LinkedHashMap<>();

    static {
        LABELS.put("OFFLINE", "Panel offline");
        ACTIONS.put("OFFLINE", "Check the panel is switched on and connected to Wi-Fi.");
        LABELS.put("AWAITING_APPROVAL", "New panel awaiting approval");
        ACTIONS.put("AWAITING_APPROVAL", "Approve or reject it in Settings, Classroom panels.");
        LABELS.put("UPDATE_REQUIRED", "App update required");
        ACTIONS.put("UPDATE_REQUIRED", "Open the panel and install the update.");
        LABELS.put("LICENCE_ROOM", "Room without a licence");
        ACTIONS.put("LICENCE_ROOM", "Review the room's licence in Settings, Classroom panels.");
        LABELS.put("LICENCE_ENDING", "Licence ending soon");
        ACTIONS.put("LICENCE_ENDING", "Review your panel licences in Settings, Classroom panels.");
    }

    public String subject(String instituteName, int count) {
        return count + " new classroom panel alert" + (count == 1 ? "" : "s")
                + (instituteName == null || instituteName.isBlank() ? "" : " for " + instituteName.trim());
    }

    /**
     * items holds at most the listed alerts; total is how many new alerts this digest covers, which
     * can be more than are listed.
     */
    public String render(String instituteName, List<Item> items, int total, ZoneId zone, String consoleLink) {
        int count = Math.max(total, items.size());
        StringBuilder b = new StringBuilder(4096);
        b.append("<div style=\"margin:0;padding:0;background:").append(PANEL)
                .append(";font-family:").append(SANS).append(";\">");
        b.append("<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"")
                .append("border-collapse:collapse;background:").append(PANEL).append(";\"><tr><td align=\"center\">");
        b.append("<table role=\"presentation\" width=\"640\" cellpadding=\"0\" cellspacing=\"0\" style=\"")
                .append("border-collapse:collapse;width:100%;max-width:640px;background:#ffffff;\">");

        b.append("<tr><td style=\"padding:24px 28px 8px;\">");
        b.append("<div style=\"font-size:12px;color:").append(MUTED).append(";\">")
                .append(esc(instituteName == null || instituteName.isBlank() ? "Your institute" : instituteName))
                .append("</div>");
        b.append("<div style=\"font-size:20px;font-weight:700;color:").append(INK).append(";margin-top:6px;\">")
                .append(count).append(" new classroom panel alert").append(count == 1 ? "" : "s")
                .append("</div>");
        b.append("</td></tr>");

        b.append("<tr><td style=\"padding:8px 28px 8px;\">");
        b.append("<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" ")
                .append("style=\"border-collapse:collapse;font-size:14px;color:").append(INK).append(";\">");
        for (Item it : items) {
            String colour = "bad".equalsIgnoreCase(it.severity()) ? BAD : WARN;
            b.append("<tr><td style=\"padding:12px 0;border-top:1px solid ").append(RULE).append(";\">");
            b.append("<div style=\"font-weight:600;color:").append(colour).append(";\">")
                    .append(esc(LABELS.getOrDefault(it.kind(), "Panel alert"))).append("</div>");
            b.append("<div style=\"margin-top:2px;\">")
                    .append(esc(it.roomName() == null || it.roomName().isBlank() ? "Institute-wide" : it.roomName()));
            String since = since(it.since(), zone);
            if (since != null) {
                b.append("<span style=\"color:").append(MUTED).append(";\"> &middot; since ")
                        .append(esc(since)).append("</span>");
            }
            b.append("</div>");
            b.append("<div style=\"margin-top:2px;color:").append(MUTED).append(";\">")
                    .append(esc(ACTIONS.getOrDefault(it.kind(), "Open Settings, Classroom panels.")))
                    .append("</div>");
            b.append("</td></tr>");
        }
        if (count > items.size()) {
            b.append("<tr><td style=\"padding:12px 0;border-top:1px solid ").append(RULE).append(";color:")
                    .append(MUTED).append(";\">and ").append(count - items.size())
                    .append(" more. Open the Alerts tab to see them all.</td></tr>");
        }
        b.append("</table></td></tr>");

        if (consoleLink != null && !consoleLink.isBlank()) {
            b.append("<tr><td style=\"padding:8px 28px 8px;\">")
                    .append("<a href=\"").append(esc(consoleLink)).append("\" style=\"display:inline-block;")
                    .append("padding:10px 16px;background:").append(ACCENT)
                    .append(";color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;\">")
                    .append("Open panel alerts</a></td></tr>");
        }

        b.append("<tr><td style=\"padding:16px 28px 24px;font-size:11px;line-height:1.6;color:").append(MUTED)
                .append(";\">You receive this because classroom panel alerts are switched on for this institute. ")
                .append("Each problem is listed once, when it is first seen.</td></tr>");
        b.append("</table></td></tr></table></div>");
        return b.toString();
    }

    static String since(String raw, ZoneId zone) {
        if (raw == null || raw.isBlank()) return null;
        try {
            return WHEN.format(Instant.parse(raw.trim()).atZone(zone));
        } catch (Exception e) {
            try {
                return WHEN.format(LocalDateTime.parse(raw.trim()).toInstant(ZoneOffset.UTC).atZone(zone));
            } catch (Exception e2) {
                return null;
            }
        }
    }

    static String esc(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                .replace("\"", "&quot;").replace("'", "&#39;");
    }
}
