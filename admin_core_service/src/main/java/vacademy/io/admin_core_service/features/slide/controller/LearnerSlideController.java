package vacademy.io.admin_core_service.features.slide.controller;

import lombok.AllArgsConstructor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.learner_quiz.answerkey.AnswerKeySurface;
import vacademy.io.admin_core_service.features.learner_quiz.answerkey.WithoutAnswerKeys;
import vacademy.io.admin_core_service.features.slide.dto.SlideDetailWithOperationProjection;
import vacademy.io.admin_core_service.features.slide.service.LearnerSlideService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.admin_core_service.config.cache.ClientCacheable;
import vacademy.io.admin_core_service.config.cache.CacheScope;

import java.util.List;

@RestController
@RequestMapping("/admin-core-service/slide/institute-learner/v1")
@AllArgsConstructor
public class LearnerSlideController {
    @Autowired
    private final LearnerSlideService learnerSlideService;

    @WithoutAnswerKeys(AnswerKeySurface.LEARNER)
    @GetMapping("/get-slides-with-status")
    @ClientCacheable(maxAgeSeconds = 60, scope = CacheScope.PRIVATE, varyHeaders = {"X-User-Id", "Accept-Language"})
    public ResponseEntity<List<SlideDetailWithOperationProjection>> getLearnerSlides(@RequestParam("userId") String userId, @RequestParam("chapterId") String chapterId, @RequestAttribute("user") CustomUserDetails userDetails) {
        return ResponseEntity.ok(learnerSlideService.getLearnerSlides(userId, chapterId, userDetails));
    }
}
