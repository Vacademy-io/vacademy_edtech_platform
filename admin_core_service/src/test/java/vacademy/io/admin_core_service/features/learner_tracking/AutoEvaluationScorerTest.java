package vacademy.io.admin_core_service.features.learner_tracking;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.learner_tracking.util.AutoEvaluationScorer;
import vacademy.io.admin_core_service.features.learner_tracking.util.AutoEvaluationScorer.Verdict;

import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Pins server-side quiz/question grading.
 *
 * <p>The bug this exists to prevent: the learner app posts its own
 * {@code response_status}, and the quiz "Finish" path posted the literal
 * "SUBMITTED" for every question. That went straight into
 * {@code quiz_slide_question_tracked}, so a 16/18 attempt was recorded as 0/18 and
 * every downstream reader — the LLM analytics payload most visibly — reported the
 * learner as having got nothing right. Grading has to work on every response shape
 * the app has ever written, and has to say UNKNOWN rather than guess when it can't.
 */
class AutoEvaluationScorerTest {

    private final AutoEvaluationScorer scorer = new AutoEvaluationScorer(new ObjectMapper());

    private static final List<String> OPTIONS = List.of("opt-a", "opt-b", "opt-c", "opt-d");

    @Nested
    @DisplayName("response shapes written by the learner app")
    class ResponseShapes {

        @Test
        @DisplayName("legacy {answer: <optionId>} from the Finish button grades correctly")
        void legacyAnswerShape() {
            String key = "{\"correctAnswers\":[\"opt-b\"]}";
            assertEquals(Verdict.CORRECT, scorer.evaluate(key, "{\"answer\":\"opt-b\"}", () -> OPTIONS));
            assertEquals(Verdict.WRONG, scorer.evaluate(key, "{\"answer\":\"opt-c\"}", () -> OPTIONS));
        }

        @Test
        @DisplayName("rich {selectedOptions:[{id}]} shape grades correctly")
        void richShape() {
            String key = "{\"correctAnswers\":[\"opt-b\"]}";
            String response = "{\"questionName\":\"Q\",\"selectedOptions\":[{\"id\":\"opt-b\",\"name\":\"B\"}]}";
            assertEquals(Verdict.CORRECT, scorer.evaluate(key, response, () -> OPTIONS));
        }

        @Test
        @DisplayName("MCQM needs every correct option and nothing else")
        void multiSelect() {
            String key = "{\"correctAnswers\":[\"opt-a\",\"opt-c\"]}";
            assertEquals(Verdict.CORRECT,
                    scorer.evaluate(key, "{\"answer\":[\"opt-c\",\"opt-a\"]}", () -> OPTIONS));
            assertEquals(Verdict.WRONG, scorer.evaluate(key, "{\"answer\":[\"opt-a\"]}", () -> OPTIONS));
            assertEquals(Verdict.WRONG,
                    scorer.evaluate(key, "{\"answer\":[\"opt-a\",\"opt-c\",\"opt-d\"]}", () -> OPTIONS));
        }

        @Test
        @DisplayName("an unanswered question is SKIPPED, never WRONG")
        void unanswered() {
            String key = "{\"correctAnswers\":[\"opt-b\"]}";
            assertEquals(Verdict.SKIPPED, scorer.evaluate(key, "{}", () -> OPTIONS));
            assertEquals(Verdict.SKIPPED, scorer.evaluate(key, "{\"answer\":null}", () -> OPTIONS));
            assertEquals(Verdict.SKIPPED, scorer.evaluate(key, "{\"selectedOptions\":[]}", () -> OPTIONS));
            assertEquals(Verdict.SKIPPED, scorer.evaluate(key, null, () -> OPTIONS));
        }
    }

    @Nested
    @DisplayName("answer keys written by the authoring flows")
    class AnswerKeys {

        @Test
        @DisplayName("positional-index keys (AI copilot path) resolve through the option list")
        void indexBasedKey() {
            String key = "{\"correctAnswers\":[1]}";
            assertEquals(Verdict.CORRECT, scorer.evaluate(key, "{\"answer\":\"opt-b\"}", () -> OPTIONS));
            assertEquals(Verdict.WRONG, scorer.evaluate(key, "{\"answer\":\"opt-a\"}", () -> OPTIONS));
        }

        @Test
        @DisplayName("an index out of range is not graded rather than graded wrongly")
        void indexOutOfRange() {
            assertEquals(Verdict.UNKNOWN,
                    scorer.evaluate("{\"correctAnswers\":[9]}", "{\"answer\":\"opt-b\"}", () -> OPTIONS));
        }

        @Test
        @DisplayName("numeric option ids are treated as ids, not indices")
        void numericOptionIds() {
            List<String> numericOptions = List.of("10", "11", "12");
            assertEquals(Verdict.CORRECT,
                    scorer.evaluate("{\"correctAnswers\":[\"11\"]}", "{\"answer\":\"11\"}", () -> numericOptions));
        }

        @Test
        @DisplayName("the key nested under data is read too")
        void nestedKey() {
            assertEquals(Verdict.CORRECT, scorer.evaluate("{\"data\":{\"correctAnswers\":[\"opt-a\"]}}",
                    "{\"answer\":\"opt-a\"}", () -> OPTIONS));
        }
    }

    @Nested
    @DisplayName("questions that must not be graded")
    class NotGradable {

        @Test
        @DisplayName("free-text questions are left to whatever evaluated them")
        void subjectiveKey() {
            assertEquals(Verdict.UNKNOWN,
                    scorer.evaluate("{\"data\":{\"answer\":{\"content\":\"an essay\"}}}",
                            "{\"answer\":\"an essay\"}", () -> List.of()));
        }

        @Test
        @DisplayName("a missing or unparseable key is UNKNOWN")
        void noKey() {
            assertEquals(Verdict.UNKNOWN, scorer.evaluate(null, "{\"answer\":\"opt-a\"}", () -> OPTIONS));
            assertEquals(Verdict.UNKNOWN, scorer.evaluate("", "{\"answer\":\"opt-a\"}", () -> OPTIONS));
            assertEquals(Verdict.UNKNOWN, scorer.evaluate("not json", "{\"answer\":\"opt-a\"}", () -> OPTIONS));
            assertEquals(Verdict.UNKNOWN,
                    scorer.evaluate("{\"correctAnswers\":[]}", "{\"answer\":\"opt-a\"}", () -> OPTIONS));
        }

        @Test
        @DisplayName("a response shape we do not recognise is UNKNOWN, not WRONG")
        void unrecognisedResponse() {
            String key = "{\"correctAnswers\":[\"opt-b\"]}";
            assertEquals(Verdict.UNKNOWN, scorer.evaluate(key, "{\"somethingElse\":true}", () -> OPTIONS));
            assertEquals(Verdict.UNKNOWN, scorer.evaluate(key, "not json", () -> OPTIONS));
        }
    }

    @Test
    @DisplayName("correct and selected ids are exposed for rendering answers as text")
    void exposesIdsForRendering() {
        assertEquals(List.of("opt-b"),
                List.copyOf(scorer.correctAnswerIds("{\"correctAnswers\":[1]}", () -> OPTIONS)));
        assertEquals(List.of("opt-c"), List.copyOf(scorer.selectedAnswerIds("{\"answer\":\"opt-c\"}")));
        assertEquals(List.of(), List.copyOf(scorer.selectedAnswerIds("garbage")));
    }

    @Nested
    @DisplayName("partial marking on multiple-correct questions")
    class PartialCredit {

        private static final Set<String> KEY = Set.of("opt-a", "opt-c");

        @Test
        @DisplayName("one of two correct options earns half")
        void subsetEarnsShare() {
            assertEquals(0.5, AutoEvaluationScorer.partialCreditFraction(KEY, Set.of("opt-a")));
        }

        @Test
        @DisplayName("the full key earns everything")
        void fullKeyEarnsAll() {
            assertEquals(1.0, AutoEvaluationScorer.partialCreditFraction(KEY, Set.of("opt-a", "opt-c")));
        }

        @Test
        @DisplayName("any wrong option earns nothing, even alongside correct ones")
        void wrongOptionEarnsNothing() {
            assertEquals(0.0, AutoEvaluationScorer.partialCreditFraction(KEY, Set.of("opt-a", "opt-b")));
            assertEquals(0.0, AutoEvaluationScorer.partialCreditFraction(KEY, Set.of("opt-b")));
        }

        @Test
        @DisplayName("only responses flagged isPartial are read as partial")
        void isMarkedPartial() {
            assertEquals(true, scorer.isMarkedPartial("{\"marks\":0.5,\"isPartial\":true}"));
            assertEquals(false, scorer.isMarkedPartial("{\"marks\":0,\"isPartial\":false}"));
            assertEquals(false, scorer.isMarkedPartial("{\"marks\":0,\"isCorrect\":false}"));
            assertEquals(false, scorer.isMarkedPartial("not json isPartial"));
            assertEquals(false, scorer.isMarkedPartial(null));
        }

        @Test
        @DisplayName("unanswered or keyless questions earn nothing")
        void emptyEarnsNothing() {
            assertEquals(0.0, AutoEvaluationScorer.partialCreditFraction(KEY, Set.of()));
            assertEquals(0.0, AutoEvaluationScorer.partialCreditFraction(Set.of(), Set.of("opt-a")));
        }
    }
}
