package vacademy.io.assessment_service.features.assessment.service.marking_strategy;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import vacademy.io.assessment_service.features.assessment.dto.AssessmentQuestionPreviewDto;
import vacademy.io.assessment_service.features.assessment.dto.Questio_type_based_dtos.mcqm.MCQMCorrectAnswerDto;
import vacademy.io.assessment_service.features.assessment.dto.Questio_type_based_dtos.mcqm.MCQMMarkingDto;
import vacademy.io.assessment_service.features.assessment.dto.Questio_type_based_dtos.mcqm.MCQMResponseDto;
import vacademy.io.assessment_service.features.assessment.dto.survey_dto.MCQSurveyDto;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.enums.QuestionResponseEnum;
import vacademy.io.assessment_service.features.assessment.service.IQuestionTypeBasedStrategy;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.learner_assessment.service.QuestionWiseMarksService;

import java.util.*;

@Slf4j
@Component
public class MCQMQuestionTypeBasedStrategy extends IQuestionTypeBasedStrategy {

    @Override
    public double calculateMarks(String markingJsonStr, String correctAnswerJsonStr, String responseJson) {
        try {
            MCQMMarkingDto markingDto = (MCQMMarkingDto) validateAndGetMarkingData(markingJsonStr);
            MCQMCorrectAnswerDto correctAnswerDto = (MCQMCorrectAnswerDto) validateAndGetCorrectAnswerData(correctAnswerJsonStr);
            MCQMResponseDto responseDto = (MCQMResponseDto) validateAndGetResponseData(responseJson);

            // Validate input objects and avoid NullPointerException
            if (correctAnswerDto == null || markingDto == null || responseDto == null) {
                setAnswerStatus(QuestionResponseEnum.PENDING.name());
                return 0.0;
            }

            // Extracting correct option IDs
            List<String> correctOptionIds = Optional.ofNullable(correctAnswerDto.getData())
                    .map(MCQMCorrectAnswerDto.DataFields::getCorrectOptionIds)
                    .orElse(List.of());

            // Extracting student response
            List<String> attemptedOptionIds = Optional.ofNullable(responseDto.getResponseData())
                    .map(MCQMResponseDto.ResponseData::getOptionIds)
                    .orElse(List.of());

            // Extract marking scheme details safely
            MCQMMarkingDto.DataFields markingData = markingDto.getData();
            if (markingData == null) {
                setAnswerStatus(QuestionResponseEnum.PENDING.name());
                return 0.0;
            }

            double totalMarks = markingData.getTotalMark();
            double negativeMarks = markingData.getNegativeMark();
            double negativePercentage = markingData.getNegativeMarkingPercentage();
            double partialMarking = markingData.getPartialMarking();
            double partialMarkingPercentage = markingData.getPartialMarkingPercentage();

            // If the student did not attempt the question, return 0 marks
            if (attemptedOptionIds.isEmpty()) {
                setAnswerStatus(QuestionResponseEnum.PENDING.name());
                return 0.0;
            }

            // Check if the answer is completely correct.
            //
            // Compared as SETS, not lists. List.equals is order-sensitive, so a learner
            // who ticked the same options in a different order than the answer key was
            // stored in missed full credit and fell through to the branches below —
            // which, with partialMarking == 0, awarded FULL NEGATIVE MARKS for a fully
            // correct answer. Option order carries no meaning here.
            if (new HashSet<>(attemptedOptionIds).equals(new HashSet<>(correctOptionIds))) {
                setAnswerStatus(QuestionResponseEnum.CORRECT.name());
                return totalMarks;
            }

            // Partial marking scenario
            long correctSelected = attemptedOptionIds.stream().filter(correctOptionIds::contains).count();
            long incorrectSelected = attemptedOptionIds.size() - correctSelected;
            long totalCorrectOptions = correctOptionIds.size();

            if (partialMarking != 0 && correctSelected > 0 && incorrectSelected == 0) {
                double partialMarks = (totalMarks / totalCorrectOptions) * correctSelected;
                double finalMarks = (partialMarks * partialMarkingPercentage) / 100;
                setAnswerStatus(QuestionResponseEnum.PARTIAL_CORRECT.name());
                return finalMarks;
            }

            // If incorrect response, apply negative marking
            setAnswerStatus(QuestionResponseEnum.INCORRECT.name());
            return -1*(negativeMarks);

        } catch (Exception e) {
            log.error("Error Occurred: " + e.getMessage());
            return 0.0;
        }
    }


    @Override
    public Object validateAndGetMarkingData(String markingJson) throws JsonProcessingException {
        ObjectMapper objectMapper = new ObjectMapper();
        return objectMapper.readValue(markingJson, MCQMMarkingDto.class);
    }

    @Override
    public Object validateAndGetCorrectAnswerData(String correctAnswerJson) throws JsonProcessingException {
        ObjectMapper objectMapper = new ObjectMapper();
        return objectMapper.readValue(correctAnswerJson, MCQMCorrectAnswerDto.class);
    }

    @Override
    public Object validateAndGetResponseData(String responseJson) throws JsonProcessingException {
        ObjectMapper objectMapper = new ObjectMapper();
        return objectMapper.readValue(responseJson, MCQMResponseDto.class);
    }

    @Override
    public Object validateAndGetSurveyData(Assessment assessment, AssessmentQuestionPreviewDto assessmentQuestionPreviewDto,List<QuestionWiseMarks> allRespondentData) {
        setType(assessmentQuestionPreviewDto.getQuestion().getType());

        return MCQSurveyDto.builder()
                .type(getType())
                .totalRespondent(allRespondentData.size())
                .order(assessmentQuestionPreviewDto.getQuestionOrder())
                .mcqSurveyInfoList(createMCQMSurveyInfo(allRespondentData)).build();
    }

    private List<MCQSurveyDto.MCQSurveyInfo> createMCQMSurveyInfo(
            List<QuestionWiseMarks> allRespondentData) {

        List<MCQSurveyDto.MCQSurveyInfo> response = new ArrayList<>();
        Map<String, Integer> answerCountMapping = new HashMap<>();

        allRespondentData.forEach(questionWiseResponse -> {
            List<String> answers = extractValidAnswersForMCQM(questionWiseResponse.getResponseJson());
            if (answers.isEmpty()) {
                // if no answer, mark as NO_ANSWER
                answerCountMapping.merge("NO_ANSWER", 1, Integer::sum);
            } else {
                answers.forEach(optionId ->
                        answerCountMapping.merge(optionId, 1, Integer::sum)
                );
            }
        });

        // Convert map into MCQSurveyInfo list
        answerCountMapping.forEach((answer, count) -> {
            double percentage = (count * 100.0) / allRespondentData.size();
            MCQSurveyDto.MCQSurveyInfo info = MCQSurveyDto.MCQSurveyInfo.builder()
                    .option(answer)
                    .percentage(percentage)
                    .respondentCount(count)
                    .build();
            response.add(info);
        });

        return response;
    }

    private List<String> extractValidAnswersForMCQM(String responseJson) {
        List<String> optionIds = new ArrayList<>();
        try {
            ObjectMapper mapper = new ObjectMapper();
            JsonNode root = mapper.readTree(responseJson);

            JsonNode optionIdsNode = root.path("responseData").path("optionIds");

            if (optionIdsNode.isArray()) {
                optionIdsNode.forEach(node -> optionIds.add(node.asText()));
            }
        } catch (Exception e) {
            e.printStackTrace(); // log error
        }
        return optionIds;
    }

}
