package vacademy.io.admin_core_service.features.enrollment_policy.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.CollectionUtils;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.enrollment_policy.dto.EnrollmentPolicySettingsDTO;
import vacademy.io.admin_core_service.features.enrollment_policy.processor.EnrolmentContext;
import vacademy.io.admin_core_service.features.enrollment_policy.processor.EnrolmentProcessorFactory;
import vacademy.io.admin_core_service.features.enrollment_policy.service.SubOrgAdminService;
import vacademy.io.admin_core_service.features.institute_learner.entity.StudentSessionInstituteGroupMapping;
import vacademy.io.admin_core_service.features.institute_learner.enums.LearnerSessionStatusEnum;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.enums.UserPlanSourceEnum;
import vacademy.io.admin_core_service.features.user_subscription.enums.UserPlanStatusEnum;
import vacademy.io.admin_core_service.features.user_subscription.repository.UserPlanRepository;
import vacademy.io.common.auth.dto.UserDTO;

import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Slf4j
public class PackageSessionEnrolmentService {

    private final UserPlanRepository userPlanRepository;
    private final StudentSessionInstituteGroupMappingRepository mappingRepository;
    private final EnrolmentProcessorFactory processorFactory;
    private final ObjectMapper objectMapper;
    private final AuthService authService;
    private final SubOrgAdminService subOrgAdminService;

    /**
     * Institute-gated variant used by the daily renewal scheduler: loads only
     * the plans of institutes that opted in via
     * PAYMENT_SETTING.packageSessionRenewalSchedulerEnabled, instead of the
     * whole user_plan table.
     */
    @Transactional
    public void processActiveEnrollmentsForInstitutes(List<String> instituteIds) {
        if (CollectionUtils.isEmpty(instituteIds)) {
            log.info("No institutes opted into renewal-scheduler processing");
            return;
        }
        log.info("Starting processing of ACTIVE UserPlans for {} institute(s)", instituteIds.size());

        List<UserPlan> activeUserPlans = userPlanRepository.findAllByStatusInAndInstituteIdIn(
                List.of(UserPlanStatusEnum.ACTIVE.name(), UserPlanStatusEnum.CANCELED.name()),
                instituteIds);
        processPlans(activeUserPlans);
    }

    private void processPlans(List<UserPlan> activeUserPlans) {
        if (CollectionUtils.isEmpty(activeUserPlans)) {
            log.info("No ACTIVE UserPlans to process");
            return;
        }

        log.info("Found {} ACTIVE UserPlans to process", activeUserPlans.size());

        // Group by source (USER vs SUB_ORG)
        Map<String, List<UserPlan>> userPlansBySource = activeUserPlans.stream()
                .collect(Collectors.groupingBy(
                        up -> StringUtils.hasText(up.getSource()) ? up.getSource() : UserPlanSourceEnum.USER.name()));

        // Process USER source UserPlans
        List<UserPlan> userSourcePlans = userPlansBySource.getOrDefault(UserPlanSourceEnum.USER.name(), List.of());
        if (!CollectionUtils.isEmpty(userSourcePlans)) {
            log.info("Processing {} USER source UserPlans", userSourcePlans.size());
            processUserSourcePlans(userSourcePlans);
        }

        // Process SUB_ORG source UserPlans
        List<UserPlan> subOrgSourcePlans = userPlansBySource.getOrDefault(UserPlanSourceEnum.SUB_ORG.name(), List.of());
        if (!CollectionUtils.isEmpty(subOrgSourcePlans)) {
            log.info("Processing {} SUB_ORG source UserPlans", subOrgSourcePlans.size());
            processSubOrgSourcePlans(subOrgSourcePlans);
        }
    }

    /**
     * Processes USER source UserPlans (individual users).
     */
    private void processUserSourcePlans(List<UserPlan> userPlans) {
        for (UserPlan userPlan : userPlans) {
            try {
                processUserPlan(userPlan);
            } catch (Exception e) {
                log.error("Failed to process USER source UserPlan: {}", userPlan.getId(), e);
            }
        }
    }

    /**
     * Processes SUB_ORG source UserPlans.
     */
    private void processSubOrgSourcePlans(List<UserPlan> userPlans) {
        for (UserPlan userPlan : userPlans) {
            try {
                processUserPlan(userPlan);
            } catch (Exception e) {
                log.error("Failed to process SUB_ORG source UserPlan: {}", userPlan.getId(), e);
            }
        }
    }

    /**
     * Processes a single UserPlan.
     * Finds all ACTIVE mappings for this UserPlan and processes them.
     * UserPlan status is only changed after complete processing.
     * Processing is based on UserPlan.startDate and UserPlan.endDate (not mapping
     * dates).
     */
    private void processUserPlan(UserPlan userPlan) {
        log.info("Processing UserPlan: {} (source: {})", userPlan.getId(), userPlan.getSource());

        // Skip UserPlans without endDate (they need to be initialized first)
        if (userPlan.getEndDate() == null) {
            log.warn("UserPlan {} has no endDate set. Initializing from mappings if available.", userPlan.getId());
            initializeUserPlanDatesFromMappings(userPlan);

            // If still no endDate after initialization, skip
            if (userPlan.getEndDate() == null) {
                log.warn("UserPlan {} still has no endDate after initialization, skipping", userPlan.getId());
                return;
            }
        }

        // Find all ACTIVE mappings for this UserPlan
        List<StudentSessionInstituteGroupMapping> activeMappings = mappingRepository
                .findByUserPlanIdAndStatus(userPlan.getId(), UserPlanStatusEnum.ACTIVE.name());

        if (CollectionUtils.isEmpty(activeMappings)) {
            log.warn("No ACTIVE mappings found for UserPlan: {}, skipping", userPlan.getId());
            return;
        }

        log.info("Found {} ACTIVE mappings for UserPlan: {} (endDate: {})",
                activeMappings.size(), userPlan.getId(), userPlan.getEndDate());

        // Determine if this is SUB_ORG or USER based on UserPlan.source
        boolean isSubOrg = UserPlanSourceEnum.SUB_ORG.name().equals(userPlan.getSource())
                && StringUtils.hasText(userPlan.getSubOrgId());

        // Get representative user for context
        UserDTO representativeUser = getRepresentativeUser(userPlan, activeMappings, isSubOrg);
        if (representativeUser == null) {
            log.warn("Could not get representative user for UserPlan: {}, skipping", userPlan.getId());
            return;
        }

        // Build policy map for all mappings (ONE TIME for the entire UserPlan)
        Map<String, EnrollmentPolicySettingsDTO> policiesByPackageSessionId = new java.util.HashMap<>();
        for (StudentSessionInstituteGroupMapping mapping : activeMappings) {
            if (mapping.getPackageSession() != null && mapping.getPackageSession().getId() != null) {
                String policyJson = mapping.getPackageSession().getEnrollmentPolicySettings();
                if (policyJson != null && !policyJson.isBlank()) {
                    try {
                        EnrollmentPolicySettingsDTO policy = parsePolicy(policyJson, mapping.getId());
                        if (policy != null) {
                            policiesByPackageSessionId.put(mapping.getPackageSession().getId(), policy);
                        }
                    } catch (Exception e) {
                        log.debug("Failed to parse policy for mapping: {}", mapping.getId(), e);
                    }
                }
            }
        }
        
        if (policiesByPackageSessionId.isEmpty()) {
            log.warn("No valid policies found for UserPlan: {}, skipping", userPlan.getId());
            return;
        }

        // Create ONE context for the entire UserPlan (not per-mapping)
        EnrolmentContext context = EnrolmentContext.builder()
                .userPlan(userPlan)
                .mappings(activeMappings) // All ACTIVE mappings for this UserPlan
                .policiesByPackageSessionId(policiesByPackageSessionId)
                .user(representativeUser)
                .build();

        // Process ONCE per UserPlan (not per mapping)
        processorFactory.getProcessor(context)
                .ifPresent(processor -> {
                    try {
                        processor.process(context);
                        log.info("Successfully processed UserPlan: {}", userPlan.getId());
                    } catch (Exception e) {
                        log.error("Failed to process UserPlan: {}", userPlan.getId(), e);
                    }
                });

        // Note: UserPlan status changes (to EXPIRED) are handled by processors
    }

    /**
     * Gets the representative user for context based on UserPlan source.
     * For USER: returns the individual user
     * For SUB_ORG: returns ROOT_ADMIN
     */
    private UserDTO getRepresentativeUser(UserPlan userPlan, List<StudentSessionInstituteGroupMapping> mappings,
            boolean isSubOrg) {
        try {
            List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(List.of(userPlan.getUserId()));
            if (CollectionUtils.isEmpty(users)) {
                log.warn("User not found for UserPlan: {}", userPlan.getId());
                return null;
            }
            return users.get(0);
        } catch (Exception e) {
            log.error("Failed to fetch user for UserPlan: {}", userPlan.getId(), e);
            return null;
        }
    }

    /**
     * Initializes UserPlan dates from mappings if UserPlan dates are not set.
     * This is for backward compatibility with existing UserPlans.
     */
    private void initializeUserPlanDatesFromMappings(UserPlan userPlan) {
        List<StudentSessionInstituteGroupMapping> mappings = mappingRepository
                .findByUserPlanIdAndStatus(userPlan.getId(), LearnerSessionStatusEnum.ACTIVE.name());

        if (CollectionUtils.isEmpty(mappings)) {
            return;
        }

        // Use the earliest enrolledDate as startDate
        Date earliestEnrolledDate = mappings.stream()
                .map(StudentSessionInstituteGroupMapping::getEnrolledDate)
                .filter(java.util.Objects::nonNull)
                .min(Date::compareTo)
                .orElse(null);

        // Use the latest expiryDate as endDate
        Date latestExpiryDate = mappings.stream()
                .map(StudentSessionInstituteGroupMapping::getExpiryDate)
                .filter(java.util.Objects::nonNull)
                .max(Date::compareTo)
                .orElse(null);

        if (earliestEnrolledDate != null && userPlan.getStartDate() == null) {
            userPlan.setStartDate(earliestEnrolledDate);
            log.debug("Initialized UserPlan {} startDate from mappings: {}", userPlan.getId(), earliestEnrolledDate);
        }

        if (latestExpiryDate != null && userPlan.getEndDate() == null) {
            userPlan.setEndDate(latestExpiryDate);
            log.debug("Initialized UserPlan {} endDate from mappings: {}", userPlan.getId(), latestExpiryDate);
        }

        // Save if dates were initialized
        if (earliestEnrolledDate != null || latestExpiryDate != null) {
            userPlanRepository.save(userPlan);
            log.info("Initialized UserPlan {} dates from mappings", userPlan.getId());
        }
    }

    private EnrollmentPolicySettingsDTO parsePolicy(String json, String mappingId) {
        try {
            return objectMapper.readValue(json, EnrollmentPolicySettingsDTO.class);
        } catch (Exception e) {
            log.error("Failed to parse enrollment policy JSON for mapping {}: {}", mappingId, e.getMessage());
            return null;
        }
    }
}
