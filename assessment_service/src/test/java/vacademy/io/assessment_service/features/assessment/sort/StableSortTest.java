package vacademy.io.assessment_service.features.assessment.sort;

import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Sort;

import java.util.LinkedHashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The participant / submission / respondent lists are native SQL with no ORDER BY of
 * their own, so this Sort is the only thing that gives them a total order. When it came
 * back {@link Sort#unsorted()} Postgres returned rows in heap order, and every write to
 * student_attempt (opening a paper flips result_status to EVALUATING; submitting marks
 * writes result_marks / result_status / evaluated_file_id / report_release_status) moved
 * the row — reshuffling the list mid-grading and, under LIMIT/OFFSET paging, showing one
 * submission twice while skipping another.
 */
class StableSortTest {

    private static final Sort DEFAULT_SORT = Sort.by(Sort.Order.asc("studentName"));

    private static Map<String, String> sortMap(String... keyValuePairs) {
        Map<String, String> map = new LinkedHashMap<>();
        for (int i = 0; i < keyValuePairs.length; i += 2) {
            map.put(keyValuePairs[i], keyValuePairs[i + 1]);
        }
        return map;
    }

    @Test
    void neverReturnsUnsortedForAnEmptyOrNullRequest() {
        // This is the whole point: an unsorted Pageable is what let the list reshuffle.
        assertThat(StableSort.withStableOrder(null, DEFAULT_SORT, "registrationId").isSorted()).isTrue();
        assertThat(StableSort.withStableOrder(Map.of(), DEFAULT_SORT, "registrationId").isSorted()).isTrue();
    }

    @Test
    void appliesTheDefaultAndTheTieBreakersWhenNothingWasRequested() {
        Sort sort = StableSort.withStableOrder(Map.of(), DEFAULT_SORT, "registrationId", "attemptId");

        assertThat(sort).containsExactly(
                Sort.Order.asc("studentName"),
                Sort.Order.asc("registrationId"),
                Sort.Order.asc("attemptId"));
    }

    @Test
    void aRequestedSortWinsAndKeepsTheTieBreakersBehindIt() {
        // A teacher clicking "Score" must still get a stable order within equal scores,
        // otherwise paging through a tie reorders the tied rows on every fetch.
        Sort sort = StableSort.withStableOrder(sortMap("score", "DESC"), DEFAULT_SORT, "registrationId", "attemptId");

        assertThat(sort).containsExactly(
                Sort.Order.desc("score"),
                Sort.Order.asc("registrationId"),
                Sort.Order.asc("attemptId"));
    }

    @Test
    void treatsAnythingOtherThanDescAsAscendingJustAsTheOldHelperDid() {
        assertThat(StableSort.withStableOrder(sortMap("score", "asc"), DEFAULT_SORT))
                .containsExactly(Sort.Order.asc("score"));
        assertThat(StableSort.withStableOrder(sortMap("score", "desc"), DEFAULT_SORT))
                .containsExactly(Sort.Order.desc("score"));
        assertThat(StableSort.withStableOrder(sortMap("score", "nonsense"), DEFAULT_SORT))
                .containsExactly(Sort.Order.asc("score"));
    }

    @Test
    void doesNotAppendATieBreakerTheCallerAlreadySortedOn() {
        // Otherwise "registrationId DESC" would be followed by a contradictory
        // "registrationId ASC", hiding which direction actually applies.
        Sort sort = StableSort.withStableOrder(sortMap("registrationId", "DESC"), DEFAULT_SORT, "registrationId", "attemptId");

        assertThat(sort).containsExactly(
                Sort.Order.desc("registrationId"),
                Sort.Order.asc("attemptId"));
    }

    @Test
    void ignoresBlankPropertiesRatherThanEmittingAnEmptyOrderBy() {
        Sort sort = StableSort.withStableOrder(sortMap("  ", "ASC"), DEFAULT_SORT, "registrationId");

        assertThat(sort).containsExactly(
                Sort.Order.asc("studentName"),
                Sort.Order.asc("registrationId"));
    }

    @Test
    void keepsTheRequestedOrderOfMultipleColumns() {
        Sort sort = StableSort.withStableOrder(sortMap("score", "DESC", "duration", "ASC"), DEFAULT_SORT, "registrationId");

        assertThat(sort).containsExactly(
                Sort.Order.desc("score"),
                Sort.Order.asc("duration"),
                Sort.Order.asc("registrationId"));
    }
}
