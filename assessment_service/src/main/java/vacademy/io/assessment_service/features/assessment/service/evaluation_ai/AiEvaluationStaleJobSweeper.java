package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.assessment_service.features.assessment.entity.AiEvaluationProcess;
import vacademy.io.assessment_service.features.assessment.repository.AiEvaluationProcessRepository;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Date;
import java.util.List;

/**
 * Marks AI-evaluation runs that have been stuck in a non-terminal state past a
 * timeout as FAILED. Without this, an ai_service crash / deploy mid-grade (no
 * terminal callback ever arrives) leaves a process PROCESSING forever: the
 * progress page hangs, the dashboard shows it running, and — because of the
 * trigger-idempotency guard — the teacher can't even re-trigger it.
 *
 * <p>Staleness is measured from {@code started_at}: a single-attempt copy grades
 * in minutes (OCR ~5 min + per-question grading), so a non-terminal process
 * older than the (generous, configurable) timeout is certainly dead. Marking it
 * FAILED surfaces it as a retryable row on the evaluations dashboard.
 *
 * <p>The sweep only transitions rows to FAILED (no counters, re-dispatch, or LLM
 * calls), so it is idempotent and safe to run on every replica.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class AiEvaluationStaleJobSweeper {

    private final AiEvaluationProcessRepository processRepository;

    /** States that mean "still running" and are eligible to be swept if too old. */
    /**
     * Rows with the AI service. PENDING is deliberately absent: a queued copy is
     * waiting for the in-flight cap, not stuck, however long it has been there.
     */
    private static final List<String> DISPATCHED = AiEvaluationQueuePoller.IN_FLIGHT;

    @Value("${assessment.ai-evaluation.stale-timeout-minutes:30}")
    private long staleTimeoutMinutes;

    /**
     * A silent copy goes back to the queue this many times before it is failed.
     * The usual cause is an ai-service deploy that killed the in-process job;
     * re-running it costs tokens but never credits twice (billing is idempotent
     * on the process id), and a student's copy is not lost to a redeploy.
     */
    @Value("${assessment.ai-evaluation.max-requeues:2}")
    private int maxRequeues;

    @Scheduled(fixedDelayString = "${assessment.ai-evaluation.sweeper-interval-ms:300000}",
            initialDelayString = "${assessment.ai-evaluation.sweeper-initial-delay-ms:120000}")
    @Transactional
    public void sweepStaleProcesses() {
        Date cutoff = Date.from(Instant.now().minus(staleTimeoutMinutes, ChronoUnit.MINUTES));
        List<AiEvaluationProcess> silent = processRepository.findSilentDispatched(DISPATCHED, cutoff);
        if (silent.isEmpty()) {
            return;
        }
        Date now = new Date();
        int requeued = 0, failed = 0, moved = 0;
        // Guarded per-row updates, not a saveAll of what was read: a complete
        // callback (or a fresh heartbeat) landing between the read and the write
        // must win, not be turned back into PENDING or FAILED (gate G6).
        for (AiEvaluationProcess process : silent) {
            String id = process.getId();
            String status = process.getStatus();
            int retries = process.getRetryCount() == null ? 0 : process.getRetryCount();
            if (retries < maxRequeues) {
                String message = "No response from the AI service for " + staleTimeoutMinutes
                        + " min; queued again (attempt " + (retries + 2) + ").";
                if (processRepository.sweepRequeue(id, status, cutoff, retries + 1, message, now) > 0) {
                    requeued++;
                } else {
                    moved++;
                }
            } else {
                String message = "Evaluation timed out " + (retries + 1)
                        + " times with no response from the AI service. Please retry.";
                if (processRepository.sweepFail(id, status, cutoff, message, now) > 0) {
                    failed++;
                } else {
                    moved++;
                }
            }
        }
        log.warn("[ai-eval-sweeper] {} silent evaluation(s): {} queued again, {} failed, {} moved on meanwhile "
                + "(no heartbeat for > {} min)", silent.size(), requeued, failed, moved, staleTimeoutMinutes);
    }
}
