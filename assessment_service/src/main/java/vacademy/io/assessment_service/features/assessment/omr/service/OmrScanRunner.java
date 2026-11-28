package vacademy.io.assessment_service.features.assessment.omr.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.stereotype.Component;
import vacademy.io.assessment_service.features.assessment.omr.client.AiServiceOmrClient;
import vacademy.io.assessment_service.features.assessment.omr.entity.OmrScanBatch;
import vacademy.io.assessment_service.features.assessment.omr.entity.OmrScanItem;
import vacademy.io.assessment_service.features.assessment.omr.repository.OmrScanBatchRepository;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadPoolExecutor;

/**
 * Works through an OMR upload off the request thread: split every file into sheets,
 * then read the sheets file by file in chunks and place them.
 *
 * <p>As CopyIntakeRunner: a sweep every couple of minutes offers every RUNNING batch
 * to the pool again (a pod restarted mid-batch, or ai_service answered 429), and
 * running twice is safe because every file and sheet is claimed with an atomic status
 * change. A batch already queued on this pod is not queued a second time. Nothing runs
 * on the scheduler thread or the default async pool.
 */
@Component
@Slf4j
public class OmrScanRunner {

    private final OmrScanService service;
    private final OmrScanBatchRepository batchRepository;
    private final ThreadPoolTaskExecutor executor;
    private final Set<String> inFlight = ConcurrentHashMap.newKeySet();

    public OmrScanRunner(OmrScanService service, OmrScanBatchRepository batchRepository,
                         @Qualifier("omrScanExecutor") ThreadPoolTaskExecutor executor) {
        this.service = service;
        this.batchRepository = batchRepository;
        this.executor = executor;
    }

    /** Queue a pass over the batch; returns at once. */
    public void run(String batchId) {
        if (!inFlight.add(batchId)) return;
        try {
            executor.execute(() -> {
                try {
                    process(batchId);
                } catch (AiServiceOmrClient.OmrBusyException e) {
                    log.info("[omr] batch {}: reader busy, the sweep will continue it", batchId);
                } catch (Exception e) {
                    log.error("[omr] batch {} pass failed: {}", batchId, e.getMessage(), e);
                } finally {
                    inFlight.remove(batchId);
                }
            });
        } catch (RuntimeException e) {
            inFlight.remove(batchId);
            log.warn("[omr] pool full; batch {} will be offered again by the sweep", batchId);
        }
    }

    void process(String batchId) {
        OmrScanBatch batch = batchRepository.findById(batchId).orElse(null);
        if (batch == null || !OmrScanBatch.RUNNING.equals(batch.getStatus())) return;
        service.recoverStale(batchId);

        for (OmrScanItem file : service.pendingFiles(batchId)) {
            service.split(file.getId());
        }

        List<OmrScanItem> sheets = service.pendingSheets(batchId);
        if (!sheets.isEmpty()) {
            OmrScanService.PassContext ctx;
            try {
                ctx = service.context(batch);
            } catch (Exception e) {
                // The learner list (admin-core) is down: leave the sheets PENDING for the sweep.
                log.error("[omr] batch {}: could not load the set or the learners: {}", batchId, e.getMessage());
                service.noteBatchError(batchId, "Could not load the learners (" + e.getMessage()
                        + "); the sheets will be read again shortly.");
                return;
            }
            if (batch.getErrorMessage() != null) service.noteBatchError(batchId, null);

            Map<String, List<OmrScanItem>> byFile = new LinkedHashMap<>();
            for (OmrScanItem s : sheets) byFile.computeIfAbsent(s.getFileId(), k -> new ArrayList<>()).add(s);
            for (List<OmrScanItem> fileSheets : byFile.values()) {
                fileSheets.sort(Comparator.comparing(OmrScanItem::getPageNo));
                for (int from = 0; from < fileSheets.size(); from += OmrScanService.READ_CHUNK) {
                    service.readChunk(ctx, fileSheets.subList(from, Math.min(fileSheets.size(), from + OmrScanService.READ_CHUNK)));
                }
            }
        }
        service.finalizeIfDone(batchId);
    }

    @Scheduled(fixedDelayString = "${assessment.omr.sweep-interval-ms:120000}",
            initialDelayString = "${assessment.omr.sweep-initial-delay-ms:75000}")
    public void sweep() {
        try {
            for (OmrScanBatch batch : batchRepository.findByStatus(OmrScanBatch.RUNNING)) {
                run(batch.getId());
            }
        } catch (Exception e) {
            log.warn("[omr] sweep failed: {}", e.getMessage());
        }
    }

    /** Thread budget for OMR uploads, kept off the shared pools (see CopyIntakeExecutorConfig). */
    @Configuration
    public static class OmrScanExecutorConfig {
        @Bean("omrScanExecutor")
        public ThreadPoolTaskExecutor omrScanExecutor(@Value("${assessment.omr.batch-parallelism:2}") int parallelism) {
            ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
            executor.setCorePoolSize(parallelism);
            executor.setMaxPoolSize(parallelism);
            executor.setQueueCapacity(100);
            executor.setThreadNamePrefix("omr-scan-");
            executor.setRejectedExecutionHandler(new ThreadPoolExecutor.AbortPolicy());
            executor.setWaitForTasksToCompleteOnShutdown(false);
            executor.initialize();
            return executor;
        }
    }
}
