package vacademy.io.assessment_service.features.assessment.service.marking_strategy;

import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.enums.QuestionResponseEnum;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Marking rules for multiple-correct MCQs.
 *
 * The case that matters most here is the FIRST one. The full-credit check used to be
 * `attemptedOptionIds.equals(correctOptionIds)` -- List.equals, which is order-sensitive.
 * A learner who ticked exactly the right options but in a different order than the answer
 * key happened to be stored in missed full credit, fell through to the partial branch,
 * and (with partialMarking == 0) was then given FULL NEGATIVE MARKS for a completely
 * correct answer. These tests pin the set-comparison behaviour so it cannot regress.
 */
class MCQMQuestionTypeBasedStrategyTest {

    private final MCQMQuestionTypeBasedStrategy strategy = new MCQMQuestionTypeBasedStrategy();

    /** 4 marks, 1 negative, no partial credit. */
    private static final String MARKING_NO_PARTIAL =
            "{\"type\":\"MCQM\",\"data\":{\"totalMark\":4,\"negativeMark\":1,"
                    + "\"negativeMarkingPercentage\":100,\"partialMarking\":0,\"partialMarkingPercentage\":0}}";

    /** 4 marks, 1 negative, partial credit enabled at 100% of the pro-rata value. */
    private static final String MARKING_WITH_PARTIAL =
            "{\"type\":\"MCQM\",\"data\":{\"totalMark\":4,\"negativeMark\":1,"
                    + "\"negativeMarkingPercentage\":100,\"partialMarking\":1,\"partialMarkingPercentage\":100}}";

    private static final String CORRECT_A_B =
            "{\"type\":\"MCQM\",\"data\":{\"correctOptionIds\":[\"a\",\"b\"]}}";

    private String response(String... optionIds) {
        StringBuilder ids = new StringBuilder();
        for (int i = 0; i < optionIds.length; i++) {
            if (i > 0) ids.append(",");
            ids.append("\"").append(optionIds[i]).append("\"");
        }
        return "{\"responseData\":{\"type\":\"MCQM\",\"optionIds\":[" + ids + "]}}";
    }

    @Test
    void correctOptionsInADifferentOrder_stillAwardsFullMarks() {
        // The regression this whole test class exists for.
        double marks = strategy.calculateMarks(MARKING_NO_PARTIAL, CORRECT_A_B, response("b", "a"));

        assertThat(marks).isEqualTo(4.0);
        assertThat(strategy.getAnswerStatus()).isEqualTo(QuestionResponseEnum.CORRECT.name());
    }

    @Test
    void correctOptionsInKeyOrder_awardsFullMarks() {
        double marks = strategy.calculateMarks(MARKING_NO_PARTIAL, CORRECT_A_B, response("a", "b"));

        assertThat(marks).isEqualTo(4.0);
        assertThat(strategy.getAnswerStatus()).isEqualTo(QuestionResponseEnum.CORRECT.name());
    }

    @Test
    void duplicateSelectionOfTheSameCorrectOption_isStillFullMarks() {
        // Set comparison also makes the scorer robust to a client that repeats an id.
        double marks = strategy.calculateMarks(MARKING_NO_PARTIAL, CORRECT_A_B, response("b", "a", "b"));

        assertThat(marks).isEqualTo(4.0);
        assertThat(strategy.getAnswerStatus()).isEqualTo(QuestionResponseEnum.CORRECT.name());
    }

    @Test
    void unattempted_scoresZeroAndStaysPending() {
        double marks = strategy.calculateMarks(MARKING_NO_PARTIAL, CORRECT_A_B, response());

        assertThat(marks).isEqualTo(0.0);
        assertThat(strategy.getAnswerStatus()).isEqualTo(QuestionResponseEnum.PENDING.name());
    }

    @Test
    void wrongOptionSelected_appliesNegativeMarking() {
        double marks = strategy.calculateMarks(MARKING_NO_PARTIAL, CORRECT_A_B, response("a", "c"));

        assertThat(marks).isEqualTo(-1.0);
        assertThat(strategy.getAnswerStatus()).isEqualTo(QuestionResponseEnum.INCORRECT.name());
    }

    @Test
    void subsetOfCorrectOptions_withPartialEnabled_awardsProRata() {
        // 1 of 2 correct options, no wrong ones -> half of 4 marks.
        double marks = strategy.calculateMarks(MARKING_WITH_PARTIAL, CORRECT_A_B, response("a"));

        assertThat(marks).isEqualTo(2.0);
        assertThat(strategy.getAnswerStatus()).isEqualTo(QuestionResponseEnum.PARTIAL_CORRECT.name());
    }

    @Test
    void subsetOfCorrectOptions_withPartialDisabled_isPenalised() {
        // Documents existing behaviour rather than endorsing it: with partialMarking
        // off, a strict subset is treated as fully incorrect. Left unchanged.
        double marks = strategy.calculateMarks(MARKING_NO_PARTIAL, CORRECT_A_B, response("a"));

        assertThat(marks).isEqualTo(-1.0);
        assertThat(strategy.getAnswerStatus()).isEqualTo(QuestionResponseEnum.INCORRECT.name());
    }
}
