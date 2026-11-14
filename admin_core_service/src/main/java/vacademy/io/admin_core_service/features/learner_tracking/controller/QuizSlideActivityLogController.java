package vacademy.io.admin_core_service.features.learner_tracking.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.learner_tracking.dto.ActivityLogDTO;
import vacademy.io.admin_core_service.features.learner_tracking.dto.QuizQuestionFeedbackDTO;
import vacademy.io.admin_core_service.features.learner_tracking.service.QuizSlideActivityLogService;
import vacademy.io.common.auth.config.PageConstants;
import vacademy.io.common.auth.model.CustomUserDetails;

@RestController
@RequestMapping("/admin-core-service/learner-tracking/activity-log/quiz-slide")
public class QuizSlideActivityLogController {
    @Autowired
    private QuizSlideActivityLogService quizSlideActivityLogService;

    @PostMapping("/add-or-update-quiz-slide-activity-log")
    public ResponseEntity<String> addOrUpdateQuizSlideActivityLog(@RequestBody ActivityLogDTO activityLogDTO,
                                                                        String slideId,
                                                                        String chapterId,
                                                                        String moduleId,
                                                                        String subjectId,
                                                                        String packageSessionId,
                                                                        String userId,
                                                                        @RequestAttribute("user") CustomUserDetails user,
                                                                        @RequestHeader(value = "clientId", required = false) String clientId) {
        quizSlideActivityLogService.requireLegacySubmitAllowed(activityLogDTO, slideId, user, clientId);
        return ResponseEntity.ok(quizSlideActivityLogService.addOrUpdateQuizSlideActivityLog(activityLogDTO, slideId,chapterId,moduleId,subjectId,packageSessionId, userId, user));
    }

    @GetMapping("/quiz-slide-activity-logs")
    public ResponseEntity<Page<ActivityLogDTO>> getQuizSlideActivityLogs(
            @RequestParam("userId") String userId,
            @RequestParam("slideId") String slideId,
            @RequestParam(value = "pageNo", defaultValue = PageConstants.DEFAULT_PAGE_NUMBER, required = false) int pageNo,
            @RequestParam(value = "pageSize", defaultValue = PageConstants.DEFAULT_PAGE_SIZE, required = false) int pageSize,
            @RequestAttribute("user") CustomUserDetails userDetails) {

        return ResponseEntity.ok(quizSlideActivityLogService.getQuizSlideActivityLog(userId, slideId, PageRequest.of(pageNo, pageSize), userDetails));
    }

    @PostMapping("/save-question-feedback")
    public ResponseEntity<String> saveQuizQuestionFeedback(
            @RequestBody QuizQuestionFeedbackDTO dto,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(quizSlideActivityLogService.saveQuizQuestionFeedback(dto));
    }
}
