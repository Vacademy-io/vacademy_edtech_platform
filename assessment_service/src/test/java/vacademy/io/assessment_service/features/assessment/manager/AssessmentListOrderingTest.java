package vacademy.io.assessment_service.features.assessment.manager;

import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.query.QueryUtils;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.AdminAssessmentFilter;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentRepository;
import vacademy.io.assessment_service.features.assessment.sort.StableSort;

import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The Live / Upcoming / Past / Draft list must order by when the exam RUNS
 * ({@code bound_start_time}), not by when it was created.
 *
 * <p>The admin list sends no sort_columns, which used to leave the Pageable unsorted; the
 * query carries no ORDER BY of its own, so Postgres returned heap order — indistinguishable
 * from creation order on this table, and wrong the moment a paper is set up in advance.
 */
class AssessmentListOrderingTest {

    private static final String TIE_BREAKER = "id";

    private static Sort defaultSortFor(boolean upcoming) {
        AdminAssessmentFilter filter = new AdminAssessmentFilter();
        filter.setGetUpcomingAssessments(upcoming);
        return invokeDefaultSort(filter);
    }

    /** Mirrors AdminAssessmentGetManager.defaultAssessmentListSort (private). */
    private static Sort invokeDefaultSort(AdminAssessmentFilter filter) {
        return Boolean.TRUE.equals(filter.getGetUpcomingAssessments())
                ? Sort.by(Sort.Order.asc("bound_start_time"))
                : Sort.by(Sort.Order.desc("bound_start_time"));
    }

    private static String declaredQuery(String methodName) {
        List<Method> matches = Arrays.stream(AssessmentRepository.class.getMethods())
                .filter(m -> m.getName().equals(methodName))
                .filter(m -> m.getAnnotation(Query.class) != null)
                .toList();
        assertThat(matches).as("exactly one @Query named %s", methodName).hasSize(1);
        return matches.get(0).getAnnotation(Query.class).value();
    }

    private static String orderByClause(Sort sort) {
        String query = declaredQuery("filterAssessments");
        String sorted = QueryUtils.applySorting(query, sort, QueryUtils.detectAlias(query));
        int at = sorted.toLowerCase().lastIndexOf("order by");
        assertThat(at).as("an ORDER BY must be appended").isNotNegative();
        return sorted.substring(at).replaceAll("\\s+", " ").trim();
    }

    @Test
    void upcomingShowsTheSoonestExamFirst() {
        Sort sort = StableSort.withStableOrder(Map.of(), defaultSortFor(true), TIE_BREAKER);

        assertThat(orderByClause(sort)).isEqualTo("order by a.bound_start_time asc, a.id asc");
    }

    @Test
    void liveAndPastAndDraftShowTheMostRecentExamFirst() {
        Sort sort = StableSort.withStableOrder(Map.of(), defaultSortFor(false), TIE_BREAKER);

        assertThat(orderByClause(sort)).isEqualTo("order by a.bound_start_time desc, a.id asc");
    }

    @Test
    void neverOrdersByCreatedAt() {
        // The whole point of the change: creation time must not decide list position.
        for (boolean upcoming : new boolean[] { true, false }) {
            String clause = orderByClause(
                    StableSort.withStableOrder(Map.of(), defaultSortFor(upcoming), TIE_BREAKER));
            assertThat(clause).doesNotContain("created_at");
        }
    }

    @Test
    void sortPropertiesResolveToTheAssessmentTableAndNotADoubledAlias() {
        // Spring Data prefixes an unrecognised sort property with the detected alias. These
        // are bare column names so they become "a.<col>"; passing "a.id" would have
        // produced the invalid "a.a.id".
        assertThat(QueryUtils.detectAlias(declaredQuery("filterAssessments"))).isEqualTo("a");

        String clause = orderByClause(
                StableSort.withStableOrder(Map.of(), defaultSortFor(false), TIE_BREAKER));
        assertThat(clause).doesNotContain("a.a.");
    }

    @Test
    void anExplicitSortFromTheClientStillWinsAndKeepsTheTieBreaker() {
        Sort sort = StableSort.withStableOrder(
                Map.of("name", "ASC"), defaultSortFor(false), TIE_BREAKER);

        assertThat(orderByClause(sort)).isEqualTo("order by a.name asc, a.id asc");
    }
}
