package vacademy.io.admin_core_service.features.learner_quiz.controller;

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
import vacademy.io.admin_core_service.features.learner_quiz.dto.QuizAnswerCheckRequest;
import vacademy.io.admin_core_service.features.learner_quiz.dto.QuizAnswerCheckResponse;
import vacademy.io.admin_core_service.features.learner_quiz.dto.QuizAttemptResultResponse;
import vacademy.io.admin_core_service.features.learner_quiz.dto.QuizAttemptSubmitRequest;
import vacademy.io.admin_core_service.features.learner_quiz.service.LearnerQuizAttemptService;
import vacademy.io.common.auth.model.CustomUserDetails;

/** Quiz grading for the signed-in learner. The learner is always the token holder. */
@RestController
@RequestMapping("/admin-core-service/learner-tracking/quiz-attempt/v1")
@RequiredArgsConstructor
public class LearnerQuizAttemptController {

    private final LearnerQuizAttemptService service;

    @PostMapping("/submit")
    public ResponseEntity<QuizAttemptResultResponse> submit(@RequestBody QuizAttemptSubmitRequest request,
            @RequestAttribute("user") CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId) {
        return ResponseEntity.ok(service.submit(request, user, clientId));
    }

    @GetMapping("/result")
    public ResponseEntity<QuizAttemptResultResponse> result(@RequestParam("slideId") String slideId,
            @RequestAttribute("user") CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId) {
        return ResponseEntity.ok(service.getResult(slideId, user, clientId));
    }

    @PostMapping("/check-answer")
    public ResponseEntity<QuizAnswerCheckResponse> checkAnswer(@RequestBody QuizAnswerCheckRequest request,
            @RequestAttribute("user") CustomUserDetails user,
            @RequestHeader(value = "clientId", required = false) String clientId) {
        return ResponseEntity.ok(service.checkAnswer(request, user, clientId));
    }
}
