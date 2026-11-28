package vacademy.io.admin_core_service.features.slide.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.slide.cbe.CbeEvaluationSecretService;
import vacademy.io.admin_core_service.features.slide.dto.SlideDTO;
import vacademy.io.admin_core_service.features.slide.service.QuestionSlideService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.Map;

@RestController
@RequestMapping("/admin-core-service/slide/question-slide")
public class QuestionSlideController {

    @Autowired
    private QuestionSlideService questionSlideService;

    @Autowired
    private CbeEvaluationSecretService cbeEvaluationSecretService;

    @PostMapping("/add-or-update")
    public String addQuestionSlide(@RequestBody SlideDTO slideDTO,
                                   @RequestParam String chapterId,
                                   @RequestParam String instituteId,
                                   @RequestParam String packageSessionId,
                                   @RequestParam String moduleId,
                                   @RequestParam String subjectId,
                                   @RequestAttribute("user") CustomUserDetails userDetails) {

        return questionSlideService.addOrUpdateQuestionSlide(slideDTO, chapterId,moduleId,subjectId,packageSessionId, userDetails);
    }

    /**
     * CBE_RESPONSE: the model solution, marking scheme and grading notes of a question
     * slide, for the editor. Staff of the owning institute only (clientId header); learners
     * never receive this, not even through the slide JSON.
     */
    @GetMapping("/v1/{slideId}/evaluation-secret")
    public ResponseEntity<Map<String, Object>> getEvaluationSecret(@PathVariable String slideId,
                                                                   @RequestAttribute("user") CustomUserDetails userDetails) {
        return ResponseEntity.ok(cbeEvaluationSecretService.getEvaluationSecret(slideId, userDetails));
    }

}
