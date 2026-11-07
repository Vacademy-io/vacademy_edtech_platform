package vacademy.io.assessment_service.features.assessment.controller;


import org.springframework.beans.factory.annotation.Autowired;
import vacademy.io.assessment_service.features.assessment.audit.AssessmentAuditClient;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.assessment_service.features.assessment.dto.StepResponseDto;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.service.IStep;
import vacademy.io.assessment_service.features.assessment.service.assessment_get.AssessmentService;
import vacademy.io.assessment_service.features.assessment.service.creation.AssessmentAccessDetail;
import vacademy.io.assessment_service.features.assessment.service.creation.AssessmentAddParticipantsDetail;
import vacademy.io.assessment_service.features.assessment.service.creation.AssessmentAddQuestionDetail;
import vacademy.io.assessment_service.features.assessment.service.creation.AssessmentBasicDetail;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

@RestController
@RequestMapping("/assessment-service/assessment/create/v1")
public class AssessmentStatusController {

    @Autowired
    AssessmentAccessDetail assessmentAccessDetail;

    @Autowired
    AssessmentBasicDetail assessmentBasicDetail;

    @Autowired
    AssessmentAddQuestionDetail assessmentAddQuestionDetail;

    @Autowired
    AssessmentAddParticipantsDetail assessmentAddParticipantsDetail;

    @Autowired
    AssessmentService assessmentService;

    @Autowired
    AssessmentAuditClient auditClient;


    @GetMapping("/status")
    public List<StepResponseDto> createAssessment(@RequestAttribute("user") CustomUserDetails user, @RequestParam(name = "assessmentId", required = false) String assessmentId, @RequestParam(name = "instituteId", required = false) String instituteId, @RequestParam String type) {
        List<IStep> steps = List.of(assessmentBasicDetail, assessmentAddQuestionDetail, assessmentAddParticipantsDetail, assessmentAccessDetail);
        List<StepResponseDto> stepResponses = new ArrayList<>();

        Optional<Assessment> assessment = assessmentService.getAssessmentWithActiveSections(assessmentId, instituteId);
        for (IStep step : steps) {
            step.fillStepKeysBasedOnAssessmentType(type, instituteId);
            step.checkStatusAndFetchData(assessment);
            stepResponses.add(step.toResponseDto());
        }
        return stepResponses;
    }

    @DeleteMapping("/delete")
    public ResponseEntity<String> deleteAssessment(@RequestAttribute("user") CustomUserDetails user,
                                                   @RequestParam(name = "assessmentId") String assessmentId,
                                                   @RequestParam(name = "instituteId") String instituteId) {
        String name = assessmentService.getAssessmentFromId(assessmentId).map(Assessment::getName).orElse(assessmentId);
        ResponseEntity<String> response = assessmentService.deleteAssessment(user, assessmentId, instituteId);
        auditClient.record(user, instituteId, AssessmentAuditClient.ACTION_DELETE, assessmentId,
                "deleted assessment " + name, null);
        return response;
    }
}
