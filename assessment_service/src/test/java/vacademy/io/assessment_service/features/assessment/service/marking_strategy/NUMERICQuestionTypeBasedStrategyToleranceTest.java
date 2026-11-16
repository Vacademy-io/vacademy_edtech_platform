package vacademy.io.assessment_service.features.assessment.service.marking_strategy;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.enums.QuestionResponseEnum;
import vacademy.io.assessment_service.features.question_core.dto.NumericalEvaluationDto;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * NUMERIC questions with an optional ± tolerance (accounting papers accept rounding).
 * Without a tolerance the rule must stay the exact match it always was.
 */
class NUMERICQuestionTypeBasedStrategyToleranceTest {

    private final NUMERICQuestionTypeBasedStrategy strategy = new NUMERICQuestionTypeBasedStrategy();

    /** 4 marks, 1 negative at 100%. */
    private static final String MARKING =
            "{\"type\":\"NUMERIC\",\"data\":{\"totalMark\":4,\"negativeMark\":1,\"negativeMarkingPercentage\":100}}";

    private static String key(String validAnswers, String tolerance) {
        return "{\"type\":\"NUMERIC\",\"data\":{\"validAnswers\":" + validAnswers
                + (tolerance == null ? "" : ",\"tolerance\":" + tolerance) + "}}";
    }

    private static String response(String value) {
        return "{\"responseData\":{\"type\":\"NUMERIC\",\"validAnswer\":" + value + "}}";
    }

    private double mark(String key, String answer) {
        return strategy.calculateMarks(MARKING, key, response(answer));
    }

    @Test
    void withinTolerance_isCorrect() {
        assertThat(mark(key("[1250]", "1"), "1251")).isEqualTo(4.0);
        assertThat(strategy.getAnswerStatus()).isEqualTo(QuestionResponseEnum.CORRECT.name());
        assertThat(mark(key("[1250]", "1"), "1249.5")).isEqualTo(4.0);
    }

    @Test
    void exactlyOnTheBoundary_isCorrect_evenWhereDoubleMathDrifts() {
        // 1.1 - 0.1 is 1.0000000000000002 as doubles; on the decimals it is exactly 1.
        assertThat(mark(key("[0.1]", "1"), "1.1")).isEqualTo(4.0);
        assertThat(mark(key("[100]", "0.5"), "99.5")).isEqualTo(4.0);
    }

    @Test
    void outsideTolerance_isIncorrect_withUnchangedNegativeMarking() {
        assertThat(mark(key("[1250]", "1"), "1251.01")).isEqualTo(-1.0);
        assertThat(strategy.getAnswerStatus()).isEqualTo(QuestionResponseEnum.INCORRECT.name());
        assertThat(mark(key("[1250]", "1"), "1248")).isEqualTo(-1.0);
    }

    @Test
    void negativeNumbers() {
        assertThat(mark(key("[-500]", "2"), "-502")).isEqualTo(4.0);
        assertThat(mark(key("[-500]", "2"), "-498")).isEqualTo(4.0);
        assertThat(mark(key("[-500]", "2"), "-497.9")).isEqualTo(-1.0);
        assertThat(mark(key("[-0.5]", "1"), "0.5")).isEqualTo(4.0);
    }

    @Test
    void decimalTolerance() {
        assertThat(mark(key("[3.14]", "0.01"), "3.15")).isEqualTo(4.0);
        assertThat(mark(key("[3.14]", "0.01"), "3.13")).isEqualTo(4.0);
        assertThat(mark(key("[3.14]", "0.01"), "3.151")).isEqualTo(-1.0);
    }

    @Test
    void anyOfSeveralValidAnswers() {
        assertThat(mark(key("[10, 20]", "1"), "20.5")).isEqualTo(4.0);
        assertThat(mark(key("[10, 20]", "1"), "15")).isEqualTo(-1.0);
    }

    @Test
    void missingTolerance_isExactMatchAsBefore() {
        assertThat(mark(key("[1250]", null), "1250")).isEqualTo(4.0);
        assertThat(mark(key("[1250]", null), "1250.0")).isEqualTo(4.0);
        assertThat(mark(key("[1250]", null), "1251")).isEqualTo(-1.0);
        assertThat(mark(key("[1250]", null), "1250.0001")).isEqualTo(-1.0);
    }

    @Test
    void zeroNullOrNegativeTolerance_isExactMatch() {
        assertThat(mark(key("[1250]", "0"), "1251")).isEqualTo(-1.0);
        assertThat(mark(key("[1250]", "null"), "1251")).isEqualTo(-1.0);
        assertThat(mark(key("[1250]", "-5"), "1251")).isEqualTo(-1.0);
        assertThat(mark(key("[1250]", "0"), "1250")).isEqualTo(4.0);
    }

    @Test
    void unanswered_staysPendingWithNoMarks() {
        assertThat(mark(key("[1250]", "1"), "null")).isEqualTo(0.0);
        assertThat(strategy.getAnswerStatus()).isEqualTo(QuestionResponseEnum.PENDING.name());
    }

    @Test
    void savingAQuestion_keepsTheTolerance_andOmitsItWhenUnset() throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        NumericalEvaluationDto withTolerance = mapper.readValue(key("[1250]", "1.5"), NumericalEvaluationDto.class);
        assertThat(withTolerance.getData().getTolerance()).isEqualTo(1.5);
        assertThat(mapper.writeValueAsString(withTolerance)).contains("\"tolerance\":1.5");

        NumericalEvaluationDto without = new NumericalEvaluationDto("NUMERIC",
                new NumericalEvaluationDto.NumericalData(List.of(1250.0)));
        assertThat(mapper.writeValueAsString(without))
                .isEqualTo("{\"type\":\"NUMERIC\",\"data\":{\"validAnswers\":[1250.0]}}");
    }

    @Test
    void normaliseTolerance_dropsMeaninglessValues() {
        assertThat(NumericAnswerMatcher.normaliseTolerance(null)).isNull();
        assertThat(NumericAnswerMatcher.normaliseTolerance(0.0)).isNull();
        assertThat(NumericAnswerMatcher.normaliseTolerance(-1.0)).isNull();
        assertThat(NumericAnswerMatcher.normaliseTolerance(Double.NaN)).isNull();
        assertThat(NumericAnswerMatcher.normaliseTolerance(Double.POSITIVE_INFINITY)).isNull();
        assertThat(NumericAnswerMatcher.normaliseTolerance(0.5)).isEqualTo(0.5);
    }
}
