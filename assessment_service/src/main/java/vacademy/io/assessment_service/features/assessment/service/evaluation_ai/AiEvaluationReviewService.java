package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.assessment_service.features.assessment.entity.AiEvaluationProcess;
import vacademy.io.assessment_service.features.assessment.enums.AiEvaluationStatusEnum;
import vacademy.io.assessment_service.features.assessment.entity.AiQuestionEvaluation;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.AiEvaluationProcessRepository;
import vacademy.io.assessment_service.features.assessment.repository.AiQuestionEvaluationRepository;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository;
import vacademy.io.assessment_service.features.open_evaluation.policy.ResultLockGuard;
import vacademy.io.common.exceptions.ResourceNotFoundException;

import java.math.BigDecimal;
import java.util.Date;

/**
 * Teacher-in-the-loop review of AI evaluation results. Lets a reviewer override
 * a single question's marks and feedback before the result is released, and
 * keeps the attempt total, the mirrored question_wise_marks row, and provenance
 * consistent. This is the write path that turns "AI grades your students" into
 * "AI drafts, the teacher approves".
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class AiEvaluationReviewService {

    private final AiEvaluationProcessRepository processRepository;
    private final AiQuestionEvaluationRepository questionEvaluationRepository;
    private final QuestionWiseMarksRepository questionWiseMarksRepository;
    private final StudentAttemptRepository studentAttemptRepository;
    private final TypedAnswerEvaluation typedAnswerEvaluation;
    private final ResultLockGuard resultLockGuard;

    /** Partner API feed: an override is a change the partner must see. Optional; null in unit tests. */
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private vacademy.io.assessment_service.features.open_evaluation.submission.ApiSubmissionFeed submissionFeed;

    @Transactional
    public void overrideQuestion(String processId, String questionId, Double marks, String feedback,
            String editorUserId) {
        AiEvaluationProcess process = processRepository.findByIdWithStudentAttempt(processId)
                .orElseThrow(() -> new ResourceNotFoundException("Evaluation process not found: " + processId));

        // A released result on a partner-API exam is finalized: no edits until it is
        // unfinalized (gate G8). Dashboard exams keep today's behaviour.
        resultLockGuard.requireNotFinalizedForApiExam(process.getStudentAttempt());

        // Newest row: a pre-V53 double dispatch left two, and a single-result
        // lookup threw "2 results were returned" at the reviewer.
        AiQuestionEvaluation row = AiQuestionEvaluationService.newest(questionEvaluationRepository
                        .findAllByEvaluationProcessIdAndQuestionIdOrderByCreatedAtDesc(processId, questionId))
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Question evaluation not found for question " + questionId));

        // Clamp to [0, max]. A teacher editing a previously-FAILED question turns
        // it into a resolved, graded question.
        double max = row.getMaxMarks() != null ? row.getMaxMarks().doubleValue() : Double.MAX_VALUE;
        double clamped = marks == null ? 0.0 : Math.max(0.0, Math.min(marks, max));

        row.setMarksAwarded(BigDecimal.valueOf(clamped));
        if (feedback != null) {
            row.setFeedback(feedback);
        }
        row.setStatus("COMPLETED");
        row.setIsEdited(true);
        row.setEditedBy(editorUserId);
        row.setEditedAt(new Date());
        questionEvaluationRepository.save(row);

        // Mirror the human decision into question_wise_marks so the submissions
        // table and (once released) the learner report read the reviewed value.
        String attemptId = process.getStudentAttempt() != null ? process.getStudentAttempt().getId() : null;
        if (attemptId != null) {
            QuestionWiseMarks marksRow = questionWiseMarksRepository
                    .findByStudentAttemptIdAndQuestionId(attemptId, questionId)
                    .orElse(null);
            if (marksRow != null) {
                marksRow.setMarks(clamped);
                marksRow.setAiEvaluatedAt(new Date());
                marksRow.setMarksSource("AI_REVIEWED");
                // The teacher's edited feedback becomes the authoritative,
                // learner-visible remark for this question.
                if (feedback != null) {
                    marksRow.setEvaluatorFeedback(feedback);
                }
                questionWiseMarksRepository.save(marksRow);
            }
        }

        recomputeAttemptTotals(process);
        if (submissionFeed != null && attemptId != null) {
            submissionFeed.touch(attemptId);
        }
        log.info("[copy-check] question {} of process {} overridden to {} by {}",
                questionId, processId, clamped, editorUserId);
    }

    /**
     * Recompute the attempt's total/result marks from the successfully-graded
     * (COMPLETED) question evaluations of this process. Keeps failed/unreviewed
     * questions out of the total until a teacher grades them.
     */
    private void recomputeAttemptTotals(AiEvaluationProcess process) {
        if (process.getStudentAttempt() == null) {
            return;
        }
        var rows = AiQuestionEvaluationService.newestPerQuestion(questionEvaluationRepository
                .findByEvaluationProcessIdOrderByQuestionNumberAsc(process.getId()));

        // Non-COMPLETED, not just FAILED: a PENDING row mid-run counts as
        // ungraded, otherwise a teacher tweaking one already-graded question
        // while the AI is still working would promote the attempt (and its
        // partial total) straight into the auto-release query's reach.
        long stillUngraded = rows.stream().filter(q -> !"COMPLETED".equals(q.getStatus())).count();
        boolean processFinished = AiEvaluationStatusEnum.COMPLETED.name().equals(process.getStatus());
        StudentAttempt attempt = studentAttemptRepository.findById(process.getStudentAttempt().getId())
                .orElse(null);
        if (attempt != null) {
            double total = typedAnswerEvaluation.attemptTotal(attempt, rows);
            attempt.setTotalMarks(total);
            attempt.setResultMarks(total);
            // Counterpart of CopyCheckCallbackService.onComplete leaving the
            // attempt EVALUATING while any question is ungraded: once the
            // teacher grades the last such question, THIS is the only write
            // path left that can complete the attempt — without it the attempt
            // stays EVALUATING forever after a full manual review. Gated on the
            // process itself being COMPLETED so a mid-run edit, or an edit on a
            // stale swept-FAILED process while a retry is running, can never
            // promote the attempt.
            if (stillUngraded == 0 && processFinished) {
                attempt.setResultStatus("COMPLETED");
            }
            studentAttemptRepository.save(attempt);
        }
    }
}
