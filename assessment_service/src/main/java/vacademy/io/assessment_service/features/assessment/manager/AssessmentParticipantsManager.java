package vacademy.io.assessment_service.features.assessment.manager;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.itextpdf.html2pdf.ConverterProperties;
import com.itextpdf.html2pdf.HtmlConverter;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.http.ResponseEntity;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.CollectionUtils;
import org.springframework.util.ObjectUtils;
import org.springframework.util.StringUtils;
import vacademy.io.assessment_service.features.assessment.dto.*;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.request.ProvideReattemptRequestDto;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.request.ReleaseRequestDto;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.request.RespondentFilter;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.*;
import vacademy.io.assessment_service.features.assessment.dto.batch_pending.NotAttemptedParticipants;
import vacademy.io.assessment_service.features.assessment.dto.create_assessment.AssessmentRegistrationsDto;
import vacademy.io.assessment_service.features.assessment.entity.*;
import vacademy.io.assessment_service.features.assessment.enums.*;
import vacademy.io.assessment_service.features.assessment.notification.AssessmentReportNotificationService;
import vacademy.io.assessment_service.features.assessment.repository.*;
import vacademy.io.assessment_service.features.assessment.sort.StableSort;
import vacademy.io.assessment_service.features.assessment.service.HtmlBuilderService;
import vacademy.io.assessment_service.features.assessment.service.QuestionBasedStrategyFactory;
import vacademy.io.assessment_service.features.assessment.service.assessment_get.AssessmentService;
import vacademy.io.assessment_service.features.assessment.service.bulk_entry_services.AssessmentBatchRegistrationService;
import vacademy.io.assessment_service.features.assessment.service.bulk_entry_services.QuestionAssessmentSectionMappingService;
import vacademy.io.assessment_service.features.evaluation.service.QuestionEvaluationService;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.learner_assessment.service.QuestionWiseMarksService;
import vacademy.io.assessment_service.features.notification.service.AssessmentNotificationService;
import vacademy.io.assessment_service.features.question_core.dto.MCQEvaluationDTO;
import vacademy.io.assessment_service.features.question_core.entity.Option;
import vacademy.io.assessment_service.features.question_core.entity.Question;
import vacademy.io.assessment_service.features.question_core.repository.OptionRepository;
import vacademy.io.assessment_service.features.rich_text.dto.AssessmentRichTextDataDTO;
import vacademy.io.assessment_service.features.rich_text.entity.AssessmentRichTextData;
import vacademy.io.assessment_service.features.rich_text.enums.TextType;
import vacademy.io.assessment_service.features.rich_text.repository.AssessmentRichTextRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.core.utils.DateUtil;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.media.service.FileService;
import vacademy.io.common.student.dto.BasicParticipantDTO;

import java.io.ByteArrayOutputStream;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.stream.Collectors;
import java.util.stream.StreamSupport;

import vacademy.io.assessment_service.features.open_evaluation.policy.ApiCandidatePolicy;

import static vacademy.io.common.auth.enums.CompanyStatus.ACTIVE;

@Slf4j
@Component
public class AssessmentParticipantsManager {
    /** The one report per attempt (AI report when it exists, plus report-profile pages). Lazy: avoids a bean cycle. */
    @Autowired
    @org.springframework.context.annotation.Lazy
    vacademy.io.assessment_service.features.assessment.service.aireport.AiReportPdfService aiReportPdfService;

    @Autowired
    AssessmentService assessmentService;

    @Autowired
    vacademy.io.assessment_service.features.assessment.service.AssessmentWorkflowEventPublisher assessmentWorkflowEventPublisher;

    @Autowired
    AssessmentRepository assessmentRepository;

    @Autowired
    AssessmentBatchRegistrationService assessmentBatchRegistrationService;

    @Autowired
    AssessmentUserRegistrationRepository assessmentUserRegistrationRepository;

    @Autowired
    AssessmentCustomFieldRepository assessmentCustomFieldRepository;

    @Autowired
    QuestionAssessmentSectionMappingService questionAssessmentSectionMappingService;

    @Autowired
    QuestionWiseMarksService questionWiseMarksService;

    @Autowired
    StudentAttemptRepository studentAttemptRepository;

    @Autowired
    AssessmentRichTextRepository assessmentRichTextRepository;

    @Autowired
    QuestionEvaluationService questionEvaluationService;

    @Autowired
    OptionRepository optionRepository;

    @Autowired
    AssessmentNotificationMetadataRepository assessmentNotificationMetadataRepository;

    @Autowired
    HtmlBuilderService htmlBuilderService;

    @Autowired
    SectionRepository sectionRepository;

    @Autowired
    AssessmentReportNotificationService assessmentReportNotificationService;

    @Autowired
    vacademy.io.assessment_service.features.assessment.notification.ResultNotificationService resultNotificationService;

    @Autowired
    AssessmentNotificationService assessmentNotificationService;

    @Autowired
    private FileService fileService;

    @Autowired
    @org.springframework.context.annotation.Lazy
    private vacademy.io.assessment_service.features.learner_assessment.service.LearnerReportService learnerReportService;

    @Autowired
    private vacademy.io.assessment_service.features.client.AdminCoreServiceClient adminCoreServiceClient;

    @Autowired
    private vacademy.io.assessment_service.features.assessment.service.batch_pending.NotAttemptedLearnerService notAttemptedLearnerService;

    @Autowired
    private vacademy.io.assessment_service.features.assessment.service.ReleaseStateWriter releaseStateWriter;

    @Autowired
    private vacademy.io.assessment_service.features.assessment.service.ReportPdfRenderService reportPdfRenderService;

    @Autowired
    private vacademy.io.assessment_service.features.assessment.service.ReportPdfUploadService reportPdfUploadService;

    @Transactional
    public ResponseEntity<AssessmentSaveResponseDto> saveParticipantsToAssessment(CustomUserDetails user,
            AssessmentRegistrationsDto assessmentRegistrationsDto, String assessmentId, String instituteId,
            String type) {

        Optional<Assessment> assessmentOptional = assessmentService.getAssessmentWithActiveSections(assessmentId,
                instituteId);

        if (assessmentOptional.isEmpty()) {
            throw new VacademyException("Assessment not found");
        }

        if (!assessmentRegistrationsDto.isClosedTest()) {
            if (assessmentRegistrationsDto.getOpenTestDetails() == null
                    || assessmentRegistrationsDto.getOpenTestDetails().getRegistrationStartDate() == null
                    || assessmentRegistrationsDto.getOpenTestDetails().getRegistrationEndDate() == null) {
                throw new VacademyException("Please provide open test details");
            }
            assessmentOptional.get().setAssessmentVisibility(AssessmentVisibility.PUBLIC.name());
            assessmentRepository.save(assessmentOptional.get());
        } else {
            assessmentOptional.get().setAssessmentVisibility(AssessmentVisibility.PRIVATE.name());
            assessmentRepository.save(assessmentOptional.get());
        }

        preRegisterBatches(
                assessmentRegistrationsDto.getAddedPreRegisterBatchesDetails() == null ? Collections.emptyList()
                        : assessmentRegistrationsDto.getAddedPreRegisterBatchesDetails(),
                instituteId, assessmentOptional.get());
        preRegisterParticipant(user,
                assessmentRegistrationsDto.getAddedPreRegisterStudentsDetails() == null ? Collections.emptyList()
                        : assessmentRegistrationsDto.getAddedPreRegisterStudentsDetails(),
                instituteId, assessmentOptional);
        removeBatches(
                assessmentRegistrationsDto.getDeletedPreRegisterBatchesDetails() == null ? Collections.emptyList()
                        : assessmentRegistrationsDto.getDeletedPreRegisterBatchesDetails(),
                instituteId, assessmentOptional.get());
        removeParticipants(
                assessmentRegistrationsDto.getDeletedPreRegisterStudentsDetails() == null ? Collections.emptyList()
                        : assessmentRegistrationsDto.getDeletedPreRegisterStudentsDetails(),
                instituteId, assessmentOptional.get());
        handleOpenRegistration(assessmentRegistrationsDto.getOpenTestDetails(), assessmentOptional.get());
        handleJoinUrlChange(assessmentRegistrationsDto.getUpdatedJoinLink(), assessmentOptional.get(), instituteId);
        handleAssessmentParticipantNotification(assessmentRegistrationsDto.getNotifyStudent(),
                assessmentRegistrationsDto.getNotifyParent(), assessmentOptional.get(), instituteId);
        return ResponseEntity.ok(
                new AssessmentSaveResponseDto(assessmentOptional.get().getId(), assessmentOptional.get().getStatus()));
    }

    private void handleAssessmentParticipantNotification(AssessmentRegistrationsDto.NotifyStudent notifyStudent,
            AssessmentRegistrationsDto.NotifyParent notifyParent, Assessment assessment, String instituteId) {

        if (assessment == null)
            return;
        AssessmentNotificationMetadata assessmentNotificationMetadata = new AssessmentNotificationMetadata();
        assessmentNotificationMetadata.setAssessment(assessment);

        Optional<AssessmentNotificationMetadata> savedAssessmentNotificationMetadata = assessmentNotificationMetadataRepository
                .findTopByAssessmentId(assessment.getId());

        if (savedAssessmentNotificationMetadata.isPresent())
            assessmentNotificationMetadata = savedAssessmentNotificationMetadata.get();

        // Update fields from notifyStudent
        if (notifyStudent != null) {
            if (notifyStudent.getWhenAssessmentCreated() != null) {
                assessmentNotificationMetadata
                        .setParticipantWhenAssessmentCreated(notifyStudent.getWhenAssessmentCreated());
            }
            if (notifyStudent.getShowLeaderboard() != null) {
                assessmentNotificationMetadata.setParticipantShowLeaderboard(notifyStudent.getShowLeaderboard());
            }
            if (notifyStudent.getBeforeAssessmentGoesLive() != null) {
                assessmentNotificationMetadata
                        .setParticipantBeforeAssessmentGoesLive(notifyStudent.getBeforeAssessmentGoesLive());
            }
            if (notifyStudent.getWhenAssessmentLive() != null) {
                assessmentNotificationMetadata.setParticipantWhenAssessmentLive(notifyStudent.getWhenAssessmentLive());
            }
            if (notifyStudent.getWhenAssessmentReportGenerated() != null) {
                assessmentNotificationMetadata
                        .setParticipantWhenAssessmentReportGenerated(notifyStudent.getWhenAssessmentReportGenerated());
            }
        }

        // Update fields from notifyParent
        if (notifyParent != null) {
            if (notifyParent.getWhenAssessmentCreated() != null) {
                assessmentNotificationMetadata.setParentWhenAssessmentCreated(notifyParent.getWhenAssessmentCreated());
            }
            if (notifyParent.getBeforeAssessmentGoesLive() != null) {
                assessmentNotificationMetadata
                        .setParentBeforeAssessmentGoesLive(notifyParent.getBeforeAssessmentGoesLive());
            }
            if (notifyParent.getShowLeaderboard() != null) {
                assessmentNotificationMetadata.setParentShowLeaderboard(notifyParent.getShowLeaderboard());
            }
            if (notifyParent.getWhenAssessmentLive() != null) {
                assessmentNotificationMetadata.setParentWhenAssessmentLive(notifyParent.getWhenAssessmentLive());
            }
            if (notifyParent.getWhenStudentAppears() != null) {
                assessmentNotificationMetadata.setWhenStudentAppears(notifyParent.getWhenStudentAppears());
            }
            if (notifyParent.getWhenStudentFinishesTest() != null) {
                assessmentNotificationMetadata.setWhenStudentFinishesTest(notifyParent.getWhenStudentFinishesTest());
            }
            if (notifyParent.getWhenAssessmentReportGenerated() != null) {
                assessmentNotificationMetadata
                        .setParentWhenAssessmentReportGenerated(notifyParent.getWhenAssessmentReportGenerated());
            }
        }

        assessmentNotificationMetadataRepository.save(assessmentNotificationMetadata);

    }

    private void handleJoinUrlChange(String updatedJoinLink, Assessment assessment, String instituteId) {
        // TODO: handle join url change
    }

    private void preRegisterParticipant(CustomUserDetails user, List<BasicParticipantDTO> addedParticipants,
            String instituteId, Optional<Assessment> assessmentOptional) {

        Assessment assessment = assessmentOptional.get();
        List<AssessmentUserRegistration> userRegistrations = new ArrayList<>();

        for (BasicParticipantDTO participantDTO : addedParticipants) {
            // Check if the participant is already registered for this assessment
            String participantId = participantDTO.getUserId();
            if (!assessmentUserRegistrationRepository.existsByInstituteIdAndAssessmentIdAndUserId(
                    instituteId, assessment.getId(), participantId)) {
                userRegistrations.add(addUserToAssessment(participantDTO, user.getUserId(), instituteId, assessment));
            }
        }

        // Only save if there are any new registrations
        if (!userRegistrations.isEmpty()) {
            assessmentUserRegistrationRepository.saveAll(userRegistrations);
        }
    }

    private void handleOpenRegistration(AssessmentRegistrationsDto.OpenTestDetails openTestDetails,
            Assessment assessment) {
        if (ObjectUtils.isEmpty(openTestDetails))
            return;

        if (!ObjectUtils.isEmpty(openTestDetails.getRegistrationStartDate())) {
            assessment.setRegistrationOpenDate(
                    DateUtil.convertStringToUTCDate(openTestDetails.getRegistrationStartDate()));
        }

        if (!ObjectUtils.isEmpty(openTestDetails.getRegistrationEndDate())) {
            assessment.setRegistrationCloseDate(
                    DateUtil.convertStringToUTCDate(openTestDetails.getRegistrationEndDate()));
        }

        if (!ObjectUtils.isEmpty(openTestDetails.getInstructionsHtml())) {
            assessment.setRegistrationInstructions(
                    new AssessmentRichTextData(null, TextType.HTML.name(), openTestDetails.getInstructionsHtml()));
            assessmentRepository.save(assessment);
        }

        if (!ObjectUtils.isEmpty(openTestDetails.getRegistrationFormDetails())) {
            addCustomRegistrationFieldsToAssessment(openTestDetails, assessment);
            updateCustomRegistrationFieldsToAssessment(openTestDetails, assessment);
            removeAddedFieldsIfAny(openTestDetails, assessment);
        }

    }

    private void removeAddedFieldsIfAny(AssessmentRegistrationsDto.OpenTestDetails openTestDetails,
            Assessment assessment) {
        List<RegistrationFieldDto> removed = openTestDetails.getRegistrationFormDetails().getRemovedCustomAddedFields();
        if (removed == null || removed.isEmpty()) return;
        List<String> deletedFieldKeys = removed.stream().map(RegistrationFieldDto::getKey).toList();
        if (!deletedFieldKeys.isEmpty()) {
            assessmentCustomFieldRepository.softDeleteByAssessmentIdAndFieldKeys(assessment.getId(), deletedFieldKeys);
        }
    }

    private void addCustomRegistrationFieldsToAssessment(AssessmentRegistrationsDto.OpenTestDetails openTestDetails,
            Assessment assessment) {
        List<AssessmentCustomField> customFields = new ArrayList<>();
        for (RegistrationFieldDto registrationFieldDto : openTestDetails.getRegistrationFormDetails()
                .getAddedCustomAddedFields()) {
            customFields.add(createRegistrationField(registrationFieldDto, assessment));
        }
        assessmentCustomFieldRepository.saveAll(customFields);
    }

    private void updateCustomRegistrationFieldsToAssessment(AssessmentRegistrationsDto.OpenTestDetails openTestDetails,
            Assessment assessment) {
        List<AssessmentCustomField> customFields = new ArrayList<>();
        for (RegistrationFieldDto registrationFieldDto : openTestDetails.getRegistrationFormDetails()
                .getUpdatedCustomAddedFields()) {
            Optional<AssessmentCustomField> assessmentCustomField = resolveFieldToUpdate(registrationFieldDto,
                    assessment);
            if (assessmentCustomField.isEmpty())
                continue;
            customFields.add(updateRegistrationField(assessmentCustomField.get(), registrationFieldDto, assessment));
        }
        assessmentCustomFieldRepository.saveAll(customFields);
    }

    /**
     * Id first, field key second. A rename rewrites field_key from the new name, so the key the
     * client is still holding no longer matches anything — matching on the row id keeps editing a
     * field twice from silently doing nothing. The key lookup remains for clients that send no id
     * and for rows the client only knows by key.
     */
    private Optional<AssessmentCustomField> resolveFieldToUpdate(RegistrationFieldDto dto, Assessment assessment) {
        if (StringUtils.hasText(dto.getId())) {
            Optional<AssessmentCustomField> byId = assessmentCustomFieldRepository.findById(dto.getId())
                    // An id from another assessment must never be editable through this request.
                    .filter(field -> field.getAssessment() != null
                            && assessment.getId().equals(field.getAssessment().getId()));
            if (byId.isPresent())
                return byId;
        }
        return assessmentCustomFieldRepository.findByFieldKeyAndAssessment(dto.getKey(), assessment);
    }

    private AssessmentCustomField createRegistrationField(RegistrationFieldDto registrationFieldDto,
            Assessment assessment) {
        AssessmentCustomField assessmentCustomField = new AssessmentCustomField();
        assessmentCustomField.setAssessment(assessment);
        assessmentCustomField.setFieldKey(registrationFieldDto.getName().toLowerCase().trim().replace(" ", "_"));
        assessmentCustomField.setFieldName(registrationFieldDto.getName().trim());
        assessmentCustomField.setFieldOrder(
                (registrationFieldDto.getOrderField() == null) ? 0 : registrationFieldDto.getOrderField());
        assessmentCustomField.setFieldType(registrationFieldDto.getType().trim());
        assessmentCustomField.setIsMandatory(registrationFieldDto.getIsMandatory());
        assessmentCustomField.setStatus(ACTIVE.name());
        assessmentCustomField.setCommaSeparatedOptions(registrationFieldDto.getCommaSeparatedOptions());
        assessmentCustomField.setConfig(registrationFieldDto.getConfig());
        return assessmentCustomField;
    }

    private AssessmentCustomField updateRegistrationField(AssessmentCustomField assessmentCustomField,
            RegistrationFieldDto registrationFieldDto, Assessment assessment) {
        assessmentCustomField.setAssessment(assessment);
        assessmentCustomField.setFieldKey(registrationFieldDto.getName().toLowerCase().trim().replace(" ", "_"));
        assessmentCustomField.setFieldName(registrationFieldDto.getName().trim());
        assessmentCustomField.setFieldType(registrationFieldDto.getType().trim());
        assessmentCustomField.setIsMandatory(registrationFieldDto.getIsMandatory());
        assessmentCustomField.setStatus(ACTIVE.name());
        assessmentCustomField.setCommaSeparatedOptions(registrationFieldDto.getCommaSeparatedOptions());
        // Null means the client said nothing about settings, so keep the stored ones; an empty
        // string is an explicit "clear it".
        if (registrationFieldDto.getConfig() != null) {
            assessmentCustomField.setConfig(registrationFieldDto.getConfig());
        }
        // Reordering an existing field arrives through this path, so skipping the
        // order here made drag-and-drop silently no-op. Leave it alone when the
        // client omits it rather than collapsing every field to 0.
        if (registrationFieldDto.getOrderField() != null) {
            assessmentCustomField.setFieldOrder(registrationFieldDto.getOrderField());
        }
        return assessmentCustomField;
    }

    private void preRegisterBatches(List<String> addedBatches, String instituteId, Assessment assessment) {
        List<AssessmentBatchRegistration> batchRegistrations = new ArrayList<>();
        for (String batchId : addedBatches) {
            // Check if registration already exists before adding
            if (!assessmentBatchRegistrationService.existsByInstituteAndAssessmentAndBatch(
                    instituteId, assessment.getId(), batchId)) {
                batchRegistrations.add(addBatchToAssessment(instituteId, batchId, assessment));
            }
        }
        // Only save if there are any new registrations
        if (!batchRegistrations.isEmpty()) {
            assessmentBatchRegistrationService.addMultipleRegistrations(batchRegistrations);
        }
    }

    private void removeBatches(List<String> deletedBatches, String instituteId, Assessment assessment) {
        if (deletedBatches.isEmpty())
            return;
        assessmentBatchRegistrationService.hardDeleteRegistrationsByIds(deletedBatches, instituteId,
                assessment.getId());
    }

    private void removeParticipants(List<BasicParticipantDTO> deletedParticipants, String instituteId,
            Assessment assessment) {
        if (deletedParticipants.isEmpty())
            return;
        assessmentUserRegistrationRepository.hardDeleteByAssessmentIdAndUserIdsAndInstituteId(assessment.getId(),
                deletedParticipants.stream().map(BasicParticipantDTO::getUserId).toList(), instituteId);
    }

    AssessmentBatchRegistration addBatchToAssessment(String instituteId, String batchId, Assessment assessment) {

        AssessmentBatchRegistration assessmentBatchRegistration = new AssessmentBatchRegistration();
        assessmentBatchRegistration.setAssessment(assessment);
        assessmentBatchRegistration.setBatchId(batchId);
        assessmentBatchRegistration.setInstituteId(instituteId);
        assessmentBatchRegistration.setStatus(ACTIVE.name());
        assessmentBatchRegistration.setRegistrationTime(new Date());
        return assessmentBatchRegistration;
    }

    AssessmentUserRegistration addUserToAssessment(BasicParticipantDTO basicParticipantDTO, String adminUserId,
            String instituteId, Assessment assessment) {
        AssessmentUserRegistration assessmentParticipantRegistration = new AssessmentUserRegistration();
        assessmentParticipantRegistration.setAssessment(assessment);
        assessmentParticipantRegistration.setUserId(basicParticipantDTO.getUserId());
        assessmentParticipantRegistration.setUsername(basicParticipantDTO.getUsername());
        assessmentParticipantRegistration.setParticipantName(basicParticipantDTO.getFullName());
        assessmentParticipantRegistration.setPhoneNumber(basicParticipantDTO.getMobileNumber());
        assessmentParticipantRegistration.setFaceFileId(basicParticipantDTO.getFileId());
        assessmentParticipantRegistration.setUserEmail(basicParticipantDTO.getEmail());
        assessmentParticipantRegistration
                .setReattemptCount((basicParticipantDTO.getReattemptCount() == null) ? assessment.getReattemptCount()
                        : basicParticipantDTO.getReattemptCount());
        assessmentParticipantRegistration.setInstituteId(instituteId);
        assessmentParticipantRegistration.setStatus(ACTIVE.name());
        assessmentParticipantRegistration.setSource(UserRegistrationSources.ADMIN_PRE_REGISTRATION.name());
        assessmentParticipantRegistration.setSourceId(adminUserId);
        assessmentParticipantRegistration.setRegistrationTime(new Date());
        return assessmentParticipantRegistration;
    }

    /**
     * Grants extra attempt(s) to already-registered participants by bumping the
     * {@code reattempt_count} on their AssessmentUserRegistration. This is the
     * "Provide Reattempt" admin action — there is no separate attempt row to
     * create; the learner is gated by reattempt_count vs attempts already taken.
     */
    @Transactional
    public ResponseEntity<String> provideReattempt(CustomUserDetails user, String assessmentId, String instituteId,
            ProvideReattemptRequestDto request) {
        if (request == null || request.getRegistrationIds() == null || request.getRegistrationIds().isEmpty())
            throw new VacademyException("No participants selected for reattempt");

        int attemptsToGrant = (request.getReattemptCount() == null || request.getReattemptCount() < 1)
                ? 1
                : request.getReattemptCount();

        List<AssessmentUserRegistration> registrations = assessmentUserRegistrationRepository
                .findAllById(request.getRegistrationIds());

        // Only touch registrations that actually belong to this assessment (and
        // institute, when provided) so a stale/forged id can't bump a different
        // assessment's count.
        List<AssessmentUserRegistration> toUpdate = registrations.stream()
                .filter(registration -> registration.getAssessment() != null
                        && assessmentId.equals(registration.getAssessment().getId())
                        && (instituteId == null || instituteId.equals(registration.getInstituteId())))
                .collect(Collectors.toList());

        if (toUpdate.isEmpty())
            throw new VacademyException("No matching participants found for this assessment");

        for (AssessmentUserRegistration registration : toUpdate) {
            int current = (registration.getReattemptCount() == null) ? 0 : registration.getReattemptCount();
            registration.setReattemptCount(current + attemptsToGrant);
        }
        assessmentUserRegistrationRepository.saveAll(toUpdate);

        // Trigger ASSESSMENT_REATTEMPT_GRANTED workflow. Every registration in toUpdate was
        // filtered to this assessment above, so the first one's assessment is the right one
        // for all of them.
        assessmentWorkflowEventPublisher.publishReattemptGranted(toUpdate,
                toUpdate.get(0).getAssessment(), attemptsToGrant,
                user != null ? user.getUserId() : null);

        return ResponseEntity.ok("Reattempt granted to " + toUpdate.size() + " participant(s)");
    }

    public ResponseEntity<List<AssessmentUserRegistration>> assessmentAdminParticipants(CustomUserDetails user,
            String instituteId, String assessmentId) {

        Optional<Assessment> assessmentOptional = assessmentRepository.findByAssessmentIdAndInstituteId(assessmentId,
                instituteId);

        if (assessmentOptional.isEmpty()) {
            return ResponseEntity.ok().body(List.of());
        }
        List<AssessmentUserRegistration> assessmentUserRegistrations = assessmentOptional.get().getUserRegistrations()
                .stream().toList();
        return ResponseEntity.ok(assessmentUserRegistrations);
    }

    public ClosedAssessmentParticipantsResponse getAllParticipantsForClosedAssessment(CustomUserDetails user,
            String instituteId, String assessmentId, AssessmentUserFilter filter, Integer pageNo, Integer pageSize) {
        if (Objects.isNull(filter))
            throw new VacademyException("Invalid Filter Request");
        Sort sortingColumns = createSortObject(filter.getSortColumns());

        Pageable pageable = PageRequest.of(pageNo, pageSize, sortingColumns);
        Page<ParticipantsDetailsDto> registeredUserPage = null;

        // Handle Case for BATCH REGISTRATION
        if (filter.getRegistrationSource().equals(UserRegistrationSources.BATCH_PREVIEW_REGISTRATION.name())) {
            registeredUserPage = handleCaseForBatchRegistration(assessmentId, instituteId, filter, pageable);
        }
        // Handle Case for ADMIN PRE REGISTRATION
        else if (filter.getRegistrationSource().equals(UserRegistrationSources.ADMIN_PRE_REGISTRATION.name())) {
            registeredUserPage = handleCaseForAdminPreRegistration(assessmentId, instituteId, filter, pageable);
        } else
            throw new VacademyException("Invalid Source Request");

        return createAllRegisteredUserForClosedTest(registeredUserPage);
    }

    /**
     * Handles the case for admin pre-registration by fetching the list of
     * registered users
     * based on the given filter conditions.
     */
    private Page<ParticipantsDetailsDto> handleCaseForAdminPreRegistration(
            String assessmentId,
            String instituteId,
            AssessmentUserFilter filter,
            Pageable pageable) {

        Page<ParticipantsDetailsDto> registeredUserPage = null;

        // Check if the attempt type is "PENDING"
        if (isPendingAttempt(filter)) {

            // If a name filter is provided, search for pre-registered and pending users
            // with name filtering
            if (StringUtils.hasText(filter.getName())) {
                registeredUserPage = assessmentUserRegistrationRepository
                        .findUserRegistrationWithFilterWithSearchForPreRegistrationAndPending(
                                filter.getName(), assessmentId, instituteId, filter.getStatus(),
                                filter.getRegistrationSource(), pageable);
            }

            // If no results found, search for admin pre-registered and pending users
            if (Objects.isNull(registeredUserPage)) {
                registeredUserPage = assessmentUserRegistrationRepository
                        .findUserRegistrationWithFilterAdminPreRegistrationAndPending(
                                assessmentId, instituteId, filter.getStatus(),
                                filter.getRegistrationSource(), pageable);
            }

        } else {
            // If a name filter is provided, search for users with name filtering
            if (StringUtils.hasText(filter.getName())) {
                registeredUserPage = assessmentUserRegistrationRepository
                        .findUserRegistrationWithFilterWithSearchForSource(
                                filter.getName(), assessmentId, instituteId, filter.getStatus(),
                                filter.getAttemptType(), filter.getRegistrationSource(),
                                evaluationStatusFilter(filter.getEvaluationStatus()),
                                evaluationStatusFilter(filter.getSubmissionStatus()), pageable);
            }

            // If no results found, search for users based on batch, attempt type, and
            // registration source
            if (Objects.isNull(registeredUserPage)) {
                registeredUserPage = assessmentUserRegistrationRepository
                        .findUserRegistrationWithFilterForSource(
                                assessmentId, instituteId, filter.getBatches(),
                                filter.getAttemptType(), filter.getRegistrationSource(),
                                evaluationStatusFilter(filter.getEvaluationStatus()),
                                evaluationStatusFilter(filter.getSubmissionStatus()), pageable);
            }
        }

        // Return the filtered list of registered users
        return registeredUserPage;
    }

    private Page<ParticipantsDetailsDto> handleCaseForBatchRegistration(String assessmentId, String instituteId,
            AssessmentUserFilter filter, Pageable pageable) {
        Page<ParticipantsDetailsDto> registeredUserPage = null;
        if (isPendingAttempt(filter)) {
            registeredUserPage = findBatchLearnersWhoNeverAttempted(assessmentId, instituteId, filter, pageable);
        } else {
            // Handle Case for Attempted case i.e LIVE,PREVIEW,ENDED
            if (StringUtils.hasText(filter.getName())) {
                registeredUserPage = assessmentUserRegistrationRepository
                        .findUserRegistrationWithFilterWithSearchForBatch(filter.getName(), assessmentId, instituteId,
                                filter.getBatches(), filter.getStatus(), filter.getAttemptType(),
                                evaluationStatusFilter(filter.getEvaluationStatus()),
                                evaluationStatusFilter(filter.getSubmissionStatus()), pageable);
            }
            if (Objects.isNull(registeredUserPage)) {
                registeredUserPage = assessmentUserRegistrationRepository.findUserRegistrationWithFilterForBatch(
                        assessmentId, instituteId, filter.getBatches(), filter.getStatus(), filter.getAttemptType(),
                        evaluationStatusFilter(filter.getEvaluationStatus()),
                                evaluationStatusFilter(filter.getSubmissionStatus()), pageable);
            }
        }

        return registeredUserPage;
    }

    /**
     * Learners enrolled in this assessment's batches who never attempted it — the Pending
     * tab for Batch Selection.
     *
     * <p>This cannot be a query in this database. A batch-enrolled learner gets NO
     * {@code assessment_user_registration} row until they actually start the test, so the
     * "never attempted" set does not exist here at all; only admin_core knows who is in
     * the batch. So: take batch enrollment from admin_core, subtract everyone who has an
     * attempt, sort and page the remainder.
     *
     * <p><b>Load.</b> The submissions page asks for this count on every mount, so the
     * expensive part must not run per request:
     * <ul>
     *   <li>Enrollment comes from a cached client call, keyed on institute + batch set, so
     *       repeat mounts, tab switches and paging share one admin_core round trip.</li>
     *   <li>The exclusion is applied HERE, not pushed into admin_core's SQL as an array.
     *       That predicate is unestimable and a generic plan re-evaluates it per row —
     *       measured on prod, 22ms became 434-880ms, intermittently. Without it the
     *       admin_core query is plan-stable at 22ms/28ms on the largest batch in prod.</li>
     *   <li>An assessment with no batch registrations short-circuits before any HTTP or
     *       DB work.</li>
     * </ul>
     *
     * <p>Ordering matches the rest of the submissions list: learner name, then user id as
     * a tie-breaker, so paging is stable (see {@code StableSort}).
     */
    /**
     * Learners enrolled in this assessment's batches who never attempted it — the Pending
     * tab for Batch Selection.
     *
     * <p>The resolution itself lives in {@link NotAttemptedLearnerService} because the CSV
     * export asks the same question, and the two must never disagree about who is on the
     * list. This method only pages the answer.
     */
    private Page<ParticipantsDetailsDto> findBatchLearnersWhoNeverAttempted(
            String assessmentId, String instituteId, AssessmentUserFilter filter, Pageable pageable) {
        return NotAttemptedParticipants.page(
                NotAttemptedParticipants.toRows(
                        notAttemptedLearnerService.findNotAttempted(assessmentId, instituteId, filter)),
                pageable);
    }

    /**
     * Retrieves all participants for an open assessment based on the provided
     * filter criteria.
     *
     * @param user         The authenticated user details.
     * @param instituteId  The ID of the institute.
     * @param assessmentId The ID of the assessment.
     * @param filter       The filter criteria for fetching participants.
     * @param pageNo       The page number for pagination.
     * @param pageSize     The size of each page for pagination.
     * @return A {@link ClosedAssessmentParticipantsResponse} containing the list of
     *         participants.
     * @throws VacademyException if the filter is null.
     */
    public ClosedAssessmentParticipantsResponse getAllParticipantsForOpenAssessment(
            CustomUserDetails user,
            String instituteId,
            String assessmentId,
            AssessmentUserFilter filter,
            Integer pageNo,
            Integer pageSize) {

        // Validate the filter
        if (Objects.isNull(filter)) {
            throw new VacademyException("Invalid Filter Request");
        }

        // Create sorting object based on filter parameters
        Sort sortingColumns = createSortObject(filter.getSortColumns());

        // Define pagination settings
        Pageable pageable = PageRequest.of(pageNo, pageSize, sortingColumns);
        Page<ParticipantsDetailsDto> registeredUserPage = null;

        // Check if the assessment attempt is pending
        if (isPendingAttempt(filter)) {

            // If a name filter is provided, search with name-based filtering
            if (StringUtils.hasText(filter.getName())) {
                registeredUserPage = assessmentUserRegistrationRepository
                        .findUserRegistrationWithFilterWithSearchForPreRegistrationAndPending(
                                filter.getName(), assessmentId, instituteId, filter.getStatus(),
                                filter.getRegistrationSource(), pageable);
            }

            // If no results are found, perform a broader search
            if (Objects.isNull(registeredUserPage)) {
                registeredUserPage = assessmentUserRegistrationRepository
                        .findUserRegistrationWithFilterAdminPreRegistrationAndPending(
                                assessmentId, instituteId, filter.getStatus(),
                                filter.getRegistrationSource(), pageable);
            }

        } else {
            // If a name filter is provided, search with name-based filtering
            if (StringUtils.hasText(filter.getName())) {
                registeredUserPage = assessmentUserRegistrationRepository
                        .findUserRegistrationWithFilterWithSearchForSource(
                                filter.getName(), assessmentId, instituteId, filter.getStatus(),
                                filter.getAttemptType(), filter.getRegistrationSource(),
                                evaluationStatusFilter(filter.getEvaluationStatus()),
                                evaluationStatusFilter(filter.getSubmissionStatus()), pageable);
            }

            // If no results are found, perform a broader search
            if (Objects.isNull(registeredUserPage)) {
                registeredUserPage = assessmentUserRegistrationRepository
                        .findUserRegistrationWithFilterForSource(
                                assessmentId, instituteId, filter.getStatus(),
                                filter.getAttemptType(), filter.getRegistrationSource(),
                                evaluationStatusFilter(filter.getEvaluationStatus()),
                                evaluationStatusFilter(filter.getSubmissionStatus()), pageable);
            }
        }

        // Convert the retrieved data into the required response format
        return createAllRegisteredUserForClosedTest(registeredUserPage);
    }

    private ClosedAssessmentParticipantsResponse createAllRegisteredUserForClosedTest(
            Page<ParticipantsDetailsDto> registrationPage) {
        if (Objects.isNull(registrationPage)) {
            return ClosedAssessmentParticipantsResponse.builder().content(new ArrayList<>())
                    .pageNo(0)
                    .pageSize(0)
                    .last(true)
                    .totalPages(0)
                    .totalElements(0)
                    .build();
        }

        List<ParticipantsDetailsDto> content = registrationPage.getContent();
        return ClosedAssessmentParticipantsResponse.builder().content(content)
                .pageNo(registrationPage.getNumber())
                .pageSize(registrationPage.getSize())
                .last(registrationPage.isLast())
                .totalPages(registrationPage.getTotalPages())
                .totalElements(registrationPage.getTotalElements()).build();
    }

    // Fallback order for the participant/submission list when the client sends no
    // sort (which is the default — the admin table only sets sort_columns once a
    // header is clicked). Alphabetical by learner is what an evaluator working
    // down the list expects; the DB collation is en_US.UTF-8, so this reads
    // naturally rather than grouping by case.
    private static final Sort DEFAULT_PARTICIPANT_SORT = Sort.by(Sort.Order.asc("studentName"));

    // Unique-per-row tie-breakers. (registrationId, attemptId) is unique in every
    // one of these queries — a registration with several attempts yields one row
    // per attempt, so registrationId alone is not enough. Both are SELECT aliases
    // in all six paged participant queries.
    private static final String[] PARTICIPANT_TIE_BREAKERS = { "registrationId", "attemptId" };

    // Sorting Object to Sort the values.
    //
    // Never returns Sort.unsorted(): these are native queries with no ORDER BY of
    // their own, so an unsorted Pageable let Postgres hand back rows in heap
    // order. Grading a submission rewrites its student_attempt row to a new heap
    // slot, which reshuffled the list under the evaluator and — with LIMIT/OFFSET
    // paging — could show one learner twice while skipping another entirely.
    private Sort createSortObject(Map<String, String> sortColumns) {
        return StableSort.withStableOrder(sortColumns, DEFAULT_PARTICIPANT_SORT, PARTICIPANT_TIE_BREAKERS);
    }

    // Sentinel used when no evaluation-status filter is applied. The native queries
    // guard with `('__ALL__' IN (:evaluationStatus) OR ...)`, so this value makes the
    // guard pass for every row. We deliberately pass a non-empty, non-null list here:
    // a null collection breaks the native `IN (:param)` binding, and an empty list
    // renders `IN ()` which is invalid SQL in Postgres.
    private static final List<String> EVALUATION_STATUS_NO_FILTER = List.of("__ALL__");

    private List<String> evaluationStatusFilter(List<String> values) {
        return (values == null || values.isEmpty()) ? EVALUATION_STATUS_NO_FILTER : values;
    }

    /**
     * Retrieves all participants for a given assessment based on the provided
     * filter.
     *
     * @param user         The authenticated user details.
     * @param instituteId  The ID of the institute.
     * @param assessmentId The ID of the assessment.
     * @param filter       The filter criteria for fetching participants.
     * @param pageNo       The page number for pagination.
     * @param pageSize     The size of each page for pagination.
     * @return ResponseEntity containing a list of participants matching the
     *         criteria.
     * @throws VacademyException if the filter is invalid or the assessment type is
     *                           null.
     */
    public ResponseEntity<ClosedAssessmentParticipantsResponse> getAllParticipantsForAssessment(
            CustomUserDetails user,
            String instituteId,
            String assessmentId,
            AssessmentUserFilter filter,
            Integer pageNo,
            Integer pageSize) {

        // Validate the filter and ensure it contains an assessment type
        if (Objects.isNull(filter) || Objects.isNull(filter.getAssessmentType())) {
            throw new VacademyException("Invalid Filter Request");
        }

        // Determine whether to fetch participants for an open or closed assessment
        ClosedAssessmentParticipantsResponse response = filter.getAssessmentType()
                .equals(AssessmentVisibility.PUBLIC.name())
                        ? getAllParticipantsForOpenAssessment(user, instituteId, assessmentId, filter, pageNo, pageSize)
                        : getAllParticipantsForClosedAssessment(user, instituteId, assessmentId, filter, pageNo,
                                pageSize);

        return ResponseEntity.ok(response);
    }

    /**
     * Checks if the assessment attempt is pending based on the provided filter.
     *
     * @param filter The assessment user filter.
     * @return true if there is only one attempt type and it is "PENDING", otherwise
     *         false.
     */
    private boolean isPendingAttempt(AssessmentUserFilter filter) {
        // Return false if the filter is null
        if (Objects.isNull(filter)) {
            return false;
        }

        // Check if the only attempt type in the filter is "PENDING"
        return filter.getAttemptType().size() == 1 &&
                filter.getAttemptType().get(0).equals(UserRegistrationFilterEnum.PENDING.name());
    }

    public Integer getAssessmentCountForUserId(CustomUserDetails user, String instituteId, List<String> batchId) {
        Integer userAssessmentCount = assessmentUserRegistrationRepository.countDistinctAssessmentsByUserAndFilters(
                user.getId(),
                instituteId,
                List.of(ACTIVE.name()),
                List.of(UserRegistrationSources.ADMIN_PRE_REGISTRATION.name(),
                        UserRegistrationSources.OPEN_REGISTRATION.name()),
                List.of(AssessmentStatus.PUBLISHED.name()) // Corrected List format
        );

        Integer batchAssessmentCount = assessmentBatchRegistrationService.countAssessmentsForBatch(batchId, user,
                instituteId);

        return userAssessmentCount + batchAssessmentCount; // Correct sum operation
    }

    public ResponseEntity<StudentReportOverallDetailDto> getStudentReportDetails(CustomUserDetails userDetails,
            String assessmentId, String attemptId, String instituteId) {
        return ResponseEntity.ok(createStudentReportDetailResponse(assessmentId, attemptId, instituteId));
    }

    public StudentReportOverallDetailDto createStudentReportDetailResponse(String assessmentId, String attemptId,
            String instituteId) {
        Optional<StudentAttempt> studentAttempt = studentAttemptRepository.findById(attemptId);
        if (studentAttempt.isEmpty())
            throw new VacademyException("Attempt Not Found");

        List<Section> sections = sectionRepository.findByAssessmentIdAndStatusNotIn(assessmentId, List.of("DELETED"));
        List<String> sectionIds = sections.stream().map(Section::getId).toList();

        if (CollectionUtils.isEmpty(sectionIds)) {
            throw new VacademyException("No Sections Found for the Given Assessment");
        }

        List<QuestionAssessmentSectionMapping> mappings = questionAssessmentSectionMappingService
                .getQuestionAssessmentSectionMappingBySectionIds(sectionIds);

        ParticipantsQuestionOverallDetailDto questionOverallDetailDto = studentAttemptRepository
                .findParticipantsQuestionOverallDetails(assessmentId, instituteId, attemptId);

        return StudentReportOverallDetailDto.builder()
                .allSections(generateStudentReport(mappings, attemptId, buildQuestionOrderMap(mappings)))
                .questionOverallDetailDto(questionOverallDetailDto)
                .evaluatedFileId(studentAttempt.get().getEvaluatedFileId())
                .responseFileId(extractAttemptDataFileId(studentAttempt.get().getAttemptData(), "fileId"))
                .reportFileId(extractAttemptDataFileId(studentAttempt.get().getAttemptData(), "reportFileId"))
                .build();
    }

    /**
     * Context-aware overload (PR2, bulk report export): reuses the
     * already-loaded {@code ctx.sections} and
     * {@code ctx.questionOrderByQuestionAndSection} instead of re-querying
     * them per student (plan C4). Only {@code findById(attemptId)} and
     * {@code findParticipantsQuestionOverallDetails} run here.
     *
     * <p>The 3-arg overload above deliberately keeps its own body rather than
     * delegating to this one — delegating would force every existing caller
     * (AdminExportManager per-student download, both LearnerReportService
     * entry points) to pay for a full loadClassContext, which is a latency
     * regression for those call sites (ARCHITECTURE.md §5.2, assumption A4).
     */
    public StudentReportOverallDetailDto createStudentReportDetailResponse(
            vacademy.io.assessment_service.features.learner_assessment.dto.ReportClassContext ctx,
            String attemptId, String instituteId) {
        Optional<StudentAttempt> studentAttempt = studentAttemptRepository.findById(attemptId);
        if (studentAttempt.isEmpty())
            throw new VacademyException("Attempt Not Found");

        ParticipantsQuestionOverallDetailDto questionOverallDetailDto = studentAttemptRepository
                .findParticipantsQuestionOverallDetails(ctx.getAssessmentId(), instituteId, attemptId);

        return StudentReportOverallDetailDto.builder()
                .allSections(generateStudentReportFromContext(ctx, attemptId))
                .questionOverallDetailDto(questionOverallDetailDto)
                .evaluatedFileId(studentAttempt.get().getEvaluatedFileId())
                .responseFileId(extractAttemptDataFileId(studentAttempt.get().getAttemptData(), "fileId"))
                .build();
    }

    private Map<String, List<StudentReportAnswerReviewDto>> generateStudentReportFromContext(
            vacademy.io.assessment_service.features.learner_assessment.dto.ReportClassContext ctx, String attemptId) {
        List<vacademy.io.assessment_service.features.learner_assessment.dto.context.SectionSnapshot> sections = ctx.getSections();
        if (CollectionUtils.isEmpty(sections)) {
            return new HashMap<>();
        }
        Map<String, Integer> orderByKey = ctx.getQuestionOrderByQuestionAndSection();

        Map<String, List<StudentReportAnswerReviewDto>> result = new HashMap<>();
        for (vacademy.io.assessment_service.features.learner_assessment.dto.context.SectionSnapshot section : sections) {
            String sectionId = section.id();
            List<String> questionIds = orderByKey.keySet().stream()
                    .filter(k -> k.endsWith('#' + sectionId))
                    .map(k -> k.substring(0, k.length() - sectionId.length() - 1))
                    .toList();
            result.put(sectionId, getQuestionReviewForAttempt(sectionId, questionIds, attemptId, orderByKey));
        }
        return result;
    }

    // PR1 (bulk report export, C3 fix): the mappings are already bulk-loaded above
    // (getQuestionAssessmentSectionMappingBySectionIds). Build a lookup keyed by
    // "questionId#sectionId" so buildStudentReportReview no longer re-queries
    // getMappingById once per question per student.
    //
    // Semantics caveat (must be preserved): getMappingById ->
    // findByQuestionIdAndSectionId is `ORDER BY created_at DESC LIMIT 1`, but this
    // bulk loader is unordered and undeduped. The merge below picks the greatest
    // createdAt for a given (question, section) pair so the replacement is
    // behaviour-identical when duplicate mapping rows exist.
    private static String questionOrderMapKey(String questionId, String sectionId) {
        return questionId + '#' + sectionId;
    }

    private static Map<String, Integer> buildQuestionOrderMap(List<QuestionAssessmentSectionMapping> mappings) {
        if (CollectionUtils.isEmpty(mappings)) {
            return new HashMap<>();
        }
        Map<String, QuestionAssessmentSectionMapping> newest = new HashMap<>();
        for (QuestionAssessmentSectionMapping m : mappings) {
            if (m.getQuestion() == null || m.getSection() == null) {
                continue;
            }
            String key = questionOrderMapKey(m.getQuestion().getId(), m.getSection().getId());
            newest.merge(key, m, (a, b) -> {
                Date da = a.getCreatedAt();
                Date db = b.getCreatedAt();
                if (da == null) return b;
                if (db == null) return a;
                return db.after(da) ? b : a;
            });
        }
        Map<String, Integer> out = new HashMap<>(newest.size() * 2);
        newest.forEach((k, m) -> out.put(k, m.getQuestionOrder()));
        return out;
    }

    // The attempt stores admin-attached file ids inside its attemptData JSON —
    // "fileId" (the learner's submitted answer sheet, for "view submitted") and
    // "reportFileId" (an uploaded result report). Parse defensively.
    private String extractAttemptDataFileId(String attemptData, String key) {
        if (attemptData == null || attemptData.isBlank()) return null;
        try {
            Map<String, Object> jsonMap = new ObjectMapper().readValue(attemptData, Map.class);
            Object fileId = jsonMap.get(key);
            return fileId != null ? fileId.toString() : null;
        } catch (Exception e) {
            return null;
        }
    }

    private Map<String, List<StudentReportAnswerReviewDto>> generateStudentReport(
            List<QuestionAssessmentSectionMapping> mappings, String attemptId, Map<String, Integer> orderByKey) {
        if (CollectionUtils.isEmpty(mappings)) {
            return new HashMap<>();
        }

        Map<String, List<String>> sectionToQuestionsMap = mappings.stream()
                .collect(Collectors.groupingBy(
                        mapping -> mapping.getSection().getId(), // Group by sectionId
                        Collectors.mapping(mapping -> mapping.getQuestion().getId(), Collectors.toList()) // Collect
                                                                                                          // questionIds
                ));

        return sectionToQuestionsMap.entrySet().stream()
                .collect(Collectors.toMap(
                        Map.Entry::getKey,
                        entry -> getQuestionReviewForAttempt(entry.getKey(), entry.getValue(), attemptId, orderByKey)));

    }

    private List<StudentReportAnswerReviewDto> getQuestionReviewForAttempt(String sectionId, List<String> questionIds,
            String attemptId, Map<String, Integer> orderByKey) {
        if (CollectionUtils.isEmpty(questionIds)) {
            return Collections.emptyList();
        }

        List<QuestionWiseMarks> questionWiseMarksList = questionWiseMarksService
                .getAllQuestionWiseMarksForQuestionIdsAndAttemptId(attemptId, questionIds, sectionId);

        if (CollectionUtils.isEmpty(questionWiseMarksList)) {
            return Collections.emptyList();
        }

        return questionWiseMarksList.stream()
                .map(qwm -> buildStudentReportReview(qwm, orderByKey))
                .filter(Objects::nonNull) // Remove any null results
                .toList();
    }

    private StudentReportAnswerReviewDto buildStudentReportReview(QuestionWiseMarks questionWiseMarks,
            Map<String, Integer> orderByKey) {
        try {
            if (questionWiseMarks == null || questionWiseMarks.getQuestion() == null) {
                return null; // Avoid throwing an exception, instead return null to filter later
            }

            String mappingKey = questionOrderMapKey(questionWiseMarks.getQuestion().getId(),
                    questionWiseMarks.getSection().getId());
            Integer questionOrder = orderByKey.get(mappingKey);
            if (questionOrder == null) {
                // Preserves pre-PR1 behaviour: getMappingById returned null, an explicit
                // exception fired, and the catch below swallowed it — the question was
                // silently dropped from the report by the caller's filter(Objects::nonNull).
                throw new VacademyException("Section and Question Mapping Not Found");
            }

            Question currentQuestion = questionWiseMarks.getQuestion();
            // H: Guard against null textData
            String questionHtml = currentQuestion.getTextData() != null
                    ? currentQuestion.getTextData().getContent() : "";
            String questionType = currentQuestion.getQuestionType();

            if (StringUtils.isEmpty(questionType)) {
                throw new VacademyException("Invalid Question Type for Question ID: " + currentQuestion.getId());
            }

            // Surface the AI evaluation to the learner: per-question feedback +
            // criteria breakdown from the persisted copy-check verdict.
            String aiFeedback = null;
            String aiCriteriaBreakdown = null;
            String aiJson = questionWiseMarks.getAiEvaluationDetailsJson();
            if (aiJson != null && !aiJson.isBlank()) {
                try {
                    com.fasterxml.jackson.databind.JsonNode node = new ObjectMapper().readTree(aiJson);
                    if (node.hasNonNull("feedback")) {
                        aiFeedback = node.get("feedback").asText();
                    }
                    if (node.has("criteria_breakdown") && node.get("criteria_breakdown").isArray()) {
                        aiCriteriaBreakdown = node.get("criteria_breakdown").toString();
                    }
                } catch (Exception ignored) {
                    // Non-fatal — leave AI fields null.
                }
            }

            return StudentReportAnswerReviewDto.builder()
                    .questionId(currentQuestion.getId())
                    .questionText(currentQuestion.getTextData() != null ? currentQuestion.getTextData().toDTO() : null)
                    .parentId(currentQuestion.getParentRichText() != null ? currentQuestion.getParentRichText().getId()
                            : null)
                    .parentRichText(
                            currentQuestion.getTextData() != null ? currentQuestion.getTextData().toDTO() : null)
                    .questionName(questionHtml)
                    .questionType(questionType)
                    .questionOrder(questionOrder)
                    .correctOptions(currentQuestion.getAutoEvaluationJson())
                    .studentResponseOptions(questionWiseMarks.getResponseJson())
                    .answerStatus(questionWiseMarks.getStatus())
                    .mark(questionWiseMarks.getMarks()) // primitive double on the entity; null-safe by construction
                    .explanationId(currentQuestion.getExplanationTextData() != null
                            ? currentQuestion.getExplanationTextData().getId()
                            : null)
                    .explanation(currentQuestion.getExplanationTextData() != null
                            ? currentQuestion.getExplanationTextData().getContent()
                            : null)
                    .timeTakenInSeconds(questionWiseMarks.getTimeTakenInSeconds())
                    .evaluatorFeedback(questionWiseMarks.getEvaluatorFeedback())
                    .aiFeedback(aiFeedback)
                    .aiCriteriaBreakdown(aiCriteriaBreakdown)
                    .evaluationSource(questionWiseMarks.getMarksSource())
                    .build();
        } catch (Exception e) {
            // G: Return null instead of empty DTO — caller filters nulls.
            // Previously swallowed with no log line, so a dropped question was
            // invisible. Now surfaced at WARN so a missing question in a report
            // can be traced back to a specific attempt/question.
            log.warn("[report] Dropping question {} from report for attempt {}: {}",
                    questionWiseMarks != null && questionWiseMarks.getQuestion() != null
                            ? questionWiseMarks.getQuestion().getId() : "unknown",
                    questionWiseMarks != null && questionWiseMarks.getStudentAttempt() != null
                            ? questionWiseMarks.getStudentAttempt().getId() : "unknown",
                    e.getMessage(), e);
            return null;
        }
    }

    public ResponseEntity<RespondentListResponse> getRespondentList(CustomUserDetails user, String assessmentId,
            String sectionId, String questionId, RespondentFilter filter, Integer pageNo, Integer pageSize) {

        if (Objects.isNull(filter))
            throw new VacademyException("Invalid Request");
        // Same unsorted-native-query problem as the participant list above, but the
        // respondent queries select participantName (not studentName), so the
        // default and tie-breakers have to use this query's own aliases.
        Sort sortingObject = StableSort.withStableOrder(filter.getSortColumns(),
                Sort.by(Sort.Order.asc("participantName")), "registrationId", "attemptId");

        Pageable pageable = PageRequest.of(pageNo, pageSize, sortingObject);
        Page<RespondentListDto> responses = null;
        if (StringUtils.hasText(filter.getName())) {
            responses = assessmentUserRegistrationRepository
                    .findRespondentListForAssessmentWithFilterAndSearch(filter.getName(), assessmentId, questionId,
                            filter.getAssessmentVisibility(), filter.getStatus(), filter.getRegistrationSource(),
                            filter.getRegistrationSourceId(), pageable);
        }
        if (Objects.isNull(responses)) {
            responses = assessmentUserRegistrationRepository
                    .findRespondentListForAssessmentWithFilter(assessmentId, questionId,
                            filter.getAssessmentVisibility(), filter.getStatus(), filter.getRegistrationSource(),
                            filter.getRegistrationSourceId(), pageable);
        }
        return ResponseEntity.ok(createRespondentListResponse(responses));
    }

    private RespondentListResponse createRespondentListResponse(Page<RespondentListDto> responses) {
        if (Objects.isNull(responses)) {
            return RespondentListResponse.builder()
                    .content(null)
                    .pageNo(0)
                    .pageSize(0)
                    .totalElements(0)
                    .totalPages(0)
                    .last(true)
                    .build();
        }

        List<RespondentListDto> content = responses.getContent();

        return RespondentListResponse.builder()
                .content(content)
                .pageSize(responses.getSize())
                .pageNo(responses.getNumber())
                .totalElements(responses.getTotalElements())
                .totalPages(responses.getTotalPages())
                .last(responses.isLast())
                .build();
    }

    /**
     * Releases participants' results based on the given request type.
     *
     * @param userDetails  The user details of the requester.
     * @param assessmentId The ID of the assessment.
     * @param instituteId  The ID of the institute.
     * @param request      The request containing participant IDs (if applicable).
     * @param type         The type of release (ASSESSMENT_ALL, PARTICIPANTS,
     *                     ASSESSMENT_CUSTOM).
     * @return ResponseEntity<String> indicating success or failure.
     */
    public ResponseEntity<String> releaseParticipantsResult(CustomUserDetails userDetails,
            String assessmentId,
            String instituteId,
            ReleaseRequestDto request,
            String type) {

        if (!StringUtils.hasText(type))
            throw new VacademyException("Invalid Request Type");

        // Tenant check: the assessment must belong to the institute in the request.
        Optional<Assessment> assessmentOptional = assessmentRepository.findByAssessmentIdAndInstituteId(assessmentId,
                instituteId);
        if (assessmentOptional.isEmpty())
            throw new VacademyException("No Assessment Found");

        try {
            // Call the async method
            releaseResultWrapper(assessmentOptional.get(), instituteId, request, type);
        } catch (Exception e) {
            log.error("[FAILED TO RELEASE] " + e.getMessage());
        }

        return ResponseEntity.ok("Done");
    }

    @Async
    public CompletableFuture<Void> releaseResultWrapper(Assessment assessment, String instituteId,
            ReleaseRequestDto request, String type) {
        return CompletableFuture.runAsync(() -> {
            try {
                processReleaseParticipants(assessment, instituteId, request, type);
            } catch (Exception e) {
                log.error("Error processing participants", e);
            }
        }).thenRun(() -> sendNotificationToAdmin(assessment, instituteId));
    }

    private void sendNotificationToAdmin(Assessment assessment, String instituteId) {
        assessmentNotificationService.sendNotificationsToAdminsAfterReleasingTheResult(assessment, instituteId);
    }

    private void processReleaseParticipants(Assessment assessment, String instituteId, ReleaseRequestDto request,
            String type) {
        switch (type) {
            case "ASSESSMENT_ALL" -> handleReleaseResultForAllAssessment(assessment, instituteId);
            case "PARTICIPANTS", "ENTIRE_ASSESSMENT_PARTICIPANTS" ->
                handleReleaseResultForParticipants(assessment, instituteId, request);
            case "ASSESSMENT_CUSTOM" -> handleReleaseResultForCustomAssessmentSelection(assessment, instituteId);
            default -> throw new VacademyException("Invalid Type");
        }
    }

    /**
     * Handles result release for a custom selection of assessments.
     *
     * @param assessment  The assessment for which results are being released.
     * @param instituteId The ID of the institute.
     */
    private void handleReleaseResultForCustomAssessmentSelection(Assessment assessment, String instituteId) {
        List<StudentAttempt> attemptList = studentAttemptRepository
                .findAllParticipantsFromAssessmentAndStatusNotInAndReportNotReleased(
                        assessment.getId(), List.of("DELETED"));
        createParticipantsReportAndSendEmail(attemptList, assessment, instituteId);
    }

    /**
     * Generates reports for the given student attempts and sends notifications via
     * email.
     *
     * @param attemptList The list of student attempts.
     * @param assessment  The assessment details.
     * @param instituteId The ID of the institute.
     */
    private void createParticipantsReportAndSendEmail(List<StudentAttempt> attemptList, Assessment assessment,
            String instituteId) {
        if (ApiCandidatePolicy.isApiExam(assessment)) {
            // Exams created through the partner API (spec 12): Release Result is the
            // state change only. API candidates have no login and no email, so no report
            // PDF is rendered and nothing is sent; the ASSESSMENT_RESULT_RELEASED workflow
            // is not fired for them either.
            releaseStateWriter.release(attemptList);
            return;
        }
        if (assessment.getEvaluationType().equals("MANUAL")) {
            handleParticipantsReportCreationForManualAssessment(attemptList, assessment, instituteId);
            return;
        }

        // PR2 (bulk report export): one loadClassContext call replaces the
        // separate branding + option-distribution prefetch above, AND removes
        // the class-wide query duplication that used to happen again inside
        // buildComparisonData for every attempt (plan C4/C5).
        vacademy.io.assessment_service.features.learner_assessment.dto.ReportClassContext ctx =
                learnerReportService.loadClassContext(assessment.getId(), instituteId);

        // NOTE (C9, partially addressed): the release flow still accumulates
        // rendered PDFs in memory to hand to AssessmentReportNotificationService,
        // which reads directly from the byte[] map for the email attachment.
        // Fully eliminating the in-memory map requires changing that service's
        // contract to fetch bytes per-email from file_id instead — a larger,
        // separately-reviewable change left for a follow-up (see PR2 notes in
        // ASSESSMENT_BULK_REPORT_EXPORT_ARCHITECTURE.md §6, step 18). What IS
        // fixed here: no more duplicate per-student class-wide queries, no more
        // duplicated HTML/PDF generation code (now shared via
        // ReportPdfRenderService), and a failed upload no longer silently
        // leaves report_pdf_file_id unset (ReportPdfUploadService throws).
        //
        // Emails now go out in batches as reports are made: holding every PDF until the end
        // and sending one request with all of them breaks on large classes once each report
        // is the AI report plus profile pages (~2 MB each, 2.7 MB as base64): 5 per request.
        final int emailBatch = 5;
        Map<StudentAttempt, byte[]> reportMap = new HashMap<>();
        // The result email / WhatsApp templates for this assessment, looked up once per release.
        final vacademy.io.assessment_service.features.assessment.notification.ResultNotificationService.Templates resultTemplates =
                resultNotificationService.resolve(instituteId, assessment.getId());
        final Map<String, Map<String, String>> variablesByAttempt = new HashMap<>();
        attemptList.forEach(attempt -> {
            try {
                // Skip attempts that were never submitted (no meaningful report to generate)
                String attemptStatus = attempt.getStatus();
                if (attemptStatus == null || (!attemptStatus.equals("LIVE") && !attemptStatus.equals("ENDED"))) {
                    log.info("Skipping report for attempt {} with status '{}' (not submitted)", attempt.getId(), attemptStatus);
                    updateAttemptDataReleaseData(attempt);
                    return;
                }

                // Generate student report details (ctx-aware: reuses sections/question order)
                StudentReportOverallDetailDto studentReportOverallDetailDto =
                        createStudentReportDetailResponse(ctx, attempt.getId(), instituteId);

                // Build comparison data for rich PDF (ctx-aware: reuses class aggregates)
                String userId = attempt.getRegistration() != null ? attempt.getRegistration().getUserId() : null;
                vacademy.io.assessment_service.features.learner_assessment.dto.StudentComparisonDto comparison = null;
                try {
                    comparison = learnerReportService.buildComparisonFromContext(ctx, attempt.getId(), userId);
                } catch (Exception e) {
                    log.warn("Failed to build comparison for attempt {}: {}", attempt.getId(), e.getMessage());
                }

                // The student's one report: the AI report when it exists, else the normal report,
                // wrapped in the assessment's report-profile pages (e.g. a scholarship letter).
                final vacademy.io.assessment_service.features.learner_assessment.dto.StudentComparisonDto cmp = comparison;
                var rendered = aiReportPdfService.renderWithVariables(userId, assessment.getId(), attempt.getId(),
                        instituteId, studentReportOverallDetailDto,
                        () -> reportPdfRenderService.render(studentReportOverallDetailDto, cmp, ctx));
                byte[] participantPdfReport = rendered.pdf();
                variablesByAttempt.put(attempt.getId(), rendered.variables());

                // Upload PDF to storage and cache the file ID. Throws on failure —
                // caught below so one student's upload failure doesn't stop the batch.
                try {
                    String fileName = "report_" + attempt.getId() + ".pdf";
                    String fileId = reportPdfUploadService.upload(participantPdfReport, fileName, "ASSESSMENT_REPORT", assessment.getId());
                    attempt.setReportPdfFileId(fileId);
                    log.info("Uploaded report PDF for attempt {}, fileId: {}", attempt.getId(), fileId);
                } catch (Exception e) {
                    log.warn("Failed to upload PDF for attempt {}: {}", attempt.getId(), e.getMessage());
                }

                // Update attempt status
                updateAttemptDataReleaseData(attempt);

                // Send notification to the student
                reportMap.put(attempt, participantPdfReport);
                if (reportMap.size() >= emailBatch) {
                    sendResultNotifications(reportMap, variablesByAttempt, assessment.getId(), instituteId, resultTemplates);
                    publishResultReleasedFor(reportMap);
                    reportMap.clear();
                }
            } catch (Exception e) {
                log.error("Failed to generate report for attempt {}: {}", attempt.getId(), e.getMessage());
                // Still release the attempt even if PDF generation fails
                updateAttemptDataReleaseData(attempt);
            }
        });
        if (!reportMap.isEmpty()) {
            sendResultNotifications(reportMap, variablesByAttempt, assessment.getId(), instituteId, resultTemplates);
            publishResultReleasedFor(reportMap);
        }
    }

    /** Email (always, from the bound or default template) and WhatsApp (when bound) for one batch. */
    private void sendResultNotifications(Map<StudentAttempt, byte[]> reports, Map<String, Map<String, String>> variablesByAttempt,
                                         String assessmentId, String instituteId,
                                         vacademy.io.assessment_service.features.assessment.notification.ResultNotificationService.Templates templates) {
        if (!adminCoreServiceClient.isLearnerResultNotificationEnabled(instituteId)) {
            log.info("[result-notification] learner notifications disabled for institute {} — skipping", instituteId);
            return;
        }
        List<vacademy.io.assessment_service.features.assessment.notification.ResultNotificationService.Item> items = new ArrayList<>();
        reports.forEach((attempt, pdf) -> items.add(new vacademy.io.assessment_service.features.assessment.notification.ResultNotificationService.Item(
                attempt, pdf, variablesByAttempt.getOrDefault(attempt.getId(), Map.of()))));
        try {
            resultNotificationService.sendEmails(items, assessmentId, instituteId, templates);
        } catch (Exception e) {
            log.error("[result-notification] email batch failed for assessment {}", assessmentId, e);
        }
        try {
            resultNotificationService.sendWhatsApps(items, assessmentId, instituteId, templates);
        } catch (Exception e) {
            log.error("[result-notification] WhatsApp batch failed for assessment {}", assessmentId, e);
        }
    }

    private void handleParticipantsReportCreationForManualAssessment(List<StudentAttempt> attemptList,
            Assessment assessment, String instituteId) {
        Map<StudentAttempt, byte[]> reportMap = new HashMap<>();
        attemptList.forEach(attempt -> {
            // The checked copy is what a manual-result learner receives. An attempt
            // may have none — the AI check failed and the teacher entered marks
            // without uploading a checked PDF — and one such attempt must not
            // abort the release (and the emails) of everyone after it in the list.
            byte[] checkedCopy = null;
            if (StringUtils.hasText(attempt.getEvaluatedFileId())) {
                try {
                    checkedCopy = fileService.getFileFromFileId(attempt.getEvaluatedFileId());
                } catch (Exception e) {
                    log.warn("Checked copy {} for attempt {} could not be fetched; releasing without it: {}",
                            attempt.getEvaluatedFileId(), attempt.getId(), e.getMessage());
                }
            } else {
                log.info("Attempt {} has no checked copy; releasing marks without an attachment", attempt.getId());
            }

            // Update attempt status
            updateAttemptDataReleaseData(attempt);

            // Email + workflow only for learners who actually have a copy to receive.
            if (checkedCopy != null) {
                reportMap.put(attempt, checkedCopy);
            }
        });
        sendNotificationToStudent(reportMap, assessment.getId(), instituteId);
        publishResultReleasedFor(reportMap);
    }

    /**
     * Updates the attempt data to mark the report as released.
     *
     * @param attempt The student attempt to update.
     */
    private void updateAttemptDataReleaseData(StudentAttempt attempt) {
        // Shared with the partner API's finalize (ReleaseStateWriter): status, release
        // date, save, then one comparisonData cache clear -- per attempt here, as before.
        releaseStateWriter.release(attempt);
    }

    /**
     * Fires ASSESSMENT_RESULT_RELEASED for the learners who actually got a report.
     *
     * <p>Keyed off the same map that drives the result email rather than off
     * {@link #updateAttemptDataReleaseData}, because that method is also called for attempts
     * that get NO report and NO email: ones that were never submitted (a registered no-show
     * on the "release all" path) and ones whose PDF generation failed. Emitting from there
     * would tell a learner who never sat the assessment that their result is out, and would
     * announce a report that does not exist.
     *
     * <p>Deliberately not suppressed for an attempt that was already RELEASED: two of the
     * three admin release paths do not filter released attempts, and the existing behaviour
     * on a re-release is to regenerate the report and re-email — so a deliberate re-release
     * after a revaluation should reach an institute's workflow too.
     *
     * <p>Also deliberately not gated on the resultNotifications setting that
     * {@link #sendNotificationToStudent} honours: that switch turns off Vacademy's built-in
     * email, and an institute may well have turned it off precisely because they built their
     * own workflow to replace it.
     */
    private void publishResultReleasedFor(Map<StudentAttempt, byte[]> reportMap) {
        if (reportMap.isEmpty()) {
            return;
        }
        assessmentWorkflowEventPublisher.publishResultReleased(new ArrayList<>(reportMap.keySet()));
    }

    /**
     * Sends a notification to the student with the generated report.
     *
     * @param participantPdfReport The generated PDF report as a byte array.
     */
    private void sendNotificationToStudent(Map<StudentAttempt, byte[]> participantPdfReport, String assessmentId, String instituteId) {
        // Learner result/report emails are opt-out via Assessment Settings
        // (ASSESSMENT_SETTING.resultNotifications). Default is ON, so this only
        // skips when an admin explicitly turns the learner/student toggle off.
        if (!adminCoreServiceClient.isLearnerResultNotificationEnabled(instituteId)) {
            log.info("[result-notification] learner notifications disabled for institute {} — skipping report email", instituteId);
            return;
        }
        assessmentReportNotificationService.sendAssessmentReportsToLearners(participantPdfReport, assessmentId, instituteId);
        log.info("Notification Check");
    }

    /**
     * Handles result release for a specific list of participants.
     *
     * @param assessment  The assessment details.
     * @param instituteId The ID of the institute.
     * @param request     The request containing the participant attempt IDs.
     */
    private void handleReleaseResultForParticipants(Assessment assessment, String instituteId,
            ReleaseRequestDto request) {
        if (Objects.isNull(request))
            throw new VacademyException("Invalid Request");

        // Fetch attempts based on request. Only attempts on THIS assessment: the ids
        // come from the client, and the assessment was the only thing tenant-checked.
        List<StudentAttempt> attemptList = StreamSupport
                .stream(studentAttemptRepository.findAllById(request.getAttemptIds()).spliterator(), false)
                .filter(attempt -> {
                    boolean onAssessment = attempt.getRegistration() != null
                            && attempt.getRegistration().getAssessment() != null
                            && assessment.getId().equals(attempt.getRegistration().getAssessment().getId());
                    if (!onAssessment) {
                        log.warn("[release-result] skipping attempt {} not on assessment {}", attempt.getId(),
                                assessment.getId());
                    }
                    return onAssessment;
                })
                .toList();

        createParticipantsReportAndSendEmail(attemptList, assessment, instituteId);
    }

    /**
     * Handles result release for all participants in an assessment.
     *
     * @param assessment  The assessment details.
     * @param instituteId The ID of the institute.
     */
    private void handleReleaseResultForAllAssessment(Assessment assessment, String instituteId) {
        List<StudentAttempt> attemptList = studentAttemptRepository.findAllParticipantsFromAssessmentAndStatusNotIn(
                assessment.getId(), List.of("DELETED"));
        createParticipantsReportAndSendEmail(attemptList, assessment, instituteId);
    }

    /**
     * Fetches a single participant's registration details, including the
     * answers they gave to the assessment's custom form fields. Used by the
     * admin dashboard to populate the "External Participant" side sheet where
     * the regular student profile API returns empty (externals don't have a
     * StudentSessionInstituteGroupMapping).
     */
    public ResponseEntity<ParticipantRegistrationDetailDto> getParticipantRegistrationDetails(
            String registrationId) {
        AssessmentUserRegistration registration = assessmentUserRegistrationRepository
                .findById(registrationId)
                .orElseThrow(() -> new VacademyException(
                        "Registration not found with id: " + registrationId));

        List<ParticipantRegistrationDetailDto.CustomFieldAnswer> customFields = registration
                .getAssessmentRegistrationCustomFieldResponseList().stream()
                .sorted(Comparator.comparingInt(cfr -> {
                    Integer order = cfr.getAssessmentCustomField() != null
                            ? cfr.getAssessmentCustomField().getFieldOrder()
                            : null;
                    return order != null ? order : Integer.MAX_VALUE;
                }))
                .map(cfr -> {
                    var field = cfr.getAssessmentCustomField();
                    return ParticipantRegistrationDetailDto.CustomFieldAnswer.builder()
                            .fieldId(field != null ? field.getId() : null)
                            .fieldName(field != null ? field.getFieldName() : null)
                            .fieldKey(field != null ? field.getFieldKey() : null)
                            .fieldType(field != null ? field.getFieldType() : null)
                            .fieldOrder(field != null ? field.getFieldOrder() : null)
                            .isMandatory(field != null ? field.getIsMandatory() : null)
                            .answer(cfr.getAnswer())
                            .build();
                })
                .collect(Collectors.toList());

        ParticipantRegistrationDetailDto dto = ParticipantRegistrationDetailDto.builder()
                .registrationId(registration.getId())
                .userId(registration.getUserId())
                .participantName(registration.getParticipantName())
                .email(registration.getUserEmail())
                .phoneNumber(registration.getPhoneNumber())
                .source(registration.getSource())
                .status(registration.getStatus())
                .registrationTime(registration.getRegistrationTime())
                .customFields(customFields)
                .build();

        return ResponseEntity.ok(dto);
    }
}
