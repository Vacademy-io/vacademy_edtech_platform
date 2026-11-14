package vacademy.io.admin_core_service.features.telephony.core;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.telephony.core.dto.CallAvailabilityDTO;
import vacademy.io.admin_core_service.features.telephony.core.dto.CallOptionsResponseDTO;
import vacademy.io.admin_core_service.features.telephony.core.dto.ConnectCallRequestDTO;
import vacademy.io.admin_core_service.features.telephony.core.dto.ConnectCallResponseDTO;
import vacademy.io.admin_core_service.features.live_activity.core.LiveActivityCallRecorder;
import vacademy.io.admin_core_service.features.telephony.enums.CallStatus;
import vacademy.io.admin_core_service.features.telephony.enums.ProviderCapability;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.TelephonyProviderNumber;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.TelephonyCallLogRepository;
import vacademy.io.admin_core_service.features.telephony.spi.OutboundOriginationResolver;
import vacademy.io.admin_core_service.features.telephony.spi.ProviderNumberSelector;
import vacademy.io.admin_core_service.features.telephony.spi.dto.BridgeCallRequest;
import vacademy.io.admin_core_service.features.telephony.spi.dto.NormalizedCallEvent;
import vacademy.io.admin_core_service.features.telephony.spi.dto.OutboundCallHandle;
import vacademy.io.admin_core_service.features.telephony.spi.dto.ProviderError;
import vacademy.io.admin_core_service.features.telephony.spi.dto.ProviderNumberView;
import vacademy.io.admin_core_service.features.telephony.spi.dto.SelectionContext;
import org.springframework.beans.factory.annotation.Value;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;
import vacademy.io.common.tracing.ExternalCallTimer;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Optional;

/**
 * Provider-agnostic outbound-call orchestrator.
 *
 * The Exotel HTTP call (5-8s p99) is intentionally OUTSIDE any DB transaction.
 * Holding a connection-pool slot across an external HTTP call would cap
 * concurrent calls at (pool_size / avg_call_seconds) — at our pool of ~20
 * and 5s average, that's only 4 concurrent calls. Splitting the work into
 * two short transactions around the HTTP call lifts that ceiling to whatever
 * pool can momentarily handle, typically 100x.
 *
 * The @Transactional units live in {@link CallLifecycleTxOps}, NOT on this
 * bean. Spring AOP doesn't intercept self-invocation (`this.method()`), so
 * placing the transactional methods on the same bean as `connect()` would
 * make the annotations no-ops. Injecting CallLifecycleTxOps means every
 * call goes through Spring's proxy and the @Transactional behaviour actually
 * engages.
 *
 * Failure model:
 *   - prepareAndPersist fails → row never inserted; user sees error toast.
 *   - HTTP call fails  → markFailedAfterDispatch (REQUIRES_NEW) flips the
 *                        row to FAILED so support can see it.
 *   - commitDispatched fails → unlikely; the call may still be live on
 *                              Exotel but the webhook ?corr= finds the row.
 */
@Service
public class CallOrchestrator {

    private static final Logger log = LoggerFactory.getLogger(CallOrchestrator.class);

    @Autowired private CallLifecycleTxOps tx;
    @Autowired private TelephonyProviderRegistry registry;
    @Autowired private CallEventBus eventBus;
    @Autowired private LiveActivityCallRecorder liveActivityCallRecorder;
    @Autowired private ProviderCircuitBreaker circuitBreaker;
    @Autowired private TelephonyConfigCache configCache;
    @Autowired private TelephonyCallLogRepository callLogRepo;
    @Autowired private CreditClient creditClient;

    /** Kill-switch for the pre-dial affordability gate (default ON). */
    @Value("${telephony.voice.credit-gate.enabled:true}")
    private boolean voiceCreditGateEnabled;

    public ConnectCallResponseDTO connect(ConnectCallRequestDTO req, CustomUserDetails actor) {
        String instituteId = requireNonBlank(req.getInstituteId(), "instituteId is required");

        // ── Phase 0: affordability ───────────────────────────────────
        assertVoiceCreditsAvailable(instituteId);

        // ── Phase 1: gather + persist (transactional, fast) ──────────────────
        Prepared p = tx.prepareAndPersist(instituteId, req, actor);
        return dispatch(p);
    }

    /**
     * Phase 0 of a click-to-call for a counsellor named by id rather than by the request's
     * principal — the public API's POST /v1/human-calls: the same voice credit gate as
     * {@link #connect}. The API then reserves the call (its checks and
     * {@link CallLifecycleTxOps#prepareAndPersistForCounsellor} in one transaction, under
     * advisory locks) and hands the result to {@link #dispatchPrepared}.
     */
    public void assertCanDial(String instituteId) {
        requireNonBlank(instituteId, "instituteId is required");
        assertVoiceCreditsAvailable(instituteId);
    }

    /**
     * Phases 1b–3 for a call whose INITIATED row is already committed. Deliberately not
     * transactional: the provider HTTP call must never run inside a transaction (or under
     * the API's advisory locks), for the reason in the class comment.
     */
    public ConnectCallResponseDTO dispatchPrepared(Prepared p) {
        return dispatch(p);
    }

    /** Phases 1b–3 of a click-to-call, shared by both entry points (moved verbatim). */
    private ConnectCallResponseDTO dispatch(Prepared p) {
        circuitBreaker.assertAvailable(p.providerType());

        // ── Phase 2: external HTTP (no DB connection held) ───────────────────
        OutboundCallHandle handle;
        try {
            // Attributed to `ext`, not to us: this call is the provider dialling a real
            // phone and it costs ~2s by nature. Counting it as our latency is what made
            // the speed indicator tell counsellors "Vacademy is slow" while the platform
            // was serving p50 16ms. See ExternalCallTimer.
            handle = ExternalCallTimer.timeChecked(
                    () -> registry.initiator(p.providerType()).initiate(p.bridge(), p.creds()));
        } catch (Exception e) {
            circuitBreaker.recordFailure(p.providerType(), e);
            tx.markFailedAfterDispatch(p.callLogId(), "provider_initiate_failure");
            log.error("provider initiate failed for call {}", p.callLogId(), e);
            // Surface common, actionable provider errors directly so the
            // counsellor sees "top up balance" instead of "try again later"
            // and stops retrying a doomed call. The adapter owns the mapping —
            // the core stays provider-neutral.
            ProviderError pe = registry.initiator(p.providerType()).translateError(e);
            throw new VacademyException(pe.getUserMessage());
        }
        circuitBreaker.recordSuccess(p.providerType());

        // ── Phase 3: commit provider id + initial event (transactional, fast) ─
        tx.commitDispatched(p.callLogId(), handle);
        eventBus.publish(p.callLogId(), NormalizedCallEvent.builder()
                .correlationId(p.callLogId())
                .providerCallId(handle.getProviderCallId())
                .status(CallStatus.QUEUED)
                .build());

        // Live activity feed. This publish bypasses CallLogService.applyEvent, so without
        // its own hook a call would not reach the institute feed until its first provider
        // webhook arrived -- losing exactly the "a counsellor just started dialling" moment.
        liveActivityCallRecorder.recordQueued(p.callLogId());

        // Post-call providers (Airtel) emit no live progress — the UI must not
        // promise a streaming status it will never get. Default true so legacy /
        // unknown providers keep the realtime flow.
        boolean realtimeEvents = registry.descriptor(p.providerType())
                .map(d -> d.supports(ProviderCapability.REALTIME_EVENTS))
                .orElse(true);

        return ConnectCallResponseDTO.builder()
                .callLogId(p.callLogId())
                .status(CallStatus.QUEUED.name())
                .callerId(p.callerId())
                .eventsStreamUrl("/admin-core-service/v1/telephony/calls/" + p.callLogId() + "/events")
                .realtimeEvents(realtimeEvents)
                .responseId(p.responseId())
                .build();
    }

    /**
     * Refuse the dial when the institute cannot pay for it.
     *
     * <p>Every manual call on a Vacademy-paid trunk is metered per minute by
     * {@link CallBillingService}, which deducts POST-paid and with
     * {@code allow_negative=true} — correct for a call that already happened, but
     * it means nothing ever stopped an exhausted institute from dialling again.
     * AI calling, the chatbot and engagement dispatch all gate their spend; the
     * counsellor click-to-call path never did, so one institute ran to -1427
     * credits across 1,306 billed calls before anyone noticed.
     *
     * <p><b>Only Vacademy-paid trunks.</b> Airtel/Exotel/Vonage ride the
     * INSTITUTE'S own carrier account and are never charged to this wallet, so
     * gating them would block calls the balance has nothing to do with. The
     * provider set is shared with the meter ({@link CallBillingService#isVoiceBillable})
     * precisely so the two cannot drift apart.
     *
     * <p><b>Fails OPEN</b>, unlike the AI-calling gate next door, and the asymmetry
     * is deliberate. There, a blocked call is a scheduler retrying later. Here, a
     * counsellor is mid-conversation with a lead on the other line, and every
     * outbound call on the platform funnels through this method — so making an
     * ai_service hiccup mean "nobody can dial" trades a small, self-correcting
     * billing leak (the meter still charges, the balance still goes negative, we
     * still see it) for a total calling outage. We block only on a balance we
     * actually read.
     */
    private void assertVoiceCreditsAvailable(String instituteId) {
        if (!voiceCreditGateEnabled) return;

        // Same enabled-filter computeAvailability uses: an institute with calling
        // switched off must hear "calling is not configured" from prepareAndPersist,
        // not "top up your credits" — one of those is actionable and the other sends
        // them to buy something that would not help.
        String providerType = configCache.get(instituteId)
                .filter(r -> Boolean.TRUE.equals(r.getConfig().getEnabled()))
                .map(r -> r.getConfig().getProviderType())
                .orElse(null);
        if (!CallBillingService.isVoiceBillable(providerType)) return;

        Optional<Double> balance;
        try {
            balance = creditClient.readBalance(instituteId);
        } catch (Exception e) {
            log.warn("credit gate: balance read threw for institute {} — allowing call (fail-open): {}",
                    instituteId, e.getMessage());
            return;
        }
        if (balance.isEmpty()) {
            log.warn("credit gate: balance unreadable for institute {} — allowing call (fail-open)",
                    instituteId);
            return;
        }
        if (balance.get() > 0.0) return;

        log.warn("call BLOCKED — institute {} is out of credits (balance {}, provider {})",
                instituteId, balance.get(), providerType);
        // ConflictException (409), not VacademyException (510): this is a business
        // rule doing its job, and the VacademyException handler logs at ERROR level
        // — which would file one Sentry issue per blocked click, hundreds a day for
        // a busy call centre. The frontend reads `ex` off the body either way, so
        // the counsellor still gets this exact sentence as a toast.
        throw new ConflictException(
                "Your institute has run out of AI credits. Please top up to continue calling.");
    }

    /**
     * Can {@code callerUserId} place a call in this institute right now?
     *
     * <p>Never throws for the "no" cases — an absent/disabled config and an
     * unprepared caller are both ordinary answers, not errors. Callers use this
     * to decide whether to render a Call button, which happens on pages that
     * have nothing to do with calling, so a thrown 510 there would be pure noise
     * in the logs and a failure sample in the latency indicator.
     *
     * <p>Cheap: a config-cache read plus, at most, the provider's own per-caller
     * lookup (one indexed row for Airtel, a cached auth_service record for
     * Exotel/Plivo). No provider HTTP, no writes.
     */
    public CallAvailabilityDTO computeAvailability(String instituteId, String callerUserId) {
        if (instituteId == null || instituteId.isBlank()) {
            return CallAvailabilityDTO.builder().enabled(false).callerReady(false).build();
        }
        Optional<TelephonyConfigCache.Resolved> resolved = configCache.get(instituteId)
                .filter(r -> Boolean.TRUE.equals(r.getConfig().getEnabled()));
        if (resolved.isEmpty()) {
            return CallAvailabilityDTO.builder().enabled(false).callerReady(false).build();
        }
        String providerType = resolved.get().getConfig().getProviderType();

        // A provider with no registered resolver can't originate at all. Report it
        // as "not enabled" rather than letting the UI offer a button that would
        // throw at dial time.
        OutboundOriginationResolver resolver;
        try {
            resolver = registry.originationResolver(providerType);
        } catch (Exception e) {
            log.warn("no origination resolver for provider {} (institute {})", providerType, instituteId);
            return CallAvailabilityDTO.builder()
                    .enabled(false).callerReady(false).providerType(providerType).build();
        }

        // The readiness probe is advisory; a provider that fails to answer must not
        // take the button away from someone who could actually dial. Degrade to
        // "ready" and let resolve() be the authority at dial time.
        Optional<String> blocked;
        try {
            blocked = resolver.callerBlockedReason(instituteId, callerUserId);
        } catch (Exception e) {
            log.warn("caller-readiness probe failed for {} on {}; assuming ready",
                    callerUserId, providerType, e);
            blocked = Optional.empty();
        }

        return CallAvailabilityDTO.builder()
                .enabled(true)
                .callerReady(blocked.isEmpty())
                .reason(blocked.orElse(null))
                .providerType(providerType)
                .build();
    }

    /**
     * Returns every enabled ExoPhone for the institute plus the one the
     * configured strategy would auto-select for this lead today. Powers the
     * runtime picker popover on the Call button — the frontend pre-checks
     * {@code recommendedNumberId} so the counsellor's default flow stays a
     * single click.
     *
     * Side-effect-free: reads the config cache + (only for STICKY_PER_LEAD)
     * the call-log sticky lookup. No DB writes, no provider HTTP.
     */
    public CallOptionsResponseDTO computeOptions(String instituteId, String leadUserId) {
        if (instituteId == null || instituteId.isBlank()) {
            throw new VacademyException("instituteId is required");
        }
        TelephonyConfigCache.Resolved resolved = configCache.get(instituteId)
                .filter(r -> Boolean.TRUE.equals(r.getConfig().getEnabled()))
                .orElseThrow(() -> new VacademyException("Calling is not configured for this institute"));

        // No-pool providers (Airtel) dial from the counsellor's own extension —
        // there is no caller-ID number to pick. Return an empty list + the flag so
        // the picker just confirms the dial instead of surfacing a stale number
        // pool (e.g. ExoPhones left over from a previous Exotel config).
        String providerType = resolved.getConfig().getProviderType();
        boolean usesNumberPool = registry.descriptor(providerType)
                .map(d -> d.supports(ProviderCapability.NUMBER_POOL))
                .orElse(true); // legacy/unknown providers keep pool semantics
        if (!usesNumberPool) {
            return CallOptionsResponseDTO.builder()
                    .numbers(List.of())
                    .recommendedNumberId(null)
                    .strategyKey(null)
                    .providerType(providerType)
                    .usesNumberPool(false)
                    .build();
        }

        List<TelephonyProviderNumber> enabled = resolved.getEnabledNumbers();
        List<CallOptionsResponseDTO.NumberChoice> choices = enabled.stream()
                .map(n -> CallOptionsResponseDTO.NumberChoice.builder()
                        .id(n.getId())
                        .phoneNumber(n.getPhoneNumber())
                        .label(n.getLabel())
                        .region(n.getRegion())
                        .priority(n.getPriority())
                        .build())
                .toList();

        String strategyKey = resolved.getConfig().getDefaultSelectorKey();
        String recommendedId = null;

        if (!enabled.isEmpty()) {
            List<ProviderNumberView> views = enabled.stream()
                    .map(n -> ProviderNumberView.builder()
                            .id(n.getId())
                            .phoneNumber(n.getPhoneNumber())
                            .label(n.getLabel())
                            .region(n.getRegion())
                            .priority(n.getPriority() == null ? 100 : n.getPriority())
                            .enabled(Boolean.TRUE.equals(n.getEnabled()))
                            .build())
                    .toList();

            Optional<String> sticky = (leadUserId != null && !leadUserId.isBlank()
                    && "STICKY_PER_LEAD".equals(strategyKey))
                    ? callLogRepo.findMostRecentNumberIdForLead(leadUserId)
                    : Optional.empty();

            ProviderNumberSelector selector = registry.selector(strategyKey);
            Optional<ProviderNumberView> picked = selector.select(SelectionContext.builder()
                    .instituteId(instituteId)
                    .leadUserId(leadUserId)
                    .available(views)
                    .lastProviderNumberIdForLead(sticky.orElse(null))
                    .build());

            recommendedId = picked.map(ProviderNumberView::getId).orElse(null);
        }

        return CallOptionsResponseDTO.builder()
                .numbers(choices)
                .recommendedNumberId(recommendedId)
                .strategyKey(strategyKey)
                .providerType(providerType)
                .usesNumberPool(true)
                .build();
    }

    private static String requireNonBlank(String s, String msg) {
        if (s == null || s.isBlank()) throw new VacademyException(msg);
        return s;
    }

    /**
     * Maps common provider HTTP errors onto user-actionable messages.
     * Anything unrecognised falls through to the original generic retry
     * message — keeps unexpected errors loud in logs while avoiding
     * exposing raw provider stack traces to the counsellor's toast.
     */

    /** Intermediate value carried across the orchestrator's three phases. */
    public record Prepared(
            String callLogId,
            String providerType,
            String callerId,
            /** audience_response the call was filed under — null for a learner
             *  with no lead row. Echoed to the UI for disposition capture. */
            String responseId,
            BridgeCallRequest bridge,
            TelephonyConfigCache.Resolved resolved
    ) {
        public vacademy.io.admin_core_service.features.telephony.spi.dto.ProviderCredentials creds() {
            return resolved.getCredentials();
        }
    }
}
