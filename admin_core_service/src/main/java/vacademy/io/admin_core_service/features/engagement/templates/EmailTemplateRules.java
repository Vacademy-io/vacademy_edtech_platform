package vacademy.io.admin_core_service.features.engagement.templates;

import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Entities;
import org.jsoup.safety.Safelist;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Checks, cleans and renders engine email templates. Pure functions, no Spring.
 *
 * Edge cases: E1 subject, E2 unresolved variables, E3 unsafe HTML, E4 cold-outreach unsubscribe,
 * E7 links that are not in the brief.
 */
public final class EmailTemplateRules {

    private EmailTemplateRules() {}

    public enum Level { BLOCK, WARN }

    public record Issue(Level level, String code, String message) {}

    static final Pattern PLACEHOLDER = Pattern.compile("\\{\\{\\s*([A-Za-z][A-Za-z0-9_]{0,39})\\s*}}");
    private static final Pattern ANY_BRACES = Pattern.compile("\\{\\{[^}]*}}");
    private static final Pattern VAR_NAME = Pattern.compile("^[a-z][a-z0-9_]{0,39}$");
    private static final String PH_HOST = "https://ph.invalid/";
    private static final Set<String> SPAM_WORDS = Set.of(
            "free!!!", "100% free", "guaranteed", "act now", "urgent", "winner", "cash prize", "click here",
            "limited time only", "risk-free", "no cost", "earn money", "$$$");
    private static final Pattern UNSUBSCRIBE = Pattern.compile(
            "(?i)unsubscribe|opt[ -]?out|reply\\s+stop|stop receiving|don'?t want (?:these|to hear)");

    public static final int MAX_SUBJECT_CHARS = 150;
    public static final int MAX_BODY_CHARS = 20000;

    /**
     * All problems with a template. BLOCK issues stop saving/approving; WARN issues are shown to the
     * reviewer. bodyHtml should already be sanitised (see sanitise).
     */
    public static List<Issue> check(String subject, String bodyHtml, List<String> variableNames,
                                    List<String> sampleValues, Map<String, String> sources,
                                    String brief, boolean coldOutreach) {
        List<Issue> out = new ArrayList<>();
        String s = subject == null ? "" : subject.trim();
        // E1 — subject
        if (s.isEmpty()) {
            out.add(new Issue(Level.BLOCK, "E1_SUBJECT_EMPTY", "The subject is empty."));
        } else {
            if (s.length() > MAX_SUBJECT_CHARS) {
                out.add(new Issue(Level.BLOCK, "E1_SUBJECT_LONG", "The subject is longer than " + MAX_SUBJECT_CHARS + " characters."));
            }
            int words = s.replaceAll(PLACEHOLDER.pattern(), "x").split("\\s+").length;
            if (words < 2 || words > 12) {
                out.add(new Issue(Level.WARN, "E1_SUBJECT_WORDS", "Subjects of 3 to 9 words get opened most; this one has " + words + "."));
            }
            if (mostlyCapitals(s)) {
                out.add(new Issue(Level.WARN, "E1_SUBJECT_CAPS", "The subject is mostly CAPITAL letters, which spam filters punish."));
            }
            if (s.contains("!!") || s.contains("??")) {
                out.add(new Issue(Level.WARN, "E1_SUBJECT_PUNCT", "Repeated !! or ?? in the subject looks like spam."));
            }
        }
        String body = bodyHtml == null ? "" : bodyHtml;
        if (Jsoup.parse(body).text().isBlank()) {
            out.add(new Issue(Level.BLOCK, "BODY_EMPTY", "The email body is empty."));
        }
        if (body.length() > MAX_BODY_CHARS) {
            out.add(new Issue(Level.BLOCK, "BODY_LONG", "The email body is too long."));
        }
        String lower = (s + " " + Jsoup.parse(body).text()).toLowerCase(Locale.ROOT);
        for (String w : SPAM_WORDS) {
            if (lower.contains(w)) {
                out.add(new Issue(Level.WARN, "SPAM_WORD", "\"" + w + "\" often sends emails to spam."));
            }
        }

        // Variables: names, placeholders used, samples, sources.
        List<String> names = variableNames == null ? List.of() : variableNames;
        for (String n : names) {
            if (n == null || !VAR_NAME.matcher(n).matches()) {
                out.add(new Issue(Level.BLOCK, "VAR_NAME", "Variable name '" + n + "' must be lowercase letters, digits or _ ."));
            }
        }
        if (new LinkedHashSet<>(names).size() != names.size()) {
            out.add(new Issue(Level.BLOCK, "VAR_DUPLICATE", "A variable name is declared twice."));
        }
        int samples = sampleValues == null ? 0 : sampleValues.size();
        if (samples != names.size()) {
            out.add(new Issue(Level.BLOCK, "VAR_SAMPLES", names.size() + " variable(s) but " + samples + " sample value(s)."));
        }
        Set<String> used = placeholders(s + "\n" + body);
        for (String u : used) {
            if (!names.contains(u)) {
                out.add(new Issue(Level.BLOCK, "E2_UNKNOWN_PLACEHOLDER", "{{" + u + "}} is used but not declared as a variable."));
            }
        }
        Matcher bad = ANY_BRACES.matcher(s + "\n" + body);
        while (bad.find()) {
            if (!PLACEHOLDER.matcher(bad.group()).matches()) {
                out.add(new Issue(Level.BLOCK, "E2_BAD_PLACEHOLDER", "\"" + bad.group() + "\" is not a valid placeholder; use {{name}}."));
            }
        }
        for (String n : names) {
            if (!used.contains(n)) {
                out.add(new Issue(Level.WARN, "VAR_UNUSED", "Variable '" + n + "' is declared but never used."));
            }
        }
        List<String> links = TemplateVariableSources.briefLinks(brief);
        for (String p : TemplateVariableSources.problems(names, sources, links)) {
            out.add(new Issue(Level.BLOCK, "VAR_SOURCE", p));
        }

        // E7 — every link written into the template must be in the brief.
        for (String url : linksIn(s + "\n" + body)) {
            if (!linkInBrief(url, brief)) {
                out.add(new Issue(Level.BLOCK, "E7_LINK_NOT_IN_BRIEF", "The link " + url + " is not in the engine brief."));
            }
        }

        // E4 — cold outreach must let people opt out.
        if (coldOutreach && !UNSUBSCRIBE.matcher(Jsoup.parse(body).text()).find()) {
            out.add(new Issue(Level.BLOCK, "E4_NO_UNSUBSCRIBE",
                    "Cold outreach emails must tell people how to stop (for example: reply STOP to unsubscribe)."));
        }
        return out;
    }

    public static boolean hasBlocking(List<Issue> issues) {
        return issues.stream().anyMatch(i -> i.level() == Level.BLOCK);
    }

    /**
     * E3 — keep only safe formatting HTML. Placeholders inside href/src survive cleaning by being
     * swapped for a temporary https URL, then swapped back.
     */
    public static String sanitise(String html) {
        if (html == null) return "";
        String protectedHtml = Pattern.compile("(href|src)\\s*=\\s*([\"'])\\s*\\{\\{\\s*([A-Za-z][A-Za-z0-9_]{0,39})\\s*}}\\s*\\2")
                .matcher(html).replaceAll(m -> Matcher.quoteReplacement(m.group(1) + "=\"" + PH_HOST + m.group(3) + "\""));
        Safelist safe = Safelist.relaxed()
                .addProtocols("a", "href", "https", "mailto")
                .removeProtocols("a", "href", "http")
                .removeProtocols("img", "src", "http")
                .addAttributes(":all", "style");
        Document.OutputSettings out = new Document.OutputSettings().prettyPrint(false);
        String cleaned = Jsoup.clean(protectedHtml, "", safe, out);
        return cleaned.replaceAll(Pattern.quote(PH_HOST) + "([A-Za-z][A-Za-z0-9_]{0,39})", "{{$1}}");
    }

    /** The rendered email for one person, or the variables that are still missing. */
    public record Rendered(String subject, String html, String text, List<String> missing) {}

    /**
     * Single-pass substitution (a value containing "{{x}}" is not substituted again). Values are
     * HTML-escaped in the body; the subject is plain text on one line.
     */
    public static Rendered render(String subject, String bodyHtml, List<String> variableNames, Map<String, String> values) {
        List<String> missing = new ArrayList<>();
        for (String n : variableNames == null ? List.<String>of() : variableNames) {
            String v = values == null ? null : values.get(n);
            if (v == null || v.isBlank()) missing.add(n);
        }
        String subj = substitute(subject == null ? "" : subject, values, false).replaceAll("[\\r\\n]+", " ").trim();
        String html = substitute(bodyHtml == null ? "" : bodyHtml, values, true);
        Document doc = Jsoup.parse(html.replaceAll("(?i)<br\\s*/?>", "\n").replaceAll("(?i)</p>", "</p>\n"));
        doc.outputSettings(new Document.OutputSettings().prettyPrint(false));
        String text = doc.wholeText().replaceAll("[ \\t]+\n", "\n").replaceAll("\n{3,}", "\n\n").trim();
        return new Rendered(subj, html, text, missing);
    }

    private static String substitute(String in, Map<String, String> values, boolean escapeHtml) {
        Matcher m = PLACEHOLDER.matcher(in);
        StringBuilder sb = new StringBuilder();
        while (m.find()) {
            String v = values == null ? null : values.get(m.group(1));
            String out = v == null ? "" : (escapeHtml ? Entities.escape(v) : v);
            m.appendReplacement(sb, Matcher.quoteReplacement(out));
        }
        m.appendTail(sb);
        return sb.toString();
    }

    static Set<String> placeholders(String in) {
        Set<String> out = new LinkedHashSet<>();
        Matcher m = PLACEHOLDER.matcher(in == null ? "" : in);
        while (m.find()) out.add(m.group(1));
        return out;
    }

    /** Links written into the template text or hrefs, ignoring placeholders. */
    static List<String> linksIn(String in) {
        return TemplateVariableSources.linksIn(in, PLACEHOLDER);
    }

    private static boolean linkInBrief(String url, String brief) {
        return TemplateVariableSources.linkInBrief(url, brief);
    }

    private static boolean mostlyCapitals(String s) {
        int letters = 0, upper = 0;
        for (char c : s.toCharArray()) {
            if (Character.isLetter(c)) {
                letters++;
                if (Character.isUpperCase(c)) upper++;
            }
        }
        return letters >= 8 && upper * 10 > letters * 7;
    }
}
