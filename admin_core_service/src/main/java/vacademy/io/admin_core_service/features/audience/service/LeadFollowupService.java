package vacademy.io.admin_core_service.features.audience.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.audience.dto.CloseLeadFollowupRequest;
import vacademy.io.admin_core_service.features.audience.dto.CreateLeadFollowupRequest;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import vacademy.io.admin_core_service.features.audience.dto.LeadFollowupDto;
import vacademy.io.admin_core_service.features.audience.dto.UpdateLeadFollowupRequest;
import vacademy.io.admin_core_service.features.audience.entity.Audience;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.entity.LeadFollowup;
import vacademy.io.admin_core_service.features.audience.enums.LeadFollowupStatus;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.repository.LeadFollowupRepository;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.timeline.service.TimelineEventService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import vacademy.io.admin_core_service.features.live_activity.core.LiveActivityCounsellorRecorder;
import vacademy.io.admin_core_service.features.live_activity.enums.LiveActivityAction;

@Slf4j
@Service
@RequiredArgsConstructor
public class LeadFollowupService {

    private final LeadFollowupRepository leadFollowupRepository;
    private final LiveActivityCounsellorRecorder liveActivityCounsellorRecorder;
    private final TimelineEventService timelineEventService;
    private final AuthService authService;
    private final AudienceResponseRepository audienceResponseRepository;
    private final AudienceRepository audienceRepository;
    private final vacademy.io.admin_core_service.features.counsellor_workbench.service.CounsellorScopeService counsellorScopeService;
    private final vacademy.io.admin_core_service.features.counsellor_workbench.repository.WorkbenchLeadRepository workbenchLeadRepository;
    private final vacademy.io.admin_core_service.features.audience.repository.UserLeadProfileRepository userLeadProfileRepository;
    private final vacademy.io.admin_core_service.features.audience.repository.LeadStatusRepository leadStatusRepository;
    private final vacademy.io.admin_core_service.features.common.repository.CustomFieldValuesRepository customFieldValuesRepository;
    private final vacademy.io.admin_core_service.features.common.repository.CustomFieldRepository customFieldRepository;
    private final LeadFollowupSettingService leadFollowupSettingService;
    private final vacademy.io.admin_core_service.features.utm_attribution.service.UtmListFilterResolver utmListFilterResolver;

    @Transactional
    public LeadFollowupDto create(CreateLeadFollowupRequest request, CustomUserDetails user) {
        String instituteId = resolveInstituteId(request.getAudienceResponseId(), request.getInstituteId());

        LeadFollowup followup = LeadFollowup.builder()
                .audienceResponseId(request.getAudienceResponseId())
                .instituteId(instituteId)
                .createdBy(user.getUserId())
                .scheduleTime(request.getScheduleTime())
                .content(request.getContent())
                .studentResponse(request.getStudentResponse())
                .followUpMode(request.getFollowUpMode())
                .nextAction(request.getNextAction())
                .interestLevel(request.getInterestLevel())
                .build();

        LeadFollowup saved = leadFollowupRepository.save(followup);

        String studentUserId = audienceResponseRepository.findById(request.getAudienceResponseId())
                .map(AudienceResponse::getUserId)
                .orElse(null);

        timelineEventService.logEvent(
                "LEAD", request.getAudienceResponseId(),
                "FOLLOWUP_SCHEDULED",
                "ADMIN", user.getUserId(), user.getUsername(),
                "Follow-up scheduled",
                request.getContent(),
                Map.of("followupId", saved.getId(), "scheduleTime",
                        request.getScheduleTime() != null ? request.getScheduleTime().getTime() : null),
                studentUserId
        );

        liveActivityCounsellorRecorder.recordFollowup(
                instituteId, LiveActivityAction.FOLLOWUP_CREATED, saved.getId(),
                user.getUserId(), user.getUserId(), null);

        return LeadFollowupDto.from(saved);
    }

    /**
     * All follow-ups for one lead. RBAC: a hierarchy-scoped caller (COUNSELLOR
     * role) may only read them when the lead's current assignee sits inside
     * their scope (unassigned leads stay visible — same rule the leads list
     * applies to the shared unassigned pool).
     */
    @Transactional(readOnly = true)
    public List<LeadFollowupDto> listForLead(String audienceResponseId, CustomUserDetails user) {
        List<LeadFollowup> rows = leadFollowupRepository
                .findByAudienceResponseIdOrderByScheduleTimeAsc(audienceResponseId);
        if (!rows.isEmpty()) {
            assertCanAccessLead(audienceResponseId, rows.get(0).getInstituteId(), user);
        }
        return rows.stream()
                .map(LeadFollowupDto::from)
                .collect(Collectors.toList());
    }

    /**
     * Pending follow-ups the caller may work on.
     *
     * <p>Legacy shape (no instituteId): the caller's own follow-ups only —
     * kept so old frontends behave exactly as before.
     *
     * <p>With instituteId: hierarchy-scoped callers (COUNSELLOR role) get
     * their own + their counsellor-role reports' pending follow-ups (the
     * manager view); pure admins get the whole institute. An explicit
     * {@code counsellorUserId} narrows to that one user — validated against
     * the caller's scope when the caller is scoped.
     */
    @Transactional(readOnly = true)
    public List<LeadFollowupDto> myPending(CustomUserDetails user, String instituteId, String counsellorUserId) {
        if (instituteId == null || instituteId.isBlank()) {
            return withLeadInfo(withoutClosedLeads(leadFollowupRepository
                    .findByCreatedByAndIsClosedFalseOrderByScheduleTimeAsc(user.getUserId()))
                    .stream()
                    .map(LeadFollowupDto::from)
                    .collect(Collectors.toList()));
        }

        boolean scoped = counsellorScopeService.isScopedCaller(instituteId, user);
        List<LeadFollowup> rows;
        if (counsellorUserId != null && !counsellorUserId.isBlank()) {
            if (scoped && !user.getUserId().equals(counsellorUserId)
                    && !counsellorScopeService.scopedCounsellorUserIds(instituteId, user.getUserId())
                            .contains(counsellorUserId)) {
                throw new VacademyException("You don't have access to this counsellor's follow-ups");
            }
            rows = leadFollowupRepository
                    .findByInstituteIdAndCreatedByInAndIsClosedFalseOrderByScheduleTimeAsc(
                            instituteId, List.of(counsellorUserId));
        } else if (scoped) {
            rows = leadFollowupRepository
                    .findByInstituteIdAndCreatedByInAndIsClosedFalseOrderByScheduleTimeAsc(
                            instituteId,
                            counsellorScopeService.scopedCounsellorUserIds(instituteId, user.getUserId()));
        } else {
            rows = leadFollowupRepository
                    .findByInstituteIdAndIsClosedFalseOrderByScheduleTimeAsc(instituteId);
        }
        return withLeadInfo(withoutClosedLeads(rows).stream()
                .map(LeadFollowupDto::from)
                .collect(Collectors.toList()));
    }

    /**
     * Drops follow-ups whose lead has since been marked Lost / Converted. They are moot, so
     * they must not sit in Upcoming / Overdue (or the reminder bell). The rows stay open
     * rather than being closed here, so they come back if the lead is reopened.
     */
    private List<LeadFollowup> withoutClosedLeads(List<LeadFollowup> rows) {
        List<String> leadIds = rows.stream()
                .map(LeadFollowup::getAudienceResponseId)
                .filter(java.util.Objects::nonNull)
                .distinct()
                .collect(Collectors.toList());
        if (leadIds.isEmpty()) return rows;
        java.util.Set<String> closed = new java.util.HashSet<>(audienceResponseRepository.findClosedLeadIds(leadIds));
        if (closed.isEmpty()) return rows;
        return rows.stream()
                .filter(fu -> !closed.contains(fu.getAudienceResponseId()))
                .collect(Collectors.toList());
    }

    /**
     * Completed follow-ups — the mirror of {@link #myPending} for work already
     * closed, newest first.
     *
     * A row here is a follow-up, not a lead, and that is the point. A counsellor
     * who rings a lead today and books the next call for Friday closes one
     * follow-up and opens another; the lead belongs in this list for the call
     * that happened AND in Upcoming for the one that has not. Keying the list on
     * leads instead would show that lead as finished while Friday is still open.
     *
     * Paged, because unlike the pending set this one only grows.
     */
    public Page<LeadFollowupDto> completed(CustomUserDetails user, String instituteId,
                                           String counsellorUserId, String search,
                                           Timestamp closedFrom, Timestamp closedTo,
                                           String leadStatusCsv, String leadStatusExcludeCsv,
                                           Pageable pageable, boolean includeLeadDetail) {
        return completed(user, instituteId, counsellorUserId, search, closedFrom, closedTo,
                leadStatusCsv, leadStatusExcludeCsv, null, null, null, pageable, includeLeadDetail);
    }

    /**
     * Same, with the Follow-ups page's lead filters, which used to show on the
     * Completed tab without filtering it: Source / Label (audience ids), UTM
     * (resolved to response ids the way the leads query does it) and the
     * interest level recorded on the follow-up. All null = no filter.
     */
    public Page<LeadFollowupDto> completed(CustomUserDetails user, String instituteId,
                                           String counsellorUserId, String search,
                                           Timestamp closedFrom, Timestamp closedTo,
                                           String leadStatusCsv, String leadStatusExcludeCsv,
                                           String audienceIdsCsv,
                                           vacademy.io.admin_core_service.features.utm_attribution.dto.UtmListFilterDTO utmFilters,
                                           List<String> interestLevels,
                                           Pageable pageable, boolean includeLeadDetail) {
        // ORDER BY lives in the query, so the Pageable stays unsorted.
        Pageable paged = PageRequest.of(pageable.getPageNumber(), pageable.getPageSize());

        if (instituteId == null || instituteId.isBlank()) {
            return hydrate(leadFollowupRepository
                    .findByCreatedByAndIsClosedTrue(user.getUserId(), paged), includeLeadDetail);
        }

        // Empty CSV means "every counsellor in the institute" to the query.
        String createdByCsv = "";
        boolean scoped = counsellorScopeService.isScopedCaller(instituteId, user);
        if (counsellorUserId != null && !counsellorUserId.isBlank()) {
            if (scoped && !user.getUserId().equals(counsellorUserId)
                    && !counsellorScopeService.scopedCounsellorUserIds(instituteId, user.getUserId())
                            .contains(counsellorUserId)) {
                throw new VacademyException("You don't have access to this counsellor's follow-ups");
            }
            createdByCsv = counsellorUserId;
        } else if (scoped) {
            List<String> ids = counsellorScopeService.scopedCounsellorUserIds(
                    instituteId, user.getUserId());
            // An empty CSV means "no restriction" to the query, so a scoped caller
            // with no resolved reports must still be pinned to their own id rather
            // than widened to the institute.
            createdByCsv = ids == null || ids.isEmpty()
                    ? user.getUserId()
                    : String.join(",", ids);
        }

        // A lead whose name lives on its auth user has nothing in parent_name, so
        // searching audience_response alone would never find it. Same gap the leads
        // query closes, closed the same way.
        String searchUserIdsCsv = null;
        if (search != null && !search.isBlank()) {
            try {
                List<String> ids = authService.searchUserIdsByQuery(search, null);
                if (ids != null && !ids.isEmpty()) {
                    searchUserIdsCsv = String.join(",", ids);
                }
            } catch (Exception e) {
                log.warn("auth-service user search failed for completed follow-ups query='{}': {}",
                        search, e.getMessage());
            }
        }

        String matchedResponseIdsCsv = null;
        String excludedResponseIdsCsv = null;
        if (vacademy.io.admin_core_service.features.utm_attribution.service.UtmListFilterResolver
                .hasFilter(utmFilters)) {
            var utm = utmListFilterResolver.resolve(utmFilters,
                    vacademy.io.admin_core_service.features.common.service.CustomFieldListFilterResolver.Surface.RESPONSE,
                    instituteId);
            // A filter that matches nothing must return nothing — an empty CSV
            // would read as "no filter" to the query.
            if (utm.shortCircuitsToEmpty()) return Page.empty(paged);
            matchedResponseIdsCsv = utm.matchedIdsCsv();
            excludedResponseIdsCsv = utm.excludedIdsCsv();
        }

        return hydrate(leadFollowupRepository.findCompleted(
                instituteId, createdByCsv, closedFrom, closedTo,
                search == null || search.isBlank() ? null : search.trim(),
                searchUserIdsCsv, leadStatusCsv, leadStatusExcludeCsv,
                isBlank(audienceIdsCsv) ? null : audienceIdsCsv.trim(),
                matchedResponseIdsCsv, excludedResponseIdsCsv,
                joinInterestLevels(interestLevels), paged), includeLeadDetail);
    }

    /**
     * Interest levels for the CHR(31)-joined SQL parameter, or null for "no
     * filter". The labels are the institute's own, so they may hold commas.
     */
    public static String joinInterestLevels(List<String> levels) {
        if (levels == null) return null;
        List<String> clean = levels.stream()
                .filter(l -> l != null && !l.isBlank())
                .map(String::trim)
                .distinct()
                .toList();
        return clean.isEmpty() ? null : String.join("\u001F", clean);
    }

    /** Map a page of entities through the same lead-name hydration the lists use. */
    private Page<LeadFollowupDto> hydrate(Page<LeadFollowup> page) {
        List<LeadFollowupDto> dtos = withLeadInfo(page.getContent().stream()
                .map(LeadFollowupDto::from)
                .collect(Collectors.toList()));
        return new PageImpl<>(dtos, page.getPageable(), page.getTotalElements());
    }

    /**
     * hydrate(), optionally plus everything that makes a completed follow-up readable
     * on its own: email, source, pipeline status, interest tier, the counsellor who
     * owns the lead, and the lead's custom field answers.
     *
     * <p>The extra pass is at most six batched queries for the WHOLE page, never one
     * per row, and it is opt-in. The Completed table reads none of those fields and the
     * tile's count probe reads only totalElements, so making it unconditional would have
     * put all six on every page load to produce data nobody looked at.
     */
    private Page<LeadFollowupDto> hydrate(Page<LeadFollowup> page, boolean includeLeadDetail) {
        Page<LeadFollowupDto> hydrated = hydrate(page);
        if (includeLeadDetail) withLeadDetail(hydrated.getContent());
        return hydrated;
    }

    /**
     * Batch-hydrate lead display fields (name/mobile/userId) from
     * audience_response — the reminder popup and pending lists need a name,
     * not just an id. User-linked leads keep parent_name null and carry their
     * identity on the auth user instead, so a second auth-service batch fills
     * the gaps. Failures leave the fields null rather than failing the list.
     */
    private List<LeadFollowupDto> withLeadInfo(List<LeadFollowupDto> dtos) {
        List<String> responseIds = dtos.stream()
                .map(LeadFollowupDto::getAudienceResponseId)
                .filter(id -> id != null && !id.isBlank())
                .distinct()
                .collect(Collectors.toList());
        if (responseIds.isEmpty()) return dtos;
        Map<String, AudienceResponse> byId = audienceResponseRepository.findAllById(responseIds)
                .stream()
                .collect(Collectors.toMap(AudienceResponse::getId, r -> r, (a, b) -> a));
        dtos.forEach(d -> {
            AudienceResponse ar = byId.get(d.getAudienceResponseId());
            if (ar != null) {
                d.setLeadName(ar.getParentName());
                d.setLeadMobile(ar.getParentMobile());
                d.setLeadUserId(ar.getUserId());
            }
        });

        List<String> missingUserIds = dtos.stream()
                .filter(d -> isBlank(d.getLeadName()) || isBlank(d.getLeadMobile()))
                .map(LeadFollowupDto::getLeadUserId)
                .filter(id -> id != null && !id.isBlank())
                .distinct()
                .collect(Collectors.toList());
        if (!missingUserIds.isEmpty()) {
            try {
                Map<String, UserDTO> users = authService
                        .getUsersFromAuthServiceByUserIds(new ArrayList<>(missingUserIds))
                        .stream()
                        .filter(u -> u != null && u.getId() != null)
                        .collect(Collectors.toMap(UserDTO::getId, u -> u, (a, b) -> a));
                dtos.forEach(d -> {
                    UserDTO u = users.get(d.getLeadUserId());
                    if (u != null) {
                        if (isBlank(d.getLeadName())) d.setLeadName(u.getFullName());
                        if (isBlank(d.getLeadMobile())) d.setLeadMobile(u.getMobileNumber());
                    }
                });
            } catch (Exception e) {
                log.warn("[LeadFollowup] auth user hydration failed: {}", e.getMessage());
            }
        }
        return dtos;
    }

    /**
     * Second hydration pass: the lead fields a stand-alone row needs. Everything here
     * is decoration on the queue, so a failure logs and leaves the fields null rather
     * than failing the list.
     */
    private void withLeadDetail(List<LeadFollowupDto> dtos) {
        List<String> responseIds = dtos.stream()
                .map(LeadFollowupDto::getAudienceResponseId)
                .filter(id -> id != null && !id.isBlank())
                .distinct()
                .collect(Collectors.toList());
        if (responseIds.isEmpty()) return;

        try {
            Map<String, AudienceResponse> responseById = audienceResponseRepository.findAllById(responseIds)
                    .stream()
                    .collect(Collectors.toMap(AudienceResponse::getId, r -> r, (a, b) -> a));

            // Pipeline status: the lead's own lead_status_id resolved to its label, else
            // the profile's conversion_status mapped through the same catalog. Same
            // precedence the leads list uses, so the two never disagree.
            List<String> statusIds = responseById.values().stream()
                    .map(AudienceResponse::getLeadStatusId)
                    .filter(id -> id != null && !id.isBlank())
                    .distinct()
                    .collect(Collectors.toList());
            List<vacademy.io.admin_core_service.features.audience.entity.LeadStatus> statuses = statusIds.isEmpty()
                    ? List.of()
                    : leadStatusRepository.findAllById(statusIds);
            Map<String, String> statusIdToLabel = statuses.stream()
                    .collect(Collectors.toMap(
                            vacademy.io.admin_core_service.features.audience.entity.LeadStatus::getId,
                            vacademy.io.admin_core_service.features.audience.entity.LeadStatus::getLabel,
                            (a, b) -> a));

            String instituteId = dtos.stream()
                    .map(LeadFollowupDto::getInstituteId)
                    .filter(id -> id != null && !id.isBlank())
                    .findFirst().orElse(null);

            List<String> userIds = responseById.values().stream()
                    .map(AudienceResponse::getUserId)
                    .filter(id -> id != null && !id.isBlank())
                    .distinct()
                    .collect(Collectors.toList());
            Map<String, vacademy.io.admin_core_service.features.audience.entity.UserLeadProfile> profileByUserId =
                    (userIds.isEmpty() || instituteId == null)
                            ? Map.of()
                            : userLeadProfileRepository.findByUserIdInAndInstituteId(userIds, instituteId).stream()
                                    .collect(Collectors.toMap(
                                            vacademy.io.admin_core_service.features.audience.entity.UserLeadProfile::getUserId,
                                            p -> p,
                                            (a, b) -> a));

            List<vacademy.io.admin_core_service.features.common.entity.CustomFieldValues> cfValues =
                    customFieldValuesRepository.findBySourceTypeAndSourceIdIn("AUDIENCE_RESPONSE", responseIds);
            Map<String, List<vacademy.io.admin_core_service.features.common.entity.CustomFieldValues>> cfByResponseId =
                    cfValues.stream().collect(Collectors.groupingBy(
                            vacademy.io.admin_core_service.features.common.entity.CustomFieldValues::getSourceId));
            List<String> fieldIds = cfValues.stream()
                    .map(vacademy.io.admin_core_service.features.common.entity.CustomFieldValues::getCustomFieldId)
                    .distinct().collect(Collectors.toList());
            Map<String, vacademy.io.admin_core_service.features.common.entity.CustomFields> fieldDefsById =
                    fieldIds.isEmpty() ? Map.of()
                            : customFieldRepository.findAllById(fieldIds).stream()
                                    .collect(Collectors.toMap(
                                            vacademy.io.admin_core_service.features.common.entity.CustomFields::getId,
                                            f -> f, (a, b) -> a));

            // Audience names come from the institute's own list, which is a handful of
            // rows and already cached by every other caller here.
            Map<String, String> audienceNameById = instituteId == null
                    ? Map.of()
                    : audienceRepository.findByInstituteId(instituteId).stream()
                            .filter(a -> a.getId() != null && a.getCampaignName() != null)
                            .collect(Collectors.toMap(Audience::getId, Audience::getCampaignName,
                                    (a, b) -> a));

            for (LeadFollowupDto dto : dtos) {
                AudienceResponse ar = responseById.get(dto.getAudienceResponseId());
                if (ar == null) continue;
                dto.setLeadEmail(ar.getParentEmail());
                dto.setLeadSource(audienceNameById.get(ar.getAudienceId()));

                var profile = ar.getUserId() != null ? profileByUserId.get(ar.getUserId()) : null;
                if (ar.getLeadStatusId() != null && statusIdToLabel.containsKey(ar.getLeadStatusId())) {
                    dto.setLeadStatus(statusIdToLabel.get(ar.getLeadStatusId()));
                } else if (profile != null) {
                    dto.setLeadStatus(profile.getConversionStatus());
                }
                if (profile != null) {
                    dto.setLeadTier(profile.getLeadTier());
                    dto.setAssignedCounselorName(profile.getAssignedCounselorName());
                }

                var rowValues = cfByResponseId.get(ar.getId());
                if (rowValues == null || rowValues.isEmpty()) continue;
                Map<String, String> values = new java.util.HashMap<>();
                Map<String, Object> metadata = new java.util.HashMap<>();
                for (var cfv : rowValues) {
                    values.put(cfv.getCustomFieldId(), cfv.getValue());
                    var def = fieldDefsById.get(cfv.getCustomFieldId());
                    if (def != null) {
                        Map<String, String> meta = new java.util.HashMap<>();
                        meta.put("fieldName", def.getFieldName());
                        meta.put("fieldKey", def.getFieldKey());
                        meta.put("fieldType", def.getFieldType());
                        metadata.put(cfv.getCustomFieldId(), meta);
                    }
                }
                dto.setCustomFieldValues(values);
                dto.setCustomFieldMetadata(metadata);
            }
        } catch (Exception e) {
            log.warn("[LeadFollowup] lead detail hydration failed: {}", e.getMessage());
        }
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

    /**
     * Edit a follow-up.
     *
     * Open follow-ups keep the old path: no scope check, because the reminder's
     * snooze runs through here and a counsellor must still be able to snooze
     * their own follow-up after the lead moved to someone outside their scope.
     *
     * A closed follow-up stays read-only, exactly as before, unless the
     * institute turned on "Allow editing past follow-ups" (LEAD_SETTING
     * followUpFields.allowEditing). Then its note, closing note and interest
     * level can be corrected; the schedule never, since a closed follow-up
     * keeps the time it was due.
     */
    @Transactional
    public LeadFollowupDto update(String id, UpdateLeadFollowupRequest request, CustomUserDetails user) {
        LeadFollowup followup = findOrThrow(id);
        if (Boolean.TRUE.equals(followup.getIsClosed())) {
            editClosed(followup, request, user);
        } else {
            if (request.getScheduleTime() != null) followup.setScheduleTime(request.getScheduleTime());
            if (request.getContent() != null) followup.setContent(request.getContent());
            // An open follow-up has no closing note yet; closerReason is ignored here.
            applyInterestLevel(followup, request);
        }
        return LeadFollowupDto.from(leadFollowupRepository.save(followup));
    }

    private void editClosed(LeadFollowup followup, UpdateLeadFollowupRequest request, CustomUserDetails user) {
        if (request.getScheduleTime() != null
                || !leadFollowupSettingService.allowEditing(followup.getInstituteId())) {
            throw new VacademyException("Cannot update a closed follow-up");
        }
        // Editing a closed follow-up is the new path, so it gets the lead-scope
        // rule of listForLead; whoever created the follow-up may always fix it.
        if (user == null || !java.util.Objects.equals(user.getUserId(), followup.getCreatedBy())) {
            assertCanAccessLead(followup.getAudienceResponseId(), followup.getInstituteId(), user);
        }
        if (request.getContent() != null) followup.setContent(request.getContent());
        if (request.getCloserReason() != null) followup.setCloserReason(request.getCloserReason());
        applyInterestLevel(followup, request);
    }

    /** A blank interest level clears it. */
    private static void applyInterestLevel(LeadFollowup followup, UpdateLeadFollowupRequest request) {
        if (request.getInterestLevel() == null) return;
        followup.setInterestLevel(isBlank(request.getInterestLevel()) ? null : request.getInterestLevel());
    }

    /**
     * A hierarchy-scoped caller (COUNSELLOR role) may only touch a lead's
     * follow-ups when the lead's current assignee sits inside their scope
     * (unassigned leads stay open, same as the shared unassigned pool).
     */
    private void assertCanAccessLead(String audienceResponseId, String followupInstituteId,
                                     CustomUserDetails user) {
        if (user == null || user.getUserId() == null) return;
        String instituteId = resolveInstituteId(audienceResponseId, followupInstituteId);
        if (!counsellorScopeService.isScopedCaller(instituteId, user)) return;
        String leadUserId = audienceResponseRepository.findById(audienceResponseId)
                .map(AudienceResponse::getUserId)
                .orElse(null);
        String assignee = null;
        if (leadUserId != null) {
            try {
                assignee = workbenchLeadRepository.currentAssigneeForLead(instituteId, leadUserId);
            } catch (org.springframework.dao.EmptyResultDataAccessException e) {
                // No user_lead_profile row yet — treat as unassigned.
            }
        }
        if (assignee != null && !counsellorScopeService
                .scopedCounsellorUserIds(instituteId, user.getUserId()).contains(assignee)) {
            throw new VacademyException("You don't have access to this lead's follow-ups");
        }
    }

    @Transactional
    public LeadFollowupDto close(String id, CloseLeadFollowupRequest request, CustomUserDetails user) {
        LeadFollowup followup = findOrThrow(id);
        if (Boolean.TRUE.equals(followup.getIsClosed())) {
            throw new VacademyException("Follow-up is already closed");
        }

        String status = LeadFollowupStatus.COMPLETED.name();

        Timestamp now = new Timestamp(System.currentTimeMillis());
        followup.setStatus(status);
        followup.setIsClosed(true);
        followup.setCloserReason(request.getCloserReason());
        followup.setClosedBy(user.getUserId());
        followup.setClosedAt(now);

        LeadFollowup saved = leadFollowupRepository.save(followup);

        String studentUserId = audienceResponseRepository.findById(followup.getAudienceResponseId())
                .map(AudienceResponse::getUserId)
                .orElse(null);

        timelineEventService.logEvent(
                "LEAD", followup.getAudienceResponseId(),
                "FOLLOWUP_CLOSED",
                "ADMIN", user.getUserId(), user.getUsername(),
                "Follow-up " + status.toLowerCase(),
                request.getCloserReason(),
                Map.of("followupId", id, "status", status),
                studentUserId
        );

        liveActivityCounsellorRecorder.recordFollowup(
                followup.getInstituteId(), LiveActivityAction.FOLLOWUP_CLOSED, saved.getId(),
                user.getUserId(), user.getUserId(), null);

        return LeadFollowupDto.from(saved);
    }

    private LeadFollowup findOrThrow(String id) {
        return leadFollowupRepository.findById(id)
                .orElseThrow(() -> new VacademyException("Follow-up not found: " + id));
    }

    /** Derive instituteId from the audience response chain when the caller didn't supply it. */
    private String resolveInstituteId(String audienceResponseId, String providedInstituteId) {
        if (providedInstituteId != null && !providedInstituteId.isBlank()) {
            return providedInstituteId;
        }
        return audienceResponseRepository.findById(audienceResponseId)
                .map(AudienceResponse::getAudienceId)
                .flatMap(audienceRepository::findById)
                .map(Audience::getInstituteId)
                .orElseThrow(() -> new VacademyException("Cannot resolve institute for response: " + audienceResponseId));
    }
}
