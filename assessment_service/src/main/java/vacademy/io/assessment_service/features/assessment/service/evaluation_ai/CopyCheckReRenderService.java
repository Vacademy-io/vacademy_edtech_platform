package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;
import vacademy.io.assessment_service.features.assessment.client.AiServiceCopyCheckClient;
import vacademy.io.assessment_service.features.assessment.entity.AiEvaluationProcess;
import vacademy.io.assessment_service.features.assessment.entity.AiQuestionEvaluation;
import vacademy.io.assessment_service.features.assessment.enums.AiEvaluationStatusEnum;
import vacademy.io.assessment_service.features.assessment.repository.AiEvaluationProcessRepository;
import vacademy.io.assessment_service.features.assessment.repository.AiQuestionEvaluationRepository;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.common.exceptions.ResourceNotFoundException;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Re-draws an AI checked copy after a teacher's review, so the PDF the student gets says
 * what the released marks say.
 *
 * <p>The review page writes each correction (mark, remark, pen-note edits) onto the
 * question's {@code ai_question_evaluation} row ({@link AiEvaluationReviewService}).
 * This sends every corrected question to ai_service {@code POST /copy-check/re-render},
 * which re-draws the copy from the inputs it saved at the first render, and then points
 * the run (and the attempt, when this run's copy is still the attempt's copy) at the new
 * file. Nothing is changed when the re-draw fails: the old copy stays.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class CopyCheckReRenderService {

    private final AiEvaluationProcessRepository processRepository;
    private final AiQuestionEvaluationRepository questionEvaluationRepository;
    private final StudentAttemptRepository studentAttemptRepository;
    private final EvaluationUtilityService evaluationUtilityService;
    private final CopyCheckOrchestratorService orchestratorService;
    private final AiServiceCopyCheckClient aiServiceClient;
    private final ObjectMapper objectMapper;
    private final PlatformTransactionManager transactionManager;
    private final TypedAnswerEvaluation typedAnswerEvaluation;
    private final vacademy.io.assessment_service.features.open_evaluation.policy.ResultLockGuard resultLockGuard;

    /** Partner API feed: a changed checked copy is a change the partner must see. Optional; null in unit tests. */
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private vacademy.io.assessment_service.features.open_evaluation.submission.ApiSubmissionFeed submissionFeed;

    public record Result(String evaluatedFileId, Double totalMarksAwarded, Double totalMaxMarks,
                         int questionsChanged) {
    }

    /** What the re-draw needs, read in one short transaction. */
    private record Inputs(String attemptId, String pdfUrl, List<Map<String, Object>> overrides,
                          Map<String, Boolean> counted, double total) {
    }

    /**
     * @param penStyle           the pen to draw with ({ink, font, size}); null keeps the pen
     *                           the copy was first drawn with
     * @param commentPlacement   INSIDE / OUTSIDE; null keeps the copy's template
     */
    public Result reRender(String processId, String instituteId, Map<String, Object> penStyle,
                           String commentPlacement, String userId) {
        TransactionTemplate read = new TransactionTemplate(transactionManager);
        read.setReadOnly(true);
        Inputs in = read.execute(status -> collect(processId));

        Map<String, Object> body = new HashMap<>();
        body.put("process_id", processId);
        body.put("institute_id", instituteId);
        body.put("attempt_id", in.attemptId());
        body.put("pdf_url", in.pdfUrl());
        body.put("overrides", in.overrides());
        // The copy must carry the marks the system stores (gate G9): which questions an
        // "any N of M" group counts after the teacher's changes, and the attempt total.
        body.put("counted", in.counted());
        body.put("total_marks_awarded", in.total());
        if (penStyle != null) {
            // A choice equal to the usual pen is sent as {} ("the usual pen"), not
            // omitted, which would mean "the pen the copy was drawn with".
            Map<String, Object> cleaned = CopyPenStyle.clean(penStyle);
            body.put("pen_style", cleaned == null ? Map.of() : cleaned);
        }
        if (StringUtils.hasText(commentPlacement)) {
            body.put("comment_placement", "OUTSIDE".equalsIgnoreCase(commentPlacement) ? "OUTSIDE" : "INSIDE");
        }

        Map<String, Object> out;
        try {
            out = aiServiceClient.reRender(body);
        } catch (AiServiceCopyCheckClient.ReRenderUnavailableException e) {
            throw new VacademyException(HttpStatus.CONFLICT,
                    "This copy was checked before re-drawing was available. Run the AI check again to update it.");
        } catch (Exception e) {
            log.error("[copy-check] re-render of process {} failed: {}", processId, e.getMessage());
            throw new VacademyException(HttpStatus.BAD_GATEWAY, "Could not update the checked copy. Please try again.");
        }
        String fileId = String.valueOf(out.get("evaluated_file_id"));

        new TransactionTemplate(transactionManager).executeWithoutResult(status -> save(processId, fileId, userId));
        log.info("[copy-check] process {} re-drawn by {} with {} corrected question(s) -> {}",
                processId, userId, in.overrides().size(), fileId);
        return new Result(fileId, number(out.get("total_marks_awarded")), number(out.get("total_max_marks")),
                in.overrides().size());
    }

    private Inputs collect(String processId) {
        AiEvaluationProcess process = processRepository.findByIdWithStudentAttempt(processId)
                .orElseThrow(() -> new ResourceNotFoundException("Evaluation process not found: " + processId));
        if (!AiEvaluationStatusEnum.COMPLETED.name().equals(process.getStatus())) {
            throw new VacademyException(HttpStatus.CONFLICT, "The AI check of this copy has not finished yet.");
        }
        if (process.getStudentAttempt() == null) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "This evaluation has no attempt.");
        }
        // A released result on a partner-API exam is finalized: its copy is not changed
        // either until it is unfinalized (gate G8), same as a mark override.
        resultLockGuard.requireNotFinalizedForApiExam(process.getStudentAttempt());
        String fileId = evaluationUtilityService.extractFileId(process.getStudentAttempt().getAttemptData());
        if (!StringUtils.hasText(fileId)) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "This attempt has no uploaded answer sheet to re-draw.");
        }
        String pdfUrl = orchestratorService.answerSheetUrl(process, fileId);
        if (pdfUrl == null) {
            throw new VacademyException(HttpStatus.BAD_GATEWAY, "Could not read the answer sheet. Please try again.");
        }

        List<AiQuestionEvaluation> rows = AiQuestionEvaluationService.newestPerQuestion(
                questionEvaluationRepository.findByEvaluationProcessIdOrderByQuestionNumberAsc(processId));
        List<Map<String, Object>> overrides = new ArrayList<>();
        for (AiQuestionEvaluation row : rows) {
            if (!Boolean.TRUE.equals(row.getIsEdited()) || row.getQuestion() == null) {
                continue;
            }
            Map<String, Object> o = new LinkedHashMap<>();
            o.put("question_id", row.getQuestion().getId());
            if (row.getMarksAwarded() != null) {
                o.put("marks_awarded", row.getMarksAwarded().doubleValue());
            }
            if (row.getFeedback() != null) {
                o.put("feedback", row.getFeedback());
            }
            o.put("annotation_edits", annotationEdits(row.getEvaluationResultJson()));
            overrides.add(o);
        }
        Map<String, Boolean> counted = new LinkedHashMap<>();
        java.util.Set<String> notCounted = typedAnswerEvaluation.notCountedQuestionIds(process.getStudentAttempt(), rows);
        for (AiQuestionEvaluation row : rows) {
            if (row.getQuestion() != null) {
                counted.put(row.getQuestion().getId(), !notCounted.contains(row.getQuestion().getId()));
            }
        }
        double total = typedAnswerEvaluation.attemptTotal(process.getStudentAttempt(), rows);
        return new Inputs(process.getStudentAttempt().getId(), pdfUrl, overrides, counted, total);
    }

    private List<Object> annotationEdits(String resultJson) {
        List<Object> out = new ArrayList<>();
        if (!StringUtils.hasText(resultJson)) {
            return out;
        }
        try {
            JsonNode list = objectMapper.readTree(resultJson).path(AiEvaluationReviewService.ANNOTATION_EDITS_KEY);
            if (list.isArray()) {
                for (JsonNode n : list) {
                    out.add(objectMapper.convertValue(n, Map.class));
                }
            }
        } catch (Exception e) {
            log.warn("[copy-check] unreadable verdict JSON; pen-note edits skipped: {}", e.getMessage());
        }
        return out;
    }

    private void save(String processId, String fileId, String userId) {
        AiEvaluationProcess process = processRepository.findByIdWithStudentAttempt(processId).orElse(null);
        if (process == null) {
            return;
        }
        String previous = null;
        ObjectNode json;
        try {
            JsonNode parsed = StringUtils.hasText(process.getEvaluationJson())
                    ? objectMapper.readTree(process.getEvaluationJson()) : null;
            json = parsed instanceof ObjectNode o ? o : objectMapper.createObjectNode();
        } catch (Exception e) {
            json = objectMapper.createObjectNode();
        }
        if (json.path("evaluated_file_id").isTextual()) {
            previous = json.get("evaluated_file_id").asText();
            if (!json.has("ai_evaluated_file_id")) {
                // The AI's own first copy, kept for reference.
                json.put("ai_evaluated_file_id", previous);
            }
        }
        json.put("evaluated_file_id", fileId);
        json.put("re_rendered_at", new Date().toInstant().toString());
        json.put("re_rendered_by", userId);
        process.setEvaluationJson(json.toString());
        processRepository.save(process);
        final String runCopy = previous;

        // The attempt's copy is per attempt, shared by every run: move it only when it is
        // still this run's copy (or empty), never over a later run's or a hand-uploaded one.
        if (process.getStudentAttempt() != null) {
            studentAttemptRepository.findById(process.getStudentAttempt().getId()).ifPresent(attempt -> {
                String current = attempt.getEvaluatedFileId();
                if (!StringUtils.hasText(current) || current.equals(runCopy)) {
                    attempt.setEvaluatedFileId(fileId);
                    studentAttemptRepository.save(attempt);
                    if (submissionFeed != null) {
                        submissionFeed.touch(attempt.getId());
                    }
                }
            });
        }
    }

    private static Double number(Object v) {
        if (v instanceof Number n) return n.doubleValue();
        try {
            return v == null ? null : Double.valueOf(v.toString());
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
