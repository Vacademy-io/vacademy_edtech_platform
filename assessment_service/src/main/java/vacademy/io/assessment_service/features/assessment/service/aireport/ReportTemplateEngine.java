package vacademy.io.assessment_service.features.assessment.service.aireport;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * A small Mustache subset for report template pages. No code runs: templates can only
 * read values from the context.
 * <ul>
 *   <li>{@code {{name}}} HTML-escaped value; dotted paths read nested maps ({@code {{asset.logo}}})</li>
 *   <li>{@code {{{name}}}} raw value (only for values the server builds, e.g. data URIs, SVG)</li>
 *   <li>{@code {{#list}}...{{/list}}} repeats per item (item keys in scope); for a truthy value, shows once</li>
 *   <li>{@code {{^flag}}...{{/flag}}} shows when the value is missing, false, zero or empty</li>
 * </ul>
 */
public final class ReportTemplateEngine {

    private static final Pattern SECTION = Pattern.compile("\\{\\{([#^])\\s*([\\w.]+)\\s*}}(.*?)\\{\\{/\\s*\\2\\s*}}", Pattern.DOTALL);
    private static final Pattern RAW = Pattern.compile("\\{\\{\\{\\s*([\\w.]+)\\s*}}}");
    private static final Pattern VAR = Pattern.compile("\\{\\{\\s*([\\w.]+)\\s*}}");

    private ReportTemplateEngine() {
    }

    public static String render(String template, Map<String, Object> context) {
        if (template == null) return "";
        return renderIn(template, List.of(context));
    }

    private static String renderIn(String template, List<Map<String, Object>> scopes) {
        // Sections first (innermost names resolve against the item scope).
        StringBuilder out = new StringBuilder();
        Matcher m = SECTION.matcher(template);
        int last = 0;
        while (m.find()) {
            out.append(template, last, m.start());
            boolean inverted = "^".equals(m.group(1));
            Object value = lookup(m.group(2), scopes);
            String body = m.group(3);
            if (inverted) {
                if (!truthy(value)) out.append(renderIn(body, scopes));
            } else if (value instanceof Collection<?> items) {
                for (Object item : items) out.append(renderIn(body, push(scopes, item)));
            } else if (truthy(value)) {
                out.append(renderIn(body, push(scopes, value)));
            }
            last = m.end();
        }
        out.append(template.substring(last));
        String s = out.toString();

        s = replace(RAW, s, name -> str(lookup(name, scopes)));
        s = replace(VAR, s, name -> escape(str(lookup(name, scopes))));
        return s;
    }

    private static String replace(Pattern p, String s, java.util.function.Function<String, String> f) {
        Matcher m = p.matcher(s);
        StringBuilder out = new StringBuilder();
        while (m.find()) m.appendReplacement(out, Matcher.quoteReplacement(f.apply(m.group(1))));
        m.appendTail(out);
        return out.toString();
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> push(List<Map<String, Object>> scopes, Object item) {
        if (!(item instanceof Map<?, ?> map)) return scopes;
        java.util.ArrayList<Map<String, Object>> next = new java.util.ArrayList<>(scopes.size() + 1);
        next.add((Map<String, Object>) map);
        next.addAll(scopes);
        return next;
    }

    @SuppressWarnings("unchecked")
    private static Object lookup(String path, List<Map<String, Object>> scopes) {
        String[] parts = path.split("\\.");
        for (Map<String, Object> scope : scopes) {
            if (!scope.containsKey(parts[0])) continue;
            Object v = scope.get(parts[0]);
            for (int i = 1; i < parts.length && v != null; i++) {
                v = v instanceof Map<?, ?> map ? ((Map<String, Object>) map).get(parts[i]) : null;
            }
            return v;
        }
        return null;
    }

    static boolean truthy(Object v) {
        if (v == null) return false;
        if (v instanceof Boolean b) return b;
        if (v instanceof Number n) return n.doubleValue() != 0;
        if (v instanceof Collection<?> c) return !c.isEmpty();
        if (v instanceof String s) return !s.isBlank();
        return true;
    }

    private static String str(Object v) {
        return v == null ? "" : v.toString();
    }

    static String escape(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }
}
