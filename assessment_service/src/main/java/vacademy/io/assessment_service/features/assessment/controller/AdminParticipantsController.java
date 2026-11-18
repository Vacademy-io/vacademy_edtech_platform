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


    @GetMapping("/get-report-detail")
    public ResponseEntity<StudentReportOverallDetailDto> studentReportDetails(@RequestAttribute("user") CustomUserDetails userDetails,
                                                                              @RequestParam("assessmentId") String assessmentId,
                                                                              @RequestParam("attemptId") String attemptId,
                                                                              @RequestParam("instituteId") String instituteId) {
        return assessmentParticipantsManager.getStudentReportDetails(userDetails, assessmentId, attemptId, instituteId);
    }

    /**
     * Staff sets one question's marks on one attempt from the submission view (any
     * question type; AI-marked questions go through the AI review override). The
     * total is recomputed; the release status is left as it is.
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

        return ResponseEntity.ok(questionMarksOverrideService.override(assessmentId, attemptId,
                request.getSectionId(), request.getQuestionId(), request.getMarks(), request.getFeedback(),
                userDetails.getUserId()));
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
