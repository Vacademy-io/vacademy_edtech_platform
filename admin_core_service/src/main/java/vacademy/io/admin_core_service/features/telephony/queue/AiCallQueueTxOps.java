package vacademy.io.admin_core_service.features.telephony.queue;

import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.telephony.queue.entity.AiCallQueueItem;
import vacademy.io.admin_core_service.features.telephony.queue.repository.AiCallQueueItemRepository;

import java.util.List;

/**
 * Queue writes that must succeed or fail on their OWN transaction.
 *
 * <p>The reason this is a separate bean rather than a few methods on
 * {@link AiCallQueueService}: enqueue is called from inside the workflow engine's
 * transaction, and the {@code ux_ai_call_queue_pending} unique index can legitimately
 * reject an insert (two replicas resuming the same workflow run in the same instant).
 * A constraint violation marks the CURRENT transaction rollback-only — so without
 * {@code REQUIRES_NEW} here, one de-duplicated AI call would roll back the entire
 * workflow step that asked for it. Spring proxies only cross-bean calls, so the
 * boundary has to live in a different class; {@code RecordingTxOps} and
 * {@code CallLifecycleTxOps} are here for the same reason.
 *
 * <p>Both methods below are entry points called from {@link AiCallQueueService} — the
 * chunk loop and the row-by-row fallback are orchestrated there, precisely so every
 * transaction boundary is a real proxied call rather than a self-invocation that would
 * silently share the failed transaction.
 */
@Component
@RequiredArgsConstructor
public class AiCallQueueTxOps {

    private final AiCallQueueItemRepository repository;

    /**
     * Insert one item on its own transaction.
     *
     * @return the saved item, or {@code null} when the unique index rejected it
     *         because an undialled item for this lead already exists. That is not an
     *         error: the call the caller wanted IS queued, just not by them.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public AiCallQueueItem insertOne(AiCallQueueItem item) {
        try {
            return repository.saveAndFlush(item);
        } catch (DataIntegrityViolationException e) {
            return null;
        }
    }

    /**
     * Insert a chunk on its own transaction, all-or-nothing.
     *
     * @return the inserted rows, or {@code null} when the chunk hit the unique index —
     *         the caller then retries those rows one at a time, so that with 500 leads
     *         a single already-queued lead cannot cost the other 499 their calls.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public List<AiCallQueueItem> insertChunk(List<AiCallQueueItem> chunk) {
        try {
            return repository.saveAllAndFlush(chunk);
        } catch (DataIntegrityViolationException e) {
            return null;
        }
    }
}
