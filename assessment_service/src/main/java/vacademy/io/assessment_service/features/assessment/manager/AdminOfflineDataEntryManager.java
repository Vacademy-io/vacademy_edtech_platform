package vacademy.io.assessment_service.features.assessment.manager;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import vacademy.io.assessment_service.features.assessment.dto.offline_entry.*;
import vacademy.io.assessment_service.features.assessment.entity.*;
import vacademy.io.assessment_service.features.assessment.enums.AttemptResultStatusEnum;
import vacademy.io.assessment_service.features.assessment.enums.ReleaseResultStatusEnum;
import vacademy.io.assessment_service.features.assessment.enums.UserRegistrationSources;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentUserRegistrationRepository;
import vacademy.io.assessment_service.features.assessment.service.StudentAttemptService;
import static vacademy.io.common.auth.enums.CompanyStatus.ACTIVE;
import vacademy.io.assessment_service.features.learner_assessment.dto.status_json.*;
import vacademy.io.assessment_service.features.learner_assessment.enums.AssessmentAttemptEnum;
import vacademy.io.assessment_service.features.learner_assessment.service.AssessmentLLMAnalyticsService;
import vacademy.io.assessment_service.features.open_evaluation.policy.ResultLockGuard;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.core.utils.DateUtil;
import vacademy.io.common.exceptions.VacademyException;

import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.stream.Collectors;

@Slf4j
@Component
public class AdminOfflineDataEntryManager {

    @Autowired
    private AssessmentUserRegistrationRepository assessmentUserRegistrationRepository;

    @Autowired
    private AssessmentRepository assessmentRepository;

    @Autowired
    private StudentAttemptService studentAttemptService;

    @Autowired
    private AssessmentLLMAnalyticsService assessmentLLMAnalyticsService;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired(required = false)
    private ResultLockGuard resultLockGuard;

    public ResponseEntity<OfflineAttemptCreateResponse> createOfflineAttempt(
            CustomUserDetails userDetails,
            String assessmentId,
            String registrationId,
            String instituteId,
            OfflineAttemptCreateRequest request) {
        try {
            AssessmentUserRegistration registration;

            if (StringUtils.hasText(registrationId)) {
                // Case 1: Individual participant — registrationId provided directly
                Optional<AssessmentUserRegistration> registrationOptional =
                        assessmentUserRegistrationRepository.findById(registrationId);
                if (registrationOptional.isEmpty()) {
                    throw new VacademyException("Registration Not Found");
                }
                registration = registrationOptional.get();
                if (!registration.getAssessment().getId().equals(assessmentId)) {
                    throw new VacademyException("Registration does not belong to the specified assessment");
                }
            } else if (request != null && StringUtils.hasText(request.getUserId())) {
                // Case 2: Batch student — no registrationId, create AssessmentUserRegistration.
                // Tenant check: the assessment must belong to the institute in the request.
                Optional<Assessment> assessmentOptional =
                        assessmentRepository.findByAssessmentIdAndInstituteId(assessmentId, instituteId);
                if (assessmentOptional.isEmpty()) {
                    throw new VacademyException("Assessment Not Found");
                }
                Assessment assessment = assessmentOptional.get();

                // Check if registration already exists for this user+assessment
                Optional<AssessmentUserRegistration> existingRegistration =
                        assessmentUserRegistrationRepository.findTopByUserIdAndAssessmentId(
                                request.getUserId(), assessmentId);

                if (existingRegistration.isPresent()) {
                    registration = existingRegistration.get();
                } else {
                    // Create new registration (same pattern as LearnerAssessmentAttemptStartManager)
                    AssessmentUserRegistration newReg = new AssessmentUserRegistration();
                    newReg.setAssessment(assessment);
                    newReg.setUserId(request.getUserId());
                    newReg.setUserEmail(request.getEmail() != null ? request.getEmail() : "");
                    newReg.setUsername(request.getUsername() != null ? request.getUsername() : "");
                    newReg.setParticipantName(request.getFullName() != null ? request.getFullName() : "");
                    newReg.setPhoneNumber(request.getMobileNumber());
                    newReg.setReattemptCount(assessment.getReattemptCount() != null ? assessment.getReattemptCount() : 0);
                    newReg.setSource(UserRegistrationSources.BATCH_PREVIEW_REGISTRATION.name());
                    newReg.setSourceId(request.getBatchId() != null ? request.getBatchId() : "");
                    newReg.setStatus(ACTIVE.name());
                    newReg.setRegistrationTime(DateUtil.getCurrentUtcTime());
                    newReg.setInstituteId(instituteId);
                    registration = assessmentUserRegistrationRepository.save(newReg);
                }
            } else {
                throw new VacademyException("Either registrationId or userId must be provided");
            }

            // Determine next attempt number
            int attemptNumber = 1;
            if (registration.getStudentAttempts() != null) {
                attemptNumber = registration.getStudentAttempts().size() + 1;
            }

            Date now = DateUtil.getCurrentUtcTime();
            Assessment assessment = registration.getAssessment();

            StudentAttempt attempt = new StudentAttempt();
            attempt.setRegistration(registration);
            attempt.setAttemptNumber(attemptNumber);
            attempt.setPreviewStartTime(now);
            attempt.setStartTime(now);
            attempt.setSubmitTime(now);
            attempt.setMaxTime(assessment.getDuration() != null ? assessment.getDuration() : 0);
            attempt.setStatus(AssessmentAttemptEnum.ENDED.name());
            attempt.setResultStatus(AttemptResultStatusEnum.PENDING.name());
            // Hold the report explicitly. Every copy uploaded for a student —
            // the single offline entry and each copy of a bulk AI intake come
            // through here — used to start with a NULL release status. NULL is
            // a dead zone: the learner's Reports list filters on
            // report_release_status IN ('RELEASED','PENDING'), so the copy
            // simply vanished for the student (no "pending" row) even after the
            // AI had graded it, the admin's Result Status column read "Not
            // available", and any client that omits that filter would treat the
            // row as released. PENDING is the state every other submission path
            // already uses: it shows "Pending evaluation" to the learner and
            // "Not released" to the admin until "Release Result" is pressed.
            // Manual evaluation and the bulk marks import still set RELEASED
            // themselves, and the auto-release cron matches NULL and PENDING.
            attempt.setReportReleaseStatus(ReleaseResultStatusEnum.PENDING.name());
            // Seed empty JSON so downstream attempt_data readers/updaters (manual
            // evaluation upload, set assignment) don't trip on a NULL column.
            attempt.setAttemptData("{}");
            attempt.setTotalMarks(0.0);
            attempt.setResultMarks(0.0);
            attempt.setTotalTimeInSeconds(0L);

            StudentAttempt savedAttempt = studentAttemptService.updateStudentAttempt(attempt);

            OfflineAttemptCreateResponse response = OfflineAttemptCreateResponse.builder()
                    .attemptId(savedAttempt.getId())
                    .registrationId(registration.getId())
                    .assessmentId(assessmentId)
                    .build();

            return ResponseEntity.ok(response);
        } catch (Exception e) {
            throw new VacademyException("Failed to create offline attempt: " + e.getMessage());
        }
    }

    public ResponseEntity<String> submitOfflineResponses(
            CustomUserDetails userDetails,
            String assessmentId,
            String attemptId,
            String instituteId,
            OfflineResponseSubmitRequest request) {
        try {
            if (request == null || request.getSections() == null) {
                throw new VacademyException("Invalid Request");
            }

            Optional<StudentAttempt> attemptOptional = studentAttemptService.getStudentAttemptById(attemptId);
            if (attemptOptional.isEmpty()) {
                throw new VacademyException("Attempt Not Found");
            }

            StudentAttempt attempt = attemptOptional.get();
            Assessment assessment = attempt.getRegistration().getAssessment();

            if (!assessment.getId().equals(assessmentId)) {
                throw new VacademyException("Attempt does not belong to the specified assessment");
            }

            attempt = applyResponses(attempt, assessment, request);

            // Send activity log asynchronously (don't block the response)
            final StudentAttempt finalAttempt = attempt;
            final Assessment finalAssessment = assessment;
            CompletableFuture.runAsync(() -> {
                try {
                    assessmentLLMAnalyticsService.sendAssessmentDataForAnalysisAsync(
                            finalAttempt, finalAssessment.getId(), finalAssessment.getName(),
                            finalAssessment.getAssessmentType(), finalAssessment.getDuration(), 0);
                } catch (Exception e) {
                    log.error("Failed to send offline assessment data for activity log: {}", e.getMessage());
                }
            });

            return ResponseEntity.ok("Done");
        } catch (Exception e) {
            throw new VacademyException("Failed to submit offline responses: " + e.getMessage());
        }
    }

    /**
     * Writes the responses as the attempt's attempt_data / submit_data and runs the marks
     * calculation (objective questions scored, written answers held for the AI when the
     * assessment has AI evaluation on). No analytics, no notification and no workflow
     * event: the marks calculation is called with {@code endSource = null} and the attempt
     * is already ENDED. Shared by the offline entry above and the partner API's typed
     * submissions ({@code ApiSubmissionWriter.writeTyped}).
     *
     * @return the saved attempt
     */
    public StudentAttempt applyResponses(StudentAttempt attempt, Assessment assessment,
            OfflineResponseSubmitRequest request) {
        // Build the attemptData JSON in the format expected by AttemptDataParserService
        String attemptDataJson = buildAttemptDataJson(attempt.getId(), assessment.getId(), request);

        attempt.setAttemptData(attemptDataJson);
        attempt.setSubmitData(attemptDataJson);
        studentAttemptService.updateStudentAttempt(attempt);

        // Trigger auto-evaluation (synchronous - needed for marks)
        return studentAttemptService.updateStudentAttemptWithResultAfterMarksCalculation(Optional.of(attempt));
    }

    /**
     * Combined: create attempt + submit responses + evaluate in a single call.
     * Eliminates 2 extra HTTP round-trips from the frontend.
     */
    public ResponseEntity<OfflineAttemptCreateResponse> createAttemptAndSubmitResponses(
            CustomUserDetails userDetails,
            String assessmentId,
            String registrationId,
            String instituteId,
            OfflineResponseSubmitRequest request) {
        try {
            // Build a create request from the submit request's user fields
            OfflineAttemptCreateRequest createRequest = OfflineAttemptCreateRequest.builder()
                    .userId(request.getUserId())
                    .fullName(request.getFullName())
                    .email(request.getEmail())
                    .username(request.getUsername())
                    .mobileNumber(request.getMobileNumber())
                    .batchId(request.getBatchId())
                    .build();

            // Step 1: Create the attempt
            ResponseEntity<OfflineAttemptCreateResponse> createResponse =
                    createOfflineAttempt(userDetails, assessmentId, registrationId, instituteId, createRequest);

            String attemptId = createResponse.getBody().getAttemptId();

            // Step 2: Submit and evaluate
            submitOfflineResponses(userDetails, assessmentId, attemptId, instituteId, request);

            return createResponse;
        } catch (Exception e) {
            throw new VacademyException("Failed to create and submit offline attempt: " + e.getMessage());
        }
    }

    /**
     * Attaches the scanned PDFs an admin collected offline to an existing attempt:
     * the learner's answer sheet, the checked (annotated) copy and a prepared
     * result report.
     * <p>
     * This deliberately does NOT go through manual-evaluation's submit/marks —
     * that endpoint recomputes total_marks from the questions in its payload and
     * flips the attempt to COMPLETED/RELEASED, so using it merely to carry a file
     * id would zero out the marks the offline entry just calculated.
     */
    public ResponseEntity<String> attachOfflineFiles(
            CustomUserDetails userDetails,
            String assessmentId,
            String attemptId,
            String instituteId,
            OfflineAttachmentsRequest request) {
        if (request == null) throw new VacademyException("Invalid Request");

        Optional<StudentAttempt> attemptOptional = studentAttemptService.getStudentAttemptById(attemptId);
        if (attemptOptional.isEmpty()) throw new VacademyException("Attempt Not Found");

        StudentAttempt attempt = attemptOptional.get();
        if (!attempt.getRegistration().getAssessment().getId().equals(assessmentId)) {
            throw new VacademyException("Attempt does not belong to the specified assessment");
        }

        // Same guard the manual-evaluation answer-sheet upload applies: writing to
        // an attempt the learner is still sitting would race their own submission
        // and could overwrite attempt_data mid-exam.
        String status = attempt.getStatus();
        if (AssessmentAttemptEnum.PREVIEW.name().equals(status)
                || AssessmentAttemptEnum.LIVE.name().equals(status)) {
            throw new VacademyException(HttpStatus.BAD_REQUEST,
                    "This student's attempt is still in progress (" + status
                            + "). Files can be attached only after it is submitted.");
        }

        try {
            Map<String, String> attemptDataUpdates = new LinkedHashMap<>();
            if (StringUtils.hasText(request.getStudentFileId())) {
                attemptDataUpdates.put("fileId", request.getStudentFileId());
            }
            if (StringUtils.hasText(request.getReportFileId())) {
                attemptDataUpdates.put("reportFileId", request.getReportFileId());
            }

            if (!attemptDataUpdates.isEmpty()) {
                attempt.setAttemptData(mergeIntoAttemptData(attempt.getAttemptData(), attemptDataUpdates));
            }
            if (StringUtils.hasText(request.getCheckedFileId())) {
                attempt.setEvaluatedFileId(request.getCheckedFileId());
            }

            studentAttemptService.updateStudentAttempt(attempt);
            return ResponseEntity.ok("Done");
        } catch (Exception e) {
            throw new VacademyException("Failed to attach offline files: " + e.getMessage());
        }
    }

    /**
     * Bulk offline data entry: one row per student carrying their total marks and
     * the already-uploaded sheet file ids.
     * <p>
     * Each row is isolated — a student whose registration can't be resolved fails
     * alone and the rest still import, because re-running a 200-row scan batch to
     * get past one bad roll number is not a reasonable ask of an admin.
     */
    public ResponseEntity<OfflineBulkImportResponse> bulkImportOfflineEntries(
            CustomUserDetails userDetails,
            String assessmentId,
            String instituteId,
            OfflineBulkImportRequest request) {
        if (request == null || request.getEntries() == null || request.getEntries().isEmpty()) {
            throw new VacademyException("Invalid Request: no entries to import");
        }

        List<OfflineBulkImportResponse.OfflineBulkImportResult> results = new ArrayList<>();
        int successCount = 0;

        for (OfflineBulkImportRequest.OfflineBulkImportEntry entry : request.getEntries()) {
            try {
                String attemptId = importSingleEntry(userDetails, assessmentId, instituteId, entry);
                results.add(OfflineBulkImportResponse.OfflineBulkImportResult.builder()
                        .rowLabel(entry.getRowLabel())
                        .username(entry.getUsername())
                        .status("SUCCESS")
                        .attemptId(attemptId)
                        .build());
                successCount++;
            } catch (Exception e) {
                log.error("Bulk offline import failed for row {}: {}", entry.getRowLabel(), e.getMessage());
                results.add(OfflineBulkImportResponse.OfflineBulkImportResult.builder()
                        .rowLabel(entry.getRowLabel())
                        .username(entry.getUsername())
                        .status("FAILED")
                        .message(e.getMessage())
                        .build());
            }
        }

        return ResponseEntity.ok(OfflineBulkImportResponse.builder()
                .results(results)
                .successCount(successCount)
                .failureCount(results.size() - successCount)
                .build());
    }

    private String importSingleEntry(
            CustomUserDetails userDetails,
            String assessmentId,
            String instituteId,
            OfflineBulkImportRequest.OfflineBulkImportEntry entry) {

        requireNotFinalizedForApiExam(assessmentId, entry);

        OfflineAttemptCreateRequest createRequest = OfflineAttemptCreateRequest.builder()
                .userId(entry.getUserId())
                .fullName(entry.getFullName())
                .email(entry.getEmail())
                .username(entry.getUsername())
                .mobileNumber(entry.getMobileNumber())
                .batchId(entry.getBatchId())
                .build();

        OfflineAttemptCreateResponse created = createOfflineAttempt(
                userDetails, assessmentId, entry.getRegistrationId(), instituteId, createRequest).getBody();
        if (created == null) throw new VacademyException("Could not create an attempt for this student");

        StudentAttempt attempt = studentAttemptService.getStudentAttemptById(created.getAttemptId())
                .orElseThrow(() -> new VacademyException("Attempt Not Found after creation"));

        applyBulkMarksAndFiles(attempt, entry);
        studentAttemptService.updateStudentAttempt(attempt);

        return attempt.getId();
    }

    /**
     * A bulk marks import creates and releases a new attempt. On a partner-API exam whose
     * candidate already has a released (finalized) result that would publish a second
     * result over it, so the row is refused until the result is unfinalized (gate G8).
     * Dashboard exams are unaffected.
     */
    private void requireNotFinalizedForApiExam(String assessmentId,
            OfflineBulkImportRequest.OfflineBulkImportEntry entry) {
        if (resultLockGuard == null) {
            return;
        }
        Optional<AssessmentUserRegistration> registration = Optional.empty();
        if (StringUtils.hasText(entry.getRegistrationId())) {
            registration = assessmentUserRegistrationRepository.findById(entry.getRegistrationId());
        } else if (StringUtils.hasText(entry.getUserId())) {
            registration = assessmentUserRegistrationRepository.findTopByUserIdAndAssessmentId(entry.getUserId(),
                    assessmentId);
        }
        registration.filter(r -> r.getAssessment() != null && assessmentId.equals(r.getAssessment().getId()))
                .ifPresent(resultLockGuard::requireNoFinalizedAttemptForApiExam);
    }

    private void applyBulkMarksAndFiles(StudentAttempt attempt, OfflineBulkImportRequest.OfflineBulkImportEntry entry) {
        if (entry.getTotalMarks() != null) {
            // Mirrors manual evaluation's submit: for a hand-checked paper the
            // admin's total IS the result, and entering it IS the release — the
            // learner would otherwise sit on "Pending evaluation" forever.
            attempt.setTotalMarks(entry.getTotalMarks());
            attempt.setResultMarks(entry.getTotalMarks());
            attempt.setResultStatus(AttemptResultStatusEnum.COMPLETED.name());
            attempt.setReportReleaseStatus(ReleaseResultStatusEnum.RELEASED.name());
            attempt.setReportLastReleaseDate(DateUtil.getCurrentUtcTime());
        }

        Map<String, String> attemptDataUpdates = new LinkedHashMap<>();
        if (StringUtils.hasText(entry.getStudentFileId())) {
            attemptDataUpdates.put("fileId", entry.getStudentFileId());
        }
        if (StringUtils.hasText(entry.getReportFileId())) {
            attemptDataUpdates.put("reportFileId", entry.getReportFileId());
        }
        if (!attemptDataUpdates.isEmpty()) {
            try {
                attempt.setAttemptData(mergeIntoAttemptData(attempt.getAttemptData(), attemptDataUpdates));
            } catch (Exception e) {
                throw new VacademyException("Failed to attach files: " + e.getMessage());
            }
        }
        if (StringUtils.hasText(entry.getCheckedFileId())) {
            attempt.setEvaluatedFileId(entry.getCheckedFileId());
        }
    }

    /**
     * Merges keys into the attempt_data JSON, preserving every other key. A
     * null/blank/unparseable blob starts from an empty object rather than failing —
     * the response payload is rebuilt on submit anyway, and losing an attachment
     * to a malformed blob is worse than losing the malformed blob.
     */
    private String mergeIntoAttemptData(String attemptData, Map<String, String> updates) throws Exception {
        Map<String, Object> jsonMap = new HashMap<>();
        if (StringUtils.hasText(attemptData)) {
            try {
                jsonMap = objectMapper.readValue(attemptData, Map.class);
            } catch (Exception e) {
                log.warn("Unparseable attempt_data while attaching offline files, starting fresh: {}", e.getMessage());
            }
        }
        jsonMap.putAll(updates);
        return objectMapper.writeValueAsString(jsonMap);
    }

    private String buildAttemptDataJson(String attemptId, String assessmentId, OfflineResponseSubmitRequest request) {
        try {
            List<SectionAttemptData> sectionAttemptDataList = request.getSections().stream()
                    .map(this::buildSectionAttemptData)
                    .collect(Collectors.toList());

            LearnerAssessmentAttemptDataDto attemptData = LearnerAssessmentAttemptDataDto.builder()
                    .attemptId(attemptId)
                    .assessment(AssessmentAttemptData.builder()
                            .assessmentId(assessmentId)
                            .timeElapsedInSeconds(0L)
                            .build())
                    .sections(sectionAttemptDataList)
                    .build();

            return objectMapper.writeValueAsString(attemptData);
        } catch (Exception e) {
            throw new VacademyException("Failed to build attempt data JSON: " + e.getMessage());
        }
    }

    private SectionAttemptData buildSectionAttemptData(OfflineSectionResponse sectionResponse) {
        List<QuestionAttemptData> questionAttemptDataList = sectionResponse.getQuestions().stream()
                .map(this::buildQuestionAttemptData)
                .collect(Collectors.toList());

        return SectionAttemptData.builder()
                .sectionId(sectionResponse.getSectionId())
                .sectionDurationLeftInSeconds(0L)
                .timeElapsedInSeconds(0L)
                .questions(questionAttemptDataList)
                .build();
    }

    private QuestionAttemptData buildQuestionAttemptData(OfflineQuestionResponse questionResponse) {
        return QuestionAttemptData.builder()
                .questionId(questionResponse.getQuestionId())
                .isMarkedForReview(false)
                .isVisited(true)
                .timeTakenInSeconds(0L)
                .responseData(QuestionAttemptData.OptionsJson.builder()
                        .type(questionResponse.getType())
                        .optionIds(questionResponse.getOptionIds() != null ? questionResponse.getOptionIds() : new ArrayList<>())
                        // Typed answers (partner API): null for the dashboard's option-only
                        // entry, and then left out of the JSON.
                        .answer(questionResponse.getAnswer())
                        .validAnswer(questionResponse.getValidAnswer())
                        .build())
                .build();
    }
}
