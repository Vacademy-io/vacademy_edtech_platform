package vacademy.io.admin_core_service.features.engagement.planning;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.Locale;

/**
 * The three weekly-planning emails, as plain branded HTML. Every value is escaped:
 * batch, subject and teacher names are typed by admins and must never become markup.
 */
public final class EngagementPlanningEmails {

    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("d MMM", Locale.ENGLISH);

    private EngagementPlanningEmails() {}

    public record Mail(String subject, String html) {}

    /** "What are you teaching next week?" — the first email, or its reminder. */
    public static Mail ask(String institute, String teacherName, String batch, String subjects,
                           LocalDate weekStart, String link, LocalDate expires, boolean reminder) {
        String week = DAY.format(weekStart);
        String subject = (reminder ? "Reminder: " : "") + "What are you teaching " + oneLine(batch)
                + " in the week of " + week + "?";
        String forWhat = subjects == null || subjects.isBlank() ? "" : " (" + esc(subjects) + ")";
        String body = "<p>Hi " + esc(firstName(teacherName)) + ",</p>"
                + "<p>Tell us in a line or two what you will cover in <strong>" + esc(batch) + "</strong>"
                + forWhat + " in the week of <strong>" + esc(week) + "</strong>.</p>"
                + "<p>We will turn it into short daily tasks for your students: a question of the day,"
                + " a quick reading and flashcards. You review them before students see anything.</p>"
                + button(link, "Tell us your topics")
                + "<p style=\"color:#64748b;font-size:13px\">This link only sends your topics for this batch"
                + " and week. It does not sign you in. It works until " + esc(DAY.format(expires)) + ".</p>";
        return new Mail(subject, layout(institute, body,
                "You get this because you teach this batch. An admin can turn these emails off in"
                        + " Settings, Daily Engagement."));
    }

    /** The AI draft is saved (or published, with auto-publish on). */
    public static Mail ready(String institute, String teacherName, String batch, LocalDate weekStart,
                             int days, int tasks, boolean published, String link) {
        String week = DAY.format(weekStart);
        String subject = published
                ? "Your tasks for " + oneLine(batch) + " are live"
                : "Your tasks for " + oneLine(batch) + " are ready to review";
        String body = "<p>Hi " + esc(firstName(teacherName)) + ",</p>"
                + "<p>We drafted <strong>" + tasks + " task" + (tasks == 1 ? "" : "s") + " over " + days
                + " day" + (days == 1 ? "" : "s") + "</strong> for <strong>" + esc(batch)
                + "</strong>, week of " + esc(week) + ".</p>"
                + (published
                    ? "<p>Your institute publishes these automatically, so students will see them on their"
                        + " days. You can still edit or remove any task.</p>"
                    : "<p>They are saved as a draft. Students see nothing until you publish.</p>")
                + button(link, published ? "See the tasks" : "Review and publish");
        return new Mail(subject, layout(institute, body, null));
    }

    private static String button(String href, String label) {
        return "<p style=\"margin:24px 0\"><a href=\"" + esc(href) + "\" style=\"background:#ED7424;"
                + "color:#ffffff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600;"
                + "display:inline-block\">" + esc(label) + "</a></p>";
    }

    private static String layout(String institute, String body, String footer) {
        return "<div style=\"font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;"
                + "color:#0f172a;max-width:560px;margin:0 auto;padding:24px\">"
                + "<p style=\"font-size:13px;color:#64748b;margin:0 0 16px\">" + esc(institute) + "</p>"
                + body
                + (footer == null ? "" : "<hr style=\"border:none;border-top:1px solid #e2e8f0;margin:24px 0\">"
                    + "<p style=\"font-size:12px;color:#94a3b8\">" + esc(footer) + "</p>")
                + "</div>";
    }

    static String firstName(String full) {
        if (full == null || full.isBlank()) return "there";
        return full.strip().split("\\s+")[0];
    }

    private static String oneLine(String s) {
        return s == null ? "" : s.replaceAll("[\\r\\n]+", " ").strip();
    }

    static String esc(String s) {
        if (s == null) return "";
        StringBuilder b = new StringBuilder(s.length() + 16);
        for (char c : s.toCharArray()) {
            switch (c) {
                case '<' -> b.append("&lt;");
                case '>' -> b.append("&gt;");
                case '&' -> b.append("&amp;");
                case '"' -> b.append("&quot;");
                case '\'' -> b.append("&#39;");
                default -> b.append(c);
            }
        }
        return b.toString();
    }
}
