package vacademy.io.admin_core_service.features.audience.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.util.CollectionUtils;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.audience.dto.UserLeadProfileDTO;
import vacademy.io.admin_core_service.features.audience.dto.combined.*;
import vacademy.io.admin_core_service.features.audience.enums.CustomFieldValueSourceType;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.common.dto.CustomFieldValueMap;
import vacademy.io.admin_core_service.features.common.entity.CustomFieldValues;
import vacademy.io.admin_core_service.features.common.entity.CustomFields;
import vacademy.io.admin_core_service.features.common.entity.InstituteCustomField;
import vacademy.io.admin_core_service.features.common.enums.StatusEnum;
import vacademy.io.admin_core_service.features.common.repository.CustomFieldRepository;
import vacademy.io.admin_core_service.features.common.repository.CustomFieldValuesRepository;
import vacademy.io.admin_core_service.features.common.repository.InstituteCustomFieldRepository;
import vacademy.io.admin_core_service.features.institute_learner.dto.projection.StudentListV2Projection;
import vacademy.io.admin_core_service.features.institute_learner.repository.InstituteStudentRepository;
import vacademy.io.common.auth.dto.UserDTO;

import java.util.*;
import java.util.stream.Collectors;


@Service
public class DistinctUserAudienceService {

    /**
     * The search split into %token% patterns for LIKE ALL, pipe-separated.
     *
     * Names here are routinely stored jammed together ("DrBhagyshriRajput") while people
     * type them spaced and in any order, and half a contact's identity can sit on the name
     * and half on the email ("Dr Manish" / manishbachhav27.mb@...). A single substring match
     * found neither. Requiring every token somewhere in the name+email text finds both.
     *
     * Pipe is the separator because STRING_TO_ARRAY needs one and a pipe in a typed name is
     * far-fetched; any that appear are dropped rather than splitting the token.
     */
    private static String searchTokensCsv(String nameSearch) {
        if (nameSearch == null || nameSearch.isBlank()) return null;
        String[] parts = nameSearch.toLowerCase().replace('|', ' ').trim().split("\\s+");
        List<String> tokens = new ArrayList<>();
        for (String part : parts) {
            if (!part.isBlank()) tokens.add("%" + part + "%");
        }
        return tokens.isEmpty() ? null : String.join("|", tokens);
    }

    private static final Logger logger = LoggerFactory.getLogger(DistinctUserAudienceService.class);

    @Autowired
    private InstituteStudentRepository instituteStudentRepository;

    @Autowired
    private AudienceRepository audienceRepository;

    @Autowired
    private AudienceResponseRepository audienceResponseRepository;

    @Autowired
    private CustomFieldValuesRepository customFieldValuesRepository;

    @Autowired
    private CustomFieldRepository customFieldRepository;

    @Autowired
    private InstituteCustomFieldRepository instituteCustomFieldRepository;

    @Autowired
    private AuthService authService;

    @Autowired
    private UserLeadProfileService userLeadProfileService;

    @Autowired
    private vacademy.io.admin_core_service.features.common.service.CustomFieldListFilterResolver customFieldListFilterResolver;

    @Autowired
    private vacademy.io.admin_core_service.features.utm_attribution.service.UtmListFilterResolver utmListFilterResolver;

    @Autowired
    private ObjectMapper objectMapper;

    public CombinedUserAudienceResponseDTO getCombinedUsersWithCustomFields(CombinedUserAudienceRequestDTO request) {
        logger.info("Getting combined users for institute: {}", request.getInstituteId());

        boolean includeInstituteUsers = request.getIncludeInstituteUsers() == null || request.getIncludeInstituteUsers();
        boolean includeAudienceRespondents = request.getIncludeAudienceRespondents() == null || request.getIncludeAudienceRespondents();

        int page = request.getPage() != null ? request.getPage() : 0;
        int size = request.getSize() != null ? request.getSize() : 20;

        // ── Resolve audience IDs ──────────────────────────────────────────────
        List<String> audienceIds = resolveAudienceIds(request, includeAudienceRespondents);

        // ── Extract name search ───────────────────────────────────────────────
        String nameSearch = (request.getUserFilter() != null
                && StringUtils.hasText(request.getUserFilter().getNameSearch()))
                ? request.getUserFilter().getNameSearch() : null;

        // ── Extract gender filter (applies to both sources via the student table) ─
        List<String> genders = (request.getUserFilter() != null
                && !CollectionUtils.isEmpty(request.getUserFilter().getGenders()))
                ? request.getUserFilter().getGenders() : null;

        if (!includeInstituteUsers && !includeAudienceRespondents) {
            return emptyResponse(request, audienceIds);
        }

        // Lead/enquiry contacts are bare auth Users with no institute role and no
        // student row, so a name that lives only on the auth User cannot be matched
        // in SQL. Resolve it to user ids here and let the query match on them, the
        // same way AudienceService.getLeads already does for the leads list.
        //
        // instituteId is deliberately NOT passed: searchUserIdsByQuery scopes to users
        // holding a user_role for the institute, which no lead has. Broadening is safe
        // because the ids are only ever intersected with ar.user_id, and that branch is
        // already institute-scoped by its JOIN on audience.
        //
        // Placed AFTER the early return and gated on includeAudienceRespondents: the ids
        // are read by the audience half of the UNION only, so a Students-only request or
        // a request with both sources off must not pay for the round trip.
        String searchUserIdsCsv = null;
        if (nameSearch != null && includeAudienceRespondents) {
            try {
                List<String> ids = authService.searchUserIdsByQuery(nameSearch, null);
                if (ids != null && !ids.isEmpty()) {
                    searchUserIdsCsv = String.join(",", ids);
                }
            } catch (Exception e) {
                logger.warn("auth-service user search failed for query='{}': {}", nameSearch, e.getMessage());
            }
        }

        // ── Step 1: Paginated user IDs from DB ────────────────────────────────
        // The UNION ALL query handles both institute users and audience respondents.
        // When a source is excluded, pass the __EXCLUDE__ sentinel so its part
        // matches nothing (a null/empty list is interpreted as "no filter" by the
        // query and would otherwise include the whole source).
        List<String> effectiveAudienceIds = includeAudienceRespondents ? audienceIds : List.of("__EXCLUDE__");
        List<String> effectiveStatuses = includeInstituteUsers ? request.getStatuses() : List.of("__EXCLUDE__");
        List<String> effectivePackageSessionIds = includeInstituteUsers ? request.getPackageSessionIds() : List.of("__EXCLUDE__");

        // Pre-resolve custom-field filters into matching user IDs (either-match
        // across USER and AUDIENCE_RESPONSE answers) — one indexed lookup per
        // field instead of a correlated subquery in the paging query. Positive
        // operators produce a matched set (null = no filter; empty = nothing
        // matches → empty page); IS_EMPTY entries produce an exclusion set.
        vacademy.io.admin_core_service.features.common.service.CustomFieldListFilterResolver.Resolution cfResolution =
                customFieldListFilterResolver.resolve(
                        request.getCustomFieldFilters(),
                        vacademy.io.admin_core_service.features.common.service.CustomFieldListFilterResolver.Surface.CONTACT);
        if (cfResolution.shortCircuitsToEmpty()) {
            return emptyResponse(request, audienceIds);
        }
        // Campaign (UTM) filter: resolve touches → user ids (either-match across
        // the learner row and the person's leads) and AND with the custom-field
        // set, so the paging query stays unchanged.
        if (vacademy.io.admin_core_service.features.utm_attribution.service.UtmListFilterResolver
                .hasFilter(request.getUtmFilters())) {
            cfResolution = cfResolution.and(utmListFilterResolver.resolve(
                    request.getUtmFilters(),
                    vacademy.io.admin_core_service.features.common.service.CustomFieldListFilterResolver.Surface.CONTACT,
                    request.getInstituteId()));
            if (cfResolution.shortCircuitsToEmpty()) {
                return emptyResponse(request, audienceIds);
            }
        }

        Page<String> userPage = instituteStudentRepository.findPagedCombinedUserIds(
                request.getInstituteId(),
                effectiveStatuses,
                effectivePackageSessionIds,
                includeInstituteUsers ? request.getPaymentStatuses() : null,
                includeInstituteUsers ? request.getSubOrgUserTypes() : null,
                nameSearch,
                searchTokensCsv(nameSearch),
                genders,
                effectiveAudienceIds,
                cfResolution.matchedIdsCsv(),
                cfResolution.excludedIdsCsv(),
                searchUserIdsCsv,
                (request.getSortCustomFieldId() != null && !request.getSortCustomFieldId().isBlank())
                        ? request.getSortCustomFieldId() : null,
                // SQL compares :cfSortDirection = 'ASC' literally — normalize
                // case so a lowercase "asc" doesn't silently fall back to DESC.
                request.getSortDirection() == null ? null
                        : request.getSortDirection().trim().toUpperCase(java.util.Locale.ENGLISH),
                PageRequest.of(page, size));

        List<String> pagedUserIds = userPage.getContent();
        long totalCount = userPage.getTotalElements();

        logger.info("DB returned {} user IDs for page {}, total {}", pagedUserIds.size(), page, totalCount);

        if (pagedUserIds.isEmpty()) {
            return emptyResponse(request, audienceIds);
        }

        // ── Step 2: Auth service call for ONLY these user IDs ────────────────
        List<UserDTO> userDTOs = authService.getUsersFromAuthServiceByUserIds(pagedUserIds);
        Map<String, UserDTO> userIdToUserDTO = userDTOs.stream()
                .filter(Objects::nonNull)
                .collect(Collectors.toMap(UserDTO::getId, u -> u, (a, b) -> a));

        // ── Step 3: V2 enrollment enrichment for ONLY these user IDs ─────────
        List<StudentListV2Projection> v2List = instituteStudentRepository.getStudentV2DataForUserIds(
                pagedUserIds,
                List.of(request.getInstituteId()),
                List.of(StatusEnum.ACTIVE.name()));

        // Per user: prefer ACTIVE enrollment, then first seen
        Map<String, StudentListV2Projection> v2DataByUserId = new HashMap<>();
        for (StudentListV2Projection p : v2List) {
            if (p.getUserId() == null) continue;
            StudentListV2Projection existing = v2DataByUserId.get(p.getUserId());
            if (existing == null) {
                v2DataByUserId.put(p.getUserId(), p);
            } else if ("ACTIVE".equalsIgnoreCase(p.getStatus()) && !"ACTIVE".equalsIgnoreCase(existing.getStatus())) {
                v2DataByUserId.put(p.getUserId(), p);
            }
        }

        // ── Step 4: Custom fields for ONLY these user IDs ─────────────────────
        Map<String, List<CustomFieldDTO>> userIdToCustomFields = fetchCustomFieldsForUsers(
                request.getInstituteId(), pagedUserIds);

        // ── Step 5: Lead profiles for ONLY these user IDs ─────────────────────
        Map<String, UserLeadProfileDTO> leadProfilesByUserId = userLeadProfileService
                .getProfilesForUsers(pagedUserIds, request.getInstituteId());

        // ── Step 6: Audience membership for these user IDs ────────────────────
        Set<String> instituteUserIdSet = v2DataByUserId.keySet();
        Set<String> audienceUserIdSet = new HashSet<>();
        if (includeAudienceRespondents && !CollectionUtils.isEmpty(audienceIds)) {
            audienceUserIdSet.addAll(
                    audienceResponseRepository.findDistinctUserIdsByAudienceIdsAndUserIds(audienceIds, pagedUserIds));
        }

        // ── Step 7: Build DTOs in page order ─────────────────────────────────
        List<UserWithCustomFieldsDTO> users = new ArrayList<>();
        for (String userId : pagedUserIds) {
            UserDTO userDTO = userIdToUserDTO.get(userId);
            if (userDTO == null) continue;

            UserWithCustomFieldsDTO.UserWithCustomFieldsDTOBuilder builder = UserWithCustomFieldsDTO.builder()
                    .user(userDTO)
                    .isInstituteUser(instituteUserIdSet.contains(userId))
                    .isAudienceRespondent(audienceUserIdSet.contains(userId))
                    .customFields(userIdToCustomFields.getOrDefault(userId, new ArrayList<>()));

            UserLeadProfileDTO leadProfile = leadProfilesByUserId.get(userId);
            if (leadProfile != null) {
                builder.leadScore(leadProfile.getBestScore())
                       .leadTier(leadProfile.getLeadTier())
                       .leadConversionStatus(leadProfile.getConversionStatus())
                       .assignedCounselorId(leadProfile.getAssignedCounselorId())
                       .assignedCounselorName(leadProfile.getAssignedCounselorName());
            }

            StudentListV2Projection v2 = v2DataByUserId.get(userId);
            if (v2 != null) {
                builder.status(v2.getStatus())
                       .faceFileId(v2.getFaceFileId())
                       .subOrgName(v2.getSubOrgName())
                       .subOrgId(v2.getSubOrgId())
                       .commaSeparatedOrgRoles(v2.getCommaSeparatedOrgRoles())
                       .packageSessionId(v2.getPackageSessionId())
                       .instituteEnrollmentNumber(v2.getInstituteEnrollmentNumber())
                       .paymentStatus(v2.getPaymentStatus())
                       .instituteId(v2.getInstituteId())
                       .fathersName(v2.getFathersName())
                       .mothersName(v2.getMothersName())
                       .parentsMobileNumber(v2.getParentsMobileNumber())
                       .parentsEmail(v2.getParentsEmail())
                       .parentsToMotherMobileNumber(v2.getParentsToMotherMobileNumber())
                       .parentsToMotherEmail(v2.getParentsToMotherEmail())
                       .linkedInstituteName(v2.getLinkedInstituteName())
                       .customFieldsMap(parseCustomFieldsJson(v2.getCustomFieldsJson()));
            }

            users.add(builder.build());
        }

        int totalPages = (int) Math.ceil((double) totalCount / size);
        logger.info("Returning {} users (page {} of {})", users.size(), page, totalPages);

        return CombinedUserAudienceResponseDTO.builder()
                .users(users)
                .totalElements(totalCount)
                .totalPages(totalPages)
                .currentPage(page)
                .pageSize(size)
                .isLast(page >= totalPages - 1)
                .filteredAudienceIds(audienceIds)
                .build();
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private List<String> resolveAudienceIds(CombinedUserAudienceRequestDTO request, boolean includeAudienceRespondents) {
        if (!includeAudienceRespondents) return new ArrayList<>();
        CampaignFilterDTO campaignFilter = request.getCampaignFilter();
        if (campaignFilter != null && !CollectionUtils.isEmpty(campaignFilter.getAudienceIds())) {
            return campaignFilter.getAudienceIds();
        }
        return audienceRepository.findAudienceIdsWithFilters(
                request.getInstituteId(),
                campaignFilter != null ? campaignFilter.getCampaignName() : null,
                campaignFilter != null ? campaignFilter.getCampaignStatus() : null,
                campaignFilter != null ? campaignFilter.getCampaignType() : null,
                campaignFilter != null ? campaignFilter.getStartDateFromLocal() : null,
                campaignFilter != null && campaignFilter.getStartDateFromLocal() != null,
                campaignFilter != null ? campaignFilter.getStartDateToLocal() : null,
                campaignFilter != null && campaignFilter.getStartDateToLocal() != null);
    }

    private CombinedUserAudienceResponseDTO emptyResponse(CombinedUserAudienceRequestDTO request, List<String> audienceIds) {
        return CombinedUserAudienceResponseDTO.builder()
                .users(new ArrayList<>())
                .totalElements(0L)
                .totalPages(0)
                .currentPage(request.getPage() != null ? request.getPage() : 0)
                .pageSize(request.getSize() != null ? request.getSize() : 20)
                .isLast(true)
                .filteredAudienceIds(audienceIds)
                .build();
    }

    private Map<String, List<CustomFieldDTO>> fetchCustomFieldsForUsers(String instituteId, List<String> userIds) {
        if (CollectionUtils.isEmpty(userIds)) return new HashMap<>();

        List<Object[]> instituteCustomFieldsData = instituteCustomFieldRepository
                .findAllActiveCustomFieldsWithDetailsByInstituteId(instituteId);

        Map<String, CustomFieldDTO> uniqueCustomFieldsMap = new LinkedHashMap<>();
        for (Object[] data : instituteCustomFieldsData) {
            InstituteCustomField icf = (InstituteCustomField) data[0];
            CustomFields cf = (CustomFields) data[1];
            if (!uniqueCustomFieldsMap.containsKey(cf.getId())) {
                uniqueCustomFieldsMap.put(cf.getId(), CustomFieldDTO.builder()
                        .customFieldId(cf.getId())
                        .fieldKey(cf.getFieldKey())
                        .fieldName(cf.getFieldName())
                        .fieldType(cf.getFieldType())
                        .value(null)
                        .build());
            }
        }
        List<CustomFieldDTO> customFieldTemplate = new ArrayList<>(uniqueCustomFieldsMap.values());

        List<CustomFieldValues> userCustomFieldValues = customFieldValuesRepository
                .findBySourceTypeAndSourceIdIn("USER", userIds);

        List<String> responseIds = audienceResponseRepository.findResponseIdsByUserIds(userIds);
        List<CustomFieldValues> audienceCustomFieldValues = new ArrayList<>();
        if (!CollectionUtils.isEmpty(responseIds)) {
            audienceCustomFieldValues = customFieldValuesRepository
                    .findBySourceTypeAndSourceIdIn("AUDIENCE_RESPONSE", responseIds);
        }

        Map<String, String> responseIdToUserId = new HashMap<>();
        if (!CollectionUtils.isEmpty(responseIds)) {
            audienceResponseRepository.findAllById(responseIds).forEach(ar -> {
                if (ar.getUserId() != null) responseIdToUserId.put(ar.getId(), ar.getUserId());
            });
        }

        Map<String, Map<String, String>> userCustomFieldValueMap = new HashMap<>();
        for (CustomFieldValues cfv : userCustomFieldValues) {
            if (CustomFieldValueSourceType.USER.name().equals(cfv.getSourceType())) {
                userCustomFieldValueMap
                        .computeIfAbsent(cfv.getSourceId(), k -> new HashMap<>())
                        .put(cfv.getCustomFieldId(), cfv.getValue());
            }
        }
        for (CustomFieldValues cfv : audienceCustomFieldValues) {
            if (CustomFieldValueSourceType.AUDIENCE_RESPONSE.name().equals(cfv.getSourceType())) {
                String userId = responseIdToUserId.get(cfv.getSourceId());
                if (userId != null) {
                    userCustomFieldValueMap
                            .computeIfAbsent(userId, k -> new HashMap<>())
                            .put(cfv.getCustomFieldId(), cfv.getValue());
                }
            }
        }

        Map<String, List<CustomFieldDTO>> result = new HashMap<>();
        for (String userId : userIds) {
            Map<String, String> userValues = userCustomFieldValueMap.getOrDefault(userId, new HashMap<>());
            List<CustomFieldDTO> fields = customFieldTemplate.stream()
                    .map(t -> CustomFieldDTO.builder()
                            .customFieldId(t.getCustomFieldId())
                            .fieldKey(t.getFieldKey())
                            .fieldName(t.getFieldName())
                            .fieldType(t.getFieldType())
                            .value(userValues.get(t.getCustomFieldId()))
                            .build())
                    .collect(Collectors.toList());
            result.put(userId, fields);
        }
        return result;
    }

    private Map<String, String> parseCustomFieldsJson(String json) {
        if (json == null || json.equals("[]")) return new HashMap<>();
        try {
            List<CustomFieldValueMap> list = objectMapper.readValue(json, new TypeReference<List<CustomFieldValueMap>>() {});
            // Skip null values: see StudentListManager.parseCustomFields for the
            // payload-bloat explanation (~250x bigger response without this guard).
            Map<String, String> map = new HashMap<>();
            for (CustomFieldValueMap cf : list) {
                if (cf.getValue() != null) map.put(cf.getCustomFieldId(), cf.getValue());
            }
            return map;
        } catch (JsonProcessingException e) {
            return new HashMap<>();
        }
    }
}
