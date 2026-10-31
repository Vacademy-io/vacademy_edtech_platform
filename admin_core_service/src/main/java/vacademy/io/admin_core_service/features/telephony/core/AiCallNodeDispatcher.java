package vacademy.io.admin_core_service.features.telephony.core;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiCallRequestDTO;
import vacademy.io.admin_core_service.features.telephony.enums.CallTrigger;
import vacademy.io.admin_core_service.features.telephony.queue.AiCallQueueService;

import java.util.concurrent.Executor;

/**
 * Where the CALL_AI workflow node hands off an AI call.
 *
 * <p>Since the AI call queue this is a durable {@code ai_call_queue} INSERT rather than
 * a task on an in-memory executor. Three things changed for the better:
 *
 * <ul>
 *   <li><b>It survives a restart.</b> The old queue lived in one replica's heap, so a
 *       deploy during a bulk sheet upload silently dropped every call still waiting —
 *       a caveat this class used to carry as a known follow-up.</li>
 *   <li><b>It is fleet-aware.</b> The old executor paced calls 300 ms apart with no
 *       knowledge of how many were already live, so a big upload simply overran the
 *       voice box and leads heard "all lines busy".</li>
 *   <li><b>It de-duplicates properly.</b> The workflow engine resumes a run by
 *       RESTARTING it, so a CALL_AI node can re-enter many times for the same lead
 *       before its first call ever goes out. The queue's partial unique index collapses
 *       those into one pending call.</li>
 * </ul>
 *
 * <p>The method signatures are unchanged, so {@code CallAiNodeHandler} is untouched.
 *
 * <p>{@code telephony.ai.queue.enabled=false} restores the old in-memory executor
 * exactly as it was. That is a rollback lever, not a supported mode — it dials without
 * a concurrency limit.
 */
@Component
public class AiCallNodeDispatcher {

    private static final Logger log = LoggerFactory.getLogger(AiCallNodeDispatcher.class);

    private final AiCallService aiCallService;
    private final AiCallQueueService queueService;
    private final Executor executor;

    /** Gap between consecutive calls on the LEGACY path only. */
    @Value("${aavtaar.queue.pace-ms:300}")
    private long paceMs;

    /** Rollback lever: false = the pre-queue in-memory executor. See the class note. */
    @Value("${telephony.ai.queue.enabled:true}")
    private boolean queueEnabled;

    public AiCallNodeDispatcher(AiCallService aiCallService,
                                AiCallQueueService queueService,
                                @Qualifier("aiCallQueueExecutor") Executor executor) {
        this.aiCallService = aiCallService;
        this.queueService = queueService;
        this.executor = executor;
    }

    /** Queue this AI call; returns immediately. */
    public void enqueue(AiCallRequestDTO req) {
        enqueue(req, CallTrigger.AUTOMATION);
    }

    /**
     * As {@link #enqueue(AiCallRequestDTO)}, but with the caller declaring WHICH
     * throttle profile applies. The trigger is chosen by the calling code from the
     * node's authored config — never read off the request body — so a workflow can
     * opt out of the already-assigned guard only when an admin explicitly built it
     * that way. It rides on the queue row, so the dial made an hour later still
     * carries the decision the node made.
     */
    public void enqueue(AiCallRequestDTO req, CallTrigger trigger) {
        CallTrigger effective = trigger == null ? CallTrigger.AUTOMATION : trigger;
        if (queueEnabled) {
            try {
                queueService.enqueue(req, effective, AiCallQueueService.SOURCE_WORKFLOW, null, null);
            } catch (Exception e) {
                // Never let a queue write break the workflow step that asked for the
                // call. The node has already recorded its attempt and paused; a lost
                // enqueue costs one call, a thrown exception costs the whole run.
                log.warn("ai-call queue: could not queue the CALL_AI node's call for lead {} "
                        + "(response {}): {}", req.getUserId(), req.getResponseId(), e.getMessage());
            }
            return;
        }
        legacyEnqueue(req, effective);
    }

    /**
     * The pre-queue path, kept verbatim behind the rollback flag: a single paced worker
     * thread placing calls one at a time with no fleet-wide limit.
     */
    private void legacyEnqueue(AiCallRequestDTO req, CallTrigger trigger) {
        executor.execute(() -> {
            try {
                aiCallService.placeCall(req, null, trigger);
            } catch (Exception e) {
                log.warn("ai-call queue (legacy): failed to place call for lead {} (response {}): {}",
                        req.getUserId(), req.getResponseId(), e.getMessage());
            }
            if (paceMs > 0) {
                try {
                    Thread.sleep(paceMs);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                }
            }
        });
    }
}
