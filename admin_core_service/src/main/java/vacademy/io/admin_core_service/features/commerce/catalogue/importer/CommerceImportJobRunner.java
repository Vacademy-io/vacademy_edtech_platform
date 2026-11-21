package vacademy.io.admin_core_service.features.commerce.catalogue.importer;

import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.entity.CommerceImportJob;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.repository.CommerceImportJobRepository;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.List;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Runs import jobs off the request thread and takes up jobs whose worker stopped.
 *
 * <p>Its own two threads, not the shared task executor: an import of a few thousand rows
 * runs for minutes and must not hold a thread that mail and workflows wait for.
 *
 * <p>Which pod runs a job is decided by one UPDATE in the database (the claim), so the sweep
 * needs no scheduler lock: every pod may look, only one claim returns a row.
 */
@Slf4j
@Component
public class CommerceImportJobRunner {

    /** A worker saves progress after every product; this long without one means it is gone. */
    static final Duration STALE_AFTER = Duration.ofMinutes(10);
    /** A file that stops its worker this many times is given up, not retried for ever. */
    static final int MAX_ATTEMPTS = 5;

    private static final List<String> ACTIVE = List.of(CommerceImportJob.QUEUED, CommerceImportJob.RUNNING);

    private final CommerceImportJobRepository jobRepository;
    private final CommerceImportJobProcessor processor;
    private final ThreadPoolExecutor executor;

    public CommerceImportJobRunner(CommerceImportJobRepository jobRepository,
                                   CommerceImportJobProcessor processor) {
        this.jobRepository = jobRepository;
        this.processor = processor;
        AtomicInteger counter = new AtomicInteger();
        this.executor = new ThreadPoolExecutor(2, 2, 60, TimeUnit.SECONDS, new ArrayBlockingQueue<>(50), task -> {
            Thread thread = new Thread(task, "commerce-import-" + counter.incrementAndGet());
            thread.setDaemon(true);
            return thread;
        });
        this.executor.allowCoreThreadTimeOut(true);
    }

    /** Called after the job row is committed. A job that cannot be queued here waits for the sweep. */
    public void dispatch(String jobId) {
        try {
            executor.execute(() -> {
                try {
                    if (jobRepository.claimQueued(jobId, LocalDateTime.now()) == 1) {
                        processor.run(jobId);
                    }
                } catch (Exception e) {
                    log.error("commerce import job {} could not be started: {}", jobId, e.getMessage(), e);
                }
            });
        } catch (RejectedExecutionException e) {
            log.warn("commerce import job {} is waiting: all import workers of this pod are busy", jobId);
        }
    }

    @Scheduled(fixedDelay = 120_000, initialDelay = 60_000)
    public void sweep() {
        try {
            sweepOnce();
        } catch (Exception e) {
            log.error("COMMERCE_ALERT import sweep failed: {}", e.getMessage(), e);
        }
    }

    /** One pass; returns how many jobs this pod took up. */
    int sweepOnce() {
        LocalDateTime now = LocalDateTime.now();
        LocalDateTime staleBefore = now.minus(STALE_AFTER);
        int taken = 0;
        for (CommerceImportJob job : jobRepository
                .findTop20ByStatusInAndHeartbeatAtBeforeOrderByHeartbeatAtAsc(ACTIVE, staleBefore)) {
            String jobId = job.getId();
            if (job.getAttempt() != null && job.getAttempt() >= MAX_ATTEMPTS) {
                if (jobRepository.abandon(jobId, "the import stopped " + MAX_ATTEMPTS
                        + " times without finishing; the rows already imported are kept", now, staleBefore) == 1) {
                    log.error("COMMERCE_ALERT import job {} of institute {} was given up after {} attempts",
                            jobId, job.getInstituteId(), MAX_ATTEMPTS);
                }
                continue;
            }
            if (executor.getQueue().remainingCapacity() == 0) {
                break;
            }
            if (jobRepository.claimStale(jobId, now, staleBefore) == 1) {
                taken++;
                log.warn("commerce import job {} is resumed at product {} (attempt {})", jobId,
                        job.getNextGroupIndex(), job.getAttempt() == null ? 1 : job.getAttempt() + 1);
                try {
                    executor.execute(() -> processor.run(jobId));
                } catch (RejectedExecutionException e) {
                    log.warn("commerce import job {} is waiting: all import workers of this pod are busy", jobId);
                }
            }
        }
        return taken;
    }

    @PreDestroy
    void shutdown() {
        executor.shutdownNow();
    }
}
