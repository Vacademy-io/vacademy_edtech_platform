package vacademy.io.admin_core_service.features.telephony.core;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.audience.entity.LeadStatus;
import vacademy.io.admin_core_service.features.audience.repository.LeadStatusRepository;
import vacademy.io.admin_core_service.features.audience.service.LeadStatusService;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.CallDispositionCatalog;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.TelephonyCallLog;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.CallDispositionCatalogRepository;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.TelephonyCallLogRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.sql.Timestamp;
import java.util.List;
import java.util.UUID;
import vacademy.io.admin_core_service.features.live_activity.core.LiveActivityCounsellorRecorder;

/**
 * The "quick disposition" a counsellor sets after a call. Two responsibilities:
 *   1. the per-institute call-outcome catalog (lazy-seeded with sensible defaults,
 *      auto-mapped to the institute's lead statuses by name where one exists);
 *   2. applying a disposition to a call row and — when the chosen outcome maps to
 *      a lead status AND the call targeted a lead — routing the lead through the
 *      ONE authoritative status path ({@link LeadStatusService#changeLeadStatus})
 *      so it mirrors to audience_response + user_lead_profile + history + trigger.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CallDispositionService {

    private final CallDispositionCatalogRepository catalogRepo;
    private final LiveActivityCounsellorRecorder liveActivityCounsellorRecorder;
    private final TelephonyCallLogRepository callLogRepo;
    private final LeadStatusRepository leadStatusRepository;
    private final LeadStatusService leadStatusService;

    private static final String SOURCE = "MANUAL_DISPOSITION";

    /**
     * Default call outcomes seeded on first use:
     * {key, label, color, category, lead-status-match-candidates(|-separated, normalized)}.
     * The last field lists normalized lead_status keys/labels this outcome should
     * map to if the institute has defined one — else the disposition is recorded
     * without ever touching lead status.
     */
    private static final String[][] DEFAULTS = {
            {"INTERESTED",     "Interested",          "#16a34a", "CONNECTED",     "INTERESTED"},
            {"NOT_INTERESTED", "Not Interested",      "#ef4444", "CONNECTED",     "NOTINTERESTED|LOST"},
            {"CALLBACK",       "Callback",            "#f59e0b", "CALLBACK",      "CALLBACK|CALLBACKREQUESTED"},
            {"RNR",            "Ringing No Response",  "#6b7280", "NOT_CONNECTED", ""},
            {"BUSY",           "Busy",                "#6b7280", "NOT_CONNECTED", ""},
            {"SWITCHED_OFF",   "Switched Off",        "#6b7280", "NOT_CONNECTED", ""},
            {"NOT_REACHABLE",  "Not Reachable",       "#6b7280", "NOT_CONNECTED", ""},
            {"WRONG_NUMBER",   "Wrong Number",        "#9ca3af", "OTHER",         ""},
            {"DND",            "Do Not Disturb",      "#9ca3af", "OTHER",         ""},
    };

    /** Active call-outcomes for an institute, seeding the starter set on first access. */
    @Transactional
    public List<CallDispositionCatalog> listForInstitute(String instituteId) {
        if (catalogRepo.countByInstituteId(instituteId) == 0) {
            seedDefaults(instituteId);
        }
        return catalogRepo.findByInstituteIdAndIsActiveTrueOrderByDisplayOrderAsc(instituteId);
    }

    /**
     * Active call-outcomes WITHOUT the lazy seed — for readers that merely display the
     * vocabulary (the Call Log's disposition filter), not ones that let a counsellor
     * apply an outcome.
     *
     * <p>Seeding is guarded by a count, so two concurrent first-access callers can both
     * see zero and both insert, and the second loses to
     * {@code uk_cdc_institute_key}. The Call Log loads the picker catalog and the
     * filter vocabulary in the same tick, which would make exactly that pair of
     * concurrent callers — so only the picker path seeds. On a never-used institute
     * the filter is briefly AI-outcomes-only, which is precisely the vocabulary its
     * (zero) calls could carry anyway.
     */
    @Transactional(readOnly = true)
    public List<CallDispositionCatalog> listForInstituteWithoutSeeding(String instituteId) {
        return catalogRepo.findByInstituteIdAndIsActiveTrueOrderByDisplayOrderAsc(instituteId);
    }

    private void seedDefaults(String instituteId) {
        List<LeadStatus> statuses = leadStatusRepository
                .findByInstituteIdAndIsActiveTrueOrderByDisplayOrderAsc(instituteId);
        int order = 1;
        for (String[] d : DEFAULTS) {
            String mappedStatusId = resolveLeadStatusId(statuses, d[4]);
            catalogRepo.save(CallDispositionCatalog.builder()
                    .id(UUID.randomUUID().toString())
                    .instituteId(instituteId)
                    .dispositionKey(d[0])
                    .label(d[1])
                    .color(d[2])
                    .category(d[3])
                    .mapsToLeadStatusId(mappedStatusId)
                    .displayOrder(order++)
                    .isActive(true)
                    .build());
        }
        log.info("[CallDisposition] Seeded {} default dispositions for institute {}", DEFAULTS.length, instituteId);
    }

    /** First institute lead-status whose normalized key/label matches one of the pipe-separated candidates. */
    private String resolveLeadStatusId(List<LeadStatus> statuses, String candidatesCsv) {
        if (candidatesCsv == null || candidatesCsv.isBlank()) return null;
        for (String cand : candidatesCsv.split("\\|")) {
            String norm = normalize(cand);
            if (norm.isEmpty()) continue;
            for (LeadStatus s : statuses) {
                if (norm.equals(normalize(s.getStatusKey())) || norm.equals(normalize(s.getLabel()))) {
                    return s.getId();
                }
            }
        }
        return null;
    }

    /**
     * Apply a disposition to a call and (if mapped + the call targeted a lead)
     * advance the lead's pipeline status. The lead-status write is best-effort —
     * a mapping/sync failure must never lose the disposition the counsellor just set.
     */
    /** Outcome of applying a disposition — carries display fields + whether lead status was synced. */
    public record AppliedDisposition(TelephonyCallLog call, CallDispositionCatalog outcome,
                                     boolean leadStatusSynced) {
    }

    @Transactional
    public AppliedDisposition applyDisposition(String callLogId, String instituteId, String dispositionKey,
                                               String notes, Long callbackAtEpochMillis, String actorUserId) {
        TelephonyCallLog call = callLogRepo.findById(callLogId)
                .orElseThrow(() -> new VacademyException("Call not found: " + callLogId));
        if (instituteId == null || !instituteId.equals(call.getInstituteId())) {
            throw new VacademyException("Call does not belong to this institute");
        }
        if (catalogRepo.countByInstituteId(instituteId) == 0) {
            seedDefaults(instituteId);
        }
        CallDispositionCatalog outcome = catalogRepo
                .findByInstituteIdAndDispositionKey(instituteId, dispositionKey)
                .orElseThrow(() -> new VacademyException("Unknown disposition: " + dispositionKey));

        call.setDispositionKey(outcome.getDispositionKey());
        call.setDispositionNotes(notes);
        call.setDispositionedBy(actorUserId);
        call.setDispositionedAt(new Timestamp(System.currentTimeMillis()));
        call.setCallbackAt(callbackAtEpochMillis != null ? new Timestamp(callbackAtEpochMillis) : null);
        callLogRepo.save(call);

        // Sync lead status only when this outcome maps to one AND the call actually
        // targeted a lead (subject LEAD / legacy-null with a response_id) — calls to
        // students / live-session participants must never touch lead status.
        boolean synced = false;
        if (outcome.getMapsToLeadStatusId() != null && isLeadCall(call)) {
            try {
                leadStatusService.changeLeadStatus(
                        call.getResponseId(), outcome.getMapsToLeadStatusId(), actorUserId, SOURCE);
                synced = true;
            } catch (Exception e) {
                log.warn("[CallDisposition] lead-status sync failed for call {} (response {}): {}",
                        callLogId, call.getResponseId(), e.getMessage());
            }
        }
        // Live activity feed: "a counsellor just wrapped a call with outcome X". This is the
        // richest counsellor signal available -- one transactional write path carrying the
        // actor, the lead, the human-readable outcome and free-text notes.
        //
        // Note the bulk endpoint (POST /bulk/disposition) must route through this same
        // method, or bulk dispositions silently never reach the feed.
        liveActivityCounsellorRecorder.recordDisposition(
                instituteId, callLogId, call.getCounsellorUserId(), actorUserId,
                outcome.getDispositionKey(), outcome.getLabel(), notes, call.getToNumber());

        return new AppliedDisposition(call, outcome, synced);
    }

    private boolean isLeadCall(TelephonyCallLog call) {
        if (call.getResponseId() == null || call.getResponseId().isBlank()) return false;
        String subject = call.getSubjectType();
        return subject == null || subject.isBlank() || "LEAD".equalsIgnoreCase(subject);
    }

    /** Upper-case alphanumerics only, so "Call Back" / "CALL_BACK" / "Callback" all match. */
    private static String normalize(String s) {
        return s == null ? "" : s.replaceAll("[^A-Za-z0-9]", "").toUpperCase();
    }
}
