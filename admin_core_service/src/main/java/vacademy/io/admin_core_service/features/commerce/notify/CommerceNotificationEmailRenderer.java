package vacademy.io.admin_core_service.features.commerce.notify;

import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;

/**
 * The HTML of a buyer's email, made here and never by notification_service's variable
 * substitution (which does not escape). One table layout, inline styles, no images and no
 * tracking pixel of our own; the shop name as heading; the text in paragraphs; the order link
 * as a button; the items table where the trigger has one; a footer. No unsubscribe line: these
 * messages are transactional.
 */
@Component
public class CommerceNotificationEmailRenderer {

    static final int MAX_ITEMS = 20;
    private static final List<String> LINK_LABELS = List.of("see your order", "details", "see your bill",
            "अपना ऑर्डर देखें", "विवरण", "बिल देखें");

    /** One item row (raw values; the renderer cleans and escapes them). */
    public record Item(String name, String variant, String quantity, String lineTotal) {
    }

    /** What an email shows. Raw values; {@code link} null when there is no link base. */
    public record Input(String locale, String shopName, String subjectTemplate, String bodyTemplate,
                        Map<String, String> values, String link, String emailLine, List<Item> items, String total) {
    }

    /** The subject (plain text, one line) and the HTML body (no placeholder left). */
    public record Email(String subject, String html) {
    }

    public Email render(Input in) {
        boolean en = CommerceNotificationTexts.EN.equals(in.locale());
        Map<String, String> plain = new LinkedHashMap<>();
        Map<String, String> html = new LinkedHashMap<>();
        if (in.values() != null) {
            in.values().forEach((k, v) -> {
                plain.put(k, v);
                html.put(k, CommerceNotificationValues.escapeHtml(v));
            });
        }
        String subject = CommerceNotificationValues.subjectLine(CommerceNotificationTexts.fill(in.subjectTemplate(),
                plain));
        String shop = CommerceNotificationValues.escapeHtml(in.shopName() == null ? "" : in.shopName());

        StringBuilder body = new StringBuilder();
        for (String chunk : paragraphs(in.bodyTemplate())) {
            Matcher link = CommerceNotificationTexts.PLACEHOLDER.matcher(chunk);
            int at = -1;
            int end = -1;
            while (link.find()) {
                if ("order_link".equals(link.group(1))) {
                    at = link.start();
                    end = link.end();
                    break;
                }
            }
            if (at < 0) {
                paragraph(body, chunk, html);
                continue;
            }
            int sentence = sentenceStart(chunk, at);
            paragraph(body, chunk.substring(0, sentence), html);
            String leadIn = chunk.substring(sentence, at).trim();
            if (in.link() != null) {
                String lead = leadIn.endsWith(":") ? leadIn.substring(0, leadIn.length() - 1).trim() : leadIn;
                if (!lead.isEmpty() && !LINK_LABELS.contains(lead.toLowerCase(java.util.Locale.ROOT))) {
                    paragraph(body, lead, html);
                }
                button(body, in.link(), en ? "See your order" : "अपना ऑर्डर देखें");
            }
            paragraph(body, chunk.substring(end), html);
        }
        if (in.emailLine() != null) {
            paragraph(body, in.emailLine(), html);
        }
        if (in.items() != null && !in.items().isEmpty()) {
            items(body, in.items(), in.total(), en);
        }
        String footer = en ? "You get this email because you placed an order at " + shop + "."
                : "यह ईमेल आपको इसलिए मिला है क्योंकि आपने " + shop + " पर ऑर्डर दिया था।";

        String out = "<!DOCTYPE html><html lang=\"" + (en ? "en" : "hi") + "\"><head><meta charset=\"utf-8\">"
                + "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>"
                + CommerceNotificationValues.escapeHtml(subject) + "</title></head>"
                + "<body style=\"margin:0;padding:0;background:#f4f4f5;\">"
                + "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" "
                + "style=\"background:#f4f4f5;\"><tr><td align=\"center\" style=\"padding:24px 12px;\">"
                + "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" "
                + "style=\"max-width:560px;background:#ffffff;border-radius:8px;font-family:Arial,Helvetica,sans-serif;"
                + "color:#1f2937;font-size:15px;line-height:1.6;\">"
                + "<tr><td style=\"padding:24px 24px 8px 24px;font-size:20px;font-weight:bold;\">" + shop + "</td></tr>"
                + "<tr><td style=\"padding:8px 24px 16px 24px;\">" + body + "</td></tr>"
                + "<tr><td style=\"padding:16px 24px 24px 24px;font-size:12px;color:#6b7280;"
                + "border-top:1px solid #e5e7eb;\">" + footer + "</td></tr>"
                + "</table></td></tr></table></body></html>";
        // Nothing of the {{...}} form may reach notification_service.
        return new Email(subject, out.replace("{{", "").replace("}}", ""));
    }

    /** The body split at line breaks; blank parts dropped. */
    static List<String> paragraphs(String template) {
        List<String> out = new ArrayList<>();
        if (template == null) {
            return out;
        }
        for (String part : template.split("\\r?\\n")) {
            if (!part.isBlank()) {
                out.add(part.trim());
            }
        }
        return out;
    }

    /** Where the sentence holding {@code index} starts: after the last ". ", "। ", "! " or "? " before it. */
    static int sentenceStart(String text, int index) {
        int best = 0;
        for (String stop : new String[] {". ", "। ", "! ", "? "}) {
            int at = text.lastIndexOf(stop, index - 1);
            if (at >= 0 && at + stop.length() <= index) {
                best = Math.max(best, at + stop.length());
            }
        }
        return best;
    }

    private static void paragraph(StringBuilder out, String template, Map<String, String> htmlValues) {
        if (template == null || template.isBlank()) {
            return;
        }
        String escaped = CommerceNotificationValues.escapeHtml(template.trim());
        out.append("<p style=\"margin:0 0 14px 0;\">").append(CommerceNotificationTexts.fill(escaped, htmlValues))
                .append("</p>");
    }

    private static void button(StringBuilder out, String link, String label) {
        out.append("<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin:4px 0 18px 0;\">")
                .append("<tr><td style=\"background:#111827;border-radius:6px;\">")
                // ses:no-track: the mail service leaves this link as it is (no click-tracking redirect), so
                // the order link reaches the buyer's browser directly and is never rewritten.
                .append("<a ses:no-track href=\"").append(CommerceNotificationValues.escapeHtml(link))
                .append("\" target=\"_blank\" rel=\"noopener noreferrer\" style=\"display:inline-block;padding:10px 20px;"
                        + "color:#ffffff;text-decoration:none;font-weight:bold;\">")
                .append(CommerceNotificationValues.escapeHtml(label)).append("</a></td></tr></table>");
    }

    private static void items(StringBuilder out, List<Item> items, String total, boolean en) {
        out.append("<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" "
                + "style=\"border-collapse:collapse;margin:8px 0 14px 0;font-size:14px;\">");
        out.append("<tr>");
        for (String head : en ? new String[] {"Item", "Variant", "Qty", "Amount"}
                : new String[] {"सामान", "प्रकार", "मात्रा", "राशि"}) {
            out.append("<th align=\"left\" style=\"padding:6px 4px;border-bottom:1px solid #e5e7eb;\">").append(head)
                    .append("</th>");
        }
        out.append("</tr>");
        int shown = Math.min(items.size(), MAX_ITEMS);
        for (int i = 0; i < shown; i++) {
            Item item = items.get(i);
            out.append("<tr>")
                    .append(cell(CommerceNotificationValues.cleanHtml(item.name(), 120, "-")))
                    .append(cell(CommerceNotificationValues.cleanHtml(item.variant(), 60, "")))
                    .append(cell(CommerceNotificationValues.cleanHtml(item.quantity(), 12, "")))
                    .append(cell(CommerceNotificationValues.cleanHtml(item.lineTotal(), 32, "")))
                    .append("</tr>");
        }
        if (items.size() > MAX_ITEMS) {
            out.append("<tr><td colspan=\"4\" style=\"padding:6px 4px;\">+")
                    .append(items.size() - MAX_ITEMS).append(en ? " more" : " और").append("</td></tr>");
        }
        if (total != null) {
            out.append("<tr><td colspan=\"3\" style=\"padding:6px 4px;font-weight:bold;\">")
                    .append(en ? "Total" : "कुल").append("</td>")
                    .append("<td style=\"padding:6px 4px;font-weight:bold;\">")
                    .append(CommerceNotificationValues.cleanHtml(total, 32, "")).append("</td></tr>");
        }
        out.append("</table>");
    }

    private static String cell(String value) {
        return "<td style=\"padding:6px 4px;border-bottom:1px solid #f3f4f6;\">" + value + "</td>";
    }
}
