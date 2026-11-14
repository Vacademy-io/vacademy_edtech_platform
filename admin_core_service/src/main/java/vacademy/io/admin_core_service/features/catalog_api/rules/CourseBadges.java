package vacademy.io.admin_core_service.features.catalog_api.rules;

import java.time.Duration;
import java.time.Instant;
import java.util.*;

/**
 * Course badges from live data, and the "Popular" sort's order.
 *
 * <p>Port of {@code frontend-learner-dashboard-app/src/routes/$tagName/-utils/course-badges.ts}
 * ({@code computeCourseBadges}, {@code comparePopularity}) and {@code bestRankedId} of
 * {@code -components/components/catalog/catalog-sort.ts}:
 * <ul>
 *   <li>bestseller: the top N (default 3) PAID courses by enrolment rank, institute-wide;</li>
 *   <li>popular: the best-ranked course of each stream (a stream = its course tag);</li>
 *   <li>new: created within the last N days (default 60);</li>
 *   <li>free: its cheapest version on sale now costs nothing.</li>
 * </ul>
 * Ranks come from {@code CatalogPopularityService} (1 = most enrolled); courses nobody is
 * enrolled in have none.
 */
public final class CourseBadges {

    public static final List<String> ALL_BADGES = List.of("bestseller", "popular", "new", "free");

    private CourseBadges() {
    }

    /**
     * One course as the badge rules see it.
     *
     * @param price lowest price among the versions on sale now; null when none is (0 = free)
     * @param tags  lower-case course tags (incl. level keys) plus the tag of every stream it is in
     */
    public record Input(String courseId, Instant createdAt, Double price, Collection<String> tags) {
    }

    /**
     * Badges per course id, in {@code types} order, at most {@code max} each (courses with none
     * are absent).
     */
    public static Map<String, List<String>> compute(List<Input> courses, Map<String, Integer> ranks,
                                                    List<String> streamTags, Instant now, List<String> types,
                                                    int newDays, int bestsellerTop, int max) {
        List<String> order = new ArrayList<>();
        for (String t : (types == null || types.isEmpty() ? ALL_BADGES : types)) {
            if (ALL_BADGES.contains(t) && !order.contains(t)) order.add(t);
        }
        Map<String, Set<String>> earned = new HashMap<>();

        // Bestseller: the top N PAID courses by rank (List.sort is stable, like Array.prototype.sort).
        List<Input> paidRanked = new ArrayList<>();
        for (Input c : courses) if (isPaid(c) && ranks.get(c.courseId()) != null) paidRanked.add(c);
        paidRanked.sort(Comparator.comparingInt(c -> ranks.get(c.courseId())));
        for (int i = 0; i < Math.min(bestsellerTop, paidRanked.size()); i++) {
            give(earned, paidRanked.get(i).courseId(), "bestseller");
        }

        // Popular: the best-ranked course of each stream.
        for (String stream : streamTags == null ? List.<String>of() : streamTags) {
            String s = stream == null ? "" : stream.trim().toLowerCase(Locale.ROOT);
            if (s.isEmpty()) continue;
            Input best = null;
            for (Input c : courses) {
                Integer r = ranks.get(c.courseId());
                if (r == null) continue;
                boolean inStream = false;
                for (String t : c.tags()) {
                    if (t != null && t.trim().toLowerCase(Locale.ROOT).equals(s)) {
                        inStream = true;
                        break;
                    }
                }
                if (!inStream) continue;
                if (best == null || r < ranks.get(best.courseId())) best = c;
            }
            if (best != null) give(earned, best.courseId(), "popular");
        }

        Duration window = Duration.ofDays(newDays);
        for (Input c : courses) {
            if (c.createdAt() != null) {
                Duration age = Duration.between(c.createdAt(), now);
                if (!age.isNegative() && age.compareTo(window) <= 0) give(earned, c.courseId(), "new");
            }
            if (c.price() != null && c.price() == 0) give(earned, c.courseId(), "free");
        }

        Map<String, List<String>> out = new LinkedHashMap<>();
        for (Input c : courses) {
            Set<String> set = earned.get(c.courseId());
            if (set == null) continue;
            List<String> list = order.stream().filter(set::contains).limit(Math.max(0, max)).toList();
            if (!list.isEmpty()) out.put(c.courseId(), list);
        }
        return out;
    }

    private static boolean isPaid(Input c) {
        return c.price() != null && c.price() > 0;
    }

    private static void give(Map<String, Set<String>> earned, String id, String badge) {
        earned.computeIfAbsent(id, k -> new HashSet<>()).add(badge);
    }

    /** The best (lowest) rank among ids; null when none is ranked. */
    public static Integer bestRank(Collection<String> ids, Map<String, Integer> ranks) {
        Integer best = null;
        for (String id : ids) {
            Integer r = ranks.get(id);
            if (r != null && (best == null || r < best)) best = r;
        }
        return best;
    }

    /** "Popular" order: ranked first by rank, unranked after them (equal → 0, so a stable sort keeps their order). */
    public static int comparePopularity(Integer a, Integer b) {
        if (a == null && b == null) return 0;
        if (a == null) return 1;
        if (b == null) return -1;
        return Integer.compare(a, b);
    }
}
