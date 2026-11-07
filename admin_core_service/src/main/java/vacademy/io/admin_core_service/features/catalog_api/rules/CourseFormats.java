package vacademy.io.admin_core_service.features.catalog_api.rules;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.*;

import static vacademy.io.admin_core_service.features.catalog_api.rules.CatalogJson.*;

/**
 * A course's FORMAT ("E-books", "Live sessions"…), authored once per site in
 * {@code globalSettings.courseFormats} (+ optional {@code courseFormatOrder}).
 *
 * <p>Port of {@code frontend-learner-dashboard-app/src/routes/$tagName/-utils/course-format.ts}
 * ({@code resolveCourseFormats}, {@code rowTags}, {@code courseFormatKeys}, {@code cardFormatKeys}).
 * A row's formats, in precedence order: a {@code format-<key>} course tag naming an authored key;
 * a course tag listed in a format's {@code tags}; the row's level name listed in a format's
 * {@code levels} (trimmed, case-insensitive). No settings means no formats anywhere.
 */
public final class CourseFormats {

    public static final String FORMAT_TAG_PREFIX = "format-";
    private static final int MAX_FORMATS = 30;

    private CourseFormats() {
    }

    /** One validated format: lower-case key, base-language label, lower-case levels and tags. */
    public record Format(String key, String label, List<String> levels, List<String> tags) {
    }

    /** In display order (courseFormatOrder first, then authoring order). */
    public record Resolved(List<Format> list, Map<String, Format> byKey) {
        public String labelOf(String key) {
            Format f = byKey.get(key);
            return f == null ? null : f.label();
        }
    }

    private static List<String> strList(JsonNode raw) {
        if (raw == null || !raw.isArray()) return List.of();
        LinkedHashSet<String> out = new LinkedHashSet<>();
        for (JsonNode n : raw) {
            String v = norm(n);
            if (!v.isEmpty()) out.add(v);
        }
        return new ArrayList<>(out);
    }

    /** Validated formats from globalSettings, or null when the site authors none. */
    public static Resolved resolve(JsonNode globalSettings) {
        JsonNode raw = field(globalSettings, "courseFormats");
        if (!isObject(raw)) return null;
        List<Format> all = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        Iterator<Map.Entry<String, JsonNode>> it = raw.fields();
        while (it.hasNext()) {
            Map.Entry<String, JsonNode> e = it.next();
            String key = lower(e.getKey());
            JsonNode def = e.getValue();
            if (key.isEmpty() || seen.contains(key) || !isObject(def)) continue;
            String label = text(def.get("label"));
            if (label.isEmpty()) continue;
            seen.add(key);
            List<String> tags = strList(def.get("tags"));
            String own = FORMAT_TAG_PREFIX + key;
            List<String> allTags = new ArrayList<>();
            if (!tags.contains(own)) allTags.add(own);
            allTags.addAll(tags);
            all.add(new Format(key, label, strList(def.get("levels")), allTags));
            if (all.size() >= MAX_FORMATS) break;
        }
        if (all.isEmpty()) return null;
        List<String> order = strList(field(globalSettings, "courseFormatOrder"));
        List<Format> list = new ArrayList<>(all);
        // List.sort is stable, so equal ranks keep authoring order (the TS "|| a.i - b.i").
        list.sort(Comparator.comparingInt(f -> {
            int i = order.indexOf(f.key());
            return i == -1 ? order.size() : i;
        }));
        Map<String, Format> byKey = new LinkedHashMap<>();
        for (Format f : list) byKey.put(f.key(), f);
        return new Resolved(List.copyOf(list), Collections.unmodifiableMap(byKey));
    }

    /** A row's course tags, lower-case: a comma string plus any extra tags. */
    public static List<String> rowTags(String commaTags, Collection<String> extra) {
        List<String> out = new ArrayList<>();
        addTags(out, commaTags);
        if (extra != null) for (String t : extra) addTags(out, t);
        return out;
    }

    private static void addTags(List<String> out, String v) {
        if (v == null) return;
        for (String t : v.split(",")) {
            String n = lower(t);
            if (!n.isEmpty()) out.add(n);
        }
    }

    /** Every format key the row has, in precedence order. */
    public static List<String> courseFormatKeys(String commaTags, String levelName, Resolved formats) {
        return formatKeysOfTags(rowTags(commaTags, null), levelName, formats);
    }

    public static List<String> formatKeysOfTags(List<String> lowerTags, String levelName, Resolved formats) {
        if (formats == null) return List.of();
        List<String> out = new ArrayList<>();
        for (String tag : lowerTags) {
            if (tag.startsWith(FORMAT_TAG_PREFIX)) push(out, formats, tag.substring(FORMAT_TAG_PREFIX.length()));
        }
        for (Format f : formats.list()) {
            for (String t : f.tags()) {
                if (lowerTags.contains(t)) {
                    push(out, formats, f.key());
                    break;
                }
            }
        }
        String level = lower(levelName);
        if (!level.isEmpty()) {
            for (Format f : formats.list()) if (f.levels().contains(level)) push(out, formats, f.key());
        }
        return out;
    }

    private static void push(List<String> out, Resolved formats, String key) {
        if (formats.byKey().containsKey(key) && !out.contains(key)) out.add(key);
    }

    /** Format keys of any of the rows (a language-grouped card), first-seen order. */
    public static List<String> cardFormatKeys(List<CatalogRow> rows, Resolved formats) {
        List<String> out = new ArrayList<>();
        for (CatalogRow r : rows) {
            for (String key : courseFormatKeys(r.tags(), r.levelName(), formats)) {
                if (!out.contains(key)) out.add(key);
            }
        }
        return out;
    }
}
