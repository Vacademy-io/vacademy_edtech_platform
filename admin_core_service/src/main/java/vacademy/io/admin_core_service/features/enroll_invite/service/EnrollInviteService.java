package vacademy.io.admin_core_service.features.enroll_invite.service;

import vacademy.io.admin_core_service.features.shortlink.service.ShortUrlManagementService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.CollectionUtils;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.common.dto.InstituteCustomFieldDTO;
import vacademy.io.admin_core_service.features.common.enums.CustomFieldTypeEnum;
import vacademy.io.admin_core_service.features.common.enums.StatusEnum;
import vacademy.io.admin_core_service.features.common.service.InstituteCustomFiledService;
import vacademy.io.admin_core_service.features.enroll_invite.dto.*;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.entity.PackageSessionEnrollInvitePaymentOptionPlanToReferralOption;
import vacademy.io.admin_core_service.features.enroll_invite.entity.PackageSessionLearnerInvitationToPaymentOption;
import vacademy.io.admin_core_service.features.enroll_invite.enums.EnrollInviteTag;
import vacademy.io.admin_core_service.features.enroll_invite.repository.EnrollInviteRepository;
import vacademy.io.admin_core_service.features.enroll_invite.util.EnrollInviteAvailabilityUtil;
import vacademy.io.admin_core_service.features.packages.enums.PackageSessionStatusEnum;
import vacademy.io.admin_core_service.features.packages.service.PackageSessionService;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentOptionDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentPlanDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.ReferralOptionDTO;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.entity.ReferralOption;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentOptionService;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentPlanService;
import vacademy.io.admin_core_service.features.user_subscription.service.ReferralOptionService;
import vacademy.io.admin_core_service.features.faculty.repository.FacultySubjectPackageSessionMappingRepository;
import vacademy.io.admin_core_service.features.workflow.enums.WorkflowTriggerEvent;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.core.standard_classes.ListService;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.session.PackageSession;

import java.security.SecureRandom;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class EnrollInviteService {

    private static final Logger logger = LoggerFactory.getLogger(EnrollInviteService.class);

    @Autowired
    private EnrollInviteRepository repository;
    @Autowired
    private PaymentOptionService paymentOptionService;
    @Autowired
    private PackageSessionEnrollInviteToPaymentOptionService packageSessionEnrollInviteToPaymentOptionService;
    @Autowired
    private PackageSessionService packageSessionService;
    @Autowired
    private InstituteCustomFiledService instituteCustomFiledService;
    @Autowired
    private ReferralOptionService referralOptionService;
    @Autowired
    private PaymentPlanService paymentPlanService;
    @Autowired
    private PackageSessionEnrollInvitePaymentOptionPlanToReferralOptionService packageSessionEnrollInvitePaymentOptionPlanToReferralOptionService;
    @Autowired
    private vacademy.io.admin_core_service.features.shortlink.service.ShortLinkIntegrationService shortLinkIntegrationService;

    @Autowired
    private ShortUrlManagementService shortUrlManagementService;

    @Autowired
    private FacultySubjectPackageSessionMappingRepository facultyMappingRepository;

    @Autowired
    private vacademy.io.admin_core_service.features.institute.repository.InstituteRepository instituteRepository;

    @Autowired
    private vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService instituteSettingService;

    @Autowired
    private WorkflowTriggerService workflowTriggerService;

    @Autowired
    private AuthService authService;

    @org.springframework.beans.factory.annotation.Value("${default.learner.portal.url:https://learner.vacademy.io}")
    private String learnerBaseUrl;

    @org.springframework.beans.factory.annotation.Value("${default.learner.portal.enroll_invite_path:/learner-invitation-response}")
    private String learnerInvitePath;

    private static final String SHORT_LINK_SOURCE_ENROLL_INVITE = "ENROLL_INVITE";

    @Transactional
    public String createEnrollInvite(EnrollInviteDTO enrollInviteDTO) {
        return createEnrollInvite(enrollInviteDTO, null);
    }

    /**
     * @param actor the admin performing the call, or null for internal callers
     *              (sub-org provisioning, course copy) where no JWT is on hand —
     *              the invite is then recorded with an unknown creator.
     */
    @Transactional
    public String createEnrollInvite(EnrollInviteDTO enrollInviteDTO, CustomUserDetails actor) {
        if (enrollInviteDTO == null) {
            throw new VacademyException("EnrollInvite payload cannot be null.");
        }
        enrollInviteDTO.setInviteCode(getInviteCode());

        List<PackageSessionToPaymentOptionDTO> mappingDTOs = enrollInviteDTO.getPackageSessionToPaymentOptions();
        if (CollectionUtils.isEmpty(mappingDTOs)) {
            throw new VacademyException("Package session to payment options cannot be empty.");
        }

        EnrollInvite enrollInviteToSave = new EnrollInvite(enrollInviteDTO);
        String actorId = actor != null ? actor.getUserId() : null;
        enrollInviteToSave.setCreatedByUserId(actorId);
        enrollInviteToSave.setUpdatedByUserId(actorId);
        EnrollInvite initialSavedEnrollInvite = repository.save(enrollInviteToSave);

        // Generate Short URL using centralized service
        String destinationUrl = learnerBaseUrl + learnerInvitePath + "?instituteId="
                + initialSavedEnrollInvite.getInstituteId() + "&inviteCode="
                + initialSavedEnrollInvite.getInviteCode();
        String shortUrl = shortUrlManagementService.createShortUrl(
                destinationUrl,
                SHORT_LINK_SOURCE_ENROLL_INVITE,
                initialSavedEnrollInvite.getId(),
                initialSavedEnrollInvite.getInstituteId());
        if (shortUrl != null) {
            initialSavedEnrollInvite.setShortUrl(shortUrl);
            initialSavedEnrollInvite = repository.save(initialSavedEnrollInvite);
        }

        final EnrollInvite savedEnrollInvite = initialSavedEnrollInvite;

        // Custom fields revamp: the frontend now sends the explicit list of fields
        // (defaults the admin pre-selected + any ad-hoc fields they added) on every
        // create / update. The previous "auto-copy all defaults to new invite" call
        // is intentionally removed — defaults that the admin un-checks must NOT
        // come back. See vacademy_platform/docs/CUSTOM_FIELDS.md.
        saveInstituteCustomFields(savedEnrollInvite.getId(), enrollInviteDTO.getInstituteId(),
                enrollInviteDTO.getInstituteCustomFields());

        List<PackageSessionLearnerInvitationToPaymentOption> mappingEntities = mappingDTOs.stream()
                .filter(Objects::nonNull)
                .map(dto -> {
                    validateMappingDTO(dto);
                    PaymentOption paymentOption = paymentOptionService.findById(dto.getPaymentOption().getId());
                    PackageSession packageSession = packageSessionService.findById(dto.getPackageSessionId());

                    return new PackageSessionLearnerInvitationToPaymentOption(
                            savedEnrollInvite, packageSession, paymentOption, StatusEnum.ACTIVE.name());
                })
                .collect(Collectors.toList());

        if (mappingEntities.isEmpty()) {
            throw new VacademyException("No valid packageSession-paymentOption mappings were provided.");
        }
        packageSessionEnrollInviteToPaymentOptionService
                .createPackageSessionLearnerInvitationToPaymentOptions(mappingEntities);
        validateSaveOrUpdate(mappingEntities, mappingDTOs);

        // Trigger INVITE_CREATE workflow
        try {
            Map<String, Object> contextData = new HashMap<>();
            contextData.put("invite", savedEnrollInvite);
            workflowTriggerService.handleTriggerEvents(
                    WorkflowTriggerEvent.INVITE_CREATE.name(),
                    savedEnrollInvite.getId(),
                    savedEnrollInvite.getInstituteId(),
                    contextData);
        } catch (Exception e) {
            logger.warn("Failed to trigger INVITE_CREATE workflow", e);
        }

        return savedEnrollInvite.getId();
    }

    @Transactional
    public String updateEnrollInvite(EnrollInviteDTO enrollInviteDTO) {
        return updateEnrollInvite(enrollInviteDTO, (CustomUserDetails) null);
    }

    /** @param actor the admin editing, or null for internal callers (recorded as unknown). */
    @Transactional
    public String updateEnrollInvite(EnrollInviteDTO enrollInviteDTO, CustomUserDetails actor) {
        if (enrollInviteDTO == null) {
            throw new VacademyException("EnrollInvite payload cannot be null.");
        }
        List<PackageSessionToPaymentOptionDTO> mappingDTOs = enrollInviteDTO.getPackageSessionToPaymentOptions();
        if (CollectionUtils.isEmpty(mappingDTOs)) {
            throw new VacademyException("Package session to payment options cannot be empty.");
        }

        EnrollInvite enrollInviteToSave = findById(enrollInviteDTO.getId());
        updateEnrollInvite(enrollInviteDTO, enrollInviteToSave);
        if (actor != null) {
            enrollInviteToSave.setUpdatedByUserId(actor.getUserId());
        }
        final EnrollInvite savedEnrollInvite = repository.save(enrollInviteToSave);

        saveInstituteCustomFields(savedEnrollInvite.getId(), enrollInviteDTO.getInstituteId(),
                enrollInviteDTO.getInstituteCustomFields());

        // Note: copyDefaultCustomFieldsToEnrollInvite is NOT called on update
        // to allow users to control which custom fields are active via the payload

        List<PackageSessionLearnerInvitationToPaymentOption> mappingEntities = mappingDTOs.stream()
                .filter(Objects::nonNull)
                .map(dto -> {
                    if (StringUtils.hasText(dto.getId())) {
                        return packageSessionEnrollInviteToPaymentOptionService.updateStatus(dto.getId(),
                                dto.getStatus());
                    } else {
                        validateMappingDTO(dto);
                        PaymentOption paymentOption = paymentOptionService.findById(dto.getPaymentOption().getId());
                        PackageSession packageSession = packageSessionService.findById(dto.getPackageSessionId());

                        return new PackageSessionLearnerInvitationToPaymentOption(
                                savedEnrollInvite, packageSession, paymentOption, StatusEnum.ACTIVE.name());
                    }
                })
                .collect(Collectors.toList());

        if (mappingEntities.isEmpty()) {
            throw new VacademyException("No valid packageSession-paymentOption mappings were provided.");
        }

        // Logic to soft-delete existing mappings that are not present in the incoming
        // DTO list
        List<PackageSessionLearnerInvitationToPaymentOption> existingMappings = packageSessionEnrollInviteToPaymentOptionService
                .findByInvite(enrollInviteToSave);
        Set<String> incomingIds = mappingDTOs.stream()
                .map(PackageSessionToPaymentOptionDTO::getId)
                .filter(StringUtils::hasText)
                .collect(Collectors.toSet());

        List<String> idsToDelete = existingMappings.stream()
                .map(PackageSessionLearnerInvitationToPaymentOption::getId)
                .filter(id -> !incomingIds.contains(id))
                .collect(Collectors.toList());

        if (!idsToDelete.isEmpty()) {
            packageSessionEnrollInviteToPaymentOptionService.updateStatusByIds(idsToDelete, StatusEnum.DELETED.name());
            packageSessionEnrollInvitePaymentOptionPlanToReferralOptionService
                    .updateStatusByPackageSessionLearnerInvitationToPaymentOptionIds(idsToDelete,
                            StatusEnum.DELETED.name());
        }

        packageSessionEnrollInviteToPaymentOptionService
                .createPackageSessionLearnerInvitationToPaymentOptions(mappingEntities);
        validateSaveOrUpdate(mappingEntities, mappingDTOs);

        // Update Short URL using centralized service
        String newDestinationUrl = learnerBaseUrl + learnerInvitePath + "?instituteId="
                + savedEnrollInvite.getInstituteId() + "&inviteCode="
                + savedEnrollInvite.getInviteCode();
        shortUrlManagementService.updateShortUrl(
                newDestinationUrl,
                SHORT_LINK_SOURCE_ENROLL_INVITE,
                savedEnrollInvite.getId(),
                savedEnrollInvite.getShortUrl());

        return savedEnrollInvite.getId();
    }
    // Create and other existing methods...

    private void updateEnrollInvite(EnrollInviteDTO enrollInviteDTO, EnrollInvite enrollInvite) {
        enrollInvite.setCurrency(enrollInviteDTO.getCurrency());
        enrollInvite.setWebPageMetaDataJson(enrollInviteDTO.getWebPageMetaDataJson());
        enrollInvite.setVendor(enrollInviteDTO.getVendor());
        enrollInvite.setEndDate(enrollInviteDTO.getEndDate());
        enrollInvite.setStartDate(enrollInviteDTO.getStartDate());
        enrollInvite.setLearnerAccessDays(enrollInviteDTO.getLearnerAccessDays());
        enrollInvite.setStatus(enrollInviteDTO.getStatus());
        enrollInvite.setName(enrollInviteDTO.getName());
        enrollInvite.setVendorId(enrollInviteDTO.getVendorId());
        enrollInvite.setIsBundled(enrollInviteDTO.getIsBundled());
        enrollInvite.setSettingJson(enrollInviteDTO.getSettingJson());
    }

    /**
     * Column the invite list falls back to when the caller sends no sort. Newest
     * first: an admin who just created a link expects to see it at the top, and
     * without any ORDER BY Postgres returned the page in whatever heap order it
     * liked, so the list reshuffled after every edit.
     */
    private static final Sort DEFAULT_INVITE_SORT = Sort.by(Sort.Direction.DESC, "created_at");

    private static boolean hasAdminRole(CustomUserDetails user) {
        return user.getAuthorities() != null && user.getAuthorities().stream()
                .map(a -> a == null ? null : a.getAuthority())
                .anyMatch("ADMIN"::equalsIgnoreCase);
    }

    public Page<EnrollInviteListItemDTO> getEnrollInvitesByInstituteIdAndFilters(String instituteId,
            EnrollInviteFilterDTO enrollInviteFilterDTO, int pageNo, int pageSize, CustomUserDetails user) {
        Sort sortColumns = ListService.createSortObject(enrollInviteFilterDTO.getSortColumns());
        if (sortColumns.isUnsorted()) {
            sortColumns = DEFAULT_INVITE_SORT;
        }
        Pageable pageable = PageRequest.of(pageNo, pageSize, sortColumns);
        Page<EnrollInviteWithSessionsProjection> pageResult;

        // Filter by faculty mapping: if user has EnrollInvite entries, scope to those
        // only.
        // No entries = full access.
        // ADMIN is never scoped: an institute admin who is also a sub-org member
        // holds ENROLL_INVITE rows for that sub-org, and scoping on them hid every
        // other invite in the institute.
        List<String> allowedEnrollInviteIds = null;
        if (user != null && !hasAdminRole(user)) {
            List<String> accessIds = facultyMappingRepository
                    .findEnrollInviteAccessIdsByUserIdAndInstituteId(
                            user.getUserId(), instituteId, List.of("ACTIVE"));
            if (!accessIds.isEmpty()) {
                allowedEnrollInviteIds = accessIds;
            }
        }

        boolean hasSearch = StringUtils.hasText(enrollInviteFilterDTO.getSearchName());
        boolean hasScope = !CollectionUtils.isEmpty(enrollInviteFilterDTO.getPackageSessionIds())
                || !CollectionUtils.isEmpty(enrollInviteFilterDTO.getPaymentOptionIds())
                || !CollectionUtils.isEmpty(enrollInviteFilterDTO.getTags());

        if (hasSearch && !hasScope) {
            // Institute-wide search (Invite page with no batch filter) keeps its
            // dedicated query; it differs from the filtered one in how it treats
            // invites without a live package session, and that behaviour is relied on.
            pageResult = repository.getEnrollInvitesByInstituteIdAndSearchName(instituteId,
                    enrollInviteFilterDTO.getSearchName(),
                    List.of(StatusEnum.ACTIVE.name()),
                    List.of(PackageSessionStatusEnum.ACTIVE.name(), PackageSessionStatusEnum.HIDDEN.name()),
                    pageable);
        } else {
            // Scoped list, with or without a search term. Before this the search
            // branch won regardless of scope, so typing in the course-details
            // dialog returned invites from every course in the institute.
            // Normalize absent search text; the repository explicitly casts search
            // parameters so PostgreSQL can also handle untyped/null bindings.
            pageResult = repository.getEnrollInvitesWithFilters(instituteId,
                    enrollInviteFilterDTO.getPackageSessionIds(),
                    enrollInviteFilterDTO.getPaymentOptionIds(),
                    enrollInviteFilterDTO.getTags(),
                    List.of(StatusEnum.ACTIVE.name()),
                    List.of(PackageSessionStatusEnum.ACTIVE.name(), PackageSessionStatusEnum.HIDDEN.name()),
                    hasSearch ? enrollInviteFilterDTO.getSearchName().trim() : "",
                    pageable);
        }

        // Post-filter results if user is faculty-scoped
        if (allowedEnrollInviteIds != null) {
            final Set<String> allowedSet = new HashSet<>(allowedEnrollInviteIds);
            List<EnrollInviteWithSessionsProjection> filtered = pageResult.getContent().stream()
                    .filter(invite -> allowedSet.contains(invite.getId()))
                    .toList();
            pageResult = new org.springframework.data.domain.PageImpl<>(filtered, pageable, filtered.size());
        }

        Page<EnrollInviteListItemDTO> page = pageResult.map(row -> EnrollInviteListItemDTO.from(row,
                shortUrlManagementService.getAbsoluteShortUrl(row.getInstituteId(), row.getShortUrl())));
        attachActorNames(page.getContent());
        attachPaymentSummaries(page.getContent());
        return page;
    }

    /**
     * Which payment option each invite's batches charge through, for the list
     * card. ONE query for the whole page (mappings + payment option fetched
     * together; plans load in @BatchSize batches). Best-effort like the actor
     * names: a failure leaves the summaries empty rather than failing the list.
     */
    private void attachPaymentSummaries(List<EnrollInviteListItemDTO> rows) {
        List<String> inviteIds = rows.stream().map(EnrollInviteListItemDTO::getId).filter(Objects::nonNull).toList();
        if (inviteIds.isEmpty()) return;
        try {
            // Same dedupe as findByInvite: a batch can carry stale ACTIVE mappings,
            // and the newest one is the option the learner actually sees.
            Map<String, Map<String, PackageSessionLearnerInvitationToPaymentOption>> latest = new HashMap<>();
            for (PackageSessionLearnerInvitationToPaymentOption m : packageSessionEnrollInviteToPaymentOptionService
                    .findByEnrollInviteIdsWithPackageSession(inviteIds)) {
                if (m.getEnrollInvite() == null || m.getPackageSession() == null || m.getPaymentOption() == null)
                    continue;
                latest.computeIfAbsent(m.getEnrollInvite().getId(), k -> new HashMap<>())
                        .merge(m.getPackageSession().getId(), m, (a, b) -> {
                            if (a.getCreatedAt() == null) return b;
                            if (b.getCreatedAt() == null) return a;
                            return a.getCreatedAt().isAfter(b.getCreatedAt()) ? a : b;
                        });
            }
            for (EnrollInviteListItemDTO row : rows) {
                Map<String, PackageSessionLearnerInvitationToPaymentOption> bySession = latest.get(row.getId());
                row.setPaymentSummaries(bySession == null ? List.of()
                        : bySession.values().stream().map(this::toPaymentSummary).toList());
            }
        } catch (Exception e) {
            logger.warn("Could not resolve enroll invite payment summaries ({} invites): {}", inviteIds.size(),
                    e.getMessage());
        }
    }

    private EnrollInviteListItemDTO.PaymentSummary toPaymentSummary(PackageSessionLearnerInvitationToPaymentOption m) {
        PaymentOption option = m.getPaymentOption();
        List<PaymentPlan> plans = Optional.ofNullable(option.getPaymentPlans()).orElse(Collections.emptyList())
                .stream().filter(Objects::nonNull).toList();
        DoubleSummaryStatistics prices = plans.stream().mapToDouble(PaymentPlan::getActualPrice).summaryStatistics();
        String currency = plans.stream().map(PaymentPlan::getCurrency).filter(StringUtils::hasText).findFirst()
                .orElse(null);
        return EnrollInviteListItemDTO.PaymentSummary.builder()
                .packageSessionId(m.getPackageSession().getId())
                .mappingId(m.getId())
                .paymentOptionId(option.getId())
                .paymentOptionName(option.getName())
                .type(option.getType())
                .requireApproval(option.isRequireApproval())
                .planCount(plans.size())
                .minPrice(plans.isEmpty() ? null : prices.getMin())
                .maxPrice(plans.isEmpty() ? null : prices.getMax())
                .currency(currency)
                .build();
    }

    /**
     * Resolves created_by / updated_by ids to display names in ONE batched
     * auth_service call per page. Best-effort, like the payment-option list: the
     * invites must still come back when auth_service is slow or down, so a
     * failure leaves the names null and the UI falls back to "unknown".
     */
    private void attachActorNames(List<EnrollInviteListItemDTO> rows) {
        List<String> ids = rows.stream()
                .flatMap(r -> java.util.stream.Stream.of(r.getCreatedByUserId(), r.getUpdatedByUserId()))
                .filter(id -> id != null && !id.isBlank())
                .distinct()
                .toList();
        if (ids.isEmpty()) return;
        Map<String, String> names = new HashMap<>();
        try {
            for (UserDTO u : authService.getUsersFromAuthServiceByUserIds(ids)) {
                if (u == null || u.getId() == null) continue;
                String name = u.getFullName() != null && !u.getFullName().isBlank()
                        ? u.getFullName().trim()
                        : u.getEmail() != null && !u.getEmail().isBlank() ? u.getEmail() : u.getUsername();
                if (name != null) names.put(u.getId(), name);
            }
        } catch (Exception e) {
            logger.warn("Could not resolve enroll invite actor names ({} ids): {}", ids.size(), e.getMessage());
            return;
        }
        for (EnrollInviteListItemDTO row : rows) {
            row.setCreatedByName(names.get(row.getCreatedByUserId()));
            row.setUpdatedByName(names.get(row.getUpdatedByUserId()));
        }
    }

    public EnrollInviteDTO findByEnrollInviteId(String enrollInviteId, String instituteId) {
        EnrollInvite enrollInvite = repository.findById(enrollInviteId)
                .orElseThrow(() -> new VacademyException("EnrollInvite not found with id: " + enrollInviteId));
        return buildFullEnrollInviteDTO(enrollInvite, instituteId);
    }

    public EnrollInviteDTO findDefaultEnrollInviteByPackageSessionId(String packageSessionId, String instituteId) {
        EnrollInvite enrollInvite = repository.findLatestForPackageSessionWithFilters(
                packageSessionId,
                List.of(StatusEnum.ACTIVE.name()),
                List.of(EnrollInviteTag.DEFAULT.name()),
                List.of(StatusEnum.ACTIVE.name()))
                .orElseThrow(() -> new VacademyException(
                        "Default EnrollInvite not found for package session: " + packageSessionId));
        return buildFullEnrollInviteDTO(enrollInvite, instituteId);
    }

    public boolean findDefaultEnrollInviteByPackageSessionId(String packageSessionId) {
        EnrollInvite enrollInvite = repository.findLatestForPackageSessionWithFilters(
                packageSessionId,
                List.of(StatusEnum.ACTIVE.name()),
                List.of(EnrollInviteTag.DEFAULT.name()),
                List.of(StatusEnum.ACTIVE.name()))
                .orElseThrow(() -> new VacademyException(
                        "Default EnrollInvite not found for package session: " + packageSessionId));
        return true;
    }

    /**
     * Finds default EnrollInvite by package session ID without throwing exception
     * Returns Optional.empty() if no default enroll invite is found
     * This method only maps basic fields to avoid LazyInitializationException
     *
     * @param packageSessionId The package session ID
     * @param instituteId      The institute ID
     * @return Optional containing EnrollInviteDTO with basic fields if found, empty
     *         otherwise
     */
    public Optional<EnrollInviteDTO> findDefaultEnrollInviteByPackageSessionIdOptional(String packageSessionId,
            String instituteId) {
        Optional<EnrollInvite> enrollInviteOptional = repository.findLatestForPackageSessionWithFilters(
                packageSessionId,
                List.of(StatusEnum.ACTIVE.name()),
                List.of(EnrollInviteTag.DEFAULT.name()),
                List.of(StatusEnum.ACTIVE.name()));

        return enrollInviteOptional.map(enrollInvite -> buildBasicEnrollInviteDTO(enrollInvite));
    }

    public List<EnrollInviteDTO> findByPaymentOptionIds(List<String> paymentOptionIds, String instituteId) {
        List<PackageSessionLearnerInvitationToPaymentOption> mappings = packageSessionEnrollInviteToPaymentOptionService
                .findByPaymentOptionIds(paymentOptionIds);

        Map<EnrollInvite, List<PackageSessionLearnerInvitationToPaymentOption>> groupedByInvite = mappings.stream()
                .collect(Collectors.groupingBy(PackageSessionLearnerInvitationToPaymentOption::getEnrollInvite));

        return groupedByInvite.entrySet().stream()
                .map(entry -> buildFullEnrollInviteDTO(entry.getKey(), instituteId, entry.getValue()))
                .collect(Collectors.toList());
    }

    public List<EnrollInviteDTO> findEnrollInvitesByReferralOptionIds(List<String> referralOptionIds,
            String instituteId) {
        List<PackageSessionEnrollInvitePaymentOptionPlanToReferralOption> referralMappings = packageSessionEnrollInvitePaymentOptionPlanToReferralOptionService
                .findByReferralOptionIds(referralOptionIds);

        Map<EnrollInvite, List<PackageSessionLearnerInvitationToPaymentOption>> groupedByInvite = referralMappings
                .stream()
                .map(PackageSessionEnrollInvitePaymentOptionPlanToReferralOption::getPackageSessionLearnerInvitationToPaymentOption)
                .distinct()
                .collect(Collectors.groupingBy(PackageSessionLearnerInvitationToPaymentOption::getEnrollInvite));

        return groupedByInvite.entrySet().stream()
                .map(entry -> buildFullEnrollInviteDTO(entry.getKey(), instituteId, entry.getValue()))
                .collect(Collectors.toList());
    }

    @Transactional
    public String updateDefaultEnrollInviteConfig(String enrollInviteId, String packageSessionId) {
        return updateDefaultEnrollInviteConfig(enrollInviteId, packageSessionId, null);
    }

    public String updateDefaultEnrollInviteConfig(String enrollInviteId, String packageSessionId,
            CustomUserDetails actor) {
        removeDefaultTag(packageSessionId);
        addDefaultTag(enrollInviteId, actor);
        return enrollInviteId;
    }

    @Transactional
    public String deleteEnrollInvites(List<String> enrollInviteIds) {
        List<EnrollInvite> enrollInvites = repository.findAllById(enrollInviteIds);
        for (EnrollInvite enrollInvite : enrollInvites) {
            enrollInvite.setStatus(StatusEnum.DELETED.name());

            // Delete associated short URL using centralized service
            shortUrlManagementService.deleteShortUrl(
                    SHORT_LINK_SOURCE_ENROLL_INVITE,
                    enrollInvite.getId(),
                    enrollInvite.getShortUrl());
        }
        repository.saveAll(enrollInvites);
        packageSessionEnrollInviteToPaymentOptionService.deleteByEnrollInviteIds(enrollInviteIds);
        return "Enroll invites deleted successfully";
    }

    /**
     * Persist the full set of custom fields the admin selected for this enroll
     * invite. Delegates to the unified per-feature sync — see
     * {@link vacademy.io.admin_core_service.features.common.service.InstituteCustomFiledService#syncFeatureCustomFields}.
     *
     * The frontend always sends the complete picked list (defaults + ad-hoc).
     * Anything not present here is soft-deleted; anything previously deleted
     * is reactivated by id (so a re-tick brings the existing answers back).
     */
    private void saveInstituteCustomFields(String inviteId, String instituteId, List<InstituteCustomFieldDTO> dtos) {
        if (!StringUtils.hasText(instituteId) || !StringUtils.hasText(inviteId)) {
            return;
        }
        instituteCustomFiledService.syncFeatureCustomFields(
                instituteId,
                CustomFieldTypeEnum.ENROLL_INVITE.name(),
                inviteId,
                dtos);
    }

    // ===================================================================================
    // PRIVATE HELPER AND DTO BUILDING METHODS
    // ===================================================================================

    public EnrollInviteDTO buildFullEnrollInviteDTO(EnrollInvite enrollInvite, String instituteId) {
        List<PackageSessionLearnerInvitationToPaymentOption> mappings = packageSessionEnrollInviteToPaymentOptionService
                .findByInvite(enrollInvite);
        return buildFullEnrollInviteDTO(enrollInvite, instituteId, mappings);
    }

    private EnrollInviteDTO buildFullEnrollInviteDTO(EnrollInvite enrollInvite, String instituteId,
            List<PackageSessionLearnerInvitationToPaymentOption> mappings) {
        EnrollInviteDTO dto = enrollInvite.toEnrollInviteDTO();
        // Availability window / status, computed on the server clock so every consumer
        // (learner enroll page, catalogue, admin) shares one definition.
        dto.setAvailabilityStatus(EnrollInviteAvailabilityUtil.compute(enrollInvite));
        dto.setShortUrl(
                shortUrlManagementService.getAbsoluteShortUrl(enrollInvite.getInstituteId(), dto.getShortUrl()));

        // 1. Fetch and set Custom Fields
        dto.setInstituteCustomFields(instituteCustomFiledService.findCustomFieldsAsJson(
                instituteId, CustomFieldTypeEnum.ENROLL_INVITE.name(), enrollInvite.getId()));

        // 2. Build and set Payment Option DTOs from mappings
        List<PackageSessionToPaymentOptionDTO> paymentOptionDTOs = mappings.stream()
                .map(this::mapToPackageSessionToPaymentOptionDTO)
                .collect(Collectors.toList());
        dto.setPackageSessionToPaymentOptions(paymentOptionDTOs);

        // 3. Populate sub-org info if present
        if (StringUtils.hasText(enrollInvite.getSubOrgId())) {
            instituteRepository.findById(enrollInvite.getSubOrgId()).ifPresent(subOrg -> {
                EnrollInviteDTO.SubOrgInfoDTO subOrgInfo = new EnrollInviteDTO.SubOrgInfoDTO();
                subOrgInfo.setId(subOrg.getId());
                subOrgInfo.setName(subOrg.getInstituteName());
                subOrgInfo.setLogoFileId(subOrg.getLogoFileId());
                dto.setSubOrg(subOrgInfo);
            });
        }

        // 4. Populate GTM container ID if configured
        try {
            Object gtmSetting = instituteSettingService.getSettingByInstituteIdAndKey(instituteId, "GTM_SETTING");
            if (gtmSetting instanceof Map) {
                Map<?, ?> gtmMap = (Map<?, ?>) gtmSetting;
                if (Boolean.TRUE.equals(gtmMap.get("enabled"))
                        && gtmMap.get("containerId") != null
                        && StringUtils.hasText(gtmMap.get("containerId").toString())) {
                    dto.setGtmContainerId(gtmMap.get("containerId").toString());
                }
            }
        } catch (Exception e) {
            logger.debug("GTM setting not found for institute {}: {}", instituteId, e.getMessage());
        }

        return dto;
    }

    private PackageSessionToPaymentOptionDTO mapToPackageSessionToPaymentOptionDTO(
            PackageSessionLearnerInvitationToPaymentOption mapping) {
        if (mapping == null)
            return null;
        PaymentOption paymentOption = mapping.getPaymentOption();
        if (paymentOption == null)
            return null;

        List<PaymentPlanDTO> paymentPlans = mapPaymentPlans(mapping,
                Optional.ofNullable(paymentOption.getPaymentPlans()).orElse(Collections.emptyList()));

        PaymentOptionDTO paymentOptionDTO = mapToPaymentOptionDTO(paymentOption, paymentPlans);

        return PackageSessionToPaymentOptionDTO.builder()
                .id(mapping.getId())
                .packageSessionId(mapping.getPackageSession() != null ? mapping.getPackageSession().getId() : null)
                .enrollInviteId(mapping.getEnrollInvite() != null ? mapping.getEnrollInvite().getId() : null)
                .status(mapping.getStatus())
                .paymentOption(paymentOptionDTO)
                .build();
    }

    private PaymentOptionDTO mapToPaymentOptionDTO(PaymentOption paymentOption, List<PaymentPlanDTO> paymentPlans) {
        return PaymentOptionDTO.builder()
                .id(paymentOption.getId())
                .name(paymentOption.getName())
                .status(paymentOption.getStatus())
                .source(paymentOption.getSource())
                .sourceId(paymentOption.getSourceId())
                .tag(paymentOption.getTag())
                .type(paymentOption.getType())
                .paymentOptionMetadataJson(paymentOption.getPaymentOptionMetadataJson())
                .requireApproval(paymentOption.isRequireApproval())
                .unit(paymentOption.getUnit())
                .complexPaymentOptionId(paymentOption.getComplexPaymentOptionId())
                .regionalPricingEnabled(Boolean.TRUE.equals(paymentOption.getRegionalPricingEnabled()))
                .paymentPlans(paymentPlans)
                .build();
    }

    private List<PaymentPlanDTO> mapPaymentPlans(
            PackageSessionLearnerInvitationToPaymentOption mapping, List<PaymentPlan> paymentPlans) {
        return paymentPlans.stream()
                .filter(Objects::nonNull)
                .map(plan -> mapPaymentPlan(plan, mapping))
                .collect(Collectors.toList());
    }

    private PaymentPlanDTO mapPaymentPlan(
            PaymentPlan paymentPlan, PackageSessionLearnerInvitationToPaymentOption mapping) {
        PaymentPlanDTO paymentPlanDTO = paymentPlan.mapToPaymentPlanDTO();
        Optional<ReferralOptionDTO> referralOption = packageSessionEnrollInvitePaymentOptionPlanToReferralOptionService
                .getReferralOptionsByPackageSessionLearnerInvitationToPaymentOptionAndPaymentPlan(mapping, paymentPlan);
        paymentPlanDTO.setReferralOption(referralOption.orElse(null));
        return paymentPlanDTO;
    }

    // Other private methods like removeDefaultTag, addDefaultTag, validate...
    private void removeDefaultTag(String packageSessionId) {
        Optional<EnrollInvite> optionalEnrollInvite = repository.findLatestForPackageSessionWithFilters(
                packageSessionId,
                List.of(StatusEnum.ACTIVE.name()),
                List.of(EnrollInviteTag.DEFAULT.name()),
                List.of(StatusEnum.ACTIVE.name()));
        if (optionalEnrollInvite.isPresent()) {
            EnrollInvite enrollInvite = optionalEnrollInvite.get();
            enrollInvite.setTag(null);
            repository.save(enrollInvite);
        }
    }

    private void addDefaultTag(String enrollInviteId, CustomUserDetails actor) {
        Optional<EnrollInvite> optionalEnrollInvite = repository.findById(enrollInviteId);
        if (optionalEnrollInvite.isPresent()) {
            EnrollInvite enrollInvite = optionalEnrollInvite.get();
            enrollInvite.setTag(EnrollInviteTag.DEFAULT.name());
            if (actor != null) {
                enrollInvite.setUpdatedByUserId(actor.getUserId());
            }
            repository.save(enrollInvite);
        } else {
            throw new VacademyException("EnrollInvite not found");
        }
    }

    private void validateMappingDTO(PackageSessionToPaymentOptionDTO dto) {
        if (dto.getPackageSessionId() == null || dto.getPackageSessionId().isBlank()) {
            throw new VacademyException("packageSessionId is required in packageSessionToPaymentOptions.");
        }
        if (dto.getPaymentOption() == null || dto.getPaymentOption().getId() == null
                || dto.getPaymentOption().getId().isBlank()) {
            throw new VacademyException("paymentOption.id is required in packageSessionToPaymentOptions.");
        }
    }

    private void validateSaveOrUpdate(
            List<PackageSessionLearnerInvitationToPaymentOption> savedMappings,
            List<PackageSessionToPaymentOptionDTO> originalDTOs) {

        if (CollectionUtils.isEmpty(savedMappings) || CollectionUtils.isEmpty(originalDTOs)
                || savedMappings.size() != originalDTOs.size()) {
            return;
        }

        List<PackageSessionEnrollInvitePaymentOptionPlanToReferralOption> referralsToSave = new ArrayList<>();

        for (int i = 0; i < originalDTOs.size(); i++) {
            PackageSessionToPaymentOptionDTO dto = originalDTOs.get(i);
            PackageSessionLearnerInvitationToPaymentOption persistedParent = savedMappings.get(i);

            if (Objects.isNull(dto.getPaymentOption())
                    || CollectionUtils.isEmpty(dto.getPaymentOption().getPaymentPlans())) {
                continue;
            }

            for (PaymentPlanDTO planDTO : dto.getPaymentOption().getPaymentPlans()) {
                if (Objects.nonNull(planDTO.getReferralOption())
                        && StringUtils.hasText(planDTO.getReferralOption().getId())) {
                    Optional<PaymentPlan> optionalPlan = paymentPlanService.findById(planDTO.getId());
                    Optional<ReferralOption> optionalReferral = referralOptionService
                            .getReferralOption(planDTO.getReferralOption().getId());

                    if (optionalPlan.isPresent() && optionalReferral.isPresent()) {
                        PackageSessionEnrollInvitePaymentOptionPlanToReferralOption childEntity = packageSessionEnrollInvitePaymentOptionPlanToReferralOptionService
                                .addOrUpdatePackageSessionEnrollInvitePaymentOptionPlanToReferralOption(persistedParent,
                                        optionalReferral.get(), optionalPlan.get(),
                                        planDTO.getReferralOptionSMappingStatus());
                        referralsToSave.add(childEntity);
                    }
                }
            }
        }

        if (!referralsToSave.isEmpty()) {
            packageSessionEnrollInvitePaymentOptionPlanToReferralOptionService.saveInBulk(referralsToSave);
        }
    }

    @Transactional
    public String updatePaymentOptionsForInvites(
            List<UpdateEnrollInvitePackageSessionPaymentOptionDTO> updatePaymentOptionRequests) {

        // Step 1: Delete old payment options
        List<String> oldPaymentOptionIds = extractOldPaymentOptionIds(updatePaymentOptionRequests);
        deleteOldPaymentOptions(oldPaymentOptionIds);

        // Step 2: Process new payment options for each enroll invite
        for (UpdateEnrollInvitePackageSessionPaymentOptionDTO request : updatePaymentOptionRequests) {
            processNewPaymentOptions(request);
        }

        return "success";
    }

    // ------------------- PRIVATE METHODS ------------------- //

    /**
     * Extracts old payment option IDs that need to be deleted.
     */
    private List<String> extractOldPaymentOptionIds(
            List<UpdateEnrollInvitePackageSessionPaymentOptionDTO> requests) {
        List<String> oldIds = new ArrayList<>();
        for (UpdateEnrollInvitePackageSessionPaymentOptionDTO dto : requests) {
            if (dto.getUpdatePaymentOptions() != null) {
                dto.getUpdatePaymentOptions().forEach(updateOption -> {
                    if (updateOption.getOldPackageSessionPaymentOptionId() != null) {
                        oldIds.add(updateOption.getOldPackageSessionPaymentOptionId());
                    }
                });
            }
        }
        return oldIds;
    }

    /**
     * Deletes old payment options and related referral options by setting them to
     * DELETED.
     */
    private void deleteOldPaymentOptions(List<String> oldIds) {
        if (oldIds.isEmpty())
            return;
        packageSessionEnrollInviteToPaymentOptionService.updateStatusByIds(oldIds, StatusEnum.DELETED.name());
        packageSessionEnrollInvitePaymentOptionPlanToReferralOptionService
                .updateStatusByPackageSessionLearnerInvitationToPaymentOptionIds(oldIds, StatusEnum.DELETED.name());
    }

    /**
     * Processes new payment options for a single enroll invite request.
     */
    private void processNewPaymentOptions(UpdateEnrollInvitePackageSessionPaymentOptionDTO request) {
        if (request.getUpdatePaymentOptions() == null)
            return;

        Optional<EnrollInvite> optionalEnrollInvite = repository.findById(request.getEnrollInviteId());
        if (optionalEnrollInvite.isEmpty())
            return;

        EnrollInvite enrollInvite = optionalEnrollInvite.get();

        // Create new PackageSessionLearnerInvitationToPaymentOption entities
        List<PackageSessionLearnerInvitationToPaymentOption> newPaymentOptions = request.getUpdatePaymentOptions()
                .stream()
                .map(updateOption -> createPackageSessionPaymentOption(enrollInvite, updateOption))
                .collect(Collectors.toList());

        List<PackageSessionToPaymentOptionDTO> newPaymentOptionDTOs = request.getUpdatePaymentOptions()
                .stream()
                .map(UpdateEnrollInvitePackageSessionPaymentOptionDTO.UpdatePaymentOptionDTO::getNewPackageSessionPaymentOption)
                .collect(Collectors.toList());

        // Save new payment options and referral options
        packageSessionEnrollInviteToPaymentOptionService
                .createPackageSessionLearnerInvitationToPaymentOptions(newPaymentOptions);
        validateSaveOrUpdate(newPaymentOptions, newPaymentOptionDTOs);
    }

    /**
     * Creates a single PackageSessionLearnerInvitationToPaymentOption from the
     * provided DTO.
     */
    private PackageSessionLearnerInvitationToPaymentOption createPackageSessionPaymentOption(
            EnrollInvite enrollInvite,
            UpdateEnrollInvitePackageSessionPaymentOptionDTO.UpdatePaymentOptionDTO updateOptionDTO) {

        PackageSession packageSession = packageSessionService
                .findById(updateOptionDTO.getNewPackageSessionPaymentOption().getPackageSessionId());

        PaymentOption paymentOption = paymentOptionService
                .findById(updateOptionDTO.getNewPackageSessionPaymentOption().getPaymentOption().getId());

        return new PackageSessionLearnerInvitationToPaymentOption(
                enrollInvite,
                packageSession,
                paymentOption,
                StatusEnum.ACTIVE.name());
    }

    public EnrollInvite findById(String id) {
        return repository.findById(id).orElseThrow(() -> new VacademyException("EnrollInvite not found"));
    }

    // ── Audit helpers (called from @Auditable SpEL on EnrollInviteController) ──
    // Every method is total: audit must never break the mutation it describes.

    /**
     * Pre-mutation snapshot for {@code captureBefore} on update. The entity is
     * flat (no relations), so it serialises cleanly into {@code before_payload}
     * and the audit UI can diff it against the request body.
     */
    public EnrollInvite auditSnapshot(String enrollInviteId) {
        if (enrollInviteId == null || enrollInviteId.isBlank()) return null;
        try {
            return repository.findById(enrollInviteId).orElse(null);
        } catch (Exception e) {
            logger.warn("auditSnapshot failed for enroll invite {}: {}", enrollInviteId, e.getMessage());
            return null;
        }
    }

    /** Name of one invite for the audit sentence, falling back to its id. */
    public String auditName(String enrollInviteId) {
        if (enrollInviteId == null || enrollInviteId.isBlank()) return null;
        try {
            return repository.findById(enrollInviteId)
                    .map(EnrollInvite::getName)
                    .filter(n -> n != null && !n.isBlank())
                    .orElse(enrollInviteId);
        } catch (Exception e) {
            return enrollInviteId;
        }
    }

    /**
     * "invite link Summer Batch" for one id, "3 invite link(s)" for several — a
     * bulk delete naming every invite would not fit the log row.
     */
    public String auditLabel(List<String> enrollInviteIds) {
        List<String> ids = enrollInviteIds == null
                ? List.of()
                : enrollInviteIds.stream().filter(Objects::nonNull).filter(id -> !id.isBlank()).distinct().toList();
        if (ids.isEmpty()) return null;
        if (ids.size() > 1) return ids.size() + " invite link(s)";
        return "invite link " + auditName(ids.get(0));
    }

    private static String getInviteCode() {
        String chars = "abcdefghijklmnopqrstuvwxyz0123456789";
        SecureRandom random = new SecureRandom();
        StringBuilder sb = new StringBuilder(6);

        for (int i = 0; i < 6; i++) {
            int index = random.nextInt(chars.length());
            sb.append(chars.charAt(index));
        }

        return sb.toString();
    }

    /**
     * Retrieves enroll invites by user ID and institute ID following the path:
     * SSIGM -> UserPlan -> EnrollInvite -> PackageSession -> PaymentOption
     * All entities must have ACTIVE status.
     */
    public List<EnrollInviteDTO> getEnrollInvitesByUserIdAndInstituteId(String userId, String instituteId) {

        // Define active statuses for all entities
        List<String> activeStatuses = List.of(StatusEnum.ACTIVE.name());

        // Get enroll invites using the complex join query
        List<EnrollInvite> enrollInvites = repository.findDefaultEnrollInvitesForStudent(
                userId,
                instituteId,
                activeStatuses, // SSIGM statuses
                activeStatuses, // EnrollInvite statuses
                activeStatuses);

        // Convert to DTOs and populate additional data
        return enrollInvites.stream()
                .map(this::convertToEnrollInviteDTO)
                .collect(Collectors.toList());
    }

    /**
     * Converts EnrollInvite entity to DTO with all related data
     */
    private EnrollInviteDTO convertToEnrollInviteDTO(EnrollInvite enrollInvite) {
        EnrollInviteDTO dto = enrollInvite.toEnrollInviteDTO();
        dto.setShortUrl(
                shortUrlManagementService.getAbsoluteShortUrl(enrollInvite.getInstituteId(), dto.getShortUrl()));
        return dto;
    }

    /**
     * Builds a basic EnrollInviteDTO with only essential fields to avoid
     * LazyInitializationException
     * This method is safe to use outside of transaction context
     *
     * @param enrollInvite The EnrollInvite entity
     * @return EnrollInviteDTO with basic fields populated
     */
    private EnrollInviteDTO buildBasicEnrollInviteDTO(EnrollInvite enrollInvite) {
        EnrollInviteDTO dto = new EnrollInviteDTO();
        dto.setId(enrollInvite.getId());
        dto.setName(enrollInvite.getName());
        dto.setEndDate(enrollInvite.getEndDate());
        dto.setStartDate(enrollInvite.getStartDate());
        dto.setInviteCode(enrollInvite.getInviteCode());
        dto.setStatus(enrollInvite.getStatus());
        dto.setInstituteId(enrollInvite.getInstituteId());
        dto.setVendor(enrollInvite.getVendor());
        dto.setVendorId(enrollInvite.getVendorId());
        dto.setCurrency(enrollInvite.getCurrency());
        dto.setTag(enrollInvite.getTag());
        dto.setLearnerAccessDays(enrollInvite.getLearnerAccessDays());
        dto.setWebPageMetaDataJson(enrollInvite.getWebPageMetaDataJson());
        dto.setIsBundled(enrollInvite.getIsBundled());
        dto.setShortUrl(shortUrlManagementService.getAbsoluteShortUrl(enrollInvite.getInstituteId(),
                enrollInvite.getShortUrl()));
        return dto;
    }

}