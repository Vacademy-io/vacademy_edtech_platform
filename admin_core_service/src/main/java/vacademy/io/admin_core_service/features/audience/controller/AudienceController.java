package vacademy.io.admin_core_service.features.audience.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.audience.dto.*;
import vacademy.io.admin_core_service.features.audience.service.AudienceRoleAccessService;
import vacademy.io.admin_core_service.features.audience.service.AudienceService;
import vacademy.io.admin_core_service.features.audience.service.LeadAssignmentNotifier;
import vacademy.io.admin_core_service.features.audience.service.LeadCreatorAttributionService;
import vacademy.io.admin_core_service.features.audience.service.LeadDeduplicationService;
import vacademy.io.admin_core_service.features.audience.service.LeadVisibilityResolver;
import vacademy.io.admin_core_service.features.audience.service.ManualLeadOwnerGuard;
import vacademy.io.admin_core_service.features.audience.service.UserLeadProfileService;
import vacademy.io.admin_core_service.features.timeline.enums.LeadJourneyActionType;
import vacademy.io.admin_core_service.features.timeline.service.TimelineEventService;
import vacademy.io.common.auth.config.PageConstants;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.util.List;
import java.util.Map;

/**
 * REST Controller for Audience Management
 * Endpoints for campaign creation, lead management, and reporting
 */
@RestController
@RequestMapping("/admin-core-service/v1/audience")
public class AudienceController {

    @Autowired
    private AudienceService audienceService;

    @Autowired
    private UserLeadProfileService userLeadProfileService;

    @Autowired
    private TimelineEventService timelineEventService;

    @Autowired
    private LeadAssignmentNotifier leadAssignmentNotifier;

    @Autowired
    private LeadCreatorAttributionService leadCreatorAttributionService;

    @Autowired
    private ManualLeadOwnerGuard manualLeadOwnerGuard;

    @Autowired
    private AudienceRoleAccessService audienceRoleAccessService;

    @Autowired
    private LeadVisibilityResolver leadVisibilityResolver;

    @Autowired
    private InstituteAccessValidator instituteAccessValidator;

    @Autowired
    private LeadDeduplicationService leadDeduplicationService;

    /**
     * Returns the candidate counsellors a caller is allowed to assign a lead
     * to: COUNSELLOR-role users only. A hierarchy-scoped caller (holds the
     * COUNSELLOR role) is narrowed to their scope (themselves + counsellor
     * reports + reports' reports); a pure admin gets the institute-wide
     * counsellor roster.
     *
     * Used by the "Assign counsellor" dialogs on Recent Leads / per-campaign
     * leads / Enquiries. Replaces direct calls to /auth-service/v1/user/
     * autosuggest-users for those flows so a manager can't accidentally
     * assign a lead to someone outside their reporting chain.
     */
    @GetMapping("/eligible-assignees")
    public ResponseEntity<List<vacademy.io.common.auth.dto.UserDTO>> eligibleAssignees(
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "query", required = false) String query,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(audienceService.eligibleAssignees(instituteId, query, user));
    }

    /**
     * Counsellor options for the CRM Leads "All counsellors" filter — always the
     * caller-visible COUNSELLOR-role list. A hierarchy-scoped caller (COUNSELLOR role) gets
     * their scope (themselves + counsellor reports) with {@code scoped=true}, matching the
     * leads they can actually see; a pure admin gets the institute-wide counsellor roster
     * with {@code scoped=false}. Used by the Recent Leads / per-campaign leads / Follow-ups
     * filter bars.
     */
    @GetMapping("/lead-counsellor-options")
    public ResponseEntity<LeadCounsellorOptionsDTO> leadCounsellorOptions(
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "assignable", defaultValue = "false") boolean assignable,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(audienceService.leadCounsellorOptions(instituteId, user, assignable));
    }

    /**
     * The caller's lead visibility in the institute — exactly the scope the CRM
     * Leads list (POST /leads) applies, resolved by the same
     * {@link LeadVisibilityResolver}. Lets other clients (the MCP CRM tools)
     * read leads with the dashboard's scope instead of re-deriving it.
     *
     * <p>Snake_case: {@code {mode, owner_ids, include_unassigned,
     * allowed_audience_ids, sub_org_ids, is_admin}}; a null {@code owner_ids} /
     * {@code allowed_audience_ids} means no restriction. The caller must be staff
     * of {@code instituteId}.
     */
    @GetMapping("/lead-scope")
    public ResponseEntity<LeadScopeDTO> leadScope(
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteStaff(user, instituteId);
        return ResponseEntity.ok(LeadScopeDTO.from(
                leadVisibilityResolver.resolveWithSubOrgIds(user, instituteId)));
    }

    @PostMapping("/campaign")
    @Auditable(
            entityType = "AUDIENCE",
            action = "CREATE",
            entityIdExpr = "#result?.body",
            descriptionExpr = "'created audience ' + (#audienceDTO?.campaignName ?: 'list')")
    public ResponseEntity<String> createCampaign(
            @RequestBody AudienceDTO audienceDTO,
            @RequestAttribute("user") CustomUserDetails user) {
        
        // Set created by user
        if (audienceDTO.getCreatedByUserId() == null) {
            audienceDTO.setCreatedByUserId(user.getUserId());
        }

        String campaignId = audienceService.createCampaign(audienceDTO);
        return ResponseEntity.ok(campaignId);
    }

    @PutMapping("/campaign/{audienceId}")
    @Auditable(
            entityType = "AUDIENCE",
            action = "UPDATE",
            entityIdExpr = "#audienceId",
            captureBefore = "@crmAuditNarrator.audienceSnapshot(#audienceId)",
            descriptionExpr = "'updated audience ' + (#audienceDTO?.campaignName "
                    + "?: @crmAuditNarrator.nameFromSnapshot(#before, #audienceId))")
    public ResponseEntity<String> updateCampaign(
            @PathVariable String audienceId,
            @RequestBody AudienceDTO audienceDTO,
            @RequestAttribute("user") CustomUserDetails user) {

        String updatedId = audienceService.updateCampaign(audienceId, audienceDTO);
        return ResponseEntity.ok(updatedId);
    }

    /**
     * A lead list's key -> value tags, {@code {audience_id, tags}}. The list must belong to
     * {@code instituteId} and the caller must be staff of that institute.
     */
    @GetMapping("/campaign/{audienceId}/tags")
    public ResponseEntity<AudienceTagsResponseDTO> getCampaignTags(
            @PathVariable String audienceId,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteStaff(user, instituteId);
        return ResponseEntity.ok(audienceService.getCampaignTags(audienceId, instituteId, user));
    }

    /**
     * Replaces a lead list's tags without resending the whole list. Body {@code {"tags": {...}}};
     * an empty map clears them. Returns the saved {@code {audience_id, tags}}. Same checks as
     * the GET above, plus the list must still be in {@code instituteId} when written.
     */
    @PutMapping("/campaign/{audienceId}/tags")
    @Auditable(
            entityType = "AUDIENCE",
            action = "UPDATE",
            entityIdExpr = "#audienceId",
            captureBefore = "@crmAuditNarrator.audienceSnapshot(#audienceId)",
            descriptionExpr = "'updated tags of audience ' + @crmAuditNarrator.nameFromSnapshot(#before, #audienceId)")
    public ResponseEntity<AudienceTagsResponseDTO> setCampaignTags(
            @PathVariable String audienceId,
            @RequestParam("instituteId") String instituteId,
            @RequestBody AudienceTagsRequestDTO request,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteStaff(user, instituteId);
        return ResponseEntity.ok(audienceService.setCampaignTags(
                audienceId, instituteId, request != null ? request.getTags() : null, user));
    }

    /**
     * Tag keys in use across the institute's lead lists with their distinct values and list
     * counts, {@code [{key, values: [{value, lists}]}]}, for tag autocomplete. Scoped to the
     * lists the caller can see, like {@code POST /campaigns}.
     */
    @GetMapping("/campaign-tags")
    public ResponseEntity<List<CampaignTagSummaryDTO>> getCampaignTagSummary(
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteStaff(user, instituteId);
        return ResponseEntity.ok(audienceService.getCampaignTagSummary(instituteId, user));
    }

    @PostMapping("/campaigns")
    public ResponseEntity<Page<AudienceDTO>> getCampaigns(
            @RequestBody AudienceFilterDTO filterDTO,
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam(name = "pageNo", defaultValue = PageConstants.DEFAULT_PAGE_NUMBER) int pageNo,
            @RequestParam(name = "pageSize", defaultValue = PageConstants.DEFAULT_PAGE_SIZE) int pageSize) {

        // Set pagination from request params
        if (filterDTO.getPage() == null) {
            filterDTO.setPage(pageNo);
        }
        if (filterDTO.getSize() == null) {
            filterDTO.setSize(pageSize);
        }

        Page<AudienceDTO> campaigns = audienceService.getCampaigns(filterDTO, user);
        return ResponseEntity.ok(campaigns);
    }

    @DeleteMapping("/campaign/{instituteId}/{audienceId}")
    @Auditable(
            entityType = "AUDIENCE",
            action = "DELETE",
            entityIdExpr = "#audienceId",
            // The name has to be read before the delete — after it, there is
            // nothing left to look up.
            captureBefore = "@crmAuditNarrator.audienceSnapshot(#audienceId)",
            descriptionExpr = "'deleted audience ' + @crmAuditNarrator.nameFromSnapshot(#before, #audienceId)")
    public ResponseEntity<String> deleteCampaign(
            @PathVariable String instituteId,
            @PathVariable String audienceId) {

        audienceService.deleteCampaign(audienceId, instituteId);
        return ResponseEntity.ok("Campaign deleted successfully");
    }

    /**
     * Add a lead by hand from the admin panel.
     *
     * <p>Same payload and same intake pipeline as the public
     * {@code /open/v1/audience/lead/submit} endpoint, with one difference: this
     * one knows who is adding the lead. That lets
     * {@link LeadCreatorAttributionService} stamp the creator as the lead's
     * counsellor when the institute's audience-access setting asks for it — the
     * public endpoint carries no token, so it never could.
     *
     * <p>Existing website/webhook integrations stay on the open endpoint and are
     * unaffected.
     */
    @PostMapping("/lead/submit")
    @Auditable(
            entityType = "LEAD",
            action = "CREATE",
            entityIdExpr = "#result?.body",
            descriptionExpr = "'added lead ' + (#requestDTO?.userDTO?.fullName "
                    + "?: #requestDTO?.userDTO?.mobileNumber ?: #requestDTO?.userDTO?.email ?: 'contact')")
    public ResponseEntity<String> submitLead(
            @RequestBody SubmitLeadRequestDTO requestDTO,
            @RequestAttribute("user") CustomUserDetails user) {

        manualLeadOwnerGuard.checkCanAdd(requestDTO, user);
        leadCreatorAttributionService.applyCreatorAsCounsellor(requestDTO, user);
        requestDTO.setCreatedByUserId(user.getUserId());
        return ResponseEntity.ok(audienceService.submitLead(requestDTO));
    }

    /**
     * CSV / bulk import of leads from the admin panel. Authenticated twin of
     * {@code /open/v1/audience/lead/bulk-submit}, for the same reason as
     * {@link #submitLead}: rows that carry no owner column fall to the person
     * running the import when the audience-access setting asks for it.
     */
    @PostMapping("/lead/bulk-submit")
    @Auditable(
            entityType = "LEAD",
            action = "IMPORT",
            entityIdExpr = "#request?.audienceId",
            // A CSV import body is unbounded — thousands of rows of PII. The
            // summary in the description is what an audit reader needs.
            payload = Auditable.PayloadMode.NONE,
            descriptionExpr = "'imported ' + (#result?.body?.summary?.successful ?: (#request?.rows?.size() ?: 0)) "
                    + "+ ' lead(s)' + (#request?.audienceId != null ? ' into ' "
                    + "+ @crmAuditNarrator.audienceFor(#request.audienceId) : '')")
    public ResponseEntity<BulkSubmitLeadResponseDTO> bulkSubmitLead(
            @RequestBody BulkSubmitLeadRequestDTO request,
            @RequestAttribute("user") CustomUserDetails user) {

        leadCreatorAttributionService.applyCreatorAsCounsellor(request, user);
        if (request.getRows() != null) {
            request.getRows().stream()
                    .filter(java.util.Objects::nonNull)
                    .forEach(row -> row.setCreatedByUserId(user.getUserId()));
        }
        return ResponseEntity.ok(audienceService.bulkSubmitLead(request));
    }

    @PostMapping("/leads")
    public ResponseEntity<Page<LeadDetailDTO>> getLeads(
            @RequestBody LeadFilterDTO filterDTO,
            @RequestAttribute("user") CustomUserDetails user,
            @RequestParam(name = "pageNo", defaultValue = PageConstants.DEFAULT_PAGE_NUMBER) int pageNo,
            @RequestParam(name = "pageSize", defaultValue = PageConstants.DEFAULT_PAGE_SIZE) int pageSize) {

        // Set pagination from request params
        if (filterDTO.getPage() == null) {
            filterDTO.setPage(pageNo);
        }
        if (filterDTO.getSize() == null) {
            filterDTO.setSize(pageSize);
        }

        Page<LeadDetailDTO> leads = audienceService.getLeads(filterDTO, user);
        return ResponseEntity.ok(leads);
    }

    @GetMapping("/lead/{responseId}")
    public ResponseEntity<LeadDetailDTO> getLeadById(@PathVariable String responseId) {
        LeadDetailDTO lead = audienceService.getLeadById(responseId);
        return ResponseEntity.ok(lead);
    }

    /**
     * Distinct values a custom field actually holds across the institute's
     * leads, searchable and paginated. Powers the multi-select custom-field
     * dropdowns in the leads filter bar (e.g. listing every city leads have
     * entered into a free-text "City" field). The frontend only calls this for
     * custom fields the admin has enabled as leads filters in settings.
     */
    @GetMapping("/custom-field-values")
    public ResponseEntity<Page<String>> getLeadCustomFieldValues(
            @RequestParam("instituteId") String instituteId,
            @RequestParam("customFieldId") String customFieldId,
            @RequestParam(value = "search", required = false) String search,
            @RequestParam(name = "pageNo", defaultValue = PageConstants.DEFAULT_PAGE_NUMBER) int pageNo,
            @RequestParam(name = "pageSize", defaultValue = PageConstants.DEFAULT_PAGE_SIZE) int pageSize) {
        return ResponseEntity.ok(
                audienceService.getLeadCustomFieldValues(instituteId, customFieldId, search, pageNo, pageSize));
    }

    /**
     * Soft-delete one or more leads. Replaces the previous
     * {@code DELETE /lead/{responseId}}, which hard-deleted the row with no authorization
     * check and was never wired to any UI.
     *
     * <p>Body-based because a delete needs three things a path param can't carry: the id LIST
     * (bulk), the {@code scope} (this response vs the whole person), and the
     * {@code institute_id} the ADMIN check is made against.</p>
     */
    @PostMapping("/leads/delete")
    @Auditable(
            entityType = "LEAD",
            action = "DELETE",
            entityIdExpr = "#request?.responseIds != null and #request.responseIds.size() == 1 "
                    + "? #request.responseIds[0] : null",
            // A delete that matched nothing still returns 200; logging it would
            // claim leads were removed that never were.
            conditionExpr = "#result?.body != null and #result.body['deleted'] != null "
                    + "and #result.body['deleted'] > 0",
            descriptionExpr = "'deleted lead ' + @crmAuditNarrator.leadsFor(#request?.responseIds)")
    public ResponseEntity<Map<String, Object>> deleteLeads(
            @RequestBody LeadDeleteRequestDTO request,
            @RequestAttribute("user") CustomUserDetails user) {
        int deleted = audienceService.deleteLeads(request, user);
        return ResponseEntity.ok(Map.of("deleted", deleted));
    }

    /** Restore soft-deleted leads — the inverse of {@link #deleteLeads}. ADMIN only. */
    @PostMapping("/leads/restore")
    @Auditable(
            entityType = "LEAD",
            action = "RESTORE",
            entityIdExpr = "#request?.responseIds != null and #request.responseIds.size() == 1 "
                    + "? #request.responseIds[0] : null",
            conditionExpr = "#result?.body != null and #result.body['restored'] != null "
                    + "and #result.body['restored'] > 0",
            descriptionExpr = "'restored lead ' + @crmAuditNarrator.leadsFor(#request?.responseIds)")
    public ResponseEntity<Map<String, Object>> restoreLeads(
            @RequestBody LeadDeleteRequestDTO request,
            @RequestAttribute("user") CustomUserDetails user) {
        int restored = audienceService.restoreLeads(request, user);
        return ResponseEntity.ok(Map.of("restored", restored));
    }

    /**
     * Move leads from one lead list to another. ADMIN only.
     *
     * <p>Body-based for the same reasons as {@link #deleteLeads} — an id LIST, a {@code scope},
     * and the {@code institute_id} the ADMIN check runs against — plus the target list and how the
     * move should treat that list's automation.</p>
     *
     * <p>Partial success: the response reports how many moved and which were skipped, with a
     * reason each. Merging two lists collides by definition, so refusing the whole batch over one
     * collision would make the operation unusable.</p>
     */
    @PostMapping("/leads/migrate")
    @Auditable(
            entityType = "LEAD",
            action = "MIGRATE",
            entityIdExpr = "#request?.responseIds != null and #request.responseIds.size() == 1 "
                    + "? #request.responseIds[0] : null",
            // A migration that moved nothing still returns 200 (every lead was skipped);
            // logging it would claim leads changed list when none did.
            conditionExpr = "#result?.body != null and #result.body.migrated > 0",
            descriptionExpr = "'moved lead ' + @crmAuditNarrator.leadsFor(#request?.responseIds)")
    public ResponseEntity<MigrateLeadsResponseDTO> migrateLeads(
            @RequestBody MigrateLeadsRequestDTO request,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(audienceService.migrateLeads(request, user));
    }

    /**
     * Edit a lead's profile from the CRM. The learner-profile endpoint cannot serve
     * a lead: it resolves the caller against the {@code student} table, and a lead
     * that never enrolled has no row there. This writes only where a lead is actually
     * read from — the auth user, the {@code audience_response} parent/guardian fields,
     * and the lead's custom field values. It never touches {@code student}.
     */
    @PutMapping("/lead/{responseId}/profile")
    @Auditable(
            entityType = "LEAD",
            action = "UPDATE",
            entityIdExpr = "#responseId",
            descriptionExpr = "'updated lead ' + @crmAuditNarrator.leadFor(#responseId)")
    public ResponseEntity<String> updateLeadProfile(@PathVariable String responseId,
                                                    @RequestBody LeadProfileEditRequestDTO request) {
        audienceService.updateLeadProfile(responseId, request);
        return ResponseEntity.ok("Lead profile updated");
    }

    /**
     * Send a message to audience campaign leads.
     */
    @PostMapping("/campaign/{audienceId}/send")
    @Auditable(
            entityType = "AUDIENCE",
            action = "SEND_MESSAGE",
            entityIdExpr = "#audienceId",
            descriptionExpr = "'sent a message to audience ' + @crmAuditNarrator.audienceFor(#audienceId)")
    public ResponseEntity<SendAudienceMessageResponseDTO> sendMessage(
            @PathVariable String audienceId,
            @RequestBody SendAudienceMessageRequestDTO request) {
        request.setAudienceId(audienceId);
        SendAudienceMessageResponseDTO response = audienceService.sendAudienceMessage(request);
        return ResponseEntity.ok(response);
    }

    /**
     * Get communication history for a campaign.
     */
    @GetMapping("/campaign/{audienceId}/communications")
    public ResponseEntity<Page<AudienceCommunicationDTO>> getCommunications(
            @PathVariable String audienceId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        Page<AudienceCommunicationDTO> communications = audienceService.getCommunications(audienceId, page, size);
        return ResponseEntity.ok(communications);
    }

    @PostMapping("/enquiries")
    public ResponseEntity<Page<EnquiryWithResponseDTO>> getEnquiries(
            @RequestBody EnquiryListFilterDTO filterDTO,
            @RequestParam(name = "pageNo", defaultValue = PageConstants.DEFAULT_PAGE_NUMBER) int pageNo,
            @RequestParam(name = "pageSize", defaultValue = PageConstants.DEFAULT_PAGE_SIZE) int pageSize) {
        
        // Set pagination from request params if not provided in body
        if (filterDTO.getPage() == null) {
            filterDTO.setPage(pageNo);
        }
        if (filterDTO.getSize() == null) {
            filterDTO.setSize(pageSize);
        }
        
        Page<EnquiryWithResponseDTO> enquiries = audienceService.getEnquiriesWithResponses(filterDTO);
        return ResponseEntity.ok(enquiries);
    }

    // ── Walk-In Registration ──────────────────────────────

    /**
     * Register a walk-in lead. Simplified form for events/fairs.
     * Auto-sets sourceType to WALK_IN and assigns the logged-in user as counselor.
     * POST /admin-core-service/v1/audience/walk-in/submit
     */
    @PostMapping("/walk-in/submit")
    @Auditable(
            entityType = "LEAD",
            action = "CREATE",
            entityIdExpr = "#result?.body?.audienceResponseId",
            descriptionExpr = "'registered walk-in lead ' + (#walkInDTO?.parentName "
                    + "?: #walkInDTO?.childName ?: #walkInDTO?.parentMobile ?: 'contact')")
    public ResponseEntity<SubmitLeadWithEnquiryResponseDTO> submitWalkIn(
            @RequestBody WalkInRegistrationDTO walkInDTO,
            @RequestAttribute("user") CustomUserDetails user) {

        SubmitLeadWithEnquiryResponseDTO response = audienceService.submitWalkIn(walkInDTO, user);
        return ResponseEntity.ok(response);
    }

    // ── Lead Score ────────────────────────────────────────

    /**
     * Get lead score details for a specific lead.
     * GET /admin-core-service/v1/audience/lead/{responseId}/score
     */
    /**
     * The different phone numbers and real emails the person behind this lead has enquired
     * with, each with the first enquiry that brought it, e.g. a repeat that came in with a
     * new phone or a new email. Snake_case {phones: [...], emails: [...]}, each item
     * {value, response_id, source_type, campaign_name, created_at}. The caller must be
     * staff of the lead's institute.
     */
    @GetMapping("/lead/{responseId}/enquiry-contacts")
    public ResponseEntity<LeadEnquiryContactsDTO> getLeadEnquiryContacts(@PathVariable String responseId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(leadDeduplicationService.findEnquiryContacts(responseId,
                instituteId -> instituteAccessValidator.requireStaffAccess(user, instituteId)));
    }

    @GetMapping("/lead/{responseId}/score")
    public ResponseEntity<LeadScoreDTO> getLeadScore(@PathVariable String responseId) {
        LeadScoreDTO score = audienceService.getLeadScore(responseId);
        return ResponseEntity.ok(score);
    }

    /**
     * Manually set (or clear) the score for a lead.
     * PUT /admin-core-service/v1/audience/lead/{responseId}/score/manual
     * Body: { "score": 75 }  — pass null to clear the override.
     */
    @PutMapping("/lead/{responseId}/score/manual")
    @Auditable(
            entityType = "LEAD",
            action = "SCORE_CHANGE",
            entityIdExpr = "#responseId",
            descriptionExpr = "'changed lead score of ' + @crmAuditNarrator.leadFor(#responseId) "
                    + "+ ' to ' + (#body != null and #body['score'] != null ? #body['score'] : 'auto')")
    public ResponseEntity<LeadScoreDTO> setManualScore(
            @PathVariable String responseId,
            @RequestBody java.util.Map<String, Integer> body,
            @RequestAttribute("user") CustomUserDetails user) {
        Integer score = body.get("score");
        LeadScoreDTO result = audienceService.setManualScore(responseId, score, user.getUserId(), user.getUsername());
        return ResponseEntity.ok(result);
    }

    /**
     * Force recalculate all lead scores for a campaign.
     * POST /admin-core-service/v1/audience/campaign/{audienceId}/recalculate-scores
     */
    @PostMapping("/campaign/{audienceId}/recalculate-scores")
    @Auditable(
            entityType = "AUDIENCE",
            action = "RECALCULATE_SCORES",
            entityIdExpr = "#audienceId",
            descriptionExpr = "'recalculated lead scores for audience ' + @crmAuditNarrator.audienceFor(#audienceId)")
    public ResponseEntity<String> recalculateScores(@PathVariable String audienceId) {
        audienceService.recalculateScoresForAudience(audienceId);
        return ResponseEntity.ok("Scores recalculated for campaign: " + audienceId);
    }

    /**
     * Get aggregated lead profile for a specific user.
     * Builds the profile on-demand if it doesn't exist yet (e.g. batch hasn't run).
     * GET /admin-core-service/v1/audience/user-lead-profile?userId=...&instituteId=...
     */
    @GetMapping("/user-lead-profile")
    public ResponseEntity<?> getUserLeadProfile(
            @RequestParam String userId,
            @RequestParam String instituteId) {
        // Try existing profile first
        var existing = userLeadProfileService.getProfileDTO(userId, instituteId);
        if (existing.isPresent()) {
            return ResponseEntity.ok(existing.get());
        }
        // Build on-demand — creates a profile if the user has any audience responses
        try {
            userLeadProfileService.buildOrUpdateProfile(userId, instituteId);
        } catch (Exception ignored) {
            // No audience data for this user — that's fine
        }
        return userLeadProfileService.getProfileDTO(userId, instituteId)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * Manually mark a user's lead as CONVERTED.
     * POST /admin-core-service/v1/audience/user-lead-profile/mark-converted
     */
    @PostMapping("/user-lead-profile/mark-converted")
    @Auditable(
            entityType = "LEAD",
            action = "CONVERT",
            entityIdExpr = "#userId",
            descriptionExpr = "'marked lead ' + @crmAuditNarrator.leadUserFor(#userId) + ' as converted'")
    public ResponseEntity<UserLeadProfileDTO> markLeadConverted(
            @RequestParam String userId,
            @RequestParam String instituteId) {
        userLeadProfileService.markConverted(userId, instituteId);
        return ResponseEntity.ok(userLeadProfileService.getProfileDTO(userId, instituteId).orElse(null));
    }

    /**
     * Update lead conversion status (LEAD, CONVERTED, LOST).
     * POST /admin-core-service/v1/audience/user-lead-profile/update-status?userId=...&instituteId=...&status=...
     */
    @PostMapping("/user-lead-profile/update-status")
    @Auditable(
            entityType = "LEAD",
            action = "STATUS_CHANGE",
            entityIdExpr = "#userId",
            descriptionExpr = "'changed lead status of ' + @crmAuditNarrator.leadUserFor(#userId) + ' to ' + #status")
    public ResponseEntity<UserLeadProfileDTO> updateLeadStatus(
            @RequestParam String userId,
            @RequestParam String instituteId,
            @RequestParam String status,
            @RequestAttribute("user") CustomUserDetails user) {
        String oldStatus = userLeadProfileService.getProfileDTO(userId, instituteId)
                .map(p -> p.getConversionStatus())
                .orElse(null);
        var updatedProfile = userLeadProfileService.updateConversionStatus(userId, instituteId, status,
                user != null ? user.getUserId() : null);
        try {
            LeadJourneyActionType actionType = "CONVERTED".equals(status) ? LeadJourneyActionType.LEAD_CONVERTED
                    : "LOST".equals(status) ? LeadJourneyActionType.LEAD_LOST
                    : LeadJourneyActionType.STATUS_CHANGED;
            String title = "CONVERTED".equals(status) ? "Lead converted"
                    : "LOST".equals(status) ? "Lead marked as lost"
                    : "Status changed to " + status;
            Map<String, Object> meta = new java.util.LinkedHashMap<>();
            if (oldStatus != null) meta.put("old_status", oldStatus);
            meta.put("new_status", status);
            meta.put("changed_by", user.getUsername() != null ? user.getUsername() : "");
            timelineEventService.logJourneyEvent(
                    "USER_LEAD_PROFILE", updatedProfile.getId(),
                    actionType,
                    "ADMIN", user.getUserId(), user.getUsername(),
                    title, null,
                    meta,
                    userId);
        } catch (Exception e) {
            // best-effort
        }
        return ResponseEntity.ok(userLeadProfileService.getProfileDTO(userId, instituteId).orElse(null));
    }

    /**
     * Manually set lead tier (HOT, WARM, COLD) by overriding the score.
     * POST /admin-core-service/v1/audience/user-lead-profile/update-tier?userId=...&instituteId=...&tier=HOT
     */
    @PostMapping("/user-lead-profile/update-tier")
    @Auditable(
            entityType = "LEAD",
            action = "TIER_CHANGE",
            entityIdExpr = "#userId",
            descriptionExpr = "'changed lead tier of ' + @crmAuditNarrator.leadUserFor(#userId) + ' to ' + #tier")
    public ResponseEntity<UserLeadProfileDTO> updateLeadTier(
            @RequestParam String userId,
            @RequestParam String instituteId,
            @RequestParam String tier,
            @RequestAttribute("user") CustomUserDetails user) {
        var updatedProfile = userLeadProfileService.updateLeadTier(userId, instituteId, tier);
        try {
            timelineEventService.logJourneyEvent(
                    "USER_LEAD_PROFILE", updatedProfile.getId(),
                    LeadJourneyActionType.STATUS_CHANGED,
                    "ADMIN", user.getUserId(), user.getUsername(),
                    "Lead tier set to " + tier, null,
                    Map.of("tier", tier, "changed_by", user.getUsername() != null ? user.getUsername() : ""),
                    userId);
        } catch (Exception e) {
            // best-effort
        }
        return ResponseEntity.ok(userLeadProfileService.getProfileDTO(userId, instituteId).orElse(null));
    }

    /**
     * Batch fetch lead profiles for a list of user IDs, scoped to one institute (a user_id
     * can now have a profile per institute — see UserLeadProfile's uniqueConstraints).
     * POST /admin-core-service/v1/audience/user-lead-profiles/batch?instituteId=...
     * Body: ["userId1", "userId2", ...]
     * Returns: { "userId1": { ...profile }, "userId2": { ...profile } }
     */
    @PostMapping("/user-lead-profiles/batch")
    public ResponseEntity<Map<String, UserLeadProfileDTO>> getBatchLeadProfiles(
            @RequestParam String instituteId,
            @RequestBody List<String> userIds) {
        return ResponseEntity.ok(userLeadProfileService.getProfilesForUsers(userIds, instituteId));
    }

    /**
     * Get a user's audience/campaign memberships within one institute.
     * GET /admin-core-service/v1/audience/user-audiences?userId=...&instituteId=...
     *
     * <p>{@code instituteId} falls back to the {@code clientId} header (the admin app's current
     * institute) so a bundle cached from before the param existed keeps working — scoped, not
     * platform-wide as it used to be.</p>
     *
     * <p>The caller must hold a role in that institute, so an admin of one institute can't name
     * another and read which of its campaigns a person is in. Accepted from either the JWT's
     * per-institute roles, or the DB-loaded roles when the clientId header names this same
     * institute (covers a role granted after the token was minted).</p>
     */
    @GetMapping("/user-audiences")
    public ResponseEntity<List<UserAudienceMembershipDTO>> getUserAudiences(
            @RequestParam String userId,
            @RequestParam(required = false) String instituteId,
            @RequestHeader(value = "clientId", required = false) String clientId,
            @RequestAttribute(value = "user", required = false) CustomUserDetails user) {
        String scopedInstituteId = (instituteId != null && !instituteId.isBlank()) ? instituteId : clientId;
        if (scopedInstituteId == null || scopedInstituteId.isBlank()) {
            throw new InvalidRequestException("instituteId is required");
        }
        boolean rolesInJwt = !audienceRoleAccessService.currentRequestRoles(scopedInstituteId).isEmpty();
        boolean rolesForHeaderInstitute = scopedInstituteId.equals(clientId)
                && user != null && user.getAuthorities() != null && !user.getAuthorities().isEmpty();
        if (!rolesInJwt && !rolesForHeaderInstitute) {
            throw new ForbiddenException("You do not have access to this institute");
        }
        return ResponseEntity.ok(userLeadProfileService.getUserAudienceMemberships(userId, scopedInstituteId));
    }

    /**
     * Assign — or remove — a counselor on a user's lead profile.
     * POST /admin-core-service/v1/audience/user-lead-profile/assign-counselor
     *   ?userId=...&instituteId=...&counselorId=...&counselorName=...
     *
     * <p>Omitting {@code counselorId} (or sending it blank) REMOVES the
     * current assignment: the lead returns to the unassigned pool and a
     * COUNSELOR_UNASSIGNED journey event is logged. Removing when nothing is
     * assigned is a silent no-op (no event noise).
     */
    @PostMapping("/user-lead-profile/assign-counselor")
    @Auditable(
            entityType = "LEAD",
            // One mapping, two logical operations: a blank counselorId removes
            // the assignment. Stamping both ASSIGN would make removals invisible.
            actionExpr = "(#counselorId == null or #counselorId.isBlank()) ? 'UNASSIGN' : 'ASSIGN'",
            entityIdExpr = "#userId",
            // Unassigning a lead that has no counsellor returns early with a 200
            // and changes nothing; only a lead that HAD one is a real removal.
            captureBefore = "@crmAuditNarrator.assignedCounsellorFor(#userId, #instituteId)",
            conditionExpr = "(#counselorId != null and !#counselorId.isBlank()) or #before != null",
            descriptionExpr = "@crmAuditNarrator.counsellorAssignment(#userId, #counselorId, #counselorName)")
    public ResponseEntity<UserLeadProfileDTO> assignCounselor(
            @RequestParam String userId,
            @RequestParam String instituteId,
            @RequestParam(required = false) String counselorId,
            @RequestParam(required = false) String counselorName,
            @RequestAttribute("user") CustomUserDetails user) {
        boolean unassign = counselorId == null || counselorId.isBlank();

        if (unassign) {
            String previousName = userLeadProfileService.getProfileDTO(userId, instituteId)
                    .map(p -> p.getAssignedCounselorName() != null
                            ? p.getAssignedCounselorName() : p.getAssignedCounselorId())
                    .orElse(null);
            if (previousName == null) {
                // Nothing assigned — no-op, no journey noise.
                return ResponseEntity.ok(
                        userLeadProfileService.getProfileDTO(userId, instituteId).orElse(null));
            }
            var unassignedProfile = userLeadProfileService.assignCounselor(userId, instituteId, null, null);
            try {
                timelineEventService.logJourneyEvent(
                        "USER_LEAD_PROFILE", unassignedProfile.getId(),
                        LeadJourneyActionType.COUNSELOR_UNASSIGNED,
                        "ADMIN", user.getUserId(), user.getUsername(),
                        "Counselor removed",
                        "Removed " + previousName + " — lead is unassigned",
                        Map.of("removed_counselor", previousName,
                               "removed_by", user.getUsername() != null ? user.getUsername() : ""),
                        userId);
            } catch (Exception e) {
                // best-effort — don't fail the removal if logging fails
            }
            return ResponseEntity.ok(
                    userLeadProfileService.getProfileDTO(userId, instituteId).orElse(null));
        }

        var assignedProfile = userLeadProfileService.assignCounselor(userId, instituteId, counselorId, counselorName);
        try {
            timelineEventService.logJourneyEvent(
                    "USER_LEAD_PROFILE", assignedProfile.getId(),
                    LeadJourneyActionType.COUNSELOR_ASSIGNED,
                    "ADMIN", user.getUserId(), user.getUsername(),
                    "Counselor assigned",
                    "Assigned to " + (counselorName != null ? counselorName : counselorId),
                    Map.of("counselor_id", counselorId,
                           "counselor_name", counselorName != null ? counselorName : "",
                           "assigned_by", user.getUsername() != null ? user.getUsername() : ""),
                    userId);
        } catch (Exception e) {
            // best-effort — don't fail the assignment if logging fails
        }
        try {
            // Bell notification to the counsellor — manual assignment should
            // light up the bell exactly like pool auto-assignment does.
            leadAssignmentNotifier.notifyAssigned(instituteId, counselorId, null, null, userId);
        } catch (Exception e) {
            // best-effort — don't fail the assignment if notification fails
        }
        return ResponseEntity.ok(userLeadProfileService.getProfileDTO(userId, instituteId).orElse(null));
    }
}

