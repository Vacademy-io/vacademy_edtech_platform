package vacademy.io.assessment_service.features.scheduler.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.assessment_service.features.scheduler.service.LearnerSchedulerRunner;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;

@RestController
@RequestMapping("/assessment-service/scheduler/test")
public class SchedulerTestController {

    @Autowired
    LearnerSchedulerRunner learnerSchedulerRunner;

    @GetMapping("/update-attempt")
    public ResponseEntity<String> testAttemptScheduler(@RequestAttribute("user") CustomUserDetails user) {
        // Manual run of the hourly attempt sweep: platform super admins only.
        SuperAdminAuthUtil.requireSuperAdmin(user);
        learnerSchedulerRunner.updateAttemptStatus();
        return ResponseEntity.ok("Done");
    }
}
