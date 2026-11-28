package vacademy.io.admin_core_service.features.catalog_api.rules;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.*;
import java.util.function.Function;
import java.util.regex.Pattern;

import static vacademy.io.admin_core_service.features.catalog_api.rules.CatalogJson.*;

/**
 * Course language versions: a course's languages are its LEVELS ("Hindi", "Beginner English"),
 * or, for sites whose levels are formats, a course tag that IS a language. With grouping on, a
 * course's rows fold into one card that knows its languages.
 *
 * <p>Port of {@code frontend-learner-dashboard-app/src/routes/$tagName/-utils/course-variants.ts}
 * ({@code languageOfLevel}, {@code languageOfTags}, {@code languageOfRow},
 * {@code versionGroupIndex}, {@code groupCourseVariants}) and of {@code normaliseLanguages} in
 * {@code -components/components/catalog/catalog-config.ts}.
 */
public final class CourseLanguages {

    private CourseLanguages() {
    }

    public record Language(String code, String label, String chip, List<String> match) {
        /** match words, label and code: the tokens that identify the language. */
        List<String> tokens() {
            List<String> out = new ArrayList<>();
            if (match != null) for (String m : match) if (m != null && !m.isEmpty()) out.add(m);
            if (label != null && !label.isEmpty()) out.add(label);
            if (code != null && !code.isEmpty()) out.add(code);
            List<String> lowered = new ArrayList<>();
            for (String t : out) lowered.add(t.toLowerCase(Locale.ROOT).trim());
            return lowered;
        }
    }

    public static final List<Language> DEFAULT_LANGUAGES = List.of(
            new Language("en", "English", "EN", List.of("english", "eng")),
            new Language("hi", "Hindi", "हिं", List.of("hindi", "हिन्दी", "हिंदी")));

    /**
     * Site course languages with codes normalised (lower-case, unique, non-empty); the defaults
     * when the site lists none ({@code courseLanguagesOf} + {@code normaliseLanguages}).
     */
    public static List<Language> normalise(JsonNode courseLanguages) {
        JsonNode raw = field(courseLanguages, "languages");
        if (raw == null || !raw.isArray() || raw.isEmpty()) return DEFAULT_LANGUAGES;
        Set<String> seen = new HashSet<>();
        List<Language> out = new ArrayList<>();
        for (JsonNode lang : raw) {
            if (!isObject(lang)) continue;
            String code = lower(text(lang.get("code")));
            if (code.isEmpty() || seen.contains(code)) continue;
            seen.add(code);
            List<String> match = new ArrayList<>();
            JsonNode m = lang.get("match");
            if (m != null && m.isArray()) for (JsonNode t : m) if (t.isTextual()) match.add(t.asText());
            String label = lang.path("label").isTextual() ? lang.get("label").asText() : "";
            String chip = lang.path("chip").isTextual() ? lang.get("chip").asText() : null;
            out.add(new Language(code, label, chip, match));
        }
        return out.isEmpty() ? DEFAULT_LANGUAGES : out;
    }

    /** Whole-word patterns per token: every list request tests thousands of rows against a handful of tokens. */
    private static final Map<String, Pattern> WORD_PATTERNS = new java.util.concurrent.ConcurrentHashMap<>();

    private static Pattern wordPattern(String token) {
        if (WORD_PATTERNS.size() > 10_000) WORD_PATTERNS.clear(); // tokens are site-authored: bound the cache
        return WORD_PATTERNS.computeIfAbsent(token,
                t -> Pattern.compile("(^|[^a-z0-9])" + Pattern.quote(t) + "([^a-z0-9]|$)"));
    }

    private static boolean isAscii(String s) {
        for (int i = 0; i < s.length(); i++) if (s.charAt(i) > 0x7F) return false;
        return true;
    }

    /**
     * The language a level name stands for. ASCII words must match as whole words (so "eng"
     * does not match "engineering"); non-Latin tokens match anywhere.
     */
    public static Language languageOfLevel(String levelName, List<Language> languages) {
        String name = levelName == null ? "" : levelName.toLowerCase(Locale.ROOT);
        if (name.trim().isEmpty()) return null;
        for (Language lang : languages) {
            for (String token : lang.tokens()) {
                if (token.isEmpty()) continue;
                if (isAscii(token)) {
                    if (wordPattern(token).matcher(name).find()) return lang;
                } else if (name.contains(token)) {
                    return lang;
                }
            }
        }
        return null;
    }

    /** A tag that is EXACTLY a language's label, code or match word; never a word inside a longer tag. */
    public static Language languageOfTags(String tags, List<Language> languages) {
        if (tags == null || tags.trim().isEmpty()) return null;
        List<String> list = new ArrayList<>();
        for (String t : tags.split(",")) {
            String n = t.trim().toLowerCase(Locale.ROOT);
            if (!n.isEmpty()) list.add(n);
        }
        if (list.isEmpty()) return null;
        for (Language lang : languages) {
            List<String> tokens = new ArrayList<>();
            for (String t : lang.tokens()) if (!t.isEmpty()) tokens.add(t);
            for (String t : list) if (tokens.contains(t)) return lang;
        }
        return null;
    }

    /** The language a row is in: its level name, else a course tag that is exactly a language. */
    public static Language languageOfRow(String levelName, String tags, List<Language> languages) {
        Language byLevel = languageOfLevel(levelName, languages);
        return byLevel != null ? byLevel : languageOfTags(tags, languages);
    }

    public static Language languageOfRow(CatalogRow row, List<Language> languages) {
        return languageOfRow(row.levelName(), row.tags(), languages);
    }

    /** Package id → "vg:&lt;n&gt;" for the authored version groups; an id listed twice keeps its first group. */
    public static Map<String, String> versionGroupIndex(List<List<String>> groups) {
        if (groups == null || groups.isEmpty()) return null;
        Map<String, String> out = new HashMap<>();
        for (int i = 0; i < groups.size(); i++) {
            List<String> group = groups.get(i);
            if (group == null) continue;
            for (String id : group) {
                String key = id == null ? "" : id.trim();
                if (!key.isEmpty() && !out.containsKey(key)) out.put(key, "vg:" + i);
            }
        }
        return out.isEmpty() ? null : out;
    }

    /** One card: a course (or version group) with its rows, the row it shows first and its languages. */
    public record Group<T>(String courseId, List<T> variants, T primary, List<Language> languages) {
    }

    /**
     * Folds rows into one group per course, keeping catalogue order (a course sits where its
     * first row sat). With grouping disabled every row is a group of one.
     */
    public static <T> List<Group<T>> groupCourseVariants(List<T> rows,
                                                         Function<T, String> packageId,
                                                         Function<T, String> packageSessionId,
                                                         Function<T, Language> languageOf,
                                                         boolean enabled,
                                                         List<Language> languages,
                                                         String preferredLanguage,
                                                         List<List<String>> versionGroups) {
        record Acc<R>(String courseId, List<R> variants) {
        }
        List<Acc<T>> groups = new ArrayList<>();
        Map<String, Acc<T>> byCourse = new HashMap<>();
        Map<String, String> groupOf = enabled ? versionGroupIndex(versionGroups) : null;
        for (T row : rows) {
            String pkg = packageId.apply(row);
            String ps = packageSessionId.apply(row);
            String courseId = hasText(pkg) ? pkg : (ps == null ? "" : ps);
            String key;
            if (enabled && hasText(pkg)) {
                String vg = groupOf == null ? null : groupOf.get(pkg);
                key = vg != null ? vg : pkg;
            } else {
                key = courseId + "::" + (ps != null ? ps : String.valueOf(groups.size()));
            }
            Acc<T> group = byCourse.get(key);
            if (group == null) {
                group = new Acc<>(courseId, new ArrayList<>());
                byCourse.put(key, group);
                groups.add(group);
            }
            group.variants().add(row);
        }
        List<Group<T>> out = new ArrayList<>(groups.size());
        for (Acc<T> g : groups) {
            Set<String> present = new HashSet<>();
            for (T v : g.variants()) {
                Language lang = languageOf.apply(v);
                if (lang != null) present.add(lang.code());
            }
            List<Language> langs = new ArrayList<>();
            for (Language l : languages) if (present.contains(l.code())) langs.add(l);
            T primary = g.variants().get(0);
            if (hasText(preferredLanguage)) {
                for (T v : g.variants()) {
                    Language lang = languageOf.apply(v);
                    if (lang != null && lang.code().equals(preferredLanguage)) {
                        primary = v;
                        break;
                    }
                }
            }
            out.add(new Group<>(g.courseId(), List.copyOf(g.variants()), primary, List.copyOf(langs)));
        }
        return out;
    }

    /** {@link #groupCourseVariants} over catalogue rows. */
    public static List<Group<CatalogRow>> groupRows(List<CatalogRow> rows, boolean enabled, List<Language> languages,
                                                    String preferredLanguage, List<List<String>> versionGroups) {
        return groupCourseVariants(rows, CatalogRow::packageId, CatalogRow::packageSessionId,
                r -> languageOfRow(r, languages), enabled, languages, preferredLanguage, versionGroups);
    }
}
