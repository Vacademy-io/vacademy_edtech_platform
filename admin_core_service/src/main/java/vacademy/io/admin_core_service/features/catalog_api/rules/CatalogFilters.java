package vacademy.io.admin_core_service.features.catalog_api.rules;

import java.util.*;
import java.util.function.Function;
import java.util.function.Predicate;

/**
 * Courses-page filtering and live facet counts.
 *
 * <p>Port of {@code -components/components/catalog/catalog-filters.ts}: filters are GROUPS,
 * options inside a group are OR-ed, groups are AND-ed. Card groups (search, stream, category,
 * badge, format, authored option groups) test the course; row groups (language, price, level,
 * session, tag, instructor, price range) test a VERSION, and a card matches when ONE of its
 * versions passes every active row group ("Hindi and Paid" = a paid Hindi version). A group's
 * option count is the number of cards that would show with that option as the group's only
 * choice, given every OTHER active group ({@code countFacetOptions}).
 *
 * <p>Like the TS {@code buildFacetGroups}, tests are remembered per card / row object for the
 * life of one request ({@link #remember}), so counting one group's options does not re-run every
 * other group's test per option.
 */
public final class CatalogFilters {

    private CatalogFilters() {
    }

    /** A filter group: {@code matches} tests a card, {@code rowMatches} a version (either may be null). */
    public record Group<C, R>(String id, boolean active, Predicate<C> matches, Predicate<R> rowMatches) {
    }

    /** One option of a group, for counting. */
    public record Option<C, R>(String value, Predicate<C> matches, Predicate<R> rowMatches) {
    }

    private record Tests<C, R>(List<Predicate<C>> card, List<Predicate<R>> row) {
    }

    private static <C, R> Tests<C, R> partition(List<Group<C, R>> groups, String exceptId) {
        List<Predicate<C>> card = new ArrayList<>();
        List<Predicate<R>> row = new ArrayList<>();
        for (Group<C, R> g : groups) {
            if (!g.active() || g.id().equals(exceptId)) continue;
            if (g.matches() != null) card.add(g.matches());
            if (g.rowMatches() != null) row.add(g.rowMatches());
        }
        return new Tests<>(card, row);
    }

    private static <C, R> boolean passes(C item, List<R> rows, List<Predicate<C>> cardTests,
                                         List<Predicate<R>> rowTests, Predicate<R> extraRowTest) {
        for (Predicate<C> t : cardTests) if (!t.test(item)) return false;
        if (rowTests.isEmpty() && extraRowTest == null) return true;
        for (R row : rows) {
            boolean ok = true;
            for (Predicate<R> t : rowTests) {
                if (!t.test(row)) {
                    ok = false;
                    break;
                }
            }
            if (ok && (extraRowTest == null || extraRowTest.test(row))) return true;
        }
        return false;
    }

    /** Items passing every active group except {@code exceptId} ({@code applyFacetGroups}). */
    public static <C, R> List<C> apply(List<C> items, Function<C, List<R>> rowsOf, List<Group<C, R>> groups,
                                       String exceptId) {
        Tests<C, R> tests = partition(groups, exceptId);
        if (tests.card().isEmpty() && tests.row().isEmpty()) return items;
        List<C> out = new ArrayList<>();
        for (C item : items) if (passes(item, rowsOf.apply(item), tests.card(), tests.row(), null)) out.add(item);
        return out;
    }

    /** The versions of an item passing every active row group; all of them when none is active ({@code rowsMatchingGroups}). */
    public static <C, R> List<R> rowsMatching(C item, Function<C, List<R>> rowsOf, List<Group<C, R>> groups) {
        Tests<C, R> tests = partition(groups, null);
        List<R> rows = rowsOf.apply(item);
        if (tests.row().isEmpty()) return rows;
        List<R> out = new ArrayList<>();
        for (R row : rows) {
            boolean ok = true;
            for (Predicate<R> t : tests.row()) {
                if (!t.test(row)) {
                    ok = false;
                    break;
                }
            }
            if (ok) out.add(row);
        }
        return out;
    }

    /** Per option: how many items pass every OTHER active group and match the option ({@code countFacetOptions}). */
    public static <C, R> Map<String, Integer> countOptions(List<C> items, Function<C, List<R>> rowsOf,
                                                           List<Group<C, R>> groups, String groupId,
                                                           List<Option<C, R>> options) {
        Tests<C, R> tests = partition(groups, groupId);
        Map<String, Integer> out = new LinkedHashMap<>();
        for (Option<C, R> option : options) {
            List<Predicate<C>> cardTests = tests.card();
            if (option.matches() != null) {
                cardTests = new ArrayList<>(cardTests);
                cardTests.add(option.matches());
            }
            int n = 0;
            for (C item : items) if (passes(item, rowsOf.apply(item), cardTests, tests.row(), option.rowMatches())) n++;
            out.put(option.value(), n);
        }
        return out;
    }

    /** The groups with every test remembered per card / row object (identity), for one request. */
    public static <C, R> List<Group<C, R>> remember(List<Group<C, R>> groups) {
        List<Group<C, R>> out = new ArrayList<>(groups.size());
        for (Group<C, R> g : groups) {
            out.add(new Group<>(g.id(), g.active(), memo(g.matches()), memo(g.rowMatches())));
        }
        return out;
    }

    private static <K> Predicate<K> memo(Predicate<K> test) {
        if (test == null) return null;
        Map<K, Boolean> known = new IdentityHashMap<>();
        return k -> {
            Boolean hit = known.get(k);
            if (hit != null) return hit;
            boolean answer = test.test(k);
            known.put(k, answer);
            return answer;
        };
    }

    // ── row tests ───────────────────────────────────────────────────────────────

    /**
     * {@code rowMatchesLevels}: the version's level is one of {@code selected}, plus the Buy/Rent
     * book-store convention — when "Buy" or "Rent" is selected it may live in the level name, the
     * package type or any field of the row. Unlike the site (exact, case-sensitive), names compare
     * trimmed and case-insensitively, as everywhere else in this API.
     */
    public static boolean rowMatchesLevels(CatalogRow row, Collection<String> selected) {
        if (selected.isEmpty()) return true;
        String level = row.levelName() == null ? "" : row.levelName().trim();
        for (String s : selected) if (s.trim().equalsIgnoreCase(level)) return true;
        for (String s : selected) {
            String v = s.trim();
            if (!v.equalsIgnoreCase("buy") && !v.equalsIgnoreCase("rent")) continue;
            String[] fields = {row.levelName(), row.packageType(), row.title(), row.sessionName(), row.tags(),
                    row.packageId(), row.packageSessionId(), row.currency(), row.enrollInviteAvailability()};
            for (String f : fields) if (f != null && f.trim().equalsIgnoreCase(v)) return true;
        }
        return false;
    }

    /** A price choice: free, paid, or at most {@code max}. */
    public record PriceChoice(String kind, double max) {
        public static final PriceChoice FREE = new PriceChoice("free", 0);
        public static final PriceChoice PAID = new PriceChoice("paid", 0);

        public static PriceChoice max(double max) {
            return new PriceChoice("max", max);
        }
    }

    /** {@code rowMatchesPrice}: coming-soon versions have no price yet and never match. */
    public static boolean rowMatchesPrice(CatalogRow row, PriceChoice choice) {
        if (row.comingSoon() != null) return false;
        double price = row.price();
        return switch (choice.kind()) {
            case "free" -> price == 0;
            case "paid" -> price > 0;
            default -> price <= choice.max();
        };
    }

    /**
     * {@code rowInPriceRange}, inclusive at both ends. Unlike the site's legacy range slider (which
     * tests a coming-soon version's placeholder price), a coming-soon version never matches, as
     * with {@link #rowMatchesPrice}: it has no price yet.
     */
    public static boolean rowInPriceRange(CatalogRow row, Double min, Double max) {
        if (row.comingSoon() != null) return false;
        double price = row.price();
        return (min == null || price >= min) && (max == null || price <= max);
    }

    /**
     * {@code isPureLanguageLevel} ({@code catalog-cards.ts}): a level that is ONLY a language
     * ("Hindi", "हिन्दी"); with language grouping the language chips already say it.
     */
    public static boolean isPureLanguageLevel(String levelName, List<CourseLanguages.Language> languages) {
        CourseLanguages.Language lang = CourseLanguages.languageOfLevel(levelName, languages);
        if (lang == null) return false;
        String name = (levelName == null ? "" : levelName).toLowerCase(Locale.ROOT)
                .replaceAll("[\\s\\-_.,:;()/|]+", " ").trim();
        return lang.tokens().contains(name);
    }

    /** Placeholder level / session names the site never offers as a filter option ({@code SENTINEL_LEVEL_NAMES}). */
    public static final Set<String> SENTINEL_NAMES = Set.of("default", "none", "null", "undefined", "");

    public static boolean isSentinel(String name) {
        return name == null || SENTINEL_NAMES.contains(name.trim().toLowerCase(Locale.ROOT));
    }
}
