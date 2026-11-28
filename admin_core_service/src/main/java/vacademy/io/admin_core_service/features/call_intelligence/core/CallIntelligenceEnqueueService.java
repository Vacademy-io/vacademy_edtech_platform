package vacademy.io.admin_core_service.features.call_intelligence.core;

import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.call_intelligence.core.dto.CrmIntelligenceSettingsPojo;
import vacademy.io.admin_core_service.features.call_intelligence.persistence.entity.CallIntelligence;
import vacademy.io.admin_core_service.features.call_intelligence.persistence.repository.CallIntelligenceRepository;
import vacademy.io.admin_core_service.features.telephony.enums.ProviderType;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.TelephonyCallLog;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.TelephonyCallLogRepository;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;

/**
 * Enqueues a call for transcription + LLM analysis by inserting a PENDING
 * {@link CallIntelligence} row (the DB-backed work queue). Called from the single
 * point where a recording lands in our own storage — {@code recording_storage_key}
 * being set — which is uniform across every source: Exotel/Airtel
 * ({@code RecordingTxOps}), AI/Aavtaar ({@code AiCallRecordingService}) and manual
 * uploads. That's the earliest moment we have something transcribable plus the
 * call's duration/status, so it's the right trigger.
 *
 * <p><b>Best-effort:</b> never throws — a failure here must not roll back or block
 * the recording-persistence flow that called it. <b>Idempotent:</b> a unique index
 * on {@code call_log_id} plus the existence check make re-delivery safe.
 *
 * <p>Credit balance is intentionally NOT checked here — that happens when the
 * poller dispatches the job (balance can change between enqueue and dispatch, and
 * we don't want to gate the recording flow on a credits lookup). An institute with
 * no balance simply gets the row marked SKIPPED/INSUFFICIENT_CREDITS later.
 */
@Service
@RequiredArgsConstructor
public class CallIntelligenceEnqueueService {

    private static final Logger log = LoggerFactory.getLogger(CallIntelligenceEnqueueService.class);

    private final CrmIntelligenceSettingsService settingsService;
    private final CallIntelligenceRepository repo;
    private final TelephonyCallLogRepository callLogRepo;

    /**
     * Insert a PENDING analysis row for {@code row} if the institute has call
     * intelligence enabled for this call's source and the call clears the
     * eligibility gates. Safe to call multiple times for the same call.
     */
    public void enqueueIfEligible(TelephonyCallLog row) {
        try {
            if (row == null || row.getId() == null) return;

            CrmIntelligenceSettingsPojo settings = settingsService.get(row.getInstituteId());
            String source = sourceBucket(row.getProviderType());
            // AI-agent calls are analysed by DEFAULT and free of charge (founder,
            // 2026-09-11: "auto add in all AI calls by default"); the institute's
            // CRM Intelligence switch and source toggles govern human calls only.
            if (!"AI".equals(source)) {
                if (!settings.callsEnabled()) return;
                if (!settings.sourceEnabled(source)) return;
            }

            // Need an actual recording in our storage to transcribe.
            if (isBlank(row.getRecordingStorageKey())) return;

            CrmIntelligenceSettingsPojo.Calls calls = settings.getCalls();
            Integer duration = row.getDurationSeconds();
            // Too-short calls (voicemail blips) carry no analyzable conversation.
            if (duration != null && duration < calls.getMinDurationSeconds()) return;
            // Connected calls only, unless the institute opted in to analyze the rest.
            if (!calls.isAnalyzeNotConnected() && duration != null && duration == 0) return;

            // Idempotent: one analysis per call.
            if (repo.existsByCallLogId(row.getId())) return;

            CallIntelligence ci = CallIntelligence.builder()
                    .callLogId(row.getId())
                    .instituteId(row.getInstituteId())
                    .counsellorUserId(row.getCounsellorUserId())
                    .responseId(row.getResponseId())
                    .userId(row.getUserId())
                    .source(source)
                    .direction(row.getDirection())
                    .callStartedAt(callStartedAt(row))
                    .durationSeconds(duration)
                    .status("PENDING")
                    .attempts(0)
                    .build();
            repo.save(ci);
            log.info("call-intelligence: enqueued call {} (institute {}, source {})",
                    row.getId(), row.getInstituteId(), source);

        } catch (org.springframework.dao.DataIntegrityViolationException dup) {
            // Lost an enqueue race — the unique index did its job. Not an error.
            log.debug("call-intelligence: call {} already enqueued (race)", row.getId());
        } catch (Exception e) {
            // Best-effort: a failure to enqueue must never break recording persistence.
            log.warn("call-intelligence: failed to enqueue call {} — skipping (recording flow unaffected)",
                    row != null ? row.getId() : null, e);
        }
    }

    /**
     * On-demand (re)analysis for a single call, triggered explicitly by a user from
     * the call's intelligence panel. Unlike {@link #enqueueIfEligible}, this BYPASSES
     * the per-source toggle and the min-duration gate (the user asked for THIS call) —
     * it only still requires the feature to be on for the institute and a recording to
     * exist. Creates the PENDING row, or resets an existing FAILED/SKIPPED/COMPLETED
     * row back to PENDING so the poller re-runs it. Credit dedup (idempotency_key =
     * call_intelligence:{callLogId}) means a re-analyze never double-charges.
     *
     * @return a status code for the API: QUEUED | NOT_FOUND | DISABLED | NO_RECORDING.
     */
    @Transactional
    public String triggerManual(String callLogId) {
        if (isBlank(callLogId)) return "NOT_FOUND";
        TelephonyCallLog row = callLogRepo.findById(callLogId).orElse(null);
        if (row == null) return "NOT_FOUND";

        CrmIntelligenceSettingsPojo settings = settingsService.get(row.getInstituteId());
        // AI-agent calls are always analysable (default-on, free); the switch
        // gates human calls only — same rule as enqueueIfEligible.
        if (!"AI".equals(sourceBucket(row.getProviderType())) && !settings.callsEnabled()) return "DISABLED";
        if (isBlank(row.getRecordingStorageKey())) return "NO_RECORDING";

        CallIntelligence ci = repo.findByCallLogId(callLogId).orElse(null);
        if (ci == null) {
            ci = CallIntelligence.builder()
                    .callLogId(row.getId())
                    .instituteId(row.getInstituteId())
                    .counsellorUserId(row.getCounsellorUserId())
                    .responseId(row.getResponseId())
                    .userId(row.getUserId())
                    .source(sourceBucket(row.getProviderType()))
                    .direction(row.getDirection())
                    .callStartedAt(callStartedAt(row))
                    .durationSeconds(row.getDurationSeconds())
                    .status("PENDING")
                    .attempts(0)
                    .build();
        } else {
            // Reset for a fresh run (retry a failure, or re-analyze a completed call).
            ci.setStatus("PENDING");
            ci.setSkipReason(null);
            ci.setError(null);
            ci.setAttempts(0);
            ci.setJobId(null);
            ci.setCompletedAt(null);
        }
        repo.save(ci);
        log.info("call-intelligence: manual (re)analyze queued for call {} (institute {})",
                row.getId(), row.getInstituteId());
        return "QUEUED";
    }

    /**
     * Analysis a client asked for explicitly on one call — the public API's
     * {@code analyze: true} on POST /v1/human-calls. Unlike {@link #triggerManual} this
     * also bypasses the institute's CRM Intelligence switch (off by default): the API
     * client opted in for this call and is billed for it (credit_pricing
     * 'call_intelligence', charged per minute by ai_service), so an institute toggle must
     * not silently drop it. Still needs a recording, and never resets an existing row —
     * one the recording flow already enqueued (institute auto-analysis) may be running,
     * and resetting it would start a second transcription.
     *
     * @return QUEUED | EXISTS | NOT_FOUND | NO_RECORDING.
     */
    @Transactional
    public String enqueueRequested(String callLogId) {
        if (isBlank(callLogId)) return "NOT_FOUND";
        TelephonyCallLog row = callLogRepo.findById(callLogId).orElse(null);
        if (row == null) return "NOT_FOUND";
        if (isBlank(row.getRecordingStorageKey())) return "NO_RECORDING";
        if (repo.existsByCallLogId(callLogId)) return "EXISTS";
        repo.save(CallIntelligence.builder()
                .callLogId(row.getId())
                .instituteId(row.getInstituteId())
                .counsellorUserId(row.getCounsellorUserId())
                .responseId(row.getResponseId())
                .userId(row.getUserId())
                .source(sourceBucket(row.getProviderType()))
                .direction(row.getDirection())
                .callStartedAt(callStartedAt(row))
                .durationSeconds(row.getDurationSeconds())
                .status("PENDING")
                .attempts(0)
                .build());
        log.info("call-intelligence: API-requested analysis queued for call {} (institute {})",
                row.getId(), row.getInstituteId());
        return "QUEUED";
    }

    /** Bucket a provider type into the source toggle keys: MANUAL | AI | TELEPHONY. */
    private static String sourceBucket(String providerType) {
        if (ProviderType.MANUAL.equals(providerType)) return "MANUAL";
        // Every AI-agent provider is "AI": AAVTAAR, our own VACADEMY_AI voice bot
        // (missing here until 2026-09-11 — its calls were bucketed as TELEPHONY and
        // gated/charged like a human call) and MOCK (synthetic AI for testing).
        if (ProviderType.AAVTAAR.equals(providerType) || ProviderType.VACADEMY_AI.equals(providerType)
                || ProviderType.MOCK.equals(providerType)) return "AI";
        return "TELEPHONY"; // EXOTEL, AIRTEL, and any future bridge provider
    }

    /** Best available "when the call happened" timestamp for time-based analytics. */
    private static Timestamp callStartedAt(TelephonyCallLog row) {
        if (row.getStartTime() != null) return row.getStartTime();
        if (row.getAnswerTime() != null) return row.getAnswerTime();
        return row.getCreatedAt(); // AI calls have no provider start_time
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }
}
