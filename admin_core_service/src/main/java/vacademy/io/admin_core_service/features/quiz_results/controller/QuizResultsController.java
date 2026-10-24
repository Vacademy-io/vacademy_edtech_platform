package vacademy.io.admin_core_service.features.quiz_results.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.quiz_results.dto.LearnerQuizAnswersResponse;
import vacademy.io.admin_core_service.features.quiz_results.dto.LearnerQuizDetailResponse;
import vacademy.io.admin_core_service.features.quiz_results.dto.LearnerQuizOverviewResponse;
import vacademy.io.admin_core_service.features.quiz_results.dto.QuizLearnerResultsResponse;
import vacademy.io.admin_core_service.features.quiz_results.dto.QuizOverviewResponse;
import vacademy.io.admin_core_service.features.quiz_results.dto.QuizQuestionAnalysisResponse;
import vacademy.io.admin_core_service.features.quiz_results.service.QuizResultsService;
import vacademy.io.common.auth.model.CustomUserDetails;

/**
 * Quiz Results - the teacher/admin view of how a batch performed on the quiz slides in a
 * course. Read-only; three endpoints matching the three screens of the tab:
 * the quiz list, one quiz's learner roster, and one quiz's question breakdown.
 *
 * <p>Every endpoint is scoped to a batch (package_session). Quiz slides are shared across
 * batches, so a slide id on its own would mix other classes into the numbers.
 */
@RestController
@RequestMapping("/admin-core-service/quiz-results")
@RequiredArgsConstructor
public class QuizResultsController {

    private final QuizResultsService quizResultsService;

    /** Every quiz in the batch, with participation and score aggregates. */
    @GetMapping("/overview")
    public ResponseEntity<QuizOverviewResponse> getOverview(
            @RequestParam("batchId") String batchId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(quizResultsService.getOverview(batchId, user));
    }

    /** One quiz: a row per enrolled learner, including those who never attempted it. */
    @GetMapping("/quiz")
    public ResponseEntity<QuizLearnerResultsResponse> getQuizResults(
            @RequestParam("batchId") String batchId,
            @RequestParam("slideId") String slideId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(quizResultsService.getQuizResults(batchId, slideId, user));
    }

    /** One quiz: per-question accuracy and the option-by-option answer distribution. */
    @GetMapping("/questions")
    public ResponseEntity<QuizQuestionAnalysisResponse> getQuestionAnalysis(
            @RequestParam("batchId") String batchId,
            @RequestParam("slideId") String slideId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(quizResultsService.getQuestionAnalysis(batchId, slideId, user));
    }

    /** Learner-wise list: a row per enrolled learner, totalled across every quiz. */
    @GetMapping("/learners")
    public ResponseEntity<LearnerQuizOverviewResponse> getLearnerOverview(
            @RequestParam("batchId") String batchId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(quizResultsService.getLearnerOverview(batchId, user));
    }

    /** One learner: every quiz in the course with their standing on it, attempted or not. */
    @GetMapping("/learner")
    public ResponseEntity<LearnerQuizDetailResponse> getLearnerDetail(
            @RequestParam("batchId") String batchId,
            @RequestParam("userId") String userId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(quizResultsService.getLearnerDetail(batchId, userId, user));
    }

    /** One learner, one quiz: what they answered on each attempt, with marks per question. */
    @GetMapping("/learner/answers")
    public ResponseEntity<LearnerQuizAnswersResponse> getLearnerAnswers(
            @RequestParam("batchId") String batchId,
            @RequestParam("slideId") String slideId,
            @RequestParam("userId") String userId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(quizResultsService.getLearnerAnswers(batchId, slideId, userId, user));
    }
}
