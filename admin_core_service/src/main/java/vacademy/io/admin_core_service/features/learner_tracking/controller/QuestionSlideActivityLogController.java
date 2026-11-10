package vacademy.io.admin_core_service.features.learner_tracking.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.learner_tracking.cbe.CbeSlideSubmitService;
import vacademy.io.admin_core_service.features.learner_tracking.cbe.dto.CbeAttemptResponse;
import vacademy.io.admin_core_service.features.learner_tracking.cbe.dto.CbeSubmitRequest;
import vacademy.io.admin_core_service.features.learner_tracking.dto.ActivityLogDTO;
import vacademy.io.admin_core_service.features.learner_tracking.service.QuestionSlideActivityLogService;
import vacademy.io.common.auth.config.PageConstants;
import vacademy.io.common.auth.model.CustomUserDetails;

@RestController
@RequestMapping("/admin-core-service/learner-tracking/activity-log/question-slide")
public class QuestionSlideActivityLogController {

    @Autowired
    private QuestionSlideActivityLogService activityLogService;

    @Autowired
    private CbeSlideSubmitService cbeSlideSubmitService;

    @PostMapping("/add-or-update-question-slide-activity-log")
    public ResponseEntity<String> addOrUpdateQuestionSlideActivityLog(@RequestBody ActivityLogDTO activityLogDTO,
                                                                      @RequestParam String slideId,
                                                                      @RequestParam String chapterId,
                                                                      @RequestParam String packageSessionId,
                                                                      @RequestParam String moduleId,
                                                                      @RequestParam String subjectId,
                                                                      String userId,@RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(activityLogService.addOrUpdateQuestionSlideActivityLog(activityLogDTO, slideId,chapterId,packageSessionId,moduleId,subjectId, userId, user));
    }

    @GetMapping("/question-slide-activity-logs")
    public ResponseEntity<Page<ActivityLogDTO>> getVideoQuestionActivityLogs(
            @RequestParam("userId") String userId,
            @RequestParam("slideId") String slideId,
            @RequestParam(value = "pageNo", defaultValue = PageConstants.DEFAULT_PAGE_NUMBER, required = false) int pageNo,
            @RequestParam(value = "pageSize", defaultValue = PageConstants.DEFAULT_PAGE_SIZE, required = false) int pageSize,
            @RequestAttribute("user") CustomUserDetails userDetails) {

        return ResponseEntity.ok(activityLogService.getQuestionSlideActivityLogs(userId, slideId, PageRequest.of(pageNo, pageSize), userDetails));
    }

    /**
     * Spreadsheet & Written Response (CBE_RESPONSE): submit an answer for an instant AI check.
     * The learner is the token holder. 200 with the evaluation (or evaluation null and a
     * message when grading failed), 402 when the institute is out of AI credits (the answer
     * is saved), 409 when no AI checks are left. docs/CBE_RESPONSE_QUESTION.md section 5.2.
     */
    @PostMapping("/cbe/submit")
    public ResponseEntity<CbeAttemptResponse> submitCbeAnswer(@RequestBody CbeSubmitRequest request,
                                                              @RequestAttribute("user") CustomUserDetails user,
                                                              @RequestHeader(value = "clientId", required = false) String clientId) {
        CbeSlideSubmitService.Outcome outcome = cbeSlideSubmitService.submit(request, user, clientId);
        return ResponseEntity.status(outcome.httpStatus()).body(outcome.body());
    }

    /** The signed-in learner's latest CBE attempt on a slide, attempts left, and the solution once submitted. */
    @GetMapping("/cbe/my-attempts")
    public ResponseEntity<CbeAttemptResponse> myCbeAttempts(@RequestParam("slide_id") String slideId,
                                                            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(cbeSlideSubmitService.myAttempts(slideId, user));
    }

}
