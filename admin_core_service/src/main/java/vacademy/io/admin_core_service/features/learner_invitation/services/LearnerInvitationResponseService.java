package vacademy.io.admin_core_service.features.learner_invitation.services;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.transaction.Transactional;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute_learner.dto.InstituteStudentDTO;
import vacademy.io.admin_core_service.features.institute_learner.dto.InstituteStudentDetails;
import vacademy.io.admin_core_service.features.institute_learner.entity.Student;
import vacademy.io.admin_core_service.features.institute_learner.entity.StudentSessionInstituteGroupMapping;
import vacademy.io.admin_core_service.features.institute_learner.enums.LearnerSessionStatusEnum;
import vacademy.io.admin_core_service.features.institute_learner.manager.StudentRegistrationManager;
import vacademy.io.admin_core_service.features.institute_learner.repository.InstituteStudentRepository;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionRepository;
import vacademy.io.admin_core_service.features.learner_invitation.dto.*;
import vacademy.io.admin_core_service.features.learner_invitation.dto.json_mapper.PackageSelectionDTO;
import vacademy.io.admin_core_service.features.learner_invitation.entity.LearnerInvitation;
import vacademy.io.admin_core_service.features.learner_invitation.entity.LearnerInvitationCustomFieldResponse;
import vacademy.io.admin_core_service.features.learner_invitation.entity.LearnerInvitationResponse;
import vacademy.io.admin_core_service.features.learner_invitation.enums.CustomFieldStatusEnum;
import vacademy.io.admin_core_service.features.learner_invitation.enums.LearnerInvitationCodeStatusEnum;
import vacademy.io.admin_core_service.features.learner_invitation.enums.LearnerInvitationResponseStatusEnum;
import vacademy.io.admin_core_service.features.learner_invitation.notification.LearnerInvitationNotification;
import vacademy.io.admin_core_service.features.learner_invitation.repository.LearnerInvitationCustomFieldResponseRepository;
import vacademy.io.admin_core_service.features.learner_invitation.repository.LearnerInvitationRepository;
import vacademy.io.admin_core_service.features.learner_invitation.repository.LearnerInvitationResponseRepository;
import vacademy.io.admin_core_service.features.packages.enums.PackageSessionStatusEnum;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.common.institute.entity.session.PackageSession;

import java.util.*;
import java.util.stream.Collectors;

@Service
public class LearnerInvitationResponseService {

    // Dependencies
    @Autowired private LearnerInvitationResponseRepository learnerInvitationResponseRepository;
    @Autowired private LearnerInvitationRepository learnerInvitationRepository;
    @Autowired private LearnerInvitationCustomFieldResponseRepository learnerInvitationCustomFieldResponseRepository;
    @Autowired private InstituteRepository instituteRepository;
    @Autowired private LearnerInvitationNotification notification;
    @Autowired private InstituteStudentRepository instituteStudentRepository;
    @Autowired private StudentRegistrationManager studentRegistrationManager;
    @Autowired private PackageSessionRepository packageSessionRepository;
    @Autowired private ObjectMapper objectMapper;
    @Autowired private StudentSessionRepository studentSessionRepository;

    // Constants
    private static final int DEFAULT_ACCESS_DAYS = 365;
    private static final List<String> ACTIVE_PACKAGE_STATUSES = List.of(
            PackageSessionStatusEnum.ACTIVE.name(),
            PackageSessionStatusEnum.HIDDEN.name()
    );
    private static final List<String> INVITED_STATUSES = List.of(LearnerSessionStatusEnum.INVITED.name());

    // Main Service Methods =====================================================

    @Transactional
    public String registerLearnerInvitationResponse(LearnerInvitationResponseDTO learnerInvitationResponseDTO) {
        validateRegistrationRequest(learnerInvitationResponseDTO);

        LearnerInvitation invitation = getValidInvitation(learnerInvitationResponseDTO.getLearnerInvitationId());
        List<PackageSelectionDTO> packageSelection = parsePackageSelection(learnerInvitationResponseDTO.getBatchSelectionResponseJson());

        Optional<Student> existingStudent = findExistingStudent(
                learnerInvitationResponseDTO.getEmail(),
                invitation.getInstituteId()
        );

        if (existingStudent.isEmpty()) {
            registerNewStudent(learnerInvitationResponseDTO, invitation, packageSelection);
        } else {
            createSessionMappings(
                    existingStudent.get().getUserId(),
                    invitation.getInstituteId(),
                    packageSelection,
                    new BooleanWrapper(false)
            );
        }

        return "Done!!!";
    }

    public LearnerInvitationFormDTO getInvitationFormByInviteCodeAndInstituteId(String instituteId, String inviteCode) {
        Objects.requireNonNull(instituteId, "Institute ID cannot be null");
        Objects.requireNonNull(inviteCode, "Invite code cannot be null");

        LearnerInvitation invitation = getValidInvitationByCode(instituteId, inviteCode);
        Institute institute = getInstitute(invitation.getInstituteId());

        return buildInvitationFormDTO(invitation, institute);
    }

    public Page<OneLearnerInvitationResponse> getLearnerInvitationResponses(
            LearnerInvitationResponsesFilterDTO filterDTO,
            String instituteId,
            int pageNo,
            int pageSize,
            CustomUserDetails user) {

        validatePaginationParameters(pageNo, pageSize);
        Pageable pageable = PageRequest.of(pageNo, pageSize);

        return learnerInvitationResponseRepository
                .findByInstituteIdAndStatusWithCustomFields(
                        instituteId,
                        filterDTO.getStatus(),
                        List.of(CustomFieldStatusEnum.ACTIVE.name()),
                        pageable
                )
                .map(LearnerInvitationResponse::mapToOneLearnerInvitationResponse);
    }

    @Transactional
    public String updateLearnerInvitationResponseStatus(
            LearnerInvitationRequestStatusChangeDTO statusChangeDTO,
            CustomUserDetails user) {

        validateStatusChangeRequest(statusChangeDTO);
        List<LearnerInvitationResponse> responses = updateResponseStatuses(statusChangeDTO);
        sendStatusUpdateNotifications(responses);

        return "Status updated successfully!!!";
    }

    // Core Business Logic Methods ==============================================

    private void registerNewStudent(
            LearnerInvitationResponseDTO responseDTO,
            LearnerInvitation invitation,
            List<PackageSelectionDTO> packageSelection) {

        Student student = createInitialStudent(responseDTO, invitation, packageSelection);
        createSessionMappings(
                student.getUserId(),
                invitation.getInstituteId(),
                packageSelection,
                new BooleanWrapper(true)
        );
    }

    private Student createInitialStudent(
            LearnerInvitationResponseDTO responseDTO,
            LearnerInvitation invitation,
            List<PackageSelectionDTO> packageSelection) {

        InstituteStudentDTO studentDTO = buildStudentDTO(responseDTO);
        PackageSession firstSession = findFirstValidPackageSession(packageSelection);

        studentDTO.setInstituteStudentDetails(
                buildStudentDetails(invitation.getInstituteId(), firstSession)
        );

        studentRegistrationManager.addStudentToInstitute(null, studentDTO, null);

        return findCreatedStudent(responseDTO.getEmail(), invitation.getInstituteId());
    }

    private void createSessionMappings(
            String userId,
            String instituteId,
            List<PackageSelectionDTO> packageSelection,
            BooleanWrapper skipFirstWrapper) {

        List<StudentSessionInstituteGroupMapping> mappings = buildSessionMappings(
                userId,
                instituteId,
                packageSelection,
                skipFirstWrapper
        );

        studentSessionRepository.saveAll(mappings);
    }

    // Helper Methods ===========================================================

    private List<StudentSessionInstituteGroupMapping> buildSessionMappings(
            String userId,
            String instituteId,
            List<PackageSelectionDTO> packageSelection,
            BooleanWrapper skipFirstWrapper) {

        StudentSessionInstituteGroupMapping latestMapping = getLatestStudentMapping(userId, instituteId);
        Set<String> existingSessionIds = getExistingInvitedSessionIds(userId, instituteId);
        List<StudentSessionInstituteGroupMapping> mappings = new ArrayList<>();
        BooleanWrapper skippedWrapper = new BooleanWrapper(!skipFirstWrapper.getValue());

        if (packageSelection != null) {
            for (PackageSelectionDTO packageItem : packageSelection) {
                if (packageItem.getSelectedSessions() != null) {
                    for (PackageSelectionDTO.SelectedSession session : packageItem.getSelectedSessions()) {
                        if (session.getSelectedLevels() != null) {
                            for (PackageSelectionDTO.SelectedLevel level : session.getSelectedLevels()) {
                                if (skippedWrapper.getValue() == false) {
                                    skippedWrapper.setValue(true);
                                    continue;
                                }

                                PackageSession packageSession = findPackageSession(
                                        level.getId(),
                                        session.getSessionId(),
                                        packageItem.getPackageId()
                                );

                                if (packageSession != null && !existingSessionIds.contains(packageSession.getId())) {
                                    mappings.add(buildSessionMapping(latestMapping, packageSession));
                                }
                            }
                        }
                    }
                }
            }
        }

        return mappings;
    }

    private PackageSession findFirstValidPackageSession(List<PackageSelectionDTO> packageSelection) {
        if (packageSelection == null) {
            throw new VacademyException("Package selection is missing or empty.");
        }

        PackageSelectionDTO firstPackage = packageSelection.get(0);
        if (firstPackage.getSelectedSessions() == null || firstPackage.getSelectedSessions().isEmpty()) {
            throw new VacademyException("No sessions selected in the package.");
        }

        PackageSelectionDTO.SelectedSession firstSession = firstPackage.getSelectedSessions().get(0);
        if (firstSession.getSelectedLevels() == null || firstSession.getSelectedLevels().isEmpty()) {
            throw new VacademyException("No levels selected in the session.");
        }

        PackageSelectionDTO.SelectedLevel firstLevel = firstSession.getSelectedLevels().get(0);
        return findPackageSession(firstLevel.getId(), firstSession.getSessionId(), firstPackage.getPackageId());
    }

    private StudentSessionInstituteGroupMapping buildSessionMapping(
            StudentSessionInstituteGroupMapping template,
            PackageSession packageSession) {

        StudentSessionInstituteGroupMapping mapping = new StudentSessionInstituteGroupMapping();
        mapping.setId(UUID.randomUUID().toString());
        mapping.setInstitute(template.getInstitute());
        mapping.setUserId(template.getUserId());
        mapping.setEnrolledDate(new Date());
        mapping.setExpiryDate(makeExpiryDate(new Date(), DEFAULT_ACCESS_DAYS));
        mapping.setInstituteEnrolledNumber(template.getInstituteEnrolledNumber());
        mapping.setPackageSession(packageSession);
        mapping.setStatus(LearnerSessionStatusEnum.INVITED.name());
        return mapping;
    }

    private PackageSession findPackageSession(String levelId, String sessionId, String packageId) {
        Optional<PackageSession> packageSession = packageSessionRepository
                .findTopByLevelIdAndSessionIdAndPackageEntityIdAndStatusesOrderByCreatedAtDesc(
                        levelId, sessionId, packageId, ACTIVE_PACKAGE_STATUSES
                );

        return packageSession.orElseThrow(() -> new VacademyException("Package session not found."));
    }

    // Wrapper class to simulate pass-by-reference for boolean
    private static class BooleanWrapper {
        private boolean value;

        public BooleanWrapper(boolean value) {
            this.value = value;
        }

        public boolean getValue() {
            return value;
        }

        public void setValue(boolean value) {
            this.value = value;
        }
    }

    // Data Access Methods ======================================================

    private LearnerInvitation getValidInvitation(String invitationId) {
        return learnerInvitationRepository.findById(invitationId)
                .orElseThrow(() -> new VacademyException("Learner invitation not found"));
    }

    private LearnerInvitation getValidInvitationByCode(String instituteId, String inviteCode) {
        LearnerInvitation invitation = learnerInvitationRepository
                .findByInstituteIdAndInviteCodeAndStatus(
                        instituteId,
                        inviteCode,
                        List.of(LearnerInvitationCodeStatusEnum.ACTIVE.name()),
                        List.of(CustomFieldStatusEnum.ACTIVE.name())
                )
                .orElseThrow(() -> new VacademyException("This invite link is closed. Please contact the institute for further support."));

        if (invitation.getExpiryDate().before(new Date())) {
            throw new VacademyException("This invite code is expired. Please contact the institute for further support.");
        }

        return invitation;
    }

    private Optional<Student> findExistingStudent(String email, String instituteId) {
        return instituteStudentRepository
                .findTopStudentByEmailAndInstituteIdOrderByMappingCreatedAtDesc(email, instituteId);
    }

    private Student findCreatedStudent(String email, String instituteId) {
        return instituteStudentRepository
                .findTopStudentByEmailAndInstituteIdOrderByMappingCreatedAtDesc(email, instituteId)
                .orElseThrow(() -> new VacademyException("Student creation failed"));
    }

    private StudentSessionInstituteGroupMapping getLatestStudentMapping(String userId, String instituteId) {
        return studentSessionRepository
                .findTopByUserIdAndInstituteIdOrderByCreatedAtDesc(userId, instituteId)
                .orElseThrow(() -> new VacademyException("Student session not found"));
    }

    private Set<String> getExistingInvitedSessionIds(String userId, String instituteId) {
        return studentSessionRepository
                .findAllByInstituteIdAndUserIdAndStatusIn(instituteId, userId, INVITED_STATUSES)
                .stream()
                .map(mapping -> mapping.getPackageSession().getId())
                .collect(Collectors.toSet());
    }

    private Institute getInstitute(String instituteId) {
        return instituteRepository.findById(instituteId)
                .orElseThrow(() -> new VacademyException("Institute not found"));
    }

    private List<LearnerInvitationResponse> updateResponseStatuses(LearnerInvitationRequestStatusChangeDTO statusChangeDTO) {
        List<LearnerInvitationResponse> responses = learnerInvitationResponseRepository
                .findAllById(statusChangeDTO.getLearnerInvitationResponseIds());

        responses.forEach(response -> {
            response.setStatus(statusChangeDTO.getStatus());
            response.setMessageByInstitute(statusChangeDTO.getDescription());
        });

        return learnerInvitationResponseRepository.saveAll(responses);
    }

    // DTO Building Methods =====================================================

    private InstituteStudentDTO buildStudentDTO(LearnerInvitationResponseDTO responseDTO) {
        InstituteStudentDTO studentDTO = new InstituteStudentDTO();
        UserDTO userDTO = new UserDTO();
        userDTO.setEmail(responseDTO.getEmail());
        userDTO.setFullName(responseDTO.getFullName());
        userDTO.setMobileNumber(responseDTO.getContactNumber());
        studentDTO.setUserDetails(userDTO);
        return studentDTO;
    }

    private InstituteStudentDetails buildStudentDetails(String instituteId, PackageSession packageSession) {
        InstituteStudentDetails details = new InstituteStudentDetails();
        details.setInstituteId(instituteId);
        details.setPackageSessionId(packageSession.getId());
        details.setEnrollmentStatus(LearnerSessionStatusEnum.INVITED.name());
        return details;
    }

    private LearnerInvitationFormDTO buildInvitationFormDTO(LearnerInvitation invitation, Institute institute) {
        LearnerInvitationFormDTO formDTO = new LearnerInvitationFormDTO();
        formDTO.setLearnerInvitation(invitation.mapToDTO());
        formDTO.setInstituteName(institute.getInstituteName());
        formDTO.setInstituteLogoFileId(institute.getLogoFileId());
        return formDTO;
    }

    // Utility Methods ==========================================================

    private List<PackageSelectionDTO> parsePackageSelection(String batchSelectionJson) {
        try {
            System.out.println(batchSelectionJson);
            if (!StringUtils.hasText(batchSelectionJson)) {
                throw new VacademyException("Batch selection JSON cannot be empty");
            }

            return objectMapper.readValue(batchSelectionJson, new TypeReference<List<PackageSelectionDTO>>() {});
        } catch (JsonProcessingException e) {
            throw new VacademyException("Invalid package selection format: " + e.getMessage());
        } catch (Exception e) {
            throw new VacademyException("Error processing package selection: " + e.getMessage());
        }
    }


    private void sendStatusUpdateNotifications(List<LearnerInvitationResponse> responses) {
        if (!responses.isEmpty()) {
            List<String> emails = responses.stream()
                    .map(LearnerInvitationResponse::getEmail)
                    .collect(Collectors.toList());

            Institute institute = getInstitute(responses.get(0).getInstituteId());
            notification.sendStatusUpdateNotification(emails, institute);
        }
    }

    public Date makeExpiryDate(Date enrollmentDate, int accessDays) {
        try {
            Date expiryDate = new Date();
            expiryDate.setTime(enrollmentDate.getTime() + (long) accessDays * 24 * 60 * 60 * 1000);
            return expiryDate;
        } catch (Exception e) {
            return null;
        }
    }

    // Validation Methods =======================================================

    private void validateRegistrationRequest(LearnerInvitationResponseDTO responseDTO) {
        Objects.requireNonNull(responseDTO, "learnerInvitationResponseDTO cannot be null");

        if (!StringUtils.hasText(responseDTO.getEmail())) {
            throw new VacademyException("Email is required");
        }
        if (!StringUtils.hasText(responseDTO.getFullName())) {
            throw new VacademyException("Full name is required");
        }
        if (!StringUtils.hasText(responseDTO.getContactNumber())) {
            throw new VacademyException("Contact number is required");
        }
        if (!StringUtils.hasText(responseDTO.getInstituteId())) {
            throw new VacademyException("Institute id is required");
        }
        if (!StringUtils.hasText(responseDTO.getLearnerInvitationId())) {
            throw new VacademyException("Learner invitation id is required");
        }

        validateDuplicateRegistration(responseDTO);
    }

    private void validateDuplicateRegistration(LearnerInvitationResponseDTO responseDTO) {
        Optional<LearnerInvitationResponse> existingResponse = learnerInvitationResponseRepository
                .findByEmailAndLearnerInvitationIdAndStatusIn(
                        responseDTO.getEmail(),
                        responseDTO.getLearnerInvitationId(),
                        List.of(
                                LearnerInvitationResponseStatusEnum.ACTIVE.name(),
                                LearnerInvitationResponseStatusEnum.ACCEPTED.name()
                        )
                );

        if (existingResponse.isPresent()) {
            throw new VacademyException("Learner with email " + responseDTO.getEmail() + " has already registered");
        }
    }

    private void validateStatusChangeRequest(LearnerInvitationRequestStatusChangeDTO statusChangeDTO) {
        Objects.requireNonNull(statusChangeDTO, "Status change request cannot be null");

        if (statusChangeDTO.getLearnerInvitationResponseIds() == null ||
                statusChangeDTO.getLearnerInvitationResponseIds().isEmpty()) {
            throw new VacademyException("Response IDs are required");
        }
        if (!StringUtils.hasText(statusChangeDTO.getStatus())) {
            throw new VacademyException("Status is required");
        }
    }

    private void validatePaginationParameters(int pageNo, int pageSize) {
        if (pageNo < 0) {
            throw new VacademyException("Page number cannot be negative");
        }
        if (pageSize <= 0) {
            throw new VacademyException("Page size must be positive");
        }
    }
}