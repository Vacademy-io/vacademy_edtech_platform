package vacademy.io.admin_core_service.features.telephony.publicapi;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.call_intelligence.persistence.entity.CallIntelligence;
import vacademy.io.admin_core_service.features.call_intelligence.persistence.repository.CallIntelligenceRepository;
import vacademy.io.admin_core_service.features.media_service.service.MediaService;
import vacademy.io.admin_core_service.features.telephony.core.CallBillingService;
import vacademy.io.admin_core_service.features.telephony.core.TelephonyConfigCache;
import vacademy.io.admin_core_service.features.telephony.enums.ProviderType;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.CallDispositionCatalog;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.TelephonyCallLog;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.CallDispositionCatalogRepository;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.TelephonyCallLogRepository;
import vacademy.io.admin_core_service.features.telephony.publicapi.entity.HumanCallApiCall;
import vacademy.io.admin_core_service.features.telephony.publicapi.repository.HumanCallApiCallRepository;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.*;

/**
 * Builds the public view of a human call — {@code object: "human_call"} — from its API row,
 * its telephony_call_log row, its Call Intelligence row and the institute's disposition
 * catalog, and decides whether the call (and, separately, its requested analysis) is
 * final. GET /v1/human-calls/{id} and the webhooks share this, so an event says exactly
 * what a GET says.
 *
 * <p>Status mapping from telephony_call_log: INITIATED/QUEUED → queued,
 * COUNSELLOR_RINGING → ringing_counsellor, COUNSELLOR_ANSWERED → connecting,
 * IN_PROGRESS → in_progress, COMPLETED → completed, NO_ANSWER → no_answer, BUSY → busy,
 * FAILED → failed, CANCELLED → canceled. How live these are depends on the provider
 * ({@code status_updates}): Vacademy Voice (Plivo) reports every step, Exotel only the
 * end, Airtel only once its call record is imported (minutes to hours later).
 *
 * <p>Like {@link AiCallingApiViews}, nothing here mutates an entity (open-session-in-view
 * would flush it as a whole-row UPDATE); the only write is the targeted, idempotent
 * terminal_seen_at fill.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class HumanCallViews {

    public static final Set<String> FINAL_STATUSES =
            Set.of("completed", "no_answer", "busy", "failed", "canceled");
    static final Set<String> CALL_LOG_TERMINAL = Set.of("COMPLETED", "NO_ANSWER", "BUSY", "FAILED", "CANCELLED");
    /** Between the insert and the dial a row has no call log; it is still being placed. */
    static final Duration CREATING_GRACE = Duration.ofMinutes(2);
    /** A call that never reports an end is failed after this (Airtel: its CDR import can lag). */
    static final Duration STUCK_AFTER = Duration.ofHours(2);
    static final Duration STUCK_AFTER_AIRTEL = Duration.ofHours(24);
    /** How long a connected call waits for its recording copy before its event goes out. */
    static final Duration RECORDING_WAIT = Duration.ofMinutes(10);
    static final Duration RECORDING_WAIT_AIRTEL = Duration.ofMinutes(60);
    static final String NO_RESULT = "No final status was received for this call.";
    /**
     * ai_service/app/services/call_intelligence_poller.py MAX_ATTEMPTS: a FAILED
     * call_intelligence row with fewer claims than this is re-armed (after 30 minutes).
     */
    static final int CI_MAX_ATTEMPTS = 4;
    static final String NOT_PLACED = "The call could not be placed.";

    private static final ObjectMapper JSON = new ObjectMapper();

    private final HumanCallApiCallRepository callRepository;
    private final TelephonyCallLogRepository callLogRepository;
    private final CallIntelligenceRepository intelligenceRepository;
    private final CallDispositionCatalogRepository dispositionCatalog;
    private final TelephonyConfigCache configCache;
    private final MediaService mediaService;
    private final NamedParameterJdbcTemplate jdbc;

    /** The computed state of a call. {@code noAnswerBy} only for no_answer / busy, and only when known. */
    public record State(String status, boolean isFinal, String reason, String noAnswerBy,
                        TelephonyCallLog callLog, Instant terminalSeenAt) {
    }

    public State state(HumanCallApiCall c) {
        Instant now = Instant.now();
        TelephonyCallLog l = c.getCallLogId() == null ? null
                : callLogRepository.findById(c.getCallLogId()).orElse(null);
        if (l == null) {
            boolean creating = c.getCreatedAt() == null || c.getCreatedAt().plus(CREATING_GRACE).isAfter(now);
            return creating ? new State("queued", false, null, null, null, null)
                    : new State("failed", true, NOT_PLACED, null, null, null);
        }
        String ls = l.getStatus() == null ? "" : l.getStatus();
        Instant terminalSeenAt = c.getTerminalSeenAt();
        if (CALL_LOG_TERMINAL.contains(ls) && terminalSeenAt == null) {
            terminalSeenAt = now;
            try {
                callRepository.setTerminalSeenAtIfNull(c.getId(), now);
            } catch (RuntimeException e) {
                log.debug("human-call-api: could not record end for {}: {}", c.getId(), e.getMessage());
            }
        }
        return switch (ls) {
            case "COMPLETED" -> new State("completed", recordingSettled(c, l, terminalSeenAt, now), null, null,
                    l, terminalSeenAt);
            case "NO_ANSWER" -> new State("no_answer", true, null,
                    noAnswerBy(l.getProviderType(), ls, l.getRawPayloadJson()), l, terminalSeenAt);
            case "BUSY" -> new State("busy", true, null,
                    noAnswerBy(l.getProviderType(), ls, l.getRawPayloadJson()), l, terminalSeenAt);
            case "FAILED" -> new State("failed", true, failureReason(l.getTerminationReason()), null, l, terminalSeenAt);
            case "CANCELLED" -> new State("canceled", true, null, null, l, terminalSeenAt);
            default -> {
                Instant dialed = l.getCreatedAt() == null ? null : l.getCreatedAt().toInstant();
                if (dialed != null && dialed.plus(stuckAfter(l.getProviderType())).isBefore(now)) {
                    yield new State("failed", true, NO_RESULT, null, l, terminalSeenAt);
                }
                yield new State(liveStatus(ls), false, null, null, l, terminalSeenAt);
            }
        };
    }

    /**
     * telephony_call_log status → public status, for a call still running. Anything else
     * not terminal (INITIATED, QUEUED, unknown) is "queued". HumanCallApiCallRepository.page
     * repeats this mapping in SQL for the status filter; HumanCallViewsTest checks the two agree.
     */
    static final Map<String, String> LIVE_STATUS = Map.of(
            "COUNSELLOR_RINGING", "ringing_counsellor",
            "COUNSELLOR_ANSWERED", "connecting",
            "IN_PROGRESS", "in_progress");
    /** telephony_call_log terminal status → public status (same SQL mirror as above). */
    static final Map<String, String> TERMINAL_STATUS = Map.of(
            "COMPLETED", "completed",
            "NO_ANSWER", "no_answer",
            "BUSY", "busy",
            "FAILED", "failed",
            "CANCELLED", "canceled");

    static String liveStatus(String callLogStatus) {
        return LIVE_STATUS.getOrDefault(callLogStatus == null ? "" : callLogStatus, "queued");
    }

    static Duration stuckAfter(String providerType) {
        return ProviderType.AIRTEL.equals(providerType) ? STUCK_AFTER_AIRTEL : STUCK_AFTER;
    }

    /** A connected call is final once its recording is in, recording is off, or the wait ran out. */
    private boolean recordingSettled(HumanCallApiCall c, TelephonyCallLog l, Instant terminalSeenAt, Instant now) {
        if (l.getRecordingStorageKey() != null) return true;
        if (!recordsCalls(c.getInstituteId())) return true;
        Instant ended = terminalSeenAt == null ? now : terminalSeenAt;
        return ended.plus(recordingWait(l.getProviderType())).isBefore(now);
    }

    static Duration recordingWait(String providerType) {
        return ProviderType.AIRTEL.equals(providerType) ? RECORDING_WAIT_AIRTEL : RECORDING_WAIT;
    }

    private boolean recordsCalls(String instituteId) {
        try {
            return configCache.get(instituteId)
                    .map(r -> r.getConfig() == null || !Boolean.FALSE.equals(r.getConfig().getRecordCalls()))
                    .orElse(true);
        } catch (RuntimeException e) {
            return true;
        }
    }

    /**
     * Which leg did not pick up, when the provider's last report says so; null otherwise.
     * Exotel's connect callback carries the first (counsellor) leg in {@code Status} and the
     * second (contact) leg in {@code DialCallStatus}; Plivo reports the contact leg as
     * {@code DialBLeg*}. Nothing is guessed: Airtel, and any report without those fields,
     * gives null.
     */
    static String noAnswerBy(String providerType, String callLogStatus, String rawPayload) {
        if (!"NO_ANSWER".equals(callLogStatus) && !"BUSY".equals(callLogStatus)) return null;
        Map<String, String> p = payload(rawPayload);
        if (p.isEmpty()) return null;
        if (ProviderType.EXOTEL.equals(providerType)) {
            String status = lower(p.get("Status"));
            String dial = lower(p.get("DialCallStatus"));
            if (status.contains("completed") && (dial.contains("no-answer") || dial.contains("busy"))) return "contact";
            if (status.contains("no-answer") || status.contains("busy")) return "counsellor";
            return null;
        }
        if (ProviderType.PLIVO.equals(providerType)) {
            if (p.containsKey("DialBLegStatus") || p.containsKey("DialBLegHangupCause")) return "contact";
            return null;
        }
        return null;
    }

    /** A provider report kept verbatim: a flat JSON object or a form-encoded body. */
    static Map<String, String> payload(String raw) {
        Map<String, String> out = new HashMap<>();
        if (raw == null || raw.isBlank()) return out;
        String t = raw.trim();
        try {
            if (t.startsWith("{")) {
                JsonNode n = JSON.readTree(t);
                n.fields().forEachRemaining(e -> out.put(e.getKey(), e.getValue().isValueNode() ? e.getValue().asText() : e.getValue().toString()));
                return out;
            }
            for (String pair : t.split("&")) {
                int eq = pair.indexOf('=');
                if (eq <= 0) continue;
                out.put(URLDecoder.decode(pair.substring(0, eq), StandardCharsets.UTF_8),
                        URLDecoder.decode(pair.substring(eq + 1), StandardCharsets.UTF_8));
            }
        } catch (Exception e) {
            log.debug("human-call-api: unreadable provider payload: {}", e.getMessage());
        }
        return out;
    }

    private static String failureReason(String terminationReason) {
        if (terminationReason == null || terminationReason.isBlank()) return "The call failed.";
        return switch (terminationReason) {
            case "provider_initiate_failure", "provider_rejected" -> "The calling provider refused the call.";
            default -> "The call failed (" + terminationReason + ").";
        };
    }

    /** How fresh a call's status is, per provider. */
    static String statusUpdates(String providerType) {
        if (ProviderType.EXOTEL.equals(providerType)) return "final_only";
        if (ProviderType.AIRTEL.equals(providerType)) return "delayed";
        return "realtime";
    }

    // ── The object ───────────────────────────────────────────────────────────────

    public Map<String, Object> view(HumanCallApiCall c) {
        return view(c, state(c));
    }

    public Map<String, Object> view(HumanCallApiCall c, State s) {
        TelephonyCallLog l = s.callLog();
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", c.getId());
        m.put("object", "human_call");
        m.put("status", s.status());
        if (s.reason() != null && !s.reason().isBlank()) m.put("status_reason", s.reason());
        if ("no_answer".equals(s.status()) || "busy".equals(s.status())) m.put("no_answer_by", s.noAnswerBy());
        Map<String, Object> counsellor = new LinkedHashMap<>();
        counsellor.put("id", c.getCounsellorUserId());
        counsellor.put("name", c.getCounsellorName());
        counsellor.put("email", c.getCounsellorEmail());
        m.put("counsellor", counsellor);
        m.put("phone_number", c.getPhoneNumber());
        Map<String, Object> contact = new LinkedHashMap<>();
        contact.put("name", c.getContactName());
        contact.put("email", c.getContactEmail());
        contact.put("external_id", c.getExternalId());
        m.put("contact", contact);
        m.put("crm_lead_linked", c.getResponseId() != null);
        m.put("metadata", c.getMetadata() == null ? Map.of() : c.getMetadata());
        m.put("analyze", c.isAnalysisRequested());
        String provider = l != null ? l.getProviderType() : c.getProviderType();
        m.put("status_updates", statusUpdates(provider));

        Instant now = Instant.now();
        m.put("created_at", c.getCreatedAt() == null ? null : c.getCreatedAt().toString());
        Instant dialedAt = l == null || l.getCreatedAt() == null ? null : l.getCreatedAt().toInstant();
        m.put("dialed_at", iso(dialedAt));
        Integer duration = l == null ? null : l.getDurationSeconds();
        Instant endedAt = s.isFinal() ? endedAt(c, l, s.terminalSeenAt(), duration, now) : null;
        m.put("answered_at", iso(answeredAt(l, s.status(), endedAt, duration, now)));
        m.put("ended_at", iso(endedAt));
        m.put("duration_seconds", duration);

        String recordingUrl = recordingUrl(l);
        m.put("recording_url", recordingUrl);
        m.put("recording_expires_at", recordingUrl == null ? null
                : now.plus(AiCallingApiViews.RECORDING_LINK_TTL).toString());
        m.put("disposition", disposition(c.getInstituteId(), l));
        CallIntelligence ci = intelligence(l);
        m.put("analysis", analysis(c, s, ci, now));
        m.put("cost", cost(c.getInstituteId(), l, s));
        return m;
    }

    private static String iso(Instant i) {
        return i == null ? null : i.toString();
    }

    /** The carrier's end time, else start + duration, else when we saw it end; never in the future. */
    static Instant endedAt(HumanCallApiCall c, TelephonyCallLog l, Instant terminalSeenAt, Integer duration, Instant now) {
        if (l != null && l.getEndTime() != null && !l.getEndTime().toInstant().isAfter(now)) {
            return l.getEndTime().toInstant();
        }
        Instant start = l == null || l.getStartTime() == null ? null : l.getStartTime().toInstant();
        if (start != null && duration != null && !start.plusSeconds(duration).isAfter(now)) {
            return start.plusSeconds(duration);
        }
        if (terminalSeenAt != null && !terminalSeenAt.isAfter(now)) return terminalSeenAt;
        if (c.getFinalizedAt() != null && !c.getFinalizedAt().isAfter(now)) return c.getFinalizedAt();
        return now;
    }

    /** When the contact picked up: the carrier's answer time, else end − talk time; never in the future. */
    static Instant answeredAt(TelephonyCallLog l, String status, Instant endedAt, Integer duration, Instant now) {
        if (l == null) return null;
        if (l.getAnswerTime() != null && !l.getAnswerTime().toInstant().isAfter(now)) {
            return l.getAnswerTime().toInstant();
        }
        if ("completed".equals(status) && endedAt != null && duration != null && duration > 0) {
            Instant a = endedAt.minusSeconds(duration);
            return a.isAfter(now) ? null : a;
        }
        return null;
    }

    private Map<String, Object> disposition(String instituteId, TelephonyCallLog l) {
        if (l == null || l.getDispositionKey() == null) return null;
        Map<String, Object> d = new LinkedHashMap<>();
        d.put("key", l.getDispositionKey());
        String label = null;
        try {
            label = dispositionCatalog.findByInstituteIdAndDispositionKey(instituteId, l.getDispositionKey())
                    .map(CallDispositionCatalog::getLabel).orElse(null);
        } catch (RuntimeException e) {
            log.debug("human-call-api: disposition label lookup failed: {}", e.getMessage());
        }
        d.put("label", label);
        d.put("notes", l.getDispositionNotes());
        d.put("set_at", l.getDispositionedAt() == null ? null : l.getDispositionedAt().toInstant().toString());
        String by = l.getDispositionedBy();
        d.put("set_by", by == null ? null : by.startsWith("api:") ? "api" : "counsellor");
        return d;
    }

    CallIntelligence intelligence(TelephonyCallLog l) {
        if (l == null) return null;
        try {
            return intelligenceRepository.findByCallLogId(l.getId()).orElse(null);
        } catch (RuntimeException e) {
            log.debug("human-call-api: analysis lookup failed for {}: {}", l.getId(), e.getMessage());
            return null;
        }
    }

    /**
     * The analysis block. With a Call Intelligence row: its state (and results once
     * COMPLETED) — shown even when the institute's own CRM Intelligence setting analysed a
     * call the client did not ask about, since that analysis exists and is paid for.
     * Without one: not_requested, or for a requested analysis pending until the call has
     * ended with a recording, failed when it cannot run (did not connect, no recording).
     */
    static Map<String, Object> analysis(HumanCallApiCall c, State s, CallIntelligence ci, Instant now) {
        Map<String, Object> a = new LinkedHashMap<>();
        if (ci != null) {
            String st = ci.getStatus() == null ? "" : ci.getStatus().toUpperCase(Locale.ROOT);
            switch (st) {
                case "COMPLETED" -> {
                    a.put("status", "completed");
                    a.put("summary", ci.getGeneralSummary());
                    a.put("short_update", ci.getShortUpdate());
                    a.put("call_type", ci.getCallType());
                    a.put("inferred_goal", ci.getInferredGoal());
                    a.put("outcome", ci.getGenericStatus());
                    a.put("sentiment", ci.getLeadSentiment());
                    a.put("conversion_likelihood", ci.getConversionLikelihood());
                    a.put("counsellor_rating", number(ci.getCallerSelfGoalRating()));
                    a.put("outcome_rating", number(ci.getCallOutputRating()));
                    a.put("language", ci.getDetectedLanguage());
                    a.put("credits", number(ci.getCreditsCharged()));
                    a.put("completed_at", ci.getCompletedAt() == null ? null : ci.getCompletedAt().toInstant().toString());
                }
                case "FAILED", "SKIPPED" -> {
                    // ai_service re-arms a FAILED row until it has been claimed
                    // CI_MAX_ATTEMPTS times, so until then it is a retry in waiting, not a
                    // verdict: reporting it failed fired analysis_ready, and the analysis
                    // then completed (and was billed) with no event. SKIPPED is final.
                    int attempts = ci.getAttempts() == null ? 0 : ci.getAttempts();
                    if ("FAILED".equals(st) && attempts < CI_MAX_ATTEMPTS) {
                        a.put("status", "pending");
                    } else {
                        a.put("status", "failed");
                        a.put("reason", ci.getSkipReason() != null ? ci.getSkipReason().toLowerCase(Locale.ROOT)
                                : "analysis_error");
                    }
                }
                default -> a.put("status", "pending");
            }
            return a;
        }
        if (!c.isAnalysisRequested()) {
            a.put("status", "not_requested");
            return a;
        }
        if (s.isFinal() && !"completed".equals(s.status())) {
            a.put("status", "failed");
            a.put("reason", "not_connected");
            return a;
        }
        TelephonyCallLog l = s.callLog();
        if (s.isFinal() && l != null && l.getRecordingStorageKey() == null) {
            a.put("status", "failed");
            a.put("reason", "no_recording");
            return a;
        }
        a.put("status", "pending");
        return a;
    }

    /** completed | failed: the analysis can no longer change. */
    static boolean analysisFinal(Map<String, Object> analysis) {
        Object st = analysis == null ? null : analysis.get("status");
        return "completed".equals(st) || "failed".equals(st);
    }

    private static Double number(BigDecimal v) {
        return v == null ? null : v.doubleValue();
    }

    /**
     * What the call cost this account. Only Vacademy Voice (Plivo) talk time is charged
     * here ({@link CallBillingService#isVoiceBillable}); Exotel and Airtel calls ride the
     * institute's own carrier account, so they cost 0 credits and say billed_by_provider.
     * null while the call is still running.
     */
    Map<String, Object> cost(String instituteId, TelephonyCallLog l, State s) {
        if (l == null || !s.isFinal()) return null;
        Map<String, Object> m = new LinkedHashMap<>();
        if (!CallBillingService.isVoiceBillable(l.getProviderType())) {
            m.put("credits", 0.0);
            m.put("billed", true);
            m.put("note", "billed_by_provider");
            return m;
        }
        if (!"COMPLETED".equals(l.getStatus())) {
            m.put("credits", 0.0);
            m.put("billed", true);
            return m;
        }
        BigDecimal credits;
        try {
            credits = jdbc.queryForObject("""
                    SELECT COALESCE(SUM(ABS(amount)), 0) FROM credit_transactions
                     WHERE institute_id = :i AND transaction_type = 'USAGE_DEDUCTION'
                       AND external_reference_id = :ref
                    """, new MapSqlParameterSource().addValue("i", instituteId).addValue("ref", "voice_call:" + l.getId()),
                    BigDecimal.class);
        } catch (RuntimeException e) {
            log.warn("human-call-api: cost lookup failed for call log {}: {}", l.getId(), e.getMessage());
            return null;
        }
        m.put("credits", (credits == null ? BigDecimal.ZERO : credits).setScale(2, RoundingMode.HALF_UP).doubleValue());
        m.put("billed", !AiCallingUsageService.voiceLegPending(l));
        return m;
    }

    private String recordingUrl(TelephonyCallLog l) {
        if (l == null || l.getRecordingStorageKey() == null) return null;
        try {
            // Same bucket rule as RecordingPlaybackController: Vacademy Voice recordings are private.
            String url = Boolean.TRUE.equals(l.getRecordingPrivate())
                    ? mediaService.getFileUrlById(l.getRecordingStorageKey())
                    : mediaService.getFilePublicUrlById(l.getRecordingStorageKey());
            return url == null || url.isBlank() ? null : url;
        } catch (RuntimeException e) {
            log.warn("human-call-api: recording link failed for call log {}: {}", l.getId(), e.getMessage());
            return null;
        }
    }

    private static String lower(String s) {
        return s == null ? "" : s.toLowerCase(Locale.ROOT);
    }
}
