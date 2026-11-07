package vacademy.io.assessment_service.features.assessment.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import vacademy.io.assessment_service.features.assessment.dto.AssessmentQuestionPreviewDto;
import vacademy.io.assessment_service.features.assessment.dto.Questio_type_based_dtos.mcqm.MCQMCorrectAnswerDto;
import vacademy.io.assessment_service.features.assessment.dto.Questio_type_based_dtos.mcqm.MCQMResponseDto;
import vacademy.io.assessment_service.features.assessment.dto.Questio_type_based_dtos.mcqs.MCQSCorrectAnswerDto;
import vacademy.io.assessment_service.features.assessment.dto.Questio_type_based_dtos.mcqs.MCQSResponseDto;
import vacademy.io.assessment_service.features.assessment.dto.QuestionWiseBasicDetailDto;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.enums.QuestionResponseEnum;
import vacademy.io.assessment_service.features.assessment.service.marking_strategy.*;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.question_core.enums.QuestionTypes;

import java.util.*;
import java.util.function.Supplier;

public class QuestionBasedStrategyFactory {

    /**
     * Suppliers, NOT instances.
     * <p>
     * {@link IQuestionTypeBasedStrategy} carries mutable {@code type} and
     * {@code answerStatus} fields, and {@code calculateMarks} below reads
     * {@code getAnswerStatus()} AFTER the marks call returns. When this map held one
     * shared instance per type, two learners graded concurrently on the @Async pool
     * mutated the same object between those two statements — so learner A's question
     * could be persisted with learner B's CORRECT/INCORRECT status. Silent, and it
     * corrupted question_wise_marks, reports and every status-based revaluation.
     * <p>
     * Handing out a fresh instance per call confines that state to one thread. The
     * marks arithmetic is untouched.
     */
    private static final Map<String, Supplier<IQuestionTypeBasedStrategy>> strategies = new HashMap<>();

    static {
        strategies.put(QuestionTypes.MCQM.name(), MCQMQuestionTypeBasedStrategy::new);
        strategies.put(QuestionTypes.MCQS.name(), MCQSQuestionTypeBasedStrategy::new);
        strategies.put(QuestionTypes.ONE_WORD.name(), OneWordQuestionTypeBasedStrategy::new);
        strategies.put(QuestionTypes.LONG_ANSWER.name(), LongAnswerQuestionTypeBasedStrategy::new);
        strategies.put(QuestionTypes.NUMERIC.name(), NUMERICQuestionTypeBasedStrategy::new);
        strategies.put(QuestionTypes.TRUE_FALSE.name(), MCQSQuestionTypeBasedStrategy::new);
        strategies.put(QuestionTypes.CODING.name(), CodingQuestionTypeBasedStrategy::new);
        // Add more strategies here
    }

    private static IQuestionTypeBasedStrategy getStrategy(String questionType) {
        Supplier<IQuestionTypeBasedStrategy> supplier = strategies.getOrDefault(questionType, null);
        if (Objects.isNull(supplier)) {
            return null;
        }
        IQuestionTypeBasedStrategy strategy = supplier.get();
        strategy.setType(questionType);
        strategy.setAnswerStatus(QuestionResponseEnum.PENDING.name());
        return strategy;
    }

    /**
     * Same lookup, but never null — the callers below dereference the strategy
     * immediately and previously NPE'd on an unrecognised question type.
     */
    private static IQuestionTypeBasedStrategy requireStrategy(String questionType) {
        IQuestionTypeBasedStrategy strategy = getStrategy(questionType);
        if (strategy == null) {
            throw new IllegalArgumentException("Invalid Question Type: " + questionType);
        }
        return strategy;
    }

    public static Object verifyMarkingJson(String markingJson, String type) throws JsonProcessingException {
        IQuestionTypeBasedStrategy strategy = getStrategy(type);
        if (strategy == null) {
            throw new IllegalArgumentException("Invalid Question Type: " + type);
        }
        return strategy.validateAndGetMarkingData(markingJson);
    }

    public static Object verifyCorrectAnswerJson(String correctAnswerJson, String type) throws JsonProcessingException {
        IQuestionTypeBasedStrategy strategy = getStrategy(type);
        if (strategy == null) {
            throw new IllegalArgumentException("Invalid Question Type: " + type);
        }
        return strategy.validateAndGetCorrectAnswerData(correctAnswerJson);
    }

    public static Object verifyResponseJson(String responseJson, String type) throws JsonProcessingException {
        IQuestionTypeBasedStrategy strategy = getStrategy(type);
        if (strategy == null) {
            throw new IllegalArgumentException("Invalid Question Type: " + type);
        }
        return strategy.validateAndGetResponseData(responseJson);
    }

    public static QuestionWiseBasicDetailDto calculateMarks(String markingJson, String correctAnswerJson, String responseJson, String type) {
        IQuestionTypeBasedStrategy strategy = getStrategy(type);
        if (strategy == null) {
            throw new IllegalArgumentException("Invalid Question Type: " + type);
        }
        double marks =  strategy.calculateMarks(markingJson, correctAnswerJson, responseJson);
        String answerStatus = strategy.getAnswerStatus();

        return QuestionWiseBasicDetailDto.builder().marks(marks)
                .answerStatus(answerStatus).build();
    }

    public static List<String> getResponseOptionIds(String responseJson, String type) throws JsonProcessingException {
        IQuestionTypeBasedStrategy strategy = requireStrategy(type);
        if(strategy.getType().equals(QuestionTypes.MCQS.name())){
            MCQSResponseDto responseDto = (MCQSResponseDto) verifyResponseJson(responseJson, type);

            return responseDto.getResponseData().getOptionIds();
        }

        if (strategy.getType().equals(QuestionTypes.MCQM.name())) {
            MCQMResponseDto responseDto = (MCQMResponseDto) verifyResponseJson(responseJson, type);

            return responseDto.getResponseData().getOptionIds();
        }

        return new ArrayList<>();
    }

    public static List<String> getCorrectOptionIds(String evaluationJson, String type) throws JsonProcessingException {
        IQuestionTypeBasedStrategy strategy = requireStrategy(type);
        if(strategy.getType().equals(QuestionTypes.MCQS.name()) || strategy.getType().equals(QuestionTypes.TRUE_FALSE.name())){
            MCQSCorrectAnswerDto optionDto = (MCQSCorrectAnswerDto) verifyCorrectAnswerJson(evaluationJson, type);

            return optionDto.getData().getCorrectOptionIds();
        }

        if (strategy.getType().equals(QuestionTypes.MCQM.name())) {
            MCQMCorrectAnswerDto optionDto = (MCQMCorrectAnswerDto) verifyCorrectAnswerJson(evaluationJson, type);

            return optionDto.getData().getCorrectOptionIds();
        }

        return new ArrayList<>();
    }

    public static Object getCorrectAnswerFromAutoEvaluationBasedOnQuestionType(String autoEvaluationJson) throws Exception{
        String type = getQuestionTypeFromEvaluationJson(autoEvaluationJson);
        IQuestionTypeBasedStrategy strategy = requireStrategy(type);
        return strategy.validateAndGetCorrectAnswerData(autoEvaluationJson);
    }

    public static String getQuestionTypeFromEvaluationJson(String jsonString) throws Exception{
        ObjectMapper mapper = new ObjectMapper();
        JsonNode root = mapper.readTree(jsonString);
        return root.get("type").asText();
    }

    public static Object getSurveyDetailBasedOnType(Assessment assessment, AssessmentQuestionPreviewDto assessmentQuestionPreviewDto, List<QuestionWiseMarks> allRespondentData){
        String type = assessmentQuestionPreviewDto.getQuestionType();
        IQuestionTypeBasedStrategy strategy = requireStrategy(type);
        return strategy.validateAndGetSurveyData(assessment,assessmentQuestionPreviewDto,allRespondentData);
    }
}
