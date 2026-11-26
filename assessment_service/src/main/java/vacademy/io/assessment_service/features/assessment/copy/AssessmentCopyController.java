package vacademy.io.assessment_service.features.assessment.copy;

import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.assessment_service.features.assessment.audit.AssessmentAuditClient;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentRepository;
import vacademy.io.assessment_service.features.assessment.service.AssessmentWorkflowEventPublisher;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

/** "Duplicate Assessment" in the admin's assessment list. */
@Slf4j
@RestController
@RequestMapping("/assessment-service/assessment/create/v1")
public class AssessmentCopyController {

    private final AssessmentCopyService copyService;
    private final AssessmentRepository assessmentRepository;
    private final AssessmentWorkflowEventPublisher workflowEventPublisher;
    private final AssessmentAuditClient auditClient;

    public AssessmentCopyController(AssessmentCopyService copyService, AssessmentRepository assessmentRepository,
                                    AssessmentWorkflowEventPublisher workflowEventPublisher,
                                    AssessmentAuditClient auditClient) {
        this.copyService = copyService;
        this.assessmentRepository = assessmentRepository;
        this.workflowEventPublisher = workflowEventPublisher;
        this.auditClient = auditClient;
    }

    /** Copies the assessment as a new DRAFT; the original is not changed. */
    @PostMapping("/copy")
    public ResponseEntity<AssessmentCopyResponse> copyAssessment(@RequestAttribute("user") CustomUserDetails user,
                                                                 @RequestParam("assessmentId") String assessmentId,
                                                                 @RequestParam("instituteId") String instituteId,
                                                                 @RequestBody(required = false) AssessmentCopyRequest request) {
        AssessmentCopyResponse copy;
        try {
            copy = copyService.copy(assessmentId, instituteId, request);
        } catch (DataAccessException e) {
            // The copy runs in one transaction, so it is already rolled back; the admin gets a
            // plain message instead of the SQL, which the dialog would show as the toast.
            log.error("[assessment-copy] copy of {} (institute {}) failed and was rolled back", assessmentId, instituteId, e);
            throw new VacademyException(HttpStatus.INTERNAL_SERVER_ERROR,
                    "Could not duplicate the assessment. Nothing was saved, please try again.");
        }
        // After the copy committed, like any new draft: ASSESSMENT_CREATE, then the audit row.
        try {
            assessmentRepository.findById(copy.assessmentId()).ifPresent(assessment ->
                    workflowEventPublisher.publishAssessmentCreated(assessment, instituteId,
                            user != null ? user.getUserId() : null));
        } catch (Exception e) {
            log.warn("[assessment-copy] ASSESSMENT_CREATE not sent for {}: {}", copy.assessmentId(), e.getMessage());
        }
        auditClient.record(user, instituteId, AssessmentAuditClient.ACTION_CREATE, copy.assessmentId(),
                "duplicated assessment " + assessmentId + " as " + copy.name(), request);
        return ResponseEntity.ok(copy);
    }
}
