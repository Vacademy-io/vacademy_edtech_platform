package vacademy.io.admin_core_service.features.institute_learner.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.institute_learner.entity.StudentSessionInstituteGroupMapping;
import vacademy.io.admin_core_service.features.institute_learner.enums.LearnerSessionStatusEnum;
import vacademy.io.admin_core_service.features.institute_learner.enums.LearnerSessionTypeEnum;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionRepository;
import vacademy.io.admin_core_service.features.packages.enums.PackageSessionStatusEnum;
import vacademy.io.admin_core_service.features.packages.enums.PackageStatusEnum;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.user_subscription.dto.policy.EnrollmentPolicyJsonDTOs;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.session.PackageSession;

import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Optional;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.institute.entity.Institute;

/**
 * Service to handle learner enrollment entry creation with ABANDONED_CART
 * type tracking.
 * This creates an initial tracking entry before payment/workflow processing.
 */
@Slf4j
@Service
public class LearnerEnrollmentEntryService {

    @Autowired
    private StudentSessionRepository studentSessionRepository;

    @Autowired
    private PackageSessionRepository packageSessionRepository;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private InstituteRepository instituteRepository;

    @Autowired
    private vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService workflowTriggerService;

    /**
     * Finds the INVITED package session for a given actual package session.
     * Every package has an INVITED session where level_id='INVITED' and
     * session_id='INVITED'.
     *
     * @param actualPackageSessionId The actual package session ID from frontend
     * @return The INVITED package session
     * @throws VacademyException if no INVITED session found
     */
    public PackageSession findInvitedPackageSession(String actualPackageSessionId) {
        Optional<PackageSession> invitedSession = packageSessionRepository.findInvitedPackageSessionForPackage(
                actualPackageSessionId,
                "INVITED",
                "INVITED",
                List.of(PackageSessionStatusEnum.INVITED.name()),
                List.of(PackageSessionStatusEnum.ACTIVE.name(), PackageSessionStatusEnum.HIDDEN.name()),
                List.of(PackageStatusEnum.ACTIVE.name()));

        if (invitedSession.isEmpty()) {
            log.error("No INVITED package session found for package session ID: {}", actualPackageSessionId);
            throw new VacademyException("No INVITED package session found for enrollment");
        }

        return invitedSession.get();
    }

    /**
     * Physically deletes previous ABANDONED_CART and PAYMENT_FAILED entries.
     * Called when a user re-submits the enrollment form.
     *
     * <p>This is a hard DELETE, not a status flip — soft-deleting tripped
     * uq_dest_pkg_inst_user_status on a third enrollment attempt, because a row with
     * status='DELETED' already existed from the previous cleanup. Side effect worth
     * knowing: checkout-attempt history is not retained. Capturing it would need a
     * separate append-only table, not a change here.
     *
     * @param userId                  The user ID
     * @param invitedPackageSessionId The INVITED package session ID
     * @param actualPackageSessionId  The actual (destination) package session ID
     * @param instituteId             The institute ID
     * @return Number of rows physically deleted
     */
    public int deletePreviousThrowawayEntries(String userId, String invitedPackageSessionId,
            String actualPackageSessionId, String instituteId) {
        List<String> typesToDelete = List.of(
                LearnerSessionTypeEnum.ABANDONED_CART.name(),
                LearnerSessionTypeEnum.PAYMENT_FAILED.name());

        int deletedCount = studentSessionRepository.deleteThrowawayEntries(
                userId,
                invitedPackageSessionId,
                actualPackageSessionId,
                instituteId,
                typesToDelete);

        log.info("Hard-deleted {} previous throwaway entries for user: {}, destination: {}",
                deletedCount, userId, actualPackageSessionId);
        return deletedCount;
    }

    /**
     * Creates an ABANDONED_CART entry for initial form submission tracking.
     *
     * @param userId                The user ID
     * @param invitedPackageSession The INVITED package session
     * @param actualPackageSession  The actual (destination) package session
     * @param instituteId           The institute ID
     * @param userPlanId            The user plan ID (can be null for form-fill
     *                              step, updated later during payment)
     * @return The created mapping
     */
    public StudentSessionInstituteGroupMapping createOnlyDetailsFilledEntry(
            String userId,
            PackageSession invitedPackageSession,
            PackageSession actualPackageSession,
            String instituteId,
            String userPlanId) {
        return createOnlyDetailsFilledEntry(
                userId, invitedPackageSession, actualPackageSession, instituteId, userPlanId, null);
    }

    /**
     * Preferred overload — accepts the caller's UserDTO so the ABANDONED_CART
     * workflow context can include the full user object alongside the IDs.
     * Without this, downstream HTTP_REQUEST / SEND_EMAIL nodes can't access
     * #ctx['user'].fullName / .email / .mobileNumber and webhook payloads
     * come back with null Name/Phone/Email fields.
     */
    public StudentSessionInstituteGroupMapping createOnlyDetailsFilledEntry(
            String userId,
            PackageSession invitedPackageSession,
            PackageSession actualPackageSession,
            String instituteId,
            String userPlanId,
            UserDTO userDTO) {

        // Fetch institute entity
        Institute institute = instituteRepository.findById(instituteId).orElse(null);
        if (institute == null) {
            log.warn("Institute not found for ID: {}. Entry will be created without institute.", instituteId);
        }

        StudentSessionInstituteGroupMapping mapping = new StudentSessionInstituteGroupMapping();
        mapping.setUserId(userId);
        mapping.setPackageSession(invitedPackageSession);
        mapping.setDestinationPackageSession(actualPackageSession);
        mapping.setType(LearnerSessionTypeEnum.ABANDONED_CART.name());
        mapping.setStatus(LearnerSessionStatusEnum.ACTIVE.name());
        mapping.setEnrolledDate(new Date());
        if (userPlanId != null) {
            mapping.setUserPlanId(userPlanId);
        }
        mapping.setInstitute(institute);

        StudentSessionInstituteGroupMapping saved = studentSessionRepository.save(mapping);
        log.info(
                "Created ABANDONED_CART entry with ID: {} for user: {}, destination: {}, institute: {}, userPlanId: {}",
                saved.getId(), userId, actualPackageSession.getId(), instituteId, userPlanId);

        // Trigger ABANDONED_CART workflow.
        // Context shape intentionally mirrors what
        // StudentRegistrationManager.triggerEnrollmentWorkflow
        // builds for LEARNER_BATCH_ENROLLMENT, so the same webhook payload template
        // (Name/Phone/Email/CourseName referencing #ctx['user'] and
        // #ctx['packageName'])
        // works for both events. Payment fields are intentionally absent — at
        // ABANDONED_CART time the learner hasn't paid yet.
        try {
            java.util.Map<String, Object> contextData = new java.util.HashMap<>();
            contextData.put("userId", userId);
            contextData.put("userPlanId", userPlanId);
            // Match the singular + plural keys LEARNER_BATCH_ENROLLMENT uses,
            // so SpEL like #ctx['packageSessionIds'] works in either workflow.
            contextData.put("packageSessionId", actualPackageSession.getId());
            contextData.put("packageId",
                    actualPackageSession.getPackageEntity() != null ? actualPackageSession.getPackageEntity().getId()
                            : null);
            contextData.put("packageSessionIds", actualPackageSession.getId());
            if (actualPackageSession.getPackageEntity() != null) {
                contextData.put("packageId", actualPackageSession.getPackageEntity().getId());
                contextData.put("packageName", actualPackageSession.getPackageEntity().getPackageName());
            } else {
                contextData.put("packageId", null);
                contextData.put("packageName", null);
            }
            if (userDTO != null) {
                contextData.put("user", userDTO);
            }
            workflowTriggerService.handleTriggerEvents(
                    vacademy.io.admin_core_service.features.workflow.enums.WorkflowTriggerEvent.ABANDONED_CART.name(),
                    invitedPackageSession.getId(), instituteId, contextData);
        } catch (Exception e) {
            log.warn("Failed to trigger ABANDONED_CART workflow", e);
        }

        return saved;
    }

    /**
     * Creates a PAYMENT_FAILED entry when payment fails.
     *
     * @param userId                The user ID
     * @param invitedPackageSession The INVITED package session
     * @param actualPackageSession  The actual (destination) package session
     * @param instituteId           The institute ID
     * @param userPlanId            The user plan ID
     * @return The created mapping
     */
    public StudentSessionInstituteGroupMapping createPaymentFailedEntry(
            String userId,
            PackageSession invitedPackageSession,
            PackageSession actualPackageSession,
            String instituteId,
            String userPlanId) {

        // Fetch institute entity
        Institute institute = instituteRepository.findById(instituteId).orElse(null);
        if (institute == null) {
            log.warn("Institute not found for ID: {}. Entry will be created without institute.", instituteId);
        }

        StudentSessionInstituteGroupMapping mapping = new StudentSessionInstituteGroupMapping();
        mapping.setUserId(userId);
        mapping.setPackageSession(invitedPackageSession);
        mapping.setDestinationPackageSession(actualPackageSession);
        mapping.setType(LearnerSessionTypeEnum.PAYMENT_FAILED.name());
        mapping.setStatus(LearnerSessionStatusEnum.ACTIVE.name());
        mapping.setEnrolledDate(new Date());
        mapping.setUserPlanId(userPlanId);
        mapping.setInstitute(institute);

        StudentSessionInstituteGroupMapping saved = studentSessionRepository.save(mapping);
        log.info("Created PAYMENT_FAILED entry with ID: {} for user: {}, destination: {}, institute: {}",
                saved.getId(), userId, actualPackageSession.getId(), instituteId);

        return saved;
    }

    /**
     * Checks if workflow is configured for the package session.
     *
     * @param packageSession The package session to check
     * @return true if workflow is enabled, false otherwise
     */
    public boolean hasWorkflowConfiguration(PackageSession packageSession) {
        try {
            String enrollmentPolicySettings = packageSession.getEnrollmentPolicySettings();
            if (!StringUtils.hasText(enrollmentPolicySettings)) {
                return false;
            }

            EnrollmentPolicyJsonDTOs.EnrollmentPolicySettingsDTO settings = objectMapper.readValue(
                    enrollmentPolicySettings,
                    EnrollmentPolicyJsonDTOs.EnrollmentPolicySettingsDTO.class);

            if (settings.getWorkflow() == null) {
                return false;
            }

            return Boolean.TRUE.equals(settings.getWorkflow().getEnabled())
                    && settings.getWorkflow().getWorkflows() != null
                    && !settings.getWorkflow().getWorkflows().isEmpty();

        } catch (Exception e) {
            log.warn("Error parsing enrollment policy settings for package session {}: {}",
                    packageSession.getId(), e.getMessage());
            return false;
        }
    }

    /**
     * Gets the workflow configuration for a package session.
     *
     * @param packageSession The package session
     * @return The workflow config DTO or null if not configured
     */
    public EnrollmentPolicyJsonDTOs.WorkflowConfigDTO getWorkflowConfiguration(PackageSession packageSession) {
        try {
            String enrollmentPolicySettings = packageSession.getEnrollmentPolicySettings();
            if (!StringUtils.hasText(enrollmentPolicySettings)) {
                return null;
            }

            EnrollmentPolicyJsonDTOs.EnrollmentPolicySettingsDTO settings = objectMapper.readValue(
                    enrollmentPolicySettings,
                    EnrollmentPolicyJsonDTOs.EnrollmentPolicySettingsDTO.class);

            return settings.getWorkflow();

        } catch (Exception e) {
            log.warn("Error parsing enrollment policy settings for package session {}: {}",
                    packageSession.getId(), e.getMessage());
            return null;
        }
    }

    /**
     * Gets the list of workflow IDs configured for a package session.
     *
     * @param packageSession The package session
     * @return List of workflow IDs (empty if none configured)
     */
    public List<String> getWorkflowIds(PackageSession packageSession) {
        try {
            EnrollmentPolicyJsonDTOs.WorkflowConfigDTO workflowConfig = getWorkflowConfiguration(packageSession);

            if (workflowConfig == null || !Boolean.TRUE.equals(workflowConfig.getEnabled())) {
                return List.of();
            }

            if (workflowConfig.getWorkflows() == null || workflowConfig.getWorkflows().isEmpty()) {
                return List.of();
            }

            return workflowConfig.getWorkflows().stream()
                    .map(EnrollmentPolicyJsonDTOs.WorkflowItemDTO::getWorkflowId)
                    .filter(id -> id != null && !id.isBlank())
                    .toList();

        } catch (Exception e) {
            log.warn("Error getting workflow IDs for package session {}: {}",
                    packageSession.getId(), e.getMessage());
            return List.of();
        }
    }

    /**
     * Finds ABANDONED_CART entries for a specific user plan.
     * Used during payment webhook processing.
     *
     * @param userId      The user ID
     * @param userPlanId  The user plan ID
     * @param instituteId The institute ID
     * @return List of matching entries
     */
    public List<StudentSessionInstituteGroupMapping> findOnlyDetailsFilledEntriesForUserPlan(
            String userId, String userPlanId, String instituteId) {

        return studentSessionRepository.findAllByUserPlanIdAndStatusIn(
                userPlanId,
                List.of(LearnerSessionStatusEnum.ACTIVE.name())).stream()
                .filter(m -> LearnerSessionTypeEnum.ABANDONED_CART.name().equals(m.getType()))
                .filter(m -> m.getInstitute() != null && instituteId.equals(m.getInstitute().getId()))
                .toList();
    }

    /**
     * Updates ABANDONED_CART entries with the userPlanId when payment is initiated.
     * Called during the enroll/payment step after form-fill.
     *
     * @param userId                       The user ID
     * @param destinationPackageSessionIds The destination package session IDs
     * @param instituteId                  The institute ID
     * @param userPlanId                   The user plan ID to set
     * @return Number of entries updated
     */
    public int updateAbandonedCartEntriesWithUserPlanId(
            String userId,
            List<String> destinationPackageSessionIds,
            String instituteId,
            String userPlanId) {

        int updatedCount = 0;

        for (String destinationPackageSessionId : destinationPackageSessionIds) {
            List<StudentSessionInstituteGroupMapping> entries = studentSessionRepository
                    .findByUserIdAndDestinationPackageSession_IdAndStatusIn(
                            userId,
                            destinationPackageSessionId,
                            List.of(LearnerSessionStatusEnum.ACTIVE.name()));

            for (StudentSessionInstituteGroupMapping entry : entries) {
                if (LearnerSessionTypeEnum.ABANDONED_CART.name().equals(entry.getType())
                        && entry.getInstitute() != null
                        && instituteId.equals(entry.getInstitute().getId())
                        && entry.getUserPlanId() == null) {
                    entry.setUserPlanId(userPlanId);
                    studentSessionRepository.save(entry);
                    updatedCount++;
                    log.info("Updated ABANDONED_CART entry {} with userPlanId: {}", entry.getId(), userPlanId);
                }
            }
        }

        log.info("Updated {} ABANDONED_CART entries with userPlanId: {} for user: {}",
                updatedCount, userPlanId, userId);
        return updatedCount;
    }

    /**
     * Finds existing ABANDONED_CART entries for a user and destination package
     * sessions.
     * Used to check if form-fill step was already completed.
     *
     * @param userId                       The user ID
     * @param destinationPackageSessionIds The destination package session IDs
     * @param instituteId                  The institute ID
     * @return List of ABANDONED_CART entries
     */
    public List<StudentSessionInstituteGroupMapping> findExistingAbandonedCartEntries(
            String userId,
            List<String> destinationPackageSessionIds,
            String instituteId) {

        List<StudentSessionInstituteGroupMapping> allEntries = new ArrayList<>();

        for (String destinationPackageSessionId : destinationPackageSessionIds) {
            List<StudentSessionInstituteGroupMapping> entries = studentSessionRepository
                    .findByUserIdAndDestinationPackageSession_IdAndStatusIn(
                            userId,
                            destinationPackageSessionId,
                            List.of(LearnerSessionStatusEnum.ACTIVE.name()));

            entries.stream()
                    .filter(e -> LearnerSessionTypeEnum.ABANDONED_CART.name().equals(e.getType()))
                    .filter(e -> e.getInstitute() != null && instituteId.equals(e.getInstitute().getId()))
                    .forEach(allEntries::add);
        }

        return allEntries;
    }
}
