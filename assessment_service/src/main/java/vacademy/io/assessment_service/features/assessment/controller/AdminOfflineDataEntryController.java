package vacademy.io.assessment_service.features.assessment.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.assessment_service.features.assessment.dto.offline_entry.OfflineAttachmentsRequest;
import vacademy.io.assessment_service.features.assessment.dto.offline_entry.OfflineAttemptCreateRequest;
import vacademy.io.assessment_service.features.assessment.dto.offline_entry.OfflineBulkImportRequest;
import vacademy.io.assessment_service.features.assessment.dto.offline_entry.OfflineBulkImportResponse;
import vacademy.io.assessment_service.features.assessment.dto.offline_entry.OfflineAttemptCreateResponse;
import vacademy.io.assessment_service.features.assessment.dto.offline_entry.OfflineResponseSubmitRequest;
import vacademy.io.assessment_service.features.assessment.manager.AdminOfflineDataEntryManager;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.EvaluationAccessValidator;
import vacademy.io.common.auth.model.CustomUserDetails;

@RestController
@RequestMapping("/assessment-service/assessment/offline-entry")
public class AdminOfflineDataEntryController {

    @Autowired
    private AdminOfflineDataEntryManager adminOfflineDataEntryManager;

    @Autowired
    private EvaluationAccessValidator accessValidator;

    /**
     * Offline entry writes attempts and registrations in an institute: staff of
     * the institute that owns the assessment only, and instituteId must be the
     * clientId the caller's roles were loaded for. The manager then ties every
     * registration/attempt id to assessmentId.
     */
    private void requireStaffOfAssessmentInstitute(CustomUserDetails user, String clientId, String instituteId,
                                                   String assessmentId) {
        accessValidator.requireActiveInstitute(clientId, instituteId);
        accessValidator.requireAssessmentInInstitute(user, instituteId, assessmentId);
        accessValidator.requireStaffRole(user);
    }

    @PostMapping("/create-attempt")
    public ResponseEntity<OfflineAttemptCreateResponse> createOfflineAttempt(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @RequestHeader(value = "clientId", required = false) String clientId,
            @RequestParam("assessmentId") String assessmentId,
            @RequestParam(value = "registrationId", required = false) String registrationId,
            @RequestParam("instituteId") String instituteId,
            @RequestBody(required = false) OfflineAttemptCreateRequest request) {
        requireStaffOfAssessmentInstitute(userDetails, clientId, instituteId, assessmentId);
        return adminOfflineDataEntryManager.createOfflineAttempt(userDetails, assessmentId, registrationId, instituteId, request);
    }

    @PostMapping("/submit-responses")
    public ResponseEntity<String> submitOfflineResponses(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @RequestHeader(value = "clientId", required = false) String clientId,
            @RequestParam("assessmentId") String assessmentId,
            @RequestParam("attemptId") String attemptId,
            @RequestParam("instituteId") String instituteId,
            @RequestBody OfflineResponseSubmitRequest request) {
        requireStaffOfAssessmentInstitute(userDetails, clientId, instituteId, assessmentId);
        return adminOfflineDataEntryManager.submitOfflineResponses(userDetails, assessmentId, attemptId, instituteId, request);
    }

    @PostMapping("/create-and-submit")
    public ResponseEntity<OfflineAttemptCreateResponse> createAndSubmit(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @RequestHeader(value = "clientId", required = false) String clientId,
            @RequestParam("assessmentId") String assessmentId,
            @RequestParam(value = "registrationId", required = false) String registrationId,
            @RequestParam("instituteId") String instituteId,
            @RequestBody OfflineResponseSubmitRequest request) {
        requireStaffOfAssessmentInstitute(userDetails, clientId, instituteId, assessmentId);
        return adminOfflineDataEntryManager.createAttemptAndSubmitResponses(userDetails, assessmentId, registrationId, instituteId, request);
    }

    @PostMapping("/attach-files")
    public ResponseEntity<String> attachOfflineFiles(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @RequestHeader(value = "clientId", required = false) String clientId,
            @RequestParam("assessmentId") String assessmentId,
            @RequestParam("attemptId") String attemptId,
            @RequestParam("instituteId") String instituteId,
            @RequestBody OfflineAttachmentsRequest request) {
        requireStaffOfAssessmentInstitute(userDetails, clientId, instituteId, assessmentId);
        return adminOfflineDataEntryManager.attachOfflineFiles(userDetails, assessmentId, attemptId, instituteId, request);
    }

    @PostMapping("/bulk-import")
    public ResponseEntity<OfflineBulkImportResponse> bulkImportOfflineEntries(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @RequestHeader(value = "clientId", required = false) String clientId,
            @RequestParam("assessmentId") String assessmentId,
            @RequestParam("instituteId") String instituteId,
            @RequestBody OfflineBulkImportRequest request) {
        requireStaffOfAssessmentInstitute(userDetails, clientId, instituteId, assessmentId);
        return adminOfflineDataEntryManager.bulkImportOfflineEntries(userDetails, assessmentId, instituteId, request);
    }
}
