package vacademy.io.admin_core_service.features.engagement.templates;

import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Meta's body rules that the {{n}} alignment check does not cover (edge cases W3, W4). Checked
 * before saving, approving and submitting, so a template is not sent to Meta only to be rejected.
 */
public final class WhatsAppTemplateRules {

    private WhatsAppTemplateRules() {}

    public static final int MAX_BODY_CHARS = 1024;
    public static final int MAX_FOOTER_CHARS = 60;

    private static final Pattern PH = Pattern.compile("\\{\\{\\d+}}");
    private static final Pattern ADJACENT = Pattern.compile("\\{\\{\\d+}}[\\s\\p{Punct}&&[^{]]*\\{\\{\\d+}}");

    /**
     * W2 — every link written into the body must be in the engine brief (a link can still be a
     * variable whose source is brief.link.N). Null when fine.
     */
    public static String linkProblem(String body, String brief) {
        for (String url : TemplateVariableSources.linksIn(body, PH)) {
            if (!TemplateVariableSources.linkInBrief(url, brief)) {
                return "the link " + url + " is not in the engine brief";
            }
        }
        return null;
    }

    /** Words that make a message promotional (MARKETING), not a transaction update (UTILITY). en + Hinglish. */
    private static final Pattern PROMO = Pattern.compile(
            "(?i)(?:^|[^\\p{L}])(offer|offers|discount|discounts|sale|% off|off on|free|cashback|coupon|promo|deal|deals|"
            + "limited (?:time|seats)|hurry|last chance|enrol(?:l)? now|join now|register now|admission(?:s)? open|"
            + "new batch|special price|scholarship|book now|don'?t miss|chhoot|chhut|muft)(?:$|[^\\p{L}])");

    public static final Set<String> HEADER_TYPES = Set.of("NONE", "TEXT", "IMAGE", "VIDEO", "DOCUMENT");
    public static final int MAX_HEADER_TEXT = 60;
    public static final int MAX_BUTTON_TEXT = 25;

    /**
     * W6 — a UTILITY template that reads as promotion. Meta re-categorises or rejects those, and
     * mislabelling hurts the number's quality rating. Null when fine (or not UTILITY).
     */
    public static String categoryWarning(String body, String category) {
        if (body == null || category == null || !"UTILITY".equalsIgnoreCase(category)) return null;
        Matcher m = PROMO.matcher(body);
        if (!m.find()) return null;
        return "This reads as promotion (\"" + m.group(1).trim() + "\"), which Meta treats as MARKETING. "
                + "Labelled UTILITY it may be re-categorised or rejected; choose MARKETING if it promotes.";
    }

    /** W13 — header rules. Null when fine. */
    public static String headerProblem(String type, String text, String mediaUrl, String brief) {
        String t = type == null ? "NONE" : type.toUpperCase();
        if (!HEADER_TYPES.contains(t)) return "header type must be NONE, TEXT, IMAGE, VIDEO or DOCUMENT";
        switch (t) {
            case "TEXT" -> {
                if (text == null || text.isBlank()) return "a TEXT header needs its text";
                if (text.length() > MAX_HEADER_TEXT) return "header text exceeds Meta's " + MAX_HEADER_TEXT + "-char limit";
                if (PH.matcher(text).find()) return "the header can't contain variables";
                if (linkProblem(text, brief) != null) return "the header has a link that is not in the engine brief";
            }
            case "IMAGE", "VIDEO", "DOCUMENT" -> {
                if (mediaUrl == null || mediaUrl.isBlank()) return "a " + t.toLowerCase() + " header needs a sample file";
                String u = mediaUrl.trim().toLowerCase();
                if (!u.startsWith("https://")) return "the header file must be an https link";
                String path = u.replaceAll("[?#].*$", "");
                boolean ok = switch (t) {
                    case "IMAGE" -> path.endsWith(".jpg") || path.endsWith(".jpeg") || path.endsWith(".png");
                    case "VIDEO" -> path.endsWith(".mp4") || path.endsWith(".3gp");
                    default -> path.endsWith(".pdf");
                };
                if (!ok) return "the header file must be " + switch (t) {
                    case "IMAGE" -> "a .jpg or .png image";
                    case "VIDEO" -> "an .mp4 video";
                    default -> "a .pdf document";
                };
            }
            default -> { }
        }
        return null;
    }

    /** One button as stored: type QUICK_REPLY | URL | PHONE_NUMBER. */
    public record Button(String type, String text, String url, String phoneNumber) {}

    /**
     * W13/W14 — Meta's button rules: at most 10 buttons, at most 2 URL and 1 phone, text up to 25
     * chars; a URL button must point to a link in the brief (never a model-written URL).
     */
    public static String buttonsProblem(List<Button> buttons, String brief) {
        if (buttons == null || buttons.isEmpty()) return null;
        if (buttons.size() > 10) return "at most 10 buttons";
        int urls = 0, phones = 0;
        for (Button b : buttons) {
            String type = b.type() == null ? "" : b.type().toUpperCase();
            if (b.text() == null || b.text().isBlank()) return "every button needs its text";
            if (b.text().length() > MAX_BUTTON_TEXT) return "button text exceeds Meta's " + MAX_BUTTON_TEXT + "-char limit";
            switch (type) {
                case "QUICK_REPLY" -> { }
                case "URL" -> {
                    urls++;
                    if (b.url() == null || !b.url().trim().toLowerCase().startsWith("https://")) return "a URL button needs an https link";
                    if (!TemplateVariableSources.linkInBrief(b.url().trim(), brief)) {
                        return "the button link " + b.url().trim() + " is not in the engine brief";
                    }
                }
                case "PHONE_NUMBER" -> {
                    phones++;
                    if (b.phoneNumber() == null || !b.phoneNumber().trim().matches("^\\+?[0-9]{8,15}$")) {
                        return "a call button needs a phone number with country code";
                    }
                }
                default -> { return "button type must be QUICK_REPLY, URL or PHONE_NUMBER"; }
            }
        }
        if (urls > 2) return "at most 2 link buttons";
        if (phones > 1) return "at most 1 call button";
        return null;
    }

    /** A human-readable problem, or null when the body follows Meta's rules. */
    public static String problem(String body, String footer) {
        if (body == null || body.isBlank()) return "empty body";
        String b = body.trim();
        if (b.length() > MAX_BODY_CHARS) return "body exceeds Meta's " + MAX_BODY_CHARS + "-char limit";
        if (footer != null && footer.length() > MAX_FOOTER_CHARS) {
            return "footer exceeds Meta's " + MAX_FOOTER_CHARS + "-char limit";
        }
        if (footer != null && PH.matcher(footer).find()) return "the footer can't contain variables";
        if (b.startsWith("{{") && PH.matcher(b).lookingAt()) return "the body can't start with a variable";
        if (b.matches("(?s).*\\{\\{\\d+}}\\s*$")) return "the body can't end with a variable; add text after it";
        if (ADJACENT.matcher(b).find()) return "two variables are next to each other; put words between them";
        if (b.contains("\n\n\n")) return "the body has more than two line breaks in a row";
        int vars = 0;
        Matcher m = PH.matcher(b);
        while (m.find()) vars++;
        if (vars > 0) {
            String text = PH.matcher(b).replaceAll(" ").trim();
            int words = text.isEmpty() ? 0 : text.split("\\s+").length;
            if (words < 2 * vars + 1) {
                return "too many variables for the length of the message (" + vars + " variable(s), "
                        + words + " word(s)); Meta rejects these";
            }
        }
        return null;
    }
}
