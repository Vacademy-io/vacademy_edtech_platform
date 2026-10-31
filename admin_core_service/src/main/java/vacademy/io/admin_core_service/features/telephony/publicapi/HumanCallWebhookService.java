package vacademy.io.admin_core_service.features.telephony.publicapi;

import jakarta.annotation.PreDestroy;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.call_intelligence.core.CallIntelligenceEnqueueService;
import vacademy.io.admin_core_service.features.call_intelligence.persistence.entity.CallIntelligence;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.TelephonyCallLog;
import vacademy.io.admin_core_service.features.telephony.publicapi.entity.AiCallApiCall;
import vacademy.io.admin_core_service.features.telephony.publicapi.entity.AiCallWebhook;
import vacademy.io.admin_core_service.features.telephony.publicapi.entity.HumanCallApiCall;
import vacademy.io.admin_core_service.features.telephony.publicapi.repository.AiCallWebhookRepository;
import vacademy.io.admin_core_service.features.telephony.publicapi.repository.HumanCallApiCallRepository;

import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;

/**
 * Webhooks for human calls placed through the public API, delivered to the institute's
 * existing endpoint (ai_call_webhook) with the same signing, retries, SSRF checks and
 * per-institute fairness as AI call events — {@link AiCallingWebhookService#deliver} does
 * the sending.
 *
 * <p><b>Events.</b> {@code human_call.completed} (the counsellor and the contact talked),
 * {@code human_call.not_connected} (no_answer, busy, failed, canceled) — one per call, when
 * it is final (see {@link HumanCallViews#state}); and, only for a call created with
 * {@code analyze: true}, {@code human_call.analysis_ready} once the analysis completed or
 * could not run. Each event's data is the human-call object as GET returns it.
 *
 * <p><b>Analysis.</b> This finaliser is also what asks for it: once a requested call's
 * recording is in our storage, it calls
 * {@link CallIntelligenceEnqueueService#enqueueRequested} (billed per minute by
 * ai_service). Nothing hooks the call pipeline, so a missed signal costs one tick.
 *
 * <p><b>Isolation from AI events.</b> Separate scheduled passes, ShedLocks and thread pool:
 * a backlog or a slow endpoint here can never delay an AI call's event, and vice versa.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class HumanCallWebhookService {

    static final String EVENT_COMPLETED = "human_call.completed";
    static final String EVENT_NOT_CONNECTED = "human_call.not_connected";
    static final String EVENT_ANALYSIS_READY = "human_call.analysis_ready";
    static final int DELIVERY_THREADS = 4;

    private final HumanCallApiCallRepository callRepository;
    private final AiCallWebhookRepository webhookRepository;
    private final HumanCallViews views;
    private final AiCallingWebhookService sender;
    private final CallIntelligenceEnqueueService intelligence;

    private final ExecutorService deliveryPool = Executors.newFixedThreadPool(DELIVERY_THREADS, r -> {
        Thread t = new Thread(r, "human-call-webhook");
        t.setDaemon(true);
        return t;
    });

    @PreDestroy
    void shutdown() {
        deliveryPool.shutdownNow();
    }

    // ── Finaliser ────────────────────────────────────────────────────────────────

    @Scheduled(fixedDelayString = "${telephony.human.api.finalize-delay-ms:15000}", initialDelay = 35000)
    @SchedulerLock(name = "HumanCallApiFinalize", lockAtMostFor = "PT5M", lockAtLeastFor = "PT2S")
    public void finalizePass() {
        try {
            List<HumanCallApiCall> open = callRepository.findOpen(
                    Instant.now().minus(AiCallingWebhookService.SCAN_WINDOW), 300);
            for (HumanCallApiCall c : open) {
                if (Thread.currentThread().isInterrupted()) return;
                try {
                    finalizeOne(c);
                } catch (RuntimeException e) {
                    log.warn("human-call-api: finalise {} failed: {}", c.getId(), e.getMessage());
                }
            }
            callRepository.clearIdempotencyKeysBefore(Instant.now().minus(AiCallingApiService.IDEMPOTENCY_TTL));
        } catch (RuntimeException e) {
            log.warn("human-call-api: finalise pass failed: {}", e.getMessage());
        }
    }

    void finalizeOne(HumanCallApiCall c) {
        HumanCallViews.State s = views.state(c);
        boolean hasHook = webhookRepository.findById(c.getInstituteId()).map(AiCallWebhook::isEnabled).orElse(false);
        Instant now = Instant.now();
        boolean callOpen = c.getFinalizedAt() == null;
        if (callOpen && s.isFinal()) {
            callRepository.finalizeIfOpen(c.getId(), s.status(),
                    "completed".equals(s.status()) ? EVENT_COMPLETED : EVENT_NOT_CONNECTED, now,
                    hasHook ? AiCallApiCall.WEBHOOK_PENDING : AiCallApiCall.WEBHOOK_NONE, hasHook ? now : null);
            callOpen = false;
        }
        boolean analysisOpen = c.isAnalysisRequested() && c.getAnalysisFinalizedAt() == null;
        if (analysisOpen) analysisOpen = !advanceAnalysis(c, s, hasHook, now);
        if (callOpen || analysisOpen) callRepository.markChecked(c.getId());
    }

    /**
     * Ask for the analysis once the recording is in, and close the analysis outbox once it
     * can no longer change. Returns true when it was closed.
     */
    boolean advanceAnalysis(HumanCallApiCall c, HumanCallViews.State s, boolean hasHook, Instant now) {
        TelephonyCallLog l = s.callLog();
        if (c.getAnalysisTriggeredAt() == null && l != null && l.getRecordingStorageKey() != null
                && "COMPLETED".equals(l.getStatus())) {
            String r = intelligence.enqueueRequested(l.getId());
            if ("QUEUED".equals(r) || "EXISTS".equals(r)) callRepository.markAnalysisTriggered(c.getId(), now);
        }
        CallIntelligence ci = views.intelligence(l);
        Map<String, Object> analysis = HumanCallViews.analysis(c, s, ci, now);
        if (!HumanCallViews.analysisFinal(analysis)) return false;
        // A call that never connected already said so in human_call.not_connected; its
        // analysis closes without an event of its own.
        boolean send = hasHook && "completed".equals(s.status());
        callRepository.finalizeAnalysisIfOpen(c.getId(), now,
                send ? AiCallApiCall.WEBHOOK_PENDING : AiCallApiCall.WEBHOOK_NONE, send ? now : null);
        return true;
    }

    // ── Delivery ─────────────────────────────────────────────────────────────────

    /** Which of a row's two outboxes a delivery belongs to. */
    enum Slot { CALL, ANALYSIS }

    @Scheduled(fixedDelayString = "${telephony.human.api.webhook-delay-ms:5000}", initialDelay = 45000)
    @SchedulerLock(name = "HumanCallApiWebhooks", lockAtMostFor = "PT10M", lockAtLeastFor = "PT2S")
    public void deliverPass() {
        List<Map.Entry<Slot, HumanCallApiCall>> due = new ArrayList<>();
        try {
            Instant now = Instant.now();
            for (HumanCallApiCall c : callRepository.findWebhooksDue(now, AiCallingWebhookService.PER_INSTITUTE_PER_PASS, 200)) {
                due.add(Map.entry(Slot.CALL, c));
            }
            for (HumanCallApiCall c : callRepository.findAnalysisWebhooksDue(now, AiCallingWebhookService.PER_INSTITUTE_PER_PASS, 200)) {
                due.add(Map.entry(Slot.ANALYSIS, c));
            }
        } catch (RuntimeException e) {
            log.warn("human-call-api: webhook pass failed: {}", e.getMessage());
            return;
        }
        if (due.isEmpty()) return;
        // One task per institute, in order; institutes run in parallel; an institute stops
        // at its first failed delivery this pass (as for AI events).
        Map<String, List<Map.Entry<Slot, HumanCallApiCall>>> byInstitute = new LinkedHashMap<>();
        for (Map.Entry<Slot, HumanCallApiCall> e : due) {
            byInstitute.computeIfAbsent(e.getValue().getInstituteId(), k -> new ArrayList<>()).add(e);
        }
        List<Future<?>> tasks = new ArrayList<>();
        for (List<Map.Entry<Slot, HumanCallApiCall>> items : byInstitute.values()) {
            tasks.add(deliveryPool.submit(() -> {
                for (Map.Entry<Slot, HumanCallApiCall> e : items) {
                    if (Thread.currentThread().isInterrupted()) return;
                    try {
                        if (!deliverOne(e.getKey(), e.getValue())) return;
                    } catch (RuntimeException ex) {
                        log.warn("human-call-api: webhook for {} failed: {}", e.getValue().getId(), ex.getMessage());
                        return;
                    }
                }
            }));
        }
        long deadline = System.nanoTime() + AiCallingWebhookService.PASS_DEADLINE.toNanos();
        for (Future<?> f : tasks) {
            try {
                f.get(Math.max(1, deadline - System.nanoTime()), TimeUnit.NANOSECONDS);
            } catch (TimeoutException e) {
                f.cancel(true);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                tasks.forEach(t -> t.cancel(true));
                return;
            } catch (ExecutionException e) {
                log.warn("human-call-api: webhook task failed: {}", e.getMessage());
            }
        }
    }

    /** Deliver one event and record the result. Returns false when the delivery failed. */
    boolean deliverOne(Slot slot, HumanCallApiCall c) {
        int attempts = slot == Slot.CALL ? c.getWebhookAttempts() : c.getAnalysisWebhookAttempts();
        Optional<AiCallWebhook> hook = webhookRepository.findById(c.getInstituteId()).filter(AiCallWebhook::isEnabled);
        if (hook.isEmpty()) {
            record(slot, c.getId(), AiCallApiCall.WEBHOOK_NONE, attempts, null, null, null, null);
            return true;
        }
        Map<String, Object> data = views.view(c);
        String type = slot == Slot.CALL ? c.getFinalEvent() : EVENT_ANALYSIS_READY;
        AiCallingWebhookService.Delivery d = sender.deliver(hook.get(), eventId(slot, c), type, data);
        if (d.interrupted()) return false;
        int attempt = attempts + 1;
        String error = d.error() == null ? null : d.error().length() > 480 ? d.error().substring(0, 480) : d.error();
        if (d.ok()) {
            record(slot, c.getId(), AiCallApiCall.WEBHOOK_DELIVERED, attempt, null, d.code(), null, Instant.now());
        } else if (attempt > AiCallingWebhookService.RETRY_AFTER.size()) {
            record(slot, c.getId(), AiCallApiCall.WEBHOOK_FAILED, attempt, null, d.code(), error, null);
        } else {
            record(slot, c.getId(), AiCallApiCall.WEBHOOK_PENDING, attempt,
                    Instant.now().plus(AiCallingWebhookService.RETRY_AFTER.get(attempt - 1)), d.code(), error, null);
        }
        return d.ok();
    }

    private void record(Slot slot, String id, String status, int attempts, Instant nextAt, Integer code,
                        String error, Instant deliveredAt) {
        if (slot == Slot.CALL) {
            callRepository.recordDelivery(id, status, attempts, nextAt, code, error, deliveredAt);
        } else {
            callRepository.recordAnalysisDelivery(id, status, attempts, nextAt, code, error, deliveredAt);
        }
    }

    /** Stable per call and event, so every retry carries the same id (receivers dedupe on it). */
    static String eventId(Slot slot, HumanCallApiCall c) {
        String hex = c.getId().replaceFirst("^" + HumanCallApiService.ID_PREFIX, "");
        return (slot == Slot.CALL ? "evt_hc_" : "evt_hca_") + hex;
    }
}
