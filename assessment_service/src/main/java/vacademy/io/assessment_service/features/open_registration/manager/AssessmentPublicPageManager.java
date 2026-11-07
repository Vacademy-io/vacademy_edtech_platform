package vacademy.io.assessment_service.features.open_registration.manager;


import jakarta.transaction.Transactional;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import vacademy.io.assessment_service.features.assessment.entity.*;
import vacademy.io.assessment_service.features.assessment.enums.AssessmentVisibility;
import vacademy.io.assessment_service.features.assessment.enums.UserRegistrationSources;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentInstituteMappingRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentUserRegistrationRepository;
import vacademy.io.assessment_service.features.open_registration.dto.AssessmentPublicDto;
import vacademy.io.assessment_service.features.open_registration.dto.GetAssessmentPublicResponseDto;
import vacademy.io.assessment_service.features.open_registration.dto.ParticipantPublicResponseDto;
import vacademy.io.assessment_service.features.open_registration.dto.RegisterOpenAssessmentRequestDto;
import vacademy.io.common.core.utils.DateUtil;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.student.dto.BasicParticipantDTO;

import java.util.*;

import static vacademy.io.common.auth.enums.CompanyStatus.ACTIVE;

@Component
public class AssessmentPublicPageManager {

    @Autowired
    AssessmentInstituteMappingRepository assessmentInstituteMappingRepository;

    @Autowired
    vacademy.io.assessment_service.features.assessment.service.AssessmentWorkflowEventPublisher assessmentWorkflowEventPublisher;

    @Autowired
    AssessmentUserRegistrationRepository assessmentUserRegistrationRepository;

    @Autowired
    AssessmentRepository assessmentRepository;

    public ResponseEntity<GetAssessmentPublicResponseDto> getAssessmentPage(String code) {
        Optional<AssessmentInstituteMapping> assessmentInstituteMapping = assessmentInstituteMappingRepository.findTopByAssessmentUrl(code);

        if (assessmentInstituteMapping.isEmpty()) {
            throw new VacademyException("Assessment not found");
        }

        Assessment assessment = assessmentInstituteMapping.get().getAssessment();

        // Nothing but a PUBLISHED assessment may be registered for. This endpoint
        // never looked at status, so a DELETED or DRAFT assessment whose row
        // happened to carry a registration window stayed fully registerable
        // through its old share link — verified live on 5 prod assessments
        // (3 DELETED, 2 DRAFT). A deleted assessment must look like a dead link,
        // not merely a closed one, so this reuses the "not found" rejection.
        if (!isLive(assessment)) {
            throw new VacademyException("Assessment not found");
        }

        if (assessment.getBoundEndTime() != null && assessment.getBoundEndTime().before(new Date())) {
            throw new VacademyException("Assessment is ended");
        }

        // Whether a share link may be used is decided by assessment_visibility — the
        // one field the admin builder actually edits. This used to key off the
        // registration window alone, so an assessment an admin had switched from
        // PRIVATE to PUBLIC still answered "Assessment is Private" forever: the
        // PRIVATE->PUBLIC edit leaves registration_open_date/close_date NULL
        // (AssessmentParticipantsManager.handleOpenRegistration skips blank dates),
        // and nothing else in the service ever writes them. 216 rows were stranded
        // that way, 55 of them published with a circulated link.
        if (!isPubliclyVisible(assessment)) {
            return ResponseEntity.ok(GetAssessmentPublicResponseDto.builder().instituteId(assessmentInstituteMapping.get().getInstituteId()).assessmentPublicDto(new AssessmentPublicDto(assessment)).serverTimeInGmt(DateUtil.getCurrentUtcTime()).canRegister(false).errorMessage("Assessment is Private").build());
        }

        // For a PUBLIC assessment the window is an optional *restriction*, not a
        // precondition: an unset bound simply means "no limit on that side".
        // bound_end_time is already enforced above.
        Date now = new Date();
        if (assessment.getRegistrationOpenDate() != null && assessment.getRegistrationOpenDate().after(now)) {
            return ResponseEntity.ok(GetAssessmentPublicResponseDto.builder().instituteId(assessmentInstituteMapping.get().getInstituteId()).assessmentPublicDto(new AssessmentPublicDto(assessment)).serverTimeInGmt(DateUtil.getCurrentUtcTime()).canRegister(false).errorMessage("Assessment is closed").build());
        }
        if (assessment.getRegistrationCloseDate() != null && assessment.getRegistrationCloseDate().before(now)) {
            return ResponseEntity.ok(GetAssessmentPublicResponseDto.builder().instituteId(assessmentInstituteMapping.get().getInstituteId()).assessmentPublicDto(new AssessmentPublicDto(assessment)).serverTimeInGmt(DateUtil.getCurrentUtcTime()).canRegister(false).errorMessage("Assessment is closed").build());
        }

        return ResponseEntity.ok(GetAssessmentPublicResponseDto.builder().instituteId(assessmentInstituteMapping.get().getInstituteId()).serverTimeInGmt(DateUtil.getCurrentUtcTime()).assessmentPublicDto(new AssessmentPublicDto(assessment)).canRegister(true).assessmentCustomFields(assessment.getAssessmentCustomFields()).build());

    }

    /**
     * assessment_visibility is NOT NULL in the schema, but treat anything that is
     * not an explicit PUBLIC as private — a blank or unrecognised value must never
     * open registration by accident.
     */
    /** Only a PUBLISHED assessment is registerable; DRAFT and DELETED are dead links. */
    static boolean isLive(Assessment assessment) {
        return "PUBLISHED".equalsIgnoreCase(assessment.getStatus());
    }

    static boolean isPubliclyVisible(Assessment assessment) {
        return AssessmentVisibility.PUBLIC.name().equalsIgnoreCase(assessment.getAssessmentVisibility());
    }

    private void validateRegisterRequest(Optional<Assessment> assessment) {

        if (assessment.isEmpty()) {
            throw new VacademyException("Assessment not found");
        }

        // Must mirror getAssessmentPage exactly. When these two disagreed, a PUBLIC
        // assessment with no registration window rendered the form and then failed
        // the POST with "Assessment not found" — the worst of both worlds.
        if (!isLive(assessment.get())) {
            throw new VacademyException("Assessment not found");
        }

        // The page throws on an ended assessment but this path never did, so a
        // direct POST could still register against a finished assessment whose
        // registration window happened to outlast it.
        if (assessment.get().getBoundEndTime() != null
                && assessment.get().getBoundEndTime().before(new Date())) {
            throw new VacademyException("Assessment is ended");
        }

        if (!isPubliclyVisible(assessment.get())) {
            throw new VacademyException("Assessment is Private");
        }

        Date now = new Date();
        if (assessment.get().getRegistrationOpenDate() != null && assessment.get().getRegistrationOpenDate().after(now)) {
            throw new VacademyException("Assessment is closed");
        }

        if (assessment.get().getRegistrationCloseDate() != null && assessment.get().getRegistrationCloseDate().before(now)) {
            throw new VacademyException("Assessment is closed");
        }

    }

    public ResponseEntity<ParticipantPublicResponseDto> getParticipantStatus(String assessmentId, String instituteId, String userId, String psIds) {
        Optional<AssessmentUserRegistration> assessmentUserRegistration = assessmentUserRegistrationRepository.findTopByUserIdAndAssessmentId(userId, assessmentId);

        if (assessmentUserRegistration.isEmpty()) {
            return checkBatchRegistration(assessmentId, instituteId, userId, psIds);
        }

        Optional<StudentAttempt> recentAttempt = assessmentUserRegistration.get().getStudentAttempts().stream().findFirst();

        if (recentAttempt.isEmpty()) {
            return ResponseEntity.ok(ParticipantPublicResponseDto.builder().remainingAttempts(assessmentUserRegistration.get().getAssessment().getReattemptCount()).isAlreadyRegistered(true).build());

        }

        Integer totalAttemptsGiven = assessmentUserRegistration.get().getStudentAttempts().size();
        Integer studentTotalAttempts = (assessmentUserRegistration.get().getReattemptCount() != null) ? assessmentUserRegistration.get().getReattemptCount() : assessmentUserRegistration.get().getAssessment().getReattemptCount();
        if (studentTotalAttempts == null) studentTotalAttempts = 1;
        Integer remainingAttempts = studentTotalAttempts - totalAttemptsGiven;
        return ResponseEntity.ok(ParticipantPublicResponseDto.builder().remainingAttempts(remainingAttempts).isAlreadyRegistered(true).lastAttemptStatus(recentAttempt.get().getStatus()).build());
    }

    public ResponseEntity<ParticipantPublicResponseDto> checkBatchRegistration(String assessmentId, String instituteId, String userId, String psIds) {
        Optional<Assessment> assessment = assessmentRepository.findByAssessmentIdAndInstituteId(assessmentId, instituteId);
        if (assessment.isEmpty()) {
            throw new VacademyException("Assessment not found");
        }

        if (psIds == null || psIds.isEmpty()) {
            return ResponseEntity.ok(ParticipantPublicResponseDto.builder().remainingAttempts(assessment.get().getReattemptCount()).isAlreadyRegistered(false).build());
        }

        List<String> psIdList = List.of(psIds.split(","));

        Set<AssessmentBatchRegistration> batchRegistrations = assessment.get().getBatchRegistrations();

        for (AssessmentBatchRegistration batchRegistration : batchRegistrations) {
            if (psIdList.contains(batchRegistration.getId())) {
                return ResponseEntity.ok(ParticipantPublicResponseDto.builder().remainingAttempts(assessment.get().getReattemptCount()).isAlreadyRegistered(true).lastAttemptStatus(null).build());
            }
        }

        return ResponseEntity.ok(ParticipantPublicResponseDto.builder().remainingAttempts(assessment.get().getReattemptCount()).isAlreadyRegistered(false).build());
    }

    @Transactional
    public ResponseEntity<String> registerAssessment(String userId, RegisterOpenAssessmentRequestDto registerOpenAssessmentRequestDto) {
        Optional<Assessment> assessment = assessmentRepository.findByAssessmentIdAndInstituteId(registerOpenAssessmentRequestDto.getAssessmentId(), registerOpenAssessmentRequestDto.getInstituteId());
        validateRegisterRequest(assessment);

        BasicParticipantDTO participantDTO = registerOpenAssessmentRequestDto.getParticipantDTO();

        // Resolve the user id: prefer the participant payload, fall back to the query param.
        // This value is persisted into the UNIQUE(assessment_id, user_id) column, so a blank id
        // makes every anonymous registrant collide on user_id=''. Reject it up front instead of
        // letting the batch insert blow up with a raw 500 (duplicate key violation).
        String resolvedUserId = StringUtils.hasText(participantDTO.getUserId())
                ? participantDTO.getUserId()
                : userId;
        if (!StringUtils.hasText(resolvedUserId)) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "A valid user is required to register for this assessment.");
        }
        participantDTO.setUserId(resolvedUserId);

        // The unique constraint is (assessment_id, user_id), and it covers soft-deleted rows too.
        // Look up any prior registration for this pair so we never blindly insert a duplicate.
        Optional<AssessmentUserRegistration> existingRegistration =
                assessmentUserRegistrationRepository.findTopByUserIdAndAssessmentId(resolvedUserId, registerOpenAssessmentRequestDto.getAssessmentId());
        if (existingRegistration.isPresent()) {
            AssessmentUserRegistration registration = existingRegistration.get();
            if ("DELETED".equalsIgnoreCase(registration.getStatus())) {
                // A previous registration was soft-deleted. Reactivate it in place — inserting a
                // fresh row would violate UNIQUE(assessment_id, user_id) against the deleted one.
                registration.setStatus(ACTIVE.name());
                registration.setRegistrationTime(new Date());
                registration.setReattemptCount((participantDTO.getReattemptCount() == null)
                        ? assessment.get().getReattemptCount() : participantDTO.getReattemptCount());
                AssessmentUserRegistration reactivated = assessmentUserRegistrationRepository.save(registration);
                // A reactivated soft-deleted row is still a fresh form submission from the
                // registrant's point of view; only the "already active" case below is a no-op.
                assessmentWorkflowEventPublisher.publishFormSubmission(reactivated, assessment.get());
                return ResponseEntity.ok("Registered successfully");
            }
            // An active registration already exists — treat a repeat submission as idempotent.
            return ResponseEntity.ok("Already registered");
        }

        AssessmentUserRegistration registration;
        try {
            registration = addUserToAssessment(participantDTO, userId, registerOpenAssessmentRequestDto.getInstituteId(), assessment.get(), registerOpenAssessmentRequestDto.getCustomFieldRequestList());
        } catch (DataIntegrityViolationException e) {
            String rootCause = e.getMostSpecificCause().getMessage();
            if (rootCause != null && rootCause.contains("assessment_user_registration_unique")) {
                // A concurrent identical submission raced past the existence check and won the
                // insert. Surface a clean conflict instead of the raw duplicate-key 500.
                throw new VacademyException(HttpStatus.CONFLICT, "You are already registered for this assessment.");
            }
            // Any other integrity violation is a different problem — don't mislabel it.
            throw e;
        }

        // Emitted outside the try above so a failure in here can never be caught and
        // reported to the registrant as a duplicate-registration conflict.
        assessmentWorkflowEventPublisher.publishFormSubmission(registration, assessment.get());
        return ResponseEntity.ok("Registered successfully");
    }

    AssessmentUserRegistration addUserToAssessment(BasicParticipantDTO basicParticipantDTO, String userId, String instituteId, Assessment assessment, List<AssessmentRegistrationCustomFieldRequest> customFieldRequestList) {
        AssessmentUserRegistration assessmentParticipantRegistration = new AssessmentUserRegistration();
        assessmentParticipantRegistration.setAssessment(assessment);
        assessmentParticipantRegistration.setUserId(basicParticipantDTO.getUserId());
        assessmentParticipantRegistration.setUsername(basicParticipantDTO.getUsername());
        assessmentParticipantRegistration.setParticipantName(basicParticipantDTO.getFullName());
        assessmentParticipantRegistration.setPhoneNumber(basicParticipantDTO.getMobileNumber());
        assessmentParticipantRegistration.setFaceFileId(basicParticipantDTO.getFileId());
        assessmentParticipantRegistration.setUserEmail(basicParticipantDTO.getEmail());
        assessmentParticipantRegistration.setReattemptCount((basicParticipantDTO.getReattemptCount() == null) ? assessment.getReattemptCount() : basicParticipantDTO.getReattemptCount());
        assessmentParticipantRegistration.setInstituteId(instituteId);
        assessmentParticipantRegistration.setStatus(ACTIVE.name());
        assessmentParticipantRegistration.setSource(UserRegistrationSources.OPEN_REGISTRATION.name());
        assessmentParticipantRegistration.setSourceId(userId);
        assessmentParticipantRegistration.setRegistrationTime(new Date());
        addCustomUserValues(customFieldRequestList, assessmentParticipantRegistration);
        // saveAndFlush so a UNIQUE(assessment_id, user_id) violation surfaces here (inside the
        // caller's try/catch) rather than at transaction commit, where it could not be handled.
        return assessmentUserRegistrationRepository.saveAndFlush(assessmentParticipantRegistration);
    }

    void addCustomUserValues(List<AssessmentRegistrationCustomFieldRequest> customFields, AssessmentUserRegistration assessmentUserRegistration) {
        Set<AssessmentRegistrationCustomFieldResponse> customFieldResponses = new HashSet<>();

        for (AssessmentRegistrationCustomFieldRequest customField : customFields) {
            AssessmentRegistrationCustomFieldResponse customFieldResponse = new AssessmentRegistrationCustomFieldResponse();
            customFieldResponse.setAssessmentUserRegistration(assessmentUserRegistration);
            customFieldResponse.setAnswer(customField.getAnswer());
            customFieldResponse.setAssessmentCustomField(AssessmentCustomField.builder().id(customField.getAssessmentCustomFieldId()).build());
            customFieldResponse.setAssessmentUserRegistration(assessmentUserRegistration);
            customFieldResponses.add(customFieldResponse);
        }
        assessmentUserRegistration.setAssessmentRegistrationCustomFieldResponseList(customFieldResponses);
    }
}
