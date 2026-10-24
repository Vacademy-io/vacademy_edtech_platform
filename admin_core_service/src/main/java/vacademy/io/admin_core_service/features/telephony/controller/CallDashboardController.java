package vacademy.io.admin_core_service.features.telephony.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.telephony.core.CallDetailService;
import vacademy.io.admin_core_service.features.telephony.core.CallNumberVisibilityService;
import vacademy.io.admin_core_service.features.telephony.core.CallDispositionOptionsService;
import vacademy.io.admin_core_service.features.telephony.core.CallDispositionService;
import vacademy.io.admin_core_service.features.telephony.core.CallDispositionService.AppliedDisposition;
import vacademy.io.admin_core_service.features.telephony.core.CallExportAiEnricher;
import vacademy.io.admin_core_service.features.telephony.core.CallExportService;
import vacademy.io.admin_core_service.features.telephony.core.CallSearchService;
import vacademy.io.admin_core_service.features.telephony.core.dto.CallActionDTO;
import vacademy.io.admin_core_service.features.telephony.core.dto.CallDetailDTO;
import vacademy.io.admin_core_service.features.telephony.core.dto.CallDispositionCatalogDTO;
import vacademy.io.admin_core_service.features.telephony.core.dto.CallDispositionRequestDTO;
import vacademy.io.admin_core_service.features.telephony.core.dto.CallMetricsDTO;
import vacademy.io.admin_core_service.features.telephony.core.dto.CallRowDTO;
import vacademy.io.admin_core_service.features.telephony.core.dto.CallSearchFilterDTO;
import vacademy.io.admin_core_service.features.telephony.core.dto.BulkCallActionRequestDTO;
import vacademy.io.admin_core_service.features.telephony.core.dto.DispositionCountDTO;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.TelephonyCallLog;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.TelephonyCallLogRepository;
import vacademy.io.admin_core_service.features.audience.service.LeadStatusService;
import vacademy.io.admin_core_service.features.audience.service.UserLeadProfileService;
import vacademy.io.admin_core_service.features.call_intelligence.core.CallIntelligenceEnqueueService;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.io.OutputStreamWriter;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * The team calling dashboard surface — a leader (or a single counsellor, by
 * hierarchy) sees calls across their downstream with full filtering.
 * RBAC scope is derived from the caller; provider-agnostic (AI + human, in + out).
 *
 * <p>Aggregate roll-ups (daily series, per-counsellor leaderboard, heatmap,
 * follow-up aging) already live under {@code /v1/reports/calls-*} — this
 * controller is the row-level list those dashboards drill into.
 */
@RestController
@RequestMapping("/admin-core-service/v1/telephony/calls")
@RequiredArgsConstructor
public class CallDashboardController {

    /** Sync export cap — large enough for routine pulls, async-job path is the v2 follow-up. */
    private static final int EXPORT_CAP = 25_000;

    private final CallSearchService callSearchService;
    private final CallNumberVisibilityService callNumberVisibilityService;
    private final CallDispositionService callDispositionService;
    private final CallDispositionOptionsService callDispositionOptionsService;
    private final CallExportService callExportService;
    private final CallDetailService callDetailService;
    private final CallExportAiEnricher callExportAiEnricher;
    private final InstituteAccessValidator instituteAccessValidator;
    private final vacademy.io.admin_core_service.features.engagement.repository
            .EngagementActionRepository actionRepository;
    private final TelephonyCallLogRepository callLogRepository;
    private final LeadStatusService leadStatusService;
    private final UserLeadProfileService userLeadProfileService;
    private final CallIntelligenceEnqueueService callIntelligenceEnqueueService;

    /** Bulk actions are loops over the single-row services; this caps one request. */
    private static final int BULK_CAP = 500;

    @PostMapping("/search")
    public ResponseEntity<Page<CallRowDTO>> search(
            @RequestBody CallSearchFilterDTO filter,
            @RequestAttribute("user") CustomUserDetails user) {
        if (filter == null || filter.getInstituteId() == null || filter.getInstituteId().isBlank()) {
            throw new VacademyException("instituteId is required");
        }
        instituteAccessValidator.validateUserAccess(user, filter.getInstituteId());
        boolean unmask = callNumberVisibilityService.canViewFullNumbers(user, filter.getInstituteId());
        return ResponseEntity.ok(callSearchService.search(filter, user.getUserId(), unmask));
    }

    /**
     * Deep detail for a single call — the "more details" popover on the Call Log,
     * chiefly to explain a FAILED / BUSY / NO_ANSWER outcome. Surfaces the
     * provider's own hangup/cause/error fields (mined from the stored webhook body),
     * plus price and full timing that the paginated list omits.
     */
    /**
      * What this call promised, and whether it actually went out.
      *
      * <p>Until now a send was visible only when it FAILED (the engagement inbox surfaces
      * kind=SEND only in that state, by design - a healthy auto-send is the dispatch job's
      * business, not a task). So an OPEN or SENT one appeared nowhere, and nothing tied
      * either back to the call that produced it. That is exactly the question people ask
      * after a call: "it said it would WhatsApp the link - did it?"
      *
      * <p>Guarded like /search rather than like /detail: this carries no caller phone
      * numbers or verbatim speech, so it needs institute access, not VIEW_CALL_NUMBERS.
      */
     @GetMapping("/{callLogId}/actions")
     public ResponseEntity<List<CallActionDTO>> actions(
             @PathVariable String callLogId,
             @RequestParam String instituteId,
             @RequestAttribute("user") CustomUserDetails user) {
         instituteAccessValidator.validateUserAccess(user, instituteId);
         return ResponseEntity.ok(
                 actionRepository.findByCallRefPrefix(instituteId, callLogId + ":%")
                         .stream().map(CallActionDTO::from).toList());
     }

     /**
      * The whole institute's AI-call send backlog, with counts.
      *
      * <p>The per-call panel answers "did THIS call's promise go out?". This answers the
      * question someone actually has when a parent says they never got the link: "what is
      * stuck, anywhere?". Without it the only way to find a failed send was to guess which
      * call it belonged to and open that one.
      *
      * <p>Default statuses are the ones that need a human: queued (the dispatch job has not
      * reached it), mid-dispatch, failed, and expired-unsent. SENT is excluded unless asked
      * for, because a delivered message is not a task.
      */
     @GetMapping("/actions/queue")
     public ResponseEntity<Map<String, Object>> actionQueue(
             @RequestParam String instituteId,
             @RequestParam(defaultValue = "OPEN,DISPATCHING,FAILED,EXPIRED") String statuses,
             @RequestParam(defaultValue = "50") int limit,
             @RequestAttribute("user") CustomUserDetails user) {
         instituteAccessValidator.validateUserAccess(user, instituteId);
         List<String> wanted = java.util.Arrays.stream(statuses.split(","))
                 .map(String::trim).filter(x -> !x.isEmpty()).toList();
         List<CallActionDTO> items = actionRepository
                 .findAiCallActions(instituteId, wanted, Math.min(limit, 200))
                 .stream().map(CallActionDTO::from).toList();
         Map<String, Long> counts = new java.util.LinkedHashMap<>();
         for (Object[] row : actionRepository.countAiCallActionsByStatus(instituteId)) {
             counts.put(String.valueOf(row[0]), ((Number) row[1]).longValue());
         }
         return ResponseEntity.ok(Map.of("counts", counts, "items", items));
     }

     @GetMapping("/{callLogId}/detail")
    public ResponseEntity<CallDetailDTO> detail(
            @PathVariable String callLogId,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        if (instituteId == null || instituteId.isBlank()) {
            throw new VacademyException("instituteId is required");
        }
        instituteAccessValidator.validateUserAccess(user, instituteId);
        boolean unmask = callNumberVisibilityService.canViewFullNumbers(user, instituteId);
        // Technical diagnostics ride the ADMIN role, NOT VIEW_CALL_NUMBERS. That
        // authority means "may see phone numbers"; whether someone may debug a call
        // is a different question, and coupling them left institute admins — the
        // people who actually triage these calls — unable to see why their own call
        // failed. Non-admins still get the verdict and fault names, just not the
        // numbers behind them (which quote verbatim caller speech).
        boolean canSeeDiagnostics = instituteAccessValidator.isInstituteAdmin(user);
        return ResponseEntity.ok(
                callDetailService.detail(callLogId, instituteId, unmask, canSeeDiagnostics));
    }

    /**
     * Call-outcome catalog — the outcomes a counsellor may APPLY. This is the picker's
     * list, and the only vocabulary {@code POST /{id}/disposition} accepts.
     * For the dashboard's disposition FILTER use {@link #dispositionOptions} instead:
     * an AI call's outcome comes from the agent, not this catalog.
     */
    @GetMapping("/dispositions")
    public ResponseEntity<List<CallDispositionCatalogDTO>> dispositions(
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        if (instituteId == null || instituteId.isBlank()) {
            throw new VacademyException("instituteId is required");
        }
        instituteAccessValidator.validateUserAccess(user, instituteId);
        List<CallDispositionCatalogDTO> out = callDispositionService.listForInstitute(instituteId).stream()
                .map(CallDispositionCatalogDTO::from).toList();
        return ResponseEntity.ok(out);
    }

    /**
     * Filter vocabulary for the Call Log's Disposition dropdown: the settable catalog
     * PLUS the AI outcomes this institute configured (Settings → AI Calling, and its
     * AI agents' declared dispositions) and the ones its calls have actually returned.
     * Each entry carries {@code settable} — false for the AI-sourced ones, which are
     * filterable but cannot be applied by hand.
     */
    @GetMapping("/dispositions/options")
    public ResponseEntity<List<CallDispositionCatalogDTO>> dispositionOptions(
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        if (instituteId == null || instituteId.isBlank()) {
            throw new VacademyException("instituteId is required");
        }
        instituteAccessValidator.validateUserAccess(user, instituteId);
        return ResponseEntity.ok(callDispositionOptionsService.filterOptions(instituteId));
    }

    /** Quick after-call disposition; syncs the lead's pipeline status when the outcome maps to one. */
    @PostMapping("/{callLogId}/disposition")
    public ResponseEntity<Map<String, Object>> disposition(
            @PathVariable String callLogId,
            @RequestParam("instituteId") String instituteId,
            @RequestBody CallDispositionRequestDTO req,
            @RequestAttribute("user") CustomUserDetails user) {
        if (req == null || req.getDispositionKey() == null || req.getDispositionKey().isBlank()) {
            throw new VacademyException("dispositionKey is required");
        }
        instituteAccessValidator.validateUserAccess(user, instituteId);
        AppliedDisposition applied = callDispositionService.applyDisposition(
                callLogId, instituteId, req.getDispositionKey().trim(), req.getNotes(),
                req.getCallbackAtEpochMillis(), user.getUserId());

        Map<String, Object> body = new HashMap<>();
        body.put("call_log_id", applied.call().getId());
        body.put("disposition_key", applied.outcome().getDispositionKey());
        body.put("disposition_label", applied.outcome().getLabel());
        body.put("disposition_color", applied.outcome().getColor());
        body.put("category", applied.outcome().getCategory());
        body.put("dispositioned_at", epoch(applied.call().getDispositionedAt()));
        body.put("callback_at", epoch(applied.call().getCallbackAt()));
        body.put("lead_status_synced", applied.leadStatusSynced());
        return ResponseEntity.ok(body);
    }

    private static Long epoch(Timestamp t) {
        return t == null ? null : t.getTime();
    }

    /**
     * Disposition strip: every effective outcome in the filter window with a count.
     * Same body as /search; the disposition filter and the chips are ignored so the
     * strip lists the window's outcomes, not the current selection.
     */
    @PostMapping("/dispositions/counts")
    public ResponseEntity<List<DispositionCountDTO>> dispositionCounts(
            @RequestBody CallSearchFilterDTO filter,
            @RequestAttribute("user") CustomUserDetails user) {
        if (filter == null || filter.getInstituteId() == null || filter.getInstituteId().isBlank()) {
            throw new VacademyException("instituteId is required");
        }
        instituteAccessValidator.validateUserAccess(user, filter.getInstituteId());
        return ResponseEntity.ok(callSearchService.dispositionCounts(filter, user.getUserId()));
    }

    // ── Bulk actions (Call Log row checkboxes, 2026-09-11) ────────────────────
    //
    // Each is a loop over the existing single-row path, so every rule that path
    // enforces (catalog validation, lead-status sync, journey events, audit) holds
    // per row. Partial success is reported, never hidden: the response carries the
    // ids that failed and why, and one bad row never rolls back the others.

    @PostMapping("/bulk/disposition")
    public ResponseEntity<Map<String, Object>> bulkDisposition(
            @RequestBody BulkCallActionRequestDTO req,
            @RequestAttribute("user") CustomUserDetails user) {
        List<TelephonyCallLog> calls = bulkTargets(req, user);
        if (req.getDispositionKey() == null || req.getDispositionKey().isBlank()) {
            throw new VacademyException("dispositionKey is required");
        }
        return ResponseEntity.ok(runBulk(calls, c -> callDispositionService.applyDisposition(
                c.getId(), req.getInstituteId(), req.getDispositionKey().trim(), req.getNotes(),
                null, user.getUserId())));
    }

    @PostMapping("/bulk/lead-status")
    public ResponseEntity<Map<String, Object>> bulkLeadStatus(
            @RequestBody BulkCallActionRequestDTO req,
            @RequestAttribute("user") CustomUserDetails user) {
        List<TelephonyCallLog> calls = bulkTargets(req, user);
        if (req.getStatusId() == null || req.getStatusId().isBlank()) {
            throw new VacademyException("statusId is required");
        }
        // One lead may own several selected calls; change its status once.
        java.util.Set<String> done = new java.util.HashSet<>();
        return ResponseEntity.ok(runBulk(calls, c -> {
            if (c.getResponseId() == null || c.getResponseId().isBlank()) {
                throw new VacademyException("call has no lead");
            }
            if (done.add(c.getResponseId())) {
                leadStatusService.changeLeadStatus(c.getResponseId(), req.getStatusId().trim(),
                        user.getUserId(), "MANUAL");
            }
        }));
    }

    @PostMapping("/bulk/assign-counsellor")
    public ResponseEntity<Map<String, Object>> bulkAssignCounsellor(
            @RequestBody BulkCallActionRequestDTO req,
            @RequestAttribute("user") CustomUserDetails user) {
        List<TelephonyCallLog> calls = bulkTargets(req, user);
        java.util.Set<String> done = new java.util.HashSet<>();
        boolean unassign = req.getCounselorId() == null || req.getCounselorId().isBlank();
        return ResponseEntity.ok(runBulk(calls, c -> {
            if (c.getUserId() == null || c.getUserId().isBlank() || "UNKNOWN".equals(c.getUserId())) {
                throw new VacademyException("call has no lead");
            }
            if (done.add(c.getUserId())) {
                userLeadProfileService.assignCounselor(c.getUserId(), req.getInstituteId(),
                        unassign ? null : req.getCounselorId().trim(),
                        unassign ? null : req.getCounselorName());
            }
        }));
    }

    /** Queue (re-)analysis for every selected call that has a recording. */
    @PostMapping("/bulk/analyze")
    public ResponseEntity<Map<String, Object>> bulkAnalyze(
            @RequestBody BulkCallActionRequestDTO req,
            @RequestAttribute("user") CustomUserDetails user) {
        List<TelephonyCallLog> calls = bulkTargets(req, user);
        return ResponseEntity.ok(runBulk(calls, c -> {
            String r = callIntelligenceEnqueueService.triggerManual(c.getId());
            if (!"QUEUED".equals(r)) throw new VacademyException(r);
        }));
    }

    /** Resolve + authorise the selected rows: institute access, same-institute rows only, capped. */
    private List<TelephonyCallLog> bulkTargets(BulkCallActionRequestDTO req, CustomUserDetails user) {
        if (req == null || req.getInstituteId() == null || req.getInstituteId().isBlank()) {
            throw new VacademyException("instituteId is required");
        }
        if (req.getCallLogIds() == null || req.getCallLogIds().isEmpty()) {
            throw new VacademyException("callLogIds is required");
        }
        if (req.getCallLogIds().size() > BULK_CAP) {
            throw new VacademyException("at most " + BULK_CAP + " calls per request");
        }
        instituteAccessValidator.validateUserAccess(user, req.getInstituteId());
        List<TelephonyCallLog> rows = callLogRepository.findAllById(req.getCallLogIds()).stream()
                .filter(c -> req.getInstituteId().equals(c.getInstituteId()))
                .toList();
        if (rows.isEmpty()) throw new VacademyException("no matching calls");
        return rows;
    }

    private interface RowAction {
        void apply(TelephonyCallLog call) throws Exception;
    }

    private static Map<String, Object> runBulk(List<TelephonyCallLog> calls, RowAction action) {
        List<String> updated = new java.util.ArrayList<>();
        List<Map<String, String>> failed = new java.util.ArrayList<>();
        for (TelephonyCallLog c : calls) {
            try {
                action.apply(c);
                updated.add(c.getId());
            } catch (Exception e) {
                failed.add(Map.of("call_log_id", c.getId(),
                        "error", e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage()));
            }
        }
        Map<String, Object> body = new HashMap<>();
        body.put("updated", updated.size());
        body.put("updated_ids", updated);
        body.put("failed", failed);
        return body;
    }

    /** KPI strip: headline counts (same filters as the list, minus chips) + chip badges. */
    @PostMapping("/metrics")
    public ResponseEntity<CallMetricsDTO> metrics(
            @RequestBody CallSearchFilterDTO filter,
            @RequestAttribute("user") CustomUserDetails user) {
        if (filter == null || filter.getInstituteId() == null || filter.getInstituteId().isBlank()) {
            throw new VacademyException("instituteId is required");
        }
        instituteAccessValidator.validateUserAccess(user, filter.getInstituteId());
        return ResponseEntity.ok(callSearchService.metrics(filter, user.getUserId()));
    }

    /** Export the filtered call list as CSV or XLSX (synchronous, capped at {@value #EXPORT_CAP} rows). */
    @PostMapping("/export")
    public void export(
            @RequestBody CallSearchFilterDTO filter,
            @RequestParam(value = "format", defaultValue = "csv") String format,
            @RequestAttribute("user") CustomUserDetails user,
            HttpServletResponse response) {
        if (filter == null || filter.getInstituteId() == null || filter.getInstituteId().isBlank()) {
            throw new VacademyException("instituteId is required");
        }
        instituteAccessValidator.validateUserAccess(user, filter.getInstituteId());
        boolean unmask = callNumberVisibilityService.canViewFullNumbers(user, filter.getInstituteId());
        List<CallRowDTO> rows = callSearchService.exportRows(filter, user.getUserId(), unmask, EXPORT_CAP);
        Map<String, CallExportAiEnricher.AiRow> ai =
                callExportAiEnricher.forCalls(rows.stream().map(CallRowDTO::getId).toList());
        boolean xlsx = "xlsx".equalsIgnoreCase(format) || "excel".equalsIgnoreCase(format);
        try {
            if (xlsx) {
                response.setContentType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
                response.setHeader("Content-Disposition", "attachment; filename=\"calls.xlsx\"");
                callExportService.writeXlsx(rows, ai, response.getOutputStream());
            } else {
                response.setContentType("text/csv; charset=UTF-8");
                response.setHeader("Content-Disposition", "attachment; filename=\"calls.csv\"");
                OutputStreamWriter writer = new OutputStreamWriter(response.getOutputStream(), StandardCharsets.UTF_8);
                callExportService.writeCsv(rows, ai, writer);
            }
        } catch (java.io.IOException e) {
            throw new UncheckedIOException("Failed to write call export", e);
        }
    }

}
