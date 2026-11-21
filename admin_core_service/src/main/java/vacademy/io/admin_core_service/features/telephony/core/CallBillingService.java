package vacademy.io.admin_core_service.features.telephony.core;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;
import vacademy.io.admin_core_service.features.credits.client.MeteringFields;
import vacademy.io.admin_core_service.features.telephony.core.dto.VoiceCallingSettingsPojo;
import vacademy.io.admin_core_service.features.telephony.enums.ProviderType;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.AiCallResultRepository;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.TelephonyCallLogRepository;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.List;

/**
 * Per-minute credit metering for phone calls — the "P4" seam the telephony
 * package always planned ({@link VoiceCallingSettingsPojo.BillingConfig}).
 *
 * <p>Two independent meters can fire for one physical call:
 * <ul>
 *   <li><b>Voice leg</b> ({@code voice_call_out} / {@code voice_call_in}) — telephony
 *       minutes of calls carried on VACADEMY-PROVIDED trunks: provider {@code PLIVO}
 *       (Vacademy Voice) and {@code VACADEMY_AI} (our AI dials on the same Plivo
 *       subaccounts). Airtel/Exotel/Vonage ride the INSTITUTE'S own carrier account,
 *       and MANUAL/MOCK aren't real carried calls — never billed.</li>
 *   <li><b>AI leg</b> ({@code ai_call_out} / {@code ai_call_in}) — AI-conversation
 *       minutes (STT+LLM+TTS) of a completed AI call, billed off the VERIFIED
 *       ai_call_result (providers VACADEMY_AI and AAVTAAR, never MOCK). An outbound
 *       Vacademy-AI call pays voice + AI; an inbound IVR call answered by a human
 *       pays voice only; the same inbound handled by the AI agent pays both.</li>
 * </ul>
 *
 * <p><b>Rates</b>: per-institute override first ({@code VOICE_CALLING_SETTING.billing}
 * — ops-managed via manual DB edit; the tenant settings endpoint refuses to persist
 * it, see VoiceConfigController), then the global {@code credit_pricing} row
 * ({@code token_rate} = credits/minute, {@code minimum_charge} = per-call floor;
 * seeded in V378). A 0 rate disables that meter; a missing row skips with a warn.
 *
 * <p><b>Cost</b> = max(minimum_charge, ceil(duration/60) × perMinute). The wallet
 * write goes through ai_service ({@link CreditClient#deductPrecomputed} → the
 * internal-token-gated POST /credits/v1/deduct) with {@code precomputed_credits},
 * {@code allow_negative=true} (post-paid — the call already happened) and an
 * idempotency key enforced by the V243 partial unique index, so any number of
 * attempts charge exactly once.
 *
 * <p><b>At-least-once</b>: on an acknowledged deduction the source row is STAMPED
 * ({@code credits_billed_at}); unstamped completed rows are re-attempted by
 * {@link CallBillingReconciliationJob}, so a lost HTTP call (ai_service restart)
 * is healed instead of silently leaking revenue. Async + never blocks a webhook.
 */
@Service
public class CallBillingService {

    private static final Logger log = LoggerFactory.getLogger(CallBillingService.class);

    /**
     * Platform-wide billing granularity in seconds. 30 = half-minute pulses for every
     * institute that has not negotiated its own. Rates stay credits-per-MINUTE, so this
     * does not change anybody's price per minute — it only stops a 5-second call being
     * rounded up to a full one.
     */
    @org.springframework.beans.factory.annotation.Value("${telephony.billing.pulse-seconds:60}")
    private int defaultPulseSeconds;

    /** Providers whose telephony minutes ride Vacademy-paid trunks. */
    private static final List<String> VOICE_BILLABLE_PROVIDERS =
            List.of(ProviderType.PLIVO, ProviderType.VACADEMY_AI);
    /** AI providers whose conversation minutes we meter (MOCK excluded). */
    private static final List<String> AI_BILLABLE_PROVIDERS =
            List.of(ProviderType.VACADEMY_AI, ProviderType.AAVTAAR);

    public static final String RT_VOICE_OUT = "voice_call_out";
    public static final String RT_VOICE_IN = "voice_call_in";
    public static final String RT_AI_OUT = "ai_call_out";
    public static final String RT_AI_IN = "ai_call_in";

    /**
     * Engine assumed when an agent cannot be resolved. MUST match the voice bot's
     * own fallback for a missing tts_model (voice_bot_service/app/config.py,
     * TTS_MODEL default) — see {@link #resolveEngine}.
     */
    private static final String ENGINE_FALLBACK = "sarvam";

    @Autowired private CreditClient creditClient;
    @Autowired private VoiceCallingSettingsService voiceSettings;
    @Autowired private TelephonyCallLogRepository callLogRepo;
    @Autowired private AiCallResultRepository aiCallResultRepo;
    @PersistenceContext private EntityManager entityManager;

    /**
     * Static twin of {@link #isVoiceBillableProvider}, so a pre-dial caller can ask
     * "would this call be charged to the Vacademy wallet?" without taking a bean
     * dependency on the billing service. The pre-dial credit gate and this meter
     * MUST agree on the provider set: gating a provider we never bill would block
     * an institute for spend it does not make, and billing one we never gate is the
     * hole this whole change exists to close.
     */
    public static boolean isVoiceBillable(String providerType) {
        return providerType != null && VOICE_BILLABLE_PROVIDERS.contains(providerType);
    }

    public boolean isVoiceBillableProvider(String providerType) {
        return isVoiceBillable(providerType);
    }

    /**
     * Static twin of {@link #isAiBillableProvider}, for readers that report what is still
     * to be charged (the public API's usage and per-call cost) and must use the same set.
     */
    public static boolean isAiBillable(String provider) {
        return provider != null && AI_BILLABLE_PROVIDERS.contains(provider);
    }

    public boolean isAiBillableProvider(String provider) {
        return isAiBillable(provider);
    }

    /**
     * Stable dedup identity for the AI-minutes charge of one PHYSICAL call — or null
     * when no safe identity exists (then DO NOT bill: an unbindable report with no
     * provider call id mints a brand-new ai_call_result + call-log row on every
     * webhook re-delivery, so any row-derived key would charge once per delivery).
     * Preference: the provider's own call id (re-POSTs with the same call_uuid upsert
     * in place → stable) → the call-log id, but ONLY when the row provably pre-dates
     * the report (correlationId = the id we minted at dial/answer time, or the report
     * bound to an existing row) — never the id of a row the promotion itself created.
     */
    public static String aiIdempotencyKey(String provider, String callUuid,
                                          String correlationId, String boundCallLogId) {
        if (callUuid != null && !callUuid.isBlank()) {
            return "ai_call:uuid:" + provider + ":" + callUuid.trim();
        }
        if (boundCallLogId != null && correlationId != null && !correlationId.isBlank()) {
            return "ai_call:" + boundCallLogId;
        }
        return null;
    }

    /** Telephony-minutes meter. Call only for COMPLETED rows with duration > 0. */
    @Async("callBillingExecutor")
    public void billVoiceLeg(String callLogId, String instituteId, String providerType,
                             String direction, int durationSeconds) {
        try {
            String requestType = "INBOUND".equalsIgnoreCase(direction) ? RT_VOICE_IN : RT_VOICE_OUT;
            boolean ok = bill(callLogId, instituteId, requestType, durationSeconds,
                    "voice_call:" + callLogId,
                    "Call minutes (" + providerType + " " + direction + ")",
                    BigDecimal.ZERO,
                    callMetering(USE_CASE_TELEPHONY, "call_log_id", callLogId, providerType, direction,
                            durationSeconds, null, null, null, leadIdForCallLog(callLogId)));
            if (ok) callLogRepo.markCreditsBilled(callLogId, Instant.now());
        } catch (Exception e) {
            log.error("call-billing: voice leg failed call={} inst={}: {}",
                    callLogId, instituteId, e.getMessage());
        }
    }

    /**
     * AI-conversation-minutes meter. {@code idempotencyKey} MUST come from
     * {@link #aiIdempotencyKey}; {@code aiCallResultId} is stamped on success so the
     * reconciliation sweep stops re-attempting.
     */
    @Async("callBillingExecutor")
    public void billAiLeg(String idempotencyKey, String aiCallResultId, String instituteId,
                          String provider, String direction, int durationSeconds,
                          String agentId) {
        try {
            String requestType = "INBOUND".equalsIgnoreCase(direction) ? RT_AI_IN : RT_AI_OUT;
            String engine = resolveEngine(provider, agentId);
            BigDecimal surcharge = resolveEngineSurcharge(engine);
            boolean ok = bill(aiCallResultId, instituteId, requestType, durationSeconds,
                    idempotencyKey,
                    "AI call minutes (" + provider + " " + direction
                            + (engine != null ? " · " + engine : "") + ")",
                    surcharge,
                    callMetering(USE_CASE_AI_CALLING, "ai_call_result_id", aiCallResultId, provider, direction,
                            durationSeconds, agentId, engine, agentName(agentId),
                            leadIdForAiCallResult(aiCallResultId)));
            if (ok) aiCallResultRepo.markCreditsBilled(aiCallResultId, Instant.now());
        } catch (Exception e) {
            log.error("call-billing: ai leg failed result={} inst={}: {}",
                    aiCallResultId, instituteId, e.getMessage());
        }
    }

    /** ai_usage_event use cases (ai_use_case_catalog keys) for the two meters. */
    static final String USE_CASE_TELEPHONY = "telephony";
    static final String USE_CASE_AI_CALLING = "ai_calling";

    /**
     * Usage-metering fields for one call charge: a system meter on the PHONE surface,
     * with what identifies the call in the context. Never affects the amount.
     */
    static MeteringFields callMetering(String useCase, String refKey, String refId, String provider,
                                       String direction, int durationSeconds, String agentId, String engine) {
        return callMetering(useCase, refKey, refId, provider, direction, durationSeconds, agentId, engine,
                null, null);
    }

    /** As above, plus the agent's display name and the lead (audience_response) id when known. */
    static MeteringFields callMetering(String useCase, String refKey, String refId, String provider,
                                       String direction, int durationSeconds, String agentId, String engine,
                                       String agentName, String leadId) {
        java.util.Map<String, Object> context = new java.util.HashMap<>();
        if (refId != null) context.put(refKey, refId);
        if (provider != null) context.put("provider", provider);
        if (direction != null) context.put("direction", direction);
        context.put("duration_seconds", durationSeconds);
        if (agentId != null && !agentId.isBlank()) context.put("agent_id", agentId);
        if (engine != null) context.put("tts_engine", engine);
        if (agentName != null && !agentName.isBlank()) context.put("agent_name", agentName);
        if (leadId != null && !leadId.isBlank()) context.put("lead_id", leadId);
        return MeteringFields.system(useCase)
                .surface(MeteringFields.SURFACE_PHONE)
                .usageContext(context)
                .build();
    }

    /**
     * {@code metering} with the BILLED minutes (pulse-rounded, the same quantity the
     * description's billed label shows) in usage_context.minutes, which ai_service
     * stores as the event's minutes. Null in, null out; never affects the amount.
     */
    static MeteringFields withBilledMinutes(MeteringFields metering, long pulses, int pulseSeconds) {
        if (metering == null) return null;
        java.util.Map<String, Object> context = new java.util.LinkedHashMap<>();
        if (metering.usageContext() != null) context.putAll(metering.usageContext());
        context.put("minutes", BigDecimal.valueOf(pulses * (long) pulseSeconds)
                .divide(BigDecimal.valueOf(60), 3, RoundingMode.HALF_UP));
        return metering.toBuilder().usageContext(context).build();
    }

    /** ai_agent.name for the usage-event label; best effort (null on any problem). */
    private String agentName(String agentId) {
        if (agentId == null || agentId.isBlank()) return null;
        try {
            List<?> rows = entityManager.createNativeQuery("SELECT name FROM ai_agent WHERE id = :id")
                    .setParameter("id", agentId)
                    .getResultList();
            return rows.isEmpty() || rows.get(0) == null ? null : String.valueOf(rows.get(0));
        } catch (Exception e) {
            log.debug("call-billing: agent name lookup failed for {}: {}", agentId, e.getMessage());
            return null;
        }
    }

    /** The lead (audience_response) a call log targeted, for the usage-event context; best effort. */
    private String leadIdForCallLog(String callLogId) {
        if (callLogId == null || callLogId.isBlank()) return null;
        try {
            List<?> rows = entityManager.createNativeQuery(
                    "SELECT response_id FROM telephony_call_log WHERE id = :id "
                            + "AND (subject_type IS NULL OR subject_type = 'LEAD')")
                    .setParameter("id", callLogId)
                    .getResultList();
            return rows.isEmpty() || rows.get(0) == null ? null : String.valueOf(rows.get(0));
        } catch (Exception e) {
            log.debug("call-billing: lead lookup failed for call {}: {}", callLogId, e.getMessage());
            return null;
        }
    }

    /** The lead behind an AI call result (via its call log), for the usage-event context; best effort. */
    private String leadIdForAiCallResult(String aiCallResultId) {
        if (aiCallResultId == null || aiCallResultId.isBlank()) return null;
        try {
            List<?> rows = entityManager.createNativeQuery(
                    "SELECT cl.response_id FROM ai_call_result r "
                            + "JOIN telephony_call_log cl ON cl.id = r.call_log_id "
                            + "WHERE r.id = :id AND (cl.subject_type IS NULL OR cl.subject_type = 'LEAD')")
                    .setParameter("id", aiCallResultId)
                    .getResultList();
            return rows.isEmpty() || rows.get(0) == null ? null : String.valueOf(rows.get(0));
        } catch (Exception e) {
            log.debug("call-billing: lead lookup failed for ai result {}: {}", aiCallResultId, e.getMessage());
            return null;
        }
    }

    /** @return true when ai_service acknowledged the charge (or its idempotent replay). */
    private boolean bill(String refId, String instituteId, String requestType,
                         int durationSeconds, String idempotencyKey, String description,
                         BigDecimal engineSurcharge, MeteringFields metering) {
        if (instituteId == null || instituteId.isBlank() || durationSeconds <= 0) return false;

        Rate rate = resolveRate(instituteId, requestType);
        if (rate == null) {
            log.warn("call-billing: no rate for {} (no override, no credit_pricing row) — skipping ref={}",
                    requestType, refId);
            return false;
        }
        BigDecimal perMinute = rate.perMinute();
        // signum() != 0, not > 0: the column is a SURCHARGE but a negative value
        // is a legitimate per-engine DISCOUNT. Edge TTS costs us nothing, so an
        // Edge agent is sold at 2 credits/min on the AI leg rather than 5 —
        // expressed as -3 here. With the old `> 0` guard that discount was
        // silently dropped and the institute was charged the full rate.
        if (engineSurcharge != null && engineSurcharge.signum() != 0) {
            if (rate.negotiated()) {
                // A per-institute override is an AGREED all-in price. Silently adding
                // a surcharge on top would break a negotiated number that somebody
                // quoted in writing, so the override always wins outright.
                log.info("call-billing: institute {} has a negotiated {} rate — engine surcharge {} not applied",
                        instituteId, requestType, engineSurcharge);
            } else {
                // Never below zero: a discount larger than the rate must not
                // turn a call into a credit refund.
                perMinute = perMinute.add(engineSurcharge).max(BigDecimal.ZERO);
            }
        }
        // Billing granularity. The rate stays credits-per-MINUTE; the pulse only decides
        // how coarsely the duration is rounded up, so changing it never reprices the rate
        // itself. Default 60 = the historical per-minute behaviour.
        int pulseSeconds = resolvePulseSeconds(instituteId);
        long pulses = (durationSeconds + pulseSeconds - 1L) / pulseSeconds; // ceil, min 1
        BigDecimal perPulse = perMinute
                .multiply(BigDecimal.valueOf(pulseSeconds))
                .divide(BigDecimal.valueOf(60), 6, RoundingMode.HALF_UP);
        BigDecimal cost = perPulse.multiply(BigDecimal.valueOf(pulses))
                .max(rate.minimum())
                .setScale(4, RoundingMode.HALF_UP);
        String billedLabel = pulseSeconds == 60
                ? pulses + " min"
                : pulses + " x " + pulseSeconds + "s";
        if (cost.signum() <= 0) {
            // 0-rate = metering disabled (globally or per-institute): report success so
            // the caller stamps the row and the sweeper doesn't retry forever.
            return true;
        }

        boolean ok = creditClient.deductPrecomputed(
                instituteId, requestType, description + " · " + billedLabel,
                cost, idempotencyKey, withBilledMinutes(metering, pulses, pulseSeconds));
        log.info("call-billing: {} ref={} inst={} secs={} pulse={}s billed={} credits={} ok={}",
                requestType, refId, instituteId, durationSeconds, pulseSeconds, billedLabel, cost, ok);
        return ok;
    }

    /** @param negotiated true when this came from a per-institute override, i.e. an
     *  agreed all-in price that engine surcharges must not be stacked onto. */
    private record Rate(BigDecimal perMinute, BigDecimal minimum, boolean negotiated) {}

    /**
     * Per-institute override → global credit_pricing. Overrides live in
     * VOICE_CALLING_SETTING.billing (institutes.setting_json), which is OPS-ONLY: the
     * tenant-facing voice-config save endpoint preserves the stored billing block
     * (a tenant zeroing their own rates = free calls), so writes happen via manual DB
     * update today and a root-admin surface later. The legacy blanket
     * perMinuteCreditOverride applies to the VOICE meters only.
     */
    /**
     * Which TTS engine this call is PRICED against.
     *
     * <p>Deliberately the agent's CONFIGURED engine, not the engine that actually
     * spoke (which the voice bot records separately in the call diagnostics). The
     * institute agreed a price for the engine they chose; if our own infrastructure
     * falls back to the other one — a missing API key, a vendor outage — that is our
     * problem, and letting it move the customer's bill either way would make their
     * per-minute price depend on our incidents. The diagnostics field is the audit
     * trail for spotting the mismatch.
     *
     * <p>Only VACADEMY_AI calls run through our TTS at all. AAVTAAR brings its own,
     * so there is nothing of ours to surcharge.
     *
     * <p>An unresolvable agent (no id, deleted row, or the built-in fallback persona,
     * which has no row) resolves to 'sarvam' — matching the voice bot's OWN fallback
     * for a missing tts_model. These two defaults must stay in lockstep: if they ever
     * disagree we would serve one engine and charge for the other.
     */
    private String resolveEngine(String provider, String agentId) {
        if (!ProviderType.VACADEMY_AI.equals(provider)) return null;
        if (agentId == null || agentId.isBlank()) return ENGINE_FALLBACK;
        try {
            List<?> rows = entityManager.createNativeQuery(
                    "SELECT tts_model FROM ai_agent WHERE id = :id")
                    .setParameter("id", agentId)
                    .getResultList();
            if (rows.isEmpty()) return ENGINE_FALLBACK;
            Object v = rows.get(0);
            String m = v == null ? null : String.valueOf(v).trim().toLowerCase();
            return (m == null || m.isEmpty() || "null".equals(m)) ? ENGINE_FALLBACK : m;
        } catch (Exception e) {
            log.error("call-billing: tts_model lookup failed for agent {}: {}", agentId, e.getMessage());
            return ENGINE_FALLBACK;
        }
    }

    /**
     * Per-minute credit surcharge for an engine, from ai_tts_model_pricing (V421).
     *
     * <p>Returns ZERO on a missing row and logs it loudly. That is a deliberate
     * choice to UNDER-bill rather than skip the charge entirely: dropping the whole
     * AI-minutes charge because a pricing row is absent would lose the base revenue
     * too, and the reconciliation sweeper would then retry it forever.
     */
    private BigDecimal resolveEngineSurcharge(String engine) {
        if (engine == null || engine.isBlank()) return BigDecimal.ZERO;
        try {
            List<?> rows = entityManager.createNativeQuery(
                    "SELECT surcharge_credits_per_min FROM ai_tts_model_pricing "
                    + "WHERE model = :m AND is_active = TRUE")
                    .setParameter("m", engine)
                    .getResultList();
            if (rows.isEmpty()) {
                log.error("call-billing: no ai_tts_model_pricing row for engine '{}' — billing base rate only", engine);
                return BigDecimal.ZERO;
            }
            return toDecimal(rows.get(0));
        } catch (Exception e) {
            log.error("call-billing: engine surcharge lookup failed for '{}': {}", engine, e.getMessage());
            return BigDecimal.ZERO;
        }
    }

    /**
     * Billing pulse for this institute, in seconds: the per-institute override when set,
     * otherwise the platform default. Falls back to 60 (per-minute) on any error, which is
     * the historical behaviour and never bills MORE than the institute expects.
     */
    private int resolvePulseSeconds(String instituteId) {
        try {
            VoiceCallingSettingsPojo pojo = voiceSettings.get(instituteId);
            VoiceCallingSettingsPojo.BillingConfig billing = pojo == null ? null : pojo.getBilling();
            if (billing != null && billing.getBillingPulseSeconds() != null
                    && billing.getBillingPulseSeconds() > 0) {
                return billing.getBillingPulseSeconds();
            }
        } catch (Exception e) {
            log.debug("call-billing: pulse lookup failed for {} — using default {}s",
                    instituteId, defaultPulseSeconds);
        }
        return defaultPulseSeconds > 0 ? defaultPulseSeconds : 30;
    }

    private Rate resolveRate(String instituteId, String requestType) {
        VoiceCallingSettingsPojo.BillingConfig billing = null;
        try {
            VoiceCallingSettingsPojo pojo = voiceSettings.get(instituteId);
            billing = pojo == null ? null : pojo.getBilling();
        } catch (Exception e) {
            log.debug("call-billing: settings load failed for {} — using global rates", instituteId);
        }
        if (billing != null) {
            Double override = switch (requestType) {
                case RT_VOICE_OUT -> billing.getVoiceCallOutPerMinuteCredits() != null
                        ? billing.getVoiceCallOutPerMinuteCredits() : billing.getPerMinuteCreditOverride();
                case RT_VOICE_IN -> billing.getVoiceCallInPerMinuteCredits() != null
                        ? billing.getVoiceCallInPerMinuteCredits() : billing.getPerMinuteCreditOverride();
                case RT_AI_OUT -> billing.getAiCallOutPerMinuteCredits();
                case RT_AI_IN -> billing.getAiCallInPerMinuteCredits();
                default -> null;
            };
            if (override != null) {
                return new Rate(BigDecimal.valueOf(override), BigDecimal.ZERO, true);
            }
        }

        // Global default from credit_pricing (same DB): token_rate = credits/minute.
        try {
            @SuppressWarnings("unchecked")
            List<Object[]> rows = entityManager.createNativeQuery(
                    "SELECT token_rate, minimum_charge FROM credit_pricing " +
                    "WHERE request_type = :rt AND is_active = TRUE")
                    .setParameter("rt", requestType)
                    .getResultList();
            if (rows.isEmpty()) return null;
            Object[] row = rows.get(0);
            return new Rate(toDecimal(row[0]), toDecimal(row[1]), false);
        } catch (Exception e) {
            log.error("call-billing: credit_pricing lookup failed for {}: {}", requestType, e.getMessage());
            return null;
        }
    }

    private static BigDecimal toDecimal(Object o) {
        if (o == null) return BigDecimal.ZERO;
        if (o instanceof BigDecimal bd) return bd;
        return new BigDecimal(o.toString());
    }
}
