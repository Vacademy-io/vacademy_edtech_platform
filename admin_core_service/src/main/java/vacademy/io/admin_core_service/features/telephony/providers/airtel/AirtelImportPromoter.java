package vacademy.io.admin_core_service.features.telephony.providers.airtel;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.telephony.core.LeadDirectoryResolver;
import vacademy.io.admin_core_service.features.telephony.core.TelephonyJson;
import vacademy.io.admin_core_service.features.telephony.core.UserMobileResolver;
import vacademy.io.admin_core_service.features.telephony.enums.CallDirection;
import vacademy.io.admin_core_service.features.telephony.enums.CallStatus;
import vacademy.io.admin_core_service.features.telephony.enums.ProviderType;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.AirtelCallImport;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.InstituteTelephonyConfig;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.TelephonyCallLog;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.TelephonyCounsellorEndpoint;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.AirtelCallImportRepository;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.InstituteTelephonyConfigRepository;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.TelephonyCallLogRepository;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.TelephonyCounsellorEndpointRepository;
import vacademy.io.admin_core_service.features.timeline.enums.LeadJourneyActionType;
import vacademy.io.admin_core_service.features.timeline.service.TimelineEventService;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Promotes one {@code airtel_call_import} (CCR/CDR S3) row into the CRM:
 *   • CDR  → enrich OUR click2dial row (stamp the call id + status/duration) or,
 *            if none, create a new telephony_call_log row.
 *   • RECORDING → attach its media_service storage key to the matching call row
 *            + fire a timeline event.
 *
 * Resolves the institute by Airtel account id and the counsellor by extension /
 * provider user id (telephony_counsellor_endpoint). Rows it can't attribute are
 * SKIPPED. {@code promoteRow} is @Transactional and is invoked cross-bean by the
 * scheduler so the proxy applies.
 */
@Service
@ConditionalOnProperty(prefix = "telephony.airtel.s3", name = "enabled", havingValue = "true")
public class AirtelImportPromoter {

    private static final Logger log = LoggerFactory.getLogger(AirtelImportPromoter.class);
    /** Leave an unmatched recording RECEIVED (retry) until its row is this old. */
    private static final long RECORDING_RETRY_MAX_AGE_SECONDS = 3600;
    /** Look-back for our click2dial row (created just before the call started). */
    private static final long MATCH_LOOKBACK_SECONDS = 1800;
    /** Forward slack for clock skew between our create and the provider start. */
    private static final long OUTBOUND_FORWARD_SLACK_SECONDS = 300;
    /** ± window (each side of the call start) when matching a recording to a call. */
    private static final long RECORDING_MATCH_WINDOW_SECONDS = 3600;

    @Autowired private AirtelCallImportRepository importRepo;
    @Autowired private TelephonyCallLogRepository callLogRepo;
    @Autowired private InstituteTelephonyConfigRepository configRepo;
    @Autowired private TelephonyCounsellorEndpointRepository endpointRepo;
    @Autowired private TimelineEventService timelineEventService;
    @Autowired private UserMobileResolver userMobileResolver;
    @Autowired private LeadDirectoryResolver leadDirectoryResolver;
    @Autowired private vacademy.io.admin_core_service.features.call_intelligence.core.CallIntelligenceEnqueueService callIntelligenceEnqueueService;

    /**
     * Promote one staging row, in its OWN transaction. On any failure it lets the
     * exception PROPAGATE so Spring rolls this tx back cleanly — catching here and
     * saving FAILED in the same (now rollback-only) tx is what produced "Transaction
     * silently rolled back because it has been marked as rollback-only" on commit,
     * which aborted the whole poll. The scheduler isolates per-row failures and
     * records them via {@link #markFailed} in a SEPARATE transaction.
     */
    @Transactional
    public void promoteRow(String importId) {
        AirtelCallImport imp = importRepo.findById(importId).orElse(null);
        if (imp == null || !AirtelCallImport.STATUS_RECEIVED.equals(imp.getProcessingStatus())) return;

        String instituteId = resolveInstitute(imp);
        if (instituteId == null) {
            skip(imp, "no institute configured for Airtel account " + imp.getAccountId());
            return;
        }
        imp.setInstituteId(instituteId);

        if (AirtelCallImport.KIND_CDR.equals(imp.getKind())) {
            // A CDR creates/enriches the call row, so it needs the counsellor.
            String counsellor = resolveCounsellor(imp);
            if (counsellor == null) {
                skip(imp, "counsellor not mapped, or mapped twice (ext=" + imp.getSourceExtension()
                        + ", user=" + imp.getSourceUserId() + ")");
                return;
            }
            promoteCdr(imp, instituteId, counsellor);
        } else if (AirtelCallImport.KIND_RECORDING.equals(imp.getKind())) {
            // A recording attaches to an existing call row by call id, so it does
            // NOT need the counsellor up front — inbound recordings can't resolve
            // one (the CSV's "called number" is the DID, not the extension).
            promoteRecording(imp);
        } else {
            skip(imp, "unknown kind " + imp.getKind());
        }
    }

    /**
     * Record a promotion failure in a SEPARATE transaction, so it persists even
     * though the row's own promote tx rolled back. Only touches still-RECEIVED rows
     * (a row another worker already promoted/skipped is left alone). The reason
     * lands in {@code process_detail} — queryable, so failures self-diagnose.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void markFailed(String importId, String reason) {
        importRepo.findById(importId).ifPresent(imp -> {
            if (AirtelCallImport.STATUS_RECEIVED.equals(imp.getProcessingStatus())) {
                imp.setProcessingStatus(AirtelCallImport.STATUS_FAILED);
                imp.setProcessDetail(trunc(reason));
                importRepo.save(imp);
            }
        });
    }

    private String resolveInstitute(AirtelCallImport imp) {
        if (imp.getInstituteId() != null) return imp.getInstituteId();
        if (imp.getAccountId() == null) return null;
        // Match the import's Airtel account id against each AIRTEL config's parsed
        // provider_config JSON in Java. The AIRTEL config set is tiny (one per
        // institute), and this avoids the brace-guarded ::jsonb native query that
        // tripped Hibernate's "{alias}" path parser ("Unmatched braces for alias
        // path") — the bug that failed every promote.
        for (InstituteTelephonyConfig cfg : configRepo.findByProviderType(ProviderType.AIRTEL)) {
            if (imp.getAccountId().equals(
                    TelephonyJson.read(cfg.getProviderConfig()).get("accountId"))) {
                return cfg.getInstituteId();
            }
        }
        return null;
    }

    /**
     * The counsellor behind the record's extension (else its Airtel user id), looked up in the
     * institute the record was attributed to only. Two rows for the same extension in that
     * institute is ambiguous: neither is picked, and the record is skipped with a reason.
     */
    String resolveCounsellor(AirtelCallImport imp) {
        String instituteId = imp.getInstituteId();
        if (instituteId == null || instituteId.isBlank()) return null;
        if (imp.getSourceExtension() != null && !imp.getSourceExtension().isBlank()) {
            String c = single(endpointRepo.findByInstituteIdAndProviderTypeAndExtensionAndEnabledTrue(
                    instituteId, ProviderType.AIRTEL, imp.getSourceExtension()), "extension " + imp.getSourceExtension());
            if (c != null) return c;
        }
        if (imp.getSourceUserId() != null && !imp.getSourceUserId().isBlank()) {
            return single(endpointRepo.findByInstituteIdAndProviderTypeAndProviderUserIdAndEnabledTrue(
                    instituteId, ProviderType.AIRTEL, imp.getSourceUserId()), "Airtel user " + imp.getSourceUserId());
        }
        return null;
    }

    private static String single(List<TelephonyCounsellorEndpoint> rows, String what) {
        if (rows == null || rows.isEmpty()) return null;
        java.util.Set<String> users = new java.util.HashSet<>();
        for (TelephonyCounsellorEndpoint r : rows) users.add(r.getCounsellorUserId());
        if (users.size() > 1) {
            log.warn("airtel-import: {} is mapped to {} counsellors in one institute; not attributing", what, users.size());
            return null;
        }
        return users.iterator().next();
    }

    private void promoteCdr(AirtelCallImport imp, String instituteId, String counsellor) {
        boolean outbound = "OUTBOUND".equals(imp.getDirection());
        Instant anchor = anchorInstant(imp);

        TelephonyCallLog row = null;
        // Enrich our own click2dial row (placed with no provider id) — pick the one
        // CLOSEST to the call's start within a bounded window, so a counsellor
        // calling the same lead twice doesn't enrich the wrong attempt.
        if (outbound && imp.getCounterpartyMsisdn10() != null) {
            row = callLogRepo.findAirtelUnmatchedOutbound(
                    counsellor, imp.getCounterpartyMsisdn10(),
                    ts(anchor.minusSeconds(MATCH_LOOKBACK_SECONDS)),
                    ts(anchor.plusSeconds(OUTBOUND_FORWARD_SLACK_SECONDS)),
                    ts(anchor)).orElse(null);
        }
        if (row == null && imp.getCallId() != null) {
            // Idempotency: a prior pass (or a concurrent poll) may already have
            // created — or enriched a click2dial row into — the call log for this
            // call id. Reuse it instead of inserting a duplicate, which the unique
            // index uk_tcl_provider_call rejects (the call is already logged).
            row = callLogRepo.findByProviderTypeAndProviderCallId(
                    ProviderType.AIRTEL, imp.getCallId()).orElse(null);
        }
        if (row != null) {
            row.setProviderCallId(imp.getCallId());
            applyCdrFields(row, imp);
            // If the reused/enriched row is still UNKNOWN-lead (created before the
            // lead resolver could match it), try to attribute it now — makes a
            // reset+reprocess of UNKNOWN rows self-healing.
            resolveLeadIfUnknown(row, instituteId, imp);
            callLogRepo.save(row);
        } else {
            row = createCallLog(imp, instituteId, counsellor, outbound);
            callLogRepo.save(row);
        }
        markPromoted(imp, row.getId());
    }

    /** Re-attribute a row whose lead is still UNKNOWN, via the counterparty number. */
    private void resolveLeadIfUnknown(TelephonyCallLog row, String instituteId, AirtelCallImport imp) {
        if (row.getUserId() != null && !"UNKNOWN".equals(row.getUserId())) return; // already attributed
        if (imp.getCounterpartyMsisdn10() == null) return;
        leadDirectoryResolver.findByPhoneLast10(instituteId, imp.getCounterpartyMsisdn10())
                .ifPresent(lead -> {
                    if (lead.userId() != null && !lead.userId().isBlank()) row.setUserId(lead.userId());
                    if (lead.responseId() != null) row.setResponseId(lead.responseId());
                });
    }

    private void promoteRecording(AirtelCallImport imp) {
        TelephonyCallLog row = null;
        // PRIMARY match — by call id. Airtel names Cdr/<uuid>.json and Rec/<uuid>.mp3
        // with the SAME uuid = the CDR callId, which the CDR import stamps onto the
        // call row's providerCallId. So once the CDR is promoted, the recording finds
        // its row by id alone — no counsellor/number/time guesswork. This is what lets
        // INBOUND recordings attach (their CSV "called number" is the DID, not an ext).
        if (imp.getRecordingObjectId() != null) {
            row = callLogRepo.findByProviderTypeAndProviderCallId(
                    ProviderType.AIRTEL, imp.getRecordingObjectId()).orElse(null);
        }
        // FALLBACK — counsellor + counterparty + time, for a recording that lands
        // before its CDR AND whose counsellor is resolvable (outbound, where the CSV
        // "calling number" is the counsellor extension). Inbound can't resolve a
        // counsellor here, so it relies on the call-id match after the CDR promotes.
        if (row == null && imp.getCounterpartyMsisdn10() != null) {
            String counsellor = resolveCounsellor(imp);
            if (counsellor != null) {
                Instant anchor = anchorInstant(imp);
                row = callLogRepo.findAirtelCallForRecording(
                        counsellor, imp.getCounterpartyMsisdn10(),
                        ts(anchor.minusSeconds(RECORDING_MATCH_WINDOW_SECONDS)),
                        ts(anchor.plusSeconds(RECORDING_MATCH_WINDOW_SECONDS)),
                        ts(anchor)).orElse(null);
            }
        }
        if (row == null) {
            // The matching CDR may not have been promoted yet — retry next cycle,
            // unless this row has been waiting too long.
            if (ageSeconds(imp.getReceivedAt()) > RECORDING_RETRY_MAX_AGE_SECONDS) {
                skip(imp, "no matching call within the retry window");
            }
            return; // leave RECEIVED → retried
        }
        row.setRecordingStorageKey(imp.getRecordingStorageKey());
        row.setRecordingLogged(true);
        if (row.getDurationSeconds() == null && imp.getRecordingLengthSeconds() != null) {
            row.setDurationSeconds(imp.getRecordingLengthSeconds());
        }
        callLogRepo.save(row);
        writeTimeline(row, "Call recording available");
        markPromoted(imp, row.getId());

        // Recording attached — enqueue transcription + analysis if enabled. Best-effort.
        callIntelligenceEnqueueService.enqueueIfEligible(row);
    }

    private TelephonyCallLog createCallLog(AirtelCallImport imp, String instituteId,
                                           String counsellor, boolean outbound) {
        String counterparty = imp.getCounterpartyNumber();
        // Resolve the lead from the counterparty number (inbound caller / outbound
        // callee) so all inbound calls AND softphone-originated outbound calls — the
        // ones with no CRM click2dial row to enrich — land on the right lead +
        // timeline instead of "UNKNOWN". No/ambiguous match keeps the sentinel.
        Optional<LeadDirectoryResolver.LeadRef> lead = imp.getCounterpartyMsisdn10() == null
                ? Optional.empty()
                : leadDirectoryResolver.findByPhoneLast10(instituteId, imp.getCounterpartyMsisdn10());
        String responseId = lead.map(LeadDirectoryResolver.LeadRef::responseId).orElse(null);
        String userId = lead.map(LeadDirectoryResolver.LeadRef::userId)
                .filter(s -> s != null && !s.isBlank())
                .orElse("UNKNOWN");
        TelephonyCallLog row = TelephonyCallLog.builder()
                .id(java.util.UUID.randomUUID().toString())
                .instituteId(instituteId)
                .providerType(ProviderType.AIRTEL)
                .providerCallId(imp.getCallId())
                .responseId(responseId)
                .userId(userId)
                .counsellorUserId(counsellor)
                .direction(outbound ? CallDirection.OUTBOUND.name() : CallDirection.INBOUND.name())
                .fromNumber(outbound ? imp.getSourceExtension() : counterparty)
                .toNumber(outbound ? counterparty : imp.getCallerIdNumber())
                .callerId(imp.getCallerIdNumber())
                .status(CallStatus.QUEUED.name())
                .recordingFetchAttempts(0)
                .recordingLogged(false)
                .build();
        row.markNew();
        applyCdrFields(row, imp);
        return row;
    }

    private void applyCdrFields(TelephonyCallLog row, AirtelCallImport imp) {
        row.setStatus(statusFromDisposition(imp.getDisposition(), imp.getDurationSeconds()));
        if (imp.getDurationSeconds() != null) row.setDurationSeconds(imp.getDurationSeconds());
        if (imp.getDisposition() != null) row.setTerminationReason(trunc48(imp.getDisposition()));
        if (imp.getDateStart() != null) row.setStartTime(Timestamp.from(imp.getDateStart().toInstant()));
        if (imp.getDateEnd() != null) row.setEndTime(Timestamp.from(imp.getDateEnd().toInstant()));
    }

    private void writeTimeline(TelephonyCallLog row, String title) {
        try {
            Map<String, Object> meta = new HashMap<>();
            meta.put("provider_call_id", row.getProviderCallId());
            meta.put("recording_storage_key", row.getRecordingStorageKey());
            meta.put("status", row.getStatus());
            meta.put("duration_seconds", row.getDurationSeconds());
            meta.put("call_log_id", row.getId());
            meta.put("direction", row.getDirection());
            String actorName = userMobileResolver.findDisplayName(row.getCounsellorUserId()).orElse("Vacademy");
            timelineEventService.logJourneyEvent(
                    "LEAD",
                    row.getResponseId() != null ? row.getResponseId() : row.getUserId(),
                    LeadJourneyActionType.REACHOUT,
                    "SYSTEM", null, actorName,
                    title,
                    "Airtel call " + row.getStatus().toLowerCase(),
                    // Link to the lead so an imported call counts as a response for TAT.
                    meta, row.getUserId());
        } catch (Exception ignored) {
            // never block promotion on a logging side-effect
        }
    }

    private void markPromoted(AirtelCallImport imp, String callLogId) {
        imp.setProcessingStatus(AirtelCallImport.STATUS_PROMOTED);
        imp.setCallLogId(callLogId);
        importRepo.save(imp);
    }

    private void skip(AirtelCallImport imp, String reason) {
        imp.setProcessingStatus(AirtelCallImport.STATUS_SKIPPED);
        imp.setProcessDetail(trunc(reason));
        importRepo.save(imp);
        log.info("Airtel import {} skipped: {}", imp.getId(), reason);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static String statusFromDisposition(String disposition, Integer duration) {
        String d = disposition == null ? "" : disposition.toLowerCase();
        if (d.contains("no answer") || d.contains("noanswer") || d.contains("unanswered") || d.contains("missed")) {
            return CallStatus.NO_ANSWER.name();
        }
        if (d.contains("answer")) return CallStatus.COMPLETED.name();
        if (d.contains("busy")) return CallStatus.BUSY.name();
        if (d.contains("fail")) return CallStatus.FAILED.name();
        if (d.contains("cancel") || d.contains("abandon") || d.contains("reject")) return CallStatus.CANCELLED.name();
        return (duration != null && duration > 0) ? CallStatus.COMPLETED.name() : CallStatus.NO_ANSWER.name();
    }

    /** The call's start instant — Airtel CDR/recording time, else when we received it. */
    private static Instant anchorInstant(AirtelCallImport imp) {
        if (imp.getDateStart() != null) return imp.getDateStart().toInstant();
        if (imp.getReceivedAt() != null) return imp.getReceivedAt().toInstant();
        return Instant.now();
    }

    private static Timestamp ts(Instant instant) {
        return Timestamp.from(instant);
    }

    private static long ageSeconds(Timestamp receivedAt) {
        return receivedAt == null ? 0 : (Instant.now().getEpochSecond() - receivedAt.toInstant().getEpochSecond());
    }

    private static String trunc(String s) {
        return s == null ? null : s.substring(0, Math.min(s.length(), 800));
    }

    private static String trunc48(String s) {
        return s == null ? null : s.substring(0, Math.min(s.length(), 48));
    }
}
