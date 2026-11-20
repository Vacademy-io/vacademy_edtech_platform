package vacademy.io.admin_core_service.features.admission.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.admission.dto.AdmissionRequestDTO;
import vacademy.io.admin_core_service.features.admission.dto.AdmissionResponseDTO;
import vacademy.io.admin_core_service.features.applicant.entity.ApplicantStage;
import vacademy.io.admin_core_service.features.applicant.entity.Applicant;
import vacademy.io.admin_core_service.features.applicant.entity.ApplicationStage;
import vacademy.io.admin_core_service.features.applicant.repository.ApplicantRepository;
import vacademy.io.admin_core_service.features.applicant.repository.ApplicantStageRepository;
import vacademy.io.admin_core_service.features.applicant.repository.ApplicationStageRepository;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.common.entity.CustomFieldValues;
import vacademy.io.admin_core_service.features.common.repository.CustomFieldValuesRepository;
import vacademy.io.admin_core_service.features.common.repository.InstituteCustomFieldRepository;
import vacademy.io.admin_core_service.features.enquiry.entity.Enquiry;
import vacademy.io.admin_core_service.features.enquiry.repository.EnquiryRepository;
import vacademy.io.admin_core_service.features.institute.entity.Template;
import vacademy.io.admin_core_service.features.institute.repository.TemplateRepository;
import vacademy.io.admin_core_service.features.institute_learner.entity.Student;
import vacademy.io.admin_core_service.features.institute_learner.repository.InstituteStudentRepository;
import vacademy.io.admin_core_service.features.notification.dto.NotificationTemplateVariables;
import vacademy.io.admin_core_service.features.notification.entity.NotificationEventConfig;
import vacademy.io.admin_core_service.features.notification.enums.NotificationEventType;
import vacademy.io.admin_core_service.features.notification.enums.NotificationSourceType;
import vacademy.io.admin_core_service.features.notification.enums.NotificationTemplateType;
import vacademy.io.admin_core_service.features.notification.repository.NotificationEventConfigRepository;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.admin_core_service.features.notification_service.service.SendUniqueLinkService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.common.notification.dto.GenericEmailRequest;

import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.*;
import vacademy.io.common.auth.dto.ParentWithChildDTO;

@Service
public class AdmissionService {

    private static final Logger logger = LoggerFactory.getLogger(AdmissionService.class);

    @Autowired
    private AuthService authService;

    @Autowired
    private InstituteStudentRepository instituteStudentRepository;

    @Autowired
    private ApplicantRepository applicantRepository;

    @Autowired
    private ApplicantStageRepository applicantStageRepository;

    @Autowired
    private ApplicationStageRepository applicationStageRepository;

    @Autowired
    private AudienceResponseRepository audienceResponseRepository;

    @Autowired
    private CustomFieldValuesRepository customFieldValuesRepository;

    @Autowired
    private InstituteCustomFieldRepository instituteCustomFieldRepository;

    @Autowired
    private NotificationService notificationService;

    @Autowired
    private SendUniqueLinkService sendUniqueLinkService;

    @Autowired
    private NotificationEventConfigRepository notificationEventConfigRepository;

    @Autowired
    private TemplateRepository templateRepository;

    @Autowired
    private EnquiryRepository enquiryRepository;

    @Autowired
    private InstituteRepository instituteRepository;

    @Autowired
    private vacademy.io.admin_core_service.features.admission.service.AdmissionPipelineService admissionPipelineService;

    @Transactional
    public AdmissionResponseDTO submitAdmissionForm(AdmissionRequestDTO request, CustomUserDetails userDetails) {
        logger.info("Processing Admission Form for Institute: {}, Source: {}, SourceId: {}",
                request.getInstituteId(), request.getSource(), request.getSourceId());

        boolean hasApplication = request.getApplicationId() != null && !request.getApplicationId().isBlank();
        boolean hasEnquiry = request.getEnquiryId() != null && !request.getEnquiryId().isBlank();

        if (hasApplication) {
            return handleAdmissionFromApplication(request);
        } else if (hasEnquiry) {
            return handleAdmissionFromEnquiry(request);
        } else {
            return handleFreshAdmission(request);
        }
    }

    // ========================================================================
    // PATH 1: Fresh Admission (no enquiry_id, no application_id)
    // ========================================================================
    private AdmissionResponseDTO handleFreshAdmission(AdmissionRequestDTO request) {
        UserManagementResult userResult = handleUserCreation(request);

        Student student = createStudentProfile(userResult.childUser(), request);
        saveCustomFieldValues(request.getCustomFieldValues(), student.getId(), request.getInstituteId());

        AudienceResponse ar = handleAudienceResponse(request, userResult.parentUser(), userResult.childUser(), student);

        Applicant applicant = handleApplicantAndStage(request, ar, userResult.parentUser());

        sendAdmissionWelcomeEmail(userResult.parentUser(), userResult.childUser(), userResult.sendCredentials(),
                userResult.password(), request.getInstituteId(),
                applicant != null ? applicant.getApplicationStageId() : null);

        // --- NEW: Record Admission in Pipeline ---
        admissionPipelineService.recordAdmission(
                request.getInstituteId(),
                request.getDestinationPackageSessionId() != null ? request.getDestinationPackageSessionId() : request.getSessionId(),
                userResult.parentUser() != null ? userResult.parentUser().getId() : null,
                userResult.childUser() != null ? userResult.childUser().getId() : null,
                null,
                applicant != null && applicant.getId() != null ? applicant.getId().toString() : null,
                request.getSource()
        );

        return AdmissionResponseDTO.builder()
            .applicantId(getApplicantId(applicant))
            .trackingId(getTrackingId(applicant))
            .parentUserId(getUserId(userResult.parentUser()))
            .childUserId(getUserId(userResult.childUser()))
                .parent(toUserSummary(userResult.parentUser()))
                .child(toUserSummary(userResult.childUser()))
                .workflowType("ADMISSION")
                .overallStatus("ADMISSION_INITIATED")
            .currentStageId(getCurrentStageId(applicant))
                .message("Admission processed successfully.")
                .isTransition(false)
                .build();
    }

    // ========================================================================
    // PATH 2: Admission from Enquiry
    // ========================================================================
    private AdmissionResponseDTO handleAdmissionFromEnquiry(AdmissionRequestDTO request) {
        logger.info("Processing admission from enquiry: {}", request.getEnquiryId());

        AudienceResponse ar = audienceResponseRepository.findByEnquiryId(request.getEnquiryId())
                .orElseThrow(() -> new VacademyException(
                        "No audience response found for enquiry_id: " + request.getEnquiryId()));

        UserManagementResult userResult = handleUserCreation(request);

        Student student = createStudentProfile(userResult.childUser(), request);
        saveCustomFieldValues(request.getCustomFieldValues(), student.getId(), request.getInstituteId());

        ar.setOverallStatus("ADMISSION");
        ar.setStudentUserId(userResult.childUser().getId());
        ar.setUserId(userResult.parentUser().getId());
        ar.setParentName(userResult.parentUser().getFullName());
        ar.setParentEmail(userResult.parentUser().getEmail());
        ar.setParentMobile(userResult.parentUser().getMobileNumber());
        if (request.getDestinationPackageSessionId() != null
                && !request.getDestinationPackageSessionId().isBlank()) {
            ar.setDestinationPackageSessionId(request.getDestinationPackageSessionId());
        }
        audienceResponseRepository.save(ar);

        Applicant applicant = handleApplicantAndStage(request, ar, userResult.parentUser());

        updateEnquiryStatus(request.getEnquiryId());

        sendAdmissionWelcomeEmail(userResult.parentUser(), userResult.childUser(), userResult.sendCredentials(),
                userResult.password(), request.getInstituteId(),
                applicant != null ? applicant.getApplicationStageId() : null);

        // --- NEW: Record Admission in Pipeline ---
        admissionPipelineService.recordAdmission(
                request.getInstituteId(),
                request.getDestinationPackageSessionId() != null ? request.getDestinationPackageSessionId() : request.getSessionId(),
                userResult.parentUser() != null ? userResult.parentUser().getId() : null,
                userResult.childUser() != null ? userResult.childUser().getId() : null,
                request.getEnquiryId(),
                applicant != null && applicant.getId() != null ? applicant.getId().toString() : null,
                request.getSource()
        );

        return AdmissionResponseDTO.builder()
            .applicantId(getApplicantId(applicant))
            .trackingId(getTrackingId(applicant))
            .parentUserId(getUserId(userResult.parentUser()))
            .childUserId(getUserId(userResult.childUser()))
                .parent(toUserSummary(userResult.parentUser()))
                .child(toUserSummary(userResult.childUser()))
                .workflowType("ADMISSION")
                .overallStatus("ADMISSION_INITIATED")
            .currentStageId(getCurrentStageId(applicant))
                .message("Admission from enquiry processed successfully.")
                .isTransition(true)
                .build();
    }

    // ========================================================================
    // PATH 3: Admission from Application
    // ========================================================================
    private AdmissionResponseDTO handleAdmissionFromApplication(AdmissionRequestDTO request) {
        logger.info("Processing admission from application (applicant_id): {}", request.getApplicationId());

        AudienceResponse ar = audienceResponseRepository.findByApplicantId(request.getApplicationId())
                .orElseThrow(() -> new VacademyException(
                        "No audience response found for application_id (applicant): " + request.getApplicationId()));

        Applicant applicant = applicantRepository.findById(UUID.fromString(request.getApplicationId()))
                .orElseThrow(() -> new VacademyException(
                        "No applicant found for application_id: " + request.getApplicationId()));

        UserDTO parentUser = resolveExistingParent(ar);
        UserDTO childUser = resolveExistingChild(ar);

        Student student = updateExistingStudentProfile(ar.getStudentUserId(), request);
        saveCustomFieldValues(request.getCustomFieldValues(), student.getId(), request.getInstituteId());

        ar.setOverallStatus("ADMISSION");
        if (request.getDestinationPackageSessionId() != null
                && !request.getDestinationPackageSessionId().isBlank()) {
            ar.setDestinationPackageSessionId(request.getDestinationPackageSessionId());
        }
        audienceResponseRepository.save(ar);

        ApplicationStage admissionStage = applicationStageRepository
                .findFirstStage(request.getInstituteId(), request.getSource(), request.getSourceId(), "ADMISSION")
                .orElseThrow(() -> new VacademyException(
                        "No ADMISSION stage configured for this institute/source. Please configure it first."));

        applicant.setWorkflowType("ADMISSION");
        applicant.setOverallStatus("ADMISSION_INITIATED");
        applicant.setApplicationStageId(admissionStage.getId().toString());
        applicant.setApplicationStageStatus("INITIATED");
        applicant = applicantRepository.save(applicant);

        String configJson = admissionStage.getConfigJson();
        if (configJson == null || configJson.isEmpty()) {
            configJson = "{}";
        }
        ApplicantStage applicantStage = ApplicantStage.builder()
                .applicantId(applicant.getId().toString())
                .stageId(admissionStage.getId().toString())
                .stageStatus("COMPLETED")
                .responseJson(configJson)
                .build();
        applicantStageRepository.save(applicantStage);

        applicant.setApplicationStageStatus("COMPLETED");
        applicant.setOverallStatus("ADMISSION_COMPLETED");
        applicant = applicantRepository.save(applicant);

        sendAdmissionWelcomeEmail(parentUser, childUser, false, null, request.getInstituteId(),
                admissionStage.getId().toString());

        // --- NEW: Record Admission in Pipeline ---
        admissionPipelineService.recordAdmission(
                request.getInstituteId(),
                request.getDestinationPackageSessionId() != null ? request.getDestinationPackageSessionId() : request.getSessionId(),
                parentUser != null ? parentUser.getId() : null,
                childUser != null ? childUser.getId() : null,
                ar.getEnquiryId(),
                applicant != null && applicant.getId() != null ? applicant.getId().toString() : null,
                request.getSource()
        );

        return AdmissionResponseDTO.builder()
                .applicantId(getApplicantId(applicant))
                .trackingId(getTrackingId(applicant))
                .parentUserId(getUserId(parentUser))
                .childUserId(getUserId(childUser))
                .parent(toUserSummary(parentUser))
                .child(toUserSummary(childUser))
                .workflowType("ADMISSION")
                .overallStatus("ADMISSION_COMPLETED")
                .currentStageId(getCurrentStageId(applicant))
                .message("Admission from application processed successfully.")
                .isTransition(true)
                .build();
    }

    private String getApplicantId(Applicant applicant) {
        if (applicant == null || applicant.getId() == null) {
            return null;
        }
        return applicant.getId().toString();
    }

    private String getTrackingId(Applicant applicant) {
        if (applicant == null) {
            return null;
        }
        return applicant.getTrackingId();
    }

    private String getCurrentStageId(Applicant applicant) {
        if (applicant == null) {
            return null;
        }
        return applicant.getApplicationStageId();
    }

    private String getUserId(UserDTO user) {
        if (user == null) {
            return null;
        }
        return user.getId();
    }

    private AdmissionResponseDTO.UserSummaryDTO toUserSummary(UserDTO user) {
        if (user == null) {
            return null;
        }
        return AdmissionResponseDTO.UserSummaryDTO.builder()
                .id(user.getId())
                .fullName(user.getFullName())
                .email(user.getEmail())
                .phone(user.getMobileNumber())
                .build();
    }

    // ========================================================================
    // Helpers for from-application path
    // ========================================================================

    private UserDTO resolveExistingParent(AudienceResponse ar) {
        if (ar.getUserId() == null) {
            throw new VacademyException("Audience response has no linked parent user_id.");
        }
        try {
            List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(List.of(ar.getUserId()));
            if (users != null && !users.isEmpty()) return users.get(0);
        } catch (Exception e) {
            logger.warn("Could not fetch parent user {} from auth service: {}", ar.getUserId(), e.getMessage());
        }
        UserDTO fallback = new UserDTO();
        fallback.setId(ar.getUserId());
        fallback.setFullName(ar.getParentName());
        fallback.setEmail(ar.getParentEmail());
        fallback.setMobileNumber(ar.getParentMobile());
        return fallback;
    }

    private UserDTO resolveExistingChild(AudienceResponse ar) {
        if (ar.getStudentUserId() == null) {
            throw new VacademyException("Audience response has no linked student_user_id.");
        }
        try {
            List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(List.of(ar.getStudentUserId()));
            if (users != null && !users.isEmpty()) return users.get(0);
        } catch (Exception e) {
            logger.warn("Could not fetch child user {} from auth service: {}", ar.getStudentUserId(), e.getMessage());
        }
        UserDTO fallback = new UserDTO();
        fallback.setId(ar.getStudentUserId());
        return fallback;
    }

    private Student updateExistingStudentProfile(String studentUserId, AdmissionRequestDTO req) {
        Student student = instituteStudentRepository.findTopByUserId(studentUserId)
                .orElseThrow(() -> new VacademyException(
                        "No student record found for student_user_id: " + studentUserId));

        String fullName = buildFullName(req.getFirstName(), req.getLastName());
        if (!fullName.isBlank()) student.setFullName(fullName);
        if (req.getGender() != null && !req.getGender().isBlank()) student.setGender(req.getGender());
        if (req.getClassApplyingFor() != null && !req.getClassApplyingFor().isBlank())
            student.setApplyingForClass(req.getClassApplyingFor());
        if (req.getAdmissionNo() != null && !req.getAdmissionNo().isBlank())
            student.setAdmissionNo(req.getAdmissionNo());
        if (req.getDateOfAdmission() != null && !req.getDateOfAdmission().isBlank())
            student.setDateOfAdmission(parseDate(req.getDateOfAdmission()));
        if (req.getDateOfBirth() != null && !req.getDateOfBirth().isBlank())
            student.setDateOfBirth(parseDate(req.getDateOfBirth()));
        if (req.getMobileNumber() != null && !req.getMobileNumber().isBlank())
            student.setMobileNumber(req.getMobileNumber());
        if (req.getAdmissionType() != null && !req.getAdmissionType().isBlank())
            student.setAdmissionType(req.getAdmissionType());
        if (req.getStudentAadhaar() != null && !req.getStudentAadhaar().isBlank()) {
            student.setIdNumber(req.getStudentAadhaar());
            student.setIdType("AADHAAR");
        }
        if (req.getPreviousSchoolName() != null && !req.getPreviousSchoolName().isBlank())
            student.setPreviousSchoolName(req.getPreviousSchoolName());
        if (req.getPreviousClass() != null && !req.getPreviousClass().isBlank())
            student.setLastClassAttended(req.getPreviousClass());
        if (req.getPreviousBoard() != null && !req.getPreviousBoard().isBlank())
            student.setPreviousSchoolBoard(req.getPreviousBoard());
        if (req.getPreviousPercentage() != null && !req.getPreviousPercentage().isBlank())
            student.setLastExamResult(req.getPreviousPercentage());
        if (req.getMotherTongue() != null && !req.getMotherTongue().isBlank())
            student.setMotherTongue(req.getMotherTongue());
        if (req.getBloodGroup() != null && !req.getBloodGroup().isBlank())
            student.setBloodGroup(req.getBloodGroup());
        if (req.getNationality() != null && !req.getNationality().isBlank())
            student.setNationality(req.getNationality());
        if (req.getFatherName() != null && !req.getFatherName().isBlank())
            student.setFatherName(req.getFatherName());
        if (req.getFatherMobile() != null && !req.getFatherMobile().isBlank())
            student.setParentsMobileNumber(req.getFatherMobile());
        if (req.getFatherEmail() != null && !req.getFatherEmail().isBlank())
            student.setParentsEmail(req.getFatherEmail());
        if (req.getMotherName() != null && !req.getMotherName().isBlank())
            student.setMotherName(req.getMotherName());
        if (req.getMotherMobile() != null && !req.getMotherMobile().isBlank())
            student.setParentToMotherMobileNumber(req.getMotherMobile());
        if (req.getMotherEmail() != null && !req.getMotherEmail().isBlank())
            student.setParentsToMotherEmail(req.getMotherEmail());
        if (req.getGuardianName() != null && !req.getGuardianName().isBlank())
            student.setGuardianName(req.getGuardianName());
        if (req.getGuardianMobile() != null && !req.getGuardianMobile().isBlank())
            student.setGuardianMobile(req.getGuardianMobile());
        if (req.getGuardianEmail() != null && !req.getGuardianEmail().isBlank())
            student.setGuardianEmail(req.getGuardianEmail());
        if (req.getCurrentAddress() != null && !req.getCurrentAddress().isBlank())
            student.setAddressLine(req.getCurrentAddress());
        if (req.getCurrentLocality() != null && !req.getCurrentLocality().isBlank())
            student.setCity(req.getCurrentLocality());
        if (req.getCurrentPinCode() != null && !req.getCurrentPinCode().isBlank())
            student.setPinCode(req.getCurrentPinCode());

        return instituteStudentRepository.save(student);
    }

    private void updateEnquiryStatus(String enquiryId) {
        try {
            Optional<Enquiry> enquiryOpt = enquiryRepository.findById(UUID.fromString(enquiryId));
            if (enquiryOpt.isPresent()) {
                Enquiry enquiry = enquiryOpt.get();
                enquiry.setConvertionStatus("CONVERTED");
                enquiry.setEnquiryStatus("ADMITTED");
                enquiryRepository.save(enquiry);
                logger.info("Updated enquiry {} status to ADMITTED/CONVERTED", enquiryId);
            } else {
                logger.warn("Enquiry row not found for enquiry_id: {}", enquiryId);
            }
        } catch (Exception e) {
            logger.warn("Could not update enquiry status for enquiry_id: {} - {}", enquiryId, e.getMessage());
        }
    }

    // --- Helper Methods ---

    private UserManagementResult handleUserCreation(AdmissionRequestDTO request) {
        // Step 1: Check Parent
        UserDTO parentUser = null;
        boolean sendCredentials = false;
        String password = null;

        try {
            // Check existence by Mobile Number
            parentUser = authService.getUserByMobileNumber(request.getFatherMobile());

            if (parentUser == null) {
                // NEW PARENT
                UserDTO parentRequest = new UserDTO();
                parentRequest.setFullName(request.getFatherName());
                parentRequest.setEmail(request.getFatherEmail());
                parentRequest.setMobileNumber(request.getFatherMobile());
                parentRequest.setRoles(java.util.List.of("PARENT"));

                parentUser = authService.createUserFromAuthService(parentRequest, request.getInstituteId(), false);

                if (parentUser.getPassword() != null && !parentUser.getPassword().isEmpty()) {
                    sendCredentials = true;
                    password = parentUser.getPassword();
                    logger.info("New Parent User created: {}", parentUser.getId());
                }
            } else {
                // EXISTING PARENT
                logger.info("Existing Parent User found: {}", parentUser.getId());
                // Fetch password for email inclusion
                UserDTO userWithPass = authService.getUsersFromAuthServiceWithPasswordByUserId(parentUser.getId());
                if (userWithPass != null) {
                    password = userWithPass.getPassword();
                    sendCredentials = true; // Treating as "New Entry" for credentials
                }
            }

        } catch (Exception e) {
            throw new VacademyException("Failed to manage parent user: " + e.getMessage());
        }

        // Step 2: Check duplicate BEFORE creating child user
        String childName = buildFullName(request.getFirstName(), request.getLastName());
        String parentMobile = request.getFatherMobile();

        // Check 1: Robust check via Auth Service (Parent ID -> Children)
        if (parentUser != null) {
            try {
                List<ParentWithChildDTO> parentChildren = authService
                        .getUsersWithChildren(List.of(parentUser.getId()));

                final UserDTO finalParentUser = parentUser; // Create effectively final variable for lambda

                // Check if any child has the same name (case-insensitive)
                boolean duplicateInAuth = false;
                if (parentChildren != null) {
                    duplicateInAuth = parentChildren.stream()
                            .filter(dto -> dto.getParent() != null
                                    && dto.getParent().getId().equals(finalParentUser.getId()))
                            .map(ParentWithChildDTO::getChild)
                            .filter(Objects::nonNull)
                            .anyMatch(child -> child.getFullName().equalsIgnoreCase(childName));
                }

                if (duplicateInAuth) {
                    throw new VacademyException(
                            "A student named '" + childName + "' is already registered under this parent account.");
                }
            } catch (VacademyException ve) {
                if (ve.getMessage().contains("already registered"))
                    throw ve;
                logger.warn("Auth Service child check failed, proceeding to fallback: {}", ve.getMessage());
            } catch (Exception e) {
                logger.warn("Auth Service child check failed, proceeding to fallback: {}", e.getMessage());
            }
        }

        // Check 2: Fallback check via Student Repository (Mobile + Name)
        // Useful for legacy data or if Auth Service check was skipped/failed
        if (parentMobile != null && !parentMobile.isBlank() && childName != null && !childName.isBlank()) {
            Optional<Student> existingStudent = instituteStudentRepository
                    .findByParentMobileAndChildFullName(parentMobile, childName);
            if (existingStudent.isPresent()) {
                throw new VacademyException(
                        "A student named '" + childName + "' is already admitted under this parent (mobile match).");
            }
        }

        // Step 3: Create Child user (username = mobile if provided, else
        // auto-generated)
        UserDTO childUser = null;
        try {
            UserDTO childRequest = new UserDTO();
            childRequest.setFullName(childName);
            // Use mobile as username if provided; otherwise auto-generate a unique one
            String childUsername = (request.getMobileNumber() != null && !request.getMobileNumber().isBlank())
                    ? request.getMobileNumber()
                    : "stud_" + UUID.randomUUID().toString().replace("-", "").substring(0, 10);
            childRequest.setUsername(childUsername);
            childRequest.setEmail("child_" + UUID.randomUUID().toString().substring(0, 8) + "@vacademy.com");
            childRequest.setRoles(java.util.List.of("STUDENT"));
            childRequest.setLinkedParentId(parentUser.getId());

            childUser = authService.createUserFromAuthService(childRequest, request.getInstituteId(), false);
            logger.info("Child User created: {}", childUser.getId());

        } catch (Exception e) {
            throw new VacademyException("Failed to manage child user: " + e.getMessage());
        }

        return new UserManagementResult(parentUser, childUser, sendCredentials, password);
    }

    private Student createStudentProfile(UserDTO childUser, AdmissionRequestDTO req) {
        Student student = new Student(childUser);
        student.setLinkedInstituteName("Vacademy");

        // --- Screen 1: Student Details (columns present in DB) ---
        student.setGender(req.getGender());
        student.setApplyingForClass(req.getClassApplyingFor());
        student.setAdmissionNo(req.getAdmissionNo());
        student.setDateOfAdmission(parseDate(req.getDateOfAdmission()));
        student.setDateOfBirth(parseDate(req.getDateOfBirth()));
        student.setMobileNumber(req.getMobileNumber());
        student.setAdmissionType(req.getAdmissionType());
        // TODO: restore once V119 migration adds: section, has_transport, student_type,
        // class_group

        // Aadhaar maps to id_number + id_type
        if (req.getStudentAadhaar() != null && !req.getStudentAadhaar().isBlank()) {
            student.setIdNumber(req.getStudentAadhaar());
            student.setIdType("AADHAAR");
        }

        // --- Screen 2: Previous School & Demographics (columns present in DB) ---
        student.setPreviousSchoolName(req.getPreviousSchoolName());
        student.setLastClassAttended(req.getPreviousClass());
        student.setPreviousSchoolBoard(req.getPreviousBoard());
        student.setLastExamResult(req.getPreviousPercentage());
        // student.setCaste(req.getCaste()); // TODO: restore once migration adds caste
        // column
        student.setMotherTongue(req.getMotherTongue());
        student.setBloodGroup(req.getBloodGroup());
        student.setNationality(req.getNationality());
        // TODO: restore once V119 migration adds: year_of_passing,
        // previous_admission_no, religion, how_did_you_know

        // --- Screen 3: Parent Details (columns present in DB) ---
        student.setFatherName(req.getFatherName());
        student.setParentsMobileNumber(req.getFatherMobile());
        student.setParentsEmail(req.getFatherEmail());

        student.setMotherName(req.getMotherName());
        student.setParentToMotherMobileNumber(req.getMotherMobile());
        student.setParentsToMotherEmail(req.getMotherEmail());

        student.setGuardianName(req.getGuardianName());
        student.setGuardianMobile(req.getGuardianMobile());
        student.setGuardianEmail(req.getGuardianEmail());
        // TODO: restore once V119 migration adds:
        // father_aadhaar/qualification/occupation,
        // mother_aadhaar/qualification/occupation

        // --- Screen 4: Address Details (columns present in DB) ---
        student.setAddressLine(req.getCurrentAddress());
        student.setCity(req.getCurrentLocality());
        student.setPinCode(req.getCurrentPinCode());
        // TODO: restore once V119 migration adds: permanent_address, permanent_locality

        return instituteStudentRepository.save(student);
    }

    /**
     * Safely parse an ISO date string ("yyyy-MM-dd") to java.util.Date.
     * Returns null if input is null/blank or unparseable.
     */
    private Date parseDate(String dateStr) {
        if (dateStr == null || dateStr.isBlank())
            return null;
        try {
            return new SimpleDateFormat("yyyy-MM-dd").parse(dateStr);
        } catch (ParseException e) {
            logger.warn("Could not parse date string '{}', storing null", dateStr);
            return null;
        }
    }

    private void saveCustomFieldValues(Map<String, String> customValues, String studentId, String instituteId) {
        if (customValues == null || customValues.isEmpty())
            return;

        List<CustomFieldValues> toSave = new ArrayList<>();
        for (Map.Entry<String, String> entry : customValues.entrySet()) {
            String fieldId = entry.getKey();
            String value = entry.getValue();
            if (value == null || value.isBlank())
                continue;

            boolean isLinked = instituteCustomFieldRepository.existsByInstituteIdAndCustomFieldIdAndStatus(instituteId,
                    fieldId, "ACTIVE");
            if (isLinked) {
                toSave.add(CustomFieldValues.builder()
                        .customFieldId(fieldId)
                        .sourceType("STUDENT")
                        .sourceId(studentId)
                        .value(value)
                        .build());
            }
        }
        if (!toSave.isEmpty()) {
            customFieldValuesRepository.saveAll(toSave);
        }
    }

    private AudienceResponse handleAudienceResponse(AdmissionRequestDTO req, UserDTO parent, UserDTO child,
            Student student) {
        List<AudienceResponse> existing = audienceResponseRepository.findByUserIdOrStudentUserId(parent.getId(),
                child.getId());
        // 1. Prioritize finding AR strictly linked to this child
        Optional<AudienceResponse> reuse = existing.stream()
                .filter(ar -> ar.getStudentUserId() != null && ar.getStudentUserId().equals(child.getId()))
                .findFirst();

        // 2. If not found, look for "unclaimed" AR belonging to parent (no child linked
        // yet)
        if (reuse.isEmpty()) {
            reuse = existing.stream()
                    .filter(ar -> ar.getUserId().equals(parent.getId()) && ar.getStudentUserId() == null)
                    // Optional: maybe sort by createdAt desc?
                    .findFirst();
        }

        if (reuse.isPresent()) {
            AudienceResponse ar = reuse.get();
            ar.setOverallStatus("ADMISSION");

            // Ensure child is linked (critical for unclaimed leads)
            if (ar.getStudentUserId() == null) {
                ar.setStudentUserId(child.getId());
                logger.info("Linking unclaimed AudienceResponse {} to child user {}", ar.getId(), child.getId());
            }

            // Update destination if provided
            if (req.getDestinationPackageSessionId() != null) {
                ar.setDestinationPackageSessionId(req.getDestinationPackageSessionId());
            }
            return audienceResponseRepository.save(ar);
        }

        AudienceResponse ar = AudienceResponse.builder()
                .userId(parent.getId())
                .studentUserId(child.getId())
                .sourceType("MANUAL_ADMISSION")
                .sourceId(req.getSourceId())
                .destinationPackageSessionId(req.getDestinationPackageSessionId())
                .parentName(parent.getFullName())
                .parentEmail(parent.getEmail())
                .parentMobile(parent.getMobileNumber())
                .overallStatus("ADMISSION")
                .build();
        return audienceResponseRepository.save(ar);
    }

    private Applicant handleApplicantAndStage(AdmissionRequestDTO req, AudienceResponse ar, UserDTO parent) {

        // Step 1: Look up admin-configured ADMISSION stage (consistent with application
        // form flow)
        ApplicationStage admissionStage = applicationStageRepository
                .findFirstStage(req.getInstituteId(), req.getSource(), req.getSourceId(), "ADMISSION")
                .orElseThrow(() -> new VacademyException(
                        "No ADMISSION stage configured for this institute/source. Please configure it first."));

        // Step 2: Find existing applicant from AudienceResponse
        Applicant applicant = null;
        if (ar.getApplicantId() != null) {
            try {
                applicant = applicantRepository.findById(UUID.fromString(ar.getApplicantId())).orElse(null);
            } catch (IllegalArgumentException e) {
                logger.warn("Invalid UUID in AR applicantId: {}", ar.getApplicantId());
            }
        }

        if (applicant == null) {
            // CREATE NEW applicant
            String trackingId = "ADM-" + String.format("%06d", new Random().nextInt(999999));
            applicant = new Applicant();
            applicant.setWorkflowType("ADMISSION");
            applicant.setTrackingId(trackingId);
            applicant.setOverallStatus("ADMISSION_INITIATED");
            applicant.setApplicationStageId(admissionStage.getId().toString());
            applicant.setApplicationStageStatus("INITIATED");
            applicant = applicantRepository.save(applicant);

            ar.setApplicantId(applicant.getId().toString());
            audienceResponseRepository.save(ar);

        } else {
            // EXISTING applicant — check idempotency
            if ("ADMISSION".equals(applicant.getWorkflowType())
                    && admissionStage.getId().toString().equals(applicant.getApplicationStageId())) {
                logger.info("Applicant {} already in ADMISSION workflow at this stage. Skipping.",
                        applicant.getId());
                return applicant;
            }

            // Transition to ADMISSION workflow
            applicant.setWorkflowType("ADMISSION");
            applicant.setOverallStatus("ADMISSION_INITIATED");
            applicant.setApplicationStageId(admissionStage.getId().toString());
            applicant.setApplicationStageStatus("INITIATED");
            applicant = applicantRepository.save(applicant);
        }

        // Step 3: Create ApplicantStage (per-student stage record — consistent with
        // application form flow)
        String configJson = admissionStage.getConfigJson();
        if (configJson == null || configJson.isEmpty()) {
            configJson = "{}";
        }
        ApplicantStage applicantStage = ApplicantStage.builder()
                .applicantId(applicant.getId().toString())
                .stageId(admissionStage.getId().toString())
                .stageStatus("COMPLETED")
                .responseJson(configJson)
                .build();
        applicantStageRepository.save(applicantStage);

        // Step 4: Mark applicant stage as COMPLETED (admission is a terminal single
        // step)
        applicant.setApplicationStageStatus("COMPLETED");
        applicant.setOverallStatus("ADMISSION_COMPLETED");
        return applicantRepository.save(applicant);
    }

    private void sendAdmissionWelcomeEmail(UserDTO parent, UserDTO child, boolean sendCreds, String password,
            String instituteId, String admissionStageId) {
        try {
            // Scoped to this institute's ADMISSION stage. Looking the config up by event and
            // source type alone returned the first row across ALL institutes, so a parent could
            // get another institute's welcome template.
            Optional<NotificationEventConfig> configOpt = org.springframework.util.StringUtils.hasText(admissionStageId)
                    ? notificationEventConfigRepository
                            .findFirstByEventNameAndSourceTypeAndSourceIdAndTemplateTypeAndIsActiveTrueOrderByUpdatedAtDesc(
                                    NotificationEventType.ADMISSION_FORM_SUBMISSION,
                                    NotificationSourceType.APPLICATION_STAGE,
                                    admissionStageId,
                                    NotificationTemplateType.EMAIL)
                    : Optional.empty();

            Institute institute = instituteRepository.findById(instituteId).orElse(null);
            String instituteName = (institute != null && institute.getInstituteName() != null)
                    ? institute.getInstituteName() : "";

            boolean sentViaTemplate = false;

            if (configOpt.isPresent() && configOpt.get().getTemplateId() != null) {
                // Configured Template Found
                String templateId = configOpt.get().getTemplateId();
                Optional<Template> templateOpt = templateRepository.findById(templateId)
                        .filter(t -> isTemplateUsableByInstitute(t, instituteId));

                if (templateOpt.isPresent()) {
                    NotificationTemplateVariables vars = NotificationTemplateVariables.builder()
                            .userFullName(parent.getFullName())
                            .userEmail(parent.getEmail())
                            .childName(child.getFullName())
                            .instituteName(instituteName)
                            .build();

                    if (sendCreds && password != null) {
                        vars.setUserPassword(password);
                        vars.setUserName(parent.getEmail());
                    }

                    sendUniqueLinkService.sendEmailWithTemplate(instituteId, parent, templateOpt.get(), vars);
                    sentViaTemplate = true;
                }
            }

            if (!sentViaTemplate) {
                // FALLBACK DEFAULT STYLED EMAIL
                logger.info("No Admission Template found. Sending Default Styled Fallback Email.");

                String displayName = !instituteName.isBlank() ? instituteName : "our institute";
                // Institute's own learner portal; null (no portal configured) drops the links.
                String portalUrl = resolveInstitutePortalUrl(institute);

                String username = (sendCreds && password != null) ? parent.getUsername() : "";
                String pwd = (sendCreds && password != null) ? password : "";

                String body = buildDefaultAdmissionEmailBody(
                        parent.getFullName(),
                        child != null ? child.getFullName() : "Student",
                        displayName,
                        portalUrl,
                        portalUrl,
                        username,
                        pwd);

                GenericEmailRequest emailReq = new GenericEmailRequest();
                emailReq.setTo(parent.getEmail());
                emailReq.setSubject("Admission Confirmed! Welcome to " + displayName);
                emailReq.setBody(body);
                notificationService.sendGenericHtmlMailViaUnified(emailReq, instituteId);
            }
        } catch (Exception e) {
            logger.error("Failed to send Admission Welcome Email", e);
        }
    }

    /**
     * Second guard on the configured template: it must belong to this institute (or be a
     * shared DEFAULT/unowned template), never another institute's.
     */
    private boolean isTemplateUsableByInstitute(Template template, String instituteId) {
        String owner = template.getInstituteId();
        if (owner == null || owner.isBlank() || "DEFAULT".equals(owner) || owner.equals(instituteId)) {
            return true;
        }
        logger.warn("Admission welcome template {} belongs to institute {}, not {} - using the default email",
                template.getId(), owner, instituteId);
        return false;
    }

    /**
     * The shared learner portal (default.learner.portal.url). Institutes without a portal of their
     * own have their learners sign in there, so their links fall back to it rather than vanish.
     */
    @org.springframework.beans.factory.annotation.Value("${default.learner.portal.url:}")
    private String defaultLearnerPortalUrl;

    private String defaultPortalOrNull() {
        if (defaultLearnerPortalUrl == null || defaultLearnerPortalUrl.isBlank()) {
            return null;
        }
        String base = defaultLearnerPortalUrl.trim();
        while (base.endsWith("/")) {
            base = base.substring(0, base.length() - 1);
        }
        return base;
    }

    /**
     * The institute's own learner-portal origin ({@code https://host}, no trailing slash), else
     * the shared learner portal its learners sign in to; null only when neither is configured.
     */
    private String resolveInstitutePortalUrl(Institute institute) {
        if (institute == null || !org.springframework.util.StringUtils.hasText(institute.getLearnerPortalBaseUrl())) {
            return defaultPortalOrNull();
        }
        String base = institute.getLearnerPortalBaseUrl().trim();
        if (!base.startsWith("http://") && !base.startsWith("https://")) {
            base = "https://" + base;
        }
        while (base.endsWith("/")) {
            base = base.substring(0, base.length() - 1);
        }
        return base;
    }

    private record UserManagementResult(UserDTO parentUser, UserDTO childUser, boolean sendCredentials,
            String password) {
    }

    private String buildFullName(String first, String last) {
        StringBuilder sb = new StringBuilder();
        if (first != null && !first.isBlank())
            sb.append(first.trim());
        if (last != null && !last.isBlank()) {
            if (sb.length() > 0)
                sb.append(" ");
            sb.append(last.trim());
        }
        return sb.length() > 0 ? sb.toString() : "";
    }

    /**
     * Build default styled HTML email body for admission confirmation
     */
    private String buildDefaultAdmissionEmailBody(
            String parentName,
            String childName,
            String instituteName,
            String websiteUrl,
            String loginUrl,
            String username,
            String password) {

        return "<!DOCTYPE html>" +
                "<html>" +
                "<head>" +
                "<style>" +
                "body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #2c3e50; background-color: #f4f7f6; }" +
                ".container { max-width: 650px; margin: 40px auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.1); }" +
                ".header { background: linear-gradient(135deg, #FFB75E 0%, #ED8F03 100%); color: white; padding: 30px 20px; text-align: center; }" +
                ".header h2 { margin: 0; font-size: 28px; letter-spacing: 1px; }" +
                ".content { padding: 40px 30px; }" +
                ".welcome-msg { font-size: 18px; color: #34495e; margin-bottom: 25px; text-align: center; }" +
                ".credentials-box { background-color: #f8f9fa; border-left: 5px solid #ED8F03; padding: 25px; margin: 30px 0; border-radius: 0 8px 8px 0; }" +
                ".credentials-box h3 { margin-top: 0; color: #ED8F03; }" +
                ".cred-row { margin: 10px 0; font-size: 16px; }" +
                ".cred-val { font-family: monospace; background: #e9ecef; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 18px; }" +
                ".button { display: inline-block; padding: 14px 35px; background-color: #ED8F03; color: white !important; text-decoration: none; border-radius: 6px; font-weight: bold; text-transform: uppercase; font-size: 14px; }" +
                ".footer { background-color: #2c3e50; text-align: center; padding: 25px; color: #a8b2bd; font-size: 13px; }" +
                "</style>" +
                "</head>" +
                "<body>" +
                "<div class='container'>" +
                "<div class='header'>" +
                "<h2>Admission Confirmed! \uD83C\uDF89</h2>" +
                "<p style='margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;'>Welcome to " + instituteName + "</p>" +
                "</div>" +
                "<div class='content'>" +
                "<p class='welcome-msg'>Dear <strong>" + parentName + "</strong>,</p>" +
                "<p>We are absolutely thrilled to officially welcome <strong>" + childName + "</strong> to our institute!</p>" +
                "<p>Your admission process has been successfully completed. To help you get started, access fee schedules, and view academic updates, we have set up your permanent Parent Portal account.</p>" +
                ((!username.isEmpty()) ?
                "<div class='credentials-box'>" +
                "<h3>Your Portal Credentials</h3>" +
                "<div class='cred-row'>Username: <span class='cred-val'>" + username + "</span></div>" +
                "<div class='cred-row'>Password: <span class='cred-val'>" + password + "</span></div>" +
                "</div>" +
                (loginUrl != null ?
                "<div style='text-align: center; margin: 40px 0;'>" +
                "<a href='" + loginUrl + "' class='button'>Login to Parent Portal</a>" +
                "</div>" : "") : "") +
                (websiteUrl != null ?
                "<p>If you have any questions, please visit our <a href='" + websiteUrl + "' style='color: #ED8F03;'>website</a> or reach out to our administration team.</p>" :
                "<p>If you have any questions, please reach out to our administration team.</p>") +
                "</div>" +
                "<div class='footer'>" +
                "<p>You are receiving this email because you have successfully enrolled at " + instituteName + ".</p>" +
                "</div>" +
                "</div>" +
                "</body>" +
                "</html>";
    }
}
