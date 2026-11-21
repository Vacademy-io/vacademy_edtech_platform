package vacademy.io.assessment_service.features.notification.service;

import java.util.LinkedHashMap;
import java.util.Map;

import org.springframework.util.StringUtils;

/**
 * HTML for the short operational emails staff get from the AI copy check. One
 * layout for every sender (bulk batch, single/auto check) so they read as the
 * same product: what happened, the numbers, what to do next, one button.
 *
 * Inline styles only (mail clients strip stylesheets); no platform name in the
 * copy — the sender address and the institute's own branding say who it is from.
 */
public final class StaffNoticeEmails {

    private StaffNoticeEmails() {
    }

    /**
     * "AI check finished" for one assessment.
     *
     * @param firstName   greeting name, may be null
     * @param assessment  the test's name
     * @param counts      label → number, in display order; zero rows are dropped
     *                    except the first (the total)
     * @param extraNote   an optional paragraph before the release reminder
     *                    (e.g. copies waiting for a student to be picked)
     * @param link        absolute URL of the submissions / batch page
     */
    public static String aiCheckFinished(String firstName, String assessment, Map<String, Long> counts,
                                         String extraNote, String link) {
        String who = StringUtils.hasText(firstName) ? "Hi " + esc(firstName) + "," : "Hi,";
        StringBuilder rows = new StringBuilder();
        boolean first = true;
        for (Map.Entry<String, Long> e : counts.entrySet()) {
            long v = e.getValue() == null ? 0 : e.getValue();
            if (!first && v == 0) continue;
            first = false;
            rows.append("<tr>")
                .append("<td style=\"padding:8px 12px;border-bottom:1px solid #eee;color:#4b5563\">").append(esc(e.getKey())).append("</td>")
                .append("<td style=\"padding:8px 12px;border-bottom:1px solid #eee;text-align:right;font-weight:600;color:#111827\">").append(v).append("</td>")
                .append("</tr>");
        }
        return "<div style=\"font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2937;font-size:15px;line-height:1.5\">"
                + "<h2 style=\"font-size:20px;margin:0 0 16px;color:#111827\">AI check finished</h2>"
                + "<p style=\"margin:0 0 12px\">" + who + "</p>"
                + "<p style=\"margin:0 0 16px\">The AI has finished checking the answer sheets for <b>" + esc(assessment) + "</b>.</p>"
                + "<table style=\"border-collapse:collapse;width:100%;margin:0 0 16px;border:1px solid #eee;border-radius:8px\">" + rows + "</table>"
                + (StringUtils.hasText(extraNote) ? "<p style=\"margin:0 0 16px\">" + esc(extraNote) + "</p>" : "")
                + "<div style=\"background:#fff7ed;border-left:4px solid #f97316;padding:12px 14px;border-radius:6px;margin:0 0 20px\">"
                + "<b>Learners see nothing yet.</b> Review the marks and the checked copies, then press <b>Release Result</b> to publish them."
                + "</div>"
                + "<p style=\"margin:0 0 24px\"><a href=\"" + esc(link) + "\" style=\"display:inline-block;background:#f97316;color:#ffffff;padding:11px 20px;border-radius:6px;text-decoration:none;font-weight:600\">Open the results</a></p>"
                + "<p style=\"margin:0;color:#6b7280;font-size:12px\">You are receiving this because you started this check or manage this institute's assessments.</p>"
                + "</div>";
    }

    /** Insertion-ordered counts; first entry is the total and always shown. */
    public static Map<String, Long> counts() {
        return new LinkedHashMap<>();
    }

    static String esc(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }
}
