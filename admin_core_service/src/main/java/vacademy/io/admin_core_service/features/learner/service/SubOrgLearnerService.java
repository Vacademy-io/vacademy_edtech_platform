package vacademy.io.admin_core_service.features.learner.service;

import vacademy.io.admin_core_service.features.offline_payment.service.OfflinePaymentDetailsService;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.common.entity.CustomFields;
import vacademy.io.admin_core_service.features.common.entity.InstituteCustomField;
import vacademy.io.admin_core_service.features.common.enums.CustomFieldValueSourceTypeEnum;
import vacademy.io.admin_core_service.features.common.repository.CustomFieldValuesRepository;
import vacademy.io.admin_core_service.features.common.repository.InstituteCustomFieldRepository;
import vacademy.io.admin_core_service.features.common.service.CustomFieldValueService;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.enums.SubOrgRoles;
import vacademy.io.admin_core_service.features.enroll_invite.repository.EnrollInviteRepository;
import vacademy.io.admin_core_service.features.enroll_invite.service.PackageSessionEnrollInviteToPaymentOptionService;
import vacademy.io.admin_core_service.features.faculty.dto.AddUserAccessDTO;
import vacademy.io.admin_core_service.features.faculty.service.FacultyService;
import vacademy.io.admin_core_service.features.institute_learner.entity.StudentSubOrg;
import vacademy.io.admin_core_service.features.institute_learner.enums.StudentSubOrgLinkType;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSubOrgRepository;
import vacademy.io.admin_core_service.features.fee_management.repository.StudentFeePaymentRepository;
import vacademy.io.admin_core_service.features.fee_management.service.CpoEnrollmentConfigApplier;
import vacademy.io.admin_core_service.features.fee_management.service.FeeLedgerAllocationService;
import vacademy.io.admin_core_service.features.fee_management.service.StudentFeePaymentGenerationService;
import vacademy.io.admin_core_service.features.invoice.entity.Invoice;
import vacademy.io.admin_core_service.features.invoice.service.InvoiceService;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;
import vacademy.io.admin_core_service.features.user_subscription.enums.PaymentLogStatusEnum;
import vacademy.io.admin_core_service.features.user_subscription.enums.PaymentOptionType;
import vacademy.io.admin_core_service.features.user_subscription.enums.UserPlanSourceEnum;
import vacademy.io.admin_core_service.features.user_subscription.enums.UserPlanStatusEnum;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentOptionRepository;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentLogService;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute_learner.entity.Student;
import vacademy.io.admin_core_service.features.institute_learner.entity.StudentSessionInstituteGroupMapping;
import vacademy.io.admin_core_service.features.institute_learner.enums.LearnerSessionStatusEnum;
import vacademy.io.admin_core_service.features.institute_learner.repository.InstituteStudentRepository;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.learner.dto.*;
import vacademy.io.admin_core_service.features.packages.enums.PackageSessionStatusEnum;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.UserPlanRepository;
import vacademy.io.admin_core_service.features.workflow.enums.WorkflowTriggerEvent;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.payment.enums.PaymentGateway;
import vacademy.io.common.payment.enums.PaymentStatusEnum;
import com.fasterxml.jackson.databind.ObjectMapper;
import vacademy.io.common.institute.entity.Group;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.common.institute.entity.session.PackageSession;

import java.math.BigDecimal;
import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;
import java.util.Random;
import java.util.Calendar;

@Slf4j
@Service
@RequiredArgsConstructor
public class SubOrgLearnerService {

    private final AuthService authService;
    private final OfflinePaymentDetailsService offlinePaymentDetailsService;
    private final InstituteStudentRepository instituteStudentRepository;
    private final StudentSessionInstituteGroupMappingRepository mappingRepository;
    private final PackageSessionRepository packageSessionRepository;
    private final InstituteRepository instituteRepository;
    private final CustomFieldValueService customFieldValueService;
    private final CustomFieldValuesRepository customFieldValuesRepository;
    private final InstituteCustomFieldRepository instituteCustomFieldRepository;
    private final WorkflowTriggerService workflowTriggerService;
    private final UserPlanRepository userPlanRepository;
    private final EnrollInviteRepository enrollInviteRepository;
    private final StudentSubOrgRepository studentSubOrgRepository;
    private final PackageSessionEnrollInviteToPaymentOptionService packageSessionEnrollInviteToPaymentOptionService;
    private final FacultyService facultyService;
    private final PaymentLogService paymentLogService;
    private final PaymentLogRepository paymentLogRepository;
    private final InvoiceService invoiceService;
    private final PaymentOptionRepository paymentOptionRepository;
    private final StudentFeePaymentGenerationService studentFeePaymentGenerationService;
    private final StudentFeePaymentRepository studentFeePaymentRepository;
    private final CpoEnrollmentConfigApplier cpoEnrollmentConfigApplier;
    private final FeeLedgerAllocationService feeLedgerAllocationService;
    private final vacademy.io.admin_core_service.features.suborg.service.SubOrgSubscriptionService subOrgSubscriptionService;
    private final vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService instituteSettingService;
    private final vacademy.io.admin_core_service.features.course_settings.service.LmsExistingUserEditPolicyService lmsExistingUserEditPolicyService;

    @Transactional(readOnly = true)
    public SubOrgResponseDTO getUsersByPackageSessionAndSubOrg(
            String packageSessionId,
            String subOrgId) {

        log.info("Fetching student mappings for package_session_id: {} and sub_org_id: {}", packageSessionId, subOrgId);

        // Validate and fetch sub-organization (institute)
        Institute subOrg = instituteRepository.findById(subOrgId)
                .orElseThrow(() -> new VacademyException("Sub-organization not found with id: " + subOrgId));

        // Query to get all mapping rows for this sub-org and package session
        List<Object[]> mappingData = instituteStudentRepository
                .findMappingsByPackageSessionAndSubOrg(packageSessionId, subOrgId);

        log.info("Found {} student mappings for package_session_id: {} and sub_org_id: {}",
                mappingData.size(), packageSessionId, subOrgId);

        // Extract unique user IDs
        Set<String> userIds = new HashSet<>();
        for (Object[] row : mappingData) {
            if (row[1] != null) { // row[1] is user_id
                userIds.add((String) row[1]);
            }
        }

        // Fetch complete user details from auth service
        List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(new ArrayList<>(userIds));

        // Create a map for quick lookup
        Map<String, UserDTO> userMap = users.stream()
                .collect(Collectors.toMap(UserDTO::getId, Function.identity()));

        log.info("Successfully fetched {} user details", users.size());

        // Build list of student mappings with user details
        List<StudentMappingWithUserDTO> studentMappings = new ArrayList<>();
        String instituteIdFromMapping = null;
        for (Object[] row : mappingData) {
            StudentMappingWithUserDTO mapping = buildStudentMappingWithUser(row, userMap);
            if (mapping != null) {
                studentMappings.add(mapping);
                // Extract institute_id from the mapping (row[7])
                if (instituteIdFromMapping == null && row[7] != null) {
                    instituteIdFromMapping = (String) row[7];
                }
            }
        }

        // Fetch and populate custom fields for all users (filtered by institute's
        // active custom fields)
        // Use institute_id from student_session_institute_group_mapping, not sub_org_id
        if (instituteIdFromMapping != null) {
            enrichStudentMappingsWithCustomFields(studentMappings, instituteIdFromMapping);
        }

        // Build sub-org details
        SubOrgDetailsDTO subOrgDetails = buildSubOrgDetails(subOrg);

        // Build and return response
        SubOrgResponseDTO response = new SubOrgResponseDTO();
        response.setSubOrgDetails(subOrgDetails);
        response.setStudentMappings(studentMappings);

        return response;
    }

    private StudentMappingWithUserDTO buildStudentMappingWithUser(Object[] row, Map<String, UserDTO> userMap) {
        if (row == null || row.length < 12) {
            return null;
        }

        String userId = (String) row[1];
        UserDTO user = userMap.get(userId);

        if (user == null) {
            log.warn("User not found for userId: {}", userId);
            return null;
        }

        return StudentMappingWithUserDTO.builder()
                .id((String) row[0])
                .userId(userId)
                .instituteEnrollmentNumber((String) row[2])
                .enrolledDate(row[3] != null ? (Date) row[3] : null)
                .expiryDate(row[4] != null ? (Date) row[4] : null)
                .status((String) row[5])
                .packageSessionId((String) row[6])
                .instituteId((String) row[7])
                .groupId((String) row[8])
                .subOrgId((String) row[9])
                .userPlanId((String) row[10])
                .destinationPackageSessionId((String) row[11])
                .user(user)
                .build();
    }

    /**
     * Enrich student mappings with custom fields
     * Returns ALL institute-level custom fields for each user with:
     * - Actual values if user has filled them
     * - Null values if user hasn't filled them
     * This ensures consistent response structure across all users
     */
    private void enrichStudentMappingsWithCustomFields(List<StudentMappingWithUserDTO> studentMappings,
            String instituteId) {
        if (studentMappings == null || studentMappings.isEmpty()) {
            return;
        }

        // Extract all unique user IDs
        List<String> userIds = studentMappings.stream()
                .map(StudentMappingWithUserDTO::getUserId)
                .filter(Objects::nonNull)
                .distinct()
                .collect(Collectors.toList());

        if (userIds.isEmpty()) {
            return;
        }

        log.info("Fetching custom fields for {} users from institute {}", userIds.size(), instituteId);

        // Step 1: Fetch ALL active institute custom fields (template for all users)
        List<Object[]> instituteCustomFieldsData = instituteCustomFieldRepository
                .findAllActiveCustomFieldsWithDetailsByInstituteId(instituteId);

        log.info("Found {} active custom fields configured for institute", instituteCustomFieldsData.size());

        // Build template map of all custom fields with null values, deduplicated by field_key
        // Using LinkedHashMap to preserve form order while ensuring uniqueness
        Map<String, CustomFieldDTO> instituteCustomFieldsTemplateMap = new LinkedHashMap<>();
        for (Object[] row : instituteCustomFieldsData) {
            InstituteCustomField icf = (InstituteCustomField) row[0];
            CustomFields cf = (CustomFields) row[1];

            String fieldKey = cf.getFieldKey();
            
            // Only add if we haven't seen this field_key before (deduplication)
            if (!instituteCustomFieldsTemplateMap.containsKey(fieldKey)) {
                CustomFieldDTO template = CustomFieldDTO.builder()
                        .customFieldId(cf.getId())
                        .fieldKey(fieldKey)
                        .fieldName(cf.getFieldName())
                        .fieldType(cf.getFieldType())
                        .fieldValue(null) // Default to null
                        .sourceType(CustomFieldValueSourceTypeEnum.USER.name())
                        .build();

                instituteCustomFieldsTemplateMap.put(fieldKey, template);
            }
        }
        
        // Convert map to list for iteration
        List<CustomFieldDTO> instituteCustomFieldsTemplate = new ArrayList<>(instituteCustomFieldsTemplateMap.values());

        // Step 2: Fetch user-specific custom field values
        List<Object[]> customFieldData = customFieldValuesRepository.findCustomFieldsWithKeysByUserIdsAndInstitute(
                CustomFieldValueSourceTypeEnum.USER.name(),
                userIds,
                instituteId);

        log.info("Found {} custom field value records", customFieldData.size());

        // Group custom field values by user ID and field_key (instead of customFieldId)
        // This allows matching even if values are stored under different duplicate custom_field_ids
        Map<String, Map<String, String>> userCustomFieldValuesMap = new HashMap<>();

        for (Object[] row : customFieldData) {
            String userId = (String) row[0];
            String fieldKey = (String) row[2];  // Using field_key instead of custom_field_id
            String fieldValue = (String) row[5];

            // Use putIfAbsent to keep the first value (most recent due to ORDER BY created_at DESC)
            userCustomFieldValuesMap
                    .computeIfAbsent(userId, k -> new HashMap<>())
                    .putIfAbsent(fieldKey, fieldValue);
        }

        // Step 3: Enrich each student mapping with ALL institute custom fields
        for (StudentMappingWithUserDTO mapping : studentMappings) {
            String userId = mapping.getUserId();
            Map<String, String> userValues = userCustomFieldValuesMap.getOrDefault(userId, new HashMap<>());

            // Clone template and fill in user values using field_key for lookup
            List<CustomFieldDTO> userCustomFields = new ArrayList<>();
            for (CustomFieldDTO template : instituteCustomFieldsTemplate) {
                CustomFieldDTO userField = CustomFieldDTO.builder()
                        .customFieldId(template.getCustomFieldId())
                        .fieldKey(template.getFieldKey())
                        .fieldName(template.getFieldName())
                        .fieldType(template.getFieldType())
                        .fieldValue(userValues.get(template.getFieldKey())) // Lookup by field_key instead of custom_field_id
                        .sourceType(template.getSourceType())
                        .build();

                userCustomFields.add(userField);
            }

            mapping.setCustomFields(userCustomFields);
        }

        log.info("Successfully enriched {} student mappings with {} custom fields each",
                studentMappings.size(), instituteCustomFieldsTemplate.size());
    }

    /**
     * Build sub-organization details DTO
     */
    private SubOrgDetailsDTO buildSubOrgDetails(Institute institute) {
        SubOrgDetailsDTO dto = new SubOrgDetailsDTO();
        dto.setId(institute.getId());
        dto.setName(institute.getInstituteName());
        dto.setEmail(institute.getEmail());
        dto.setMobileNumber(institute.getMobileNumber());
        dto.setAddress(institute.getAddress());
        dto.setCity(institute.getCity());
        dto.setState(institute.getState());
        dto.setCountry(institute.getCountry());
        dto.setPincode(institute.getPinCode());
        dto.setWebsiteUrl(institute.getWebsiteUrl());
        dto.setStatus("ACTIVE"); // Default status

        return dto;
    }

    @Transactional
    public SubOrgEnrollResponseDTO enrollLearnerToSubOrg(SubOrgEnrollRequestDTO request, CustomUserDetails admin) {
        // Resolve the PS list once — multi-PS variant takes precedence; otherwise fall back
        // to the single packageSessionId for backwards compatibility.
        List<String> psIds = (request.getPackageSessionIds() != null
                && !request.getPackageSessionIds().isEmpty())
                ? request.getPackageSessionIds()
                : (StringUtils.hasText(request.getPackageSessionId())
                        ? List.of(request.getPackageSessionId())
                        : Collections.emptyList());

        log.info("Starting sub-org enrollment for package_session_ids: {}, sub_org_id: {}",
                psIds, request.getSubOrgId());

        // 1. Validate request (PS list non-empty + everything else)
        if (psIds.isEmpty()) {
            throw new VacademyException("At least one package session ID is required");
        }
        validateRequest(request);

        // 2. Validate every PS up front
        List<PackageSession> packageSessions = new ArrayList<>(psIds.size());
        for (String psId : psIds) {
            packageSessions.add(validatePackageSession(psId));
        }
        Institute subOrg = validateSubOrg(request.getSubOrgId());
        validateInstitute(request.getInstituteId());
        // How the offline payment was made: validated now, before the learner is created,
        // so a bad mode fails the request instead of leaving an enrollment without its payment.
        OfflinePaymentDetailsService.Resolved offlinePaidVia = "OFFLINE".equalsIgnoreCase(request.getPaymentMode())
                && request.getOfflinePaymentAmount() != null && request.getOfflinePaymentAmount() > 0.0
                ? offlinePaymentDetailsService.resolve(request.getInstituteId(),
                        request.getOfflinePaymentDetails(), request.getOfflinePaymentReference())
                : null;

        // 3. Create or fetch user
        UserDTO user = createOrFetchUser(request);

        // 4. Ensure student record exists
        ensureStudentExists(user);

        // 5. Validate member count limit + dedupe enrollment per PS
        for (String psId : psIds) {
            validateMemberCountLimit(request.getSubOrgId(), psId);
        }
        for (String psId : psIds) {
            // Re-use existing helper by temporarily setting the field — single-PS dedupe.
            String saved = request.getPackageSessionId();
            request.setPackageSessionId(psId);
            try {
                validateNoDuplicateEnrollment(user.getId(), request);
            } finally {
                request.setPackageSessionId(saved);
            }
        }

        // 6. Create ONE UserPlan against the first PS's scoped invite — this UserPlan is
        // shared across all PSes the user gets access to. Each PS then gets its own SSIGM,
        // StudentSubOrg, and FSPSSM rows referencing this UserPlan.
        String primaryPsId = psIds.get(0);
        String learnerUserPlanId = createLearnerUserPlan(user.getId(), request.getSubOrgId(), primaryPsId);

        // 7-9. Per-PS: SSIGM + StudentSubOrg + faculty mapping (admin only).
        // Resolve the FSPSSM access_permission CSV once: explicit request override wins,
        // otherwise read the sub-org's persisted ADMIN_PERMISSIONS setting (falls back to
        // "FULL" inside the service). Avoids re-fetching the org-level invite per-PS.
        String resolvedAccessPermission = StringUtils.hasText(request.getAccessPermission())
                ? request.getAccessPermission()
                : subOrgSubscriptionService.resolveAdminPermissionCsv(
                        request.getSubOrgId(), request.getInstituteId());
        StudentSessionInstituteGroupMapping firstMapping = null;
        for (PackageSession ps : packageSessions) {
            // createMapping reads request.packageSessionId — temporarily set it.
            String saved = request.getPackageSessionId();
            request.setPackageSessionId(ps.getId());
            try {
                StudentSessionInstituteGroupMapping mapping = createMapping(
                        request, user, ps, subOrg, learnerUserPlanId);
                mapping = mappingRepository.save(mapping);
                if (firstMapping == null) firstMapping = mapping;
                if (isAdminRole(request.getCommaSeparatedOrgRoles())) {
                    syncFacultyMappingForSubOrgAdmin(user, ps.getId(),
                            request.getSubOrgId(), request.getCommaSeparatedOrgRoles(),
                            resolvedAccessPermission);
                }
            } finally {
                request.setPackageSessionId(saved);
            }
        }
        createStudentSubOrgEntry(user.getId(), subOrg, request.getCommaSeparatedOrgRoles());

        String firstMappingId = firstMapping != null ? firstMapping.getId() : null;
        log.info("Created {} mapping(s) for user: {}", psIds.size(), user.getId());
        UserDTO adminDTO = authService.getUsersFromAuthServiceByUserIds(List.of(admin.getUserId())).get(0);

        // 10. Save custom fields (against the first mapping — they're user-level).
        if (firstMappingId != null
                && request.getCustomFieldValues() != null
                && !request.getCustomFieldValues().isEmpty()) {
            customFieldValueService.addCustomFieldValue(
                    request.getCustomFieldValues(),
                    CustomFieldValueSourceTypeEnum.STUDENT_SESSION_INSTITUTE_GROUP_MAPPING.name(),
                    firstMappingId);
            customFieldValueService.addCustomFieldValue(
                    request.getCustomFieldValues(),
                    CustomFieldValueSourceTypeEnum.USER.name(),
                    user.getId());
        }

        // 11. Optional payment-option override (typically CPO for admins). Runs against the
        // single shared UserPlan, so SFP rows + offline allocation happen once.
        PaymentOption resolvedLearnerOption = applyLearnerPaymentOptionOverrideIfRequested(
                request, learnerUserPlanId, user.getId(), admin.getUserId());

        // 12. Optional offline payment record + invoice.
        ManualPaymentResult paymentResult = recordOfflinePaymentIfRequested(
                request, user.getId(), learnerUserPlanId, admin.getUserId(), resolvedLearnerOption, offlinePaidVia);

        // Hydrate password back from auth-service so the LMS create-user webhook
        // (workflow node referencing #ctx['member']['password']) receives the real
        // stored credential instead of null. createUserFromAuthService strips
        // passwords from its response, so the UserDTO held above has no password
        // even though one was generated and persisted. Mirrors the bulk-assign
        // workaround in BulkAssignmentService. Best-effort: a fetch blip leaves
        // password=null and downstream workflow nodes must branch on it; we don't
        // want a credential read-back to abort an otherwise-successful enrollment.
        try {
            UserDTO userWithPwd = authService.getUsersFromAuthServiceWithPasswordByUserId(user.getId());
            if (userWithPwd != null && StringUtils.hasText(userWithPwd.getPassword())) {
                user.setPassword(userWithPwd.getPassword());
            }
        } catch (Exception e) {
            log.warn("Could not fetch stored password for sub-org learner userId={}: {}",
                    user.getId(), e.getMessage());
        }

        // Trigger workflow for each PS (existing per-PS contract).
        for (String psId : psIds) {
            triggerEnrollmentWorkflow(request.getInstituteId(), user, psId, request.getSubOrgId(), adminDTO);
        }

        return SubOrgEnrollResponseDTO.builder()
                .user(user)
                .mappingId(firstMappingId)
                .message("Successfully enrolled user to sub-organization (" + psIds.size() + " PS)")
                .paymentLogId(paymentResult.paymentLogId)
                .invoiceId(paymentResult.invoiceId)
                .build();
    }

    private record ManualPaymentResult(String paymentLogId, String invoiceId) {
        static ManualPaymentResult empty() {
            return new ManualPaymentResult(null, null);
        }
    }

    /**
     * Records the optional offline payment fields on the request as a PaymentLog against
     * the learner's UserPlan and, when requested, generates an invoice. For CPO learners
     * the payment is FIFO-allocated against the previously-generated StudentFeePayment
     * rows (mirroring bulk/v3/assign's CPO offline path); non-CPO learners just get the
     * PaymentLog with no allocation, since they have no SFP rows.
     */
    private ManualPaymentResult recordOfflinePaymentIfRequested(SubOrgEnrollRequestDTO request,
                                                                String learnerUserId,
                                                                String learnerUserPlanId,
                                                                String recordedByUserId,
                                                                PaymentOption resolvedOption,
                                                                OfflinePaymentDetailsService.Resolved paidVia) {
        boolean offlineRequested = "OFFLINE".equalsIgnoreCase(request.getPaymentMode())
                && request.getOfflinePaymentAmount() != null
                && request.getOfflinePaymentAmount() > 0.0
                && StringUtils.hasText(learnerUserPlanId);
        if (!offlineRequested) {
            return ManualPaymentResult.empty();
        }

        UserPlan learnerPlan = userPlanRepository.findById(learnerUserPlanId).orElse(null);
        if (learnerPlan == null) {
            log.warn("Skipping offline payment recording — learner UserPlan {} not found",
                    learnerUserPlanId);
            return ManualPaymentResult.empty();
        }

        double amount = request.getOfflinePaymentAmount();
        String currency = StringUtils.hasText(request.getOfflinePaymentCurrency())
                ? request.getOfflinePaymentCurrency() : "INR";
        Date paymentDate = request.getOfflinePaymentDate() != null ? request.getOfflinePaymentDate()
                : paidVia != null && paidVia.paymentDate() != null
                        ? java.sql.Date.valueOf(paidVia.paymentDate()) : new Date();

        String paymentLogId;
        try {
            paymentLogId = paymentLogService.createPaymentLog(
                    learnerUserId,
                    amount,
                    PaymentGateway.MANUAL.name(),
                    PaymentGateway.MANUAL.name(),
                    currency,
                    learnerPlan,
                    null,
                    paymentDate);

            Map<String, Object> specific = new HashMap<>();
            specific.put("source", "SUB_ORG_ADD_MEMBER");
            specific.put("recorded_by", recordedByUserId);
            if (StringUtils.hasText(request.getOfflinePaymentReference())) {
                specific.put("transaction_id", request.getOfflinePaymentReference());
            }
            String specificJson;
            try {
                specificJson = new ObjectMapper().writeValueAsString(specific);
            } catch (Exception je) {
                log.warn("Failed to serialize paymentSpecificData for offline payment: {}",
                        je.getMessage());
                specificJson = null;
            }

            paymentLogService.updatePaymentLogOnly(
                    paymentLogId,
                    PaymentLogStatusEnum.SUCCESS.name(),
                    PaymentStatusEnum.PAID.name(),
                    specificJson);
            offlinePaymentDetailsService.apply(paymentLogId, paidVia, recordedByUserId);
            log.info("Recorded manual offline payment={} currency={} for learner={} userPlan={} logId={}",
                    amount, currency, learnerUserId, learnerUserPlanId, paymentLogId);
        } catch (Exception e) {
            log.error("Failed to record manual offline payment for learner={}, userPlan={}: {}",
                    learnerUserId, learnerUserPlanId, e.getMessage(), e);
            return ManualPaymentResult.empty();
        }

        // CPO-only: FIFO-allocate the payment across the freshly-generated SFP rows so
        // they transition PENDING → PARTIAL_PAID / PAID. Wrapped in try/catch — failure
        // to allocate shouldn't kill the enrollment, the PaymentLog is already recorded.
        boolean isCpo = resolvedOption != null
                && PaymentOptionType.CPO.name().equalsIgnoreCase(resolvedOption.getType());
        if (isCpo) {
            try {
                feeLedgerAllocationService.allocatePaymentForNewLog(
                        paymentLogId, BigDecimal.valueOf(amount), learnerUserPlanId);
            } catch (Exception e) {
                log.error("FIFO allocation failed for paymentLogId={}, userPlanId={}: {}",
                        paymentLogId, learnerUserPlanId, e.getMessage(), e);
            }
        }

        // Deferred to after enrollLearnerToSubOrg commits — see generateInvoiceAfterCommit.
        // Generating inline handed the invoice's REQUIRES_NEW transaction a PaymentLog this
        // (transactional) enrolment had not committed, so invoice_payment_log_mapping failed its
        // FK; catching that did not clear rollbackOnly, so the whole sub-org enrolment was then
        // discarded at commit rather than merely going without an invoice.
        //
        // invoiceId is consequently always null in the response now. It was already null whenever
        // this failed — the catch left it unset — so nothing that used to be populated is lost;
        // the invoice is still created, just after the enrolment is safely committed.
        if (request.isGenerateInvoice()) {
            invoiceService.generateInvoiceAfterCommit(paymentLogId, request.getInstituteId());
        }
        return new ManualPaymentResult(paymentLogId, null);
    }

    /**
     * Per-learner payment-option override. If the admin picks a different PaymentOption
     * (e.g. CPO, ONE_TIME) on the Add User form, swap the learner's UserPlan to point at
     * it and run any CPO-specific side effects (generate SFPs, apply cpoConfig). Returns
     * the resolved option (or null if no override / not found) so the offline-payment
     * step can decide whether to FIFO-allocate.
     */
    private PaymentOption applyLearnerPaymentOptionOverrideIfRequested(
            SubOrgEnrollRequestDTO request,
            String learnerUserPlanId,
            String learnerUserId,
            String adminUserId) {
        if (!StringUtils.hasText(request.getPaymentOptionId())
                || !StringUtils.hasText(learnerUserPlanId)) {
            log.info("Payment option override skipped — paymentOptionId={} userPlanId={}",
                    request.getPaymentOptionId(), learnerUserPlanId);
            return null;
        }

        // The frontend's CPO picker uses ComplexPaymentOption.id as the option value (the
        // mirror id isn't exposed there), so try a direct PaymentOption.id lookup first
        // and fall back to mirror-by-CPO. Both shapes end up at the same mirror row.
        PaymentOption override = paymentOptionRepository
                .findById(request.getPaymentOptionId())
                .orElseGet(() -> paymentOptionRepository
                        .findByComplexPaymentOptionId(request.getPaymentOptionId())
                        .orElse(null));
        if (override == null) {
            log.warn("Requested paymentOptionId={} not found as PaymentOption or CPO mirror; "
                            + "keeping default plan",
                    request.getPaymentOptionId());
            return null;
        }

        UserPlan learnerPlan = userPlanRepository.findById(learnerUserPlanId).orElse(null);
        if (learnerPlan == null) return null;

        boolean isCpo = PaymentOptionType.CPO.name().equalsIgnoreCase(override.getType());
        boolean alreadyOnOverride = override.getId().equals(learnerPlan.getPaymentOptionId());

        if (!alreadyOnOverride) {
            learnerPlan.setPaymentOptionId(override.getId());
            if (override.getPaymentPlans() != null && !override.getPaymentPlans().isEmpty()) {
                learnerPlan.setPaymentPlanId(override.getPaymentPlans().get(0).getId());
            }
            // CPO plans start PENDING_FOR_PAYMENT — installments awaiting allocation.
            if (isCpo) learnerPlan.setStatus(UserPlanStatusEnum.PENDING_FOR_PAYMENT.name());
            userPlanRepository.save(learnerPlan);
            log.info("Override applied: userPlan={} type={} cpoId={}",
                    learnerUserPlanId, override.getType(), override.getComplexPaymentOptionId());
        } else {
            log.info("UserPlan {} already pointing at PaymentOption {} ({}); skipping option swap"
                            + " but will ensure CPO side-effects still run.",
                    learnerUserPlanId, override.getId(), override.getType());
        }

        // CPO side-effects: generate SFP rows IF NONE EXIST YET. This is the critical
        // step that the earlier early-return swallowed — when createLearnerUserPlan
        // resolved the UserPlan directly to the CPO mirror via the org-level invite,
        // the bills never got materialised.
        if (isCpo) {
            String cpoId = override.getComplexPaymentOptionId();
            if (!StringUtils.hasText(cpoId)) {
                log.error("CPO mirror PaymentOption {} has null complexPaymentOptionId — sync bug?",
                        override.getId());
                return override;
            }
            boolean hasExistingBills = !studentFeePaymentRepository
                    .findByUserPlanId(learnerUserPlanId).isEmpty();
            if (!hasExistingBills) {
                try {
                    List<String> ids = studentFeePaymentGenerationService.generateFeeBills(
                            learnerUserPlanId, cpoId, learnerUserId, request.getInstituteId());
                    log.info("Generated {} SFP row(s) for userPlan={} cpoId={}",
                            ids != null ? ids.size() : 0, learnerUserPlanId, cpoId);
                } catch (Exception e) {
                    log.error("Failed to generate SFP rows for learnerUserPlan={}, cpoId={}: {}",
                            learnerUserPlanId, cpoId, e.getMessage(), e);
                    throw new VacademyException("Failed to generate fee bills: " + e.getMessage());
                }
            } else {
                log.info("SFP rows already exist for userPlan={} — skipping generateFeeBills",
                        learnerUserPlanId);
            }
            if (request.getCpoConfig() != null) {
                try {
                    cpoEnrollmentConfigApplier.apply(learnerUserPlanId, request.getCpoConfig(),
                            adminUserId);
                    log.info("Applied cpoConfig for userPlan={}", learnerUserPlanId);
                } catch (Exception e) {
                    log.error("Failed to apply cpoConfig for userPlan={}: {}",
                            learnerUserPlanId, e.getMessage(), e);
                    throw new VacademyException("Failed to apply CPO configuration: " + e.getMessage());
                }
            }
        }
        return override;
    }

    /**
     * Validate request has required fields
     */
    private void validateRequest(SubOrgEnrollRequestDTO request) {
        if (request.getUser() == null) {
            throw new VacademyException("User details are required");
        }
        boolean hasSingle = StringUtils.hasText(request.getPackageSessionId());
        boolean hasMulti = request.getPackageSessionIds() != null
                && !request.getPackageSessionIds().isEmpty();
        if (!hasSingle && !hasMulti) {
            throw new VacademyException("Package session ID(s) required");
        }
        if (!StringUtils.hasText(request.getSubOrgId())) {
            throw new VacademyException("Sub-organization ID is required");
        }
        if (!StringUtils.hasText(request.getInstituteId())) {
            throw new VacademyException("Institute ID is required");
        }
    }

    /**
     * Validate package session exists and is active
     */
    private PackageSession validatePackageSession(String packageSessionId) {
        PackageSession packageSession = packageSessionRepository.findById(packageSessionId)
                .orElseThrow(() -> new VacademyException("Package session not found with id: " + packageSessionId));

        if (!PackageSessionStatusEnum.ACTIVE.name().equals(packageSession.getStatus())) {
            throw new VacademyException("Package session is not active. Current status: " + packageSession.getStatus());
        }

        return packageSession;
    }

    /**
     * Validate sub-organization exists
     */
    private Institute validateSubOrg(String subOrgId) {
        return instituteRepository.findById(subOrgId)
                .orElseThrow(() -> new VacademyException("Sub-organization not found with id: " + subOrgId));
    }

    /**
     * Validate main institute exists
     */
    private void validateInstitute(String instituteId) {
        instituteRepository.findById(instituteId)
                .orElseThrow(() -> new VacademyException("Institute not found with id: " + instituteId));
    }

    /**
     * Create new user or fetch existing user with proper user_roles entry.
     * <p>
     * Honors the institute-level COURSE_SETTING.enrollmentNotifications.showSendCredentials
     * toggle — same gate that bulk/v3/assign, the admin "Enrol Customer" button and
     * learner/v1/enroll already follow. When the admin disabled "Send Credentials" in
     * display settings, the auth-service credential email is suppressed for sub-org
     * member adds too. Default is true for back-compat (any read failure also defaults
     * to true so a setting-blip can't silently swallow a credential delivery).
     */
    private UserDTO createOrFetchUser(SubOrgEnrollRequestDTO request) {
        log.info("Creating or fetching user with email: {}, userId: {}",
                request.getUser().getEmail(), request.getUser().getId());

        if (request.getUser().getRoles() == null || request.getUser().getRoles().isEmpty()) {
            request.getUser().setRoles(List.of("STUDENT"));
        }

        // Generate password if not provided
        if (!StringUtils.hasText(request.getUser().getPassword())) {
            String generatedPassword = generateRandomPassword(8);
            request.getUser().setPassword(generatedPassword);
            log.info("Generated password for user with email: {}", request.getUser().getEmail());
        }

        // Default the username to the email. The learner-portal sub-org members page
        // (single add + bulk upload) sends no username, so auth-service used to invent
        // one ("vitt" + 4 random chars) that then rode into the enrolment workflow and
        // the welcome email while the admin wizard, which has a username field, enrols
        // the same people as email/email. Only applies to a NEW account — auth-service
        // ignores the username when it matches an existing user by email.
        if (!StringUtils.hasText(request.getUser().getUsername())
                && StringUtils.hasText(request.getUser().getEmail())) {
            request.getUser().setUsername(request.getUser().getEmail().trim().toLowerCase());
        }

        boolean sendCredentials = readCourseSettingEnrollmentFlag(
                request.getInstituteId(), "showSendCredentials");
        if (!sendCredentials) {
            log.info("Skipping credential email for sub-org member add: " +
                    "COURSE_SETTING.showSendCredentials=false for institute {}",
                    request.getInstituteId());
        }

        return authService.createUserFromAuthService(
                request.getUser(),
                request.getInstituteId(),
                sendCredentials);
    }

    /**
     * Reads INSTITUTE.setting.COURSE_SETTING.data.enrollmentNotifications.{flagKey}.
     * Defaults to {@code true} when the setting block or flag is missing so behavior
     * is unchanged for institutes that never touched the toggle. Mirrors the same
     * helper in {@code LearnerEnrollRequestService} / {@code UserPlanService} —
     * kept inline here to avoid cross-service dependency just for one JSON walk.
     */
    @SuppressWarnings("unchecked")
    private boolean readCourseSettingEnrollmentFlag(String instituteId, String flagKey) {
        try {
            Object data = instituteSettingService.getSettingByInstituteIdAndKey(instituteId, "COURSE_SETTING");
            if (!(data instanceof java.util.Map)) {
                return true;
            }
            Object enrollmentNotifications = ((java.util.Map<String, Object>) data).get("enrollmentNotifications");
            if (!(enrollmentNotifications instanceof java.util.Map)) {
                return true;
            }
            Object flag = ((java.util.Map<String, Object>) enrollmentNotifications).get(flagKey);
            return !(flag instanceof Boolean) || (Boolean) flag;
        } catch (Exception e) {
            log.warn("Could not read COURSE_SETTING.enrollmentNotifications.{} for institute {}: {}",
                    flagKey, instituteId, e.getMessage());
            return true;
        }
    }

    private String generateRandomPassword(int length) {
        String chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        Random random = new Random();
        StringBuilder password = new StringBuilder(length);
        for (int i = 0; i < length; i++) {
            password.append(chars.charAt(random.nextInt(chars.length())));
        }
        return password.toString();
    }

    private void ensureStudentExists(UserDTO user) {
        Optional<Student> studentOpt = instituteStudentRepository.findTopByUserIdOrderByCreatedAtDesc(user.getId());
        if (studentOpt.isEmpty()) {
            log.info("Creating student record for user: {}", user.getId());
            Student student = new Student(user);
            instituteStudentRepository.save(student);
        }
    }

    /**
     * Validate no duplicate active enrollment exists
     */
    private void validateNoDuplicateEnrollment(String userId, SubOrgEnrollRequestDTO request) {
        Optional<StudentSessionInstituteGroupMapping> existingMapping = mappingRepository
                .findByUserIdAndPackageSessionIdAndInstituteId(
                        userId,
                        request.getPackageSessionId(),
                        request.getInstituteId());

        if (existingMapping.isPresent()) {
            StudentSessionInstituteGroupMapping mapping = existingMapping.get();
            if (LearnerSessionStatusEnum.ACTIVE.name().equals(mapping.getStatus()) &&
                    request.getSubOrgId().equals(mapping.getSubOrg() != null ? mapping.getSubOrg().getId() : null)) {
                throw new VacademyException(
                        "User is already enrolled in this package session through the same sub-organization");
            }
        }
    }

    /**
     * Create student session institute group mapping
     */
    private StudentSessionInstituteGroupMapping createMapping(
            SubOrgEnrollRequestDTO request,
            UserDTO user,
            PackageSession packageSession,
            Institute subOrg,
            String userPlanId) {

        StudentSessionInstituteGroupMapping mapping = new StudentSessionInstituteGroupMapping();

        // Basic fields
        mapping.setUserId(user.getId());
        mapping.setPackageSession(packageSession);
        mapping.setSubOrg(subOrg);

        // Institute and group
        Institute institute = new Institute();
        institute.setId(request.getInstituteId());
        mapping.setInstitute(institute);

        if (StringUtils.hasText(request.getGroupId())) {
            Group group = new Group();
            group.setId(request.getGroupId());
            mapping.setGroup(group);
        }

        // Dates
        mapping.setEnrolledDate(request.getEnrolledDate() != null ? request.getEnrolledDate() : new Date());
        mapping.setExpiryDate(request.getExpiryDate());
        if (request.getCommaSeparatedOrgRoles() != null)
            mapping.setCommaSeparatedOrgRoles(request.getCommaSeparatedOrgRoles());

        // Status and enrollment number
        mapping.setStatus(StringUtils.hasText(request.getStatus()) ? request.getStatus()
                : LearnerSessionStatusEnum.ACTIVE.name());
        mapping.setInstituteEnrolledNumber(request.getInstituteEnrollmentNumber());

        // Comma separated org roles
        mapping.setCommaSeparatedOrgRoles(request.getCommaSeparatedOrgRoles());

        // No payment tracking for sub-org enrollments
        mapping.setUserPlanId(userPlanId);
        mapping.setDestinationPackageSession(null);

        return mapping;
    }

    @Transactional
    public SubOrgTerminateResponseDTO terminateLearners(SubOrgTerminateRequestDTO request,
            CustomUserDetails userDetails) {
        log.info("Terminating learners for sub_org_id: {}, institute_id: {}, package_session_id: {}, user_count: {}",
                request.getSubOrgId(), request.getInstituteId(), request.getPackageSessionId(),
                request.getUserIds().size());

        // Validate sub-organization exists
        instituteRepository.findById(request.getSubOrgId())
                .orElseThrow(
                        () -> new VacademyException("Sub-organization not found with id: " + request.getSubOrgId()));

        // Validate institute exists
        instituteRepository.findById(request.getInstituteId())
                .orElseThrow(() -> new VacademyException("Institute not found with id: " + request.getInstituteId()));

        // Validate package session exists
        packageSessionRepository.findById(request.getPackageSessionId())
                .orElseThrow(() -> new VacademyException(
                        "Package session not found with id: " + request.getPackageSessionId()));

        // SOFT keeps the learner ACTIVE and just moves their access cut-off to the
        // chosen date; HARD (default) terminates immediately. Blank mode => HARD so
        // pre-existing callers are unaffected.
        boolean soft = "SOFT".equalsIgnoreCase(request.getMode());
        if (soft) {
            java.sql.Timestamp accessTill = parseAccessTillDate(request.getAccessTillDate());
            if (accessTill == null) {
                throw new VacademyException("A last access date is required for a soft termination");
            }
            int softCount = mappingRepository.softCancelLearnersBySubOrgAndUserIds(
                    request.getSubOrgId(),
                    request.getInstituteId(),
                    request.getPackageSessionId(),
                    request.getUserIds(),
                    accessTill);

            // No termination workflow for SOFT — access continues until the cut-off.
            log.info("Soft-cancelled {} learners (access until {})", softCount, accessTill);

            return SubOrgTerminateResponseDTO.builder()
                    .terminatedCount(softCount)
                    .message("Access for " + softCount + " learner(s) will continue until " + accessTill)
                    .build();
        }

        // Perform bulk termination
        int terminatedCount = mappingRepository.terminateLearnersBySubOrgAndUserIds(
                request.getSubOrgId(),
                request.getInstituteId(),
                request.getPackageSessionId(),
                request.getUserIds(),
                LearnerSessionStatusEnum.TERMINATED.name());

        triggerTerminationWorkflow(request.getUserIds(), request.getInstituteId(), request.getPackageSessionId(),
                userDetails);

        log.info("Successfully terminated {} learners", terminatedCount);

        return SubOrgTerminateResponseDTO.builder()
                .terminatedCount(terminatedCount)
                .message("Successfully terminated " + terminatedCount + " learner(s)")
                .build();
    }

    /**
     * Parse a SOFT "last access date". Accepts a bare {@code yyyy-MM-dd} (kept
     * through end-of-day, UTC) or a full ISO-8601 instant. Returns null on blank
     * or unparseable input.
     */
    private java.sql.Timestamp parseAccessTillDate(String raw) {
        if (!StringUtils.hasText(raw)) {
            return null;
        }
        String value = raw.trim();
        try {
            if (value.length() == 10 && value.charAt(4) == '-') {
                java.time.LocalDate day = java.time.LocalDate.parse(value);
                return java.sql.Timestamp.from(
                        day.atTime(java.time.LocalTime.MAX).atZone(java.time.ZoneOffset.UTC).toInstant());
            }
            return java.sql.Timestamp.from(java.time.Instant.parse(value));
        } catch (java.time.format.DateTimeParseException e) {
            log.warn("Ignoring unparseable access_till_date '{}': {}", raw, e.getMessage());
            return null;
        }
    }

    @Transactional(readOnly = true)
    public UserAdminDetailsResponseDTO getAdminDetailsByUserId(String userId) {
        log.info("Fetching admin details for user_id: {}", userId);

        // Find all active mappings where user has ADMIN role
        List<StudentSessionInstituteGroupMapping> adminMappings = mappingRepository
                .findActiveAdminMappingsByUserId(userId, SubOrgRoles.ADMIN.name());

        if (adminMappings.isEmpty()) {
            log.info("No admin mappings found for user_id: {}", userId);
        }

        // Build complete mapping DTOs with sub-org details
        List<StudentSessionMappingWithSubOrgDTO> mappingDTOs = adminMappings.stream()
                .map(this::buildCompleteMappingDTO)
                .toList();

        log.info("Found {} admin mappings for user_id: {}", mappingDTOs.size(), userId);

        return UserAdminDetailsResponseDTO.builder()
                .adminMappings(mappingDTOs)
                .build();
    }

    /**
     * Build complete StudentSessionMappingWithSubOrgDTO from
     * StudentSessionInstituteGroupMapping entity
     */
    private StudentSessionMappingWithSubOrgDTO buildCompleteMappingDTO(StudentSessionInstituteGroupMapping mapping) {
        // Build sub-org (institute) details
        Institute subOrg = mapping.getSubOrg();
        InstituteBasicDTO subOrgDto = null;
        if (subOrg != null) {
            subOrgDto = InstituteBasicDTO.builder()
                    .instituteId(subOrg.getId())
                    .instituteName(subOrg.getInstituteName())
                    .instituteCode(subOrg.getSubdomain())
                    .email(subOrg.getEmail())
                    .mobileNumber(subOrg.getMobileNumber())
                    .address(subOrg.getAddress())
                    .city(subOrg.getCity())
                    .state(subOrg.getState())
                    .country(subOrg.getCountry())
                    .build();
        }

        return StudentSessionMappingWithSubOrgDTO.builder()
                .id(mapping.getId())
                .userId(mapping.getUserId())
                .instituteEnrolledNumber(mapping.getInstituteEnrolledNumber())
                .enrolledDate(mapping.getEnrolledDate())
                .inviteCode(getUserPlanId(mapping.getUserPlanId()))
                .expiryDate(mapping.getExpiryDate())
                .status(mapping.getStatus())
                .createdAt(mapping.getCreatedAt())
                .updatedAt(mapping.getUpdatedAt())
                .groupId(mapping.getGroup() != null ? mapping.getGroup().getId() : null)
                .instituteId(mapping.getInstitute() != null ? mapping.getInstitute().getId() : null)
                .packageSessionId(mapping.getPackageSession() != null ? mapping.getPackageSession().getId() : null)
                .destinationPackageSessionId(
                        mapping.getDestinationPackageSession() != null ? mapping.getDestinationPackageSession().getId()
                                : null)
                .userPlanId(mapping.getUserPlanId())
                .typeId(mapping.getTypeId())
                .type(mapping.getType())
                .source(mapping.getSource())
                .desiredLevelId(mapping.getDesiredLevelId())
                .desiredPackageId(mapping.getDesiredPackageId())
                .automatedCompletionCertificateFileId(mapping.getAutomatedCompletionCertificateFileId())
                .subOrgId(subOrg != null ? subOrg.getId() : null)
                .commaSeparatedOrgRoles(mapping.getCommaSeparatedOrgRoles())
                .subOrgDetails(subOrgDto)
                .packageName(
                        mapping.getPackageSession() != null && mapping.getPackageSession().getPackageEntity() != null
                                ? mapping.getPackageSession().getPackageEntity().getPackageName()
                                : null)
                .levelName(mapping.getPackageSession() != null && mapping.getPackageSession().getLevel() != null
                        ? mapping.getPackageSession().getLevel().getLevelName()
                        : null)
                .sessionName(mapping.getPackageSession() != null && mapping.getPackageSession().getSession() != null
                        ? mapping.getPackageSession().getSession().getSessionName()
                        : null)
                .build();
    }

    private String getUserPlanId(String userPlanId){
        if (userPlanId == null) {
            return null;
        }
        return userPlanRepository.findInviteCodeByUserPlanId(userPlanId).orElse(null);
    }

    @Async
    private void triggerTerminationWorkflow(List<String> userIds, String instituteId, String packageSessionId,
            CustomUserDetails userDetails) {
        List<UserDTO> userDTOS = authService.getUsersFromAuthServiceByUserIds(userIds);
        UserDTO admin = authService.getUsersFromAuthServiceByUserIds(List.of(userDetails.getUserId())).get(0);
        Optional<PackageSession> optionalPackageSession = packageSessionRepository.findById(packageSessionId);
        if (optionalPackageSession.isEmpty()) {
            throw new VacademyException("PackageSession Not found");
        }
        for (UserDTO userDTO : userDTOS) {
            Map<String, Object> contextData = new HashMap<>();
            contextData.put("member", userDTO);
            contextData.put("packageSessionIds", packageSessionId);
            contextData.put("admin", admin);
            contextData.put("packageId", optionalPackageSession.get().getPackageEntity().getId());
            workflowTriggerService.handleTriggerEvents(WorkflowTriggerEvent.SUB_ORG_MEMBER_TERMINATION.name(),
                    packageSessionId, instituteId, contextData);
        }
    }

    @Async
    public void triggerEnrollmentWorkflow(String instituteId, UserDTO userDTO, String packageSessionId,
            String subOrgId, UserDTO enrolledBy) {
        Optional<PackageSession> optionalPackageSession = packageSessionRepository.findById(packageSessionId);
        if (optionalPackageSession.isEmpty()) {
            throw new VacademyException("PackageSession Not found");
        }
        // May a workflow overwrite an existing LMS account's password for this enrolment?
        // Resolved course-then-institute (defaults false) so the staff/add-member path carries the
        // same lmsEditExistingUser flag the batch path already sets. Best-effort — a read failure
        // must not stop the enrolment, and false leaves the existing account untouched.
        boolean mayEditExistingLmsUser = false;
        try {
            mayEditExistingLmsUser = lmsExistingUserEditPolicyService.mayEditExistingUser(
                    instituteId, optionalPackageSession.get().getPackageEntity().getId());
        } catch (Exception e) {
            log.warn("Could not resolve lmsEditExistingUser for institute {} / package {} — defaulting to false: {}",
                    instituteId, optionalPackageSession.get().getPackageEntity().getId(), e.getMessage());
        }
        // The sub-org's OWN leader, not whoever clicked enroll — see the javadoc on
        // SubOrgMemberEnrollmentContext.build. This route is NOT only used by a practice admin
        // adding their own staff: a Vet Education platform admin adds members on a practice's
        // behalf, and their email resolves to no LearnDash group at all (get-leader-group 404s),
        // so nt_vet_add_mem_03_find_leader_group failed and the member was never added to the
        // practice group. Resolving the leader from the sub-org fixes that; a null leader makes
        // the practice-group nodes skip, which beats filing someone under the wrong practice.
        UserDTO subOrgLeader = resolveSubOrgLeader(subOrgId, packageSessionId);
        // Built centrally so this route and bulk/v3/assign publish an identical context —
        // see SubOrgMemberEnrollmentContext for why 'user' is published alongside 'member'.
        Map<String, Object> contextData = SubOrgMemberEnrollmentContext.build(
                userDTO, subOrgLeader, enrolledBy, optionalPackageSession.get(), mayEditExistingLmsUser);
        workflowTriggerService.handleTriggerEvents(WorkflowTriggerEvent.SUB_ORG_MEMBER_ENROLLMENT.name(),
                packageSessionId, instituteId, contextData);
    }

    /**
     * The sub-org's own leader — the practice admin whose email owns the practice's LearnDash
     * group. Workflow nodes resolve that group with
     * {@code get-leader-group?email=#ctx['subOrgAdmin']['email']}, so this must never be the
     * acting platform admin.
     *
     * <p>Prefers the ROOT_ADMIN mapping for this batch and falls back to any active admin of the
     * sub-org. Returns null when the sub-org has no resolvable leader: the practice-group nodes
     * then skip, which is deliberate — no group beats the wrong group. Mirrors
     * {@code BulkAssignmentService.resolveSubOrgLeader}, the other publisher of this event.
     */
    private UserDTO resolveSubOrgLeader(String subOrgId, String packageSessionId) {
        if (!StringUtils.hasText(subOrgId)) {
            return null;
        }
        try {
            String leaderUserId = mappingRepository
                    .findRootAdminMappingBySubOrgAndPackageSession(subOrgId, packageSessionId)
                    .map(StudentSessionInstituteGroupMapping::getUserId)
                    .orElse(null);

            if (!StringUtils.hasText(leaderUserId)) {
                List<String> adminIds = mappingRepository.findActiveAdminUserIdsBySubOrg(subOrgId);
                leaderUserId = (adminIds == null || adminIds.isEmpty()) ? null : adminIds.get(0);
            }

            if (!StringUtils.hasText(leaderUserId)) {
                log.warn("No leader found for sub-org {} — SUB_ORG_MEMBER_ENROLLMENT will carry a "
                        + "null subOrgAdmin, so practice-group nodes will skip rather than enroll "
                        + "into the wrong group", subOrgId);
                return null;
            }

            List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(List.of(leaderUserId));
            return (users == null || users.isEmpty()) ? null : users.get(0);
        } catch (Exception e) {
            log.warn("Failed to resolve leader for sub-org {}: {}", subOrgId, e.getMessage());
            return null;
        }
    }

    private String findRootAdminPlanId(String subOrgId, String packageSessionId) {
        Optional<StudentSessionInstituteGroupMapping> rootAdminMappingOpt = mappingRepository
                .findRootAdminMappingBySubOrgAndPackageSession(subOrgId, packageSessionId);

        if (rootAdminMappingOpt.isEmpty()) {
            log.warn("No ROOT_ADMIN mapping found for sub_org_id: {}, package_session_id: {} - skipping validation",
                    subOrgId, packageSessionId);
            return null;
        }

        StudentSessionInstituteGroupMapping rootAdminMapping = rootAdminMappingOpt.get();
        return rootAdminMapping.getUserPlanId();

    }

    private void validateMemberCountLimit(String subOrgId, String packageSessionId) {
        String userPlanId = findRootAdminPlanId(subOrgId, packageSessionId);
        if (userPlanId == null) {
            log.warn("ROOT_ADMIN mapping has no user_plan_id for batch {} - skipping validation",
                    packageSessionId);
            return;
        }

        log.info("Found ROOT_ADMIN mapping with user_plan_id: {} for batch {}", userPlanId, packageSessionId);

        // Step 2: Get UserPlan by ID
        Optional<UserPlan> userPlanOpt = userPlanRepository.findById(userPlanId);

        if (userPlanOpt.isEmpty()) {
            log.warn("UserPlan not found for id: {} - skipping validation", userPlanId);
            return;
        }

        UserPlan userPlan = userPlanOpt.get();
        PaymentPlan paymentPlan = userPlan.getPaymentPlan();

        if (paymentPlan == null) {
            log.warn("No PaymentPlan found for UserPlan: {} - skipping validation", userPlan.getId());
            return;
        }

        Integer memberCountLimit = paymentPlan.getMemberCount();

        if (memberCountLimit == null) {
            log.info("No member_count limit set for payment_plan: {} - allowing unlimited enrollment",
                    paymentPlan.getId());
            return;
        }

        // Step 3: Count current ACTIVE members in this batch
        long currentMemberCount = mappingRepository.countBySubOrgIdAndPackageSessionIdAndStatus(
                subOrgId,
                packageSessionId,
                LearnerSessionStatusEnum.ACTIVE.name());

        log.info("Batch quota - Current: {}, Limit: {}, UserPlan: {}",
                currentMemberCount, memberCountLimit, userPlanId);

        // Step 4: Validate limit not exceeded
        if (currentMemberCount >= memberCountLimit) {
            throw new VacademyException(
                    String.format("Member limit exceeded for this batch. " +
                            "Current members: %d, Maximum allowed: %d. " +
                            "Please contact ROOT_ADMIN to upgrade the plan.",
                            currentMemberCount, memberCountLimit));
        }

        log.info("Validation passed. {} seats remaining for this batch.",
                (memberCountLimit - currentMemberCount - 1));
    }

    /**
     * Creates an individual UserPlan for a sub-org learner, linked to the scoped FREE invite.
     * Falls back to rootAdminPlanId if no scoped invite exists.
     *
     * The sub-org's admin-level CPO does NOT cascade to learners — that's an institute↔admin
     * finance agreement only. Learners default to the scoped FREE invite; if the admin wants
     * a different per-learner payment option (CPO/ONE_TIME/...), it's applied later in
     * {@link #applyLearnerPaymentOptionOverrideIfRequested}.
     */
    private String createLearnerUserPlan(String userId, String subOrgId, String packageSessionId) {
        Optional<EnrollInvite> scopedInviteOpt = enrollInviteRepository
                .findScopedInviteForSubOrgAndPackageSession(subOrgId, packageSessionId);

        if (scopedInviteOpt.isEmpty()) {
            log.warn("No scoped FREE invite found for sub-org={}, ps={}. Falling back to rootAdminPlanId.",
                    subOrgId, packageSessionId);
            return findRootAdminPlanId(subOrgId, packageSessionId);
        }

        EnrollInvite scopedInvite = scopedInviteOpt.get();

        UserPlan learnerPlan = new UserPlan();
        learnerPlan.setUserId(userId);
        learnerPlan.setSource(UserPlanSourceEnum.SUB_ORG.name());
        learnerPlan.setSubOrgId(subOrgId);
        learnerPlan.setStatus(UserPlanStatusEnum.ACTIVE.name());
        learnerPlan.setStartDate(new Date());
        learnerPlan.setEnrollInviteId(scopedInvite.getId());

        try {
            var inviteMappings = packageSessionEnrollInviteToPaymentOptionService
                    .findByInvite(scopedInvite);
            for (var mapping : inviteMappings) {
                if (mapping.getPaymentOption() != null) {
                    learnerPlan.setPaymentOptionId(mapping.getPaymentOption().getId());
                    if (mapping.getPaymentOption().getPaymentPlans() != null
                            && !mapping.getPaymentOption().getPaymentPlans().isEmpty()) {
                        PaymentPlan plan = mapping.getPaymentOption().getPaymentPlans().get(0);
                        learnerPlan.setPaymentPlanId(plan.getId());
                        if (plan.getValidityInDays() != null) {
                            Calendar cal = Calendar.getInstance();
                            cal.add(Calendar.DAY_OF_YEAR, plan.getValidityInDays());
                            learnerPlan.setEndDate(cal.getTime());
                        }
                    }
                    break;
                }
            }
        } catch (Exception e) {
            log.warn("Could not resolve PaymentPlan from scoped invite: {}", e.getMessage());
        }

        learnerPlan = userPlanRepository.save(learnerPlan);
        log.info("Created individual UserPlan id={} for learner={} in sub-org={}",
                learnerPlan.getId(), userId, subOrgId);
        return learnerPlan.getId();
    }

    /**
     * Creates a student_sub_org junction entry if one doesn't already exist.
     */
    private void createStudentSubOrgEntry(String userId, Institute subOrg, String orgRoles) {
        Optional<StudentSubOrg> existing = studentSubOrgRepository
                .findByUserIdAndSubOrgId(userId, subOrg.getId());
        if (existing.isPresent()) {
            log.info("student_sub_org entry already exists for user={}, sub-org={}", userId, subOrg.getId());
            return;
        }

        // Find student record
        Optional<Student> studentOpt = instituteStudentRepository.findTopByUserIdOrderByCreatedAtDesc(userId);
        String studentId = studentOpt.map(Student::getId).orElse(userId);

        String linkType = StudentSubOrgLinkType.DIRECT.name();
        StudentSubOrg entry = new StudentSubOrg(studentId, userId, subOrg, linkType);
        studentSubOrgRepository.save(entry);
        log.info("Created student_sub_org entry for user={}, sub-org={}, linkType={}",
                userId, subOrg.getId(), linkType);
    }

    /**
     * Check if the roles string contains ADMIN or ROOT_ADMIN
     */
    private boolean isAdminRole(String commaSeparatedOrgRoles) {
        if (!StringUtils.hasText(commaSeparatedOrgRoles)) return false;
        String upper = commaSeparatedOrgRoles.toUpperCase();
        return upper.contains(SubOrgRoles.ADMIN.name()) || upper.contains(SubOrgRoles.ROOT_ADMIN.name());
    }

    /**
     * Creates FSPSSM entries for a sub-org admin:
     * - One entry with access_type = PACKAGE_SESSION (always)
     * - One entry per SUBORG_LEARNER invite with access_type = ENROLL_INVITE (auto-discovered via sub_org_id)
     */
    private void syncFacultyMappingForSubOrgAdmin(UserDTO user, String packageSessionId,
                                                   String subOrgId, String orgRoles,
                                                   String accessPermission) {
        // Caller resolves the CSV; we only guard against empty so a stray null/blank
        // doesn't write an empty access_permission column.
        String effectivePermission = StringUtils.hasText(accessPermission) ? accessPermission : "FULL";

        // 1. PACKAGE_SESSION entry
        AddUserAccessDTO psAccessDTO = AddUserAccessDTO.builder()
                .userId(user.getId())
                .packageSessionId(packageSessionId)
                .name(user.getFullName())
                .status("ACTIVE")
                .userType(orgRoles)
                .accessType("PACKAGE_SESSION")
                .accessId(packageSessionId)
                .accessPermission(effectivePermission)
                .linkageType("SUB_ORG")
                .suborgId(subOrgId)
                .build();
        facultyService.grantUserAccess(psAccessDTO);
        log.info("Synced FSPSSM (PACKAGE_SESSION) user={}, PS={}, subOrg={}, perm={}",
                user.getId(), packageSessionId, subOrgId, effectivePermission);

        // 2. ENROLL_INVITE entries — auto-discover invites with sub_org_id for this PS
        try {
            List<String> inviteIds = enrollInviteRepository
                    .findInviteIdsForSubOrgAndPackageSession(subOrgId, packageSessionId);
            for (String inviteId : inviteIds) {
                AddUserAccessDTO inviteAccessDTO = AddUserAccessDTO.builder()
                        .userId(user.getId())
                        .packageSessionId(packageSessionId)
                        .name(user.getFullName())
                        .status("ACTIVE")
                        .userType(orgRoles)
                        .accessType("ENROLL_INVITE")
                        .accessId(inviteId)
                        .accessPermission(effectivePermission)
                        .linkageType("SUB_ORG")
                        .suborgId(subOrgId)
                        .build();
                facultyService.grantUserAccess(inviteAccessDTO);
            }
            if (!inviteIds.isEmpty()) {
                log.info("Synced {} FSPSSM (ENROLL_INVITE) entries for user={}, subOrg={}, PS={}",
                        inviteIds.size(), user.getId(), subOrgId, packageSessionId);
            }
        } catch (Exception e) {
            log.warn("Could not sync ENROLL_INVITE FSPSSM for subOrg={}, PS={}: {}", subOrgId, packageSessionId, e.getMessage());
        }
    }

    @Transactional(readOnly = true)
    public SubOrgAdminsResponseDTO getSubOrgAdmins(String userId, String packageSessionId, String subOrgId) {
        log.info("Fetching admins for packageSessionId: {}, subOrgId: {}", packageSessionId, subOrgId);

        // Query the database for admins
        List<Object[]> adminResults = mappingRepository.findAdminsByPackageSessionAndSubOrg(packageSessionId, subOrgId,
                userId);

        // Map results to DTOs
        List<AdminDetailsDTO> admins = adminResults.stream()
                .map(result -> AdminDetailsDTO.builder()
                        .userId((String) result[0])
                        .name((String) result[1])
                        .role(SubOrgRoles.ADMIN.name())
                        .build())
                .collect(Collectors.toList());

        log.info("Found {} admins for packageSessionId: {}, subOrgId: {}", admins.size(), packageSessionId, subOrgId);

        return SubOrgAdminsResponseDTO.builder()
                .userId(userId)
                .packageSessionId(packageSessionId)
                .subOrgId(subOrgId)
                .admins(admins)
                .totalAdmins(admins.size())
                .build();
    }

    @Transactional(readOnly = true)
    public SubOrgAdminsResponseDTO getAllAdminsBySubOrg(String subOrgId) {
        log.info("Fetching all admins for subOrgId: {}", subOrgId);

        List<Object[]> adminResults = mappingRepository.findAdminsBySubOrg(subOrgId);

        List<AdminDetailsDTO> admins = adminResults.stream()
                .map(result -> AdminDetailsDTO.builder()
                        .userId((String) result[0])
                        .name((String) result[1])
                        .role((String) result[2])
                        .build())
                .collect(Collectors.toList());

        log.info("Found {} admins for subOrgId: {}", admins.size(), subOrgId);

        return SubOrgAdminsResponseDTO.builder()
                .subOrgId(subOrgId)
                .admins(admins)
                .totalAdmins(admins.size())
                .build();
    }

    /**
     * Sub-organizations already present in an org-associated package session, each with its own
     * contact details and its admins (name + email).
     *
     * <p>Feeds the sub-org step of the admin enroll wizard. The set is scoped to the package
     * session rather than the whole institute so the admin only sees organizations that actually
     * belong to the batch they are enrolling into.
     *
     * <p>Includes INACTIVE/TERMINATED mappings when locating sub-orgs — an organization whose only
     * members have lapsed still exists and must remain pickable — but only ACTIVE members count
     * toward {@code memberCount}'s admin list.
     */
    @Transactional(readOnly = true)
    public List<PackageSessionSubOrgDTO> getSubOrgsByPackageSession(String packageSessionId) {
        List<String> statuses = List.of(
                LearnerSessionStatusEnum.ACTIVE.name(),
                LearnerSessionStatusEnum.INACTIVE.name(),
                LearnerSessionStatusEnum.TERMINATED.name());

        List<Object[]> rows = mappingRepository.findSubOrgsByPackageSession(packageSessionId, statuses);
        if (rows.isEmpty()) {
            return List.of();
        }

        List<String> subOrgIds = rows.stream()
                .map(r -> r[0] != null ? String.valueOf(r[0]) : null)
                .filter(Objects::nonNull)
                .distinct()
                .collect(Collectors.toList());

        Map<String, List<AdminDetailsDTO>> adminsBySubOrg = new HashMap<>();
        for (Object[] admin : mappingRepository.findAdminsBySubOrgIds(subOrgIds)) {
            if (admin[0] == null) {
                continue;
            }
            adminsBySubOrg
                    .computeIfAbsent(String.valueOf(admin[0]), k -> new ArrayList<>())
                    .add(AdminDetailsDTO.builder()
                            .userId(admin[1] != null ? String.valueOf(admin[1]) : null)
                            .name(admin[2] != null ? String.valueOf(admin[2]) : null)
                            .email(admin[3] != null ? String.valueOf(admin[3]) : null)
                            .role(admin[4] != null ? String.valueOf(admin[4]) : null)
                            .build());
        }

        return rows.stream()
                .filter(r -> r[0] != null)
                .map(r -> {
                    String subOrgId = String.valueOf(r[0]);
                    return PackageSessionSubOrgDTO.builder()
                            .subOrgId(subOrgId)
                            .name(r[1] != null ? String.valueOf(r[1]) : null)
                            .email(r[2] != null ? String.valueOf(r[2]) : null)
                            .mobileNumber(r[3] != null ? String.valueOf(r[3]) : null)
                            .memberCount(r[4] != null ? ((Number) r[4]).longValue() : 0L)
                            .admins(adminsBySubOrg.getOrDefault(subOrgId, List.of()))
                            .build();
                })
                .collect(Collectors.toList());
    }
}
