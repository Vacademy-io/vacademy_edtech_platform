package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.util.StringUtils;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.CopyCheckCallbackDto;
import vacademy.io.assessment_service.features.assessment.entity.AiEvaluationProcess;
import vacademy.io.assessment_service.features.assessment.entity.AiQuestionEvaluation;
import vacademy.io.assessment_service.features.assessment.enums.AttemptResultStatusEnum;
import vacademy.io.assessment_service.features.assessment.enums.ReleaseResultStatusEnum;
import vacademy.io.assessment_service.features.assessment.entity.CopyCheckLayout;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.enums.AiEvaluationStatusEnum;
import vacademy.io.assessment_service.features.assessment.repository.AiEvaluationProcessRepository;
import vacademy.io.assessment_service.features.assessment.repository.AiQuestionEvaluationRepository;
import vacademy.io.assessment_service.features.assessment.repository.CopyCheckLayoutRepository;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository;

import java.util.Date;
import java.util.List;
import java.util.Optional;

/**
 * Persists callback events from ai_service. Each handler is idempotent:
 *   - progress: just updates step/progress on the process
 *   - question: upserts ai_question_evaluation + question_wise_marks for the
 *     given (process_id, question_id) pair, so a retried callback rewrites
 *     the same row instead of duplicating it
 *   - complete / failed: terminal — clears cancellation flag too
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class CopyCheckCallbackService {

    private final AiEvaluationProcessRepository processRepository;
    private final vacademy.io.assessment_service.features.assessment.copy_intake.service.CopyIntakeService copyIntakeService;
    private final AiQuestionEvaluationRepository questionEvaluationRepository;
    private final CopyCheckLayoutRepository layoutRepository;
    private final QuestionWiseMarksRepository questionWiseMarksRepository;
    private final StudentAttemptRepository studentAttemptRepository;
    private final AiEvaluationCancellationService cancellationService;
    private final TypedAnswerEvaluation typedAnswerEvaluation;
    private final ObjectMapper objectMapper;

    @Transactional
    public void onProgress(CopyCheckCallbackDto.Progress payload) {
        AiEvaluationProcess process = processRepository.findById(payload.getProcessId()).orElse(null);
        if (process == null) {
            log.warn("[copy-check] progress callback for unknown process={}", payload.getProcessId());
            return;
        }
        // Progress never moves a finished process: a straggler (or a heartbeat
        // that overlapped the complete callback) must not flip COMPLETED back
        // to EVALUATING, and a reaped run must stay reaped.
        if (isTerminal(process.getStatus())) {
            log.info("[copy-check] ignoring progress '{}' for finished process {} (status={})",
                    payload.getStep(), payload.getProcessId(), process.getStatus());
            return;
        }
        // ai_service re-posts the current step every minute as a heartbeat. A
        // repeat carries no news, so it only moves updated_at - as a targeted
        // UPDATE, never a full-row save that could race a real state change.
        boolean heartbeat = payload.getStep() != null && payload.getStep().equals(process.getCurrentStep())
                && (payload.getLayoutMap() == null || payload.getLayoutMap().isNull());
        if (heartbeat) {
            processRepository.touch(process.getId(), new Date(), TERMINAL);
            return;
        }
        // A targeted UPDATE of step/status/updated_at only, guarded on "not finished".
        // A full-row save here used to write back every column as this callback had
        // read it - including a claim, job id or status another writer had just
        // changed (gate G6). The entity is deliberately not modified, so nothing
        // else is flushed either.
        String status = null;
        if ("LAYOUT_OCR_DONE".equals(payload.getStep())) {
            status = AiEvaluationStatusEnum.EXTRACTING.name();
            persistLayoutIfPresent(process, payload.getLayoutMap());
        } else if ("GRADING".equals(payload.getStep())) {
            status = AiEvaluationStatusEnum.EVALUATING.name();
        }
        Date now = new Date();
        if (status != null) {
            processRepository.applyProgressStepAndStatus(process.getId(), payload.getStep(), status, now, TERMINAL);
        } else {
            processRepository.applyProgressStep(process.getId(), payload.getStep(), now, TERMINAL);
        }
    }

    /** Nothing further can happen to a process in one of these states. */
    private static final List<String> TERMINAL = AiEvaluationStatusEnum.TERMINAL;

    private static boolean isTerminal(String status) {
        return status != null && TERMINAL.contains(status.toUpperCase());
    }

    private void persistLayoutIfPresent(AiEvaluationProcess process, JsonNode layoutMap) {
        if (layoutMap == null || layoutMap.isMissingNode() || layoutMap.isNull()) return;
        try {
            CopyCheckLayout row = layoutRepository
                    .findByEvaluationProcessId(process.getId())
                    .orElseGet(CopyCheckLayout::new);
            row.setEvaluationProcessId(process.getId());
            row.setAttemptId(process.getStudentAttempt() != null ? process.getStudentAttempt().getId() : null);
            row.setLayoutJson(objectMapper.writeValueAsString(layoutMap));
            layoutRepository.save(row);
        } catch (JsonProcessingException e) {
            log.error("[copy-check] failed to serialize layout for process {}", process.getId(), e);
        }
    }

    @Transactional
    public void onQuestionDone(CopyCheckCallbackDto.QuestionDone payload) {
        AiEvaluationProcess process = processRepository.findById(payload.getProcessId()).orElse(null);
        if (process == null) {
            log.warn("[copy-check] question callback for unknown process={}", payload.getProcessId());
            return;
        }
        // A process the stale-job sweeper marked FAILED, or the teacher CANCELLED,
        // is reaped: ignore straggler callbacks so a (possibly still-alive) old run
        // can't silently resurrect it and race a retry into the same marks rows.
        if (isReaped(process.getStatus())) {
            log.info("[copy-check] ignoring question callback for reaped process {} (status={})",
                    payload.getProcessId(), process.getStatus());
            return;
        }
        String qStatus = (payload.getStatus() != null && !payload.getStatus().isBlank())
                ? payload.getStatus().toUpperCase()
                : "COMPLETED";
        boolean failed = "FAILED".equals(qStatus);

        // Duplicated tracking rows (a double dispatch) used to turn this lookup
        // into "2 results were returned" and lose the whole verdict; take the
        // newest row instead and let the rest sit idle.
        List<AiQuestionEvaluation> rowsForQuestion = questionEvaluationRepository
                .findAllByEvaluationProcessIdAndQuestionIdOrderByCreatedAtDesc(process.getId(), payload.getQuestionId());
        if (rowsForQuestion.size() > 1) {
            log.warn("[copy-check] {} tracking rows for question {} in process {}; using the newest",
                    rowsForQuestion.size(), payload.getQuestionId(), process.getId());
        }
        Optional<AiQuestionEvaluation> row = AiQuestionEvaluationService.newest(rowsForQuestion);

        // Never let a late or retried AI callback overwrite a mark a human has
        // already reviewed/edited on the review page.
        if (row.isPresent() && Boolean.TRUE.equals(row.get().getIsEdited())) {
            log.info("[copy-check] skipping AI callback for question {} — already edited by a reviewer",
                    payload.getQuestionId());
            return;
        }

        // Idempotency anchor: a retried callback hits the same row, and we must
        // not double-bump questions_completed below. A question counts as
        // processed once it reaches a terminal state (graded OR failed).
        boolean wasTerminal = row.isPresent()
                && ("COMPLETED".equals(row.get().getStatus()) || "FAILED".equals(row.get().getStatus()));
        AiQuestionEvaluation evalRow = row.orElseGet(() -> {
            AiQuestionEvaluation r = new AiQuestionEvaluation();
            r.setEvaluationProcess(process);
            return r;
        });
        evalRow.setMarksAwarded(payload.getMarksAwarded() != null
                ? java.math.BigDecimal.valueOf(payload.getMarksAwarded()) : null);
        evalRow.setMaxMarks(payload.getMaxMarks() != null
                ? java.math.BigDecimal.valueOf(payload.getMaxMarks()) : null);
        evalRow.setFeedback(payload.getFeedback());
        evalRow.setExtractedAnswer(payload.getExtractedAnswer());
        try {
            evalRow.setEvaluationResultJson(objectMapper.writeValueAsString(payload));
        } catch (JsonProcessingException e) {
            log.warn("[copy-check] could not serialize verdict for {}/{}", process.getId(), payload.getQuestionId());
        }
        evalRow.setStatus(qStatus);
        evalRow.setCompletedAt(new Date());
        evalRow.setRubricVersion(payload.getRubricVersion());
        questionEvaluationRepository.save(evalRow);

        // Mirror ONLY successfully-graded questions into question_wise_marks. A
        // FAILED question is left untouched (no silent 0) — it surfaces on the
        // review page for the teacher to grade by hand, which then mirrors it.
        if (!failed && payload.getMarksAwarded() != null) {
            QuestionWiseMarks marks = questionWiseMarksRepository
                    .findByStudentAttemptIdAndQuestionId(
                            process.getStudentAttempt() != null ? process.getStudentAttempt().getId() : null,
                            payload.getQuestionId())
                    .orElse(null);
            if (marks != null) {
                marks.setMarks(payload.getMarksAwarded());
                marks.setAiEvaluatedAt(new Date());
                marks.setMarksSource("AI");
                try {
                    marks.setAiEvaluationDetailsJson(objectMapper.writeValueAsString(payload));
                } catch (JsonProcessingException ignored) {
                    // Non-fatal — feedback is also on ai_question_evaluation row.
                }
                questionWiseMarksRepository.save(marks);
            }
        }

        if (!wasTerminal) {
            // An increment in SQL: question callbacks arrive concurrently, and a
            // read-modify-save of the whole row lost counts (and could undo other
            // columns' changes) when two landed together.
            processRepository.incrementQuestionsCompleted(process.getId(), new Date());
        }
    }

    @Transactional
    public void onComplete(CopyCheckCallbackDto.Complete payload) {
        AiEvaluationProcess process = processRepository.findById(payload.getProcessId()).orElse(null);
        if (process == null) {
            log.warn("[copy-check] complete callback for unknown process={}", payload.getProcessId());
            return;
        }
        // Don't let a straggler complete callback resurrect a reaped (swept-FAILED
        // or user-CANCELLED) run into COMPLETED after a retry may already exist.
        if (isReaped(process.getStatus())) {
            log.info("[copy-check] ignoring complete callback for reaped process {} (status={})",
                    payload.getProcessId(), process.getStatus());
            cancellationService.clearFlag(payload.getProcessId());
            return;
        }
        process.setStatus(AiEvaluationStatusEnum.COMPLETED.name());
        process.setCompletedAt(new Date());
        try {
            process.setEvaluationJson(objectMapper.writeValueAsString(payload));
        } catch (JsonProcessingException ignored) {
        }
        processRepository.save(process);
        // A copy from a bulk upload: settle its intake row and maybe the batch.
        notifyIntake(payload.getProcessId(), true, null);

        if (process.getStudentAttempt() != null) {
            StudentAttempt attempt = studentAttemptRepository
                    .findById(process.getStudentAttempt().getId())
                    .orElse(null);
            // A RELEASED result is frozen against background AI writes: a
            // teacher who evaluated by hand (or bulk-imported marks) and
            // released while this run was still in flight must not have their
            // totals, status, or checked copy silently replaced by a late
            // complete callback. The AI verdicts stay on the review page; the
            // teacher applies them explicitly via override if wanted.
            if (attempt != null && ReleaseResultStatusEnum.RELEASED.name().equals(attempt.getReportReleaseStatus())) {
                log.warn("[copy-check] process {} completed but attempt {} result is already RELEASED — "
                        + "leaving the attempt untouched", process.getId(), attempt.getId());
                attempt = null;
            }
            if (attempt != null) {
                // Recompute from the successfully-graded questions rather than
                // trusting the AI's reported total: FAILED questions are excluded
                // (not counted as a silent 0) until a teacher grades them, which
                // recomputes this total via AiEvaluationReviewService. An online
                // attempt's run covers only its written answers; the objective
                // marks scored on submit are added back in.
                // One row per question (newest): a pre-V53 duplicate must not count twice.
                List<AiQuestionEvaluation> rows = AiQuestionEvaluationService.newestPerQuestion(questionEvaluationRepository
                        .findByEvaluationProcessIdOrderByQuestionNumberAsc(process.getId()));
                double total = typedAnswerEvaluation.attemptTotal(attempt, rows);
                attempt.setTotalMarks(total);
                attempt.setResultMarks(total);

                // A copy where some questions never graded is NOT evaluated. The
                // total above deliberately excludes them, so marking the attempt
                // COMPLETED would publish a score whose denominator still counts
                // marks nobody awarded — a 23/100 that is really 23 out of the 60
                // that got graded. Leave it EVALUATING so it stays in the
                // teacher's queue until they grade the rest.
                // Anything non-COMPLETED counts: a row still PENDING here means
                // its question callback was dropped (they are fire-and-forget
                // with one retry), and that question's marks are just as absent
                // from the total as a FAILED one's.
                long ungraded = rows.stream().filter(q -> !"COMPLETED".equals(q.getStatus())).count();
                if (ungraded > 0) {
                    attempt.setResultStatus(AttemptResultStatusEnum.EVALUATING.name());
                    log.warn("[copy-check] process {} completed with {}/{} question(s) ungraded — "
                            + "attempt {} left EVALUATING for manual review",
                            process.getId(), ungraded, rows.size(), attempt.getId());
                } else {
                    attempt.setResultStatus("COMPLETED");
                }
                // The annotated copy ai_service rendered. Absent when the render
                // or upload failed, in which case leave whatever is already on
                // the attempt — a failed render must not wipe a copy a teacher
                // uploaded by hand.
                if (StringUtils.hasText(payload.getEvaluatedFileId())) {
                    attempt.setEvaluatedFileId(payload.getEvaluatedFileId());
                }
                studentAttemptRepository.save(attempt);
            }
        }
        cancellationService.clearFlag(payload.getProcessId());
        log.info("[copy-check] process {} complete: {}/{} ({} questions)",
                payload.getProcessId(), payload.getTotalMarksAwarded(),
                payload.getTotalMaxMarks(), payload.getQuestionsEvaluated());
    }

    @Transactional
    public void onFailed(CopyCheckCallbackDto.Failed payload) {
        AiEvaluationProcess process = processRepository.findById(payload.getProcessId()).orElse(null);
        if (process == null) return;
        // A user-initiated stop sets status=CANCELLED first; ai_service then
        // reports the aborted job as failed("Cancelled by user"). Do NOT clobber
        // that deliberate CANCELLED state with FAILED — the teacher stopped it on
        // purpose, and support must be able to tell real pipeline failures apart
        // from user stops.
        if ("CANCELLED".equalsIgnoreCase(process.getStatus())) {
            cancellationService.clearFlag(payload.getProcessId());
            log.info("[copy-check] ignoring failed callback for already-cancelled process {}",
                    payload.getProcessId());
            return;
        }
        process.setStatus(AiEvaluationStatusEnum.FAILED.name());
        process.setErrorMessage(withErrorCode(payload.getErrorCode(), payload.getErrorMessage()));
        process.setCompletedAt(new Date());
        processRepository.save(process);
        notifyIntake(payload.getProcessId(), false, payload.getErrorMessage());
        cancellationService.clearFlag(payload.getProcessId());
        log.warn("[copy-check] process {} failed: {}", payload.getProcessId(), payload.getErrorMessage());
    }

    /**
     * The stored failure text with ai_service's machine code in front ("code: message"),
     * the same shape the dispatcher uses for its own refusals ("insufficient_credits: ..."),
     * so the partner API can report the code without matching message text. A message
     * that already starts with the code, or a callback without one, is stored as is.
     */
    static String withErrorCode(String code, String message) {
        if (code == null || !code.matches("[a-z][a-z0-9_]{0,63}")) {
            return message;
        }
        if (message == null || message.isBlank()) {
            return code;
        }
        return message.startsWith(code + ":") ? message : code + ": " + message;
    }

    /** A process that has been reaped by the sweeper (FAILED) or the user (CANCELLED). */
    private static boolean isReaped(String status) {
        return "FAILED".equalsIgnoreCase(status) || "CANCELLED".equalsIgnoreCase(status);
    }

    /**
     * Best-effort: the intake bookkeeping must never fail a grading callback.
     * Runs after this callback's transaction commits, so the batch settles on
     * committed data and the completion email is not sent inside a database
     * transaction that is still open.
     */
    private void notifyIntake(String processId, boolean succeeded, String error) {
        Runnable update = () -> {
            try {
                copyIntakeService.onEvaluationFinished(processId, succeeded, error);
                copyIntakeService.getBatchIdForProcess(processId).ifPresent(copyIntakeService::finalizeIfDone);
            } catch (Exception e) {
                log.warn("[copy-check] intake update failed for process {}: {}", processId, e.getMessage());
            }
        };
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    update.run();
                }
            });
        } else {
            update.run();
        }
    }
}
