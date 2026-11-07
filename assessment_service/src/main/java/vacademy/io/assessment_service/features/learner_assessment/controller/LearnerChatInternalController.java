package vacademy.io.assessment_service.features.learner_assessment.controller;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.assessment_service.features.learner_assessment.dto.internal.LearnerChatAssessmentsResponse;
import vacademy.io.assessment_service.features.learner_assessment.dto.internal.LearnerChatResultsResponse;
import vacademy.io.assessment_service.features.learner_assessment.service.LearnerChatInternalService;

import java.util.List;

/**
 * Internal (service-to-service) reads for the learner AI chatbot in ai_service.
 *
 * <p><b>Security:</b> under {@code /assessment-service/internal/**}, guarded by
 * {@code InternalAuthFilter} (HMAC {@code clientName} + {@code Signature}). The caller passes the
 * learner identity from its own authenticated chat session. Read-only.
 *
 * <p>Shows the learner exactly what the learner app shows: unreleased results never carry marks.
 */
@Slf4j
@RestController
@RequestMapping("/assessment-service/internal/learner-chat/v1")
public class LearnerChatInternalController {

    @Autowired
    private LearnerChatInternalService learnerChatInternalService;

    /** Open and upcoming tests for the learner (the examination page's Live and Upcoming tabs). */
    @GetMapping("/assessments")
    public ResponseEntity<LearnerChatAssessmentsResponse> assessments(
            @RequestParam(name = "userId") String userId,
            @RequestParam(name = "instituteId") String instituteId,
            @RequestParam(name = "batchIds", required = false) List<String> batchIds) {
        return ResponseEntity.ok(learnerChatInternalService.listAssessments(userId, instituteId, batchIds));
    }

    /** Latest released results (max 5, enriched) plus tests awaiting release (names only). */
    @GetMapping("/results")
    public ResponseEntity<LearnerChatResultsResponse> results(
            @RequestParam(name = "userId") String userId,
            @RequestParam(name = "instituteId") String instituteId,
            @RequestParam(name = "limit", required = false) Integer limit) {
        return ResponseEntity.ok(learnerChatInternalService.listResults(userId, instituteId, limit));
    }
}
