package vacademy.io.assessment_service.features.learner_assessment.manager;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.transaction.Transactional;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import vacademy.io.assessment_service.features.assessment.dto.manual_evaluation.EvaluationSettingDto;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentInstituteMapping;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentSetMapping;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.enums.ReleaseResultStatusEnum;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentInstituteMappingRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentSetMappingRepository;
import vacademy.io.assessment_service.features.assessment.service.StudentAttemptService;
import vacademy.io.assessment_service.features.learner_assessment.dto.AssessmentAttemptUpdateRequest;
import vacademy.io.assessment_service.features.learner_assessment.dto.status_json.manual.LearnerManualAttemptDataDto;
import vacademy.io.assessment_service.features.learner_assessment.dto.status_json.manual.ManualAssessmentAttemptDto;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.learner_assessment.enums.AssessmentAttemptEnum;
import vacademy.io.assessment_service.features.learner_assessment.enums.AssessmentAttemptResultEnum;
import vacademy.io.assessment_service.features.learner_assessment.service.QuestionWiseMarksService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.core.utils.DateUtil;
import vacademy.io.assessment_service.core.exception.VacademyException;

import java.util.*;
import java.util.concurrent.CompletableFuture;

@Slf4j
@Component
public class LearnerAssessmentManualStatusManager {

    @Autowired
    StudentAttemptService studentAttemptService;

    @Autowired
    QuestionWiseMarksService questionWiseMarksService;

    @Autowired
    AssessmentSetMappingRepository assessmentSetMappingRepository;

    @Autowired
    AssessmentInstituteMappingRepository assessmentInstituteMappingRepository;

    public static List<String> getRandomUserId(List<String> userIds) {
        if (userIds == null || userIds.isEmpty()) {
            return Collections.emptyList(); // Return empty list if no users
        }
        Random random = new Random();
        String randomUserId = userIds.get(random.nextInt(userIds.size()));
        return Collections.singletonList(randomUserId); // Return as List<String>
    }

    /**
     * Submits a manual assessment attempt.
     *
     * @param userDetails  The authenticated user details.
     * @param assessmentId The ID of the assessment being submitted.
     * @param attemptId    The ID of the attempt.
     * @param request      The request containing assessment update data.
     * @param instituteId
     * @return ResponseEntity containing a success message or an error.
     * @throws VacademyException if the attempt or assessment is invalid.
     */
    public ResponseEntity<String> submitManualAssessment(CustomUserDetails userDetails,
            String assessmentId,
            String attemptId,
            AssessmentAttemptUpdateRequest request,
            String instituteId) {
        try {
            // Fetch student attempt from the database
            Optional<StudentAttempt> attemptOptional = studentAttemptService.getStudentAttemptById(attemptId);
            if (attemptOptional.isEmpty())
                throw new VacademyException("Attempt Not Found");

            // Validate if the attempt belongs to the given assessment
            Assessment assessment = attemptOptional.get().getRegistration().getAssessment();
            if (!assessment.getId().equals(assessmentId))
                throw new VacademyException("Assessment Not Found");

            // Check attempt status before proceeding
            if (attemptOptional.get().getStatus().equals("PREVIEW")) {
                throw new VacademyException("Attempt is in Preview");
            }

            // A repeat submit is not a failure. The learner's paper is already stored,
            // so tapping Submit twice — or the app retrying — must not greet them with
            // an error at the end of their exam. 87 of 271 submissions on 2026-08-29
            // hit this path and were shown "Failed to Submit: Attempt already Ended"
            // despite having submitted successfully. Answer idempotently instead.
            if (attemptOptional.get().getStatus().equals("ENDED")) {
                log.info("[SUBMIT-MANUAL] Repeat submit on an already-ended attempt, treating as done: attemptId={}",
                        attemptId);
                return ResponseEntity.ok("Already submitted");
            }

            // Process and update the attempt for manual submission
            updateAttemptForManualSubmit(assessment, attemptOptional.get(), request, instituteId);

            return ResponseEntity.ok("Done");
        } catch (Exception e) {
            throw new VacademyException("Failed to Submit: " + e.getMessage());
        }
    }

    /**
     * Updates the student attempt details for manual submission.
     *
     * @param assessment     The assessment associated with the attempt.
     * @param studentAttempt The attempt being updated.
     * @param request        The request containing the JSON data.
     * @param instituteId
     * @throws JsonProcessingException if JSON parsing fails.
     */
    @Transactional
    private void updateAttemptForManualSubmit(Assessment assessment,
            StudentAttempt studentAttempt,
            AssessmentAttemptUpdateRequest request, String instituteId) throws JsonProcessingException {

        // Validate request
        if (Objects.isNull(request) || Objects.isNull(request.getJsonContent())) {
            throw new VacademyException("Invalid Request");
        }

        // Parse and validate the JSON data
        LearnerManualAttemptDataDto attemptData = studentAttemptService
                .validateAndCreateManualAttemptJsonObject(request.getJsonContent());
        Optional<AssessmentSetMapping> setMapping = assessmentSetMappingRepository.findById(request.getSetId());

        if (Objects.isNull(attemptData))
            throw new VacademyException("Attempt Data is Null");

        // This endpoint is used exclusively for PDF-upload (answer-sheet) manual
        // submissions — the learner client routes coding/subjective MANUAL exams
        // (which carry per-question responses instead of a file) to the AUTO
        // submit endpoint. So a blank fileId here means "submit with no answer
        // sheet". Reject it instead of silently marking the attempt ENDED with
        // result_marks=0, which is how empty PDF submissions got auto-scored 0.
        if (Objects.isNull(attemptData.getFileId()) || attemptData.getFileId().isBlank()) {
            throw new VacademyException("No answer sheet uploaded. Please upload your PDF before submitting.");
        }

        // Extract client sync time from the parsed JSON
        String clientSyncTime = attemptData.getClientLastSync();
        ManualAssessmentAttemptDto assessmentAttemptDto = attemptData.getAssessment();

        // Update student attempt details
        studentAttempt.setStatus(AssessmentAttemptEnum.ENDED.name());
        studentAttempt.setSubmitTime(DateUtil.getCurrentUtcTime());
        studentAttempt.setAttemptData(request.getJsonContent());
        studentAttempt.setSubmitData(request.getJsonContent());
        studentAttempt.setResultStatus(AssessmentAttemptResultEnum.PENDING.name());
        studentAttempt.setReportReleaseStatus(ReleaseResultStatusEnum.PENDING.name());
        studentAttempt.setClientLastSync(DateUtil.convertStringToUTCDate(clientSyncTime));
        studentAttempt.setTotalTimeInSeconds(assessmentAttemptDto.getTimeElapsedInSeconds());
        setMapping.ifPresent(studentAttempt::setAssessmentSetMapping);
        studentAttempt.setCommaSeparatedEvaluatorUserIds(
                convertListToCommaSeparatedString(getEvaluatorsForAttempt(assessment.getId(), instituteId)));

        // Save the updated attempt
        studentAttemptService.updateStudentAttempt(studentAttempt);

        // Generate question-wise marks asynchronously
        try {
            createQuestionWiseMarksWrapper(assessment, studentAttempt, request.getJsonContent(), attemptData);
        } catch (Exception e) {
            log.error(e.getMessage());
        }
    }

    private List<String> getEvaluatorsForAttempt(String assessmentId, String instituteId) {
        try {
            Optional<AssessmentInstituteMapping> assessmentInstituteMapping = assessmentInstituteMappingRepository
                    .findByAssessmentIdAndInstituteId(assessmentId, instituteId);
            if (assessmentInstituteMapping.isEmpty())
                throw new VacademyException("Institute Mapping not Found");

            if (Objects.isNull(assessmentInstituteMapping.get().getEvaluationSetting()))
                return new ArrayList<>();

            ObjectMapper objectMapper = new ObjectMapper();
            EvaluationSettingDto settingDto = objectMapper
                    .readValue(assessmentInstituteMapping.get().getEvaluationSetting(), EvaluationSettingDto.class);

            return getEvaluatorsFromEvaluationSetting(settingDto);
        } catch (Exception e) {
            throw new VacademyException("Failed To Convert: " + e.getMessage());
        }
    }

    private List<String> getEvaluatorsFromEvaluationSetting(EvaluationSettingDto settingDto) {
        if (Objects.isNull(settingDto) || Objects.isNull(settingDto.getUsers()))
            return new ArrayList<>();
        List<String> userIds = new ArrayList<>();

        settingDto.getUsers().forEach(users -> {
            userIds.add(users.getUserId());
        });

        return getRandomUserId(userIds);
    }

    /**
     * Asynchronously creates or updates question-wise marks data for manual
     * assessments.
     *
     * @param assessment     The associated assessment.
     * @param studentAttempt The student attempt being evaluated.
     * @param jsonContent    The JSON content of the assessment data.
     * @param attemptData    The parsed attempt data.
     * @return CompletableFuture containing the list of created question-wise marks.
     */
    @Async
    public CompletableFuture<List<QuestionWiseMarks>> createQuestionWiseMarksWrapper(Assessment assessment,
            StudentAttempt studentAttempt,
            String jsonContent,
            LearnerManualAttemptDataDto attemptData) {
        return CompletableFuture.completedFuture(
                questionWiseMarksService.createOrUpdateQuestionWiseMarksDataForManualAssessment(
                        assessment, studentAttempt, jsonContent, attemptData));
    }

    public String convertListToCommaSeparatedString(List<String> list) {
        if (Objects.isNull(list) || list.isEmpty())
            return null;
        return String.join(",", list);
    }

}
