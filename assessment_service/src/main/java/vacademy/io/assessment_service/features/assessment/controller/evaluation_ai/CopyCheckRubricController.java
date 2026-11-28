package vacademy.io.assessment_service.features.assessment.controller.evaluation_ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.assessment_service.features.assessment.entity.CopyCheckLayout;
import vacademy.io.assessment_service.features.assessment.repository.CopyCheckLayoutRepository;
import vacademy.io.assessment_service.features.assessment.client.AiServiceCopyCheckClient;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.CopyCheckCriteriaService;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.EvaluationAccessValidator;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.Map;

/**
 * FE-facing rubric CRUD + layout fetch. The rubric mutations proxy to
 * ai_service which owns the persistence; the layout endpoint serves the
 * cached LayoutMap blob for the FE annotation overlay to read once and
 * render boxes against pdf.js dimensions.
 *
 * <p>Rubrics hold model answers and layouts hold transcribed handwriting, so
 * every call is bound to the caller's institute ({@code clientId}, the scope of
 * the JWT authorities) and limited to staff (see {@link EvaluationAccessValidator}).
 * The verified institute is also forwarded to ai_service (body {@code institute_id}
 * on upsert, {@code ?institute_id=} elsewhere) so its rubric-row tenant check
 * refuses a row that belongs to another institute.
 */
@RestController
@RequestMapping("/assessment-service/copy-check")
@RequiredArgsConstructor
public class CopyCheckRubricController {

    private final AiServiceCopyCheckClient aiServiceClient;
    private final CopyCheckLayoutRepository layoutRepository;
    private final EvaluationAccessValidator accessValidator;
    private final CopyCheckCriteriaService criteriaService;

    @GetMapping("/rubric/{assessmentId}")
    public ResponseEntity<JsonNode> getRubric(@RequestAttribute("user") CustomUserDetails user,
                                              @RequestHeader(value = "clientId", required = false) String instituteId,
                                              @PathVariable String assessmentId) {
        requireStaffOnAssessment(user, instituteId, assessmentId);
        JsonNode rubric = aiServiceClient.getRubric(assessmentId, instituteId);
        if (rubric == null) return ResponseEntity.notFound().build();
        return ResponseEntity.ok(rubric);
    }

    @PostMapping("/rubric")
    public ResponseEntity<JsonNode> upsertRubric(@RequestAttribute("user") CustomUserDetails user,
                                                 @RequestHeader(value = "clientId", required = false) String instituteId,
                                                 @RequestBody JsonNode body) {
        String assessmentId = body != null && body.hasNonNull("assessment_id") ? body.get("assessment_id").asText() : null;
        requireStaffOnAssessment(user, instituteId, assessmentId);
        // The rubric is stored under the institute named in the body; pin it to the verified one.
        if (body instanceof ObjectNode objectBody) {
            objectBody.put("institute_id", instituteId);
        }
        return ResponseEntity.ok(aiServiceClient.upsertRubric(body));
    }

    @DeleteMapping("/rubric/{assessmentId}")
    public ResponseEntity<Void> deleteRubric(@RequestAttribute("user") CustomUserDetails user,
                                             @RequestHeader(value = "clientId", required = false) String instituteId,
                                             @PathVariable String assessmentId) {
        requireStaffOnAssessment(user, instituteId, assessmentId);
        aiServiceClient.deleteRubric(assessmentId, instituteId);
        return ResponseEntity.noContent().build();
    }

    @PutMapping("/rubric/{assessmentId}/question/{questionId}")
    public ResponseEntity<JsonNode> upsertQuestionAnswer(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String instituteId,
            @PathVariable String assessmentId,
            @PathVariable String questionId,
            @RequestBody JsonNode body) {
        requireStaffOnAssessment(user, instituteId, assessmentId);
        return ResponseEntity.ok(aiServiceClient.upsertQuestionAnswer(assessmentId, questionId, instituteId, body));
    }

    @DeleteMapping("/rubric/{assessmentId}/question/{questionId}")
    public ResponseEntity<Void> deleteQuestionAnswer(
            @RequestAttribute("user") CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String instituteId,
            @PathVariable String assessmentId,
            @PathVariable String questionId) {
        requireStaffOnAssessment(user, instituteId, assessmentId);
        aiServiceClient.deleteQuestionAnswer(assessmentId, questionId, instituteId);
        return ResponseEntity.noContent().build();
    }

    /**
     * Every question of the paper with the criteria the AI copy check marks it by
     * ({@code rubric}, null = generated on its first check) and the question's own
     * criteria as a starting point.
     */
    @GetMapping("/criteria/{assessmentId}")
    public ResponseEntity<Map<String, Object>> getCriteria(@RequestAttribute("user") CustomUserDetails user,
                                                           @RequestHeader(value = "clientId", required = false) String instituteId,
                                                           @PathVariable String assessmentId) {
        requireStaffOnAssessment(user, instituteId, assessmentId);
        return ResponseEntity.ok(criteriaService.view(instituteId, assessmentId));
    }

    /**
     * Save the criteria for some questions of the paper:
     * {@code {"rubrics": {question_id: rubric}, "if_match": rubric_version}}. The rest are
     * left as they are. Used for every copy checked from now on.
     */
    @PatchMapping("/criteria/{assessmentId}")
    public ResponseEntity<Map<String, Object>> saveCriteria(@RequestAttribute("user") CustomUserDetails user,
                                                            @RequestHeader(value = "clientId", required = false) String instituteId,
                                                            @PathVariable String assessmentId,
                                                            @RequestBody JsonNode body) {
        requireStaffOnAssessment(user, instituteId, assessmentId);
        Integer ifMatch = body != null && body.hasNonNull("if_match") ? body.get("if_match").asInt() : null;
        int version = criteriaService.save(instituteId, assessmentId, body == null ? null : body.get("rubrics"), ifMatch);
        return ResponseEntity.ok(Map.of("rubric_version", version));
    }

    @GetMapping("/layout/{layoutId}")
    public ResponseEntity<String> getLayout(@RequestAttribute("user") CustomUserDetails user,
                                            @RequestHeader(value = "clientId", required = false) String instituteId,
                                            @PathVariable String layoutId) {
        CopyCheckLayout row = layoutRepository.findById(layoutId).orElse(null);
        if (row == null) return ResponseEntity.notFound().build();
        accessValidator.requireAttemptAccess(user, instituteId, row.getAttemptId());
        accessValidator.requireStaffRole(user);
        return ResponseEntity.ok(row.getLayoutJson());
    }

    private void requireStaffOnAssessment(CustomUserDetails user, String instituteId, String assessmentId) {
        accessValidator.requireAssessmentInInstitute(user, instituteId, assessmentId);
        accessValidator.requireStaffRole(user);
    }
}
