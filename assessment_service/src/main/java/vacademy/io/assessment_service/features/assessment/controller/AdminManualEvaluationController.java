package vacademy.io.assessment_service.features.assessment.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.assessment_service.features.assessment.dto.manual_evaluation.EvaluationDraftDto;
import vacademy.io.assessment_service.features.assessment.dto.manual_evaluation.EvaluationDraftRequest;
import vacademy.io.assessment_service.features.assessment.dto.manual_evaluation.ManualAttemptFilter;
import vacademy.io.assessment_service.features.assessment.dto.manual_evaluation.ManualAttemptResponse;
import vacademy.io.assessment_service.features.assessment.dto.manual_evaluation.ManualSubmitMarksRequest;
import vacademy.io.assessment_service.features.assessment.manager.AdminManualEvaluationManager;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;
import java.util.Map;

import static vacademy.io.common.core.constants.PageConstants.DEFAULT_PAGE_NUMBER;
import static vacademy.io.common.core.constants.PageConstants.DEFAULT_PAGE_SIZE;

@RestController
@RequestMapping("/assessment-service/assessment/manual-evaluation")
public class AdminManualEvaluationController {

    @Autowired
    AdminManualEvaluationManager adminManualEvaluationManager;

    @Autowired
    vacademy.io.assessment_service.features.assessment.service.evaluation_ai.EvaluationAccessValidator accessValidator;

    @Autowired(required = false)
    vacademy.io.assessment_service.features.submission_review.service.SubmissionReviewAccess submissionReviewAccess;

    @PostMapping("/submit/marks")
    public ResponseEntity<String> submitManualMarks(@RequestAttribute("user") CustomUserDetails userDetails,
                                                    @RequestHeader(value = "clientId", required = false) String clientId,
                                                    @RequestParam("assessmentId") String assessmentId,
                                                    @RequestParam("instituteId") String instituteId,
                                                    @RequestParam("attemptId") String attemptId,
                                                    @RequestBody ManualSubmitMarksRequest request) {
        // Marks are the result: staff of the attempt's own institute only (a learner token
        // used to be able to submit marks). An evaluator only on attempts assigned to them.
        accessValidator.requireActiveInstitute(clientId, instituteId);
        accessValidator.requireStaffRole(userDetails);
        var attempt = accessValidator.requireAttemptAccess(userDetails, instituteId, attemptId);
        if (submissionReviewAccess != null) {
            submissionReviewAccess.requireManualSubmit(userDetails, attempt);
        }
        return adminManualEvaluationManager.submitManualEvaluatedMarks(userDetails, assessmentId, instituteId, attemptId, request);
    }

    // The four endpoints below take an attempt id: staff of the attempt's own institute only
    // (the clientId header the dashboard always sends). They used to accept any token.
    @PostMapping("/update/set")
    public ResponseEntity<String> updateAttemptSet(@RequestAttribute("user") CustomUserDetails userDetails,
                                                   @RequestHeader(value = "clientId", required = false) String clientId,
                                                   @RequestParam("attemptId") String attemptId,
                                                   @RequestParam("setId") String setId) {
        accessValidator.requireStaffRole(userDetails);
        accessValidator.requireAttemptAccess(userDetails, clientId, attemptId);
        return adminManualEvaluationManager.updateAttemptSet(userDetails, attemptId, setId);
    }

    @PostMapping("/update/attempt")
    public ResponseEntity<String> updateAttemptResponse(@RequestAttribute("user") CustomUserDetails userDetails,
                                                        @RequestHeader(value = "clientId", required = false) String clientId,
                                                        @RequestParam("attemptId") String attemptId,
                                                        @RequestParam("fileId") String fileId) {
        accessValidator.requireStaffRole(userDetails);
        accessValidator.requireAttemptAccess(userDetails, clientId, attemptId);
        return adminManualEvaluationManager.updateAttemptResponse(userDetails, attemptId, fileId);
    }

    // Batch lookup for the submissions table: attemptId -> answer-sheet fileId (only
    // attempts that actually have a submitted file appear in the map). Ids of another
    // institute are dropped.
    @PostMapping("/attempts/file-status")
    public ResponseEntity<Map<String, String>> getAttemptsFileStatus(@RequestAttribute("user") CustomUserDetails userDetails,
                                                                     @RequestHeader(value = "clientId", required = false) String clientId,
                                                                     @RequestBody List<String> attemptIds) {
        accessValidator.requireStaffRole(userDetails);
        accessValidator.requireInstituteMembership(userDetails, clientId);
        return adminManualEvaluationManager.getAttemptsFileStatus(userDetails,
                accessValidator.attemptsInInstitute(clientId, attemptIds));
    }

    @GetMapping("/get/attempt-data")
    public ResponseEntity<String> getAttemptData(@RequestAttribute("user") CustomUserDetails userDetails,
                                                 @RequestHeader(value = "clientId", required = false) String clientId,
                                                 @RequestParam("attemptId") String attemptId,
                                                 @RequestParam(value = "markEvaluating", required = false, defaultValue = "false") boolean markEvaluating) {
        accessValidator.requireStaffRole(userDetails);
        accessValidator.requireAttemptAccess(userDetails, clientId, attemptId);
        return adminManualEvaluationManager.getAttemptData(userDetails, attemptId, markEvaluating);
    }

    // --- Draft (save-for-later) endpoints: pause & resume manual evaluation ---

    @PostMapping("/save/draft")
    public ResponseEntity<String> saveEvaluationDraft(@RequestAttribute("user") CustomUserDetails userDetails,
                                                      @RequestParam("assessmentId") String assessmentId,
                                                      @RequestParam("instituteId") String instituteId,
                                                      @RequestParam("attemptId") String attemptId,
                                                      @RequestBody EvaluationDraftRequest request) {
        return adminManualEvaluationManager.saveEvaluationDraft(userDetails, assessmentId, instituteId, attemptId, request.getDraftJson());
    }

    @GetMapping("/get/draft")
    public ResponseEntity<EvaluationDraftDto> getEvaluationDraft(@RequestAttribute("user") CustomUserDetails userDetails,
                                                                 @RequestParam("attemptId") String attemptId) {
        return adminManualEvaluationManager.getEvaluationDraft(userDetails, attemptId);
    }

    @DeleteMapping("/delete/draft")
    public ResponseEntity<String> deleteEvaluationDraft(@RequestAttribute("user") CustomUserDetails userDetails,
                                                        @RequestParam("attemptId") String attemptId) {
        return adminManualEvaluationManager.deleteEvaluationDraft(userDetails, attemptId);
    }

    @PostMapping("all/attempts")
    public ResponseEntity<ManualAttemptResponse> getAttempt(@RequestAttribute("user") CustomUserDetails userDetails,
                                                            @RequestBody ManualAttemptFilter filter,
                                                            @RequestParam("assessmentId") String assessmentId,
                                                            @RequestParam("instituteId") String instituteId,
                                                            @RequestParam(value = "pageNo", defaultValue = DEFAULT_PAGE_NUMBER, required = false) int pageNo,
                                                            @RequestParam(value = "pageSize", defaultValue = DEFAULT_PAGE_SIZE, required = false) int pageSize
    ) {
        return adminManualEvaluationManager.getAssignedAttempt(userDetails, filter, assessmentId, instituteId, pageNo, pageSize);
    }
}
