package vacademy.io.assessment_service.features.assessment.service.marking_strategy;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.util.Pair;
import org.springframework.stereotype.Component;
import vacademy.io.assessment_service.features.assessment.dto.AssessmentQuestionPreviewDto;
import vacademy.io.assessment_service.features.assessment.dto.Questio_type_based_dtos.long_answer.LongAanswerCorrectAnswerDto;
import vacademy.io.assessment_service.features.assessment.dto.Questio_type_based_dtos.long_answer.LongAnswerMarkingDto;
import vacademy.io.assessment_service.features.assessment.dto.Questio_type_based_dtos.long_answer.LongAnswerResponseDto;
import vacademy.io.assessment_service.features.assessment.dto.survey_dto.OneWordLongSurveyDto;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.enums.QuestionResponseEnum;
import vacademy.io.assessment_service.features.assessment.service.IQuestionTypeBasedStrategy;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.learner_assessment.service.QuestionWiseMarksService;

import java.util.*;

@Slf4j
@Component
public class LongAnswerQuestionTypeBasedStrategy extends IQuestionTypeBasedStrategy {

    public static Pair<Double, String> calculateMarksViaMatching(String correctAnswer, String studentAnswer, double totalMarks, double negativeMarks) {
        // Convert answers to sets of words (ignore case & split by spaces)
        Set<String> correctWords = new HashSet<>(Arrays.asList(correctAnswer.toLowerCase().split("\\s+")));
        Set<String> studentWords = new HashSet<>(Arrays.asList(studentAnswer.toLowerCase().split("\\s+")));

        // Compute Jaccard Similarity
        Set<String> intersection = new HashSet<>(correctWords);
        intersection.retainAll(studentWords);

        Set<String> union = new HashSet<>(correctWords);
        union.addAll(studentWords);

        double similarity = (double) intersection.size() / union.size();
        // Determine marks based on similarity
        if (similarity >= 0.8) {

            return Pair.of(totalMarks, QuestionResponseEnum.CORRECT.name()); // Full marks for high similarity
        } else if (similarity >= 0.5) {
            return Pair.of(totalMarks*0.5, QuestionResponseEnum.CORRECT.name()); // 50% marks for moderate similarity
        } else {
            return Pair.of(-negativeMarks, QuestionResponseEnum.INCORRECT.name());
        }
    }

    @Override
    public double calculateMarks(String markingJsonStr, String correctAnswerJsonStr, String responseJson) {
        // Until a rule below says otherwise the answer is left for a person (or the AI) to
        // mark: 0 marks, PENDING ("Needs marking" on the submission page).
        setAnswerStatus(QuestionResponseEnum.PENDING.name());
        try {
            // Nothing to match against, or nothing answered: no keyword score. A question with
            // no model answer is normal (the teacher or the AI marks it), so this is quiet.
            if (isBlank(markingJsonStr) || isBlank(correctAnswerJsonStr) || isBlank(responseJson)) {
                return 0.0;
            }
            LongAnswerMarkingDto markingDto = (LongAnswerMarkingDto) validateAndGetMarkingData(markingJsonStr);
            LongAanswerCorrectAnswerDto correctAnswerDto = (LongAanswerCorrectAnswerDto) validateAndGetCorrectAnswerData(correctAnswerJsonStr);
            LongAnswerResponseDto responseDto = (LongAnswerResponseDto) validateAndGetResponseData(responseJson);

            String correctAnswer = modelAnswer(correctAnswerDto);
            if (correctAnswer == null || markingDto == null || markingDto.getData() == null
                    || responseDto == null || responseDto.getResponseData() == null
                    || responseDto.getResponseData().getAnswer() == null) {
                return 0.0;
            }

            // Extracting student response
            String attemptedAnswer = responseDto.getResponseData().getAnswer().toLowerCase();

            // Extract marking scheme details safely
            LongAnswerMarkingDto.DataFields markingData = markingDto.getData();
            double totalMarks = markingData.getTotalMark();
            double negativeMarks = markingData.getNegativeMark();

            // Not attempted (whitespace counts as blank): 0, PENDING, never a keyword score.
            if (attemptedAnswer.isBlank()) {
                return 0.0;
            }
            Pair<Double, String> marksStatusMap = calculateMarksViaMatching(attemptedAnswer, correctAnswer, totalMarks, negativeMarks);
            if (marksStatusMap == null) {
                return 0.0;
            }
            setAnswerStatus(marksStatusMap.getSecond());
            return marksStatusMap.getFirst();
        } catch (Exception e) {
            // Unreadable JSON: leave it for a person, and say which kind of data broke.
            setAnswerStatus(QuestionResponseEnum.PENDING.name());
            log.warn("Long answer not scored by keyword match: {}", e.getMessage());
            return 0.0;
        }
    }

    /** The model answer in lower case, or null when the question has none (no data, or blank). */
    static String modelAnswer(LongAanswerCorrectAnswerDto dto) {
        if (dto == null || dto.getData() == null || dto.getData().getAnswer() == null) return null;
        String content = dto.getData().getAnswer().getContent();
        return content == null || content.isBlank() ? null : content.toLowerCase();
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank() || "null".equals(s.trim());
    }

    @Override
    public Object validateAndGetMarkingData(String markingJson) throws JsonProcessingException {
        ObjectMapper objectMapper = new ObjectMapper();
        return objectMapper.readValue(markingJson, LongAnswerMarkingDto.class);
    }

    @Override
    public Object validateAndGetCorrectAnswerData(String correctAnswerJson) throws JsonProcessingException {
        ObjectMapper objectMapper = new ObjectMapper();
        return objectMapper.readValue(correctAnswerJson, LongAanswerCorrectAnswerDto.class);
    }

    @Override
    public Object validateAndGetResponseData(String responseJson) throws JsonProcessingException {
        ObjectMapper objectMapper = new ObjectMapper();
        return objectMapper.readValue(responseJson, LongAnswerResponseDto.class);
    }

    @Override
    public Object validateAndGetSurveyData(Assessment assessment, AssessmentQuestionPreviewDto assessmentQuestionPreviewDto, List<QuestionWiseMarks> allRespondentData) {
        setType(assessmentQuestionPreviewDto.getQuestion().getType());

        return OneWordLongSurveyDto.builder()
                .type(getType())
                .totalRespondent(allRespondentData.size())
                .order(assessmentQuestionPreviewDto.getQuestionOrder())
                .latestResponse(createLatestResponseForLongAnswer(allRespondentData)).build();
    }

    private List<OneWordLongSurveyDto.OneWordLongSurveyInfo> createLatestResponseForLongAnswer(List<QuestionWiseMarks> allRespondentData) {
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
