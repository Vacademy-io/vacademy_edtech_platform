package vacademy.io.assessment_service.features.assessment.controller;


import org.springframework.beans.factory.annotation.Autowired;
import vacademy.io.assessment_service.features.assessment.audit.AssessmentAuditClient;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.assessment_service.features.assessment.dto.AssessmentSaveResponseDto;
import vacademy.io.assessment_service.features.assessment.manager.AssessmentBasicDetailsManager;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.Map;

@RestController
@RequestMapping("/assessment-service/assessment/publish/v1")
public class AssessmentPublishController {


    @Autowired
    AssessmentBasicDetailsManager assessmentBasicDetailsManager;

    @Autowired
    AssessmentAuditClient auditClient;


    @PostMapping("/")
    public ResponseEntity<AssessmentSaveResponseDto> publishAssessment(@RequestAttribute("user") CustomUserDetails user,
                                                                       @RequestBody Map<String, String> data,
                                                                       @RequestParam(name = "assessmentId", required = false) String assessmentId,
                                                                       @RequestParam(name = "instituteId", required = false) String instituteId,
                                                                       @RequestParam String type) {
        ResponseEntity<AssessmentSaveResponseDto> response = assessmentBasicDetailsManager.publishAssessment(user, data, assessmentId, instituteId, type);
        auditClient.record(user, instituteId, AssessmentAuditClient.ACTION_PUBLISH, assessmentId,
                "published assessment " + assessmentId, data);
        return response;
    }
}
