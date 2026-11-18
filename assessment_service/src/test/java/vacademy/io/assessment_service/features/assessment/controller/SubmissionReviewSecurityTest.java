package vacademy.io.assessment_service.features.assessment.controller;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.request.RevaluateRequest;
import vacademy.io.assessment_service.features.assessment.dto.manual_evaluation.ManualSubmitMarksRequest;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentInstituteMapping;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.manager.AdminAssessmentGetManager;
import vacademy.io.assessment_service.features.assessment.manager.AdminManualEvaluationManager;
import vacademy.io.assessment_service.features.assessment.repository.AiEvaluationProcessRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentInstituteMappingRepository;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.EvaluationAccessValidator;
import vacademy.io.assessment_service.features.submission_review.ReviewFixtures;
import vacademy.io.assessment_service.features.submission_review.service.SubmissionReviewAccess;
import vacademy.io.common.exceptions.ForbiddenException;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Acceptance 7 (manual submit + revaluate security): a learner token, or a clientId other
 * than the institute, gets 403 on manual submit and revaluate.
 */
class SubmissionReviewSecurityTest {

    private AdminManualEvaluationController manual;
    private AdminManualEvaluationManager manualManager;
    private AdminAssessmentGetController revaluate;
    private AdminAssessmentGetManager revaluateManager;
    private StudentAttempt attempt;
    private StudentAttemptRepository attemptRepo;
    private AiEvaluationProcessRepository processRepo;
    private EvaluationAccessValidator validator;

    @BeforeEach
    void setUp() {
        StudentAttemptRepository attempts = mock(StudentAttemptRepository.class);
        AssessmentInstituteMappingRepository mappings = mock(AssessmentInstituteMappingRepository.class);
        attemptRepo = attempts;
        processRepo = mock(AiEvaluationProcessRepository.class);
        validator = new EvaluationAccessValidator(attempts, processRepo, mappings);
        attempt = ReviewFixtures.attempt("att-1", ReviewFixtures.assessment("A", "MANUAL", false), "ENDED");
        when(attempts.findById("att-1")).thenReturn(Optional.of(attempt));
        when(mappings.findByAssessmentIdAndInstituteId("A", "inst-1"))
                .thenReturn(Optional.of(new AssessmentInstituteMapping()));

        manual = new AdminManualEvaluationController();
        manualManager = mock(AdminManualEvaluationManager.class);
        ReflectionTestUtils.setField(manual, "adminManualEvaluationManager", manualManager);
        ReflectionTestUtils.setField(manual, "accessValidator", validator);
        ReflectionTestUtils.setField(manual, "submissionReviewAccess", new SubmissionReviewAccess());

        revaluate = new AdminAssessmentGetController();
        revaluateManager = mock(AdminAssessmentGetManager.class);
        ReflectionTestUtils.setField(revaluate, "adminAssessmentGetManager", revaluateManager);
        ReflectionTestUtils.setField(revaluate, "revaluateAccessValidator", validator);
    }

    @Test
    void learner_cannot_submit_marks() {
        assertThatThrownBy(() -> manual.submitManualMarks(ReviewFixtures.user("learner-1", "STUDENT"), "inst-1", "A",
                "inst-1", "att-1", new ManualSubmitMarksRequest())).isInstanceOf(ForbiddenException.class);
        verifyNoInteractions(manualManager);
    }

    @Test
    void other_institute_cannot_submit_marks() {
        assertThatThrownBy(() -> manual.submitManualMarks(ReviewFixtures.user("t-1", "TEACHER"), "inst-2", "A",
                "inst-1", "att-1", new ManualSubmitMarksRequest())).isInstanceOf(ForbiddenException.class);
        assertThatThrownBy(() -> manual.submitManualMarks(ReviewFixtures.user("t-1", "TEACHER"), "inst-2", "A",
                "inst-2", "att-1", new ManualSubmitMarksRequest())).isInstanceOf(ForbiddenException.class);
        verifyNoInteractions(manualManager);
    }

    @Test
    void evaluator_only_on_assigned_attempts() {
        attempt.setCommaSeparatedEvaluatorUserIds("someone-else");
        assertThatThrownBy(() -> manual.submitManualMarks(ReviewFixtures.user("ev-1", "EVALUATOR"), "inst-1", "A",
                "inst-1", "att-1", new ManualSubmitMarksRequest())).isInstanceOf(ForbiddenException.class);
        attempt.setCommaSeparatedEvaluatorUserIds("ev-1");
        manual.submitManualMarks(ReviewFixtures.user("ev-1", "EVALUATOR"), "inst-1", "A", "inst-1", "att-1",
                new ManualSubmitMarksRequest());
        verify(manualManager).submitManualEvaluatedMarks(any(), any(), any(), any(), any());
    }

    @Test
    void learner_and_other_institute_cannot_revaluate() {
        assertThatThrownBy(() -> revaluate.revaluateAssessment(ReviewFixtures.user("learner-1", "STUDENT"), "inst-1",
                "A", "inst-1", new RevaluateRequest(), "ENTIRE_ASSESSMENT")).isInstanceOf(ForbiddenException.class);
        assertThatThrownBy(() -> revaluate.revaluateAssessment(ReviewFixtures.user("t-1", "ADMIN"), "inst-2",
                "A", "inst-1", new RevaluateRequest(), "ENTIRE_ASSESSMENT")).isInstanceOf(ForbiddenException.class);
        assertThatThrownBy(() -> revaluate.revaluateAssessment(ReviewFixtures.user("t-1", "ADMIN"), "inst-9",
                "A", "inst-9", new RevaluateRequest(), "ENTIRE_ASSESSMENT")).isInstanceOf(ForbiddenException.class);
        verifyNoInteractions(revaluateManager);
        revaluate.revaluateAssessment(ReviewFixtures.user("t-1", "ADMIN"), "inst-1", "A", "inst-1",
                new RevaluateRequest(), "ENTIRE_ASSESSMENT");
        verify(revaluateManager).revaluateAssessment(any(), any(), any(), any(), any());
    }

    // ---------------------------------------------------------------- review fixes (2026-11-18)

    /** Review 3 #1: the attempt ids of a re-mark must be the assessment's own. */
    @Test
    void remark_of_another_assessments_attempts_is_refused() {
        RevaluateRequest request = new RevaluateRequest();
        request.setAttemptIds(java.util.List.of("att-1", "foreign"));
        when(attemptRepo.findIdsOnAssessment(org.mockito.ArgumentMatchers.eq("A"), org.mockito.ArgumentMatchers.anyList()))
                .thenReturn(java.util.List.of("att-1"));
        assertThatThrownBy(() -> revaluate.revaluateAssessment(ReviewFixtures.user("t-1", "ADMIN"), "inst-1", "A",
                "inst-1", request, "PARTICIPANTS_AND_QUESTIONS")).isInstanceOf(ForbiddenException.class);
        assertThatThrownBy(() -> revaluate.revaluateAssessment(ReviewFixtures.user("t-1", "ADMIN"), "inst-1", "A",
                "inst-1", request, "ENTIRE_ASSESSMENT_PARTICIPANTS")).isInstanceOf(ForbiddenException.class);
        verifyNoInteractions(revaluateManager);
        request.setAttemptIds(java.util.List.of("att-1"));
        revaluate.revaluateAssessment(ReviewFixtures.user("t-1", "ADMIN"), "inst-1", "A", "inst-1", request,
                "PARTICIPANTS_AND_QUESTIONS");
        verify(revaluateManager).revaluateAssessment(any(), any(), any(), any(), any());
    }

    /**
     * Review 3 #2, widened by pre-ship review R2: the W9 release (opt-in flags) is open to
     * every staff role except evaluator-only; the old body keeps today's staff rule.
     */
    @Test
    void w9_release_result_is_refused_only_to_an_evaluator() {
        AdminParticipantsController release = new AdminParticipantsController();
        var manager = mock(vacademy.io.assessment_service.features.assessment.manager.AssessmentParticipantsManager.class);
        ReflectionTestUtils.setField(release, "assessmentParticipantsManager", manager);
        ReflectionTestUtils.setField(release, "accessValidator", validator);
        ReflectionTestUtils.setField(release, "submissionReviewAccess", new SubmissionReviewAccess());
        var w9 = new vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.request.ReleaseRequestDto(
                java.util.List.of());
        w9.setAllowUnmarked(true);
        assertThatThrownBy(() -> release.releaseResult(ReviewFixtures.user("ev-1", "EVALUATOR"), "inst-1", "A", "inst-1",
                w9, "ASSESSMENT_ALL")).isInstanceOf(ForbiddenException.class);
        assertThatThrownBy(() -> release.releaseResult(ReviewFixtures.user("l-1", "STUDENT"), "inst-1", "A", "inst-1",
                w9, "ASSESSMENT_ALL")).isInstanceOf(ForbiddenException.class);
        assertThatThrownBy(() -> release.releaseResult(ReviewFixtures.user("c-1", "ASSESSMENT CREATOR"), "inst-2", "A",
                "inst-1", w9, "ASSESSMENT_ALL")).isInstanceOf(ForbiddenException.class);
        verifyNoInteractions(manager);
        // The PDF tool's follow-up call (old body) by an evaluator keeps working.
        release.releaseResult(ReviewFixtures.user("ev-1", "EVALUATOR"), "inst-1", "A", "inst-1",
                new vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.request.ReleaseRequestDto(
                        java.util.List.of("att-1")), "PARTICIPANTS");
        release.releaseResult(ReviewFixtures.user("t-1", "TEACHER"), "inst-1", "A", "inst-1", w9, "ASSESSMENT_ALL");
        release.releaseResult(ReviewFixtures.user("m-1", "MENTOR"), "inst-1", "A", "inst-1", w9, "ASSESSMENT_ALL");
        release.releaseResult(ReviewFixtures.user("c-1", "ASSESSMENT CREATOR"), "inst-1", "A", "inst-1", w9,
                "ASSESSMENT_ALL");
        release.releaseResult(ReviewFixtures.user("x-1", "EXAM COORDINATOR"), "inst-1", "A", "inst-1", w9,
                "ASSESSMENT_ALL");
        verify(manager, org.mockito.Mockito.times(5)).releaseParticipantsResult(any(), any(), any(), any(), any());
    }

    /** Review 3 #3: the old AI review PUT follows the same edit rule as the submission page. */
    @Test
    void ai_review_put_follows_the_edit_rule() {
        var process = new vacademy.io.assessment_service.features.assessment.entity.AiEvaluationProcess();
        process.setId("p1");
        process.setStudentAttempt(attempt);
        when(processRepo.findById("p1")).thenReturn(Optional.of(process));
        var reviewService = mock(vacademy.io.assessment_service.features.assessment.service.evaluation_ai.AiEvaluationReviewService.class);
        var controller = new vacademy.io.assessment_service.features.assessment.controller.evaluation_ai.AiEvaluationController(
                null, null, reviewService, null, validator, null, null);
        ReflectionTestUtils.setField(controller, "submissionReviewAccess", new SubmissionReviewAccess());
        var body = new vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.QuestionOverrideRequest();
        body.setMarksAwarded(3.0);
        attempt.setReportReleaseStatus("RELEASED");
        assertThatThrownBy(() -> controller.overrideQuestion(ReviewFixtures.user("ev-1", "EVALUATOR"), "inst-1", "p1",
                "q1", body)).isInstanceOf(RuntimeException.class);
        assertThatThrownBy(() -> controller.overrideQuestion(ReviewFixtures.user("l-1", "STUDENT"), "inst-1", "p1",
                "q1", body)).isInstanceOf(ForbiddenException.class);
        verifyNoInteractions(reviewService);
        controller.overrideQuestion(ReviewFixtures.user("t-1", "TEACHER"), "inst-1", "p1", "q1", body);
        // Pre-ship review R2: every other staff role edits as before 1a, after release too.
        controller.overrideQuestion(ReviewFixtures.user("m-1", "MENTOR"), "inst-1", "p1", "q1", body);
        controller.overrideQuestion(ReviewFixtures.user("c-1", "ASSESSMENT CREATOR"), "inst-1", "p1", "q1", body);
        controller.overrideQuestion(ReviewFixtures.user("x-1", "EXAM COORDINATOR"), "inst-1", "p1", "q1", body);
        verify(reviewService, org.mockito.Mockito.times(4)).overrideQuestion(any(), any(), any(), any(), any(), any());
    }

    /** Review 3 #5: the attempt-level manual-evaluation endpoints are staff of the attempt's institute only. */
    @Test
    void manual_evaluation_attempt_endpoints_are_tenant_scoped() {
        var learner = ReviewFixtures.user("learner-1", "STUDENT");
        var otherAdmin = ReviewFixtures.user("x-1", "ADMIN");
        assertThatThrownBy(() -> manual.updateAttemptResponse(learner, "inst-1", "att-1", "file-9"))
                .isInstanceOf(ForbiddenException.class);
        assertThatThrownBy(() -> manual.updateAttemptResponse(otherAdmin, "inst-2", "att-1", "file-9"))
                .isInstanceOf(ForbiddenException.class);
        assertThatThrownBy(() -> manual.updateAttemptSet(learner, "inst-1", "att-1", "set-1"))
                .isInstanceOf(ForbiddenException.class);
        assertThatThrownBy(() -> manual.getAttemptData(otherAdmin, "inst-2", "att-1", false))
                .isInstanceOf(ForbiddenException.class);
        assertThatThrownBy(() -> manual.getAttemptsFileStatus(learner, "inst-1", java.util.List.of("att-1")))
                .isInstanceOf(ForbiddenException.class);
        verifyNoInteractions(manualManager);

        var admin = ReviewFixtures.user("a-1", "ADMIN");
        manual.updateAttemptResponse(admin, "inst-1", "att-1", "file-9");
        verify(manualManager).updateAttemptResponse(admin, "att-1", "file-9");
        when(attemptRepo.findIdsInInstitute(org.mockito.ArgumentMatchers.eq("inst-1"), org.mockito.ArgumentMatchers.anyList()))
                .thenReturn(java.util.List.of("att-1"));
        manual.getAttemptsFileStatus(admin, "inst-1", java.util.List.of("att-1", "foreign"));
        verify(manualManager).getAttemptsFileStatus(admin, java.util.List.of("att-1"));
    }
}
