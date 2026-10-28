package vacademy.io.admin_core_service.features.engagement.templates;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Where each template variable gets its value (edge cases W14, E2, E7). A template stores
 * {variable: source}; at send time the value comes from the person's data, the engine brief, a
 * fixed text, or (for free-text lines only) the brain. A model-written value can never become a
 * link: link variables must come from a link in the brief.
 *
 * Sources:
 *   profile.name        the person's full name
 *   profile.firstName   the first word of the name
 *   form.<field>        a lead form answer
 *   research.<field>    a Lead Agent research note
 *   brief.link.<n>      the n-th link in the engine brief (1-based)
 *   static:<text>       a fixed value
 *   ai                  written by the brain (no links, at most 300 chars)
 */
public final class TemplateVariableSources {

    private TemplateVariableSources() {}

    static final int MAX_AI_VALUE_CHARS = 300;

    private static final Pattern SOURCE = Pattern.compile(
            "^(profile\\.name|profile\\.firstName|ai|form\\.[\\p{L}\\p{N}_ .-]{1,80}|research\\.[\\p{L}\\p{N}_ .-]{1,80}"
            + "|brief\\.link\\.[1-9][0-9]?|static:.{1,200})$");

    /** Schemed URLs, www. hosts and bare domain/path tokens, same reach as the reply guard. */
    static final Pattern URL = Pattern.compile(
            "(?i)(?:https?://|www\\.)[^\\s<>\"')]+|\\b[a-z0-9-]{2,}(?:\\.[a-z0-9-]{2,})*\\.(?:com|in|io|org|net|co|edu|app|me|ly|link|info)(?:/[^\\s<>\"')]*)?");

    /** Variable names that look like they carry a link. */
    static boolean isLinkVariable(String name) {
        String n = name == null ? "" : name.toLowerCase(Locale.ROOT);
        return n.contains("link") || n.contains("url") || n.contains("website");
    }

    /** Links in the brief, in order of appearance, trailing punctuation removed. */
    public static List<String> briefLinks(String brief) {
        List<String> out = new ArrayList<>();
        if (brief == null) return out;
        Matcher m = Pattern.compile("(?i)https?://[^\\s<>\"')]+").matcher(brief);
        while (m.find()) {
            String u = m.group().replaceAll("[.,;:!?*_~]+$", "");
            if (!out.contains(u)) out.add(u);
        }
        return out;
    }

    /** Problems with a template's source map; empty = valid. Every declared variable needs a source. */
    public static List<String> problems(List<String> variableNames, Map<String, String> sources, List<String> briefLinks) {
        List<String> out = new ArrayList<>();
        for (String v : variableNames == null ? List.<String>of() : variableNames) {
            String src = sources == null ? null : sources.get(v);
            if (src == null || src.isBlank()) {
                out.add("variable '" + v + "' has no source");
                continue;
            }
            if (!SOURCE.matcher(src.trim()).matches()) {
                out.add("variable '" + v + "' has an unknown source '" + src + "'");
                continue;
            }
            String s = src.trim();
            if (isLinkVariable(v) && !s.startsWith("brief.link.")) {
                out.add("variable '" + v + "' is a link, so it must come from a link in the brief (brief.link.N)");
            }
            if (s.startsWith("brief.link.")) {
                int n = Integer.parseInt(s.substring("brief.link.".length()));
                if (briefLinks == null || n > briefLinks.size()) {
                    out.add("variable '" + v + "' points to brief link " + n + " but the brief has "
                            + (briefLinks == null ? 0 : briefLinks.size()) + " link(s)");
                }
            }
            if (s.startsWith("static:") && URL.matcher(s.substring(7)).find()) {
                out.add("variable '" + v + "' has a fixed value with a link; use brief.link.N instead");
            }
        }
        return out;
    }

    /** The resolved values and the variables that could not be filled for this person. */
    public record Resolved(Map<String, String> values, List<String> missing) {}

    /**
     * Fill a template's variables for one person.
     *
     * @param payloads   data-point payloads for the person (key "profile" etc.), may be partial
     * @param aiValues   values the brain proposed; used ONLY for variables whose source is "ai"
     */
    public static Resolved resolve(List<String> variableNames, Map<String, String> sources,
                                   Map<String, JsonNode> payloads, List<String> briefLinks,
                                   Map<String, String> aiValues) {
        Map<String, String> values = new LinkedHashMap<>();
        List<String> missing = new ArrayList<>();
        JsonNode profile = payloads == null ? null : payloads.get("profile");
        for (String v : variableNames == null ? List.<String>of() : variableNames) {
            String src = sources == null ? null : sources.get(v);
            String val = src == null ? null : valueFor(v, src.trim(), profile, briefLinks, aiValues);
            if (val == null || val.isBlank()) {
                missing.add(v);
            } else {
                values.put(v, val.trim());
            }
        }
        return new Resolved(values, missing);
    }

    private static String valueFor(String var, String src, JsonNode profile, List<String> briefLinks,
                                   Map<String, String> aiValues) {
        if (src.equals("profile.name")) return text(profile, "name");
        if (src.equals("profile.firstName")) {
            String name = text(profile, "name");
            return name == null ? null : name.trim().split("\\s+")[0];
        }
        if (src.startsWith("form.")) return profile == null ? null : text(profile.get("formAnswers"), src.substring(5));
        if (src.startsWith("research.")) return profile == null ? null : text(profile.get("researchNotes"), src.substring(9));
        if (src.startsWith("brief.link.")) {
            int n = Integer.parseInt(src.substring("brief.link.".length()));
            return briefLinks != null && n >= 1 && n <= briefLinks.size() ? briefLinks.get(n - 1) : null;
        }
        if (src.startsWith("static:")) return src.substring(7);
        if (src.equals("ai")) {
            String raw = aiValues == null ? null : aiValues.get(var);
            if (raw == null) return null;
            String one = raw.replaceAll("[\\r\\n]+", " ").trim();
            // A brain-written value is text only: a link or an over-long value is treated as missing.
            if (isLinkVariable(var) || URL.matcher(one).find() || one.length() > MAX_AI_VALUE_CHARS) return null;
            return one;
        }
        return null;
    }

    private static String text(JsonNode node, String field) {
        if (node == null || field == null) return null;
        JsonNode v = node.get(field);
        return v == null || v.isNull() ? null : v.asText();
    }
}
