package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
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

    /** Hands the checked copy's marks to the AI reports. Optional; null in unit tests. */
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    @org.springframework.context.annotation.Lazy
    private CopyCheckReportDataSender reportDataSender;

    /** Submission review (phase 1a): release-when-marked after an AI run completes. Optional. */
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private org.springframework.context.ApplicationEventPublisher eventPublisher;

    /** Submission review (phase 1a): the R6 total when a teacher's mark sits beside AI marks. Optional. */
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    @org.springframework.context.annotation.Lazy
    private vacademy.io.assessment_service.features.submission_review.service.SubmissionReleaseService submissionReleaseService;

    @Autowired(required = false)
    private vacademy.io.assessment_service.features.submission_review.service.SubmissionReviewStore submissionReviewStore;

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
        // Global lock order of every marks writer (submission review): the attempt row first,
        // then its marks rows, then AI rows. A teacher's edit of the same answer waits here
        // (or this waits for it) instead of the two crossing.
        String lockedAttemptId = process.getStudentAttempt() != null ? process.getStudentAttempt().getId() : null;
        if (lockedAttemptId != null) {
            studentAttemptRepository.lockById(lockedAttemptId);
        }

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
        // A question that sits in two sections has a marks row in each; it was graded
        // once, and the verdict is the mark of every one of them (a LIMIT 1 lookup left
        // the other copy at its submit-time 0).
        if (!failed && payload.getMarksAwarded() != null) {
            String attemptId = process.getStudentAttempt() != null ? process.getStudentAttempt().getId() : null;
            String detailsJson = null;
            try {
                detailsJson = objectMapper.writeValueAsString(payload);
            } catch (JsonProcessingException ignored) {
                // Non-fatal — feedback is also on ai_question_evaluation row.
            }
            Date now = new Date();
            // Submission review guard (contract 7.3): the verdict above is always kept, but
            // it never replaces a mark a person set (MANUAL, AI_REVIEWED, OMR, OFFLINE) and
            // never changes the marks of a released result.
            boolean released = attemptId != null && studentAttemptRepository.findById(attemptId)
                    .map(a -> ReleaseResultStatusEnum.RELEASED.name().equals(a.getReportReleaseStatus()))
                    .orElse(false);
            if (released) {
                log.info("[copy-check] attempt {} is released; AI verdict for question {} kept on the review page only",
                        attemptId, payload.getQuestionId());
            }
            for (QuestionWiseMarks marks : released ? List.<QuestionWiseMarks>of() : questionWiseMarksRepository
                    .findAllByAttemptIdAndQuestionId(attemptId, payload.getQuestionId())) {
                if (vacademy.io.assessment_service.features.submission_review.model.MarksSource
                        .isProtected(marks.getMarksSource())) {
                    log.info("[copy-check] question {} of attempt {} was marked by a person ({}); AI mark not applied",
                            payload.getQuestionId(), attemptId, marks.getMarksSource());
                    continue;
                }
                marks.setMarks(payload.getMarksAwarded());
                marks.setAiEvaluatedAt(now);
                marks.setMarksSource("AI");
                // Legacy derivation shows it as "Checked by AI, needs your OK" (or Marked once released).
                marks.setMarkState(null);
                marks.setAiQuestionEvaluationId(evalRow.getId());
                marks.setRevision(marks.getRevision() + 1);
                if (detailsJson != null) {
                    marks.setAiEvaluationDetailsJson(detailsJson);
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
        if (fromAnotherRun(process, payload.getJobId())) {
            log.info("[copy-check] ignoring complete callback of job {} for process {}: it now runs as job {}",
                    payload.getJobId(), payload.getProcessId(), process.getAiServiceJobId());
            return;
        }
        // Attempt row lock FIRST (submission review global lock order: attempt, then its
        // marks and AI rows). Saving the run row below and locking the attempt after would
        // invert the order of a late per-question callback (attempt lock, then the run's
        // questions_completed) and Postgres would abort one of them as a deadlock.
        if (process.getStudentAttempt() != null) {
            studentAttemptRepository.lockById(process.getStudentAttempt().getId());
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
            // (The attempt row is already locked above.)
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
                Double r6 = r6TotalWhenTeacherMarked(attempt, rows);
                if (r6 != null) {
                    total = r6;
                }
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
                } else if (typedAnswerEvaluation.gradesCbeOnly(process)) {
                    // A run nobody asked for (CBE answers always go to the AI, on a test
                    // with AI evaluation off): its marks are a draft until a teacher
                    // reviews them. COMPLETED would let "release after the assessment
                    // ends" (AutoResultReleaseJob) publish them unreviewed. EVALUATING
                    // keeps it in the teacher's queue; Release Result, or the review
                    // page completing it, takes it from there.
                    attempt.setResultStatus(AttemptResultStatusEnum.EVALUATING.name());
                    log.info("[copy-check] process {} graded the CBE answers of attempt {}; held for teacher review",
                            process.getId(), attempt.getId());
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
                if (reportDataSender != null) {
                    // The AI reports read these marks; sent after this commits.
                    reportDataSender.sendAfterCommit(attempt.getId());
                }
                // "Release the rest when marked" (submission review 6.4): this run may have
                // finished the marking of an attempt the teacher asked to release once marked.
                // The listener decides under the lock from what still blocks a release (AI
                // drafts do not: the teacher's Release was their OK), not from result_status,
                // which a CBE-only run on an AI-off test deliberately leaves EVALUATING.
                if (eventPublisher != null && Boolean.TRUE.equals(attempt.getReleaseWhenMarked())) {
                    eventPublisher.publishEvent(new vacademy.io.assessment_service.features.submission_review
                            .service.ReviewEvents.AttemptReadyForRelease(attempt.getId(), null));
                }
            }
        }
        cancellationService.clearFlag(payload.getProcessId());
        log.info("[copy-check] process {} complete: {}/{} ({} questions)",
                payload.getProcessId(), payload.getTotalMarksAwarded(),
                payload.getTotalMaxMarks(), payload.getQuestionsEvaluated());
    }

    /**
     * Contract 7.3: when a person marked a question this run graded (their mark was kept,
     * see onQuestionDone), the run's own total would count the AI's mark instead - use the
     * submission review total (R6 over the stored marks). Null = keep the run's total.
     */
    private Double r6TotalWhenTeacherMarked(StudentAttempt attempt, List<AiQuestionEvaluation> rows) {
        if (submissionReleaseService == null || submissionReviewStore == null) return null;
        try {
            java.util.Set<String> graded = new java.util.HashSet<>();
            for (AiQuestionEvaluation r : rows) {
                if (r.getQuestion() != null) graded.add(r.getQuestion().getId());
            }
            boolean protectedRow = questionWiseMarksRepository.findByStudentAttemptId(attempt.getId()).stream()
                    .anyMatch(m -> m.getQuestion() != null && graded.contains(m.getQuestion().getId())
                            && vacademy.io.assessment_service.features.submission_review.model.MarksSource
                            .isProtected(m.getMarksSource()));
            if (!protectedRow) return null;
            var state = submissionReviewStore.attempt(attempt.getId());
            return state == null ? null : submissionReleaseService.snapshot(attempt, state).total();
        } catch (Exception e) {
            log.warn("[copy-check] could not compute the review total of attempt {}: {}", attempt.getId(),
                    e.getMessage());
            return null;
        }
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
        // An older run of a re-dispatched copy failing must not fail the run that
        // replaced it (whose own complete callback would then be ignored as reaped).
        if (fromAnotherRun(process, payload.getJobId())) {
            log.info("[copy-check] ignoring failed callback of job {} for process {}: it now runs as job {}",
                    payload.getJobId(), payload.getProcessId(), process.getAiServiceJobId());
            return;
        }
        process.setStatus(AiEvaluationStatusEnum.FAILED.name());
        process.setErrorMessage(withErrorCode(payload.getErrorCode(), payload.getErrorMessage()));
        process.setCompletedAt(new Date());
        processRepository.save(process);
        // A copy waiting for the teacher's language confirmation keeps its code in
        // front, so the batch panel can offer "Check in <language>"; other
        // failures show their message as before.
        notifyIntake(payload.getProcessId(), false,
                "language_needs_confirmation".equals(payload.getErrorCode())
                        ? withErrorCode(payload.getErrorCode(), payload.getErrorMessage())
                        : payload.getErrorMessage());
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

    /**
     * A terminal callback from an ai_service job this process no longer runs as: the
     * copy was re-dispatched (sweeper requeue, a submit retry) and a different job was
     * recorded for it. Unknown on either side (an older ai_service build sends no job id;
     * no job recorded yet) = not provable, so the callback is accepted as before.
     */
    static boolean fromAnotherRun(AiEvaluationProcess process, String callbackJobId) {
        String current = process.getAiServiceJobId();
        return StringUtils.hasText(callbackJobId) && StringUtils.hasText(current)
                && !callbackJobId.trim().equals(current.trim());
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
