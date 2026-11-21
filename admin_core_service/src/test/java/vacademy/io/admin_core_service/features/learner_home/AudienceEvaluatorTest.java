package vacademy.io.admin_core_service.features.learner_home;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.Audience;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.Condition;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.ConditionKind;
import vacademy.io.admin_core_service.features.learner_home.repository.LearnerHomeJdbc.Enrolment;
import vacademy.io.admin_core_service.features.learner_home.resolve.AudienceEvaluator;
import vacademy.io.admin_core_service.features.learner_home.resolve.LearnerFacts;

import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/** Truth table over the four condition kinds, empty facts, AND of conditions and deleted ids. */
class AudienceEvaluatorTest {

    /** In batch ps-1 of course p-1, and batch ps-2 of course p-2; tag t-1. */
    private static final LearnerFacts LEARNER = LearnerFacts.of(
            List.of(new Enrolment("ps-1", "p-1"), new Enrolment("ps-2", "p-2")), List.of("t-1"));

    private static Audience rules(Condition... conditions) {
        return new Audience(false, Arrays.asList(conditions));
    }

    private static Condition c(ConditionKind kind, String... ids) {
        return new Condition(kind, List.of(ids));
    }

    @Test
    void everyoneMatchesEvenWithoutFacts() {
        assertTrue(AudienceEvaluator.matches(Audience.EVERYONE, LearnerFacts.EMPTY));
    }

    @Test
    void failsClosedOnMissingOrEmptyRules() {
        assertFalse(AudienceEvaluator.matches(null, LEARNER), "no audience at all = nobody");
        assertFalse(AudienceEvaluator.matches(rules(), LEARNER), "RULES with no condition = nobody");
        assertFalse(AudienceEvaluator.matches(rules(c(ConditionKind.NOT_ENROLLED_IN_COURSE)), LEARNER),
                "a NOT condition with no ids does not become everyone");
    }

    @ParameterizedTest(name = "{0} {1} -> {2}")
    @CsvSource({
            "PACKAGE_SESSION, ps-1, true",
            "PACKAGE_SESSION, ps-9, false",
            "ENROLLED_IN_COURSE, p-2, true",
            "ENROLLED_IN_COURSE, p-9, false",
            "NOT_ENROLLED_IN_COURSE, p-9, true",
            "NOT_ENROLLED_IN_COURSE, p-1, false",
            "USER_TAG, t-1, true",
            "USER_TAG, t-9, false",
    })
    void eachKindMatchesAndMisses(ConditionKind kind, String id, boolean expected) {
        assertEquals(expected, AudienceEvaluator.matches(rules(c(kind, id)), LEARNER));
    }

    @Test
    void anyOfIdsWithinOneCondition() {
        assertTrue(AudienceEvaluator.matches(rules(c(ConditionKind.PACKAGE_SESSION, "ps-9", "ps-2")), LEARNER));
        assertFalse(AudienceEvaluator.matches(rules(c(ConditionKind.NOT_ENROLLED_IN_COURSE, "p-9", "p-1")), LEARNER));
    }

    @Test
    void emptyFactsOnlyMatchNotEnrolled() {
        assertFalse(AudienceEvaluator.matches(rules(c(ConditionKind.PACKAGE_SESSION, "ps-1")), LearnerFacts.EMPTY));
        assertFalse(AudienceEvaluator.matches(rules(c(ConditionKind.ENROLLED_IN_COURSE, "p-1")), LearnerFacts.EMPTY));
        assertFalse(AudienceEvaluator.matches(rules(c(ConditionKind.USER_TAG, "t-1")), LearnerFacts.EMPTY));
        assertTrue(AudienceEvaluator.matches(rules(c(ConditionKind.NOT_ENROLLED_IN_COURSE, "p-1")), LearnerFacts.EMPTY));
    }

    @Test
    void allConditionsMustHold() {
        Audience three = rules(c(ConditionKind.PACKAGE_SESSION, "ps-1"), c(ConditionKind.USER_TAG, "t-1"),
                c(ConditionKind.NOT_ENROLLED_IN_COURSE, "p-3"));
        assertTrue(AudienceEvaluator.matches(three, LEARNER));
        Audience oneFails = rules(c(ConditionKind.PACKAGE_SESSION, "ps-1"), c(ConditionKind.USER_TAG, "t-1"),
                c(ConditionKind.NOT_ENROLLED_IN_COURSE, "p-2"));
        assertFalse(AudienceEvaluator.matches(oneFails, LEARNER));
    }

    @Test
    void deletedIdsMatchNothing() {
        assertFalse(AudienceEvaluator.matches(rules(c(ConditionKind.ENROLLED_IN_COURSE, "deleted-course")), LEARNER));
        assertTrue(AudienceEvaluator.matches(rules(c(ConditionKind.NOT_ENROLLED_IN_COURSE, "deleted-course")), LEARNER));
        assertFalse(AudienceEvaluator.matches(rules(c(ConditionKind.ENROLLED_IN_COURSE)), LEARNER));
    }

    @Test
    void factsKeepTheNewestBatchPerCourse() {
        LearnerFacts f = LearnerFacts.of(List.of(new Enrolment("ps-new", "p-1"), new Enrolment("ps-old", "p-1")), List.of());
        assertEquals("ps-new", f.packageSessionByPackage().get("p-1"));
        assertEquals(2, f.packageSessionIds().size());
    }
}
