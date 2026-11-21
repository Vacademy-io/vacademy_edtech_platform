package vacademy.io.admin_core_service.features.common.util;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * {@code {{#if key}} ... {{/if}}} blocks for templates that are otherwise filled by literal
 * {@code {{key}}} replacement (invoice PDFs, payment confirmation emails).
 *
 * <p>Those renderers know a key's value only at the moment they substitute it, so the condition
 * is evaluated by letting the renderer fill it: {@link #prepare} rewrites each block so that its
 * own {@code {{key}}} sits between two markers, the caller runs its normal substitution, and
 * {@link #finish} keeps the block body when that slot filled to something non-blank and drops the
 * whole block otherwise. A key the renderer does not know stays as a raw {@code {{key}}} in the
 * slot and counts as empty, so an unsupported condition hides its block rather than printing
 * template syntax.
 *
 * <p>Blocks do not nest; {@code {{else}}} is not supported. Both are left for a real template
 * engine if a template ever needs them.
 */
public final class TemplateConditionals {

    private static final Pattern IF_BLOCK = Pattern.compile(
            "\\{\\{#if\\s+([a-zA-Z0-9_]+)\\s*\\}\\}(.*?)\\{\\{/if\\}\\}", Pattern.DOTALL);

    // HTML comments: harmless if a renderer ever skips finish(), and never touched by the
    // {{key}} replacement in between.
    private static final String OPEN = "<!--TPL_IF-->";
    private static final String SEP = "<!--TPL_THEN-->";
    private static final String CLOSE = "<!--TPL_ENDIF-->";

    private static final Pattern PREPARED_BLOCK = Pattern.compile(
            Pattern.quote(OPEN) + "(.*?)" + Pattern.quote(SEP) + "(.*?)" + Pattern.quote(CLOSE), Pattern.DOTALL);

    private static final Pattern TAGS = Pattern.compile("<[^>]*>");

    private TemplateConditionals() {
    }

    /** Rewrites each {@code {{#if key}}body{{/if}}} so its condition is filled by the caller. */
    public static String prepare(String template) {
        if (template == null || !template.contains("{{#if")) {
            return template;
        }
        Matcher m = IF_BLOCK.matcher(template);
        StringBuilder out = new StringBuilder();
        while (m.find()) {
            String replacement = OPEN + "{{" + m.group(1) + "}}" + SEP + m.group(2) + CLOSE;
            m.appendReplacement(out, Matcher.quoteReplacement(replacement));
        }
        m.appendTail(out);
        return out.toString();
    }

    /** Keeps each prepared block's body when its condition filled to visible text, else drops it. */
    public static String finish(String filled) {
        if (filled == null || !filled.contains(OPEN)) {
            return filled;
        }
        Matcher m = PREPARED_BLOCK.matcher(filled);
        StringBuilder out = new StringBuilder();
        while (m.find()) {
            String keep = isTruthy(m.group(1)) ? m.group(2) : "";
            m.appendReplacement(out, Matcher.quoteReplacement(keep));
        }
        m.appendTail(out);
        return out.toString();
    }

    private static boolean isTruthy(String conditionValue) {
        if (conditionValue == null) {
            return false;
        }
        String text = TAGS.matcher(conditionValue).replaceAll("").replace("&nbsp;", " ").trim();
        // Still a raw token: the renderer had no value for this key.
        return !text.isEmpty() && !(text.startsWith("{{") && text.endsWith("}}"));
    }
}
