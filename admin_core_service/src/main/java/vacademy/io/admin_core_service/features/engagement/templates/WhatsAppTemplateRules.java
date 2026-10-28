package vacademy.io.admin_core_service.features.engagement.templates;

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
