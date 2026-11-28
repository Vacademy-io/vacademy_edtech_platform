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

    /** Links written into a template text (placeholders and email addresses ignored), trailing punctuation removed. */
    public static List<String> linksIn(String text, Pattern placeholder) {
        List<String> out = new ArrayList<>();
        String withoutPh = placeholder.matcher(text == null ? "" : text).replaceAll(" ")
                // an email address ("office@school.in") is not a link
                .replaceAll("(?i)(?:mailto:)?[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}", " ");
        Matcher m = URL.matcher(withoutPh);
        while (m.find()) {
            String u = m.group().replaceAll("[.,;:!?*_~]+$", "");
            if (u.toLowerCase(Locale.ROOT).startsWith("mailto")) continue;
            if (!out.contains(u)) out.add(u);
        }
        return out;
    }

    /** True when the link appears in the brief ("example.com/join" matches "https://example.com/join"). */
    public static boolean linkInBrief(String url, String brief) {
        if (brief == null || url == null) return false;
        String b = brief.toLowerCase(Locale.ROOT);
        String u = url.toLowerCase(Locale.ROOT);
        if (b.contains(u)) return true;
        String bare = u.replaceFirst("^https?://", "").replaceFirst("^www\\.", "");
        return !bare.isBlank() && b.contains(bare);
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

    /** Variables that mean the person's full name, and their first name (normalised: lower case, letters/digits only). */
    private static final java.util.Set<String> NAME_VARS = java.util.Set.of(
            "name", "fullname", "leadname", "studentname", "parentname", "contactname", "customername");
    private static final java.util.Set<String> FIRST_NAME_VARS = java.util.Set.of("firstname", "fname");

    /**
     * Variables and lead fields that mean the lead's own organisation. Only used for a researched
     * organisation (the Lead Agent's leads): for a student lead, "institute_name" in a template is the
     * sender, and a form field like "Institute" is the student's old school.
     */
    private static final java.util.Set<String> ORG_KEYS = java.util.Set.of(
            "institutename", "institute", "institutionname", "institution", "organisationname", "organizationname",
            "organisation", "organization", "orgname", "laorgname", "companyname", "company");

    /** A name field holding a placeholder rather than a name. */
    private static final java.util.Set<String> NOT_A_NAME = java.util.Set.of(
            "unknown", "na", "none", "null", "nil", "test", "lead", "user", "customer", "student", "noname");

    private static final int MAX_FILLED_CHARS = 100;

    /**
     * A value for a variable the brain left out, taken only from the person's own data; null when
     * there is none (the caller must then not send, never send a blank or a made-up value). In order:
     * the template's declared source (unless that is "ai"); for an institute/organisation variable,
     * a researched organisation's own organisation field (nothing else); a lead field with the
     * variable's exact name ("city" fills from a "City" answer); the person's name for name variables.
     */
    public static String fromLeadData(String var, Map<String, String> sources, Map<String, JsonNode> payloads,
                                      List<String> briefLinks) {
        if (var == null) return null;
        JsonNode profile = payloads == null ? null : payloads.get("profile");
        String src = sources == null ? null : sources.get(var);
        if (src != null && !src.isBlank() && !src.trim().equals("ai")) {
            String v = clean(valueFor(var, src.trim(), profile, briefLinks, null), isLinkVariable(var));
            if (v != null) return v;
        }
        if (isLinkVariable(var) || profile == null) return null;
        String key = normalise(var);
        boolean prospect = "ORGANISATION_PROSPECT".equals(text(profile, "subjectType"));
        if (ORG_KEYS.contains(key)) {
            return prospect ? clean(fieldNamed(profile, ORG_KEYS), false) : null;
        }
        String exact = clean(fieldNamed(profile, java.util.Set.of(key)), false);
        if (exact != null) return exact;
        if (NAME_VARS.contains(key) || FIRST_NAME_VARS.contains(key)) {
            String name = clean(text(profile, "name"), false);
            if (name == null || name.contains("@") || NOT_A_NAME.contains(normalise(name))) return null;
            return FIRST_NAME_VARS.contains(key) ? name.split(" ")[0] : name;
        }
        return null;
    }

    /** The first form answer or research note whose normalised field name is one of these. */
    private static String fieldNamed(JsonNode profile, java.util.Set<String> keys) {
        for (String group : List.of("formAnswers", "researchNotes")) {
            JsonNode fields = profile.get(group);
            if (fields == null || !fields.isObject()) continue;
            var it = fields.fields();
            while (it.hasNext()) {
                var e = it.next();
                if (keys.contains(normalise(e.getKey())) && !e.getValue().isNull()) return e.getValue().asText();
            }
        }
        return null;
    }

    private static String normalise(String s) {
        return s == null ? "" : s.toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N}]", "");
    }

    /** One line, trimmed, with a letter in it, short, and no link unless the variable is one. */
    private static String clean(String v, boolean linkAllowed) {
        if (v == null) return null;
        String one = v.replaceAll("\\s+", " ").trim();
        if (one.isEmpty() || one.length() > MAX_FILLED_CHARS || !one.matches(".*\\p{L}.*")) return null;
        if (!linkAllowed && URL.matcher(one).find()) return null;
        return one;
    }

    private static String text(JsonNode node, String field) {
        if (node == null || field == null) return null;
        JsonNode v = node.get(field);
        return v == null || v.isNull() ? null : v.asText();
    }
}
