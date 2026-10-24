package vacademy.io.admin_core_service.features.catalog_api.rules;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

/** computeCourseBadges / comparePopularity / bestRankedId (course-badges.ts, catalog-sort.ts). */
class CourseBadgesTest {

    static final Instant NOW = Instant.parse("2026-10-16T00:00:00Z");

    static CourseBadges.Input in(String id, String created, Double price, String... tags) {
        return new CourseBadges.Input(id, created == null ? null : Instant.parse(created), price, List.of(tags));
    }

    static Map<String, List<String>> all(List<CourseBadges.Input> courses, Map<String, Integer> ranks, List<String> streams) {
        return CourseBadges.compute(courses, ranks, streams, NOW, CourseBadges.ALL_BADGES, 60, 3, 4);
    }

    @Test
    void bestsellersAreTheTopNPaidCoursesByRank() {
        List<CourseBadges.Input> courses = List.of(in("free", null, 0.0), in("a", null, 100.0), in("b", null, 200.0),
                in("c", null, 300.0), in("d", null, 400.0), in("unsold", null, 50.0), in("closed", null, null));
        Map<String, Integer> ranks = Map.of("free", 1, "d", 2, "b", 3, "a", 4, "c", 5, "closed", 6);
        Map<String, List<String>> out = all(courses, ranks, List.of());
        assertEquals(List.of("bestseller"), out.get("d"));
        assertEquals(List.of("bestseller"), out.get("b"));
        assertEquals(List.of("bestseller"), out.get("a"));
        assertNull(out.get("c")); // 4th paid course
        assertEquals(List.of("free"), out.get("free")); // free courses are never bestsellers
        assertNull(out.get("closed")); // nothing on sale: neither paid nor free
        assertNull(out.get("unsold"));
        assertEquals(List.of("bestseller"), CourseBadges.compute(courses, ranks, List.of(), NOW,
                CourseBadges.ALL_BADGES, 60, 1, 4).get("d"));
        assertNull(CourseBadges.compute(courses, ranks, List.of(), NOW, CourseBadges.ALL_BADGES, 60, 1, 4).get("b"));
    }

    @Test
    void popularIsTheBestRankedCourseOfEachStream() {
        List<CourseBadges.Input> courses = List.of(in("x", null, 10.0, "dharma"), in("y", null, 10.0, "Dharma "),
                in("z", null, 10.0, "shastra"), in("w", null, 10.0, "kala"));
        Map<String, Integer> ranks = Map.of("x", 9, "y", 4, "z", 7);
        Map<String, List<String>> out = CourseBadges.compute(courses, ranks, List.of("dharma", "shastra", "kala", " "),
                NOW, List.of("popular"), 60, 3, 4);
        assertEquals(List.of("popular"), out.get("y"));
        assertEquals(List.of("popular"), out.get("z"));
        assertNull(out.get("x"));
        assertNull(out.get("w")); // unranked: nobody enrolled
    }

    @Test
    void newIsWithinTheWindowAndNeverInTheFuture() {
        List<CourseBadges.Input> courses = List.of(in("fresh", "2026-10-01T00:00:00Z", 10.0),
                in("edge", "2026-08-17T00:00:00Z", 10.0), in("old", "2026-08-16T23:59:59Z", 10.0),
                in("future", "2026-10-17T00:00:00Z", 10.0), in("undated", null, 10.0));
        Map<String, List<String>> out = all(courses, Map.of(), List.of());
        assertEquals(List.of("new"), out.get("fresh"));
        assertEquals(List.of("new"), out.get("edge")); // exactly 60 days
        assertNull(out.get("old"));
        assertNull(out.get("future"));
        assertNull(out.get("undated"));
        assertNull(CourseBadges.compute(courses, Map.of(), List.of(), NOW, CourseBadges.ALL_BADGES, 7, 3, 4)
                .get("edge"));
    }

    @Test
    void badgesFollowTheTypeOrderAndCap() {
        List<CourseBadges.Input> courses = List.of(in("c", "2026-10-10T00:00:00Z", 0.0, "dharma"));
        Map<String, Integer> ranks = Map.of("c", 1);
        assertEquals(List.of("popular", "new", "free"), all(courses, ranks, List.of("dharma")).get("c"));
        assertEquals(List.of("free", "new"), CourseBadges.compute(courses, ranks, List.of("dharma"), NOW,
                List.of("free", "new"), 60, 3, 4).get("c"));
        assertEquals(List.of("free"), CourseBadges.compute(courses, ranks, List.of("dharma"), NOW,
                List.of("free", "new", "popular"), 60, 3, 1).get("c"));
    }

    @Test
    void popularityOrderAndBestRank() {
        List<Integer> ranks = new ArrayList<>(Arrays.asList(null, 3, null, 1, 2));
        ranks.sort(CourseBadges::comparePopularity);
        assertEquals(Arrays.asList(1, 2, 3, null, null), ranks);
        assertEquals(2, CourseBadges.bestRank(List.of("a", "b", "c"), Map.of("b", 5, "c", 2)));
        assertNull(CourseBadges.bestRank(List.of("a"), Map.of("b", 5)));
    }
}
