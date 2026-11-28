package vacademy.io.assessment_service.features.assessment.controller;


import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.request.ProvideReattemptRequestDto;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.request.QuestionMarksOverrideRequest;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.request.ReleaseRequestDto;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.StudentReportOverallDetailDto;
import vacademy.io.assessment_service.features.assessment.manager.AssessmentParticipantsManager;
import vacademy.io.assessment_service.features.assessment.service.QuestionMarksOverrideService;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.EvaluationAccessValidator;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.Map;

@RestController
@RequestMapping("/assessment-service/admin/participants")
public class AdminParticipantsController {

    @Autowired
    AssessmentParticipantsManager assessmentParticipantsManager;

    @Autowired
    EvaluationAccessValidator accessValidator;

    @Autowired
    QuestionMarksOverrideService questionMarksOverrideService;

    @Autowired(required = false)
    vacademy.io.assessment_service.features.submission_review.service.SubmissionReviewAccess submissionReviewAccess;


    @GetMapping("/get-report-detail")
    public ResponseEntity<StudentReportOverallDetailDto> studentReportDetails(@RequestAttribute("user") CustomUserDetails userDetails,
                                                                              @RequestParam("assessmentId") String assessmentId,
                                                                              @RequestParam("attemptId") String attemptId,
                                                                              @RequestParam("instituteId") String instituteId) {
        return assessmentParticipantsManager.getStudentReportDetails(userDetails, assessmentId, attemptId, instituteId);
    }

    /**
     * Staff sets one question's marks on one attempt (any question type). Kept from PR #3814;
     * it writes through the submission-review MarkWriter like the Submission page (MANUAL
     * mark, history, total, Revised tag). The release status is left as it is.
     */
    @PutMapping("/question-marks")
    public ResponseEntity<Map<String, Object>> overrideQuestionMarks(@RequestAttribute("user") CustomUserDetails userDetails,
                                                                     @RequestHeader(value = "clientId", required = false) String clientId,
                                                                     @RequestParam("assessmentId") String assessmentId,
                                                                     @RequestParam("instituteId") String instituteId,
                                                                     @RequestParam("attemptId") String attemptId,
                                                                     @RequestBody QuestionMarksOverrideRequest request) {
        accessValidator.requireActiveInstitute(clientId, instituteId);
        accessValidator.requireAssessmentInInstitute(userDetails, instituteId, assessmentId);
        accessValidator.requireStaffRole(userDetails);

        // Edit rights of the Submission page (an evaluator-only user: assigned attempts, before
        // release) are checked in the service, which also writes through MarkWriter.
        return ResponseEntity.ok(questionMarksOverrideService.override(userDetails, assessmentId, attemptId, request));
    }

    @PostMapping("/release-result")
    public ResponseEntity<String> releaseResult(@RequestAttribute("user") CustomUserDetails userDetails,
                                                @RequestHeader(value = "clientId", required = false) String clientId,
                                                @RequestParam("assessmentId") String assessmentId,
                                                @RequestParam("instituteId") String instituteId,
                                                @RequestBody ReleaseRequestDto request,
                                                @RequestParam("methodType") String type) {
        // Releasing emails every participant their report: staff of the owning
        // institute only. instituteId must be the clientId the roles came from.
        accessValidator.requireActiveInstitute(clientId, instituteId);
        accessValidator.requireInstituteMembership(userDetails, instituteId);
        accessValidator.requireStaffRole(userDetails);
        // The submission-review release (W9 opt-in flags, incl. "release with unmarked
        // answers"): every staff member except an evaluator-only one, as on the per-learner
        // release (contract 8, pre-ship review R2). The old body (PDF tool follow-up,
        // homework, old callers) keeps today's staff rule.
        if (request != null && request.hasReleaseOptions() && submissionReviewAccess != null) {
            submissionReviewAccess.requireRelease(userDetails);
        }

        return assessmentParticipantsManager.releaseParticipantsResult(userDetails, assessmentId, instituteId, request, type);
    }

    @PostMapping("/provide-reattempt")
    public ResponseEntity<String> provideReattempt(@RequestAttribute("user") CustomUserDetails userDetails,
                                                   @RequestParam("assessmentId") String assessmentId,
                                                   @RequestParam("instituteId") String instituteId,
                                                   @RequestBody ProvideReattemptRequestDto request) {

        return assessmentParticipantsManager.provideReattempt(userDetails, assessmentId, instituteId, request);
    }


}
