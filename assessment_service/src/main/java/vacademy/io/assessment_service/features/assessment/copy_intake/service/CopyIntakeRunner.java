package vacademy.io.assessment_service.features.assessment.copy_intake.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.stereotype.Component;
import vacademy.io.assessment_service.features.assessment.copy_intake.entity.AiCopyIntakeBatch;
import vacademy.io.assessment_service.features.assessment.copy_intake.entity.AiCopyIntakeItem;
import vacademy.io.assessment_service.features.assessment.copy_intake.repository.AiCopyIntakeBatchRepository;
import vacademy.io.assessment_service.features.assessment.copy_intake.service.StudentNameMatcher.Candidate;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Future;

/**
 * Works through a batch's copies off the request thread: read the name, place
 * the copy, queue it. The AI check itself is then drained by the evaluation
 * poller under its in-flight cap.
 *
 * <p>Also a safety net: every couple of minutes any batch still RUNNING is
 * offered to the batch pool again - unread copies (a pod restarted mid-batch)
 * get read, and a batch whose last callback was missed gets settled. Running
 * twice is safe: each copy is claimed with an atomic status change, so
 * overlapping passes (two pods, or a sweep landing during the first pass)
 * share the work instead of repeating it. A batch already on this pod's pool
 * is not queued a second time.
 *
 * <p>Nothing here runs on the scheduler thread or the default async pool; see
 * {@link CopyIntakeExecutorConfig} for why.
 */
@Component
@Slf4j
public class CopyIntakeRunner {

    private final CopyIntakeService service;
    private final AiCopyIntakeBatchRepository batchRepository;
    private final ThreadPoolTaskExecutor batchExecutor;
    private final ThreadPoolTaskExecutor identifyExecutor;

    /** Batches this pod is working on or has queued; keeps the sweep from stacking duplicates. */
    private final Set<String> inFlight = ConcurrentHashMap.newKeySet();

    public CopyIntakeRunner(CopyIntakeService service,
                            AiCopyIntakeBatchRepository batchRepository,
                            @Qualifier("copyIntakeBatchExecutor") ThreadPoolTaskExecutor batchExecutor,
                            @Qualifier("copyIntakeIdentifyExecutor") ThreadPoolTaskExecutor identifyExecutor) {
        this.service = service;
        this.batchRepository = batchRepository;
        this.batchExecutor = batchExecutor;
        this.identifyExecutor = identifyExecutor;
    }

    /** Queue a pass over the batch; returns at once. */
    public void run(String batchId) {
        if (!inFlight.add(batchId)) {
            return;      // already queued or running here
        }
        try {
            batchExecutor.execute(() -> {
                try {
                    process(batchId);
                } catch (Exception e) {
                    log.error("[copy-intake] batch {} pass failed: {}", batchId, e.getMessage(), e);
                } finally {
                    inFlight.remove(batchId);
                }
            });
        } catch (RuntimeException e) {
            // TaskRejectedException from a full queue: forget the batch so the
            // sweep can offer it again.
            inFlight.remove(batchId);
            log.warn("[copy-intake] batch pool full; batch {} will be offered again by the sweep", batchId);
        }
    }

    void process(String batchId) {
        AiCopyIntakeBatch batch = batchRepository.findById(batchId).orElse(null);
        if (batch == null || !AiCopyIntakeBatch.RUNNING.equals(batch.getStatus())) return;

        service.recoverStaleIdentifying(batchId);
        List<AiCopyIntakeItem> pending = service.pendingItems(batchId);
        if (!pending.isEmpty()) {
            // The student list is loaded once per pass, not once per copy: the
            // batch learners come from admin-core over HTTP. If that is down the
            // copies stay PENDING and the sweep tries again in a couple of minutes.
            List<Candidate> candidates;
            try {
                candidates = service.candidatesFor(batch.getAssessmentId(), batch.getInstituteId());
            } catch (Exception e) {
                log.error("[copy-intake] batch {}: student list unavailable: {}", batchId, e.getMessage());
                service.noteBatchError(batchId, "Could not load the student list (" + e.getMessage()
                        + "); the copies will be read again shortly.");
                return;
            }
            if (batch.getErrorMessage() != null) service.noteBatchError(batchId, null);
            log.info("[copy-intake] batch {}: reading {} copies against {} students",
                    batchId, pending.size(), candidates.size());
            readAll(pending, candidates);
        }
        service.syncQueuedItems(batchId);
        service.finalizeIfDone(batchId);
    }

    /**
     * Hand every copy to the shared reader pool and wait for this batch's
     * share. Each copy is claimed inside identifyAndPlace, so a copy another
     * pass already took is skipped there at no cost; one the pool cannot take
     * right now simply stays PENDING for the next pass.
     */
    private void readAll(List<AiCopyIntakeItem> pending, List<Candidate> candidates) {
        List<Future<?>> futures = new ArrayList<>();
        for (AiCopyIntakeItem item : pending) {
            try {
                futures.add(identifyExecutor.submit(() -> {
                    try {
                        service.identifyAndPlace(item.getId(), candidates);
                    } catch (Exception e) {
                        log.error("[copy-intake] item {} failed: {}", item.getId(), e.getMessage(), e);
                    }
                }));
            } catch (RuntimeException e) {
                log.warn("[copy-intake] reader pool full; copy {} waits for the next pass", item.getId());
            }
        }
        for (Future<?> f : futures) {
            try {
                f.get();
            } catch (Exception ignored) {
                // logged inside the task
            }
        }
    }

    /**
     * Resume interrupted batches and settle finished ones nothing reported.
     * Only offers work to the batch pool - this runs on the single scheduler
     * thread the evaluation poller shares, and must return in milliseconds.
     */
    @Scheduled(fixedDelayString = "${assessment.copy-intake.sweep-interval-ms:120000}",
            initialDelayString = "${assessment.copy-intake.sweep-initial-delay-ms:60000}")
    public void sweep() {
        try {
            for (AiCopyIntakeBatch batch : batchRepository.findByStatus(AiCopyIntakeBatch.RUNNING)) {
                run(batch.getId());
            }
        } catch (Exception e) {
            log.warn("[copy-intake] sweep failed: {}", e.getMessage());
        }
    }
}
