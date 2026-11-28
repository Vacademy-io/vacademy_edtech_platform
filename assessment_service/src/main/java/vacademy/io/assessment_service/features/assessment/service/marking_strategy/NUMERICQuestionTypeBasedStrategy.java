package vacademy.io.assessment_service.features.assessment.service.marking_strategy;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import vacademy.io.assessment_service.features.assessment.dto.AssessmentQuestionPreviewDto;
import vacademy.io.assessment_service.features.assessment.dto.Questio_type_based_dtos.numeric.NUMERICCorrectAnswerDto;
import vacademy.io.assessment_service.features.assessment.dto.Questio_type_based_dtos.numeric.NUMERICMarkingDto;
import vacademy.io.assessment_service.features.assessment.dto.Questio_type_based_dtos.numeric.NUMERICResponseDto;
import vacademy.io.assessment_service.features.assessment.dto.survey_dto.NumberSurveyDto;
import vacademy.io.assessment_service.features.assessment.dto.survey_dto.OneWordLongSurveyDto;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.enums.QuestionResponseEnum;
import vacademy.io.assessment_service.features.assessment.service.IQuestionTypeBasedStrategy;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.learner_assessment.service.QuestionWiseMarksService;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Slf4j
@Component
public class NUMERICQuestionTypeBasedStrategy extends IQuestionTypeBasedStrategy {

    @Override
    public double calculateMarks(String markingJsonStr, String correctAnswerJsonStr, String responseJson) {
        try {
            NUMERICMarkingDto markingDto = (NUMERICMarkingDto) validateAndGetMarkingData(markingJsonStr);
            NUMERICCorrectAnswerDto correctAnswerDto = (NUMERICCorrectAnswerDto) validateAndGetCorrectAnswerData(correctAnswerJsonStr);
            NUMERICResponseDto responseDto = (NUMERICResponseDto) validateAndGetResponseData(responseJson);

            // Validate input objects and prevent NullPointerException
            if (correctAnswerDto == null || markingDto == null || responseDto == null) {
                setAnswerStatus(QuestionResponseEnum.PENDING.name());
                return 0.0;
            }

            // Extracting correct answer
            List<Double> validAnswers = correctAnswerDto.getData().getValidAnswers();

            // Extracting student's selected answer
            Double attemptedAnswer = responseDto.getResponseData().getValidAnswer();

            // Extract marking scheme details safely
            NUMERICMarkingDto.DataFields markingData = markingDto.getData();
            if (markingData == null) {
                setAnswerStatus(QuestionResponseEnum.PENDING.name());
                return 0.0;
            }

            double totalMarks = markingData.getTotalMark();
            double negativeMarks = markingData.getNegativeMark();
            int negativePercentage = markingData.getNegativeMarkingPercentage();

            // If no answer was attempted, return 0 marks
            if (attemptedAnswer == null) {
                setAnswerStatus(QuestionResponseEnum.PENDING.name());
                return 0.0;
            }

            // If the answer matches a valid answer (within the question's ± tolerance,
            // when it has one), award full marks
            if (NumericAnswerMatcher.matches(validAnswers, attemptedAnswer,
                    correctAnswerDto.getData().getTolerance())) {
                setAnswerStatus(QuestionResponseEnum.CORRECT.name());
                return totalMarks;
            }

            // If an incorrect answer was selected, apply negative marking
            setAnswerStatus(QuestionResponseEnum.INCORRECT.name());
            return -(negativeMarks * negativePercentage / 100.0);

        } catch (Exception e) {
            return 0.0;
        }
    }


    @Override
    public Object validateAndGetMarkingData(String markingJson) throws JsonProcessingException {
        ObjectMapper objectMapper = new ObjectMapper();
        return objectMapper.readValue(markingJson, NUMERICMarkingDto.class);
    }

    @Override
    public Object validateAndGetCorrectAnswerData(String correctAnswerJson) throws JsonProcessingException {
        ObjectMapper objectMapper = new ObjectMapper();
        return objectMapper.readValue(correctAnswerJson, NUMERICCorrectAnswerDto.class);
    }

    @Override
    public Object validateAndGetResponseData(String responseJson) throws JsonProcessingException {
        ObjectMapper objectMapper = new ObjectMapper();
        return objectMapper.readValue(responseJson, NUMERICResponseDto.class);
    }

    @Override
    public Object validateAndGetSurveyData(Assessment assessment, AssessmentQuestionPreviewDto assessmentQuestionPreviewDto,List<QuestionWiseMarks> allRespondentData) {
        setType(assessmentQuestionPreviewDto.getQuestion().getType());

        return NumberSurveyDto.builder()
                .type(getType())
                .totalRespondent(allRespondentData.size())
                .order(assessmentQuestionPreviewDto.getQuestionOrder())
                .numberSurveyInfoList(createNumberSurveyInfo(allRespondentData)).build();
    }

    private List<NumberSurveyDto.NumberSurveyInfo> createNumberSurveyInfo(List<QuestionWiseMarks> allRespondentData) {
        List<NumberSurveyDto.NumberSurveyInfo> response = new ArrayList<>();
        Map<Double, Integer> answerCountMapping = new HashMap<>();

        allRespondentData.forEach(questionWiseResponse -> {
            Double answer = extractValidAnswer(questionWiseResponse.getResponseJson());
            answerCountMapping.merge(answer, 1, Integer::sum);
        });

        // Convert map into NumberSurveyInfo list
        answerCountMapping.forEach((answer, count) -> {
            NumberSurveyDto.NumberSurveyInfo info = NumberSurveyDto.NumberSurveyInfo.builder()
                    .answer(String.valueOf(answer))   // convert Double -> String
                    .totalResponses(count)
                    .build();
            response.add(info);
        });

        return response;
    }

    public static double extractValidAnswer(String jsonString) {
        try {
            ObjectMapper objectMapper = new ObjectMapper();
            JsonNode rootNode = objectMapper.readTree(jsonString);

            // Navigate to responseData → validAnswer
            JsonNode validAnswerNode = rootNode.path("responseData").path("validAnswer");

            if (validAnswerNode.isMissingNode() || !validAnswerNode.isNumber()) {
                throw new IllegalArgumentException("validAnswer not found or not numeric");
            }

            return validAnswerNode.asDouble();
        } catch (Exception e) {
            log.error("Failed to parse Numeric JSON: "+e.getMessage());
        }
        return 0.0;
    }
}
