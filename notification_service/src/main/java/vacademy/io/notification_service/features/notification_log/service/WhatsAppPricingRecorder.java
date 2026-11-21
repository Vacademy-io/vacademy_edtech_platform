package vacademy.io.notification_service.features.notification_log.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import vacademy.io.notification_service.features.notification_log.repository.WhatsAppPricingRepository;

import java.time.Instant;
import java.util.Map;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/**
 * Saves Meta's per-message pricing from a WhatsApp status webhook onto the outbound row that sent
 * the message, so the engagement report can price WhatsApp spend per message.
 * <p>
 * Meta puts a {@code pricing} object ({billable, pricing_model, type, category}) on the {@code sent}
 * status and on one of delivered/read, never on failed, and it carries no amount. Both webhook
 * paths call this: the Com.bot path (CombotWebhookService, the one Meta-direct institutes actually
 * post to) with each status map, and the Meta handler path (WebhookEventProcessor) with the raw
 * payload. WATI sends no pricing, so nothing is recorded for it.
 * <p>
 * Best-effort by contract: the status itself is already saved by the caller, so a failure here
 * loses an annotation, never an event. Nothing in this class throws, and the write never runs
 * inside the caller's transaction: called within one (the Com.bot path is @Transactional), it
 * waits for that transaction to commit, so a failed pricing UPDATE (lock timeout, bad value) can
 * never mark the webhook's transaction rollback-only and lose the status it saved.
 */
@Component
@Slf4j
public class WhatsAppPricingRecorder {

    /** Writes waiting for a connection; past this a burst drops pricing annotations, never statuses. */
    private static final int QUEUE_CAPACITY = 5_000;

    private final WhatsAppPricingRepository whatsAppPricingRepository;
    private final ObjectMapper objectMapper;

    /**
     * Runs the writes that waited for a commit, on its own thread rather than the webhook's. During
     * afterCommit the webhook still holds its pooled connection (Hibernate keeps it until the
     * EntityManager closes, after the synchronizations run), so a write on the same thread needs a
     * second connection; with this service's 3-connection pool, three webhooks doing that at once
     * would wait on each other until the pool times out. A plain call there would not work either:
     * it joins the finished transaction and is never committed. One thread is enough for one
     * indexed single-row UPDATE per status.
     */
    private final ThreadPoolExecutor afterCommitWriter;

    public WhatsAppPricingRecorder(WhatsAppPricingRepository whatsAppPricingRepository, ObjectMapper objectMapper) {
        this.whatsAppPricingRepository = whatsAppPricingRepository;
        this.objectMapper = objectMapper;
        this.afterCommitWriter = new ThreadPoolExecutor(1, 1, 60, TimeUnit.SECONDS,
                new LinkedBlockingQueue<>(QUEUE_CAPACITY),
                r -> {
                    Thread t = new Thread(r, "wa-pricing-writer");
                    t.setDaemon(true);
                    return t;
                },
                (task, executor) -> log.warn("WhatsApp pricing writer is backed up; one pricing annotation dropped"));
        this.afterCommitWriter.allowCoreThreadTimeOut(true);
    }

    /**
     * Record one status's pricing. {@code pricing} is the status's {@code pricing} value as either a
     * Map (Com.bot path) or a JsonNode; null, or an object with none of the known fields, is a no-op.
     * Inside a transaction the write happens after it commits (and not at all if it rolls back,
     * like the status it came with); outside one it happens now, in the repository's own transaction.
     */
    public void record(String wamid, Object pricing) {
        if (wamid == null || wamid.isBlank() || pricing == null) {
            return;
        }
        try {
            JsonNode node = pricing instanceof JsonNode json ? json : objectMapper.valueToTree(pricing);
            if (node == null || !node.isObject()) {
                return;
            }
            Boolean billable = bool(node.get("billable"));
            String type = text(node.get("type"));
            String category = text(node.get("category"));
            String model = text(node.get("pricing_model"));
            if (billable == null && type == null && category == null && model == null) {
                return;
            }
            Instant reportedAt = Instant.now();
            if (!TransactionSynchronizationManager.isSynchronizationActive()) {
                apply(wamid, billable, type, category, model, reportedAt);
                return;
            }
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    // An exception here would reach the code that committed the webhook; never throw.
                    try {
                        afterCommitWriter.execute(() -> apply(wamid, billable, type, category, model, reportedAt));
                    } catch (Exception e) {
                        log.warn("Could not queue WhatsApp pricing for messageId={}: {}", wamid, e.getMessage());
                    }
                }
            });
        } catch (Exception e) {
            log.warn("Could not save WhatsApp pricing on outbound row for messageId={}: {}",
                    wamid, e.getMessage());
        }
    }

    /**
     * Record the pricing from a raw Meta webhook payload: {@code entry[0].changes[0].value.statuses[0]},
     * the same status MetaWebhookHandler parsed the event from. Skipped when that status is not
     * {@code wamid}'s, and a no-op for payloads of any other shape (WATI).
     */
    public void recordFromMetaPayload(String wamid, Map<String, Object> rawPayload) {
        if (wamid == null || wamid.isBlank() || rawPayload == null) {
            return;
        }
        try {
            JsonNode root = objectMapper.valueToTree(rawPayload);
            JsonNode status = root.path("entry").path(0).path("changes").path(0)
                    .path("value").path("statuses").path(0);
            if (!wamid.equals(status.path("id").asText(null))) {
                return;
            }
            record(wamid, status.get("pricing"));
        } catch (Exception e) {
            log.warn("Could not read WhatsApp pricing from webhook payload for messageId={}: {}",
                    wamid, e.getMessage());
        }
    }

    /** The UPDATE, in the repository's own transaction (none is bound on the calling thread). Never throws. */
    private void apply(String wamid, Boolean billable, String type, String category, String model,
                       Instant reportedAt) {
        try {
            int updated = whatsAppPricingRepository.applyPricingByProviderMessageId(
                    wamid, billable, type, category, model, reportedAt);
            if (updated == 0) {
                // Same as the delivery-status stamp: normal when the status outran its own send row.
                log.debug("No outbound row to price for messageId={}", wamid);
            }
        } catch (Exception e) {
            log.warn("Could not save WhatsApp pricing on outbound row for messageId={}: {}",
                    wamid, e.getMessage());
        }
    }

    @PreDestroy
    void shutdown() {
        afterCommitWriter.shutdown();
        try {
            if (!afterCommitWriter.awaitTermination(5, TimeUnit.SECONDS)) {
                afterCommitWriter.shutdownNow();
            }
        } catch (InterruptedException ie) {
            afterCommitWriter.shutdownNow();
            Thread.currentThread().interrupt();
        }
    }

    private static String text(JsonNode value) {
        if (value == null || value.isNull() || !value.isValueNode()) {
            return null;
        }
        String s = value.asText().trim();
        return s.isEmpty() ? null : s;
    }

    private static Boolean bool(JsonNode value) {
        if (value == null || value.isNull()) {
            return null;
        }
        if (value.isBoolean()) {
            return value.booleanValue();
        }
        if (value.isTextual()) {
            String s = value.asText().trim();
            if ("true".equalsIgnoreCase(s)) return true;
            if ("false".equalsIgnoreCase(s)) return false;
        }
        return null;
    }
}
