package vacademy.io.assessment_service.features.assessment.service.marking_strategy;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import vacademy.io.assessment_service.features.assessment.dto.AssessmentQuestionPreviewDto;
import vacademy.io.assessment_service.features.assessment.dto.Questio_type_based_dtos.one_word.OneWordCorrectAnswerDto;
import vacademy.io.assessment_service.features.assessment.dto.Questio_type_based_dtos.one_word.OneWordMarkingDto;
import vacademy.io.assessment_service.features.assessment.dto.Questio_type_based_dtos.one_word.OneWordResponseDto;
import vacademy.io.assessment_service.features.assessment.dto.survey_dto.OneWordLongSurveyDto;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.enums.QuestionResponseEnum;
import vacademy.io.assessment_service.features.assessment.service.IQuestionTypeBasedStrategy;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.learner_assessment.service.QuestionWiseMarksService;

import java.util.ArrayList;
import java.util.List;

@Slf4j
@Component
public class OneWordQuestionTypeBasedStrategy extends IQuestionTypeBasedStrategy {

    @Override
    public double calculateMarks(String markingJsonStr, String correctAnswerJsonStr, String responseJson) {
        try {
            OneWordMarkingDto markingDto = (OneWordMarkingDto) validateAndGetMarkingData(markingJsonStr);
            OneWordCorrectAnswerDto correctAnswerDto = (OneWordCorrectAnswerDto) validateAndGetCorrectAnswerData(correctAnswerJsonStr);
            OneWordResponseDto responseDto = (OneWordResponseDto) validateAndGetResponseData(responseJson);

            // Validate input objects and avoid NullPointerException
            if (correctAnswerDto == null || markingDto == null || responseDto == null) {
                setAnswerStatus(QuestionResponseEnum.PENDING.name());
                return 0.0;
            }
            if (responseDto.getResponseData().getAnswer() == null) {
                setAnswerStatus(QuestionResponseEnum.PENDING.name());
                return 0.0;
            }

            // Both sides are normalised the same way. Lower-casing alone left a
            // trailing space marking a correct answer WRONG and then applying negative
            // marking on top — a one-word box is exactly where stray whitespace comes
            // from. Internal runs are collapsed so "carbon  dioxide" matches
            // "carbon dioxide".
            String correctAnswer = normalize(correctAnswerDto.getData().getAnswer());

            String attemptedAnswer = normalize(responseDto.getResponseData().getAnswer());

            // Extract marking scheme details safely
            OneWordMarkingDto.DataFields markingData = markingDto.getData();
            if (markingData == null) {
                setAnswerStatus(QuestionResponseEnum.PENDING.name());
                return 0.0;
            }

            double totalMarks = markingData.getTotalMark();
            double negativeMarks = markingData.getNegativeMark();

            // If the student did not attempt the question, return 0 marks
            if (attemptedAnswer.isEmpty()) {
                setAnswerStatus(QuestionResponseEnum.PENDING.name());
                return 0.0;
            }

            // Check if the answer is completely correct
            if (attemptedAnswer.equals(correctAnswer)) {
                setAnswerStatus(QuestionResponseEnum.CORRECT.name());
                return totalMarks;
            }

            // If incorrect response, apply negative marking
            setAnswerStatus(QuestionResponseEnum.INCORRECT.name());
            return -(negativeMarks);

        } catch (Exception e) {
            log.error("Error Occurred: " + e.getMessage());
            return 0.0;
        }
    }


    /** Trim, collapse internal whitespace, lower-case. Null-safe. */
    private static String normalize(String answer) {
        if (answer == null) return "";
        return answer.trim().replaceAll("\\s+", " ").toLowerCase();
    }

    @Override
    public Object validateAndGetMarkingData(String markingJson) throws JsonProcessingException {
        ObjectMapper objectMapper = new ObjectMapper();
        return objectMapper.readValue(markingJson, OneWordMarkingDto.class);
    }

    @Override
    public Object validateAndGetCorrectAnswerData(String correctAnswerJson) throws JsonProcessingException {
        ObjectMapper objectMapper = new ObjectMapper();
        return objectMapper.readValue(correctAnswerJson, OneWordCorrectAnswerDto.class);
    }

    @Override
    public Object validateAndGetResponseData(String responseJson) throws JsonProcessingException {
        ObjectMapper objectMapper = new ObjectMapper();
        return objectMapper.readValue(responseJson, OneWordResponseDto.class);
    }

    @Override
    public Object validateAndGetSurveyData(Assessment assessment, AssessmentQuestionPreviewDto assessmentQuestionPreviewDto,List<QuestionWiseMarks> allRespondentData) {
        setType(assessmentQuestionPreviewDto.getQuestion().getType());

        return OneWordLongSurveyDto.builder()
                .type(getType())
                .totalRespondent(allRespondentData.size())
                .order(assessmentQuestionPreviewDto.getQuestionOrder())
                .latestResponse(createLatestResponseForOneWordAnswer(allRespondentData)).build();
    }

    private List<OneWordLongSurveyDto.OneWordLongSurveyInfo> createLatestResponseForOneWordAnswer(List<QuestionWiseMarks> allRespondentData ) {
        List<OneWordLongSurveyDto.OneWordLongSurveyInfo> response = new ArrayList<>();
        allRespondentData.forEach(questionWiseResponse->{
            response.add(OneWordLongSurveyDto.OneWordLongSurveyInfo.builder()
                    .answer(questionWiseResponse.getResponseJson())
                    .email(questionWiseResponse.getStudentAttempt().getRegistration().getUserEmail())
                    .name(questionWiseResponse.getStudentAttempt().getRegistration().getParticipantName()).build());
        });

        return response;
    }

}
