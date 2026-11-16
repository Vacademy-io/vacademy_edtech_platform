package vacademy.io.admin_core_service.features.learner_quiz;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.learner_tracking.util.AutoEvaluationScorer;
import vacademy.io.admin_core_service.features.learner_tracking.util.AutoEvaluationScorer.Verdict;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Numeric answers within a question's ± tolerance (accounting papers), on both grading
 * paths: the quiz attempt / check-answer path (evaluateForQuestionType) and the activity
 * log path (evaluate). Without a tolerance nothing may change.
 */
class AutoEvaluationScorerNumericToleranceTest {

    private final AutoEvaluationScorer scorer = new AutoEvaluationScorer(new ObjectMapper());

    private static String typed(String value) {
        return "{\"selectedOptions\":[{\"id\":\"" + value + "\",\"name\":\"" + value + "\"}]}";
    }

    /** Quiz slide key: tolerance beside correctAnswers. */
    private static String quizKey(String answers, String tolerance) {
        return "{\"correctAnswers\":" + answers + (tolerance == null ? "" : ",\"tolerance\":" + tolerance) + "}";
    }

    /** Question / video slide key: data.tolerance beside data.validAnswers. */
    private static String dataKey(String answers, String tolerance) {
        return "{\"type\":\"NUMERIC\",\"data\":{\"validAnswers\":" + answers
                + (tolerance == null ? "" : ",\"tolerance\":" + tolerance) + "}}";
    }

    private Verdict byType(String key, String given) {
        // Options present on purpose: a numeric key must never be read as option positions.
        return scorer.evaluateForQuestionType("NUMERIC", key, typed(given), () -> List.of("o1", "o2", "o3"));
    }

    private Verdict byLog(String key, String given) {
        return scorer.evaluate(key, typed(given), () -> List.of("o1", "o2", "o3"));
    }

    @Test
    @DisplayName("inside the tolerance is correct, outside is wrong")
    void withinAndOutside() {
        String key = quizKey("[1250]", "1");
        assertThat(byType(key, "1251")).isEqualTo(Verdict.CORRECT);
        assertThat(byType(key, "1249")).isEqualTo(Verdict.CORRECT);
        assertThat(byType(key, "1251.5")).isEqualTo(Verdict.WRONG);
        assertThat(byLog(key, "1251")).isEqualTo(Verdict.CORRECT);
        assertThat(byLog(key, "1251.5")).isEqualTo(Verdict.WRONG);
    }

    @Test
    @DisplayName("data.tolerance beside validAnswers")
    void dataShape() {
        String key = dataKey("[3.14]", "0.01");
        assertThat(byType(key, "3.15")).isEqualTo(Verdict.CORRECT);
        assertThat(byType(key, "3.151")).isEqualTo(Verdict.WRONG);
    }

    @Test
    @DisplayName("negative numbers and the exact boundary")
    void negativesAndBoundary() {
        String key = quizKey("[-500]", "2");
        assertThat(byType(key, "-502")).isEqualTo(Verdict.CORRECT);
        assertThat(byType(key, "-497.9")).isEqualTo(Verdict.WRONG);
        assertThat(byType(quizKey("[0.1]", "1"), "1.1")).isEqualTo(Verdict.CORRECT);
        assertThat(byLog(quizKey("[-500]", "2"), "-498")).isEqualTo(Verdict.CORRECT);
    }

    @Test
    @DisplayName("spaces and thousands separators are ignored when a tolerance applies")
    void commasAndSpaces() {
        String key = quizKey("[1250]", "1");
        assertThat(byType(key, "1,251")).isEqualTo(Verdict.CORRECT);
        assertThat(byType(key, " 1 250 ")).isEqualTo(Verdict.CORRECT);
        assertThat(byType(key, "abc")).isEqualTo(Verdict.WRONG);
    }

    @Test
    @DisplayName("an index-looking key is not resolved to options when a tolerance applies")
    void smallIntegersAreNumbersNotPositions() {
        String key = quizKey("[2]", "0.5");
        assertThat(byLog(key, "2.4")).isEqualTo(Verdict.CORRECT);
        assertThat(byLog(key, "o3")).isEqualTo(Verdict.WRONG);
    }

    @Test
    @DisplayName("no tolerance, 0 or negative: exactly as before")
    void missingToleranceIsExact() {
        for (String tolerance : new String[] {null, "0", "-1", "null"}) {
            String key = quizKey("[1250]", tolerance);
            assertThat(byType(key, "1250.0")).as("tolerance " + tolerance).isEqualTo(Verdict.CORRECT);
            assertThat(byType(key, "1251")).as("tolerance " + tolerance).isEqualTo(Verdict.WRONG);
            // The activity-log path compares the key as strings, as it always has...
            assertThat(scorer.evaluate(key, typed("1250"), List::of)).as("tolerance " + tolerance)
                    .isEqualTo(Verdict.CORRECT);
            assertThat(scorer.evaluate(key, typed("1251"), List::of)).as("tolerance " + tolerance)
                    .isEqualTo(Verdict.WRONG);
            // ...and, when the question has options, still reads a number key as a position
            // past the end of them: not gradable, the client's verdict stands.
            assertThat(byLog(key, "1250")).as("tolerance " + tolerance).isEqualTo(Verdict.UNKNOWN);
        }
        // Old rule untouched: a small-integer key on the log path is still read as option positions.
        assertThat(byLog(quizKey("[1]", null), "o2")).isEqualTo(Verdict.CORRECT);
    }

    @Test
    @DisplayName("an unanswered question is still skipped")
    void skipped() {
        String key = quizKey("[1250]", "1");
        assertThat(scorer.evaluateForQuestionType("NUMERIC", key, "{\"selectedOptions\":[]}", List::of))
                .isEqualTo(Verdict.SKIPPED);
        assertThat(scorer.evaluate(key, "{\"selectedOptions\":[]}", List::of)).isEqualTo(Verdict.SKIPPED);
    }
}
