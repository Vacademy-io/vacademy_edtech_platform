package vacademy.io.admin_core_service.features.course_pulse.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.course_pulse.service.LearnerPulseService;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.Map;

/**
 * GET /admin-core-service/course-pulse/learner: one learner live pulse and recent reading, for
 * the student side view Academic Activity tab. Staff of the institute only; the learner must be
 * enrolled in it.
 */
@RestController
@RequestMapping("/admin-core-service/course-pulse")
@RequiredArgsConstructor
public class LearnerPulseController {

    private final LearnerPulseService learnerPulseService;
    private final InstituteAccessValidator instituteAccessValidator;
    private final StudentSessionInstituteGroupMappingRepository mappingRepository;

    @GetMapping("/learner")
    public ResponseEntity<Map<String, Object>> learner(@RequestParam("userId") String userId,
                                                       @RequestParam("instituteId") String instituteId,
                                                       @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireStaffAccess(user, instituteId);
        if (mappingRepository.findLatestPackageSessionIdByUserIdAndInstituteId(userId, instituteId).isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(learnerPulseService.learnerPulse(userId));
    }
}
