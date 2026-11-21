package vacademy.io.admin_core_service.features.learner_tracking.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.learner_tracking.cbe.QuizCbeGradingService;
import vacademy.io.admin_core_service.features.learner_tracking.cbe.dto.QuizCbeGradeRequest;
import vacademy.io.admin_core_service.features.learner_tracking.cbe.dto.QuizCbeGradeResponse;
import vacademy.io.common.auth.model.CustomUserDetails;

/**
 * Spreadsheet &amp; Written Response questions inside quiz slides: the AI check of a submitted
 * attempt's answers. The learner is always the token holder.
 */
@RestController
@RequestMapping("/admin-core-service/learner-tracking/activity-log/quiz-slide/cbe")
@RequiredArgsConstructor
public class QuizCbeGradingController {

    private final QuizCbeGradingService service;

    /** Grades the attempt's CBE answers that are not graded yet; returns where each stands. */
    @PostMapping("/grade")
    public ResponseEntity<QuizCbeGradeResponse> grade(@RequestBody QuizCbeGradeRequest request,
            @RequestAttribute("user") CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId) {
        return ResponseEntity.ok(service.grade(request, user, clientId));
    }

    /** Where each CBE answer of the attempt stands, with the learner's own answer; grades nothing. */
    @GetMapping("/results")
    public ResponseEntity<QuizCbeGradeResponse> results(@RequestParam("slide_id") String slideId,
            @RequestParam("attempt_id") String attemptId,
            @RequestAttribute("user") CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId) {
        return ResponseEntity.ok(service.results(slideId, attemptId, user, clientId));
    }
}
