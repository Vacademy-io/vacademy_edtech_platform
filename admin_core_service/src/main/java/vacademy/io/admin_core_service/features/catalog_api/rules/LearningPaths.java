package vacademy.io.admin_core_service.features.catalog_api.rules;

import vacademy.io.admin_core_service.features.catalog_api.rules.CatalogStreams.FolderNode;
import vacademy.io.admin_core_service.features.catalog_api.rules.CourseLanguages.Language;

import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Learning paths: a path IS a product page; its ACTIVE courses, in the admin's display order,
 * are the path's numbered steps. With grouped versions a course's language versions are one
 * step; levels that differ by more than their language stay separate steps.
 *
 * <p>Port of {@code levelWithoutLanguage}, {@code buildPathSteps}, {@code collectPathEntries},
 * {@code findFolderBySlug}, {@code resolvePathScope} and {@code pathsInScope} in
 * {@code frontend-learner-dashboard-app/src/routes/$tagName/-components/components/learning-path-utils.ts}
 * and {@code languageTokens} in {@code -components/site-cart/site-cart-items.ts}.
 */
public final class LearningPaths {

    private LearningPaths() {
    }

    /** The part of a product-page (by-code) mapping a path step reads. */
    public record PathMapping(String packageId, String packageSessionId, String levelName, String packageName,
                              String status, String enrollInviteId, Double price, Double elevatedPrice,
                              String currency, String tags, String imageMediaId) {
    }

    public record Step(String key, String courseId, List<PathMapping> variants, List<Language> languages,
                       PathMapping primary) {
    }

    /** A language's tokens, longest first. */
    static List<String> languageTokens(Language language) {
        List<String> out = new ArrayList<>();
        for (String t : language.tokens()) if (!t.isEmpty()) out.add(t);
        out.sort((a, b) -> b.length() - a.length());
        return out;
    }

    private static boolean isAscii(String s) {
        for (int i = 0; i < s.length(); i++) if (s.charAt(i) > 0x7F) return false;
        return true;
    }

    private static final Pattern SEPARATORS = Pattern.compile("[\\s\\-_.,:;|/\\\\()\\[\\]{}·•–—]+");

    /** A level name without its language words: "Beginner Hindi" and "Beginner (English)" are both "beginner". */
    public static String levelWithoutLanguage(String levelName, Language language) {
        String name = " " + (levelName == null ? "" : levelName.toLowerCase(Locale.ROOT)) + " ";
        for (String token : languageTokens(language)) {
            if (isAscii(token)) {
                Pattern p = Pattern.compile("(^|[^a-z0-9])" + Pattern.quote(token) + "(?=[^a-z0-9]|$)");
                name = p.matcher(name).replaceAll(m -> Matcher.quoteReplacement(m.group(1) + " "));
            } else {
                name = name.replace(token, " ");
            }
        }
        return SEPARATORS.matcher(name).replaceAll(" ").trim();
    }

    /**
     * The path's steps: ACTIVE mappings in the order given, each package session once. With
     * grouped versions, rows of one package fold into one step only when they differ by language
     * alone; every other row is a step of its own.
     */
    public static List<Step> buildPathSteps(List<PathMapping> mappings, boolean groupVersions, List<Language> languages,
                                            String preferredLanguage) {
        Set<String> seen = new HashSet<>();
        List<PathMapping> rows = new ArrayList<>();
        if (mappings != null) {
            for (PathMapping m : mappings) {
                if (m == null || m.packageSessionId() == null || m.packageSessionId().isEmpty()) continue;
                String status = m.status() == null ? "ACTIVE" : m.status();
                if (!"ACTIVE".equals(status.toUpperCase(Locale.ROOT))) continue;
                if (!seen.add(m.packageSessionId())) continue;
                rows.add(m);
            }
        }
        List<Acc> steps = new ArrayList<>();
        Map<String, Acc> foldable = new HashMap<>();
        for (PathMapping row : rows) {
            boolean hasPackage = row.packageId() != null && !row.packageId().isEmpty();
            Language language = groupVersions && hasPackage
                    ? CourseLanguages.languageOfLevel(row.levelName(), languages) : null;
            if (language == null) {
                steps.add(newStep(row));
                continue;
            }
            String foldKey = row.packageId() + "\u0000" + levelWithoutLanguage(row.levelName(), language);
            Acc step = foldable.get(foldKey);
            if (step == null) {
                Acc created = newStep(row);
                steps.add(created);
                foldable.put(foldKey, created);
            } else if (step.variants().stream().anyMatch(v -> language.code().equals(codeOf(v, languages)))) {
                steps.add(newStep(row)); // two rows in the same language are two courses
            } else {
                step.variants().add(row);
            }
        }
        List<Step> out = new ArrayList<>();
        for (Acc s : steps) {
            Set<String> present = new HashSet<>();
            for (PathMapping v : s.variants()) {
                String c = codeOf(v, languages);
                if (c != null) present.add(c);
            }
            List<Language> langs = new ArrayList<>();
            for (Language l : languages) if (present.contains(l.code())) langs.add(l);
            PathMapping primary = s.variants().get(0);
            if (preferredLanguage != null && !preferredLanguage.isEmpty()) {
                for (PathMapping v : s.variants()) {
                    if (preferredLanguage.equals(codeOf(v, languages))) {
                        primary = v;
                        break;
                    }
                }
            }
            out.add(new Step(s.key(), s.courseId(), List.copyOf(s.variants()), List.copyOf(langs), primary));
        }
        return out;
    }

    private record Acc(String key, String courseId, List<PathMapping> variants) {
    }

    private static Acc newStep(PathMapping row) {
        String packageId = row.packageId() == null ? "" : row.packageId().trim();
        List<PathMapping> variants = new ArrayList<>();
        variants.add(row);
        return new Acc(row.packageSessionId(), packageId.isEmpty() ? row.packageSessionId() : packageId, variants);
    }

    private static String codeOf(PathMapping row, List<Language> languages) {
        Language l = CourseLanguages.languageOfLevel(row.levelName(), languages);
        return l == null ? null : l.code();
    }

    /** A path in the library: the product page node, its code and the folder it sits in. */
    public record PathEntry(FolderNode node, String code, FolderNode parent) {
    }

    /** The paths (product pages) under {@code nodes}, in library order, each code once; coming-soon folders are not opened. */
    public static List<PathEntry> collectPathEntries(List<FolderNode> nodes, FolderNode parent, Set<String> seen) {
        List<PathEntry> out = new ArrayList<>();
        if (nodes == null) return out;
        for (FolderNode n : nodes) {
            if (CatalogStreams.PRODUCT_PAGE.equals(n.nodeType())) {
                String code = n.productPageCode() == null ? "" : n.productPageCode().trim();
                if (!code.isEmpty() && seen.add(code)) out.add(new PathEntry(n, code, parent));
            } else if (!n.comingSoon()) {
                out.addAll(collectPathEntries(n.children(), n, seen));
            }
        }
        return out;
    }

    public static List<PathEntry> collectPathEntries(List<FolderNode> nodes) {
        return collectPathEntries(nodes, null, new HashSet<>());
    }

    /** The folder a ?stream= value names: a top-level folder first, else the first folder anywhere with that slug. */
    public static FolderNode findFolderBySlug(List<FolderNode> roots, String slug) {
        String key = slug == null ? "" : slug.trim().toLowerCase(Locale.ROOT);
        if (key.isEmpty()) return null;
        for (FolderNode n : roots) if (matches(n, key)) return n;
        Deque<FolderNode> queue = new ArrayDeque<>();
        for (FolderNode n : roots) queue.addAll(n.children());
        while (!queue.isEmpty()) {
            FolderNode n = queue.removeFirst();
            if (matches(n, key)) return n;
            queue.addAll(n.children());
        }
        return null;
    }

    private static boolean matches(FolderNode n, String key) {
        return n.isFolder() && CatalogStreams.folderSlug(n).toLowerCase(Locale.ROOT).equals(key);
    }

    /**
     * The paths a list shows: every path, or (with {@code stream}) the paths under that folder;
     * an unknown or coming-soon folder lists none ({@code resolvePathScope} + {@code pathsInScope}).
     */
    public static List<PathEntry> pathsInScope(List<FolderNode> roots, String stream) {
        if (stream == null || stream.isEmpty()) return collectPathEntries(roots);
        FolderNode folder = findFolderBySlug(roots, stream);
        if (folder == null || folder.comingSoon()) return List.of();
        return collectPathEntries(folder.children(), folder, new HashSet<>());
    }
}
