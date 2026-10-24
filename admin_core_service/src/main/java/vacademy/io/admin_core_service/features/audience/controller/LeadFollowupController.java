package vacademy.io.admin_core_service.features.audience.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.audience.dto.CloseLeadFollowupRequest;
import vacademy.io.admin_core_service.features.audience.dto.CompletedFollowUpsQuery;
import vacademy.io.admin_core_service.features.audience.dto.CreateLeadFollowupRequest;
import vacademy.io.admin_core_service.features.audience.dto.LeadFollowupDto;
import vacademy.io.admin_core_service.features.audience.dto.UpdateLeadFollowupRequest;
import vacademy.io.admin_core_service.features.audience.service.LeadFollowupService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;

@RestController
@RequestMapping("/admin-core-service/v1/lead-followup")
@RequiredArgsConstructor
public class LeadFollowupController {

    private final LeadFollowupService leadFollowupService;

    @PostMapping
    @Auditable(
            entityType = "LEAD_FOLLOWUP",
            action = "CREATE",
            entityIdExpr = "#result?.body?.id",
            descriptionExpr = "'scheduled a follow-up for lead ' "
                    + "+ @crmAuditNarrator.leadFor(#request?.audienceResponseId)")
    public ResponseEntity<LeadFollowupDto> create(@RequestBody CreateLeadFollowupRequest request,
                                                   @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(leadFollowupService.create(request, user));
    }

    @GetMapping("/{audienceResponseId}")
    public ResponseEntity<List<LeadFollowupDto>> listForLead(@PathVariable String audienceResponseId,
                                                             @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(leadFollowupService.listForLead(audienceResponseId, user));
    }

    /**
     * Legacy no-param shape returns the caller's own pending follow-ups.
     * With {@code instituteId}: hierarchy-scoped callers get the manager view
     * (own + counsellor-role reports'); pure admins get the institute, and
     * {@code counsellorUserId} narrows to one user (scope-validated).
     */
    @GetMapping("/my-pending")
    public ResponseEntity<List<LeadFollowupDto>> myPending(
            @RequestParam(value = "instituteId", required = false) String instituteId,
            @RequestParam(value = "counsellorUserId", required = false) String counsellorUserId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(leadFollowupService.myPending(user, instituteId, counsellorUserId));
    }

    /**
     * Completed follow-ups, newest first — what the Follow-ups page's
     * "Completed" tile lists. Same scoping as {@link #myPending}, but paged:
     * the closed set only grows.
     *
     * @param includeLeadDetail adds the lead's email, source, pipeline status,
     *        interest level, owner and custom-field answers to every row. Off by
     *        default and deliberately so: the table needs none of it, and the
     *        tile's count probe asks for a single row on every page load — both
     *        would pay for up to six extra queries they never read. The CSV
     *        export turns it on, because there a row has to stand on its own.
     */
    @GetMapping("/completed")
    public ResponseEntity<Page<LeadFollowupDto>> completed(
            @RequestParam(value = "instituteId", required = false) String instituteId,
            @RequestParam(value = "counsellorUserId", required = false) String counsellorUserId,
            @RequestParam(value = "search", required = false) String search,
            @RequestParam(value = "closedFrom", required = false) String closedFrom,
            @RequestParam(value = "closedTo", required = false) String closedTo,
            // Lead status keys, comma-separated - the sidebar route's status /
            // statusExclude, same as the open buckets send to the leads list.
            @RequestParam(value = "leadStatusId", required = false) String leadStatusId,
            @RequestParam(value = "leadStatusExcludeId", required = false) String leadStatusExcludeId,
            @RequestParam(value = "page", defaultValue = "0") int page,
            @RequestParam(value = "size", defaultValue = "20") int size,
            @RequestParam(value = "includeLeadDetail", defaultValue = "false") boolean includeLeadDetail,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(
                leadFollowupService.completed(user, instituteId, counsellorUserId, search,
                        toTimestamp(closedFrom), toTimestamp(closedTo),
                        leadStatusId, leadStatusExcludeId,
                        PageRequest.of(page, size), includeLeadDetail));
    }

    /**
     * Same as the GET, with the lead filters in the body (see
     * {@link CompletedFollowUpsQuery} for why a body).
     */
    @PostMapping("/completed")
    public ResponseEntity<Page<LeadFollowupDto>> completedFiltered(
            @RequestBody CompletedFollowUpsQuery q,
            @RequestAttribute("user") CustomUserDetails user) {
        int page = q.getPage() == null ? 0 : q.getPage();
        int size = q.getSize() == null ? 20 : q.getSize();
        String audienceIdsCsv = q.getAudienceIds() == null || q.getAudienceIds().isEmpty()
                ? null
                : String.join(",", q.getAudienceIds());
        return ResponseEntity.ok(
                leadFollowupService.completed(user, q.getInstituteId(), q.getCounsellorUserId(),
                        q.getSearch(), toTimestamp(q.getClosedFrom()), toTimestamp(q.getClosedTo()),
                        q.getLeadStatusId(), q.getLeadStatusExcludeId(),
                        audienceIdsCsv, q.getUtmFilters(), q.getInterestLevels(),
                        PageRequest.of(page, size), Boolean.TRUE.equals(q.getIncludeLeadDetail())));
    }

    /** ISO-8601 instant from the browser, or null when the range is open-ended. */
    private static Timestamp toTimestamp(String iso) {
        if (iso == null || iso.isBlank()) return null;
        return Timestamp.from(Instant.parse(iso));
    }

    @PutMapping("/{id}")
    @Auditable(
            entityType = "LEAD_FOLLOWUP",
            action = "UPDATE",
            entityIdExpr = "#id",
            captureBefore = "@crmAuditNarrator.followupSnapshot(#id)",
            descriptionExpr = "(#request?.scheduleTime != null ? 'rescheduled' : 'edited') "
                    + "+ ' a follow-up for lead ' + @crmAuditNarrator.followupLeadFor(#id)")
    public ResponseEntity<LeadFollowupDto> update(@PathVariable String id,
                                                   @RequestBody UpdateLeadFollowupRequest request,
                                                   @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(leadFollowupService.update(id, request, user));
    }

    @PutMapping("/{id}/close")
    @Auditable(
            entityType = "LEAD_FOLLOWUP",
            action = "CLOSE",
            entityIdExpr = "#id",
            descriptionExpr = "'closed a follow-up for lead ' + @crmAuditNarrator.followupLeadFor(#id)")
    public ResponseEntity<LeadFollowupDto> close(@PathVariable String id,
                                                  @RequestBody CloseLeadFollowupRequest request,
                                                  @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(leadFollowupService.close(id, request, user));
    }
}
