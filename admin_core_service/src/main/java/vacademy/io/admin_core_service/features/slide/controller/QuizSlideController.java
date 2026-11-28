package vacademy.io.admin_core_service.features.slide.controller;

import lombok.AllArgsConstructor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.slide.cbe.QuizCbeSecretService;
import vacademy.io.admin_core_service.features.slide.dto.SlideDTO;
import vacademy.io.admin_core_service.features.slide.service.AssignmentSlideService;
import vacademy.io.admin_core_service.features.slide.service.QuestionSlideService;
import vacademy.io.admin_core_service.features.slide.service.QuizSlideService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.Map;

@RestController
@RequestMapping("/admin-core-service/slide/quiz-slide")
public class QuizSlideController {

    @Autowired
    private QuizSlideService questionSlideService;

    @Autowired
    private QuizCbeSecretService quizCbeSecretService;

    @PostMapping("/add-or-update")
    public String addOrUpdateQuizSlide(@RequestBody SlideDTO slideDTO,
                                     @RequestParam String chapterId,
                                     @RequestParam String instituteId,
                                     @RequestParam String packageSessionId,
                                     @RequestParam String subjectId,
                                     @RequestParam String moduleId,
                                     @RequestAttribute("user") CustomUserDetails userDetails) {

        return questionSlideService.addOrUpdateQuizSlide(slideDTO, chapterId,packageSessionId,moduleId,subjectId, userDetails);
    }

    /**
     * CBE_RESPONSE: the model solutions, marking schemes and grading notes of the
     * spreadsheet questions in a quiz slide, keyed by question id, for the quiz editor.
     * Staff of the owning institute only (clientId header); learners never receive these,
     * not even through the slide JSON.
     */
    @GetMapping("/v1/{slideId}/evaluation-secrets")
    public ResponseEntity<Map<String, Object>> getEvaluationSecrets(@PathVariable String slideId,
                                                                    @RequestAttribute("user") CustomUserDetails userDetails) {
        return ResponseEntity.ok(quizCbeSecretService.getEvaluationSecrets(slideId, userDetails));
    }
}
