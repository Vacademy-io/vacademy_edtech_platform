package vacademy.io.admin_core_service.features.suborg.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.CollectionUtils;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.common.enums.StatusEnum;
import vacademy.io.admin_core_service.features.common.service.InstituteCustomFiledService;
import vacademy.io.admin_core_service.features.enroll_invite.dto.EnrollInviteSettingDTO;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.entity.PackageSessionLearnerInvitationToPaymentOption;
import vacademy.io.admin_core_service.features.enroll_invite.enums.EnrollInviteTag;
import vacademy.io.admin_core_service.features.enroll_invite.repository.EnrollInviteRepository;
import vacademy.io.admin_core_service.features.enroll_invite.repository.PackageSessionLearnerInvitationToPaymentOptionRepository;
import vacademy.io.admin_core_service.features.enroll_invite.service.PackageSessionEnrollInviteToPaymentOptionService;
import vacademy.io.admin_core_service.features.faculty.dto.AddUserAccessDTO;
import vacademy.io.admin_core_service.features.faculty.entity.FacultySubjectPackageSessionMapping;
import vacademy.io.admin_core_service.features.faculty.repository.FacultySubjectPackageSessionMappingRepository;
import vacademy.io.admin_core_service.features.faculty.service.FacultyService;
import vacademy.io.admin_core_service.features.fee_management.entity.ComplexPaymentOption;
import vacademy.io.admin_core_service.features.fee_management.repository.ComplexPaymentOptionRepository;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteTerminologyService;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteTerminologyService.Terms;
import vacademy.io.admin_core_service.features.institute_learner.enums.LearnerSessionStatusEnum;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.packages.service.PackageSessionService;
import vacademy.io.admin_core_service.features.suborg.dto.CreateSubOrgSubscriptionDTO;
import vacademy.io.admin_core_service.features.suborg.dto.CreateSubOrgSubscriptionResponseDTO;
import vacademy.io.admin_core_service.features.suborg.dto.SeatUsageDTO;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.enums.PaymentOptionType;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentOptionRepository;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentOptionService;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.common.institute.entity.session.PackageSession;

import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

@Slf4j
@Service
@RequiredArgsConstructor
public class SubOrgSubscriptionService {

    private final SubOrgManagementService subOrgManagementService;
    private final EnrollInviteRepository enrollInviteRepository;
    private final SubOrgSeatCapResolver seatCapResolver;
    private final PaymentOptionRepository paymentOptionRepository;
    private final PackageSessionService packageSessionService;
    private final PackageSessionEnrollInviteToPaymentOptionService packageSessionEnrollInviteToPaymentOptionService;
    private final PackageSessionLearnerInvitationToPaymentOptionRepository pslipoRepository;
    private final StudentSessionInstituteGroupMappingRepository mappingRepository;
    private final ComplexPaymentOptionRepository complexPaymentOptionRepository;
    private final PaymentOptionService paymentOptionService;
    private final InstituteCustomFiledService instituteCustomFiledService;
    private final FacultyService facultyService;
    private final FacultySubjectPackageSessionMappingRepository facultyMappingRepository;
    private final InstituteTerminologyService instituteTerminologyService;
    private final InstituteRepository instituteRepository;

    /**
     * Creates a sub-org with an org-level EnrollInvite that the sub-org admin
     * will pay via. This invite is tagged SUB_ORG and linked to the sub-org.
     */
    @Transactional
    public CreateSubOrgSubscriptionResponseDTO createSubOrgWithSubscription(
            CreateSubOrgSubscriptionDTO request, String parentInstituteId) {

        // 1. Create the sub-org (reuse existing logic)
        String subOrgId = subOrgManagementService.createSubOrg(
                request.getSubOrgDetails(), parentInstituteId);
        log.info("Created sub-org with ID: {}", subOrgId);

        // Institute terminology (Settings > Naming Settings) drives every name minted below,
        // so an institute that calls sub-orgs "Branches" and learners "Students" sees those
        // words on the invites it just created. Resolved once and threaded through.
        Terms terms = instituteTerminologyService.forInstitute(parentInstituteId);

        // 2. Create the org-level EnrollInvite
        EnrollInvite invite = new EnrollInvite();
        invite.setName(SubOrgNaming.orgInviteName(terms, request.getSubOrgDetails().getInstituteName()));
        invite.setTag(EnrollInviteTag.SUB_ORG.name());
        invite.setSubOrgId(subOrgId);
        invite.setStatus(StatusEnum.ACTIVE.name());
        invite.setInstituteId(parentInstituteId);
        invite.setInviteCode(generateInviteCode());
        invite.setIsBundled(request.getPackageSessionIds() != null
                && request.getPackageSessionIds().size() > 1);
        invite.setVendor(request.getVendor());
        invite.setVendorId(request.getVendorId());
        invite.setCurrency(request.getCurrency());
        invite.setLearnerAccessDays(request.getValidityInDays());

        // 3. Resolve PaymentOption.
        //    Non-CPO: fresh PaymentOption + fresh PaymentPlan with seat cap (existing flow).
        //    CPO: reuse the singleton mirror via findOrCreateMirrorForCpo — there's a
        //    UNIQUE constraint on payment_option.complex_payment_option_id, so a brand-new
        //    row collides when the same CPO has already been mirrored (e.g. by a prior
        //    sub-org or by the fee-management UI). Seat cap is carried on settingJson
        //    instead, since the synthetic plan is shared across sub-orgs.
        String paymentType = request.getPaymentType() != null ? request.getPaymentType() : "FREE";
        ComplexPaymentOption cpo = null;
        if (PaymentOptionType.CPO.name().equalsIgnoreCase(paymentType)) {
            if (request.getComplexPaymentOptionId() == null
                    || request.getComplexPaymentOptionId().isBlank()) {
                throw new VacademyException(
                        "complex_payment_option_id is required when payment_type=CPO");
            }
            cpo = complexPaymentOptionRepository
                    .findByIdAndStatusNot(request.getComplexPaymentOptionId(),
                            StatusEnum.DELETED.name())
                    .orElseThrow(() -> new VacademyException(
                            "Fee structure not found: " + request.getComplexPaymentOptionId()));
            if ("PENDING_APPROVAL".equalsIgnoreCase(cpo.getStatus())) {
                throw new VacademyException(
                        "Fee structure is pending approval and cannot back a sub-org subscription");
            }
        }

        // Non-CPO reuse: the admin pays via an EXISTING institute-level PaymentOption
        // (configured in Payment Settings, source=INSTITUTE) instead of a freshly-minted
        // one. Validate it here so a bad id fails fast before the sub-org/invite rows are
        // created. Null → legacy fresh-option path below.
        PaymentOption pickedOption = null;
        if (cpo == null && StringUtils.hasText(request.getPaymentOptionId())) {
            pickedOption = paymentOptionRepository.findById(request.getPaymentOptionId())
                    .orElseThrow(() -> new VacademyException(
                            "Payment option not found: " + request.getPaymentOptionId()));
            if (StatusEnum.DELETED.name().equalsIgnoreCase(pickedOption.getStatus())) {
                throw new VacademyException("Selected payment option is not active");
            }
            if (StringUtils.hasText(pickedOption.getSourceId())
                    && !parentInstituteId.equals(pickedOption.getSourceId())) {
                throw new VacademyException(
                        "Selected payment option does not belong to this institute");
            }
            // Carry the reused plan's currency onto the invite when the caller didn't send one.
            if (!StringUtils.hasText(invite.getCurrency())) {
                String planCurrency = firstActivePlanCurrency(pickedOption);
                if (StringUtils.hasText(planCurrency)) invite.setCurrency(planCurrency);
            }
        }

        // Build settingJson — authRoles for invite-time role override, memberCount for
        // sub-orgs that REUSE a shared PaymentOption (CPO mirror or a picked institute
        // option — neither's plan can carry a per-sub-org seat cap), and the allow-list
        // of custom roles the sub-org admin can assign when adding their own team members
        // (consumed by /manage-suborg-teams).
        boolean hasAuthRoles = !CollectionUtils.isEmpty(request.getAuthRoles());
        boolean reusingSharedOption = cpo != null || pickedOption != null;
        boolean carryMemberCount = reusingSharedOption && request.getMemberCount() != null;
        boolean hasAllowedTeamRoles = !CollectionUtils.isEmpty(request.getAllowedTeamRoles());
        boolean hasAdminPermissions = !CollectionUtils.isEmpty(request.getAdminPermissions());
        log.info("[ADMIN_PERMS] createSubOrg: adminPermissions received from request = {} (hasAdminPermissions={})",
                request.getAdminPermissions(), hasAdminPermissions);
        if (hasAuthRoles || carryMemberCount || hasAllowedTeamRoles || hasAdminPermissions) {
            try {
                EnrollInviteSettingDTO settingDTO = new EnrollInviteSettingDTO();
                EnrollInviteSettingDTO.Settings settings = new EnrollInviteSettingDTO.Settings();
                EnrollInviteSettingDTO.SubOrgSetting subOrgSetting = new EnrollInviteSettingDTO.SubOrgSetting();
                if (hasAuthRoles) subOrgSetting.setAuthRoles(request.getAuthRoles());
                if (carryMemberCount) subOrgSetting.setMemberCount(request.getMemberCount());
                if (hasAllowedTeamRoles) subOrgSetting.setAllowedTeamRoles(request.getAllowedTeamRoles());
                if (hasAdminPermissions) subOrgSetting.setAdminPermissions(request.getAdminPermissions());
                settings.setSubOrgSetting(subOrgSetting);
                settingDTO.setSetting(settings);
                ObjectMapper mapper = new ObjectMapper();
                String serialized = mapper.writeValueAsString(settingDTO);
                invite.setSettingJson(serialized);
                log.info("[ADMIN_PERMS] createSubOrg: serialized settingJson = {}", serialized);
            } catch (Exception e) {
                log.warn("Failed to serialize sub-org settings: {}", e.getMessage());
            }
        }

        invite = enrollInviteRepository.save(invite);
        log.info("Created org-level EnrollInvite id={} for sub-org={}", invite.getId(), subOrgId);

        // Seed this invite with the institute's default custom fields — same
        // institute-driven mechanism every other system-created invite uses
        // (DefaultEnrollInviteService / BulkCourseService). Server-created sub-org
        // invites have no admin UI to pick fields, so without this they end up with
        // none and the learner form falls back to a duplicate-laden field set.
        instituteCustomFiledService.copyDefaultCustomFieldsToEnrollInvite(parentInstituteId, invite.getId());

        PaymentOption option;
        if (cpo != null) {
            // Reuse the singleton mirror. Idempotent — handles "this CPO already has a mirror".
            option = paymentOptionService.findOrCreateMirrorForCpo(cpo);
            log.info("Reusing CPO mirror PaymentOption id={} for cpoId={}",
                    option.getId(), cpo.getId());
        } else if (pickedOption != null) {
            // Reuse the institute-level option the admin selected. Its PaymentPlan holds
            // the real price; the per-sub-org seat cap rides on settingJson.MEMBER_COUNT
            // (see createScopedFreeInvites fallback). No fresh option/plan minted.
            option = pickedOption;
            log.info("Reusing institute PaymentOption id={} type={} for sub-org admin payment",
                    option.getId(), option.getType());
        } else {
            option = new PaymentOption();
            option.setName(SubOrgNaming.adminPaymentOptionName(
                    terms, request.getSubOrgDetails().getInstituteName()));
            option.setType(paymentType);
            option.setTag("DEFAULT");
            option.setStatus(StatusEnum.ACTIVE.name());
            option.setRequireApproval(false);
            option = paymentOptionRepository.save(option);
            log.info("Created PaymentOption id={} type={}", option.getId(), option.getType());

            // 4. Per-sub-org PaymentPlan carries the seat cap for the non-CPO path.
            PaymentPlan plan = new PaymentPlan();
            plan.setName(SubOrgNaming.adminPaymentPlanName(terms));
            plan.setStatus(StatusEnum.ACTIVE.name());
            plan.setActualPrice(request.getActualPrice() != null ? request.getActualPrice() : 0);
            plan.setElevatedPrice(request.getElevatedPrice() != null ? request.getElevatedPrice() : 0);
            plan.setCurrency(request.getCurrency());
            plan.setTag("DEFAULT");
            plan.setMemberCount(request.getMemberCount());
            plan.setValidityInDays(request.getValidityInDays());
            plan.setPaymentOption(option);
            option.getPaymentPlans().add(plan);
            paymentOptionRepository.save(option);
            log.info("Created PaymentPlan with memberCount={}", request.getMemberCount());
        }

        // 5. Link invite to each package session
        if (!CollectionUtils.isEmpty(request.getPackageSessionIds())) {
            List<PackageSessionLearnerInvitationToPaymentOption> mappings = new ArrayList<>();
            for (String psId : request.getPackageSessionIds()) {
                PackageSession ps = packageSessionService.findById(psId);
                PackageSessionLearnerInvitationToPaymentOption mapping =
                        new PackageSessionLearnerInvitationToPaymentOption(
                                invite, ps, option, StatusEnum.ACTIVE.name());
                mappings.add(mapping);
            }
            packageSessionEnrollInviteToPaymentOptionService
                    .createPackageSessionLearnerInvitationToPaymentOptions(mappings);
            log.info("Linked invite to {} package sessions", mappings.size());
        }

        // 6. Create SUBORG_LEARNER invites per (PS × distinct institute-wide PaymentOption).
        // The parent institute may have several invites for the same PS — one per payment
        // mode (FREE / ONE_TIME / SUBSCRIPTION / CPO). Mirroring all of them gives sub-org
        // learners the same range of choices their institute already offers.
        //
        // Fallback: if a PS has no institute-wide PaymentOptions linked yet, we still create
        // a single SUBORG_LEARNER invite using the admin's `option` so the sub-org keeps a
        // baseline learner-enrollment path.
        if (!CollectionUtils.isEmpty(request.getPackageSessionIds())) {
            int created = 0;
            for (String psId : request.getPackageSessionIds()) {
                PackageSession ps = packageSessionService.findById(psId);
                created += mirrorSuborgLearnerInvitesForPs(
                        subOrgId, parentInstituteId, ps, option, request);
            }
            log.info("Created {} SUBORG_LEARNER invite(s) across {} PS(es) for sub-org={}",
                    created, request.getPackageSessionIds().size(), subOrgId);
        }

        return CreateSubOrgSubscriptionResponseDTO.builder()
                .subOrgId(subOrgId)
                .enrollInviteId(invite.getId())
                .inviteCode(invite.getInviteCode())
                .shortUrl(invite.getShortUrl())
                .build();
    }

    /**
     * Auto-creates scoped FREE invites for each package session linked to
     * the org-level invite. Called after the sub-org admin pays.
     */
    @Transactional
    public void createScopedFreeInvites(EnrollInvite orgInvite, UserPlan orgUserPlan,
                                         PaymentPlan orgPlan) {
        String subOrgId = orgInvite.getSubOrgId();
        String instituteId = orgInvite.getInstituteId();
        Terms terms = instituteTerminologyService.forInstitute(instituteId);

        // The sub-org's own cap. A shared option's plan (CPO synthetic or a picked institute
        // option) says nothing about this sub-org, so settingJson.MEMBER_COUNT beats it.
        Integer settingMemberCount = readSubOrgMemberCountFromSettings(orgInvite);

        // Find all package sessions linked to the org-level invite
        List<PackageSessionLearnerInvitationToPaymentOption> orgMappings =
                packageSessionEnrollInviteToPaymentOptionService.findByInvite(orgInvite);

        if (CollectionUtils.isEmpty(orgMappings)) {
            log.warn("No package sessions linked to org invite {}. Skipping scoped invite creation.",
                    orgInvite.getId());
            return;
        }

        for (PackageSessionLearnerInvitationToPaymentOption orgMapping : orgMappings) {
            PackageSession ps = orgMapping.getPackageSession();
            if (ps == null) continue;

            // Check if scoped invite already exists for this sub-org + package session
            if (enrollInviteRepository.findScopedInviteForSubOrgAndPackageSession(
                    subOrgId, ps.getId()).isPresent()) {
                log.info("Scoped invite already exists for sub-org={}, ps={}. Skipping.",
                        subOrgId, ps.getId());
                continue;
            }

            // Create scoped FREE invite
            EnrollInvite scopedInvite = new EnrollInvite();
            scopedInvite.setName(SubOrgNaming.scopedInviteName(
                    terms, ps.getPackageEntity() != null ? ps.getPackageEntity().getPackageName() : null));
            scopedInvite.setTag(EnrollInviteTag.SUB_ORG.name());
            scopedInvite.setSubOrgId(subOrgId);
            scopedInvite.setStatus(StatusEnum.ACTIVE.name());
            scopedInvite.setInstituteId(instituteId);
            scopedInvite.setInviteCode(generateInviteCode());
            scopedInvite.setIsBundled(false);
            scopedInvite.setLearnerAccessDays(
                    orgPlan != null ? orgPlan.getValidityInDays() : orgInvite.getLearnerAccessDays());
            scopedInvite = enrollInviteRepository.save(scopedInvite);
            instituteCustomFiledService.copyDefaultCustomFieldsToEnrollInvite(instituteId, scopedInvite.getId());

            // Create FREE PaymentOption
            PaymentOption freeOption = new PaymentOption();
            freeOption.setName(SubOrgNaming.freePaymentOptionName(terms));
            freeOption.setType("FREE");
            freeOption.setTag("DEFAULT");
            freeOption.setStatus(StatusEnum.ACTIVE.name());
            freeOption.setRequireApproval(false);
            freeOption = paymentOptionRepository.save(freeOption);

            // Create PaymentPlan with seat cap from org plan
            PaymentPlan freePlan = new PaymentPlan();
            freePlan.setName(SubOrgNaming.freePaymentPlanName(terms));
            freePlan.setStatus(StatusEnum.ACTIVE.name());
            freePlan.setActualPrice(0);
            freePlan.setElevatedPrice(0);
            freePlan.setTag("DEFAULT");
            Integer planMemberCount = orgPlan != null ? orgPlan.getMemberCount() : null;
            freePlan.setMemberCount(settingMemberCount != null ? settingMemberCount : planMemberCount);
            freePlan.setValidityInDays(orgPlan != null ? orgPlan.getValidityInDays()
                    : orgInvite.getLearnerAccessDays());
            freePlan.setPaymentOption(freeOption);
            freeOption.getPaymentPlans().add(freePlan);
            paymentOptionRepository.save(freeOption);

            // Link scoped invite to package session
            PackageSessionLearnerInvitationToPaymentOption link =
                    new PackageSessionLearnerInvitationToPaymentOption(
                            scopedInvite, ps, freeOption, StatusEnum.ACTIVE.name());
            packageSessionEnrollInviteToPaymentOptionService
                    .createPackageSessionLearnerInvitationToPaymentOptions(List.of(link));

            log.info("Created scoped FREE invite id={} for sub-org={}, ps={}",
                    scopedInvite.getId(), subOrgId, ps.getId());
        }
    }

    /**
     * Returns seat usage for a sub-org in a specific package session.
     */
    public SeatUsageDTO getSeatUsage(String subOrgId, String packageSessionId) {
        PackageSession ps = packageSessionService.findById(packageSessionId);

        long usedSeats = mappingRepository.countBySubOrgIdAndPackageSessionIdAndStatus(
                subOrgId, packageSessionId, LearnerSessionStatusEnum.ACTIVE.name());

        // Find the scoped invite's plan to get totalSeats
        PaymentPlan scopedPlan = null;
        Optional<EnrollInvite> scopedInvite = enrollInviteRepository
                .findScopedInviteForSubOrgAndPackageSession(subOrgId, packageSessionId);
        if (scopedInvite.isPresent()) {
            List<PackageSessionLearnerInvitationToPaymentOption> inviteMappings =
                    packageSessionEnrollInviteToPaymentOptionService.findByInvite(scopedInvite.get());
            for (PackageSessionLearnerInvitationToPaymentOption mapping : inviteMappings) {
                if (mapping.getPaymentOption() != null
                        && mapping.getPaymentOption().getPaymentPlans() != null) {
                    for (PaymentPlan plan : mapping.getPaymentOption().getPaymentPlans()) {
                        if (plan.getMemberCount() != null) {
                            scopedPlan = plan;
                            break;
                        }
                    }
                }
                if (scopedPlan != null) break;
            }
        }
        Integer totalSeats = seatCapResolver.resolve(subOrgId,
                scopedInvite.map(EnrollInvite::getInstituteId).orElse(null), scopedPlan);

        return SeatUsageDTO.builder()
                .packageSessionId(packageSessionId)
                .packageName(ps.getPackageEntity() != null
                        ? ps.getPackageEntity().getPackageName() : null)
                .usedSeats(usedSeats)
                .totalSeats(totalSeats)
                .build();
    }

    /**
     * Deactivates all scoped FREE invites for a sub-org (called on org plan expiry).
     */
    @Transactional
    public void deactivateScopedInvites(String subOrgId, String instituteId) {
        List<EnrollInvite> scopedInvites = enrollInviteRepository
                .findBySubOrgIdAndInstituteId(subOrgId, instituteId,
                        List.of(StatusEnum.ACTIVE.name()));

        for (EnrollInvite invite : scopedInvites) {
            invite.setStatus(StatusEnum.DELETED.name());
            enrollInviteRepository.save(invite);
            log.info("Deactivated scoped invite id={} for sub-org={}", invite.getId(), subOrgId);
        }
    }

    /**
     * Replaces the ALLOWED_TEAM_ROLES list on the sub-org's org-level invite settingJson.
     * Idempotent. Pass an empty list to clear the restriction.
     */
    @Transactional
    public List<String> updateAllowedTeamRoles(String subOrgId, String parentInstituteId,
                                               List<String> allowedRoles) {
        if (!StringUtils.hasText(subOrgId)) {
            throw new VacademyException("sub_org_id is required");
        }
        if (!StringUtils.hasText(parentInstituteId)) {
            throw new VacademyException("parent_institute_id is required");
        }
        // findOrgLevelSubOrgInvite picks the settings-bearing invite (the original
        // org-level one), not a scoped FREE invite that shares the same tag/sub_org_id.
        EnrollInvite invite = findOrgLevelSubOrgInvite(subOrgId, parentInstituteId)
                .orElseThrow(() -> new VacademyException(
                        "No active org-level invite found for sub-org " + subOrgId));

        ObjectMapper mapper = new ObjectMapper();
        EnrollInviteSettingDTO dto;
        try {
            dto = StringUtils.hasText(invite.getSettingJson())
                    ? mapper.readValue(invite.getSettingJson(), EnrollInviteSettingDTO.class)
                    : new EnrollInviteSettingDTO();
        } catch (Exception e) {
            log.warn("Could not parse existing settingJson for invite {}; recreating", invite.getId());
            dto = new EnrollInviteSettingDTO();
        }
        if (dto.getSetting() == null) dto.setSetting(new EnrollInviteSettingDTO.Settings());
        EnrollInviteSettingDTO.SubOrgSetting subSetting = dto.getSetting().getSubOrgSetting();
        if (subSetting == null) {
            subSetting = new EnrollInviteSettingDTO.SubOrgSetting();
            dto.getSetting().setSubOrgSetting(subSetting);
        }
        subSetting.setAllowedTeamRoles(allowedRoles);

        try {
            invite.setSettingJson(mapper.writeValueAsString(dto));
            enrollInviteRepository.save(invite);
        } catch (Exception e) {
            throw new VacademyException("Failed to persist allowed_team_roles: " + e.getMessage());
        }
        log.info("Updated allowed_team_roles for sub-org={} to {}", subOrgId, allowedRoles);
        return allowedRoles != null ? allowedRoles : List.of();
    }

    /**
     * Create the SUBORG_LEARNER mirror invites for a single PS: one mirror per distinct
     * institute-wide PaymentOption linked to the PS. Idempotent — skips PaymentOptions
     * that are already covered by an existing SUBORG_LEARNER invite for this sub-org/PS,
     * so calling this from both initial create AND the re-sync endpoint is safe.
     *
     * Source set = PSLIPO rows on this PS where {@code ei.sub_org_id IS NULL} (i.e. the
     * parent institute's invites, not the sub-org's own). Falls back to {@code fallbackOption}
     * only when (a) the source set is empty AND (b) the sub-org has no existing
     * SUBORG_LEARNER invite for this PS — that preserves the original "always at least one
     * learner invite" guarantee without doubling up.
     *
     * @return the number of new invites created.
     */
    @Transactional
    public int mirrorSuborgLearnerInvitesForPs(String subOrgId, String parentInstituteId,
                                                PackageSession ps, PaymentOption fallbackOption,
                                                CreateSubOrgSubscriptionDTO request) {
        if (ps == null) return 0;
        String psId = ps.getId();
        String psLabel = buildPsLabel(ps);

        // 1. Existing SUBORG_LEARNER mirrors for this (sub-org, PS) → PaymentOption ids already covered.
        Set<String> coveredOptionIds = new HashSet<>();
        boolean hasAnyExistingMirror = false;
        List<String> existingInviteIds = enrollInviteRepository
                .findInviteIdsForSubOrgAndPackageSession(subOrgId, psId);
        if (!existingInviteIds.isEmpty()) {
            for (String inviteId : existingInviteIds) {
                EnrollInvite existing = enrollInviteRepository.findById(inviteId).orElse(null);
                if (existing == null) continue;
                if (!EnrollInviteTag.SUBORG_LEARNER.name().equals(existing.getTag())) continue;
                hasAnyExistingMirror = true;
                for (PackageSessionLearnerInvitationToPaymentOption link
                        : packageSessionEnrollInviteToPaymentOptionService.findByInvite(existing)) {
                    if (link.getPaymentOption() != null) {
                        coveredOptionIds.add(link.getPaymentOption().getId());
                    }
                }
            }
        }

        // 2. Institute-wide PaymentOptions linked to this PS (dedupe by PaymentOption.id).
        List<PackageSessionLearnerInvitationToPaymentOption> sourceLinks =
                pslipoRepository.findActiveByPackageSessionIdsAndInstituteId(
                        List.of(psId), parentInstituteId);
        Map<String, PaymentOption> distinctSourceOptions = new LinkedHashMap<>();
        for (PackageSessionLearnerInvitationToPaymentOption link : sourceLinks) {
            EnrollInvite ei = link.getEnrollInvite();
            if (ei == null) continue;
            // Skip the sub-org's own invites — only mirror parent-institute invites.
            if (StringUtils.hasText(ei.getSubOrgId())) continue;
            PaymentOption opt = link.getPaymentOption();
            if (opt == null) continue;
            distinctSourceOptions.putIfAbsent(opt.getId(), opt);
        }

        int created = 0;
        for (PaymentOption sourceOption : distinctSourceOptions.values()) {
            if (coveredOptionIds.contains(sourceOption.getId())) continue;
            createSuborgLearnerInvite(subOrgId, parentInstituteId, ps, psLabel,
                    sourceOption, request);
            created++;
        }

        // Fallback: nothing institute-wide AND no existing mirror — keep the legacy guarantee.
        if (created == 0 && distinctSourceOptions.isEmpty() && !hasAnyExistingMirror
                && fallbackOption != null) {
            createSuborgLearnerInvite(subOrgId, parentInstituteId, ps, psLabel,
                    fallbackOption, request);
            created = 1;
        }
        return created;
    }

    private void createSuborgLearnerInvite(String subOrgId, String parentInstituteId,
                                           PackageSession ps, String psLabel,
                                           PaymentOption option, CreateSubOrgSubscriptionDTO request) {
        EnrollInvite learnerInvite = new EnrollInvite();
        String optionLabel = option != null && StringUtils.hasText(option.getType())
                ? option.getType() : "DEFAULT";
        Terms terms = instituteTerminologyService.forInstitute(parentInstituteId);
        learnerInvite.setName(SubOrgNaming.learnerInviteName(terms, psLabel, optionLabel));
        learnerInvite.setTag(EnrollInviteTag.SUBORG_LEARNER.name());
        learnerInvite.setSubOrgId(subOrgId);
        learnerInvite.setStatus(StatusEnum.ACTIVE.name());
        learnerInvite.setInstituteId(parentInstituteId);
        learnerInvite.setInviteCode(generateInviteCode());
        learnerInvite.setIsBundled(false);
        if (request != null) {
            learnerInvite.setVendor(request.getVendor());
            learnerInvite.setVendorId(request.getVendorId());
            learnerInvite.setCurrency(request.getCurrency());
            learnerInvite.setLearnerAccessDays(request.getValidityInDays());
        }
        learnerInvite = enrollInviteRepository.save(learnerInvite);
        instituteCustomFiledService.copyDefaultCustomFieldsToEnrollInvite(parentInstituteId, learnerInvite.getId());

        PackageSessionLearnerInvitationToPaymentOption link =
                new PackageSessionLearnerInvitationToPaymentOption(
                        learnerInvite, ps, option, StatusEnum.ACTIVE.name());
        packageSessionEnrollInviteToPaymentOptionService
                .createPackageSessionLearnerInvitationToPaymentOptions(List.of(link));
        log.info("Created SUBORG_LEARNER invite id={} name='{}' for sub-org={}, PS={}, option={}",
                learnerInvite.getId(), learnerInvite.getName(), subOrgId, ps.getId(),
                option != null ? option.getId() : "null");
    }

    /**
     * Re-runs the SUBORG_LEARNER mirror logic across every PS already linked to the
     * sub-org's org-level invite. Idempotent — only creates invites for PaymentOptions
     * that aren't already mirrored. Used by the "Re-sync invites" button on the deep
     * page when the institute admin adds new institute-wide invites after the sub-org
     * was first created.
     */
    @Transactional
    public Map<String, Object> resyncSuborgLearnerInvites(String subOrgId, String parentInstituteId) {
        if (!StringUtils.hasText(subOrgId) || !StringUtils.hasText(parentInstituteId)) {
            throw new VacademyException("sub_org_id and parent_institute_id are required");
        }
        // Pick the original org-level invite (the one with settingJson + PSLIPO rows),
        // not a scoped FREE invite that shares the same tag/sub_org_id.
        EnrollInvite orgInvite = findOrgLevelSubOrgInvite(subOrgId, parentInstituteId)
                .orElseThrow(() -> new VacademyException(
                        "No active org-level invite found for sub-org " + subOrgId));

        // Pull every PS this sub-org has from the org invite's PSLIPOs.
        List<PackageSessionLearnerInvitationToPaymentOption> orgLinks =
                packageSessionEnrollInviteToPaymentOptionService.findByInvite(orgInvite);
        Map<String, PackageSession> psById = new LinkedHashMap<>();
        PaymentOption fallback = null;
        for (PackageSessionLearnerInvitationToPaymentOption link : orgLinks) {
            if (link.getPackageSession() != null) {
                psById.putIfAbsent(link.getPackageSession().getId(), link.getPackageSession());
            }
            if (fallback == null && link.getPaymentOption() != null) {
                fallback = link.getPaymentOption();
            }
        }

        int totalCreated = 0;
        for (PackageSession ps : psById.values()) {
            totalCreated += mirrorSuborgLearnerInvitesForPs(
                    subOrgId, parentInstituteId, ps, fallback, null);
        }

        // Re-apply the institute's CURRENT terminology to invites created earlier. Names are
        // written once at creation, so an institute that renames "Sub-Org" to "Branch" after
        // its sub-orgs exist would otherwise keep the old wording forever. Re-sync is the
        // deliberate "push the rename through" action.
        int totalRenamed = backfillSubOrgInviteNames(subOrgId, parentInstituteId, orgInvite.getId());

        Map<String, Object> result = new HashMap<>();
        result.put("sub_org_id", subOrgId);
        result.put("created_count", totalCreated);
        result.put("renamed_count", totalRenamed);
        result.put("package_session_count", psById.size());
        log.info("Re-synced SUBORG_LEARNER invites for sub-org={}: created={} renamed={} across {} PSes",
                subOrgId, totalCreated, totalRenamed, psById.size());
        return result;
    }

    /**
     * Rewrite every existing sub-org invite name using the institute's current
     * Naming Settings terminology. Regenerates through {@link SubOrgNaming} — the same
     * builders creation uses — so a re-synced name is byte-identical to a freshly created
     * one. Only rows whose name still matches a system-generated shape are touched; a name
     * that has drifted from the pattern is assumed hand-edited and left alone.
     *
     * <p>Scope is deliberately invites only. PaymentOption/PaymentPlan rows are NOT renamed
     * here because the sub-org flows can reuse an institute-level PaymentOption
     * ({@code pickedOption}) shared with non-sub-org invites — renaming it would rewrite a
     * label the rest of the institute depends on. Those pick up new terminology on creation.
     *
     * @return the number of invites actually renamed.
     */
    private int backfillSubOrgInviteNames(String subOrgId, String parentInstituteId, String orgInviteId) {
        Terms terms = instituteTerminologyService.forInstitute(parentInstituteId);
        String subOrgName = subOrgDisplayName(subOrgId);

        List<EnrollInvite> invites = enrollInviteRepository.findBySubOrgIdAndInstituteIdAndTags(
                subOrgId, parentInstituteId,
                List.of(EnrollInviteTag.SUB_ORG.name(), EnrollInviteTag.SUBORG_LEARNER.name()),
                List.of(StatusEnum.ACTIVE.name()));

        int renamed = 0;
        for (EnrollInvite invite : invites) {
            String desired = desiredInviteName(invite, terms, subOrgName, orgInviteId);
            if (desired == null || desired.equals(invite.getName())) continue;
            if (!looksSystemGenerated(invite.getName())) {
                log.info("Skipping rename of invite id={} — name '{}' looks hand-edited",
                        invite.getId(), invite.getName());
                continue;
            }
            log.info("Renaming sub-org invite id={} '{}' -> '{}'",
                    invite.getId(), invite.getName(), desired);
            invite.setName(desired);
            enrollInviteRepository.save(invite);
            renamed++;
        }
        return renamed;
    }

    /** The name this invite WOULD get if it were created right now; null when unknown. */
    private String desiredInviteName(EnrollInvite invite, Terms terms,
                                     String subOrgName, String orgInviteId) {
        if (EnrollInviteTag.SUBORG_LEARNER.name().equals(invite.getTag())) {
            for (PackageSessionLearnerInvitationToPaymentOption link
                    : packageSessionEnrollInviteToPaymentOptionService.findByInvite(invite)) {
                if (link.getPackageSession() == null) continue;
                PaymentOption opt = link.getPaymentOption();
                String optionLabel = opt != null && StringUtils.hasText(opt.getType())
                        ? opt.getType() : "DEFAULT";
                return SubOrgNaming.learnerInviteName(
                        terms, buildPsLabel(link.getPackageSession()), optionLabel);
            }
            return null;
        }
        if (EnrollInviteTag.SUB_ORG.name().equals(invite.getTag())) {
            // The org-level invite is named after the sub-org; the scoped FREE invites
            // minted per package session are named after their course.
            if (invite.getId() != null && invite.getId().equals(orgInviteId)) {
                return SubOrgNaming.orgInviteName(terms, subOrgName);
            }
            for (PackageSessionLearnerInvitationToPaymentOption link
                    : packageSessionEnrollInviteToPaymentOptionService.findByInvite(invite)) {
                PackageSession ps = link.getPackageSession();
                if (ps == null || ps.getPackageEntity() == null) continue;
                return SubOrgNaming.scopedInviteName(terms, ps.getPackageEntity().getPackageName());
            }
            return null;
        }
        return null;
    }

    /**
     * True when the stored name still looks like something these flows minted, under EITHER
     * the built-in defaults or any terminology the institute has used. Matching on the
     * structural suffix (" Subscription: ", " Access: ", " — ") rather than the leading term
     * means a rename from "Sub-Org" to "Branch" and back is still recognised, while a fully
     * hand-written name is not — so re-sync can never clobber an admin's own wording.
     */
    private boolean looksSystemGenerated(String name) {
        if (!StringUtils.hasText(name)) return true;
        return name.contains(" Subscription: ")
                || name.contains(" Access: ")
                || name.contains(" — ");
    }

    /** Display name of the sub-org (a child institute); falls back to its id. */
    private String subOrgDisplayName(String subOrgId) {
        try {
            return instituteRepository.findById(subOrgId)
                    .map(Institute::getInstituteName)
                    .filter(StringUtils::hasText)
                    .orElse(subOrgId);
        } catch (Exception e) {
            log.warn("Could not load sub-org {} for naming; using id", subOrgId, e);
            return subOrgId;
        }
    }

    /**
     * Reads the persisted ADMIN_PERMISSIONS list for a sub-org's org-level invite and
     * returns it as a CSV (the shape FSPSSM.access_permission expects). Falls back to
     * {@code "FULL"} when the setting is missing — keeps every pre-existing sub-org on
     * the legacy permission set without a migration.
     *
     * Looks up the FIRST active org-level invite for (subOrgId, parentInstituteId).
     * Sub-orgs only ever have one org-level invite (see createSubOrgWithSubscription),
     * so this is fine; if that invariant ever changes, prefer the most recent one.
     */
    /**
     * Pick the *original* org-level SUB_ORG invite for a sub-org — the one created at
     * sub-org creation that carries the settingJson with AUTH_ROLES / MEMBER_COUNT /
     * ALLOWED_TEAM_ROLES / ADMIN_PERMISSIONS. After the admin pays, {@link #createScopedFreeInvites}
     * creates additional SUB_ORG-tagged invites (one per PS, settingJson=null). The
     * default repository query returns them all ordered by created_at DESC, so a naive
     * {@code candidates.get(0)} lands on a scoped FREE invite and the resolver loses
     * the admin's configured permissions. This helper filters to the one that actually
     * carries settings; if multiple are present we take the oldest (the original).
     */
    private Optional<EnrollInvite> findOrgLevelSubOrgInvite(String subOrgId, String parentInstituteId) {
        List<EnrollInvite> candidates = enrollInviteRepository
                .findBySubOrgIdAndInstituteId(subOrgId, parentInstituteId,
                        List.of(StatusEnum.ACTIVE.name()));
        if (candidates.isEmpty()) return Optional.empty();
        // Prefer invites with a non-blank settingJson (the org-level one) — earliest first
        // because the original is the oldest. Fall back to the most-recent invite of any
        // shape so legacy sub-orgs (created before settingJson existed) still resolve to
        // a row callers can update.
        EnrollInvite withSettings = candidates.stream()
                .filter(i -> StringUtils.hasText(i.getSettingJson()))
                .min(java.util.Comparator.comparing(
                        EnrollInvite::getCreatedAt,
                        java.util.Comparator.nullsLast(java.util.Comparator.naturalOrder())))
                .orElse(null);
        if (withSettings != null) return Optional.of(withSettings);
        return Optional.of(candidates.get(0));
    }

    public String resolveAdminPermissionCsv(String subOrgId, String parentInstituteId) {
        if (!StringUtils.hasText(subOrgId) || !StringUtils.hasText(parentInstituteId)) {
            log.warn("[ADMIN_PERMS] resolve called with blank subOrgId='{}' or instituteId='{}', defaulting to FULL",
                    subOrgId, parentInstituteId);
            return "FULL";
        }
        EnrollInvite invite = findOrgLevelSubOrgInvite(subOrgId, parentInstituteId).orElse(null);
        if (invite == null) {
            log.warn("[ADMIN_PERMS] No ACTIVE SUB_ORG invite for subOrg={} institute={}; defaulting to FULL",
                    subOrgId, parentInstituteId);
            return "FULL";
        }
        if (!StringUtils.hasText(invite.getSettingJson())) {
            log.warn("[ADMIN_PERMS] Invite {} (subOrg={}) has no settingJson; defaulting to FULL",
                    invite.getId(), subOrgId);
            return "FULL";
        }
        try {
            EnrollInviteSettingDTO dto = new ObjectMapper()
                    .readValue(invite.getSettingJson(), EnrollInviteSettingDTO.class);
            List<String> perms = Optional.ofNullable(dto)
                    .map(EnrollInviteSettingDTO::getSetting)
                    .map(EnrollInviteSettingDTO.Settings::getSubOrgSetting)
                    .map(EnrollInviteSettingDTO.SubOrgSetting::getAdminPermissions)
                    .orElse(null);
            if (CollectionUtils.isEmpty(perms)) {
                log.warn("[ADMIN_PERMS] settingJson for invite {} (subOrg={}) has no ADMIN_PERMISSIONS list; "
                                + "defaulting to FULL. settingJson dump: {}",
                        invite.getId(), subOrgId, invite.getSettingJson());
                return "FULL";
            }
            String csv = String.join(",", perms);
            log.info("[ADMIN_PERMS] Resolved CSV='{}' for subOrg={} from invite {}",
                    csv, subOrgId, invite.getId());
            return csv;
        } catch (Exception e) {
            log.warn("[ADMIN_PERMS] Could not parse ADMIN_PERMISSIONS for invite {} (subOrg={}): {}; settingJson: {}",
                    invite.getId(), subOrgId, e.getMessage(), invite.getSettingJson());
            return "FULL";
        }
    }

    /**
     * Replaces the ADMIN_PERMISSIONS list on the sub-org's org-level invite settingJson.
     * Mirrors {@link #updateAllowedTeamRoles}. Pass null / empty to clear (so the runtime
     * falls back to "FULL"). NOTE: existing FSPSSM rows are NOT rewritten — the new value
     * only applies to admin users enrolled after this call. We can add a back-fill later
     * if the edit UX needs it.
     */
    @Transactional
    public List<String> updateAdminPermissions(String subOrgId, String parentInstituteId,
                                               List<String> adminPermissions) {
        if (!StringUtils.hasText(subOrgId)) {
            throw new VacademyException("sub_org_id is required");
        }
        if (!StringUtils.hasText(parentInstituteId)) {
            throw new VacademyException("parent_institute_id is required");
        }
        // findOrgLevelSubOrgInvite picks the settings-bearing invite (the original
        // org-level one), not a scoped FREE invite that shares the same tag/sub_org_id.
        EnrollInvite invite = findOrgLevelSubOrgInvite(subOrgId, parentInstituteId)
                .orElseThrow(() -> new VacademyException(
                        "No active org-level invite found for sub-org " + subOrgId));

        ObjectMapper mapper = new ObjectMapper();
        EnrollInviteSettingDTO dto;
        try {
            dto = StringUtils.hasText(invite.getSettingJson())
                    ? mapper.readValue(invite.getSettingJson(), EnrollInviteSettingDTO.class)
                    : new EnrollInviteSettingDTO();
        } catch (Exception e) {
            log.warn("Could not parse existing settingJson for invite {}; recreating", invite.getId());
            dto = new EnrollInviteSettingDTO();
        }
        if (dto.getSetting() == null) dto.setSetting(new EnrollInviteSettingDTO.Settings());
        EnrollInviteSettingDTO.SubOrgSetting subSetting = dto.getSetting().getSubOrgSetting();
        if (subSetting == null) {
            subSetting = new EnrollInviteSettingDTO.SubOrgSetting();
            dto.getSetting().setSubOrgSetting(subSetting);
        }
        subSetting.setAdminPermissions(adminPermissions);

        try {
            invite.setSettingJson(mapper.writeValueAsString(dto));
            enrollInviteRepository.save(invite);
        } catch (Exception e) {
            throw new VacademyException("Failed to persist admin_permissions: " + e.getMessage());
        }
        log.info("Updated admin_permissions for sub-org={} to {}", subOrgId, adminPermissions);
        return adminPermissions != null ? adminPermissions : List.of();
    }

    /**
     * Link additional package sessions to an existing sub-org. Add-only: removing a PS
     * is intentionally not supported here because it would orphan already-enrolled
     * learners' access path. Idempotent — PSes already linked are silently skipped.
     *
     * For each new PS we:
     *   1. Add a PSLIPO row on the org-level invite using the SAME PaymentOption the
     *      admin currently has (so the seat cap and CPO ledger don't get duplicated).
     *   2. Run {@link #mirrorSuborgLearnerInvitesForPs} so the SUBORG_LEARNER side picks
     *      up every institute-wide payment option for the new PS (same as create-time).
     *
     * @return list of PS ids that were actually added (not the full requested set).
     */
    @Transactional
    public List<String> addSubOrgPackageSessions(String subOrgId, String parentInstituteId,
                                                  List<String> psIds) {
        if (!StringUtils.hasText(subOrgId) || !StringUtils.hasText(parentInstituteId)) {
            throw new VacademyException("sub_org_id and parent_institute_id are required");
        }
        if (CollectionUtils.isEmpty(psIds)) return List.of();

        // Original org-level invite (settings-bearing), not a scoped FREE invite.
        EnrollInvite orgInvite = findOrgLevelSubOrgInvite(subOrgId, parentInstituteId)
                .orElseThrow(() -> new VacademyException(
                        "No active org-level invite found for sub-org " + subOrgId));

        // Resolve the admin's PaymentOption from any existing PSLIPO on the org invite.
        // We deliberately reuse it (not a fresh option) so a CPO-backed sub-org keeps a
        // SINGLE mirror across all PSes — the seat cap + ledger live on that one option.
        List<PackageSessionLearnerInvitationToPaymentOption> existingLinks =
                packageSessionEnrollInviteToPaymentOptionService.findByInvite(orgInvite);
        PaymentOption adminOption = null;
        Set<String> alreadyLinkedPsIds = new HashSet<>();
        for (PackageSessionLearnerInvitationToPaymentOption link : existingLinks) {
            if (link.getPackageSession() != null) {
                alreadyLinkedPsIds.add(link.getPackageSession().getId());
            }
            if (adminOption == null && link.getPaymentOption() != null) {
                adminOption = link.getPaymentOption();
            }
        }
        if (adminOption == null) {
            throw new VacademyException(
                    "Sub-org has no payment option on its org-level invite; cannot add courses");
        }

        List<String> added = new ArrayList<>();
        for (String psId : psIds) {
            if (!StringUtils.hasText(psId)) continue;
            if (alreadyLinkedPsIds.contains(psId)) continue;

            PackageSession ps;
            try {
                ps = packageSessionService.findById(psId);
            } catch (Exception e) {
                log.warn("Skipping unknown package_session_id={} while adding to sub-org={}",
                        psId, subOrgId);
                continue;
            }
            if (ps == null) continue;

            // 1. PSLIPO on the org-level invite.
            PackageSessionLearnerInvitationToPaymentOption link =
                    new PackageSessionLearnerInvitationToPaymentOption(
                            orgInvite, ps, adminOption, StatusEnum.ACTIVE.name());
            packageSessionEnrollInviteToPaymentOptionService
                    .createPackageSessionLearnerInvitationToPaymentOptions(List.of(link));

            // 2. SUBORG_LEARNER mirrors for the new PS.
            mirrorSuborgLearnerInvitesForPs(subOrgId, parentInstituteId, ps, adminOption, null);

            // 3. Grant the sub-org's existing team members (admins/teachers) FSPSSM access to
            //    the new PS. Without this the course is linked to the invite (parent-side
            //    management sees it) but stays invisible on the sub-org end, whose course
            //    visibility is driven by SUB_ORG-linked FSPSSM rows. Create-time and
            //    add-team-member already write these; add-course must backfill them too.
            grantExistingTeamMembersAccessToPs(subOrgId, psId);

            // org invite's is_bundled flag flips on when it owns more than one PS.
            if (!Boolean.TRUE.equals(orgInvite.getIsBundled())) {
                orgInvite.setIsBundled(true);
                enrollInviteRepository.save(orgInvite);
            }
            added.add(psId);
            log.info("Linked PS {} to sub-org {} via org invite {}", psId, subOrgId, orgInvite.getId());
        }
        return added;
    }

    /**
     * Grant every existing team member of {@code subOrgId} SUB_ORG-linked FSPSSM access to a
     * newly-added package session, mirroring what create-time / add-team-member write:
     * one PACKAGE_SESSION row plus one ENROLL_INVITE row per active invite (org-level +
     * SUBORG_LEARNER mirrors) linked to the (sub-org, PS) pair. The sub-org end resolves
     * course visibility from these rows, so skipping this is exactly why an added course
     * shows up parent-side but not on the sub-org end. Idempotent: a (access_type, access_id)
     * the member already holds for this PS is not re-created. Must run AFTER the mirror
     * invites exist so {@code findInviteIdsForSubOrgAndPackageSession} can see them.
     */
    private void grantExistingTeamMembersAccessToPs(String subOrgId, String psId) {
        List<String> userIds = facultyMappingRepository
                .findDistinctUserIdsBySubOrgIdAndLinkage(subOrgId, List.of(StatusEnum.ACTIVE.name()));
        if (CollectionUtils.isEmpty(userIds)) return;

        List<String> inviteIds = enrollInviteRepository
                .findInviteIdsForSubOrgAndPackageSession(subOrgId, psId);

        int grantedMembers = 0;
        for (String userId : userIds) {
            List<FacultySubjectPackageSessionMapping> existing =
                    facultyMappingRepository.findByUserIdAndSubOrgIdAndLinkage(userId, subOrgId);

            // Reuse the member's own identity + permission from any live existing row.
            FacultySubjectPackageSessionMapping ref = existing.stream()
                    .filter(f -> !StatusEnum.DELETED.name().equalsIgnoreCase(f.getStatus()))
                    .findFirst().orElse(null);
            if (ref == null) continue;
            String name = ref.getName();
            String userType = ref.getUserType();
            String perm = StringUtils.hasText(ref.getAccessPermission()) ? ref.getAccessPermission() : "FULL";

            // Idempotency: what this member already holds for THIS package session.
            Set<String> have = new HashSet<>();
            for (FacultySubjectPackageSessionMapping f : existing) {
                if (!StatusEnum.DELETED.name().equalsIgnoreCase(f.getStatus())
                        && psId.equals(f.getPackageSessionId())) {
                    have.add(f.getAccessType() + "::" + f.getAccessId());
                }
            }

            if (!have.contains("PACKAGE_SESSION::" + psId)) {
                facultyService.grantUserAccess(buildSubOrgAccess(
                        userId, name, userType, perm, subOrgId, psId, "PACKAGE_SESSION", psId));
            }
            for (String inviteId : inviteIds) {
                if (have.contains("ENROLL_INVITE::" + inviteId)) continue;
                facultyService.grantUserAccess(buildSubOrgAccess(
                        userId, name, userType, perm, subOrgId, psId, "ENROLL_INVITE", inviteId));
            }
            grantedMembers++;
        }
        log.info("Backfilled sub-org FSPSSM access for {} team member(s) on PS {} of sub-org {}",
                grantedMembers, psId, subOrgId);
    }

    private AddUserAccessDTO buildSubOrgAccess(String userId, String name, String userType,
                                               String accessPermission, String subOrgId, String psId,
                                               String accessType, String accessId) {
        return AddUserAccessDTO.builder()
                .userId(userId)
                .packageSessionId(psId)
                .name(name)
                .status("ACTIVE")
                .userType(userType)
                .accessType(accessType)
                .accessId(accessId)
                .accessPermission(accessPermission)
                .linkageType("SUB_ORG")
                .suborgId(subOrgId)
                .build();
    }

    /**
     * Consolidated config update for a sub-org. Each field is optional — only present
     * fields are applied. Mirrors what {@link #createSubOrgWithSubscription} writes, so
     * the Edit Sub-Org modal can edit anything settable at create. Returns a map of the
     * applied changes (for toast feedback on the FE).
     *
     * Editable today:
     *   - auth_roles            → settingJson.AUTH_ROLES
     *   - allowed_team_roles    → settingJson.ALLOWED_TEAM_ROLES
     *   - admin_permissions     → settingJson.ADMIN_PERMISSIONS (CSV applied to new FSPSSM rows)
     *   - member_count          → settingJson.MEMBER_COUNT (CPO) AND/OR org invite's PaymentPlan.memberCount (non-CPO)
     *   - validity_in_days      → org invite.learnerAccessDays + PaymentPlan.validityInDays
     *
     * NOT YET editable (deferred — too entangled with already-enrolled UserPlans):
     *   - linked package sessions (PSLIPO add/remove)
     *   - CPO swap (would require migrating the admin's UserPlan to a new mirror)
     */
    @Transactional
    public Map<String, Object> updateSubOrgConfiguration(String subOrgId, String parentInstituteId,
                                                         Map<String, Object> body) {
        if (!StringUtils.hasText(subOrgId) || !StringUtils.hasText(parentInstituteId)) {
            throw new VacademyException("sub_org_id and parent_institute_id are required");
        }
        // Pick the original org-level invite (settings-bearing), not a scoped FREE invite.
        EnrollInvite invite = findOrgLevelSubOrgInvite(subOrgId, parentInstituteId)
                .orElseThrow(() -> new VacademyException(
                        "No active org-level invite found for sub-org " + subOrgId));

        ObjectMapper mapper = new ObjectMapper();
        EnrollInviteSettingDTO dto;
        try {
            dto = StringUtils.hasText(invite.getSettingJson())
                    ? mapper.readValue(invite.getSettingJson(), EnrollInviteSettingDTO.class)
                    : new EnrollInviteSettingDTO();
        } catch (Exception e) {
            log.warn("Could not parse existing settingJson for invite {}; recreating", invite.getId());
            dto = new EnrollInviteSettingDTO();
        }
        if (dto.getSetting() == null) dto.setSetting(new EnrollInviteSettingDTO.Settings());
        EnrollInviteSettingDTO.SubOrgSetting subSetting = dto.getSetting().getSubOrgSetting();
        if (subSetting == null) {
            subSetting = new EnrollInviteSettingDTO.SubOrgSetting();
            dto.getSetting().setSubOrgSetting(subSetting);
        }

        Map<String, Object> applied = new HashMap<>();

        // Add-only PS linking. Removal is deliberately not supported here (would orphan
        // already-enrolled learners). Returns the actual added subset so the FE toast
        // tells the admin exactly what got linked vs. what was skipped as duplicate.
        if (body.containsKey("add_package_session_ids")) {
            List<String> toAdd = stringList(body.get("add_package_session_ids"));
            if (!toAdd.isEmpty()) {
                List<String> addedIds = addSubOrgPackageSessions(subOrgId, parentInstituteId, toAdd);
                applied.put("added_package_session_ids", addedIds);
            }
        }

        // Swap the PaymentOption backing the sub-org admin's payment collection. Rewrites
        // the org-level invite's PSLIPO rows to point at the newly chosen institute option.
        // Affects FUTURE admin enrollments only — an admin who already accepted the invite
        // keeps the PaymentOption snapshotted on their UserPlan.
        if (body.containsKey("payment_option_id")) {
            String newOptionId = body.get("payment_option_id") != null
                    ? String.valueOf(body.get("payment_option_id")) : null;
            if (StringUtils.hasText(newOptionId)) {
                PaymentOption newOption = paymentOptionRepository.findById(newOptionId)
                        .orElseThrow(() -> new VacademyException(
                                "Payment option not found: " + newOptionId));
                if (StatusEnum.DELETED.name().equalsIgnoreCase(newOption.getStatus())) {
                    throw new VacademyException("Selected payment option is not active");
                }
                // CPO mirrors carry the institute id on the underlying CPO, not on sourceId;
                // only enforce the institute check for plain institute options.
                if (StringUtils.hasText(newOption.getSourceId())
                        && !parentInstituteId.equals(newOption.getSourceId())
                        && newOption.getComplexPaymentOptionId() == null) {
                    throw new VacademyException(
                            "Selected payment option does not belong to this institute");
                }
                List<PackageSessionLearnerInvitationToPaymentOption> orgLinks =
                        packageSessionEnrollInviteToPaymentOptionService.findByInvite(invite);
                for (PackageSessionLearnerInvitationToPaymentOption link : orgLinks) {
                    link.setPaymentOption(newOption);
                    pslipoRepository.save(link);
                }
                String planCurrency = firstActivePlanCurrency(newOption);
                if (StringUtils.hasText(planCurrency)) invite.setCurrency(planCurrency);
                applied.put("payment_option_id", newOptionId);
                log.info("Swapped sub-org {} admin payment option to {} across {} PSLIPO row(s)",
                        subOrgId, newOptionId, orgLinks.size());
            }
        }

        if (body.containsKey("auth_roles")) {
            List<String> roles = stringList(body.get("auth_roles"));
            subSetting.setAuthRoles(roles);
            applied.put("auth_roles", roles);
        }
        if (body.containsKey("allowed_team_roles")) {
            List<String> roles = stringList(body.get("allowed_team_roles"));
            subSetting.setAllowedTeamRoles(roles);
            applied.put("allowed_team_roles", roles);
        }
        if (body.containsKey("admin_permissions")) {
            List<String> perms = stringList(body.get("admin_permissions"));
            subSetting.setAdminPermissions(perms);
            applied.put("admin_permissions", perms);
        }

        Integer newMemberCount = body.containsKey("member_count")
                ? toInt(body.get("member_count")) : null;
        Integer newValidity = body.containsKey("validity_in_days")
                ? toInt(body.get("validity_in_days")) : null;

        // Both seat cap and validity also live on the PaymentPlan for sub-orgs that own a
        // DEDICATED (freshly-minted) PaymentPlan. We MUST NOT touch the plan of a SHARED
        // option — a CPO synthetic plan (reused by every sub-org on that CPO) or an
        // institute-level option (source=INSTITUTE, reused by the institute's own learners).
        // For those, rely on settingJson and let createScopedFreeInvites read MEMBER_COUNT.
        PaymentOption orgOption = null;
        for (PackageSessionLearnerInvitationToPaymentOption link
                : packageSessionEnrollInviteToPaymentOptionService.findByInvite(invite)) {
            if (link.getPaymentOption() != null) {
                orgOption = link.getPaymentOption();
                break;
            }
        }
        boolean sharedOption = orgOption != null
                && (PaymentOptionType.CPO.name().equalsIgnoreCase(orgOption.getType())
                    || orgOption.getComplexPaymentOptionId() != null
                    || "INSTITUTE".equalsIgnoreCase(orgOption.getSource()));

        if (newMemberCount != null) {
            // Always write to settingJson so scoped FREE invites pick it up.
            subSetting.setMemberCount(newMemberCount);
            applied.put("member_count", newMemberCount);
        }
        if (newValidity != null) {
            invite.setLearnerAccessDays(newValidity);
            applied.put("validity_in_days", newValidity);
        }

        // Persist settingJson (always — even when only member_count/validity changed we may
        // have lazily-initialised the subOrgSetting block above and want to keep it).
        try {
            invite.setSettingJson(mapper.writeValueAsString(dto));
        } catch (Exception e) {
            throw new VacademyException("Failed to serialize updated settings: " + e.getMessage());
        }
        enrollInviteRepository.save(invite);

        // Update the DEDICATED PaymentPlan when present so the existing seat-cap reads
        // (which still query PaymentPlan.memberCount) reflect the new value. Skipped for
        // shared options — their plan is owned by the institute / a CPO, not this sub-org.
        if (!sharedOption && orgOption != null && orgOption.getPaymentPlans() != null) {
            for (PaymentPlan plan : orgOption.getPaymentPlans()) {
                if (!StatusEnum.ACTIVE.name().equals(plan.getStatus())) continue;
                boolean planChanged = false;
                if (newMemberCount != null) {
                    plan.setMemberCount(newMemberCount);
                    planChanged = true;
                }
                if (newValidity != null) {
                    plan.setValidityInDays(newValidity);
                    planChanged = true;
                }
                if (planChanged) {
                    paymentOptionRepository.save(orgOption);
                    break;
                }
            }
        }
        log.info("Updated sub-org {} configuration: {}", subOrgId, applied.keySet());
        return applied;
    }

    private List<String> stringList(Object raw) {
        List<String> out = new ArrayList<>();
        if (raw instanceof List<?> list) {
            for (Object o : list) {
                if (o != null) out.add(String.valueOf(o));
            }
        }
        return out;
    }

    private Integer toInt(Object raw) {
        if (raw == null) return null;
        if (raw instanceof Number n) return n.intValue();
        try {
            return Integer.parseInt(String.valueOf(raw));
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /** Currency of the option's first ACTIVE PaymentPlan, or null when none carries one. */
    private String firstActivePlanCurrency(PaymentOption option) {
        if (option == null || option.getPaymentPlans() == null) return null;
        for (PaymentPlan plan : option.getPaymentPlans()) {
            if (plan == null) continue;
            if (!StatusEnum.ACTIVE.name().equalsIgnoreCase(plan.getStatus())) continue;
            if (StringUtils.hasText(plan.getCurrency())) return plan.getCurrency();
        }
        return null;
    }

    private Integer readSubOrgMemberCountFromSettings(EnrollInvite invite) {
        if (invite == null || !StringUtils.hasText(invite.getSettingJson())) return null;
        try {
            EnrollInviteSettingDTO dto = new ObjectMapper()
                    .readValue(invite.getSettingJson(), EnrollInviteSettingDTO.class);
            return Optional.ofNullable(dto)
                    .map(EnrollInviteSettingDTO::getSetting)
                    .map(EnrollInviteSettingDTO.Settings::getSubOrgSetting)
                    .map(EnrollInviteSettingDTO.SubOrgSetting::getMemberCount)
                    .orElse(null);
        } catch (Exception e) {
            log.debug("Could not read MEMBER_COUNT from settingJson for invite {}: {}",
                    invite.getId(), e.getMessage());
            return null;
        }
    }

    /**
     * Builds a human-friendly PS label for invite naming, joining package / level / session
     * with " · " separators. Falls back to the PS id when nothing else is available.
     */
    private String buildPsLabel(PackageSession ps) {
        if (ps == null) return "unknown";
        String pkg = ps.getPackageEntity() != null ? ps.getPackageEntity().getPackageName() : null;
        String level = ps.getLevel() != null ? ps.getLevel().getLevelName() : null;
        String session = ps.getSession() != null ? ps.getSession().getSessionName() : null;
        StringBuilder sb = new StringBuilder();
        if (StringUtils.hasText(pkg)) sb.append(pkg);
        if (StringUtils.hasText(level)) {
            if (sb.length() > 0) sb.append(" · ");
            sb.append(level);
        }
        if (StringUtils.hasText(session)) {
            if (sb.length() > 0) sb.append(" · ");
            sb.append(session);
        }
        return sb.length() > 0 ? sb.toString() : ps.getId();
    }

    private String generateInviteCode() {
        String chars = "abcdefghijklmnopqrstuvwxyz0123456789";
        SecureRandom random = new SecureRandom();
        StringBuilder sb = new StringBuilder(6);
        for (int i = 0; i < 6; i++) {
            sb.append(chars.charAt(random.nextInt(chars.length())));
        }
        return sb.toString();
    }
}
