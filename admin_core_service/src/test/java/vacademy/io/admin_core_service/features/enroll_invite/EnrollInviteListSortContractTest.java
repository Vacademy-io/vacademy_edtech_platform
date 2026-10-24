package vacademy.io.admin_core_service.features.enroll_invite;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.query.QueryUtils;
import vacademy.io.admin_core_service.features.enroll_invite.repository.EnrollInviteRepository;

import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.Locale;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Pins how Spring Data appends the caller's sort to the two native invite-list
 * queries. Neither query carries an ORDER BY of its own, so the list order is
 * entirely whatever {@code Pageable} sort the service hands over — and that
 * only works if Spring qualifies the column to the outer {@code ei} alias.
 *
 * <p>Two ways this silently breaks, both invisible to a compile:
 * <ul>
 *   <li>alias detection lands on a subquery alias ({@code psl}, {@code ps}) and
 *       the ORDER BY references a column the outer row doesn't have;</li>
 *   <li>someone adds an ORDER BY to the query text, after which Spring appends
 *       ", ei.created_at" onto it instead of starting a fresh clause.</li>
 * </ul>
 * Either would 500 the Invite page on the first request. The FE sends
 * {@code sort_columns: {created_at: 'DESC'}} and the service defaults to the same.
 */
class EnrollInviteListSortContractTest {

    private static final Sort NEWEST_FIRST = Sort.by(Sort.Direction.DESC, "created_at");

    @Test
    @DisplayName("filtered invite query sorts by the outer alias: 'order by ei.created_at desc'")
    void filteredQuerySortsOnOuterAlias() {
        Query query = queryOn("getEnrollInvitesWithFilters");
        String sorted = QueryUtils.applySorting(query.value(), NEWEST_FIRST);
        assertEndsWithNewestFirst(sorted);
    }

    @Test
    @DisplayName("institute-wide search query sorts by the outer alias too")
    void searchQuerySortsOnOuterAlias() {
        Query query = queryOn("getEnrollInvitesByInstituteIdAndSearchName");
        String sorted = QueryUtils.applySorting(query.value(), NEWEST_FIRST);
        assertEndsWithNewestFirst(sorted);
    }

    @Test
    @DisplayName("the list queries carry no ORDER BY of their own")
    void listQueriesHaveNoHardcodedOrderBy() {
        for (String name : new String[] { "getEnrollInvitesWithFilters", "getEnrollInvitesByInstituteIdAndSearchName" }) {
            String lower = queryOn(name).value().toLowerCase(Locale.ROOT);
            assertFalse(lower.contains("order by"),
                    name + " has a hardcoded ORDER BY — Spring would append the caller's sort onto it");
        }
    }

    private static void assertEndsWithNewestFirst(String sorted) {
        String lower = sorted.toLowerCase(Locale.ROOT).replaceAll("\\s+", " ").trim();
        assertTrue(lower.endsWith("order by ei.created_at desc"),
                "expected the sort to be qualified to the outer alias, got tail: ..."
                        + lower.substring(Math.max(0, lower.length() - 80)));
    }

    private static Query queryOn(String methodName) {
        Method method = Arrays.stream(EnrollInviteRepository.class.getDeclaredMethods())
                .filter(m -> m.getName().equals(methodName))
                .findFirst()
                .orElseThrow(() -> new AssertionError("no such repository method: " + methodName));
        Query query = method.getAnnotation(Query.class);
        assertNotNull(query, methodName + " has no @Query");
        return query;
    }
}
