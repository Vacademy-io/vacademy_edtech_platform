package vacademy.io.assessment_service.features.notification.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.assessment_service.features.notification.service.LearnerAssessmentNoticeService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;

/**
 * Manual triggers for the learner reminder and "has started" emails. The same work runs every
 * minute on its own ({@link LearnerAssessmentNoticeService#sendDueNotices()}); both endpoints run
 * that one pass, and each email is claimed before it is sent, so calling them never sends twice.
 * The pass covers every institute, so only platform super admins can trigger it by hand.
 */
@RestController
@RequestMapping("/assessment-service/notification")
@RequiredArgsConstructor
public class AssessmentNotificationController {

    private final LearnerAssessmentNoticeService learnerAssessmentNoticeService;

    @PostMapping("/upcoming")
    public ResponseEntity<String> sendNotificationForUpcomingAssessments(@RequestAttribute("user") CustomUserDetails user) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        learnerAssessmentNoticeService.sendDueNotices();
        return ResponseEntity.ok("Due assessment reminders sent.");
    }

    @PostMapping("/started")
    public ResponseEntity<String> sendNotificationForStartedAssessments(@RequestAttribute("user") CustomUserDetails user) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
        learnerAssessmentNoticeService.sendDueNotices();
        return ResponseEntity.ok("Due assessment reminders sent.");
    }
}
