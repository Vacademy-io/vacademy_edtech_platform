package vacademy.io.assessment_service.features.learner_assessment.manager;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import vacademy.io.assessment_service.features.announcement.entity.AssessmentAnnouncement;
import vacademy.io.assessment_service.features.announcement.service.AnnouncementService;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.enums.DurationDistributionEnum;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.assessment.service.AttemptDataParserService;
import vacademy.io.assessment_service.features.learner_assessment.dto.AssessmentAttemptUpdateRequest;
import vacademy.io.assessment_service.features.learner_assessment.dto.DataDurationDistributionDto;
import vacademy.io.assessment_service.features.learner_assessment.dto.LearnerAssessmentStartAssessmentResponse;
import vacademy.io.assessment_service.features.learner_assessment.dto.LearnerAssessmentStartPreviewResponse;
import vacademy.io.assessment_service.features.learner_assessment.dto.response.AssessmentRestartResponse;
import vacademy.io.assessment_service.features.learner_assessment.dto.response.BasicLevelAnnouncementDto;
import vacademy.io.assessment_service.features.learner_assessment.dto.response.LearnerUpdateStatusResponse;
import vacademy.io.assessment_service.features.learner_assessment.enums.AssessmentAttemptEnum;
import vacademy.io.assessment_service.features.learner_assessment.enums.AssessmentAttemptResultEnum;
import vacademy.io.assessment_service.features.learner_assessment.service.AssessmentLLMAnalyticsService;
import vacademy.io.assessment_service.features.learner_assessment.service.RestartAssessmentService;
import vacademy.io.assessment_service.features.question_core.enums.EvaluationTypes;
import vacademy.io.assessment_service.features.assessment.service.StudentAttemptService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.core.utils.DateUtil;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.assessment_service.core.exception.VacademyException;
import vacademy.io.common.logging.SentryLogger;

import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.util.*;

/**
 * Manages the status of learner assessment attempts and updates the learner's
 * progress.
 */
@Slf4j
@Component
public class LearnerAssessmentAttemptStatusManager {

        @Autowired
        StudentAttemptRepository studentAttemptRepository;

        @Autowired
        AnnouncementService announcementService;

        @Autowired
        StudentAttemptService studentAttemptService;

        @Autowired
        AttemptDataParserService attemptDataParserService;

        @Autowired
        LearnerAssessmentAttemptStartManager learnerAssessmentAttemptStartManager;

        @Autowired
        RestartAssessmentService restartAssessmentService;

        @Autowired
        vacademy.io.assessment_service.features.assessment.service.evaluation_ai.AiEvaluationSubmissionEnqueuer aiEvaluationSubmissionEnqueuer;

        @Autowired
        AssessmentLLMAnalyticsService assessmentLLMAnalyticsService;

        @Autowired
        vacademy.io.assessment_service.features.assessment.service.AssessmentWorkflowEventPublisher assessmentWorkflowEventPublisher;

        /**
         * Attempt ids with a live-sync marks recalculation currently queued or
         * running. During a live exam every 60s sync enqueues a full recalc; when
         * the async pool falls behind, duplicates for the same attempt pile up in
         * the queue doing identical work. Skipping while one is in flight loses
         * nothing: the next sync re-enqueues with newer data, and the submit /
         * expiry paths always run the authoritative calculation regardless.
         */
        private final Set<String> attemptsWithRecalcInFlight = java.util.concurrent.ConcurrentHashMap.newKeySet();

        /**
         * Reject an attempt that does not belong to the caller.
         * <p>
         * These endpoints previously checked only that the attempt belonged to the
         * ASSESSMENT in the query string — never that it belonged to the caller. Since
         * the attempt id is the only other input, any authenticated learner could sync
         * over, or submit, another learner's exam.
         * <p>
         * Staff are let through deliberately: evaluators and admins legitimately act on
         * a learner's attempt, and this guard exists to stop learner-on-learner access,
         * not to narrow what staff can already do.
         */
        static void assertOwnershipOrStaff(StudentAttempt attempt, CustomUserDetails user, String operation) {
                if (user == null) {
                        throw new ForbiddenException("Not allowed to access this attempt");
                }
                String ownerId = attempt.getRegistration() == null ? null : attempt.getRegistration().getUserId();
                if (ownerId != null && ownerId.equals(user.getUserId())) {
                        return;
                }
                if (isStaff(user)) {
                        return;
                }
                log.warn("Blocked cross-user attempt access during {}: attemptId={}, ownerUserId={}, callerUserId={}",
                                operation, attempt.getId(), ownerId, user.getUserId());
                throw new ForbiddenException("Not allowed to access this attempt");
        }

        private static boolean isStaff(CustomUserDetails user) {
                if (user.isRootUser()) return true;
                return user.getAuthorities() != null && user.getAuthorities().stream()
                                .map(authority -> authority.getAuthority() == null ? ""
                                                : authority.getAuthority().toUpperCase())
                                .anyMatch(STAFF_AUTHORITIES::contains);
        }

        private static final Set<String> STAFF_AUTHORITIES = Set.of("ADMIN", "EVALUATOR", "TEACHER", "CREATOR");

        /**
         * Converts the duration distribution data into a list of duration responses.
         *
         * @param durationData the duration data in JSON format
         * @return a list of duration responses
         */
        public static List<LearnerUpdateStatusResponse.DurationResponse> convertToDurationList(String durationData) {
                try {
                        List<LearnerUpdateStatusResponse.DurationResponse> durationResponses = new ArrayList<>();

                        if (Objects.isNull(durationData))
                                return durationResponses;

                        ObjectMapper objectMapper = new ObjectMapper();
                        DataDurationDistributionDto dataDurationDistributionDto = objectMapper.readValue(durationData,
                                        DataDurationDistributionDto.class);

                        return mapToDurationResponses(dataDurationDistributionDto);
                } catch (Exception e) {
                        throw new VacademyException("Invalid Data Duration format: " + e.getMessage());
                }
        }

        /**
         * Maps the DataDurationDistributionDto object to a list of duration response
         * objects.
         *
         * @param dto the DataDurationDistributionDto object containing duration data
         * @return a list of duration response objects
         */
        public static List<LearnerUpdateStatusResponse.DurationResponse> mapToDurationResponses(
                        DataDurationDistributionDto dto) {
                List<LearnerUpdateStatusResponse.DurationResponse> durationResponses = new ArrayList<>();

                if (dto == null || dto.getDataDuration() == null) {
                        return durationResponses;
                }

                DataDurationDistributionDto.DataDuration dataDuration = dto.getDataDuration();

                // Convert assessment duration
                Optional.ofNullable(dataDuration.getAssessmentDuration())
                                .ifPresent(assessment -> durationResponses.add(
                                                new LearnerUpdateStatusResponse.DurationResponse(
                                                                assessment.getId(),
                                                                DurationDistributionEnum.ASSESSMENT.name(),
                                                                assessment.getNewMaxTimeInSeconds())));

                // Convert sections duration
                Optional.ofNullable(dataDuration.getSectionsDuration())
                                .ifPresent(sections -> sections.forEach(section -> durationResponses.add(
                                                new LearnerUpdateStatusResponse.DurationResponse(
                                                                section.getId(),
                                                                DurationDistributionEnum.SECTION.name(),
                                                                section.getNewMaxTimeInSeconds()))));

                // Convert questions duration
                Optional.ofNullable(dataDuration.getQuestionsDuration())
                                .ifPresent(questions -> questions.forEach(question -> durationResponses.add(
                                                new LearnerUpdateStatusResponse.DurationResponse(
                                                                question.getId(),
                                                                DurationDistributionEnum.QUESTION.name(),
                                                                question.getNewMaxTimeInSeconds()))));

                return durationResponses;
        }

        /**
         * Updates the learner's assessment status based on the provided attempt
         * details.
         *
         * @param user         the custom user details
         * @param assessmentId the ID of the assessment
         * @param attemptId    the ID of the student attempt
         * @param request      the JSON content with learner's assessment status
         * @return a ResponseEntity containing the update status response
         */
        public ResponseEntity<LearnerUpdateStatusResponse> updateLearnerStatus(CustomUserDetails user,
                        String assessmentId,
                        String attemptId, AssessmentAttemptUpdateRequest request) {
                Optional<StudentAttempt> studentAttempt = studentAttemptRepository.findById(attemptId);
                if (studentAttempt.isEmpty()) {
                        // Expected client error (stale/invalid attemptId) — slf4j only, NOT Sentry.
                        // This path is hit on every learner sync during live assessments, so a
                        // Sentry event here floods the errors quota for a non-bug.
                        log.warn("Student attempt not found during response update: assessmentId={}, attemptId={}, userId={}",
                                        assessmentId, attemptId, user.getId());
                        throw new VacademyException("Student Attempt Not Found");
                }

                if (Objects.isNull(request) || Objects.isNull(request.getJsonContent())) {
                        log.warn("Invalid request during assessment response update: assessmentId={}, attemptId={}, userId={}",
                                        assessmentId, attemptId, user.getId());
                        throw new VacademyException("Invalid request");
                }

                Assessment assessment = studentAttempt.get().getRegistration().getAssessment();
                if (!assessment.getId().equals(assessmentId)) {
                        log.warn("Student attempt not linked with assessment during update: assessmentId={}, attemptAssessmentId={}, attemptId={}, userId={}",
                                        assessmentId, assessment.getId(), attemptId, user.getId());
                        throw new VacademyException("Student Not Linked with Assessment");
                }

                assertOwnershipOrStaff(studentAttempt.get(), user, "status-update");

                // Check if the attempt status is preview
                if (AssessmentAttemptEnum.PREVIEW.name().equals(studentAttempt.get().getStatus())) {
                        log.warn("Attempt to update preview assessment: assessmentId={}, attemptId={}, userId={}",
                                        assessmentId, attemptId, user.getId());
                        throw new VacademyException("Currently Assessment is in preview");
                }

                StudentAttempt attempt = new StudentAttempt();

                // Handle cases where the attempt status is either 'ENDED' or 'LIVE'
                if (AssessmentAttemptEnum.ENDED.name().equals(studentAttempt.get().getStatus()))
                        attempt = handleAttemptEndedStatus(studentAttempt, request.getJsonContent());

                if (AssessmentAttemptEnum.LIVE.name().equals(studentAttempt.get().getStatus()))
                        attempt = handleAttemptLiveStatus(studentAttempt, request.getJsonContent());

                try {
                        // MANUAL-evaluation assessments (PDF answer-sheet upload, and
                        // coding/subjective) are graded by a human or the AI evaluator, never by
                        // this auto-scorer. Re-scoring every question on every 60s sync is pure
                        // waste for them: the total it computes is discarded, because on submit
                        // updateStudentAttemptWithResultAfterMarksCalculation explicitly refuses
                        // to set resultMarks for MANUAL.
                        //
                        // Safe to skip because question_wise_marks rows are always produced by
                        // one of the terminal paths, never by this sync:
                        //   - PDF upload            -> /manual-status/submit
                        //                              (createOrUpdateQuestionWiseMarksDataForManualAssessment)
                        //   - coding/subjective     -> /status/submit (full calculation)
                        //   - learner never submits -> hourly AssessmentAttemptEndTaskExecutor
                        //                              (updateStudentAttemptResultAfterMarksCalculationAsync)
                        //
                        // The learner's work is still persisted every 60s -- handleAttemptLive/
                        // EndedStatus above already saved attempt_data before this point. Only the
                        // scoring pass is skipped, so nothing is lost if the browser dies.
                        if (isManualEvaluation(assessment)) {
                                log.debug("Skipping live-sync marks calculation for MANUAL assessment: assessmentId={}, attemptId={}",
                                                assessmentId, attemptId);
                        } else if (attemptsWithRecalcInFlight.add(attemptId)) {
                                // Update the student attempt asynchronously; the in-flight guard is
                                // released when the async run finishes (or if enqueueing itself fails,
                                // via the catch below).
                                studentAttemptService
                                                .updateStudentAttemptWithTotalAfterMarksCalculationAsync(Optional.of(attempt))
                                                .whenComplete((result, error) -> attemptsWithRecalcInFlight.remove(attemptId));
                        } else {
                                log.debug("Skipping duplicate live-sync marks calculation, one already in flight: attemptId={}",
                                                attemptId);
                        }
                } catch (Exception e) {
                        // Release the in-flight guard: if enqueueing threw, no whenComplete
                        // callback exists to clear it, and a leaked entry would silently stop
                        // all future live-sync recalcs for this attempt.
                        attemptsWithRecalcInFlight.remove(attemptId);
                        log.error("Error while updating student attempt or calculating marks: {}", e.getMessage());
                        SentryLogger.SentryEventBuilder.error(e)
                                        .withMessage("Failed to update student attempt or calculate marks")
                                        .withTag("assessment.id", assessmentId)
                                        .withTag("attempt.id", attemptId)
                                        .withTag("attempt.status", studentAttempt.get().getStatus())
                                        .withTag("user.id", user.getId())
                                        .withTag("operation", "updateStudentAttemptAsync")
                                        .send();
                }

                // Create and return the response for update status
                LearnerUpdateStatusResponse response = createResponseForUpdateStatus(Optional.of(assessment),
                                Optional.of(attempt));
                return ResponseEntity.ok(response);
        }

        /**
         * True when the assessment is graded by a human/AI evaluator rather than the
         * auto-scorer. Defaults to false on any failure so an unexpected state falls
         * back to the previous behaviour (score it) rather than silently skipping.
         */
        private boolean isManualEvaluation(Assessment assessment) {
                try {
                        return assessment != null
                                        && EvaluationTypes.MANUAL.name().equals(assessment.getEvaluationType());
                } catch (Exception e) {
                        log.error("Failed to resolve evaluation type, will score as usual: {}", e.getMessage());
                        return false;
                }
        }

        /**
         * Creates the response for updating the learner's assessment status.
         *
         * @param assessmentOptional     the optional assessment
         * @param studentAttemptOptional the optional student attempt
         * @return the learner update status response
         */
        private LearnerUpdateStatusResponse createResponseForUpdateStatus(Optional<Assessment> assessmentOptional,
                        Optional<StudentAttempt> studentAttemptOptional) {
                if (studentAttemptOptional.isEmpty() || assessmentOptional.isEmpty())
                        throw new VacademyException("Invalid request");

                // Retrieve and map announcements
                List<AssessmentAnnouncement> allAnnouncement = announcementService
                                .getAnnouncementForAssessment(assessmentOptional.get().getId());
                List<BasicLevelAnnouncementDto> allAnnouncementResponse = announcementService
                                .createBasicLevelAnnouncementDto(allAnnouncement);

                // Convert duration distribution to response format
                String durationDistribution = studentAttemptOptional.get().getDurationDistributionJson();
                List<LearnerUpdateStatusResponse.DurationResponse> durationResponses = convertToDurationList(
                                durationDistribution);

                return LearnerUpdateStatusResponse.builder()
                                .announcements(allAnnouncementResponse)
                                .control(new ArrayList<>()) // Placeholder for any control-related info
                                .duration(durationResponses)
                                .build();
        }

        /**
         * Handles the case where the student attempt status is 'ENDED'.
         *
         * @param studentAttemptOptional the optional student attempt
         * @param attemptDataJson        the attempt data in JSON format
         * @return the updated student attempt
         */
        private StudentAttempt handleAttemptEndedStatus(Optional<StudentAttempt> studentAttemptOptional,
                        String attemptDataJson) {
                // Check if student attempt data has changed
                if (Objects.isNull(studentAttemptOptional.get().getAttemptData())
                                || !studentAttemptOptional.get().getAttemptData().equals(attemptDataJson)) {
                        StudentAttempt studentAttempt = studentAttemptOptional.get();
                        studentAttempt.setAttemptData(attemptDataJson);

                        ZonedDateTime utcNow = ZonedDateTime.now(ZoneOffset.UTC);
                        Date utcDate = Date.from(utcNow.toInstant());
                        studentAttempt.setServerLastSync(utcDate); // Set server sync time

                        studentAttempt.setClientLastSync(
                                        DateUtil.convertStringToUTCDate(attemptDataParserService
                                                        .getClientLastSyncTime(attemptDataJson))); // Set
                                                                                                   // client
                                                                                                   // sync
                                                                                                   // time
                        return studentAttemptRepository.save(studentAttempt); // Save updated attempt
                }

                return studentAttemptOptional.get(); // If no changes, return existing attempt
        }

        /**
         * Handles the case where the student attempt status is 'LIVE'.
         *
         * @param studentAttemptOptional the optional student attempt
         * @param attemptDataJson        the attempt data in JSON format
         * @return the updated student attempt
         */
        private StudentAttempt handleAttemptLiveStatus(Optional<StudentAttempt> studentAttemptOptional,
                        String attemptDataJson) {
                StudentAttempt studentAttempt = studentAttemptOptional.get();
                studentAttempt.setAttemptData(attemptDataJson);

                ZonedDateTime utcNow = ZonedDateTime.now(ZoneOffset.UTC);
                Date utcDate = Date.from(utcNow.toInstant());
                studentAttempt.setServerLastSync(utcDate); // Set server sync time

                studentAttempt.setClientLastSync(
                                DateUtil.convertStringToDate(
                                                attemptDataParserService.getClientLastSyncTime(attemptDataJson))); // Set
                                                                                                                   // client
                                                                                                                   // sync
                                                                                                                   // time
                return studentAttemptRepository.save(studentAttempt); // Save updated attempt
        }

        public ResponseEntity<String> submitAssessment(CustomUserDetails user, String assessmentId, String attemptId,
                        AssessmentAttemptUpdateRequest request) {
                Optional<StudentAttempt> studentAttempt = studentAttemptRepository.findById(attemptId);
                if (studentAttempt.isEmpty()) {
                        // Expected client error — slf4j only, NOT Sentry (see updateLearnerStatus).
                        log.warn("Student attempt not found during submission: assessmentId={}, attemptId={}, userId={}",
                                        assessmentId, attemptId, user.getId());
                        throw new VacademyException("Student Attempt Not Found");
                }

                if (Objects.isNull(request) || Objects.isNull(request.getJsonContent())) {
                        log.warn("Invalid request during assessment submission: assessmentId={}, attemptId={}, userId={}",
                                        assessmentId, attemptId, user.getId());
                        throw new VacademyException("Invalid request");
                }

                Assessment assessment = studentAttempt.get().getRegistration().getAssessment();
                if (!assessment.getId().equals(assessmentId)) {
                        log.warn("Assessment mismatch during submission: assessmentId={}, attemptAssessmentId={}, attemptId={}, userId={}",
                                        assessmentId, assessment.getId(), attemptId, user.getId());
                        throw new VacademyException("Student Not Linked with Assessment");
                }

                assertOwnershipOrStaff(studentAttempt.get(), user, "submit");

                // Check if the attempt status is preview
                if (AssessmentAttemptEnum.PREVIEW.name().equals(studentAttempt.get().getStatus())) {
                        log.warn("Attempt to submit preview assessment: assessmentId={}, attemptId={}, userId={}",
                                        assessmentId, attemptId, user.getId());
                        throw new VacademyException("Currently Assessment is in preview");
                }

                StudentAttempt attempt = new StudentAttempt();

                // Handle cases where the attempt status is either 'ENDED' or 'LIVE'
                if (!AssessmentAttemptEnum.PREVIEW.name().equals(studentAttempt.get().getStatus()))
                        attempt = handleAttemptLiveOrEndedStatusWhenSubmit(studentAttempt, request.getJsonContent());

                log.info("[SUBMIT-ASSESSMENT] Attempt saved with status: {}, attemptId: {}", attempt.getStatus(),
                                attempt.getId());

                try {
                        // Update the student attempt asynchronously
                        studentAttemptService
                                        .updateStudentAttemptResultAfterMarksCalculationAsync(Optional.of(attempt));
                        log.info("[SUBMIT-ASSESSMENT] Marks calculation triggered for attemptId: {}", attempt.getId());
                } catch (Exception e) {
                        log.error("[RESULT ERROR] Failed To Update Result Marks:: {}", e.getMessage());
                        SentryLogger.SentryEventBuilder.error(e)
                                        .withMessage("Failed to calculate assessment result marks after submission")
                                        .withTag("assessment.id", assessmentId)
                                        .withTag("attempt.id", attemptId)
                                        .withTag("attempt.status", studentAttempt.get().getStatus())
                                        .withTag("user.id", user.getId())
                                        .withTag("operation", "submitAssessment")
                                        .send();
                }

                try {
                        // Send assessment data to admin core service for LLM analytics (async,
                        // fire-and-forget)
                        assessmentLLMAnalyticsService.sendAssessmentDataForAnalysisAsync(
                                        attempt, assessment.getId(), assessment.getName(),
                                        assessment.getAssessmentType(), assessment.getDuration(), 0);
                } catch (Exception e) {
                        log.error("Failed to send assessment data for analysis - continuing anyway: {}", e.getMessage(),
                                        e);
                }

                // Queue AI evaluation for assessments that opted in (V43). Enqueue only --
                // the poller dispatches -- so the work belongs to a database row rather
                // than to this pod, and survives a deploy or crash right after submit.
                // Self-contained and non-throwing: a submission that succeeded must never
                // be reported as failed because an optional grading step could not start.
                aiEvaluationSubmissionEnqueuer.enqueueIfEnabled(attempt, assessment);

                log.info("[SUBMIT-ASSESSMENT] Submission completed successfully for attemptId: {}", attemptId);
                return ResponseEntity.ok("Done");
        }

        private StudentAttempt handleAttemptLiveOrEndedStatusWhenSubmit(Optional<StudentAttempt> studentAttempt,
                        String attemptStatusData) {
                if (studentAttempt.isEmpty())
                        throw new VacademyException("Attempt Not Found");
                StudentAttempt attempt = studentAttempt.get();
                attempt.setStatus(AssessmentAttemptEnum.ENDED.name());
                attempt.setResultStatus(AssessmentAttemptResultEnum.PENDING.name());
                attempt.setSubmitData(attemptStatusData);
                attempt.setAttemptData(attemptStatusData);
                ZonedDateTime utcNow = ZonedDateTime.now(ZoneOffset.UTC);
                Date utcDate = Date.from(utcNow.toInstant());
                attempt.setSubmitTime(utcDate);

                StudentAttempt saved = studentAttemptService.updateStudentAttempt(attempt);

                // Trigger ASSESSMENT_END workflow
                assessmentWorkflowEventPublisher.publishAssessmentEnd(saved, "SUBMITTED");

                return saved;
        }

        public ResponseEntity<AssessmentRestartResponse> restartAssessment(CustomUserDetails user, String assessmentId,
                        String attemptId, AssessmentAttemptUpdateRequest request) {
                try {
                        if (Objects.isNull(request))
                                throw new VacademyException("Invalid Request");

                        Optional<StudentAttempt> studentAttempt = studentAttemptRepository.findById(attemptId);
                        if (studentAttempt.isEmpty())
                                throw new VacademyException("Student Attempt Not Found");

                        Assessment assessment = studentAttempt.get().getRegistration().getAssessment();
                        if (!assessment.getId().equals(assessmentId))
                                throw new VacademyException("Student Not Linked with Assessment");

                        // Check if the attempt status is preview
                        if (AssessmentAttemptEnum.PREVIEW.name().equals(studentAttempt.get().getStatus()))
                                throw new VacademyException("Currently Assessment is in preview");

                        if (AssessmentAttemptEnum.ENDED.name().equals(studentAttempt.get().getStatus()))
                                throw new VacademyException("Assessment Already Ended");

                        LearnerUpdateStatusResponse updateStatusResponse = handleStatusResponse(studentAttempt,
                                        assessment,
                                        request.getJsonContent());

                        Optional<StudentAttempt> newSavedAttempt = studentAttemptRepository
                                        .findById(studentAttempt.get().getId());
                        if (newSavedAttempt.isEmpty())
                                throw new VacademyException("Attempt Not Found");

                        return ResponseEntity.ok(AssessmentRestartResponse.builder()
                                        .startAssessmentResponse(createStartAssessmentResponse(studentAttempt))
                                        .previewResponse(createLearnerAssessmentPreview(studentAttempt, assessment))
                                        .attemptDataJson(newSavedAttempt.get().getAttemptData())
                                        .updateStatusResponse(updateStatusResponse).build());
                } catch (Exception e) {
                        throw new VacademyException("Failed To Restart: " + e.getMessage());
                }
        }

        private LearnerAssessmentStartAssessmentResponse createStartAssessmentResponse(
                        Optional<StudentAttempt> studentAttempt) {
                if (studentAttempt.isEmpty())
                        throw new VacademyException("Attempt Not Found");

                Date startTime = DateUtil.getCurrentUtcTime();
                Date endTime = DateUtil.addMinutes(startTime, studentAttempt.get().getMaxTime());

                return new LearnerAssessmentStartAssessmentResponse(startTime, endTime, studentAttempt.get().getId(),
                                studentAttempt.get().getRegistration().getId());

        }

        private LearnerUpdateStatusResponse handleStatusResponse(Optional<StudentAttempt> studentAttempt,
                        Assessment assessment, String requestJsonContent) {
                List<LearnerUpdateStatusResponse.DurationResponse> dataDurationResponse = restartAssessmentService
                                .getNewDurationForAssessment(studentAttempt, assessment, requestJsonContent);

                List<AssessmentAnnouncement> allAnnouncement = announcementService
                                .getAnnouncementForAssessment(assessment.getId());
                List<BasicLevelAnnouncementDto> allAnnouncementResponse = announcementService
                                .createBasicLevelAnnouncementDto(allAnnouncement);

                return LearnerUpdateStatusResponse.builder()
                                .duration(dataDurationResponse)
                                .control(new ArrayList<>())
                                .announcements(allAnnouncementResponse).build();
        }

        private LearnerAssessmentStartPreviewResponse createLearnerAssessmentPreview(
                        Optional<StudentAttempt> studentAttempt, Assessment assessment) {
                LearnerAssessmentStartPreviewResponse learnerAssessmentStartPreviewResponse = new LearnerAssessmentStartPreviewResponse();
                learnerAssessmentStartPreviewResponse
                                .setAssessmentUserRegistrationId(studentAttempt.get().getRegistration().getId());
                learnerAssessmentStartPreviewResponse.setAttemptId(studentAttempt.get().getId());
                learnerAssessmentStartPreviewResponse.setPreviewTotalTime(assessment.getPreviewTime());
                learnerAssessmentStartPreviewResponse
                                .setSectionDtos(learnerAssessmentAttemptStartManager.createSectionDtoList(assessment));
                return learnerAssessmentStartPreviewResponse;
        }
}
