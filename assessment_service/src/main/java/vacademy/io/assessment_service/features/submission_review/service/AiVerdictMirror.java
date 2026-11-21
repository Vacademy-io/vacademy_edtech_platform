package vacademy.io.assessment_service.features.submission_review.service;

import org.springframework.stereotype.Component;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.QuestionOverrideRequest;
import vacademy.io.assessment_service.features.assessment.entity.AiEvaluationProcess;
import vacademy.io.assessment_service.features.assessment.entity.AiQuestionEvaluation;
import vacademy.io.assessment_service.features.assessment.enums.AiEvaluationStatusEnum;
import vacademy.io.assessment_service.features.assessment.repository.AiEvaluationProcessRepository;
import vacademy.io.assessment_service.features.assessment.repository.AiQuestionEvaluationRepository;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.AiEvaluationReviewService;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.AiQuestionEvaluationService;

import java.math.BigDecimal;
import java.util.Comparator;
import java.util.Date;
import java.util.List;
import java.util.Optional;

/**
 * A teacher's mark copied onto the AI verdict of the question (contract 3.5), exactly as the
 * AI review page always did: "Redraw checked copy" and the partner API read the AI row.
 * Shared by the review PUT and MarkWriter.
 */
@Component
public class AiVerdictMirror {

    private final AiEvaluationProcessRepository processRepository;
    private final AiQuestionEvaluationRepository questionEvaluationRepository;

    public AiVerdictMirror(AiEvaluationProcessRepository processRepository,
                           AiQuestionEvaluationRepository questionEvaluationRepository) {
        this.processRepository = processRepository;
        this.questionEvaluationRepository = questionEvaluationRepository;
    }

    /** The newest finished AI run of the attempt, if any. */
    public Optional<AiEvaluationProcess> newestTerminalProcess(String attemptId) {
        List<AiEvaluationProcess> all = processRepository.findByStudentAttempt_IdIn(List.of(attemptId));
        return all.stream()
                .filter(p -> p.getStatus() != null && AiEvaluationStatusEnum.TERMINAL.contains(p.getStatus().toUpperCase()))
                .max(Comparator.comparing(p -> p.getCreatedAt() == null ? new Date(0) : p.getCreatedAt()));
    }

    public Optional<AiQuestionEvaluation> verdictById(String id) {
        return id == null ? Optional.empty() : questionEvaluationRepository.findById(id);
    }

    /** The AI verdict of a question in a run (newest row of a double dispatch). */
    public Optional<AiQuestionEvaluation> verdict(String processId, String questionId) {
        if (processId == null) return Optional.empty();
        return AiQuestionEvaluationService.newest(questionEvaluationRepository
                .findAllByEvaluationProcessIdAndQuestionIdOrderByCreatedAtDesc(processId, questionId));
    }

    /**
     * Writes the teacher's mark (and feedback, and pen-note edits) onto the verdict of the
     * question in {@code processId}, or in the newest finished run when null. Returns the
     * verdict id, or null when the AI never marked this question.
     */
    public String apply(String attemptId, String processId, String questionId, double marks, String feedback,
                        List<QuestionOverrideRequest.AnnotationEdit> annotationEdits, String editorUserId) {
        String pid = processId;
        if (pid == null) {
            pid = newestTerminalProcess(attemptId).map(AiEvaluationProcess::getId).orElse(null);
        }
        Optional<AiQuestionEvaluation> found = verdict(pid, questionId);
        if (found.isEmpty()) return null;
        AiQuestionEvaluation row = found.get();
        row.setMarksAwarded(BigDecimal.valueOf(marks));
        if (feedback != null) {
            row.setFeedback(feedback);
        }
        row.setStatus("COMPLETED");
        if (annotationEdits != null) {
            row.setEvaluationResultJson(AiEvaluationReviewService.withAnnotationEdits(row.getEvaluationResultJson(),
                    annotationEdits));
        }
        row.setIsEdited(true);
        row.setEditedBy(editorUserId);
        row.setEditedAt(new Date());
        questionEvaluationRepository.save(row);
        return row.getId();
    }
}
