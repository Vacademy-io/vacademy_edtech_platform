package vacademy.io.assessment_service.features.assessment.service.marking_strategy;

import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.enums.QuestionResponseEnum;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Marking rules for one-word answers.
 *
 * Matching used to be `toLowerCase()` only. A one-word input box is exactly where stray
 * whitespace comes from, so a correct answer with a trailing space was marked WRONG and
 * then given negative marking on top. Both sides are now trimmed and their internal
 * whitespace collapsed.
 *
 * Every change here is one-directional: it can only turn a wrongly-INCORRECT answer into
 * CORRECT, never the reverse. The "genuinely wrong" cases below pin that.
 */
class OneWordQuestionTypeBasedStrategyTest {

    private final OneWordQuestionTypeBasedStrategy strategy = new OneWordQuestionTypeBasedStrategy();

    /** 2 marks, 0.5 negative. */
    private static final String MARKING =
            "{\"type\":\"ONE_WORD\",\"data\":{\"totalMark\":2,\"negativeMark\":0.5,"
                    + "\"negativeMarkingPercentage\":100}}";

    private static final String CORRECT_PHOTOSYNTHESIS =
            "{\"type\":\"ONE_WORD\",\"data\":{\"answer\":\"Photosynthesis\"}}";

    private static final String CORRECT_TWO_WORDS =
            "{\"type\":\"ONE_WORD\",\"data\":{\"answer\":\"carbon dioxide\"}}";

    private String response(String answer) {
        return "{\"responseData\":{\"type\":\"ONE_WORD\",\"answer\":\"" + answer + "\"}}";
    }

    @Test
    void exactMatch_awardsFullMarks() {
        double marks = strategy.calculateMarks(MARKING, CORRECT_PHOTOSYNTHESIS, response("Photosynthesis"));

        assertThat(marks).isEqualTo(2.0);
        assertThat(strategy.getAnswerStatus()).isEqualTo(QuestionResponseEnum.CORRECT.name());
    }

    @Test
    void differentCase_awardsFullMarks() {
        double marks = strategy.calculateMarks(MARKING, CORRECT_PHOTOSYNTHESIS, response("PHOTOSYNTHESIS"));

        assertThat(marks).isEqualTo(2.0);
        assertThat(strategy.getAnswerStatus()).isEqualTo(QuestionResponseEnum.CORRECT.name());
    }

    @Test
    void trailingAndLeadingWhitespace_awardsFullMarks() {
        // The regression this class exists for.
        double marks = strategy.calculateMarks(MARKING, CORRECT_PHOTOSYNTHESIS, response("  photosynthesis "));

        assertThat(marks).isEqualTo(2.0);
        assertThat(strategy.getAnswerStatus()).isEqualTo(QuestionResponseEnum.CORRECT.name());
    }

    @Test
    void collapsedInternalWhitespace_awardsFullMarks() {
        double marks = strategy.calculateMarks(MARKING, CORRECT_TWO_WORDS, response("carbon   dioxide"));

        assertThat(marks).isEqualTo(2.0);
        assertThat(strategy.getAnswerStatus()).isEqualTo(QuestionResponseEnum.CORRECT.name());
    }

    @Test
    void genuinelyWrongAnswer_stillAppliesNegativeMarking() {
        // Trimming must not make wrong answers pass.
        double marks = strategy.calculateMarks(MARKING, CORRECT_PHOTOSYNTHESIS, response("respiration"));

        assertThat(marks).isEqualTo(-0.5);
        assertThat(strategy.getAnswerStatus()).isEqualTo(QuestionResponseEnum.INCORRECT.name());
    }

    @Test
    void misspelledAnswer_stillIncorrect() {
        double marks = strategy.calculateMarks(MARKING, CORRECT_PHOTOSYNTHESIS, response("photosinthesis"));

        assertThat(marks).isEqualTo(-0.5);
        assertThat(strategy.getAnswerStatus()).isEqualTo(QuestionResponseEnum.INCORRECT.name());
    }

    @Test
    void blankAnswer_scoresZeroAndStaysPending() {
        // Whitespace-only is an unattempted question, not a wrong one -- it must not
        // attract negative marking.
        double marks = strategy.calculateMarks(MARKING, CORRECT_PHOTOSYNTHESIS, response("   "));

        assertThat(marks).isEqualTo(0.0);
        assertThat(strategy.getAnswerStatus()).isEqualTo(QuestionResponseEnum.PENDING.name());
    }
}
