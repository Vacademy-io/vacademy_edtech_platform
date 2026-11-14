package vacademy.io.assessment_service.features.assessment.controller.assessment_steps;


import org.springframework.beans.factory.annotation.Autowired;
import vacademy.io.assessment_service.features.assessment.audit.AssessmentAuditClient;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.assessment_service.features.assessment.dto.AssessmentSaveResponseDto;
import vacademy.io.assessment_service.features.assessment.dto.create_assessment.BasicAssessmentDetailsDTO;
import vacademy.io.assessment_service.features.assessment.manager.AssessmentBasicDetailsManager;
import vacademy.io.common.auth.model.CustomUserDetails;

@RestController
@RequestMapping("/assessment-service/assessment/basic/create/v1")
public class AssessmentBasicDetailsController {

    @Autowired
    AssessmentBasicDetailsManager assessmentBasicDetailsManager;

    @Autowired
    AssessmentAuditClient auditClient;

    @PostMapping("/submit")
    public ResponseEntity<AssessmentSaveResponseDto> saveBasicAssessmentDetails(@RequestAttribute("user") CustomUserDetails user,
                                                                                @RequestBody BasicAssessmentDetailsDTO basicAssessmentDetailsDTO,
                                                                                @RequestParam(name = "assessmentId", required = false) String assessmentId,
                                                                                @RequestParam(name = "instituteId", required = false) String instituteId,
                                                                                @RequestParam String type) {
        // Whether this is a first save or an edit is decided here, not by the
        // manager: an id the client did not have before the call means CREATE.
        boolean isNew = assessmentId == null || assessmentId.isBlank() || "defaultId".equals(assessmentId);
        ResponseEntity<AssessmentSaveResponseDto> response = assessmentBasicDetailsManager.saveBasicAssessmentDetails(user, basicAssessmentDetailsDTO, assessmentId, instituteId, type);
        String savedId = response.getBody() != null ? response.getBody().getAssessmentId() : assessmentId;
        String name = basicAssessmentDetailsDTO.getTestCreation() != null ? basicAssessmentDetailsDTO.getTestCreation().getAssessmentName() : null;
        auditClient.record(user, instituteId,
                isNew ? AssessmentAuditClient.ACTION_CREATE : AssessmentAuditClient.ACTION_UPDATE,
                savedId,
                (isNew ? "created assessment " : "updated basic details of assessment ") + (name != null ? name : savedId),
                basicAssessmentDetailsDTO);
        return response;
    }


}
