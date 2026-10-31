package vacademy.io.assessment_service.features.assessment.sort;

import org.springframework.data.domain.Sort;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Builds a {@link Sort} that always defines a TOTAL order for the paged
 * participant / submission / respondent list queries.
 *
 * <p>Why this exists: those queries are native SQL with no ORDER BY of their
 * own, so the Pageable's sort is the only thing ordering them. An empty sort map
 * used to collapse to {@link Sort#unsorted()}, which leaves Postgres free to
 * return rows in physical heap order. Every write to {@code student_attempt}
 * rewrites the row to a new heap slot — opening the evaluator workspace flips
 * {@code result_status} to EVALUATING, submitting marks writes
 * {@code result_marks} / {@code result_status} / {@code evaluated_file_id} /
 * {@code report_release_status} — so the list reordered underneath an evaluator
 * mid-grading. Worse, the paging is LIMIT/OFFSET, so a reorder between two page
 * fetches could show one submission twice and skip another one entirely.
 *
 * <p>Hardcoding ORDER BY into the SQL instead does NOT work here: Spring Data
 * appends the Pageable's sort to the declared query, so a trailing ORDER BY
 * becomes the primary key and silently demotes the column the user clicked.
 * The order has to come through the Sort. (Non-paged export queries have no
 * Pageable, so those do carry their ORDER BY inline.)
 *
 * <p>Sort properties must be SELECT aliases of the target query. Spring Data's
 * DefaultQueryEnhancer leaves a recognised alias bare but prefixes anything
 * else with the detected table alias, which would produce invalid SQL — so each
 * caller passes the default and tie-breakers that its own queries actually
 * select.
 */
public final class StableSort {

    private StableSort() {
    }

    /**
     * @param sortColumns requested sort as property -> "ASC"/"DESC"; may be null or empty
     * @param defaultSort order to apply when the caller requested nothing
     * @param tieBreakers unique-per-row properties appended ASC, so the order stays
     *                    deterministic even when the leading column has duplicate
     *                    values (two learners really can share a name)
     */
    public static Sort withStableOrder(Map<String, String> sortColumns, Sort defaultSort, String... tieBreakers) {
        List<Sort.Order> orders = new ArrayList<>();
        // Tracks properties already ordered on, so a tie-breaker that the caller
        // explicitly sorted by is not appended a second time (Postgres tolerates
        // the duplicate, but it hides which direction actually applies).
        Set<String> seen = new LinkedHashSet<>();

        if (sortColumns != null) {
            for (Map.Entry<String, String> entry : sortColumns.entrySet()) {
                String property = entry.getKey();
                if (property == null || property.isBlank())
                    continue;
                Sort.Direction direction = "DESC".equalsIgnoreCase(entry.getValue())
                        ? Sort.Direction.DESC
                        : Sort.Direction.ASC;
                if (seen.add(property.toLowerCase()))
                    orders.add(new Sort.Order(direction, property));
            }
        }

        if (orders.isEmpty() && defaultSort != null) {
            for (Sort.Order order : defaultSort) {
                if (seen.add(order.getProperty().toLowerCase()))
                    orders.add(order);
            }
        }

        if (tieBreakers != null) {
            for (String tieBreaker : tieBreakers) {
                if (tieBreaker != null && !tieBreaker.isBlank() && seen.add(tieBreaker.toLowerCase()))
                    orders.add(Sort.Order.asc(tieBreaker));
            }
        }

        return orders.isEmpty() ? Sort.unsorted() : Sort.by(orders);
    }
}
