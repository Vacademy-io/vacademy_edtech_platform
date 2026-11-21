package vacademy.io.admin_core_service.features.migration.service;

import vacademy.io.admin_core_service.features.commerce.common.CommerceLegacyGuard;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.common.entity.CustomFieldValues;
import vacademy.io.admin_core_service.features.common.entity.CustomFields;
import vacademy.io.admin_core_service.features.common.entity.InstituteCustomField;
import vacademy.io.admin_core_service.features.common.enums.StatusEnum;
import vacademy.io.admin_core_service.features.common.repository.CustomFieldRepository;
import vacademy.io.admin_core_service.features.common.repository.CustomFieldValuesRepository;
import vacademy.io.admin_core_service.features.common.repository.InstituteCustomFieldRepository;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.repository.EnrollInviteRepository;
import vacademy.io.admin_core_service.features.institute.entity.InstitutePaymentGatewayMapping;
import vacademy.io.admin_core_service.features.institute.repository.InstitutePaymentGatewayMappingRepository;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute_learner.entity.Student;
import vacademy.io.admin_core_service.features.institute_learner.entity.StudentSessionInstituteGroupMapping;
import vacademy.io.admin_core_service.features.institute_learner.repository.InstituteStudentRepository;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.migration.dto.v2.*;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserInstitutePaymentGatewayMapping;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.UserInstitutePaymentGatewayMappingRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.UserPlanRepository;
import vacademy.io.admin_core_service.features.tag_management.entity.Tag;
import vacademy.io.admin_core_service.features.tag_management.entity.UserTag;
import vacademy.io.admin_core_service.features.tag_management.enums.TagStatus;
import vacademy.io.admin_core_service.features.tag_management.repository.TagRepository;
import vacademy.io.admin_core_service.features.tag_management.repository.UserTagRepository;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.common.institute.entity.session.PackageSession;

import java.time.LocalDateTime;
import java.util.*;

/**
 * Service for V2 Migration APIs
 * 
 * Handles:
 * - Bulk user import with idempotency
 * - Bulk enrollment import with practice membership support
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class MigrationV2Service {

    private final AuthService authService;
    private final InstituteStudentRepository studentRepository;
    private final InstituteRepository instituteRepository;
    private final PackageSessionRepository packageSessionRepository;
    private final EnrollInviteRepository enrollInviteRepository;
    private final UserPlanRepository userPlanRepository;
    private final StudentSessionInstituteGroupMappingRepository ssigmRepository;
    private final PaymentLogRepository paymentLogRepository;
    private final CustomFieldRepository customFieldRepository;
    private final CustomFieldValuesRepository customFieldValuesRepository;
    private final InstituteCustomFieldRepository instituteCustomFieldRepository;
    private final UserInstitutePaymentGatewayMappingRepository userGatewayMappingRepository;
    private final InstitutePaymentGatewayMappingRepository instituteGatewayMappingRepository;
    private final TagRepository tagRepository;
    private final UserTagRepository userTagRepository;
    private final CommerceLegacyGuard commerceLegacyGuard;

    // ========================================
    // API 1: Import Users
    // ========================================

    public BulkUserImportResponseDTO importUsers(String instituteId,
            BulkUserImportRequestDTO request, CustomUserDetails currentUser) {

        if (request == null || request.getUsers() == null || request.getUsers().isEmpty()) {
            return BulkUserImportResponseDTO.empty(request != null && request.isDryRun(), null);
        }

        List<UserImportResultDTO> results = new ArrayList<>();
        int successCount = 0;
        int failureCount = 0;
        int skippedCount = 0;

        for (int i = 0; i < request.getUsers().size(); i++) {
            UserImportItemDTO item = request.getUsers().get(i);

            try {
                UserImportResultDTO result = processUserImport(i, item, instituteId, request);
                results.add(result);

                switch (result.getStatus()) {
                    case SUCCESS, VALIDATED -> successCount++;
                    case SKIPPED -> skippedCount++;
                    case FAILED -> failureCount++;
                }
            } catch (Exception e) {
                log.error("Failed to process user at index {}: {}", i, e.getMessage(), e);
                results.add(UserImportResultDTO.failed(i, item.getEmail(), e.getMessage()));
                failureCount++;
            }
        }

        return BulkUserImportResponseDTO.builder()
                .totalRequested(request.getUsers().size())
                .successCount(successCount)
                .failureCount(failureCount)
                .skippedCount(skippedCount)
                .dryRun(request.isDryRun())
                .results(results)
                .build();
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public UserImportResultDTO processUserImport(int index, UserImportItemDTO item,
            String instituteId, BulkUserImportRequestDTO request) {

        // Validation
        if (!StringUtils.hasText(item.getEmail())) {
            return UserImportResultDTO.failed(index, null, "Email is required");
        }

        // Dry run - just validate
        if (request.isDryRun()) {
            return validateUserImportItem(index, item, instituteId, request);
        }

        // Check if user already exists (by checking student record)
        Optional<Student> existingStudentOpt = studentRepository
                .findTopStudentByEmailAndInstituteIdOrderByMappingCreatedAtDesc(
                        item.getEmail(), instituteId);
        boolean isNewUser = existingStudentOpt.isEmpty();

        // Skip existing if flag is set
        if (!isNewUser && request.shouldSkipExisting()) {
            Student existingStudent = existingStudentOpt.get();
            return UserImportResultDTO.skipped(index, item.getEmail(),
                    existingStudent.getUserId(), "User already exists");
        }

        // Create or update user
        UserDTO user = createOrUpdateUser(item, instituteId);

        // Create or update student
        Student student = createOrUpdateStudent(user.getId(), item);
        boolean isNewStudent = existingStudentOpt.isEmpty();

        // Save custom fields
        int customFieldsSaved = saveCustomFields(user.getId(), item.getCustomFields(),
                request.getDefaultCustomFieldMapping(), instituteId);

        // Store external ID as custom field if provided
        if (StringUtils.hasText(item.getExternalId())) {
            saveExternalIdAsCustomField(user.getId(), item.getExternalId(),
                    item.getExternalSource(), instituteId);
        }

        // Assign tags if provided
        int tagsAssigned = saveTags(user.getId(), item.getTags(), instituteId, null);

        // Link payment gateway if provided
        boolean gatewayLinked = false;
        if (item.getPaymentGateway() != null && StringUtils.hasText(item.getPaymentGateway().getCustomerId())) {
            gatewayLinked = linkPaymentGateway(user.getId(), item.getPaymentGateway(), instituteId);
        }

        return UserImportResultDTO.success(index, item.getEmail(), user.getId(),
                student.getId(), isNewUser, isNewStudent, customFieldsSaved,
                tagsAssigned, gatewayLinked, item.getExternalId());
    }

    private UserImportResultDTO validateUserImportItem(int index, UserImportItemDTO item,
            String instituteId, BulkUserImportRequestDTO request) {

        // Validate custom fields exist
        if (item.getCustomFields() != null) {
            for (CustomFieldImportDTO cf : item.getCustomFields()) {
                String fieldId = resolveCustomFieldId(cf, request.getDefaultCustomFieldMapping(), instituteId);
                if (fieldId == null) {
                    return UserImportResultDTO.failed(index, item.getEmail(),
                            "Custom field not found: " + cf.getEffectiveFieldIdentifier());
                }
            }
        }

        // Validate payment gateway mapping exists
        if (item.getPaymentGateway() != null &&
                StringUtils.hasText(item.getPaymentGateway().getInstitutePaymentGatewayMappingId())) {
            Optional<InstitutePaymentGatewayMapping> mapping = instituteGatewayMappingRepository
                    .findById(item.getPaymentGateway().getInstitutePaymentGatewayMappingId());
            if (mapping.isEmpty()) {
                return UserImportResultDTO.failed(index, item.getEmail(),
                        "Payment gateway mapping not found: " +
                                item.getPaymentGateway().getInstitutePaymentGatewayMappingId());
            }
        }

        // Validate tags exist (unless auto_create is enabled)
        if (item.getTags() != null) {
            for (TagImportDTO tagImport : item.getTags()) {
                if (!tagImport.shouldAutoCreate()) {
                    String tagId = resolveTagId(tagImport, instituteId, null);
                    if (tagId == null) {
                        return UserImportResultDTO.failed(index, item.getEmail(),
                                "Tag not found: " + tagImport.getEffectiveIdentifier());
                    }
                }
            }
        }

        return UserImportResultDTO.validated(index, item.getEmail(), item.getExternalId());
    }

    private UserDTO createOrUpdateUser(UserImportItemDTO item, String instituteId) {
        UserDTO userDTO = new UserDTO();
        userDTO.setEmail(item.getEmail());
        userDTO.setFullName(item.getEffectiveFullName());
        userDTO.setUsername(item.getEffectiveUsername());
        userDTO.setMobileNumber(item.getPhone());
        userDTO.setPassword(item.getPassword() != null ? item.getPassword() : generateRandomPassword());
        userDTO.setRoles(item.getEffectiveRoles());
        // Set address fields so they are saved in the users table
        userDTO.setAddressLine(item.getAddressLine());
        userDTO.setCity(item.getCity());
        userDTO.setPinCode(item.getPinCode());

        return authService.createUserFromAuthService(userDTO, instituteId, false);
    }

    private Student createOrUpdateStudent(String userId, UserImportItemDTO item) {
        Optional<Student> existingStudent = studentRepository.findTopByUserId(userId);

        Student student = existingStudent.orElseGet(Student::new);
        student.setUserId(userId);
        student.setEmail(item.getEmail());
        student.setFullName(item.getEffectiveFullName());
        student.setMobileNumber(item.getPhone());
        student.setAddressLine(item.getAddressLine());
        student.setCity(item.getCity());
        student.setRegion(item.getRegion());
        student.setPinCode(item.getPinCode());

        return studentRepository.save(student);
    }

    private int saveCustomFields(String userId, List<CustomFieldImportDTO> customFields,
            Map<String, String> mapping, String instituteId) {

        if (customFields == null || customFields.isEmpty()) {
            return 0;
        }

        int saved = 0;
        for (CustomFieldImportDTO cf : customFields) {
            String fieldId = resolveCustomFieldId(cf, mapping, instituteId);
            if (fieldId != null && StringUtils.hasText(cf.getValue())) {
                saveOrUpdateCustomFieldValue(fieldId, "USER", userId, cf.getValue());
                saved++;
            }
        }
        return saved;
    }

    private String resolveCustomFieldId(CustomFieldImportDTO cf, Map<String, String> mapping, String instituteId) {
        // Priority 1: Direct ID
        if (cf.hasDirectId()) {
            Optional<CustomFields> field = customFieldRepository.findById(cf.getCustomFieldId());
            return field.isPresent() ? cf.getCustomFieldId() : null;
        }

        // Priority 2: Field key - search within institute's custom fields
        if (StringUtils.hasText(cf.getFieldKey())) {
            // Find custom field by field_key that is linked to this institute
            List<Object[]> results = instituteCustomFieldRepository.findAllActiveCustomFieldsWithDetailsByInstituteId(instituteId);
            for (Object[] row : results) {
                InstituteCustomField icf = (InstituteCustomField) row[0];
                CustomFields customField = (CustomFields) row[1];
                if (cf.getFieldKey().equals(customField.getFieldKey()) && 
                    StatusEnum.ACTIVE.name().equals(icf.getStatus())) {
                    return customField.getId();
                }
            }
            // Fallback: try global search if not found in institute
            Optional<CustomFields> field = customFieldRepository.findByFieldKey(cf.getFieldKey());
            return field.map(CustomFields::getId).orElse(null);
        }

        // Priority 3: Field name from mapping
        if (StringUtils.hasText(cf.getFieldKeyOrName()) && mapping != null) {
            String fieldId = mapping.get(cf.getFieldKeyOrName());
            if (fieldId != null) {
                return fieldId;
            }
        }

        return null;
    }

    private void saveOrUpdateCustomFieldValue(String customFieldId, String sourceType,
            String sourceId, String value) {

        Optional<CustomFieldValues> existing = customFieldValuesRepository
                .findTopByCustomFieldIdAndSourceTypeAndSourceIdOrderByCreatedAtDesc(
                        customFieldId, sourceType, sourceId);

        CustomFieldValues cfv = existing.orElseGet(() -> {
            CustomFieldValues newCfv = new CustomFieldValues();
            newCfv.setCustomFieldId(customFieldId);
            newCfv.setSourceType(sourceType);
            newCfv.setSourceId(sourceId);
            return newCfv;
        });

        cfv.setValue(value);
        customFieldValuesRepository.save(cfv);
    }

    private void saveExternalIdAsCustomField(String userId, String externalId,
            String externalSource, String instituteId) {

        // Look for a custom field named "External ID" or "Keap Contact ID"
        String fieldName = externalSource != null ? externalSource + " ID" : "External ID";
        Optional<CustomFields> field = customFieldRepository
                .findTopByFieldKeyAndStatusOrderByCreatedAtDesc(
                        fieldName.toLowerCase().replace(" ", "_"), StatusEnum.ACTIVE.name());

        if (field.isPresent()) {
            saveOrUpdateCustomFieldValue(field.get().getId(), "USER", userId, externalId);
        }
    }

    private boolean linkPaymentGateway(String userId, PaymentGatewayImportDTO gateway, String instituteId) {
        if (gateway == null || !StringUtils.hasText(gateway.getCustomerId())) {
            return false;
        }

        // Find institute payment gateway mapping
        InstitutePaymentGatewayMapping instituteMapping = null;

        if (StringUtils.hasText(gateway.getInstitutePaymentGatewayMappingId())) {
            instituteMapping = instituteGatewayMappingRepository
                    .findById(gateway.getInstitutePaymentGatewayMappingId()).orElse(null);
        }

        if (instituteMapping == null) {
            log.warn("Institute payment gateway mapping not found for user: {}", userId);
            return false;
        }

        // Check if mapping already exists
        Optional<UserInstitutePaymentGatewayMapping> existing = userGatewayMappingRepository
                .findByUserIdAndInstitutePaymentGatewayMappingId(userId, instituteMapping.getId());

        if (existing.isPresent()) {
            return true; // Already linked
        }

        // Create new mapping
        UserInstitutePaymentGatewayMapping mapping = new UserInstitutePaymentGatewayMapping();
        mapping.setUserId(userId);
        mapping.setInstitutePaymentGatewayMapping(instituteMapping);
        mapping.setPaymentGatewayCustomerId(gateway.getCustomerId());
        mapping.setStatus("ACTIVE");
        mapping.setCreatedAt(LocalDateTime.now());
        mapping.setUpdatedAt(LocalDateTime.now());

        userGatewayMappingRepository.save(mapping);
        return true;
    }

    private String generateRandomPassword() {
        String chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        Random random = new Random();
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 10; i++) {
            sb.append(chars.charAt(random.nextInt(chars.length())));
        }
        return sb.toString();
    }

    /**
     * Saves tags for a user.
     * Tags can be specified by ID or name.
     * If tag doesn't exist and auto_create is true, creates the tag.
     * 
     * @param userId          User ID to assign tags to
     * @param tags            List of tags to assign
     * @param instituteId     Institute context
     * @param createdByUserId User creating the tags (for audit)
     * @return Number of tags assigned
     */
    private int saveTags(String userId, List<TagImportDTO> tags, String instituteId, String createdByUserId) {
        if (tags == null || tags.isEmpty()) {
            return 0;
        }

        int count = 0;
        for (TagImportDTO tagImport : tags) {
            String tagId = resolveTagId(tagImport, instituteId, createdByUserId);
            if (tagId == null) {
                log.warn("Tag not found and auto-create disabled for: {}", tagImport.getEffectiveIdentifier());
                continue;
            }

            // Check if user already has this tag
            Optional<UserTag> existingUserTag = userTagRepository
                    .findUserTagByUserIdAndTagIdAndInstituteId(userId, tagId, instituteId);

            if (existingUserTag.isPresent()) {
                // Reactivate if inactive
                UserTag userTag = existingUserTag.get();
                if (userTag.getStatus() != TagStatus.ACTIVE) {
                    userTag.setStatus(TagStatus.ACTIVE);
                    userTagRepository.save(userTag);
                    count++;
                }
                // Already active, skip
            } else {
                // Create new UserTag
                UserTag userTag = new UserTag(userId, tagId, instituteId, createdByUserId);
                userTagRepository.save(userTag);
                count++;
            }
        }
        return count;
    }

    /**
     * Resolves tag ID from TagImportDTO.
     * First checks by ID, then by name.
     * If not found and auto_create is true, creates the tag.
     */
    private String resolveTagId(TagImportDTO tagImport, String instituteId, String createdByUserId) {
        // Priority 1: Direct Tag ID
        if (tagImport.hasDirectId()) {
            Optional<Tag> tag = tagRepository.findActiveTagByIdAndInstituteId(tagImport.getTagId(), instituteId);
            if (tag.isPresent()) {
                return tag.get().getId();
            }
            // Fall through to try by name if ID not found
        }

        // Priority 2: Tag Name lookup
        if (tagImport.hasTagName()) {
            List<Tag> tags = tagRepository.findByTagNameAndInstituteId(
                    tagImport.getTagName(), instituteId, TagStatus.ACTIVE);
            if (!tags.isEmpty()) {
                return tags.get(0).getId();
            }

            // Not found - auto-create if enabled
            if (tagImport.shouldAutoCreate()) {
                Tag newTag = new Tag(tagImport.getTagName(), instituteId, null, createdByUserId);
                tagRepository.save(newTag);
                log.info("Auto-created tag '{}' for institute {}", tagImport.getTagName(), instituteId);
                return newTag.getId();
            }
        }

        return null;
    }

    // ========================================
    // API 2: Import Enrollments
    // ========================================

    public BulkEnrollmentImportResponseDTO importEnrollments(String instituteId,
            BulkEnrollmentImportRequestDTO request, CustomUserDetails currentUser) {

        if (request == null || request.getEnrollments() == null || request.getEnrollments().isEmpty()) {
            return BulkEnrollmentImportResponseDTO.empty(request != null && request.isDryRun());
        }

        List<EnrollmentImportResultDTO> results = new ArrayList<>();
        int successCount = 0;
        int failureCount = 0;
        int skippedCount = 0;

        // Cache for practice lookups (owner email -> SubOrg, UserPlan)
        Map<String, PracticeCacheEntry> practiceCache = new HashMap<>();

        for (int i = 0; i < request.getEnrollments().size(); i++) {
            EnrollmentImportItemDTO item = request.getEnrollments().get(i);

            try {
                EnrollmentImportResultDTO result = processEnrollmentImport(
                        i, item, instituteId, request, practiceCache);
                results.add(result);

                switch (result.getStatus()) {
                    case SUCCESS, VALIDATED -> successCount++;
                    case SKIPPED -> skippedCount++;
                    case FAILED -> failureCount++;
                }
            } catch (Exception e) {
                log.error("Failed to process enrollment at index {}: {}", i, e.getMessage(), e);
                results.add(EnrollmentImportResultDTO.failed(i, item.getEmail(), e.getMessage()));
                failureCount++;
            }
        }

        return BulkEnrollmentImportResponseDTO.builder()
                .totalRequested(request.getEnrollments().size())
                .successCount(successCount)
                .failureCount(failureCount)
                .skippedCount(skippedCount)
                .dryRun(request.isDryRun())
                .results(results)
                .build();
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public EnrollmentImportResultDTO processEnrollmentImport(int index, EnrollmentImportItemDTO item,
            String instituteId, BulkEnrollmentImportRequestDTO request,
            Map<String, PracticeCacheEntry> practiceCache) {

        // Validation
        if (!StringUtils.hasText(item.getEmail())) {
            return EnrollmentImportResultDTO.failed(index, null, "Email is required");
        }

        // Find user by email - try multiple approaches
        String userId = null;
        UserDTO user = null;
        
        // Approach 1: Try to find student with SSIGM (for users already enrolled in this institute)
        Optional<Student> studentOpt = studentRepository.findTopStudentByEmailAndInstituteIdOrderByMappingCreatedAtDesc(
                item.getEmail(), instituteId);
        if (studentOpt.isPresent()) {
            userId = studentOpt.get().getUserId();
            user = new UserDTO();
            user.setId(userId);
            user.setEmail(item.getEmail());
        } else {
            // Approach 2: Find student directly by email (for users created via bulk import but not yet enrolled)
            // Convert Iterable to List and find by email
            List<Student> allStudents = new ArrayList<>();
            studentRepository.findAll().forEach(allStudents::add);
            
            Optional<Student> studentByEmailOpt = allStudents.stream()
                    .filter(s -> s.getEmail() != null && s.getEmail().equalsIgnoreCase(item.getEmail()))
                    .max((s1, s2) -> {
                        if (s1.getCreatedAt() != null && s2.getCreatedAt() != null) {
                            return s1.getCreatedAt().compareTo(s2.getCreatedAt());
                        }
                        return 0;
                    });
            
            if (studentByEmailOpt.isPresent()) {
                Student student = studentByEmailOpt.get();
                userId = student.getUserId();
                if (userId != null) {
                    user = new UserDTO();
                    user.setId(userId);
                    user.setEmail(item.getEmail());
                }
            }
        }
        
        if (userId == null || user == null) {
            return EnrollmentImportResultDTO.failed(index, item.getEmail(),
                    "User not found with email: " + item.getEmail() + ". Please ensure the user was created via bulk user import API first.");
        }

        // Resolve package session
        String packageSessionId = resolvePackageSessionId(item, request.getEffectiveDefaults());
        if (!StringUtils.hasText(packageSessionId)) {
            return EnrollmentImportResultDTO.failed(index, item.getEmail(),
                    "Package session ID is required");
        }

        Optional<PackageSession> psOpt = packageSessionRepository.findById(packageSessionId);
        if (psOpt.isEmpty()) {
            return EnrollmentImportResultDTO.failed(index, item.getEmail(),
                    "Package session not found: " + packageSessionId);
        }
        PackageSession packageSession = psOpt.get();

        // Dry run - validate only
        if (request.isDryRun()) {
            return validateEnrollmentItem(index, item, user, packageSession, instituteId,
                    request, practiceCache);
        }

        // Process based on enrollment type
        if (packageSession.getIsOrgAssociated() != null && packageSession.getIsOrgAssociated()) {
            // Practice enrollment
            return processPracticeEnrollment(index, item, user, packageSession,
                    instituteId, request, practiceCache);
        } else {
            // Individual enrollment
            return processIndividualEnrollment(index, item, user, packageSession,
                    instituteId, request);
        }
    }

    private EnrollmentImportResultDTO validateEnrollmentItem(int index, EnrollmentImportItemDTO item,
            UserDTO user, PackageSession packageSession, String instituteId,
            BulkEnrollmentImportRequestDTO request, Map<String, PracticeCacheEntry> practiceCache) {

        String enrollmentType = "INDIVIDUAL";
        if (packageSession.getIsOrgAssociated() != null && packageSession.getIsOrgAssociated()) {
            if (item.isPracticeRootAdmin()) {
                enrollmentType = "PRACTICE_ROOT_ADMIN";
            } else {
                enrollmentType = "PRACTICE_MEMBER";
                // Validate practice link exists
                if (item.hasPractice() && item.getPractice().hasLinkToOwner()) {
                    // Check if owner exists
                    if (StringUtils.hasText(item.getPractice().getLinkToOwnerEmail())) {
                        Optional<Student> ownerStudentOpt = studentRepository
                                .findTopStudentByEmailAndInstituteIdOrderByMappingCreatedAtDesc(
                                        item.getPractice().getLinkToOwnerEmail(), instituteId);
                        if (ownerStudentOpt.isEmpty()) {
                            return EnrollmentImportResultDTO.failed(index, item.getEmail(),
                                    "Practice owner not found: " + item.getPractice().getLinkToOwnerEmail());
                        }
                    }
                }
            }
        }

        return EnrollmentImportResultDTO.validated(index, item.getEmail(),
                enrollmentType, item.getExternalSubscriptionId());
    }

    private EnrollmentImportResultDTO processIndividualEnrollment(int index, EnrollmentImportItemDTO item,
            UserDTO user, PackageSession packageSession, String instituteId,
            BulkEnrollmentImportRequestDTO request) {

        // Find institute
        Institute institute = instituteRepository.findById(instituteId)
                .orElseThrow(() -> new RuntimeException("Institute not found: " + instituteId));

        // Find enroll invite
        EnrollInvite enrollInvite = findEnrollInvite(item, packageSession, request.getEffectiveDefaults());

        // Create UserPlan
        UserPlan userPlan = createUserPlan(user.getId(), item, enrollInvite, null,
                instituteId, request.getEffectiveDefaults());

        // Create SSIGM
        StudentSessionInstituteGroupMapping ssigm = createSSIGM(user.getId(), userPlan,
                packageSession, institute, null, null, item.getEffectiveLearnerStatus());

        // Update inventory (decrement available slots)
        updateInventoryOnEnrollment(packageSession);

        // Create payment logs
        int paymentLogsCreated = createPaymentLogs(item.getPaymentHistory(), userPlan, user.getId());

        return EnrollmentImportResultDTO.successIndividual(index, item.getEmail(), user.getId(),
                userPlan.getId(), ssigm.getId(), paymentLogsCreated, item.getExternalSubscriptionId());
    }

    private EnrollmentImportResultDTO processPracticeEnrollment(int index, EnrollmentImportItemDTO item,
            UserDTO user, PackageSession packageSession, String instituteId,
            BulkEnrollmentImportRequestDTO request, Map<String, PracticeCacheEntry> practiceCache) {

        if (!item.hasPractice()) {
            return EnrollmentImportResultDTO.failed(index, item.getEmail(),
                    "Practice configuration required for org-associated package session");
        }

        Institute institute = instituteRepository.findById(instituteId)
                .orElseThrow(() -> new RuntimeException("Institute not found: " + instituteId));

        if (item.isPracticeRootAdmin()) {
            return processPracticeRootAdminEnrollment(index, item, user, packageSession,
                    institute, request, practiceCache);
        } else {
            return processPracticeMemberEnrollment(index, item, user, packageSession,
                    institute, request, practiceCache);
        }
    }

    private EnrollmentImportResultDTO processPracticeRootAdminEnrollment(int index,
            EnrollmentImportItemDTO item, UserDTO user, PackageSession packageSession,
            Institute parentInstitute, BulkEnrollmentImportRequestDTO request,
            Map<String, PracticeCacheEntry> practiceCache) {

        // Validate practice name
        if (!StringUtils.hasText(item.getPractice().getPracticeName())) {
            return EnrollmentImportResultDTO.failed(index, item.getEmail(),
                    "Practice name is required for ROOT_ADMIN");
        }

        // Create SubOrg (Institute)
        Institute subOrg = new Institute();
        subOrg.setInstituteName(item.getPractice().getPracticeName());
        subOrg = instituteRepository.save(subOrg);

        // Find enroll invite
        EnrollInvite enrollInvite = findEnrollInvite(item, packageSession, request.getEffectiveDefaults());

        // Create UserPlan for root admin (source = SUB_ORG)
        UserPlan userPlan = createUserPlanForPractice(user.getId(), item, enrollInvite, subOrg,
                parentInstitute.getId(), request.getEffectiveDefaults());

        // Create SSIGM
        String roles = item.getPractice().getCommaSeparatedRoles();
        StudentSessionInstituteGroupMapping ssigm = createSSIGM(user.getId(), userPlan,
                packageSession, parentInstitute, subOrg, roles, item.getEffectiveLearnerStatus());

        // Update inventory (decrement available slots)
        updateInventoryOnEnrollment(packageSession);

        // Create payment logs
        int paymentLogsCreated = createPaymentLogs(item.getPaymentHistory(), userPlan, user.getId());

        // Cache for members
        practiceCache.put(item.getEmail(), new PracticeCacheEntry(subOrg, userPlan));

        return EnrollmentImportResultDTO.successPracticeRootAdmin(index, item.getEmail(), user.getId(),
                userPlan.getId(), ssigm.getId(), subOrg.getId(), subOrg.getInstituteName(),
                paymentLogsCreated, item.getExternalSubscriptionId());
    }

    private EnrollmentImportResultDTO processPracticeMemberEnrollment(int index,
            EnrollmentImportItemDTO item, UserDTO user, PackageSession packageSession,
            Institute parentInstitute, BulkEnrollmentImportRequestDTO request,
            Map<String, PracticeCacheEntry> practiceCache) {

        // Find SubOrg and root admin's UserPlan
        PracticeCacheEntry cacheEntry = findPractice(item.getPractice(), packageSession, practiceCache);
        if (cacheEntry == null) {
            return EnrollmentImportResultDTO.failed(index, item.getEmail(),
                    "Practice not found. Ensure root admin is enrolled first.");
        }

        // Create SSIGM linking to root admin's plan
        String roles = item.getPractice().getCommaSeparatedRoles();
        StudentSessionInstituteGroupMapping ssigm = createSSIGM(user.getId(), cacheEntry.userPlan,
                packageSession, parentInstitute, cacheEntry.subOrg, roles, item.getEffectiveLearnerStatus());

        // Update inventory (decrement available slots)
        updateInventoryOnEnrollment(packageSession);

        // Members don't have payment logs

        return EnrollmentImportResultDTO.successPracticeMember(index, item.getEmail(), user.getId(),
                cacheEntry.userPlan.getId(), ssigm.getId(), cacheEntry.subOrg.getId(), roles);
    }

    private PracticeCacheEntry findPractice(PracticeEnrollmentDTO practice, PackageSession packageSession,
            Map<String, PracticeCacheEntry> cache) {

        // Check cache first (by owner email)
        if (StringUtils.hasText(practice.getLinkToOwnerEmail())) {
            PracticeCacheEntry cached = cache.get(practice.getLinkToOwnerEmail());
            if (cached != null) {
                return cached;
            }

            // Find from database - lookup owner by email via student
            Optional<Student> ownerStudentOpt = studentRepository
                    .findTopStudentByEmailAndInstituteIdOrderByMappingCreatedAtDesc(
                            practice.getLinkToOwnerEmail(), findInstituteIdFromPackageSession(packageSession));
            if (ownerStudentOpt.isPresent()) {
                String ownerId = ownerStudentOpt.get().getUserId();
                // Find SSIGM with ROOT_ADMIN role
                Optional<StudentSessionInstituteGroupMapping> ownerMappingOpt = ssigmRepository
                        .findByUserIdAndStatusInAndPackageSessionId(
                                ownerId, List.of("ACTIVE"), packageSession.getId());

                if (ownerMappingOpt.isPresent()) {
                    StudentSessionInstituteGroupMapping mapping = ownerMappingOpt.get();
                    if (mapping.getCommaSeparatedOrgRoles() != null &&
                            mapping.getCommaSeparatedOrgRoles().contains("ROOT_ADMIN")) {
                        Institute subOrg = mapping.getSubOrg();
                        UserPlan userPlan = userPlanRepository.findById(mapping.getUserPlanId()).orElse(null);
                        if (subOrg != null && userPlan != null) {
                            PracticeCacheEntry entry = new PracticeCacheEntry(subOrg, userPlan);
                            cache.put(practice.getLinkToOwnerEmail(), entry);
                            return entry;
                        }
                    }
                }
            }
        }

        // Check by SubOrg ID
        if (StringUtils.hasText(practice.getSubOrgId())) {
            Optional<Institute> subOrgOpt = instituteRepository.findById(practice.getSubOrgId());
            if (subOrgOpt.isPresent()) {
                // Find any active UserPlan linked to this SubOrg
                Optional<UserPlan> planOpt = userPlanRepository.findBySubOrgIdAndSourceAndStatus(
                        practice.getSubOrgId(), "SUB_ORG", "ACTIVE");
                if (planOpt.isPresent()) {
                    return new PracticeCacheEntry(subOrgOpt.get(), planOpt.get());
                }
            }
        }

        return null;
    }

    private String resolvePackageSessionId(EnrollmentImportItemDTO item, EnrollmentDefaultsDTO defaults) {
        if (StringUtils.hasText(item.getPackageSessionId())) {
            return item.getPackageSessionId();
        }
        return defaults != null ? defaults.getPackageSessionId() : null;
    }

    private EnrollInvite findEnrollInvite(EnrollmentImportItemDTO item, PackageSession packageSession,
            EnrollmentDefaultsDTO defaults) {

        // Priority 1: From item
        if (StringUtils.hasText(item.getEnrollInviteId())) {
            return enrollInviteRepository.findById(item.getEnrollInviteId())
                    .orElseThrow(() -> new RuntimeException("Enroll invite not found: " + item.getEnrollInviteId()));
        }

        // Priority 2: From defaults
        if (defaults != null && StringUtils.hasText(defaults.getEnrollInviteId())) {
            return enrollInviteRepository.findById(defaults.getEnrollInviteId())
                    .orElseThrow(() -> new RuntimeException("Default enroll invite not found"));
        }

        // Priority 3: Default for package session
        Optional<EnrollInvite> inviteOpt = enrollInviteRepository.findLatestForPackageSessionWithFilters(
                packageSession.getId(), List.of("ACTIVE"), null, List.of("ACTIVE"));

        if (inviteOpt.isPresent()) {
            return inviteOpt.get();
        }

        throw new RuntimeException("No enroll invite found for package session: " + packageSession.getId());
    }

    private UserPlan createUserPlan(String userId, EnrollmentImportItemDTO item, EnrollInvite enrollInvite,
            Institute subOrg, String instituteId, EnrollmentDefaultsDTO defaults) {

        UserPlan userPlan = new UserPlan();
        userPlan.setUserId(userId);
        userPlan.setEnrollInviteId(enrollInvite.getId());
        userPlan.setSource("USER");

        // Payment option and plan
        String paymentOptionId = item.getPaymentOptionId() != null ? item.getPaymentOptionId()
                : (defaults != null ? defaults.getPaymentOptionId() : null);
        String paymentPlanId = item.getPaymentPlanId() != null ? item.getPaymentPlanId()
                : (defaults != null ? defaults.getPaymentPlanId() : null);

        userPlan.setPaymentOptionId(paymentOptionId);
        userPlan.setPaymentPlanId(paymentPlanId);

        // Status from subscription or one-time
        String status = "ACTIVE";
        Date startDate = new Date();
        Date endDate = null;

        if (item.isSubscription() && item.getSubscription() != null) {
            status = item.getSubscription().getEffectiveStatus();
            startDate = item.getSubscription().getStartDate() != null ? item.getSubscription().getStartDate()
                    : new Date();
            endDate = item.getSubscription().getEffectiveEndDate();
        } else if (item.isOneTime() && item.getOneTime() != null) {
            status = item.getOneTime().getEffectiveStatus();
            startDate = item.getOneTime().getEffectiveStartDate();
            endDate = item.getOneTime().getCalculatedEndDate();
        }

        userPlan.setStatus(status);
        userPlan.setStartDate(startDate);
        userPlan.setEndDate(endDate);

        return userPlanRepository.save(userPlan);
    }

    private UserPlan createUserPlanForPractice(String userId, EnrollmentImportItemDTO item,
            EnrollInvite enrollInvite, Institute subOrg, String instituteId,
            EnrollmentDefaultsDTO defaults) {

        UserPlan userPlan = createUserPlan(userId, item, enrollInvite, subOrg, instituteId, defaults);
        userPlan.setSource("SUB_ORG");
        userPlan.setSubOrgId(subOrg.getId());
        return userPlanRepository.save(userPlan);
    }

    private StudentSessionInstituteGroupMapping createSSIGM(String userId, UserPlan userPlan,
            PackageSession packageSession, Institute institute, Institute subOrg,
            String roles, String status) {

        StudentSessionInstituteGroupMapping ssigm = new StudentSessionInstituteGroupMapping();
        ssigm.setUserId(userId);
        ssigm.setUserPlanId(userPlan.getId());
        ssigm.setPackageSession(packageSession);
        ssigm.setInstitute(institute);
        ssigm.setEnrolledDate(userPlan.getStartDate());
        ssigm.setExpiryDate(userPlan.getEndDate());
        ssigm.setStatus(status);
        ssigm.setTypeId(packageSession.getId());

        if (subOrg != null) {
            ssigm.setSubOrg(subOrg);
            ssigm.setCommaSeparatedOrgRoles(roles);
        }

        return ssigmRepository.save(ssigm);
    }

    private int createPaymentLogs(List<PaymentHistoryImportDTO> paymentHistory, UserPlan userPlan, String userId) {
        if (paymentHistory == null || paymentHistory.isEmpty()) {
            return 0;
        }

        int count = 0;
        for (PaymentHistoryImportDTO payment : paymentHistory) {
            PaymentLog log = new PaymentLog();
            log.setUserPlan(userPlan);
            log.setUserId(userId);
            // Convert BigDecimal to Double
            log.setPaymentAmount(payment.getAmount() != null ? payment.getAmount().doubleValue() : null);
            log.setDate(payment.getDate() != null ? payment.getDate() : new Date());
            log.setPaymentStatus(payment.getEffectiveStatus());
            String vendor = payment.getEffectiveVendor();
            log.setVendor(vendor);
            // Set vendorId to same as vendor
            log.setVendorId(vendor);
            // Set currency from DTO
            log.setCurrency(payment.getEffectiveCurrency());
            log.setStatus("ACTIVE");

            // Store transaction ID in payment specific data
            if (StringUtils.hasText(payment.getTransactionId())) {
                log.setPaymentSpecificData("{\"external_transaction_id\":\"" +
                        payment.getTransactionId() + "\"}");
            }

            paymentLogRepository.save(log);
            count++;
        }
        return count;
    }

    /**
     * Helper method to get institute ID from a package session
     */
    private String findInstituteIdFromPackageSession(PackageSession packageSession) {
        if (packageSession == null) {
            return null;
        }
        // PackageSession is linked to Institute via mappings
        // For now, we'll use a simpler approach - get from the SSIGM if available
        List<StudentSessionInstituteGroupMapping> mappings = ssigmRepository
                .findByUserPlanIdAndStatus(packageSession.getId(), "ACTIVE");
        if (!mappings.isEmpty() && mappings.get(0).getInstitute() != null) {
            return mappings.get(0).getInstitute().getId();
        }
        return null;
    }

    /**
     * Updates inventory by decrementing available_slots when a user is enrolled.
     * If available_slots is null or 0, the update is skipped but enrollment
     * continues.
     * 
     * @param packageSession The package session being enrolled into
     */
    private void updateInventoryOnEnrollment(PackageSession packageSession) {
        if (packageSession == null) {
            return;
        }

        if (packageSession.getPackageEntity() != null && commerceLegacyGuard.isVariantSession(
                packageSession.getId(), packageSession.getPackageEntity().getPackageType())) {
            // A product's stock moves only through Commerce.
            log.warn("Skipping inventory update for package session {} - shop product", packageSession.getId());
            return;
        }

        Integer availableSlots = packageSession.getAvailableSlots();

        // If available_slots is null or 0, ignore inventory update but continue with
        // migration
        if (availableSlots == null || availableSlots <= 0) {
            log.debug("Skipping inventory update for package session {} - available_slots is {} ",
                    packageSession.getId(), availableSlots);
            return;
        }

        // Decrement available slots
        packageSession.setAvailableSlots(availableSlots - 1);
        packageSessionRepository.save(packageSession);

        log.debug("Updated inventory for package session {}: available_slots {} -> {}",
                packageSession.getId(), availableSlots, availableSlots - 1);
    }

    // Helper class for practice cache
    private static class PracticeCacheEntry {
        final Institute subOrg;
        final UserPlan userPlan;

        PracticeCacheEntry(Institute subOrg, UserPlan userPlan) {
            this.subOrg = subOrg;
            this.userPlan = userPlan;
        }
    }
}
