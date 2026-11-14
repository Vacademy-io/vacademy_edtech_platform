package vacademy.io.admin_core_service.features.access_pass.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.CollectionUtils;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.access_pass.dto.AccessPassDTOs.*;
import vacademy.io.admin_core_service.features.access_pass.entity.AccessPass;
import vacademy.io.admin_core_service.features.access_pass.entity.AccessPassGrant;
import vacademy.io.admin_core_service.features.access_pass.entity.AccessPassItem;
import vacademy.io.admin_core_service.features.access_pass.entity.AccessPassSubOrg;
import vacademy.io.admin_core_service.features.access_pass.enums.AccessPassEnums.*;
import vacademy.io.admin_core_service.features.access_pass.repository.AccessPassGrantRepository;
import vacademy.io.admin_core_service.features.access_pass.repository.AccessPassItemRepository;
import vacademy.io.admin_core_service.features.access_pass.repository.AccessPassRepository;
import vacademy.io.admin_core_service.features.access_pass.repository.AccessPassSubOrgRepository;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.suborg.service.SubOrgSubscriptionService;
import vacademy.io.common.institute.entity.Institute;
import org.springframework.context.annotation.Lazy;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.common.enums.StatusEnum;
import vacademy.io.admin_core_service.features.common.service.InstituteCustomFiledService;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.entity.PackageSessionLearnerInvitationToPaymentOption;
import vacademy.io.admin_core_service.features.enroll_invite.enums.EnrollInviteTag;
import vacademy.io.admin_core_service.features.enroll_invite.repository.EnrollInviteRepository;
import vacademy.io.admin_core_service.features.enroll_invite.repository.PackageSessionLearnerInvitationToPaymentOptionRepository;
import vacademy.io.admin_core_service.features.enroll_invite.service.EnrollInviteCoursePreviewService;
import vacademy.io.admin_core_service.features.institute.service.InstitutePaymentGatewayMappingService;
import vacademy.io.admin_core_service.features.packages.enums.PackageSessionStatusEnum;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.shortlink.service.ShortUrlManagementService;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.enums.UserPlanStatusEnum;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentOptionService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.session.PackageSession;

import java.security.SecureRandom;
import java.sql.Timestamp;
import java.text.Normalizer;
import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Admin and public operations on access passes. The pass's item list is the source of
 * truth; every change here rewrites the generated invite's package-session mappings to
 * match and, when current holders are affected, queues a holder sync.
 */
@Slf4j
@Service
public class AccessPassService {

    private static final String SHORT_LINK_SOURCE_ENROLL_INVITE = "ENROLL_INVITE";
    private static final String DELETED = AccessPassStatus.DELETED.name();

    @Autowired private AccessPassRepository passRepository;
    @Autowired private AccessPassItemRepository itemRepository;
    @Autowired private AccessPassGrantRepository grantRepository;
    @Autowired private AccessPassSyncService syncService;
    @Autowired private InstituteAccessValidator accessValidator;
    @Autowired private EnrollInviteRepository enrollInviteRepository;
    @Autowired private PackageSessionLearnerInvitationToPaymentOptionRepository mappingRepository;
    @Autowired private PackageSessionRepository packageSessionRepository;
    @Autowired private PaymentOptionService paymentOptionService;
    @Autowired private InstitutePaymentGatewayMappingService institutePaymentGatewayMappingService;
    @Autowired private ShortUrlManagementService shortUrlManagementService;
    @Autowired private InstituteCustomFiledService instituteCustomFiledService;
    @Autowired private EnrollInviteCoursePreviewService enrollInviteCoursePreviewService;
    @Autowired private AuthService authService;
    @Autowired private AccessPassSubOrgRepository subOrgLinkRepository;
    @Autowired private InstituteRepository instituteRepository;
    // @Lazy: SubOrgSubscriptionService sits in the UserPlanService / payment graph.
    @Autowired @Lazy private SubOrgSubscriptionService subOrgSubscriptionService;

    @Value("${default.learner.portal.url:https://learner.vacademy.io}")
    private String learnerBaseUrl;

    @Value("${default.learner.portal.enroll_invite_path:/learner-invitation-response}")
    private String learnerInvitePath;

    // ─────────────────────────────── admin: write ───────────────────────────────

    @Transactional
    public AccessPassResponse create(CustomUserDetails user, String instituteId, AccessPassRequest req) {
        accessValidator.requireInstituteAdmin(user, instituteId);
        if (req == null || !StringUtils.hasText(req.getName())) {
            throw new VacademyException("Access pass name is required");
        }
        PaymentOption option = requirePaymentOption(req.getPaymentOptionId(), instituteId);
        AudienceType audience = parseAudience(req.getAudienceType());
        CourseScope scope = parseScope(req.getCourseScope());
        List<PackageSession> courses = scope == CourseScope.ALL_COURSES
                ? eligibleInstituteCourses(instituteId)
                : requireCourses(instituteId, req.getPackageSessionIds());
        if (courses.isEmpty()) {
            throw new VacademyException("This institute has no live courses to include yet");
        }

        AccessPass pass = AccessPass.builder()
                .audienceType(audience.name())
                .courseScope(scope.name())
                .instituteId(instituteId)
                .name(req.getName().trim())
                .slug(uniqueSlug(instituteId, StringUtils.hasText(req.getSlug()) ? req.getSlug() : req.getName(), null))
                .shortDescription(req.getShortDescription())
                .description(req.getDescription())
                .coverImageUrl(req.getCoverImageUrl())
                .tags(joinTags(req.getTags()))
                .status(AccessPassStatus.DRAFT.name())
                .paymentOptionId(option.getId())
                .onItemRemoved(parsePolicy(req.getOnItemRemoved()).name())
                .displayOrder(req.getDisplayOrder() != null ? req.getDisplayOrder() : 0)
                .settingsJson(req.getSettingsJson())
                .needsSync(false)
                .createdBy(userId(user))
                .updatedBy(userId(user))
                .build();
        pass = passRepository.save(pass);

        EnrollInvite invite = createInvite(pass, option, courses);
        pass.setEnrollInviteId(invite.getId());
        pass = passRepository.save(pass);

        Timestamp now = new Timestamp(System.currentTimeMillis());
        int order = 0;
        List<AccessPassItem> items = new ArrayList<>();
        for (PackageSession ps : courses) {
            items.add(newItem(pass, ps.getId(), order++, user, now));
        }
        itemRepository.saveAll(items);

        log.info("[access-pass] created pass {} ({}) with {} courses, invite {}", pass.getId(), pass.getName(),
                courses.size(), invite.getId());
        return detail(pass, true);
    }

    @Transactional
    public AccessPassResponse update(CustomUserDetails user, String instituteId, String passId,
                                     AccessPassRequest req) {
        accessValidator.requireInstituteAdmin(user, instituteId);
        AccessPass pass = requirePass(instituteId, passId);
        if (req == null) {
            return detail(pass, true);
        }
        if (req.getName() != null) {
            if (!StringUtils.hasText(req.getName())) {
                throw new VacademyException("Access pass name cannot be empty");
            }
            pass.setName(req.getName().trim());
        }
        if (req.getSlug() != null) {
            pass.setSlug(uniqueSlug(instituteId, req.getSlug(), pass.getId()));
        }
        if (req.getShortDescription() != null) pass.setShortDescription(emptyToNull(req.getShortDescription()));
        if (req.getDescription() != null) pass.setDescription(emptyToNull(req.getDescription()));
        if (req.getCoverImageUrl() != null) pass.setCoverImageUrl(emptyToNull(req.getCoverImageUrl()));
        if (req.getTags() != null) pass.setTags(joinTags(req.getTags()));
        if (req.getDisplayOrder() != null) pass.setDisplayOrder(req.getDisplayOrder());
        if (req.getSettingsJson() != null) pass.setSettingsJson(emptyToNull(req.getSettingsJson()));

        boolean policyChanged = false;
        if (req.getOnItemRemoved() != null) {
            String policy = parsePolicy(req.getOnItemRemoved()).name();
            policyChanged = !policy.equals(pass.getOnItemRemoved());
            pass.setOnItemRemoved(policy);
        }

        EnrollInvite invite = requireInvite(pass);
        if (StringUtils.hasText(req.getPaymentOptionId()) && !req.getPaymentOptionId().equals(pass.getPaymentOptionId())) {
            // Re-price for FUTURE buyers: re-create the invite's mappings on the new option.
            // Current holders keep their user_plan, its option and its price.
            PaymentOption option = requirePaymentOption(req.getPaymentOptionId(), instituteId);
            List<String> courseIds = activeCourseIds(pass.getId());
            retireActiveMappings(invite, null);
            createMappings(invite, option, packageSessionRepository.findAllById(courseIds));
            invite.setCurrency(currencyOf(option));
            pass.setPaymentOptionId(option.getId());
        }
        invite.setName(pass.getName());
        enrollInviteRepository.save(invite);

        boolean scopeChanged = false;
        if (req.getCourseScope() != null) {
            String scope = parseScope(req.getCourseScope()).name();
            scopeChanged = !scope.equals(pass.getCourseScope());
            // ALL_COURSES -> SELECTED keeps today's items as the selection;
            // SELECTED -> ALL_COURSES is filled in by the sync (refreshAllCourses).
            pass.setCourseScope(scope);
        }

        pass.setUpdatedBy(userId(user));
        boolean revokeTurnedOn = policyChanged && ItemRemovalPolicy.REVOKE.name().equals(pass.getOnItemRemoved());
        boolean nowAllCourses = scopeChanged && CourseScope.ALL_COURSES.name().equals(pass.getCourseScope());
        if (revokeTurnedOn || nowAllCourses) {
            // REVOKE applies to courses already removed, too; ALL_COURSES pulls in the catalogue.
            pass.setNeedsSync(true);
            syncService.requestSync(pass.getId());
        }
        pass = passRepository.save(pass);
        return detail(pass, true);
    }

    @Transactional
    public AccessPassResponse updateStatus(CustomUserDetails user, String instituteId, String passId, String status) {
        accessValidator.requireInstituteAdmin(user, instituteId);
        AccessPass pass = requirePass(instituteId, passId);
        AccessPassStatus target;
        try {
            target = AccessPassStatus.valueOf(String.valueOf(status).toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new VacademyException("Unknown access pass status: " + status);
        }
        if (target == AccessPassStatus.ACTIVE) {
            if (activeCourseIds(pass.getId()).isEmpty()) {
                throw new VacademyException("Add at least one course before publishing the pass");
            }
            if (!StringUtils.hasText(pass.getPaymentOptionId())) {
                throw new VacademyException("Choose a payment option before publishing the pass");
            }
        }
        pass.setStatus(target.name());
        pass.setUpdatedBy(userId(user));

        // Only an ACTIVE B2C pass sells through its invite. Archived / deleted passes keep
        // their invite INACTIVE (never DELETED): current holders' plans and renewals still
        // point at it. A B2B pass is never bought by learners directly — it reaches them
        // through the sub-orgs it is assigned to — so its invite stays INACTIVE.
        EnrollInvite invite = requireInvite(pass);
        boolean sells = target == AccessPassStatus.ACTIVE && !isB2B(pass);
        invite.setStatus(sells ? StatusEnum.ACTIVE.name() : StatusEnum.INACTIVE.name());
        enrollInviteRepository.save(invite);

        pass = passRepository.save(pass);
        log.info("[access-pass] pass {} -> {}", pass.getId(), target);
        return detail(pass, true);
    }

    @Transactional
    public AccessPassResponse addItems(CustomUserDetails user, String instituteId, String passId,
                                       List<String> packageSessionIds) {
        accessValidator.requireInstituteAdmin(user, instituteId);
        AccessPass pass = requirePass(instituteId, passId);
        requireSelectedScope(pass);
        List<PackageSession> courses = requireCourses(instituteId, packageSessionIds);
        EnrollInvite invite = requireInvite(pass);
        PaymentOption option = requirePaymentOption(pass.getPaymentOptionId(), instituteId);

        Set<String> already = new HashSet<>(activeCourseIds(pass.getId()));
        List<PackageSession> toAdd = courses.stream().filter(ps -> !already.contains(ps.getId())).toList();
        if (toAdd.isEmpty()) {
            return detail(pass, true);
        }
        Timestamp now = new Timestamp(System.currentTimeMillis());
        int order = already.size();
        List<AccessPassItem> items = new ArrayList<>();
        for (PackageSession ps : toAdd) {
            items.add(newItem(pass, ps.getId(), order++, user, now));
        }
        itemRepository.saveAll(items);
        createMappings(invite, option, toAdd);
        invite.setIsBundled(already.size() + toAdd.size() > 1);
        enrollInviteRepository.save(invite);

        pass.setNeedsSync(true);
        pass.setUpdatedBy(userId(user));
        pass = passRepository.save(pass);
        // Deliver the new courses to current holders once this commits.
        syncService.requestSync(pass.getId());
        log.info("[access-pass] added {} course(s) to pass {}: {}", toAdd.size(), pass.getId(),
                toAdd.stream().map(PackageSession::getId).toList());
        return detail(pass, true);
    }

    @Transactional
    public AccessPassResponse removeItem(CustomUserDetails user, String instituteId, String passId,
                                         String packageSessionId) {
        accessValidator.requireInstituteAdmin(user, instituteId);
        AccessPass pass = requirePass(instituteId, passId);
        requireSelectedScope(pass);
        AccessPassItem item = itemRepository
                .findFirstByAccessPassIdAndPackageSessionIdAndStatus(pass.getId(), packageSessionId,
                        ItemStatus.ACTIVE.name())
                .orElseThrow(() -> new VacademyException("This course is not part of the pass"));
        if (AccessPassStatus.ACTIVE.name().equals(pass.getStatus()) && activeCourseIds(pass.getId()).size() <= 1) {
            throw new VacademyException("A published pass must keep at least one course. Archive it instead.");
        }
        item.setStatus(ItemStatus.REMOVED.name());
        item.setRemovedAt(new Timestamp(System.currentTimeMillis()));
        item.setRemovedBy(userId(user));
        itemRepository.save(item);

        // New buyers stop getting the course. Current holders: per on_item_removed.
        EnrollInvite invite = requireInvite(pass);
        retireActiveMappings(invite, packageSessionId);
        invite.setIsBundled(activeCourseIds(pass.getId()).size() > 1);
        enrollInviteRepository.save(invite);

        pass.setUpdatedBy(userId(user));
        if (ItemRemovalPolicy.REVOKE.name().equals(pass.getOnItemRemoved())) {
            pass.setNeedsSync(true);
            syncService.requestSync(pass.getId());
        }
        pass = passRepository.save(pass);
        log.info("[access-pass] removed course {} from pass {} (policy {})", packageSessionId, pass.getId(),
                pass.getOnItemRemoved());
        return detail(pass, true);
    }

    public SyncReport syncNow(CustomUserDetails user, String instituteId, String passId) {
        accessValidator.requireInstituteAdmin(user, instituteId);
        AccessPass pass = requirePass(instituteId, passId);
        return syncService.syncPass(pass.getId());
    }

    /**
     * ALL_COURSES scope: make the pass's items equal the institute's live course batches.
     * New batches join (item + invite mapping), batches that are no longer live leave.
     * Called by the sync before holders are reconciled, so holders get new courses in
     * the same run. Returns {added, removed}; a no-op for SELECTED passes.
     */
    @Transactional
    public int[] refreshAllCourses(String passId) {
        AccessPass pass = passRepository.findById(passId).orElse(null);
        if (pass == null || !CourseScope.ALL_COURSES.name().equals(pass.getCourseScope())
                || DELETED.equals(pass.getStatus())) {
            return new int[] {0, 0};
        }
        List<PackageSession> eligible = eligibleInstituteCourses(pass.getInstituteId());
        Set<String> eligibleIds = eligible.stream().map(PackageSession::getId).collect(Collectors.toSet());
        List<AccessPassItem> current = itemRepository
                .findByAccessPassIdAndStatusOrderByDisplayOrderAscAddedAtAsc(pass.getId(), ItemStatus.ACTIVE.name());
        Set<String> currentIds = current.stream().map(AccessPassItem::getPackageSessionId).collect(Collectors.toSet());

        List<PackageSession> toAdd = eligible.stream().filter(ps -> !currentIds.contains(ps.getId())).toList();
        List<AccessPassItem> toRemove = current.stream()
                .filter(i -> !eligibleIds.contains(i.getPackageSessionId())).toList();
        if (toAdd.isEmpty() && toRemove.isEmpty()) {
            return new int[] {0, 0};
        }

        EnrollInvite invite = requireInvite(pass);
        Timestamp now = new Timestamp(System.currentTimeMillis());
        if (!toAdd.isEmpty()) {
            PaymentOption option = requirePaymentOption(pass.getPaymentOptionId(), pass.getInstituteId());
            int order = current.size();
            List<AccessPassItem> items = new ArrayList<>();
            for (PackageSession ps : toAdd) {
                items.add(newItem(pass, ps.getId(), order++, null, now));
            }
            itemRepository.saveAll(items);
            createMappings(invite, option, toAdd);
        }
        for (AccessPassItem item : toRemove) {
            item.setStatus(ItemStatus.REMOVED.name());
            item.setRemovedAt(now);
            itemRepository.save(item);
            retireActiveMappings(invite, item.getPackageSessionId());
        }
        invite.setIsBundled(current.size() - toRemove.size() + toAdd.size() > 1);
        enrollInviteRepository.save(invite);
        log.info("[access-pass] ALL_COURSES pass {}: +{} -{} courses from the catalogue", pass.getId(),
                toAdd.size(), toRemove.size());
        return new int[] {toAdd.size(), toRemove.size()};
    }

    // ─────────────────────────────── B2B: sub-orgs ──────────────────────────────

    /**
     * Give a sub-org this B2B pass: its courses are linked to the sub-org's org-level
     * invite (the same path as "add course" on the sub-org screen, which also mirrors
     * the learner invites and grants the sub-org's team access), and the link is kept
     * so courses added to the pass later reach the sub-org through the sync.
     */
    @Transactional
    public List<SubOrgLinkResponse> assignSubOrg(CustomUserDetails user, String instituteId, String passId,
                                                 String subOrgId) {
        accessValidator.requireInstituteAdmin(user, instituteId);
        AccessPass pass = requirePass(instituteId, passId);
        if (!isB2B(pass)) {
            throw new VacademyException("Only B2B passes can be assigned to sub-organisations");
        }
        if (!StringUtils.hasText(subOrgId)) {
            throw new VacademyException("sub_org_id is required");
        }
        if (subOrgLinkRepository.findFirstByAccessPassIdAndSubOrgIdAndStatus(pass.getId(), subOrgId,
                SubOrgLinkStatus.ACTIVE.name()).isPresent()) {
            return subOrgs(user, instituteId, passId);
        }
        // Throws when the sub-org has no org-level invite in this institute, which is
        // also what keeps an admin from attaching another institute's sub-org.
        subOrgSubscriptionService.addSubOrgPackageSessions(subOrgId, instituteId, activeCourseIds(pass.getId()));

        Timestamp now = new Timestamp(System.currentTimeMillis());
        subOrgLinkRepository.save(AccessPassSubOrg.builder()
                .accessPassId(pass.getId())
                .instituteId(instituteId)
                .subOrgId(subOrgId)
                .status(SubOrgLinkStatus.ACTIVE.name())
                .assignedBy(userId(user))
                .assignedAt(now)
                .lastSyncedAt(now)
                .build());
        log.info("[access-pass] B2B pass {} assigned to sub-org {}", pass.getId(), subOrgId);
        return subOrgs(user, instituteId, passId);
    }

    /**
     * Stop pushing this pass's future course changes to the sub-org. Courses already
     * linked stay with the sub-org: the sub-org model has no course removal (removing
     * one would orphan its enrolled learners' access), so unassigning is not a revoke.
     */
    @Transactional
    public List<SubOrgLinkResponse> unassignSubOrg(CustomUserDetails user, String instituteId, String passId,
                                                   String subOrgId) {
        accessValidator.requireInstituteAdmin(user, instituteId);
        AccessPass pass = requirePass(instituteId, passId);
        subOrgLinkRepository.findFirstByAccessPassIdAndSubOrgIdAndStatus(pass.getId(), subOrgId,
                SubOrgLinkStatus.ACTIVE.name()).ifPresent(link -> {
                    link.setStatus(SubOrgLinkStatus.REMOVED.name());
                    link.setRemovedAt(new Timestamp(System.currentTimeMillis()));
                    link.setRemovedBy(userId(user));
                    subOrgLinkRepository.save(link);
                });
        return subOrgs(user, instituteId, passId);
    }

    public List<SubOrgLinkResponse> subOrgs(CustomUserDetails user, String instituteId, String passId) {
        accessValidator.requireInstituteStaff(user, instituteId);
        AccessPass pass = requirePass(instituteId, passId);
        List<AccessPassSubOrg> links = subOrgLinkRepository
                .findByAccessPassIdAndStatusOrderByAssignedAtDesc(pass.getId(), SubOrgLinkStatus.ACTIVE.name());
        Map<String, String> names = new HashMap<>();
        for (Institute i : instituteRepository.findAllById(links.stream().map(AccessPassSubOrg::getSubOrgId).toList())) {
            names.put(i.getId(), i.getInstituteName());
        }
        return links.stream().map(l -> SubOrgLinkResponse.builder()
                .subOrgId(l.getSubOrgId())
                .subOrgName(names.get(l.getSubOrgId()))
                .status(l.getStatus())
                .assignedAt(str(l.getAssignedAt()))
                .lastSyncedAt(str(l.getLastSyncedAt()))
                .build()).toList();
    }

    // ─────────────────────────────── admin: read ────────────────────────────────

    public List<AccessPassResponse> list(CustomUserDetails user, String instituteId, List<String> statuses) {
        accessValidator.requireInstituteStaff(user, instituteId);
        List<String> wanted = CollectionUtils.isEmpty(statuses)
                ? List.of(AccessPassStatus.DRAFT.name(), AccessPassStatus.ACTIVE.name(), AccessPassStatus.ARCHIVED.name())
                : statuses.stream().map(s -> s.toUpperCase(Locale.ROOT)).filter(s -> !DELETED.equals(s)).toList();
        return summaries(passRepository.findByInstituteIdAndStatusInOrderByDisplayOrderAscCreatedAtDesc(instituteId, wanted),
                true);
    }

    public AccessPassResponse get(CustomUserDetails user, String instituteId, String passId) {
        accessValidator.requireInstituteStaff(user, instituteId);
        return detail(requirePass(instituteId, passId), true);
    }

    public Page<HolderResponse> holders(CustomUserDetails user, String instituteId, String passId,
                                        List<String> planStatuses, int pageNo, int pageSize) {
        accessValidator.requireInstituteStaff(user, instituteId);
        AccessPass pass = requirePass(instituteId, passId);
        List<String> statuses = CollectionUtils.isEmpty(planStatuses)
                ? List.of(UserPlanStatusEnum.ACTIVE.name(), UserPlanStatusEnum.CANCELED.name(),
                        UserPlanStatusEnum.EXPIRED.name(), UserPlanStatusEnum.PENDING.name(),
                        UserPlanStatusEnum.PENDING_FOR_PAYMENT.name())
                : planStatuses;
        Page<AccessPassRepository.HolderRow> rows = passRepository.findHolders(pass.getEnrollInviteId(), statuses,
                PageRequest.of(Math.max(0, pageNo), Math.min(Math.max(1, pageSize), 200)));

        List<String> userIds = rows.getContent().stream().map(AccessPassRepository.HolderRow::getUserId)
                .filter(Objects::nonNull).distinct().toList();
        Map<String, UserDTO> users = new HashMap<>();
        if (!userIds.isEmpty()) {
            try {
                for (UserDTO u : authService.getUsersFromAuthServiceByUserIds(userIds)) {
                    users.put(u.getId(), u);
                }
            } catch (Exception e) {
                log.warn("[access-pass] could not resolve holder names for pass {}: {}", passId, e.getMessage());
            }
        }
        List<String> planIds = rows.getContent().stream().map(AccessPassRepository.HolderRow::getUserPlanId).toList();
        Map<String, List<AccessPassGrant>> grantsByPlan = planIds.isEmpty() ? Map.of()
                : grantRepository.findByUserPlanIdIn(planIds).stream()
                        .filter(g -> GrantStatus.ACTIVE.name().equals(g.getStatus()))
                        .collect(Collectors.groupingBy(AccessPassGrant::getUserPlanId));

        return rows.map(r -> {
            UserDTO u = users.get(r.getUserId());
            List<AccessPassGrant> grants = grantsByPlan.getOrDefault(r.getUserPlanId(), List.of());
            return HolderResponse.builder()
                    .userPlanId(r.getUserPlanId())
                    .userId(r.getUserId())
                    .fullName(u != null ? u.getFullName() : null)
                    .email(u != null ? u.getEmail() : null)
                    .mobileNumber(u != null ? u.getMobileNumber() : null)
                    .planStatus(r.getStatus())
                    .startDate(str(r.getStartDate()))
                    .endDate(str(r.getEndDate()))
                    .autoRenewalEnabled(r.getAutoRenewalEnabled())
                    .purchasedAt(str(r.getCreatedAt()))
                    .grantedCourses((int) grants.stream().filter(g -> GrantType.GRANTED.name().equals(g.getGrantType())).count())
                    .coveredCourses((int) grants.stream().filter(g -> GrantType.COVERED.name().equals(g.getGrantType())).count())
                    .build();
        });
    }

    /** For the admin course list: which passes include each of these courses. */
    public List<CoursePassMembership> passesForCourses(CustomUserDetails user, String instituteId,
                                                       List<String> packageSessionIds) {
        accessValidator.requireInstituteStaff(user, instituteId);
        if (CollectionUtils.isEmpty(packageSessionIds)) {
            return List.of();
        }
        List<AccessPassItem> items = itemRepository.findByInstituteIdAndPackageSessionIdInAndStatus(instituteId,
                packageSessionIds, ItemStatus.ACTIVE.name());
        Map<String, AccessPass> passes = passRepository.findAllById(
                        items.stream().map(AccessPassItem::getAccessPassId).distinct().toList())
                .stream().filter(p -> !DELETED.equals(p.getStatus()))
                .collect(Collectors.toMap(AccessPass::getId, Function.identity()));
        return items.stream().filter(i -> passes.containsKey(i.getAccessPassId()))
                .map(i -> {
                    AccessPass p = passes.get(i.getAccessPassId());
                    return CoursePassMembership.builder().packageSessionId(i.getPackageSessionId())
                            .accessPassId(p.getId()).accessPassName(p.getName()).accessPassStatus(p.getStatus())
                            .build();
                }).toList();
    }

    // ─────────────────────────────── public ─────────────────────────────────────

    /** ACTIVE passes for catalogue cards, optionally filtered by one tag. */
    public List<AccessPassResponse> publicList(String instituteId, String tag) {
        // B2B passes reach learners through their sub-orgs, never the public catalogue.
        List<AccessPass> passes = passRepository.findByInstituteIdAndStatusInOrderByDisplayOrderAscCreatedAtDesc(
                        instituteId, List.of(AccessPassStatus.ACTIVE.name()))
                .stream().filter(p -> !isB2B(p)).toList();
        if (StringUtils.hasText(tag)) {
            String wanted = tag.trim().toLowerCase(Locale.ROOT);
            passes = passes.stream().filter(p -> splitTags(p.getTags()).stream()
                    .anyMatch(t -> t.toLowerCase(Locale.ROOT).equals(wanted))).toList();
        }
        return summaries(passes, false);
    }

    public AccessPassResponse publicBySlug(String instituteId, String slug) {
        AccessPass pass = passRepository.findFirstByInstituteIdAndSlugAndStatus(instituteId, slug,
                        AccessPassStatus.ACTIVE.name())
                .filter(p -> !isB2B(p))
                .orElseThrow(() -> new VacademyException("Access pass not found"));
        return detail(pass, false);
    }

    // ─────────────────────────────── invite plumbing ────────────────────────────

    private EnrollInvite createInvite(AccessPass pass, PaymentOption option, List<PackageSession> courses) {
        EnrollInvite invite = new EnrollInvite();
        invite.setName(pass.getName());
        invite.setInstituteId(pass.getInstituteId());
        invite.setStartDate(new java.sql.Date(System.currentTimeMillis()));
        invite.setEndDate(null);
        invite.setInviteCode(uniqueInviteCode(pass.getInstituteId()));
        // Sells only once the pass is published.
        invite.setStatus(StatusEnum.INACTIVE.name());
        invite.setTag(EnrollInviteTag.ACCESS_PASS.name());
        invite.setIsBundled(courses.size() > 1);
        invite.setCurrency(currencyOf(option));
        InstitutePaymentGatewayMappingService.VendorInfo vendor = institutePaymentGatewayMappingService
                .getLatestVendorInfoForInstitute(pass.getInstituteId());
        invite.setVendor(vendor.getVendor());
        invite.setVendorId(vendor.getVendorId());
        try {
            invite.setWebPageMetaDataJson(
                    enrollInviteCoursePreviewService.createPreview(courses.get(0).getId(), pass.getInstituteId()));
        } catch (Exception e) {
            log.warn("[access-pass] could not build invite preview for pass {}: {}", pass.getId(), e.getMessage());
        }
        invite = enrollInviteRepository.save(invite);

        String destination = learnerBaseUrl + learnerInvitePath + "?instituteId=" + invite.getInstituteId()
                + "&inviteCode=" + invite.getInviteCode();
        try {
            String shortUrl = shortUrlManagementService.createShortUrl(destination, SHORT_LINK_SOURCE_ENROLL_INVITE,
                    invite.getId(), invite.getInstituteId());
            if (shortUrl != null) {
                invite.setShortUrl(shortUrl);
                invite = enrollInviteRepository.save(invite);
            }
        } catch (Exception e) {
            log.warn("[access-pass] short URL failed for invite {}: {}", invite.getId(), e.getMessage());
        }
        // The enroll form collects the institute's default fields, as on any invite.
        instituteCustomFiledService.copyDefaultCustomFieldsToEnrollInvite(pass.getInstituteId(), invite.getId());

        createMappings(invite, option, courses);
        return invite;
    }

    private void createMappings(EnrollInvite invite, PaymentOption option, List<PackageSession> courses) {
        List<PackageSessionLearnerInvitationToPaymentOption> rows = courses.stream()
                .map(ps -> new PackageSessionLearnerInvitationToPaymentOption(invite, ps, option,
                        StatusEnum.ACTIVE.name()))
                .toList();
        mappingRepository.saveAll(rows);
    }

    /** Soft-delete the invite's ACTIVE mappings (all, or one course's). */
    private void retireActiveMappings(EnrollInvite invite, String onlyPackageSessionId) {
        List<PackageSessionLearnerInvitationToPaymentOption> active =
                mappingRepository.findByEnrollInviteAndStatusIn(invite, List.of(StatusEnum.ACTIVE.name()));
        List<String> ids = active.stream()
                .filter(m -> onlyPackageSessionId == null
                        || (m.getPackageSession() != null && onlyPackageSessionId.equals(m.getPackageSession().getId())))
                .map(PackageSessionLearnerInvitationToPaymentOption::getId)
                .toList();
        if (!ids.isEmpty()) {
            mappingRepository.updateStatusByIds(ids, StatusEnum.DELETED.name());
        }
    }

    private String uniqueInviteCode(String instituteId) {
        String chars = "abcdefghijklmnopqrstuvwxyz0123456789";
        SecureRandom random = new SecureRandom();
        for (int attempt = 0; attempt < 10; attempt++) {
            StringBuilder sb = new StringBuilder("ap");
            for (int i = 0; i < 6; i++) {
                sb.append(chars.charAt(random.nextInt(chars.length())));
            }
            String code = sb.toString();
            if (enrollInviteRepository.findValidEnrollInvite(
                    List.of(StatusEnum.ACTIVE.name(), StatusEnum.INACTIVE.name()), instituteId, code).isEmpty()) {
                return code;
            }
        }
        throw new VacademyException("Could not generate a unique invite code, please retry");
    }

    // ─────────────────────────────── read models ────────────────────────────────

    private List<AccessPassResponse> summaries(List<AccessPass> passes, boolean adminView) {
        if (passes.isEmpty()) {
            return List.of();
        }
        List<String> passIds = passes.stream().map(AccessPass::getId).toList();
        Map<String, Long> courseCounts = itemRepository.findByAccessPassIdInAndStatus(passIds, ItemStatus.ACTIVE.name())
                .stream().collect(Collectors.groupingBy(AccessPassItem::getAccessPassId, Collectors.counting()));
        Map<String, Long> holderCounts = new HashMap<>();
        if (adminView) {
            List<String> inviteIds = passes.stream().map(AccessPass::getEnrollInviteId).filter(Objects::nonNull).toList();
            if (!inviteIds.isEmpty()) {
                for (AccessPassRepository.HolderCountRow row : passRepository.countCurrentHolders(inviteIds,
                        new Timestamp(System.currentTimeMillis()))) {
                    holderCounts.put(row.getEnrollInviteId(), row.getHolderCount());
                }
            }
        }
        Map<String, EnrollInvite> invites = enrollInviteRepository.findAllById(
                        passes.stream().map(AccessPass::getEnrollInviteId).filter(Objects::nonNull).toList())
                .stream().collect(Collectors.toMap(EnrollInvite::getId, Function.identity()));

        List<AccessPassResponse> out = new ArrayList<>();
        for (AccessPass p : passes) {
            AccessPassResponse.AccessPassResponseBuilder b = base(p, invites.get(p.getEnrollInviteId()), adminView)
                    .courseCount(courseCounts.getOrDefault(p.getId(), 0L).intValue())
                    .price(priceOf(p.getPaymentOptionId()));
            if (adminView) {
                b.currentHolderCount(holderCounts.getOrDefault(p.getEnrollInviteId(), 0L));
            }
            out.add(b.build());
        }
        return out;
    }

    private AccessPassResponse detail(AccessPass p, boolean adminView) {
        List<AccessPassItem> items = itemRepository
                .findByAccessPassIdAndStatusOrderByDisplayOrderAscAddedAtAsc(p.getId(), ItemStatus.ACTIVE.name());
        Map<String, PackageSession> sessions = packageSessionRepository
                .findAllById(items.stream().map(AccessPassItem::getPackageSessionId).toList())
                .stream().collect(Collectors.toMap(PackageSession::getId, Function.identity()));
        List<ItemResponse> itemDtos = items.stream().map(i -> toItem(i, sessions.get(i.getPackageSessionId()))).toList();

        EnrollInvite invite = p.getEnrollInviteId() == null ? null
                : enrollInviteRepository.findById(p.getEnrollInviteId()).orElse(null);
        AccessPassResponse.AccessPassResponseBuilder b = base(p, invite, adminView)
                .description(p.getDescription())
                .items(itemDtos)
                .courseCount(itemDtos.size())
                .price(priceOf(p.getPaymentOptionId()));
        if (adminView && p.getEnrollInviteId() != null) {
            long holders = passRepository.countCurrentHolders(List.of(p.getEnrollInviteId()),
                            new Timestamp(System.currentTimeMillis()))
                    .stream().mapToLong(AccessPassRepository.HolderCountRow::getHolderCount).sum();
            b.currentHolderCount(holders);
        }
        return b.build();
    }

    private AccessPassResponse.AccessPassResponseBuilder base(AccessPass p, EnrollInvite invite, boolean adminView) {
        AccessPassResponse.AccessPassResponseBuilder b = AccessPassResponse.builder()
                .id(p.getId())
                .instituteId(p.getInstituteId())
                .name(p.getName())
                .slug(p.getSlug())
                .shortDescription(p.getShortDescription())
                .coverImageUrl(p.getCoverImageUrl())
                .tags(splitTags(p.getTags()))
                .status(p.getStatus())
                .audienceType(p.getAudienceType())
                .courseScope(p.getCourseScope())
                .displayOrder(p.getDisplayOrder())
                .enrollInviteId(p.getEnrollInviteId())
                .inviteCode(invite != null ? invite.getInviteCode() : null);
        if (invite != null && invite.getShortUrl() != null) {
            b.shortUrl(shortUrlManagementService.getAbsoluteShortUrl(p.getInstituteId(), invite.getShortUrl()));
        }
        if (adminView) {
            if (isB2B(p)) {
                b.subOrgCount(subOrgLinkRepository
                        .findByAccessPassIdAndStatusOrderByAssignedAtDesc(p.getId(), SubOrgLinkStatus.ACTIVE.name())
                        .size());
            }
            b.paymentOptionId(p.getPaymentOptionId())
                    .onItemRemoved(p.getOnItemRemoved())
                    .settingsJson(p.getSettingsJson())
                    .needsSync(p.getNeedsSync())
                    .lastSyncedAt(str(p.getLastSyncedAt()))
                    .createdAt(str(p.getCreatedAt()))
                    .updatedAt(str(p.getUpdatedAt()));
        }
        return b;
    }

    private ItemResponse toItem(AccessPassItem item, PackageSession ps) {
        ItemResponse.ItemResponseBuilder b = ItemResponse.builder()
                .packageSessionId(item.getPackageSessionId())
                .displayOrder(item.getDisplayOrder())
                .addedAt(str(item.getAddedAt()));
        if (ps != null) {
            if (ps.getPackageEntity() != null) {
                b.packageId(ps.getPackageEntity().getId())
                        .packageName(ps.getPackageEntity().getPackageName())
                        .thumbnailFileId(ps.getPackageEntity().getThumbnailFileId())
                        .coursePreviewImageMediaId(ps.getPackageEntity().getCoursePreviewImageMediaId());
            }
            if (ps.getLevel() != null && !"DEFAULT".equalsIgnoreCase(ps.getLevel().getId())) {
                b.levelName(ps.getLevel().getLevelName());
            }
            if (ps.getSession() != null && !"DEFAULT".equalsIgnoreCase(ps.getSession().getId())) {
                b.sessionName(ps.getSession().getSessionName());
            }
        }
        return b.build();
    }

    private PriceSummary priceOf(String paymentOptionId) {
        if (!StringUtils.hasText(paymentOptionId)) {
            return null;
        }
        try {
            PaymentOption option = paymentOptionService.findById(paymentOptionId);
            List<PaymentPlan> plans = Optional.ofNullable(option.getPaymentPlans()).orElse(List.of()).stream()
                    .filter(Objects::nonNull)
                    .filter(pl -> pl.getStatus() == null || StatusEnum.ACTIVE.name().equalsIgnoreCase(pl.getStatus()))
                    .toList();
            DoubleSummaryStatistics prices = plans.stream().mapToDouble(PaymentPlan::getActualPrice).summaryStatistics();
            return PriceSummary.builder()
                    .paymentOptionId(option.getId())
                    .paymentOptionName(option.getName())
                    .type(option.getType())
                    .minPrice(plans.isEmpty() ? null : prices.getMin())
                    .maxPrice(plans.isEmpty() ? null : prices.getMax())
                    .currency(currencyOf(option))
                    .minValidityInDays(plans.stream().map(PaymentPlan::getValidityInDays).filter(Objects::nonNull)
                            .min(Integer::compareTo).orElse(null))
                    .planCount(plans.size())
                    .build();
        } catch (Exception e) {
            log.warn("[access-pass] could not price payment option {}: {}", paymentOptionId, e.getMessage());
            return null;
        }
    }

    // ─────────────────────────────── validation / helpers ───────────────────────

    private AccessPass requirePass(String instituteId, String passId) {
        return passRepository.findByIdAndInstituteIdAndStatusNot(passId, instituteId, DELETED)
                .orElseThrow(() -> new VacademyException("Access pass not found"));
    }

    private EnrollInvite requireInvite(AccessPass pass) {
        if (pass.getEnrollInviteId() == null) {
            throw new VacademyException("Access pass " + pass.getId() + " has no invite");
        }
        return enrollInviteRepository.findById(pass.getEnrollInviteId())
                .orElseThrow(() -> new VacademyException("Invite of access pass " + pass.getId() + " is missing"));
    }

    private PaymentOption requirePaymentOption(String paymentOptionId, String instituteId) {
        if (!StringUtils.hasText(paymentOptionId)) {
            throw new VacademyException("payment_option_id is required");
        }
        PaymentOption option = paymentOptionService.findById(paymentOptionId);
        if (DELETED.equalsIgnoreCase(option.getStatus())) {
            throw new VacademyException("Payment option " + paymentOptionId + " is deleted");
        }
        // Institute-sourced options must be this institute's. (Options sourced from a
        // package session are checked through the course list below.)
        if ("INSTITUTE".equalsIgnoreCase(option.getSource()) && option.getSourceId() != null
                && !option.getSourceId().equals(instituteId)) {
            throw new VacademyException("Payment option does not belong to this institute");
        }
        return option;
    }

    private List<PackageSession> requireCourses(String instituteId, List<String> packageSessionIds) {
        List<String> ids = Optional.ofNullable(packageSessionIds).orElse(List.of()).stream()
                .filter(StringUtils::hasText).distinct().toList();
        if (ids.isEmpty()) {
            throw new VacademyException("Select at least one course");
        }
        Map<String, PackageSession> found = packageSessionRepository.findAllById(ids).stream()
                .collect(Collectors.toMap(PackageSession::getId, Function.identity()));
        List<PackageSession> out = new ArrayList<>();
        for (String id : ids) {
            PackageSession ps = found.get(id);
            if (ps == null || DELETED.equalsIgnoreCase(ps.getStatus())) {
                throw new VacademyException("Course batch not found: " + id);
            }
            String owner = packageSessionRepository.findInstituteIdByPackageSessionId(id).orElse(null);
            if (!instituteId.equals(owner)) {
                throw new VacademyException("Course batch " + id + " does not belong to this institute");
            }
            if (Boolean.TRUE.equals(ps.getIsOrgAssociated())) {
                // Org-associated batches create a sub-org per learner at enrollment, which a
                // later background grant cannot do.
                throw new VacademyException("Organisation batches cannot be part of an access pass: " + id);
            }
            out.add(ps);
        }
        return out;
    }

    /**
     * Course batches an ALL_COURSES pass covers: every ACTIVE batch of the institute.
     * INVITED batches (the placeholders paid checkouts park learners in), drafts, hidden
     * and deleted ones are out, and so are organisation batches (see requireCourses).
     */
    private List<PackageSession> eligibleInstituteCourses(String instituteId) {
        return packageSessionRepository
                .findPackageSessionsByInstituteId(instituteId, List.of(PackageSessionStatusEnum.ACTIVE.name()))
                .stream()
                .filter(ps -> !Boolean.TRUE.equals(ps.getIsOrgAssociated()))
                .sorted(Comparator.comparing(PackageSession::getId))
                .toList();
    }

    private void requireSelectedScope(AccessPass pass) {
        if (CourseScope.ALL_COURSES.name().equals(pass.getCourseScope())) {
            throw new VacademyException(
                    "This pass includes all courses automatically. Switch it to selected courses to edit the list.");
        }
    }

    static boolean isB2B(AccessPass pass) {
        return AudienceType.B2B.name().equals(pass.getAudienceType());
    }

    private static AudienceType parseAudience(String raw) {
        if (!StringUtils.hasText(raw)) {
            return AudienceType.B2C;
        }
        try {
            return AudienceType.valueOf(raw.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new VacademyException("audience_type must be B2C or B2B");
        }
    }

    private static CourseScope parseScope(String raw) {
        if (!StringUtils.hasText(raw)) {
            return CourseScope.SELECTED;
        }
        try {
            return CourseScope.valueOf(raw.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new VacademyException("course_scope must be SELECTED or ALL_COURSES");
        }
    }

    private List<String> activeCourseIds(String passId) {
        return itemRepository.findByAccessPassIdAndStatusOrderByDisplayOrderAscAddedAtAsc(passId,
                ItemStatus.ACTIVE.name()).stream().map(AccessPassItem::getPackageSessionId).toList();
    }

    private AccessPassItem newItem(AccessPass pass, String packageSessionId, int order, CustomUserDetails user,
                                   Timestamp now) {
        return AccessPassItem.builder()
                .accessPassId(pass.getId())
                .instituteId(pass.getInstituteId())
                .packageSessionId(packageSessionId)
                .status(ItemStatus.ACTIVE.name())
                .displayOrder(order)
                .addedBy(userId(user))
                .addedAt(now)
                .build();
    }

    private String uniqueSlug(String instituteId, String raw, String selfId) {
        String base = slugify(raw);
        if (base.isEmpty()) {
            base = "pass";
        }
        String candidate = base;
        for (int n = 2; n < 1000; n++) {
            Optional<AccessPass> clash = passRepository.findFirstByInstituteIdAndSlugAndStatusNot(instituteId, candidate,
                    DELETED);
            if (clash.isEmpty() || clash.get().getId().equals(selfId)) {
                return candidate;
            }
            candidate = base + "-" + n;
        }
        throw new VacademyException("Could not find a free slug for " + raw);
    }

    static String slugify(String raw) {
        String s = Normalizer.normalize(String.valueOf(raw), Normalizer.Form.NFD)
                .replaceAll("\\p{M}", "")
                .toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z0-9]+", "-")
                .replaceAll("(^-+)|(-+$)", "");
        return s.length() > 80 ? s.substring(0, 80).replaceAll("-+$", "") : s;
    }

    private static ItemRemovalPolicy parsePolicy(String raw) {
        if (!StringUtils.hasText(raw)) {
            return ItemRemovalPolicy.KEEP_FOR_EXISTING;
        }
        try {
            return ItemRemovalPolicy.valueOf(raw.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new VacademyException("on_item_removed must be KEEP_FOR_EXISTING or REVOKE");
        }
    }

    private static String currencyOf(PaymentOption option) {
        return Optional.ofNullable(option.getPaymentPlans()).orElse(List.of()).stream()
                .filter(Objects::nonNull).map(PaymentPlan::getCurrency).filter(StringUtils::hasText)
                .findFirst().orElse(null);
    }

    private static String joinTags(List<String> tags) {
        if (tags == null) {
            return null;
        }
        String joined = tags.stream().filter(StringUtils::hasText).map(String::trim).distinct()
                .collect(Collectors.joining(","));
        return joined.isEmpty() ? null : joined;
    }

    private static List<String> splitTags(String tags) {
        if (!StringUtils.hasText(tags)) {
            return List.of();
        }
        return Arrays.stream(tags.split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList();
    }

    private static String emptyToNull(String s) {
        return StringUtils.hasText(s) ? s : null;
    }

    private static String userId(CustomUserDetails user) {
        return user != null ? user.getUserId() : null;
    }

    private static String str(Date d) {
        return d == null ? null : new Timestamp(d.getTime()).toInstant().toString();
    }
}
