package vacademy.io.assessment_service.features.notification.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.assessment_service.features.notification.service.LearnerAssessmentNoticeService;

/**
 * Manual triggers for the learner reminder and "has started" emails. The same work runs every
 * minute on its own ({@link LearnerAssessmentNoticeService#sendDueNotices()}); both endpoints run
 * that one pass, and each email is claimed before it is sent, so calling them never sends twice.
 */
@RestController
@RequestMapping("/assessment-service/notification")
@RequiredArgsConstructor
public class AssessmentNotificationController {

    private final LearnerAssessmentNoticeService learnerAssessmentNoticeService;

    @PostMapping("/upcoming")
    public ResponseEntity<String> sendNotificationForUpcomingAssessments() {
        learnerAssessmentNoticeService.sendDueNotices();
        return ResponseEntity.ok("Due assessment reminders sent.");
    }

    @PostMapping("/started")
    public ResponseEntity<String> sendNotificationForStartedAssessments() {
        learnerAssessmentNoticeService.sendDueNotices();
        return ResponseEntity.ok("Due assessment reminders sent.");
    }
}
