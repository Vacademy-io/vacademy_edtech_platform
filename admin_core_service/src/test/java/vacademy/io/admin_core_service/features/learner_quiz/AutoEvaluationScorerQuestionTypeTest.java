package vacademy.io.admin_core_service.features.learner_quiz;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import vacademy.io.admin_core_service.features.learner_tracking.util.AutoEvaluationScorer;
import vacademy.io.admin_core_service.features.learner_tracking.util.AutoEvaluationScorer.Verdict;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/** Verdicts the learner app showed, which grading on the server must keep. */
class AutoEvaluationScorerQuestionTypeTest {

    private final AutoEvaluationScorer scorer = new AutoEvaluationScorer(new ObjectMapper());

    private static String picked(String... ids) {
        StringBuilder out = new StringBuilder("{\"selectedOptions\":[");
        for (int i = 0; i < ids.length; i++) {
            out.append(i > 0 ? "," : "").append("{\"id\":\"").append(ids[i]).append("\",\"name\":\"x\"}");
        }
        return out.append("]}").toString();
    }

    private Verdict verdict(String type, String key, String response, String... optionIds) {
        return scorer.evaluateForQuestionType(type, key, response, () -> List.of(optionIds));
    }

    @Test
    @DisplayName("single select accepts any keyed option")
    void singleSelectAcceptsAnyKeyed() {
        String key = "{\"correctAnswers\":[\"a\",\"b\"]}";
        assertThat(verdict("MCQS", key, picked("b"))).isEqualTo(Verdict.CORRECT);
        assertThat(verdict("MCQS", key, picked("c"))).isEqualTo(Verdict.WRONG);
        assertThat(verdict("TRUE_FALSE", "{\"correctAnswers\":[\"t\"]}", picked("t"))).isEqualTo(Verdict.CORRECT);
    }

    @Test
    @DisplayName("multiple correct needs the whole key, in any order")
    void multiSelectNeedsWholeKey() {
        String key = "{\"correctAnswers\":[\"a\",\"b\"]}";
        assertThat(verdict("MCQM", key, picked("b", "a"))).isEqualTo(Verdict.CORRECT);
        assertThat(verdict("MCQM", key, picked("a"))).isEqualTo(Verdict.WRONG);
        assertThat(verdict("CMCQM", key, picked("a", "b", "c"))).isEqualTo(Verdict.WRONG);
    }

    @Test
    @DisplayName("positional keys resolve through the option list")
    void positionalKey() {
        assertThat(verdict("MCQS", "{\"correctAnswers\":[1]}", picked("o2"), "o1", "o2")).isEqualTo(Verdict.CORRECT);
        assertThat(verdict("MCQS", "{\"correctAnswers\":[1]}", picked("o1"), "o1", "o2")).isEqualTo(Verdict.WRONG);
        assertThat(verdict("MCQS", "{\"correctAnswers\":[7]}", picked("o1"), "o1", "o2"))
                .as("a position past the end is a key nobody can trust").isEqualTo(Verdict.UNKNOWN);
    }

    @ParameterizedTest
    @CsvSource({ "2.5,CORRECT", "2.50,CORRECT", "02.5,CORRECT", "2.51,WRONG", "abc,WRONG" })
    @DisplayName("numeric answers compare as numbers and ignore the option list")
    void numeric(String given, Verdict expected) {
        assertThat(verdict("NUMERIC", "{\"correctAnswers\":[2.5]}", picked(given), "o1", "o2")).isEqualTo(expected);
    }

    @Test
    void numericKeyIsNeverReadAsPositions() {
        assertThat(verdict("NUMERIC", "{\"correctAnswers\":[1]}", picked("1"), "o1", "o2")).isEqualTo(Verdict.CORRECT);
        assertThat(verdict("CNUMERIC", "{\"correctAnswers\":[1,2]}", picked("2"))).isEqualTo(Verdict.CORRECT);
    }

    @Test
    void numericValidAnswersShape() {
        String key = "{\"type\":\"NUMERIC\",\"data\":{\"validAnswers\":[4,8]}}";
        assertThat(verdict("NUMERIC", key, picked("8"))).isEqualTo(Verdict.CORRECT);
        assertThat(verdict("NUMERIC", key, picked("9"))).isEqualTo(Verdict.WRONG);
    }

    @Test
    @DisplayName("question and video slide key shapes are read")
    void slideKeyShapes() {
        assertThat(verdict("MCQS", "{\"type\":\"MCQS\",\"data\":{\"correctOptionIds\":[\"a\"]}}", picked("a")))
                .isEqualTo(Verdict.CORRECT);
        assertThat(verdict("MCQS", "{\"correctOptionId\":\"a\"}", picked("a"))).isEqualTo(Verdict.CORRECT);
        assertThat(verdict("MCQM", "{\"data\":{\"correctOptionIds\":[\"a\",\"b\"]}}", picked("a"))).isEqualTo(Verdict.WRONG);
    }

    @Test
    @DisplayName("free text is not graded, whatever its key says")
    void freeTextIsNotGraded() {
        assertThat(verdict("LONG_ANSWER", "{\"data\":{\"answer\":{\"content\":\"x\"}}}", picked("x"))).isEqualTo(Verdict.UNKNOWN);
        assertThat(verdict("ONE_WORD", "{\"data\":{\"answer\":\"x\"}}", picked("x"))).isEqualTo(Verdict.UNKNOWN);
        assertThat(verdict("LONG_ANSWER", "{\"correctAnswers\":[0]}", picked("x"))).isEqualTo(Verdict.UNKNOWN);
    }

    @Test
    void unansweredIsSkippedEvenWithoutAKey() {
        assertThat(verdict("MCQS", "{\"correctAnswers\":[\"a\"]}", "{\"selectedOptions\":[]}")).isEqualTo(Verdict.SKIPPED);
        assertThat(verdict("LONG_ANSWER", null, null)).isEqualTo(Verdict.SKIPPED);
    }

    @Test
    void noKeyMeansUnknownNotWrong() {
        assertThat(verdict("MCQS", "", picked("a"))).isEqualTo(Verdict.UNKNOWN);
        assertThat(verdict("MCQS", "not json", picked("a"))).isEqualTo(Verdict.UNKNOWN);
        assertThat(verdict("MCQS", "{\"correctAnswers\":[]}", picked("a"))).isEqualTo(Verdict.UNKNOWN);
    }

    @Test
    void modelAnswerText() {
        assertThat(scorer.modelAnswerText("{\"data\":{\"answer\":\"cell\"}}")).isEqualTo("cell");
        assertThat(scorer.modelAnswerText("{\"data\":{\"answer\":{\"content\":\"<p>x</p>\"}}}")).isEqualTo("<p>x</p>");
        assertThat(scorer.modelAnswerText("{\"correctAnswers\":[\"a\"]}")).isNull();
        assertThat(scorer.modelAnswerText(null)).isNull();
    }

    @Test
    void existingEvaluateKeepsItsExactSetRule() {
        assertThat(scorer.evaluate("{\"correctAnswers\":[\"a\",\"b\"]}", picked("a"))).isEqualTo(Verdict.WRONG);
    }
}
