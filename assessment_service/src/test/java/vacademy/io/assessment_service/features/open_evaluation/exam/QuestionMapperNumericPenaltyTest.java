package vacademy.io.assessment_service.features.open_evaluation.exam;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.service.marking_strategy.MCQSQuestionTypeBasedStrategy;
import vacademy.io.assessment_service.features.assessment.service.marking_strategy.NUMERICQuestionTypeBasedStrategy;

import java.math.BigDecimal;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * NUMERIC marking_json written by the partner API: the grader deducts
 * negativeMark * negativeMarkingPercentage / 100, so a penalty needs percentage 100.
 * It used to be written as 0, which dropped the penalty entirely.
 */
class QuestionMapperNumericPenaltyTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static final String KEY = "{\"type\":\"NUMERIC\",\"data\":{\"validAnswers\":[42.0]}}";

    private static String response(double value) {
        return "{\"questionId\":\"q1\",\"responseData\":{\"type\":\"NUMERIC\",\"validAnswer\":" + value + "}}";
    }

    private static int pct(String markingJson) throws Exception {
        JsonNode node = MAPPER.readTree(markingJson);
        return node.path("data").path("negativeMarkingPercentage").asInt(-1);
    }

    @Test
    void numeric_with_a_penalty_writes_100_and_a_wrong_answer_loses_the_full_penalty() throws Exception {
        String json = QuestionMapper.markingJson("NUMERIC", new BigDecimal("4"), new BigDecimal("1"));
        assertThat(pct(json)).isEqualTo(100);

        NUMERICQuestionTypeBasedStrategy grader = new NUMERICQuestionTypeBasedStrategy();
        assertThat(grader.calculateMarks(json, KEY, response(7))).isEqualTo(-1.0);
        assertThat(grader.calculateMarks(json, KEY, response(42))).isEqualTo(4.0);
    }

    @Test
    void numeric_without_a_penalty_writes_0() throws Exception {
        assertThat(pct(QuestionMapper.markingJson("NUMERIC", new BigDecimal("4"), BigDecimal.ZERO))).isZero();
        assertThat(pct(QuestionMapper.markingJson("NUMERIC", new BigDecimal("4"), null))).isZero();
        String json = QuestionMapper.markingJson("NUMERIC", new BigDecimal("4"), null);
        assertThat(new NUMERICQuestionTypeBasedStrategy().calculateMarks(json, KEY, response(7))).isEqualTo(-0.0);
    }

    @Test
    void other_types_keep_0_because_their_graders_ignore_the_percentage() throws Exception {
        String mcqs = QuestionMapper.markingJson("MCQS", new BigDecimal("4"), new BigDecimal("1"));
        assertThat(pct(mcqs)).isZero();
        String key = "{\"type\":\"MCQS\",\"data\":{\"correctOptionIds\":[\"o1\"]}}";
        String wrong = "{\"questionId\":\"q1\",\"responseData\":{\"type\":\"MCQS\",\"optionIds\":[\"o2\"]}}";
        assertThat(new MCQSQuestionTypeBasedStrategy().calculateMarks(mcqs, key, wrong)).isEqualTo(-1.0);
    }

    @Test
    void with_marks_sets_100_when_a_numeric_penalty_is_written_and_keeps_old_values_otherwise() throws Exception {
        // An older mapping written with the ratio (25 = 1/4) and no penalty change: untouched.
        String legacy = "{\"type\":\"NUMERIC\",\"data\":{\"totalMark\":4,\"negativeMark\":1,\"negativeMarkingPercentage\":25}}";
        assertThat(pct(QuestionMapper.withMarks(legacy, "NUMERIC", new BigDecimal("5"), null))).isEqualTo(25);

        // The penalty is (re)written: percentage follows it.
        assertThat(pct(QuestionMapper.withMarks(legacy, "NUMERIC", null, new BigDecimal("2")))).isEqualTo(100);
        assertThat(pct(QuestionMapper.withMarks(legacy, "NUMERIC", null, BigDecimal.ZERO))).isZero();

        // No percentage stored yet: derived from the stored penalty.
        String bare = "{\"type\":\"NUMERIC\",\"data\":{\"totalMark\":4,\"negativeMark\":1}}";
        assertThat(pct(QuestionMapper.withMarks(bare, "NUMERIC", new BigDecimal("4"), null))).isEqualTo(100);
    }
}
