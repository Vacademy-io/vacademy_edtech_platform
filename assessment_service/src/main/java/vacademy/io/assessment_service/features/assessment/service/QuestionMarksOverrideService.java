package vacademy.io.assessment_service.features.assessment.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.assessment_service.features.assessment.entity.AiEvaluationProcess;
import vacademy.io.assessment_service.features.assessment.entity.AiQuestionEvaluation;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.EvaluationLogs;
import vacademy.io.assessment_service.features.assessment.entity.QuestionAssessmentSectionMapping;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.enums.AiEvaluationStatusEnum;
import vacademy.io.assessment_service.features.assessment.enums.EvaluationLogSourceEnum;
import vacademy.io.assessment_service.features.assessment.enums.EvaluationLogsTypeEnum;
import vacademy.io.assessment_service.features.assessment.enums.QuestionResponseEnum;
import vacademy.io.assessment_service.features.assessment.repository.AiEvaluationProcessRepository;
import vacademy.io.assessment_service.features.assessment.repository.AiQuestionEvaluationRepository;
import vacademy.io.assessment_service.features.assessment.repository.EvaluationLogsRepository;
import vacademy.io.assessment_service.features.assessment.repository.QuestionAssessmentSectionMappingRepository;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.AiEvaluationReviewService;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.AiQuestionEvaluationService;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.CopyCheckReportDataSender;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.TypedAnswerEvaluation;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.learner_assessment.enums.AssessmentAttemptEnum;
import vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository;
import vacademy.io.assessment_service.features.open_evaluation.policy.ResultLockGuard;
import vacademy.io.assessment_service.features.open_evaluation.submission.ApiSubmissionFeed;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.core.utils.DateUtil;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * Staff changes the marks of one question of one attempt from the submission
 * view — any question type (MCQ, numeric, long answer, spreadsheet & written,
 * ...), e.g. to give marks for a wrongly keyed question or as a bonus.
 *
 * <p>Two paths, so every screen keeps showing one number:
 * <ul>
 *   <li>The question was marked by the attempt's latest AI run: the change goes
 *       through {@link AiEvaluationReviewService#overrideQuestion}, exactly as the
 *       AI review page does it (AI_REVIEWED, AI totals).</li>
 *   <li>Otherwise the question's marks row(s) of that section are set with
 *       marks_source {@value #TEACHER} (AI_REVIEWED when an older AI run marked
 *       the row, so the AI lineage stays) and the attempt total is recomputed.
 *       Re-evaluation keeps a TEACHER mark ({@link StudentAttemptService#isEvaluatorMarked});
 *       an AI_REVIEWED mark follows the AI rules exactly as before (the whole-attempt
 *       recalculation keeps it, question-wise re-evaluation re-scores it).</li>
 * </ul>
 * While an AI run on the attempt is still queued or working, a written / CBT question
 * is refused: the run would write its own mark over the teacher's when it finishes.
 * A question with no marks row in this attempt (not in the learner's paper, or
 * the submit's marking has not run yet) is refused rather than given a new row:
 * re-evaluation totals only the learner's own questions, so such marks would not
 * stay in the total.
 * Marks are kept within 0 and the question's full marks. Release status is not
 * touched: a held result stays held, a released one shows the new marks.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class QuestionMarksOverrideService {

    /** question_wise_marks.marks_source of a mark a staff member set by hand. */
    public static final String TEACHER = "TEACHER";

    private static final ObjectMapper JSON = new ObjectMapper();

    private final StudentAttemptRepository studentAttemptRepository;
    private final QuestionWiseMarksRepository questionWiseMarksRepository;
    private final QuestionAssessmentSectionMappingRepository mappingRepository;
    private final AiEvaluationProcessRepository processRepository;
    private final AiQuestionEvaluationRepository questionEvaluationRepository;
    private final AiEvaluationReviewService aiReviewService;
    private final TypedAnswerEvaluation typedAnswerEvaluation;
    private final StudentAttemptService studentAttemptService;
    private final EvaluationLogsRepository evaluationLogsRepository;
    private final ResultLockGuard resultLockGuard;

    /** AI runs that are over; any other status means the run may still write marks. */
    static final List<String> FINISHED_RUN_STATUSES = List.of(AiEvaluationStatusEnum.COMPLETED.name(),
            AiEvaluationStatusEnum.FAILED.name(), AiEvaluationStatusEnum.CANCELLED.name());

    /** Partner API feed; optional (null in unit tests), as in AiEvaluationReviewService. */
    @Autowired(required = false)
    private ApiSubmissionFeed submissionFeed;

    /** Bulk-checked copies' AI report data; optional, lazy as in AiEvaluationReviewService. */
    @Autowired(required = false)
    @Lazy
    private CopyCheckReportDataSender reportDataSender;

    @Transactional
    public Map<String, Object> override(String assessmentId, String attemptId, String sectionId, String questionId,
            Double marks, String feedback, String editorUserId) {
        if (isBlank(sectionId) || isBlank(questionId)) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Question and section are required");
        }
        if (marks == null || marks.isNaN() || marks.isInfinite()) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Enter the marks for this question");
        }

        StudentAttempt attempt = studentAttemptRepository.findById(attemptId)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "Attempt not found"));
        Assessment assessment = attempt.getRegistration() != null ? attempt.getRegistration().getAssessment() : null;
        if (assessment == null || !Objects.equals(assessment.getId(), assessmentId)) {
            throw new VacademyException(HttpStatus.NOT_FOUND, "Attempt not found in this assessment");
        }
        if (AssessmentAttemptEnum.LIVE.name().equals(attempt.getStatus())) {
            throw new VacademyException(HttpStatus.CONFLICT,
                    "The learner is still writing this test. Marks can be changed after they submit.");
        }
        resultLockGuard.requireNotFinalizedForApiExam(attempt);

        QuestionAssessmentSectionMapping mapping = mappingRepository.findByQuestionIdAndSectionId(questionId, sectionId)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "Question not found in this section"));
        Double maxMarks = fullMarks(mapping);
        double newMarks = clamp(marks, maxMarks);

        List<QuestionWiseMarks> sectionRows = rowsOf(attemptId, questionId, sectionId);
        if (sectionRows.isEmpty()) {
            throw new VacademyException(HttpStatus.CONFLICT,
                    "This question has no marks in this attempt yet, so its marks cannot be changed.");
        }
        Double previousMarks = sectionRows.get(0).getMarks();

        AiEvaluationProcess latestRun = latestRun(attemptId);
        // List.of(...).contains(null) throws, so a run without a status counts as not running.
        boolean runStillWorking = latestRun != null && latestRun.getStatus() != null
                && !FINISHED_RUN_STATUSES.contains(latestRun.getStatus());
        if (runStillWorking && TypedAnswerEvaluation.isAiGraded(mapping.getQuestion())) {
            throw new VacademyException(HttpStatus.CONFLICT,
                    "AI is still checking this attempt. Change this question's marks after it finishes.");
        }
        boolean aiMarked = latestRun != null && !questionEvaluationRepository
                .findAllByEvaluationProcessIdAndQuestionIdOrderByCreatedAtDesc(latestRun.getId(), questionId).isEmpty();

        String marksSource;
        if (aiMarked) {
            aiReviewService.overrideQuestion(latestRun.getId(), questionId, newMarks, feedback, editorUserId);
            marksSource = "AI_REVIEWED";
        } else {
            marksSource = setTeacherMarks(sectionRows, newMarks, maxMarks, feedback);
            recomputeTotal(attempt, assessment, latestRun);
            // Same after-commit notices the AI review override sends: a partner-API exam's
            // feed shows the change; a bulk-checked copy's AI report data is refreshed
            // (a no-op for every other attempt).
            if (submissionFeed != null) submissionFeed.touch(attemptId);
            if (reportDataSender != null) reportDataSender.sendAfterCommit(attemptId);
        }
        // What was stored: the AI path may clamp further to the AI row's max marks.
        double storedMarks = sectionRows.get(0).getMarks();

        logChange(attempt, editorUserId, questionId, sectionId, previousMarks, storedMarks, feedback, marksSource);
        log.info("[marks-override] attempt {} question {} section {}: {} -> {} ({}) by {}",
                attemptId, questionId, sectionId, previousMarks, storedMarks, marksSource, editorUserId);

        StudentAttempt saved = studentAttemptRepository.findById(attemptId).orElse(attempt);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("question_id", questionId);
        out.put("section_id", sectionId);
        out.put("marks", storedMarks);
        out.put("max_marks", maxMarks);
        out.put("marks_source", marksSource);
        out.put("attempt_total_marks", saved.getTotalMarks());
        return out;
    }

    /** Sets the rows; returns the marks_source written (TEACHER, or AI_REVIEWED on an AI-marked row). */
    private String setTeacherMarks(List<QuestionWiseMarks> rows, double newMarks, Double maxMarks, String feedback) {
        String written = TEACHER;
        for (QuestionWiseMarks row : rows) {
            boolean aiMarked = "AI".equals(row.getMarksSource()) || "AI_REVIEWED".equals(row.getMarksSource());
            String source = aiMarked ? "AI_REVIEWED" : TEACHER;
            row.setMarks(newMarks);
            row.setStatus(statusFor(newMarks, maxMarks, row.getStatus()));
            row.setMarksSource(source);
            if (feedback != null) {
                row.setEvaluatorFeedback(feedback.isBlank() ? null : feedback);
            }
            questionWiseMarksRepository.save(row);
            written = source;
        }
        return written;
    }

    /**
     * Same total every other screen computes: after an AI run on an online attempt,
     * the run's verdicts plus the stored marks of the questions it did not mark;
     * otherwise every marks row (internal-choice extras left out).
     */
    private void recomputeTotal(StudentAttempt attempt, Assessment assessment, AiEvaluationProcess latestRun) {
        if (latestRun != null && typedAnswerEvaluation.isTypedAttempt(attempt, assessment)) {
            List<AiQuestionEvaluation> runRows = AiQuestionEvaluationService.newestPerQuestion(
                    questionEvaluationRepository.findByEvaluationProcessIdOrderByQuestionNumberAsc(latestRun.getId()));
            double total = typedAnswerEvaluation.attemptTotal(attempt, runRows);
            attempt.setTotalMarks(total);
            attempt.setResultMarks(total);
            studentAttemptRepository.save(attempt);
            return;
        }
        studentAttemptService.updateMarksAfterRevaluation(attempt, assessment.getId());
    }

    private List<QuestionWiseMarks> rowsOf(String attemptId, String questionId, String sectionId) {
        List<QuestionWiseMarks> rows = new ArrayList<>();
        for (QuestionWiseMarks row : questionWiseMarksRepository.findAllByAttemptIdAndQuestionId(attemptId, questionId)) {
            String rowSection = row.getSectionId() != null ? row.getSectionId()
                    : row.getSection() != null ? row.getSection().getId() : null;
            if (sectionId.equals(rowSection)) rows.add(row);
        }
        return rows;
    }

    private AiEvaluationProcess latestRun(String attemptId) {
        List<AiEvaluationProcess> runs = processRepository.findByStudentAttempt_IdIn(List.of(attemptId));
        if (runs == null || runs.isEmpty()) return null;
        return runs.stream()
                .max(Comparator.comparing(AiEvaluationProcess::getCreatedAt,
                        Comparator.nullsFirst(Comparator.naturalOrder())))
                .orElse(null);
    }

    private void logChange(StudentAttempt attempt, String editorUserId, String questionId, String sectionId,
            Double previousMarks, double newMarks, String feedback, String marksSource) {
        ObjectNode data = JSON.createObjectNode();
        data.put("question_id", questionId);
        data.put("section_id", sectionId);
        if (previousMarks == null) data.putNull("previous_marks"); else data.put("previous_marks", previousMarks);
        data.put("marks", newMarks);
        data.put("marks_source", marksSource);
        if (feedback != null) data.put("feedback", feedback);
        evaluationLogsRepository.save(EvaluationLogs.builder()
                .source(EvaluationLogSourceEnum.STUDENT_ATTEMPT.name())
                .sourceId(attempt.getId())
                .learnerId(attempt.getRegistration() != null ? attempt.getRegistration().getUserId() : null)
                .authorId(editorUserId)
                .dataJson(data.toString())
                .dateAndTime(DateUtil.getCurrentUtcTime())
                .type(EvaluationLogsTypeEnum.MARKS_OVERRIDE.name())
                .build());
    }

    /** data.totalMark of the question's marking JSON (number or numeric text); null when absent. */
    static Double fullMarks(QuestionAssessmentSectionMapping mapping) {
        String markingJson = mapping.getMarkingJson();
        if (markingJson != null && !markingJson.isBlank()) {
            try {
                JsonNode value = JSON.readTree(markingJson).path("data").path("totalMark");
                if (value.isNumber()) return value.asDouble();
                if (value.isTextual() && !value.asText().isBlank()) return Double.parseDouble(value.asText().trim());
            } catch (Exception ignored) {
                // fall through to the section default
            }
        }
        if (mapping.getSection() != null && mapping.getSection().getMarksPerQuestion() != null
                && mapping.getSection().getMarksPerQuestion() > 0) {
            return mapping.getSection().getMarksPerQuestion();
        }
        return null;
    }

    static double clamp(double marks, Double maxMarks) {
        double value = Math.max(0.0, marks);
        if (maxMarks != null && maxMarks > 0) value = Math.min(value, maxMarks);
        return value;
    }

    /**
     * Status follows the marks so the correct/partial/wrong counts agree with them.
     * Zero on a question the learner skipped stays skipped.
     */
    static String statusFor(double marks, Double maxMarks, String currentStatus) {
        if (marks <= 0) {
            return QuestionResponseEnum.PENDING.name().equals(currentStatus) || currentStatus == null
                    ? QuestionResponseEnum.PENDING.name()
                    : QuestionResponseEnum.INCORRECT.name();
        }
        if (maxMarks == null || maxMarks <= 0 || marks >= maxMarks) return QuestionResponseEnum.CORRECT.name();
        return QuestionResponseEnum.PARTIAL_CORRECT.name();
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }
}
