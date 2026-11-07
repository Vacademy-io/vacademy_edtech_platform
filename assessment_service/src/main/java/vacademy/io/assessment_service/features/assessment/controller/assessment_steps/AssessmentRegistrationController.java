package vacademy.io.assessment_service.features.assessment.controller.assessment_steps;


import org.springframework.beans.factory.annotation.Autowired;
import vacademy.io.assessment_service.features.assessment.audit.AssessmentAuditClient;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.assessment_service.features.assessment.dto.AssessmentSaveResponseDto;
import vacademy.io.assessment_service.features.assessment.dto.create_assessment.AssessmentRegistrationsDto;
import vacademy.io.assessment_service.features.assessment.manager.AssessmentParticipantsManager;
import vacademy.io.common.auth.model.CustomUserDetails;

@RestController
@RequestMapping("/assessment-service/assessment/add-participants/create/v1")
public class AssessmentRegistrationController {

    @Autowired
    AssessmentParticipantsManager assessmentParticipantsManager;

    @Autowired
    AssessmentAuditClient auditClient;

    @PostMapping("/submit")
    public ResponseEntity<AssessmentSaveResponseDto> saveParticipantsToAssessment(@RequestAttribute("user") CustomUserDetails user,
                                                                                  @RequestBody AssessmentRegistrationsDto basicAssessmentDetailsDTO,
                                                                                  @RequestParam(name = "assessmentId", required = false) String assessmentId,
                                                                                  @RequestParam(name = "instituteId", required = false) String instituteId,
                                                                                  @RequestParam String type) {
        ResponseEntity<AssessmentSaveResponseDto> response = assessmentParticipantsManager.saveParticipantsToAssessment(user, basicAssessmentDetailsDTO, assessmentId, instituteId, type);
        auditClient.record(user, instituteId, AssessmentAuditClient.ACTION_UPDATE, assessmentId,
                "updated participants of assessment " + assessmentId, basicAssessmentDetailsDTO);
        return response;
    }


}
