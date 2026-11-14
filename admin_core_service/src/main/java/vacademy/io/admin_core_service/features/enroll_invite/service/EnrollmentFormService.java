package vacademy.io.admin_core_service.features.enroll_invite.service;

import jakarta.transaction.Transactional;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.common.enums.CustomFieldValueSourceTypeEnum;
import vacademy.io.admin_core_service.features.common.service.CustomFieldValueService;
import vacademy.io.admin_core_service.features.enroll_invite.dto.EnrollmentFormSubmitDTO;
import vacademy.io.admin_core_service.features.enroll_invite.dto.EnrollmentFormSubmitResponseDTO;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.repository.EnrollInviteRepository;
import vacademy.io.admin_core_service.features.institute_learner.dto.StudentExtraDetails;
import vacademy.io.admin_core_service.features.institute_learner.entity.StudentSessionInstituteGroupMapping;
import vacademy.io.admin_core_service.features.institute_learner.manager.StudentRegistrationManager;
import vacademy.io.admin_core_service.features.institute_learner.service.LearnerEnrollmentEntryService;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.dto.learner.LearnerExtraDetails;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.session.PackageSession;
import vacademy.io.common.common.dto.CustomFieldValueDTO;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import vacademy.io.admin_core_service.features.live_activity.core.LiveActivityDedupeKeys;
import vacademy.io.admin_core_service.features.live_activity.core.LiveActivityRecorder;
import vacademy.io.admin_core_service.features.live_activity.dto.LiveActivityEvent;
import vacademy.io.admin_core_service.features.live_activity.enums.LiveActivityAction;
import vacademy.io.admin_core_service.features.live_activity.enums.LiveActivityActorType;
import vacademy.io.admin_core_service.features.live_activity.enums.LiveActivityCategory;


@Slf4j
@Service
public class EnrollmentFormService {

    @Autowired
    private EnrollInviteRepository enrollInviteRepository;

    @Autowired
    private vacademy.io.admin_core_service.features.user_subscription.repository.UserPlanRepository userPlanRepository;


    @Autowired
    private StudentRegistrationManager studentRegistrationManager;

    @Autowired
    private LearnerEnrollmentEntryService learnerEnrollmentEntryService;

    @Autowired
    private PackageSessionRepository packageSessionRepository;

    @Autowired
    private CustomFieldValueService customFieldValueService;

    @Autowired
    private InviteFormAdminNotificationService inviteFormAdminNotificationService;

    @Autowired
    private PhoneIdentifierInviteSubmissionGuard phoneIdentifierInviteSubmissionGuard;

    @Autowired
    private LiveActivityRecorder liveActivityRecorder;


    @Transactional
    public EnrollmentFormSubmitResponseDTO submitEnrollmentForm(EnrollmentFormSubmitDTO request) {
        log.info("Processing enrollment form submission for email: {}",
                request.getUserDetails() != null ? request.getUserDetails().getEmail() : "null");

        // Step 1: Validate EnrollInvite
        EnrollInvite enrollInvite = validateEnrollInvite(request.getEnrollInviteId(), request.getInstituteId());

        // Step 2: Create or update user. The form's custom field values ride along so the
        // institute's username strategy can use one of them (e.g. roll number).
        if (request.getUserDetails() != null) {
            request.getUserDetails().setUsernameFieldValues(
                    CustomFieldValueDTO.toValueMap(request.getCustomFieldValues()));
        }
        UserDTO createdUser = studentRegistrationManager.createUserFromAuthService(
                request.getUserDetails(), 
                request.getInstituteId(), 
                false);

        // PHONE is this institute's identity key. Once that resolved account has a
        // plan for this invite, stop here before checkout rows/payment can begin.
        phoneIdentifierInviteSubmissionGuard.validateNotAlreadySubmitted(
                enrollInvite, createdUser.getId(), request.getInstituteId());
        
        // Step 3: Create student record
        studentRegistrationManager.createStudentFromRequest(
                createdUser,
                mapToStudentExtraDetails(request.getLearnerExtraDetails()));

        // Step 4: Create ABANDONED_CART entries for each package session
        List<String> abandonedCartEntryIds = new ArrayList<>();
        
        for (String actualPackageSessionId : request.getPackageSessionIds()) {
            // Find INVITED PackageSession
            PackageSession invitedPackageSession = learnerEnrollmentEntryService
                    .findInvitedPackageSession(actualPackageSessionId);

            PackageSession actualPackageSession = packageSessionRepository.findById(actualPackageSessionId)
                    .orElseThrow(() -> new VacademyException("Package session not found: " + actualPackageSessionId));

            // Mark previous ABANDONED_CART and PAYMENT_FAILED entries as DELETED
            learnerEnrollmentEntryService.markPreviousEntriesAsDeleted(
                    createdUser.getId(),
                    invitedPackageSession.getId(),
                    actualPackageSessionId,
                    request.getInstituteId());

            // Create new ABANDONED_CART entry (without userPlanId - will be set later during payment).
            // Pass the full UserDTO so the ABANDONED_CART workflow's webhook can use
            // #ctx['user'].fullName / .email / .mobileNumber — same shape as
            // LEARNER_BATCH_ENROLLMENT so a single webhook template fits both.
            StudentSessionInstituteGroupMapping entry = learnerEnrollmentEntryService.createOnlyDetailsFilledEntry(
                    createdUser.getId(),
                    invitedPackageSession,
                    actualPackageSession,
                    request.getInstituteId(),
                    null, // userPlanId is null at this stage
                    createdUser);

            abandonedCartEntryIds.add(entry.getId());
            
            log.info("Created ABANDONED_CART entry {} for user {} in package session {}",
                    entry.getId(), createdUser.getId(), actualPackageSessionId);
        }

        // Step 5: Save custom field values
        if (request.getCustomFieldValues() != null && !request.getCustomFieldValues().isEmpty()) {
            customFieldValueService.addCustomFieldValue(
                    request.getCustomFieldValues(),
                    CustomFieldValueSourceTypeEnum.USER.name(),
                    createdUser.getId());
        }

        // Step 6: Alert the team members configured on this invite
        // (setting_json → setting.NOTIFICATION_SETTING). FREE invites never reach this
        // endpoint — the learner FE skips form-submit for them — so that path fires the
        // same notification from LearnerEnrollRequestService instead.
        inviteFormAdminNotificationService.notifyAdminsOnFormFill(
                enrollInvite,
                createdUser,
                request.getCustomFieldValues());

        log.info("Enrollment form submitted successfully for user: {}, created {} ABANDONED_CART entries",
                createdUser.getId(), abandonedCartEntryIds.size());

        // Step 7: Surface it on the live activity feed. This endpoint fires exactly when the
        // prospect leaves the registration step, so it IS the "pressed Next" moment -- the
        // top of the abandoned-cart funnel, and the earliest point anyone can act on.
        //
        // After commit, not inline: the feed must never show a prospect whose enrolment
        // entry then rolled back. Recording is best-effort and never throws, so a feed
        // problem cannot fail the submission.
        recordFormNextActivity(enrollInvite, createdUser, request);

        // Welcome/confirmation WhatsApp is handled by the workflow engine on the
        // PAYMENT_SUCCESS trigger (per-invite, configurable), not from here.

        return EnrollmentFormSubmitResponseDTO.builder()
                .userId(createdUser.getId())
                .abandonedCartEntryIds(abandonedCartEntryIds)
                .trialAvailable(trialAvailableFor(createdUser.getId(), request.getInstituteId()))
                .message("Form submitted successfully. Please proceed to payment.")
                .build();
    }

    /**
     * Whether the learner still has their free trial. Mirrors the rule the enrolment path
     * applies, so the form promises exactly what the checkout will charge.
     *
     * <p>Any failure answers "yes": a lookup problem must not tell a first-time learner they
     * have no trial, which would read as a bait-and-switch for the many to spare the few.
     */
    private boolean trialAvailableFor(String userId, String instituteId) {
        try {
            java.util.Date now = new java.util.Date();
            boolean consumed = phoneIdentifierInviteSubmissionGuard.usesPhoneIdentifier(instituteId)
                    ? userPlanRepository.hasConsumedTrialByPhone(userId, instituteId, "", now)
                    : userPlanRepository.hasConsumedTrialAtInstitute(userId, instituteId, "", now);
            return !consumed;
        } catch (Exception e) {
            log.warn("Could not resolve trial eligibility for user {}: {}", userId, e.getMessage());
            return true;
        }
    }

    private EnrollInvite validateEnrollInvite(String enrollInviteId, String instituteId) {
        Optional<EnrollInvite> enrollInviteOpt = enrollInviteRepository.findById(enrollInviteId);
        
        if (enrollInviteOpt.isEmpty()) {
            throw new VacademyException("Enroll invite not found: " + enrollInviteId);
        }

        EnrollInvite enrollInvite = enrollInviteOpt.get();

        // Check if invite belongs to the institute
        if (!enrollInvite.getInstituteId().equals(instituteId)) {
            throw new VacademyException("Enroll invite does not belong to this institute");
        }

        // Check if invite is active
        if (!"ACTIVE".equals(enrollInvite.getStatus())) {
            throw new VacademyException("Enroll invite is not active");
        }

        // Check if invite has started
        Date now = new Date();
        if (enrollInvite.getStartDate() != null && enrollInvite.getStartDate().after(now)) {
            throw new VacademyException("Enroll invite has not started yet");
        }

        // Check if invite has expired
        if (enrollInvite.getEndDate() != null && enrollInvite.getEndDate().before(now)) {
            throw new VacademyException("Enroll invite has expired");
        }

        return enrollInvite;
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

    private void recordFormNextActivity(EnrollInvite enrollInvite,
                                        UserDTO createdUser,
                                        EnrollmentFormSubmitDTO request) {
        try {
            Map<String, Object> payload = new HashMap<>();
            if (enrollInvite.getName() != null) {
                payload.put("inviteName", enrollInvite.getName());
            }
            if (request.getPackageSessionIds() != null) {
                payload.put("packageSessionIds", request.getPackageSessionIds());
            }

            liveActivityRecorder.recordAfterCommit(LiveActivityEvent.builder()
                    .instituteId(request.getInstituteId())
                    .occurredAtEpochMillis(System.currentTimeMillis())
                    .category(LiveActivityCategory.INVITE_FORM)
                    .action(LiveActivityAction.FORM_NEXT)
                    .actorType(LiveActivityActorType.PROSPECT)
                    .dedupeKey(LiveActivityDedupeKeys.forInviteForm(
                            enrollInvite.getId(), createdUser.getId(), LiveActivityAction.FORM_NEXT))
                    .subjectId(createdUser.getId())
                    .subjectName(createdUser.getFullName())
                    .subjectEmail(createdUser.getEmail())
                    .subjectMobile(createdUser.getMobileNumber())
                    .entityId(enrollInvite.getId())
                    .payload(payload)
                    .build());
        } catch (Exception e) {
            // Never let the feed break an enrolment.
            log.warn("Failed to record live activity for enrollment form submission: {}",
                    e.getMessage());
        }
    }
}
