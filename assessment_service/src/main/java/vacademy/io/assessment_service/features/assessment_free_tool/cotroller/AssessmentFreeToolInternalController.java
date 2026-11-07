package vacademy.io.assessment_service.features.assessment_free_tool.cotroller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.assessment_service.features.assessment_free_tool.dto.AiPublishAssessmentRequest;
import vacademy.io.assessment_service.features.assessment_free_tool.service.AiPublishAssessmentService;
import vacademy.io.assessment_service.features.assessment_free_tool.service.AssessmentFreeToolGetService;
import vacademy.io.common.ai.dto.AiEvaluationMetadata;

import java.util.Map;

@RestController
@RequestMapping("/assessment-service/internal/evaluation-tool")
@RequiredArgsConstructor
public class AssessmentFreeToolInternalController {

    private final AssessmentFreeToolGetService evaluationMetadataService;
    private final AiPublishAssessmentService aiPublishService;

    @GetMapping("/metadata/{assessmentId}")
    public ResponseEntity<AiEvaluationMetadata> getEvaluationMetadata(@PathVariable String assessmentId) {
        AiEvaluationMetadata metadata = evaluationMetadataService.getEvaluationMetadata(assessmentId);
        return ResponseEntity.ok(metadata);
    }

    /**
     * Publishes an AI-generated MCQ assessment in one shot:
     * creates Assessment + Section + Questions + Options + correct-answer JSON
     * + section mappings. Used by admin-core when a teacher clicks Publish
     * on the Create-Assessment-from-Recording modal.
     *
     * Returns the new assessment id so admin-core can store it on the
     * ai_generated_artifact row. Lives under /internal/ (InternalAuthFilter)
     * because the request names the institute to publish into.
     */
    @PostMapping("/assessment/ai-publish")
    public ResponseEntity<Map<String, String>> aiPublishAssessment(
            @RequestBody AiPublishAssessmentRequest request) {
        String assessmentId = aiPublishService.publish(request);
        return ResponseEntity.ok(Map.of("assessmentId", assessmentId));
    }

}
