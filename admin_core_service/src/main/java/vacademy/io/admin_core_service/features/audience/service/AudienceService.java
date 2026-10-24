package vacademy.io.admin_core_service.features.audience.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.util.CollectionUtils;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.audience.dto.*;
import vacademy.io.admin_core_service.features.audience.dto.CounsellorAllocationSettingDTO;
import vacademy.io.admin_core_service.features.audience.entity.Audience;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.enums.CampaignStatusEnum;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.audience.util.AudienceTagsUtil;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.entity.LeadScore;
import vacademy.io.admin_core_service.features.audience.entity.AudienceCommunication;
import vacademy.io.admin_core_service.features.audience.repository.AudienceCommunicationRepository;
import vacademy.io.admin_core_service.features.audience.repository.LeadFollowupRepository;
import vacademy.io.admin_core_service.features.audience.entity.LeadFollowup;
import vacademy.io.admin_core_service.features.notification.dto.UnifiedSendRequest;
import vacademy.io.admin_core_service.features.notification.dto.UnifiedSendResponse;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.notification.util.PhoneCountryUtil;
import vacademy.io.admin_core_service.features.audience.service.AudienceRoleAccessService;
import vacademy.io.admin_core_service.features.audience.service.AudienceRoleAccessService.EffectiveAccess;
import vacademy.io.admin_core_service.features.audience.service.AudienceRoleAccessService.Mode;
import vacademy.io.common.auth.dto.ParentWithChildDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.repository.UserRoleRepository;
import org.springframework.security.core.GrantedAuthority;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.admin_core_service.features.common.dto.InstituteCustomFieldDTO;
import vacademy.io.admin_core_service.features.common.entity.CustomFieldValues;
import vacademy.io.common.institute.entity.session.PackageSession;
import vacademy.io.admin_core_service.features.common.enums.CustomFieldTypeEnum;
import vacademy.io.admin_core_service.features.common.repository.CustomFieldRepository;
import vacademy.io.admin_core_service.features.common.repository.CustomFieldValuesRepository;
import vacademy.io.admin_core_service.features.common.repository.InstituteCustomFieldRepository;
import vacademy.io.admin_core_service.features.common.service.InstituteCustomFiledService;
import vacademy.io.admin_core_service.features.enquiry.dto.EnquiryDTO;
import vacademy.io.admin_core_service.features.enquiry.entity.Enquiry;
import vacademy.io.admin_core_service.features.enquiry.entity.LinkedUsers;
import vacademy.io.admin_core_service.features.enquiry.repository.EnquiryRepository;
import vacademy.io.admin_core_service.features.enquiry.repository.LinkedUsersRepository;
import vacademy.io.admin_core_service.features.notification.entity.NotificationEventConfig;
import vacademy.io.admin_core_service.features.notification.enums.NotificationEventType;
import vacademy.io.admin_core_service.features.notification.enums.NotificationSourceType;
import vacademy.io.admin_core_service.features.notification.enums.NotificationTemplateType;
import vacademy.io.admin_core_service.features.notification.repository.NotificationEventConfigRepository;
import vacademy.io.admin_core_service.features.notification.dto.NotificationTemplateVariables;
import vacademy.io.admin_core_service.features.notification_service.service.SendUniqueLinkService;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.admin_core_service.features.common.entity.CustomFields;
import vacademy.io.admin_core_service.features.common.entity.InstituteCustomField;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.admin_core_service.features.workflow.enums.WorkflowTriggerEvent;
import vacademy.io.admin_core_service.features.audience.enums.CustomFieldValueSourceType;
import vacademy.io.admin_core_service.features.common.service.CustomFieldValueService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.notification.dto.GenericEmailRequest;
import vacademy.io.admin_core_service.features.audience.enums.AudienceStatusEnum;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.ResourceNotFoundException;
import vacademy.io.common.exceptions.VacademyException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.JsonNode;

import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.*;
import java.util.Random;
import java.util.function.Function;
import java.util.stream.Collectors;
import vacademy.io.admin_core_service.features.timeline.enums.LeadJourneyActionType;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.admin_core_service.features.live_activity.core.LiveActivityLeadRecorder;

/**
 * Service for Audience Management
 * Follows the same pattern as EnrollInviteService
 */
@Service
public class AudienceService {

    private static final Logger logger = LoggerFactory.getLogger(AudienceService.class);

    @Autowired
    private AudienceRepository audienceRepository;

    // Repositories only (never CounselorPoolService) — the pool service already
    // depends on this one, so injecting it back would close a bean cycle.
    @Autowired
    private vacademy.io.admin_core_service.features.counselor_pool.repository.CounselorPoolAudienceRepository counselorPoolAudienceRepository;

    @Autowired
    private vacademy.io.admin_core_service.features.counselor_pool.repository.CounselorPoolRepository counselorPoolRepository;


    @Autowired
    private LiveActivityLeadRecorder liveActivityLeadRecorder;

    @Autowired
    private LeadTierService leadTierService;

    @Autowired
    private AudienceRoleAccessService audienceRoleAccessService;

    @Autowired
    private AudienceResponseRepository audienceResponseRepository;

    @Autowired
    private CustomFieldValueService customFieldValueService;

    @Autowired
    private AudienceCommunicationRepository audienceCommunicationRepository;

    @Autowired
    private InstituteCustomFiledService instituteCustomFiledService;

    @Autowired
    private CustomFieldValuesRepository customFieldValuesRepository;

    @Autowired
    private vacademy.io.admin_core_service.features.common.service.CustomFieldListFilterResolver customFieldListFilterResolver;

    @Autowired
    private vacademy.io.admin_core_service.features.utm_attribution.service.UtmListFilterResolver utmListFilterResolver;

    @Autowired
    private vacademy.io.admin_core_service.features.utm_attribution.repository.UtmAttributionRepository utmAttributionRepository;

    @Autowired
    private vacademy.io.admin_core_service.features.utm_attribution.service.UtmAttributionService utmAttributionService;

    @Autowired
    private AuthService authService;

    @Autowired
    private CustomFieldRepository customFieldRepository;

    @Autowired
    private NotificationEventConfigRepository notificationEventConfigRepository;

    @Autowired
    private SendUniqueLinkService sendUniqueLinkService;

    @Autowired
    private NotificationService notificationService;

    @Autowired
    private WorkflowTriggerService workflowTriggerService;

    @Autowired
    private LeadMoveWorkflowAsyncHelper leadMoveWorkflowAsyncHelper;


    /** Resolves caller + user-to-user descendants in the leads team. */
    @Autowired
    private vacademy.io.admin_core_service.features.counsellor_workbench.service.CounsellorScopeService counsellorScopeService;

    /** Resolves a sub-org admin's lead scope (their sub-org's members) — see getLeads. */
    @Autowired
    private vacademy.io.admin_core_service.features.suborg.service.SubOrgLeadScopeService subOrgLeadScopeService;

    /** Caller lead visibility for getLeads — shared with the lead-scope endpoint. */
    @Autowired
    private LeadVisibilityResolver leadVisibilityResolver;

    @Autowired
    private InstituteCustomFieldRepository instituteCustomFieldRepository;

    @Autowired
    private vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository packageSessionRepository;

    @Autowired
    private EnquiryRepository enquiryRepository;

    @Autowired
    private LinkedUsersRepository linkedUsersRepository;

    @Autowired
    private InstituteRepository instituteRepository;

    @Autowired
    private UserRoleRepository userRoleRepository;

    @Autowired
    private vacademy.io.admin_core_service.features.admission.service.AdmissionPipelineService admissionPipelineService;

    @Autowired
    private LeadDistributionService leadDistributionService;

    @Autowired
    private LeadScoringService leadScoringService;

    @Autowired
    private LeadDeduplicationService leadDeduplicationService;

    @Autowired
    private vacademy.io.admin_core_service.features.timeline.service.TimelineEventService timelineEventService;

    @Autowired
    private vacademy.io.admin_core_service.features.audience.repository.LeadScoreRepository leadScoreRepository;

    @Autowired
    private vacademy.io.admin_core_service.features.audience.repository.UserLeadProfileRepository userLeadProfileRepository;

    @Autowired
    private vacademy.io.admin_core_service.features.audience.repository.LeadStatusRepository leadStatusRepository;

    @Autowired
    private vacademy.io.admin_core_service.features.counselor_pool.service.CounselorAssignmentService counselorAssignmentService;

    @Autowired
    private UserLeadProfileService userLeadProfileService;

    /** Shared bell-alert sender — same notification every assignment path uses. */
    @Autowired
    private LeadAssignmentNotifier leadAssignmentNotifier;

    @Autowired
    private vacademy.io.admin_core_service.features.audience.service.LeadSlaConfigService leadSlaConfigService;

    @Autowired
    private LeadFollowupRepository leadFollowupRepository;

    /** Synthesizes / detects non-deliverable placeholder emails for emailless webhook leads. */
    @Autowired
    private PlaceholderEmailService placeholderEmailService;

    /**
     * Recipient count above which an audience send is queued as a durable batch on
     * notification-service instead of sent inline. Inline sends loop one provider
     * call per recipient; past this size they risk exceeding InternalClientUtils'
     * 30s read timeout (spurious 510 while delivery continues server-side).
     */
    private static final int ASYNC_SEND_THRESHOLD = 10;

    public List<String> getConvertedUserIdsByCampaign(String audienceId, String instituteId) {
        logger.info("Getting converted user IDs for campaign: {} (institute: {})", audienceId, instituteId);

        // Validate audience exists and belongs to institute (security check)
        audienceRepository.findByIdAndInstituteId(audienceId, instituteId)
                .orElseThrow(() -> new VacademyException(
                        "Campaign not found or doesn't belong to institute: " + audienceId));

        // Fetch all converted leads (user_id IS NOT NULL)
        List<AudienceResponse> convertedLeads = audienceResponseRepository.findConvertedLeads(audienceId);

        // Extract user IDs
        List<String> userIds = convertedLeads.stream()
                .map(AudienceResponse::getUserId)
                .filter(userId -> userId != null && !userId.isBlank())
                .distinct()
                .collect(Collectors.toList());

        logger.info("Found {} converted users for campaign: {}", userIds.size(), audienceId);
        return userIds;
    }

    /**
     * Persist the full set of custom fields the admin selected for this audience
     * campaign. Delegates to the unified per-feature sync — see
     * {@link vacademy.io.admin_core_service.features.common.service.InstituteCustomFiledService#syncFeatureCustomFields}.
     *
     * The frontend always sends the complete picked list (defaults pre-selected
     * from the institute catalog + ad-hoc fields the admin added in the dialog).
     * Anything not present here is soft-deleted; anything previously deleted is
     * reactivated by id (so a re-tick brings the existing answers back). The
     * institute_id is read from the audience entity itself, so the caller does
     * not need to pass it.
     */
    private void saveInstituteCustomFields(String audienceId, String instituteId,
            List<InstituteCustomFieldDTO> dtos) {
        if (!StringUtils.hasText(audienceId) || !StringUtils.hasText(instituteId)) {
            return;
        }
        instituteCustomFiledService.syncFeatureCustomFields(
                instituteId,
                CustomFieldTypeEnum.AUDIENCE_FORM.name(),
                audienceId,
                dtos);
        if (dtos != null) {
            logger.info("Synced {} custom field selections for audience {}", dtos.size(), audienceId);
        }
    }

    /**
     * Create a new audience campaign with custom fields
     * Pattern: Same as EnrollInviteService.createEnrollInvite()
     */
    @Transactional
    public String createCampaign(AudienceDTO audienceDTO) {
        logger.info("Creating audience campaign: {}", audienceDTO.getCampaignName());

        // Validation
        if (audienceDTO == null) {
            throw new VacademyException("Audience payload cannot be null");
        }
        if (!StringUtils.hasText(audienceDTO.getInstituteId())) {
            throw new VacademyException("Institute ID is required");
        }
        if (!StringUtils.hasText(audienceDTO.getCampaignName())) {
            throw new VacademyException("Campaign name is required");
        }

        // Set default values
        if (!StringUtils.hasText(audienceDTO.getStatus())) {
            audienceDTO.setStatus("ACTIVE");
        }

        assertCampaignNameFree(audienceDTO.getInstituteId(), audienceDTO.getCampaignName(), null);

        // 1. Create and save audience entity
        Audience audienceToSave = new Audience(audienceDTO);
        final Audience savedAudience = saveCampaign(audienceToSave);

        logger.info("Saved audience with ID: {}", savedAudience.getId());

        // 2. Link custom fields - admin's full picked list (defaults + ad-hoc).
        saveInstituteCustomFields(savedAudience.getId(), savedAudience.getInstituteId(),
                audienceDTO.getInstituteCustomFields());

        return savedAudience.getId();
    }

    /**
     * Update an existing audience campaign
     */
    @Transactional
    public String updateCampaign(String audienceId, AudienceDTO audienceDTO) {
        logger.info("Updating audience campaign: {}", audienceId);

        Audience audience = audienceRepository.findById(audienceId)
                .orElseThrow(() -> new VacademyException("Audience not found with ID: " + audienceId));

        // Security: Ensure institute ID matches
        if (!audience.getInstituteId().equals(audienceDTO.getInstituteId())) {
            throw new VacademyException("Institute ID mismatch");
        }

        // Update fields
        if (StringUtils.hasText(audienceDTO.getCampaignName())) {
            if (!audienceDTO.getCampaignName().equals(audience.getCampaignName())) {
                assertCampaignNameFree(audience.getInstituteId(), audienceDTO.getCampaignName(), audienceId);
            }
            audience.setCampaignName(audienceDTO.getCampaignName());
        }
        if (StringUtils.hasText(audienceDTO.getDescription())) {
            audience.setDescription(audienceDTO.getDescription());
        }
        if (StringUtils.hasText(audienceDTO.getStatus())) {
            audience.setStatus(audienceDTO.getStatus());
        }
        if (StringUtils.hasText(audienceDTO.getCampaignType())) {
            audience.setCampaignType(audienceDTO.getCampaignType());
        }
        if (audienceDTO.getStartDateLocal() != null) {
            audience.setStartDate(audienceDTO.getStartDateLocal());
        }
        if (audienceDTO.getEndDateLocal() != null) {
            audience.setEndDate(audienceDTO.getEndDateLocal());
        }
        if (StringUtils.hasText(audienceDTO.getSessionId())) {
            audience.setSessionId(audienceDTO.getSessionId());
        }
        if (StringUtils.hasText(audienceDTO.getSettingJson())) {
            audience.setSettingJson(audienceDTO.getSettingJson());
        }
        // Allow explicit null to clear the floor; only update when the field is present
        // in the request
        audience.setDefaultInitialScore(audienceDTO.getDefaultInitialScore());
        // Sub-org link: set unconditionally so the edit form can set, change, or clear it
        // (this PUT is only called from the full campaign edit form, which sends the whole DTO).
        audience.setSubOrgId(audienceDTO.getSubOrgId());
        // Team notification / respondent settings and objective were previously NOT copied
        // here, so any campaign that was *edited* (rather than freshly created) silently
        // dropped these fields — most visibly to_notify, which left the new-lead admin
        // notification with no recipients and never fired. Set unconditionally so the edit
        // form can add, change, or clear them (same single-caller reasoning as subOrgId).
        audience.setToNotify(audienceDTO.getToNotify());
        audience.setSendRespondentEmail(audienceDTO.getSendRespondentEmail());
        audience.setCampaignObjective(audienceDTO.getCampaignObjective());
        // Tags: null = leave the saved tags alone (older clients do not send them); an empty
        // map clears them; anything else replaces them after validation.
        if (audienceDTO.getTags() != null) {
            audience.setTagsJson(AudienceTagsUtil.toJson(AudienceTagsUtil.normalize(audienceDTO.getTags())));
        }

        Audience updated = saveCampaign(audience);

        // Update custom fields — admin's full picked list, including any toggled-off
        // entries which will be soft-deleted by the unified sync.
        saveInstituteCustomFields(updated.getId(), updated.getInstituteId(),
                audienceDTO.getInstituteCustomFields());

        logger.info("Updated audience: {}", updated.getId());
        return updated.getId();
    }

    /**
     * Campaign names are unique per institute (unique_institute_campaign), and a deleted
     * campaign keeps its row and name. Without this check a clash reached the admin as the
     * raw Postgres batch error. Exact match, like the constraint: "Testing" and "testing"
     * may coexist.
     */
    private void assertCampaignNameFree(String instituteId, String campaignName, String excludeAudienceId) {
        audienceRepository.findByInstituteIdAndCampaignNameIgnoreCase(instituteId, campaignName).stream()
                .filter(existing -> campaignName.equals(existing.getCampaignName()))
                .filter(existing -> !existing.getId().equals(excludeAudienceId))
                .findFirst()
                .ifPresent(existing -> {
                    throw new ConflictException(duplicateCampaignNameMessage(campaignName,
                            CampaignStatusEnum.DELETED.name().equals(existing.getStatus())));
                });
    }

    /**
     * Flushes so a name clash the check above could not see (a double-clicked submit, two
     * admins at once) is caught here and answered like the check, not as a 511 at commit.
     */
    private Audience saveCampaign(Audience audience) {
        try {
            return audienceRepository.saveAndFlush(audience);
        } catch (DataIntegrityViolationException e) {
            if (String.valueOf(e.getMessage()).contains("unique_institute_campaign")) {
                throw new ConflictException(duplicateCampaignNameMessage(audience.getCampaignName(), false));
            }
            throw e;
        }
    }

    private static String duplicateCampaignNameMessage(String campaignName, boolean deleted) {
        return deleted
                ? "A deleted campaign is still using the name \"" + campaignName
                        + "\". Please choose a different name."
                : "A campaign named \"" + campaignName + "\" already exists. Please choose a different name.";
    }

    /**
     * Get campaign by ID
     */
    public AudienceDTO getCampaignById(String audienceId, String instituteId) {
        Audience audience = audienceRepository.findByIdAndInstituteId(audienceId, instituteId)
                .orElseThrow(() -> new VacademyException("Audience not found"));

        // Get custom fields
        List<InstituteCustomFieldDTO> customFields = instituteCustomFiledService.findCustomFieldsAsJson(
                instituteId,
                CustomFieldTypeEnum.AUDIENCE_FORM.name(),
                audienceId);

        return AudienceDTO.builder()
                .id(audience.getId())
                .instituteId(audience.getInstituteId())
                .campaignName(audience.getCampaignName())
                .campaignType(audience.getCampaignType())
                .description(audience.getDescription())
                .campaignObjective(audience.getCampaignObjective())
                .startDateLocal(audience.getStartDate())
                .endDateLocal(audience.getEndDate())
                .status(audience.getStatus())
                .jsonWebMetadata(audience.getJsonWebMetadata())
                .toNotify(audience.getToNotify())
                .sendRespondentEmail(audience.getSendRespondentEmail())
                .sessionId(audience.getSessionId())
                .settingJson(audience.getSettingJson())
                .defaultInitialScore(audience.getDefaultInitialScore())
                .subOrgId(audience.getSubOrgId())
                .createdByUserId(audience.getCreatedByUserId())
                .instituteCustomFields(customFields)
                .build();
    }

    /**
     * Get all campaigns for an institute with filters.
     *
     * <p>
     * Caller-level access scoping mirrors {@link #getLeads}: a user whose
     * effective access is {@code AUDIENCE_LIST} only sees the campaigns they
     * were granted; admins / root see everything. {@code COUNSELOR} mode does
     * not narrow the campaign list (counselors still see all campaign cards but
     * only their own responses inside).
     */
    @Transactional(readOnly = true)
    public Page<AudienceDTO> getCampaigns(AudienceFilterDTO filterDTO, CustomUserDetails user) {
        Pageable pageable = PageRequest.of(
                filterDTO.getPage() != null ? filterDTO.getPage() : 0,
                filterDTO.getSize() != null ? filterDTO.getSize() : 20,
                Sort.by(Sort.Direction.DESC, "createdAt"));

        EffectiveAccess access = audienceRoleAccessService.resolveForCaller(
                user, filterDTO.getInstituteId());

        // JPQL `IN :collection` requires a non-null binding even when the
        // predicate is gated by the boolean flag — pass empty list as default.
        List<String> allowedAudienceIds = Collections.emptyList();
        boolean restrictByList = false;
        if (access.getMode() == Mode.AUDIENCE_LIST) {
            List<String> allowed = access.getAllowedAudienceIds();
            if (allowed == null || allowed.isEmpty()) {
                // Admin granted no lists → user sees no campaigns.
                return Page.empty(pageable);
            }
            allowedAudienceIds = allowed;
            restrictByList = true;
        }

        Page<Audience> audiences = audienceRepository.findAudiencesWithFilters(
                filterDTO.getInstituteId(),
                filterDTO.getStatus(),
                filterDTO.getCampaignType(),
                filterDTO.getCampaignName(),
                filterDTO.getSubOrgId(),
                filterDTO.getStartDateFromLocal(),
                filterDTO.getStartDateFromLocal() != null,
                filterDTO.getStartDateToLocal(),
                filterDTO.getStartDateToLocal() != null,
                allowedAudienceIds,
                restrictByList,
                pageable);

        Map<String, vacademy.io.admin_core_service.features.counselor_pool.entity.CounselorPool> poolByAudienceId =
                resolvePoolsForPage(audiences.getContent());

        return audiences.map(audience -> AudienceDTO.builder()
                .id(audience.getId())
                .instituteId(audience.getInstituteId())
                .campaignName(audience.getCampaignName())
                .campaignType(audience.getCampaignType())
                .description(audience.getDescription())
                .campaignObjective(audience.getCampaignObjective())
                .startDateLocal(audience.getStartDate())
                .endDateLocal(audience.getEndDate())
                .status(audience.getStatus())
                .jsonWebMetadata(audience.getJsonWebMetadata())
                .toNotify(audience.getToNotify())
                .sendRespondentEmail(audience.getSendRespondentEmail())
                .sessionId(audience.getSessionId())
                .settingJson(audience.getSettingJson())
                .defaultInitialScore(audience.getDefaultInitialScore())
                .subOrgId(audience.getSubOrgId())
                .createdByUserId(audience.getCreatedByUserId())
                .poolId(poolByAudienceId.containsKey(audience.getId())
                        ? poolByAudienceId.get(audience.getId()).getId() : null)
                .poolName(poolByAudienceId.containsKey(audience.getId())
                        ? poolByAudienceId.get(audience.getId()).getName() : null)
                .tags(AudienceTagsUtil.fromJson(audience.getTagsJson()))
                .build());
    }

    // ── Lead list tags ────────────────────────────────────────────────────

    /**
     * The saved tags of one list. The list must belong to {@code instituteId}; a caller whose
     * campaign access is limited to a set of lists (AUDIENCE_LIST mode) may only read those.
     */
    @Transactional(readOnly = true)
    public AudienceTagsResponseDTO getCampaignTags(String audienceId, String instituteId, CustomUserDetails user) {
        Audience audience = findTaggableAudience(audienceId, instituteId, user);
        return new AudienceTagsResponseDTO(audience.getId(), AudienceTagsUtil.fromJson(audience.getTagsJson()));
    }

    /**
     * Replaces a list's tags with {@code tags} (validated and canonicalised by
     * {@link AudienceTagsUtil}); a null or empty map clears them. Same list checks as
     * {@link #getCampaignTags}. Only the tags column is written.
     */
    @Transactional
    public AudienceTagsResponseDTO setCampaignTags(String audienceId, String instituteId,
                                                   Map<String, String> tags, CustomUserDetails user) {
        SortedMap<String, String> normalized = AudienceTagsUtil.normalize(tags);
        Audience audience = findTaggableAudience(audienceId, instituteId, user);
        audienceRepository.updateTagsJson(audience.getId(), instituteId, AudienceTagsUtil.toJson(normalized));
        return new AudienceTagsResponseDTO(audience.getId(), normalized);
    }

    /**
     * Tag keys in use across the institute's lists, each with its distinct values and the
     * number of lists carrying that value — for tag autocomplete. Keys are sorted
     * alphabetically, values by list count (most used first) then alphabetically. Scoped like
     * {@link #getCampaigns}: an AUDIENCE_LIST caller only sees the tags of lists they can see.
     */
    @Transactional(readOnly = true)
    public List<CampaignTagSummaryDTO> getCampaignTagSummary(String instituteId, CustomUserDetails user) {
        EffectiveAccess access = audienceRoleAccessService.resolveForCaller(user, instituteId);
        Set<String> allowedIds = null;
        if (access.getMode() == Mode.AUDIENCE_LIST) {
            List<String> allowed = access.getAllowedAudienceIds();
            if (allowed == null || allowed.isEmpty()) {
                return Collections.emptyList();
            }
            allowedIds = new HashSet<>(allowed);
        }

        Map<String, Map<String, Long>> countsByKey = new TreeMap<>();
        for (Object[] row : audienceRepository.findIdAndTagsJsonByInstituteId(instituteId)) {
            String id = (String) row[0];
            if (allowedIds != null && !allowedIds.contains(id)) {
                continue;
            }
            AudienceTagsUtil.fromJson((String) row[1]).forEach((key, value) ->
                    countsByKey.computeIfAbsent(key, k -> new HashMap<>()).merge(value, 1L, Long::sum));
        }

        List<CampaignTagSummaryDTO> summary = new ArrayList<>();
        countsByKey.forEach((key, counts) -> {
            List<CampaignTagSummaryDTO.ValueCount> values = counts.entrySet().stream()
                    .sorted(Map.Entry.<String, Long>comparingByValue().reversed()
                            .thenComparing(Map.Entry.comparingByKey(String.CASE_INSENSITIVE_ORDER)))
                    .map(e -> new CampaignTagSummaryDTO.ValueCount(e.getKey(), e.getValue()))
                    .collect(Collectors.toList());
            summary.add(new CampaignTagSummaryDTO(key, values));
        });
        return summary;
    }

    private Audience findTaggableAudience(String audienceId, String instituteId, CustomUserDetails user) {
        Audience audience = audienceRepository.findByIdAndInstituteId(audienceId, instituteId)
                .filter(a -> !CampaignStatusEnum.DELETED.name().equals(a.getStatus()))
                .orElseThrow(() -> new ResourceNotFoundException("Lead list not found"));
        EffectiveAccess access = audienceRoleAccessService.resolveForCaller(user, instituteId);
        if (access.getMode() == Mode.AUDIENCE_LIST) {
            List<String> allowed = access.getAllowedAudienceIds();
            if (allowed == null || !allowed.contains(audience.getId())) {
                throw new ForbiddenException("You do not have access to this lead list");
            }
        }
        return audience;
    }

    /**
     * Which counsellor pool (if any) each audience on this page feeds, so the lead-list
     * header can say so without the admin going to Pools to find out.
     *
     * <p>Two batched queries for the whole page rather than a lookup per row: the campaigns
     * grid renders 20+ lists at a time and a per-row resolve would be a 40-query N+1.</p>
     *
     * <p>Best-effort — a pool-lookup failure returns an empty map and the lists simply render
     * without the pool chip, rather than failing the campaigns page.</p>
     */
    private Map<String, vacademy.io.admin_core_service.features.counselor_pool.entity.CounselorPool>
            resolvePoolsForPage(List<Audience> audiences) {
        if (audiences == null || audiences.isEmpty()) return Collections.emptyMap();
        try {
            List<String> audienceIds = audiences.stream()
                    .map(Audience::getId)
                    .filter(Objects::nonNull)
                    .distinct()
                    .collect(Collectors.toList());
            if (audienceIds.isEmpty()) return Collections.emptyMap();

            List<vacademy.io.admin_core_service.features.counselor_pool.entity.CounselorPoolAudience> links =
                    counselorPoolAudienceRepository.findByAudienceIdIn(audienceIds);
            if (links.isEmpty()) return Collections.emptyMap();

            Map<String, vacademy.io.admin_core_service.features.counselor_pool.entity.CounselorPool> poolsById =
                    counselorPoolRepository.findAllById(links.stream()
                            .map(vacademy.io.admin_core_service.features.counselor_pool.entity.CounselorPoolAudience::getPoolId)
                            .filter(Objects::nonNull)
                            .distinct()
                            .collect(Collectors.toList()))
                    .stream()
                    .collect(Collectors.toMap(
                            vacademy.io.admin_core_service.features.counselor_pool.entity.CounselorPool::getId,
                            Function.identity(), (a, b) -> a));

            Map<String, vacademy.io.admin_core_service.features.counselor_pool.entity.CounselorPool> byAudience =
                    new HashMap<>();
            for (var link : links) {
                var pool = poolsById.get(link.getPoolId());
                if (pool != null) byAudience.put(link.getAudienceId(), pool);
            }
            return byAudience;
        } catch (Exception ex) {
            logger.warn("Failed to resolve counsellor pools for campaigns page: {}", ex.getMessage());
            return Collections.emptyMap();
        }
    }

    /** Campaign name used for the auto-provisioned per-institute catalogue lead audience. */
    private static final String CATALOGUE_AUDIENCE_NAME = "Course Catalogue Leads";

    /**
     * Submit a lead captured from the public course catalogue / course-details
     * "Get Started" form. The caller only knows the institute (not an audienceId),
     * so we resolve — or lazily create — a single per-institute "Course Catalogue
     * Leads" audience and then route through the normal v2 lead pipeline. This is
     * what makes catalogue leads appear in Audience Manager → Recent Leads (they
     * previously landed in student_session_institute_group_mapping, which no lead
     * screen reads).
     *
     * NOTE: deliberately NOT @Transactional. submitLeadV2 runs several "non-blocking"
     * @Transactional sub-calls (lead score, counsellor assignment, workflow trigger)
     * inside its own try/catch. On a freshly auto-provisioned audience (no pool /
     * scoring / field config) one of those can throw; the catch swallows it, but the
     * throw has already marked any *surrounding* transaction rollback-only — so an
     * outer @Transactional here would fail the commit with "Transaction silently
     * rolled back" and lose the lead. Without an outer transaction, the audience_
     * response save commits on its own and a failing sub-op only rolls back its own
     * tiny transaction. (submitLeadV2's own @Transactional is bypassed here anyway,
     * since this is a same-bean self-invocation.)
     */
    public String submitCatalogueLead(CatalogueLeadRequestDTO dto) {
        return submitCatalogueLead(dto, false);
    }

    /**
     * {@link #submitCatalogueLead(CatalogueLeadRequestDTO)}, optionally accepting a lead with a
     * phone number and no email (the Site Assistant contact card, where a visitor often leaves
     * only a number). Such a lead's auth user is keyed on the same deterministic, non-deliverable
     * placeholder that Meta/Google webhook leads and phone-only bulk rows already use
     * ({@link PlaceholderEmailService}, suppressed by every send path); the lead row itself keeps
     * {@code parent_email} NULL and gets no email custom field, exactly like an inbound-call lead.
     * The public catalogue form keeps requiring an email (allowPhoneOnly=false).
     */
    public String submitCatalogueLead(CatalogueLeadRequestDTO dto, boolean allowPhoneOnly) {
        if (dto == null || !StringUtils.hasText(dto.getInstituteId())) {
            throw new VacademyException("instituteId is required");
        }
        // submitLeadV2 builds the lead's user from the email; without an email it
        // saves nothing and returns an error sentinel. The catalogue form already
        // makes email mandatory, so require it here too rather than silently drop.
        boolean hasEmail = StringUtils.hasText(dto.getEmail());
        if (!hasEmail && !(allowPhoneOnly && StringUtils.hasText(dto.getMobileNumber()))) {
            throw new VacademyException(allowPhoneOnly
                    ? "An email or a phone number is required to capture a lead"
                    : "Email is required to capture a lead");
        }

        // Destination routing: a website capture point (contact form, newsletter,
        // popup registration) may name the campaign its leads belong to. Only an
        // ACTIVE audience of the SAME institute is honoured; anything else falls
        // back to the auto list — a stale audienceId on a published page must
        // degrade to "lead lands in the default list", never to a lost lead.
        Audience audience = null;
        if (StringUtils.hasText(dto.getAudienceId())) {
            audience = audienceRepository.findById(dto.getAudienceId())
                    .filter(a -> dto.getInstituteId().equals(a.getInstituteId()))
                    .filter(a -> "ACTIVE".equals(a.getStatus()))
                    .orElse(null);
            if (audience == null) {
                logger.warn("Catalogue lead: audienceId {} invalid/inactive for institute {} — using auto list",
                        dto.getAudienceId(), dto.getInstituteId());
            }
        }
        if (audience == null) {
            audience = getOrCreateCatalogueAudience(dto.getInstituteId());
        }

        UserDTO userDTO = UserDTO.builder()
                .fullName(dto.getFullName())
                .email(hasEmail ? dto.getEmail()
                        : placeholderEmailService.synthesize(dto.getFullName(), dto.getMobileNumber(), null))
                .mobileNumber(dto.getMobileNumber())
                .build();

        // Carry the visible lead fields as custom field values too, so the
        // Recent Leads table shows name/email/phone even before the admin
        // defines a custom-field schema for the auto-created audience.
        Map<String, String> customFieldValues = dto.getCustomFieldValues() != null
                ? new HashMap<>(dto.getCustomFieldValues())
                : new HashMap<>();
        if (StringUtils.hasText(dto.getFullName())) {
            customFieldValues.putIfAbsent("full_name", dto.getFullName());
        }
        if (StringUtils.hasText(dto.getEmail())) {
            customFieldValues.putIfAbsent("email", dto.getEmail());
        }
        if (StringUtils.hasText(dto.getMobileNumber())) {
            customFieldValues.putIfAbsent("phone", dto.getMobileNumber());
        }

        final String sourceId = StringUtils.hasText(dto.getSourceId()) ? dto.getSourceId() : "course-catalogue";

        // Create the lead directly rather than via submitLeadV2: that method is built
        // for fully-configured campaigns and its email/workflow/score machinery throws
        // on a freshly auto-provisioned audience (no pool / scoring / field schema),
        // getting swallowed into a generic sentinel. Here the two essential steps
        // (user + audience_response) surface real errors, and the enrichment steps are
        // best-effort so a lead is never lost over optional config.

        // Institute-configured dedup (LEAD_SETTING.data.dedup) — checked before creating the
        // auth user so a REJECTed lead never creates an orphan account. ALLOW_REASSIGN lets
        // the lead through and carries the repeat-lead counsellor/status settings to apply below.
        LeadDedupSettingService.RepeatLeadSettings repeatLeadSettings = null;
        java.util.Optional<LeadDeduplicationService.DuplicateMatch> dupMatch = leadDeduplicationService
                .checkDuplicate(dto.getInstituteId(), audience.getId(), dto.getEmail(), dto.getMobileNumber());
        if (dupMatch.isPresent()) {
            if (dupMatch.get().action() == LeadDedupSettingService.DedupAction.REJECT) {
                return dupMatch.get().rejectionMessage();
            }
            repeatLeadSettings = dupMatch.get().repeatLeadSettings();
        }

        // 1. Create/fetch the lead's user in auth_service (no credentials email).
        UserDTO createdUser = authService.createUserFromAuthService(userDTO, audience.getInstituteId(), false);
        String userId = createdUser != null ? createdUser.getId() : null;

        // 2. Dedup per person per campaign (same behaviour as submitLeadV2).
        if (StringUtils.hasText(userId)
                && audienceResponseRepository.existsByAudienceIdAndUserId(audience.getId(), userId)) {
            // Their lead may have been soft-deleted — revive it rather than leaving them
            // permanently invisible. Return either way: this is still a duplicate submission.
            reactivateSoftDeletedLeads(audience.getId(), userId);
            return "You have already submitted your response for this campaign";
        }

        // 3. Persist the lead — this is what Audience Manager → Recent Leads reads.
        AudienceResponse savedResponse = audienceResponseRepository.save(AudienceResponse.builder()
                .audienceId(audience.getId())
                .sourceType(StringUtils.hasText(dto.getSourceType()) ? dto.getSourceType() : "COURSE_CATALOGUE")
                .sourceId(sourceId)
                .userId(userId)
                .parentEmail(dto.getEmail())
                .parentMobile(truncateForParentMobileColumn(dto.getMobileNumber()))
                .workflowActivateDayAt(calculateWorkflowActivateDayAt(audience))
                .initialScore(audience.getDefaultInitialScore())
                .build());

        // 4. Enrichment — best-effort; never block the saved lead.
        try {
            logLeadSubmitted(savedResponse);
        } catch (Exception e) {
            logger.error("Catalogue lead {}: logLeadSubmitted failed: {}", savedResponse.getId(), e.getMessage());
        }
        try {
            if (!CollectionUtils.isEmpty(customFieldValues)) {
                saveCustomFieldValues(savedResponse.getId(), customFieldValues, audience.getInstituteId(),
                        audience.getId());
            }
        } catch (Exception e) {
            logger.error("Catalogue lead {}: saveCustomFieldValues failed: {}", savedResponse.getId(), e.getMessage());
        }
        try {
            leadScoringService.calculateAndSaveScore(savedResponse.getId(), savedResponse.getAudienceId(),
                    audience.getInstituteId(), savedResponse.getSourceType(), savedResponse.getEnquiryId());
        } catch (Exception e) {
            logger.error("Catalogue lead {}: lead score failed: {}", savedResponse.getId(), e.getMessage());
        }

        // Pool auto-assignment — catalogue leads carry no counsellor, so absent a repeat-lead
        // policy this is pure pool routing (previously catalogue leads never got an owner).
        applyCounsellorAssignment(repeatLeadSettings, savedResponse, userId, audience.getInstituteId(),
                null, null, createdUser != null ? createdUser.getFullName() : null,
                audience.getCampaignName());
        recordReattempt(repeatLeadSettings, savedResponse, userId, audience.getInstituteId(),
                dto.getEmail(), dto.getMobileNumber(),
                createdUser != null ? createdUser.getFullName() : null, audience.getCampaignName());
        applyRepeatLeadStatus(repeatLeadSettings, userId, audience.getInstituteId(), savedResponse,
                dto.getEmail(), dto.getMobileNumber());

        return savedResponse.getId();
    }

    /**
     * Resolve the per-institute "Course Catalogue Leads" audience, creating a
     * minimal ACTIVE one on first use so no manual campaign setup is required.
     */
    private Audience getOrCreateCatalogueAudience(String instituteId) {
        return audienceRepository.findFirstByInstituteIdAndCampaignName(instituteId, CATALOGUE_AUDIENCE_NAME)
                .orElseGet(() -> {
                    Audience audience = Audience.builder()
                            .id(UUID.randomUUID().toString())
                            .instituteId(instituteId)
                            .campaignName(CATALOGUE_AUDIENCE_NAME)
                            .campaignType("WEBSITE")
                            .campaignObjective("LEAD_GENERATION")
                            .description("Leads captured from the public course catalogue and course pages")
                            .status("ACTIVE")
                            .defaultInitialScore(0)
                            .build();
                    Audience saved = audienceRepository.save(audience);
                    logger.info("Auto-provisioned Course Catalogue Leads audience {} for institute {}",
                            saved.getId(), instituteId);
                    return saved;
                });
    }

    /** Campaign name for the auto-provisioned per-institute live-class / webinar lead audience. */
    private static final String LIVE_CLASS_AUDIENCE_NAME = "Public Webinar - Live Session";

    /**
     * Capture a lead from a public live-class (webinar) guest registration.
     *
     * <p>Live-session guest registration ({@code RegistrationService.saveGuestUserDetails})
     * writes only {@code session_guest_registrations} + EXTERNAL_PARTICIPANT custom field
     * values and never created an {@code audience_response}, so webinar registrants were
     * invisible in the CRM lead list. This routes them into a single per-institute
     * "Public Webinar - Live Session" audience so they show up in Audience Manager →
     * Recent Leads, exactly like {@link #submitCatalogueLead} does for catalogue leads.
     *
     * <p>Mirrors submitCatalogueLead deliberately: NOT {@code @Transactional} (its
     * best-effort sub-calls must not mark a surrounding tx rollback-only), and it does
     * NOT fire the {@code AUDIENCE_LEAD_SUBMISSION} workflow — the registrant already
     * receives the {@code LIVE_SESSION_FORM_SUBMISSION} seat-confirmation, and firing the
     * audience workflow too would double-message them.
     *
     * <p>Best-effort: returns null rather than throwing when it cannot create a lead, so
     * the caller — an already-committed public registration — is never disturbed.
     */
    public String submitLiveClassLead(String instituteId, String fullName, String email,
                                      String mobileNumber, Map<String, String> extraCustomFieldValues,
                                      String sourceId) {
        if (!StringUtils.hasText(instituteId) || !StringUtils.hasText(email)) {
            return null;
        }
        return submitLiveClassLeadToAudience(getOrCreateLiveClassAudience(instituteId),
                fullName, email, mobileNumber, extraCustomFieldValues, sourceId);
    }

    /**
     * Same live-class lead capture as {@link #submitLiveClassLead}, but into a specific
     * admin-selected audience list (the session's "save registrants to audience list(s)"
     * setting) instead of the auto-provisioned default. The audience is resolved by
     * id + institute so a stale/foreign id can never leak a lead across institutes, and
     * non-ACTIVE lists are skipped (same rule as submitLeadV2). Best-effort like the
     * default path: returns null rather than throwing.
     */
    public String submitLiveClassLeadToAudienceId(String audienceId, String instituteId, String fullName,
                                                  String email, String mobileNumber,
                                                  Map<String, String> extraCustomFieldValues, String sourceId) {
        if (!StringUtils.hasText(audienceId) || !StringUtils.hasText(instituteId) || !StringUtils.hasText(email)) {
            return null;
        }
        java.util.Optional<Audience> audienceOpt = audienceRepository.findByIdAndInstituteId(audienceId, instituteId);
        if (audienceOpt.isEmpty()) {
            logger.warn("Live-class lead: audience {} not found for institute {} — skipping push",
                    audienceId, instituteId);
            return null;
        }
        Audience audience = audienceOpt.get();
        if (StringUtils.hasText(audience.getStatus()) && !"ACTIVE".equalsIgnoreCase(audience.getStatus())) {
            logger.warn("Live-class lead: audience {} is {} — skipping push", audienceId, audience.getStatus());
            return null;
        }
        return submitLiveClassLeadToAudience(audience, fullName, email, mobileNumber,
                extraCustomFieldValues, sourceId);
    }

    /** Shared body of the live-class lead capture, parameterized by target audience. */
    private String submitLiveClassLeadToAudience(Audience audience, String fullName, String email,
                                                 String mobileNumber, Map<String, String> extraCustomFieldValues,
                                                 String sourceId) {
        final String instituteId = audience.getInstituteId();

        UserDTO userDTO = UserDTO.builder()
                .fullName(fullName)
                .email(email)
                .mobileNumber(mobileNumber)
                .build();

        // The webinar form's extra fields (anything beyond name/email/phone — e.g. "CUET
        // Marks") arrive keyed by their custom_field_id. Attach each to this audience's
        // AUDIENCE_FORM schema (idempotent) so it renders as a lead column; the value is
        // saved below. This keeps the lead's fields in sync with the registration form for
        // ANY institute — even one whose live-class audience was just auto-created — without
        // any manual campaign setup.
        if (extraCustomFieldValues != null && !extraCustomFieldValues.isEmpty()) {
            int order = 3; // base identity fields occupy 0..2
            for (String customFieldId : extraCustomFieldValues.keySet()) {
                try {
                    ensureAudienceFormField(instituteId, audience.getId(), customFieldId, order++);
                } catch (Exception e) {
                    logger.error("Live-class lead: attaching field {} to audience {} failed: {}",
                            customFieldId, audience.getId(), e.getMessage());
                }
            }
        }

        final String src = StringUtils.hasText(sourceId) ? sourceId : "live-class";

        // Institute-configured dedup — before creating the auth user.
        LeadDedupSettingService.RepeatLeadSettings repeatLeadSettings = null;
        java.util.Optional<LeadDeduplicationService.DuplicateMatch> dupMatch = leadDeduplicationService
                .checkDuplicate(instituteId, audience.getId(), email, mobileNumber);
        if (dupMatch.isPresent()) {
            if (dupMatch.get().action() == LeadDedupSettingService.DedupAction.REJECT) {
                return dupMatch.get().rejectionMessage();
            }
            repeatLeadSettings = dupMatch.get().repeatLeadSettings();
        }

        // 1. Create/fetch the lead's user in auth_service (no credentials email).
        UserDTO createdUser = authService.createUserFromAuthService(userDTO, audience.getInstituteId(), false);
        String userId = createdUser != null ? createdUser.getId() : null;

        // 2. Per-person-per-campaign dedup — revive a soft-deleted lead rather than duplicate.
        if (StringUtils.hasText(userId)
                && audienceResponseRepository.existsByAudienceIdAndUserId(audience.getId(), userId)) {
            reactivateSoftDeletedLeads(audience.getId(), userId);
            return "You are already captured as a lead for this campaign";
        }

        // 3. Persist the lead — this is what Audience Manager → Recent Leads reads.
        AudienceResponse savedResponse = audienceResponseRepository.save(AudienceResponse.builder()
                .audienceId(audience.getId())
                .sourceType("LIVE_SESSION")
                .sourceId(src)
                .userId(userId)
                .parentName(fullName)
                .parentEmail(email)
                .parentMobile(truncateForParentMobileColumn(mobileNumber))
                .workflowActivateDayAt(calculateWorkflowActivateDayAt(audience))
                .initialScore(audience.getDefaultInitialScore())
                .build());

        // 4. Enrichment — best-effort; never block the saved lead.
        try {
            logLeadSubmitted(savedResponse);
        } catch (Exception e) {
            logger.error("Live-class lead {}: logLeadSubmitted failed: {}", savedResponse.getId(), e.getMessage());
        }
        try {
            // Build the values to persist so every key resolves to a field that actually
            // exists on this audience — otherwise saveCustomFieldValues' single saveAll would
            // FK-fail on an unknown key and drop the whole batch (incl. the extras). Extras
            // were attached above, so they resolve. Base identity keys are included only when
            // the audience already has them (a freshly auto-created audience does not — the
            // name/email/phone still surface on the lead via parent_name/parent_email/parent_mobile).
            Map<String, String> valuesToSave = extraCustomFieldValues != null
                    ? new HashMap<>(extraCustomFieldValues)
                    : new HashMap<>();
            Set<String> audienceFieldKeys = new HashSet<>();
            for (Object[] row : instituteCustomFieldRepository.findInstituteCustomFieldsWithDetails(
                    audience.getInstituteId(), CustomFieldTypeEnum.AUDIENCE_FORM.name(), audience.getId())) {
                CustomFields cf = (CustomFields) row[1];
                if (cf.getFieldKey() != null) audienceFieldKeys.add(cf.getFieldKey().toLowerCase().trim());
            }
            if (StringUtils.hasText(fullName) && audienceFieldKeys.contains("full_name")) {
                valuesToSave.put("full_name", fullName);
            }
            if (StringUtils.hasText(email) && audienceFieldKeys.contains("email")) {
                valuesToSave.put("email", email);
            }
            if (StringUtils.hasText(mobileNumber) && audienceFieldKeys.contains("phone_number")) {
                valuesToSave.put("phone_number", mobileNumber);
            }
            if (!CollectionUtils.isEmpty(valuesToSave)) {
                saveCustomFieldValues(savedResponse.getId(), valuesToSave, audience.getInstituteId(),
                        audience.getId());
            }
        } catch (Exception e) {
            logger.error("Live-class lead {}: saveCustomFieldValues failed: {}", savedResponse.getId(), e.getMessage());
        }
        try {
            leadScoringService.calculateAndSaveScore(savedResponse.getId(), savedResponse.getAudienceId(),
                    audience.getInstituteId(), savedResponse.getSourceType(), savedResponse.getEnquiryId());
        } catch (Exception e) {
            logger.error("Live-class lead {}: lead score failed: {}", savedResponse.getId(), e.getMessage());
        }

        // Pool auto-assignment — live-class leads carry no counsellor, so absent a repeat-lead
        // policy this is pure pool routing.
        applyCounsellorAssignment(repeatLeadSettings, savedResponse, userId, audience.getInstituteId(),
                null, null, createdUser != null ? createdUser.getFullName() : null,
                audience.getCampaignName());
        recordReattempt(repeatLeadSettings, savedResponse, userId, audience.getInstituteId(),
                email, mobileNumber,
                createdUser != null ? createdUser.getFullName() : null, audience.getCampaignName());
        applyRepeatLeadStatus(repeatLeadSettings, userId, audience.getInstituteId(), savedResponse,
                email, mobileNumber);

        return savedResponse.getId();
    }

    /**
     * Resolve the per-institute live-class / webinar lead audience, creating a minimal
     * ACTIVE one on first use so no manual campaign setup is required. Resolved by name,
     * so an institute that already has a "Public Webinar - Live Session" campaign reuses it.
     */
    private Audience getOrCreateLiveClassAudience(String instituteId) {
        return audienceRepository.findFirstByInstituteIdAndCampaignName(instituteId, LIVE_CLASS_AUDIENCE_NAME)
                .orElseGet(() -> {
                    Audience audience = Audience.builder()
                            .id(UUID.randomUUID().toString())
                            .instituteId(instituteId)
                            .campaignName(LIVE_CLASS_AUDIENCE_NAME)
                            .campaignType("WEBSITE")
                            .campaignObjective("LEAD_GENERATION")
                            .description("Leads captured from public live-class / webinar registrations")
                            .status("ACTIVE")
                            .defaultInitialScore(20)
                            .build();
                    Audience saved = audienceRepository.save(audience);
                    logger.info("Auto-provisioned live-class lead audience {} for institute {}",
                            saved.getId(), instituteId);
                    return saved;
                });
    }

    /**
     * Attach a custom field to an audience's AUDIENCE_FORM schema if it isn't already,
     * so a value saved against it renders as a column in the lead list. Idempotent — a
     * no-op when the link already exists. Used to mirror a live-class registration form's
     * extra fields onto its lead audience.
     */
    private void ensureAudienceFormField(String instituteId, String audienceId, String customFieldId, int order) {
        if (!StringUtils.hasText(customFieldId)) return;
        boolean alreadyLinked = instituteCustomFieldRepository
                .findTopByInstituteIdAndCustomFieldIdAndTypeAndTypeIdAndStatusOrderByCreatedAtDesc(
                        instituteId, customFieldId, "AUDIENCE_FORM", audienceId, "ACTIVE")
                .isPresent();
        if (alreadyLinked) return;
        instituteCustomFieldRepository.save(InstituteCustomField.builder()
                .instituteId(instituteId)
                .customFieldId(customFieldId)
                .type("AUDIENCE_FORM")
                .typeId(audienceId)
                .status("ACTIVE")
                .isMandatory(false)
                .individualOrder(order)
                .groupInternalOrder(0)
                .build());
    }

    private static final String PHONE_ENQUIRIES_AUDIENCE_NAME = "Phone Enquiries";
    private static final String SELF_SIGNUPS_AUDIENCE_NAME = "Self Sign-ups";

    /** A lead resolved — or created — from an inbound phone caller (also reused for self-signups). */
    public record InboundCallLeadRef(String responseId, String userId, String audienceId) {}

    /**
     * Resolve — or, if new, create — a lead for an inbound phone caller, so an inbound
     * helpline call becomes a followable CRM lead. De-duped on the caller's phone:
     * the auth-service user is find-or-create by mobile, and if that user is already
     * a lead ANYWHERE in the institute we return the existing lead rather than mint a
     * duplicate (covers a caller who's a lead in another campaign, or whose phone is
     * only on the user record). A brand-new caller lands in the auto-provisioned
     * per-institute "Phone Enquiries" audience with {@code parent_mobile} set, so the
     * telephony last-10 phone-match binds subsequent calls to this same lead.
     *
     * <p>Runs in its OWN transaction (REQUIRES_NEW): a capture failure — or a later
     * rollback of the outcome that triggered it — must never lose the lead, and the
     * caller catches any exception without poisoning its own transaction. Idempotent
     * under retry via the phone/user de-dup above. Enrichment (score / pool
     * assignment) is best-effort. Returns null on invalid input or user-create failure.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public InboundCallLeadRef captureInboundCallLead(String instituteId, String phone, String name) {
        if (!StringUtils.hasText(instituteId) || !StringUtils.hasText(phone)) return null;

        // 1. Find-or-create the auth-service user by mobile. No email on a phone caller,
        //    so synthesize a non-deliverable placeholder (the same path Meta/Google
        //    webhook leads with no email use — suppressed by every send path).
        // Display name is a real name when known, else the phone NUMBER — never the
        // synthesized placeholder email, which would otherwise show as the lead's name
        // in Recent Leads and undercut "followable".
        String email = placeholderEmailService.synthesize(name, phone, null);
        String display = StringUtils.hasText(name) ? name.trim() : phone;
        UserDTO userDTO = UserDTO.builder()
                .email(email)
                .fullName(display)
                .mobileNumber(phone)
                .build();
        UserDTO createdUser;
        try {
            createdUser = authService.createUserFromAuthService(userDTO, instituteId, false);
        } catch (Exception e) {
            logger.error("Inbound-call lead: user create failed for {} inst {}: {}",
                    phone, instituteId, e.getMessage());
            return null;
        }
        String userId = createdUser != null ? createdUser.getId() : null;
        if (!StringUtils.hasText(userId)) return null;

        // 2. De-dup: if this user is ALREADY a lead anywhere in the institute, reuse it
        //    — never a second lead for the same person.
        List<String> existing = audienceResponseRepository.findResponseIdByInstituteAndUser(instituteId, userId);
        if (existing != null && !existing.isEmpty()) {
            String responseId = existing.get(0);
            String audienceId = audienceResponseRepository.findById(responseId)
                    .map(AudienceResponse::getAudienceId).orElse(null);
            logger.info("Inbound-call lead: caller {} already a lead (response {}) — reused", phone, responseId);
            return new InboundCallLeadRef(responseId, userId, audienceId);
        }

        // 3. New caller → create the lead in the auto-provisioned Phone Enquiries audience.
        Audience audience = getOrCreatePhoneEnquiriesAudience(instituteId);
        AudienceResponse saved = audienceResponseRepository.save(AudienceResponse.builder()
                .audienceId(audience.getId())
                .sourceType("INBOUND_CALL")
                .sourceId("INBOUND_CALL")
                .userId(userId)
                .parentMobile(phone)                                   // so phone-match binds the next call
                .parentName(display)
                .workflowActivateDayAt(calculateWorkflowActivateDayAt(audience))
                .initialScore(audience.getDefaultInitialScore())
                .build());

        // 4. Enrichment — best-effort; a captured lead is never lost over optional config.
        try {
            logLeadSubmitted(saved);
        } catch (Exception e) {
            logger.error("Inbound-call lead {}: logLeadSubmitted failed: {}", saved.getId(), e.getMessage());
        }
        try {
            leadScoringService.calculateAndSaveScore(saved.getId(), saved.getAudienceId(),
                    instituteId, saved.getSourceType(), saved.getEnquiryId());
        } catch (Exception e) {
            logger.error("Inbound-call lead {}: score failed: {}", saved.getId(), e.getMessage());
        }
        // Counsellor assignment is intentionally left to the outcome pipeline —
        // AiCallOutcomeProcessor assigns on a good disposition. Assigning here too would
        // double-rotate the pool and double-notify the same pass once a pool is attached
        // to Phone Enquiries (today it has none, so an intake assign is a no-op anyway).
        // One assignment, in one place.

        logger.info("Inbound-call lead captured: response={} user={} inst={}",
                saved.getId(), userId, instituteId);
        return new InboundCallLeadRef(saved.getId(), userId, audience.getId());
    }

    /**
     * Resolve the per-institute "Phone Enquiries" audience, creating a minimal ACTIVE
     * one on first use so an inbound helpline needs no manual campaign setup.
     */
    private Audience getOrCreatePhoneEnquiriesAudience(String instituteId) {
        return audienceRepository.findFirstByInstituteIdAndCampaignName(instituteId, PHONE_ENQUIRIES_AUDIENCE_NAME)
                .orElseGet(() -> {
                    Audience audience = Audience.builder()
                            .id(UUID.randomUUID().toString())
                            .instituteId(instituteId)
                            .campaignName(PHONE_ENQUIRIES_AUDIENCE_NAME)
                            .campaignType("PHONE_CALL")
                            .campaignObjective("LEAD_GENERATION")
                            .description("Leads captured from inbound phone calls to the AI helpline")
                            .status("ACTIVE")
                            .defaultInitialScore(0)
                            .build();
                    Audience saved = audienceRepository.save(audience);
                    logger.info("Auto-provisioned Phone Enquiries audience {} for institute {}",
                            saved.getId(), instituteId);
                    return saved;
                });
    }

    /**
     * Resolve the per-institute "Self Sign-ups" audience, creating a minimal ACTIVE
     * one on first use so an open learner registration needs no manual campaign setup.
     */
    private Audience getOrCreateSelfSignupsAudience(String instituteId) {
        return audienceRepository.findFirstByInstituteIdAndCampaignName(instituteId, SELF_SIGNUPS_AUDIENCE_NAME)
                .orElseGet(() -> {
                    Audience audience = Audience.builder()
                            .id(UUID.randomUUID().toString())
                            .instituteId(instituteId)
                            .campaignName(SELF_SIGNUPS_AUDIENCE_NAME)
                            .campaignType("SELF_SIGNUP")
                            .campaignObjective("LEAD_GENERATION")
                            .description("Learners who registered themselves without enrolling in a course")
                            .status("ACTIVE")
                            .defaultInitialScore(0)
                            .build();
                    Audience saved = audienceRepository.save(audience);
                    logger.info("Auto-provisioned Self Sign-ups audience {} for institute {}",
                            saved.getId(), instituteId);
                    return saved;
                });
    }

    /**
     * Capture a lead for a learner who self-registered (auth_service) without enrolling
     * in any course/package-session. The auth user already exists — this only creates the
     * lead-side record so the signup is visible to the institute admin in the Leads list,
     * since the normal learner list requires a course enrollment to show up at all.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public InboundCallLeadRef captureSelfSignupLead(String instituteId, String userId, String name, String email,
            String mobile) {
        if (!StringUtils.hasText(instituteId) || !StringUtils.hasText(userId)) return null;

        // De-dup: if this user is ALREADY a lead anywhere in the institute, reuse it
        // — never a second lead for the same person.
        List<String> existing = audienceResponseRepository.findResponseIdByInstituteAndUser(instituteId, userId);
        if (existing != null && !existing.isEmpty()) {
            String responseId = existing.get(0);
            String audienceId = audienceResponseRepository.findById(responseId)
                    .map(AudienceResponse::getAudienceId).orElse(null);
            logger.info("Self-signup lead: user {} already a lead (response {}) — reused", userId, responseId);
            return new InboundCallLeadRef(responseId, userId, audienceId);
        }

        Audience audience = getOrCreateSelfSignupsAudience(instituteId);
        AudienceResponse saved = audienceResponseRepository.save(AudienceResponse.builder()
                .audienceId(audience.getId())
                .sourceType("SELF_SIGNUP")
                .sourceId("SELF_SIGNUP")
                .userId(userId)
                .parentName(name)
                .parentEmail(email)
                .parentMobile(truncateForParentMobileColumn(mobile))
                .workflowActivateDayAt(calculateWorkflowActivateDayAt(audience))
                .initialScore(audience.getDefaultInitialScore())
                .build());

        try {
            logLeadSubmitted(saved);
        } catch (Exception e) {
            logger.error("Self-signup lead {}: logLeadSubmitted failed: {}", saved.getId(), e.getMessage());
        }
        try {
            leadScoringService.calculateAndSaveScore(saved.getId(), saved.getAudienceId(),
                    instituteId, saved.getSourceType(), saved.getEnquiryId());
        } catch (Exception e) {
            logger.error("Self-signup lead {}: score failed: {}", saved.getId(), e.getMessage());
        }

        logger.info("Self-signup lead captured: response={} user={} inst={}",
                saved.getId(), userId, instituteId);
        return new InboundCallLeadRef(saved.getId(), userId, audience.getId());
    }

    // ==================== WhatsApp chatbot flow leads ====================

    /** Source type stamped on leads captured by a WhatsApp chatbot flow (also the list's campaign type). */
    public static final String WHATSAPP_FLOW_SOURCE_TYPE = "WHATSAPP_FLOW";
    private static final String WHATSAPP_LEADS_AUDIENCE_NAME = "WhatsApp Leads";

    /**
     * Create a lead for a WhatsApp chatbot conversation in the institute's auto-provisioned
     * "WhatsApp Leads" list. The caller ({@code WhatsAppFlowLeadService}) has already
     * established that this phone is not a lead anywhere in the institute and holds the
     * per-phone lock inside its transaction, so this method does no de-dup of its own.
     * Same intake steps as the other captured-lead channels: timeline, score, counsellor.
     */
    public InboundCallLeadRef createWhatsAppFlowLead(String instituteId, String userId, String phone,
            String name, String flowId) {
        Audience audience = getOrCreateWhatsAppLeadsAudience(instituteId);
        String display = StringUtils.hasText(name) ? name.trim() : phone;
        AudienceResponse saved = audienceResponseRepository.save(AudienceResponse.builder()
                .audienceId(audience.getId())
                .sourceType(WHATSAPP_FLOW_SOURCE_TYPE)
                .sourceId(StringUtils.hasText(flowId) ? flowId : WHATSAPP_FLOW_SOURCE_TYPE)
                .userId(userId)
                .parentName(display)
                .parentMobile(truncateForParentMobileColumn(phone))
                .workflowActivateDayAt(calculateWorkflowActivateDayAt(audience))
                .initialScore(audience.getDefaultInitialScore())
                .build());

        try {
            logLeadSubmitted(saved);
        } catch (Exception e) {
            logger.error("WhatsApp flow lead {}: logLeadSubmitted failed: {}", saved.getId(), e.getMessage());
        }
        try {
            leadScoringService.calculateAndSaveScore(saved.getId(), saved.getAudienceId(),
                    instituteId, saved.getSourceType(), saved.getEnquiryId());
        } catch (Exception e) {
            logger.error("WhatsApp flow lead {}: score failed: {}", saved.getId(), e.getMessage());
        }
        // Swallows its own failures — assignment must never break intake.
        autoAssignCounsellorOnIntake(saved, userId, instituteId, null, null, display, audience.getCampaignName());

        logger.info("WhatsApp flow lead captured: response={} user={} inst={} flow={}",
                saved.getId(), userId, instituteId, flowId);
        return new InboundCallLeadRef(saved.getId(), userId, audience.getId());
    }

    /**
     * Resolve the per-institute "WhatsApp Leads" list, creating it on first use. Found by
     * campaign type rather than name so a renamed list keeps receiving leads. The create
     * path takes an institute-wide advisory lock and re-checks, so two first leads arriving
     * together cannot create two lists. Must run inside a transaction (the lock is
     * transaction-scoped).
     */
    private Audience getOrCreateWhatsAppLeadsAudience(String instituteId) {
        Optional<Audience> existing = audienceRepository
                .findFirstByInstituteIdAndCampaignTypeAndStatusOrderByCreatedAtAsc(
                        instituteId, WHATSAPP_FLOW_SOURCE_TYPE, "ACTIVE");
        if (existing.isPresent()) return existing.get();

        audienceResponseRepository.acquireTransactionLock("whatsapp-leads-list:" + instituteId);
        return audienceRepository
                .findFirstByInstituteIdAndCampaignTypeAndStatusOrderByCreatedAtAsc(
                        instituteId, WHATSAPP_FLOW_SOURCE_TYPE, "ACTIVE")
                .orElseGet(() -> {
                    Audience audience = Audience.builder()
                            .id(UUID.randomUUID().toString())
                            .instituteId(instituteId)
                            .campaignName(WHATSAPP_LEADS_AUDIENCE_NAME)
                            .campaignType(WHATSAPP_FLOW_SOURCE_TYPE)
                            .campaignObjective("LEAD_GENERATION")
                            .description("Leads captured from WhatsApp chatbot flows")
                            .status("ACTIVE")
                            .defaultInitialScore(0)
                            .build();
                    Audience saved = audienceRepository.save(audience);
                    logger.info("Auto-provisioned WhatsApp Leads audience {} for institute {}",
                            saved.getId(), instituteId);
                    return saved;
                });
    }

    /**
     * Attach a custom field to a lead list's form schema (idempotent) so a value saved
     * against it shows as a column. Public entry to {@link #ensureAudienceFormField} for the
     * WhatsApp chatbot capture path.
     */
    public void attachFieldToLeadList(String instituteId, String audienceId, String customFieldId, int order) {
        ensureAudienceFormField(instituteId, audienceId, customFieldId, order);
    }

    /**
     * Fire AUDIENCE_LEAD_SUBMISSION for a lead captured by a WhatsApp chatbot flow, once its
     * answers are saved. The context carries the same keys as the form paths (user, audience,
     * customFields, responseId, phone …) so existing workflow node configs work unchanged.
     * No respondent/admin email requests are built: the lead came in over WhatsApp and has
     * no real email, and the chatbot flow already replied to them.
     */
    public void fireLeadSubmissionWorkflow(String responseId) {
        AudienceResponse response = audienceResponseRepository.findById(responseId).orElse(null);
        if (response == null) return;
        Audience audience = audienceRepository.findById(response.getAudienceId()).orElse(null);
        if (audience == null) return;
        String instituteId = audience.getInstituteId();

        UserDTO user = UserDTO.builder()
                .id(response.getUserId())
                .fullName(response.getParentName())
                .email(response.getParentEmail())
                .mobileNumber(response.getParentMobile())
                .build();
        AudienceDTO audienceDTO = AudienceDTO.builder()
                .id(audience.getId())
                .campaignName(audience.getCampaignName())
                .instituteId(instituteId)
                .status(audience.getStatus())
                .toNotify(audience.getToNotify())
                .sendRespondentEmail(audience.getSendRespondentEmail())
                .build();
        String submissionTime = java.time.ZonedDateTime.now()
                .format(java.time.format.DateTimeFormatter.ofPattern("MMM dd, yyyy hh:mm a z"));

        Map<String, Object> contextData = new HashMap<>();
        contextData.put("user", user);
        contextData.put("audience", audienceDTO);
        contextData.put("audienceId", audience.getId());
        contextData.put("instituteId", instituteId);
        contextData.put("instituteName",
                instituteRepository.findById(instituteId).map(Institute::getInstituteName).orElse(""));
        contextData.put("customFields", buildCustomFieldMapForEmail(responseId));
        contextData.put("submissionTime", submissionTime);
        contextData.put("responseId", responseId);
        contextData.put("userId", response.getUserId());
        contextData.put("leadUserId", response.getUserId());
        contextData.put("phone", response.getParentMobile());
        contextData.put("parentMobile", response.getParentMobile());
        contextData.put("campaignName", audience.getCampaignName());
        contextData.put("sendRespondentEmail", false);
        contextData.put("respondentEmailRequests", new ArrayList<Map<String, Object>>());
        contextData.put("adminEmailRequests", new ArrayList<Map<String, Object>>());

        workflowTriggerService.handleTriggerEvents(
                WorkflowTriggerEvent.AUDIENCE_LEAD_SUBMISSION.name(),
                audience.getId(),
                instituteId,
                contextData);
    }

    /**
     * Submit a lead from website form
     * Automatically creates/fetches user from auth_service
     */
    @Transactional
    public String submitLead(SubmitLeadRequestDTO requestDTO) {
        logger.info("Submitting lead for audience: {}", requestDTO.getAudienceId());

        // Validate audience exists
        Audience audience = audienceRepository.findById(requestDTO.getAudienceId())
                .orElseThrow(() -> new VacademyException("Audience not found"));

        // Validate audience is active
        if (!"ACTIVE".equals(audience.getStatus())) {
            throw new VacademyException("Audience campaign is not active");
        }
        String instituteId = audienceRepository.findById(requestDTO.getAudienceId()).get().getInstituteId();
        // 1. Create/fetch user from auth_service
        String userId = null;
        UserDTO createdUser = null;
        try {
            UserDTO userDTO = requestDTO.getUserDTO();

            // Phone-only rows (CSV/bulk imports, phone-first campaigns) carry no email,
            // but auth_service needs one to mint the lead's account — historically these
            // rows fell through to the generic error sentinel and the lead was dropped.
            // Synthesize the same deterministic, non-deliverable placeholder the
            // Meta/Google webhook leads use (name+phone@<placeholder domain>) so the
            // lead is ingested. Every send path suppresses placeholder addresses
            // (see PlaceholderEmailService), so nothing is ever mailed to them.
            boolean emailSynthesized = false;
            if (userDTO != null && !StringUtils.hasText(userDTO.getEmail())
                    && (StringUtils.hasText(userDTO.getMobileNumber())
                            || StringUtils.hasText(userDTO.getFullName()))) {
                userDTO.setEmail(placeholderEmailService.synthesize(
                        userDTO.getFullName(), userDTO.getMobileNumber(), null));
                emailSynthesized = true;
                logger.info("No email on lead for audience {} — synthesized placeholder {} from name+phone",
                        requestDTO.getAudienceId(), userDTO.getEmail());
            }

            // A lead with no email, no phone AND no name has no identity to key the
            // auth user on — reject with an actionable message (the generic sentinel
            // below tells the bulk-upload caller nothing about what to fix).
            if (userDTO == null || !StringUtils.hasText(userDTO.getEmail())) {
                return "Error in submitting the response: user email, mobile number or name is required";
            }

            // Institute-configured dedup (LEAD_SETTING.data.dedup) — checked before creating the
            // auth user so a REJECTed lead never creates an orphan account. ALLOW_REASSIGN lets
            // the lead through and carries the repeat-lead counsellor/status settings to apply below.
            LeadDedupSettingService.RepeatLeadSettings repeatLeadSettings = null;
            java.util.Optional<LeadDeduplicationService.DuplicateMatch> dupMatch = leadDeduplicationService
                    .checkDuplicate(instituteId, requestDTO.getAudienceId(), userDTO.getEmail(),
                            userDTO.getMobileNumber());
            if (dupMatch.isPresent()) {
                if (dupMatch.get().action() == LeadDedupSettingService.DedupAction.REJECT) {
                    return dupMatch.get().rejectionMessage();
                }
                repeatLeadSettings = dupMatch.get().repeatLeadSettings();
            }

            if (userDTO != null && StringUtils.hasText(userDTO.getEmail())) {
                // Call auth_service to create or fetch existing user
                // sendCred = false (no email notification)
                createdUser = resolveLeadUser(userDTO, audience.getInstituteId(),
                        requestDTO.getAudienceId(), repeatLeadSettings != null, requestDTO.getCounsellorId());
                userId = createdUser.getId();
                // Prepare effectively final variables for lambda
                final UserDTO userForNotification = createdUser;
                final String instituteIdForNotification = instituteId;
                final String audienceInstituteId = audience.getInstituteId();

                // Duplicate submission guard: same audience + same user
                if (StringUtils.hasText(userId) &&
                        audienceResponseRepository.existsByAudienceIdAndUserId(requestDTO.getAudienceId(), userId)) {
                    // Revive a soft-deleted lead instead of blackholing the resubmission.
                    reactivateSoftDeletedLeads(requestDTO.getAudienceId(), userId);
                    return "You have already submitted your response for this campaign";
                }

                // 2. Create audience response with user_id.
                // Optional CSV/bulk-supplied pipeline status -> lead_status_id (the status
                // chip). Null when not supplied or unrecognised, preserving prior behaviour.
                String resolvedLeadStatusId = resolveLeadStatusId(
                        instituteId, requestDTO.getLeadStatusKey());
                AudienceResponse response = AudienceResponse.builder()
                        .audienceId(requestDTO.getAudienceId())
                        .sourceType(requestDTO.getSourceType())
                        .sourceId(requestDTO.getSourceId())
                        .userId(userId) // Set user_id if created successfully
                        .leadStatusId(resolvedLeadStatusId)
                        .parentEmail(userDTO.getEmail())
                        .parentMobile(truncateForParentMobileColumn(userDTO.getMobileNumber()))
                        .workflowActivateDayAt(calculateWorkflowActivateDayAt(audience))
                        .initialScore(audience.getDefaultInitialScore())
                        .createdByUserId(requestDTO.getCreatedByUserId())
                        .build();

                AudienceResponse savedResponse = audienceResponseRepository.save(response);
                logger.info("Saved audience response with ID: {} and user_id: {}",
                        savedResponse.getId(), userId != null ? userId : "null");
                logLeadSubmitted(savedResponse);

                // 3. Save custom field values
                if (!CollectionUtils.isEmpty(requestDTO.getCustomFieldValues())) {
                    saveCustomFieldValues(
                            savedResponse.getId(),
                            requestDTO.getCustomFieldValues(),
                            audience.getInstituteId(),
                            audience.getId());
                }

                // 3b. Calculate initial lead score (real-time).
                // Custom fields are saved first so the completeness factor sees them.
                // Without this call no LeadScore row is ever created — campaign_count
                // and best_score on UserLeadProfile would stay at 0 forever for every
                // lead that comes through this endpoint.
                try {
                    leadScoringService.calculateAndSaveScore(
                            savedResponse.getId(),
                            savedResponse.getAudienceId(),
                            instituteId,
                            savedResponse.getSourceType(),
                            savedResponse.getEnquiryId());
                } catch (Exception e) {
                    logger.error("Failed to calculate initial lead score for response {}: {}",
                            savedResponse.getId(), e.getMessage());
                    // Non-blocking — lead is still saved even if scoring fails
                }

                // 3c. Counsellor assignment — manual owner wins (e.g. a CSV bulk import that
                // carries a lead owner per row), otherwise pool auto-assignment or the
                // repeat-lead policy. Centralised in applyCounsellorAssignment. Non-blocking —
                // submission still succeeds if routing fails.
                applyCounsellorAssignment(repeatLeadSettings, savedResponse, userId, instituteId,
                        requestDTO.getCounsellorId(), requestDTO.getCounsellorName(),
                        userForNotification.getFullName(), audience.getCampaignName());
                recordReattempt(repeatLeadSettings, savedResponse, userId, instituteId,
                        userDTO.getEmail(), userDTO.getMobileNumber(),
                        userForNotification.getFullName(), audience.getCampaignName());
                applyRepeatLeadStatus(repeatLeadSettings, userId, instituteId, savedResponse,
                        userDTO.getEmail(), userDTO.getMobileNumber());

                // 4. Build custom field map for email
                Map<String, String> customFieldsForEmail = buildCustomFieldMapForEmail(savedResponse.getId());

                // 4a. Workflow-aware path: if an active workflow trigger exists for this
                // (institute, audience, AUDIENCE_LEAD_SUBMISSION), delegate to the workflow
                // engine — mirroring the Zoho webhook path. This ensures audience-side and
                // admin-manual lead submissions fire the same workflows that Zoho leads do.
                // If no trigger is configured for the audience, we fall through to the
                // existing direct-email blocks below (no behavior change for those cases).
                boolean workflowTriggerExists = workflowTriggerService
                        .findByInstituteIdEventNameAndEventId(
                                instituteId,
                                WorkflowTriggerEvent.AUDIENCE_LEAD_SUBMISSION.name(),
                                requestDTO.getAudienceId())
                        .isPresent();

                if (workflowTriggerExists) {
                    logger.info(
                            "Workflow trigger found for audience {}. Delegating lead submission to workflow engine (skipping direct email send).",
                            requestDTO.getAudienceId());

                    // Current submission time (matches V2 / Zoho path formatting)
                    java.time.ZonedDateTime now = java.time.ZonedDateTime.now();
                    java.time.format.DateTimeFormatter formatter = java.time.format.DateTimeFormatter
                            .ofPattern("MMM dd, yyyy hh:mm a z");
                    String submissionTime = now.format(formatter);

                    // Build default email bodies so workflow nodes that consume
                    // respondentEmailRequests / adminEmailRequests have content to send.
                    // Workflows that build their own emails from #user / #customFields
                    // will simply ignore these — same contract as the Zoho path.
                    String respondentEmailBody = buildDefaultEmailBody(
                            audience.getCampaignName(),
                            userForNotification.getFullName(),
                            userForNotification.getEmail(),
                            customFieldsForEmail);
                    String respondentEmailSubject = "Thank You for Submitting Your Response for Campaign - "
                            + audience.getCampaignName();

                    String adminEmailBody = buildAdminNotificationBody(
                            audience.getCampaignName(),
                            userForNotification.getFullName(),
                            userForNotification.getEmail(),
                            customFieldsForEmail);
                    String adminEmailSubject = "New Lead Submitted - " + audience.getCampaignName();

                    // Parse admin notification recipients (toNotify)
                    List<String> adminEmails = new ArrayList<>();
                    if (StringUtils.hasText(audience.getToNotify())) {
                        for (String email : audience.getToNotify().split(",")) {
                            String trimmedEmail = email.trim();
                            if (StringUtils.hasText(trimmedEmail)) {
                                adminEmails.add(trimmedEmail);
                            }
                        }
                    }

                    // Build audience DTO for workflow context
                    AudienceDTO audienceDTO = AudienceDTO.builder()
                            .id(audience.getId())
                            .campaignName(audience.getCampaignName())
                            .instituteId(audience.getInstituteId())
                            .status(audience.getStatus())
                            .toNotify(audience.getToNotify())
                            .sendRespondentEmail(audience.getSendRespondentEmail())
                            .build();

                    // Build context data — shape mirrors submitLeadV2 / Zoho path so
                    // existing workflow node configs work without modification.
                    Map<String, Object> contextData = new HashMap<>();
                    contextData.put("user", userForNotification);
                    contextData.put("audience", audienceDTO);
                    contextData.put("audienceId", requestDTO.getAudienceId());
                    contextData.put("instituteId", instituteId);
                    contextData.put("instituteName",
                            instituteRepository.findById(instituteId).map(Institute::getInstituteName).orElse(""));
                    contextData.put("customFields", customFieldsForEmail);
                    contextData.put("submissionTime", submissionTime);
                    contextData.put("responseId", savedResponse.getId());
                    // Lead-grain identity the CALL_AI / SEND_WHATSAPP nodes read directly
                    // (phone/parentMobile + userId/leadUserId).
                    contextData.put("userId", savedResponse.getUserId());
                    contextData.put("leadUserId", savedResponse.getUserId());
                    contextData.put("phone", savedResponse.getParentMobile());
                    contextData.put("parentMobile", savedResponse.getParentMobile());
                    contextData.put("campaignName", audience.getCampaignName());
                    // The SEND_EMAIL node sends one email per respondentEmailRequests
                    // entry (the flag alone doesn't gate it) — suppress the entry for
                    // synthesized placeholder addresses, which are non-deliverable and
                    // would bounce. Same contract as the form-webhook path.
                    boolean wantRespondentEmail = audience.getSendRespondentEmail() == null
                            || audience.getSendRespondentEmail();
                    contextData.put("sendRespondentEmail", !emailSynthesized && wantRespondentEmail);

                    List<Map<String, Object>> respondentEmailRequests = new ArrayList<>();
                    if (!emailSynthesized) {
                        Map<String, Object> respondentEmailRequest = new HashMap<>();
                        respondentEmailRequest.put("to", userForNotification.getEmail());
                        respondentEmailRequest.put("subject", respondentEmailSubject);
                        respondentEmailRequest.put("body", respondentEmailBody);
                        respondentEmailRequests.add(respondentEmailRequest);
                    }
                    contextData.put("respondentEmailRequests", respondentEmailRequests);

                    List<Map<String, Object>> adminEmailRequests = new ArrayList<>();
                    for (String adminEmail : adminEmails) {
                        Map<String, Object> adminEmailRequest = new HashMap<>();
                        adminEmailRequest.put("to", adminEmail);
                        adminEmailRequest.put("subject", adminEmailSubject);
                        adminEmailRequest.put("body", adminEmailBody);
                        adminEmailRequests.add(adminEmailRequest);
                    }
                    contextData.put("adminEmailRequests", adminEmailRequests);

                    workflowTriggerService.handleTriggerEvents(
                            WorkflowTriggerEvent.AUDIENCE_LEAD_SUBMISSION.name(),
                            requestDTO.getAudienceId(),
                            instituteId,
                            contextData);

                    // The workflow context carries adminEmailRequests, but a workflow that only
                    // emails the respondent has no consumer for it — the to_notify admin alert
                    // would be silently dropped. Send it directly unless the workflow itself
                    // already includes an admin-notify node (guarded to avoid double-sending).
                    notifyToNotifyAdminsIfWorkflowDoesNot(
                            requestDTO.getAudienceId(), instituteId, audience,
                            userForNotification.getFullName(), userForNotification.getEmail(),
                            customFieldsForEmail, contextData);

                    return savedResponse.getId();
                }

                // No workflow trigger configured for this audience — preserve the
                // original direct-email behavior below.

                // 5. Send notification to respondent (if enabled; never to a synthesized
                // placeholder address — non-deliverable by design, would bounce on SES)
                if (!emailSynthesized
                        && (audience.getSendRespondentEmail() == null || audience.getSendRespondentEmail())) {
                    logger.info("Sending notification to respondent: {}", userForNotification.getEmail());

                    // Fetch the most recent EMAIL template config for this institute and event
                    Optional<NotificationEventConfig> configOpt = notificationEventConfigRepository
                            .findFirstByEventNameAndSourceTypeAndSourceIdAndTemplateTypeAndIsActiveTrueOrderByUpdatedAtDesc(
                                    NotificationEventType.AUDIENCE_FORM_SUBMISSION,
                                    NotificationSourceType.AUDIENCE,
                                    requestDTO.getAudienceId(),
                                    NotificationTemplateType.EMAIL);

                    if (configOpt.isPresent()) {
                        // Get current time with timezone
                        java.time.ZonedDateTime now = java.time.ZonedDateTime.now();
                        java.time.format.DateTimeFormatter formatter = java.time.format.DateTimeFormatter
                                .ofPattern("MMM dd, yyyy hh:mm a z");
                        String submissionTime = now.format(formatter);

                        // Send email using template with dynamic parameters
                        NotificationTemplateVariables templateVars = NotificationTemplateVariables.builder()
                                .userFullName(userForNotification.getFullName())
                                .userEmail(userForNotification.getEmail())
                                .instituteId(audienceInstituteId)
                                .campaignName(audience.getCampaignName())
                                .customFields(customFieldsForEmail)
                                .submissionTime(submissionTime)
                                .build();

                        sendUniqueLinkService.sendUniqueLinkByEmailByEnrollInvite(
                                instituteIdForNotification,
                                userForNotification,
                                configOpt.get().getTemplateId(),
                                null,
                                templateVars);
                        logger.info("Sent templated email to respondent: {}", userForNotification.getEmail());
                    } else {
                        // Send default plain email
                        String defaultEmailBody = buildDefaultEmailBody(
                                audience.getCampaignName(),
                                userForNotification.getFullName(),
                                userForNotification.getEmail(),
                                customFieldsForEmail);

                        logger.info("No template found, sending default email to: {}", userForNotification.getEmail());
                        logger.info("Default email body: {}", defaultEmailBody);

                        // Send default HTML email
                        GenericEmailRequest emailRequest = new GenericEmailRequest();
                        emailRequest.setTo(userForNotification.getEmail());
                        emailRequest.setSubject(
                                "Thank You for Submitting Your Response for Campaign -" + audience.getCampaignName());
                        emailRequest.setBody(defaultEmailBody);

                        try {
                            notificationService.sendGenericHtmlMailViaUnified(emailRequest, instituteIdForNotification);
                            logger.info("Sent default email to respondent: {}", userForNotification.getEmail());
                        } catch (Exception ex) {
                            logger.error("Failed to send default email to {}: {}", userForNotification.getEmail(),
                                    ex.getMessage());
                        }
                    }
                }

                // 6. Send notifications to additional recipients (to_notify)
                if (StringUtils.hasText(audience.getToNotify())) {
                    String[] additionalEmails = audience.getToNotify().split(",");
                    logger.info("Sending notifications to {} additional recipients", additionalEmails.length);

                    for (String email : additionalEmails) {
                        String trimmedEmail = email.trim();
                        if (!StringUtils.hasText(trimmedEmail)) {
                            continue;
                        }

                        logger.info("Sending notification to additional recipient: {}", trimmedEmail);
                        String adminEmailBody = buildAdminNotificationBody(
                                audience.getCampaignName(),
                                userForNotification.getFullName(),
                                userForNotification.getEmail(),
                                customFieldsForEmail);

                        logger.info("No template found, sending default admin notification to: {}", trimmedEmail);
                        logger.info("Default admin email body: {}", adminEmailBody);

                        // Send default HTML email for admin
                        GenericEmailRequest adminEmailRequest = new GenericEmailRequest();
                        adminEmailRequest.setTo(trimmedEmail);
                        adminEmailRequest.setSubject("New Lead Submitted - " + audience.getCampaignName());
                        adminEmailRequest.setBody(adminEmailBody);

                        try {
                            notificationService.sendGenericHtmlMailViaUnified(adminEmailRequest,
                                    instituteIdForNotification);
                            logger.info("Sent default admin notification to: {}", trimmedEmail);
                        } catch (Exception ex) {
                            logger.error("Failed to send admin notification to {}: {}", trimmedEmail, ex.getMessage());
                        }
                    }
                }

                return savedResponse.getId();

            }
        } catch (Exception e) {
            logger.error("Error creating user in auth_service: {}", e.getMessage());

        }
        return "Error in submitting the response";

    }

    /**
     * Manual counsellor (lead owner) assignment for a lead — used by CSV/bulk import
     * where each row may carry its own owner. Writes user_lead_profile.assigned_counselor_id
     * and assigned_counselor_name (the fields the leads table renders) via the same service
     * the manual-assign UI uses. Looks the display name up from auth_service when the caller
     * didn't supply one, so the Counsellor column shows a name rather than "Unassigned".
     * Also sends the standard new-lead bell alert to the owner ({@code leadName} /
     * {@code campaignName} just flavour the alert text; both may be null).
     */
    private void assignManualCounsellor(String leadUserId, String instituteId,
            String counsellorId, String counsellorName, String leadName, String campaignName) {
        assignManualCounsellor(leadUserId, instituteId, counsellorId, counsellorName, leadName, campaignName, true);
    }

    /** As above; {@code notify} false skips the new-lead bell. */
    private void assignManualCounsellor(String leadUserId, String instituteId,
            String counsellorId, String counsellorName, String leadName, String campaignName,
            boolean notify) {
        if (!StringUtils.hasText(leadUserId) || !StringUtils.hasText(counsellorId)) {
            return;
        }
        String name = counsellorName;
        if (!StringUtils.hasText(name)) {
            try {
                List<UserDTO> fetched = authService
                        .getUsersFromAuthServiceByUserIds(List.of(counsellorId));
                if (!fetched.isEmpty() && fetched.get(0) != null) {
                    name = fetched.get(0).getFullName();
                }
            } catch (Exception e) {
                logger.warn("Could not fetch counsellor name for {}: {}", counsellorId, e.getMessage());
            }
        }
        userLeadProfileService.assignCounselor(leadUserId, instituteId, counsellorId, name);

        // Bell notification to the new owner — mirrors the pool auto-assign
        // alert so a bulk-imported lead owner hears about their lead too.
        // Best-effort inside the notifier; never fails the import row.
        if (notify) {
            leadAssignmentNotifier.notifyAssigned(instituteId, counsellorId, leadName, campaignName, leadUserId);
        }
    }

    /**
     * Pool-based counsellor assignment for a freshly-created lead — the single place every
     * pool-routed intake path (manual / audience-side submit, course-catalogue, v2, and all
     * form webhooks incl. Facebook/Meta) calls, so a new lead channel only has to invoke this
     * one method to get an owner. A manually supplied counsellor wins; otherwise we fall back
     * to the campaign's counselor pool (ROUND_ROBIN / TIME_BASED). Audiences not in any pool,
     * MANUAL pools, or lists set to on-demand assignment ({@code assign_on_intake=false}, the
     * AI-first case where the bot must call before anyone owns the lead) leave the lead
     * unassigned. All failures are swallowed — assignment must never break lead intake.
     *
     * NOTE: enquiry / walk-in leads use a SEPARATE assignment system ({@code linkCounsellorToEnquiry}
     * → LinkedUsers + enquiry flag) and must NOT call this, or they'd be double-assigned.
     * This helper is an interim de-duplication step; the fuller refactor is a single
     * LeadIntakeService that owns save + score + assign so a channel can't forget to call it.
     */
    private void autoAssignCounsellorOnIntake(AudienceResponse savedResponse, String leadUserId,
            String instituteId, String manualCounsellorId, String manualCounsellorName,
            String leadFullName, String campaignName) {
        if (savedResponse == null || !StringUtils.hasText(leadUserId)) {
            return;
        }
        // Manual counsellor (e.g. a CSV import or a form that carries a chosen owner) wins.
        if (StringUtils.hasText(manualCounsellorId)) {
            try {
                assignManualCounsellor(leadUserId, instituteId, manualCounsellorId,
                        manualCounsellorName, leadFullName, campaignName);
            } catch (Exception e) {
                logger.error("Failed to assign manual counsellor for response {}: {}",
                        savedResponse.getId(), e.getMessage());
            }
            return;
        }
        // Pool auto-assignment. The name lookup mirrors the manual-assign UI so the Counsellor
        // column renders a name (an id without a name shows up as Unassigned).
        try {
            counselorAssignmentService.assignCounselorOnIntake(savedResponse.getAudienceId())
                    .ifPresent(counselorUserId -> {
                        String counselorName = null;
                        try {
                            List<UserDTO> fetched = authService
                                    .getUsersFromAuthServiceByUserIds(List.of(counselorUserId));
                            if (!fetched.isEmpty() && fetched.get(0) != null) {
                                counselorName = fetched.get(0).getFullName();
                            }
                        } catch (Exception nameLookupFailure) {
                            logger.warn("Could not fetch counselor name for {}: {}",
                                    counselorUserId, nameLookupFailure.getMessage());
                        }
                        userLeadProfileService.assignCounselor(
                                leadUserId, instituteId, counselorUserId, counselorName);
                    });
        } catch (Exception e) {
            logger.error("Failed to auto-assign counselor for response {}: {}",
                    savedResponse.getId(), e.getMessage());
        }
    }

    /**
     * Counsellor assignment for a lead intake, aware of the repeat-lead policy
     * (LEAD_SETTING.data.dedup.repeatLead) when the submission matched an existing lead
     * under the "Allow & reassign" dedup action. An explicit per-submission counsellor
     * (e.g. a CSV row's owner column) always wins — it's a stronger, more specific signal
     * than the general repeat-lead policy — regardless of repeat-lead status.
     *
     * @param repeatLeadSettings null for a first-time lead (unchanged prior behaviour);
     *                           non-null when this submission matched an existing lead and
     *                           the institute's dedup action is ALLOW_REASSIGN.
     */
    private void applyCounsellorAssignment(LeadDedupSettingService.RepeatLeadSettings repeatLeadSettings,
            AudienceResponse savedResponse, String leadUserId, String instituteId,
            String requestManualCounsellorId, String requestManualCounsellorName,
            String leadFullName, String campaignName) {
        if (StringUtils.hasText(requestManualCounsellorId)) {
            autoAssignCounsellorOnIntake(savedResponse, leadUserId, instituteId,
                    requestManualCounsellorId, requestManualCounsellorName, leadFullName, campaignName);
            return;
        }
        if (repeatLeadSettings == null) {
            autoAssignCounsellorOnIntake(savedResponse, leadUserId, instituteId, null, null,
                    leadFullName, campaignName);
            return;
        }
        switch (repeatLeadSettings.counsellorMode()) {
            case NONE -> {
                try {
                    userLeadProfileService.assignCounselor(leadUserId, instituteId, null, null);
                } catch (Exception e) {
                    logger.error("Failed to clear repeat-lead counsellor for user {}: {}",
                            leadUserId, e.getMessage());
                }
            }
            case SAME_AS_PREVIOUS -> assignPreviousCounsellor(savedResponse, leadUserId, instituteId,
                    leadFullName, campaignName, !repeatLeadSettings.reattempt().notifyOwner());
            case SPECIFIC -> autoAssignCounsellorOnIntake(savedResponse, leadUserId, instituteId,
                    repeatLeadSettings.specificCounsellorId(), repeatLeadSettings.specificCounsellorName(),
                    leadFullName, campaignName);
            case ROUND_ROBIN -> autoAssignCounsellorOnIntake(savedResponse, leadUserId, instituteId, null, null,
                    leadFullName, campaignName);
        }
    }

    /**
     * The lead's person record. Under phone dedup with "Allow & reassign" and the Lead
     * Settings switch repeatLead.samePersonByPhone on, a repeat joins the person who already
     * holds this phone: auth_service matches people by email, so a repeat
     * with a new email would otherwise become a second person, a second lead and often a
     * second owner. The submission's own name, email and phone are kept on the returned DTO,
     * so this request's notifications go where they always did.
     *
     * <p>Kept exactly as before (create or fetch by email, no credentials email) when it is
     * not such a repeat, the lookup fails, the person already has a lead in this same list
     * (a repeat there still comes in as its own lead), or the request names a counsellor
     * other than the person's current owner (so intake never moves an owned lead).
     */
    private UserDTO resolveLeadUser(UserDTO userDTO, String instituteId, String audienceId,
            boolean repeatLead, String requestedCounsellorId) {
        if (repeatLead && userDTO != null) {
            try {
                String existingId = leadDeduplicationService
                        .findExistingLeadUserIdByPhone(instituteId, audienceId, userDTO.getMobileNumber())
                        .orElse(null);
                if (existingId != null && canJoinExistingPerson(existingId, instituteId, audienceId,
                        requestedCounsellorId)) {
                    List<UserDTO> found = authService.getUsersFromAuthServiceByUserIds(List.of(existingId));
                    UserDTO existing = found == null ? null : found.stream()
                            .filter(u -> u != null && existingId.equals(u.getId()))
                            .findFirst().orElse(null);
                    if (existing != null) {
                        if (StringUtils.hasText(userDTO.getEmail())) existing.setEmail(userDTO.getEmail());
                        if (StringUtils.hasText(userDTO.getFullName())) existing.setFullName(userDTO.getFullName());
                        if (StringUtils.hasText(userDTO.getMobileNumber())) {
                            existing.setMobileNumber(userDTO.getMobileNumber());
                        }
                        logger.info("Repeat lead for audience {} joins existing person {} by phone",
                                audienceId, existingId);
                        return existing;
                    }
                }
            } catch (Exception e) {
                logger.warn("Repeat lead for audience {}: person lookup by phone failed, creating by email: {}",
                        audienceId, e.getMessage());
            }
        }
        return authService.createUserFromAuthService(userDTO, instituteId, false);
    }

    /**
     * Whether a repeat may join {@code existingId}: not when that person already has a lead
     * in this list, and not when the request names a counsellor other than their owner.
     */
    private boolean canJoinExistingPerson(String existingId, String instituteId, String audienceId,
            String requestedCounsellorId) {
        if (audienceResponseRepository.existsByAudienceIdAndUserId(audienceId, existingId)) {
            return false;
        }
        if (!StringUtils.hasText(requestedCounsellorId)) {
            return true;
        }
        String owner = userLeadProfileRepository.findByUserIdAndInstituteId(existingId, instituteId)
                .map(p -> p.getAssignedCounselorId())
                .orElse(null);
        return !StringUtils.hasText(owner) || owner.equals(requestedCounsellorId);
    }

    /**
     * Repeat-lead SAME_AS_PREVIOUS: the repeat goes to the counsellor who owned the matched
     * earlier lead.
     * <ul>
     *   <li>Same person record that already has an owner (repeat with the same email) —
     *       left untouched, as before.</li>
     *   <li>Otherwise (typically a phone match carrying a new email, which creates a new
     *       user with an ownerless profile) — copy the owner of the most recent matched
     *       lead, as long as they are still an active counsellor.</li>
     *   <li>No usable previous owner — fall back to the list's pool, so a repeat lead never
     *       arrives unowned.</li>
     * </ul>
     * Failures are swallowed like every other assignment step.
     */
    private void assignPreviousCounsellor(AudienceResponse savedResponse, String leadUserId,
            String instituteId, String leadFullName, String campaignName, boolean notifyNewLead) {
        try {
            boolean alreadyOwned = userLeadProfileRepository.findByUserIdAndInstituteId(leadUserId, instituteId)
                    .map(p -> StringUtils.hasText(p.getAssignedCounselorId()))
                    .orElse(false);
            if (alreadyOwned) {
                return;
            }
        } catch (Exception e) {
            // Can't tell whether the lead is already owned, so don't risk replacing an owner.
            logger.error("Repeat lead {}: profile lookup failed, leaving the counsellor untouched: {}",
                    savedResponse.getId(), e.getMessage());
            return;
        }
        String previousCounsellorId = null;
        try {
            previousCounsellorId = leadDeduplicationService.findPreviousCounsellorId(instituteId,
                    savedResponse.getAudienceId(), savedResponse.getParentEmail(),
                    savedResponse.getParentMobile(), savedResponse.getId()).orElse(null);
            if (previousCounsellorId != null) {
                // An owner whose counsellor role was removed would make the lead invisible to
                // every counsellor. An empty roster means the lookup failed, so trust the owner.
                List<String> activeCounsellors = counsellorScopeService.allCounsellorUserIds(instituteId);
                if (!activeCounsellors.isEmpty() && !activeCounsellors.contains(previousCounsellorId)) {
                    logger.info("Repeat lead {}: previous counsellor {} is no longer active, using the pool",
                            savedResponse.getId(), previousCounsellorId);
                    previousCounsellorId = null;
                }
            }
        } catch (Exception e) {
            logger.error("Repeat lead {}: previous counsellor lookup failed: {}",
                    savedResponse.getId(), e.getMessage());
            previousCounsellorId = null;
        }
        if (previousCounsellorId != null && !notifyNewLead) {
            // The owner hears about this lead from the reattempt bell (recordReattempt), so no
            // "new lead" bell for a lead that is not new to them.
            try {
                assignManualCounsellor(leadUserId, instituteId, previousCounsellorId, null,
                        leadFullName, campaignName, false);
            } catch (Exception e) {
                logger.error("Repeat lead {}: failed to assign previous counsellor {}: {}",
                        savedResponse.getId(), previousCounsellorId, e.getMessage());
            }
            return;
        }
        autoAssignCounsellorOnIntake(savedResponse, leadUserId, instituteId, previousCounsellorId, null,
                leadFullName, campaignName);
    }

    /**
     * Repeat-lead status handling (LEAD_SETTING.data.dedup.repeatLead.statusMode).
     * KEEP_EXISTING (or no repeat-lead settings) does nothing — status is never touched.
     * RESET_TO_NEW resets the lead's profile-level conversion status back to "LEAD" (the
     * platform's default/new-lead status), which mirrors onto every audience_response row
     * for that user via {@link UserLeadProfileService#updateConversionStatus}.
     * RESET_CLOSED_TO_NEW resets only when the lead this enquiry repeats is closed (converted
     * or LOST) or no active one is left; a lead still being worked keeps its status. A
     * failed lookup leaves the status untouched.
     *
     * @param savedResponse the repeat enquiry, excluded from the "lead it repeats" lookup
     * @param email the submission's email, as passed to the dedup check
     * @param phone the submission's phone, as passed to the dedup check
     */
    private void applyRepeatLeadStatus(LeadDedupSettingService.RepeatLeadSettings repeatLeadSettings,
            String leadUserId, String instituteId, AudienceResponse savedResponse, String email, String phone) {
        if (repeatLeadSettings == null) {
            return;
        }
        LeadDedupSettingService.StatusMode mode = repeatLeadSettings.statusMode();
        if (mode == LeadDedupSettingService.StatusMode.RESET_CLOSED_TO_NEW) {
            if (savedResponse == null || savedResponse.getId() == null) {
                return;
            }
            try {
                boolean earlierLeadOpen = leadDeduplicationService.findPrimaryLead(instituteId,
                                savedResponse.getAudienceId(), email, phone, savedResponse.getId())
                        .map(p -> isOpenLeadStatus(p.getStatusKey()))
                        .orElse(false);
                if (earlierLeadOpen) {
                    return;
                }
            } catch (Exception e) {
                logger.error("Repeat lead {}: could not tell whether the earlier lead is open, status kept: {}",
                        savedResponse.getId(), e.getMessage());
                return;
            }
        } else if (mode != LeadDedupSettingService.StatusMode.RESET_TO_NEW) {
            return;
        }
        try {
            userLeadProfileService.updateConversionStatus(leadUserId, instituteId, "LEAD", "SYSTEM");
        } catch (Exception e) {
            logger.error("Failed to reset repeat-lead status for user {}: {}", leadUserId, e.getMessage());
        }
    }

    /**
     * What a repeat enquiry leaves behind (LEAD_SETTING.data.dedup.repeatLead.reattempt),
     * each part behind its own switch: flag this enquiry as a duplicate of the lead it
     * repeats, a "Reattempt" entry in that lead's journey, a bell to the counsellor who owns
     * it (not when that counsellor added the enquiry themselves), the lead's tier set to the
     * configured one (e.g. Very Hot), and a priority follow-up for the counsellor that the
     * Follow-ups page lists first. Does nothing for a first-time lead, with every switch off,
     * or when no active lead is found to repeat. Callers run it before the repeat-lead status
     * reset, so "is the earlier lead still open" reads its status from before this enquiry.
     * Best-effort like the other intake steps: a failure is logged and never fails intake.
     *
     * @param email the submission's email, as passed to the dedup check
     * @param phone the submission's phone, as passed to the dedup check
     */
    private void recordReattempt(LeadDedupSettingService.RepeatLeadSettings repeatLeadSettings,
            AudienceResponse savedResponse, String leadUserId, String instituteId, String email,
            String phone, String leadName, String campaignName) {
        if (repeatLeadSettings == null || savedResponse == null || savedResponse.getId() == null) {
            return;
        }
        LeadDedupSettingService.ReattemptSettings reattempt = repeatLeadSettings.reattempt();
        if (!reattempt.anyIntakeAction()) {
            return;
        }
        AudienceResponseRepository.PrimaryLeadRow primary;
        try {
            primary = leadDeduplicationService.findPrimaryLead(instituteId, savedResponse.getAudienceId(),
                    email, phone, savedResponse.getId()).orElse(null);
        } catch (Exception e) {
            logger.error("Repeat lead {}: lookup of the lead it repeats failed: {}",
                    savedResponse.getId(), e.getMessage());
            return;
        }
        if (primary == null || !StringUtils.hasText(primary.getResponseId())) {
            return;
        }
        String sourceLabel = reattemptSourceLabel(savedResponse.getSourceType());

        if (reattempt.markDuplicate() && (!reattempt.duplicateOpenOnly() || isOpenLeadStatus(primary.getStatusKey()))) {
            try {
                audienceResponseRepository.markDuplicateOf(savedResponse.getId(), primary.getResponseId());
            } catch (Exception e) {
                logger.error("Repeat lead {}: failed to flag as duplicate of {}: {}",
                        savedResponse.getId(), primary.getResponseId(), e.getMessage());
            }
        }
        if (reattempt.journeyEntry()) {
            try {
                leadDeduplicationService.logReattempt(primary, savedResponse, sourceLabel, campaignName);
            } catch (Exception e) {
                logger.error("Repeat lead {}: failed to log the reattempt on {}: {}",
                        savedResponse.getId(), primary.getResponseId(), e.getMessage());
            }
        }
        if (reattempt.tier() != null) {
            applyReattemptTier(reattempt.tier(), savedResponse.getId(), instituteId, primary.getUserId(), leadUserId);
        }

        // The counsellor who owns the repeat after assignment (the previous owner under
        // SAME_AS_PREVIOUS); the lead it repeats' owner when that lookup has nothing.
        String ownerId = null;
        if (reattempt.notifyOwner() || reattempt.followUp()) {
            try {
                if (StringUtils.hasText(leadUserId)) {
                    ownerId = userLeadProfileRepository.findByUserIdAndInstituteId(leadUserId, instituteId)
                            .map(p -> p.getAssignedCounselorId())
                            .filter(StringUtils::hasText)
                            .orElse(null);
                }
            } catch (Exception e) {
                logger.error("Repeat lead {}: owner lookup failed: {}", savedResponse.getId(), e.getMessage());
            }
            if (ownerId == null && StringUtils.hasText(primary.getCounsellorId())) {
                ownerId = primary.getCounsellorId();
            }
        }

        if (reattempt.followUp()) {
            openReattemptFollowUp(primary.getResponseId(), instituteId, ownerId, sourceLabel, campaignName,
                    savedResponse.getId());
        }

        if (reattempt.notifyOwner() && ownerId != null && !ownerId.equals(savedResponse.getCreatedByUserId())) {
            try {
                leadAssignmentNotifier.notifyReattempt(instituteId, ownerId, leadName, sourceLabel,
                        campaignName, leadUserId);
            } catch (Exception e) {
                logger.error("Repeat lead {}: failed to notify the owner: {}",
                        savedResponse.getId(), e.getMessage());
            }
        }
    }

    /** A lead still being worked: not converted and not LOST (Discarded). */
    static boolean isOpenLeadStatus(String statusKey) {
        if (!StringUtils.hasText(statusKey)) return true;
        String key = statusKey.trim().toUpperCase();
        return !"CONVERTED".equals(key) && !"LOST".equals(key);
    }

    /**
     * Sets the reattempt tier (Interest Level) on the person behind the lead it repeats and,
     * when the repeat came in as a different person, on that one too. An unknown or deleted
     * tier key is skipped up front: updateLeadTier would throw inside the intake transaction.
     */
    private void applyReattemptTier(String tier, String repeatResponseId, String instituteId,
            String primaryUserId, String leadUserId) {
        try {
            if (!leadTierService.isKnownTier(instituteId, tier)) {
                logger.warn("Repeat lead {}: reattempt tier {} is not a tier of institute {}, skipped",
                        repeatResponseId, tier, instituteId);
                return;
            }
            Set<String> userIds = new LinkedHashSet<>();
            if (StringUtils.hasText(primaryUserId)) userIds.add(primaryUserId);
            if (StringUtils.hasText(leadUserId)) userIds.add(leadUserId);
            for (String userId : userIds) {
                userLeadProfileService.updateLeadTier(userId, instituteId, tier);
            }
        } catch (Exception e) {
            logger.error("Repeat lead {}: failed to set tier {}: {}", repeatResponseId, tier, e.getMessage());
        }
    }

    /**
     * A follow-up due now on the lead a repeat enquiry repeats, for its counsellor, flagged
     * priority so the Follow-ups page lists the lead first. One open priority follow-up per
     * lead: a second reattempt before it is closed adds nothing.
     */
    private void openReattemptFollowUp(String primaryResponseId, String instituteId, String ownerId,
            String sourceLabel, String campaignName, String repeatResponseId) {
        try {
            if (leadFollowupRepository.existsByAudienceResponseIdAndIsClosedFalseAndIsPriorityTrue(primaryResponseId)) {
                return;
            }
            StringBuilder content = new StringBuilder("Reattempt: enquired again");
            if (StringUtils.hasText(sourceLabel)) content.append(" via ").append(sourceLabel);
            if (StringUtils.hasText(campaignName)) content.append(" · ").append(campaignName);
            leadFollowupRepository.save(LeadFollowup.builder()
                    .audienceResponseId(primaryResponseId)
                    .instituteId(instituteId)
                    .createdBy(ownerId)
                    .scheduleTime(new Timestamp(System.currentTimeMillis()))
                    .content(content.toString())
                    .isPriority(true)
                    .build());
        } catch (Exception e) {
            logger.error("Repeat lead {}: failed to open the priority follow-up on {}: {}",
                    repeatResponseId, primaryResponseId, e.getMessage());
        }
    }

    /**
     * Lead-list duplicate filter from the sidebar route: EXCLUDE hides enquiries flagged as
     * duplicates (so a repeat does not add to All Leads), ONLY lists just them (a Duplicate
     * Leads tab). Anything else is no filter.
     */
    static String normalizeDuplicateFilter(String duplicateFilter) {
        if (!StringUtils.hasText(duplicateFilter)) return null;
        String value = duplicateFilter.trim().toUpperCase();
        return "EXCLUDE".equals(value) || "ONLY".equals(value) ? value : null;
    }

    /** Readable channel name for a lead's source_type, for reattempt journey and bell text. */
    static String reattemptSourceLabel(String sourceType) {
        if (!StringUtils.hasText(sourceType)) return null;
        return switch (sourceType.trim().toUpperCase()) {
            case "META_LEAD_ADS", "FACEBOOK", "FACEBOOK_LEAD_ADS" -> "Meta Lead Ads";
            case "GOOGLE_LEAD_ADS", "GOOGLE_ADS" -> "Google Ads";
            case "AUDIENCE_CAMPAIGN", "WEBSITE" -> "website form";
            case "WALK_IN" -> "manual entry";
            default -> {
                String words = sourceType.trim().replace('_', ' ').toLowerCase();
                yield Character.toUpperCase(words.charAt(0)) + words.substring(1);
            }
        };
    }

    /**
     * Resolve an optional pipeline lead status key to a lead_status.id within the institute.
     * Returns null when the key is blank or no matching status exists for the institute, in
     * which case the lead is created without a pipeline status (unchanged prior behaviour).
     */
    private String resolveLeadStatusId(String instituteId, String leadStatusKey) {
        if (!StringUtils.hasText(instituteId) || !StringUtils.hasText(leadStatusKey)) {
            return null;
        }
        return leadStatusRepository
                .findByInstituteIdAndStatusKey(instituteId, leadStatusKey.trim())
                .map(s -> s.getId())
                .orElseGet(() -> {
                    logger.warn("Lead status key '{}' not found for institute {}; leaving lead status unset",
                            leadStatusKey, instituteId);
                    return null;
                });
    }

    /**
     * Submit a lead with workflow integration (v2)
     * Email sending is handled by workflow engine
     */
    @Transactional
    public String submitLeadV2(SubmitLeadRequestDTO requestDTO) {
        logger.info("[V2] Submitting lead for audience: {}", requestDTO.getAudienceId());

        // Validate audience exists
        Audience audience = audienceRepository.findById(requestDTO.getAudienceId())
                .orElseThrow(() -> new VacademyException("Audience not found"));

        // Validate audience is active
        if (!"ACTIVE".equals(audience.getStatus())) {
            throw new VacademyException("Audience campaign is not active");
        }

        String instituteId = audience.getInstituteId();

        // 1. Create/fetch user from auth_service
        String userId = null;
        UserDTO createdUser = null;
        try {
            UserDTO userDTO = requestDTO.getUserDTO();
            LeadDedupSettingService.RepeatLeadSettings repeatLeadSettings = null;
            if (userDTO != null && StringUtils.hasText(userDTO.getEmail())) {
                // Institute-configured dedup (LEAD_SETTING.data.dedup) — checked before creating
                // the auth user so a REJECTed lead never creates an orphan account. ALLOW_REASSIGN
                // lets the lead through and carries the repeat-lead settings to apply below.
                java.util.Optional<LeadDeduplicationService.DuplicateMatch> dupMatch = leadDeduplicationService
                        .checkDuplicate(instituteId, requestDTO.getAudienceId(), userDTO.getEmail(),
                                userDTO.getMobileNumber());
                if (dupMatch.isPresent()) {
                    if (dupMatch.get().action() == LeadDedupSettingService.DedupAction.REJECT) {
                        return dupMatch.get().rejectionMessage();
                    }
                    repeatLeadSettings = dupMatch.get().repeatLeadSettings();
                }

                // Call auth_service to create or fetch existing user
                // sendCred = false (no email notification)
                createdUser = resolveLeadUser(userDTO, audience.getInstituteId(),
                        requestDTO.getAudienceId(), repeatLeadSettings != null, requestDTO.getCounsellorId());
                userId = createdUser.getId();

                // Duplicate submission guard: same audience + same user
                if (StringUtils.hasText(userId) &&
                        audienceResponseRepository.existsByAudienceIdAndUserId(requestDTO.getAudienceId(), userId)) {
                    // Revive a soft-deleted lead instead of blackholing the resubmission.
                    reactivateSoftDeletedLeads(requestDTO.getAudienceId(), userId);
                    return "You have already submitted your response for this campaign";
                }

                // 2. Create audience response with user_id
                AudienceResponse response = AudienceResponse.builder()
                        .audienceId(requestDTO.getAudienceId())
                        .sourceType(requestDTO.getSourceType())
                        .sourceId(requestDTO.getSourceId())
                        .userId(userId)
                        .parentEmail(userDTO.getEmail())
                        .parentMobile(truncateForParentMobileColumn(userDTO.getMobileNumber()))
                        .workflowActivateDayAt(calculateWorkflowActivateDayAt(audience))
                        .initialScore(audience.getDefaultInitialScore())
                        .build();

                AudienceResponse savedResponse = audienceResponseRepository.save(response);
                logger.info("[V2] Saved audience response with ID: {} and user_id: {}",
                        savedResponse.getId(), userId);
                logLeadSubmitted(savedResponse);

                // 3. Save custom field values
                if (!CollectionUtils.isEmpty(requestDTO.getCustomFieldValues())) {
                    saveCustomFieldValues(
                            savedResponse.getId(),
                            requestDTO.getCustomFieldValues(),
                            audience.getInstituteId(),
                            audience.getId());
                }

                // 3b. Calculate initial lead score (real-time).
                // Same fix as v1 submitLead — without this, no LeadScore row is created
                // and the user's profile shows campaign_count=0, best_score=0.
                try {
                    leadScoringService.calculateAndSaveScore(
                            savedResponse.getId(),
                            savedResponse.getAudienceId(),
                            instituteId,
                            savedResponse.getSourceType(),
                            savedResponse.getEnquiryId());
                } catch (Exception e) {
                    logger.error("[V2] Failed to calculate initial lead score for response {}: {}",
                            savedResponse.getId(), e.getMessage());
                    // Non-blocking
                }

                // 3c. Counsellor assignment — manual owner wins, else pool auto-assign or the
                // repeat-lead policy. Same centralised path as v1 submitLead.
                applyCounsellorAssignment(repeatLeadSettings, savedResponse, userId, instituteId,
                        requestDTO.getCounsellorId(), requestDTO.getCounsellorName(),
                        createdUser.getFullName(), audience.getCampaignName());
                recordReattempt(repeatLeadSettings, savedResponse, userId, instituteId,
                        userDTO.getEmail(), userDTO.getMobileNumber(),
                        createdUser.getFullName(), audience.getCampaignName());
                applyRepeatLeadStatus(repeatLeadSettings, userId, instituteId, savedResponse,
                        userDTO.getEmail(), userDTO.getMobileNumber());

                // 4. Build custom field map for email (to pass to workflow)
                Map<String, String> customFieldsForEmail = buildCustomFieldMapForEmail(savedResponse.getId());

                // Get current time with timezone
                java.time.ZonedDateTime now = java.time.ZonedDateTime.now();
                java.time.format.DateTimeFormatter formatter = java.time.format.DateTimeFormatter
                        .ofPattern("MMM dd, yyyy hh:mm a z");
                String submissionTime = now.format(formatter);

                // 5. Generate complete email content (SIMPLIFIED APPROACH)
                // Build default respondent email body
                String respondentEmailBody = buildDefaultEmailBody(
                        audience.getCampaignName(),
                        createdUser.getFullName(),
                        createdUser.getEmail(),
                        customFieldsForEmail);
                String respondentEmailSubject = "Thank You for Submitting Your Response for Campaign - "
                        + audience.getCampaignName();

                // Build admin notification email body
                String adminEmailBody = buildAdminNotificationBody(
                        audience.getCampaignName(),
                        createdUser.getFullName(),
                        createdUser.getEmail(),
                        customFieldsForEmail);
                String adminEmailSubject = "New Lead Submitted - " + audience.getCampaignName();

                logger.info("[V2] Generated default email bodies for workflow");

                // 6. Parse admin notification recipients (toNotify)
                List<String> adminEmails = new ArrayList<>();
                if (StringUtils.hasText(audience.getToNotify())) {
                    String[] emails = audience.getToNotify().split(",");
                    for (String email : emails) {
                        String trimmedEmail = email.trim();
                        if (StringUtils.hasText(trimmedEmail)) {
                            adminEmails.add(trimmedEmail);
                        }
                    }
                    logger.info("[V2] Found {} admin notification recipients", adminEmails.size());
                }

                // 7. Build audience DTO for workflow context
                AudienceDTO audienceDTO = AudienceDTO.builder()
                        .id(audience.getId())
                        .campaignName(audience.getCampaignName())
                        .instituteId(audience.getInstituteId())
                        .status(audience.getStatus())
                        .toNotify(audience.getToNotify())
                        .sendRespondentEmail(audience.getSendRespondentEmail())
                        .build();

                // 8. Prepare context data for workflow (SIMPLIFIED)
                Map<String, Object> contextData = new HashMap<>();

                // User and audience data
                contextData.put("user", createdUser); // UserDTO object
                contextData.put("audience", audienceDTO); // Audience details
                contextData.put("audienceId", requestDTO.getAudienceId());
                contextData.put("instituteId", instituteId);
                contextData.put("instituteName",
                        instituteRepository.findById(instituteId).map(Institute::getInstituteName).orElse(""));
                contextData.put("customFields", customFieldsForEmail); // Map of custom field name -> value
                contextData.put("submissionTime", submissionTime);
                contextData.put("responseId", savedResponse.getId());
                // Lead-grain identity the CALL_AI / SEND_WHATSAPP nodes read directly off
                // the context (phone/parentMobile + userId/leadUserId) — so they don't
                // depend on downstream responseId resolution and other lead nodes have a
                // recipient. Mirrors the keys the CALL_AI node looks up.
                contextData.put("userId", savedResponse.getUserId());
                contextData.put("leadUserId", savedResponse.getUserId());
                contextData.put("phone", savedResponse.getParentMobile());
                contextData.put("parentMobile", savedResponse.getParentMobile());
                contextData.put("campaignName", audience.getCampaignName());

                // Email sending configuration
                contextData.put("sendRespondentEmail",
                        audience.getSendRespondentEmail() == null || audience.getSendRespondentEmail());

                // Prepare respondent email request (List with single Map)
                List<Map<String, Object>> respondentEmailRequests = new ArrayList<>();
                Map<String, Object> respondentEmailRequest = new HashMap<>();
                respondentEmailRequest.put("to", createdUser.getEmail());
                respondentEmailRequest.put("subject", respondentEmailSubject);
                respondentEmailRequest.put("body", respondentEmailBody);
                respondentEmailRequests.add(respondentEmailRequest);
                contextData.put("respondentEmailRequests", respondentEmailRequests);

                logger.info("[V2] Prepared respondent email request: to={}, subject={}",
                        createdUser.getEmail(), respondentEmailSubject);

                // Prepare admin email requests (List of Maps, one per admin)
                List<Map<String, Object>> adminEmailRequests = new ArrayList<>();
                for (String adminEmail : adminEmails) {
                    Map<String, Object> adminEmailRequest = new HashMap<>();
                    adminEmailRequest.put("to", adminEmail);
                    adminEmailRequest.put("subject", adminEmailSubject);
                    adminEmailRequest.put("body", adminEmailBody);
                    adminEmailRequests.add(adminEmailRequest);
                }
                contextData.put("adminEmailRequests", adminEmailRequests);

                logger.info("[V2] Prepared {} admin email requests", adminEmailRequests.size());
                for (Map<String, Object> req : adminEmailRequests) {
                    logger.info("  - Admin email to: {}, subject: {}", req.get("to"), req.get("subject"));
                }

                logger.info(
                        "[V2] Triggering workflow for AUDIENCE_LEAD_SUBMISSION event. AudienceId: {}, InstituteId: {}, SendRespondentEmail: {}, AdminEmails: {}",
                        requestDTO.getAudienceId(), instituteId,
                        audience.getSendRespondentEmail() == null || audience.getSendRespondentEmail(),
                        adminEmails.size());

                // 9. Trigger the workflow
                workflowTriggerService.handleTriggerEvents(
                        WorkflowTriggerEvent.AUDIENCE_LEAD_SUBMISSION.name(),
                        requestDTO.getAudienceId(), // eventId (audience campaign ID)
                        instituteId,
                        contextData);

                logger.info("[V2] Workflow triggered successfully for audience: {}", requestDTO.getAudienceId());

                // Send the to_notify admin alert directly unless the workflow already has an
                // admin-notify node (otherwise adminEmailRequests has no consumer and the alert
                // is silently dropped). Guarded to avoid double-sending.
                notifyToNotifyAdminsIfWorkflowDoesNot(
                        requestDTO.getAudienceId(), instituteId, audience,
                        createdUser.getFullName(), createdUser.getEmail(),
                        customFieldsForEmail, contextData);

                return savedResponse.getId();
            }
        } catch (Exception e) {
            logger.error("[V2] Error submitting lead: {}", e.getMessage(), e);
        }

        return "Error in submitting the response";
    }

    /**
     * Submit a walk-in lead — simplified flow for events/fairs.
     * Auto-sets sourceType to WALK_IN, auto-assigns the logged-in counselor.
     * Works with zero config — no campaign settings required.
     */
    @Transactional
    public SubmitLeadWithEnquiryResponseDTO submitWalkIn(WalkInRegistrationDTO walkInDTO,
            vacademy.io.common.auth.model.CustomUserDetails user) {
        logger.info("Registering walk-in lead for audience: {}", walkInDTO.getAudienceId());

        // Build parent UserDTO
        UserDTO parentDTO = UserDTO.builder()
                .fullName(walkInDTO.getParentName())
                .mobileNumber(walkInDTO.getParentMobile())
                .email(walkInDTO.getParentEmail())
                .build();

        // Build child UserDTO
        UserDTO childDTO = UserDTO.builder()
                .fullName(walkInDTO.getChildName())
                .gender(walkInDTO.getChildGender())
                .build();

        // Convert to SubmitLeadWithEnquiryRequestDTO
        SubmitLeadWithEnquiryRequestDTO requestDTO = SubmitLeadWithEnquiryRequestDTO.builder()
                .audienceId(walkInDTO.getAudienceId())
                .sourceType("WALK_IN")
                .parentName(walkInDTO.getParentName())
                .parentEmail(walkInDTO.getParentEmail())
                .parentMobile(walkInDTO.getParentMobile())
                .destinationPackageSessionId(walkInDTO.getDestinationPackageSessionId())
                .counsellorId(user.getUserId()) // Auto-assign the logged-in user as counselor
                .parentUserDTO(parentDTO)
                .childUserDTO(childDTO)
                .build();

        SubmitLeadWithEnquiryResponseDTO response = submitLeadWithEnquiry(requestDTO);

        // Log walk-in timeline event with notes if provided
        if (walkInDTO.getNotes() != null && !walkInDTO.getNotes().isBlank()
                && response.getAudienceResponseId() != null) {
            try {
                timelineEventService.logEvent(
                        "AUDIENCE_RESPONSE", response.getAudienceResponseId(),
                        "WALK_IN_NOTE", "COUNSELOR", user.getUserId(), user.getUsername(),
                        "Walk-in Note", walkInDTO.getNotes(), null);
            } catch (Exception e) {
                logger.warn("Could not log walk-in notes to timeline: {}", e.getMessage());
            }
        }

        logger.info("Walk-in lead registered successfully: {}", response.getAudienceResponseId());
        return response;
    }

    /**
     * Get lead score for a specific AudienceResponse.
     * Returns default score if none calculated yet.
     */
    public LeadScoreDTO getLeadScore(String responseId) {
        return leadScoreRepository
                .findByAudienceResponseId(responseId)
                .map(score -> {
                    Object factors = null;
                    if (score.getScoringFactorsJson() != null) {
                        try {
                            ObjectMapper om = new ObjectMapper();
                            factors = om.readValue(score.getScoringFactorsJson(), Object.class);
                        } catch (Exception e) {
                            logger.warn("Could not parse scoring factors JSON", e);
                        }
                    }
                    return LeadScoreDTO.builder()
                            .audienceResponseId(responseId)
                            .rawScore(score.getRawScore())
                            .tier(leadTierService.deriveTier(score.getInstituteId(), score.getRawScore()))
                            .percentileRank(score.getPercentileRank())
                            .scoringFactors(factors)
                            .lastCalculatedAt(score.getLastCalculatedAt())
                            .isManualOverride(Boolean.TRUE.equals(score.getIsManualOverride()))
                            .build();
                })
                .orElse(LeadScoreDTO.builder()
                        .audienceResponseId(responseId)
                        .rawScore(0)
                        .tier(leadTierService.deriveTier(
                                audienceResponseRepository.findById(responseId)
                                        .map(AudienceResponse::getAudienceId)
                                        .flatMap(audienceRepository::findById)
                                        .map(Audience::getInstituteId)
                                        .orElse(null),
                                0))
                        .build());
    }

    /**
     * Manually set the score for a lead. Pass null to clear the override and
     * restore calculated score.
     * Writes directly to raw_score so the score propagates everywhere (badges,
     * lists, profile).
     */
    @Transactional
    public LeadScoreDTO setManualScore(String responseId, Integer score, String actorId, String actorName) {
        if (score != null && (score < 0 || score > 100)) {
            throw new IllegalArgumentException("Score must be between 0 and 100");
        }
        LeadScore leadScore = leadScoreRepository.findByAudienceResponseId(responseId)
                .orElseThrow(() -> new RuntimeException("Lead score not found for response: " + responseId));

        Integer oldScore = leadScore.getRawScore();

        if (score != null) {
            // Distribute the manual score proportionally across all 4 factors (uniform
            // factor score = target),
            // then apply largest-remainder so contributions sum exactly to the target
            // score.
            int[] weights = { 25, 30, 25, 20 };
            String[] keys = { "source_quality", "profile_completeness", "recency", "engagement" };
            int[] contributions = new int[4];
            double[] remainders = new double[4];
            int floorSum = 0;
            for (int i = 0; i < 4; i++) {
                double exact = score * weights[i] / 100.0;
                contributions[i] = (int) exact;
                remainders[i] = exact - contributions[i];
                floorSum += contributions[i];
            }
            Integer[] order = { 0, 1, 2, 3 };
            java.util.Arrays.sort(order, (a, b) -> Double.compare(remainders[b], remainders[a]));
            int leftover = score - floorSum;
            for (int i = 0; i < leftover; i++)
                contributions[order[i]]++;

            java.util.Map<String, Object> factors = new java.util.LinkedHashMap<>();
            for (int i = 0; i < 4; i++) {
                factors.put(keys[i], java.util.Map.of(
                        "score", score,
                        "weight", weights[i],
                        "contribution", contributions[i]));
            }
            String factorsJson = null;
            try {
                factorsJson = new ObjectMapper().writeValueAsString(factors);
            } catch (Exception e) {
                logger.warn("Failed to serialize manual scoring factors for response={}", responseId, e);
            }

            leadScore.setRawScore(score);
            leadScore.setScoringFactorsJson(factorsJson);
            leadScore.setIsManualOverride(true);
            leadScore.setLastCalculatedAt(new java.sql.Timestamp(System.currentTimeMillis()));
            leadScoreRepository.save(leadScore);
        } else {
            // Clear override — unlock auto-recalculation and immediately restore the
            // computed score.
            leadScore.setIsManualOverride(false);
            leadScoreRepository.save(leadScore);
            leadScoringService.recalculateScore(responseId);
        }

        // Rebuild UserLeadProfile so best_score / lead_tier propagate to all displays.
        AudienceResponse response = null;
        try {
            response = audienceResponseRepository.findById(responseId).orElse(null);
            if (response != null) {
                String userId = response.getUserId() != null ? response.getUserId() : response.getStudentUserId();
                if (userId != null) {
                    userLeadProfileService.buildOrUpdateProfile(userId, leadScore.getInstituteId());
                }
            }
        } catch (Exception e) {
            logger.warn("Failed to rebuild user_lead_profile after manual score update for response={}", responseId, e);
        }

        // Log the manual score override as a journey event.
        try {
            String title = score != null
                    ? "Score manually set to " + score
                    : "Manual score override cleared";
            java.util.Map<String, Object> meta = new java.util.LinkedHashMap<>();
            if (oldScore != null)
                meta.put("old_score", oldScore);
            if (score != null)
                meta.put("new_score", score);
            meta.put("override_active", score != null);
            if (actorName != null)
                meta.put("actor_name", actorName);
            timelineEventService.logJourneyEvent(
                    "AUDIENCE_RESPONSE", responseId,
                    LeadJourneyActionType.MANUAL_SCORE_UPDATE,
                    "ADMIN", actorId, actorName,
                    title, null,
                    meta,
                    response != null
                            ? (response.getUserId() != null ? response.getUserId() : response.getStudentUserId())
                            : null);
        } catch (Exception e) {
            logger.warn("Failed to log MANUAL_SCORE_UPDATE journey event for response={}: {}", responseId,
                    e.getMessage(), e);
        }

        return getLeadScore(responseId);
    }

    /**
     * Force recalculate all lead scores for a campaign.
     */
    @Transactional
    public void recalculateScoresForAudience(String audienceId) {
        logger.info("Force recalculating all scores for audience: {}", audienceId);
        List<AudienceResponse> responses = audienceResponseRepository.findByAudienceId(audienceId);
        for (AudienceResponse resp : responses) {
            try {
                leadScoringService.recalculateScore(resp.getId());
            } catch (Exception e) {
                logger.error("Failed to recalculate score for response {}: {}", resp.getId(), e.getMessage());
            }
        }
        // Also recalculate percentiles
        leadScoreRepository.recalculatePercentilesForAudience(audienceId);
        logger.info("Score recalculation complete for audience: {} ({} leads)", audienceId, responses.size());
    }

    /**
     * Submit a lead with enquiry information
     * Creates enquiry entry first, then links it to audience response
     */
    @Transactional
    public SubmitLeadWithEnquiryResponseDTO submitLeadWithEnquiry(SubmitLeadWithEnquiryRequestDTO requestDTO) {
        logger.info("Submitting lead with enquiry for audience: {}", requestDTO.getAudienceId());

        // STEP 1: Validate audience campaign
        Audience audience = audienceRepository.findById(requestDTO.getAudienceId())
                .orElseThrow(() -> new VacademyException("Audience not found"));

        if (!"ACTIVE".equals(audience.getStatus())) {
            throw new VacademyException("Audience campaign is not active");
        }

        String instituteId = audience.getInstituteId();

        // Institute-configured dedup (LEAD_SETTING.data.dedup) — checked before creating any
        // users so a REJECTed lead never creates orphan parent/child accounts. ALLOW_REASSIGN
        // lets it through; only statusMode applies here (counsellor assignment for walk-ins
        // goes through the separate linkCounsellorToEnquiry engine below, untouched). When
        // this setting is disabled (default), STEP 4's soft-merge dedupeKey logic is unchanged.
        LeadDedupSettingService.RepeatLeadSettings repeatLeadSettings = null;
        java.util.Optional<LeadDeduplicationService.DuplicateMatch> dupMatch = leadDeduplicationService
                .checkDuplicate(instituteId, requestDTO.getAudienceId(), requestDTO.getParentEmail(),
                        requestDTO.getParentMobile());
        if (dupMatch.isPresent()) {
            if (dupMatch.get().action() == LeadDedupSettingService.DedupAction.REJECT) {
                throw new VacademyException(dupMatch.get().rejectionMessage());
            }
            repeatLeadSettings = dupMatch.get().repeatLeadSettings();
        }

        // STEP 2: Create parent and child users using batch endpoint
        String parentUserId = null;
        String childUserId = null; // Declare at method level for use in AudienceResponse builder
        UserDTO parentUserDTO = null;
        UserDTO childUserDTO = null;

        if (requestDTO.getParentUserDTO() != null && requestDTO.getChildUserDTO() != null) {
            // Validate and prepare child user DTO (generate email/name if missing)
            UserDTO preparedChildDTO = validateAndPrepareChildUserDTO(
                    requestDTO.getChildUserDTO(),
                    requestDTO.getParentUserDTO());

            List<UserDTO> userDTOs = List.of(requestDTO.getParentUserDTO(), preparedChildDTO);
            List<UserDTO> createdUsers = authService.createMultipleUsers(userDTOs, audience.getInstituteId(), false);

            if (createdUsers.size() != 2) {
                throw new VacademyException("Expected 2 users to be created (parent and child)");
            }

            parentUserDTO = createdUsers.get(0);
            childUserDTO = createdUsers.get(1);
            parentUserId = parentUserDTO.getId();
            childUserId = childUserDTO.getId(); // Assign child user ID

            logger.info("Created parent user with ID: {} and child user with ID: {}",
                    parentUserId, childUserId);

            // Duplicate submission guard - check if this child has already been submitted
            // for this campaign
            if (StringUtils.hasText(childUserId) &&
                    audienceResponseRepository.existsByAudienceIdAndStudentUserId(requestDTO.getAudienceId(),
                            childUserId)) {
                throw new VacademyException("You have already submitted a response for this child in this campaign");
            }
        } else {
            throw new VacademyException("Both parent and child user information are required");
        }

        // STEP 3: Create Enquiry Entry
        UUID enquiryId = null;
        Enquiry enquiry = null;
        if (requestDTO.getEnquiry() != null) {
            EnquiryDTO enquiryDTO = requestDTO.getEnquiry();
            String retrievalTrackingId = enquiryDTO.getEnquiryTrackingId();
            if (retrievalTrackingId == null || retrievalTrackingId.isEmpty()) {
                retrievalTrackingId = generateCustomTrackingId();
            }

            enquiry = Enquiry.builder()
                    .checklist(enquiryDTO.getChecklist())
                    .enquiryStatus(enquiryDTO.getEnquiryStatus())
                    .convertionStatus(enquiryDTO.getConvertionStatus())
                    .referenceSource(enquiryDTO.getReferenceSource())
                    .assignedUserId(enquiryDTO.getAssignedUserId())
                    .assignedVisitSessionId(enquiryDTO.getAssignedVisitSessionId())
                    .feeRangeExpectation(enquiryDTO.getFeeRangeExpectation())
                    .transportRequirement(enquiryDTO.getTransportRequirement())
                    .mode(enquiryDTO.getMode())
                    .enquiryTrackingId(retrievalTrackingId)
                    .interestScore(enquiryDTO.getInterestScore())
                    .notes(enquiryDTO.getNotes())
                    .parentRelationWithChild(enquiryDTO.getParentRelationWithChild())
                    .build();

            Enquiry savedEnquiry = enquiryRepository.save(enquiry);
            enquiryId = savedEnquiry.getId();
            logger.info("Created enquiry with ID: {}", enquiryId);
        }

        // STEP 4: Create Audience Response Entry with new fields - store parent's
        // user_id and child's student_user_id

        // Generate dedupe key for within-campaign deduplication
        String dedupeKey = leadDeduplicationService.generateDedupeKey(
                requestDTO.getParentEmail(), requestDTO.getParentMobile());

        AudienceResponse response = AudienceResponse.builder()
                .audienceId(requestDTO.getAudienceId())
                .sourceType(requestDTO.getSourceType())
                .sourceId(requestDTO.getSourceId())
                .userId(parentUserId) // Store parent's user_id
                .studentUserId(childUserId) // Store child's student_user_id
                .enquiryId(enquiryId != null ? enquiryId.toString() : null)
                .destinationPackageSessionId(requestDTO.getDestinationPackageSessionId())
                .parentName(requestDTO.getParentName())
                .parentEmail(requestDTO.getParentEmail())
                .parentMobile(requestDTO.getParentMobile())
                .overallStatus("ENQUIRY")
                .dedupeKey(dedupeKey)
                .initialScore(audience.getDefaultInitialScore())
                .build();

        // Check for duplicate within this campaign
        if (dedupeKey != null) {
            java.util.Optional<AudienceResponse> existingPrimary = leadDeduplicationService
                    .findDuplicate(requestDTO.getAudienceId(), dedupeKey);
            if (existingPrimary.isPresent()) {
                // Unlike the guards above, this path always inserts and merely flags the new row
                // as a duplicate of the primary. If that primary was soft-deleted, revive it —
                // otherwise the person's original lead (and its history) stays hidden forever
                // while a duplicate-flagged row accumulates beside it.
                AudienceResponse primary = existingPrimary.get();
                if (AudienceStatusEnum.INACTIVE.name().equalsIgnoreCase(primary.getAudienceStatus())) {
                    primary.setAudienceStatus(AudienceStatusEnum.ACTIVE.name());
                    audienceResponseRepository.save(primary);
                    logger.info("Reactivated soft-deleted primary lead {} on re-submission", primary.getId());
                }
                leadDeduplicationService.markDuplicate(response, primary, requestDTO.getSourceType());
                logger.info("Duplicate lead detected for campaign {}, primary={}",
                        requestDTO.getAudienceId(), primary.getId());
            }
        }

        AudienceResponse savedResponse = audienceResponseRepository.save(response);
        logger.info("Saved audience response with ID: {} linked to enquiry: {} with parent user_id: {}",
                savedResponse.getId(), enquiryId, parentUserId);
        logLeadSubmitted(savedResponse);

        // STEP 4b: Calculate initial lead score (real-time)
        try {
            leadScoringService.calculateAndSaveScore(
                    savedResponse.getId(),
                    savedResponse.getAudienceId(),
                    instituteId,
                    savedResponse.getSourceType(),
                    savedResponse.getEnquiryId());
        } catch (Exception e) {
            logger.error("Failed to calculate initial lead score for response {}: {}",
                    savedResponse.getId(), e.getMessage());
            // Non-blocking — lead is still saved even if scoring fails
        }

        // Send Enquiry Confirmation Email
        if (audience.getSendRespondentEmail() == null || audience.getSendRespondentEmail()) {
            try {
                PackageSession packageSession = null;
                if (requestDTO.getDestinationPackageSessionId() != null) {
                    packageSession = packageSessionRepository.findById(requestDTO.getDestinationPackageSessionId())
                            .orElse(null);
                }

                sendEnquiryConfirmationEmail(
                        parentUserDTO,
                        childUserDTO,
                        audience,
                        enquiry,
                        packageSession);
            } catch (Exception e) {
                logger.error("Failed to send enquiry confirmation email", e);
            }
        }

        // STEP 5: Save custom field values (same as existing submitLead)
        if (!CollectionUtils.isEmpty(requestDTO.getCustomFieldValues())) {
            saveCustomFieldValues(
                    savedResponse.getId(),
                    requestDTO.getCustomFieldValues(),
                    audience.getInstituteId(),
                    audience.getId());
        }

        linkCounsellorToEnquiry(instituteId, requestDTO.getAudienceId(), enquiry, requestDTO.getCounsellorId());
        applyRepeatLeadStatus(repeatLeadSettings, parentUserId, instituteId, savedResponse,
                requestDTO.getParentEmail(), requestDTO.getParentMobile());

        // STEP 6: Build custom field map for email
        Map<String, String> customFieldsForEmail = buildCustomFieldMapForEmail(savedResponse.getId());

        // STEP 8: Send notifications to additional recipients (toNotify)
        final UserDTO userForNotification = parentUserDTO; // Use parent user for notifications
        final String instituteIdForNotification = instituteId;

        if (StringUtils.hasText(audience.getToNotify())) {
            String[] additionalEmails = audience.getToNotify().split(",");
            logger.info("Sending notifications to {} additional recipients", additionalEmails.length);

            for (String email : additionalEmails) {
                String trimmedEmail = email.trim();
                if (!StringUtils.hasText(trimmedEmail)) {
                    continue;
                }

                logger.info("Sending notification to additional recipient: {}", trimmedEmail);
                String adminEmailBody = buildAdminNotificationBody(
                        audience.getCampaignName(),
                        userForNotification.getFullName(),
                        userForNotification.getEmail(),
                        customFieldsForEmail);

                GenericEmailRequest adminEmailRequest = new GenericEmailRequest();
                adminEmailRequest.setTo(trimmedEmail);
                adminEmailRequest.setSubject("New Lead Submitted - " + audience.getCampaignName());
                adminEmailRequest.setBody(adminEmailBody);

                try {
                    notificationService.sendGenericHtmlMailViaUnified(adminEmailRequest, instituteIdForNotification);
                    logger.info("Sent default admin notification to: {}", trimmedEmail);
                } catch (Exception ex) {
                    logger.error("Failed to send admin notification to {}: {}", trimmedEmail, ex.getMessage());
                }
            }
        }

        // --- NEW: Record Enquiry in Pipeline ---
        admissionPipelineService.recordEnquiry(
                instituteId,
                requestDTO.getDestinationPackageSessionId(),
                parentUserId,
                childUserId,
                enquiryId != null ? enquiryId.toString() : null,
                requestDTO.getSourceType());

        // STEP 9: Build and return response
        return SubmitLeadWithEnquiryResponseDTO.builder()
                .enquiryId(enquiryId)
                .audienceResponseId(savedResponse.getId())
                .parentUserId(parentUserId) // Return parent user ID
                .counsellorId(requestDTO.getCounsellorId())
                .message("Lead and enquiry submitted successfully")
                .build();
    }

    private void linkCounsellorToEnquiry(String instituteId, String audienceId, Enquiry enquiry, String counsellorId) {
        logger.info("Processing counselor assignment for enquiry: {}", enquiry.getId());

        String finalCounsellorId = null;

        // CASE 1: Manual assignment - counsellorId provided in request
        if (StringUtils.hasText(counsellorId)) {
            finalCounsellorId = counsellorId;
            logger.info("Manual counselor assignment: {}", finalCounsellorId);
        }
        // CASE 2 & 3: Auto assignment
        else {
            // Priority 2: Check Campaign Settings
            CounsellorAllocationSettingDTO campaignSettings = parseCounsellorAllocationSettings(audienceId);
            boolean assignedFromCampaign = false;

            if (campaignSettings != null) {
                // If campaign explicitly enables auto-assign and has counselors
                if (Boolean.TRUE.equals(campaignSettings.getAutoAssignEnabled())
                        && campaignSettings.getCounsellorIds() != null
                        && !campaignSettings.getCounsellorIds().isEmpty()) {

                    finalCounsellorId = leadDistributionService.selectCounselor(
                            campaignSettings, "AUDIENCE", audienceId, instituteId);
                    assignedFromCampaign = true;
                    logger.info("Auto-assigned counselor from Campaign Settings: {}", finalCounsellorId);
                }
                // If autoAssignEnabled = false, we FALL THROUGH to institute (Campaign Opt-Out)
                // If list is empty, we FALL THROUGH to institute
            }

            // Priority 3: Check Institute Settings (Fallback if campaign didn't assign)
            if (!assignedFromCampaign) {
                logger.debug("Falling back to Institute Settings for counselor assignment");
                CounsellorAllocationSettingDTO instituteSettings = parseInstituteCounsellorSettings(instituteId);

                if (instituteSettings != null
                        && Boolean.TRUE.equals(instituteSettings.getAutoAssignEnabled())
                        && instituteSettings.getCounsellorIds() != null
                        && !instituteSettings.getCounsellorIds().isEmpty()) {

                    finalCounsellorId = leadDistributionService.selectCounselor(
                            instituteSettings, "INSTITUTE", instituteId, instituteId);
                    logger.info("Auto-assigned counselor from Institute Settings: {}", finalCounsellorId);
                } else {
                    logger.info("No counselor assigned from Institute Settings conditions not met");
                }
            }
        }

        // Final assignment
        if (finalCounsellorId != null) {
            // Validate counselor
            if (validateCounselor(finalCounsellorId, instituteId)) {
                // Create linked_users entry
                LinkedUsers linkedUser = LinkedUsers.builder()
                        .source("ENQUIRY")
                        .sourceId(enquiry.getId().toString())
                        .userId(finalCounsellorId)
                        .build();

                linkedUsersRepository.save(linkedUser);

                // Update enquiry assigned flag
                enquiry.setAssignedUserId(true);
                enquiryRepository.save(enquiry);

                logger.info("Successfully linked counselor {} to enquiry {}", finalCounsellorId, enquiry.getId());
                emitLeadAssigned(instituteId, audienceId, enquiry.getId().toString(), finalCounsellorId);

                // Log journey event — covers both manual and pool-based (auto) assignments
                try {
                    String assignmentSource = StringUtils.hasText(counsellorId) ? "MANUAL" : "AUTO";
                    timelineEventService.logJourneyEvent(
                            "ENQUIRY", enquiry.getId().toString(),
                            LeadJourneyActionType.COUNSELOR_ASSIGNED,
                            StringUtils.hasText(counsellorId) ? "ADMIN" : "SYSTEM",
                            finalCounsellorId, null,
                            "Counselor assigned",
                            "Counselor assigned via " + assignmentSource,
                            Map.of("counselor_id", finalCounsellorId,
                                    "assignment_source", assignmentSource,
                                    "audience_id", audienceId != null ? audienceId : ""),
                            null);
                } catch (Exception e) {
                    logger.warn("Failed to log COUNSELOR_ASSIGNED journey event for enquiry {}: {}",
                            enquiry.getId(), e.getMessage());
                }

                // Bell to the counsellor — same alert every other assignment path sends.
                try {
                    String campaignName = audienceId != null
                            ? audienceRepository.findById(audienceId).map(Audience::getCampaignName).orElse(null)
                            : null;
                    // Left as an ordinary dismissible alert: an enquiry is not a lead
                    // user, so there is no id here that a timeline event would ever
                    // match, and a correlation that never clears is worse than none.
                    leadAssignmentNotifier.notifyAssigned(instituteId, finalCounsellorId, null, campaignName);
                } catch (Exception e) {
                    logger.warn("Failed to notify counsellor {} for enquiry {}: {}",
                            finalCounsellorId, enquiry.getId(), e.getMessage());
                }
            } else {
                logger.warn("Counselor validation failed for counselorId: {}", finalCounsellorId);
                enquiry.setAssignedUserId(false);
                enquiryRepository.save(enquiry);
            }
        } else {
            // CASE 3: No counselor assigned
            enquiry.setAssignedUserId(false);
            enquiryRepository.save(enquiry);
            logger.info("No counselor assigned to enquiry: {}", enquiry.getId());
        }
    }

    /**
     * Parse counselor allocation settings from audience setting_json
     */
    private CounsellorAllocationSettingDTO parseCounsellorAllocationSettings(String audienceId) {
        try {
            Audience audience = audienceRepository.findById(audienceId).orElse(null);
            if (audience == null || !StringUtils.hasText(audience.getSettingJson())) {
                logger.debug("No settings found for audience: {}", audienceId);
                return null;
            }

            ObjectMapper mapper = new ObjectMapper();
            JsonNode root = mapper.readTree(audience.getSettingJson());

            JsonNode counsellorSettings = root
                    .path("SCHOOL_SETTING")
                    .path("data")
                    .path("COUNSELLOR_ALLOCATION_SETTING")
                    .path("data");

            if (counsellorSettings.isMissingNode()) {
                logger.debug("No counselor allocation settings found in JSON for audience: {}", audienceId);
                return null;
            }

            return mapper.treeToValue(counsellorSettings, CounsellorAllocationSettingDTO.class);
        } catch (Exception e) {
            logger.error("Failed to parse counselor allocation settings for audience: {}", audienceId, e);
            return null;
        }
    }

    /**
     * Parse counselor allocation settings from institute setting_json
     */
    private CounsellorAllocationSettingDTO parseInstituteCounsellorSettings(String instituteId) {
        try {
            Institute institute = instituteRepository.findById(instituteId).orElse(null);
            if (institute == null || !StringUtils.hasText(institute.getSetting())) {
                logger.debug("No settings found for institute: {}", instituteId);
                return null;
            }

            ObjectMapper mapper = new ObjectMapper();
            JsonNode root = mapper.readTree(institute.getSetting());

            JsonNode counsellorSettings = root
                    .path("SCHOOL_SETTING")
                    .path("data")
                    .path("COUNSELLOR_ALLOCATION_SETTING")
                    .path("data");

            if (counsellorSettings.isMissingNode()) {
                logger.debug("No counselor allocation settings found in JSON for institute: {}", instituteId);
                return null;
            }

            return mapper.treeToValue(counsellorSettings, CounsellorAllocationSettingDTO.class);
        } catch (Exception e) {
            logger.error("Failed to parse counselor allocation settings for institute: {}", instituteId, e);
            return null;
        }
    }

    /**
     * @deprecated Replaced by {@link LeadDistributionService#selectCounselor}.
     *             Kept for backward compatibility — remove after confirming no
     *             external callers.
     */
    @Deprecated
    private String selectRandomCounselor(List<String> counsellorIds) {
        if (counsellorIds == null || counsellorIds.isEmpty()) {
            return null;
        }
        Random random = new Random();
        int index = random.nextInt(counsellorIds.size());
        return counsellorIds.get(index);
    }

    /**
     * Validate that the assigned user exists in the system
     * 
     * Design Decision: We only verify user existence, not role.
     * This allows any registered user (counselors, admins, managers, etc.) to be
     * assigned to enquiries.
     * The calling service is responsible for ensuring the appropriate user is
     * assigned.
     */
    private boolean validateCounselor(String counselorId, String instituteId) {
        if (!StringUtils.hasText(counselorId)) {
            logger.warn("User ID is null or empty");
            return false;
        }

        // Verify user exists via AuthService
        try {
            List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(List.of(counselorId));
            if (users == null || users.isEmpty()) {
                logger.warn("User {} not found in auth service", counselorId);
                return false;
            }
            logger.debug("User {} validation passed - user exists", counselorId);
            return true;
        } catch (Exception e) {
            logger.error("Failed to validate user {}: {}", counselorId, e.getMessage());
            return false;
        }
    }

    /**
     * Validate and prepare child user DTO
     * Generates unique email and full name if not present
     * 
     * @param childUserDTO  Child user DTO from request
     * @param parentUserDTO Parent user DTO for reference
     * @return Validated and prepared child user DTO
     */
    private UserDTO validateAndPrepareChildUserDTO(UserDTO childUserDTO, UserDTO parentUserDTO) {
        if (childUserDTO == null) {
            throw new VacademyException("Child user information is required");
        }

        // Check and generate email if not present
        if (!StringUtils.hasText(childUserDTO.getEmail())) {
            // Generate unique email using UUID
            String uniqueEmail = "child_" + java.util.UUID.randomUUID().toString().replace("-", "").substring(0, 12)
                    + "@noemail.vacademy.io";
            childUserDTO.setEmail(uniqueEmail);
            logger.info("Generated unique email for child: {}", uniqueEmail);
        }

        // Check and generate full name if not present
        if (!StringUtils.hasText(childUserDTO.getFullName())) {
            String parentName = StringUtils.hasText(parentUserDTO.getFullName())
                    ? parentUserDTO.getFullName()
                    : "Parent";
            String childFullName = "Child of " + parentName;
            childUserDTO.setFullName(childFullName);
            logger.info("Generated full name for child: {}", childFullName);
        }

        return childUserDTO;
    }

    /**
     * Get all leads for a campaign with filters.
     * <p>
     * Caller-level access scoping (Phase 1 of role-based filtering):
     * <ul>
     * <li>ADMIN / root user → sees every lead, may explicitly filter by
     * {@code assignedCounselorId} or by lead tier.</li>
     * <li>COUNSELOR (without ADMIN) → automatically scoped to leads where the
     * linked counselor is the caller, regardless of what the request body
     * sent for {@code assignedCounselorId}.</li>
     * <li>Any other role → unchanged (no auto-scoping); per-resource list
     * access will land in a later phase.</li>
     * </ul>
     */
    /**
     * Resolve the people a caller may assign a lead to: COUNSELLOR-role users
     * only. Assignment is an admin action, not data visibility — so any
     * ADMIN-role caller (including one who ALSO holds the COUNSELLOR role and
     * therefore sees only their hierarchy scope in the lists) may assign to
     * the institute-wide counsellor roster. Non-admin counsellors stay
     * restricted to their scope — {@code self + counsellor reports}. Either
     * way the picker no longer offers non-counsellor users (the old admin
     * branch was a raw autosuggest over ALL institute users).
     */
    public List<vacademy.io.common.auth.dto.UserDTO> eligibleAssignees(String instituteId,
                                                                       String query,
                                                                       CustomUserDetails caller) {
        if (caller == null || caller.getUserId() == null) return List.of();
        List<String> userIds = counsellorScopeService
                .assignableCounsellorUserIds(instituteId, caller);
        if (userIds.isEmpty()) {
            // Setup mode: the institute has no COUNSELLOR-role users yet (or the
            // role lookup is degraded). Blocking assignment outright would brick
            // the CRM mid-migration — admins keep the old institute-wide
            // autosuggest until counsellor roles are granted.
            if (counsellorScopeService.hasAdminRole(caller, instituteId)) {
                if (query == null || query.isBlank()) return List.of();
                return authService.autosuggestUsers(instituteId, query);
            }
            return List.of();
        }
        // Pull full user records for the candidate set (name / email / mobile),
        // then filter in-process. Empty query → first 10 so the picker isn't
        // blank on first open (autosuggest used to require a query).
        List<vacademy.io.common.auth.dto.UserDTO> candidates =
                authService.getUsersFromAuthServiceByUserIds(userIds);
        if (query == null || query.isBlank()) {
            return candidates.stream().limit(10).toList();
        }
        final String q = query.toLowerCase();
        return candidates.stream()
                .filter(u -> matchesAutosuggest(u, q))
                .limit(10)
                .toList();
    }

    /**
     * Counsellor options for the CRM Leads "All counsellors" filter, scoped the
     * SAME way {@link #getLeads} scopes the visible leads: a hierarchy-scoped
     * caller (COUNSELLOR role — even alongside ADMIN) gets the counsellors
     * whose leads they can actually see (self + counsellor-role descendants);
     * a pure admin gets the institute-wide COUNSELLOR-role roster.
     *
     * <p>The counsellor list is populated in BOTH cases (it used to be empty
     * for admins, forcing an institute-wide frontend fallback that also
     * offered ADMIN-role users). {@code scoped} keeps its RBAC meaning: true
     * only when the caller is hierarchy-scoped — the frontend uses it to
     * decide whether the caller's data is narrowed server-side.</p>
     */
    public LeadCounsellorOptionsDTO leadCounsellorOptions(String instituteId, CustomUserDetails caller,
                                                          boolean assignable) {
        if (caller == null || caller.getUserId() == null
                || instituteId == null || instituteId.isBlank()) {
            return LeadCounsellorOptionsDTO.builder().scoped(false).counsellors(List.of()).build();
        }

        // Sub-org admin: scope the counsellor roster to their sub-org, consistent
        // with the sub-org-scoped leads in getLeads. Detected by the ACTIVE SUB_ORG
        // FSPSSM linkage (a sub-org admin also holds the parent ADMIN role and would
        // otherwise get the full institute roster). This one branch covers BOTH the
        // filter dropdown (assignable=false) and the assignment pickers
        // (assignable=true), so a sub-org admin can neither filter by nor assign to
        // counsellors outside their sub-org. scoped=true tells the frontend the
        // roster is narrowed server-side.
        List<String> subOrgMembers = subOrgLeadScopeService
                .subOrgScopedCounsellorUserIds(caller.getUserId());
        if (!subOrgMembers.isEmpty()) {
            // Show only the sub-org's actual COUNSELLORS — not the sub-org admin
            // themselves or other non-counsellor team members (teachers, etc.).
            // Intersect the sub-org members with the institute's COUNSELLOR-role
            // roster. Fall back to the full member set only if that intersection is
            // empty, so a sub-org whose counsellors don't yet carry the COUNSELLOR
            // role still gets a usable picker rather than an empty dropdown.
            Set<String> counsellorRoster = new HashSet<>(
                    counsellorScopeService.allCounsellorUserIds(instituteId));
            List<String> subOrgCounsellors = subOrgMembers.stream()
                    .filter(counsellorRoster::contains)
                    .collect(Collectors.toList());
            List<String> rosterIds = subOrgCounsellors.isEmpty() ? subOrgMembers : subOrgCounsellors;
            List<vacademy.io.common.auth.dto.UserDTO> subOrgUsers =
                    authService.getUsersFromAuthServiceByUserIds(rosterIds);
            return LeadCounsellorOptionsDTO.builder().scoped(true).counsellors(subOrgUsers).build();
        }

        boolean scoped = counsellorScopeService.isScopedCaller(instituteId, caller);
        // assignable=true resolves ASSIGNMENT targets (bulk-assign dialog,
        // telephony/IVR routing config): ADMIN-role callers get the
        // institute-wide roster even when they also hold COUNSELLOR and are
        // hierarchy-scoped in the filter lists.
        List<String> userIds = assignable
                ? counsellorScopeService.assignableCounsellorUserIds(instituteId, caller)
                : counsellorScopeService.visibleCounsellorUserIds(instituteId, caller.getUserId());
        if (userIds.isEmpty()) {
            return LeadCounsellorOptionsDTO.builder().scoped(scoped).counsellors(List.of()).build();
        }
        // Full user records (name/email/mobile) for the scope — no limit, unlike the
        // assignment picker; a filter dropdown wants the complete roster, not a top-10.
        List<vacademy.io.common.auth.dto.UserDTO> users =
                authService.getUsersFromAuthServiceByUserIds(userIds);
        return LeadCounsellorOptionsDTO.builder().scoped(scoped).counsellors(users).build();
    }

    private static boolean matchesAutosuggest(vacademy.io.common.auth.dto.UserDTO u, String qLower) {
        if (u == null) return false;
        String name = u.getFullName();
        String email = u.getEmail();
        String mobile = u.getMobileNumber();
        return (name != null && name.toLowerCase().contains(qLower))
                || (email != null && email.toLowerCase().contains(qLower))
                || (mobile != null && mobile.toLowerCase().contains(qLower));
    }

    @Transactional(readOnly = true)
    public Page<LeadDetailDTO> getLeads(LeadFilterDTO filterDTO, CustomUserDetails user) {
        Pageable pageable = PageRequest.of(
                filterDTO.getPage() != null ? filterDTO.getPage() : 0,
                filterDTO.getSize() != null ? filterDTO.getSize() : 50);

        // Convert list filters to comma-separated strings for native query
        String overallStatusStr = filterDTO.getOverallStatuses() != null && !filterDTO.getOverallStatuses().isEmpty()
                ? String.join(",", filterDTO.getOverallStatuses())
                : null;

        // Audience multi-select (Recent Leads "All audiences" dropdown). The list can
        // carry any number of campaign ids:
        //   0 ids  -> untouched, the caller sees every audience they're allowed to
        //   1 id   -> collapsed onto audienceId so the request takes the existing
        //             per-campaign query (which also honours source/dedup filters)
        //   2+ ids -> left as a CSV that narrows the institute-wide query below
        // An explicit audienceId always wins, so per-campaign callers are unaffected.
        List<String> requestedAudienceIds = filterDTO.getAudienceIds() == null
                ? List.of()
                : filterDTO.getAudienceIds().stream()
                        .filter(id -> id != null && !id.isBlank())
                        .map(String::trim)
                        .distinct()
                        .toList();
        if ((filterDTO.getAudienceId() == null || filterDTO.getAudienceId().isBlank())
                && requestedAudienceIds.size() == 1) {
            filterDTO.setAudienceId(requestedAudienceIds.get(0));
        }
        String requestedAudienceIdsCsv = (filterDTO.getAudienceId() == null
                || filterDTO.getAudienceId().isBlank())
                        && requestedAudienceIds.size() > 1
                                ? String.join(",", requestedAudienceIds)
                                : null;

        // SECURITY: the campaign-users client sends only audienceId (no instituteId),
        // and every RBAC block below gates on a non-blank instituteId — so the
        // per-campaign list used to skip counsellor-hierarchy and sub-org scoping
        // entirely (institute-wide visibility for scoped callers), while the
        // institute_id-carrying Recent Leads request was scoped. Derive the institute
        // from the audience up-front so scoping applies no matter what the client sends.
        if ((filterDTO.getInstituteId() == null || filterDTO.getInstituteId().isBlank())
                && filterDTO.getAudienceId() != null && !filterDTO.getAudienceId().isBlank()) {
            audienceRepository.findById(filterDTO.getAudienceId())
                    .map(Audience::getInstituteId)
                    .ifPresent(filterDTO::setInstituteId);
        }
        // Same derivation for the multi-audience case — the institute-wide query it
        // routes to gates on a non-blank instituteId, and all selected campaigns
        // belong to one institute.
        if ((filterDTO.getInstituteId() == null || filterDTO.getInstituteId().isBlank())
                && requestedAudienceIdsCsv != null) {
            audienceRepository.findById(requestedAudienceIds.get(0))
                    .map(Audience::getInstituteId)
                    .ifPresent(filterDTO::setInstituteId);
        }

        // Caller-level lead visibility — sub-org admin scope, counsellor-hierarchy
        // RBAC and the institute's AUDIENCE_ROLE_ACCESS modes — resolved by
        // LeadVisibilityResolver (shared with GET /v1/audience/lead-scope, so the
        // scope reported there is exactly the one applied here).
        //
        // The owner scope (sub-org members / counsellor subtree) is a CSV the
        // native query plugs into a `STRING_TO_ARRAY(...) = ANY` predicate
        // alongside the single-id filter — so a manager can still drill into a
        // specific report by sending assignedCounselorId.
        LeadVisibility visibility = leadVisibilityResolver.resolve(user, filterDTO.getInstituteId());
        String assignedCounselorIdsCsv = visibility.scopeOwnerIdsCsv();

        // COUNSELOR mode / AUDIENCE_LIST "only my assigned leads" with no
        // hierarchy scope: ignore whatever assignedCounselorId the request body
        // sent — the caller only sees leads they're directly linked to.
        if (visibility.forcedOwnerId() != null) {
            filterDTO.setAssignedCounselorId(visibility.forcedOwnerId());
        }

        // Whether the shared unassigned pool (no counsellor on either
        // linked_users or user_lead_profile) stays visible inside the owner scope.
        boolean includeUnassigned = visibility.includeUnassigned();

        String allowedAudienceIdsCsv = null;
        List<String> allowed = visibility.allowedAudienceIds();
        if (allowed != null) {
            if (allowed.isEmpty()) {
                // Admin granted no lists → user sees nothing (intentional lock-out).
                return Page.empty(pageable);
            }
            allowedAudienceIdsCsv = String.join(",", allowed);
            String requestedAudienceId = filterDTO.getAudienceId();
            if (requestedAudienceId != null && !requestedAudienceId.isBlank()
                    && !allowed.contains(requestedAudienceId)) {
                // Punching through to a campaign they weren't granted.
                return Page.empty(pageable);
            }
        }

        // Conversion-status filter — defaults to EXCLUDE_CONVERTED so leads
        // that have been enrolled into a course don't clutter the active-leads
        // listing. Callers must opt into ONLY_CONVERTED or ALL to see them.
        String conversionStatusFilter = filterDTO.getConversionStatusFilter();

        // Soft-delete filter — EXCLUDE_DELETED unless the caller explicitly asks otherwise, so
        // every existing caller (and every new one that forgets) hides deleted leads by default.
        String audienceStatusFilter = filterDTO.getAudienceStatusFilter();

        // Cross-service search expansion. Leads created via the simple submit flow
        // store the user's name/email/mobile on the User row in auth_service, not
        // on audience_response.parent_*. So a substring search like "cold" against
        // ar.parent_* misses those users entirely. We resolve the gap by asking
        // auth_service for matching user IDs first, then OR'ing them into the
        // audience-response filter via :searchUserIdsCsv. Empty/blank search → null
        // CSV → predicate behaves exactly as before for non-search queries.
        //
        // We intentionally pass instituteId = null here. searchUserIdsByQuery scopes
        // matches to users that hold a user_role for the institute, but lead/enquiry
        // users are bare contacts with no role — passing the instituteId excluded
        // every such user, so name/email/phone search returned 0 rows for leads whose
        // identity lives only on the auth User. Broadening the auth lookup is safe:
        // the returned IDs are intersected with ar.user_id, and audience_response is
        // already institute-scoped (JOIN audience a ON a.institute_id = :instituteId),
        // so no cross-institute lead can leak in.
        String searchUserIdsCsv = null;
        String rawSearch = filterDTO.getSearchQuery();
        if (rawSearch != null && !rawSearch.isBlank()) {
            try {
                List<String> ids = authService.searchUserIdsByQuery(rawSearch, null);
                if (ids != null && !ids.isEmpty()) {
                    searchUserIdsCsv = String.join(",", ids);
                }
            } catch (Exception e) {
                logger.warn("auth-service user search failed for query='{}': {}", rawSearch, e.getMessage());
            }
        }

        // Resolve the institute's TAT (minutes + working-hours rule) up-front so the SLA-state
        // filter can derive the deadline live via lead_sla_due_at(). Needs to happen BEFORE the
        // repo call because the predicate is bound at query time. Null when the institute
        // hasn't enabled TAT — SQL guards with `:tatMinutes IS NOT NULL`.
        vacademy.io.admin_core_service.features.audience.dto.LeadSlaConfigDTO.TatReminder filterTat = resolveFilterTat(
                filterDTO.getInstituteId() != null && !filterDTO.getInstituteId().isBlank()
                        ? filterDTO.getInstituteId()
                        : (filterDTO.getAudienceId() != null
                            ? audienceRepository.findById(filterDTO.getAudienceId())
                                    .map(Audience::getInstituteId).orElse(null)
                            : null));
        Integer filterTatMinutes = filterTat != null ? filterTat.getTatMinutes() : null;
        String filterTatRule = filterTat != null ? filterTat.getWorkingHoursRule() : null;

        // Pre-resolve the custom-field filters into matching audience_response IDs
        // using one indexed lookup per field (intersected across fields). This
        // replaces a per-row correlated jsonb subquery that scanned
        // custom_field_values for every candidate lead and timed out on the
        // institute-wide Recent Leads query. Positive operators produce the
        // matched set (null = no filter; empty = nothing matches → empty page);
        // IS_EMPTY entries produce an exclusion set.
        vacademy.io.admin_core_service.features.common.service.CustomFieldListFilterResolver.Resolution
                cfResolution = resolveCustomFieldFilters(filterDTO.getCustomFieldFilters());
        if (cfResolution.shortCircuitsToEmpty()) {
            return Page.empty(pageable);
        }
        // Campaign (UTM) filter rides the same matched-id channel: resolve the
        // touches into response ids and AND them with the custom-field set, so
        // neither native query needs to know attribution exists.
        if (vacademy.io.admin_core_service.features.utm_attribution.service.UtmListFilterResolver
                .hasFilter(filterDTO.getUtmFilters())) {
            cfResolution = cfResolution.and(utmListFilterResolver.resolve(
                    filterDTO.getUtmFilters(),
                    vacademy.io.admin_core_service.features.common.service.CustomFieldListFilterResolver.Surface.RESPONSE,
                    filterDTO.getInstituteId()));
            if (cfResolution.shortCircuitsToEmpty()) {
                return Page.empty(pageable);
            }
        }
        // Follow-ups page interest filter rides the same channel: the leads whose
        // open follow-up carries one of the chosen interest levels.
        String followUpInterestLevels = LeadFollowupService.joinInterestLevels(
                filterDTO.getFollowUpInterestLevels());
        if (followUpInterestLevels != null) {
            // The per-campaign path may carry no institute id; take it from the
            // campaign, so the lookup never scans every institute's follow-ups.
            String interestInstituteId = StringUtils.hasText(filterDTO.getInstituteId())
                    ? filterDTO.getInstituteId()
                    : (StringUtils.hasText(filterDTO.getAudienceId())
                            ? audienceRepository.findById(filterDTO.getAudienceId())
                                    .map(Audience::getInstituteId).orElse(null)
                            : null);
            if (!StringUtils.hasText(interestInstituteId)) {
                return Page.empty(pageable);
            }
            cfResolution = cfResolution.and(
                    new vacademy.io.admin_core_service.features.common.service.CustomFieldListFilterResolver.Resolution(
                            new java.util.HashSet<>(leadFollowupRepository.findOpenResponseIdsByInterestLevels(
                                    interestInstituteId, followUpInterestLevels)),
                            null));
            if (cfResolution.shortCircuitsToEmpty()) {
                return Page.empty(pageable);
            }
        }
        String customFieldMatchedIdsCsv = cfResolution.matchedIdsCsv();
        String customFieldExcludedIdsCsv = cfResolution.excludedIdsCsv();

        // Cross-audience path: when no audienceId is supplied, return leads
        // across every campaign in the institute. Used by the "Recent Leads"
        // view.
        boolean crossAudience = filterDTO.getAudienceId() == null
                || filterDTO.getAudienceId().isBlank();
        if (crossAudience && filterDTO.getInstituteId() != null
                && !filterDTO.getInstituteId().isBlank()) {
            // The route's duplicates= wins. With none, "Show duplicates only in Duplicate
            // Leads" (Lead Settings) hides them here; off = no filter, as before.
            String duplicateFilter = normalizeDuplicateFilter(filterDTO.getDuplicateFilter());
            if (duplicateFilter == null
                    && leadDeduplicationService.duplicatesTabOnly(filterDTO.getInstituteId())) {
                duplicateFilter = "EXCLUDE";
            }
            Page<AudienceResponse> all = audienceResponseRepository.findInstituteLeadsWithFilters(
                    filterDTO.getInstituteId(),
                    filterDTO.getLeadStatusId(),
                    filterDTO.getLeadStatusExcludeId(),
                    filterDTO.getFollowUpPending(),
                    filterDTO.getFollowUpFrom(),
                    filterDTO.getFollowUpTo(),
                    duplicateFilter,
                    filterDTO.getSubmittedFromLocal(),
                    filterDTO.getSubmittedToLocal(),
                    filterDTO.getSearchQuery(),
                    searchUserIdsCsv,
                    filterDTO.getLeadTier(),
                    filterDTO.getAssignedCounselorId(),
                    assignedCounselorIdsCsv,
                    includeUnassigned,
                    filterDTO.getIsUnassigned(),
                    allowedAudienceIdsCsv,
                    requestedAudienceIdsCsv,
                    conversionStatusFilter,
                    audienceStatusFilter,
                    filterDTO.getSlaFilter(),
                    filterTatMinutes,
                    filterTatRule,
                    customFieldMatchedIdsCsv,
                    customFieldExcludedIdsCsv,
                    filterDTO.getCallHistoryFilter(),
                    filterDTO.getCallCountValue(),
                    filterDTO.getSortBy(),
                    filterDTO.getSortDirection(),
                    filterDTO.getSortCustomFieldId(),
                    filterDTO.getCalledFromLocal(),
                    filterDTO.getCalledToLocal(),
                    filterDTO.getActivityFromLocal(),
                    filterDTO.getActivityToLocal(),
                    pageable);
            return mapResponsesToLeadDetails(all, filterDTO.getInstituteId());
        }

        Page<AudienceResponse> responses = audienceResponseRepository.findLeadsWithFilters(
                filterDTO.getAudienceId(),
                filterDTO.getLeadStatusId(),
                filterDTO.getLeadStatusExcludeId(),
                filterDTO.getFollowUpPending(),
                filterDTO.getFollowUpFrom(),
                filterDTO.getFollowUpTo(),
                normalizeDuplicateFilter(filterDTO.getDuplicateFilter()),
                filterDTO.getSourceType(),
                filterDTO.getSourceId(),
                filterDTO.getSubmittedFromLocal(),
                filterDTO.getSubmittedToLocal(),
                filterDTO.getExcludeDuplicates(),
                filterDTO.getSearchQuery(),
                searchUserIdsCsv,
                filterDTO.getMinLeadScore(),
                filterDTO.getMaxLeadScore(),
                filterDTO.getLeadTier(),
                filterDTO.getAssignedCounselorId(),
                assignedCounselorIdsCsv,
                includeUnassigned,
                filterDTO.getIsUnassigned(),
                overallStatusStr,
                customFieldMatchedIdsCsv,
                customFieldExcludedIdsCsv,
                filterDTO.getCallHistoryFilter(),
                filterDTO.getCallCountValue(),
                conversionStatusFilter,
                audienceStatusFilter,
                filterDTO.getSlaFilter(),
                filterTatMinutes,
                filterTatRule,
                filterDTO.getSortBy(),
                filterDTO.getSortDirection(),
                filterDTO.getSortCustomFieldId(),
                filterDTO.getCalledFromLocal(),
                filterDTO.getCalledToLocal(),
                filterDTO.getActivityFromLocal(),
                filterDTO.getActivityToLocal(),
                pageable);

        // Resolve the institute for SLA-deadline computation: the filter usually
        // carries it, else
        // derive it from the campaign's audience (all leads here belong to one audience
        // → one institute).
        String campaignInstituteId = filterDTO.getInstituteId();
        if ((campaignInstituteId == null || campaignInstituteId.isBlank())
                && filterDTO.getAudienceId() != null) {
            campaignInstituteId = audienceRepository.findById(filterDTO.getAudienceId())
                    .map(Audience::getInstituteId).orElse(null);
        }
        return mapResponsesToLeadDetails(responses, campaignInstituteId);
    }

    /**
     * Resolves the leads custom-field filters (now operator-aware: IN, CONTAINS,
     * IS_EMPTY, NOT_EMPTY, BETWEEN, GTE, LTE) through the shared
     * CustomFieldListFilterResolver against AUDIENCE_RESPONSE answers. Positive
     * operators intersect into a matched response-ID set; IS_EMPTY entries
     * produce an exclusion set the leads queries apply as NOT-IN.
     */
    private vacademy.io.admin_core_service.features.common.service.CustomFieldListFilterResolver.Resolution
            resolveCustomFieldFilters(List<LeadFilterDTO.CustomFieldFilter> filters) {
        List<vacademy.io.admin_core_service.features.common.dto.CustomFieldListFilterDTO> converted =
                filters == null ? null
                        : filters.stream()
                                .filter(Objects::nonNull)
                                .map(f -> new vacademy.io.admin_core_service.features.common.dto.CustomFieldListFilterDTO(
                                        f.getFieldId(), f.getOperator(), f.getValues()))
                                .collect(Collectors.toList());
        return customFieldListFilterResolver.resolve(converted,
                vacademy.io.admin_core_service.features.common.service.CustomFieldListFilterResolver.Surface.RESPONSE);
    }

    /**
     * Searchable, paginated list of the distinct values a custom field holds
     * across an institute's leads — feeds the multi-select dropdowns in the leads
     * filter bar (e.g. every city leads have entered into a free-text "City"
     * field). Scoped to the institute; the frontend only calls this for fields
     * the admin has enabled as leads filters.
     */
    public Page<String> getLeadCustomFieldValues(String instituteId, String customFieldId,
            String search, int pageNo, int pageSize) {
        if (instituteId == null || instituteId.isBlank()
                || customFieldId == null || customFieldId.isBlank()) {
            return Page.empty(PageRequest.of(Math.max(pageNo, 0), pageSize > 0 ? pageSize : 20));
        }
        Pageable pageable = PageRequest.of(Math.max(pageNo, 0), pageSize > 0 ? pageSize : 20);
        String normalizedSearch = (search != null && !search.isBlank()) ? search.trim() : null;
        return audienceResponseRepository.findDistinctLeadCustomFieldValues(
                instituteId, customFieldId, normalizedSearch, pageable);
    }

    /**
     * Reads the institute's TAT config (minutes + working-hours rule) from lead_sla_config for
     * the SLA-state filter (the predicate derives the deadline live via lead_sla_due_at() so
     * it matches the row-level badge regardless of scheduler timing). Returns null when the
     * institute has no setting, TAT is disabled, or any read failure — the SQL guards with
     * `:tatMinutes IS NOT NULL` so a null safely turns the predicate off.
     */
    private vacademy.io.admin_core_service.features.audience.dto.LeadSlaConfigDTO.TatReminder resolveFilterTat(
            String instituteId) {
        if (instituteId == null || instituteId.isBlank()) return null;
        try {
            vacademy.io.admin_core_service.features.audience.dto.LeadSlaConfigDTO sla =
                    leadSlaConfigService.getSchedulerConfig(instituteId);
            if (sla != null && sla.getTatReminder() != null && sla.getTatReminder().isEnabled()) {
                return sla.getTatReminder();
            }
        } catch (Exception ex) {
            logger.warn("Failed to read TAT for SLA filter (institute={}): {}", instituteId, ex.getMessage());
        }
        return null;
    }

    private Page<LeadDetailDTO> mapResponsesToLeadDetails(Page<AudienceResponse> responses, String instituteId) {
        List<AudienceResponse> content = responses.getContent();

        // Batch fetch UserDTOs
        Set<String> userIds = content.stream()
                .map(AudienceResponse::getUserId)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet());
        Map<String, UserDTO> userIdToUser = userIds.isEmpty() ? Collections.emptyMap()
                : authService.getUsersFromAuthServiceByUserIds(new ArrayList<>(userIds))
                        .stream().filter(Objects::nonNull)
                        .collect(Collectors.toMap(UserDTO::getId, u -> u, (a, b) -> a));

        // Batch fetch lead scores
        List<String> responseIds = content.stream().map(AudienceResponse::getId).collect(Collectors.toList());
        Map<String, LeadScore> scoreByResponseId = leadScoreRepository.findByAudienceResponseIdIn(responseIds).stream()
                .collect(Collectors.toMap(LeadScore::getAudienceResponseId, s -> s, (a, b) -> a));

        // SLA deadlines: read the institute's TAT / follow-up config once. tatMinutes /
        // followUpSlaMinutes
        // stay null when the institute hasn't enabled that SLA, so we don't show a
        // meaningless deadline.
        Integer tatMinutes = null;
        String tatRule = null;
        Integer followUpSlaMinutes = null;
        if (instituteId != null && !instituteId.isBlank()) {
            try {
                vacademy.io.admin_core_service.features.audience.dto.LeadSlaConfigDTO sla = leadSlaConfigService
                        .getSchedulerConfig(instituteId);
                if (sla != null) {
                    if (sla.getTatReminder() != null && sla.getTatReminder().isEnabled()) {
                        tatMinutes = sla.getTatReminder().getTatMinutes();
                        tatRule = sla.getTatReminder().getWorkingHoursRule();
                    }
                    if (sla.getFollowUp() != null && sla.getFollowUp().isEnabled()) {
                        followUpSlaMinutes = sla.getFollowUp().getFollowUpSlaMinutes();
                    }
                }
            } catch (Exception ex) {
                logger.warn("Failed to read SLA config for institute {}: {}", instituteId, ex.getMessage());
            }
        }
        // Response events drive BOTH TAT and follow-up displays — single source of truth,
        // shared with the reports and the SLA scheduler (see the RESPONSE EVENT definition on
        // AudienceResponseRepository.findCounselorActionsByResponseIds).
        // firstActionAt = MIN(response event) → "Reach out by → ✓ Responded"
        // lastActionAt  = MAX(response event) → follow-up deadline
        // Fetch when EITHER TAT or follow-up SLA is on.
        final Integer tatMinutesFinal = tatMinutes;
        final List<vacademy.io.admin_core_service.features.audience.dto.LeadLastActionProjection> counselorActions = ((tatMinutes != null
                || followUpSlaMinutes != null) && !responseIds.isEmpty())
                        ? audienceResponseRepository.findCounselorActionsByResponseIds(responseIds, tatMinutes, tatRule)
                        : Collections.emptyList();
        // Effective TAT deadline per lead, computed in SQL (admin override, else lead_sla_due_at —
        // working-hours aware) so the badge matches the SLA filter and the reports exactly.
        final Map<String, Timestamp> tatDueByResponseId = counselorActions.stream()
                .filter(p -> p.getLeadId() != null && p.getTatDueAt() != null)
                .collect(Collectors.toMap(
                        vacademy.io.admin_core_service.features.audience.dto.LeadLastActionProjection::getLeadId,
                        vacademy.io.admin_core_service.features.audience.dto.LeadLastActionProjection::getTatDueAt,
                        (a, b) -> a));
        final Map<String, Timestamp> firstActionByResponseId = counselorActions.stream()
                .filter(p -> p.getLeadId() != null && p.getFirstActionAt() != null)
                .collect(Collectors.toMap(
                        vacademy.io.admin_core_service.features.audience.dto.LeadLastActionProjection::getLeadId,
                        vacademy.io.admin_core_service.features.audience.dto.LeadLastActionProjection::getFirstActionAt,
                        (a, b) -> a));
        final Map<String, Timestamp> lastActionByResponseId = counselorActions.stream()
                .filter(p -> p.getLeadId() != null && p.getLastActionAt() != null)
                .collect(Collectors.toMap(
                        vacademy.io.admin_core_service.features.audience.dto.LeadLastActionProjection::getLeadId,
                        vacademy.io.admin_core_service.features.audience.dto.LeadLastActionProjection::getLastActionAt,
                        (a, b) -> a));

        // Counsellor-scheduled callbacks override the SLA-derived deadline in the "Follow up at"
        // column. We pick the earliest OPEN row per lead — that is the next callback the counsellor
        // promised. If nothing is scheduled, we fall back to lastAction + followUpSlaHours (and
        // ultimately to null → the cell shows the em-dash placeholder).
        // Keep the whole row, not just its schedule time: the follow-up's own notes
        // (content / student response / mode / next action) ride along on the DTO so a
        // CSV export of a follow-up queue can carry what the counsellor wrote without a
        // second request per lead. Same row either way, so this costs nothing extra.
        final List<LeadFollowup> openFollowups = !responseIds.isEmpty()
                ? leadFollowupRepository.findOpenByAudienceResponseIds(responseIds)
                : Collections.emptyList();
        final Map<String, LeadFollowup> scheduledFollowupByResponseId = openFollowups.stream()
                .collect(Collectors.toMap(
                        LeadFollowup::getAudienceResponseId,
                        f -> f,
                        (a, b) -> a.getScheduleTime().before(b.getScheduleTime()) ? a : b));
        // Leads with an open priority follow-up (repeat-lead reattempt) — the Follow-ups page
        // lists them first.
        final Set<String> priorityFollowupResponseIds = openFollowups.stream()
                .filter(f -> Boolean.TRUE.equals(f.getIsPriority()))
                .map(LeadFollowup::getAudienceResponseId)
                .collect(Collectors.toSet());
        // Live duplicates per lead, only with "Show duplicates only in Duplicate Leads" on: the
        // lists hide duplicates then, so the lead they repeat carries the badge instead.
        final Map<String, Integer> duplicateCountByResponseId = responseIds.isEmpty()
                || !leadDeduplicationService.duplicatesTabOnly(instituteId) ? Collections.emptyMap()
                : audienceResponseRepository.countActiveDuplicatesOf(responseIds).stream()
                        .filter(r -> r.getPrimaryResponseId() != null && r.getDuplicateCount() != null)
                        .collect(Collectors.toMap(
                                AudienceResponseRepository.DuplicateCountRow::getPrimaryResponseId,
                                r -> r.getDuplicateCount().intValue(),
                                (a, b) -> a));

        // Batch fetch counselor assignments (enquiry_id → counselor userId)
        List<String> enquiryIds = content.stream()
                .map(AudienceResponse::getEnquiryId)
                .filter(Objects::nonNull)
                .collect(Collectors.toList());
        Map<String, String> enquiryIdToCounselor = enquiryIds.isEmpty() ? Collections.emptyMap()
                : linkedUsersRepository.findBySourceAndSourceIdIn("ENQUIRY", enquiryIds).stream()
                        .collect(Collectors.toMap(LinkedUsers::getSourceId, LinkedUsers::getUserId, (a, b) -> a));

        // Lead status (= user's conversion_status) + first_response_at both come from
        // user_lead_profile.
        // first_response_at is set the first time the lead's status moves off the
        // default 'LEAD'
        // (admin- or counselor-initiated), which is what the leads-table "Reach out by
        // → ✓ Responded
        // in N" display reads. Keep the full profile entity so we can read both fields
        // per row.
        Map<String, vacademy.io.admin_core_service.features.audience.entity.UserLeadProfile> userIdToProfile = userIds
                .isEmpty() ? Collections.emptyMap()
                        : userLeadProfileRepository.findByUserIdInAndInstituteId(new ArrayList<>(userIds), instituteId).stream()
                                .collect(Collectors.toMap(
                                        vacademy.io.admin_core_service.features.audience.entity.UserLeadProfile::getUserId,
                                        p -> p,
                                        (a, b) -> a));

        // Pipeline status: prefer the lead's lead_status_id (set from the leads UI via
        // the
        // lead-status API) resolved to its catalog key; fall back to conversion_status
        // for
        // legacy leads never moved onto the new status system.
        List<String> leadStatusIds = content.stream()
                .map(AudienceResponse::getLeadStatusId)
                .filter(Objects::nonNull)
                .distinct()
                .collect(Collectors.toList());
        // Use label (human-readable display name) rather than status_key so the
        // lead_status field in the API response / CSV export shows "New", "DNP", etc.
        // rather than internal codes like "LEAD", "DNP_KEY".
        // Also build a statusKey→label reverse map for the fallback path (leads that
        // have no lead_status_id yet and fall back to user_lead_profile.conversion_status,
        // which stores raw keys like "LEAD"/"CONVERTED"/"LOST").
        List<vacademy.io.admin_core_service.features.audience.entity.LeadStatus> fetchedStatuses =
                leadStatusIds.isEmpty() ? Collections.emptyList()
                        : leadStatusRepository.findAllById(leadStatusIds);
        Map<String, String> leadStatusIdToKey = fetchedStatuses.stream()
                        .collect(Collectors.toMap(
                                vacademy.io.admin_core_service.features.audience.entity.LeadStatus::getId,
                                vacademy.io.admin_core_service.features.audience.entity.LeadStatus::getLabel,
                                (a, b) -> a));
        Map<String, String> leadStatusKeyToLabel = fetchedStatuses.stream()
                        .collect(Collectors.toMap(
                                vacademy.io.admin_core_service.features.audience.entity.LeadStatus::getStatusKey,
                                vacademy.io.admin_core_service.features.audience.entity.LeadStatus::getLabel,
                                (a, b) -> a));
        // id → status_key (leadStatusIdToKey above actually carries labels): decides whether a
        // lead is closed (LOST / CONVERTED) and therefore off the SLA clock.
        Map<String, String> leadStatusIdToStatusKey = fetchedStatuses.stream()
                        .collect(Collectors.toMap(
                                vacademy.io.admin_core_service.features.audience.entity.LeadStatus::getId,
                                vacademy.io.admin_core_service.features.audience.entity.LeadStatus::getStatusKey,
                                (a, b) -> a));

        // Batch fetch all custom field values for these responses
        List<CustomFieldValues> allCfValues = customFieldValuesRepository
                .findBySourceTypeAndSourceIdIn("AUDIENCE_RESPONSE", responseIds);

        // Group by sourceId (response ID)
        Map<String, List<CustomFieldValues>> cfValuesByResponseId = allCfValues.stream()
                .collect(Collectors.groupingBy(CustomFieldValues::getSourceId));

        // Batch fetch custom field definitions for field names
        Set<String> allCustomFieldIds = allCfValues.stream()
                .map(CustomFieldValues::getCustomFieldId)
                .collect(Collectors.toSet());
        Map<String, CustomFields> fieldDefsById = allCustomFieldIds.isEmpty()
                ? Collections.emptyMap()
                : customFieldRepository.findAllById(allCustomFieldIds).stream()
                        .collect(Collectors.toMap(CustomFields::getId, cf -> cf, (a, b) -> a));

        // Batch fetch source audience names for OPT_OUT entries
        Set<String> sourceAudienceIds = content.stream()
                .filter(r -> "OPT_OUT".equals(r.getSourceType()) && StringUtils.hasText(r.getSourceId()))
                .map(AudienceResponse::getSourceId)
                .collect(Collectors.toSet());
        Map<String, String> sourceAudienceIdToName = sourceAudienceIds.isEmpty() ? Collections.emptyMap()
                : audienceRepository.findAllById(sourceAudienceIds).stream()
                        .collect(Collectors.toMap(Audience::getId, Audience::getCampaignName, (a, b) -> a));

        // Batch fetch campaign names for the audiences these responses belong to.
        // Used by the cross-audience "Recent Leads" view, but cheap enough to
        // always populate.
        Set<String> audienceIds = content.stream()
                .map(AudienceResponse::getAudienceId)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet());
        // Keep the whole Audience, not just its name: the leads table also shows the
        // campaign type (the channel a lead came in through), and reusing this one
        // fetch keeps that free.
        Map<String, Audience> audienceById = audienceIds.isEmpty() ? Collections.emptyMap()
                : audienceRepository.findAllById(audienceIds).stream()
                        .collect(Collectors.toMap(Audience::getId, a -> a, (a, b) -> a));

        // Latest UTM tagging per lead — one query for the whole page, not one per row.
        // Keyed by user_id because that is what utm_attribution carries.
        Map<String, String[]> utmByUserId = new HashMap<>();
        if (StringUtils.hasText(instituteId) && !userIds.isEmpty()) {
            try {
                for (Object[] row : utmAttributionRepository.findLatestForUsers(instituteId, userIds)) {
                    utmByUserId.put((String) row[0],
                            new String[] { (String) row[1], (String) row[2] });
                }
            } catch (Exception e) {
                // UTM is decoration on this screen; never fail the leads list for it.
                logger.warn("Could not load UTM attribution for the leads page: {}", e.getMessage());
            }
        }

        return responses.map(response -> {
            // Build custom field values map from batch-fetched data
            List<CustomFieldValues> responseCfValues = cfValuesByResponseId
                    .getOrDefault(response.getId(), Collections.emptyList());
            Map<String, String> customFieldValues = responseCfValues.stream()
                    .collect(Collectors.toMap(
                            CustomFieldValues::getCustomFieldId,
                            CustomFieldValues::getValue,
                            (v1, v2) -> v2));

            // Build metadata: fieldId -> { fieldName, fieldKey, fieldType }
            Map<String, Object> customFieldMetadata = new HashMap<>();
            for (CustomFieldValues cfv : responseCfValues) {
                CustomFields fieldDef = fieldDefsById.get(cfv.getCustomFieldId());
                if (fieldDef != null) {
                    Map<String, String> meta = new HashMap<>();
                    meta.put("fieldName", fieldDef.getFieldName());
                    meta.put("fieldKey", fieldDef.getFieldKey());
                    meta.put("fieldType", fieldDef.getFieldType());
                    customFieldMetadata.put(cfv.getCustomFieldId(), meta);
                }
            }

            var score = scoreByResponseId.get(response.getId());
            String counselorId = response.getEnquiryId() != null
                    ? enquiryIdToCounselor.get(response.getEnquiryId())
                    : null;

            // Reach-out deadline = the effective TAT deadline from SQL when TAT is on (admin
            // override, else working-hours aware); else the scheduler-stamped value, which may
            // be null.
            Timestamp computedTatDueAt = tatMinutesFinal != null && tatDueByResponseId.containsKey(response.getId())
                    ? tatDueByResponseId.get(response.getId())
                    : response.getTatDueAt();
            Timestamp lastAction = lastActionByResponseId.get(response.getId());
            // "Follow up at" = ONLY a counsellor-explicitly-scheduled callback (a row in
            // `lead_followup`). Do NOT auto-fill from the SLA deadline (last action +
            // followUpSlaHours) — the cell is about "when did the counsellor promise to call
            // back", not "when does the SLA reminder fire". The SLA breach is surfaced
            // separately via tat_reminder_stage / follow_up_overdue.
            LeadFollowup scheduledFollowup = scheduledFollowupByResponseId.get(response.getId());
            Timestamp computedFollowUpDueAt = scheduledFollowup != null
                    ? scheduledFollowup.getScheduleTime()
                    : null;
            // First-response timestamp powers the "Reach out by → ✓ Responded" display.
            // TAT definition: first response event on the lead minus submitted_at.
            vacademy.io.admin_core_service.features.audience.entity.UserLeadProfile profile = response
                    .getUserId() != null ? userIdToProfile.get(response.getUserId()) : null;
            Timestamp firstResponseAt = firstActionByResponseId.get(response.getId());
            // Same COALESCE as the status column: per-response status first, else the profile's.
            // A Lost / Converted lead is off the SLA clock — no Pending / Overdue badge.
            String effectiveStatusKey = response.getLeadStatusId() != null
                    && leadStatusIdToStatusKey.containsKey(response.getLeadStatusId())
                            ? leadStatusIdToStatusKey.get(response.getLeadStatusId())
                            : (profile != null ? profile.getConversionStatus() : null);
            boolean slaClosed = "LOST".equals(effectiveStatusKey) || "CONVERTED".equals(effectiveStatusKey);
            String slaStage = slaClosed ? null : response.getTatReminderStage();

            return LeadDetailDTO.builder()
                    .responseId(response.getId())
                    .audienceId(response.getAudienceId())
                    .campaignName(Optional.ofNullable(audienceById.get(response.getAudienceId()))
                            .map(Audience::getCampaignName).orElse(null))
                    .campaignType(Optional.ofNullable(audienceById.get(response.getAudienceId()))
                            .map(Audience::getCampaignType).orElse(null))
                    .utmSource(Optional.ofNullable(utmByUserId.get(response.getUserId()))
                            .map(u -> u[0]).orElse(null))
                    .utmCampaign(Optional.ofNullable(utmByUserId.get(response.getUserId()))
                            .map(u -> u[1]).orElse(null))
                    .userId(response.getUserId())
                    .studentUserId(response.getStudentUserId())
                    .user(StringUtils.hasText(response.getUserId()) ? userIdToUser.get(response.getUserId()) : null)
                    .sourceType(response.getSourceType())
                    .sourceId(response.getSourceId())
                    .submittedAtLocal(response.getSubmittedAt())
                    .customFieldValues(customFieldValues)
                    .customFieldMetadata(customFieldMetadata)
                    .isDuplicate(response.getIsDuplicate())
                    .primaryResponseId(response.getPrimaryResponseId())
                    .duplicateCount(duplicateCountByResponseId.get(response.getId()))
                    .followUpPriority(priorityFollowupResponseIds.contains(response.getId()))
                    .overallStatus(response.getOverallStatus())
                    .conversionStatus(response.getConversionStatus())
                    .enquiryId(response.getEnquiryId())
                    .leadStatus(
                            response.getLeadStatusId() != null
                                    && leadStatusIdToKey.containsKey(response.getLeadStatusId())
                                            ? leadStatusIdToKey.get(response.getLeadStatusId())
                                            : (profile != null && profile.getConversionStatus() != null
                                                    ? leadStatusKeyToLabel.getOrDefault(
                                                            profile.getConversionStatus(),
                                                            profile.getConversionStatus())
                                                    : null))
                    .parentName(response.getParentName())
                    .parentEmail(response.getParentEmail())
                    .parentMobile(response.getParentMobile())
                    .leadScore(score != null ? score.getRawScore() : null)
                    // Stored tier wins over the one derived from the score - see the field
                    // doc on LeadDetailDTO.
                    .leadTier(profile != null && StringUtils.hasText(profile.getLeadTier())
                            ? profile.getLeadTier()
                            : (score != null
                                    ? leadTierService.deriveTier(instituteId, score.getRawScore())
                                    : null))
                    .percentileRank(score != null && score.getPercentileRank() != null
                            ? score.getPercentileRank().doubleValue()
                            : null)
                    // A lead with no linked enquiry (every CRM-imported one) carries its
                    // counsellor only on the profile, so the enquiry lookup alone returned
                    // null for all of them.
                    .assignedCounselorId(StringUtils.hasText(counselorId)
                            ? counselorId
                            : (profile != null ? profile.getAssignedCounselorId() : null))
                    .assignedCounselorName(profile != null ? profile.getAssignedCounselorName() : null)
                    .followUpContent(scheduledFollowup != null ? scheduledFollowup.getContent() : null)
                    .followUpStudentResponse(
                            scheduledFollowup != null ? scheduledFollowup.getStudentResponse() : null)
                    .followUpMode(scheduledFollowup != null ? scheduledFollowup.getFollowUpMode() : null)
                    .followUpNextAction(scheduledFollowup != null ? scheduledFollowup.getNextAction() : null)
                    .followUpInterestLevel(
                            scheduledFollowup != null ? scheduledFollowup.getInterestLevel() : null)
                    .sourceAudienceName("OPT_OUT".equals(response.getSourceType())
                            ? sourceAudienceIdToName.get(response.getSourceId())
                            : null)
                    .tatDueAt(computedTatDueAt)
                    .tatDueOverridden(response.getTatDueOverrideAt() != null)
                    .firstResponseAt(firstResponseAt)
                    .followUpDueAt(computedFollowUpDueAt)
                    .tatReminderStage(slaStage)
                    .tatOverdue(LeadTriggerContextBuilder.STAGE_TAT_OVERDUE.equals(slaStage))
                    .followUpOverdue(
                            LeadTriggerContextBuilder.STAGE_FOLLOW_UP_OVERDUE.equals(slaStage))
                    .tatDueSoon(LeadTriggerContextBuilder.STAGE_TAT_BEFORE.equals(slaStage)
                            || LeadTriggerContextBuilder.STAGE_FOLLOW_UP_DUE.equals(slaStage))
                    .slaClosed(slaClosed)
                    .build();
        });
    }

    /**
     * Get lead details by ID
     */
    @Transactional(readOnly = true)
    public LeadDetailDTO getLeadById(String responseId) {
        AudienceResponse response = audienceResponseRepository.findById(responseId)
                .orElseThrow(() -> new VacademyException("Lead not found"));

        Audience audience = audienceRepository.findById(response.getAudienceId())
                .orElseThrow(() -> new VacademyException("Audience not found"));

        // Values keyed by custom_field_id, plus the field DEFINITIONS behind them.
        // Without the definitions a consumer can only label each answer with its
        // field UUID — which is what the lead side-sheet did when it was opened
        // from a surface that had no list row to copy metadata from (the Call
        // Log), so the form-response card rendered nothing usable.
        List<CustomFieldValues> cfValues = customFieldValuesRepository
                .findBySourceTypeAndSourceIdIn("AUDIENCE_RESPONSE", List.of(response.getId()));
        Map<String, String> customFieldValues = cfValues.stream()
                .collect(Collectors.toMap(
                        CustomFieldValues::getCustomFieldId,
                        CustomFieldValues::getValue,
                        (v1, v2) -> v2));

        Set<String> fieldIds = cfValues.stream()
                .map(CustomFieldValues::getCustomFieldId)
                .collect(Collectors.toSet());
        Map<String, CustomFields> fieldDefsById = fieldIds.isEmpty() ? Collections.emptyMap()
                : customFieldRepository.findAllById(fieldIds).stream()
                        .collect(Collectors.toMap(CustomFields::getId, cf -> cf, (a, b) -> a));
        Map<String, Object> customFieldMetadata = new HashMap<>();
        for (CustomFieldValues cfv : cfValues) {
            CustomFields fieldDef = fieldDefsById.get(cfv.getCustomFieldId());
            if (fieldDef == null) continue;
            Map<String, String> meta = new HashMap<>();
            meta.put("fieldName", fieldDef.getFieldName());
            meta.put("fieldKey", fieldDef.getFieldKey());
            meta.put("fieldType", fieldDef.getFieldType());
            customFieldMetadata.put(cfv.getCustomFieldId(), meta);
        }

        // The lead's OWN identity. The parent_* columns below are the guardian —
        // a different person — so a consumer that shows `parentName` as the lead's
        // name prints the guardian's. Both are returned; neither substitutes.
        UserDTO user = null;
        if (StringUtils.hasText(response.getUserId())) {
            try {
                user = authService.getUsersFromAuthServiceByUserIds(List.of(response.getUserId()))
                        .stream().filter(Objects::nonNull).findFirst().orElse(null);
            } catch (Exception e) {
                // Identity hydration is best-effort: the caller still gets the
                // response, its answers and the guardian rows.
                logger.warn("getLeadById: user hydration failed for {}: {}",
                        response.getUserId(), e.getMessage());
            }
        }

        return LeadDetailDTO.builder()
                .responseId(response.getId())
                .audienceId(response.getAudienceId())
                .campaignName(audience.getCampaignName())
                .campaignType(audience.getCampaignType())
                .userId(response.getUserId())
                .studentUserId(response.getStudentUserId())
                .user(user)
                .sourceType(response.getSourceType())
                .sourceId(response.getSourceId())
                .submittedAtLocal(response.getSubmittedAt())
                .customFieldValues(customFieldValues)
                .customFieldMetadata(customFieldMetadata)
                .parentName(response.getParentName())
                .parentEmail(response.getParentEmail())
                .parentMobile(response.getParentMobile())
                .overallStatus(response.getOverallStatus())
                .conversionStatus(response.getConversionStatus())
                .enquiryId(response.getEnquiryId())
                .isDuplicate(response.getIsDuplicate())
                .primaryResponseId(response.getPrimaryResponseId())
                .build();
    }

    /**
     * Soft-delete one or more leads.
     *
     * <p>Sets {@code audience_status = INACTIVE} instead of removing the row, so the lead
     * disappears from lead views and — the point of the feature — from every promotional and
     * automated send recipient list, while call history, admission records and reports keep
     * referring to a row that still exists.</p>
     *
     * <p>Restricted to ADMIN. A lead that has already converted cannot be deleted (409): the
     * row is now the head of an admission/payment trail, and hiding it would strand that trail.</p>
     *
     * <p>Deliberately does NOT touch {@code user_lead_profile}: that is one row per person per
     * institute and carries the counsellor assignment, while this is per response. Deleting one
     * of a person's leads must not drop their assignment. The workbench derives its own
     * visibility instead.</p>
     *
     * @return the number of leads actually flipped ACTIVE -> INACTIVE.
     */
    @Transactional
    public int deleteLeads(LeadDeleteRequestDTO request, CustomUserDetails actor) {
        List<AudienceResponse> targets = resolveDeleteTargets(request, actor);

        // Block converted leads BEFORE mutating anything, so a bulk delete containing one
        // converted lead fails whole rather than half-applying.
        for (AudienceResponse response : targets) {
            String leadUserId = response.getUserId() != null ? response.getUserId() : response.getStudentUserId();
            if (leadUserId != null && isConverted(leadUserId, request.getInstituteId())) {
                throw new ConflictException(
                        "This lead has already converted and cannot be deleted.");
            }
        }

        int deleted = 0;
        for (AudienceResponse response : targets) {
            if (AudienceStatusEnum.INACTIVE.name().equalsIgnoreCase(response.getAudienceStatus())) {
                continue; // already deleted — idempotent
            }
            response.setAudienceStatus(AudienceStatusEnum.INACTIVE.name());
            audienceResponseRepository.save(response);
            logLeadCurationEvent(response, actor, LeadJourneyActionType.LEAD_DELETED,
                    "Lead deleted", "Lead removed from the CRM", request.getScope(), request.getInstituteId());
            deleted++;
        }
        logger.info("Soft-deleted {} lead(s) (scope={}) by user {}",
                deleted, resolveScope(request), actor.getUserId());
        return deleted;
    }

    /**
     * Restore soft-deleted leads — the inverse of {@link #deleteLeads}. ADMIN only.
     *
     * @return the number of leads actually flipped INACTIVE -> ACTIVE.
     */
    @Transactional
    public int restoreLeads(LeadDeleteRequestDTO request, CustomUserDetails actor) {
        List<AudienceResponse> targets = resolveDeleteTargets(request, actor);

        int restored = 0;
        for (AudienceResponse response : targets) {
            if (!AudienceStatusEnum.INACTIVE.name().equalsIgnoreCase(response.getAudienceStatus())) {
                continue; // already active — idempotent
            }
            response.setAudienceStatus(AudienceStatusEnum.ACTIVE.name());
            audienceResponseRepository.save(response);
            logLeadCurationEvent(response, actor, LeadJourneyActionType.LEAD_RESTORED,
                    "Lead restored", "Lead restored to the CRM", request.getScope(), request.getInstituteId());
            restored++;
        }
        logger.info("Restored {} lead(s) (scope={}) by user {}",
                restored, resolveScope(request), actor.getUserId());
        return restored;
    }

    /**
     * Revive any soft-deleted lead this person holds in this campaign, on re-submission.
     *
     * <p>Without this, a delete is a permanent blackhole. The intake guards ask
     * {@code existsByAudienceIdAndUserId}, which is a derived query and therefore status-blind:
     * it matches the INACTIVE row, the guard early-returns "you have already submitted", and no
     * insert and no un-hide ever happen. The person could resubmit forever and stay invisible.</p>
     *
     * <p>Callers must return immediately after this, exactly as they do today for a live
     * duplicate — NOT fall through to the insert. Falling through would both create a duplicate
     * row and re-run {@code autoAssignCounsellorOnIntake}, which would advance the pool's
     * round-robin pointer and re-roll a counsellor the lead already had.</p>
     *
     * @return true if at least one row was revived (for logging only; the caller returns either way).
     */
    private boolean reactivateSoftDeletedLeads(String audienceId, String userId) {
        if (!StringUtils.hasText(audienceId) || !StringUtils.hasText(userId)) {
            return false;
        }
        List<AudienceResponse> hidden = audienceResponseRepository
                .findByAudienceIdAndUserIdAndAudienceStatus(
                        audienceId, userId, AudienceStatusEnum.INACTIVE.name());
        if (CollectionUtils.isEmpty(hidden)) {
            return false;
        }
        hidden.forEach(lead -> {
            lead.setAudienceStatus(AudienceStatusEnum.ACTIVE.name());
            audienceResponseRepository.save(lead);
            logger.info("Reactivated soft-deleted lead {} on re-submission", lead.getId());
        });
        return true;
    }

    /**
     * Resolve the rows a delete/restore acts on, enforcing the ADMIN check.
     *
     * <p>Under RESPONSE scope the given ids ARE the targets. Under USER scope they only identify
     * the people, and every lead those people hold in this institute is swept in.</p>
     */
    private List<AudienceResponse> resolveDeleteTargets(LeadDeleteRequestDTO request, CustomUserDetails actor) {
        if (request == null || CollectionUtils.isEmpty(request.getResponseIds())) {
            throw new InvalidRequestException("At least one response id is required");
        }
        if (!StringUtils.hasText(request.getInstituteId())) {
            throw new InvalidRequestException("instituteId is required");
        }
        if (!hasAdminRole(actor, request.getInstituteId())) {
            throw new ForbiddenException("Only an admin can delete or restore a lead");
        }

        // Resolve the targets THROUGH the institute, never by raw id. The role check above only
        // proves the caller administers the institute they named — it says nothing about who owns
        // the rows they asked for. Fetching by id alone would let an admin pass their own
        // institute_id (satisfying that check) with another tenant's response ids and delete them.
        List<AudienceResponse> found = audienceResponseRepository
                .findAllByInstituteAndIds(request.getInstituteId(), request.getResponseIds());
        if (found.size() != new HashSet<>(request.getResponseIds()).size()) {
            // Some id was unknown, or belongs to another institute. Same 404 either way: telling
            // the caller which would confirm the existence of a lead they may not be entitled to see.
            throw new ResourceNotFoundException("Lead not found");
        }

        if (!"USER".equalsIgnoreCase(resolveScope(request))) {
            return found;
        }

        // USER scope — expand to every lead these people hold in this institute.
        List<String> userIds = found.stream()
                .map(r -> r.getUserId() != null ? r.getUserId() : r.getStudentUserId())
                .filter(StringUtils::hasText)
                .distinct()
                .toList();
        if (userIds.isEmpty()) {
            return found;
        }
        return audienceResponseRepository.findAllByInstituteAndUserIds(request.getInstituteId(), userIds);
    }

    private String resolveScope(LeadDeleteRequestDTO request) {
        return StringUtils.hasText(request.getScope()) ? request.getScope().toUpperCase() : "RESPONSE";
    }

    /**
     * Chunk size for the {@code lead_score} lookup a migration does, keeping that IN-list well
     * under Postgres' bind-parameter limit however many leads are moved at once.
     */
    private static final int MIGRATE_BATCH_SIZE = 500;

    /**
     * Move leads from one lead list to another. ADMIN only.
     *
     * <p>A list is an {@code audience} and a lead is an {@code audience_response}, attached by a
     * plain {@code audience_id} column — so the move itself is one column update. Everything keyed
     * by response id (status history, follow-ups, timeline, calls, engagement) follows the row with
     * no work. Two things do not, because they denormalise the audience:</p>
     * <ul>
     *   <li>{@code lead_score.audience_id} — updated here, or scores stay attributed to the old
     *       list.</li>
     *   <li>{@code audience_response.initial_score} — a snapshot of the SOURCE list's
     *       {@code default_initial_score} taken at creation. Deliberately kept: re-snapshotting
     *       would silently rescore historical leads as a side effect of an admin tidying up.</li>
     * </ul>
     *
     * <p>Partial success: colliding leads are skipped and reported. Merging two lists collides by
     * definition, and an all-or-nothing batch would be unusable at the sizes this runs at.</p>
     *
     * @return counts plus the per-lead skip reasons.
     */
    @Transactional
    public MigrateLeadsResponseDTO migrateLeads(MigrateLeadsRequestDTO request, CustomUserDetails actor) {
        if (request == null || CollectionUtils.isEmpty(request.getResponseIds())) {
            throw new InvalidRequestException("At least one response id is required");
        }
        if (!StringUtils.hasText(request.getInstituteId())) {
            throw new InvalidRequestException("instituteId is required");
        }
        if (!StringUtils.hasText(request.getTargetAudienceId())) {
            throw new InvalidRequestException("targetAudienceId is required");
        }
        if (!hasAdminRole(actor, request.getInstituteId())) {
            throw new ForbiddenException("Only an admin can move a lead to another list");
        }

        String instituteId = request.getInstituteId();
        String targetAudienceId = request.getTargetAudienceId();

        // SECURITY: resolve the TARGET through the institute too. The ADMIN check above only proves
        // the caller administers the institute they named, and resolveMigrateTargets below only
        // proves the SOURCE rows belong to it — neither says anything about the destination. Without
        // this, a legitimate admin could move their own institute's leads into another tenant's list
        // by passing its id. The vague not-found mirrors the delete path: naming the mismatch would
        // confirm the existence of a list the caller is not entitled to see.
        Audience targetAudience = audienceRepository.findById(targetAudienceId)
                .filter(a -> instituteId.equals(a.getInstituteId()))
                .orElseThrow(() -> new ResourceNotFoundException("Lead list not found"));

        // CONSENT: the opt-out list is not an ordinary list. Opting out moves the person's response
        // into it and leaves the OPTED_OUT flag on the row it replaced — so the row sitting IN the
        // opt-out list carries no flag of its own. Moving those rows out would re-subscribe people
        // who explicitly asked not to be contacted, past every suppression predicate in the system.
        // Moving INTO it is equally wrong: AudienceOptOutService also copies custom fields and fires
        // the opt-out workflow, none of which a bare column update would do.
        String optOutAudienceId = audienceRepository.findOptOutAudienceByInstituteId(instituteId)
                .map(Audience::getId)
                .orElse(null);
        if (targetAudienceId.equals(optOutAudienceId)) {
            throw new InvalidRequestException(
                    "Leads cannot be moved into the opt-out list. Use the opt-out action instead.");
        }

        MigrateLeadsRequestDTO.WorkflowAnchorMode anchorMode = resolveWorkflowAnchorMode(request);

        List<AudienceResponse> targets = resolveMigrateTargets(request, actor);

        List<MigrateLeadsResponseDTO.SkippedLead> skipped = new ArrayList<>();
        List<AudienceResponse> movable = new ArrayList<>();
        // Users already holding a response in the target list. Seeded from the DB, then extended as
        // this batch moves people in — otherwise two selected responses for the SAME person would
        // both pass the check and land in the target together, creating exactly the duplicate the
        // one-response-per-person-per-list invariant forbids.
        Set<String> usersInTarget = new HashSet<>();

        for (AudienceResponse response : targets) {
            String leadUserId = response.getUserId() != null ? response.getUserId() : response.getStudentUserId();

            if (targetAudienceId.equals(response.getAudienceId())) {
                skipped.add(skip(response, MigrateLeadsResponseDTO.SkipReason.ALREADY_IN_TARGET_LIST,
                        "Already in this lead list."));
                continue;
            }
            if (optOutAudienceId != null && optOutAudienceId.equals(response.getAudienceId())) {
                skipped.add(skip(response, MigrateLeadsResponseDTO.SkipReason.IN_OPT_OUT_LIST,
                        "This lead has opted out and cannot be moved out of the opt-out list."));
                continue;
            }
            if ("OPTED_OUT".equalsIgnoreCase(response.getOverallStatus())) {
                skipped.add(skip(response, MigrateLeadsResponseDTO.SkipReason.OPTED_OUT,
                        "This lead has opted out of contact."));
                continue;
            }
            if (AudienceStatusEnum.INACTIVE.name().equalsIgnoreCase(response.getAudienceStatus())) {
                skipped.add(skip(response, MigrateLeadsResponseDTO.SkipReason.LEAD_DELETED,
                        "This lead is deleted. Restore it before moving it."));
                continue;
            }
            if (leadUserId != null && isConverted(leadUserId, instituteId)) {
                skipped.add(skip(response, MigrateLeadsResponseDTO.SkipReason.LEAD_CONVERTED,
                        "This lead has already converted."));
                continue;
            }
            if (StringUtils.hasText(leadUserId)
                    && (usersInTarget.contains(leadUserId)
                            || audienceResponseRepository.existsByAudienceIdAndUserId(targetAudienceId, leadUserId))) {
                skipped.add(skip(response, MigrateLeadsResponseDTO.SkipReason.DUPLICATE_USER_IN_TARGET,
                        "This person already has a lead in the target list."));
                continue;
            }

            // The institute's dedup rule, evaluated against the TARGET list — dedup is scoped per
            // list, so a lead that is unique where it sits can still collide once moved. Excluding
            // this row keeps it from matching itself under INSTITUTE scope.
            //
            // LIMITATION: this reads the row's own parent_email / parent_mobile, whereas intake
            // passes the incoming USER's email/mobile. Leads created through the simple submit flow
            // keep their contact details only on the auth user, leaving parent_* blank — and
            // checkDuplicate no-ops on a blank field, so those leads move without a dedup check.
            // It fails OPEN, matching what intake itself does when the field is blank, and the
            // same-person case is still caught by the DUPLICATE_USER_IN_TARGET guard above; what
            // slips through is only a DIFFERENT user record sharing an email/phone. Closing it
            // properly means resolving the moved set through auth_service first.
            Optional<LeadDeduplicationService.DuplicateMatch> dupMatch = leadDeduplicationService.checkDuplicate(
                    instituteId, targetAudienceId, response.getParentEmail(), response.getParentMobile(),
                    response.getId());
            if (dupMatch.isPresent()
                    && dupMatch.get().action() == LeadDedupSettingService.DedupAction.REJECT) {
                skipped.add(skip(response, MigrateLeadsResponseDTO.SkipReason.DUPLICATE_IN_TARGET,
                        dupMatch.get().rejectionMessage()));
                continue;
            }

            movable.add(response);
            if (StringUtils.hasText(leadUserId)) {
                usersInTarget.add(leadUserId);
            }
        }

        // Recomputed once, not per lead: it derives from the target audience alone.
        Timestamp resetAnchor = anchorMode == MigrateLeadsRequestDTO.WorkflowAnchorMode.RESET_TO_TARGET
                ? calculateWorkflowActivateDayAt(targetAudience)
                : null;

        int migrated = 0;
        for (AudienceResponse response : movable) {
            String fromAudienceId = response.getAudienceId();

            // Written once and never overwritten, so it keeps pointing at where the lead STARTED
            // however many times it is moved afterwards.
            if (!StringUtils.hasText(response.getOriginalAudienceId()) && StringUtils.hasText(fromAudienceId)) {
                response.setOriginalAudienceId(fromAudienceId);
            }
            response.setAudienceId(targetAudienceId);
            if (resetAnchor != null) {
                response.setWorkflowActivateDayAt(resetAnchor);
            }
            migrated++;

            logLeadListChangeEvent(response, actor, fromAudienceId, targetAudience, anchorMode, instituteId);
        }
        // These entities came from a repository query inside this transaction, so they are managed:
        // the field writes above are already dirty-checked and flushed at commit. saveAll() here is
        // explicitness, not a second write.
        //
        // NOTE: this is one transaction, and the persistence context holds every moved row for its
        // duration. That is fine at the sizes the UI can select, but it is NOT the batched,
        // per-chunk-commit write path a true bulk move needs — that work is tracked separately
        // alongside the same problem in deleteLeads and CounsellorReassignService.
        audienceResponseRepository.saveAll(movable);

        // lead_score denormalises audience_id (NOT NULL), so it has to follow the row or the score
        // stays attributed to the list the lead just left. Chunked read/write over the moved ids
        // rather than a lookup per lead.
        syncLeadScoreAudience(movable, targetAudienceId);

        logger.info("Migrated {} lead(s) into audience {} (skipped {}, anchor={}) by user {}",
                migrated, targetAudienceId, skipped.size(), anchorMode, actor.getUserId());

        // Run the target list's event-driven automations on the moved leads, exactly as if each
        // had just been submitted there. "Start the new list's automation from day one"
        // (RESET_TO_TARGET) means the whole of it: the scheduled drip re-anchored above AND the
        // Lead-Submitted workflows (AI call, instant WhatsApp/email) — an admin picking it is
        // asking for the lead to be treated as new, and the dialog promises exactly that. The
        // explicit flag is kept for API callers who want the event workflows without touching
        // the drip anchor. PRESERVE + no flag = pure bookkeeping, nothing fires. Contexts are
        // built now (inside the transaction, reads only) but fired only after commit — a
        // workflow that dials or messages must see the lead already in its new list, and a
        // rollback must fire nothing.
        boolean runAutomations = Boolean.TRUE.equals(request.getRunDestinationAutomations())
                || anchorMode == MigrateLeadsRequestDTO.WorkflowAnchorMode.RESET_TO_TARGET;
        if (runAutomations && !movable.isEmpty()) {
            scheduleDestinationAutomations(movable, targetAudience, instituteId);
        }

        return MigrateLeadsResponseDTO.builder()
                .migrated(migrated)
                .skipped(skipped)
                .build();
    }

    /**
     * Build one AUDIENCE_LEAD_SUBMISSION context per moved lead and hand the batch to
     * {@link LeadMoveWorkflowAsyncHelper} once the move commits. Skipped silently when the
     * target list has no ACTIVE lead-submission trigger — nothing would run, so nothing to build.
     *
     * <p>The context mirrors {@link #submitLead}'s so the same workflow nodes work unchanged
     * (CALL_AI reads responseId / userId / phone; SEND_WHATSAPP reads user + customFields).
     * Two deliberate differences: {@code leadSource = "LEAD_MOVED"} (+ {@code fromAudienceId})
     * so a workflow can branch on it, and the respondent/admin email request lists are EMPTY —
     * the person did not just fill a form, so a "thank you for submitting" email would be wrong.
     */
    private void scheduleDestinationAutomations(List<AudienceResponse> moved, Audience targetAudience,
            String instituteId) {
        String targetAudienceId = targetAudience.getId();
        boolean triggerExists = workflowTriggerService
                .findByInstituteIdEventNameAndEventId(instituteId,
                        WorkflowTriggerEvent.AUDIENCE_LEAD_SUBMISSION.name(), targetAudienceId)
                .isPresent();
        if (!triggerExists) {
            logger.info("Moved-lead automations requested but audience {} has no active lead-submission trigger — nothing to run",
                    targetAudienceId);
            return;
        }

        // One auth round-trip for every moved lead's user, not one per lead.
        List<String> userIds = moved.stream()
                .map(r -> r.getUserId() != null ? r.getUserId() : r.getStudentUserId())
                .filter(StringUtils::hasText)
                .distinct()
                .toList();
        Map<String, UserDTO> usersById = new HashMap<>();
        if (!userIds.isEmpty()) {
            try {
                for (UserDTO u : authService.getUsersFromAuthServiceByUserIds(userIds)) {
                    if (u != null && u.getId() != null) usersById.put(u.getId(), u);
                }
            } catch (Exception e) {
                logger.warn("Could not fetch users for moved-lead automations: {}", e.getMessage());
            }
        }

        AudienceDTO audienceDTO = AudienceDTO.builder()
                .id(targetAudience.getId())
                .campaignName(targetAudience.getCampaignName())
                .instituteId(targetAudience.getInstituteId())
                .status(targetAudience.getStatus())
                .toNotify(targetAudience.getToNotify())
                .sendRespondentEmail(targetAudience.getSendRespondentEmail())
                .build();
        String instituteName = instituteRepository.findById(instituteId)
                .map(Institute::getInstituteName).orElse("");
        String submissionTime = java.time.ZonedDateTime.now()
                .format(java.time.format.DateTimeFormatter.ofPattern("MMM dd, yyyy hh:mm a z"));

        List<Map<String, Object>> contexts = new ArrayList<>();
        for (AudienceResponse response : moved) {
            String leadUserId = response.getUserId() != null ? response.getUserId() : response.getStudentUserId();
            Map<String, Object> ctx = new HashMap<>();
            ctx.put("user", usersById.get(leadUserId));
            ctx.put("audience", audienceDTO);
            ctx.put("audienceId", targetAudienceId);
            ctx.put("instituteId", instituteId);
            ctx.put("instituteName", instituteName);
            ctx.put("customFields", buildCustomFieldMapForEmail(response.getId()));
            ctx.put("submissionTime", submissionTime);
            ctx.put("responseId", response.getId());
            ctx.put("userId", leadUserId);
            ctx.put("leadUserId", leadUserId);
            ctx.put("phone", response.getParentMobile());
            ctx.put("parentMobile", response.getParentMobile());
            ctx.put("campaignName", targetAudience.getCampaignName());
            ctx.put("sendRespondentEmail", false);
            ctx.put("respondentEmailRequests", new ArrayList<>());
            ctx.put("adminEmailRequests", new ArrayList<>());
            ctx.put("leadSource", "LEAD_MOVED");
            ctx.put("fromAudienceId", response.getOriginalAudienceId());
            contexts.add(ctx);
        }

        Runnable fire = () -> leadMoveWorkflowAsyncHelper
                .fireDestinationLeadSubmission(targetAudienceId, instituteId, contexts);
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    fire.run();
                }
            });
        } else {
            fire.run();
        }
    }

    private MigrateLeadsResponseDTO.SkippedLead skip(AudienceResponse response,
            MigrateLeadsResponseDTO.SkipReason reason, String detail) {
        return MigrateLeadsResponseDTO.SkippedLead.builder()
                .responseId(response.getId())
                .reason(reason.name())
                .detail(detail)
                .build();
    }

    private MigrateLeadsRequestDTO.WorkflowAnchorMode resolveWorkflowAnchorMode(MigrateLeadsRequestDTO request) {
        if (!StringUtils.hasText(request.getWorkflowAnchor())) {
            return MigrateLeadsRequestDTO.WorkflowAnchorMode.PRESERVE;
        }
        try {
            return MigrateLeadsRequestDTO.WorkflowAnchorMode.valueOf(
                    request.getWorkflowAnchor().trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            // Fail closed. An unrecognised value must not fall through to the mode that sends
            // messages.
            throw new InvalidRequestException(
                    "workflow_anchor must be PRESERVE or RESET_TO_TARGET");
        }
    }

    /**
     * Keep {@code lead_score.audience_id} in step with the rows that just moved. Batched over the
     * moved responses; leads with no score row simply have nothing to update.
     */
    private void syncLeadScoreAudience(List<AudienceResponse> moved, String targetAudienceId) {
        List<String> responseIds = moved.stream()
                .map(AudienceResponse::getId)
                .filter(StringUtils::hasText)
                .toList();
        for (int start = 0; start < responseIds.size(); start += MIGRATE_BATCH_SIZE) {
            List<String> batch = responseIds.subList(
                    start, Math.min(start + MIGRATE_BATCH_SIZE, responseIds.size()));
            List<LeadScore> scores = leadScoreRepository.findByAudienceResponseIdIn(batch);
            if (scores.isEmpty()) {
                continue;
            }
            scores.forEach(s -> s.setAudienceId(targetAudienceId));
            leadScoreRepository.saveAll(scores);
        }
    }

    /**
     * Resolve the rows a migration acts on, enforcing the ADMIN check and institute ownership —
     * the same shape as {@link #resolveDeleteTargets}, and for the same reason: resolving by raw id
     * would let an admin pass their own institute_id together with another tenant's response ids.
     */
    private List<AudienceResponse> resolveMigrateTargets(MigrateLeadsRequestDTO request, CustomUserDetails actor) {
        List<AudienceResponse> found = audienceResponseRepository
                .findAllByInstituteAndIds(request.getInstituteId(), request.getResponseIds());
        if (found.size() != new HashSet<>(request.getResponseIds()).size()) {
            throw new ResourceNotFoundException("Lead not found");
        }

        String scope = StringUtils.hasText(request.getScope()) ? request.getScope().toUpperCase() : "RESPONSE";
        if (!"USER".equalsIgnoreCase(scope)) {
            return found;
        }

        List<String> userIds = found.stream()
                .map(r -> r.getUserId() != null ? r.getUserId() : r.getStudentUserId())
                .filter(StringUtils::hasText)
                .distinct()
                .toList();
        if (userIds.isEmpty()) {
            return found;
        }
        return audienceResponseRepository.findAllByInstituteAndUserIds(request.getInstituteId(), userIds);
    }

    /** Best-effort audit trail for a list change — a move must be attributable, but must not fail
     *  over logging. */
    private void logLeadListChangeEvent(AudienceResponse response, CustomUserDetails actor,
            String fromAudienceId, Audience targetAudience,
            MigrateLeadsRequestDTO.WorkflowAnchorMode anchorMode, String instituteId) {
        String leadUserId = response.getUserId() != null ? response.getUserId() : response.getStudentUserId();
        if (!StringUtils.hasText(leadUserId)) {
            return;
        }
        try {
            String fromName = fromAudienceId == null ? null
                    : audienceRepository.findById(fromAudienceId).map(Audience::getCampaignName).orElse(null);
            Map<String, Object> metadata = new HashMap<>();
            metadata.put("response_id", response.getId());
            metadata.put("from_audience_id", fromAudienceId != null ? fromAudienceId : "");
            metadata.put("from_campaign_name", fromName != null ? fromName : "");
            metadata.put("to_audience_id", targetAudience.getId());
            metadata.put("to_campaign_name",
                    targetAudience.getCampaignName() != null ? targetAudience.getCampaignName() : "");
            metadata.put("workflow_anchor", anchorMode.name());
            metadata.put("actor", actor.getUsername() != null ? actor.getUsername() : "");
            String typeId = userLeadProfileService.resolveProfileId(leadUserId, instituteId);
            timelineEventService.logJourneyEvent(
                    "USER_LEAD_PROFILE", typeId, LeadJourneyActionType.LEAD_LIST_CHANGED,
                    "ADMIN", actor.getUserId(), actor.getUsername(),
                    "Lead list changed",
                    "Moved from " + (fromName != null ? fromName : "another list")
                            + " to " + targetAudience.getCampaignName(),
                    metadata, leadUserId);
        } catch (Exception e) {
            logger.warn("Failed to log LEAD_LIST_CHANGED event for response {}: {}",
                    response.getId(), e.getMessage());
        }
    }

    /** True when this user's lead profile at this institute is marked CONVERTED. */
    private boolean isConverted(String leadUserId, String instituteId) {
        return userLeadProfileRepository.findByUserIdAndInstituteId(leadUserId, instituteId)
                .map(p -> "CONVERTED".equalsIgnoreCase(p.getConversionStatus()))
                .orElse(false);
    }

    /** Best-effort audit trail — a delete must be attributable, but must not fail over logging. */
    private void logLeadCurationEvent(AudienceResponse response, CustomUserDetails actor,
            LeadJourneyActionType actionType, String title, String description, String scope,
            String instituteId) {
        String leadUserId = response.getUserId() != null ? response.getUserId() : response.getStudentUserId();
        if (!StringUtils.hasText(leadUserId)) {
            return;
        }
        try {
            String campaignName = response.getAudienceId() == null ? null
                    : audienceRepository.findById(response.getAudienceId())
                            .map(Audience::getCampaignName).orElse(null);
            Map<String, Object> metadata = new HashMap<>();
            metadata.put("response_id", response.getId());
            metadata.put("scope", scope != null ? scope.toUpperCase() : "RESPONSE");
            metadata.put("campaign_name", campaignName != null ? campaignName : "");
            metadata.put("actor", actor.getUsername() != null ? actor.getUsername() : "");
            String typeId = userLeadProfileService.resolveProfileId(leadUserId, instituteId);
            timelineEventService.logJourneyEvent(
                    "USER_LEAD_PROFILE", typeId, actionType,
                    "ADMIN", actor.getUserId(), actor.getUsername(),
                    title, description, metadata, leadUserId);
        } catch (Exception e) {
            logger.warn("Failed to log {} event for response {}: {}",
                    actionType, response.getId(), e.getMessage());
        }
    }

    /**
     * True when the caller carries the ADMIN role FOR THIS INSTITUTE. Roles are per-institute,
     * so this defers to the same resolver the rest of the audience feature uses rather than
     * scanning the authorities flat — otherwise an admin of institute A could delete institute
     * B's leads.
     */
    private boolean hasAdminRole(CustomUserDetails user, String instituteId) {
        return audienceRoleAccessService.resolvedCallerRoles(user, instituteId).contains("ADMIN");
    }

    /**
     * Edit a lead's profile from the CRM.
     *
     * <p>Writes only where a lead is actually read from — the auth user
     * (name / email / mobile), the {@code audience_response} parent/guardian
     * fields, and the lead's custom field values. It never touches the
     * {@code student} table: a lead that never enrolled has no row there, which
     * is why the learner-profile endpoint cannot serve this case.</p>
     *
     * <p>If the edit moves email/phone onto an identity that another lead in the
     * same campaign already owns, it is rejected (409) so two leads cannot
     * collide on one {@code dedupe_key}.</p>
     */
    @Transactional
    public void updateLeadProfile(String responseId, LeadProfileEditRequestDTO request) {
        if (request == null) {
            throw new InvalidRequestException("Request body is required");
        }

        AudienceResponse response = audienceResponseRepository.findById(responseId)
                .orElseThrow(() -> new ResourceNotFoundException("Lead not found"));

        UserDTO updates = request.getUserDetails();

        // 1) The lead's identity lives on the auth user — merge the edits over the
        // existing record so unsent fields aren't blanked.
        String leadUserId = response.getUserId() != null ? response.getUserId() : response.getStudentUserId();
        if (updates != null && StringUtils.hasText(leadUserId)) {
            String newEmail = updates.getEmail();
            String newPhone = updates.getMobileNumber();
            if (StringUtils.hasText(newEmail) || StringUtils.hasText(newPhone)) {
                // Institute-configured dedup (LEAD_SETTING.data.dedup) — the same check used
                // at lead creation, so editing a lead's contact info can't silently collide
                // with another lead the admin's field/scope setting is supposed to catch.
                // excludeResponseId keeps this row from matching its own not-yet-saved self.
                // An in-place edit always blocks on a match regardless of action
                // (REJECT/ALLOW_REASSIGN) — there is no new response here to reassign.
                String instituteId = response.getAudienceId() != null
                        ? audienceRepository.findById(response.getAudienceId())
                                .map(Audience::getInstituteId).orElse(null)
                        : null;
                if (StringUtils.hasText(instituteId)) {
                    leadDeduplicationService
                            .checkDuplicate(instituteId, response.getAudienceId(), newEmail, newPhone, responseId)
                            .ifPresent(match -> {
                                throw new ConflictException(StringUtils.hasText(match.rejectionMessage())
                                        ? match.rejectionMessage()
                                        : "A lead already exists with this phone number or email.");
                            });
                }

                // Legacy campaign-scoped combined-key check — kept as the baseline safety net
                // for institutes that haven't configured LEAD_SETTING.data.dedup, and to keep
                // dedupeKey (used by the enquiry flow's soft-merge) up to date either way.
                String newKey = leadDeduplicationService.generateDedupeKey(newEmail, newPhone);
                if (newKey != null && response.getAudienceId() != null) {
                    leadDeduplicationService.findDuplicate(response.getAudienceId(), newKey)
                            .filter(existing -> !existing.getId().equals(responseId))
                            .ifPresent(existing -> {
                                throw new ConflictException(
                                        "A lead already exists with this phone number or email.");
                            });
                    response.setDedupeKey(newKey);
                }
            }

            List<UserDTO> existingUsers = authService.getUsersFromAuthServiceByUserIds(List.of(leadUserId));
            UserDTO existing = (existingUsers != null && !existingUsers.isEmpty()) ? existingUsers.get(0) : null;
            UserDTO merged = (existing != null) ? mergeUserDTO(existing, updates) : updates;
            merged.setId(leadUserId);
            authService.updateUser(merged, leadUserId);
        }

        // 2) Parent/guardian fields on the audience_response row. A cleared field arrives
        // as "" from the form; store it as NULL rather than an empty string, otherwise
        // queries that gate on `parent_mobile IS NOT NULL` would start matching leads that
        // have no parent contact at all.
        if (request.getParentName() != null) {
            response.setParentName(blankToNull(request.getParentName()));
        }
        if (request.getParentEmail() != null) {
            response.setParentEmail(blankToNull(request.getParentEmail()));
        }
        if (request.getParentMobile() != null) {
            response.setParentMobile(blankToNull(request.getParentMobile()));
        }
        // dedupe_key may also have changed above.
        audienceResponseRepository.save(response);

        // 3) The lead's form answers.
        if (!CollectionUtils.isEmpty(request.getCustomFieldValues())) {
            request.getCustomFieldValues().forEach(cfv -> {
                if (cfv != null) {
                    if (!StringUtils.hasText(cfv.getSourceType())) {
                        cfv.setSourceType(CustomFieldValueSourceType.AUDIENCE_RESPONSE.name());
                    }
                    if (!StringUtils.hasText(cfv.getSourceId())) {
                        cfv.setSourceId(responseId);
                    }
                }
            });
            customFieldValueService.upsertCustomFieldValues(request.getCustomFieldValues());
        }

        logger.info("Lead profile updated for response {}", responseId);
    }

    /** Trim a form-supplied value, mapping "" (a cleared field) to NULL. */
    private String blankToNull(String value) {
        return StringUtils.hasText(value) ? value.trim() : null;
    }

    /**
     * Delete campaign (soft delete by setting status to ARCHIVED)
     */
    @Transactional
    public void deleteCampaign(String audienceId, String instituteId) {
        Audience audience = audienceRepository.findByIdAndInstituteId(audienceId, instituteId)
                .orElseThrow(() -> new VacademyException("Audience not found"));

        audience.setStatus(CampaignStatusEnum.DELETED.name());
        audienceRepository.save(audience);

        logger.info("Deleted audience: {}", audienceId);
    }

    private void saveCustomFieldValues(String responseId, Map<String, String> fieldValues, String instituteId) {
        saveCustomFieldValues(responseId, fieldValues, instituteId, null);
    }

    private void saveCustomFieldValues(String responseId, Map<String, String> fieldValues, String instituteId,
            String audienceId) {
        // Build a lookup to resolve incoming keys (field_key, field_name, or
        // alternate UUID) to the canonical custom_field_id for this audience.
        Map<String, String> keyToCanonicalId = new HashMap<>();
        if (StringUtils.hasText(audienceId)) {
            try {
                List<Object[]> icfData = instituteCustomFieldRepository.findInstituteCustomFieldsWithDetails(
                        instituteId, CustomFieldTypeEnum.AUDIENCE_FORM.name(), audienceId);
                for (Object[] row : icfData) {
                    CustomFields cf = (CustomFields) row[1];
                    String canonicalId = cf.getId();
                    // Register by custom_field_id, field_key, and field_name
                    keyToCanonicalId.put(canonicalId, canonicalId);
                    if (StringUtils.hasText(cf.getFieldKey())) {
                        keyToCanonicalId.put(cf.getFieldKey().toLowerCase().trim(), canonicalId);
                    }
                    if (StringUtils.hasText(cf.getFieldName())) {
                        keyToCanonicalId.put(cf.getFieldName().toLowerCase().trim(), canonicalId);
                    }
                }
            } catch (Exception e) {
                logger.warn("Could not build canonical field lookup for audience {}: {}", audienceId, e.getMessage());
            }
        }

        List<CustomFieldValues> customFieldValuesList = new ArrayList<>();

        for (Map.Entry<String, String> entry : fieldValues.entrySet()) {
            String incomingKey = entry.getKey();
            String value = entry.getValue();

            if (!StringUtils.hasText(value)) {
                continue;
            }

            // Resolve to canonical ID: try exact match, then lowercase
            String resolvedId = keyToCanonicalId.getOrDefault(incomingKey,
                    keyToCanonicalId.getOrDefault(incomingKey.toLowerCase().trim(), incomingKey));

            CustomFieldValues cfValue = CustomFieldValues.builder()
                    .sourceType("AUDIENCE_RESPONSE")
                    .sourceId(responseId)
                    .customFieldId(resolvedId)
                    .value(value)
                    .build();

            customFieldValuesList.add(cfValue);
        }

        if (!customFieldValuesList.isEmpty()) {
            customFieldValuesRepository.saveAll(customFieldValuesList);
            logger.info("Saved {} custom field values for response {}", customFieldValuesList.size(), responseId);
        }
    }

    /**
     * Get custom field values for a response
     */
    // getCustomFieldValuesForResponse() lived here. Its only caller, getLeadById(),
    // now needs the CustomFieldValues ENTITIES (to resolve each answer's field
    // definition for the metadata map), so it fetches them itself and derives the
    // same {fieldId -> value} map with the same last-wins duplicate rule. Removed
    // rather than left behind: a second, values-only path would silently produce
    // form answers labelled with field UUIDs.

    /**
     * The lead's captured form/custom fields as {label -> value} for a response —
     * read-only, reused by the AI voice bot to personalise the call (so the agent can
     * reference the lead's company/role/etc. instead of asking again). Empty (never null)
     * when the response has no fields or the id is blank; never throws.
     */
    public Map<String, String> getLeadCustomFields(String responseId) {
        if (!StringUtils.hasText(responseId)) return Collections.emptyMap();
        try {
            Map<String, String> m = buildCustomFieldMapForEmail(responseId);
            return m == null ? Collections.emptyMap() : m;
        } catch (Exception e) {
            logger.warn("getLeadCustomFields failed for {}: {}", responseId, e.getMessage());
            return Collections.emptyMap();
        }
    }

    /**
     * Build a map of custom field names to values for email template
     * Format: {field_name -> value}
     * Example: {"Phone Number" -> "1234567890", "Company Name" -> "Acme Corp"}
     */
    private Map<String, String> buildCustomFieldMapForEmail(String responseId) {
        // 1. Fetch saved custom field values for this response
        List<CustomFieldValues> savedValues = customFieldValuesRepository
                .findBySourceTypeAndSourceId("AUDIENCE_RESPONSE", responseId);

        if (CollectionUtils.isEmpty(savedValues)) {
            return Collections.emptyMap();
        }

        // 2. Extract custom_field_ids
        Set<String> customFieldIds = savedValues.stream()
                .map(CustomFieldValues::getCustomFieldId)
                .collect(Collectors.toSet());

        // 3. Fetch custom field definitions to get field_name (readable labels)
        List<CustomFields> fieldDefinitions = customFieldRepository.findAllById(customFieldIds);

        Map<String, String> fieldIdToName = fieldDefinitions.stream()
                .collect(Collectors.toMap(
                        CustomFields::getId,
                        CustomFields::getFieldName,
                        (a, b) -> a // In case of duplicates, take first
                ));

        // 4. Build the final map: field_name -> value
        Map<String, String> result = new HashMap<>();
        for (CustomFieldValues cfv : savedValues) {
            String fieldName = fieldIdToName.get(cfv.getCustomFieldId());
            if (StringUtils.hasText(fieldName) && StringUtils.hasText(cfv.getValue())) {
                result.put(fieldName, cfv.getValue());
            }
        }

        return result;
    }

    /**
     * Build default email body with custom fields - HTML formatted
     */
    private String buildDefaultEmailBody(String campaignName, String userName, String userEmail,
            Map<String, String> customFields) {
        StringBuilder emailBody = new StringBuilder();

        // Get current time with timezone
        java.time.ZonedDateTime now = java.time.ZonedDateTime.now();
        java.time.format.DateTimeFormatter formatter = java.time.format.DateTimeFormatter
                .ofPattern("MMM dd, yyyy hh:mm a z");
        String submissionTime = now.format(formatter);

        // HTML Email Template
        emailBody.append("<!DOCTYPE html>");
        emailBody.append("<html lang='en'>");
        emailBody.append("<head>");
        emailBody.append("<meta charset='UTF-8'>");
        emailBody.append("<meta name='viewport' content='width=device-width, initial-scale=1.0'>");
        emailBody.append("<style>");
        emailBody.append(
                "body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f5f5; margin: 0; padding: 0; }");
        emailBody.append(
                ".container { max-width: 600px; margin: 30px auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden; }");
        emailBody
                .append(".header { background-color: #4a4a4a; color: white; padding: 30px 20px; text-align: center; }");
        emailBody.append(".header h1 { margin: 0; font-size: 24px; font-weight: 600; }");
        emailBody.append(".content { padding: 30px 20px; }");
        emailBody.append(".success-icon { text-align: center; margin-bottom: 20px; font-size: 48px; }");
        emailBody.append(
                ".message { color: #333; font-size: 16px; line-height: 1.6; margin-bottom: 25px; text-align: center; }");
        emailBody.append(
                ".info-section { background-color: #f9f9f9; border-left: 4px solid #4a4a4a; padding: 15px 20px; margin: 20px 0; border-radius: 4px; }");
        emailBody.append(".info-section h3 { color: #4a4a4a; margin: 0 0 15px 0; font-size: 16px; font-weight: 600; }");
        emailBody.append(".info-item { display: flex; padding: 8px 0; border-bottom: 1px solid #e9ecef; }");
        emailBody.append(".info-item:last-child { border-bottom: none; }");
        emailBody.append(".info-label { font-weight: 600; color: #495057; min-width: 120px; }");
        emailBody.append(".info-value { color: #6c757d; flex: 1; }");
        emailBody.append(
                ".footer { background-color: #f9f9f9; padding: 20px; text-align: center; color: #6c757d; font-size: 14px; }");
        emailBody.append(".footer p { margin: 5px 0; }");
        emailBody.append("</style>");
        emailBody.append("</head>");
        emailBody.append("<body>");
        emailBody.append("<div class='container'>");

        // Header
        emailBody.append("<div class='header'>");
        emailBody.append("<h1>Form Submission Confirmation</h1>");
        emailBody.append("</div>");

        // Content
        emailBody.append("<div class='content'>");
        emailBody.append("<div class='success-icon'>✅</div>");
        emailBody.append("<div class='message'>");
        emailBody.append("Thank you for submitting the form for <strong>").append(campaignName)
                .append("</strong>.<br>");
        emailBody.append("We have received your information and will get back to you soon.");
        emailBody.append("</div>");

        // User Info Section
        emailBody.append("<div class='info-section'>");
        emailBody.append("<h3>Your Information</h3>");
        if (StringUtils.hasText(userName)) {
            emailBody.append("<div class='info-item'>");
            emailBody.append("<span class='info-label'>Name:</span>");
            emailBody.append("<span class='info-value'>").append(userName).append("</span>");
            emailBody.append("</div>");
        }
        if (StringUtils.hasText(userEmail)) {
            emailBody.append("<div class='info-item'>");
            emailBody.append("<span class='info-label'>Email:</span>");
            emailBody.append("<span class='info-value'>").append(userEmail).append("</span>");
            emailBody.append("</div>");
        }
        emailBody.append("<div class='info-item'>");
        emailBody.append("<span class='info-label'>Submitted:</span>");
        emailBody.append("<span class='info-value'>").append(submissionTime).append("</span>");
        emailBody.append("</div>");
        emailBody.append("</div>");

        // Custom Fields Section
        if (!CollectionUtils.isEmpty(customFields)) {
            emailBody.append("<div class='info-section'>");
            emailBody.append("<h3>Submitted Information</h3>");
            for (Map.Entry<String, String> entry : customFields.entrySet()) {
                emailBody.append("<div class='info-item'>");
                emailBody.append("<span class='info-label'>").append(entry.getKey()).append(":</span>");
                emailBody.append("<span class='info-value'>").append(entry.getValue()).append("</span>");
                emailBody.append("</div>");
            }
            emailBody.append("</div>");
        }

        emailBody.append("</div>");

        // Footer
        emailBody.append("<div class='footer'>");
        emailBody.append("<p>This is an automated message. Please do not reply to this email.</p>");
        emailBody.append("<p>&copy; 2025 All rights reserved.</p>");
        emailBody.append("</div>");

        emailBody.append("</div>");
        emailBody.append("</body>");
        emailBody.append("</html>");

        return emailBody.toString();
    }

    /**
     * Notify the audience's {@code to_notify} admin recipients about a new lead — but ONLY
     * when the workflow that fired for this submission does not already send admin emails
     * (a SEND_EMAIL node bound to {@code adminEmailRequests}).
     *
     * <p>Why this exists: the workflow-driven submit paths ({@code submitLead},
     * {@code submitLeadV2}, {@code submitLeadFromFormWebhook}) delegate to the workflow engine
     * and return, putting the admin list on the context as {@code adminEmailRequests}. If the
     * audience's workflow only emails the respondent (the common case — no admin-notify node),
     * that list has no consumer and the {@code to_notify} alert is silently dropped. This makes
     * the alert fire directly in exactly that case, while skipping it for audiences whose
     * workflow already includes an admin-notify node (so they are not double-emailed).
     *
     * <p>On any detection error we skip the direct send (rather than risk a duplicate for the
     * audiences that are already handled correctly by a workflow node). Best-effort — never
     * blocks the submission.
     */
    private void notifyToNotifyAdminsIfWorkflowDoesNot(String audienceId, String instituteId,
            Audience audience, String respondentFullName, String respondentEmail,
            Map<String, String> customFields, Map<String, Object> contextData) {
        if (audience == null || !StringUtils.hasText(audience.getToNotify())) {
            return;
        }
        try {
            if (workflowTriggerService.anyResolvedWorkflowSendsAdminEmail(
                    WorkflowTriggerEvent.AUDIENCE_LEAD_SUBMISSION.name(), audienceId, instituteId, contextData)) {
                logger.info(
                        "Workflow already sends admin emails for audience {} — skipping direct to_notify send.",
                        audienceId);
                return;
            }
        } catch (Exception e) {
            logger.warn(
                    "Admin-notify detection failed for audience {}: {} — skipping direct send to avoid duplicate admin emails.",
                    audienceId, e.getMessage());
            return;
        }
        sendToNotifyAdminEmails(audience, respondentFullName, respondentEmail, customFields, instituteId);
    }

    /**
     * Send the "New Lead Submitted" notification email to each {@code to_notify} admin
     * recipient. Best-effort per recipient — a send failure to one never blocks the others or
     * the submission. Mirrors the direct admin-send already used by the no-workflow branches.
     */
    private void sendToNotifyAdminEmails(Audience audience, String respondentFullName,
            String respondentEmail, Map<String, String> customFields, String instituteIdForNotification) {
        if (audience == null || !StringUtils.hasText(audience.getToNotify())) {
            return;
        }
        for (String email : audience.getToNotify().split(",")) {
            String trimmedEmail = email.trim();
            if (!StringUtils.hasText(trimmedEmail)) {
                continue;
            }
            String adminEmailBody = buildAdminNotificationBody(
                    audience.getCampaignName(), respondentFullName, respondentEmail, customFields);

            GenericEmailRequest adminEmailRequest = new GenericEmailRequest();
            adminEmailRequest.setTo(trimmedEmail);
            adminEmailRequest.setSubject("New Lead Submitted - " + audience.getCampaignName());
            adminEmailRequest.setBody(adminEmailBody);

            try {
                notificationService.sendGenericHtmlMailViaUnified(adminEmailRequest, instituteIdForNotification);
                logger.info("Sent admin notification (to_notify) to: {}", trimmedEmail);
            } catch (Exception ex) {
                logger.error("Failed to send admin notification to {}: {}", trimmedEmail, ex.getMessage());
            }
        }
    }

    /**
     * Build notification email body for admin recipients (to_notify) - HTML
     * formatted
     */
    private String buildAdminNotificationBody(String campaignName, String userName, String userEmail,
            Map<String, String> customFields) {
        StringBuilder emailBody = new StringBuilder();

        // Get current time with timezone
        java.time.ZonedDateTime now = java.time.ZonedDateTime.now();
        java.time.format.DateTimeFormatter formatter = java.time.format.DateTimeFormatter
                .ofPattern("MMM dd, yyyy hh:mm a z");
        String submissionTime = now.format(formatter);

        // HTML Email Template for Admin
        emailBody.append("<!DOCTYPE html>");
        emailBody.append("<html lang='en'>");
        emailBody.append("<head>");
        emailBody.append("<meta charset='UTF-8'>");
        emailBody.append("<meta name='viewport' content='width=device-width, initial-scale=1.0'>");
        emailBody.append("<style>");
        emailBody.append(
                "body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f5f5; margin: 0; padding: 0; }");
        emailBody.append(
                ".container { max-width: 600px; margin: 30px auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden; }");
        emailBody
                .append(".header { background-color: #2c3e50; color: white; padding: 30px 20px; text-align: center; }");
        emailBody.append(".header h1 { margin: 0; font-size: 24px; font-weight: 600; }");
        emailBody.append(
                ".badge { background-color: rgba(255,255,255,0.2); padding: 5px 15px; border-radius: 20px; display: inline-block; margin-top: 10px; font-size: 14px; }");
        emailBody.append(".content { padding: 30px 20px; }");
        emailBody.append(".alert-icon { text-align: center; margin-bottom: 20px; font-size: 48px; }");
        emailBody.append(
                ".message { color: #333; font-size: 16px; line-height: 1.6; margin-bottom: 25px; text-align: center; }");
        emailBody.append(".campaign-name { color: #2c3e50; font-weight: 600; font-size: 18px; }");
        emailBody.append(
                ".info-section { background-color: #f9f9f9; border-left: 4px solid #2c3e50; padding: 15px 20px; margin: 20px 0; border-radius: 4px; }");
        emailBody.append(".info-section h3 { color: #2c3e50; margin: 0 0 15px 0; font-size: 16px; font-weight: 600; }");
        emailBody.append(".info-item { display: flex; padding: 8px 0; border-bottom: 1px solid #e9ecef; }");
        emailBody.append(".info-item:last-child { border-bottom: none; }");
        emailBody.append(".info-label { font-weight: 600; color: #495057; min-width: 140px; }");
        emailBody.append(".info-value { color: #6c757d; flex: 1; word-break: break-word; }");
        emailBody.append(
                ".action-section { background-color: #e8e8e8; padding: 20px; margin: 25px 0; border-radius: 8px; text-align: center; border-left: 4px solid #2c3e50; }");
        emailBody.append(".action-section p { color: #2c3e50; margin: 0; font-size: 14px; font-weight: 600; }");
        emailBody.append(
                ".footer { background-color: #f9f9f9; padding: 20px; text-align: center; color: #6c757d; font-size: 14px; }");
        emailBody.append(".footer p { margin: 5px 0; }");
        emailBody.append("</style>");
        emailBody.append("</head>");
        emailBody.append("<body>");
        emailBody.append("<div class='container'>");

        // Header
        emailBody.append("<div class='header'>");
        emailBody.append("<h1>🔔 New Lead Notification</h1>");
        emailBody.append("<div class='badge'>Admin Alert</div>");
        emailBody.append("</div>");

        // Content
        emailBody.append("<div class='content'>");
        emailBody.append("<div class='alert-icon'>🎯</div>");
        emailBody.append("<div class='message'>");
        emailBody.append("A new lead has been submitted for campaign:<br>");
        emailBody.append("<span class='campaign-name'>").append(campaignName).append("</span>");
        emailBody.append("</div>");

        // Lead Details Section
        emailBody.append("<div class='info-section'>");
        emailBody.append("<h3>Lead Details</h3>");
        if (StringUtils.hasText(userName)) {
            emailBody.append("<div class='info-item'>");
            emailBody.append("<span class='info-label'>Name:</span>");
            emailBody.append("<span class='info-value'>").append(userName).append("</span>");
            emailBody.append("</div>");
        }
        if (StringUtils.hasText(userEmail)) {
            emailBody.append("<div class='info-item'>");
            emailBody.append("<span class='info-label'>Email:</span>");
            emailBody.append("<span class='info-value'>").append(userEmail).append("</span>");
            emailBody.append("</div>");
        }
        emailBody.append("<div class='info-item'>");
        emailBody.append("<span class='info-label'>Submitted:</span>");
        emailBody.append("<span class='info-value'>").append(submissionTime).append("</span>");
        emailBody.append("</div>");
        emailBody.append("</div>");

        // Additional Information Section
        if (!CollectionUtils.isEmpty(customFields)) {
            emailBody.append("<div class='info-section'>");
            emailBody.append("<h3>Additional Information</h3>");
            for (Map.Entry<String, String> entry : customFields.entrySet()) {
                emailBody.append("<div class='info-item'>");
                emailBody.append("<span class='info-label'>").append(entry.getKey()).append(":</span>");
                emailBody.append("<span class='info-value'>").append(entry.getValue()).append("</span>");
                emailBody.append("</div>");
            }
            emailBody.append("</div>");
        }

        // Action Section
        emailBody.append("<div class='action-section'>");
        emailBody.append(
                "<p>💡 <strong>Action Required:</strong> Follow up with this lead as soon as possible to maximize conversion.</p>");
        emailBody.append("</div>");

        emailBody.append("</div>");

        // Footer
        emailBody.append("<div class='footer'>");
        emailBody.append("<p>This is an automated notification from your lead management system.</p>");
        emailBody.append("<p>&copy; 2025 All rights reserved.</p>");
        emailBody.append("</div>");

        emailBody.append("</div>");
        emailBody.append("</body>");
        emailBody.append("</html>");

        return emailBody.toString();
    }

    /**
     * Find user by phone number from custom field values
     * Searches in custom_field_values table and returns complete user with all
     * custom fields
     * If multiple users found, returns the latest one by created_at
     * 
     * @param phoneNumber Phone number to search for
     * @return UserWithCustomFieldsDTO containing complete user details and custom
     *         fields
     * @throws VacademyException if user not found
     */
    public UserWithCustomFieldsDTO getUserByPhoneNumber(String phoneNumber) {
        logger.info("Searching for user with phone number: {}", phoneNumber);

        // Step 1: Find all custom field values matching the phone number
        List<CustomFieldValues> matchingValues = customFieldValuesRepository.findByPhoneNumber(phoneNumber);

        if (matchingValues.isEmpty()) {
            logger.warn("No user found with phone number: {}", phoneNumber);
            throw new VacademyException("No user found with phone number: " + phoneNumber);
        }

        logger.info("Found {} custom field value records matching phone: {}", matchingValues.size(), phoneNumber);

        // Step 2: Extract user IDs from different source types
        Set<String> userIds = new HashSet<>();

        for (CustomFieldValues cfv : matchingValues) {
            String sourceType = cfv.getSourceType();
            String sourceId = cfv.getSourceId();

            if ("USER".equals(sourceType)) {
                // For USER type, source_id is the user_id directly
                userIds.add(sourceId);
                logger.debug("Found USER type: source_id={} is user_id", sourceId);
            } else if ("AUDIENCE_RESPONSE".equals(sourceType)) {
                // For AUDIENCE_RESPONSE type, source_id is response_id, need to get user_id
                Optional<AudienceResponse> responseOpt = audienceResponseRepository.findById(sourceId);
                if (responseOpt.isPresent() && responseOpt.get().getUserId() != null) {
                    userIds.add(responseOpt.get().getUserId());
                    logger.debug("Found AUDIENCE_RESPONSE type: source_id={}, user_id={}",
                            sourceId, responseOpt.get().getUserId());
                }
            }
        }

        if (userIds.isEmpty()) {
            logger.warn("No user IDs extracted from custom field values for phone: {}", phoneNumber);
            throw new VacademyException("No user found with phone number: " + phoneNumber);
        }

        logger.info("Extracted {} unique user IDs: {}", userIds.size(), userIds);

        // Step 3: If multiple users, get the latest one by created_at
        String selectedUserId;
        if (userIds.size() == 1) {
            selectedUserId = userIds.iterator().next();
            logger.info("Single user found: {}", selectedUserId);
        } else {
            // Get the latest user by finding the custom field value with latest created_at
            selectedUserId = matchingValues.stream()
                    .filter(cfv -> {
                        if ("USER".equals(cfv.getSourceType())) {
                            return userIds.contains(cfv.getSourceId());
                        } else if ("AUDIENCE_RESPONSE".equals(cfv.getSourceType())) {
                            Optional<AudienceResponse> resp = audienceResponseRepository.findById(cfv.getSourceId());
                            return resp.isPresent() && resp.get().getUserId() != null
                                    && userIds.contains(resp.get().getUserId());
                        }
                        return false;
                    })
                    .sorted((a, b) -> b.getCreatedAt().compareTo(a.getCreatedAt()))
                    .findFirst()
                    .map(cfv -> {
                        if ("USER".equals(cfv.getSourceType())) {
                            return cfv.getSourceId();
                        } else {
                            return audienceResponseRepository.findById(cfv.getSourceId())
                                    .map(AudienceResponse::getUserId)
                                    .orElse(null);
                        }
                    })
                    .orElseThrow(() -> new VacademyException("Could not determine latest user"));

            logger.info("Multiple users found ({}), selected latest: {}", userIds.size(), selectedUserId);
        }

        return buildUserWithCustomFields(selectedUserId);
    }

    /**
     * Get users by multiple phone numbers
     * Reuses the same logic as getUserByPhoneNumber but in batch
     * 
     * @param phoneNumbers List of phone numbers to search
     * @return List of UserWithCustomFieldsDTO (only includes found users)
     */
    public List<UserWithCustomFieldsDTO> getUsersByPhoneNumbers(List<String> phoneNumbers) {
        logger.info("Batch searching for {} phone numbers", phoneNumbers.size());

        List<UserWithCustomFieldsDTO> results = new ArrayList<>();

        for (String phoneNumber : phoneNumbers) {
            try {
                UserWithCustomFieldsDTO userDTO = getUserByPhoneNumber(phoneNumber);
                results.add(userDTO);
            } catch (VacademyException e) {
                // User not found - log and continue
                logger.warn("User not found for phone: {} - {}", phoneNumber, e.getMessage());
            }
        }

        logger.info("Found {} users out of {} phone numbers", results.size(), phoneNumbers.size());
        return results;
    }

    /**
     * Helper method to build UserWithCustomFieldsDTO from userId
     * Extracted for reuse in single and batch methods
     */
    private UserWithCustomFieldsDTO buildUserWithCustomFields(String selectedUserId) {
        // Step 4: Fetch complete user details from auth service.
        // The selectedUserId came from custom_field_values.source_id which may be
        // an orphaned reference (e.g. a guest_id or a deleted user). Don't fail
        // the whole lookup in that case — return the custom fields with user=null
        // so callers (chatbot flows, audience messaging) can still resolve
        // CUSTOM_FIELD placeholders even when the auth-service record is missing.
        UserDTO userDTO = null;
        try {
            List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(List.of(selectedUserId));
            if (users != null && !users.isEmpty()) {
                userDTO = users.get(0);
                logger.info("Fetched user details: id={}, email={}, name={}",
                        userDTO.getId(), userDTO.getEmail(), userDTO.getFullName());
            } else {
                logger.warn("Auth service returned no user record for userId={} — "
                        + "returning custom fields only", selectedUserId);
            }
        } catch (Exception e) {
            logger.warn("Failed to fetch user details for userId: {} — returning custom fields only: {}",
                    selectedUserId, e.getMessage());
        }

        // Step 5: Fetch all custom field values for this user (from both USER and
        // AUDIENCE_RESPONSE types)
        Map<String, String> customFieldsMap = new HashMap<>();

        // Get USER type custom fields
        List<CustomFieldValues> userCustomFields = customFieldValuesRepository
                .findBySourceTypeAndSourceId("USER", selectedUserId);

        for (CustomFieldValues cfv : userCustomFields) {
            // Get field key from custom_fields table
            Optional<CustomFields> customFieldOpt = customFieldRepository.findById(cfv.getCustomFieldId());
            if (customFieldOpt.isPresent()) {
                String fieldKey = customFieldOpt.get().getFieldName();
                customFieldsMap.put(fieldKey, cfv.getValue());
            }
        }

        logger.info("Found {} USER type custom fields", userCustomFields.size());

        // Get AUDIENCE_RESPONSE type custom fields
        List<AudienceResponse> userResponses = audienceResponseRepository.findByUserId(selectedUserId);
        for (AudienceResponse response : userResponses) {
            List<CustomFieldValues> responseCustomFields = customFieldValuesRepository
                    .findBySourceTypeAndSourceId("AUDIENCE_RESPONSE", response.getId());

            for (CustomFieldValues cfv : responseCustomFields) {
                Optional<CustomFields> customFieldOpt = customFieldRepository.findById(cfv.getCustomFieldId());
                if (customFieldOpt.isPresent()) {
                    String fieldKey = customFieldOpt.get().getFieldName();
                    // Don't override if already exists from USER type (USER takes precedence)
                    customFieldsMap.putIfAbsent(fieldKey, cfv.getValue());
                }
            }
        }

        logger.info("Total custom fields collected: {}", customFieldsMap.size());
        logger.debug("Custom fields: {}", customFieldsMap);

        // Step 6: Build and return response
        return UserWithCustomFieldsDTO.builder()
                .user(userDTO)
                .customFields(customFieldsMap)
                .build();
    }

    /**
     * Submit a lead from form webhook (Zoho Forms, Google Forms, Microsoft Forms)
     * Maps field_name to custom_field_id before saving
     * 
     * @param audienceId    The audience/campaign ID
     * @param processedData Processed form data containing field names and values
     * @param formProvider  The form provider (ZOHO_FORMS, GOOGLE_FORMS, etc.)
     * @return Response ID
     */
    @Transactional
    public String submitLeadFromFormWebhook(String audienceId, ProcessedFormDataDTO processedData,
            String formProvider) {
        logger.info("Submitting lead from form webhook: provider={}, audienceId={}", formProvider, audienceId);

        // Validate audience exists
        Audience audience = audienceRepository.findById(audienceId)
                .orElseThrow(() -> new VacademyException("Audience not found: " + audienceId));

        // Validate audience is active
        if (!"ACTIVE".equals(audience.getStatus())) {
            throw new VacademyException("Audience campaign is not active");
        }

        String instituteId = audience.getInstituteId();

        // Extract email from processed data. Meta/Facebook lead forms (and some
        // Google/Zoho forms) frequently have NO email field at all, or the admin
        // never mapped one — historically this threw and the lead was silently
        // dropped, so whole Meta-ads campaigns produced zero leads in our system.
        // Instead, synthesize a deterministic placeholder email from the lead's
        // name + phone so an auth account can still be created and the lead lands
        // in Recent Leads. The address is non-deliverable by design (see
        // PlaceholderEmailService) and is suppressed by every send path
        // (respondent email, bulk blast, message variables, lead-status workflows),
        // so it never bounces.
        String email = processedData.getEmail();
        boolean emailSynthesized = false;
        if (!StringUtils.hasText(email)) {
            String platformLeadId = processedData.getMetadata() != null
                    ? processedData.getMetadata().get("platform_lead_id")
                    : null;
            email = placeholderEmailService.synthesize(processedData.getFullName(),
                    processedData.getPhone(), platformLeadId);
            emailSynthesized = true;
            logger.info("No email on {} lead for audience {} — synthesized placeholder {} from name+phone",
                    formProvider, audienceId, email);
        }

        // Campaign the lead arrived on (Google Lead Forms send utm_* built from the campaign /
        // ad group ids). Read up front because a REPEAT lead keeps it too: one lead form runs
        // in several campaigns, and a person already in this audience who submits again via a
        // second campaign must still show up under that campaign, even though no new lead row
        // is created. record() never throws, no-ops when untagged, and skips the same
        // campaign seen again within its dedupe window (e.g. a Google retry).
        Map<String, String> webhookMetadata = processedData.getMetadata() != null
                ? processedData.getMetadata() : Map.of();
        Map<String, String> webhookUtm = new HashMap<>();
        webhookMetadata.forEach((key, value) -> {
            if (key.startsWith("utm_")) webhookUtm.put(key, value);
        });

        // Institute-configured dedup (LEAD_SETTING.data.dedup) — checked against the lead's
        // real (pre-synthesis) email/phone, before creating the auth user, so a REJECTed lead
        // never creates an orphan account. ALLOW_REASSIGN lets it through with repeat-lead settings.
        LeadDedupSettingService.RepeatLeadSettings repeatLeadSettings = null;
        java.util.Optional<LeadDeduplicationService.DuplicateMatch> dupMatch = leadDeduplicationService
                .checkDuplicate(instituteId, audienceId, processedData.getEmail(), processedData.getPhone());
        if (dupMatch.isPresent()) {
            if (dupMatch.get().action() == LeadDedupSettingService.DedupAction.REJECT) {
                // No user id without creating an account; the touch is keyed on the typed
                // email / phone, which is what the campaign filters match on as well.
                recordWebhookCampaignTouch(webhookUtm, instituteId, null, processedData, audienceId);
                return dupMatch.get().rejectionMessage();
            }
            repeatLeadSettings = dupMatch.get().repeatLeadSettings();
        }

        // 1. Create/fetch user from auth_service
        UserDTO userDTO = UserDTO.builder()
                .email(email)
                .fullName(StringUtils.hasText(processedData.getFullName()) ? processedData.getFullName() : email)
                .mobileNumber(processedData.getPhone())
                .build();

        UserDTO createdUser = resolveLeadUser(userDTO, instituteId, audienceId, repeatLeadSettings != null, null);
        String userId = createdUser.getId();

        // Ensure mobile number from form is preserved (auth service might return
        // existing user without mobile)
        if (!StringUtils.hasText(createdUser.getMobileNumber()) && StringUtils.hasText(processedData.getPhone())) {
            createdUser.setMobileNumber(processedData.getPhone());
            logger.info("Set mobile number from form data: {}", processedData.getPhone());
        }

        logger.info("User created/fetched: userId={}, email={}, mobile={}", userId, email,
                createdUser.getMobileNumber());

        // Duplicate submission guard
        if (audienceResponseRepository.existsByAudienceIdAndUserId(audienceId, userId)) {
            logger.warn("Duplicate submission for audienceId={}, userId={}", audienceId, userId);
            // Revive a soft-deleted lead instead of blackholing the resubmission. This path is
            // the Meta/Zoho/Google form webhooks, so it's the most likely to re-deliver a lead
            // an admin has since deleted.
            reactivateSoftDeletedLeads(audienceId, userId);
            recordWebhookCampaignTouch(webhookUtm, instituteId, userId, processedData, audienceId);
            return "You have already submitted your response for this campaign";
        }

        // 2. Create audience response with calculated workflowActivateDayAt
        Timestamp workflowActivateDayAt = calculateWorkflowActivateDayAt(audience);

        // Ad-platform webhooks pass the campaign that produced the lead as source_id
        // (Google Lead Forms: campaign_id) — the column's documented purpose, and what
        // the leads list's sourceId filter matches. Everything else keeps the old marker.
        String webhookSourceId = StringUtils.hasText(webhookMetadata.get("source_id"))
                ? webhookMetadata.get("source_id")
                : formProvider + "_WEBHOOK";

        AudienceResponse response = AudienceResponse.builder()
                .audienceId(audienceId)
                .sourceType(formProvider) // ZOHO_FORMS, GOOGLE_FORMS, etc.
                .sourceId(webhookSourceId.length() > 100 ? webhookSourceId.substring(0, 100) : webhookSourceId)
                .userId(userId)
                .parentEmail(processedData.getEmail())
                .parentMobile(truncateForParentMobileColumn(processedData.getPhone()))
                .workflowActivateDayAt(workflowActivateDayAt)
                .initialScore(audience.getDefaultInitialScore())
                .build();

        AudienceResponse savedResponse = audienceResponseRepository.save(response);
        logger.info("Saved audience response: responseId={}, userId={}", savedResponse.getId(), userId);
        logLeadSubmitted(savedResponse);

        recordWebhookCampaignTouch(webhookUtm, instituteId, userId, processedData, audienceId);

        // 3. Map field_name to custom_field_id and save custom field values
        if (processedData.getFormFields() != null && !processedData.getFormFields().isEmpty()) {
            saveCustomFieldValuesByFieldName(
                    savedResponse.getId(),
                    processedData.getFormFields(),
                    instituteId,
                    audienceId);
        }

        // 3a. Initial lead score (real-time), after custom fields so the completeness factor
        // sees them — same as every other intake path. This is also what creates the user's
        // lead profile; without it a webhook lead that the pool doesn't assign has no profile,
        // so its status, interest level and owner all render blank until someone opens it.
        try {
            leadScoringService.calculateAndSaveScore(savedResponse.getId(), savedResponse.getAudienceId(),
                    instituteId, savedResponse.getSourceType(), savedResponse.getEnquiryId());
        } catch (Exception e) {
            logger.error("Form webhook lead {}: lead score failed: {}", savedResponse.getId(), e.getMessage());
        }

        // 3b. Pool auto-assignment. Webhook leads (Facebook/Meta Lead Ads, Google Lead Forms,
        // Zoho, etc.) carry no counsellor, so absent a repeat-lead policy this routes purely
        // through the campaign's counselor pool. Runs before the workflow trigger so
        // downstream workflow nodes see an owned lead.
        applyCounsellorAssignment(repeatLeadSettings, savedResponse, userId, instituteId,
                null, null, createdUser.getFullName(), audience.getCampaignName());
        recordReattempt(repeatLeadSettings, savedResponse, userId, instituteId,
                processedData.getEmail(), processedData.getPhone(),
                createdUser.getFullName(), audience.getCampaignName());
        applyRepeatLeadStatus(repeatLeadSettings, userId, instituteId, savedResponse,
                processedData.getEmail(), processedData.getPhone());

        // 4. Build custom field map for workflow
        Map<String, String> customFieldsForEmail = buildCustomFieldMapForEmail(savedResponse.getId());

        // Get current time with timezone
        java.time.ZonedDateTime now = java.time.ZonedDateTime.now();
        java.time.format.DateTimeFormatter formatter = java.time.format.DateTimeFormatter
                .ofPattern("MMM dd, yyyy hh:mm a z");
        String submissionTime = now.format(formatter);

        // 5. Generate email content
        String respondentEmailBody = buildDefaultEmailBody(
                audience.getCampaignName(),
                createdUser.getFullName(),
                createdUser.getEmail(),
                customFieldsForEmail);
        String respondentEmailSubject = "Thank You for Submitting Your Response for Campaign - "
                + audience.getCampaignName();

        String adminEmailBody = buildAdminNotificationBody(
                audience.getCampaignName(),
                createdUser.getFullName(),
                createdUser.getEmail(),
                customFieldsForEmail);
        String adminEmailSubject = "New Lead Submitted - " + audience.getCampaignName();

        logger.info("Generated email bodies for workflow trigger");

        // 6. Parse admin notification recipients
        List<String> adminEmails = new ArrayList<>();
        if (StringUtils.hasText(audience.getToNotify())) {
            String[] emails = audience.getToNotify().split(",");
            for (String adminEmail : emails) {
                String trimmedEmail = adminEmail.trim();
                if (StringUtils.hasText(trimmedEmail)) {
                    adminEmails.add(trimmedEmail);
                }
            }
        }

        // 7. Build audience DTO for workflow
        AudienceDTO audienceDTO = AudienceDTO.builder()
                .id(audience.getId())
                .campaignName(audience.getCampaignName())
                .instituteId(audience.getInstituteId())
                .status(audience.getStatus())
                .toNotify(audience.getToNotify())
                .sendRespondentEmail(audience.getSendRespondentEmail())
                .build();

        // 8. Prepare context data for workflow
        Map<String, Object> contextData = new HashMap<>();
        contextData.put("user", createdUser);
        contextData.put("audience", audienceDTO);
        contextData.put("audienceId", audienceId);
        contextData.put("instituteId", instituteId);
        contextData.put("instituteName",
                instituteRepository.findById(instituteId).map(Institute::getInstituteName).orElse(""));
        contextData.put("customFields", customFieldsForEmail);
        contextData.put("submissionTime", submissionTime);
        contextData.put("responseId", savedResponse.getId());
        contextData.put("campaignName", audience.getCampaignName());
        contextData.put("formProvider", formProvider);
        // The standard AUDIENCE_LEAD_SUBMISSION workflow's SEND_EMAIL node sends one
        // email per entry in respondentEmailRequests and does NOT separately read the
        // sendRespondentEmail flag — so this LIST, not the flag, is what actually gates
        // the respondent "thank you". Populate it EXACTLY as before for real emails (so
        // existing campaigns — including those with sendRespondentEmail=false — are
        // unchanged), and suppress it ONLY for synthesized placeholder addresses, which
        // are non-deliverable and would bounce.
        boolean wantRespondentEmail = audience.getSendRespondentEmail() == null
                || audience.getSendRespondentEmail();
        contextData.put("sendRespondentEmail", !emailSynthesized && wantRespondentEmail);

        // Prepare respondent email request (skipped only for synthesized placeholder emails)
        List<Map<String, Object>> respondentEmailRequests = new ArrayList<>();
        if (!emailSynthesized) {
            Map<String, Object> respondentEmailRequest = new HashMap<>();
            respondentEmailRequest.put("to", createdUser.getEmail());
            respondentEmailRequest.put("subject", respondentEmailSubject);
            respondentEmailRequest.put("body", respondentEmailBody);
            respondentEmailRequests.add(respondentEmailRequest);
        }
        contextData.put("respondentEmailRequests", respondentEmailRequests);

        // Prepare admin email requests
        List<Map<String, Object>> adminEmailRequests = new ArrayList<>();
        for (String adminEmail : adminEmails) {
            Map<String, Object> adminEmailRequest = new HashMap<>();
            adminEmailRequest.put("to", adminEmail);
            adminEmailRequest.put("subject", adminEmailSubject);
            adminEmailRequest.put("body", adminEmailBody);
            adminEmailRequests.add(adminEmailRequest);
        }
        contextData.put("adminEmailRequests", adminEmailRequests);

        logger.info("Prepared {} admin email requests", adminEmailRequests.size());

        // 9. Trigger workflow
        try {
            workflowTriggerService.handleTriggerEvents(
                    WorkflowTriggerEvent.AUDIENCE_LEAD_SUBMISSION.name(),
                    audienceId,
                    instituteId,
                    contextData);
            logger.info("Workflow triggered successfully for form webhook submission");
        } catch (Exception e) {
            logger.error("Failed to trigger workflow for form webhook submission", e);
            // Don't throw exception - response is already saved
        }

        // Send the to_notify admin alert directly unless the workflow already has an
        // admin-notify node — otherwise adminEmailRequests has no consumer and the alert
        // is silently dropped for form-webhook leads (e.g. Meta/Zoho). Guarded against dupes.
        notifyToNotifyAdminsIfWorkflowDoesNot(
                audienceId, instituteId, audience,
                createdUser.getFullName(), createdUser.getEmail(),
                customFieldsForEmail, contextData);

        return savedResponse.getId();
    }

    /** utm_attribution touch for a tagged webhook lead (new or repeat); no-op when untagged. */
    private void recordWebhookCampaignTouch(Map<String, String> webhookUtm, String instituteId, String userId,
            ProcessedFormDataDTO processedData, String audienceId) {
        if (webhookUtm.isEmpty()) return;
        utmAttributionService.record(instituteId, userId, processedData.getEmail(),
                processedData.getPhone(), "AUDIENCE", audienceId, webhookUtm);
    }

    private void saveCustomFieldValuesByFieldName(String responseId, Map<String, String> fieldNameValues,
            String instituteId, String audienceId) {
        logger.info("Mapping {} field names to custom field IDs for response: {}", fieldNameValues.size(), responseId);

        // Fetch institute custom fields for AUDIENCE_FORM type with this specific
        // audience (campaign)
        List<Object[]> instituteCustomFieldsData = instituteCustomFieldRepository.findInstituteCustomFieldsWithDetails(
                instituteId,
                CustomFieldTypeEnum.AUDIENCE_FORM.name(),
                audienceId);

        // Create a map: field_name (lowercase) -> custom_field_id
        Map<String, String> fieldNameToIdMap = new HashMap<>();
        for (Object[] row : instituteCustomFieldsData) {
            // row[0] = InstituteCustomField, row[1] = CustomFields
            CustomFields customField = (CustomFields) row[1];
            if (StringUtils.hasText(customField.getFieldName())) {
                fieldNameToIdMap.put(customField.getFieldName().toLowerCase().trim(), customField.getId());
                logger.debug("Mapped field_name '{}' to custom_field_id: {}", customField.getFieldName(),
                        customField.getId());
            }
        }

        logger.debug("Built field name to ID map with {} entries for audienceId: {}", fieldNameToIdMap.size(),
                audienceId);

        // Map field names to IDs and save
        List<CustomFieldValues> customFieldValuesList = new ArrayList<>();
        int mappedCount = 0;
        int unmappedCount = 0;

        for (Map.Entry<String, String> entry : fieldNameValues.entrySet()) {
            String fieldName = entry.getKey();
            String value = entry.getValue();

            if (!StringUtils.hasText(value)) {
                continue;
            }

            // Try to find custom field ID by field name (case-insensitive)
            String customFieldId = fieldNameToIdMap.get(fieldName.toLowerCase().trim());

            if (customFieldId != null) {
                CustomFieldValues cfValue = CustomFieldValues.builder()
                        .sourceType("AUDIENCE_RESPONSE")
                        .sourceId(responseId)
                        .customFieldId(customFieldId)
                        .value(value)
                        .build();

                customFieldValuesList.add(cfValue);
                mappedCount++;
                logger.debug("Mapped field '{}' to custom_field_id: {}", fieldName, customFieldId);
            } else {
                logger.warn("No custom field found for field_name: '{}' in audienceId: {} - skipping", fieldName,
                        audienceId);
                unmappedCount++;
            }
        }

        if (!customFieldValuesList.isEmpty()) {
            customFieldValuesRepository.saveAll(customFieldValuesList);
            logger.info("Saved {} custom field values for response {}. Mapped: {}, Unmapped: {}",
                    customFieldValuesList.size(), responseId, mappedCount, unmappedCount);
        } else {
            logger.warn("No custom field values to save - all {} fields were unmapped for audienceId: {}",
                    unmappedCount, audienceId);
        }
    }

    /**
     * Get enquiries with audience responses, user details and custom fields
     */
    @Transactional(readOnly = true)
    public Page<EnquiryWithResponseDTO> getEnquiriesWithResponses(EnquiryListFilterDTO filterDTO) {
        logger.info("Fetching enquiries with filters: {}", filterDTO);

        // Set default pagination if not provided
        int page = filterDTO.getPage() != null ? filterDTO.getPage() : 0;
        int size = filterDTO.getSize() != null ? filterDTO.getSize() : 20;
        Pageable pageable = PageRequest.of(page, size);

        // Fetch enquiries with filters
        Page<Enquiry> enquiries = enquiryRepository.findEnquiriesWithFilters(
                filterDTO.getAudienceId(),
                filterDTO.getStatus(),
                filterDTO.getSource(),
                filterDTO.getDestinationPackageSessionId(),
                filterDTO.getCreatedFrom(),
                filterDTO.getCreatedTo(),
                filterDTO.getSearch(),
                filterDTO.getExcludeDuplicates(),
                pageable);

        logger.info("Found {} enquiries", enquiries.getTotalElements());

        // Fetch all audience responses for enquiries
        List<String> enquiryIds = enquiries.getContent().stream()
                .map(e -> e.getId().toString())
                .collect(Collectors.toList());

        List<AudienceResponse> audienceResponses = audienceResponseRepository.findByEnquiryIdIn(enquiryIds);
        Map<String, AudienceResponse> responseMap = audienceResponses.stream()
                .collect(Collectors.toMap(AudienceResponse::getEnquiryId, ar -> ar));

        // Collect all user IDs for batch fetch
        Set<String> userIds = audienceResponses.stream()
                .map(AudienceResponse::getUserId)
                .filter(StringUtils::hasText)
                .collect(Collectors.toSet());

        // Batch fetch users WITH their linked children (parent-child relationship)
        Map<String, ParentWithChildDTO> userIdToParentWithChild = userIds.isEmpty()
                ? Collections.emptyMap()
                : authService.getUsersWithChildren(new ArrayList<>(userIds))
                        .stream()
                        .filter(Objects::nonNull)
                        .filter(pwc -> pwc.getParent() != null)
                        .collect(Collectors.toMap(
                                pwc -> pwc.getParent().getId(),
                                pwc -> pwc,
                                (a, b) -> a));

        logger.info("Fetched {} users with children for {} enquiries",
                userIdToParentWithChild.size(), enquiries.getContent().size());

        // Batch fetch custom field values for all audience responses (optimization)
        List<String> responseIds = audienceResponses.stream()
                .map(AudienceResponse::getId)
                .collect(Collectors.toList());

        Map<String, Map<String, String>> customFieldsMap = new HashMap<>();
        if (!responseIds.isEmpty()) {
            List<CustomFieldValues> allCustomFields = customFieldValuesRepository
                    .findBySourceTypeAndSourceIdIn("AUDIENCE_RESPONSE", responseIds);

            // Group by source_id (response_id)
            for (CustomFieldValues cfv : allCustomFields) {
                customFieldsMap
                        .computeIfAbsent(cfv.getSourceId(), k -> new HashMap<>())
                        .put(cfv.getCustomFieldId(), cfv.getValue());
            }
            logger.info("Fetched custom fields for {} responses", customFieldsMap.size());
        }

        // Batch fetch lead scores for all audience responses
        Map<String, LeadScore> leadScoreMap = responseIds.isEmpty() ? Collections.emptyMap()
                : leadScoreRepository.findByAudienceResponseIdIn(responseIds).stream()
                        .collect(Collectors.toMap(LeadScore::getAudienceResponseId, ls -> ls, (a, b) -> a));

        // Admin-set tier per (user, institute): wins over the score band, the same rule as the
        // leads list and the side view, so a Hot / Warm / Cold pick shows here too.
        Map<String, String> explicitTierByUserInstitute = userIds.isEmpty() ? Collections.emptyMap()
                : userLeadProfileRepository.findByUserIdIn(new ArrayList<>(userIds)).stream()
                        .filter(p -> StringUtils.hasText(p.getLeadTier()))
                        .collect(Collectors.toMap(p -> p.getUserId() + "|" + p.getInstituteId(),
                                vacademy.io.admin_core_service.features.audience.entity.UserLeadProfile::getLeadTier,
                                (a, b) -> a));

        // Batch fetch assigned counsellors from linked_users table
        Map<String, String> enquiryToCounsellorMap = enquiryIds.isEmpty() ? Collections.emptyMap()
                : linkedUsersRepository.findBySourceAndSourceIdIn("ENQUIRY", enquiryIds)
                        .stream()
                        .filter(lu -> StringUtils.hasText(lu.getUserId()))
                        .collect(Collectors.toMap(
                                LinkedUsers::getSourceId,
                                LinkedUsers::getUserId,
                                (a, b) -> a));

        logger.info("Fetched {} assigned counsellors for {} enquiries",
                enquiryToCounsellorMap.size(), enquiryIds.size());

        // Build DTOs with parent and child user information
        List<EnquiryWithResponseDTO> dtos = enquiries.getContent().stream()
                .map(enquiry -> {
                    AudienceResponse audienceResponse = responseMap.get(enquiry.getId().toString());

                    if (audienceResponse == null) {
                        logger.warn("No audience response found for enquiry: {}", enquiry.getId());
                        return buildEnquiryOnlyDTO(enquiry);
                    }

                    // Get parent and child from map
                    vacademy.io.common.auth.dto.ParentWithChildDTO parentWithChild = StringUtils
                            .hasText(audienceResponse.getUserId())
                                    ? userIdToParentWithChild.get(audienceResponse.getUserId())
                                    : null;

                    UserDTO userDTO = parentWithChild != null ? parentWithChild.getParent() : null;
                    UserDTO childUserDTO = parentWithChild != null ? parentWithChild.getChild() : null;

                    // Get custom fields from map (same as /leads)
                    Map<String, String> customFields = customFieldsMap.getOrDefault(
                            audienceResponse.getId(),
                            Collections.emptyMap());

                    // Get assigned counsellor from map
                    String assignedCounsellorId = enquiryToCounsellorMap.get(enquiry.getId().toString());

                    // Get lead score from map
                    LeadScore leadScore = leadScoreMap.get(audienceResponse.getId());

                    return EnquiryWithResponseDTO.builder()
                            // Enquiry fields
                            .enquiryId(enquiry.getId())
                            .checklist(enquiry.getChecklist())
                            .enquiryStatus(enquiry.getEnquiryStatus())
                            .convertionStatus(enquiry.getConvertionStatus())
                            .referenceSource(enquiry.getReferenceSource())
                            .assignedUserId(enquiry.getAssignedUserId())
                            .assignedVisitSessionId(enquiry.getAssignedVisitSessionId())
                            .feeRangeExpectation(enquiry.getFeeRangeExpectation())
                            .transportRequirement(enquiry.getTransportRequirement())
                            .mode(enquiry.getMode())
                            .parentRelationWithChild(enquiry.getParentRelationWithChild())
                            .enquiryTrackingId(enquiry.getEnquiryTrackingId())
                            .interestScore(enquiry.getInterestScore())
                            .notes(enquiry.getNotes())
                            .enquiryCreatedAt(enquiry.getCreatedAt())
                            // Audience Response fields
                            .audienceResponseId(audienceResponse.getId())
                            .audienceId(audienceResponse.getAudienceId())
                            .sourceType(audienceResponse.getSourceType())
                            .sourceId(audienceResponse.getSourceId())
                            .destinationPackageSessionId(audienceResponse.getDestinationPackageSessionId())
                            .parentName(audienceResponse.getParentName())
                            .parentEmail(audienceResponse.getParentEmail())
                            .parentMobile(audienceResponse.getParentMobile())
                            .submittedAt(audienceResponse.getSubmittedAt())
                            // User (parent) and linked child user
                            .parentUser(userDTO)
                            .childUser(childUserDTO)
                            .customFields(customFields)
                            // Assigned counsellor
                            .assignedCounsellorId(assignedCounsellorId)
                            // Deduplication
                            .isDuplicate(audienceResponse.getIsDuplicate())
                            .primaryResponseId(audienceResponse.getPrimaryResponseId())
                            // Lead score
                            .leadScore(leadScore != null ? leadScore.getRawScore() : null)
                            .leadTier(leadScore != null
                                    ? explicitTierByUserInstitute.getOrDefault(
                                            audienceResponse.getUserId() + "|" + leadScore.getInstituteId(),
                                            leadTierService.deriveTier(leadScore.getInstituteId(), leadScore.getRawScore()))
                                    : null)
                            .percentileRank(leadScore != null && leadScore.getPercentileRank() != null
                                    ? leadScore.getPercentileRank().doubleValue()
                                    : null)
                            .build();
                })
                .collect(Collectors.toList());

        // Post-fetch: filter by lead tier (requires lead_score join not available in
        // JPQL query)
        String leadTier = filterDTO.getLeadTier();
        List<EnquiryWithResponseDTO> filteredDtos = dtos;
        if (leadTier != null && !leadTier.isBlank()) {
            // Compare against the tier already resolved on the DTO (institute catalog aware)
            // instead of re-deriving with fixed thresholds. Accepts a comma-separated list.
            Set<String> wanted = Arrays.stream(leadTier.split(","))
                    .map(String::trim).filter(v -> !v.isEmpty()).map(String::toUpperCase)
                    .collect(Collectors.toSet());
            filteredDtos = dtos.stream().filter(dto -> {
                if (dto.getLeadScore() == null || dto.getLeadTier() == null)
                    return false;
                return wanted.contains(dto.getLeadTier().toUpperCase());
            }).collect(Collectors.toList());
        }

        // Post-fetch: sort by lead score if requested
        String sortBy = filterDTO.getSortBy();
        if ("LEAD_SCORE".equalsIgnoreCase(sortBy)) {
            boolean desc = !"ASC".equalsIgnoreCase(filterDTO.getSortDirection());
            filteredDtos.sort((a, b) -> {
                int sa = a.getLeadScore() != null ? a.getLeadScore() : 0;
                int sb = b.getLeadScore() != null ? b.getLeadScore() : 0;
                return desc ? Integer.compare(sb, sa) : Integer.compare(sa, sb);
            });
        } else if ("PARENT_NAME".equalsIgnoreCase(sortBy)) {
            boolean desc = "DESC".equalsIgnoreCase(filterDTO.getSortDirection());
            filteredDtos.sort((a, b) -> {
                String na = a.getParentName() != null ? a.getParentName() : "";
                String nb = b.getParentName() != null ? b.getParentName() : "";
                return desc ? nb.compareToIgnoreCase(na) : na.compareToIgnoreCase(nb);
            });
        }

        long totalElements = leadTier != null && !leadTier.isBlank()
                ? filteredDtos.size()
                : enquiries.getTotalElements();

        return new PageImpl<>(filteredDtos, pageable, totalElements);
    }

    /**
     * Build DTO when audience response is not found
     */
    private EnquiryWithResponseDTO buildEnquiryOnlyDTO(Enquiry enquiry) {
        return EnquiryWithResponseDTO.builder()
                .enquiryId(enquiry.getId())
                .checklist(enquiry.getChecklist())
                .enquiryStatus(enquiry.getEnquiryStatus())
                .convertionStatus(enquiry.getConvertionStatus())
                .referenceSource(enquiry.getReferenceSource())
                .assignedUserId(enquiry.getAssignedUserId())
                .assignedVisitSessionId(enquiry.getAssignedVisitSessionId())
                .feeRangeExpectation(enquiry.getFeeRangeExpectation())
                .transportRequirement(enquiry.getTransportRequirement())
                .mode(enquiry.getMode())
                .parentRelationWithChild(enquiry.getParentRelationWithChild())
                .enquiryTrackingId(enquiry.getEnquiryTrackingId())
                .interestScore(enquiry.getInterestScore())
                .notes(enquiry.getNotes())
                .enquiryCreatedAt(enquiry.getCreatedAt())
                .customFields(new HashMap<>())
                .build();
    }

    /**
     * Update an existing lead with enquiry information
     * Supports partial updates - only provided fields will be updated
     * 
     * @param audienceResponseId ID of the audience response to update
     * @param requestDTO         Update request with optional fields
     * @return Response with update results
     */
    @Transactional
    public UpdateLeadWithEnquiryResponseDTO updateLeadWithEnquiry(
            String audienceResponseId,
            UpdateLeadWithEnquiryRequestDTO requestDTO) {

        logger.info("Updating lead with enquiry for audience response: {}", audienceResponseId);

        // STEP 1: Fetch and validate audience response
        AudienceResponse response = audienceResponseRepository.findById(audienceResponseId)
                .orElseThrow(() -> new VacademyException("Audience response not found"));

        // STEP 2: Get institute ID for validation
        Audience audience = audienceRepository.findById(response.getAudienceId())
                .orElseThrow(() -> new VacademyException("Audience not found"));
        String instituteId = audience.getInstituteId();

        // Track updated components
        Map<String, Object> updatedFields = new HashMap<>();
        List<String> audienceResponseUpdates = new ArrayList<>();
        List<String> enquiryUpdates = new ArrayList<>();
        List<String> parentUserUpdates = new ArrayList<>();
        List<String> childUserUpdates = new ArrayList<>();
        List<String> customFieldUpdates = new ArrayList<>();

        // STEP 3: Update Audience Response fields
        boolean audienceResponseModified = false;
        if (requestDTO.getDestinationPackageSessionId() != null) {
            response.setDestinationPackageSessionId(requestDTO.getDestinationPackageSessionId());
            audienceResponseUpdates.add("destination_package_session_id");
            audienceResponseModified = true;
        }
        if (requestDTO.getParentName() != null) {
            response.setParentName(requestDTO.getParentName());
            audienceResponseUpdates.add("parent_name");
            audienceResponseModified = true;
        }
        if (requestDTO.getParentEmail() != null) {
            response.setParentEmail(requestDTO.getParentEmail());
            audienceResponseUpdates.add("parent_email");
            audienceResponseModified = true;
        }
        if (requestDTO.getParentMobile() != null) {
            response.setParentMobile(requestDTO.getParentMobile());
            audienceResponseUpdates.add("parent_mobile");
            audienceResponseModified = true;
        }

        if (audienceResponseModified) {
            audienceResponseRepository.save(response);
            logger.info("Updated audience response fields: {}", audienceResponseUpdates);
        }

        // STEP 4: Update Enquiry (if provided and exists)
        UUID enquiryId = null;
        if (requestDTO.getEnquiry() != null && StringUtils.hasText(response.getEnquiryId())) {
            try {
                enquiryId = UUID.fromString(response.getEnquiryId());
                Optional<Enquiry> enquiryOpt = enquiryRepository.findById(enquiryId);

                if (enquiryOpt.isPresent()) {
                    Enquiry enquiry = enquiryOpt.get();
                    EnquiryDTO enquiryDTO = requestDTO.getEnquiry();

                    // Update only non-null fields
                    if (enquiryDTO.getChecklist() != null) {
                        enquiry.setChecklist(enquiryDTO.getChecklist());
                        enquiryUpdates.add("checklist");
                    }
                    if (enquiryDTO.getEnquiryStatus() != null) {
                        enquiry.setEnquiryStatus(enquiryDTO.getEnquiryStatus());
                        enquiryUpdates.add("enquiry_status");
                    }
                    if (enquiryDTO.getConvertionStatus() != null) {
                        enquiry.setConvertionStatus(enquiryDTO.getConvertionStatus());
                        enquiryUpdates.add("convertion_status");
                    }
                    if (enquiryDTO.getReferenceSource() != null) {
                        enquiry.setReferenceSource(enquiryDTO.getReferenceSource());
                        enquiryUpdates.add("reference_source");
                    }
                    if (enquiryDTO.getFeeRangeExpectation() != null) {
                        enquiry.setFeeRangeExpectation(enquiryDTO.getFeeRangeExpectation());
                        enquiryUpdates.add("fee_range_expectation");
                    }
                    if (enquiryDTO.getTransportRequirement() != null) {
                        enquiry.setTransportRequirement(enquiryDTO.getTransportRequirement());
                        enquiryUpdates.add("transport_requirement");
                    }
                    if (enquiryDTO.getMode() != null) {
                        enquiry.setMode(enquiryDTO.getMode());
                        enquiryUpdates.add("mode");
                    }
                    if (enquiryDTO.getEnquiryTrackingId() != null) {
                        enquiry.setEnquiryTrackingId(enquiryDTO.getEnquiryTrackingId());
                        enquiryUpdates.add("enquiry_tracking_id");
                    }
                    if (enquiryDTO.getInterestScore() != null) {
                        enquiry.setInterestScore(enquiryDTO.getInterestScore());
                        enquiryUpdates.add("interest_score");
                    }
                    if (enquiryDTO.getNotes() != null) {
                        enquiry.setNotes(enquiryDTO.getNotes());
                        enquiryUpdates.add("notes");
                    }

                    if (!enquiryUpdates.isEmpty()) {
                        enquiryRepository.save(enquiry);
                        logger.info("Updated enquiry fields: {}", enquiryUpdates);
                    }
                } else {
                    logger.warn("Enquiry not found for ID: {}, skipping enquiry update", enquiryId);
                }
            } catch (IllegalArgumentException e) {
                logger.warn("Invalid enquiry ID format: {}, skipping enquiry update", response.getEnquiryId());
            }
        }

        // STEP 5: Update Parent and Child Users
        String parentUserId = response.getUserId();
        String childUserId = null;

        if (requestDTO.getParentUserDTO() != null || requestDTO.getChildUserDTO() != null) {
            // Fetch parent and child users in one call
            List<vacademy.io.common.auth.dto.ParentWithChildDTO> parentWithChildren = authService
                    .getUsersWithChildren(List.of(parentUserId));

            if (!parentWithChildren.isEmpty()) {
                vacademy.io.common.auth.dto.ParentWithChildDTO parentWithChild = parentWithChildren.get(0);
                UserDTO existingParent = parentWithChild.getParent();
                UserDTO existingChild = parentWithChild.getChild();

                // Update Parent User
                if (requestDTO.getParentUserDTO() != null) {
                    UserDTO mergedParent = mergeUserDTO(existingParent, requestDTO.getParentUserDTO());
                    authService.updateUser(mergedParent, parentUserId);

                    // Track which fields were updated
                    if (requestDTO.getParentUserDTO().getFullName() != null)
                        parentUserUpdates.add("full_name");
                    if (requestDTO.getParentUserDTO().getEmail() != null)
                        parentUserUpdates.add("email");
                    if (requestDTO.getParentUserDTO().getMobileNumber() != null)
                        parentUserUpdates.add("mobile_number");
                    if (requestDTO.getParentUserDTO().getAddressLine() != null)
                        parentUserUpdates.add("address_line");
                    if (requestDTO.getParentUserDTO().getCity() != null)
                        parentUserUpdates.add("city");
                    if (requestDTO.getParentUserDTO().getPinCode() != null)
                        parentUserUpdates.add("pin_code");
                    if (requestDTO.getParentUserDTO().getDateOfBirth() != null)
                        parentUserUpdates.add("date_of_birth");
                    if (requestDTO.getParentUserDTO().getGender() != null)
                        parentUserUpdates.add("gender");

                    logger.info("Updated parent user fields: {}", parentUserUpdates);
                }

                // Update Child User (if exists)
                if (requestDTO.getChildUserDTO() != null && existingChild != null) {
                    UserDTO mergedChild = mergeUserDTO(existingChild, requestDTO.getChildUserDTO());
                    authService.updateUser(mergedChild, existingChild.getId());
                    childUserId = existingChild.getId();

                    // Track which fields were updated
                    if (requestDTO.getChildUserDTO().getFullName() != null)
                        childUserUpdates.add("full_name");
                    if (requestDTO.getChildUserDTO().getEmail() != null)
                        childUserUpdates.add("email");
                    if (requestDTO.getChildUserDTO().getDateOfBirth() != null)
                        childUserUpdates.add("date_of_birth");
                    if (requestDTO.getChildUserDTO().getGender() != null)
                        childUserUpdates.add("gender");

                    logger.info("Updated child user fields: {}", childUserUpdates);
                } else if (requestDTO.getChildUserDTO() != null) {
                    logger.warn("Child user not found for parent {}, skipping child update", parentUserId);
                }
            }
        }

        // STEP 6: Update Custom Field Values (Upsert strategy)
        if (requestDTO.getCustomFieldValues() != null && !requestDTO.getCustomFieldValues().isEmpty()) {
            // Fetch existing custom field values
            List<CustomFieldValues> existingValues = customFieldValuesRepository
                    .findBySourceTypeAndSourceId("AUDIENCE_RESPONSE", audienceResponseId);

            Map<String, CustomFieldValues> existingMap = existingValues.stream()
                    .collect(Collectors.toMap(
                            cfv -> {
                                // Get field key from custom field
                                CustomFields cf = customFieldRepository.findById(cfv.getCustomFieldId()).orElse(null);
                                return cf != null ? cf.getFieldKey() : "";
                            },
                            cfv -> cfv,
                            (a, b) -> a));

            // Upsert custom field values
            for (Map.Entry<String, String> entry : requestDTO.getCustomFieldValues().entrySet()) {
                String fieldKey = entry.getKey();
                String fieldValue = entry.getValue();

                if (existingMap.containsKey(fieldKey)) {
                    // Update existing value
                    CustomFieldValues existing = existingMap.get(fieldKey);
                    existing.setValue(fieldValue);
                    customFieldValuesRepository.save(existing);
                    customFieldUpdates.add(fieldKey + " (updated)");
                } else {
                    // Create new custom field value
                    // Find custom field by key and institute (to avoid duplicate field_key across
                    // institutes)
                    Optional<CustomFields> customFieldOpt = customFieldRepository
                            .findByFieldKeyAndInstituteId(fieldKey, instituteId);

                    if (customFieldOpt.isPresent()) {
                        CustomFieldValues newValue = CustomFieldValues.builder()
                                .sourceType("AUDIENCE_RESPONSE")
                                .sourceId(audienceResponseId)
                                .customFieldId(customFieldOpt.get().getId())
                                .value(fieldValue)
                                .build();
                        customFieldValuesRepository.save(newValue);
                        customFieldUpdates.add(fieldKey + " (added)");
                    } else {
                        logger.warn("Custom field not found for key: {}, skipping", fieldKey);
                    }
                }
            }

            if (!customFieldUpdates.isEmpty()) {
                logger.info("Updated custom field values: {}", customFieldUpdates);
            }
        }

        // STEP 7: Update Counselor Assignment
        String updatedCounsellorId = null;
        if (requestDTO.getCounsellorId() != null && !requestDTO.getCounsellorId().isEmpty()
                && StringUtils.hasText(response.getEnquiryId())) {

            try {
                UUID enquiryIdForCounselor = UUID.fromString(response.getEnquiryId());
                Optional<Enquiry> enquiryOpt = enquiryRepository.findById(enquiryIdForCounselor);

                if (enquiryOpt.isPresent()) {
                    Enquiry enquiry = enquiryOpt.get();

                    // Validate counselor
                    if (validateCounselor(requestDTO.getCounsellorId(), instituteId)) {
                        // Delete old counselor link
                        linkedUsersRepository.deleteBySourceAndSourceId("ENQUIRY", response.getEnquiryId());

                        // Create new counselor link
                        LinkedUsers newLink = LinkedUsers.builder()
                                .source("ENQUIRY")
                                .sourceId(response.getEnquiryId())
                                .userId(requestDTO.getCounsellorId())
                                .build();
                        linkedUsersRepository.save(newLink);

                        // Update enquiry flag
                        enquiry.setAssignedUserId(true);
                        enquiryRepository.save(enquiry);

                        updatedCounsellorId = requestDTO.getCounsellorId();
                        logger.info("Updated counselor assignment to: {}", updatedCounsellorId);
                        emitLeadAssigned(instituteId, response.getAudienceId(),
                                response.getEnquiryId(), updatedCounsellorId);

                        try {
                            timelineEventService.logJourneyEvent(
                                    "ENQUIRY", response.getEnquiryId(),
                                    LeadJourneyActionType.COUNSELOR_ASSIGNED,
                                    "ADMIN", updatedCounsellorId, null,
                                    "Counselor reassigned",
                                    "Counselor manually reassigned",
                                    Map.of("counselor_id", updatedCounsellorId,
                                            "assignment_source", "MANUAL"),
                                    // Link to the lead so a manual reassignment counts as a
                                    // response for TAT (the intake auto-assignment event in
                                    // linkCounsellorToEnquiry deliberately stays unlinked).
                                    response.getUserId() != null ? response.getUserId()
                                            : response.getStudentUserId());
                        } catch (Exception e) {
                            logger.warn("Failed to log COUNSELOR_ASSIGNED journey event for enquiry {}: {}",
                                    response.getEnquiryId(), e.getMessage());
                        }
                    } else {
                        logger.warn("Counselor validation failed for ID: {}, skipping counselor update",
                                requestDTO.getCounsellorId());
                    }
                }
            } catch (IllegalArgumentException e) {
                logger.warn("Invalid enquiry ID format for counselor update: {}", response.getEnquiryId());
            }
        }

        // STEP 8: Build updated fields map
        updatedFields.put("audience_response", audienceResponseUpdates);
        updatedFields.put("enquiry", enquiryUpdates);
        updatedFields.put("parent_user", parentUserUpdates);
        updatedFields.put("child_user", childUserUpdates);
        updatedFields.put("custom_fields", customFieldUpdates);
        updatedFields.put("counselor", updatedCounsellorId != null);

        // STEP 9: Build and return response
        return UpdateLeadWithEnquiryResponseDTO.builder()
                .audienceResponseId(audienceResponseId)
                .enquiryId(enquiryId)
                .parentUserId(parentUserId)
                .childUserId(childUserId)
                .counsellorId(updatedCounsellorId)
                .message("Lead and enquiry updated successfully")
                .updatedFields(updatedFields)
                .build();
    }

    /**
     * Merge user DTO for partial updates
     * Takes existing user data and overlays update data (only non-null fields)
     * 
     * @param existing Existing user data from database
     * @param updates  Update data from request
     * @return Merged user DTO with updates applied
     */
    private UserDTO mergeUserDTO(UserDTO existing, UserDTO updates) {
        return UserDTO.builder()
                .id(existing.getId())
                .username(existing.getUsername())
                .email(updates.getEmail() != null ? updates.getEmail() : existing.getEmail())
                .fullName(updates.getFullName() != null ? updates.getFullName() : existing.getFullName())
                .addressLine(updates.getAddressLine() != null ? updates.getAddressLine() : existing.getAddressLine())
                .city(updates.getCity() != null ? updates.getCity() : existing.getCity())
                .region(updates.getRegion() != null ? updates.getRegion() : existing.getRegion())
                .pinCode(updates.getPinCode() != null ? updates.getPinCode() : existing.getPinCode())
                .mobileNumber(
                        updates.getMobileNumber() != null ? updates.getMobileNumber() : existing.getMobileNumber())
                .dateOfBirth(updates.getDateOfBirth() != null ? updates.getDateOfBirth() : existing.getDateOfBirth())
                .gender(updates.getGender() != null ? updates.getGender() : existing.getGender())
                .isRootUser(existing.isRootUser())
                .profilePicFileId(updates.getProfilePicFileId() != null ? updates.getProfilePicFileId()
                        : existing.getProfilePicFileId())
                .roles(existing.getRoles())
                .lastLoginTime(existing.getLastLoginTime())
                .isParent(existing.getIsParent())
                .linkedParentId(existing.getLinkedParentId())
                .build();
    }

    /**
     * audience_response.parent_mobile is VARCHAR(20) — a raw, un-normalized phone
     * string (extra formatting/text from a form/CSV) could exceed that and fail the
     * insert. Truncate defensively rather than let a malformed value drop the lead.
     */
    private String truncateForParentMobileColumn(String mobile) {
        if (mobile == null) return null;
        return mobile.length() > 20 ? mobile.substring(0, 20) : mobile;
    }

    /**
     * Calculate workflowActivateDayAt based on audience
     * workflow_setting.offset_day.
     * If offset_day is present, adds/subtracts that many days from current date.
     * If not present, returns current timestamp.
     *
     * @param audience The audience entity containing settingJson
     * @return Timestamp for workflowActivateDayAt
     */
    private Timestamp calculateWorkflowActivateDayAt(Audience audience) {
        try {
            String settingJson = audience.getSettingJson();
            if (!StringUtils.hasText(settingJson)) {
                logger.debug("No settingJson for audience {}, using current timestamp", audience.getId());
                return Timestamp.valueOf(LocalDateTime.now());
            }

            ObjectMapper mapper = new ObjectMapper();
            JsonNode rootNode = mapper.readTree(settingJson);
            JsonNode workflowSetting = rootNode.path("workflow_setting");

            if (workflowSetting.isMissingNode()) {
                logger.debug("No workflow_setting for audience {}, using current timestamp", audience.getId());
                return Timestamp.valueOf(LocalDateTime.now());
            }

            JsonNode offsetDayNode = workflowSetting.path("offset_day");
            if (offsetDayNode.isMissingNode() || !offsetDayNode.isNumber()) {
                logger.debug("No valid offset_day for audience {}, using current timestamp", audience.getId());
                return Timestamp.valueOf(LocalDateTime.now());
            }

            int offsetDays = offsetDayNode.asInt();
            LocalDateTime activateDateTime = LocalDateTime.now().plusDays(offsetDays);

            logger.info("Calculated workflowActivateDayAt for audience {}: offset_day={}, result={}",
                    audience.getId(), offsetDays, activateDateTime);

            return Timestamp.valueOf(activateDateTime);
        } catch (Exception e) {
            logger.warn("Error parsing settingJson for audience {}, using current timestamp: {}",
                    audience.getId(), e.getMessage());
            return Timestamp.valueOf(LocalDateTime.now());
        }
    }

    private void sendEnquiryConfirmationEmail(UserDTO parentUser, UserDTO childUser, Audience audience, Enquiry enquiry,
            PackageSession packageSession) {

        String instituteId = audience.getInstituteId();

        // Get credentials (username and password)
        // Get credentials (username and password)
        String username = parentUser != null ? parentUser.getUsername() : "";
        String password = "";

        if (parentUser != null) {
            try {
                UserDTO userWithPassword = authService.getUsersFromAuthServiceWithPasswordByUserId(parentUser.getId());
                if (userWithPassword != null && StringUtils.hasText(userWithPassword.getPassword())) {
                    password = userWithPassword.getPassword();
                } else {
                    password = parentUser.getPassword(); // Fallback
                }
            } catch (Exception e) {
                logger.error("Failed to fetch user password for email", e);
                password = parentUser.getPassword(); // Fallback
            }
        }

        // Build portal URL (hardcoded for now)
        String portalUrl = "https://learner-portal.vacademy.io";

        // Format submission time
        java.time.ZonedDateTime now = java.time.ZonedDateTime.now();
        java.time.format.DateTimeFormatter formatter = java.time.format.DateTimeFormatter
                .ofPattern("MMM dd, yyyy hh:mm a z");
        String submissionTime = now.format(formatter);

        String sessionName = (packageSession != null && packageSession.getSession() != null)
                ? packageSession.getSession().getSessionName()
                : "Session";
        String trackingId = enquiry != null ? enquiry.getEnquiryTrackingId() : "N/A";
        String campaignName = audience.getCampaignName();
        String studentName = childUser != null ? childUser.getFullName() : "Student";
        String parentName = parentUser != null ? parentUser.getFullName() : "Parent";

        // Try to fetch template from notification_event_config
        Optional<NotificationEventConfig> configOpt = notificationEventConfigRepository
                .findFirstByEventNameAndSourceTypeAndSourceIdAndTemplateTypeAndIsActiveTrueOrderByUpdatedAtDesc(
                        NotificationEventType.ENQUIRY_FORM_SUBMISSION,
                        NotificationSourceType.AUDIENCE,
                        audience.getInstituteId(), // Use audience ID as source ID? No, usually Institute or Audience
                                                   // ID. Let's use Audience ID as per plan.
                        NotificationTemplateType.EMAIL);

        // Just in case, try searching with source_id = audience_id if institute_id one
        // failed or vice versa depending on config strategy
        if (configOpt.isEmpty()) {
            configOpt = notificationEventConfigRepository
                    .findFirstByEventNameAndSourceTypeAndSourceIdAndTemplateTypeAndIsActiveTrueOrderByUpdatedAtDesc(
                            NotificationEventType.ENQUIRY_FORM_SUBMISSION,
                            NotificationSourceType.AUDIENCE,
                            audience.getId(),
                            NotificationTemplateType.EMAIL);
        }

        if (configOpt.isPresent()) {
            logger.info("Found custom email template for enquiry submission: {}", configOpt.get().getTemplateId());

            // Build variables for template
            NotificationTemplateVariables variables = NotificationTemplateVariables.builder()
                    .userName(username)
                    .userPassword(password)
                    .portalUrl(portalUrl)
                    .childName(studentName)
                    .trackingId(trackingId)
                    .sessionName(sessionName)
                    .submissionTime(submissionTime)
                    .instituteId(instituteId)
                    .campaignName(campaignName)
                    .build();

            sendUniqueLinkService.sendUniqueLinkByEmailByEnrollInvite(
                    instituteId,
                    parentUser,
                    configOpt.get().getTemplateId(),
                    null,
                    variables);
        } else {
            // Default Email Fallback
            logger.info("No custom template found, using default enquiry confirmation email");

            String defaultEmailBody = buildDefaultEnquiryEmailBody(
                    parentName,
                    studentName,
                    sessionName,
                    trackingId,
                    submissionTime,
                    username,
                    password,
                    portalUrl,
                    campaignName);

            GenericEmailRequest emailRequest = new GenericEmailRequest();
            emailRequest.setTo(parentUser.getEmail());
            emailRequest.setSubject("Enquiry Submitted Successfully - " + campaignName + " - " + trackingId);
            emailRequest.setBody(defaultEmailBody);

            notificationService.sendGenericHtmlMailViaUnified(emailRequest, instituteId);
        }
    }

    /**
     * Bulk submit leads with enquiry (CSV import-friendly).
     * <p>
     * This endpoint loops through rows and delegates the actual persistence to the
     * existing
     * single-row {@link #submitLeadWithEnquiry(SubmitLeadWithEnquiryRequestDTO)}
     * method.
     * It returns per-row results so that one failing row does not block the others.
     */
    public BulkSubmitLeadWithEnquiryResponseDTO bulkSubmitLeadWithEnquiry(
            BulkSubmitLeadWithEnquiryRequestDTO request) {

        if (request == null || CollectionUtils.isEmpty(request.getRows())) {
            throw new VacademyException("rows cannot be empty");
        }

        String rootAudienceId = request.getAudienceId();

        List<BulkSubmitLeadWithEnquiryResultItemDTO> results = new ArrayList<>(
                request.getRows().size());
        Set<String> dedupeKeys = new HashSet<>();

        int success = 0;
        int failed = 0;
        int skipped = 0;

        for (int i = 0; i < request.getRows().size(); i++) {
            SubmitLeadWithEnquiryRequestDTO row = request.getRows().get(i);

            if (row == null) {
                failed++;
                results.add(BulkSubmitLeadWithEnquiryResultItemDTO.builder()
                        .index(i)
                        .status("FAILED")
                        .message("Row is null")
                        .build());
                continue;
            }

            // Support payloads where audience_id exists at the root only.
            if (!StringUtils.hasText(row.getAudienceId())
                    && StringUtils.hasText(rootAudienceId)) {
                row.setAudienceId(rootAudienceId);
            }

            if (!StringUtils.hasText(row.getAudienceId())) {
                failed++;
                results.add(BulkSubmitLeadWithEnquiryResultItemDTO.builder()
                        .index(i)
                        .status("FAILED")
                        .message("audience_id is required (root or row)")
                        .build());
                continue;
            }

            // Map optional CSV-friendly aliases:
            // - `status` -> enquiry.enquiry_status
            // - `source` -> source_type
            if (row.getEnquiry() == null && StringUtils.hasText(row.getStatus())) {
                row.setEnquiry(EnquiryDTO.builder()
                        .enquiryStatus(row.getStatus().trim())
                        .build());
            } else if (row.getEnquiry() != null
                    && !StringUtils.hasText(row.getEnquiry().getEnquiryStatus())
                    && StringUtils.hasText(row.getStatus())) {
                row.getEnquiry().setEnquiryStatus(row.getStatus().trim());
            }

            if (!StringUtils.hasText(row.getSourceType())
                    && StringUtils.hasText(row.getSource())) {
                row.setSourceType(row.getSource().trim());
            }

            // Lightweight normalization only (no extra required-field checks).
            // Mandatory fields (ensured by frontend team):
            // - child_user_dto.full_name, child_user_dto.gender,
            // child_user_dto.date_of_birth
            // - parent_name, parent_email, parent_mobile
            row.setParentName(row.getParentName().trim());
            row.setParentEmail(row.getParentEmail().trim().toLowerCase());
            row.setParentMobile(row.getParentMobile().trim());

            // Normalization for student name + optional email.
            row.getChildUserDTO().setFullName(row.getChildUserDTO()
                    .getFullName().trim());
            if (StringUtils.hasText(row.getChildUserDTO().getEmail())) {
                row.getChildUserDTO().setEmail(
                        row.getChildUserDTO().getEmail().trim().toLowerCase());
            }
            // gender is mandatory; normalize without validating its allowed values
            row.getChildUserDTO().setGender(
                    row.getChildUserDTO().getGender().trim());

            // Best-effort dedupe inside the upload payload.
            String parentEmailKey = row.getParentEmail().trim().toLowerCase();
            String childNameKey = row.getChildUserDTO().getFullName().trim().toLowerCase();
            String destinationKey = StringUtils.hasText(row.getDestinationPackageSessionId())
                    ? row.getDestinationPackageSessionId().trim()
                    : "";

            String dedupeKey = row.getAudienceId().trim()
                    + "|" + parentEmailKey
                    + "|" + childNameKey
                    + "|" + destinationKey;

            if (dedupeKeys.contains(dedupeKey)) {
                skipped++;
                results.add(BulkSubmitLeadWithEnquiryResultItemDTO.builder()
                        .index(i)
                        .status("SKIPPED")
                        .message("Duplicate in upload payload")
                        .build());
                continue;
            }
            dedupeKeys.add(dedupeKey);

            try {
                SubmitLeadWithEnquiryResponseDTO response = submitLeadWithEnquiry(row);

                success++;
                results.add(BulkSubmitLeadWithEnquiryResultItemDTO.builder()
                        .index(i)
                        .status("SUCCESS")
                        .message(response.getMessage())
                        .enquiryId(response.getEnquiryId())
                        .audienceResponseId(response.getAudienceResponseId())
                        .parentUserId(response.getParentUserId())
                        .counsellorId(response.getCounsellorId())
                        .build());
            } catch (VacademyException ve) {
                String msg = ve.getMessage();
                String normalizedMsg = msg != null ? msg.toLowerCase() : "";
                boolean alreadySubmitted = normalizedMsg.contains("already submitted");

                if (alreadySubmitted) {
                    skipped++;
                    results.add(BulkSubmitLeadWithEnquiryResultItemDTO.builder()
                            .index(i)
                            .status("SKIPPED")
                            .message(msg)
                            .build());
                } else {
                    failed++;
                    results.add(BulkSubmitLeadWithEnquiryResultItemDTO.builder()
                            .index(i)
                            .status("FAILED")
                            .message(msg)
                            .build());
                }
            } catch (Exception e) {
                failed++;
                results.add(BulkSubmitLeadWithEnquiryResultItemDTO.builder()
                        .index(i)
                        .status("FAILED")
                        .message(e.getMessage())
                        .build());
            }
        }

        BulkSubmitLeadWithEnquiryResponseDTO.SummaryDTO summary = BulkSubmitLeadWithEnquiryResponseDTO.SummaryDTO
                .builder()
                .totalRequested(results.size())
                .successful(success)
                .failed(failed)
                .skipped(skipped)
                .build();

        return BulkSubmitLeadWithEnquiryResponseDTO.builder()
                .summary(summary)
                .results(results)
                .build();
    }

    /**
     * Send a message (WhatsApp, Email, Push, or System Alert) to leads in an
     * audience campaign.
     * Resolves per-recipient template variables from system fields and custom field
     * values.
     */
    public SendAudienceMessageResponseDTO sendAudienceMessage(SendAudienceMessageRequestDTO request) {
        // 1. Validate audience exists
        Audience audience = audienceRepository.findById(request.getAudienceId())
                .orElseThrow(() -> new VacademyException("Audience not found: " + request.getAudienceId()));

        // 2. Fetch this audience's live leads (TODO: apply filters from request.getFilters()).
        // ACTIVE-only, hardcoded: a soft-deleted lead must never receive a campaign send.
        List<AudienceResponse> allResponses = audienceResponseRepository
                .findActiveByAudienceId(request.getAudienceId());
        if (CollectionUtils.isEmpty(allResponses)) {
            throw new VacademyException("No leads found for audience: " + request.getAudienceId());
        }

        // 2b. Narrow to the rows the caller ticked in the lead table, if any. Filtering the
        // audience's own ACTIVE list (rather than looking the ids up directly) keeps both
        // invariants: a response id from another audience or a soft-deleted one can never
        // be smuggled into a send. No ids supplied → the whole audience, as before.
        if (!CollectionUtils.isEmpty(request.getResponseIds())) {
            Set<String> wanted = new HashSet<>(request.getResponseIds());
            allResponses = allResponses.stream()
                    .filter(r -> wanted.contains(r.getId()))
                    .collect(Collectors.toList());
            if (allResponses.isEmpty()) {
                throw new VacademyException(
                        "None of the selected leads belong to audience: " + request.getAudienceId());
            }
        }

        String channel = request.getChannel();

        // Resolve once whether this institute's numbers should default to India
        // (+91) for bare 10-digit numbers. Blank/unknown country → treat as India.
        String messageInstituteId = request.getInstituteId();
        boolean instituteDefaultsToIndia = PhoneCountryUtil.defaultsToIndia(
                StringUtils.hasText(messageInstituteId)
                        ? instituteRepository.findById(messageInstituteId)
                                .map(Institute::getCountry).orElse(null)
                        : null);

        // 3. Batch-fetch user details for leads that have a userId (needed for contact
        // resolution)
        List<String> userIds = allResponses.stream()
                .map(AudienceResponse::getUserId)
                .filter(StringUtils::hasText)
                .distinct()
                .collect(Collectors.toList());

        Map<String, UserDTO> userMap = new HashMap<>();
        if (!userIds.isEmpty()) {
            try {
                List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(userIds);
                if (users != null) {
                    for (UserDTO u : users) {
                        userMap.put(u.getId(), u);
                    }
                }
            } catch (Exception e) {
                logger.warn("Failed to fetch user details for audience message, proceeding without: {}",
                        e.getMessage());
            }
        }

        // 4. Filter leads that have the required contact info for the channel
        List<AudienceResponse> eligibleResponses = new ArrayList<>();
        int skipped = 0;

        for (AudienceResponse resp : allResponses) {
            UserDTO userDTO = StringUtils.hasText(resp.getUserId()) ? userMap.get(resp.getUserId()) : null;
            boolean hasContact = false;
            switch (channel) {
                case "WHATSAPP":
                    hasContact = StringUtils.hasText(resp.getParentMobile())
                            || (userDTO != null && StringUtils.hasText(userDTO.getMobileNumber()));
                    break;
                case "EMAIL":
                    // Resolve the address the same way the recipient builder does (parent
                    // email first, else the user's email), then treat a synthesized
                    // placeholder address as "no contact" — it is non-deliverable and must
                    // never be included in a real EMAIL blast (it would bounce). WhatsApp /
                    // PUSH still reach these leads via phone / userId.
                    String emailContact = StringUtils.hasText(resp.getParentEmail())
                            ? resp.getParentEmail()
                            : (userDTO != null ? userDTO.getEmail() : null);
                    hasContact = StringUtils.hasText(emailContact)
                            && !placeholderEmailService.isPlaceholder(emailContact);
                    break;
                case "PUSH":
                case "SYSTEM_ALERT":
                    hasContact = StringUtils.hasText(resp.getUserId());
                    break;
                default:
                    hasContact = true;
            }
            if (hasContact) {
                eligibleResponses.add(resp);
            } else {
                skipped++;
            }
        }

        if (eligibleResponses.isEmpty()) {
            throw new VacademyException("No leads have the required contact info for channel: " + channel);
        }

        // 5. Batch-fetch custom field values for all response IDs
        List<String> responseIds = eligibleResponses.stream()
                .map(AudienceResponse::getId)
                .collect(Collectors.toList());

        // Map: responseId -> (fieldId -> value)
        Map<String, Map<String, String>> customFieldMap = new HashMap<>();
        if (!responseIds.isEmpty()) {
            List<CustomFieldValues> cfValues = customFieldValuesRepository
                    .findBySourceTypeAndSourceIdIn("AUDIENCE_RESPONSE", responseIds);
            for (CustomFieldValues cfv : cfValues) {
                customFieldMap
                        .computeIfAbsent(cfv.getSourceId(), k -> new HashMap<>())
                        .put(cfv.getCustomFieldId(), cfv.getValue());
            }
        }

        // 6. Build recipients with resolved variables
        Map<String, String> variableMapping = request.getVariableMapping();
        List<UnifiedSendRequest.Recipient> recipients = new ArrayList<>();

        for (AudienceResponse resp : eligibleResponses) {
            UserDTO userDTO = StringUtils.hasText(resp.getUserId()) ? userMap.get(resp.getUserId()) : null;
            Map<String, String> cfForResp = customFieldMap.getOrDefault(resp.getId(), Collections.emptyMap());

            // Resolve template variables. The recipient's own identity is always available
            // as {{name}} / {{first_name}} / {{email}} without the caller having to map it —
            // the unified aliases derive first/last name from "name". A send that relied on
            // an explicit mapping the caller forgot went out reading "Hi {{first_name}},".
            Map<String, String> resolvedVars = new HashMap<>();
            String builtinName = userDTO != null && StringUtils.hasText(userDTO.getFullName())
                    ? userDTO.getFullName() : resp.getParentName();
            String builtinEmail = userDTO != null && StringUtils.hasText(userDTO.getEmail())
                    ? userDTO.getEmail() : resp.getParentEmail();
            if (StringUtils.hasText(builtinName)) resolvedVars.put("name", builtinName.trim());
            if (StringUtils.hasText(builtinEmail)) resolvedVars.put("email", builtinEmail.trim());
            if (variableMapping != null) {
                for (Map.Entry<String, String> entry : variableMapping.entrySet()) {
                    String templateVar = entry.getKey();
                    String source = entry.getValue();
                    String resolved = resolveVariable(source, resp, userDTO, cfForResp, audience);
                    if (resolved != null) {
                        resolvedVars.put(templateVar, resolved);
                    }
                }
            }

            // Determine recipient name
            String recipientName = userDTO != null && StringUtils.hasText(userDTO.getFullName())
                    ? userDTO.getFullName()
                    : resp.getParentName();

            UnifiedSendRequest.Recipient.RecipientBuilder recipientBuilder = UnifiedSendRequest.Recipient.builder()
                    .name(recipientName)
                    .variables(resolvedVars);

            switch (channel) {
                case "WHATSAPP":
                    String phone = StringUtils.hasText(resp.getParentMobile())
                            ? resp.getParentMobile()
                            : (userDTO != null ? userDTO.getMobileNumber() : null);
                    // Sanitize to digits and prepend 91 for bare 10-digit numbers
                    // when the institute defaults to India (blank/unknown or India).
                    recipientBuilder.phone(PhoneCountryUtil.normalizePhone(phone, instituteDefaultsToIndia));
                    break;
                case "EMAIL":
                    String email = StringUtils.hasText(resp.getParentEmail())
                            ? resp.getParentEmail()
                            : (userDTO != null ? userDTO.getEmail() : null);
                    // Defensive: the contact filter above already drops placeholder-only
                    // leads, but never hand a synthesized non-deliverable address to the
                    // sender even if reached another way.
                    if (placeholderEmailService.isPlaceholder(email)) {
                        email = null;
                    }
                    recipientBuilder.email(email);
                    break;
                case "PUSH":
                case "SYSTEM_ALERT":
                    recipientBuilder.userId(resp.getUserId());
                    break;
            }

            recipients.add(recipientBuilder.build());
        }

        // 7. Build UnifiedSendRequest
        UnifiedSendRequest.SendOptions.SendOptionsBuilder optsBuilder = UnifiedSendRequest.SendOptions.builder()
                .source("AUDIENCE")
                .sourceId(request.getAudienceId());

        if ("EMAIL".equals(channel) && StringUtils.hasText(request.getSubject())) {
            optsBuilder.emailSubject(request.getSubject());
        }
        if (StringUtils.hasText(request.getBody())) {
            if ("EMAIL".equals(channel)) {
                optsBuilder.emailBody(request.getBody());
            } else if ("PUSH".equals(channel) || "SYSTEM_ALERT".equals(channel)) {
                optsBuilder.pushBody(request.getBody());
            }
        }
        if (StringUtils.hasText(request.getEmailType())) {
            optsBuilder.emailType(request.getEmailType());
        }
        if (("PUSH".equals(channel) || "SYSTEM_ALERT".equals(channel)) && StringUtils.hasText(request.getSubject())) {
            optsBuilder.pushTitle(request.getSubject());
        }
        // Media header for WhatsApp templates. Without this the provider rejects every
        // recipient of an IMAGE/VIDEO/DOCUMENT-header template, so the whole blast fails.
        if ("WHATSAPP".equals(channel) && StringUtils.hasText(request.getHeaderUrl())) {
            optsBuilder.headerUrl(request.getHeaderUrl());
            optsBuilder.headerType(StringUtils.hasText(request.getHeaderType())
                    ? request.getHeaderType()
                    : "image");
        }

        UnifiedSendRequest sendRequest = UnifiedSendRequest.builder()
                .instituteId(request.getInstituteId())
                .channel(channel)
                .templateName(request.getTemplateName())
                .languageCode(request.getLanguageCode() != null ? request.getLanguageCode() : "en")
                .recipients(recipients)
                .options(optsBuilder.build())
                // Above ~10 recipients the inline send loop (one provider call per
                // recipient) can outlive InternalClientUtils' 30s read timeout →
                // spurious 510 while delivery keeps running. Queue those as a batch;
                // getCommunications() syncs the final counts back from the batch.
                .forceAsync(recipients.size() > ASYNC_SEND_THRESHOLD)
                .build();

        // 8. Call notification service
        UnifiedSendResponse sendResponse;
        try {
            sendResponse = notificationService.sendUnified(sendRequest);
        } catch (Exception e) {
            logger.error("Failed to send audience message for audience {}: {}", request.getAudienceId(), e.getMessage(),
                    e);
            throw new VacademyException("Failed to send message: " + e.getMessage());
        }

        // 9. Save AudienceCommunication record
        String variableMappingJson = null;
        String filtersJson = null;
        try {
            ObjectMapper mapper = new ObjectMapper();
            if (variableMapping != null) {
                variableMappingJson = mapper.writeValueAsString(variableMapping);
            }
            if (request.getFilters() != null) {
                filtersJson = mapper.writeValueAsString(request.getFilters());
            }
        } catch (Exception e) {
            logger.warn("Failed to serialize variable mapping or filters: {}", e.getMessage());
        }

        AudienceCommunication communication = AudienceCommunication.builder()
                .instituteId(request.getInstituteId())
                .audienceId(request.getAudienceId())
                .channel(channel)
                .templateName(request.getTemplateName())
                .subject(request.getSubject())
                .body(request.getBody())
                .variableMapping(variableMappingJson)
                .filters(filtersJson)
                .recipientCount(recipients.size())
                .successful(sendResponse.getAccepted())
                .failed(sendResponse.getFailed())
                .skipped(skipped)
                .batchId(sendResponse.getBatchId())
                .status(sendResponse.getStatus())
                .createdBy(request.getCreatedBy())
                .build();

        audienceCommunicationRepository.save(communication);

        // 10. Return response
        return SendAudienceMessageResponseDTO.builder()
                .communicationId(communication.getId())
                .recipientCount(recipients.size())
                .accepted(sendResponse.getAccepted())
                .failed(sendResponse.getFailed())
                .batchId(sendResponse.getBatchId())
                .status(sendResponse.getStatus())
                .build();
    }

    /**
     * Resolve a single variable from the variableMapping source descriptor.
     */
    private String resolveVariable(String source, AudienceResponse response, UserDTO userDTO,
            Map<String, String> customFields, Audience audience) {
        if (source == null)
            return null;

        if (source.startsWith("system:")) {
            String field = source.substring("system:".length());
            switch (field) {
                case "full_name":
                    return userDTO != null && StringUtils.hasText(userDTO.getFullName())
                            ? userDTO.getFullName()
                            : response.getParentName();
                case "email":
                    String resolvedEmail = userDTO != null && StringUtils.hasText(userDTO.getEmail())
                            ? userDTO.getEmail()
                            : response.getParentEmail();
                    // Never surface a synthesized placeholder address into a message
                    // variable/body (it's non-deliverable and meaningless to the lead).
                    return placeholderEmailService.isPlaceholder(resolvedEmail) ? null : resolvedEmail;
                case "mobile_number":
                    return userDTO != null && StringUtils.hasText(userDTO.getMobileNumber())
                            ? userDTO.getMobileNumber()
                            : response.getParentMobile();
                case "city":
                    return userDTO != null ? userDTO.getCity() : null;
                case "region":
                    return userDTO != null ? userDTO.getRegion() : null;
                case "campaign_name":
                    return audience.getCampaignName();
                case "submitted_at":
                    return response.getSubmittedAt() != null ? response.getSubmittedAt().toString() : null;
                case "source_type":
                    return response.getSourceType();
                default:
                    logger.warn("Unknown system variable: {}", field);
                    return null;
            }
        } else if (source.startsWith("custom:")) {
            String fieldId = source.substring("custom:".length());
            return customFields.get(fieldId);
        } else if (source.startsWith("static:")) {
            return source.substring("static:".length());
        }

        // If no prefix, treat as literal
        return source;
    }

    /**
     * Retrieve paginated communication history for an audience campaign.
     */
    public Page<AudienceCommunicationDTO> getCommunications(String audienceId, int page, int size) {
        Pageable pageable = PageRequest.of(page, size);
        Page<AudienceCommunication> comms = audienceCommunicationRepository
                .findByAudienceIdOrderByCreatedAtDesc(audienceId, pageable);
        // Async sends are recorded as QUEUED/PROCESSING with a batchId; the batch runs
        // on notification-service, so pull its final counts in on read.
        for (AudienceCommunication c : comms) {
            if (StringUtils.hasText(c.getBatchId())
                    && ("QUEUED".equals(c.getStatus()) || "PROCESSING".equals(c.getStatus()))) {
                UnifiedSendResponse batchStatus;
                try {
                    batchStatus = notificationService.getUnifiedBatchStatus(c.getBatchId());
                } catch (Exception e) {
                    logger.warn("Failed to refresh batch status for communication {} (batch {}): {}",
                            c.getId(), c.getBatchId(), e.getMessage());
                    continue; // status unknown — keep the stored value
                }
                if (batchStatus != null && StringUtils.hasText(batchStatus.getStatus())
                        && !batchStatus.getStatus().equals(c.getStatus())) {
                    c.setStatus(batchStatus.getStatus());
                    c.setSuccessful(batchStatus.getAccepted());
                    c.setFailed(batchStatus.getFailed());
                    audienceCommunicationRepository.save(c);
                }
            }
        }
        return comms.map(c -> AudienceCommunicationDTO.builder()
                .id(c.getId())
                .channel(c.getChannel())
                .templateName(c.getTemplateName())
                .subject(c.getSubject())
                .recipientCount(c.getRecipientCount())
                .successful(c.getSuccessful())
                .failed(c.getFailed())
                .skipped(c.getSkipped())
                .batchId(c.getBatchId())
                .status(c.getStatus())
                .createdBy(c.getCreatedBy())
                .createdAt(c.getCreatedAt())
                .build());
    }

    /**
     * Bulk submit simple leads (CSV import-friendly).
     * <p>
     * Loops through rows and delegates persistence to the existing single-row
     * {@link #submitLead(SubmitLeadRequestDTO)} method.
     * Returns per-row results so that one failing row does not block the others.
     */
    public BulkSubmitLeadResponseDTO bulkSubmitLead(BulkSubmitLeadRequestDTO request) {

        if (request == null || CollectionUtils.isEmpty(request.getRows())) {
            throw new VacademyException("rows cannot be empty");
        }

        String rootAudienceId = request.getAudienceId();

        List<BulkSubmitLeadResultItemDTO> results = new ArrayList<>(request.getRows().size());
        Set<String> dedupeKeys = new HashSet<>();

        int success = 0;
        int failed = 0;
        int skipped = 0;

        for (int i = 0; i < request.getRows().size(); i++) {
            SubmitLeadRequestDTO row = request.getRows().get(i);

            if (row == null) {
                failed++;
                results.add(BulkSubmitLeadResultItemDTO.builder()
                        .index(i)
                        .status("FAILED")
                        .message("Row is null")
                        .build());
                continue;
            }

            // Support payloads where audience_id exists at the root only.
            if (!StringUtils.hasText(row.getAudienceId())
                    && StringUtils.hasText(rootAudienceId)) {
                row.setAudienceId(rootAudienceId);
            }

            if (!StringUtils.hasText(row.getAudienceId())) {
                failed++;
                results.add(BulkSubmitLeadResultItemDTO.builder()
                        .index(i)
                        .status("FAILED")
                        .message("audience_id is required (root or row)")
                        .build());
                continue;
            }

            // Best-effort dedupe by email within the upload payload.
            String emailKey = "";
            if (row.getUserDTO() != null && StringUtils.hasText(row.getUserDTO().getEmail())) {
                emailKey = row.getUserDTO().getEmail().trim().toLowerCase();
            }

            String dedupeKey = row.getAudienceId().trim() + "|" + emailKey;

            if (StringUtils.hasText(emailKey) && dedupeKeys.contains(dedupeKey)) {
                skipped++;
                results.add(BulkSubmitLeadResultItemDTO.builder()
                        .index(i)
                        .status("SKIPPED")
                        .message("Duplicate email in upload payload")
                        .build());
                continue;
            }
            if (StringUtils.hasText(emailKey)) {
                dedupeKeys.add(dedupeKey);
            }

            try {
                String responseId = submitLead(row);

                // submitLead is stringly-typed: it returns either the new response ID or a
                // human-readable outcome message. Any message must be classified as
                // SKIPPED/FAILED — reporting one as SUCCESS puts prose in audienceResponseId
                // and tells the caller a lead was saved when none was.
                String outcome = responseId != null ? responseId.toLowerCase() : "";
                boolean alreadySubmitted = outcome.contains("already submitted");
                // Institute dedup (LEAD_SETTING.data.dedup) hard-rejects the row before
                // anything is persisted ("A lead with this phone number/email already
                // exists ..."), so it is a skip, not a success.
                boolean dedupRejected = outcome.contains("already exists");

                boolean isSuccess = responseId != null
                        && !responseId.startsWith("Error")
                        && !alreadySubmitted
                        && !dedupRejected;

                if (alreadySubmitted || dedupRejected) {
                    skipped++;
                    results.add(BulkSubmitLeadResultItemDTO.builder()
                            .index(i)
                            .status("SKIPPED")
                            .message(responseId)
                            .build());
                } else if (isSuccess) {
                    success++;
                    results.add(BulkSubmitLeadResultItemDTO.builder()
                            .index(i)
                            .status("SUCCESS")
                            .message("Lead submitted successfully")
                            .audienceResponseId(responseId)
                            .userId(row.getUserDTO() != null ? row.getUserDTO().getEmail() : null)
                            .build());
                } else {
                    failed++;
                    results.add(BulkSubmitLeadResultItemDTO.builder()
                            .index(i)
                            .status("FAILED")
                            .message(responseId != null ? responseId : "Unknown error")
                            .build());
                }
            } catch (VacademyException ve) {
                String msg = ve.getMessage();
                String normalizedMsg = msg != null ? msg.toLowerCase() : "";
                boolean alreadySubmitted = normalizedMsg.contains("already submitted");

                if (alreadySubmitted) {
                    skipped++;
                    results.add(BulkSubmitLeadResultItemDTO.builder()
                            .index(i)
                            .status("SKIPPED")
                            .message(msg)
                            .build());
                } else {
                    failed++;
                    results.add(BulkSubmitLeadResultItemDTO.builder()
                            .index(i)
                            .status("FAILED")
                            .message(msg)
                            .build());
                }
            } catch (Exception e) {
                failed++;
                results.add(BulkSubmitLeadResultItemDTO.builder()
                        .index(i)
                        .status("FAILED")
                        .message(e.getMessage())
                        .build());
            }
        }

        BulkSubmitLeadResponseDTO.SummaryDTO summary = BulkSubmitLeadResponseDTO.SummaryDTO.builder()
                .totalRequested(results.size())
                .successful(success)
                .failed(failed)
                .skipped(skipped)
                .build();

        return BulkSubmitLeadResponseDTO.builder()
                .summary(summary)
                .results(results)
                .build();
    }

    private String buildDefaultEnquiryEmailBody(String parentName, String studentName, String sessionName,
            String trackingId, String submissionTime, String username, String password, String portalUrl,
            String campaignName) {

        StringBuilder credentialSection = new StringBuilder();
        if (StringUtils.hasText(password)) {
            credentialSection.append(
                    "<div style='background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;'>")
                    .append("<h3 style='margin-top: 0; color: #2c3e50;'>Portal Login Credentials</h3>")
                    .append("<p style='margin: 5px 0;'><strong>Username:</strong> ").append(username).append("</p>")
                    .append("<p style='margin: 5px 0;'><strong>Password:</strong> ").append(password).append("</p>")
                    .append("</div>");
        }

        return "<html>" +
                "<body style='font-family: Arial, sans-serif; line-height: 1.6; color: #333;'>" +
                "<div style='max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 5px;'>"
                +
                "<h2 style='color: #2c3e50; text-align: center;'>Enquiry Received Successfully</h2>" +
                "<p>Dear " + parentName + ",</p>" +
                "<p>Thank you for your interest in <strong>" + campaignName + "</strong> (" + sessionName
                + ") for <strong>" + studentName + "</strong>.</p>" +
                "<p>We have received your enquiry details. Your tracking ID is:</p>" +
                "<h3 style='text-align: center; background-color: #e8f4f8; padding: 10px; border-radius: 5px;'>"
                + trackingId + "</h3>" +
                "<p>We have created an account for you on our learner portal where you can track the status of your enquiry.</p>"
                +
                credentialSection.toString() +
                "<div style='text-align: center; margin-top: 25px;'>" +
                "<a href='" + portalUrl
                + "' style='background-color: #3498db; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;'>Login to Portal</a>"
                +
                "</div>" +
                "<p style='margin-top: 30px; font-size: 12px; color: #777; text-align: center;'>Submitted on: "
                + submissionTime + "</p>" +
                "</div>" +
                "</body>" +
                "</html>";
    }

    /**
     * Generate a 5-character alphanumeric tracking ID
     */
    private String generateCustomTrackingId() {
        String chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        StringBuilder sb = new StringBuilder();
        Random random = new Random();
        for (int i = 0; i < 5; i++) {
            sb.append(chars.charAt(random.nextInt(chars.length())));
        }
        return sb.toString();
    }

    /**
     * Log a LEAD_SUBMITTED journey event after any audience response is first
     * persisted.
     * Called from all submit paths (v1, v2, with-enquiry, webhook) so the journey
     * timeline
     * always starts with this event regardless of how the lead was captured.
     * Best-effort — failures do not block the submission.
     */
    private void emitLeadAssigned(String instituteId, String audienceId, String enquiryId, String counsellorId) {
        if (instituteId == null || instituteId.isBlank())
            return;
        try {
            Map<String, Object> ctx = new java.util.HashMap<>();
            ctx.put("audience_id", audienceId != null ? audienceId : "");
            ctx.put("enquiry_id", enquiryId != null ? enquiryId : "");
            ctx.put("counsellor_id", counsellorId != null ? counsellorId : "");
            workflowTriggerService.handleTriggerEvents(
                    WorkflowTriggerEvent.LEAD_ASSIGNED_TO_COUNSELOR.name(),
                    enquiryId, instituteId, ctx);
        } catch (Exception e) {
            logger.warn("[LeadTrigger] Failed to emit LEAD_ASSIGNED_TO_COUNSELOR for enquiry={}: {}",
                    enquiryId, e.getMessage());
        }
    }

    private void logLeadSubmitted(AudienceResponse savedResponse) {
        try {
            Map<String, Object> metadata = new LinkedHashMap<>();
            metadata.put("source_type", savedResponse.getSourceType() != null ? savedResponse.getSourceType() : "");
            if (savedResponse.getAudienceId() != null)
                metadata.put("audience_id", savedResponse.getAudienceId());
            if (savedResponse.getSourceId() != null)
                metadata.put("source_id", savedResponse.getSourceId());

            timelineEventService.logJourneyEvent(
                    "AUDIENCE_RESPONSE", savedResponse.getId(),
                    LeadJourneyActionType.LEAD_SUBMITTED,
                    "SYSTEM", null, "System",
                    "Lead submitted",
                    "Lead captured from "
                            + (savedResponse.getSourceType() != null ? savedResponse.getSourceType() : "UNKNOWN"),
                    metadata,
                    savedResponse.getUserId() != null ? savedResponse.getUserId() : savedResponse.getStudentUserId());
        } catch (Exception e) {
            logger.warn("Failed to log LEAD_SUBMITTED journey event for response {}: {}",
                    savedResponse.getId(), e.getMessage(), e);
        }

        // Live activity feed. Hooked here rather than inside logJourneyEvent above: that
        // method is REQUIRES_NEW, so a recorder running within it sits in its own
        // transaction and cannot see this still-uncommitted audience_response row. The
        // first version did exactly that and silently dropped every lead. Passing the
        // saved entity removes the read altogether.
        liveActivityLeadRecorder.recordLeadSubmitted(savedResponse);
    }
}
