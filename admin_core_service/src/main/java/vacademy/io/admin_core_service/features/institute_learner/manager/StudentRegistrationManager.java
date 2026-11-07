package vacademy.io.admin_core_service.features.institute_learner.manager;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.RandomStringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.common.util.JsonUtil;
import vacademy.io.admin_core_service.features.course_settings.service.LmsExistingUserEditPolicyService;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enrollment_policy.dto.EnrollmentPolicySettingsDTO;
import vacademy.io.admin_core_service.features.enrollment_policy.dto.ReenrollmentPolicyDTO;
import vacademy.io.admin_core_service.features.enrollment_policy.enums.ActiveRepurchaseBehavior;
import vacademy.io.admin_core_service.features.institute.controller.InstituteCertificateController;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute_learner.constants.StudentConstants;
import vacademy.io.admin_core_service.features.institute_learner.dto.*;
import vacademy.io.admin_core_service.features.institute_learner.entity.Student;
import vacademy.io.admin_core_service.features.institute_learner.entity.StudentSessionInstituteGroupMapping;
import vacademy.io.admin_core_service.features.institute_learner.enums.LearnerSessionStatusEnum;
import vacademy.io.admin_core_service.features.institute_learner.enums.LearnerStatusEnum;
import vacademy.io.admin_core_service.features.institute_learner.enums.LearnerSessionTypeEnum;
import vacademy.io.admin_core_service.features.institute_learner.repository.InstituteStudentRepository;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionRepository;
import vacademy.io.admin_core_service.features.learner.service.LearnerCouponService;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.enums.PaymentOptionType;
import vacademy.io.admin_core_service.features.user_subscription.service.UserPlanService;
import vacademy.io.admin_core_service.features.workflow.enums.WorkflowTriggerEvent;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;
import vacademy.io.common.exceptions.EnrollmentConflictException;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.common.institute.entity.session.PackageSession;

import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.*;

@Slf4j
@Component
public class StudentRegistrationManager {

    private final InstituteCertificateController instituteCertificateController;

    @Autowired
    InternalClientUtils internalClientUtils;

    @Autowired
    InstituteStudentRepository instituteStudentRepository;

    @Autowired
    StudentSessionRepository studentSessionRepository;

    @Autowired
    private PackageSessionRepository packageSessionRepository;

    @Autowired
    private LmsExistingUserEditPolicyService lmsExistingUserEditPolicyService;

    @Value("${auth.server.baseurl}")
    private String authServerBaseUrl;
    @Value("${spring.application.name}")
    private String applicationName;

    @Autowired
    private LearnerCouponService learnerCouponService;

    @Autowired
    private UserPlanService userPlanService;

    @Autowired
    private WorkflowTriggerService workflowTriggerService;

    @Autowired
    private InstituteRepository instituteRepository;

    @Autowired
    private vacademy.io.admin_core_service.features.institute_learner.service.EnrollmentCredentialPolicyService enrollmentCredentialPolicyService;

    @Autowired
    private vacademy.io.admin_core_service.features.audience.service.AudienceService audienceService;

    @Autowired
    private vacademy.io.admin_core_service.features.learner_access.service.LearnerAccessService learnerAccessService;

    StudentRegistrationManager(InstituteCertificateController instituteCertificateController) {
        this.instituteCertificateController = instituteCertificateController;
    }

    public InstituteStudentDTO addStudentToInstitute(CustomUserDetails user, InstituteStudentDTO instituteStudentDTO,
                                                     BulkUploadInitRequest bulkUploadInitRequest) {
        instituteStudentDTO = this.updateAsPerConfig(instituteStudentDTO, bulkUploadInitRequest);
        Student student = checkAndCreateStudent(instituteStudentDTO);
        linkStudentToInstitute(student, instituteStudentDTO.getInstituteStudentDetails());
        learnerCouponService.generateCouponCodeForLearner(student.getUserId());
        if (instituteStudentDTO.getInstituteStudentDetails().getEnrollmentStatus()
                .equalsIgnoreCase(LearnerSessionStatusEnum.ACTIVE.name())) {
            triggerEnrollmentWorkflow(instituteStudentDTO.getInstituteStudentDetails().getInstituteId(),
                    instituteStudentDTO.getUserDetails(),
                    instituteStudentDTO.getInstituteStudentDetails().getPackageSessionId(), null);
        }
        return instituteStudentDTO;
    }

    /**
     * Parses enrollment policy JSON string to EnrollmentPolicySettingsDTO.
     */
    private EnrollmentPolicySettingsDTO parseEnrollmentPolicy(String policyJson) {
        if (!StringUtils.hasText(policyJson)) {
            return null;
        }

        try {
            return JsonUtil.fromJson(policyJson, EnrollmentPolicySettingsDTO.class);
        } catch (Exception e) {
            log.warn("Failed to parse enrollment policy JSON: {}", e.getMessage());
            return null;
        }
    }

    public ResponseEntity<StudentDTO> addOpenStudentToInstitute(UserDTO userDTO, String instituteId) {
        InstituteStudentDTO instituteStudentDTO = new InstituteStudentDTO();
        instituteStudentDTO.setUserDetails(userDTO);
        instituteStudentDTO
                .setInstituteStudentDetails(InstituteStudentDetails.builder().instituteId(instituteId).build());

        Student student = checkAndCreateStudent(instituteStudentDTO);
        InstituteStudentDetails details = instituteStudentDTO.getInstituteStudentDetails();
        if (details != null && StringUtils.hasText(details.getPackageSessionId())) {
            linkStudentToInstitute(student, details);
            if (StringUtils.hasText(details.getEnrollmentStatus()) &&
                    details.getEnrollmentStatus().equalsIgnoreCase(LearnerSessionStatusEnum.ACTIVE.name())) {
                triggerEnrollmentWorkflow(details.getInstituteId(),
                        instituteStudentDTO.getUserDetails(),
                        details.getPackageSessionId(), null);
            }
        } else {
            // No package session means no student_session_institute_group_mapping row,
            // which makes this signup invisible in the admin's learner list (it requires
            // an enrollment row to show up at all). Surface it as a lead instead.
            // Best-effort: a failure here must never break signup.
            try {
                audienceService.captureSelfSignupLead(instituteId, student.getUserId(),
                        student.getFullName(), student.getEmail(), student.getMobileNumber());
            } catch (Exception e) {
                log.warn("Self-signup lead capture failed (non-blocking) for userId={}: {}",
                        student.getUserId(), e.getMessage());
            }
        }
        return ResponseEntity.ok(new StudentDTO(student));
    }

    public UserDTO createUserFromAuthService(UserDTO userDTO, String instituteId, boolean isNotify) {
        try {
            userDTO.setRootUser(true);
            ObjectMapper objectMapper = new ObjectMapper();
            ResponseEntity<String> response = internalClientUtils.makeHmacRequest(applicationName,
                    HttpMethod.POST.name(), authServerBaseUrl,
                    StudentConstants.addUserRoute + "?instituteId=" + instituteId + "&isNotify=" + isNotify, userDTO);
            return objectMapper.readValue(response.getBody(), UserDTO.class);

        } catch (Exception e) {
            throw new vacademy.io.common.exceptions.VacademyException(e.getMessage());
        }
    }

    private Student checkAndCreateStudent(InstituteStudentDTO instituteStudentDTO) {
        instituteStudentDTO.getUserDetails().setRoles(getStudentRoles());
        setRandomPasswordIfNull(instituteStudentDTO.getUserDetails());
        setRandomUserNameIfNull(instituteStudentDTO.getUserDetails());
        instituteStudentDTO.getUserDetails()
                .setUsername(instituteStudentDTO.getUserDetails().getUsername().toLowerCase());
        setEnrollmentNumberIfNull(instituteStudentDTO.getInstituteStudentDetails());
        // Was hardcoded true, which made this the one enrollment path no institute setting
        // could silence — institutes running their own LEARNER_BATCH_ENROLLMENT welcome mail
        // got two emails per learner, both carrying the password.
        //
        // Only honour the institute's opt-out when the caller is enrolling as ACTIVE, because
        // that is the only case where addStudentToInstitute fires the enrollment workflow that
        // sends the institute's own mail instead. Non-ACTIVE adds (the invite-response flow
        // registers learners as INVITED) fire no workflow, so suppressing here would leave the
        // learner with no credentials at all.
        String instituteId = instituteStudentDTO.getInstituteStudentDetails().getInstituteId();
        boolean enrollmentWorkflowWillFire = LearnerSessionStatusEnum.ACTIVE.name()
                .equalsIgnoreCase(instituteStudentDTO.getInstituteStudentDetails().getEnrollmentStatus());
        boolean sendCredentials = !enrollmentWorkflowWillFire
                || enrollmentCredentialPolicyService.shouldSendCredentialEmail(instituteId);
        UserDTO createdUser = createUserFromAuthService(instituteStudentDTO.getUserDetails(),
                instituteId, sendCredentials);
        instituteStudentDTO.getUserDetails().setId(createdUser.getId());
        return createStudentFromRequest(createdUser, instituteStudentDTO.getStudentExtraDetails());
    }

    private void setRandomUserNameIfNull(UserDTO userDetails) {
        if (userDetails.getUsername() == null || !StringUtils.hasText(userDetails.getUsername())) {
            userDetails.setUsername(generateUsername(userDetails.getFullName()));
        }
        userDetails.setUsername(userDetails.getUsername().toLowerCase());
    }

    private void setEnrollmentNumberIfNull(InstituteStudentDetails instituteStudentDetails) {
        if (instituteStudentDetails.getEnrollmentId() == null
                || !StringUtils.hasText(instituteStudentDetails.getEnrollmentId())) {
            instituteStudentDetails.setEnrollmentId(generateEnrollmentId());
        }
    }

    private void setRandomPasswordIfNull(UserDTO userDTO) {
        if (userDTO.getPassword() == null || !StringUtils.hasText(userDTO.getPassword())) {
            userDTO.setPassword(generatePassword());
        }
    }

    public Student createStudentFromRequest(UserDTO userDTO, StudentExtraDetails studentExtraDetails) {
        Student student = new Student();
        Optional<Student> existingStudent = getExistingStudentByUserNameAndUserId(userDTO.getUsername(),
                userDTO.getId());
        if (existingStudent.isPresent()) {
            student = existingStudent.get();
        }
        if (userDTO.getId() != null) {
            student.setUserId(userDTO.getId());
        }
        if (userDTO.getUsername() != null) {
            student.setUsername(userDTO.getUsername());
        }
        if (userDTO.getFullName() != null) {
            student.setFullName(userDTO.getFullName());
        }
        if (userDTO.getEmail() != null) {
            student.setEmail(userDTO.getEmail());
        }
        if (userDTO.getMobileNumber() != null) {
            student.setMobileNumber(userDTO.getMobileNumber());
        }
        if (userDTO.getAddressLine() != null) {
            student.setAddressLine(userDTO.getAddressLine());
        }
        if (userDTO.getProfilePicFileId() != null) {
            student.setFaceFileId(userDTO.getProfilePicFileId());
        }
        if (userDTO.getCity() != null) {
            student.setCity(userDTO.getCity());
        }
        if (userDTO.getPinCode() != null) {
            student.setPinCode(userDTO.getPinCode());
        }
        if (userDTO.getGender() != null) {
            student.setGender(userDTO.getGender());
        }
        if (userDTO.getDateOfBirth() != null) {
            student.setDateOfBirth(userDTO.getDateOfBirth());
        }
        if (userDTO.getRegion() != null) {
            student.setRegion(userDTO.getRegion());
        }

        if (studentExtraDetails != null) {
            if (studentExtraDetails.getFathersName() != null) {
                student.setFatherName(studentExtraDetails.getFathersName());
            }
            if (studentExtraDetails.getMothersName() != null) {
                student.setMotherName(studentExtraDetails.getMothersName());
            }
            if (studentExtraDetails.getParentsMobileNumber() != null) {
                student.setParentsMobileNumber(studentExtraDetails.getParentsMobileNumber());
            }
            if (studentExtraDetails.getParentsEmail() != null) {
                student.setParentsEmail(studentExtraDetails.getParentsEmail());
            }
            if (studentExtraDetails.getLinkedInstituteName() != null) {
                student.setLinkedInstituteName(studentExtraDetails.getLinkedInstituteName());
            }
            if (studentExtraDetails.getParentsToMotherEmail() != null) {
                student.setParentsToMotherEmail(studentExtraDetails.getParentsToMotherEmail());
            }
            if (studentExtraDetails.getParentsToMotherMobileNumber() != null) {
                student.setParentToMotherMobileNumber(studentExtraDetails.getParentsToMotherMobileNumber());
            }
            if (studentExtraDetails.getBillingContactName() != null) {
                student.setBillingContactName(studentExtraDetails.getBillingContactName());
            }
            if (studentExtraDetails.getBillingContactEmail() != null) {
                student.setBillingContactEmail(studentExtraDetails.getBillingContactEmail());
            }
            if (studentExtraDetails.getBillingContactRole() != null) {
                student.setBillingContactRole(studentExtraDetails.getBillingContactRole());
            }
        }
        return instituteStudentRepository.save(student);
    }

    /**
     * [REWORKED]
     * Links a student to a package session, applying re-enrollment and access day
     * policies.
     */
    public String linkStudentToInstitute(Student student, InstituteStudentDetails details) {
        try {
            // 1. Fetch the policy for the package session they are trying to join
            // For paid enrollments with destination, use destination's policy for terminateActiveSessions
            String policyPackageSessionId = StringUtils.hasText(details.getDestinationPackageSessionId())
                    ? details.getDestinationPackageSessionId()
                    : details.getPackageSessionId();

            vacademy.io.common.institute.entity.session.PackageSession packageSession = packageSessionRepository
                    .findById(policyPackageSessionId)
                    .orElseThrow(() -> new VacademyException(
                            "PackageSession not found with id: " + policyPackageSessionId));

            EnrollmentPolicySettingsDTO policy = parseEnrollmentPolicy(packageSession.getEnrollmentPolicySettings());
            if (policy == null) {
                policy = EnrollmentPolicySettingsDTO.builder().build();
            }

            // 2. Validate re-enrollment eligibility BEFORE creating/updating mapping
            validateReenrollmentEligibility(student, details, policy);

            // 3. Block enrollment if user is already active in configured sessions (e.g.,
            // block demo if paid)
            blockEnrollmentIfActiveInConfiguredSessions(student, details.getInstituteId(), policy);

            // 4. Terminate active sessions if configured in policy (e.g., demo to paid upgrade)
            // IMPORTANT: Skip termination for INVITED status (paid enrollments pending payment)
            // Termination will happen after payment confirmation in UserPlanService.applyOperationsOnFirstPayment
            boolean isPendingPayment = LearnerSessionStatusEnum.INVITED.name().equalsIgnoreCase(details.getEnrollmentStatus());
            if (!isPendingPayment) {
                terminateActiveSessionsIfConfigured(student, details.getInstituteId(), policy);
            } else {
                log.info("Skipping terminateActiveSessions for user {} - enrollment is pending payment. Will terminate after payment confirmation.",
                        student.getUserId());
            }

            // 5. Check for an active mapping in a *different* session (for stacking)
            Optional<StudentSessionInstituteGroupMapping> activeDestinationMapping = getActiveDestinationMapping(
                    student, details);

            // 6. Check for an *existing* mapping in *this* session (for
            // re-enrollment/repurchase)
            Optional<StudentSessionInstituteGroupMapping> existingMapping = getExistingMapping(student, details);
            if (existingMapping.isPresent()) {
                // Scenario: Re-enrollment (EXPIRED -> ACTIVE) or Repurchase (ACTIVE -> ACTIVE)
                return updateExistingMapping(existingMapping.get(), activeDestinationMapping, details, policy);
            } else {
                // Scenario: New Enrollment
                return createNewMapping(student, activeDestinationMapping, details, policy);
            }
        } catch (VacademyException e) {
            log.error("Policy-based enrollment failed for student {}: {}", student.getUserId(), e.getMessage());
            throw e; // Re-throw the specific exception
        } catch (Exception e) {
            log.error("Failed to link student {} to institute {}: {}", student.getUserId(), details.getInstituteId(),
                    e.getMessage(), e);
            throw new VacademyException("Failed to link student to institute: " + e.getMessage());
        }
    }

    /**
     * Terminates (marks as DELETED) the student's active enrollments in package
     * sessions
     * specified in the policy's terminateActiveSessions list.
     *
     * Use case: When a user upgrades from a demo package to a paid package,
     * the demo enrollment should be automatically terminated.
     *
     * @param student     The student whose sessions should be terminated
     * @param instituteId The institute ID
     * @param policy      The enrollment policy containing terminateActiveSessions
     *                    list
     */
    private void terminateActiveSessionsIfConfigured(Student student, String instituteId,
                                                     EnrollmentPolicySettingsDTO policy) {
        if (policy == null || policy.getOnEnrollment() == null) {
            return;
        }

        List<String> sessionsToTerminate = policy.getOnEnrollment().getTerminateActiveSessions();
        if (sessionsToTerminate == null || sessionsToTerminate.isEmpty()) {
            return;
        }

        log.info("Terminating active sessions for user {} in package sessions: {}",
                student.getUserId(), sessionsToTerminate);

        // Find and terminate all matching active enrollments
        for (String packageSessionId : sessionsToTerminate) {
            try {
                Optional<StudentSessionInstituteGroupMapping> activeMapping = studentSessionRepository
                        .findTopByPackageSessionIdAndUserIdAndStatusIn(
                                packageSessionId,
                                instituteId,
                                student.getUserId(),
                                List.of(LearnerSessionStatusEnum.ACTIVE.name(),
                                        LearnerSessionStatusEnum.INVITED.name()));

                if (activeMapping.isPresent()) {
                    StudentSessionInstituteGroupMapping mapping = activeMapping.get();
                    mapping.setStatus(LearnerSessionStatusEnum.DELETED.name());
                    studentSessionRepository.save(mapping);
                    log.info("Terminated enrollment for user {} in package session {}",
                            student.getUserId(), packageSessionId);
                }
            } catch (Exception e) {
                log.warn("Failed to terminate session {} for user {}: {}",
                        packageSessionId, student.getUserId(), e.getMessage());
                // Continue with other sessions even if one fails
            }
        }
    }

    /**
     * Blocks enrollment if user is already active in any of the package sessions
     * specified in the policy's blockIfActiveIn list.
     *
     * Use case: Prevent demo enrollment if user already has an active paid
     * subscription.
     *
     * @param student     The student trying to enroll
     * @param instituteId The institute ID
     * @param policy      The enrollment policy containing blockIfActiveIn list
     * @throws VacademyException if user is active in any blocking session
     */
    private void blockEnrollmentIfActiveInConfiguredSessions(Student student, String instituteId,
                                                             EnrollmentPolicySettingsDTO policy) {
        if (policy == null || policy.getOnEnrollment() == null) {
            return;
        }

        List<String> blockingSessions = policy.getOnEnrollment().getBlockIfActiveIn();
        if (blockingSessions == null || blockingSessions.isEmpty()) {
            return;
        }

        // Check if user is active in any of the blocking sessions
        for (String packageSessionId : blockingSessions) {
            try {
                Optional<StudentSessionInstituteGroupMapping> activeMapping = studentSessionRepository
                        .findTopByPackageSessionIdAndUserIdAndStatusIn(
                                packageSessionId,
                                instituteId,
                                student.getUserId(),
                                List.of(LearnerSessionStatusEnum.ACTIVE.name()));

                if (activeMapping.isPresent()) {
                    // User has an active enrollment in a blocking session
                    String customMessage = policy.getOnEnrollment().getBlockMessage();
                    String message = (customMessage != null && !customMessage.isBlank())
                            ? customMessage
                            : "You already have an active membership plan. Demo access is not available for existing paid subscribers.";

                    log.info("Blocking enrollment for user {} - already active in package session {}",
                            student.getUserId(), packageSessionId);

                    throw new EnrollmentConflictException(
                            EnrollmentConflictException.ConflictType.PAID_MEMBER_BLOCKED, message);
                }
            } catch (VacademyException e) {
                throw e; // Re-throw blocking exception
            } catch (Exception e) {
                log.warn("Failed to check blocking session {} for user {}: {}",
                        packageSessionId, student.getUserId(), e.getMessage());
                // Continue checking other sessions
            }
        }
    }

    /**
     * Validates re-enrollment eligibility based on policy settings.
     * Checks gap period for ACTIVE and EXPIRED statuses.
     * Throws VacademyException if re-enrollment is not allowed.
     */
    private void validateReenrollmentEligibility(Student student,
                                                 InstituteStudentDetails details,
                                                 EnrollmentPolicySettingsDTO policy) {
        if (policy == null || policy.getReenrollmentPolicy() == null) {
            return; // No policy = allow
        }

        vacademy.io.admin_core_service.features.enrollment_policy.dto.ReenrollmentPolicyDTO reenrollPolicy = policy
                .getReenrollmentPolicy();

        // Check if re-enrollment is allowed
        if (Boolean.FALSE.equals(reenrollPolicy.getAllowReenrollmentAfterExpiry())) {
            Integer gapDays = reenrollPolicy.getReenrollmentGapInDays();
            if (gapDays == null || gapDays <= 0) {
                return; // No gap specified = allow
            }

            // Find existing mapping (ACTIVE or EXPIRED)
            Optional<StudentSessionInstituteGroupMapping> existingMapping = studentSessionRepository
                    .findTopByPackageSessionIdAndUserIdAndStatusIn(
                            details.getPackageSessionId(),
                            details.getInstituteId(),
                            student.getUserId(),
                            List.of(
                                    LearnerSessionStatusEnum.ACTIVE.name(),
                                    LearnerSessionStatusEnum.EXPIRED.name()));

            if (existingMapping.isPresent()) {
                StudentSessionInstituteGroupMapping mapping = existingMapping.get();
                Date expiryDate = mapping.getExpiryDate();
                Date now = new Date();

                // If expiry date is null, it means infinity - check from updatedAt
                Date checkDate = (expiryDate != null) ? expiryDate : mapping.getUpdatedAt();

                if (checkDate != null) {
                    // Calculate days since expiry/update
                    long daysSince = (now.getTime() - checkDate.getTime()) / (1000 * 60 * 60 * 24);

                    if (daysSince < gapDays) {
                        // Calculate allowed date
                        Date allowedDate = addDaysToDate(checkDate, gapDays);
                        String allowedDateStr = allowedDate.toInstant()
                                .atZone(java.time.ZoneId.systemDefault())
                                .toLocalDate()
                                .format(java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd"));

                        // Use custom message from policy if available
                        String customMessage = reenrollPolicy.getReenrollmentBlockedMessage();
                        String message;
                        if (customMessage != null && !customMessage.isBlank()) {
                            // Replace {{allowed_date}} placeholder
                            message = customMessage.replace("{{allowed_date}}", allowedDateStr);
                        } else {
                            // Default message
                            message = String.format(
                                    "Re-enrollment is not allowed. Please try again after %s. Minimum gap required: %d days.",
                                    allowedDateStr, gapDays);
                        }

                        throw new EnrollmentConflictException(
                                EnrollmentConflictException.ConflictType.REENROLLMENT_BLOCKED, message);
                    }
                }
            }
        }
    }

    private Optional<StudentSessionInstituteGroupMapping> getActiveDestinationMapping(Student student,
                                                                                      InstituteStudentDetails details) {
        if (!StringUtils.hasText(details.getDestinationPackageSessionId())) {
            return Optional.empty();
        }

        return studentSessionRepository.findTopByPackageSessionIdAndUserIdAndStatusIn(
                details.getDestinationPackageSessionId(),
                details.getInstituteId(),
                student.getUserId(),
                List.of(LearnerSessionStatusEnum.ACTIVE.name()) // Only check for ACTIVE
        );
    }

    /**
     * [CORRECTED]
     * Now includes EXPIRED status to correctly handle re-enrollment scenarios.
     */
    private Optional<StudentSessionInstituteGroupMapping> getExistingMapping(Student student,
                                                                             InstituteStudentDetails details) {
        // Excluding the throwaway types in SQL (not with a Java filter on the single row
        // this returns) is what keeps a newer ABANDONED_CART row from hiding the reusable
        // mapping and sending us down the insert path into uq_dest_pkg_inst_user_status.
        return studentSessionRepository.findTopReusableMapping(
                details.getPackageSessionId(),
                details.getInstituteId(),
                student.getUserId(),
                List.of(
                        LearnerSessionStatusEnum.ACTIVE.name(),
                        LearnerSessionStatusEnum.INVITED.name(),
                        LearnerSessionStatusEnum.TERMINATED.name(),
                        LearnerSessionStatusEnum.INACTIVE.name(),
                        LearnerSessionStatusEnum.EXPIRED.name(), // <-- ADDED
                        // Paid flows park mappings here pre-webhook; a re-enrollment
                        // must reuse the row or the insert dies on
                        // uq_dest_pkg_inst_user_status (seen via sub-org re-registration).
                        LearnerStatusEnum.PENDING_FOR_APPROVAL.name()
                ),
                List.of(
                        LearnerSessionTypeEnum.ABANDONED_CART.name(),
                        LearnerSessionTypeEnum.PAYMENT_FAILED.name()
                ));
    }

    /**
     * [REWORKED]
     * Handles updates to an existing mapping, applying policy logic for
     * re-enrollment and repurchasing.
     */
    private String updateExistingMapping(
            StudentSessionInstituteGroupMapping mapping,
            Optional<StudentSessionInstituteGroupMapping> activeDestinationMapping,
            InstituteStudentDetails details,
            EnrollmentPolicySettingsDTO policy) {
        Date now = new Date();
        LearnerSessionStatusEnum currentStatus = LearnerSessionStatusEnum.valueOf(mapping.getStatus());

        // --- 1. Re-enrollment Gap Logic (Point 6: Demo Scenario) ---
        if (currentStatus == LearnerSessionStatusEnum.EXPIRED
                || currentStatus == LearnerSessionStatusEnum.TERMINATED
                || currentStatus == LearnerSessionStatusEnum.ACTIVE) {

            ReenrollmentPolicyDTO reenrollPolicy = policy.getReenrollmentPolicy();
            if (reenrollPolicy != null && !Boolean.TRUE.equals(reenrollPolicy.getAllowReenrollmentAfterExpiry())) {

                Integer gapDays = reenrollPolicy.getReenrollmentGapInDays();
                // Base check on expiry date, or last update time if expiry was null
                Date lastEventDate = mapping.getExpiryDate() != null ? mapping.getExpiryDate() : mapping.getUpdatedAt();

                if (gapDays != null && gapDays > 0 && lastEventDate != null) {
                    Date reEnrollmentAllowedDate = addDaysToDate(lastEventDate, gapDays);

                    if (now.before(reEnrollmentAllowedDate)) {
                        log.warn("Re-enrollment blocked for user {} on packageSession {}. Gap period active until {}.",
                                mapping.getUserId(), mapping.getPackageSession().getId(), reEnrollmentAllowedDate);

                        // Convert Date to LocalDate for formatting
                        LocalDate allowedDate = reEnrollmentAllowedDate.toInstant()
                                .atZone(ZoneId.systemDefault())
                                .toLocalDate();

                        DateTimeFormatter formatter = DateTimeFormatter.ofPattern("yyyy-MM-dd");

                        throw new VacademyException(
                                "Re-enrollment is not allowed for this course at this time. Please try again after "
                                        + allowedDate.format(formatter));
                    }
                }
            }
        }

        // --- 2. Determine Base Date for Expiry Calculation (Point 5: Repurchase) ---
        Date baseDate = now;
        ActiveRepurchaseBehavior behavior = ActiveRepurchaseBehavior.STACK; // Default
        if (policy.getReenrollmentPolicy() != null
                && policy.getReenrollmentPolicy().getActiveRepurchaseBehavior() != null) {
            behavior = policy.getReenrollmentPolicy().getActiveRepurchaseBehavior();
        }

        if (currentStatus == LearnerSessionStatusEnum.ACTIVE && behavior == ActiveRepurchaseBehavior.STACK) {
            if (mapping.getExpiryDate() != null && mapping.getExpiryDate().after(now)) {
                baseDate = mapping.getExpiryDate(); // STACK: Base is current expiry date
            }
        }
        if (activeDestinationMapping.isPresent() && activeDestinationMapping.get().getSubOrg() == null
                && StringUtils.hasText(details.getSubOrgId())) {
            mapping.setSubOrg(instituteRepository.findById(details.getSubOrgId())
                    .orElseThrow(() -> new VacademyException("Sub Org not found")));
        }
        if (activeDestinationMapping.isPresent() && activeDestinationMapping.get().getSubOrg() == null
                && StringUtils.hasText(details.getCommaSeparatedOrgRoles())) {
            mapping.setCommaSeparatedOrgRoles(details.getCommaSeparatedOrgRoles());
        }

        // --- 3. Apply the new plan's access days to the base date resolved above ---
        // Without this, baseDate was computed (STACK from the current expiry, or now)
        // and then thrown away: a learner who re-enrolled or repurchased kept their old,
        // often already-expired, window while createNewMapping's first-time path granted
        // days correctly.
        //
        // Guarded on accessDays being present because paid enrollments arrive here as
        // INVITED with no days yet — their real grant happens in shiftStudentBatch once
        // payment succeeds. makeExpiryDate returns null for absent days, so an unguarded
        // call would clear a live expiry and silently hand out unlimited access.
        Date previousExpiry = mapping.getExpiryDate();
        if (StringUtils.hasText(details.getAccessDays())) {
            mapping.setExpiryDate(makeExpiryDate(baseDate, details.getAccessDays()));
        }

        StudentSessionInstituteGroupMapping saved = studentSessionRepository.save(mapping);
        recordDetailsAccessGrant(details, saved.getId(), saved.getUserId(),
                details.getPackageSessionId(), previousExpiry, saved.getExpiryDate());
        return saved.getId();
    }

    /**
     * [REWORKED]
     * Creates a new mapping, applying policy logic. Uses JPA save() instead of
     * native query.
     */
    private String createNewMapping(
            Student student,
            Optional<StudentSessionInstituteGroupMapping> activeDestinationMapping,
            InstituteStudentDetails details, EnrollmentPolicySettingsDTO policySettingsDTO) {
        UUID studentSessionId = UUID.randomUUID();
        // enrolled_date and the access window must share one base, or the learner list —
        // which derives access days as expiry_date - enrolled_date — reports a different
        // number than the one the enrollment was created with.
        Date enrollmentDate = details.getEnrollmentDate() == null ? new Date() : details.getEnrollmentDate();
        Date baseDate = determineBaseDate(null, activeDestinationMapping, enrollmentDate);
        // Computed once and shared with the audit row below: recomputing it there would
        // let the logged window drift from the one actually written if either call site
        // is ever changed in isolation.
        Date expiryDate = makeExpiryDate(baseDate, details.getAccessDays());

        studentSessionRepository.addStudentToInstitute(
                studentSessionId.toString(),
                student.getUserId(),
                enrollmentDate,
                details.getEnrollmentStatus(),
                generateEnrollmentId(),
                details.getGroupId(),
                details.getInstituteId(),
                expiryDate,
                details.getPackageSessionId(),
                details.getDestinationPackageSessionId(),
                details.getUserPlanId(),
                details.getSubOrgId(),
                details.getCommaSeparatedOrgRoles(),
                details.getType());

        recordDetailsAccessGrant(details, studentSessionId.toString(), student.getUserId(),
                details.getPackageSessionId(), null, expiryDate);

        return studentSessionId.toString();
    }

    /**
     * Records the access window an {@code InstituteStudentDetails}-driven enrollment
     * granted. Used by the two linkStudentToInstitute branches, which carry their access
     * days as a string on the details object rather than resolving them from a user plan.
     */
    private void recordDetailsAccessGrant(InstituteStudentDetails details,
                                          String mappingId,
                                          String userId,
                                          String packageSessionId,
                                          Date previousExpiry,
                                          Date newExpiry) {
        Integer accessDays = null;
        if (StringUtils.hasText(details.getAccessDays())) {
            try {
                accessDays = Integer.parseInt(details.getAccessDays());
            } catch (NumberFormatException ignored) {
                // Logged by makeExpiryDate already; the row is still worth writing.
            }
        }
        learnerAccessService.recordGrant(
                vacademy.io.admin_core_service.features.learner_access.enums
                        .LearnerAccessSourceEnum.ENROLLMENT,
                details.getInstituteId(),
                userId,
                packageSessionId,
                mappingId,
                previousExpiry,
                newExpiry,
                accessDays,
                details.getUserPlanId(),
                null,
                null,
                "Enrollment",
                null,
                null);
    }

    /**
     * The date an access window should be measured from.
     *
     * <p>Stacking wins: if the learner already holds unexpired access to the destination
     * (or to this session), the new days are added on top of that expiry rather than
     * overlapping it.
     *
     * <p>Otherwise the window runs from {@code fallbackDate} — the enrollment date, not
     * "now". The learner list derives a learner's access days as
     * {@code expiry_date - enrolled_date}, so basing a backdated enrollment on now would
     * make it report a different number than the admin typed.
     */
    private Date determineBaseDate(
            StudentSessionInstituteGroupMapping currentMapping,
            Optional<StudentSessionInstituteGroupMapping> activeDestinationMapping,
            Date fallbackDate) {
        Date now = new Date();
        Date base = fallbackDate != null ? fallbackDate : now;

        if (activeDestinationMapping.isPresent()) {
            Date destExpiry = activeDestinationMapping.get().getExpiryDate();
            if (destExpiry != null && destExpiry.after(now)) {
                return destExpiry; // Extend from destination’s expiry
            }
        }

        if (currentMapping != null &&
                LearnerSessionStatusEnum.ACTIVE.name().equalsIgnoreCase(currentMapping.getStatus()) &&
                currentMapping.getExpiryDate() != null) {
            return currentMapping.getExpiryDate().after(now) ? currentMapping.getExpiryDate() : base;
        }

        return base;
    }

    public String shiftStudentBatch(
            StudentSessionInstituteGroupMapping invitedPackageSession,
            String newStatus) {
        return shiftStudentBatch(invitedPackageSession, newStatus, null);
    }

    /**
     * Variant that stamps {@code activeUserPlanId} on the resulting ACTIVE mapping.
     * The plain overload copies user_plan_id from the INVITED row being shifted —
     * but when a learner retried a failed checkout, that INVITED row still points
     * at the FIRST (failed) plan, so the ACTIVE mapping ended up referencing a
     * PAYMENT_FAILED plan instead of the plan that was actually paid. That broke
     * finance/roster joins and defeated the plan-stacking dedupe
     * (hasRealEnrollmentEntries never saw the paid plan's entries).
     */
    public String shiftStudentBatch(
            StudentSessionInstituteGroupMapping invitedPackageSession,
            String newStatus,
            String activeUserPlanId) {
        try {
            String userId = invitedPackageSession.getUserId();
            String instituteId = invitedPackageSession.getInstitute().getId();

            MappingWithPriorAccess resolved = findOrCreateMapping(
                    instituteId, userId, newStatus, invitedPackageSession, activeUserPlanId);
            StudentSessionInstituteGroupMapping mappingToUse = resolved.mapping();

            markOldMappingDeleted(invitedPackageSession);

            StudentSessionInstituteGroupMapping saved = studentSessionRepository.save(mappingToUse);
            recordEnrollmentAccessGrant(instituteId, saved, resolved.previousExpiry());
            return saved.getId();
        } catch (Exception e) {
            e.printStackTrace();
            throw new VacademyException("Failed to link student to institute: " + e.getMessage());
        }
    }

    /**
     * The mapping an enrollment will be written to, paired with the expiry it carried
     * <em>before</em> the plan's validity was applied. The caller needs both to log a
     * truthful "extended from X to Y" — once findOrCreateMapping returns, the old value
     * is gone.
     */
    private record MappingWithPriorAccess(StudentSessionInstituteGroupMapping mapping, Date previousExpiry) {
    }

    private MappingWithPriorAccess findOrCreateMapping(
            String instituteId,
            String userId,
            String newStatus,
            StudentSessionInstituteGroupMapping invitedPackageSession,
            String activeUserPlanId) {
        // The plan the ACTIVE mapping must reference: the explicitly supplied (paid)
        // plan when given, else whatever the shifted row carried.
        String effectiveUserPlanId = StringUtils.hasText(activeUserPlanId)
                ? activeUserPlanId
                : invitedPackageSession.getUserPlanId();
        Optional<StudentSessionInstituteGroupMapping> existingMappingOpt = studentSessionRepository
                .findTopByPackageSessionIdAndUserIdAndStatusIn(
                        invitedPackageSession.getDestinationPackageSession().getId(), instituteId, userId,
                        List.of(LearnerSessionStatusEnum.ACTIVE.name()));
        StudentSessionInstituteGroupMapping activePackageSession;
        if (existingMappingOpt.isPresent()) {
            activePackageSession = existingMappingOpt.get();
            if (StringUtils.hasText(activeUserPlanId)) {
                activePackageSession.setUserPlanId(activeUserPlanId);
            }
        } else {
            activePackageSession = new StudentSessionInstituteGroupMapping();
            activePackageSession.setInstitute(invitedPackageSession.getInstitute());
            activePackageSession.setUserId(invitedPackageSession.getUserId());
            activePackageSession.setInstituteEnrolledNumber(invitedPackageSession.getInstituteEnrolledNumber());
            activePackageSession.setEnrolledDate(new Date());
            activePackageSession.setStatus(newStatus);
            activePackageSession.setPackageSession(invitedPackageSession.getDestinationPackageSession());
            activePackageSession.setUserPlanId(effectiveUserPlanId);
            // Set type to PACKAGE_SESSION for final enrollment (not ABANDONED_CART or PAYMENT_FAILED)
            activePackageSession.setType(LearnerSessionTypeEnum.PACKAGE_SESSION.name());
            // destinationPackageSession should be null for final enrollment (not set)
        }
        if (invitedPackageSession.getSubOrg() != null) {
            activePackageSession.setSubOrg(invitedPackageSession.getSubOrg());
        }
        if (StringUtils.hasText(invitedPackageSession.getCommaSeparatedOrgRoles())) {
            activePackageSession.setCommaSeparatedOrgRoles(invitedPackageSession.getCommaSeparatedOrgRoles());
        }
        Date previousExpiry = activePackageSession.getExpiryDate();
        activePackageSession.setExpiryDate(resolveMappingExpiry(previousExpiry, effectiveUserPlanId));
        return new MappingWithPriorAccess(activePackageSession, previousExpiry);
    }


    /**
     * Writes the access-history row behind an enrollment, so a learner's access timeline
     * begins with "granted 365 days by the Annual plan" instead of starting at whatever
     * an admin later changed by hand.
     *
     * <p>Resolves provenance (which plan or invite supplied the days) from the user plan
     * the mapping now points at — the same source
     * {@link #getValidityDaysFromUserPlan(String)} reads the days from, so the logged
     * figure and the applied figure can never disagree.
     */
    private void recordEnrollmentAccessGrant(String instituteId,
                                             StudentSessionInstituteGroupMapping mapping,
                                             Date previousExpiry) {
        try {
            String userPlanId = mapping.getUserPlanId();
            Integer accessDays = getValidityDaysFromUserPlan(userPlanId);

            String paymentPlanId = null;
            String enrollInviteId = null;
            String planName = null;
            if (StringUtils.hasText(userPlanId)) {
                UserPlan userPlan = userPlanService.findById(userPlanId);
                if (userPlan != null) {
                    if (userPlan.getPaymentPlan() != null) {
                        paymentPlanId = userPlan.getPaymentPlan().getId();
                        planName = userPlan.getPaymentPlan().getName();
                    }
                    if (userPlan.getEnrollInvite() != null) {
                        enrollInviteId = userPlan.getEnrollInvite().getId();
                        if (planName == null) {
                            planName = userPlan.getEnrollInvite().getName();
                        }
                    }
                }
            }

            learnerAccessService.recordGrant(
                    vacademy.io.admin_core_service.features.learner_access.enums
                            .LearnerAccessSourceEnum.ENROLLMENT,
                    instituteId,
                    mapping,
                    previousExpiry,
                    accessDays,
                    userPlanId,
                    paymentPlanId,
                    enrollInviteId,
                    StringUtils.hasText(planName) ? "Enrolled via " + planName : "Enrollment",
                    null,
                    null);
        } catch (Exception e) {
            // The enrollment is the thing that matters; a missing history row must never
            // undo it.
            log.warn("Could not record access grant for user {} in institute {}: {}",
                    mapping != null ? mapping.getUserId() : null, instituteId, e.getMessage());
        }
    }

    /**
     * Wrapper method for backward compatibility.
     * Calculates expiry date based on PaymentPlan from UserPlan.
     */
    private Date getExpiryDateBasedOnPaymentPlan(StudentSessionInstituteGroupMapping mapping, String userPlanId) {
        Date baseDate = mapping.getExpiryDate() != null ? mapping.getExpiryDate() : new Date();
        return calculateNewExpiryDate(baseDate, userPlanId, null);
    }

    private void updateMappingFields(
            StudentSessionInstituteGroupMapping mappingToUse,
            StudentSessionInstituteGroupMapping sourceMapping,
            String newStatus) {
        mappingToUse.setEnrolledDate(new Date());
        mappingToUse.setStatus(newStatus);

        if (sourceMapping.getInstituteEnrolledNumber() != null) {
            mappingToUse.setInstituteEnrolledNumber(sourceMapping.getInstituteEnrolledNumber());
        }

        if (sourceMapping.getExpiryDate() != null) {
            mappingToUse.setExpiryDate(sourceMapping.getExpiryDate());
        }
    }

    /**
     * [NEW HELPER]
     * Calculates the new expiry date based on V2 (UserPlan) or V1
     * (legacyAccessDays).
     *
     * @param baseDate         The date to add validity to (either 'now' or a future
     *                         expiry date).
     * @param userPlanId       The ID of the V2 UserPlan.
     * @param legacyAccessDays The V1 access days string.
     * @return A new Date, or null if access is unlimited.
     */
    /**
     * How long this mapping grants access: the PLAN'S OWN {@code end_date} whenever the
     * mapping references a user plan, falling back to the validity arithmetic only when
     * there is no plan to read (legacy / access-days enrolments).
     *
     * <p>Two bugs lived in the arithmetic this replaces, and both came from the mapping
     * computing its own answer instead of reading the one the plan already holds.
     *
     * <p><b>1. A trial inherited the PAID window.</b> {@code calculateNewExpiryDate} resolves
     * {@code paymentPlan.getValidityInDays()} and never looks at {@code is_trial}, so signing
     * up for a 15-day trial on an "Annual" plan stamped the mapping with 360 days while
     * {@code user_plan.end_date} correctly held the trial end. Nothing noticed, because a
     * successful conversion overwrites the mapping expiry anyway
     * ({@code RenewalPaymentService.handleSuccessfulRenewal}) and a failed one deactivates the
     * mapping ({@code expirePlan}). Only a trial that CANCELLED — neither converted nor
     * dunned — kept the wrong value, and it kept it silently: the class-reminder audience
     * filters on {@code ssigm.expiry_date} and never consults {@code user_plan.status}, so a
     * cancelled learner went on receiving daily class links.
     *
     * <p><b>2. A repeated enrolment STACKED it.</b> The old base date was
     * {@code previousExpiry != null ? previousExpiry : new Date()}, so each pass added another
     * full validity on top of whatever the row already had. An INVITED mapping already carries
     * an expiry, and a learner who submits twice re-enters this path: one SuchBliss trial
     * signed up twice seven minutes apart and came out with {@code enrolled + 720} days —
     * exactly 2 x her 360-day plan — expiring in September 2028 off a 15-day trial.
     *
     * <p>{@code end_date} is computed once, by the code that owns the plan's window, and is
     * the value every other site already writes here —
     * {@code LearnerBatchEnrollService}, {@code AccessPassEntitlementService} and both arms of
     * {@code handleSuccessfulRenewal}. Reading it makes trial-vs-paid and single-vs-repeated
     * enrolment all resolve to the same answer, and makes stacking structurally impossible:
     * extending access now means extending the plan, which is where it belongs.
     *
     * <p>Access is never SHORTENED by this: {@code previousExpiry} wins when it is already
     * later than the plan's end, so a learner who genuinely holds a longer entitlement (a
     * stacked term, an admin extension) keeps it.
     */
    private Date resolveMappingExpiry(Date previousExpiry, String userPlanId) {
        Date planEnd = null;
        if (StringUtils.hasText(userPlanId)) {
            UserPlan userPlan = userPlanService.findById(userPlanId);
            planEnd = userPlan != null ? userPlan.getEndDate() : null;
        }
        if (planEnd == null) {
            // No plan to read -- keep the legacy arithmetic for access-days enrolments.
            Date baseDate = previousExpiry != null ? previousExpiry : new Date();
            return calculateNewExpiryDate(baseDate, userPlanId, null);
        }
        if (previousExpiry != null && previousExpiry.after(planEnd)) {
            log.info("Mapping already grants access to {} which is beyond plan {} end {} -- keeping it",
                    previousExpiry, userPlanId, planEnd);
            return previousExpiry;
        }
        return planEnd;
    }

    private Date calculateNewExpiryDate(Date baseDate, String userPlanId, String legacyAccessDays) {
        Integer validityDays = getValidityDaysFromUserPlan(userPlanId);

        if (validityDays == null && StringUtils.hasText(legacyAccessDays)) {
            // Fallback to V1 logic if no V2 plan is found
            try {
                validityDays = Integer.parseInt(legacyAccessDays);
            } catch (NumberFormatException e) {
                log.warn("Could not parse legacyAccessDays: {}", legacyAccessDays);
                validityDays = null;
            }
        }

        if (validityDays == null) {
            // Unlimited access
            return null;
        }

        if (validityDays <= 0) {
            // No extension, just return the base date (e.g., for free plans with 0 days)
            return baseDate;
        }

        return addDaysToDate(baseDate, validityDays);
    }

    /**
     * [NEW HELPER]
     * Utility to add days to a date.
     */
    private Date addDaysToDate(Date date, int days) {
        if (date == null) {
            return null;
        }
        Calendar calendar = Calendar.getInstance();
        calendar.setTime(date);
        calendar.add(Calendar.DAY_OF_YEAR, days);
        return calendar.getTime();
    }

    /**
     * [REFACTORED]
     * Renamed from getExpiryDateBasedOnPaymentPlan.
     * Returns the number of validity days from a UserPlan, or null for unlimited.
     */
    private Integer getValidityDaysFromUserPlan(String userPlanId) {
        if (userPlanId == null)
            return null;

        UserPlan userPlan = userPlanService.findById(userPlanId);
        if (userPlan == null)
            return null;

        EnrollInvite enrollInvite = userPlan.getEnrollInvite();
        PaymentOption paymentOption = userPlan.getPaymentOption();
        PaymentPlan paymentPlan = userPlan.getPaymentPlan();

        Integer validityDays = null;

        if (paymentOption != null) {
            String type = paymentOption.getType();

            if (PaymentOptionType.ONE_TIME.name().equalsIgnoreCase(type) ||
                    PaymentOptionType.SUBSCRIPTION.name().equalsIgnoreCase(type)) {

                validityDays = (paymentPlan != null) ? paymentPlan.getValidityInDays() : null;

            } else if (PaymentOptionType.DONATION.name().equalsIgnoreCase(type)) {

                validityDays = (enrollInvite != null) ? enrollInvite.getLearnerAccessDays() : null;

            } else { // Defaults to FREE
                validityDays = (enrollInvite != null) ? enrollInvite.getLearnerAccessDays() : null;
            }
        } else if (enrollInvite != null) {
            // Fallback for cases where paymentOption might be null (e.g., pure free invite)
            validityDays = enrollInvite.getLearnerAccessDays();
        }

        return validityDays; // Will be null if unlimited, or an Integer
    }

    private void markOldMappingDeleted(StudentSessionInstituteGroupMapping mapping) {
        if (mapping == null)
            return; // safety check

        String userId = mapping.getUserId();
        String packageSessionId = mapping.getPackageSession() != null ? mapping.getPackageSession().getId() : null;
        String instituteId = mapping.getInstitute() != null ? mapping.getInstitute().getId() : null;
        String destinationPackageSessionId = mapping.getDestinationPackageSession() != null
                ? mapping.getDestinationPackageSession().getId()
                : null;
        String deletedStatus = LearnerSessionStatusEnum.DELETED.name();

        // Only call delete if at least userId and status are available
        if (userId != null) {
            studentSessionRepository.deleteByUniqueConstraint(
                    userId,
                    destinationPackageSessionId,
                    packageSessionId,
                    instituteId,
                    deletedStatus);
        }

        // Mark current mapping as deleted
        mapping.setStatus(deletedStatus);
        studentSessionRepository.save(mapping);
    }

    public List<String> getStudentRoles() {
        List<String> roles = new ArrayList<>();
        roles.add(StudentConstants.studentRole);
        return roles;
    }

    public Date makeExpiryDate(Date enrollmentDate, String accessDays) {
        try {
            if (enrollmentDate == null || accessDays == null) {
                return null;
            }
            return addDaysToDate(enrollmentDate, Integer.parseInt(accessDays));
        } catch (Exception e) {
            log.warn("Failed to parse and add accessDays: {}", e.getMessage());
        }
        return null;
    }

    private Optional<Student> getExistingStudentByUserNameAndUserId(String username, String userId) {
        return instituteStudentRepository.findTopByUserIdOrderByCreatedAtDesc(userId);
    }

    public InstituteStudentDTO updateAsPerConfig(InstituteStudentDTO instituteStudentDTO,
                                                 BulkUploadInitRequest bulkUploadInitRequest) {
        if (Objects.isNull(bulkUploadInitRequest)) {
            return instituteStudentDTO;
        }
        BulkUploadInitRequest.AutoGenerateConfig autoConfig = bulkUploadInitRequest.getAutoGenerateConfig();
        BulkUploadInitRequest.ExpiryAndStatusConfig expiryAndStatusConfig = bulkUploadInitRequest
                .getExpiryAndStatusConfig();
        BulkUploadInitRequest.OptionalFieldsConfig optionalFieldsConfig = bulkUploadInitRequest
                .getOptionalFieldsConfig();

        // Auto-generate username if required
        if (autoConfig.isAutoGenerateUsername()) {
            instituteStudentDTO.getUserDetails()
                    .setUsername(generateUsername(instituteStudentDTO.getUserDetails().getFullName()).toLowerCase());
        }

        // Auto-generate password if required
        if (autoConfig.isAutoGeneratePassword()
                || StringUtils.isEmpty(instituteStudentDTO.getUserDetails().getPassword())) {
            instituteStudentDTO.getUserDetails().setPassword(generatePassword());
        }

        // Auto-generate enrollment number if required
        if (autoConfig.isAutoGenerateEnrollmentId()) {
            instituteStudentDTO.getInstituteStudentDetails().setEnrollmentId(generateEnrollmentId());
        }

        // Set expiry days if included
        if (expiryAndStatusConfig.isIncludeExpiryDays()) {
            instituteStudentDTO.getInstituteStudentDetails()
                    .setAccessDays(bulkUploadInitRequest.getExpiryAndStatusConfig().getExpiryDays().toString());
        }

        // Set enrollment status if included
        if (expiryAndStatusConfig.isIncludeEnrollmentStatus()) {
            instituteStudentDTO.getInstituteStudentDetails()
                    .setEnrollmentStatus(bulkUploadInitRequest.getExpiryAndStatusConfig().getEnrollmentStatus());
        }

        return instituteStudentDTO;
    }

    private String generateUsername(String fullName) {
        // Ensure full name has at least 4 characters, else pad with "X"
        // Bound the cut by the stripped length: "A B C" strips to 3 characters while the
        // raw length is 5, and cutting 4 threw StringIndexOutOfBoundsException.
        String stripped = fullName == null ? "" : fullName.replaceAll("\\s+", "");
        String namePart = stripped.substring(0, Math.min(stripped.length(), 4)).toLowerCase();
        if (namePart.length() < 4) {
            namePart = String.format("%-4s", namePart).replace(' ', 'X');
        }

        // Generate 4 random digits
        String randomDigits = RandomStringUtils.randomNumeric(4);

        return namePart + randomDigits;
    }

    private String generatePassword() {
        return RandomStringUtils.randomAlphanumeric(8);
    }

    private String generateEnrollmentId() {
        return RandomStringUtils.randomNumeric(6);
    }

    public String addStudent(UserDTO userDTO) {
        return createStudentFromRequest(userDTO, null).getId();
    }

    public void triggerEnrollmentWorkflow(String instituteId, UserDTO userDTO, String packageSessionId,
                                          Institute subOrg) {
        triggerEnrollmentWorkflow(instituteId, userDTO, packageSessionId, subOrg, null);
    }

    /**
     * Same, with the plan the enrollment belongs to, so the event can say whether this is a
     * TRIAL or a PAID membership. Prefer this overload wherever a plan is known.
     */
    public void triggerEnrollmentWorkflow(String instituteId, UserDTO userDTO, String packageSessionId,
                                          Institute subOrg, String userPlanId) {
        // Validate and gather context UP-FRONT while we still have references.
        // The actual workflow firing is deferred until after the parent transaction
        // commits (see below) — if it errored later, we still want the validation
        // failures to surface synchronously to the caller.
        Optional<PackageSession> packageSession = packageSessionRepository.findById(packageSessionId);
        if (packageSession.isEmpty()) {
            throw new VacademyException("Package Session Not Found");
        }
        var pkg = packageSession.get().getPackageEntity();

        final Map<String, Object> contextData = new HashMap<>();
        contextData.put("user", userDTO);
        contextData.put("packageSessionIds", packageSessionId);
        contextData.put("subOrg", subOrg);
        contextData.put("packageId", pkg.getId());
        // Exposed as {{packageName}} on the workflow context so SEND_EMAIL templates
        // and HTTP_REQUEST webhook bodies can reference the course name directly
        // without needing a separate QUERY node to look it up.
        contextData.put("packageName", pkg.getPackageName());
        // May a workflow overwrite an LMS account that already exists for this learner?
        // Resolved here, once, rather than by a QUERY node in each graph: the setting is
        // course-then-institute (see LmsExistingUserEditPolicyService) and the graph has no
        // clean way to express that fallback in SpEL. Nodes gate on
        // #ctx['lmsEditExistingUser'] == true. Best-effort — a failure to read it must not
        // stop the enrolment, and false is the safe answer (leave the LMS account alone).
        boolean mayEditExistingLmsUser = false;
        try {
            mayEditExistingLmsUser = lmsExistingUserEditPolicyService
                    .mayEditExistingUser(instituteId, pkg.getId());
        } catch (Exception e) {
            log.warn("Could not resolve {} for institute {} / package {} — defaulting to false: {}",
                    LmsExistingUserEditPolicyService.CONTEXT_KEY, instituteId, pkg.getId(), e.getMessage());
        }
        contextData.put(LmsExistingUserEditPolicyService.CONTEXT_KEY, mayEditExistingLmsUser);

        // Trial or paid? This event carried no membership shape at all, so a workflow on it
        // could not tell a trial joiner from a paying member — the same greeting, and the same
        // 14-day trial drip, fired for both. Both of the happy flows end here: a first-time
        // signup that lands on a trial, and a returning member (cancelled or renewal-failed)
        // who pays to continue and must go straight to the regular classes. The shape has to
        // travel with the event for those two to be addressable at all.
        //
        // Gate workflow conditions on membershipType ('TRIAL' / 'PAID'). UNKNOWN means no plan
        // was resolvable (admin direct enrolment, bulk assignment, free courses) and must
        // never be read as either one.
        String membershipType = "UNKNOWN";
        boolean isTrialMembership = false;
        if (StringUtils.hasText(userPlanId)) {
            try {
                UserPlan plan = userPlanService.findById(userPlanId);
                if (plan != null) {
                    isTrialMembership = Boolean.TRUE.equals(plan.getIsTrial());
                    membershipType = isTrialMembership ? "TRIAL" : "PAID";
                }
            } catch (Exception e) {
                log.warn("Could not resolve the membership shape for plan {} — the enrollment "
                        + "workflow context will say UNKNOWN: {}", userPlanId, e.getMessage());
            }
        }
        contextData.put("userPlanId", userPlanId);
        contextData.put("isTrial", isTrialMembership);
        contextData.put("membershipType", membershipType);

        final String eventName = WorkflowTriggerEvent.LEARNER_BATCH_ENROLLMENT.name();
        final String finalInstituteId = instituteId;
        final String finalPackageSessionId = packageSessionId;

        // Defer firing the workflow until AFTER the parent transaction commits.
        //
        // Why: this method is typically called from inside transactions that have
        // not yet committed their SSIGM / payment_log / user_plan updates — e.g.
        // the Razorpay webhook flow sets SSIGM=ACTIVE and payment_log=PAID, then
        // calls triggerEnrollmentWorkflow, then commits. If the workflow runs
        // synchronously (via REQUIRES_NEW on handleTriggerEvents), the QUERY
        // node opens a NEW transaction that can't see the parent's uncommitted
        // writes → enrichment fields (enrollmentStatus, paymentStatus, etc.)
        // come back null in the webhook body.
        //
        // afterCommit guarantees the workflow only fires once the parent's
        // writes are durable. If the parent rolls back, the workflow never
        // fires — which is the desired behavior (no false-positive webhooks
        // for enrollments that didn't actually happen).
        //
        // Falls back to running synchronously when there's no active transaction
        // (test scenarios, async callers without a tx wrapper, etc.).
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    try {
                        workflowTriggerService.handleTriggerEvents(
                                eventName, finalPackageSessionId, finalInstituteId, contextData);
                    } catch (Exception e) {
                        // Swallow + log: parent tx is already committed, we cannot
                        // roll back. A workflow failure here must not propagate as
                        // it would otherwise be silently dropped by Spring's
                        // afterCommit dispatcher anyway.
                        log.error("Failed to fire LEARNER_BATCH_ENROLLMENT workflow trigger "
                                + "after commit for userId={}, packageSessionId={}: {}",
                                userDTO != null ? userDTO.getId() : null,
                                finalPackageSessionId, e.getMessage(), e);
                    }
                }
            });
        } else {
            workflowTriggerService.handleTriggerEvents(
                    eventName, packageSessionId, instituteId, contextData);
        }
    }
}
