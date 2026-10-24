package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.assessment_service.features.assessment.entity.AiQuestionEvaluation;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.QuestionAssessmentSectionMappingRepository;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository;
import vacademy.io.assessment_service.features.question_core.entity.Question;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * AI evaluation of an ONLINE attempt: the learner typed an essay, letter or
 * email in the test player instead of uploading an answer sheet.
 *
 * The copy-check pipeline grades an uploaded PDF and every question on it. An
 * online attempt has no PDF, and its objective questions were already scored
 * exactly on submit, so only the written answers go to the AI (as text, see
 * ai_service copy_check/typed_answers.py) and the attempt total is those AI
 * marks plus the auto-scored marks of everything else.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class TypedAnswerEvaluation {

    /** Question types the AI grades on an online attempt. */
    public static final List<String> AI_GRADED_TYPES = List.of("LONG_ANSWER");

    private final EvaluationUtilityService evaluationUtilityService;
    private final QuestionAssessmentSectionMappingRepository questionMappingRepository;
    private final QuestionWiseMarksRepository questionWiseMarksRepository;
    private final ObjectMapper objectMapper;

    /** Internal choice ("any 4 of 5"); null in unit tests that do not need it. */
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private DashboardChoiceGroups choiceGroups;

    public boolean hasAnswerSheet(StudentAttempt attempt) {
        if (attempt == null || attempt.getAttemptData() == null) return false;
        String fileId = evaluationUtilityService.extractFileId(attempt.getAttemptData());
        return fileId != null && !fileId.isBlank();
    }

    /**
     * An online attempt: typed in the player, no uploaded sheet. A MANUAL-evaluation
     * assessment is the PDF-upload player - an attempt there without a file is a
     * missing copy, not typed answers, and keeps its old handling.
     */
    public boolean isTypedAttempt(StudentAttempt attempt, Assessment assessment) {
        return assessment != null
                && !"MANUAL".equalsIgnoreCase(assessment.getEvaluationType())
                && !hasAnswerSheet(attempt);
    }

    public static boolean isAiGraded(Question question) {
        return question != null && question.getQuestionType() != null
                && AI_GRADED_TYPES.contains(question.getQuestionType().toUpperCase());
    }

    /**
     * An online attempt the AI will grade: the assessment opted in, nothing was
     * uploaded, and the paper has a written question. Such an attempt is held
     * for the teacher like a checked copy - its written answers carry only the
     * word-overlap score until the AI (and then the teacher) has read them.
     */
    public boolean awaitsAiGrading(StudentAttempt attempt, Assessment assessment) {
        if (attempt == null || assessment == null) return false;
        if (!Boolean.TRUE.equals(assessment.getAiEvaluationEnabled())) return false;
        if (!isTypedAttempt(attempt, assessment)) return false;
        try {
            return questionMappingRepository.existsQuestionOfTypesInAssessment(assessment.getId(), AI_GRADED_TYPES);
        } catch (Exception e) {
            log.warn("[AI-EVAL-TYPED] could not check written questions for assessment {}: {}",
                    assessment.getId(), e.getMessage());
            return false;
        }
    }

    /** The text the learner typed, from question_wise_marks.response_json ({responseData: {answer}}). */
    public String typedAnswer(QuestionWiseMarks marks) {
        if (marks == null || marks.getResponseJson() == null || marks.getResponseJson().isBlank()) return null;
        try {
            JsonNode answer = objectMapper.readTree(marks.getResponseJson()).path("responseData").path("answer");
            return answer.isValueNode() && !answer.isNull() ? answer.asText() : null;
        } catch (Exception e) {
            log.warn("[AI-EVAL-TYPED] unreadable response_json on question_wise_marks {}: {}",
                    marks.getId(), e.getMessage());
            return null;
        }
    }

    /**
     * The attempt total after an AI run: the AI's graded verdicts - exactly as before
     * for an uploaded copy. For an online attempt the run covers only the written
     * answers, so the stored marks of every other question (scored on submit) are
     * added. Questions the AI could not grade count for nothing until a teacher
     * grades them.
     */
    public double attemptTotal(StudentAttempt attempt, List<AiQuestionEvaluation> processRows) {
        double total = 0.0;
        Set<String> coveredByRun = new HashSet<>();
        // Internal choice: the extra answers in an "any N of M" group are graded but
        // not counted. Empty for an assessment without groups - the total as before.
        Set<String> notCounted = notCounted(attempt, processRows);
        for (AiQuestionEvaluation row : processRows) {
            if (row.getQuestion() != null) {
                coveredByRun.add(row.getQuestion().getId());
                if (notCounted.contains(row.getQuestion().getId())) continue;
            }
            if ("COMPLETED".equals(row.getStatus()) && row.getMarksAwarded() != null) {
                total += row.getMarksAwarded().doubleValue();
            }
        }
        if (attempt == null || attempt.getId() == null) return total;
        Assessment assessment = attempt.getRegistration() != null ? attempt.getRegistration().getAssessment() : null;
        if (!isTypedAttempt(attempt, assessment)) return total;
        for (QuestionWiseMarks marks : questionWiseMarksRepository.findByStudentAttemptId(attempt.getId())) {
            if (marks.getQuestion() != null && !coveredByRun.contains(marks.getQuestion().getId())) {
                total += marks.getMarks();
            }
        }
        return total;
    }

    private Set<String> notCounted(StudentAttempt attempt, List<AiQuestionEvaluation> rows) {
        if (choiceGroups == null || attempt == null || attempt.getRegistration() == null
                || attempt.getRegistration().getAssessment() == null) {
            return Set.of();
        }
        return choiceGroups.notCounted(attempt.getRegistration().getAssessment().getId(), rows);
    }
}
