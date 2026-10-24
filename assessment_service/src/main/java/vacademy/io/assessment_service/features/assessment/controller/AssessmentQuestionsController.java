package vacademy.io.assessment_service.features.assessment.controller;


import org.springframework.beans.factory.annotation.Autowired;
import vacademy.io.assessment_service.features.assessment.service.assessment_get.AssessmentService;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.audit.AssessmentAuditClient;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.assessment_service.features.assessment.dto.AssessmentQuestionPreviewDto;
import vacademy.io.assessment_service.features.assessment.dto.AssessmentSaveResponseDto;
import vacademy.io.assessment_service.features.assessment.dto.create_assessment.AddQuestionsAssessmentDetailsDTO;
import vacademy.io.assessment_service.features.assessment.manager.AssessmentLinkQuestionsManager;
import vacademy.io.assessment_service.features.question_core.dto.QuestionDTO;
import vacademy.io.assessment_service.features.question_bank.dto.EditQuestionPaperDTO;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/assessment-service/assessment/add-questions/create/v1")
public class AssessmentQuestionsController {

    @Autowired
    AssessmentLinkQuestionsManager assessmentLinkQuestionsManager;

    @Autowired
    AssessmentAuditClient auditClient;

    @Autowired
    AssessmentService assessmentService;

    @PostMapping("/submit")
    public ResponseEntity<AssessmentSaveResponseDto> saveQuestionsToAssessment(@RequestAttribute("user") CustomUserDetails user,
                                                                               @RequestBody AddQuestionsAssessmentDetailsDTO basicAssessmentDetailsDTO,
                                                                               @RequestParam(name = "assessmentId", required = false) String assessmentId,
                                                                               @RequestParam(name = "instituteId", required = false) String instituteId,
                                                                               @RequestParam String type) {
        ResponseEntity<AssessmentSaveResponseDto> response = assessmentLinkQuestionsManager.saveQuestionsToAssessment(user, basicAssessmentDetailsDTO, assessmentId, instituteId, type);
        auditClient.record(user, instituteId, AssessmentAuditClient.ACTION_UPDATE, assessmentId,
                "updated sections and questions of assessment " + assessmentNameOr(assessmentId), basicAssessmentDetailsDTO);
        return response;
    }

    @GetMapping("/questions-of-sections/full")
    public Map<String, List<QuestionDTO>> getFullQuestionsOfSection(@RequestAttribute("user") CustomUserDetails user,
                                                                      @RequestParam(name = "assessmentId", required = false) String assessmentId,
                                                                      @RequestParam(name = "sectionIds", required = false) String sectionIds) {
        return assessmentLinkQuestionsManager.getFullQuestionsOfSection(user, assessmentId, sectionIds);
    }

    @PatchMapping("/edit-questions")
    public ResponseEntity<Boolean> editQuestions(@RequestAttribute("user") CustomUserDetails user,
                                                 @RequestBody EditQuestionPaperDTO body,
                                                 @RequestParam(name = "assessmentId") String assessmentId,
                                                 @RequestParam(name = "instituteId") String instituteId) {
        Boolean edited = assessmentLinkQuestionsManager.editQuestionsOfAssessment(user, assessmentId, instituteId, body.getUpdatedQuestions());
        if (Boolean.TRUE.equals(edited)) {
            int count = body.getUpdatedQuestions() == null ? 0 : body.getUpdatedQuestions().size();
            auditClient.record(user, instituteId, AssessmentAuditClient.ACTION_EDIT_QUESTION, assessmentId,
                    "edited " + count + (count == 1 ? " question" : " questions") + " of assessment " + assessmentNameOr(assessmentId),
                    body);
        }
        return ResponseEntity.ok(edited);
    }

    private String assessmentNameOr(String assessmentId) {
        try {
            return assessmentService.getAssessmentFromId(assessmentId).map(Assessment::getName).orElse(assessmentId);
        } catch (Exception e) {
            return assessmentId;
        }
    }

    @GetMapping("/questions-of-sections")
    public Map<String, List<AssessmentQuestionPreviewDto>> getQuestionsOfSection(@RequestAttribute("user") CustomUserDetails user,
                                                                                 @RequestParam(name = "assessmentId", required = false) String assessmentId,
                                                                                 @RequestParam(name = "sectionIds", required = false) String sectionIds) {
        return assessmentLinkQuestionsManager.getQuestionsOfSection(user, assessmentId, sectionIds);
    }


}
