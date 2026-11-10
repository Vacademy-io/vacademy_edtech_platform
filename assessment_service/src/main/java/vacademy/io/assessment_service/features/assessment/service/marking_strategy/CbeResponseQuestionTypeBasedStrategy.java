package vacademy.io.assessment_service.features.assessment.service.marking_strategy;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import vacademy.io.assessment_service.features.assessment.dto.AssessmentQuestionPreviewDto;
import vacademy.io.assessment_service.features.assessment.dto.Questio_type_based_dtos.cbe_response.CbeResponseCorrectAnswerDto;
import vacademy.io.assessment_service.features.assessment.dto.Questio_type_based_dtos.cbe_response.CbeResponseMarkingDto;
import vacademy.io.assessment_service.features.assessment.dto.Questio_type_based_dtos.cbe_response.CbeResponseResponseDto;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.enums.QuestionResponseEnum;
import vacademy.io.assessment_service.features.assessment.service.IQuestionTypeBasedStrategy;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;

import java.util.List;

/**
 * Spreadsheet & Written Response (CBE_RESPONSE): never auto-scored. Every answer is
 * 0 marks and PENDING ("awaiting evaluation") until the AI copy-check and the teacher
 * grade it (docs/CBE_RESPONSE_QUESTION.md §5.1).
 *
 * Never throws: StudentAttemptService zeroes the WHOLE attempt when one question's
 * strategy throws, so anything unexpected here also ends as 0 / PENDING.
 */
@Slf4j
public class CbeResponseQuestionTypeBasedStrategy extends IQuestionTypeBasedStrategy {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Override
    public double calculateMarks(String markingJsonStr, String correctAnswerJsonStr, String responseJson) {
        setAnswerStatus(QuestionResponseEnum.PENDING.name());
        return 0.0;
    }

    @Override
    public Object validateAndGetMarkingData(String markingJson) throws JsonProcessingException {
        return MAPPER.readValue(markingJson, CbeResponseMarkingDto.class);
    }

    @Override
    public Object validateAndGetCorrectAnswerData(String correctAnswerJson) throws JsonProcessingException {
        return MAPPER.readValue(correctAnswerJson, CbeResponseCorrectAnswerDto.class);
    }

    @Override
    public Object validateAndGetResponseData(String responseJson) throws JsonProcessingException {
        return MAPPER.readValue(responseJson, CbeResponseResponseDto.class);
    }

    @Override
    public Object validateAndGetSurveyData(Assessment assessment, AssessmentQuestionPreviewDto assessmentQuestionPreviewDto,
                                           List<QuestionWiseMarks> allRespondentData) {
        // CBE questions are not supported in surveys.
        return null;
    }
}
