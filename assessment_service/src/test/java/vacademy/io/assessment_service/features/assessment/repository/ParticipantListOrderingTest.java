package vacademy.io.assessment_service.features.assessment.repository;

import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.query.QueryUtils;
import vacademy.io.assessment_service.features.assessment.sort.StableSort;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Guards the ORDER BY that Spring Data appends to the paged participant / submission /
 * respondent queries.
 *
 * These are native queries with no ORDER BY of their own, so the sort has to arrive
 * through the Pageable — a hardcoded trailing ORDER BY would become the primary key and
 * silently demote whichever column the teacher clicked.
 *
 * The catch is that Spring Data appends the sort by string manipulation: a property it
 * recognises as a SELECT alias is emitted bare, and anything else is prefixed with the
 * detected table alias ("aur."). Its alias scanner only spots an alias that follows a
 * comma AND whitespace, so writing "select aur.id as registrationId,sa.id as attemptId"
 * instead of ", sa.id as attemptId" hides attemptId, produces "order by aur.attemptId",
 * and 500s the submissions list. This test fails on that reformat, instead of prod.
 */
class ParticipantListOrderingTest {

    // Mirrors AssessmentParticipantsManager.createSortObject.
    private static final Sort PARTICIPANT_DEFAULT = Sort.by(Sort.Order.asc("studentName"));
    // Mirrors AssessmentParticipantsManager.getRespondentList.
    private static final Sort RESPONDENT_DEFAULT = Sort.by(Sort.Order.asc("participantName"));
    private static final String[] TIE_BREAKERS = { "registrationId", "attemptId" };

    private static final List<String> PARTICIPANT_QUERIES = List.of(
            "findUserRegistrationWithFilterForBatch",
            "findUserRegistrationWithFilterWithSearchForBatch",
            "findUserRegistrationWithFilterForSource",
            "findUserRegistrationWithFilterWithSearchForSource",
            "findUserRegistrationWithFilterAdminPreRegistrationAndPending",
            "findUserRegistrationWithFilterWithSearchForPreRegistrationAndPending");

    private static final List<String> RESPONDENT_QUERIES = List.of(
            "findRespondentListForAssessmentWithFilter",
            "findRespondentListForAssessmentWithFilterAndSearch");

    private static String declaredQuery(String methodName) {
        return declaredQuery(AssessmentUserRegistrationRepository.class, methodName);
    }

    private static String declaredQuery(Class<?> repository, String methodName) {
        List<Method> matches = Arrays.stream(repository.getMethods())
                .filter(m -> m.getName().equals(methodName))
                .filter(m -> m.getAnnotation(Query.class) != null)
                .toList();
        assertThat(matches).as("exactly one @Query method named %s", methodName).hasSize(1);
        return matches.get(0).getAnnotation(Query.class).value();
    }

    /** The ORDER BY that Spring Data will actually append to this query. */
    private static String orderByClause(String methodName, Sort sort) {
        return orderByClause(AssessmentUserRegistrationRepository.class, methodName, sort);
    }

    private static String orderByClause(Class<?> repository, String methodName, Sort sort) {
        String query = declaredQuery(repository, methodName);
        String sorted = QueryUtils.applySorting(query, sort, QueryUtils.detectAlias(query));
        int at = sorted.toLowerCase().lastIndexOf("order by");
        assertThat(at).as("%s must get an ORDER BY appended", methodName).isNotNegative();
        return sorted.substring(at).replaceAll("\\s+", " ").trim();
    }

    @Test
    void everyPagedListQueryGetsATotallyOrderedOrderByWithResolvableAliases() {
        Sort participant = StableSort.withStableOrder(Map.of(), PARTICIPANT_DEFAULT, TIE_BREAKERS);
        Sort respondent = StableSort.withStableOrder(Map.of(), RESPONDENT_DEFAULT, TIE_BREAKERS);

        // A table-qualified property here means Spring Data did NOT recognise the SELECT
        // alias, so the generated SQL references a column that does not exist.
        List<String> unresolved = new ArrayList<>();

        for (String method : PARTICIPANT_QUERIES) {
            String clause = orderByClause(method, participant);
            if (clause.contains("aur."))
                unresolved.add(method + " -> " + clause);
            assertThat(clause).as("%s default order", method)
                    .isEqualTo("order by studentName asc, registrationId asc, attemptId asc");
        }
        for (String method : RESPONDENT_QUERIES) {
            String clause = orderByClause(method, respondent);
            if (clause.contains("aur."))
                unresolved.add(method + " -> " + clause);
            assertThat(clause).as("%s default order", method)
                    .isEqualTo("order by participantName asc, registrationId asc, attemptId asc");
        }

        assertThat(unresolved)
                .as("sort properties that failed to resolve to a SELECT alias — "
                        + "check for a missing space after a comma in the SELECT list")
                .isEmpty();
    }

    @Test
    void aTeacherClickedSortStaysPrimaryAndKeepsItsTieBreakers() {
        Sort clicked = StableSort.withStableOrder(Map.of("score", "DESC"), PARTICIPANT_DEFAULT, TIE_BREAKERS);

        for (String method : PARTICIPANT_QUERIES) {
            assertThat(orderByClause(method, clicked)).as("%s clicked order", method)
                    .isEqualTo("order by score desc, registrationId asc, attemptId asc");
        }
    }

    @Test
    void theEvaluatorsAssignedAttemptQueueAlsoResolvesItsAliases() {
        // Lives in StudentAttemptRepository, not the participant repository, and selects
        // participantName/attemptId rather than studentName/registrationId — so it needs
        // its own check. If either alias went unrecognised Spring Data would emit
        // "order by sa.participantName" and 500 the evaluator's queue.
        Sort sort = StableSort.withStableOrder(Map.of(),
                Sort.by(Sort.Order.asc("participantName")), "attemptId");

        String clause = orderByClause(
                vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository.class,
                "findAllAssignedAttemptForUserIdWithFilter", sort);

        assertThat(clause).isEqualTo("order by participantName asc, attemptId asc");
        assertThat(clause).doesNotContain("sa.");
    }

    @Test
    void nonPagedExportQueriesCarryTheirOwnOrderBy() {
        // These take no Pageable, so nothing appends an order for them — theirs is inline.
        for (String method : List.of(
                "findUserRegistrationWithFilterForBatchForExport",
                "findUserRegistrationWithFilterForSourceExport",
                "findUserRegistrationWithFilterAdminPreRegistrationAndPendingExport",
                "findRespondentListForAssessmentWithFilterExport")) {
            assertThat(declaredQuery(method).toLowerCase())
                    .as("%s must be deterministically ordered", method)
                    .contains("order by aur.participant_name asc, aur.id asc");
        }
    }
}
