package vacademy.io.admin_core_service.features.commerce.media;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceProductMedia;
import vacademy.io.admin_core_service.features.commerce.catalogue.enums.MediaKind;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceProductMediaRepository;
import vacademy.io.common.exceptions.ResourceNotFoundException;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.LongSupplier;

/**
 * Keeps {@code commerce_product_media.renditions_json} in step with the gallery.
 *
 * <p>Nothing here runs inside the request that saves a product. An attach asks for the work
 * after its transaction has committed, on a small pool; a scheduled job
 * ({@link CommerceRenditionJob}) takes whatever is still pending, which also covers rows that
 * an import wrote without going through the attach call, tries that failed, and a pod that
 * stopped halfway. A failure only changes the state in the column.
 *
 * <p>A row is taken by a compare-and-swap on the column, so two pods never work on the same
 * row, and a result is only written when the row still shows the file the work was done for.
 * No database connection is held while the media service works.
 */
@Slf4j
@Service
public class CommerceRenditionService {

    public enum Outcome { READY, RETRY_LATER, FAILED, SKIPPED }

    private static final String ENTITY_MEDIA = "PRODUCT_MEDIA";
    private static final int QUEUE_SIZE = 200;

    private final CommerceProductMediaRepository mediaRepository;
    private final CommerceRenditionClient client;
    private final CommerceAuditService auditService;
    /**
     * A plain mapper of its own: the compare-and-swap needs the state written exactly as it
     * was read, null values included, whatever the application-wide mapper is set to leave out.
     */
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final ExecutorService executor;
    private final AtomicBoolean jobRunning = new AtomicBoolean();
    private volatile Thread jobThread;
    private LongSupplier nowSeconds = () -> System.currentTimeMillis() / 1000;

    public CommerceRenditionService(CommerceProductMediaRepository mediaRepository,
                                    CommerceRenditionClient client,
                                    CommerceAuditService auditService) {
        this.mediaRepository = mediaRepository;
        this.client = client;
        this.auditService = auditService;
        AtomicInteger counter = new AtomicInteger();
        // A full queue drops the request; the row stays pending and the job takes it.
        this.executor = new ThreadPoolExecutor(2, 2, 60, TimeUnit.SECONDS, new ArrayBlockingQueue<>(QUEUE_SIZE),
                runnable -> {
                    Thread thread = new Thread(runnable, "commerce-rendition-" + counter.incrementAndGet());
                    thread.setDaemon(true);
                    return thread;
                }, new ThreadPoolExecutor.DiscardPolicy());
    }

    void setClock(LongSupplier nowSeconds) {
        this.nowSeconds = nowSeconds;
    }

    @PreDestroy
    void shutdown() {
        executor.shutdownNow();
        Thread pass = jobThread;
        if (pass != null) {
            pass.interrupt();
        }
    }

    /**
     * Starts the work for one gallery row once the surrounding transaction has committed.
     * Never throws: the save that calls this must not fail because of it.
     */
    public void requestAfterCommit(String mediaRowId) {
        if (mediaRowId == null) {
            return;
        }
        try {
            if (!TransactionSynchronizationManager.isSynchronizationActive()) {
                submit(mediaRowId);
                return;
            }
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    submit(mediaRowId);
                }
            });
        } catch (RuntimeException e) {
            log.warn("Could not queue renditions for gallery row {}; the job will take it: {}", mediaRowId,
                    e.getMessage());
        }
    }

    private void submit(String mediaRowId) {
        try {
            executor.execute(() -> {
                try {
                    process(mediaRowId);
                } catch (RuntimeException e) {
                    log.warn("Renditions for gallery row {} failed unexpectedly: {}", mediaRowId, e.getMessage(), e);
                }
            });
        } catch (RuntimeException e) {
            log.warn("Could not queue renditions for gallery row {}; the job will take it: {}", mediaRowId,
                    e.getMessage());
        }
    }

    /**
     * The gallery row now points at another file: its old renditions are dropped and new ones
     * asked for. Called inside the transaction that changes the row.
     */
    public void resetForNewFile(CommerceProductMedia media) {
        mediaRepository.clearRenditions(media.getInstituteId(), media.getId());
        media.setRenditionsJson(null);
        requestAfterCommit(media.getId());
    }

    /** One try for one row. Safe to call for any row at any time; does nothing unless the row is due. */
    public Outcome process(String mediaRowId) {
        CommerceProductMedia row = mediaRepository.findById(mediaRowId).orElse(null);
        if (row == null || !MediaKind.IMAGE.name().equals(row.getKind())) {
            return Outcome.SKIPPED;
        }
        String mediaId = row.getMediaId();
        Map<String, Object> before = row.getRenditionsJson();
        long now = nowSeconds.getAsLong();
        if (!CommerceRenditionState.isDue(before, mediaId, now)) {
            return Outcome.SKIPPED;
        }
        Map<String, Object> claim = CommerceRenditionState.processing(before, mediaId, now);
        if (mediaRepository.swapRenditions(mediaRowId, mediaId, json(before), json(claim)) != 1) {
            return Outcome.SKIPPED;
        }
        try {
            CommerceRenditionClient.Result result = client.generate(mediaId, owners(row));
            Map<String, Object> ready = CommerceRenditionState.ready(claim, mediaId, result.urls(),
                    result.pipelineVersion());
            int written = mediaRepository.swapRenditionsAndSize(mediaRowId, mediaId, json(claim), json(ready),
                    result.width(), result.height());
            if (written != 1) {
                log.info("Renditions for gallery row {} were made but the row changed meanwhile", mediaRowId);
                return Outcome.SKIPPED;
            }
            return Outcome.READY;
        } catch (CommerceRenditionException e) {
            return recordFailure(mediaRowId, mediaId, claim, e.getCode(), e.isRetryable(), e.getMessage());
        } catch (RuntimeException e) {
            return recordFailure(mediaRowId, mediaId, claim, "UNEXPECTED", true, e.getMessage());
        }
    }

    /** The ids the file may have been uploaded for: the institute, and the product of the row. */
    private static List<String> owners(CommerceProductMedia row) {
        List<String> owners = new ArrayList<>();
        if (row.getInstituteId() != null) {
            owners.add(row.getInstituteId());
        }
        if (row.getPackageId() != null) {
            owners.add(row.getPackageId());
        }
        return owners;
    }

    private Outcome recordFailure(String mediaRowId, String mediaId, Map<String, Object> claim, String code,
                                  boolean retryable, String message) {
        Map<String, Object> next = CommerceRenditionState.afterFailure(claim, mediaId, code, retryable,
                nowSeconds.getAsLong());
        boolean failed = CommerceRenditionState.FAILED.equals(next.get(CommerceRenditionState.KEY_STATUS));
        try {
            mediaRepository.swapRenditions(mediaRowId, mediaId, json(claim), json(next));
        } catch (RuntimeException e) {
            // The claim goes stale and the job takes the row again.
            log.warn("Could not record the rendition failure of gallery row {}: {}", mediaRowId, e.getMessage());
        }
        if (failed && retryable) {
            log.error("COMMERCE_ALERT renditions for gallery row {} gave up after {} tries ({}): {}", mediaRowId,
                    CommerceRenditionState.attempts(next), code, message);
        } else if (failed) {
            // The file itself was refused (not an image, too large): nothing for an operator to do.
            log.warn("Renditions for gallery row {} refused ({}): {}", mediaRowId, code, message);
        } else {
            log.warn("Renditions for gallery row {} not made ({}), try {} of {}: {}", mediaRowId, code,
                    CommerceRenditionState.attempts(next), CommerceRenditionState.MAX_ATTEMPTS, message);
        }
        return failed ? Outcome.FAILED : Outcome.RETRY_LATER;
    }

    /** One pass of the job: rows that are due, oldest first. Returns how many became READY. */
    public int processDue(int limit, long deadlineMillis) {
        return processDue(limit, deadlineMillis, 0L);
    }

    /**
     * As {@link #processDue(int, long)}, with a pause after every image the media service worked
     * on, so that a backfill does not keep that service busy without a break.
     */
    public int processDue(int limit, long deadlineMillis, long pauseMillis) {
        long now = nowSeconds.getAsLong();
        int ready = 0;
        for (String id : mediaRepository.findIdsDueForRenditions(now,
                now - CommerceRenditionState.STALE_CLAIM_SECONDS, limit)) {
            if (System.currentTimeMillis() > deadlineMillis || Thread.currentThread().isInterrupted()) {
                break;
            }
            try {
                Outcome outcome = process(id);
                if (outcome == Outcome.READY) {
                    ready++;
                }
                if (outcome != Outcome.SKIPPED && pauseMillis > 0) {
                    Thread.sleep(pauseMillis);
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            } catch (RuntimeException e) {
                log.warn("Renditions for gallery row {} failed unexpectedly: {}", id, e.getMessage(), e);
            }
        }
        return ready;
    }

    /**
     * Starts one pass of the job on a thread of its own and returns at once; false when the
     * pass of the minute before is still running on this pod. The scheduler thread that calls
     * this is one of four shared by every scheduled job of the service and must not wait for
     * the media service.
     */
    public boolean processDueInBackground(int limit, long budgetMillis, long pauseMillis) {
        if (!jobRunning.compareAndSet(false, true)) {
            return false;
        }
        Thread pass = new Thread(() -> {
            try {
                int ready = processDue(limit, System.currentTimeMillis() + budgetMillis, pauseMillis);
                if (ready > 0) {
                    log.info("Commerce rendition job: {} image(s) now have renditions", ready);
                }
            } catch (RuntimeException e) {
                log.error("COMMERCE_ALERT rendition job failed: {}", e.getMessage(), e);
            } finally {
                jobRunning.set(false);
            }
        }, "commerce-rendition-job");
        pass.setDaemon(true);
        jobThread = pass;
        try {
            pass.start();
            return true;
        } catch (RuntimeException | Error e) {
            jobRunning.set(false);
            log.warn("Could not start the rendition job pass: {}", e.getMessage());
            return false;
        }
    }

    /**
     * The backfill command: queues the images of an institute (or of one product) again. Without
     * {@code force} only images that have no finished renditions; with it every image, which
     * is cheap because the media service keeps what it already made.
     */
    @Transactional
    public int requeue(String instituteId, String actorUserId, String packageId, boolean force) {
        String product = packageId == null || packageId.isBlank() ? null : packageId.trim();
        int queued = mediaRepository.requeueRenditions(instituteId, product, force,
                json(CommerceRenditionState.requeuePatch()));
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("package_id", product);
        detail.put("force", force);
        detail.put("queued", queued);
        auditService.record(instituteId, actorUserId, "MEDIA_RENDITIONS_REQUEUED", "INSTITUTE", instituteId,
                json(detail));
        return queued;
    }

    /** Queues one gallery row again from the first try and starts on it right after the commit. */
    @Transactional
    public void retryOne(String instituteId, String actorUserId, String mediaRowId) {
        CommerceProductMedia row = mediaRepository.findByInstituteIdAndId(instituteId, mediaRowId)
                .orElseThrow(() -> new ResourceNotFoundException("Gallery entry not found"));
        mediaRepository.clearRenditions(instituteId, row.getId());
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("package_id", row.getPackageId());
        detail.put("media_id", row.getMediaId());
        auditService.record(instituteId, actorUserId, "MEDIA_RENDITIONS_RETRY", ENTITY_MEDIA, row.getId(),
                json(detail));
        requestAfterCommit(row.getId());
    }

    /** How many images of the institute are in each state. */
    @Transactional(readOnly = true)
    public Map<String, Long> statusCounts(String instituteId) {
        Map<String, Long> counts = new LinkedHashMap<>();
        for (String status : new String[] {CommerceRenditionState.PENDING, CommerceRenditionState.PROCESSING,
                CommerceRenditionState.READY, CommerceRenditionState.FAILED}) {
            counts.put(status, 0L);
        }
        for (Object[] row : mediaRepository.countRenditionStatuses(instituteId)) {
            String status = String.valueOf(row[0]);
            if (counts.containsKey(status)) {
                counts.merge(status, ((Number) row[1]).longValue(), Long::sum);
            }
        }
        return counts;
    }

    private String json(Map<String, Object> value) {
        if (value == null) {
            return null;
        }
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("rendition state is not JSON", e);
        }
    }
}
