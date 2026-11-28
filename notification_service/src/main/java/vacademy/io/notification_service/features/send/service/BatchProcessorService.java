package vacademy.io.notification_service.features.send.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Async;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository;
import vacademy.io.notification_service.features.send.dto.UnifiedSendRequest;
import vacademy.io.notification_service.features.send.dto.UnifiedSendResponse;
import vacademy.io.notification_service.features.send.entity.SendBatch;
import vacademy.io.notification_service.features.send.repository.SendBatchRepository;

import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Separate bean so Spring's @Async proxy works (avoids self-invocation issue).
 *
 * <p>Admin bulk email (see {@link #PACED_EMAIL_SOURCES}) runs on {@link BulkEmailLanes}, stops when
 * the provider starts rejecting a large send, and resumes from its saved offset after a pod restart,
 * because at a paced rate a big blast outlives any deploy. Everything else keeps the old fast path:
 * "your live session has started" must go out now, and must never be resumed hours later.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class BatchProcessorService {

    static final String STATUS_STOPPED = "STOPPED";

    /** The bulk email paths an admin triggers. Live class, content and system mail is not paced. */
    static final Set<String> PACED_EMAIL_SOURCES =
            Set.of("STUDENT_MANAGEMENT_BULK_EMAIL", "AUDIENCE", "WORKFLOW");

    private static final String CHANNEL_EMAIL = "EMAIL";
    private static final int EMAIL_CHUNK_SIZE = 25; // also the most a restart can send twice
    private static final int DEFAULT_CHUNK_SIZE = 50;
    private static final long DEFAULT_CHUNK_GAP_MS = 200;
    private static final long STALE_AFTER_MINUTES = 5;
    private static final long RECOVER_WITHIN_HOURS = 24;
    private static final long OUTCOME_WINDOW_MINUTES = 15;
    private static final long OUTCOME_CACHE_MS = 60_000;
    private static final int MIN_RESOLVED_FOR_STOP = 100;
    // Small batches are often time-bound mail to real learners, and a stopped batch is not retried.
    private static final int MIN_RECIPIENTS_FOR_STOP = 500;
    private static final int MAX_ERROR_LENGTH = 250;

    private final SendBatchRepository sendBatchRepository;
    private final ObjectMapper objectMapper;
    private final BulkEmailLanes emailLanes;
    private final NotificationLogRepository notificationLogRepository;

    @Value("${notification.bulk-email.auto-stop-enabled:true}")
    private boolean autoStopEnabled = true;

    private record OutcomeCheck(long checkedAtMs, String stopReason) {
    }

    private final Map<String, OutcomeCheck> outcomeChecks = new ConcurrentHashMap<>();

    // Injected lazily to avoid circular dependency — set by UnifiedSendService
    private SendChannelRouter channelRouter;

    public void setChannelRouter(SendChannelRouter channelRouter) {
        this.channelRouter = channelRouter;
    }

    @Async
    public void processAsyncBatch(String batchId) {
        if (channelRouter == null) {
            log.error("BatchProcessorService.channelRouter not initialized yet for batch {}", batchId);
            sendBatchRepository.finishBatch(batchId, "FAILED", 0, 0,
                    "Internal error: channel router not initialized", null, LocalDateTime.now());
            return;
        }
        SendBatch batch = sendBatchRepository.findById(batchId).orElse(null);
        if (batch == null) return;

        if (isPacedEmail(batch.getChannel(), batch.getSource())) {
            emailLanes.submit(batch.getInstituteId(), batch.getSource(), batchId, () -> runBatch(batchId));
        } else {
            runBatch(batchId);
        }
    }

    /** Puts email batches back on a lane when the pod running them died. Waits past a rolling deploy. */
    @Scheduled(initialDelayString = "PT5M", fixedDelayString = "PT2M")
    public void recoverInterruptedEmailBatches() {
        if (channelRouter == null) return;
        try {
            LocalDateTime now = LocalDateTime.now();
            LocalDateTime staleBefore = now.minusMinutes(STALE_AFTER_MINUTES);
            List<Object[]> stale = sendBatchRepository.findStaleEmailBatches(
                    PACED_EMAIL_SOURCES, staleBefore, now.minusHours(RECOVER_WITHIN_HOURS));
            for (Object[] row : stale) {
                String batchId = (String) row[0];
                if (emailLanes.isPending(batchId)) continue;
                if (sendBatchRepository.requeueStaleBatch(batchId, staleBefore, now) == 1) {
                    log.warn("Resuming interrupted email batch {}", batchId);
                    emailLanes.submit((String) row[1], (String) row[2], batchId, () -> runBatch(batchId));
                }
            }
        } catch (Exception e) {
            log.error("Could not check for interrupted email batches: {}", e.getMessage(), e);
        }
    }

    private void runBatch(String batchId) {
        int sent = 0;
        int failed = 0;
        try {
            SendBatch batch = sendBatchRepository.findById(batchId).orElse(null);
            if (batch == null) return;
            // Atomic, so a batch recovered while another pod still holds it runs only once.
            if (sendBatchRepository.claimBatch(batchId, LocalDateTime.now()) == 0) return;

            sent = batch.getSentCount();
            failed = batch.getFailedCount();
            String instituteId = batch.getInstituteId();
            boolean paced = isPacedEmail(batch.getChannel(), batch.getSource());
            boolean canAutoStop = paced && batch.getTotalRecipients() >= MIN_RECIPIENTS_FOR_STOP;

            UnifiedSendRequest request = objectMapper.readValue(
                    batch.getRequestPayload(), UnifiedSendRequest.class);

            List<UnifiedSendRequest.Recipient> allRecipients = request.getRecipients();
            List<UnifiedSendResponse.RecipientResult> results = new ArrayList<>();
            int chunkSize = paced ? EMAIL_CHUNK_SIZE : DEFAULT_CHUNK_SIZE;

            for (int i = sent + failed; i < allRecipients.size(); i += chunkSize) {
                int end = Math.min(i + chunkSize, allRecipients.size());
                List<UnifiedSendRequest.Recipient> chunk = allRecipients.subList(i, end);

                String stopReason = canAutoStop ? currentStopReason(instituteId) : null;
                if (stopReason != null) {
                    String message = "Auto-stopped at " + i + " of " + allRecipients.size() + ": " + stopReason;
                    log.error("Email batch {} of institute {}: {}", batchId, instituteId, message);
                    finish(batchId, STATUS_STOPPED, sent, failed, message, results);
                    return;
                }
                if (paced) {
                    emailLanes.acquire(instituteId, chunk.size());
                }

                UnifiedSendRequest chunkRequest = UnifiedSendRequest.builder()
                        .instituteId(request.getInstituteId())
                        .channel(request.getChannel())
                        .templateName(request.getTemplateName())
                        .languageCode(request.getLanguageCode())
                        .recipients(chunk)
                        .options(request.getOptions())
                        .build();

                UnifiedSendResponse chunkResponse = channelRouter.routeSync(chunkRequest);
                if (chunkResponse.getResults() != null) {
                    results.addAll(chunkResponse.getResults());
                    for (UnifiedSendResponse.RecipientResult result : chunkResponse.getResults()) {
                        if (result.isSuccess()) sent++;
                        else failed++;
                    }
                }

                // Progress doubles as the heartbeat and the resume offset.
                sendBatchRepository.updateProgress(batchId, sent, failed, LocalDateTime.now());

                if (!paced && end < allRecipients.size()) {
                    try {
                        Thread.sleep(DEFAULT_CHUNK_GAP_MS);
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                        log.warn("Batch {} processing interrupted", batchId);
                        break;
                    }
                }
            }

            finish(batchId, failed == 0 ? "COMPLETED" : "PARTIAL", sent, failed, null, results);
            log.info("Batch {} completed: sent={}, failed={}", batchId, sent, failed);

        } catch (Exception e) {
            log.error("Async batch processing failed for {}: {}", batchId, e.getMessage(), e);
            sendBatchRepository.finishBatch(batchId, "FAILED", sent, failed,
                    truncate(e.getMessage()), null, LocalDateTime.now());
        }
    }

    static boolean isPacedEmail(String channel, String source) {
        return CHANNEL_EMAIL.equalsIgnoreCase(channel) && source != null && PACED_EMAIL_SOURCES.contains(source);
    }

    private void finish(String batchId, String status, int sent, int failed, String error,
                        List<UnifiedSendResponse.RecipientResult> results) throws Exception {
        sendBatchRepository.finishBatch(batchId, status, sent, failed, truncate(error),
                objectMapper.writeValueAsString(results), LocalDateTime.now());
    }

    /** Non-null when this institute's recent mail is failing. Cached, so a lane queries once a minute. */
    private String currentStopReason(String instituteId) {
        if (!autoStopEnabled || instituteId == null) return null;
        long nowMs = System.currentTimeMillis();
        OutcomeCheck cached = outcomeChecks.get(instituteId);
        if (cached != null && nowMs - cached.checkedAtMs() < OUTCOME_CACHE_MS) {
            return cached.stopReason();
        }
        String reason = null;
        try {
            List<Object[]> rows = notificationLogRepository.countEmailOutcomesSince(
                    instituteId, LocalDateTime.now(ZoneOffset.UTC).minusMinutes(OUTCOME_WINDOW_MINUTES));
            if (!rows.isEmpty()) {
                Object[] row = rows.get(0);
                reason = stopReason(count(row[0]), count(row[1]), count(row[2]), count(row[3]));
            }
        } catch (Exception e) {
            log.warn("Could not read recent email outcomes for institute {}: {}", instituteId, e.getMessage());
        }
        outcomeChecks.put(instituteId, new OutcomeCheck(nowMs, reason));
        return reason;
    }

    /** Thresholds for stopping a send. Counts cover the recent window, resolved mail only. */
    static String stopReason(long delivered, long transientBounces, long permanentBounces, long complaints) {
        long resolved = delivered + transientBounces + permanentBounces;
        if (resolved >= MIN_RESOLVED_FOR_STOP && (transientBounces + permanentBounces) * 100 > resolved * 15) {
            return "bounces " + (transientBounces + permanentBounces) + " of " + resolved
                    + " resolved emails in the last " + OUTCOME_WINDOW_MINUTES + " minutes";
        }
        if (complaints >= 3 && complaints * 1000 > resolved) {
            return "complaints " + complaints + " of " + resolved
                    + " resolved emails in the last " + OUTCOME_WINDOW_MINUTES + " minutes";
        }
        return null;
    }

    private static long count(Object value) {
        return value instanceof Number number ? number.longValue() : 0;
    }

    private static String truncate(String message) {
        return message != null && message.length() > MAX_ERROR_LENGTH
                ? message.substring(0, MAX_ERROR_LENGTH) : message;
    }
}
