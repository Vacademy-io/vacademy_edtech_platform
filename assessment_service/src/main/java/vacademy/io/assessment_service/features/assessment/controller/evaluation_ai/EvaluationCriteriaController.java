package vacademy.io.assessment_service.features.assessment.controller.evaluation_ai;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.CreateCriteriaTemplateRequest;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.EvaluationCriteriaTemplateDto;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.GenerateCriteriaRequest;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.EvaluationCriteriaService;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.AiCriteriaGenerationService;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.EvaluationAccessValidator;
import vacademy.io.common.auth.model.CustomUserDetails;
import org.springframework.security.core.annotation.AuthenticationPrincipal;

import java.util.List;

@RestController
@RequestMapping("/assessment-service/assessment/evaluation-criteria")
@RequiredArgsConstructor
public class EvaluationCriteriaController {

        private final EvaluationCriteriaService evaluationCriteriaService;
        private final AiCriteriaGenerationService aiCriteriaGenerationService;
        private final EvaluationAccessValidator accessValidator;

        @PostMapping("/template")
        public ResponseEntity<EvaluationCriteriaTemplateDto> createTemplate(
                        @RequestBody CreateCriteriaTemplateRequest request,
                        @AuthenticationPrincipal CustomUserDetails userDetails) {
                accessValidator.requireStaffRole(userDetails);
                String createdBy = userDetails != null ? userDetails.getUserId() : "system"; // Fallback for dev/test
                return ResponseEntity.ok(evaluationCriteriaService.createTemplate(request, createdBy));
        }

        @GetMapping("/templates")
        public ResponseEntity<List<EvaluationCriteriaTemplateDto>> getTemplates(
                        @RequestParam(required = false) String subject,
                        @RequestParam(required = false) String questionType) {
                return ResponseEntity.ok(evaluationCriteriaService.getTemplatesBySubjectAndType(subject, questionType));
        }

        @GetMapping("/template/{id}")
        public ResponseEntity<EvaluationCriteriaTemplateDto> getTemplateById(@PathVariable String id) {
                return evaluationCriteriaService.getTemplateById(id)
                                .map(ResponseEntity::ok)
                                .orElse(ResponseEntity.notFound().build());
        }

        @PutMapping("/template/{id}")
        public ResponseEntity<EvaluationCriteriaTemplateDto> updateTemplate(
                        @PathVariable String id,
                        @RequestBody CreateCriteriaTemplateRequest request,
                        @AuthenticationPrincipal CustomUserDetails userDetails) {
                accessValidator.requireStaffRole(userDetails);
                return ResponseEntity.ok(evaluationCriteriaService.updateTemplate(id, request));
        }

        @DeleteMapping("/template/{id}")
        public ResponseEntity<Void> deleteTemplate(@PathVariable String id,
                        @AuthenticationPrincipal CustomUserDetails userDetails) {
                accessValidator.requireStaffRole(userDetails);
                evaluationCriteriaService.deleteTemplate(id);
                return ResponseEntity.ok().build();
        }

        @PostMapping("/generate-ai")
        public ResponseEntity<CreateCriteriaTemplateRequest> generateCriteriaWithAi(
                        @RequestBody GenerateCriteriaRequest request,
                        @RequestParam(defaultValue = "false") boolean save,
                        @AuthenticationPrincipal CustomUserDetails userDetails) {
                accessValidator.requireStaffRole(userDetails);
                String createdBy = userDetails != null ? userDetails.getUserId() : "system";
                return ResponseEntity.ok(aiCriteriaGenerationService.generateCriteria(request, save, createdBy));
        }
}
