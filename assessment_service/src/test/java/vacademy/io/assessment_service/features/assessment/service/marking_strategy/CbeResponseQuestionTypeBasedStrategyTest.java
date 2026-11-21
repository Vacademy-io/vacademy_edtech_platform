package vacademy.io.assessment_service.features.assessment.service.marking_strategy;

import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.dto.QuestionWiseBasicDetailDto;
import vacademy.io.assessment_service.features.assessment.dto.Questio_type_based_dtos.cbe_response.CbeResponseCorrectAnswerDto;
import vacademy.io.assessment_service.features.assessment.dto.Questio_type_based_dtos.cbe_response.CbeResponseResponseDto;
import vacademy.io.assessment_service.features.assessment.enums.QuestionResponseEnum;
import vacademy.io.assessment_service.features.assessment.service.QuestionBasedStrategyFactory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

/**
 * CBE_RESPONSE is never auto-scored: 0 / PENDING for every answer, and it must never
 * throw (a throw in one question's strategy zeroes the whole attempt).
 */
class CbeResponseQuestionTypeBasedStrategyTest {

    static final String MARKING = "{\"type\":\"CBE_RESPONSE\",\"data\":{\"totalMark\":20,\"negativeMark\":0}}";
    static final String CONFIG = "{\"type\":\"CBE_RESPONSE\",\"data\":{\"version\":1,\"parts\":[{\"id\":\"p1\",\"label\":\"(a)\","
            + "\"kind\":\"SPREADSHEET\",\"marks\":16,\"template\":null,\"solution\":{\"sheet\":{\"sheets\":[]}},"
            + "\"markingScheme\":[{\"id\":\"m1\",\"label\":\"Goodwill\",\"marks\":2}],\"solutionFileId\":\"f1\"}],"
            + "\"gradingNotes\":\"own figure\"}}";
    static final String ANSWER = "{\"questionId\":\"q1\",\"responseData\":{\"type\":\"CBE_RESPONSE\",\"answer\":{\"parts\":{"
            + "\"p1\":{\"kind\":\"SPREADSHEET\",\"sheet\":{\"sheets\":[{\"name\":\"Sheet1\",\"cells\":{\"B7\":{\"v\":3200,\"f\":\"=B1-B2\"}}}]}}}}}}";

    @Test
    void anAnsweredQuestionIsZeroAndPending() {
        CbeResponseQuestionTypeBasedStrategy strategy = new CbeResponseQuestionTypeBasedStrategy();
        assertThat(strategy.calculateMarks(MARKING, CONFIG, ANSWER)).isZero();
        assertThat(strategy.getAnswerStatus()).isEqualTo(QuestionResponseEnum.PENDING.name());
    }

    @Test
    void badOrMissingJsonIsZeroAndPendingNeverAThrow() {
        CbeResponseQuestionTypeBasedStrategy strategy = new CbeResponseQuestionTypeBasedStrategy();
        assertThatCode(() -> {
            assertThat(strategy.calculateMarks(null, null, null)).isZero();
            assertThat(strategy.calculateMarks("not json", "{", "]")).isZero();
            assertThat(strategy.calculateMarks("", "", "{}")).isZero();
        }).doesNotThrowAnyException();
        assertThat(strategy.getAnswerStatus()).isEqualTo(QuestionResponseEnum.PENDING.name());
    }

    @Test
    void theFactoryGradesCbeAsZeroPending() {
        QuestionWiseBasicDetailDto result = QuestionBasedStrategyFactory.calculateMarks(MARKING, CONFIG, ANSWER, "CBE_RESPONSE");
        assertThat(result.getMarks()).isZero();
        assertThat(result.getAnswerStatus()).isEqualTo("PENDING");

        QuestionWiseBasicDetailDto garbage = QuestionBasedStrategyFactory.calculateMarks("x", "y", "z", "CBE_RESPONSE");
        assertThat(garbage.getMarks()).isZero();
        assertThat(garbage.getAnswerStatus()).isEqualTo("PENDING");
    }

    @Test
    void theDtosReadTheContractShapes() throws Exception {
        CbeResponseQuestionTypeBasedStrategy strategy = new CbeResponseQuestionTypeBasedStrategy();
        CbeResponseCorrectAnswerDto config = (CbeResponseCorrectAnswerDto) strategy.validateAndGetCorrectAnswerData(CONFIG);
        assertThat(config.getData().getParts()).hasSize(1);
        assertThat(config.getData().getParts().get(0).getMarks()).isEqualTo(16.0);
        assertThat(config.getData().getGradingNotes()).isEqualTo("own figure");
        CbeResponseResponseDto response = (CbeResponseResponseDto) strategy.validateAndGetResponseData(ANSWER);
        assertThat(response.getResponseData().getAnswer().path("parts").has("p1")).isTrue();
    }
}
