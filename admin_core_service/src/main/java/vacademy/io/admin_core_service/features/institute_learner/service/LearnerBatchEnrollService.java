package vacademy.io.admin_core_service.features.institute_learner.service;

import jakarta.transaction.Transactional;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.common.enums.CustomFieldTypeEnum;
import vacademy.io.admin_core_service.features.common.enums.CustomFieldValueSourceTypeEnum;
import vacademy.io.admin_core_service.features.common.service.CustomFieldValueService;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.service.SubOrgService;
import vacademy.io.admin_core_service.features.institute_learner.dto.InstituteStudentDetails;
import vacademy.io.admin_core_service.features.institute_learner.dto.StudentExtraDetails;
import vacademy.io.admin_core_service.features.institute_learner.entity.Student;
import vacademy.io.admin_core_service.features.institute_learner.entity.StudentSessionInstituteGroupMapping;
import vacademy.io.admin_core_service.features.institute_learner.enums.LearnerSessionStatusEnum;
import vacademy.io.admin_core_service.features.institute_learner.enums.LearnerSessionTypeEnum;
import vacademy.io.admin_core_service.features.institute_learner.enums.LearnerStatusEnum;
import vacademy.io.admin_core_service.features.institute_learner.manager.StudentRegistrationManager;
import vacademy.io.admin_core_service.features.institute_learner.repository.InstituteStudentRepository;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionRepository;
import vacademy.io.admin_core_service.features.institute_learner.dto.BulkLearnerApprovalRequestDTO;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.service.ReferralMappingService;
import vacademy.io.admin_core_service.features.user_subscription.service.UserPlanService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.dto.learner.LearnerExtraDetails;
import vacademy.io.common.common.dto.CustomFieldValueDTO;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.common.institute.entity.session.PackageSession;

import java.util.List;
import java.util.Map;
import java.util.Optional;

@Service
@Slf4j
public class LearnerBatchEnrollService {

    @Autowired
    private InstituteStudentRepository instituteStudentRepository;

    @Autowired
    private StudentRegistrationManager studentRegistrationManager;

    @Autowired
    private CustomFieldValueService customFieldValueService;

    @Autowired
    private StudentSessionRepository studentSessionRepository;

    @Autowired
    private UserPlanService userPlanService;

    @Autowired
    private ReferralMappingService referralMappingService;

    @Autowired
    private AuthService authService;

    @Autowired
    private PackageSessionRepository packageSessionRepository;

    @Autowired
    private SubOrgService subOrgService;

    @Autowired
    private InstituteRepository instituteRepository;

    @Transactional
    public UserDTO checkAndCreateStudentAndAddToBatch(UserDTO userDTO,
            String instituteId,
            List<InstituteStudentDetails> instituteStudentDetails,
            List<CustomFieldValueDTO> customFieldValues,
            Map<String, Object> extraData,
            LearnerExtraDetails learnerExtraDetails,
            EnrollInvite enrollInvite) {
        return checkAndCreateStudentAndAddToBatch(userDTO, instituteId, instituteStudentDetails,
                customFieldValues, extraData, learnerExtraDetails, enrollInvite, null);
    }

    @Transactional
    public UserDTO checkAndCreateStudentAndAddToBatch(UserDTO userDTO,
            String instituteId,
            List<InstituteStudentDetails> instituteStudentDetails,
            List<CustomFieldValueDTO> customFieldValues,
            Map<String, Object> extraData,
            LearnerExtraDetails learnerExtraDetails,
            EnrollInvite enrollInvite,
            UserPlan userPlan) {
        UserDTO createdUser = studentRegistrationManager.createUserFromAuthService(userDTO, instituteId, false);
        Student student = studentRegistrationManager.createStudentFromRequest(createdUser,
                mapToStudentExtraDetails(learnerExtraDetails));

        if (userPlan != null) {
            boolean isPending = vacademy.io.admin_core_service.features.user_subscription.enums.UserPlanStatusEnum.PENDING
                    .name().equals(userPlan.getStatus());
            boolean isFutureDated = userPlan.getStartDate() != null
                    && userPlan.getStartDate().after(new java.util.Date());

            if (isPending || isFutureDated) {
                log.info("UserPlan is Stacked (Status: {}, StartDate: {}). Skipping batch enrollment for user: {}",
                        userPlan.getStatus(), userPlan.getStartDate(), userDTO.getId());
                return createdUser;
            }
        }

        Institute existingSubOrg = null;

        if (userPlan != null && StringUtils.hasText(userPlan.getSubOrgId())) {
            Optional<Institute> subOrgOpt = instituteRepository.findById(userPlan.getSubOrgId());
            if (subOrgOpt.isPresent()) {
                existingSubOrg = subOrgOpt.get();
                log.info("Reusing existing SubOrg with ID: {} from UserPlan", existingSubOrg.getId());
            } else {
                log.warn("SubOrg ID {} from UserPlan not found in repository", userPlan.getSubOrgId());
            }
        }

        for (InstituteStudentDetails instituteStudentDetail : instituteStudentDetails) {
            PackageSession packageSession = null;
            if (StringUtils.hasText(instituteStudentDetail.getDestinationPackageSessionId())) {
                packageSession = packageSessionRepository
                        .findById(instituteStudentDetail.getDestinationPackageSessionId()).get();
            } else {
                packageSession = packageSessionRepository.findById(instituteStudentDetail.getPackageSessionId()).get();
            }
            Institute suborg = null;
            if (packageSession.getIsOrgAssociated()) {
                // If we have an existing SubOrg from UserPlan, use it; otherwise create/get one
                if (existingSubOrg != null) {
                    suborg = existingSubOrg;
                    log.info("Using SubOrg from UserPlan for package session: {}", packageSession.getId());
                } else {
                    suborg = subOrgService.createOrGetSubOrg(customFieldValues, enrollInvite.getSettingJson(),
                            userDTO.getId(), packageSession.getId(), instituteId);
                }
                String commaSepratedRoles = subOrgService.getRoles(customFieldValues, enrollInvite.getSettingJson());
                if (suborg == null || !StringUtils.hasText(commaSepratedRoles)) {
                    throw new VacademyException("Sub Org can not be created. Data not passed!!!");
                }
                instituteStudentDetail.setSubOrgId(suborg.getId());
                instituteStudentDetail.setCommaSeparatedOrgRoles(commaSepratedRoles);
            }
            String studentSessionId = studentRegistrationManager.linkStudentToInstitute(student,
                    instituteStudentDetail);
            if (instituteStudentDetail.getEnrollmentStatus().equalsIgnoreCase(LearnerSessionStatusEnum.ACTIVE.name())) {
                studentRegistrationManager.triggerEnrollmentWorkflow(instituteId, userDTO,
                        instituteStudentDetail.getPackageSessionId(), suborg,
                        userPlan != null ? userPlan.getId() : null);
            }
            customFieldValueService.addCustomFieldValue(customFieldValues,
                    CustomFieldValueSourceTypeEnum.STUDENT_SESSION_INSTITUTE_GROUP_MAPPING.name(), studentSessionId);
            customFieldValueService.addCustomFieldValue(customFieldValues, CustomFieldValueSourceTypeEnum.USER.name(),
                    userDTO.getId());
        }
        return createdUser;
    }

    private StudentExtraDetails mapToStudentExtraDetails(LearnerExtraDetails learnerExtraDetails) {
        if (learnerExtraDetails == null) {
            return null;
        }
        StudentExtraDetails studentExtraDetails = new StudentExtraDetails();
        studentExtraDetails.setFathersName(learnerExtraDetails.getFathersName());
        studentExtraDetails.setMothersName(learnerExtraDetails.getMothersName());
        studentExtraDetails.setParentsMobileNumber(learnerExtraDetails.getParentsMobileNumber());
        studentExtraDetails.setParentsEmail(learnerExtraDetails.getParentsEmail());
        studentExtraDetails.setParentsToMotherMobileNumber(learnerExtraDetails.getParentsToMotherMobileNumber());
        studentExtraDetails.setParentsToMotherEmail(learnerExtraDetails.getParentsToMotherEmail());
        studentExtraDetails.setLinkedInstituteName(learnerExtraDetails.getLinkedInstituteName());
        studentExtraDetails.setBillingContactName(learnerExtraDetails.getBillingContactName());
        studentExtraDetails.setBillingContactEmail(learnerExtraDetails.getBillingContactEmail());
        studentExtraDetails.setBillingContactRole(learnerExtraDetails.getBillingContactRole());
        return studentExtraDetails;
    }

    public int shiftLearnerFromInvitedToActivePackageSessions(List<String> packageSessionIds, String userId,
            String enrollInviteId) {
        return shiftLearnerToActiveStatus(packageSessionIds, userId, enrollInviteId, LearnerStatusEnum.INVITED, null);
    }

    /**
     * Payment-confirmation variant: {@code paidUserPlanId} is the plan the payment
     * actually landed on, and it is stamped onto the resulting ACTIVE mapping.
     * Without it the mapping inherits the plan id of whatever INVITED row happens
     * to be shifted — for a learner who retried a failed checkout that is the
     * first (PAYMENT_FAILED) plan, not the paid one.
     */
    public int shiftLearnerFromInvitedToActivePackageSessions(List<String> packageSessionIds, String userId,
            String enrollInviteId, String paidUserPlanId) {
        return shiftLearnerToActiveStatus(packageSessionIds, userId, enrollInviteId, LearnerStatusEnum.INVITED,
                paidUserPlanId);
    }

    /**
     * Revives a LAPSED membership for a learner who has paid but holds no ACTIVE enrollment and
     * has nothing left to shift.
     *
     * <p>Needed because {@code shiftLearnerToActiveStatus} only PROMOTES existing INVITED /
     * ABANDONED_CART rows. A learner whose trial ran and was revoked has neither: August's
     * enrollment consumed the INVITED row, and the abandoned-cart rows were deleted when a
     * payment succeeded. So the repair that was supposed to catch a paid-but-unenrolled member
     * shifted nothing and reported success, which is the failure it was written to prevent
     * (Nitika Maheshwari, 2026-10-04 — her mapping had to be inserted by hand).
     *
     * <p>Revives the learner's most recent row in these package sessions whatever its status,
     * rather than creating a parallel one: that keeps their enrollment number, sub-org and roles.
     * Expiry comes from the plan's own end_date, which the renewal has already extended, so the
     * access window and the plan can never disagree. Fires the enrollment workflow exactly as a
     * normal enrollment does, so the member message is sent and the next class batch picks the
     * learner up without anyone intervening.
     *
     * @return true when a row was revived. False means the learner has never had any row in
     *         these sessions — nothing to revive, and deliberately not force-created here: that
     *         needs an auth round trip and a Student record inside a payment transaction. The
     *         04:30 paid-without-enrollment report is what surfaces those.
     */
    @Transactional
    public boolean reviveLapsedEnrollment(List<String> packageSessionIds, String userId, UserPlan userPlan) {
        int revivedCount = 0;
        for (String packageSessionId : packageSessionIds) {
            StudentSessionInstituteGroupMapping revived = studentSessionRepository
                    .findLatestForUserInPackageSession(userId, packageSessionId)
                    .orElse(null);
            if (revived == null) {
                log.error("Cannot revive an enrollment for user {} on plan {}: no mapping has ever existed "
                        + "in package session {}", userId, userPlan.getId(), packageSessionId);
                continue;
            }
            if (LearnerSessionStatusEnum.ACTIVE.name().equals(revived.getStatus())
                    && !LearnerSessionTypeEnum.ABANDONED_CART.name().equals(revived.getType())
                    && !LearnerSessionTypeEnum.PAYMENT_FAILED.name().equals(revived.getType())) {
                // Already a live membership in this session — leave it alone. Matches what
                // existsActiveMembership counts, so the repair never fights the check that sent
                // it here.
                continue;
            }
            log.warn("Reviving lapsed mapping {} (was status={} type={}) for user {} onto paid plan {}",
                    revived.getId(), revived.getStatus(), revived.getType(), userId, userPlan.getId());
            revived.setStatus(LearnerSessionStatusEnum.ACTIVE.name());
            revived.setUserPlanId(userPlan.getId());
            revived.setType(LearnerSessionTypeEnum.PACKAGE_SESSION.name());
            if (userPlan.getEndDate() != null) {
                revived.setExpiryDate(userPlan.getEndDate());
            }
            studentSessionRepository.save(revived);
            revivedCount++;

            try {
                UserDTO userDTO = authService.getUsersFromAuthServiceWithPasswordByUserId(userId);
                String instituteId = revived.getInstitute() != null ? revived.getInstitute().getId() : null;
                String revivedSessionId = revived.getPackageSession() != null
                        ? revived.getPackageSession().getId()
                        : packageSessionId;
                if (instituteId != null && revivedSessionId != null) {
                    studentRegistrationManager.triggerEnrollmentWorkflow(instituteId, userDTO, revivedSessionId,
                            revived.getSubOrg(), userPlan.getId());
                }
            } catch (Exception e) {
                log.error("Revived mapping {} but could not fire the enrollment workflow: {}",
                        revived.getId(), e.getMessage(), e);
            }
        }
        return revivedCount > 0;
    }

    public int shiftLearnerFromPendingForApprovalToActivePackageSessions(List<String> packageSessionIds, String userId,
            String enrollInviteId) {
        return shiftLearnerToActiveStatus(packageSessionIds, userId, enrollInviteId,
                LearnerStatusEnum.PENDING_FOR_APPROVAL, null);
    }

    /**
     * @return how many mappings were actually shifted. Zero is the interesting answer: it means
     *         the learner had nothing in INVITED or ABANDONED_CART to promote, so this call
     *         enrolled nobody. Callers repairing a paid-but-unenrolled learner must check it —
     *         treating the call as "the enrollment now exists" is how a paying member ends up in
     *         no batch at all.
     */
    private int shiftLearnerToActiveStatus(List<String> packageSessionIds, String userId, String enrollInviteId,
            LearnerStatusEnum fromStatus, String activeUserPlanId) {
        // First, find entries with the specified status (INVITED or PENDING_FOR_APPROVAL)
        List<StudentSessionInstituteGroupMapping> invitedMappings = studentSessionRepository
                .findByDestinationPackageSession_IdInAndUserIdAndStatusIn(
                        packageSessionIds, userId, List.of(fromStatus.name()));

        // Also find ABANDONED_CART entries (status=ACTIVE, type=ABANDONED_CART) for paid enrollments
        // These are created during form submission step and need to be shifted after payment
        if (fromStatus == LearnerStatusEnum.INVITED) {
            List<StudentSessionInstituteGroupMapping> abandonedCartMappings = studentSessionRepository
                    .findByDestinationPackageSession_IdInAndUserIdAndStatusIn(
                            packageSessionIds, userId, List.of(LearnerSessionStatusEnum.ACTIVE.name()));
            
            // Filter to only include ABANDONED_CART type entries
            List<StudentSessionInstituteGroupMapping> filteredAbandonedCart = abandonedCartMappings.stream()
                    .filter(m -> LearnerSessionTypeEnum.ABANDONED_CART.name().equals(m.getType()))
                    .toList();
            
            // Combine both lists, avoiding duplicates
            if (!filteredAbandonedCart.isEmpty()) {
                List<StudentSessionInstituteGroupMapping> combined = new java.util.ArrayList<>(invitedMappings);
                combined.addAll(filteredAbandonedCart);
                invitedMappings = combined;
                log.info("Found {} ABANDONED_CART entries to shift for user: {}", filteredAbandonedCart.size(), userId);
            }
        }

        UserDTO userDTO = authService.getUsersFromAuthServiceWithPasswordByUserId(userId);

        int shifted = 0;
        for (StudentSessionInstituteGroupMapping mapping : invitedMappings) {
            if (mapping.getDestinationPackageSession() != null) {
                String newSessionId = studentRegistrationManager.shiftStudentBatch(
                        mapping,
                        LearnerStatusEnum.ACTIVE.name(),
                        activeUserPlanId);
                studentRegistrationManager.triggerEnrollmentWorkflow(mapping.getInstitute().getId(), userDTO,
                        mapping.getDestinationPackageSession().getId(), mapping.getSubOrg(),
                        StringUtils.hasText(activeUserPlanId) ? activeUserPlanId : mapping.getUserPlanId());
                customFieldValueService.shiftCustomField(
                        CustomFieldValueSourceTypeEnum.STUDENT_SESSION_INSTITUTE_GROUP_MAPPING.name(),
                        mapping.getId(),
                        newSessionId,
                        CustomFieldTypeEnum.ENROLL_INVITE.name(),
                        enrollInviteId);

                customFieldValueService.shiftCustomField(
                        CustomFieldValueSourceTypeEnum.USER.name(),
                        mapping.getId(),
                        newSessionId,
                        CustomFieldTypeEnum.ENROLL_INVITE.name(),
                        enrollInviteId);

                if (invitedMappings.size() > 0) {
                    String userPlanId = invitedMappings.get(0).getUserPlanId();
                    UserPlan userPlan = userPlanService.findById(userPlanId);
                    referralMappingService.processReferralBenefitsIfApplicable(userPlan);
                }
                shifted++;
            }
        }
        return shifted;
    }

    /**
     * Process bulk learner approval requests
     *
     * @param request The bulk approval request containing multiple items
     * @return A result object with success count and total count
     */
    public BulkApprovalResult processBulkLearnerApproval(BulkLearnerApprovalRequestDTO request) {
        log.info("Processing bulk learner approval request with {} items",
                request != null ? request.getItems().size() : 0);

        if (request == null || request.getItems() == null || request.getItems().isEmpty()) {
            log.warn("Bulk approval request is null or empty");
            return new BulkApprovalResult(0, 0, "Request cannot be null or empty");
        }

        int successCount = 0;
        int totalCount = request.getItems().size();

        // Process each item in the bulk request
        for (BulkLearnerApprovalRequestDTO.LearnerApprovalItem item : request.getItems()) {
            try {
                // enrollInviteId is optional — null when the learner was not added via an enroll invite
                if (item.getPackageSessionIds() == null || item.getPackageSessionIds().isEmpty() ||
                        item.getUserId() == null || item.getUserId().trim().isEmpty()) {
                    log.warn("Skipping invalid item: userId={}, enrollInviteId={}, packageSessionIds={}",
                            item.getUserId(), item.getEnrollInviteId(), item.getPackageSessionIds());
                    continue; // Skip invalid items
                }

                log.debug("Processing item: userId={}, enrollInviteId={}, packageSessionIds={}",
                        item.getUserId(), item.getEnrollInviteId(), item.getPackageSessionIds());

                shiftLearnerFromPendingForApprovalToActivePackageSessions(
                        item.getPackageSessionIds(),
                        item.getUserId(),
                        item.getEnrollInviteId());
                successCount++;
                log.debug("Successfully processed item for userId: {}", item.getUserId());
            } catch (Exception e) {
                // Log error but continue processing other items
                log.error("Error processing item for userId: {}, enrollInviteId: {}, error: {}",
                        item.getUserId(), item.getEnrollInviteId(), e.getMessage(), e);
                continue;
            }
        }

        String message;
        if (successCount == 0) {
            message = "No items were processed successfully";
        } else if (successCount < totalCount) {
            message = String.format("Bulk approval partially successful: %d/%d items processed", successCount,
                    totalCount);
        } else {
            message = String.format("Bulk approval successful: %d items processed", successCount);
        }

        log.info("Bulk approval completed: {}/{} items processed successfully", successCount, totalCount);
        return new BulkApprovalResult(successCount, totalCount, message);
    }

    /**
     * Result class for bulk approval operations
     */
    public static class BulkApprovalResult {
        private final int successCount;
        private final int totalCount;
        private final String message;

        public BulkApprovalResult(int successCount, int totalCount, String message) {
            this.successCount = successCount;
            this.totalCount = totalCount;
            this.message = message;
        }

        public int getSuccessCount() {
            return successCount;
        }

        public int getTotalCount() {
            return totalCount;
        }

        public String getMessage() {
            return message;
        }

        public boolean isFullySuccessful() {
            return successCount == totalCount;
        }

        public boolean isPartiallySuccessful() {
            return successCount > 0 && successCount < totalCount;
        }

        public boolean isFailed() {
            return successCount == 0;
        }
    }
}
